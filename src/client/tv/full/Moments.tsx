// Moments for the full-game TV: attacks slide over the side column so the board stays visible (played cards go
// through the move pipeline, pipeline/CardStage.tsx), banners, the podium, and the log ticker.
import {useSolo} from '../../ui/useSolo';
import {soloVerdict} from '../../../shared/solo';
import {BotMarkFor} from '../../ui/BotMark';
import {motion} from 'motion/react';
import {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {prefersReducedMotion} from '../../ui/tokens';
import {findCard} from '../../../shared/cards';
import type {Color, LogLine, PublicPlayerModel} from '../../../shared/full';
import type {Flight} from './actions';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import type {AttackTarget} from './diff';
import type {Resource} from '../../../shared/types';
import {tvt} from '../settings';
import {useNet} from '../../net';
import {Art} from '../../ui/CardFace';
import {usePipeline} from './pipeline/store';
import {tickerItems} from './pipeline/ticker';
import type {TickerIcon, TickerItem} from './pipeline/ticker';

/**
 * A played card on its way through the TV's move pipeline (pipeline/CardStage.tsx). `at`: when its update arrived;
 * `gap`: ms since the previous moment's update; `gameAge`: that update's; `targets`: players the attack after it hits;
 * `gains`: what flies to the panel; `tiles`: new tiles that drop in its Phase 4; `sequenced`: the stage sounds the card
 * and its tiles (sound/cues.ts leaves them out); `replay`: shown again on request (Phase 3 and 4 only, no state).
 */
export type CardMomentModel = {k: string; kind: 'card'; color: string; name: string;
  at?: number; gap?: number | null; gameAge?: number; targets?: Color[]; gains?: Flight[];
  tiles?: Array<{spaceId: string; tileType: number}>; sequenced?: boolean;
  replay?: {verb?: string; spaceId?: string; onDone?: () => void}};

/** `covered`: its resolve went out with the card or action before it; `cue`: it sounds the attack as it shows. */
export type AttackMomentModel = {k: string; kind: 'attack'; attacker: string; targets: AttackTarget[];
  at?: number; gap?: number | null; gameAge?: number; covered?: boolean; cue?: boolean};

export type Moment =
  | CardMomentModel
  | {k: string; kind: 'banner'; title: string; sub?: string; tone: 'generation' | 'production' | 'terraformed'}
  | AttackMomentModel;

export function Banner({m}: {m: Extract<Moment, {kind: 'banner'}>}) {
  const color = m.tone === 'production' ? 'var(--mc)' : m.tone === 'terraformed' ? 'var(--ocean)' : 'var(--ice)';
  return (
    <motion.div initial={{opacity: 0, y: -30}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -20}} transition={{type: 'spring', stiffness: 140, damping: 18}}
      style={{position: 'absolute', left: '50%', top: '4vh', transform: 'translateX(-50%)', zIndex: 6, textAlign: 'center', padding: '1.4vh 3vw',
        borderRadius: '1.2vw', background: 'rgba(12,5,3,.72)', backdropFilter: 'blur(14px)', boxShadow: '0 0 0 1px var(--rim-strong)'}}>
      <motion.div initial={{letterSpacing: '0.25em', opacity: 0}} animate={{letterSpacing: '0em', opacity: 1}} transition={{duration: 0.9}}
        style={{fontSize: '3.4vw', fontWeight: 850, fontVariationSettings: "'wdth' 120", color, lineHeight: 1}}>{m.title}</motion.div>
      {m.sub && <div className="muted" style={{fontSize: tvt(1.2), marginTop: '0.6vh'}}>{m.sub}</div>}
    </motion.div>
  );
}

export function Podium({players}: {players: PublicPlayerModel[]}) {
  const rows = [...players].sort((a, b) => (b.victoryPointsBreakdown?.total ?? 0) - (a.victoryPointsBreakdown?.total ?? 0));
  const solo = useSolo();
  const verdict = solo && rows.length === 1 ? soloVerdict(solo) : null;
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 1.2}}
      style={{position: 'absolute', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center',
        background: 'url(/assets/event-gameend.webp) center / cover, radial-gradient(circle at 40% 40%, #2F5E7A, var(--dusk-0))'}}>
      <div style={{position: 'absolute', inset: 0, background: 'rgba(12,5,3,.55)'}} />
      <div style={{position: 'relative', width: '72vw'}}>
        <h2 style={{fontSize: '5vw', margin: verdict ? '0 0 1vh' : '0 0 3vh', fontWeight: 850, fontVariationSettings: "'wdth' 120"}}>{verdict?.title ?? 'Mars is alive'}</h2>
        {verdict && <div data-testid="solo-result" data-result={solo!.result} style={{fontSize: '1.8vw', fontWeight: 650, margin: '0 0 3vh', color: solo!.result === 'won' ? 'var(--plants)' : 'var(--mc)'}}>{verdict.line}</div>}
        {rows.map((p, i) => {
          const b = p.victoryPointsBreakdown;
          return (
            <motion.div key={p.color} initial={{opacity: 0, x: -60}} animate={{opacity: 1, x: 0}} transition={{delay: 0.8 + (rows.length - i) * 0.5, type: 'spring', stiffness: 90}}
              style={{display: 'grid', gridTemplateColumns: '4vw 1fr repeat(5, 7vw) 8vw', alignItems: 'center', padding: '1.4vh 1.6vw', marginBottom: '1vh', borderRadius: '1vw',
                background: 'rgba(12,5,3,.62)', boxShadow: `inset 0.4vw 0 0 ${PLAYER_HEX[p.color]}`, fontSize: '1.3vw'}}>
              <span className="num" style={{fontSize: '2.4vw'}}>{verdict ? '' : i + 1}</span>
              <span style={{fontWeight: 750, fontSize: '1.9vw'}}>{p.name}<BotMarkFor color={p.color} /></span>
              <span><span className="faint cond">TR </span>{b?.terraformRating ?? p.terraformRating}</span>
              <span><span className="faint cond">Greenery </span>{b?.greenery ?? 0}</span>
              <span><span className="faint cond">City </span>{b?.city ?? 0}</span>
              <span><span className="faint cond">Cards </span>{b?.victoryPoints ?? 0}</span>
              <span><span className="faint cond">M&amp;A </span>{(b?.milestones ?? 0) + (b?.awards ?? 0)}</span>
              <span className="num" style={{fontSize: '3vw', textAlign: 'right'}}>{b?.total ?? p.terraformRating}</span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

/** How strongly each move shows, newest first. */
const ITEM_OPACITY = [1, 0.62, 0.42];

/**
 * The log lane: the newest moves, newest first at the left, as icons with a word or two: the player's colour,
 * the card's picture, its name, and what it did ("Asteroid → ocean"). At most three; older ones are dimmer, and only
 * they fade out at the right when the lane is short. A played card's move waits until the TV has shown the card.
 */
export function LogTicker({logs: incoming, players}: {logs: LogLine[]; players: PublicPlayerModel[]}) {
  // A person still answering their own move's follow-up questions may back out of it ("Choose something else"), so the
  // lines of that move wait until it is done (and vanish with it when it is taken back), like the TV's card moments.
  const moving = useNet((s) => s.fullView?.moving ?? null);
  const generation = useNet((s) => (s.fullView?.role === 'spectator' ? s.fullView.model.game.generation : 1));
  const quiet = useRef(incoming);
  if (!moving) quiet.current = incoming;
  const logs = moving ? quiet.current : incoming;
  const waiting = usePipeline((s) => s.waiting);
  const hideKey = waiting.map((w) => w.key).join(';');
  const items = useMemo(() => tickerItems(logs, new Set(hideKey ? hideKey.split(';') : []), generation), [logs, hideKey, generation]);
  const reduce = prefersReducedMotion();
  // Moves arriving in a burst (quick bots) show at once: an entrance restarted every few hundred ms would keep the
  // newest move invisible.
  const lastChange = useRef(0);
  const burst = useRef<{key: string | undefined; on: boolean}>({key: undefined, on: false});
  const newest = items[0];
  if (newest?.key !== burst.current.key) {
    const now = Date.now();
    burst.current = {key: newest?.key, on: now - lastChange.current < 900};
    lastChange.current = now;
  }
  const lane = useRef<HTMLDivElement>(null);
  const [fadeFrom, setFadeFrom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = lane.current;
    if (!el) return;
    let from: number | null = null;
    if (el.scrollWidth > el.clientWidth + 1) {
      const left = el.getBoundingClientRect().left;
      const first = [...el.querySelectorAll<HTMLElement>('[data-ticker-item]')].find((c) => c.getBoundingClientRect().right - left > el.clientWidth + 1);
      from = Math.round(Math.max(first ? first.getBoundingClientRect().left - left : el.clientWidth * 0.94, el.clientWidth * 0.94));
    }
    if (from !== fadeFrom) setFadeFrom(from);
  });
  const mask = fadeFrom === null ? undefined : `linear-gradient(90deg, #000 ${fadeFrom}px, transparent)`;
  (window as unknown as {__ticker?: unknown}).__ticker = {newest: newest ? `${newest.label}` : null, trail: Math.max(0, items.length - 1),
    items: items.map((it) => ({by: it.by, how: it.how, label: it.label, card: it.card, icons: it.icons.map((x) => x.k === 'res' ? `${x.r}${x.prod ? '+prod' : ''}` : x.k === 'tile' ? x.tile : x.k === 'global' ? x.param : x.k), hit: it.hit}))};
  (window as unknown as {__tickerFade?: number | null}).__tickerFade = fadeFrom;
  return (
    <div ref={lane} data-ticker="" style={{display: 'flex', alignItems: 'center', gap: '1.5vw', fontSize: tvt(1.1), lineHeight: 1.2, minHeight: `calc(2.2vw * var(--tvt, 1))`,
      overflow: 'hidden', whiteSpace: 'nowrap', maskImage: mask, WebkitMaskImage: mask}}>
      {items.map((it, i) => (
        <motion.div key={it.key} data-ticker-item={i === 0 ? 'newest' : 'trail'} layout={reduce ? false : 'position'}
          initial={reduce || burst.current.on || i > 0 ? false : {opacity: 0, x: '-0.8vw'}} animate={{opacity: ITEM_OPACITY[i] ?? 0.3, x: 0}}
          transition={{opacity: {duration: 0.35, delay: i === 0 ? 0.15 : 0}, x: {duration: 0.35}, layout: {type: 'spring', stiffness: 170, damping: 26}}}
          style={{flex: 'none', display: 'flex', alignItems: 'center'}}>
          <TickerMove it={it} players={players} />
        </motion.div>
      ))}
    </div>
  );
}

/** One move in the ticker: [colour][picture] Name → [what it did]. */
function TickerMove({it, players}: {it: TickerItem; players: PublicPlayerModel[]}) {
  const color = PLAYER_HEX[it.by] ?? 'var(--ice)';
  const name = players.find((p) => p.color === it.by)?.name ?? it.by;
  const def = it.card ? findCard(it.card) : undefined;
  const h = `calc(2.1vw * var(--tvt, 1))`;
  const icon = Math.round(window.innerWidth * 0.0145 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tvt')) || 1));
  return (
    <span aria-label={`${name}: ${it.label}`} style={{display: 'inline-flex', alignItems: 'center', gap: '0.5vw'}}>
      <span aria-hidden="true" style={{width: '0.75vw', height: h, borderRadius: '0.25vw', background: color, flex: 'none'}} />
      {def
        ? <span aria-hidden="true" style={{height: h, aspectRatio: '4 / 3', borderRadius: '0.35vw', overflow: 'hidden', position: 'relative', flex: 'none', containerType: 'inline-size',
          boxShadow: `0 0 0 0.1vw color-mix(in oklab, ${color} 60%, transparent)`}}><Art card={def} /></span>
        : <MoveGlyph how={it.how} label={it.label} size={icon} color={color} h={h} />}
      <span style={{fontWeight: 650, maxWidth: '13vw', overflow: 'hidden', textOverflow: 'ellipsis', color: it.how === 'passed' ? 'var(--ice-dim)' : 'var(--ice)'}}>{it.label}</span>
      {it.icons.length > 0 && <span aria-hidden="true" className="faint" style={{fontWeight: 500}}>→</span>}
      {it.icons.map((x, i) => <ResultIcon key={i} x={x} size={icon} />)}
      {it.hit.length > 0 && (
        <span aria-hidden="true" style={{display: 'inline-flex', alignItems: 'center', gap: '0.25vw', marginLeft: '0.2vw'}}>
          <svg width={icon} height={icon} viewBox="0 0 24 24"><path d="M13.5 2 5 13.5h5.5L9 22l9-12h-5.6z" fill="var(--ember)" /></svg>
          {it.hit.map((c) => <span key={c} style={{width: '0.75vw', height: '0.75vw', borderRadius: '0.2vw', background: PLAYER_HEX[c] ?? '#999'}} />)}
        </span>
      )}
    </span>
  );
}

function MoveGlyph({how, label, size, color, h}: {how: TickerItem['how']; label: string; size: number; color: string; h: string}) {
  const res = /plant/i.test(label) ? 'plants' : /heat/i.test(label) ? 'heat' : null;
  return (
    <span aria-hidden="true" style={{height: h, aspectRatio: '4 / 3', borderRadius: '0.35vw', display: 'grid', placeItems: 'center', flex: 'none',
      background: `color-mix(in oklab, ${color} 16%, #2A1712)`, boxShadow: `inset 0 0 0 0.1vw color-mix(in oklab, ${color} 45%, transparent)`}}>
      {how === 'milestone' && <svg width={size} height={size} viewBox="0 0 24 24"><path d="M6 21V4M6 4h11l-2.5 4L17 12H6" fill="none" stroke="var(--mc)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>}
      {how === 'award' && <svg width={size} height={size} viewBox="0 0 24 24"><path d="M7 4h10v4a5 5 0 0 1-10 0Z M12 13v4M8 20h8M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" fill="none" stroke="var(--mc)" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" /></svg>}
      {how === 'passed' && <svg width={size} height={size} viewBox="0 0 24 24"><path d="M5 12h12M13 7l5 5-5 5" fill="none" stroke="var(--ice-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      {how !== 'milestone' && how !== 'award' && how !== 'passed' && (res ? <ResIcon r={res} size={size} /> : <span style={{width: '0.6vw', height: '0.6vw', borderRadius: '0.15vw', background: color}} />)}
    </span>
  );
}

const TILE_FILL = {ocean: '#2F79B5', greenery: '#3E9A4C', city: '#8A8F9C', special: '#A0643A'} as const;

/** A result: a tile, a global parameter, a resource (▲ for production), cards drawn, TR. */
function ResultIcon({x, size}: {x: TickerIcon; size: number}) {
  const n = (v: number, prod = false) => <span className="num" style={{fontSize: '0.8em', fontWeight: 700, color: prod ? 'var(--plants)' : 'var(--ice)'}}>{prod ? '▲' : '+'}{v > 1 || !prod ? v : ''}</span>;
  if (x.k === 'tile') {
    return (
      <svg width={size * 1.1} height={size * 1.1} viewBox="0 0 24 24" aria-label={x.tile}>
        <path d="M12 2.5 20.2 7.2v9.6L12 21.5 3.8 16.8V7.2z" fill={TILE_FILL[x.tile]} stroke="rgba(255,255,255,.55)" strokeWidth="1" />
        {x.tile === 'ocean' && <path d="M7 12.5c1.7-1.4 3.3 1.4 5 0s3.3 1.4 5 0" fill="none" stroke="#DCEEFF" strokeWidth="1.5" strokeLinecap="round" />}
        {x.tile === 'greenery' && <path d="M12 17c-3-2-4-4.6-3.5-8.5 3 0 5.3 2 5.3 5M12 17V11" fill="none" stroke="#E6F7DD" strokeWidth="1.4" strokeLinecap="round" />}
        {x.tile === 'city' && <path d="M8 16v-4.5l2-1.3V16M10 16V9l2.5-1.3V16M12.5 16v-5h3v5" fill="none" stroke="#F2F2F2" strokeWidth="1.3" strokeLinejoin="round" />}
        {x.tile === 'special' && <circle cx="12" cy="12" r="2.6" fill="#FFE0BF" />}
      </svg>
    );
  }
  if (x.k === 'global') {
    return x.param === 'temperature'
      ? <svg width={size} height={size} viewBox="0 0 24 24" aria-label="temperature"><path d="M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z" fill="#3A1A10" stroke="#FF8A4C" strokeWidth="1.5" /><circle cx="12" cy="16.5" r="2.2" fill="#FF8A4C" /><path d="M12 15V8" stroke="#FF8A4C" strokeWidth="1.6" /></svg>
      : x.param === 'oxygen'
        ? <svg width={size} height={size} viewBox="0 0 24 24" aria-label="oxygen"><circle cx="12" cy="12" r="9" fill="#1E3B4A" stroke="#7FD1E8" strokeWidth="1.5" /><text x="12" y="15.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#BDEBF7">O₂</text></svg>
        : <svg width={size} height={size} viewBox="0 0 24 24" aria-label="venus"><circle cx="12" cy="10" r="5" fill="none" stroke="#C9A36B" strokeWidth="1.8" /><path d="M12 15v6M9 18h6" stroke="#C9A36B" strokeWidth="1.8" /></svg>;
  }
  if (x.k === 'res') return <span style={{display: 'inline-flex', alignItems: 'center', gap: '0.15vw'}}><ResIcon r={x.r} size={size} />{n(x.n, x.prod)}</span>;
  if (x.k === 'tr') return <span style={{display: 'inline-flex', alignItems: 'center', gap: '0.15vw'}}><ResIcon r="tr" size={size} />{n(x.n)}</span>;
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', gap: '0.15vw'}}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-label="cards"><rect x="5" y="3.5" width="12" height="16" rx="2" fill="#5B4A44" stroke="#CDB8A8" strokeWidth="1.2" transform="rotate(-8 11 11.5)" /><rect x="8" y="4.5" width="12" height="16" rx="2" fill="#7A6158" stroke="#F0E2D4" strokeWidth="1.2" /></svg>
      {n(x.n)}
    </span>
  );
}

const RES_WORD: Record<string, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};

export function AttackMoment({m, players}: {m: Extract<Moment, {kind: 'attack'}>; players: PublicPlayerModel[]}) {
  const nameOf = (c: string) => players.find((p) => p.color === c)?.name ?? c;
  const icon = Math.round(window.innerWidth * 0.018);
  return (
    <motion.div
      initial={{x: '105%', opacity: 0}} animate={{x: 0, opacity: 1}} exit={{x: '105%', opacity: 0, transition: {duration: 0.35, ease: [0.4, 0, 1, 1]}}}
      transition={{type: 'spring', stiffness: 140, damping: 20}}
      style={{position: 'absolute', inset: 0, borderRadius: '1.2vw', overflow: 'hidden', zIndex: 5, boxShadow: '0 0 0 2px var(--ember), 0 3vw 6vw rgba(0,0,0,.6)'}}>
      <motion.div initial={{scale: 1.2}} animate={{scale: 1}} transition={{duration: 4, ease: 'linear'}}
        style={{position: 'absolute', inset: 0, background: 'url(/assets/event-attack.webp) center / cover no-repeat, radial-gradient(circle at 50% 30%, #7A2414, var(--dusk-0))', filter: 'brightness(.55)'}} />
      <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(12,5,3,.15), rgba(12,5,3,.94) 62%), radial-gradient(80% 50% at 50% 100%, rgba(226,80,46,.35), transparent)'}} />
      <div style={{position: 'absolute', left: '2vw', right: '2vw', bottom: '3vh'}}>
        <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: 0.2}}
          style={{display: 'flex', alignItems: 'center', gap: '0.7vw', fontSize: '1.6vw', fontWeight: 650}}>
          <span style={{width: '1vw', height: '1vw', borderRadius: '0.25vw', background: PLAYER_HEX[m.attacker]}} />{nameOf(m.attacker)}
          <span className="faint" style={{fontWeight: 500}}>strikes</span>
        </motion.div>
        {m.targets.map((t, i) => (
          <motion.div key={t.color} initial={{opacity: 0, x: -30}} animate={{opacity: 1, x: [-30, 0, -8, 6, -3, 0]}}
            transition={{delay: 0.4 + i * 0.15, duration: 0.7}} style={{marginTop: '1.6vh'}}>
            <div style={{fontSize: '3.2vw', lineHeight: 1, fontWeight: 850, fontVariationSettings: "'wdth' 115", color: 'var(--ember)'}}>{nameOf(t.color)}</div>
            <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.8vw', marginTop: '1vh'}}>
              {t.losses.map((l, k) => (
                <span key={k} style={{display: 'inline-flex', alignItems: 'center', gap: '0.4vw', padding: '0.5vh 0.8vw', borderRadius: 999, fontSize: '1.3vw',
                  background: l.what === 'production' ? 'rgba(176,122,69,.22)' : 'rgba(255,255,255,.08)',
                  boxShadow: l.what === 'production' ? 'inset 0 0 0 1.5px rgba(176,122,69,.6)' : 'none'}}>
                  {l.resource && <ResIcon r={l.resource as Resource} size={icon} />}
                  {l.what === 'tr' && <ResIcon r="tr" size={icon} />}
                  <span className="num" style={{color: 'var(--ember)'}}>−{l.amount}</span>
                  <span className="muted">{l.what === 'production' ? `${RES_WORD[l.resource!]} production` : l.what === 'tr' ? 'TR' : l.what === 'card' ? `${(findCard(l.card!)?.resourceType ?? 'resource').toLowerCase()}${l.amount > 1 ? 's' : ''} from ${l.card}` : RES_WORD[l.resource!]}</span>
                </span>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}
