/**
 * Dice tray slot: the latest roll's dice and math line plus a scrollable roll history.
 * A053 replaces the static dice with animated ones (two dice for advantage/disadvantage).
 */
import { rollHistory } from '../../net/gameSocket';

export function DiceTray() {
  const rolls = rollHistory.value;
  const last = rolls.at(-1);
  return (
    <section class="dice-tray" aria-label="Dice">
      <h2>Dice</h2>
      {last ? (
        <div class="last-roll">
          <div class="dice-set">
            {last.dice.map((d, i) => (
              <span key={i} class="die">
                {d}
              </span>
            ))}
            <span class={`roll-outcome ${last.success === undefined ? '' : last.success ? 'success' : 'failure'}`}>{last.label}</span>
          </div>
          <p class="roll-math">{last.math}</p>
        </div>
      ) : (
        <p class="hint small">No rolls yet.</p>
      )}
      {rolls.length > 1 && (
        <ol class="roll-history" reversed aria-label="Roll history">
          {rolls
            .slice(0, -1)
            .reverse()
            .map((r) => (
              <li key={r.id} class={r.success === undefined ? '' : r.success ? 'success' : 'failure'}>
                <strong>{r.label}</strong> {r.math}
              </li>
            ))}
        </ol>
      )}
    </section>
  );
}
