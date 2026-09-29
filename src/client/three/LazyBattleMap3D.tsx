/**
 * Loads the 3D battle map (and three.js) on first use, so 2D-only play never downloads it.
 * Falls back to the 2D map while loading and when WebGL isn't available.
 */
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { BattleMap, type BattleMapProps } from '../ui/combat/BattleMap';

type Props = BattleMapProps & { onUnavailable?: () => void };
let loaded: ComponentType<Props> | null = null;

export function BattleMap3D(props: Props) {
  const [Comp, setComp] = useState<ComponentType<Props> | null>(() => loaded);
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    import('./BattleMap3D')
      .then((m) => {
        loaded = m.BattleMap3D;
        if (!cancelled) setComp(() => m.BattleMap3D);
      })
      .catch(() => props.onUnavailable?.());
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Comp) return <BattleMap {...props} />;
  return <Comp {...props} />;
}
