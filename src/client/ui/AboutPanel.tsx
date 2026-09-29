/**
 * About (spec §17): what the game is, the SRD 5.2.1 CC-BY-4.0 attribution (required wording), and
 * where the free assets come from. The full list with licenses is CREDITS.md in the game folder.
 */
import { GAME_TITLE, GAME_VERSION } from '../../shared/version';

export function AboutPanel({ onClose }: { onClose: () => void }) {
  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="About">
      <section class="journal about-panel">
        <header class="journal-head">
          <h2>
            {GAME_TITLE} <span class="muted small">v{GAME_VERSION}</span>
          </h2>
          <button type="button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        <div class="about-body">
          <p>
            A solo Dungeons &amp; Dragons adventure with a local AI Dungeon Master. The rules, dice and fights are resolved by the game itself; the AI (a small model running on your
            own computer through Ollama) only narrates, voices characters and suggests ideas. Everything runs offline.
          </p>
          <h3>Rules</h3>
          <p class="attribution">
            This work includes material from the System Reference Document 5.2.1 ("SRD 5.2.1") by Wizards of the Coast LLC, available at{' '}
            <a href="https://www.dndbeyond.com/srd" target="_blank" rel="noreferrer">
              https://www.dndbeyond.com/srd
            </a>
            . The SRD 5.2.1 is licensed under the Creative Commons Attribution 4.0 International License, available at{' '}
            <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noreferrer">
              https://creativecommons.org/licenses/by/4.0/legalcode
            </a>
            .
          </p>
          <h3>Art, music and voices</h3>
          <ul class="plain-list">
            <li>3D characters, skeletons, dungeon props and weapons: KayKit by Kay Lousberg (CC0).</li>
            <li>Monsters and animals: Quaternius (CC0 packs).</li>
            <li>Music, ambience and sound effects: CC0 and public-domain works (Kenney and others).</li>
            <li>Narration voices: Piper TTS with voices trained on public-domain LibriVox recordings.</li>
          </ul>
          <p class="muted small">Every asset, its author, source and license is listed in CREDITS.md in the game folder.</p>
          <h3>The world</h3>
          <p>The continent of Orrimar, its people and the campaign "The Seven Teeth of Vashkul" are original to this game.</p>
        </div>
      </section>
    </div>
  );
}
