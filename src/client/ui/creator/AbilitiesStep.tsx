/**
 * Creator step 4: ability scores. The player picks a method each time (Standard Array, Point Buy
 * or 4d6-drop-lowest with an animated roll), assigns values, then applies the background increase.
 */
import { useEffect, useState } from 'preact/hooks';
import {
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  canAdjustPointBuy,
  pointBuyCost,
  rollAbilitySet,
  suggestAssignment,
  suggestBackgroundBonus,
  type AbilityRoll,
} from '../../../engine/character/abilityScores';
import type { AbilityMethod, CreatorState } from '../../../engine/character/creator';
import { Rng } from '../../../engine/core/rng';
import { ABILITIES, abilityModifier, formatModifier, type Ability } from '../../../engine/rules/basics';
import { db } from '../../data';
import { t } from '../i18n';
import { creator } from './creatorState';
import { srdText, abilityText } from '../srdText';

const METHODS: AbilityMethod[] = ['standard_array', 'point_buy', 'roll'];

const update = (patch: Partial<CreatorState>) => (creator.value = { ...creator.value, ...patch });

function setMethod(method: AbilityMethod) {
  if (creator.value.abilityMethod === method) return;
  const base = method === 'point_buy' ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } : {};
  const { rolledPool: _drop, ...rest } = creator.value;
  creator.value = { ...rest, abilityMethod: method, baseScores: base };
}

/** Values still available to assign for array/roll methods (multiset minus used). */
function remaining(pool: number[], scores: Partial<Record<Ability, number>>, except: Ability): number[] {
  const left = [...pool];
  for (const a of ABILITIES) {
    if (a === except) continue;
    const v = scores[a];
    const i = v === undefined ? -1 : left.indexOf(v);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

function AssignSelect({ ability, pool }: { ability: Ability; pool: number[] }) {
  const s = creator.value;
  const options = [...new Set(remaining(pool, s.baseScores, ability))].sort((a, b) => b - a);
  const value = s.baseScores[ability];
  return (
    <select
      aria-label={t('creator.abilities.scoreAria', { ability: abilityText(ability) })}
      value={value ?? ''}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        const baseScores = { ...s.baseScores };
        if (v === '') delete baseScores[ability];
        else baseScores[ability] = Number(v);
        update({ baseScores });
      }}
    >
      <option value="">—</option>
      {value !== undefined && !options.includes(value) && <option value={value}>{value}</option>}
      {options.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  );
}

function RollPanel() {
  const s = creator.value;
  const [rolling, setRolling] = useState(false);
  const [rolls, setRolls] = useState<AbilityRoll[] | null>(null);
  const [spin, setSpin] = useState<number[][]>([]);

  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setSpin(Array.from({ length: 6 }, () => Array.from({ length: 4 }, () => 1 + Math.floor(Math.random() * 6)))), 70);
    const done = setTimeout(() => {
      clearInterval(id);
      const result = rollAbilitySet(Rng.fromSeed(`${Date.now()}-${Math.random()}`));
      setRolls(result);
      setRolling(false);
      update({ rolledPool: result.map((r) => r.total), baseScores: {} });
    }, 900);
    return () => {
      clearInterval(id);
      clearTimeout(done);
    };
  }, [rolling]);

  return (
    <div class="roll-panel">
      <button type="button" class="primary" disabled={rolling} onClick={() => setRolling(true)}>
        {s.rolledPool ? t('creator.abilities.rollAgain') : t('creator.abilities.roll')}
      </button>
      <div class="dice-sets" aria-live="polite">
        {(rolling ? spin : (rolls?.map((r) => r.roll.terms[0]!.kind === 'dice' ? (r.roll.terms[0] as { rolls: number[] }).rolls : []) ?? [])).map((faces, i) => {
          const term = !rolling && rolls ? (rolls[i]!.roll.terms[0] as { kept?: boolean[] }) : undefined;
          return (
            <div key={i} class={`dice-set${rolling ? ' rolling' : ''}`}>
              {faces.map((f, j) => (
                <span key={j} class={`die${term?.kept && !term.kept[j] ? ' dropped' : ''}`}>
                  {f}
                </span>
              ))}
              {!rolling && rolls && <strong class="die-total">= {rolls[i]!.total}</strong>}
            </div>
          );
        })}
        {!rolling && !rolls && s.rolledPool && <p class="hint">{t('creator.abilities.rolled', { values: s.rolledPool.join(', ') })}</p>}
      </div>
    </div>
  );
}

export function AbilitiesStep() {
  const s = creator.value;
  const cls = s.classId ? db.classes.get(s.classId) : undefined;
  const bg = s.backgroundId ? db.backgrounds.get(s.backgroundId) : undefined;
  const pool = s.abilityMethod === 'standard_array' ? [...STANDARD_ARRAY] : (s.rolledPool ?? []);
  const cost = pointBuyCost(s.baseScores);
  const bonusTotal = Object.values(s.backgroundBonus).reduce((a, b) => a + (b ?? 0), 0);

  const setBonus = (a: Ability, v: number) => {
    const next = { ...s.backgroundBonus, [a]: v };
    if (!v) delete next[a];
    update({ backgroundBonus: next });
  };

  return (
    <section>
      <h2>{t('creator.abilities.title')}</h2>
      <div class="method-tabs" role="tablist">
        {METHODS.map((m) => (
          <button key={m} type="button" role="tab" aria-selected={s.abilityMethod === m} class={s.abilityMethod === m ? 'selected' : ''} onClick={() => setMethod(m)}>
            {t(`creator.method.${m}`)}
          </button>
        ))}
      </div>
      {s.abilityMethod && <p class="hint">{t(`creator.method.${s.abilityMethod}.hint`)}</p>}

      {s.abilityMethod === 'roll' && <RollPanel />}
      {s.abilityMethod === 'point_buy' && (
        <p class={`points-left${cost > POINT_BUY_BUDGET ? ' over' : ''}`}>
          {t('creator.abilities.pointsSpent', { cost, budget: POINT_BUY_BUDGET })}
        </p>
      )}

      {s.abilityMethod && (
        <table class="ability-table">
          <thead>
            <tr>
              <th>{t('creator.abilities.colAbility')}</th>
              <th>{t('creator.abilities.colBase')}</th>
              <th>{t('creator.abilities.colBackground')}</th>
              <th>{t('creator.abilities.colScore')}</th>
              <th>{t('creator.abilities.colModifier')}</th>
            </tr>
          </thead>
          <tbody>
            {ABILITIES.map((a) => {
              const base = s.baseScores[a];
              const bonus = s.backgroundBonus[a] ?? 0;
              const total = base !== undefined ? base + bonus : undefined;
              const allowed = bg?.abilityScores.includes(a);
              return (
                <tr key={a} class={cls?.primaryAbilities.includes(a) ? 'primary-ability' : ''}>
                  <th scope="row">
                    {abilityText(a)}
                    {cls?.primaryAbilities.includes(a) && <span class="tag tag-primary">{t('creator.abilities.primary')}</span>}
                  </th>
                  <td>
                    {s.abilityMethod === 'point_buy' ? (
                      <span class="stepper">
                        <button type="button" aria-label={t('creator.abilities.lowerAria', { ability: abilityText(a) })} disabled={!canAdjustPointBuy(s.baseScores, a, -1)} onClick={() => update({ baseScores: { ...s.baseScores, [a]: (base ?? 8) - 1 } })}>
                          −
                        </button>
                        <span class="stepper-value">{base ?? 8}</span>
                        <button type="button" aria-label={t('creator.abilities.raiseAria', { ability: abilityText(a) })} disabled={!canAdjustPointBuy(s.baseScores, a, 1)} onClick={() => update({ baseScores: { ...s.baseScores, [a]: (base ?? 8) + 1 } })}>
                          +
                        </button>
                      </span>
                    ) : (
                      <AssignSelect ability={a} pool={pool} />
                    )}
                  </td>
                  <td>
                    {allowed ? (
                      <span class="bonus-buttons" role="group" aria-label={t('creator.abilities.bonusAria', { ability: abilityText(a) })}>
                        {[0, 1, 2].map((v) => (
                          <button key={v} type="button" class={bonus === v ? 'selected' : ''} aria-pressed={bonus === v} onClick={() => setBonus(a, v)} disabled={v > 0 && bonus !== v && bonusTotal - bonus + v > 3}>
                            {v ? `+${v}` : '0'}
                          </button>
                        ))}
                      </span>
                    ) : (
                      <span class="muted">—</span>
                    )}
                  </td>
                  <td class="score">{total ?? '—'}</td>
                  <td>{total !== undefined ? formatModifier(abilityModifier(total)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {s.abilityMethod && cls && (
        <div class="quick-actions">
          {s.abilityMethod !== 'point_buy' && pool.length === 6 && (
            <button type="button" onClick={() => update({ baseScores: suggestAssignment(pool, cls.primaryAbilities) })}>
              {t('creator.abilities.suggest', { name: srdText('classes', cls.id, cls.name) })}
            </button>
          )}
          {s.abilityMethod === 'point_buy' && (
            <button type="button" onClick={() => update({ baseScores: suggestAssignment([15, 15, 15, 8, 8, 8], cls.primaryAbilities) })}>
              {t('creator.abilities.suggest', { name: srdText('classes', cls.id, cls.name) })}
            </button>
          )}
          {bg && (
            <button type="button" onClick={() => update({ backgroundBonus: suggestBackgroundBonus(bg.abilityScores, cls.primaryAbilities, s.baseScores) })}>
              {t('creator.abilities.suggestBonus')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
