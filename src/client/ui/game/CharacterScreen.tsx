/**
 * Character screen (spec §9, §12): a large rotatable 3D model with the equipped gear, wounds, armor
 * wear and scars — click a scar mark (or a scar in the list) to read where it came from — plus the
 * sheet basics: abilities, AC/HP/speed, equipment with wear.
 */
import { useState } from 'preact/hooks';
import { armorWear, wearLabel } from '../../../engine/character/armorWear';
import { itemName } from '../../../engine/character/inventory';
import { SCAR_LABEL, scarText } from '../../../engine/character/scars';
import { equipmentLook } from '../../../engine/appearance/equipmentVisuals';
import { woundLevel, woundWords } from '../../../engine/appearance/wounds';
import { totalLevel, type Character, type ScarLocation } from '../../../engine/core/creature';
import { ABILITIES, abilityModifier } from '../../../engine/rules/basics';
import { CharacterPreview } from '../../three/LazyCharacterPreview';
import { db } from '../../data';

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function CharacterScreen({ c, onClose }: { c: Character; onClose: () => void }) {
  const [picked, setPicked] = useState<ScarLocation | null>(null);
  const scar = picked ? c.scars.find((s) => s.location === picked) : undefined;
  const species = db.species.get(c.speciesId)?.name ?? c.speciesId;
  const classes = c.classes.map((x) => `${db.classes.get(x.classId)?.name ?? x.classId} ${x.level}`).join(' / ');
  const wounds = woundWords(woundLevel(c.hp, c.maxHp));
  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={`Character: ${c.name}`}>
      <section class="journal character-screen">
        <header class="journal-head">
          <h2>{c.name}</h2>
          <span class="muted small">
            {species} · {classes} · level {totalLevel(c)}
          </span>
          <button type="button" onClick={onClose} aria-label="Close character screen">
            Close
          </button>
        </header>
        <div class="character-body">
          <div class="character-model">
            <CharacterPreview
              appearance={c.appearance}
              size={c.size}
              height={420}
              look={equipmentLook(c, db)}
              wounds={woundLevel(c.hp, c.maxHp)}
              seed={c.id}
              scars={c.scars.map((s) => s.location)}
              wear={armorWear(c)}
              onPickScar={setPicked}
            />
            <p class="hint small">Drag to turn. Click a scar to see its story.</p>
            {scar && (
              <p class="scar-detail" role="status">
                {scarText(scar)}
              </p>
            )}
          </div>
          <div class="character-sheet">
            <dl class="member-stats">
              <dt>HP</dt>
              <dd>
                {c.hp}/{c.maxHp}
                {wounds && <span class="muted"> · {wounds}</span>}
              </dd>
              <dt>AC</dt>
              <dd>{c.ac}</dd>
              <dt>Speed</dt>
              <dd>{c.speed.walk} ft</dd>
              <dt>XP</dt>
              <dd>{c.xp}</dd>
            </dl>
            <table class="ability-table">
              <tbody>
                <tr>
                  {ABILITIES.map((a) => (
                    <th key={a}>{a.toUpperCase()}</th>
                  ))}
                </tr>
                <tr>
                  {ABILITIES.map((a) => (
                    <td key={a}>
                      {c.abilities[a]} <span class="muted">({signed(abilityModifier(c.abilities[a]))})</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <h3>Equipped</h3>
            <ul class="plain-list">
              {c.inventory.filter((i) => i.equipped).map((i) => (
                <li key={i.uid}>
                  {itemName(i.itemId, db)}
                  {(i.wear ?? 0) > 0 && <span class="tag tag-wear">{wearLabel(i.wear ?? 0)}</span>}
                </li>
              ))}
              {!c.inventory.some((i) => i.equipped) && <li class="muted">Nothing equipped.</li>}
            </ul>
            <h3>Scars</h3>
            {c.scars.length === 0 ? (
              <p class="muted small">No scars — yet.</p>
            ) : (
              <ul class="plain-list">
                {c.scars.map((s) => (
                  <li key={s.id}>
                    <button type="button" class={`link-button${picked === s.location ? ' selected' : ''}`} title={scarText(s)} onClick={() => setPicked(s.location)} onMouseEnter={() => setPicked(s.location)}>
                      {SCAR_LABEL[s.location]}
                    </button>
                    <span class="muted small"> — {s.description}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
