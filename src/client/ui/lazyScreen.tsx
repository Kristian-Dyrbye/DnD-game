/**
 * Loads a big screen (creator, game, combat sandbox) as its own chunk the first time it is shown, so
 * the title screen starts without the SRD data and the engine (A128). Shows a short placeholder meanwhile.
 */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MessageKey } from '../../shared/i18n';
import { t } from './i18n';

export function lazyScreen(load: () => Promise<ComponentType>, label: MessageKey): ComponentType {
  let loaded: ComponentType | null = null;
  return function LazyScreen() {
    const [Comp, setComp] = useState<ComponentType | null>(() => loaded);
    const [failed, setFailed] = useState<string | null>(null);
    useEffect(() => {
      if (loaded) return;
      let cancelled = false;
      load().then(
        (c) => {
          loaded = c;
          if (!cancelled) setComp(() => c);
        },
        (err: unknown) => {
          console.error(err);
          if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
        },
      );
      return () => {
        cancelled = true;
      };
    }, []);
    if (Comp) return <Comp />;
    return (
      <main class="screen-loading" aria-busy={!failed}>
        <p>{failed ? t('screen.failed', { name: t(label), error: failed }) : t('screen.loading', { name: t(label) })}</p>
      </main>
    );
  };
}
