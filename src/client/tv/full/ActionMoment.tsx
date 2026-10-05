// A player used a card's action. A short moment in the side column, docked beside the acting player's panel so
// the panel stays in view: the card with a "Used" stamp, who used it, and one line saying what happened. Gains fly
// from the card into the panel's resource cells; resources added to the card pop up on it.
import {motion, useIsPresent} from 'motion/react';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {findCard} from '../../../shared/cards';
import type {PublicPlayerModel} from '../../../shared/full';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import {prefersReducedMotion} from '../../ui/tokens';
import {director} from '../sound/director';
import {TvCard} from '../TvCard';
import {tvt} from '../settings';
import {cardResWord} from './actions';
import {holdKey, tokenShare, useActionHolds} from './actionHolds';
import type {ActionSummary, Flight} from './actions';
import type {Color} from '../../../shared/full';
import {pulsePanel} from './pipeline/store';
import {sendResolve} from './pipeline/resolve';
import {useDisplayName} from '../../names';

/** `gameAge`: the update it came in; `targets`: players an attack by the same move hits (sent with its resolve);
 *  `gap`: ms since the previous moment's update (pacing). */
export type ActionMomentModel = {k: string; kind: 'action'; at: number; color: string; cards: string[]; line: string; summary: ActionSummary;
  gameAge?: number; targets?: Color[]; gap?: number | null};

/** Seconds into the moment: the stamp lands, the gains leave the card, the card's count pops. */
const AT = {stamp: 0.38, fly: 0.72, pop: 0.95};

type Region = {top: number; height: number};

export function ActionMoment({m, players}: {m: ActionMomentModel; players: PublicPlayerModel[]}) {
  const p = players.find((x) => x.color === m.color);
  const nameFor = useDisplayName();
  const color = PLAYER_HEX[m.color] ?? '#F2C230';
  const def = findCard(m.cards[0]);
  const box = useRef<HTMLDivElement>(null);
  const cardBox = useRef<HTMLDivElement>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [colW, setColW] = useState(0);
  const reduced = useMemo(prefersReducedMotion, []);
  const present = useIsPresent();

  // Dock in the larger free stretch of the column above or below the acting player's panel.
  useLayoutEffect(() => {
    const col = box.current?.parentElement;
    if (!col) return;
    const c = col.getBoundingClientRect();
    const strip = col.querySelector(`[data-strip-color="${m.color}"]`)?.getBoundingClientRect();
    const gap = window.innerHeight * 0.011;
    const cap = Math.min(c.height * 0.5, window.innerHeight * 0.44);
    if (!strip) { setRegion({top: c.height - cap, height: cap}); setColW(c.width); return; }
    const above = strip.top - c.top - gap;
    const below = c.bottom - strip.bottom - gap;
    const h = Math.max(0, Math.min(cap, Math.max(above, below)));
    setRegion(below >= above ? {top: strip.bottom - c.top + gap, height: h} : {top: strip.top - c.top - gap - h, height: h});
    setColW(c.width);
  }, [m.color]);

  // Panels the moment covers fade out while it shows: the active player's glow spreads past a panel's edge and would
  // otherwise ring the moment, and nothing of a covered panel should read through.
  useEffect(() => {
    const col = box.current?.parentElement;
    if (!col || !region || !present) return;
    const c = col.getBoundingClientRect();
    const top = c.top + region.top; const bottom = top + region.height;
    const hidden: HTMLElement[] = [];
    for (const el of col.querySelectorAll<HTMLElement>('[data-strip-color]')) {
      if (el.dataset.stripColor === m.color) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > top + 1 && r.top < bottom - 1) hidden.push(el);
    }
    for (const el of hidden) { el.style.transition = 'opacity .25s'; el.style.opacity = '0'; el.dataset.coveredByMoment = ''; }
    return () => { for (const el of hidden) { el.style.opacity = ''; delete el.dataset.coveredByMoment; } };
  }, [region, m.color, present]);

  // Once the moment starts to leave, its panel cells show the latest view whatever is still in the air.
  useEffect(() => { if (!present) useActionHolds.getState().release((h) => h.moment === m.k); }, [present, m.k]);

  // The player's chime and panel pulse as it slides in (Phase 1); the cue sounds as the stamp lands; the effects resolve
  // as the gains leave the card (Phase 4, told to the server for phone haptics).
  useEffect(() => {
    director.chime(m.color);
    pulsePanel(m.color, 700);
    const t = setTimeout(() => director.cue('cardAction'), AT.stamp * 1000);
    const r = setTimeout(() => { if (m.gameAge !== undefined) sendResolve(m.k, m.gameAge, m.color, m.targets ?? []); }, AT.fly * 1000);
    return () => { clearTimeout(t); clearTimeout(r); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onCard = m.summary.onCards.find((c) => c.name === m.cards[0]);
  const [count, setCount] = useState(onCard?.from);
  useEffect(() => {
    if (!onCard) return;
    const t = setTimeout(() => setCount(onCard.to), AT.pop * 1000);
    return () => clearTimeout(t);
  }, [onCard]);

  // the card's size from the docked height
  const pad = region ? Math.min(region.height * 0.09, window.innerWidth * 0.011) : 0;
  const cardH = region ? region.height - pad * 2 : 0;
  const cardW = Math.min(cardH * 63 / 88, colW * 0.42);
  const vw = (cardW / window.innerWidth) * 100;

  return (
    <motion.div ref={box} data-action-moment={m.cards.join('|')}
      initial={reduced ? {opacity: 0} : {x: '105%', opacity: 0}} animate={{x: 0, opacity: region ? 1 : 0}} exit={reduced ? {opacity: 0, transition: {duration: 0.25}} : {x: '105%', opacity: 0, transition: {duration: 0.35, ease: [0.4, 0, 1, 1]}}}
      transition={{type: 'spring', stiffness: 170, damping: 22}}
      style={{position: 'absolute', left: 0, right: 0, top: region?.top ?? 0, height: region?.height ?? 0, zIndex: 5, isolation: 'isolate', borderRadius: '1vw', overflow: 'hidden',
        background: 'linear-gradient(110deg, #1A0B07, #120604)', boxShadow: `0 0 0 2px ${color}, 0 1.6vw 4vw rgba(0,0,0,.55)`}}>
      <div style={{position: 'absolute', inset: 0, background: `radial-gradient(60% 90% at 0% 100%, color-mix(in oklab, ${color} 22%, transparent), transparent)`}} />
      {region && (
        <div style={{position: 'relative', height: '100%', display: 'flex', gap: '1.1vw', padding: pad, alignItems: 'stretch'}}>
          {def && (
            <motion.div ref={cardBox} style={{position: 'relative', width: cardW, flexShrink: 0, alignSelf: 'center'}}
              animate={reduced ? undefined : {rotate: [0, 0, -1.6, 0.8, 0], y: [0, 0, 3, -1, 0]}}
              transition={{duration: 0.5, delay: AT.stamp - 0.05, times: [0, 0.1, 0.35, 0.65, 1]}}>
              <TvCard card={def} vw={vw} maxVh={cardH / window.innerHeight} resources={count} />
              <Stamp reduced={reduced} />
              {onCard && count !== undefined && <CardCount n={count} type={onCard.type} up={onCard.to > onCard.from} popped={count === onCard.to} />}
            </motion.div>
          )}
          <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.9vh'}}>
            <motion.div initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} transition={{delay: 0.12}}
              style={{display: 'flex', alignItems: 'center', gap: '0.55vw', fontSize: tvt(1.15), fontWeight: 650, lineHeight: 1.2}}>
              <span style={{width: '0.8vw', height: '0.8vw', borderRadius: '0.2vw', background: color, flexShrink: 0}} />
              <span style={{color, minWidth: 0, overflowWrap: 'anywhere'}}>{nameFor(m.color, p?.name)} <span style={{fontWeight: 500, whiteSpace: 'nowrap'}}>uses its action</span></span>
            </motion.div>
            <motion.div initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: 0.2, duration: 0.5, ease: [0.2, 0.9, 0.25, 1]}}
              style={{fontSize: m.cards[0].length > 20 ? '1.75vw' : '2.1vw', lineHeight: 1.02, fontWeight: 850, fontVariationSettings: "'wdth' 110"}}>
              {m.cards[0]}
              {m.cards.length > 1 && <span className="muted" style={{display: 'block', fontSize: tvt(0.95), fontWeight: 600, marginTop: '0.4vh'}}>and {m.cards.slice(1).join(', ')}</span>}
            </motion.div>
            {m.line && (
              <motion.div data-action-line="" initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: AT.stamp + 0.1, duration: 0.4}}
                style={{fontSize: tvt(1.08), lineHeight: 1.3, color: m.summary.empty ? 'var(--ice-dim)' : 'var(--ice)',
                  display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden'}}>
                {m.line}
              </motion.div>
            )}
          </div>
        </div>
      )}
      {region && !reduced && m.summary.flights.length > 0 && <Flights moment={m.k} color={m.color} flights={m.summary.flights} from={cardBox} delay={AT.fly} />}
    </motion.div>
  );
}

function Stamp({reduced}: {reduced: boolean}) {
  return (
    <div style={{position: 'absolute', left: 0, right: 0, top: '8%', height: '34%', display: 'grid', placeItems: 'center', pointerEvents: 'none'}}>
      <motion.div initial={reduced ? {opacity: 0, rotate: -14} : {opacity: 0, scale: 2.3, rotate: -20}} animate={{opacity: 0.94, scale: 1, rotate: -14}}
        transition={reduced ? {delay: AT.stamp, duration: 0.2} : {delay: AT.stamp - 0.14, type: 'spring', stiffness: 520, damping: 24, mass: 0.8}}
        className="cond"
        style={{padding: '0.35vh 1vw', fontSize: '2vw', fontWeight: 850, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#FF7A55',
          border: '0.22vw solid #FF7A55', borderRadius: '0.45vw', background: 'rgba(20,6,3,.62)', boxShadow: '0 0 0 0.12vw rgba(20,6,3,.5), 0 0.4vw 1.2vw rgba(0,0,0,.45)'}}>
        Used
      </motion.div>
    </div>
  );
}

/** The resources on the card: the old count, then the new one with a pop. */
function CardCount({n, type, up, popped}: {n: number; type?: string; up: boolean; popped: boolean}) {
  return (
    <div style={{position: 'absolute', right: '-0.6vw', top: '-0.8vh', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none'}}>
      <motion.div key={n} data-card-count={n} initial={popped ? {scale: 1.9, opacity: 0.4} : false} animate={{scale: 1, opacity: 1}}
        transition={{type: 'spring', stiffness: 380, damping: 14}}
        className="num"
        style={{minWidth: '2.6vw', height: '2.6vw', padding: '0 0.4vw', borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: '1.5vw', letterSpacing: 0,
          background: popped ? (up ? 'var(--plants)' : 'var(--ember)') : 'rgba(30,14,10,.95)', color: popped ? '#0F1A10' : 'var(--ice)',
          boxShadow: popped ? `0 0 0 0.16vw rgba(255,255,255,.85), 0 0 1.6vw ${up ? 'rgba(91,190,106,.8)' : 'rgba(226,80,46,.8)'}` : '0 0 0 0.14vw rgba(255,255,255,.4)'}}>
        {n}
      </motion.div>
      <span className="cond" style={{marginTop: '0.3vh', fontSize: tvt(0.8), fontWeight: 650, color: 'var(--ice)', textShadow: '0 1px 4px rgba(0,0,0,.9)', whiteSpace: 'nowrap'}}>
        {cardResWord(type, n)}
      </span>
    </div>
  );
}

type Token = {id: string; hold: string; share: number; r: Flight['r']; prod: boolean; sx: number; sy: number; tx: number; ty: number; delay: number; target: Element | null};

/**
 * Gains leave the card and land in the player's panel cells (stock in the cell, production on its pill). The cell
 * holds its number back until the tokens land (actionHolds.ts): each landing token gives its share back. `delay`:
 * seconds before they leave; `merge`: one token per resource, all leaving together (busy pacing); `holds`: false for
 * a replay, whose panels hold nothing back.
 */
export function Flights({moment, color, flights, from, delay = 0, merge = false, holds = true}: {moment: string; color: string; flights: Flight[];
  from: React.RefObject<HTMLDivElement | null>; delay?: number; merge?: boolean; holds?: boolean}) {
  const [tokens, setTokens] = useState<Token[]>([]);
  useEffect(() => {
    const t = setTimeout(() => {
      const src = from.current?.getBoundingClientRect();
      const strip = document.querySelector(`[data-strip-color="${color}"]`);
      if (!src || !strip) { if (holds) useActionHolds.getState().release((h) => h.moment === moment); return; }
      const out: Token[] = [];
      let k = 0;
      for (const f of flights) {
        const cell = strip.querySelector(`[data-res-cell="${f.r}"]`);
        const target = f.prod ? cell?.querySelector('[data-prod-pill]') ?? cell : cell;
        const r = target?.getBoundingClientRect();
        const hold = holdKey(moment, f);
        if (!r) { if (holds) useActionHolds.getState().release((h) => h.key === hold); continue; }
        const n = merge ? 1 : Math.min(f.prod ? 2 : 4, Math.max(1, f.n));
        for (let i = 0; i < n; i++) {
          out.push({id: `${f.r}-${f.prod}-${i}`, hold, share: tokenShare(f.n, n, i), r: f.r, prod: f.prod, target: target ?? null,
            sx: src.left + src.width * (0.35 + 0.3 * Math.random()), sy: src.top + src.height * (0.3 + 0.3 * Math.random()),
            tx: r.left + r.width / 2, ty: r.top + r.height / 2, delay: merge ? 0 : k * 0.07});
          k++;
        }
      }
      setTokens(out);
    }, delay * 1000);
    return () => clearTimeout(t);
  }, [moment, color, flights, from, delay, merge, holds]);
  const size = Math.round(window.innerWidth * 0.017);
  return createPortal(
    <div style={{position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 45}}>
      {tokens.map((t) => {
        const lift = Math.min(window.innerHeight * 0.12, Math.abs(t.ty - t.sy) * 0.5 + window.innerHeight * 0.04);
        return (
          <motion.div key={t.id} data-action-flight={t.r}
            initial={{x: t.sx - size / 2, y: t.sy - size / 2, scale: 0.5, opacity: 0}}
            animate={{x: [t.sx - size / 2, (t.sx + t.tx) / 2 - size / 2, t.tx - size / 2], y: [t.sy - size / 2, Math.min(t.sy, t.ty) - lift - size / 2, t.ty - size / 2],
              scale: [0.5, 1.25, 0.75], opacity: [0, 1, 0.9]}}
            transition={{duration: 0.72, delay: t.delay, ease: 'easeInOut', times: [0, 0.45, 1]}}
            onAnimationComplete={() => {
              if (holds) useActionHolds.getState().land(t.hold, t.share);
              t.target?.animate?.([{transform: 'scale(1)'}, {transform: 'scale(1.14)', filter: 'brightness(1.5)'}, {transform: 'scale(1)'}], {duration: 380, easing: 'ease-out'});
              setTokens((all) => all.filter((x) => x.id !== t.id));
            }}
            style={{position: 'absolute', left: 0, top: 0, width: size, height: size, filter: 'drop-shadow(0 0 0.5vw rgba(255,220,150,.55))'}}>
            <ResIcon r={t.r} size={size} />
            {t.prod && <span style={{position: 'absolute', right: -size * 0.3, top: -size * 0.35, fontSize: size * 0.6, fontWeight: 800, color: 'var(--plants)'}}>▲</span>}
          </motion.div>
        );
      })}
    </div>,
    document.body,
  );
}
