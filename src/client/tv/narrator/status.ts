// Mission control's status for the TV options panel: "Mission control: last line 2 min ago", "can't reach the
// language model", or that the voice waits for a tap on this TV. Read from /api/health (the server's narrator
// health) while the panel is open, combined with this TV's own sound state.
import {useEffect, useState, useSyncExternalStore} from 'react';
import {narratorStatus} from '../../../shared/narrator';
import type {NarratorStatusInput} from '../../../shared/narrator';
import {useNet} from '../../net';
import {director} from '../sound/director';

const REFRESH_MS = 15_000;

export function useMissionStatus(): string | null {
  const enabled = useNet((s) => s.config?.narrator === true);
  const sound = useSyncExternalStore((l) => director.subscribe(l), () => `${director.unlocked}|${director.muted}`);
  const [health, setHealth] = useState<NarratorStatusInput['health']>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      fetch('/api/health', {cache: 'no-store'})
        .then((r) => r.json())
        .then((j: {narrator?: NarratorStatusInput['health']}) => { if (alive) { setHealth(j.narrator ?? null); setNow(Date.now()); } })
        .catch(() => { /* the panel simply shows no status */ });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [enabled]);
  if (!enabled) return null;
  const [unlocked, muted] = sound.split('|').map((x) => x === 'true');
  return narratorStatus({health, now, voiceLocked: !unlocked, muted});
}
