/**
 * Input area: suggested action buttons (in a conversation: the NPC's line above its reply options) plus a free-text box (free text goes through intent parsing;
 * in the web edition keyword matching only, so the box says the buttons work best).
 * Co-op (C006c): the host sees guests' proposals above the buttons (click = do it, ✕ = ignore); a guest's buttons
 * say "Suggest" when the host decides; buttons with several possible heroes get a chooser (best bonus pre-selected).
 */
import { useState } from 'preact/hooks';
import { WEB_EDITION } from '../../edition';
import { connection, dialogue, dismissProposal, joinCode, mySeat, proposals, send, suggestions, tableSeats } from '../../net/gameSocket';
import { bestActor, buttonCommand, pageSeat, proposalCommand, proposalText, storyMode } from '../../net/coopView';
import type { SuggestedAction } from '../../../shared/protocol';
import { t } from '../i18n';

function ActorChooser({ action, value, onPick }: { action: SuggestedAction; value: string; onPick: (id: string) => void }) {
  return (
    <select class="actor-chooser" value={value} aria-label={t('action.actorAria', { action: action.label })} onChange={(e) => onPick((e.target as HTMLSelectElement).value)}>
      {(action.actors ?? []).map((a) => (
        <option key={a.id} value={a.id}>
          {a.bonus === undefined ? a.name : t('action.actorBonus', { name: a.name, bonus: a.bonus >= 0 ? `+${a.bonus}` : `${a.bonus}` })}
        </option>
      ))}
    </select>
  );
}

export function ActionInput() {
  const [text, setText] = useState('');
  /** Picked actor per action id (until the buttons change). */
  const [picked, setPicked] = useState<Record<string, string>>({});
  const offline = connection.value !== 'open';
  const seat = pageSeat(joinCode.value !== null, mySeat.value);
  const suggest = storyMode(seat, tableSeats.value?.policy) === 'suggest';
  const submit = (e: Event) => {
    e.preventDefault();
    const typed = text.trim();
    if (!typed) return;
    send({ type: 'say', text: typed.slice(0, 500) });
    setText('');
  };
  const talk = dialogue.value;
  const ideas = proposals.value;
  return (
    <section class="action-input" aria-label={t('action.aria')}>
      {ideas.length > 0 && (
        <ul class="proposals" aria-label={t('action.proposalsAria')}>
          {ideas.map((p) => {
            const cmd = proposalCommand(p);
            const line = t('action.proposal', { name: p.name, label: proposalText(p) });
            return (
              <li key={p.id}>
                {seat.role === 'host' && cmd ? (
                  <>
                    <button type="button" class="proposal" disabled={offline} title={t('action.proposalTake')} onClick={() => send(cmd)}>
                      {line}
                    </button>
                    <button type="button" class="link-button" aria-label={t('action.proposalDismiss')} title={t('action.proposalDismiss')} onClick={() => dismissProposal(p.id)}>
                      ✕
                    </button>
                  </>
                ) : (
                  <span class="proposal muted">{line}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {talk && (
        <div class="dialogue-panel" role="group" aria-label={t('action.conversationAria', { npc: talk.npc })}>
          <p class="dialogue-line">
            <strong>{talk.speaker}:</strong> “{talk.text}”
          </p>
        </div>
      )}
      {suggest && <p class="hint small">{t(seat.role === 'spectator' ? 'action.spectatorHint' : 'action.suggestHint')}</p>}
      <div class={talk ? 'suggestions dialogue-options' : 'suggestions'}>
        {suggestions.value.map((a) => {
          const actor = a.actors?.length ? (picked[a.id] ?? bestActor(a.actors)) : undefined;
          const button = (
            <button key={a.id} type="button" disabled={offline} class={a.say ? 'idea' : undefined} title={suggest ? t('action.suggestTitle') : undefined} onClick={() => send(buttonCommand(a, actor))}>
              {suggest ? t('action.suggestLabel', { label: a.label }) : a.label}
            </button>
          );
          if (!actor) return button;
          return (
            <span key={a.id} class="with-actor">
              {button}
              <ActorChooser action={a} value={actor} onPick={(id) => setPicked({ ...picked, [a.id]: id })} />
            </span>
          );
        })}
      </div>
      <form class="free-text" onSubmit={submit}>
        <input
          type="text"
          value={text}
          maxLength={500}
          placeholder={t(suggest ? 'action.placeholderSuggest' : 'action.placeholder')}
          aria-label={t('action.describeAria')}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="primary" disabled={offline || !text.trim()}>
          {t(suggest ? 'action.suggest' : 'action.act')}
        </button>
      </form>
      {WEB_EDITION && <p class="hint small free-text-hint">{t('action.webHint')}</p>}
    </section>
  );
}
