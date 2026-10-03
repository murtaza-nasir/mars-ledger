// Player strips and the milestone/award panel for the full-game TV.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';

/** Icon size that tracks the TV's width (the SVG icons take pixel sizes). */
export function useVwPx(vw: number): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return Math.round((w * vw) / 100);
}
import {findCard} from '../../../shared/cards';
import type {GameModel, PublicPlayerModel, TagCount} from '../../../shared/full';
import {PLAYER_HEX, RES_LABEL, ResIcon, TagIcon} from '../../ui/Icons';
import {actionCards} from './actions';
import {Rolling} from '../../ui/Rolling';
import {OverTimeNote, PortraitClock} from '../StripClock';
import type {Resource} from '../../../shared/types';
import {tvt} from '../settings';
import {BotMarkFor} from '../../ui/BotMark';

export function tagMap(t: PublicPlayerModel['tags']): Record<string, number> {
  if (Array.isArray(t)) return Object.fromEntries((t as TagCount[]).map((x) => [x.tag, x.count]));
  return t as Record<string, number>;
}

export function corporationOf(p: PublicPlayerModel): string | undefined {
  return p.tableau.find((c) => findCard(c.name)?.group === 'corporation')?.name;
}

const RES: Array<[Resource, keyof PublicPlayerModel, keyof PublicPlayerModel]> = [
  ['megacredits', 'megacredits', 'megacreditProduction'], ['steel', 'steel', 'steelProduction'], ['titanium', 'titanium', 'titaniumProduction'],
  ['plants', 'plants', 'plantProduction'], ['energy', 'energy', 'energyProduction'], ['heat', 'heat', 'heatProduction'],
];
/** A size that follows the TV text setting without tvt()'s text floor (for glyphs, not text). */
const sz = (vw: number) => `calc(${vw}vw * var(--tvt, 1))`;
const RES_VAR: Record<Resource, string> = {megacredits: '--mc', steel: '--steel', titanium: '--titanium', plants: '--plants', energy: '--energy', heat: '--heat'};

/**
 * How much the panel gives up when the side column runs short of height: 0 everything; 1 no tag row (the action dots
 * move to the corporation line); 2 a compact header (TR and VP on one line, the corporation line running on beneath them)
 * and resource cells with the icon beside the number; 3 the panels as at 2, with the milestones and awards block
 * compacted (no row labels, tighter spacing; FullTv); 4 no corporation line and tighter cells (five players on a 2.1:1
 * screen), the passed badge and the action count on the name's line after the hand count. Past 4 the milestones block
 * shrinks to fit (useFold). Resource numbers never go below the size they had before the redesign (tvt(1.05)).
 */
export type Fold = 0 | 1 | 2 | 3 | 4;

export function PlayerStrip({p, passed, sweep, index, fold = 0, hit, override, prodOverride}: {p: PublicPlayerModel; passed: boolean; sweep: number; index: number; fold?: Fold; hit?: number; override?: Record<Resource, number>; prodOverride?: Partial<Record<Resource, number>>}) {
  const color = PLAYER_HEX[p.color] ?? '#999';
  const compact = fold >= 2;
  const tight = fold >= 4;
  const avatar = tight ? 2.1 : compact ? 2.5 : 3;
  const icon = useVwPx(compact ? 1.05 : 1.3);
  const tagIcon = useVwPx(0.82);
  const vp = p.victoryPointsBreakdown?.total ?? p.terraformRating;
  const tags = Object.entries(tagMap(p.tags)).filter(([t, n]) => n > 0 && t !== 'event').sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const actions = actionCards(p);
  const corp = corporationOf(p);
  // after the name (folded) or the corporation: "passed" once the player has passed (their actions wait for the next
  // generation, so the dots give way to it), else the action dots once the tag row has folded away (the arrow alone
  // there: the word "actions" stays on the tag row, where it takes nobody's room)
  const meta = passed ? <PassedBadge />
    : fold >= 1 && actions.length > 0 ? <ActionDots actions={actions} short maxDots={tight ? 3 : 5} /> : null;
  const radius = '0.9vw';
  return (
    <motion.div layout key={hit ? `hit-${hit}` : 'strip'} data-panel-fold={fold}
      initial={hit ? {x: 0} : false}
      animate={{opacity: passed ? 0.5 : 1, x: hit ? [0, -14, 12, -9, 6, -3, 0] : 0, boxShadow: hit ? [`inset 0.3vw 0 0 ${color}, 0 0 0 2px rgba(226,80,46,.9)`, `inset 0.3vw 0 0 ${color}, 0 0 0 0px rgba(226,80,46,0)`] : `inset 0.3vw 0 0 ${color}`}}
      transition={{x: {duration: 0.6}, boxShadow: {duration: 1.6}}}
      style={{position: 'relative', flexShrink: 0, padding: tight ? '0.55vh 0.7vw 0.6vh 0.95vw' : compact ? '0.7vh 0.8vw 0.8vh 1vw' : '1vh 0.9vw 1.1vh 1.15vw', borderRadius: radius,
        // opaque enough to read over any sky without the blur (WebKit drops backdrop-filter)
        background: 'rgba(14,6,4,.78)', backdropFilter: 'blur(12px)'}}>
      {p.isActive && !passed && (
        <motion.div layoutId="full-turn-glow" style={{position: 'absolute', inset: 0, borderRadius: radius, pointerEvents: 'none', zIndex: 1,
          boxShadow: `0 0 0 2px ${color}, 0 0 2.4vw color-mix(in oklab, ${color} 45%, transparent)`}} />
      )}
      {sweep > 0 && (
        <div style={{position: 'absolute', inset: 0, overflow: 'hidden', borderRadius: radius, pointerEvents: 'none'}}>
          <motion.div key={sweep} initial={{x: '-110%'}} animate={{x: '110%'}} transition={{duration: 1.1, delay: index * 0.18, ease: 'easeInOut'}}
            style={{position: 'absolute', inset: 0, background: 'linear-gradient(100deg, transparent 20%, rgba(242,194,48,.28) 50%, transparent 80%)'}} />
        </div>
      )}
      {/* header: who, what they hold, where they stand. The name and the corporation come first: the passed badge and
          the action count sit after them and never take their room (a name ellipsizes only past 14 characters). */}
      {/* a grid: the portrait spans both lines; TR with VP beneath spans them too, except in a compact panel, where TR and
          VP share the name's line and the corporation line runs on beneath them to the panel's edge */}
      <div style={{display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', columnGap: '0.8vw', alignItems: 'center'}}>
        <div style={{gridColumn: 1, gridRow: tight ? 1 : '1 / span 2', display: 'flex'}}>
          <PortraitClock color={p.color} sizeVw={avatar}><Portrait corporation={corp} color={color} size={avatar} /></PortraitClock>
        </div>
        <div data-name-row="" style={{gridColumn: 2, gridRow: 1, display: 'flex', alignItems: 'center', gap: tight ? '0.5vw' : '0.7vw', minWidth: 0, alignSelf: tight ? 'center' : 'end'}}>
          <span data-player-name="" title={p.name} style={{fontSize: compact ? '1.3vw' : '1.45vw', fontWeight: 750, fontVariationSettings: "'wdth' 85", lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            flex: '0 1 auto', minWidth: keepChars(p.name, tight ? 13 : 14, 0.5)}}>
            {p.name}<BotMarkFor color={p.color} />
          </span>
          <HandCount n={p.cardsInHandNbr} />
          {tight && <OverTimeNote color={p.color} sizeVw={0.88} />}
          {tight && meta}
        </div>
        {!tight && (
          <div data-corp-line="" style={{gridColumn: compact ? '2 / span 2' : 2, gridRow: 2, alignSelf: 'start', display: 'flex', alignItems: 'center', gap: '0.6vw', minWidth: 0, marginTop: '0.1vh'}}>
            <span className="faint" title={corp} style={{fontSize: tvt(0.88), lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '0 1 auto', minWidth: keepChars(corp ?? '', 16, 0.47)}}>
              {corp ?? 'Choosing a corporation'}<OverTimeNote color={p.color} sizeVw={0.88} />
            </span>
            {meta}
          </div>
        )}
        {/* TR large with VP beneath; in a compact panel VP sits to the left on the same line */}
        <div data-panel-stats="" style={{gridColumn: 3, gridRow: compact ? 1 : '1 / span 2', display: 'flex', flexDirection: compact ? 'row-reverse' : 'column', alignItems: compact ? 'baseline' : 'flex-end', gap: tight ? '0.7vw' : compact ? '0.9vw' : 0}}>
          <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'flex-end', gap: '0.3vw'}}>
            <Rolling value={p.terraformRating} className="num" style={{fontSize: tight ? '1.7vw' : compact ? '1.9vw' : '2.2vw', color: 'var(--tr)'}} />
            <span className="cond" style={{fontSize: tvt(0.8), color: 'var(--tr)', fontWeight: 650, opacity: 0.85}}>TR</span>
          </div>
          <div className="muted" style={{fontSize: tvt(0.88), lineHeight: 1.2, marginTop: compact ? 0 : '0.2vh', whiteSpace: 'nowrap'}}>
            <span className="num" style={{fontWeight: 700, letterSpacing: 0}}>{vp}</span> VP
          </div>
        </div>
      </div>
      {/* resources: six tinted cells, the amount large and production as its own pill */}
      <div style={{display: 'grid', gridTemplateColumns: '1.2fr repeat(5, 1fr)', gap: '0.35vw', marginTop: tight ? '0.45vh' : compact ? '0.6vh' : '0.9vh'}}>
        {RES.map(([r, stock, prod]) => (
          <ResCell key={r} r={r} amount={override ? override[r] : p[stock] as number} prod={prodOverride?.[r] ?? p[prod] as number} icon={icon} compact={compact} tight={tight} />
        ))}
      </div>
      {fold === 0 && (tags.length > 0 || (actions.length > 0 && !passed)) && (
        <div data-tag-row="" style={{display: 'flex', alignItems: 'center', gap: '0.75vw', marginTop: '0.8vh', minHeight: tagIcon}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '0.6vw', flex: 1, minWidth: 0, overflow: 'hidden'}}>
            {tags.map(([t, n]) => (
              <span key={t} title={`${n} ${t}`} style={{display: 'inline-flex', alignItems: 'center', gap: '0.18vw', flexShrink: 0, opacity: 0.82}}>
                <TagIcon tag={t} size={tagIcon} /><span className="num" style={{fontSize: tvt(0.8), color: 'var(--ice-dim)', fontWeight: 650}}>{n}</span>
              </span>
            ))}
          </div>
          {!passed && <ActionDots actions={actions} />}
        </div>
      )}
    </motion.div>
  );
}

function ResCell({r, amount, prod, icon, compact, tight}: {r: Resource; amount: number; prod: number; icon: number; compact: boolean; tight?: boolean}) {
  const v = `var(${RES_VAR[r]})`;
  const pill = (
    <span data-prod-pill="" className="num" style={{display: 'inline-block', marginTop: tight ? '0.15vh' : compact ? '0.35vh' : '0.5vh', padding: tight ? '0 0.45vw' : '0.15vh 0.45vw', lineHeight: 1.15, borderRadius: 999,
      fontSize: tvt(0.74), fontWeight: 700, letterSpacing: 0, whiteSpace: 'nowrap',
      color: prod < 0 ? 'var(--ember)' : 'var(--ice)', opacity: prod === 0 ? 0.32 : 1,
      background: prod < 0 ? 'rgba(226,80,46,.16)' : `color-mix(in oklab, ${v} 24%, rgba(0,0,0,.25))`}}>
      {prod < 0 ? `▼ ${-prod}` : `▲ ${prod}`}
    </span>
  );
  return (
    <div data-res-cell={r} title={`${RES_LABEL[r]}: ${amount}, production ${prod}`}
      style={{display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0, padding: tight ? '0.35vh 0.2vw 0.4vh' : compact ? '0.5vh 0.2vw 0.6vh' : '0.6vh 0.2vw 0.7vh', borderRadius: '0.55vw',
        background: `color-mix(in oklab, ${v} 11%, rgba(255,255,255,.015))`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${v} 26%, transparent)`}}>
      {compact ? (
        <div style={{display: 'flex', alignItems: 'center', gap: '0.25vw', opacity: amount === 0 ? 0.4 : 1}}>
          <ResIcon r={r} size={icon} />
          <Rolling value={amount} className="num" style={{fontSize: tvt(1.12)}} showDelta={false} />
        </div>
      ) : (
        <>
          <span style={{display: 'inline-flex', opacity: amount === 0 ? 0.55 : 1}}><ResIcon r={r} size={icon} /></span>
          <Rolling value={amount} className="num" style={{fontSize: tvt(1.42), marginTop: '0.35vh', opacity: amount === 0 ? 0.4 : 1}} showDelta={false} />
        </>
      )}
      {pill}
    </div>
  );
}

/** A small card glyph and the number of cards in hand. */
function HandCount({n}: {n: number}) {
  return (
    <span title={`${n} cards in hand`} style={{display: 'inline-flex', alignItems: 'center', gap: '0.25vw', flexShrink: 0, color: 'var(--ice-dim)'}}>
      <svg viewBox="0 0 12 16" style={{width: sz(0.62), height: sz(0.84)}} aria-hidden>
        <rect x="1" y="1" width="10" height="14" rx="1.8" fill="rgba(234,242,244,.14)" stroke="currentColor" strokeWidth="1.3" />
      </svg>
      <span className="num" style={{fontSize: tvt(0.92), fontWeight: 700, letterSpacing: 0}}>{n}</span>
    </span>
  );
}

/** A text's floor width: its first `chars` characters (about `em` per character in the condensed face), so a flex row
 *  never squeezes a name or a corporation down to a letter or two; past `chars` it may ellipsize. */
function keepChars(text: string, chars: number, em: number): string {
  return `min(100%, ${(Math.min([...text].length, chars) * em).toFixed(2)}em)`;
}

/** "passed", as a small badge after the name or the corporation (the panel dims as well). */
function PassedBadge() {
  return (
    <span data-passed-badge="" className="cond" style={{marginLeft: 'auto', flexShrink: 0, fontSize: tvt(0.78), lineHeight: 1.3, fontWeight: 650, color: 'var(--ice-dim)',
      padding: '0 0.45vw', borderRadius: 999, boxShadow: 'inset 0 0 0 1px var(--rim-strong)', whiteSpace: 'nowrap'}}>passed</span>
  );
}

const DOT_READY = {backgroundColor: 'rgba(111,184,232,1)', boxShadow: 'inset 0 0 0 0.1vw rgba(111,184,232,1), 0 0 0.5vw 0 rgba(111,184,232,.7)'};
const DOT_USED = {backgroundColor: 'rgba(111,184,232,0)', boxShadow: 'inset 0 0 0 0.1vw rgba(234,242,244,.34), 0 0 0 0 rgba(111,184,232,0)'};

/**
 * The player's card actions this generation, labelled so it reads without a legend: the cards' action arrow and the
 * word "actions" (the arrow alone in a folded header, `short`). Up to `maxDots` actions show as dots, the ready (lit)
 * ones first and the used (dim) ones after; with more, a lit dot and a count, "3 of 7" ("3/7" when `short`). The title
 * names every card.
 */
export function ActionDots({actions, short, maxDots = 5}: {actions: Array<{name: string; used: boolean}>; short?: boolean; maxDots?: number}) {
  if (!actions.length) return null;
  const ready = actions.filter((a) => !a.used).length;
  const title = `Card actions, ${ready} of ${actions.length} unused: ${actions.map((a) => `${a.name}${a.used ? ' (used)' : ''}`).join(', ')}`;
  // ready first, then used; each group keeps the table order
  const ordered = [...actions.filter((a) => !a.used), ...actions.filter((a) => a.used)];
  const counted = actions.length > maxDots;
  const dot = (used: boolean) => ({width: sz(0.62), height: sz(0.62), borderRadius: '50%', display: 'inline-block', flexShrink: 0, ...(used ? DOT_USED : DOT_READY)});
  return (
    <span data-action-dots="" data-action-count={counted ? `${ready}/${actions.length}` : undefined} title={title}
      style={{display: 'inline-flex', alignItems: 'center', gap: '0.32vw', flexShrink: 0, marginLeft: 'auto', whiteSpace: 'nowrap'}}>
      {/* the card action arrow, as printed on the cards */}
      <svg data-action-label="" viewBox="0 0 20 12" aria-hidden="true" style={{width: sz(0.95), height: sz(0.57), flexShrink: 0, opacity: 0.75}}>
        <path d="M1 6h13M10 1.5 15.5 6 10 10.5" fill="none" stroke="rgba(111,184,232,1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!short && <span className="cond" style={{fontSize: tvt(0.78), color: 'var(--ice-dim)', marginRight: '0.12vw'}}>actions</span>}
      {counted ? (
        <>
          <motion.span data-action-dot={ready > 0 ? 'ready' : 'used'} initial={false} animate={{scale: ready > 0 ? 1 : 0.82, ...(ready > 0 ? DOT_READY : DOT_USED)}}
            transition={{duration: 0.45}} style={dot(ready === 0)} />
          <span className="num" style={{fontSize: tvt(0.86), fontWeight: 700, letterSpacing: 0, lineHeight: 1}}>
            <motion.span key={ready} initial={{opacity: 0.2, y: '-0.3em'}} animate={{opacity: 1, y: 0}} transition={{duration: 0.35}}
              style={{display: 'inline-block', color: ready > 0 ? 'rgba(111,184,232,1)' : 'var(--ice-dim)'}}>{ready}</motion.span>
            <span className="cond" style={{color: 'var(--ice-dim)', fontWeight: 600}}>{short ? '/' : ' of '}</span>
            <span style={{color: 'var(--ice-dim)'}}>{actions.length}</span>
          </span>
        </>
      ) : ordered.map((a) => (
        <motion.span key={a.name} layout="position" data-action-dot={a.used ? 'used' : 'ready'} initial={false}
          animate={{scale: a.used ? 0.82 : 1, ...(a.used ? DOT_USED : DOT_READY)}}
          transition={{duration: 0.45, layout: {duration: 0.45}}} style={dot(a.used)} />
      ))}
    </span>
  );
}

/** The corporation's portrait (public/portraits/<number>.webp) in the player's colour; hidden until it exists. */
export function Portrait({corporation, color, size}: {corporation?: string; color: string; size: number}) {
  const n = corporation ? findCard(corporation)?.number : undefined;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [n]);
  if (!n || failed) return null;
  return (
    <motion.img key={n} src={`/portraits/${n}.webp`} alt="" onError={() => setFailed(true)} decoding="async"
      initial={{opacity: 0, scale: 0.6}} animate={{opacity: 1, scale: 1}} transition={{type: 'spring', stiffness: 160, damping: 16}}
      style={{width: `${size}vw`, height: `${size}vw`, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
        boxShadow: `0 0 0 0.16vw ${color}, 0 0.4vw 1vw rgba(0,0,0,.5)`}} />
  );
}

/** Each milestone and award with the game element it is about: an icon and an accent from the resource or tag colours. */
type Theme = {icon: React.ReactNode; accent: string};
const res = (r: Resource | 'tr', accent?: string): Theme => ({icon: <ResIcon r={r} size={16} />, accent: accent ?? `var(--${r === 'megacredits' ? 'mc' : r})`});
const tag = (t: string, accent: string): Theme => ({icon: <TagIcon tag={t} size={16} />, accent});
const CARD: Theme = {icon: <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="2" fill="none" stroke="#C9B48A" strokeWidth="2" /></svg>, accent: '#C9B48A'};
const STANDING_THEME: Record<string, Theme> = {
  Terraformer: res('tr'), Mayor: tag('city', '#9AA0AE'), Gardener: tag('plant', 'var(--plants)'), Builder: tag('building', '#C08048'), Planner: CARD,
  Landlord: tag('city', '#9AA0AE'), Banker: res('megacredits'), Scientist: tag('science', '#E8E8E8'), Thermalist: res('heat'), Miner: res('steel'),
  Diversifier: tag('wild', '#B9B9B9'), Tactician: CARD, 'Polar Explorer': res('tr', '#9FD3F0'), Energizer: res('energy'), 'Rim Settler': tag('jovian', '#D9894A'),
  Cultivator: tag('plant', 'var(--plants)'), Magnate: CARD, 'Space Baron': tag('space', '#8F96C8'), Excentric: tag('microbe', '#7BB86F'), Contractor: tag('building', '#C08048'),
  Generalist: tag('wild', '#B9B9B9'), Specialist: res('megacredits'), Ecologist: tag('animal', '#4FAE5E'), Tycoon: CARD, Legend: tag('event', '#E2502E'),
  Celebrity: tag('earth', '#4F8FD8'), Industrialist: res('steel'), 'Desert Settler': res('heat'), 'Estate Dealer': tag('city', '#9AA0AE'), Benefactor: res('tr'),
};

/** Milestones and awards together, as two rows of small chips tinted by what each one is about. A claimed milestone or
 *  funded award turns the owner's colour; otherwise the chip shows the current leader and their score. */
export function Standings({game, players, compact}: {game: GameModel; players: PublicPlayerModel[]; compact?: boolean}) {
  const nameOf = (c?: string) => players.find((p) => p.color === c)?.name;
  const row = (label: string, list: GameModel['milestones'], verb: string) => (
    <div style={{display: 'grid', gap: '0.45vh'}} aria-label={label}>
      {!compact && <div className="cond" style={{fontSize: tvt(0.8), color: 'var(--ice-faint)', lineHeight: 1}}>{label}</div>}
      <div style={{display: 'grid', gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))`, gap: '0.35vw'}}>
        {list.map((m) => {
          const th = STANDING_THEME[m.name] ?? {icon: null, accent: 'var(--ice-dim)'};
          const owner = m.color;
          const ownerHex = owner ? PLAYER_HEX[owner] : null;
          const top = [...m.scores].sort((a, b) => b.score - a.score);
          const tied = top.length > 1 && top[0].score === top[1].score;
          const lead = top[0];
          return (
            <div key={m.name} data-standing={m.name} title={owner ? `${m.name}: ${verb} by ${m.playerName ?? nameOf(owner)}` : m.name}
              style={{position: 'relative', minWidth: 0, padding: compact ? '0.35vh 0.4vw 0.4vh' : '0.5vh 0.4vw 0.55vh', borderRadius: '0.55vw', display: 'grid', gap: compact ? '0.2vh' : '0.3vh',
                background: ownerHex ? `color-mix(in oklab, ${ownerHex} 34%, rgba(12,5,3,.9))` : `color-mix(in oklab, ${th.accent} 13%, rgba(12,5,3,.82))`,
                boxShadow: `inset 0 0 0 ${ownerHex ? 2 : 1}px color-mix(in oklab, ${ownerHex ?? th.accent} ${ownerHex ? 90 : 38}%, transparent)`}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '0.2vw', minWidth: 0}}>
                <span style={{flex: 'none', display: 'grid', placeItems: 'center', width: 14}}>{th.icon}</span>
                <span className="cond" style={{fontSize: 'calc(0.78vw * var(--tvt, 1))', fontVariationSettings: "'wdth' 58", fontWeight: 650, lineHeight: 1.05, color: 'var(--ice)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{m.name}</span>
              </div>
              <div className="cond" style={{fontSize: tvt(0.8), lineHeight: 1, display: 'flex', alignItems: 'center', gap: '0.25vw', minWidth: 0, whiteSpace: 'nowrap'}}>
                {ownerHex ? (
                  <span style={{color: '#fff', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis'}}>✓ {m.playerName ?? nameOf(owner)}</span>
                ) : lead ? (
                  <>
                    <span style={{width: '0.5vw', height: '0.5vw', minWidth: 7, minHeight: 7, borderRadius: '50%', flex: 'none', background: tied ? 'var(--ice-faint)' : PLAYER_HEX[lead.color]}} />
                    <span className="num" style={{color: 'var(--ice-dim)', fontWeight: 650}}>{tied ? `tied ${lead.score}` : lead.score}</span>
                  </>
                ) : <span className="faint">open</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div data-standings="" data-standings-compact={compact ? '' : undefined} style={{padding: compact ? '0.6vh 0.8vw 0.65vh' : '0.9vh 0.8vw 1vh', borderRadius: '0.9vw', background: 'rgba(12,5,3,.5)', backdropFilter: 'blur(12px)', display: 'grid', gap: compact ? '0.5vh' : '0.9vh'}}>
      {row('Milestones', game.milestones, 'claimed')}
      {row('Awards', game.awards, 'funded')}
    </div>
  );
}
