// New achievements, revealed one by one on the phone of the person who earned them, once per device.
// Tap to go to the next; each advances on its own after a moment.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {ACHIEVEMENT_BY_ID} from '../../../shared/achievements';
import type {GameState} from '../../../shared/game';
import {useNet} from '../../net';
import {Badge} from '../../ui/Badge';

const SEEN_KEY = 'mars-ledger-seen-unlocks';
function seen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}
function markSeen(keys: string[]) {
  try {
    const s = [...seen(), ...keys].slice(-300);
    localStorage.setItem(SEEN_KEY, JSON.stringify(s));
  } catch { /* private mode: the reveal may repeat after a reload */ }
}

const TIER_GLOW = {bronze: '#D08A52', silver: '#B9C1D0', gold: '#F2C230'};
const STEP_MS = 3400;

export function UnlockReveal({state, playerId}: {state: GameState; playerId: string}) {
  const unlocks = useNet((s) => s.unlocks);
  const me = state.players.find((p) => p.id === playerId);
  const currentGame = state.mode === 'full' ? state.full?.gameId : state.id;
  const [queue, setQueue] = useState<string[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [i, setI] = useState(0);

  const mine = useMemo(() => {
    if (!unlocks || !me?.profileId || unlocks.gameId !== currentGame) return [];
    return unlocks.players.find((p) => p.profileId === me.profileId)?.achievements ?? [];
  }, [unlocks, me?.profileId, currentGame]);

  // Queue what this device has not shown yet; the score screen settles for a moment first.
  useEffect(() => {
    if (!mine.length || !unlocks) return;
    const fresh = mine.filter((a) => !seen().has(`${unlocks.gameId}:${a}`));
    if (!fresh.length) return;
    const t = setTimeout(() => { setGameId(unlocks.gameId); setQueue(fresh); setI(0); }, 1600);
    return () => clearTimeout(t);
  }, [mine, unlocks]);

  const current = queue[i];
  useEffect(() => {
    if (!current || !gameId) return;
    markSeen([`${gameId}:${current}`]);
    navigator.vibrate?.([30, 60, 30, 60, 90]);
    const t = setTimeout(() => setI((x) => x + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [current, gameId]);

  const def = current ? ACHIEVEMENT_BY_ID.get(current) : undefined;
  return (
    <AnimatePresence>
      {def && (
        <motion.div key="reveal" role="dialog" aria-label="New achievement" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.35}}
          onClick={() => setI((x) => x + 1)}
          style={{position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', padding: 24, cursor: 'pointer',
            background: 'radial-gradient(70% 50% at 50% 42%, rgba(60,26,16,.985), rgba(14,6,4,.995))', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)'}}>
          <AnimatePresence mode="wait">
            <motion.div key={def.id} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, y: -20}} transition={{duration: 0.3}}
              style={{display: 'grid', justifyItems: 'center', textAlign: 'center', gap: 10, maxWidth: 340}}>
              <div className="cond" style={{fontSize: 14, letterSpacing: '0.08em', color: TIER_GLOW[def.tier]}}>
                Achievement unlocked{queue.length > 1 ? ` · ${i + 1} of ${queue.length}` : ''}
              </div>
              <div style={{position: 'relative', width: 200, height: 200, display: 'grid', placeItems: 'center'}}>
                {/* rays */}
                <motion.svg aria-hidden="true" width="260" height="260" viewBox="0 0 100 100" style={{position: 'absolute'}}
                  initial={{opacity: 0, rotate: -20, scale: 0.6}} animate={{opacity: 0.55, rotate: 20, scale: 1}} transition={{duration: STEP_MS / 1000, ease: 'easeOut'}}>
                  {Array.from({length: 12}, (_, k) => (
                    <path key={k} d="M50 50 L48.5 2 L51.5 2 Z" fill={TIER_GLOW[def.tier]} opacity={k % 2 ? 0.35 : 0.7} transform={`rotate(${k * 30} 50 50)`} />
                  ))}
                </motion.svg>
                <motion.div aria-hidden="true" initial={{scale: 0.2, opacity: 0.9}} animate={{scale: 2.2, opacity: 0}} transition={{duration: 0.9, delay: 0.25, ease: 'easeOut'}}
                  style={{position: 'absolute', width: 120, height: 120, borderRadius: '50%', boxShadow: `0 0 0 3px ${TIER_GLOW[def.tier]}`}} />
                <motion.div initial={{scale: 0.1, rotate: -30, opacity: 0}} animate={{scale: 1, rotate: 0, opacity: 1}} transition={{type: 'spring', stiffness: 220, damping: 13, delay: 0.1}}>
                  <Badge id={def.id} size={160} />
                </motion.div>
              </div>
              <motion.h2 initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 0.45}}
                style={{margin: 0, fontSize: 34, lineHeight: 1.05, fontWeight: 850, fontVariationSettings: "'wdth' 112"}}>{def.name}</motion.h2>
              <motion.p initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.65}} className="muted" style={{margin: 0, fontSize: 17}}>{def.rule}</motion.p>
              <motion.p initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 1.2}} className="faint" style={{margin: '10px 0 0', fontSize: 13}}>
                {i + 1 < queue.length ? 'Tap for the next' : 'Tap to close'}
              </motion.p>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
