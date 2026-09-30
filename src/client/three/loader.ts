/** Cached glTF loading for the client (models are served by the game server at /assets/models/). */
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Outfit } from '../../engine/appearance/appearance';
import { assetUrl } from '../edition';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export function loadGltf(path: string): Promise<GLTF> {
  const url = assetUrl(path);
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    // Don't cache failures, so a later retry (after Setup downloads the models) can succeed.
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return p;
}

export const OUTFIT_FILES: Record<Outfit, string> = {
  knight: '/assets/models/characters/Knight.glb',
  barbarian: '/assets/models/characters/Barbarian.glb',
  mage: '/assets/models/characters/Mage.glb',
  rogue: '/assets/models/characters/Rogue.glb',
  rogue_hooded: '/assets/models/characters/Rogue_Hooded.glb',
};

/** Mesh-name prefix used inside each KayKit file. */
export const OUTFIT_PREFIX: Record<Outfit, string> = {
  knight: 'Knight',
  barbarian: 'Barbarian',
  mage: 'Mage',
  rogue: 'Rogue',
  rogue_hooded: 'Rogue',
};

export const HEAD_MESH: Record<Outfit, string> = {
  knight: 'Knight_Head',
  barbarian: 'Barbarian_Head',
  mage: 'Mage_Head',
  rogue: 'Rogue_Head',
  rogue_hooded: 'Rogue_Head_Hooded',
};

export const HEADGEAR_MESH: Partial<Record<Outfit, string>> = {
  knight: 'Knight_Helmet',
  barbarian: 'Barbarian_Hat',
  mage: 'Mage_Hat',
};
