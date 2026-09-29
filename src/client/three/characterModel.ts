/**
 * Builds a character model from Appearance data using the KayKit modular adventurers:
 * body/arms/legs from the outfit file, a head from any outfit (re-bound to the same skeleton),
 * optional headgear and cape, a primary-colour tint on cape/headgear, skin recolouring of the
 * texture atlas, build width and size scale. The built-in weapon meshes stay hidden; the equipped
 * gear is attached to the hand slots instead (equipmentModels.ts).
 */
import type { ScarLocation } from '../../engine/core/creature';
import { attachScarMarks } from './scarMarks';
import type { WoundLevel } from '../../engine/appearance/wounds';
import { addWoundOverlays, setWounds, tickWounds } from './wounds';
import type { EquipmentLook } from '../../engine/appearance/equipmentVisuals';
import { attachEquipment } from './equipmentModels';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildWidth, sizeScale, type Appearance } from '../../engine/appearance/appearance';
import { HEADGEAR_MESH, HEAD_MESH, OUTFIT_FILES, OUTFIT_PREFIX, loadGltf } from './loader';

export interface CharacterModel {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  play(clip: string): void;
  /** Advance animation (and wound fading); returns true if anything changed. */
  update(dt: number): boolean;
  /** Temporary wound overlays (characters only). */
  setWounds?(level: WoundLevel, seed: string): void;
  dispose(): void;
}

const BODY_PARTS = ['Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight'];

// ---------------------------------------------------------------- skin recolouring

const recolourCache = new Map<string, THREE.Texture>();

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** True for warm, mid-saturation colours typical of the atlas's skin swatches. */
function isSkin(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max < 110 || r < g || g < b) return false;
  const sat = (max - min) / max;
  const hue = ((g - b) / (max - min || 1)) * 60;
  return sat > 0.18 && sat < 0.62 && hue > 12 && hue < 42 && r - b > 40;
}

/** Copy of the texture with skin-like pixels shifted towards `tone` (keeping shading). */
function recolouredTexture(tex: THREE.Texture, tone: string): THREE.Texture {
  const key = `${tex.uuid}:${tone}`;
  const cached = recolourCache.get(key);
  if (cached) return cached;
  const img = tex.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width || typeof document === 'undefined') return tex;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return tex;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const [tr, tg, tb] = hexToRgb(tone);
  for (let i = 0; i < data.data.length; i += 4) {
    const r = data.data[i]!;
    const g = data.data[i + 1]!;
    const b = data.data[i + 2]!;
    if (!isSkin(r, g, b)) continue;
    // Keep the atlas shading: scale the target tone by this pixel's brightness relative to a typical skin swatch.
    const shade = (r + g + b) / 3 / 190;
    data.data[i] = Math.min(255, tr * shade);
    data.data[i + 1] = Math.min(255, tg * shade);
    data.data[i + 2] = Math.min(255, tb * shade);
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  out.magFilter = tex.magFilter;
  out.minFilter = tex.minFilter;
  recolourCache.set(key, out);
  return out;
}

function withMaterial(mesh: THREE.Mesh, fn: (m: THREE.MeshStandardMaterial) => void): void {
  const m = (mesh.material as THREE.MeshStandardMaterial).clone();
  fn(m);
  mesh.material = m;
}

function applySkin(mesh: THREE.Mesh, tone: string): void {
  withMaterial(mesh, (m) => {
    if (m.map) m.map = recolouredTexture(m.map, tone);
  });
}

// ---------------------------------------------------------------- build

export async function buildCharacterModel(a: Appearance, size = 'medium', look?: EquipmentLook, scars: readonly ScarLocation[] = []): Promise<CharacterModel> {
  const base = await loadGltf(OUTFIT_FILES[a.outfit]);
  const root = cloneSkinned(base.scene);
  const prefix = OUTFIT_PREFIX[a.outfit];
  const keep = new Set(BODY_PARTS.map((p) => `${prefix}_${p}`));
  if (a.showCape) keep.add(`${prefix}_Cape`);
  const headgear = HEADGEAR_MESH[a.outfit];
  if (a.showHeadgear && headgear) keep.add(headgear);
  const sameHead = a.head === a.outfit || (OUTFIT_PREFIX[a.head] === prefix && HEAD_MESH[a.head] === HEAD_MESH[a.outfit]);
  if (sameHead) keep.add(HEAD_MESH[a.outfit]);

  let skeleton: THREE.Skeleton | undefined;
  let bodyMesh: THREE.SkinnedMesh | undefined;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.visible = keep.has(mesh.name);
    mesh.castShadow = true;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh && mesh.name === `${prefix}_Body`) {
      bodyMesh = mesh as THREE.SkinnedMesh;
      skeleton = bodyMesh.skeleton;
    }
  });

  // Head from another outfit: re-bind its skinned mesh to this skeleton.
  if (!sameHead) {
    const other = await loadGltf(OUTFIT_FILES[a.head]);
    const src = other.scene.getObjectByName(HEAD_MESH[a.head]) as THREE.SkinnedMesh | THREE.Mesh | undefined;
    if (src && (src as THREE.SkinnedMesh).isSkinnedMesh && skeleton && bodyMesh) {
      const s = src as THREE.SkinnedMesh;
      const head = new THREE.SkinnedMesh(s.geometry, s.material);
      head.name = HEAD_MESH[a.head];
      head.bind(skeleton, s.bindMatrix);
      head.castShadow = true;
      bodyMesh.parent?.add(head);
    } else if (src) {
      const headBone = root.getObjectByName('head');
      const copy = src.clone();
      (headBone ?? root).add(copy);
    }
  }

  // Colours: skin tone on skin-bearing parts, primary tint on cape and headgear.
  const tint = new THREE.Color('#ffffff').lerp(new THREE.Color(a.primaryColor), 0.65);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (/_Cape$/.test(mesh.name) || mesh.name === headgear) withMaterial(mesh, (m) => m.color.copy(tint));
    else if (/_(Head|Head_Hooded|ArmLeft|ArmRight)$/.test(mesh.name)) applySkin(mesh, a.skinTone);
  });

  // Weapons and shields in the hands (A088); wound decal overlays (A090).
  await attachEquipment(root, look);
  addWoundOverlays(root);
  // Permanent scar marks (A091), placed before scaling.
  attachScarMarks(root, scars);

  const scale = sizeScale(size);
  const width = buildWidth(a.build);
  root.scale.set(scale * width, scale, scale * width);

  const mixer = new THREE.AnimationMixer(root);
  let action: THREE.AnimationAction | undefined;
  const play = (name: string) => {
    const clip = base.animations.find((c) => c.name === name) ?? base.animations.find((c) => c.name === 'Idle');
    if (!clip) return;
    action?.fadeOut(0.2);
    action = mixer.clipAction(clip);
    action.reset().fadeIn(0.2).play();
  };
  play('Idle');

  return {
    root,
    mixer,
    play,
    update: (dt: number) => {
      mixer.update(dt);
      tickWounds(root, dt);
      return true;
    },
    setWounds: (level: WoundLevel, seed: string) => setWounds(root, level, seed),
    dispose: () => {
      mixer.stopAllAction();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.material !== undefined) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m.dispose();
        }
      });
    },
  };
}
