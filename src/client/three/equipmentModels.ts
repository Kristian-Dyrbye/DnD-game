/**
 * Loads the low-poly weapon/shield parts and attaches them to a KayKit rig's hand slots
 * (`handslot.r`, `handslot.l`; three.js loads them as `handslotr`/`handslotl`). KayKit parts fit the rig as they are; the three Quaternius
 * parts (bow, hammer, spear) are scaled by their length relative to the KayKit one-handed sword.
 */
import * as THREE from 'three';
import type { EquipmentLook, VisualPart } from '../../engine/appearance/equipmentVisuals';
import { loadGltf } from './loader';

const W = '/assets/models/weapons/';

export const PART_FILES: Record<VisualPart, string> = {
  sword_1h: `${W}sword_1handed.gltf`,
  sword_2h: `${W}sword_2handed.gltf`,
  axe_1h: `${W}axe_1handed.gltf`,
  axe_2h: `${W}axe_2handed.gltf`,
  dagger: `${W}dagger.gltf`,
  hammer: `${W}Hammer.glb`,
  spear: `${W}Spear.glb`,
  bow: `${W}Bow.glb`,
  crossbow_1h: `${W}crossbow_1handed.gltf`,
  crossbow_2h: `${W}crossbow_2handed.gltf`,
  staff: `${W}staff.gltf`,
  wand: `${W}wand.gltf`,
  spellbook: `${W}spellbook_open.gltf`,
  shield_round: `${W}shield_round.gltf`,
  shield_square: `${W}shield_square.gltf`,
  shield_badge: `${W}shield_badge.gltf`,
  shield_spikes: `${W}shield_spikes.gltf`,
};

/** Length of non-KayKit parts relative to the KayKit one-handed sword. */
const RELATIVE_LENGTH: Partial<Record<VisualPart, number>> = { hammer: 0.9, spear: 1.7, bow: 1.1 };

const longest = (o: THREE.Object3D) => {
  const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  return Math.max(s.x, s.y, s.z) || 1;
};

/** A fresh copy of a part, scaled to fit the rig. */
export async function loadPart(part: VisualPart): Promise<THREE.Object3D> {
  const g = await loadGltf(PART_FILES[part]);
  const obj = g.scene.clone(true);
  obj.name = `gear:${part}`;
  const rel = RELATIVE_LENGTH[part];
  if (rel) {
    const ref = await loadGltf(PART_FILES.sword_1h);
    obj.scale.multiplyScalar((longest(ref.scene) * rel) / longest(obj));
  }
  obj.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return obj;
}

/** Attach the look's parts to the rig (missing files are skipped, the model still shows). */
export async function attachEquipment(root: THREE.Object3D, look: EquipmentLook | undefined): Promise<void> {
  if (!look) return;
  const slots: [VisualPart | undefined, string][] = [
    [look.right, 'handslot.r'],
    [look.left, 'handslot.l'],
  ];
  await Promise.all(
    slots.map(async ([part, bone]) => {
      // three.js strips '.' from node names on load (handslot.r → handslotr).
      const slot = part && (root.getObjectByName(bone) ?? root.getObjectByName(bone.replace('.', '')));
      if (!part || !slot) return;
      try {
        const obj = await loadPart(part);
        // Same placement as the rig's built-in weapons: turned 180° around the slot's Y axis.
        obj.rotation.y = Math.PI;
        slot.add(obj);
      } catch {
        /* part file missing: show the model without it */
      }
    }),
  );
}
