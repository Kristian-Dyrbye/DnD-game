/**
 * Live, rotatable 3D preview of a character (creator + character screen). Rebuilds the model when
 * the appearance changes; renders only while mounted; shows a friendly message if the models
 * haven't been downloaded yet (Setup.bat runs scripts/assets-fetch.mjs).
 */
import type { ScarLocation } from '../../engine/core/creature';
import type { WoundLevel } from '../../engine/appearance/wounds';
import { lookKey, type EquipmentLook } from '../../engine/appearance/equipmentVisuals';
import { useEffect, useRef, useState } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Appearance } from '../../engine/appearance/appearance';
import { buildCharacterModel, type CharacterModel } from './characterModel';
import { settings } from '../ui/settingsState';
import { t } from '../ui/i18n';

/** Points the camera at the model so the whole figure fits (models differ in scale). */
function frame(camera: THREE.PerspectiveCamera, controls: OrbitControls, obj: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const fit = (size.y / 2 / Math.tan((camera.fov * Math.PI) / 360)) * 1.35;
  controls.target.copy(center);
  camera.position.set(center.x, center.y + size.y * 0.08, center.z + fit);
  controls.minDistance = fit * 0.6;
  controls.maxDistance = fit * 1.8;
  controls.update();
}

export function CharacterPreview({ appearance, size = 'medium', height = 260, look, wounds = 0, seed = 'hero', scars = [], wear = 0, onSnapshot, onPickScar }: { appearance: Appearance; size?: string; height?: number; look?: EquipmentLook; wounds?: WoundLevel; seed?: string; scars?: readonly ScarLocation[]; wear?: number; onSnapshot?: (dataUrl: string) => void; onPickScar?: (loc: ScarLocation | null) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; model?: CharacterModel } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One renderer/scene per mounted preview.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setError('3D preview unavailable (WebGL is disabled).');
      return;
    }
    // Texture quality → render resolution; the frame cap below keeps idle previews cheap.
    const perf = settings.value?.performance;
    const maxRatio = perf?.textureQuality === 'low' ? 1 : perf?.textureQuality === 'high' ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxRatio));
    const frameMs = 1000 / Math.min(perf?.fpsCap ?? 60, 60);
    renderer.setSize(el.clientWidth, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / height, 0.1, 50);
    camera.position.set(0, 1.4, 4.2);
    scene.add(new THREE.HemisphereLight(0xfff2dd, 0x2a2016, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ color: 0x2c251c, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enablePan = false;
    controls.minDistance = 2.5;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.55;
    controls.update();

    sceneRef.current = { scene, camera, controls };

    // Click a scar mark to inspect it (drags rotate the model instead).
    const raycaster = new THREE.Raycaster();
    let downAt: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (downAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const pick = onPickRef.current;
      const model = sceneRef.current?.model;
      if (!pick || !model || !downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObject(model.root, true).find((h) => h.object.userData.scar);
      pick((hit?.object.userData.scar as ScarLocation | undefined) ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const clock = new THREE.Clock();
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < frameMs) return;
      last = now;
      sceneRef.current?.model?.update(clock.getDelta());
      renderer.render(scene, camera);
      // Save-browser thumbnail: copy the frame right after rendering (no preserveDrawingBuffer needed).
      if (snapRef.current && sceneRef.current?.model && onSnapshotRef.current) {
        snapRef.current = false;
        const small = document.createElement('canvas');
        small.width = 128;
        small.height = 128;
        const g = small.getContext('2d');
        const src = renderer.domElement;
        const side = Math.min(src.width, src.height);
        g?.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, 128, 128);
        try {
          onSnapshotRef.current(small.toDataURL('image/jpeg', 0.75));
        } catch {
          /* tainted canvas or unsupported: skip */
        }
      }
    };
    raf = requestAnimationFrame(tick);

    const onResize = () => {
      renderer.setSize(el.clientWidth, height);
      camera.aspect = el.clientWidth / height;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      sceneRef.current?.model?.dispose();
      sceneRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [height]);

  const snapRef = useRef(false);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onPickRef = useRef(onPickScar);
  onPickRef.current = onPickScar;

  // Wounds follow HP (overlays fade in/out inside the model).
  const woundsRef = useRef(wounds);
  woundsRef.current = wounds;
  const wearRef = useRef(wear);
  wearRef.current = wear;
  useEffect(() => {
    sceneRef.current?.model?.setWounds?.(wounds, seed);
    sceneRef.current?.model?.setWear?.(wear, seed);
  }, [wounds, wear, seed]);

  // (Re)build the model when the look changes.
  const key = JSON.stringify(appearance) + size + lookKey(look) + scars.join(',');
  useEffect(() => {
    let cancelled = false;
    buildCharacterModel(appearance, size, look, scars)
      .then((model) => {
        const holder = sceneRef.current;
        if (cancelled || !holder) return model.dispose();
        if (holder.model) {
          holder.scene.remove(holder.model.root);
          holder.model.dispose();
        }
        holder.model = model;
        model.setWounds?.(woundsRef.current, seed);
        model.setWear?.(wearRef.current, seed);
        holder.scene.add(model.root);
        frame(holder.camera, holder.controls, model.root);
        snapRef.current = true;
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError('3D models not found. Run Setup.bat to download them.');
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (
    <div class="character-preview" ref={host} style={{ height: `${height}px` }} aria-label={t('preview.aria')}>
      {error && <p class="preview-error">{error}</p>}
    </div>
  );
}
