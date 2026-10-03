// The hall of fame on the TV: a calm rotating panel in the lobby (leaderboard, recent games, latest
// achievements), and a full-screen board shown once after a game's podium.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {ACHIEVEMENT_BY_ID} from '../../../shared/achievements';
import {BOARDS} from '../../../shared/board';
import type {HallOfFame} from '../../../shared/profiles';
import {useNet} from '../../net';
import {Avatar} from '../../ui/Avatar';
import {Badge} from '../../ui/Badge';
import {PLAYER_HEX} from '../../ui/Icons';
import {posterUrl} from '../../../shared/poster';
import {tvt} from '../settings';

type Panel = 'leaders' | 'recent' | 'latest';
const TITLES: Record<Panel, string> = {leaders: 'Hall of fame', recent: 'Recent games', latest: 'Latest achievements'};
const ROTATE_MS = 12000;
const vw = (n: number) => Math.round(window.innerWidth * n / 100);
const shortDate = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'});

function panelsOf(f: HallOfFame | null): Panel[] {
  if (!f) return [];
  return [f.leaderboard.length ? 'leaders' : null, f.recent.length ? 'recent' : null, f.latest.length ? 'latest' : null].filter(Boolean) as Panel[];
}

/** Lobby: one panel at a time, rotating slowly, with a progress hairline. Nothing before the first recorded game. */
export function FamePanel() {
  const fame = useNet((s) => s.fame);
  const panels = useMemo(() => panelsOf(fame), [fame]);
  const [i, setI] = useState(0);
  useEffect(() => {
    if (panels.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % panels.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [panels.length]);
  if (!fame || !panels.length) return null;
  const panel = panels[i % panels.length];
  return (
    <motion.section aria-label={TITLES[panel]} initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} transition={{duration: 0.8, delay: 0.6}}
      style={{position: 'relative', padding: '1.4vw 1.8vw 1.6vw', borderRadius: '1.4vw', background: 'rgba(10,4,2,.52)', backdropFilter: 'blur(14px)',
        boxShadow: 'inset 0 0 0 1px var(--rim)', overflow: 'hidden', height: '30vh'}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1vh'}}>
        <AnimatePresence mode="wait">
          <motion.h2 key={panel} initial={{opacity: 0, x: -12}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: 12}} transition={{duration: 0.4}}
            style={{margin: 0, fontSize: '1.7vw', fontWeight: 800, fontVariationSettings: "'wdth' 100"}}>{TITLES[panel]}</motion.h2>
        </AnimatePresence>
        {panels.length > 1 && (
          <div aria-hidden="true" style={{display: 'flex', gap: '0.4vw'}}>
            {panels.map((p, k) => <span key={p} style={{width: '0.5vw', height: '0.5vw', borderRadius: '50%', background: k === i % panels.length ? 'var(--ice)' : 'rgba(255,255,255,.2)'}} />)}
          </div>
        )}
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={panel} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.5}}>
          {panel === 'leaders' && <Leaders fame={fame} rows={4} scale={1} />}
          {panel === 'recent' && <Recent fame={fame} rows={3} scale={1} />}
          {panel === 'latest' && <Latest fame={fame} count={4} scale={1} columns={2} />}
        </motion.div>
      </AnimatePresence>
      {panels.length > 1 && (
        <motion.div key={`bar-${i}`} aria-hidden="true" initial={{scaleX: 0}} animate={{scaleX: 1}} transition={{duration: ROTATE_MS / 1000, ease: 'linear'}}
          style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, transformOrigin: 'left', background: 'rgba(234,242,244,.28)'}} />
      )}
    </motion.section>
  );
}

function Leaders({fame, rows, scale}: {fame: HallOfFame; rows: number; scale: number}) {
  return (
    <ol style={{listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: `${0.9 * scale}vh`}}>
      {fame.leaderboard.slice(0, rows).map((l, i) => {
        // Players level on wins share a rank.
        const rank = 1 + fame.leaderboard.filter((x) => x.wins > l.wins).length;
        return (
        <motion.li key={l.profile.id} initial={{opacity: 0, x: -20}} animate={{opacity: 1, x: 0}} transition={{delay: 0.1 + i * 0.08}}
          style={{display: 'grid', gridTemplateColumns: `${2.2 * scale}vw ${3.4 * scale}vw 1fr auto auto`, alignItems: 'center', gap: `${1 * scale}vw`}}>
          <span className="num" style={{fontSize: `${1.8 * scale}vw`, color: rank === 1 ? 'var(--mc)' : 'var(--ice-dim)'}}>{rank}</span>
          <Avatar name={l.profile.name} color={l.profile.color} avatar={l.profile.avatar} size={vw(3 * scale)} />
          <span style={{fontSize: `${1.6 * scale}vw`, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{l.profile.name}</span>
          <span style={{fontSize: tvt(1.2 * scale)}}><span className="num" style={{fontSize: `${1.8 * scale}vw`}}>{l.wins}</span> <span className="faint">win{l.wins === 1 ? '' : 's'}</span></span>
          <span className="faint" style={{fontSize: tvt(1.1 * scale), minWidth: `${9 * scale}vw`, textAlign: 'right'}}>
            {l.winRate === null ? `${l.games} game${l.games === 1 ? '' : 's'}` : `${Math.round(l.winRate * 100)}% of ${l.games}`}
          </span>
        </motion.li>
        );
      })}
    </ol>
  );
}

function Recent({fame, rows, scale}: {fame: HallOfFame; rows: number; scale: number}) {
  const games = fame.recent.slice(0, rows);
  // A poster thumbnail beside each game that has one; the column is kept whenever any game has one.
  const thumbs = games.some((g) => g.poster != null);
  return (
    <ol style={{listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: `${1.1 * scale}vh`}}>
      {games.map((g, i) => {
        const winners = g.players.filter((p) => p.placement === 1);
        return (
          <motion.li key={g.gameId} initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: 0.1 + i * 0.1}}
            style={{display: 'grid', gridTemplateColumns: thumbs ? `${7.2 * scale}vw 1fr` : '1fr', gap: `${1 * scale}vw`, alignItems: 'center'}}>
            {thumbs && (g.poster != null
              ? <img src={posterUrl({gameId: g.gameId, version: g.poster}, 'library', 'thumb')} alt="" loading="lazy"
                  style={{width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: '0.4vw', boxShadow: '0 0 0 1px var(--rim-strong)'}} />
              : <span style={{width: '100%', aspectRatio: '16 / 9', borderRadius: '0.4vw', background: 'rgba(255,255,255,.05)'}} />)}
            <div style={{display: 'grid', gap: `${0.3 * scale}vh`, minWidth: 0}}>
            <div className="faint cond" style={{fontSize: tvt(1.05 * scale)}}>{shortDate.format(g.endedAt)} · {BOARDS[g.board].title} · {g.mode === 'full' ? 'Full game' : 'Companion'} · {g.generations} generation{g.generations === 1 ? '' : 's'}</div>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: `0.4vh ${1.4 * scale}vw`, fontSize: `${1.4 * scale}vw`}}>
              {g.players.map((p) => (
                <span key={p.color + p.name} style={{fontWeight: p.placement === 1 ? 800 : 500, opacity: p.placement === 1 ? 1 : 0.72}}>
                  <span style={{color: PLAYER_HEX[p.color] ?? 'var(--ice)'}}>{p.name}</span> <span className="num">{p.vp}</span>
                  {p.placement === 1 && g.players.length > 1 && <span className="cond" style={{color: 'var(--mc)', fontSize: '0.8em'}}> {winners.length > 1 ? 'shared win' : 'wins'}</span>}
                </span>
              ))}
            </div>
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

function Latest({fame, count, scale, columns = Math.ceil(count / 2)}: {fame: HallOfFame; count: number; scale: number; columns?: number}) {
  return (
    <div style={{display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: `${1.4 * scale}vh ${1 * scale}vw`}}>
      {fame.latest.slice(0, count).map((u, i) => {
        const def = ACHIEVEMENT_BY_ID.get(u.achievement);
        return (
          <motion.div key={u.profileId + u.achievement} initial={{opacity: 0, scale: 0.7}} animate={{opacity: 1, scale: 1}} transition={{delay: 0.1 + i * 0.08, type: 'spring', stiffness: 200, damping: 16}}
            style={{display: 'flex', alignItems: 'center', gap: `${0.8 * scale}vw`, minWidth: 0}}>
            <Badge id={u.achievement} size={vw(3.6 * scale)} />
            <div style={{minWidth: 0}}>
              <div style={{fontSize: tvt(1.2 * scale), fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{def?.name ?? u.achievement}</div>
              <div style={{fontSize: tvt(1.05 * scale), color: PLAYER_HEX[u.color] ?? 'var(--ice-dim)'}}>{u.name}</div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Full-screen board, shown once after a game (see RollUp). */
export function HallOfFameBoard({fame}: {fame: HallOfFame}) {
  return (
    <div style={{position: 'absolute', inset: 0, padding: '7vh 6vw', display: 'grid', gridTemplateRows: 'auto 1fr', gap: '4vh'}}>
      <motion.h1 initial={{opacity: 0, y: 30, letterSpacing: '0.1em'}} animate={{opacity: 1, y: 0, letterSpacing: '0em'}} transition={{duration: 0.9, ease: [0.2, 0.9, 0.25, 1]}}
        style={{margin: 0, fontSize: '5.4vw', fontWeight: 900, fontVariationSettings: "'wdth' 120", lineHeight: 1}}>Hall of fame</motion.h1>
      <div style={{display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '4vw', alignContent: 'start'}}>
        <section>
          <h2 className="cond" style={{margin: '0 0 2vh', fontSize: '1.5vw', fontWeight: 600, color: 'var(--ice-dim)'}}>Leaderboard</h2>
          <Leaders fame={fame} rows={6} scale={1.25} />
        </section>
        <div style={{display: 'grid', gap: '5vh', alignContent: 'start'}}>
          {fame.latest.length > 0 && (
            <section>
              <h2 className="cond" style={{margin: '0 0 2vh', fontSize: '1.5vw', fontWeight: 600, color: 'var(--ice-dim)'}}>Latest achievements</h2>
              <Latest fame={fame} count={6} scale={1.1} columns={2} />
            </section>
          )}
          {fame.recent.length > 0 && (
            <section>
              <h2 className="cond" style={{margin: '0 0 2vh', fontSize: '1.5vw', fontWeight: 600, color: 'var(--ice-dim)'}}>Recent games</h2>
              <Recent fame={fame} rows={3} scale={1.05} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
