import { describe, expect, it } from 'vitest';
import { backstoryMessages, templateBackstory } from './backstory';

const summary = { name: 'Brenna', species: 'Dwarf', className: 'Fighter', background: 'Soldier', traits: 'Blunt', homeland: 'Millbrook' };

describe('backstory prompt', () => {
  it('includes the character details and style rules', () => {
    const [system, user] = backstoryMessages(summary);
    expect(system!.content).toContain('second person');
    expect(user!.content).toContain('Class: Fighter');
    expect(user!.content).toContain('Personality traits: Blunt');
  });

  it('has a template fallback per background', () => {
    const t = templateBackstory(summary);
    expect(t).toContain('Brenna');
    expect(t).toContain('dwarf fighter');
    expect(t).toContain('Millbrook');
    expect(templateBackstory({ ...summary, background: 'Sage' })).toContain('books');
  });
});
