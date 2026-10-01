/**
 * Authored labels must not end with a "(Skill DC n)" tag: the runner appends the check itself, so
 * the button would read "Study the tracks (Survival DC 12) (Survival DC 12)" (review 2026-10-01).
 */
import { describe, expect, it } from 'vitest';
import demo from '../../../data/adventures/demo/millbrook_demo.json';
import { validateAdventure } from './validate';

type Loose = { chapters: Array<{ scenes: Array<{ id: string; actions: Array<{ id: string; label: string }>; exits: Array<{ id: string; label: string }> }> }> };

describe('check tags in authored labels', () => {
  it('the demo adventure is clean', () => {
    const res = validateAdventure(structuredClone(demo));
    expect(res.errors).toEqual([]);
  });

  it('rejects an action, exit or option label that ends with a DC or SG tag', () => {
    const tagged = structuredClone(demo) as unknown as Loose;
    const scene = tagged.chapters[0]!.scenes[0]!;
    const action = scene.actions[0]!;
    const exit = scene.exits[0]!;
    action.label = `${action.label} (Perception DC 10)`;
    exit.label = `${exit.label} (Atletik SG 12)`;
    const res = validateAdventure(tagged);
    expect(res.errors).toHaveLength(2);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`"${action.id}" label ends with a check tag "(Perception DC 10)"`),
        expect.stringContaining(`"exit.${exit.id}" label ends with a check tag "(Atletik SG 12)"`),
      ]),
    );
  });

  it('leaves flavour in brackets alone', () => {
    const flavoured = structuredClone(demo) as unknown as Loose;
    const action = flavoured.chapters[0]!.scenes[0]!.actions[0]!;
    action.label = `${action.label} (passive Perception)`;
    expect(validateAdventure(flavoured).errors).toEqual([]);
  });
});
