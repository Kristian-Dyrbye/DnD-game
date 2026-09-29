/**
 * Wound overlays on a KayKit character (spec §12 "temporary wounds"): each visible body part gets a
 * transparent copy (same geometry, skeleton and UVs) textured with procedural decals — bruises, cuts
 * and blood — seeded per character so they stay in place. More decals and more opacity as the wound
 * step rises; opacity eases towards its target, so wounds fade when HP comes back.
 */
import * as THREE from 'three';
import { WOUND_LOOK, type WoundLevel } from '../../engine/appearance/wounds';

const PARTS = /_(Body|ArmLeft|ArmRight|LegLeft|LegRight|Head|Head_Hooded)$/;
const SIZE = 256;

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

const textures = new Map<string, THREE.Texture>();

/** Decal texture for a seed and step (the first N decals are the same at every step, so wounds only add up). */
function woundTexture(seed: string, level: WoundLevel): THREE.Texture | undefined {
  if (typeof document === 'undefined' || level === 0) return undefined;
  const key = `${seed}:${level}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  const r = rand(hash(seed));
  for (let i = 0; i < WOUND_LOOK[level].decals; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    const kind = r();
    if (kind < 0.35) {
      // Bruise: soft purple-brown blot.
      const grad = g.createRadialGradient(x, y, 0, x, y, 6 + r() * 10);
      grad.addColorStop(0, 'rgba(70,30,60,0.8)');
      grad.addColorStop(1, 'rgba(70,30,60,0)');
      g.fillStyle = grad;
      g.fillRect(x - 20, y - 20, 40, 40);
    } else if (kind < 0.75) {
      // Cut: a thin dark-red stroke.
      g.strokeStyle = 'rgba(110,10,10,0.95)';
      g.lineWidth = 1 + r() * 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 22, y + (r() - 0.5) * 22);
      g.stroke();
    } else {
      // Blood: a splash with drips.
      g.fillStyle = 'rgba(140,0,0,0.85)';
      g.beginPath();
      g.arc(x, y, 2 + r() * 4, 0, Math.PI * 2);
      g.fill();
      for (let d = 0; d < 3; d++) g.fillRect(x + (r() - 0.5) * 8, y, 1.2, 4 + r() * 8);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false; // glTF UV convention
  textures.set(key, tex);
  return tex;
}

interface WoundRig {
  overlays: THREE.Mesh[];
  material: THREE.MeshStandardMaterial;
  target: number;
  level: WoundLevel;
}

/** Transparent copies of the matching body parts sharing geometry/skeleton/UVs, with one material. */
function makeOverlays(root: THREE.Object3D, parts: RegExp, suffix: string): { overlays: THREE.Mesh[]; material: THREE.MeshStandardMaterial } {
  const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6 });
  const overlays: THREE.Mesh[] = [];
  const found: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && parts.test(m.name)) found.push(m);
  });
  for (const m of found) {
    const sk = m as THREE.SkinnedMesh;
    let copy: THREE.Mesh;
    if (sk.isSkinnedMesh) {
      const skinned = new THREE.SkinnedMesh(sk.geometry, material);
      skinned.bind(sk.skeleton, sk.bindMatrix);
      skinned.frustumCulled = false;
      copy = skinned;
    } else copy = new THREE.Mesh(m.geometry, material);
    copy.name = `${m.name}_${suffix}`;
    copy.visible = false;
    copy.position.copy(m.position);
    copy.quaternion.copy(m.quaternion);
    copy.scale.copy(m.scale);
    m.parent?.add(copy);
    overlays.push(copy);
  }
  return { overlays, material };
}

/** Create the (initially invisible) overlays on a built character model. */
export function addWoundOverlays(root: THREE.Object3D): void {
  const { overlays, material } = makeOverlays(root, PARTS, 'wounds');
  root.userData.wounds = { overlays, material, target: 0, level: 0 } satisfies WoundRig;
  const wear = makeOverlays(root, ARMOR_PARTS, 'wear');
  wear.material.polygonOffsetFactor = -1;
  root.userData.wear = wear;
}

// ---------------------------------------------------------------- armor wear (A092)

const ARMOR_PARTS = /_(Body|ArmLeft|ArmRight|LegLeft|LegRight)$/;

/** Grey scratches and dark dents, more of them with more wear (0–100). */
function wearTexture(seed: string, step: number): THREE.Texture | undefined {
  if (typeof document === 'undefined' || step === 0) return undefined;
  const key = `wear:${seed}:${step}`;
  const hit = textures.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  const r = rand(hash(`wear:${seed}`));
  for (let i = 0; i < step * 14; i++) {
    const x = r() * SIZE;
    const y = r() * SIZE;
    if (r() < 0.6) {
      g.strokeStyle = 'rgba(210,210,215,0.7)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r() - 0.5) * 18, y + (r() - 0.5) * 18);
      g.stroke();
    } else {
      const grad = g.createRadialGradient(x, y, 0, x, y, 3 + r() * 5);
      grad.addColorStop(0, 'rgba(20,20,25,0.7)');
      grad.addColorStop(1, 'rgba(20,20,25,0)');
      g.fillStyle = grad;
      g.fillRect(x - 10, y - 10, 20, 20);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  textures.set(key, tex);
  return tex;
}

/** Show armor wear (0–100) as scratches and dents on the armored parts. */
export function setWear(root: THREE.Object3D, wear: number, seed: string): void {
  const rig = root.userData.wear as { overlays: THREE.Mesh[]; material: THREE.MeshStandardMaterial } | undefined;
  if (!rig) return;
  const step = wear <= 0 ? 0 : Math.min(4, Math.ceil(wear / 25));
  const tex = wearTexture(seed, step);
  rig.material.map = tex ?? null;
  rig.material.opacity = step ? 0.85 : 0;
  rig.material.needsUpdate = true;
  for (const o of rig.overlays) o.visible = step > 0;
}

/** Set the wound step (seeded by `seed`, e.g. the creature id). */
export function setWounds(root: THREE.Object3D, level: WoundLevel, seed: string): void {
  const rig = root.userData.wounds as WoundRig | undefined;
  if (!rig) return;
  // Keep the current decals while fading out; switch texture when getting worse.
  if (level > rig.level || rig.material.map === null || rig.material.map === undefined) {
    const tex = woundTexture(seed, level);
    if (tex) {
      rig.material.map = tex;
      rig.material.needsUpdate = true;
    }
  }
  rig.level = level;
  rig.target = WOUND_LOOK[level].opacity;
  for (const o of rig.overlays) o.visible = rig.material.opacity > 0.01 || rig.target > 0;
}

/** Ease the overlay opacity towards its target (call every frame; ~1 s to fade). Returns true while changing. */
export function tickWounds(root: THREE.Object3D, dt: number): boolean {
  const rig = root.userData.wounds as WoundRig | undefined;
  if (!rig) return false;
  const diff = rig.target - rig.material.opacity;
  if (Math.abs(diff) < 0.005) {
    if (rig.target === 0) for (const o of rig.overlays) o.visible = false;
    return false;
  }
  rig.material.opacity += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.2);
  return true;
}
