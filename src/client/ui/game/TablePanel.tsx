/**
 * The host's table panel (C006b, local edition): open the game to a friend on the network (join link + QR
 * code), see who sits at the table, release a seat, choose who decides the story, and lend companions to a
 * seated player. Seats/policy come live from `table` events, the door from GET /api/table.
 */
import { useEffect, useState } from 'preact/hooks';
import { gameState, send, tableSeats } from '../../net/gameSocket';
import { controlOptions, doorState, fetchTable, lendable, type TableInfo } from '../../net/tableInfo';
import { qrMatrix, qrPath } from '../../qr';
import { settings, updateSettings } from '../settingsState';
import { t } from '../i18n';
import type { TablePolicy } from '../../../engine/session/table';

function JoinQr({ url }: { url: string }) {
  const m = qrMatrix(url);
  const n = m.length + 8;
  return (
    <svg class="join-qr" viewBox={`0 0 ${n} ${n}`} role="img" aria-label={t('table.qrAria')} shape-rendering="crispEdges">
      <rect width={n} height={n} fill="#fff" />
      <path d={qrPath(m)} fill="#000" />
    </svg>
  );
}

export function TablePanel({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<TableInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const refresh = () =>
    fetchTable()
      .then((i) => (setInfo(i), setFailed(false)))
      .catch(() => setFailed(true));
  useEffect(() => void refresh(), []);

  const allow = settings.value?.table.allowJoin ?? info?.allowJoin ?? false;
  const seats = tableSeats.value?.seats ?? info?.seats ?? [];
  const policy = tableSeats.value?.policy ?? info?.policy ?? 'host_decides';
  const door = info ? doorState({ ...info, allowJoin: allow }) : null;
  const state = gameState.value;
  const control = (state?.extensions.party as { control?: Record<string, string> } | undefined)?.control ?? {};
  const options = controlOptions(seats);
  const optionLabel = (o: (typeof options)[number]) => (o.value === 'ai' ? t('party.controlAi') : o.value === 'player' ? t('table.me') : (o.seat?.name ?? o.seat?.id ?? o.value));

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('table.title')}>
      <section class="journal table-panel">
        <header class="journal-head">
          <h2>{t('table.title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')}>
            {t('common.close')}
          </button>
        </header>
        <div class="about-body">
          <h3>{t('table.door')}</h3>
          <label class="table-toggle">
            <input type="checkbox" checked={allow} onChange={() => void updateSettings({ table: { allowJoin: !allow } }).then(refresh)} /> {t('table.allowJoin')}
          </label>
          {failed && <p class="game-error">{t('table.loadFailed')}</p>}
          {door === 'closed' && <p class="hint small">{t('table.closedHint')}</p>}
          {door === 'restart' && <p class="hint">{t('table.restart')}</p>}
          {door === 'noNetwork' && <p class="hint">{t('table.noNetwork')}</p>}
          {door === 'open' && info && (
            <div class="table-join">
              <div>
                <p>
                  {t('table.code')} <strong class="join-code">{info.code}</strong>
                </p>
                <p class="small">{t('table.linkHint')}</p>
                <ul class="plain-list">
                  {info.urls.map((u) => (
                    <li key={u}>
                      <code class="join-url">{u}</code>
                    </li>
                  ))}
                </ul>
                <p class="hint small">{t('table.firewall')}</p>
              </div>
              {info.urls[0] && <JoinQr url={info.urls[0]} />}
            </div>
          )}

          <h3>{t('table.seats')}</h3>
          <ul class="plain-list table-seats">
            {seats.map((s) => (
              <li key={s.id}>
                <strong>{s.role === 'host' ? t('table.host') : (s.name ?? s.id)}</strong> <span class="muted">{t(s.role === 'host' ? 'table.roleHost' : s.role === 'spectator' ? 'table.roleSpectator' : 'table.rolePlayer')}</span>
                {s.away && <span class="tag">{t('table.away')}</span>}
                {s.role !== 'host' && (
                  <button type="button" class="link-button small" onClick={() => send({ type: 'release_seat', seat: s.id })} title={t('table.releaseTitle')}>
                    {t('table.release')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {seats.length <= 1 && <p class="hint small">{t('table.alone')}</p>}

          <h3>{t('table.story')}</h3>
          <label>
            {t('table.policy')}{' '}
            <select value={policy} onChange={(e) => send({ type: 'set_policy', policy: (e.target as HTMLSelectElement).value as TablePolicy })}>
              <option value="host_decides">{t('table.policyHost')}</option>
              <option value="anyone">{t('table.policyAnyone')}</option>
            </select>
          </label>

          {state && lendable(state.companions, state.origins ?? {}).length > 0 && (
            <>
              <h3>{t('table.companions')}</h3>
              <p class="hint small">{t('table.companionsHint')}</p>
              <ul class="plain-list">
                {lendable(state.companions, state.origins ?? {}).map((c) => (
                  <li key={c.id}>
                    <label>
                      {c.name}{' '}
                      <select
                        value={control[c.id] ?? 'ai'}
                        disabled={!!state.extensions.combat}
                        onChange={(e) => send({ type: 'companion_control', companionId: c.id, control: (e.target as HTMLSelectElement).value as 'ai' | 'player' | `seat:${string}` })}
                      >
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {optionLabel(o)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
