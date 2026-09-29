/**
 * Builds the 3D model for a monster/NPC from its MonsterVisual (engine/appearance/monsterVisuals):
 * a Quaternius/KayKit model (cloned with its skeleton, optional tint, idle animation) or a KayKit
 * adventurer outfit for humanoid NPC stat blocks. Returns the same shape as character models.
 */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AppearanceSchema } from '../../engine/appearance/appearance';
import { idleClip, type MonsterVisual } from '../../engine/appearance/monsterVisuals';
import { buildCharacterModel, type CharacterModel } from './characterModel';
import { loadGltf } from './loader';

export async function buildMonsterModel(v: MonsterVisual, size: string): Promise<CharacterModel> {
  if (v.kind === 'character') {
    return buildCharacterModel(AppearanceSchema.parse({ outfit: v.outfit, head: v.outfit, ...(v.tint && { primaryColor: v.tint }) }), size);
  }
  const gltf = await loadGltf(v.file);
  const root = cloneSkinned(gltf.scene);
  const tint = v.tint ? new THREE.Color(v.tint) : undefined;
  const owned: THREE.Material[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // Quaternius rigs scale the armature ×100: the skinned bounds go stale and get culled.
    mesh.frustumCulled = false;
    if (tint) {
      // Own copies so the cached original stays untinted.
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        c.color?.multiply(tint);
        owned.push(c);
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? mats : mats[0]!;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  let action: THREE.AnimationAction | undefined;
  const play = (name: string) => {
    const clip = gltf.animations.find((c) => c.name === name) ?? gltf.animations.find((c) => c.name === idleClip(gltf.animations.map((a) => a.name)));
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
    dispose: () => {
      mixer.stopAllAction();
      for (const m of owned) m.dispose();
    },
  };
}
