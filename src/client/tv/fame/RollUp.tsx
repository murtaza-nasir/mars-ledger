// After a game: once the podium has finished building, the TV rolls up what everyone unlocked,
// then shows the hall of fame, then reveals the game's poster, then returns to the podium.
// Once per game per TV; tap to skip.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useRef, useState} from 'react';
import {ACHIEVEMENT_BY_ID} from '../../../shared/achievements';
import type {GameState} from '../../../shared/game';
import {useNet} from '../../net';
import {Avatar} from '../../ui/Avatar';
import {Badge} from '../../ui/Badge';
import {PLAYER_HEX} from '../../ui/Icons';
import {useStage} from '../stage';
import {HallOfFameBoard} from './HallOfFame';
import {PosterReveal} from './PosterReveal';
import {tvt} from '../settings';

/** The podium builds for a few seconds; the roll-up never starts before it has settled. */
const PODIUM_SETTLE_MS = 7000;
/** Games without a story (no history) show a plain podium: start after this long instead. */
const NO_STORY_MS = 45000;
const FAME_MS = 20000;
/** The poster reveal; with a one-off illustration as well, each gets half. */
const POSTER_MS = 18000;
const SEEN_KEY = 'mars-ledger-tv-rollups';

function seenGames(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]; } catch { return []; }
}
function markGame(gameId: string) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seenGames(), gameId].slice(-50))); } catch { /* private mode */ }
}

export function RollUp({state}: {state: GameState}) {
  const {unlocks, fame, profiles} = useNet();
  const podium = useStage((s) => s.podium);
  const story = useStage((s) => s.story);
  const fullModel = useNet((s) => (s.fullView?.role === 'spectator' ? s.fullView.model : null));
  const ended = state.mode === 'full' ? fullModel?.game.phase === 'end' : state.phase === 'ended';
  const gameId = state.mode === 'full' ? state.full?.gameId : state.id;
  const [step, setStep] = useState<'wait' | 'roll' | 'fame' | 'poster' | 'done'>('wait');
  const poster = useNet((s) => (gameId ? s.posters[gameId] : undefined));
  const posterReady = poster?.library === 'ready';
  const endedAt = useRef<number | null>(null);
  const podiumSince = useRef<number | null>(null);

  useEffect(() => { if (ended && endedAt.current === null) endedAt.current = Date.now(); }, [ended]);
  useEffect(() => { podiumSince.current = podium ? podiumSince.current ?? Date.now() : null; }, [podium]);
  useEffect(() => { if (gameId && seenGames().includes(gameId)) setStep('done'); }, [gameId]);

  // Decide when to begin: the podium has settled, or a story-less end screen has been up a while.
  useEffect(() => {
    if (!ended || step !== 'wait' || !gameId) return;
    const t = setInterval(() => {
      const now = Date.now();
      const settled = podiumSince.current !== null && now - podiumSince.current >= PODIUM_SETTLE_MS;
      const plain = !story && !podium && endedAt.current !== null && now - endedAt.current >= NO_STORY_MS;
      if (!settled && !plain) return;
      const any = !!unlocks && unlocks.gameId === gameId && unlocks.players.some((p) => p.achievements.length > 0);
      if (!any && !fame?.leaderboard.length && !posterReady) return;
      markGame(gameId);
      setStep(any ? 'roll' : fame?.leaderboard.length ? 'fame' : 'poster');
    }, 500);
    return () => clearInterval(t);
  }, [ended, step, gameId, story, podium, unlocks, fame, posterReady]);

  const rows = unlocks && unlocks.gameId === gameId ? unlocks.players.filter((p) => p.achievements.length > 0) : [];
  const badgeCount = rows.reduce((a, r) => a + r.achievements.length, 0);
  const rollMs = 3200 + Math.min(badgeCount, 16) * 450;

  // roll → fame → poster → done, each only when it has something to show.
  const after = (s: typeof step): typeof step => (s === 'roll' && fame?.leaderboard.length ? 'fame' : (s === 'roll' || s === 'fame') && posterReady ? 'poster' : 'done');
  useEffect(() => {
    if (step === 'roll') { const t = setTimeout(() => setStep(after('roll')), rollMs); return () => clearTimeout(t); }
    if (step === 'fame') { const t = setTimeout(() => setStep(after('fame')), FAME_MS); return () => clearTimeout(t); }
    if (step === 'poster') { const t = setTimeout(() => setStep('done'), POSTER_MS); return () => clearTimeout(t); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, rollMs, fame, posterReady]);

  // Captions and stickers keep quiet while it plays, as they do for the story's chapters.
  useEffect(() => {
    const busy = step === 'roll' || step === 'fame' || step === 'poster';
    useStage.getState().set('story', busy || useStage.getState().story);
    if (!busy) return;
    const skip = () => setStep((s) => after(s));
    window.addEventListener('keydown', skip);
    return () => { window.removeEventListener('keydown', skip); useStage.getState().set('story', false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, fame, posterReady]);

  const skipClick = () => setStep((s) => after(s));
  const avatarOf = (id: string) => profiles.find((p) => p.id === id)?.avatar ?? null;
  const size = Math.round(window.innerWidth * 0.052);

  return (
    <AnimatePresence>
      {(step === 'roll' || step === 'fame' || step === 'poster') && (
        <motion.div key="rollup" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.8}} onClick={skipClick}
          style={{position: 'fixed', inset: 0, zIndex: 47, cursor: 'pointer', background: 'url(/assets/event-gameend.webp) center / cover'}}>
          <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(90% 80% at 50% 40%, rgba(24,10,6,.78), rgba(10,4,2,.94))'}} />
          <AnimatePresence mode="wait">
            {step === 'roll' ? (
              <motion.div key="roll" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, y: -30}} transition={{duration: 0.6}}
                style={{position: 'absolute', inset: 0, padding: '8vh 6vw', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '5vh'}}>
                <motion.h1 initial={{opacity: 0, y: 30, letterSpacing: '0.1em'}} animate={{opacity: 1, y: 0, letterSpacing: '0em'}} transition={{duration: 0.9, ease: [0.2, 0.9, 0.25, 1]}}
                  style={{margin: 0, fontSize: '5.4vw', fontWeight: 900, fontVariationSettings: "'wdth' 120", lineHeight: 1}}>New achievements</motion.h1>
                <div style={{display: 'grid', gridTemplateColumns: `repeat(${Math.min(rows.length, 5)}, 1fr)`, gap: '3vw', alignContent: 'start'}}>
                  {rows.map((r, ri) => {
                    const before = rows.slice(0, ri).reduce((a, x) => a + x.achievements.length, 0);
                    return (
                      <motion.section key={r.profileId} initial={{opacity: 0, y: 30}} animate={{opacity: 1, y: 0}} transition={{delay: 0.4 + ri * 0.2}}
                        style={{display: 'grid', gap: '2vh', alignContent: 'start'}}>
                        <div style={{display: 'flex', alignItems: 'center', gap: '1vw'}}>
                          <Avatar name={r.name} color={r.color} avatar={avatarOf(r.profileId)} size={Math.round(window.innerWidth * 0.036)} />
                          <span style={{fontSize: '2.2vw', fontWeight: 800, color: PLAYER_HEX[r.color] ?? 'var(--ice)'}}>{r.name}</span>
                        </div>
                        <div style={{display: 'grid', gap: '1.6vh'}}>
                          {r.achievements.slice(0, 6).map((a, k) => {
                            const def = ACHIEVEMENT_BY_ID.get(a);
                            return (
                              <motion.div key={a} initial={{opacity: 0, scale: 0.4, rotate: -20}} animate={{opacity: 1, scale: 1, rotate: 0}}
                                transition={{delay: 1 + (before + k) * 0.45, type: 'spring', stiffness: 220, damping: 14}}
                                style={{display: 'flex', alignItems: 'center', gap: '1vw'}}>
                                <Badge id={a} size={size} />
                                <div>
                                  <div style={{fontSize: '1.6vw', fontWeight: 750}}>{def?.name ?? a}</div>
                                  <div className="faint" style={{fontSize: tvt(1.05), maxWidth: '22vw'}}>{def?.rule}</div>
                                </div>
                              </motion.div>
                            );
                          })}
                          {r.achievements.length > 6 && <div className="faint" style={{fontSize: tvt(1.2)}}>and {r.achievements.length - 6} more</div>}
                        </div>
                      </motion.section>
                    );
                  })}
                </div>
              </motion.div>
            ) : step === 'poster' && poster ? (
              <motion.div key="poster" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 1.2}} style={{position: 'absolute', inset: 0}}>
                <PosterReveal status={poster} ms={POSTER_MS} />
              </motion.div>
            ) : (
              fame && <motion.div key="fame" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.8}} style={{position: 'absolute', inset: 0}}>
                <HallOfFameBoard fame={fame} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
