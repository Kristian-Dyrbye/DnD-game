/**
 * Scar marks on a KayKit character (spec §12): a thin dark mark per scar, placed on the body in
 * bind-pose model space (front = +Z, the character's left = +X, measured on Knight.glb) and then
 * re-parented to the nearest bone with `attach`, so it moves with the animation.
 */
import * as THREE from 'three';
import type { ScarLocation } from '../../engine/core/creature';

interface Spot {
  bone: string;
  at: [number, number, number];
  /** Surface normal (the mark faces this way). */
  n: [number, number, number];
  tilt: number;
}

const SPOTS: Record<ScarLocation, Spot> = {
  left_cheek: { bone: 'head', at: [0.3, 1.62, 0.5], n: [0.3, 0, 1], tilt: 0.5 },
  right_cheek: { bone: 'head', at: [-0.3, 1.62, 0.5], n: [-0.3, 0, 1], tilt: -0.5 },
  brow: { bone: 'head', at: [0.12, 1.98, 0.5], n: [0, 0.2, 1], tilt: 0.2 },
  jaw: { bone: 'head', at: [0.16, 1.36, 0.45], n: [0, -0.3, 1], tilt: -0.3 },
  neck: { bone: 'head', at: [0.12, 1.28, 0.3], n: [0, 0, 1], tilt: 0.1 },
  chest: { bone: 'chest', at: [0.12, 1.08, 0.38], n: [0, 0, 1], tilt: 0.7 },
  back: { bone: 'chest', at: [-0.1, 1.02, -0.39], n: [0, 0, -1], tilt: -0.6 },
  left_shoulder: { bone: 'chest', at: [0.3, 1.2, 0.16], n: [0.2, 0.3, 1], tilt: 0.3 },
  right_shoulder: { bone: 'chest', at: [-0.3, 1.2, 0.16], n: [-0.2, 0.3, 1], tilt: -0.3 },
  left_arm: { bone: 'lowerarml', at: [0.6, 1.11, 0.14], n: [0, 0, 1], tilt: 0.4 },
  right_arm: { bone: 'lowerarmr', at: [-0.6, 1.11, 0.14], n: [0, 0, 1], tilt: -0.4 },
  left_hand: { bone: 'handl', at: [0.86, 1.14, 0.12], n: [0, 0.3, 1], tilt: 0.2 },
  right_hand: { bone: 'handr', at: [-0.86, 1.14, 0.12], n: [0, 0.3, 1], tilt: -0.2 },
  left_leg: { bone: 'upperlegl', at: [0.17, 0.4, 0.3], n: [0, 0, 1], tilt: 0.5 },
  right_leg: { bone: 'upperlegr', at: [-0.17, 0.4, 0.3], n: [0, 0, 1], tilt: -0.5 },
};

const material = new THREE.MeshStandardMaterial({ color: 0x5a1c1c, roughness: 0.9 });
const geometry = new THREE.BoxGeometry(0.2, 0.03, 0.012);

/** Add one mark per scar location (call on the unscaled, bind-posed model root). */
export function attachScarMarks(root: THREE.Object3D, locations: readonly ScarLocation[]): void {
  if (!locations.length) return;
  root.updateMatrixWorld(true);
  for (const loc of locations) {
    const spot = SPOTS[loc];
    const bone = root.getObjectByName(spot.bone);
    if (!bone) continue;
    const mark = new THREE.Mesh(geometry, material);
    mark.name = `scar:${loc}`;
    mark.userData.scar = loc;
    const normal = new THREE.Vector3(...spot.n).normalize();
    mark.position.set(...spot.at).addScaledVector(normal, 0.01);
    mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mark.rotateZ(spot.tilt);
    root.add(mark);
    mark.updateMatrixWorld(true);
    bone.attach(mark); // keep the world transform, follow the bone from now on
  }
}
