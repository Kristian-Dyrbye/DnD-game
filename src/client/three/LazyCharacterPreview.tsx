/**
 * Loads the 3D preview (and three.js with it) only when a preview is first shown, so the title
 * screen and 2D-only play start without the 3D engine in memory. Shows a placeholder meanwhile.
 */
import type { ScarLocation } from '../../engine/core/creature';
import type { WoundLevel } from '../../engine/appearance/wounds';
import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Appearance } from '../../engine/appearance/appearance';
import type { EquipmentLook } from '../../engine/appearance/equipmentVisuals';

type PreviewProps = { appearance: Appearance; size?: string; height?: number; look?: EquipmentLook; wounds?: WoundLevel; seed?: string; scars?: readonly ScarLocation[]; wear?: number; onSnapshot?: (dataUrl: string) => void; onPickScar?: (loc: ScarLocation | null) => void };
let loaded: ComponentType<PreviewProps> | null = null;

export function CharacterPreview(props: PreviewProps) {
  const [Comp, setComp] = useState<ComponentType<PreviewProps> | null>(() => loaded);
  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    import('./CharacterPreview')
      .then((m) => {
        loaded = m.CharacterPreview;
        if (!cancelled) setComp(() => m.CharacterPreview);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!Comp) return <div class="character-preview" style={{ height: `${props.height ?? 260}px` }} aria-label="3D character preview (loading)" />;
  return <Comp {...props} />;
}
