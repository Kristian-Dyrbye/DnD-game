/**
 * World map (spec §11.1): an illustrated SVG map of the continent — region shapes, routes, and the
 * places the hero knows (visited = solid, heard of = hollow). Click a known place to see the route,
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

const REGION_FILL: Record<Region['tone'], string> = { high_fantasy: '#6b7f3a', dark_fantasy: '#3e4a3f', swashbuckling: '#3f6f86' };
const ROUTE_STYLE: Record<string, { stroke: string; dash?: string }> = {
  road: { stroke: '#d9c49a' },
  trail: { stroke: '#b89b6a', dash: '6 5' },
  river: { stroke: '#7fb3d5', dash: '2 4' },
  sea: { stroke: '#9fd0ea', dash: '10 6' },
};
const TINT: Record<string, string> = { dawn: 'rgba(255,170,120,0.12)', day: 'rgba(0,0,0,0)', dusk: 'rgba(255,120,60,0.18)', night: 'rgba(10,20,60,0.45)' };

function hoursText(h: number): string {
  if (h < 8) return `${Math.round(h * 10) / 10} h`;
  return `${Math.ceil(h / 8)} day${Math.ceil(h / 8) > 1 ? 's' : ''} (${Math.round(h)} h on the road)`;
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

  const go = () => {
    if (!target) return;
    send({ type: 'travel', to: target, pace });
    onClose();
  };

  return (
    <div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="World map">
      <section class="world-map">
        <header class="journal-head">
          <h2>{lore.continent.name}</h2>
          <span class="muted small">
            {tod}
            {fx ? ` · ${fx.description}` : ''}
          </span>
          <button type="button" onClick={onClose} aria-label="Close map">
            Close
          </button>
        </header>
        <div class="world-map-body">
          <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} class="map-svg" role="img" aria-label="Continent map">
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#23384a" />
            {lore.regions.map((r) => (
              <g key={r.id}>
                <rect x={r.mapBounds.x} y={r.mapBounds.y} width={r.mapBounds.width} height={r.mapBounds.height} rx={60} fill={REGION_FILL[r.tone]} opacity={0.85} />
                <text x={r.mapBounds.x + 16} y={r.mapBounds.y + 30} class="map-region-label">
                  {r.name}
                </text>
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
            {lore.locations
              .filter((l) => known.has(l.id))
              .map((l) => {
                const here = l.id === map.current;
                return (
                  <g key={l.id} class={`map-place${target === l.id ? ' selected' : ''}`} onClick={() => !here && setTarget(l.id)} role="button" aria-label={l.name}>
                    <circle cx={l.mapPos.x} cy={l.mapPos.y} r={here ? 11 : 8} fill={visited.has(l.id) ? '#f3e2b8' : 'none'} stroke="#f3e2b8" stroke-width={3} />
                    {here && <circle cx={l.mapPos.x} cy={l.mapPos.y} r={17} fill="none" stroke="#ffd76a" stroke-width={2} />}
                    <text x={l.mapPos.x + 14} y={l.mapPos.y + 5} class="map-place-label">
                      {l.name}
                    </text>
                  </g>
                );
              })}
            <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill={TINT[tod]} pointer-events="none" />
          </svg>
          <aside class="map-side">
            <p>
              <span class="muted">You are in</span> <strong>{loc(map.current).name}</strong>
            </p>
            {targetLoc ? (
              <>
                <h3>{targetLoc.name}</h3>
                <p class="small">{visited.has(targetLoc.id) ? targetLoc.summary : 'You have only heard of this place.'}</p>
                {plan ? (
                  <>
                    <p class="small">
                      {miles} miles by {[...new Set(plan.map((l) => l.kind))].join(', ')} · about {hoursText(hours)}
                    </p>
                    <fieldset>
                      <legend>Pace</legend>
                      <div class="option-row">
                        {(['slow', 'normal', 'fast'] as const).map((p) => (
                          <label key={p} class={`option-pill${pace === p ? ' selected' : ''}`}>
                            <input type="radio" name="pace" checked={pace === p} onChange={() => setPace(p)} />
                            {p}
                          </label>
                        ))}
                      </div>
                      <p class="hint small">
                        {pace === 'fast' ? 'Fast: less time, but you notice less and cannot sneak.' : pace === 'slow' ? 'Slow: more time, better at spotting danger and foraging.' : 'Normal: a steady pace; hard to be stealthy.'}
                        {plan.some((l) => l.kind === 'trail' && effectivePace(l.kind, pace) !== pace) ? ' Trails limit you to a normal pace.' : ''}
                      </p>
                    </fieldset>
                    <button type="button" class="primary" onClick={go}>
                      Travel to {targetLoc.name}
                    </button>
                  </>
                ) : (
                  <p class="hint small">You don't know a route there yet.</p>
                )}
              </>
            ) : (
              <p class="hint small">Choose a place on the map.</p>
            )}
            <ul class="map-legend small">
              <li>● visited · ○ heard of</li>
              <li>— road · - - trail · ··· river · — — sea</li>
            </ul>
          </aside>
        </div>
      </section>
    </div>
  );
}
