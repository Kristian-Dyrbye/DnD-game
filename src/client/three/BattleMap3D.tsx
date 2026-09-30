/**
 * 3D battle map (spec §10, §12): the same props as the 2D BattleMap, drawn with three.js — ground
 * squares, raised blocking squares, darker difficult ground, walls/doors, overlays (reachable,
 * zones, area preview), a planned path, and tokens. Heroes and companions get their KayKit model
 * and monsters get models from their stat block (monsterVisuals), up to
 * settings.performance.maxNpcModels; the rest get side-coloured stand-ins.
 * Each token has an HP ring; the active creature and valid targets get rings too. Orbit (drag),
 * zoom (wheel) and pan (right drag) the camera; click a square to act. Rendering follows the fps cap.
 */
import { armorWear } from '../../engine/character/armorWear';
import { woundLevel } from '../../engine/appearance/wounds';
import { monsterVisual } from '../../engine/appearance/monsterVisuals';
import { buildMonsterModel } from './monsterModel';
import { equipmentLook, lookKey } from '../../engine/appearance/equipmentVisuals';
import type { Character } from '../../engine/core/creature';
import { db } from '../data';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cellKey, footprintSize } from '../../engine/combat/grid';
import type { BattleMapProps } from '../ui/combat/BattleMap';
import { settings } from '../ui/settingsState';
import { t } from '../ui/i18n';
import { SIDE_COLOURS, edgeSegments, hpColour, modelTokens, overlayFor, terrainOf, tokenCentre, worldToSquare } from './battle3d';
import { buildCharacterModel, type CharacterModel } from './characterModel';

interface Holder {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  board: THREE.Group;
  tokens: THREE.Group;
  models: Map<string, { model?: CharacterModel; loading: boolean; failed: boolean; look: string }>;
  dirty: boolean;
}

const disposeGroup = (g: THREE.Group) => {
  for (const child of [...g.children]) {
    g.remove(child);
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
  }
};

function ring(radius: number, color: number, width = 0.05, arc = Math.PI * 2, dashed = false): THREE.Mesh {
  const geo = new THREE.RingGeometry(radius, radius + width, 48, 1, Math.PI / 2, -arc);
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: dashed, opacity: dashed ? 0.85 : 1 });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

export function BattleMap3D(p: BattleMapProps & { onUnavailable?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const holder = useRef<Holder | null>(null);
  const props = useRef(p);
  props.current = p;
  const [message, setMessage] = useState<string | null>(null);
  const [modelsReady, setModelsReady] = useState(0);

  // Renderer, scene, camera, controls, picking and the render loop (once per mount).
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      p.onUnavailable?.();
      return;
    }
    const perf = settings.value?.performance;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, perf?.textureQuality === 'low' ? 1 : perf?.textureQuality === 'high' ? 2 : 1.5));
    renderer.shadowMap.enabled = (perf?.shadows ?? 'low') !== 'off';
    const height = Math.max(360, Math.min(640, window.innerHeight - 260));
    renderer.setSize(el.clientWidth, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const { grid } = props.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x15130f);
    const camera = new THREE.PerspectiveCamera(45, el.clientWidth / height, 0.1, 200);
    const cx = grid.width / 2;
    const cz = grid.height / 2;
    camera.position.set(cx, Math.max(grid.width, grid.height) * 0.85, cz + Math.max(grid.width, grid.height) * 0.75);
    scene.add(new THREE.HemisphereLight(0xfff2dd, 0x2a2016, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(cx - 6, 14, cz - 4);
    sun.castShadow = renderer.shadowMap.enabled;
    sun.shadow.mapSize.set(perf?.shadows === 'high' ? 2048 : 1024, perf?.shadows === 'high' ? 2048 : 1024);
    const span = Math.max(grid.width, grid.height);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span });
    sun.target.position.set(cx, 0, cz);
    scene.add(sun, sun.target);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(cx, 0, cz);
    controls.maxPolarAngle = Math.PI * 0.45;
    controls.minDistance = 3;
    controls.maxDistance = span * 2.2;
    controls.update();

    const board = new THREE.Group();
    const tokens = new THREE.Group();
    scene.add(board, tokens);
    holder.current = { scene, camera, controls, board, tokens, models: new Map(), dirty: true };
    controls.addEventListener('change', () => holder.current && (holder.current.dirty = true));

    // Picking on the ground plane.
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const toSquare = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return worldToSquare(props.current.grid, hit.x, hit.z);
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const sq = toSquare(e);
      if (sq) props.current.onSquare?.(sq);
    };
    let lastHover = '';
    const onMove = (e: PointerEvent) => {
      const sq = toSquare(e);
      const k = sq ? `${sq.x},${sq.y}` : '';
      if (k === lastHover) return;
      lastHover = k;
      props.current.onHover?.(sq);
    };
    const onLeave = () => {
      lastHover = '';
      props.current.onHover?.(null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const frameMs = 1000 / Math.min(perf?.fpsCap ?? 60, 60);
    const clock = new THREE.Clock();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frameMs) return;
      last = now;
      const h = holder.current;
      if (!h) return;
      const dt = clock.getDelta();
      let animating = false;
      for (const m of h.models.values()) if (m.model?.update(dt)) animating = true;
      if (animating || h.dirty) {
        renderer.render(scene, camera);
        h.dirty = false;
      }
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      renderer.setSize(el.clientWidth, height);
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
      if (holder.current) holder.current.dirty = true;
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      const h = holder.current;
      if (h) {
        for (const m of h.models.values()) m.model?.dispose();
        disposeGroup(h.board);
        disposeGroup(h.tokens);
      }
      holder.current = null;
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Board: ground squares, terrain, overlays, walls, path.
  useEffect(() => {
    const h = holder.current;
    if (!h) return;
    disposeGroup(h.board);
    const { grid } = p;
    const shadows = (settings.value?.performance.shadows ?? 'low') !== 'off';
    const tile = new THREE.PlaneGeometry(0.96, 0.96);
    const ground = new THREE.MeshStandardMaterial({ color: 0x3a3629, roughness: 1 });
    const rough = new THREE.MeshStandardMaterial({ color: 0x2c2a1c, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(grid.width, grid.height), new THREE.MeshStandardMaterial({ color: 0x1d1b15, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(grid.width / 2, -0.01, grid.height / 2);
    floor.receiveShadow = shadows;
    h.board.add(floor);
    const block = new THREE.BoxGeometry(1, 0.9, 1);
    const blockMat = new THREE.MeshStandardMaterial({ color: 0x4a443a, roughness: 0.9 });
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (p.fog?.has(cellKey({ x, y }))) continue;
        const t = terrainOf(grid, x, y);
        if (t === 'blocking') {
          const b = new THREE.Mesh(block, blockMat);
          b.position.set(x + 0.5, 0.45, y + 0.5);
          b.castShadow = shadows;
          b.receiveShadow = shadows;
          h.board.add(b);
          continue;
        }
        const m = new THREE.Mesh(tile, t === 'difficult' ? rough : ground);
        m.rotation.x = -Math.PI / 2;
        m.position.set(x + 0.5, 0, y + 0.5);
        m.receiveShadow = shadows;
        h.board.add(m);
        const o = overlayFor(cellKey({ x, y }), p);
        if (o) {
          const ov = new THREE.Mesh(tile, new THREE.MeshBasicMaterial({ color: o.color, transparent: true, opacity: o.opacity, depthWrite: false }));
          ov.rotation.x = -Math.PI / 2;
          ov.position.set(x + 0.5, 0.01, y + 0.5);
          h.board.add(ov);
        }
      }
    }
    for (const s of edgeSegments(grid)) {
      if (s.open || p.fog?.has(cellKey({ x: Math.floor(s.x0), y: Math.floor(s.z0) }))) continue;
      const len = Math.hypot(s.x1 - s.x0, s.z1 - s.z0);
      const w = new THREE.Mesh(new THREE.BoxGeometry(s.x1 !== s.x0 ? len : 0.12, s.door ? 0.8 : 1.2, s.z1 !== s.z0 ? len : 0.12), new THREE.MeshStandardMaterial({ color: s.door ? 0xc8913a : 0xd8d0c0 }));
      w.position.set((s.x0 + s.x1) / 2, s.door ? 0.4 : 0.6, (s.z0 + s.z1) / 2);
      w.castShadow = shadows;
      h.board.add(w);
    }
    if (p.path && p.path.length > 1) {
      const pts = p.path.map((pt) => new THREE.Vector3(pt.x + 0.5, 0.05, pt.y + 0.5));
      h.board.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0xffd76a, dashSize: 0.2, gapSize: 0.12 })).computeLineDistances());
    }
    h.dirty = true;
  }, [p.grid, p.reachable, p.aoe, p.zones, p.fog, p.path]);

  // Tokens: models or stand-ins, rings, positions.
  useEffect(() => {
    const h = holder.current;
    if (!h) return;
    // Keep loaded models (they're reused); rebuild everything else.
    for (const m of h.models.values()) if (m.model) h.tokens.remove(m.model.root);
    disposeGroup(h.tokens);
    const { grid, creatures, sides } = p;
    const shadows = (settings.value?.performance.shadows ?? 'low') !== 'off';
    const withModels = modelTokens(grid, creatures, sides, settings.value?.performance.maxNpcModels ?? 12);
    for (const t of Object.values(grid.tokens)) {
      const c = creatures[t.id];
      if (!c || p.fog?.has(cellKey({ x: t.x, y: t.y }))) continue;
      const n = footprintSize(t.size);
      const at = tokenCentre(t);
      const down = c.hp <= 0;
      const side = SIDE_COLOURS[sides[t.id] ?? 'neutral'] ?? SIDE_COLOURS.neutral!;
      const base = n / 2 - 0.12;
      const hpRing = ring(base, hpColour(c.hp, c.maxHp), 0.07, Math.PI * 2 * Math.max(0.001, c.hp / c.maxHp));
      hpRing.position.set(at.x, 0.03, at.z);
      h.tokens.add(hpRing);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(base, 32), new THREE.MeshBasicMaterial({ color: side, transparent: true, opacity: 0.55 }));
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(at.x, 0.02, at.z);
      h.tokens.add(disc);
      if (t.id === p.activeId) {
        const r = ring(base + 0.1, 0xffd76a, 0.06);
        r.position.set(at.x, 0.035, at.z);
        h.tokens.add(r);
      }
      if (p.targets?.has(t.id)) {
        const r = ring(base + 0.18, 0xff5a4a, 0.05, Math.PI * 2, true);
        r.position.set(at.x, 0.04, at.z);
        h.tokens.add(r);
      }
      const look = c.kind === 'character' ? equipmentLook(c as Character, db) : undefined;
      let entry = h.models.get(t.id);
      const scarKey = c.kind === 'character' ? (c as Character).scars.map((s) => s.location).join(',') : '';
      if (entry && entry.look !== lookKey(look) + scarKey) {
        // Gear changed (e.g. a new weapon): rebuild this model.
        entry.model?.dispose();
        h.models.delete(t.id);
        entry = undefined;
      }
      if (withModels.has(t.id) && entry?.model) {
        entry.model.setWounds?.(woundLevel(c.hp, c.maxHp), t.id);
        if (c.kind === 'character') entry.model.setWear?.(armorWear(c as Character), t.id);
        const root = entry.model.root;
        root.position.set(at.x, 0, at.z);
        root.rotation.set(down ? -Math.PI / 2 : 0, sides[t.id] === 'enemy' ? -Math.PI / 2 : Math.PI / 2, 0);
        if (down) root.position.y = 0.15;
        h.tokens.add(root);
        continue;
      }
      if (withModels.has(t.id) && !entry) {
        const slot = { loading: true, failed: false, look: lookKey(look) + scarKey } as { model?: CharacterModel; loading: boolean; failed: boolean; look: string };
        h.models.set(t.id, slot);
        const building =
          c.kind === 'character'
            ? buildCharacterModel((c as Character).appearance, c.size, look, (c as Character).scars.map((s) => s.location))
            : buildMonsterModel(monsterVisual(c.statBlockId ?? c.id, c.creatureType), c.size);
        building
          .then((model) => {
            const live = holder.current;
            if (!live || live.models.get(t.id) !== slot) return model.dispose();
            // Fit the figure to its squares (models differ in scale).
            model.root.updateMatrixWorld(true); // bones must be posed before measuring (Quaternius rigs are scaled ×100)
            const box = new THREE.Box3().setFromObject(model.root, true);
            const tall = box.getSize(new THREE.Vector3()).y || 1;
            model.root.scale.multiplyScalar((n * 1.1) / tall);
            model.root.traverse((o) => ((o as THREE.Mesh).castShadow = shadows));
            slot.model = model;
            slot.loading = false;
            setModelsReady((v) => v + 1); // place the model on the next token pass
          })
          .catch(() => {
            slot.loading = false;
            slot.failed = true;
            setMessage('3D models not found (run Setup.bat); showing stand-ins.');
          });
      }
      // Stand-in: a coloured pawn scaled to the footprint (over the model budget, or while a model loads).
      const pawn = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * n, 0.45 * n, 4, 12), new THREE.MeshStandardMaterial({ color: side, roughness: 0.6, transparent: down, opacity: down ? 0.45 : 1 }));
      pawn.position.set(at.x, down ? 0.25 * n : 0.45 * n, at.z);
      if (down) pawn.rotation.z = Math.PI / 2;
      pawn.castShadow = shadows;
      h.tokens.add(pawn);
    }
    h.dirty = true;
  }, [p.grid, p.creatures, p.sides, p.activeId, p.targets, p.fog, modelsReady]);

  return (
    <div class="battle-3d" ref={host} aria-label={t('combat.map3dAria')}>
      {message && <p class="preview-error">{message}</p>}
    </div>
  );
}
