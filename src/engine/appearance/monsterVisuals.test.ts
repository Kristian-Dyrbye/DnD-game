import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSrd } from '../data/srdBundle';
import { idleClip, monsterVisual } from './monsterVisuals';

const db = loadSrd();

describe('monster visuals', () => {
  it('maps familiar monsters to their models and NPC stat blocks to outfits', () => {
    expect(monsterVisual('goblin_warrior', 'humanoid')).toMatchObject({ kind: 'model', file: '/assets/models/monsters/Goblin.glb' });
    expect(monsterVisual('hobgoblin_warrior', 'humanoid')).toMatchObject({ file: '/assets/models/monsters/Orc.glb', tint: '#c0503a' });
    expect(monsterVisual('zombie', 'undead')).toMatchObject({ file: '/assets/models/monsters/Skeleton_Minion.glb' });
    expect(monsterVisual('giant_rat', 'beast')).toMatchObject({ file: '/assets/models/animals/Rat.glb' });
    expect(monsterVisual('adult_red_dragon', 'dragon')).toMatchObject({ file: '/assets/models/monsters/Dragon.glb' });
    expect(monsterVisual('guard', 'humanoid')).toEqual({ kind: 'character', outfit: 'knight' });
    expect(monsterVisual('cultist', 'humanoid')).toEqual({ kind: 'character', outfit: 'mage' });
    expect(monsterVisual('bandit', 'humanoid')).toEqual({ kind: 'character', outfit: 'rogue' });
    expect(monsterVisual('some_new_thing', 'fiend')).toMatchObject({ file: '/assets/models/monsters/Demon.glb', fallback: true });
  });

  it('every SRD monster gets a visual; at least 60% by name (the rest by type)', () => {
    const all = [...db.monsters.values()];
    const byName = all.filter((m) => !monsterVisual(m.id, m.creatureType).fallback);
    expect(byName.length / all.length).toBeGreaterThan(0.6);
  });

  it('every model file named exists when the assets are downloaded', () => {
    const root = path.join(process.cwd(), 'assets', 'models');
    if (!existsSync(root)) return; // assets are fetched by Setup (gitignored)
    const files = new Set([...db.monsters.values()].map((m) => monsterVisual(m.id, m.creatureType)).flatMap((v) => (v.kind === 'model' ? [v.file] : [])));
    for (const f of files) expect(existsSync(path.join(process.cwd(), f)), f).toBe(true);
  });

  it('idle clips', () => {
    expect(idleClip(['CharacterArmature|Death', 'CharacterArmature|Idle', 'CharacterArmature|Jump_Idle'])).toBe('CharacterArmature|Idle');
    expect(idleClip(['RatArmature|Rat_Death', 'RatArmature|Rat_Idle'])).toBe('RatArmature|Rat_Idle');
    expect(idleClip(['Idle_HitReact_Left', 'Idle', 'Walk'])).toBe('Idle');
    expect(idleClip(['CharacterArmature|Flying_Idle', 'CharacterArmature|Death'])).toBe('CharacterArmature|Flying_Idle');
  });
});
