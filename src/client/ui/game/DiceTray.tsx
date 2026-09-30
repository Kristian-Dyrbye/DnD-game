/**
 * Dice tray (spec §8): every roll is shown automatically with a short tumble animation, then the
 * real result and the full math line. Advantage/disadvantage shows both d20s (the dropped one
 * faded). Below is a scrollable history of every roll this session. Honours reduced motion.
 */
import { useEffect, useState } from 'preact/hooks';
import { rollHistory } from '../../net/gameSocket';
import { currentTranslator, t } from '../i18n';
import { dieClass, keptIndex, modeLabel, outcomeLabel } from './dice';

const TUMBLE_MS = 650;
const FRAME_MS = 60;

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function DiceTray() {
  const rolls = rollHistory.value;
  const last = rolls.at(-1);
  // While tumbling, show random faces (cosmetic only — the result was rolled by the engine).
  const [faces, setFaces] = useState<number[] | null>(null);
  useEffect(() => {
    if (!last || prefersReducedMotion()) return;
    const random = () => last.dice.map(() => 1 + Math.floor(Math.random() * 20));
    setFaces(random());
    const tick = setInterval(() => setFaces(random()), FRAME_MS);
    const stop = setTimeout(() => {
      clearInterval(tick);
      setFaces(null);
    }, TUMBLE_MS);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
      setFaces(null);
    };
  }, [last?.id]);

  const rolling = faces !== null;
  const kept = last ? keptIndex(last) : 0;
  const tr = currentTranslator();
  const mode = last && modeLabel(last, tr);
  const outcome = last && outcomeLabel(last, tr);
  return (
    <section class="dice-tray" aria-label={t('dice.title')}>
      <h2>{t('dice.title')}</h2>
      {last ? (
        <div class={`last-roll${rolling ? ' rolling' : ''}`}>
          <div class="roll-head">
            <strong>{last.label}</strong>
            {mode && <span class={`tag tag-${last.mode}`}>{mode}</span>}
          </div>
          <div class="dice-set" aria-hidden={rolling}>
            {(faces ?? last.dice).map((d, i) => (
              <span key={i} class={rolling ? 'die d20 tumbling' : dieClass(d, i === kept)}>
                <span>{d}</span>
              </span>
            ))}
            {!rolling && outcome && <span class={`roll-outcome ${last.success ? 'success' : 'failure'}`}>{outcome}</span>}
          </div>
          <p class="roll-math" aria-live="polite">
            {rolling ? t('dice.rolling') : last.math}
          </p>
        </div>
      ) : (
        <p class="hint small">{t('dice.none')}</p>
      )}
      {rolls.length > 1 && (
        <ol class="roll-history" reversed aria-label={t('dice.historyAria')}>
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
