/** The local combat sandbox (`#combat-<class>`); loaded lazily with the combat screen. */
import { useEffect } from 'preact/hooks';
import { db } from '../../data';
import { combatDemoClass, screen } from '../state';
import { CombatScreen } from './CombatScreen';
import { demoAct, demoCombat, startDemoCombat } from './combatDemo';

export function DemoCombat() {
  const cls = combatDemoClass && db.classes.has(combatDemoClass) ? combatDemoClass : undefined;
  useEffect(() => {
    if (!cls) screen.value = 'title';
  }, [cls]);
  if (!cls) return null;
  if (!demoCombat.value) startDemoCombat(cls);
  const cur = demoCombat.value;
  if (!cur) return null;
  return <CombatScreen enc={cur.enc} ctx={cur.ctx} act={demoAct} onLeave={() => (screen.value = 'title')} leaveLabel="Leave sandbox" />;
}
