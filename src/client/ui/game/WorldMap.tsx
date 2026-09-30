/**
 * World map (spec §11.1): an illustrated SVG map of the continent — organic region coastlines with
 * terrain glyphs, routes, icons for the places the hero knows (visited = solid, heard of = faded) with
 * labels placed so they don't overlap, and fog over everything the hero hasn't heard of. Click a known place to see the route,
 * distance and travel time by pace, then travel. The map is tinted by time of day and weather.
 * Route planning uses the same engine code as the server (world/travel.ts).
 */
import { useMemo, useState } from 'preact/hooks';
import { timeOfDay } from '../../../engine/world/clock';
import { MAP_HEIGHT, MAP_WIDTH, type Region } from '../../../engine/world/lore';
import { effectivePace, getMap, initialMap, legHours, planRoute, type Pace } from '../../../engine/world/travel';
import { weatherEffects, type WeatherState } from '../../../engine/world/weather';
import { lore } from '../../data';
import { gameState, send } from '../../net/gameSocket';
import type { MessageKey } from '../../../shared/i18n';
import { t, tn } from '../i18n';
import { placeLabels, regionPath, terrainGlyphs, type Glyph } from './mapArt';

const REGION_FILL: Record<Region['tone'], string> = { high_fantasy: '#6b7f3a', dark_fantasy: '#3e4a3f', swashbuckling: '#3f6f86' };
const ROUTE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  road: { stroke: '#d9c49a' },
  trail: { stroke: '#b89b6a', dash: '6 5' },
  river: { stroke: '#7fb3d5', dash: '2 4' },
  sea: { stroke: '#9fd0ea', dash: '10 6' },
};
const TINT: Record<string, string> = { dawn: 'rgba(255,170,120,0.12)', day: 'rgba(0,0,0,0)', dusk: 'rgba(255,120,60,0.18)', night: 'rgba(10,20,60,0.45)' };

/** Small map icon per location kind. */
function PlaceIcon({ kind, x, y, solid }: { kind: string; x: number; y: number; solid: boolean }) {
  const fill = solid ? '#f3e2b8' : 'none';
  const st = { stroke: '#f3e2b8', 'stroke-width': 2.5, fill, 'stroke-linejoin': 'round' as const };
  switch (kind) {
    case 'city':
      return <path d={`M${x - 11},${y + 8} V${y - 4} L${x - 6},${y - 10} L${x - 1},${y - 4} V${y + 8} M${x - 1},${y + 8} V${y - 8} H${x + 11} V${y + 8} Z`} {...st} />;
    case 'town':
    case 'village':
      return <path d={`M${x - 8},${y + 7} V${y - 2} L${x},${y - 9} L${x + 8},${y - 2} V${y + 7} Z`} {...st} />;
    case 'fortress':
      return <path d={`M${x - 9},${y + 8} V${y - 8} H${x - 5} V${y - 4} H${x - 2} V${y - 8} H${x + 2} V${y - 4} H${x + 5} V${y - 8} H${x + 9} V${y + 8} Z`} {...st} />;
    case 'port':
      return <path d={`M${x},${y - 9} V${y + 8} M${x - 8},${y + 2} Q${x},${y + 12} ${x + 8},${y + 2} M${x - 5},${y - 5} H${x + 5}`} {...st} fill="none" />;
    case 'temple':
      return <path d={`M${x - 9},${y + 8} H${x + 9} M${x - 7},${y + 8} V${y - 3} M${x + 7},${y + 8} V${y - 3} M${x - 10},${y - 3} L${x},${y - 10} L${x + 10},${y - 3} Z`} {...st} />;
    case 'dungeon':
    case 'ruin':
      return <path d={`M${x - 9},${y + 8} V${y - 2} A9,9 0 0 1 ${x + 9},${y - 2} V${y + 8} Z M${x - 3},${y + 8} V${y + 2} A3,3 0 0 1 ${x + 3},${y + 2} V${y + 8}`} {...st} stroke-dasharray={kind === 'ruin' ? '3 2' : undefined} />;
    case 'wilderness':
      return <path d={`M${x - 9},${y + 7} L${x - 3},${y - 5} L${x + 2},${y + 3} L${x + 5},${y - 1} L${x + 10},${y + 7} Z`} {...st} />;
    default:
      return <circle cx={x} cy={y} r={7} {...st} />;
  }
}

function TerrainGlyph({ g }: { g: Glyph }) {
  const move = `translate(${g.x.toFixed(1)} ${g.y.toFixed(1)}) scale(${g.s.toFixed(2)})`;
  if (g.kind === 'tree') return <path transform={move} d="M0,-9 L6,2 H-6 Z M0,2 V6" class="glyph glyph-tree" />;
  if (g.kind === 'reed') return <path transform={move} d="M-4,6 Q-3,-2 -5,-8 M0,6 V-10 M4,6 Q3,-2 5,-7" class="glyph glyph-reed" />;
  if (g.kind === 'wave') return <path transform={move} d="M-9,0 q3,-4 6,0 t6,0 t6,0" class="glyph glyph-wave" />;
  return <path transform={move} d="M-9,5 Q-3,-8 3,5 M-1,5 Q4,-4 9,5" class="glyph glyph-hill" />;
}

function hoursText(h: number): string {
  if (h < 8) return t('map.hours', { n: Math.round(h * 10) / 10 });
  return tn('map.days', Math.ceil(h / 8), { hours: Math.round(h) });
}

export function WorldMap({ onClose }: { onClose: () => void }) {
  const state = gameState.value;
  const map = (state && getMap(state)) ?? initialMap(lore);
  const [target, setTarget] = useState<string | null>(null);
  const [pace, setPace] = useState<Pace>('normal');
  const weather = state?.extensions.weather as WeatherState | undefined;
  const fx = weather ? weatherEffects(weather) : undefined;
  const tod = state ? timeOfDay(state.time) : 'day';

  const plan = useMemo(() => (target ? planRoute(lore, map.current, target, map.known) : undefined), [target, map.current, map.known.length]);
  const miles = plan?.reduce((s, l) => s + l.miles, 0) ?? 0;
  const hours = plan?.reduce((s, l) => s + legHours(l, pace, fx?.travelMultiplier ?? 1), 0) ?? 0;
  const known = new Set(map.known);
  const visited = new Set(map.visited);
  const routeKey = (a: string, b: string) => [a, b].sort().join('|');
  const planned = new Set(plan?.map((l) => routeKey(l.from, l.to)));
  const loc = (id: string) => lore.locations.find((l) => l.id === id)!;
  const targetLoc = target ? loc(target) : undefined;
  const labels = useMemo(
    () =>
      new Map(
        placeLabels(
          lore.locations.filter((l) => known.has(l.id)).map((l) => ({ id: l.id, text: l.name, x: l.mapPos.x, y: l.mapPos.y })),
          { x: 0, y: 0, width: MAP_WIDTH, height: MAP_HEIGHT },
        ).map((o) => [o.id, o]),
      ),
    [map.known.length],
  );

  const go = () => {
    if (!target) return;
    send({ type: 'travel', to: target, pace });
    onClose();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('map.aria')}>
      <section class="world-map">
        <header class="journal-head">
          <h2>{lore.continent.name}</h2>
          <span class="muted small">
            {t(`time.${tod}`)}
            {fx ? ` · ${fx.description}` : ''}
          </span>
          <button type="button" onClick={onClose} aria-label={t('map.closeAria')}>
            {t('common.close')}
          </button>
        </header>
        <div class="world-map-body">
          <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} class="map-svg" role="img" aria-label={t('map.svgAria')}>
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#23384a" />
            <defs>
              <filter id="fog-blur" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="28" />
              </filter>
              <mask id="fog-mask">
                <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="white" />
                <g filter="url(#fog-blur)">
                  {lore.locations
                    .filter((l) => known.has(l.id))
                    .map((l) => (
                      <circle key={l.id} cx={l.mapPos.x} cy={l.mapPos.y} r={visited.has(l.id) ? 150 : 100} fill="black" />
                    ))}
                </g>
              </mask>
            </defs>
            {lore.regions.map((r) => (
              <g key={r.id}>
                <path d={regionPath(r.mapBounds, r.id)} fill={REGION_FILL[r.tone]} stroke="#1a2a36" stroke-width={4} opacity={0.92} />
                <path d={regionPath(r.mapBounds, r.id)} fill="none" stroke="#e8dcc0" stroke-opacity={0.25} stroke-width={1.5} stroke-dasharray="2 6" transform={`translate(0 0)`} />
                {terrainGlyphs(r.mapBounds, r.tone, r.id, lore.locations.filter((l) => l.regionId === r.id).map((l) => l.mapPos)).map((g, i) => (
                  <TerrainGlyph key={i} g={g} />
                ))}
              </g>
            ))}
            {lore.routes
              .filter((r) => known.has(r.from) && known.has(r.to))
              .map((r) => {
                const a = loc(r.from).mapPos;
                const b = loc(r.to).mapPos;
                const st = ROUTE_STYLE[r.kind]!;
                const on = planned.has(routeKey(r.from, r.to));
                return <line key={`${r.from}-${r.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={on ? '#ffd76a' : st.stroke} stroke-width={on ? 5 : 3} stroke-dasharray={st.dash} />;
              })}
            {/* Fog over what the hero hasn't heard of; region names only once a place there is known. */}
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#141210" opacity={0.9} mask="url(#fog-mask)" pointer-events="none" />
            {lore.regions
              .filter((r) => lore.locations.some((l) => l.regionId === r.id && known.has(l.id)))
              .map((r) => (
                <text key={r.id} x={r.mapBounds.x + r.mapBounds.width / 2} y={r.mapBounds.y + 34} text-anchor="middle" class="map-region-label">
                  {r.name}
                </text>
              ))}
            {lore.locations
              .filter((l) => known.has(l.id))
              .map((l) => {
                const here = l.id === map.current;
                const lab = labels.get(l.id);
                return (
                  <g key={l.id} class={`map-place${target === l.id ? ' selected' : ''}${visited.has(l.id) ? '' : ' heard'}`} onClick={() => !here && setTarget(l.id)} role="button" aria-label={l.name}>
                    <circle cx={l.mapPos.x} cy={l.mapPos.y} r={16} fill="transparent" />
                    <PlaceIcon kind={l.kind} x={l.mapPos.x} y={l.mapPos.y} solid={visited.has(l.id)} />
                    {here && <circle cx={l.mapPos.x} cy={l.mapPos.y} r={17} fill="none" stroke="#ffd76a" stroke-width={2} />}
                    {lab && (
                      <text x={lab.x} y={lab.y} text-anchor={lab.anchor} class="map-place-label">
                        {l.name}
                      </text>
                    )}
                  </g>
                );
              })}
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill={TINT[tod]} pointer-events="none" />
          </svg>
          <aside class="map-side">
            <p>
              <span class="muted">{t('map.youAreIn')}</span> <strong>{loc(map.current).name}</strong>
            </p>
            {targetLoc ? (
              <>
                <h3>{targetLoc.name}</h3>
                <p class="small">{visited.has(targetLoc.id) ? targetLoc.summary : t('map.onlyHeard')}</p>
                {plan ? (
                  <>
                    <p class="small">
                      {t('map.route', { miles, kinds: [...new Set(plan.map((l) => l.kind))].map((k) => t(`map.kind.${k}` as MessageKey)).join(', '), time: hoursText(hours) })}
                    </p>
                    <fieldset>
                      <legend>{t('map.pace')}</legend>
                      <div class="option-row">
                        {(['slow', 'normal', 'fast'] as const).map((p) => (
                          <label key={p} class={`option-pill${pace === p ? ' selected' : ''}`}>
                            <input type="radio" name="pace" checked={pace === p} onChange={() => setPace(p)} />
                            {t(`map.pace.${p}`)}
                          </label>
                        ))}
                      </div>
                      <p class="hint small">
                        {t(`map.paceHint.${pace}`)}
                        {plan.some((l) => l.kind === 'trail' && effectivePace(l.kind, pace) !== pace) ? ` ${t('map.trailLimit')}` : ''}
                      </p>
                    </fieldset>
                    <button type="button" class="primary" onClick={go}>
                      {t('map.travel', { place: targetLoc.name })}
                    </button>
                  </>
                ) : (
                  <p class="hint small">{t('map.noRoute')}</p>
                )}
              </>
            ) : (
              <p class="hint small">{t('map.choose')}</p>
            )}
            <ul class="map-legend small">
              <li>{t('map.legendIcons')}</li>
              <li>{t('map.legendRoutes')}</li>
            </ul>
          </aside>
        </div>
      </section>
    </div>
  );
}
