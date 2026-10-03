// Our own card design: art window, cost, tags, requirement, VP, a type-coloured name band and the rules.
// Sized with container-query units (cqw), so one layout reads the same in a hand, full screen, or on the TV.
// Variants: 'full' (the card), 'thumb' (art + name, for piles and trays), 'row' (a list line), and 'lifted'
// (the card held up in the lifted view: same frame, but its art, rules and a facts panel fit its content).
import {motion, type MotionValue} from 'motion/react';
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import type {CardDef, Requirement, VictoryPoints} from '../../shared/types';
import {decodeArt, isDecoded, useArt} from './deck/art';
import {IS_IOS} from './platform';
import {useRenderCount} from '../perf/recorder';
import {TAG_COLOR, TagIcon} from './Icons';
import type {CardHint} from './cardHints';

export const TYPE_COLOR: Record<string, string> = {
  automated: '#3E8C4A', active: '#2F6FB8', event: '#B8402A', corporation: '#8A8472', prelude: '#C98A2E',
  standard_project: '#7A5A3A', ceo: '#8A8472',
};
/** The name band: flat colour for projects, grey-to-gold for corporations. */
export function bandFill(type: string): string {
  if (type === 'corporation' || type === 'ceo') return 'linear-gradient(95deg, #6E6B66 0%, #9C8B5E 55%, #D7B45A 100%)';
  const c = TYPE_COLOR[type] ?? '#555';
  return `linear-gradient(95deg, ${c} 0%, ${c} 60%, color-mix(in oklab, ${c} 70%, white) 100%)`;
}

ensureStyles();

// iPhone (WebKit): no CSS filters on card parts. A filter can give an element its own compositing layer inside a
// moving card, and WebKit re-rasterised those while cards slid (flicker). Elsewhere the tags keep their shadow.
const TAG_SHADOW = IS_IOS ? undefined : 'drop-shadow(0 0.6cqw 0.8cqw rgba(0,0,0,.5))';

type Props = {
  card: CardDef;
  cost?: number;
  layoutId?: string;
  /** Kept for existing callers: compact = the 'row' variant. */
  compact?: boolean;
  variant?: 'full' | 'thumb' | 'row' | 'lifted';
  /** lifted: the frame in px (its layout is fitted once, at this size). */
  width?: number;
  height?: number;
  /** lifted: the card's action, for a card on the table. */
  status?: 'ready' | 'used';
  hideAutomation?: boolean;
  /** Resources sitting on the card (animals, microbes...). */
  resources?: number;
  /** Art window shape for the full card; pickers use a wider window to save height. */
  artAspect?: string;
  /** Parallax for the art as the card moves in a deck (px). */
  artX?: MotionValue<number>;
  /** lifted: relevant counts from the live game (cardHints.ts), under the rules. */
  hints?: CardHint[];
  /** One line under a row card (e.g. its action). */
  detail?: string;
  style?: CSSProperties;
};

export function CardFace(p: Props) {
  const variant = p.variant ?? (p.compact ? 'row' : 'full');
  if (variant === 'row') return <RowCard {...p} />;
  if (variant === 'thumb') return <ThumbCard {...p} />;
  if (variant === 'lifted' && p.width && p.height) return <LiftedFace {...p} width={p.width} height={p.height} />;
  return <FullFace {...p} />;
}

// ---- full ------------------------------------------------------------------------------------
function FullFace({card, cost, layoutId, hideAutomation, resources, artAspect = '3 / 2', artX, style}: Props) {
  const box = card.text.filter((t) => /^(Action|Effect):/i.test(t));
  const rest = card.text.filter((t) => !/^(Action|Effect):/i.test(t));
  const text = card.description ?? rest.join(' ');
  const len = box.join(' ').length + (text?.length ?? 0);
  const fs = len > 320 ? 3.25 : len > 230 ? 3.6 : len > 150 ? 3.95 : 4.35;
  const req = card.requirements.map(reqLabel).filter(Boolean) as ReactNode[];
  const isCorp = card.type === 'corporation' || card.type === 'ceo';
  return (
    <motion.article layoutId={layoutId} className="tm-card" aria-label={card.name}
      style={{position: 'relative', containerType: 'inline-size', aspectRatio: '63 / 88', borderRadius: '5.5cqw', padding: '2.6cqw',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'linear-gradient(165deg, #3B2B26 0%, #251713 55%, #1B100D 100%)',
        boxShadow: `inset 0 0 0 0.55cqw color-mix(in oklab, ${TYPE_COLOR[card.type] ?? '#555'} 75%, #000), inset 0 0.8cqw 1.4cqw rgba(255,255,255,.07), 0 2.6cqw 7cqw rgba(0,0,0,.5)`,
        ...style}}>
      <div style={{position: 'relative', aspectRatio: artAspect, borderRadius: '3.4cqw', overflow: 'hidden', flex: 'none',
        boxShadow: 'inset 0 0 0 0.35cqw rgba(0,0,0,.35)'}}>
        <Art card={card} x={artX} />
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 32%, transparent 62%, rgba(0,0,0,.45) 100%)'}} />
        {card.cost !== null && card.group === 'project' && <CostChip cost={cost ?? card.cost} base={card.cost} />}
        {isCorp && card.startingMegaCredits !== null && <CostChip cost={card.startingMegaCredits} base={card.startingMegaCredits} label="M€" />}
        <div style={{position: 'absolute', top: '2.4cqw', right: '2.4cqw', display: 'flex', gap: '1cqw'}}>
          {card.tags.map((t, i) => <span key={i} className="tm-fill" style={{width: '8.6cqw', height: '8.6cqw', filter: TAG_SHADOW}}><TagIcon tag={t} /></span>)}
        </div>
        {req.length > 0 && (
          <div style={{position: 'absolute', left: '2.4cqw', bottom: '2.4cqw', display: 'flex', gap: '1.2cqw', alignItems: 'center', padding: '0.9cqw 2.2cqw',
            borderRadius: '2cqw', background: 'rgba(242,194,48,.92)', color: '#2A1A04', fontWeight: 750, fontSize: '3.6cqw', fontVariationSettings: "'wdth' 82",
            boxShadow: '0 0.8cqw 1.6cqw rgba(0,0,0,.4)'}}>
            {req}
          </div>
        )}
        {card.victoryPoints !== null && <VpBadge vp={card.victoryPoints} card={card} />}
      </div>

      <div style={{position: 'relative', margin: '2cqw -0.2cqw 0', padding: '1.9cqw 3cqw', borderRadius: '2.4cqw', background: bandFill(card.type),
        boxShadow: 'inset 0 0.4cqw 0 rgba(255,255,255,.22), inset 0 -0.5cqw 0 rgba(0,0,0,.22), 0 0.8cqw 1.8cqw rgba(0,0,0,.35)'}}>
        <div style={{fontWeight: 780, fontSize: card.name.length > 24 ? '5.2cqw' : '6.2cqw', lineHeight: 1.05, fontVariationSettings: "'wdth' 74",
          textShadow: '0 0.3cqw 0.6cqw rgba(0,0,0,.45)', color: '#FFF8EE', letterSpacing: '0.01em'}}>{card.name}</div>
      </div>

      <div style={{flex: 1, display: 'flex', flexDirection: 'column', gap: '1.6cqw', padding: '2.4cqw 0.8cqw 0', fontSize: `${fs}cqw`, lineHeight: 1.36, color: 'var(--ice)'}}>
        {box.map((b, i) => (
          <p key={i} style={{margin: 0, padding: '1.6cqw 2.2cqw', borderRadius: '2cqw', background: 'rgba(255,255,255,.065)',
            boxShadow: `inset 0.7cqw 0 0 ${TYPE_COLOR[card.type] ?? '#666'}`}}>
            <strong style={{fontWeight: 720}}>{b.split(':')[0]}:</strong>{b.slice(b.indexOf(':') + 1)}
          </p>
        ))}
        {text && <p style={{margin: 0, color: 'rgba(234,242,244,.86)'}}>{text}</p>}
      </div>

      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '2cqw', paddingTop: '1.6cqw', fontSize: '3cqw', color: 'var(--ice-faint)'}}>
        <span className="num" style={{fontWeight: 600, letterSpacing: '0.04em'}}>{card.number ? `#${card.number}` : ''}</span>
        {!hideAutomation && card.automation !== 'full' && <span>{card.automation === 'partial' ? 'Mostly automatic' : 'Apply by hand'}</span>}
        {((card.resourceType && resources !== undefined) || (resources ?? 0) > 0) && <ResourcePill n={resources ?? 0} type={card.resourceType} />}
      </div>
      <div className="tm-sheen" aria-hidden="true" />
    </motion.article>
  );
}

// ---- lifted ----------------------------------------------------------------------------------
// The printed proportion wastes space when a card is held up: a short card left its lower half empty. Here the
// frame stays the same, but the art takes the free height, the rules are set as large as fit (17 to 24 px), and
// a facts panel says in words what the small card shows as icons. The fit is measured once, before the card is
// painted, at its final size: cards in the swipe strip mount before they slide in, so nothing re-wraps mid-swipe.
const TYPE_WORDS: Record<string, string> = {
  automated: 'Automated', active: 'Active', event: 'Event', corporation: 'Corporation', prelude: 'Prelude', ceo: 'CEO',
  standard_project: 'Standard project', standard_action: 'Standard action',
};
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const resWord = (t: string | null | undefined, n: number) => (t ? plural(n, t.toLowerCase()) : String(n));

export function reqWords(r: Requirement): string | null {
  const n = r.count ?? 1;
  if (r.temperature !== undefined) {
    const t = r.temperature > 0 ? `+${r.temperature}` : fmtSigned(r.temperature);
    return r.max ? `${t} °C or colder` : `${t} °C or warmer`;
  }
  if (r.oxygen !== undefined) return r.max ? `${r.oxygen}% oxygen or less` : `${r.oxygen}% oxygen or more`;
  if (r.oceans !== undefined) return r.max ? `${plural(r.oceans, 'ocean')} or fewer` : `${plural(r.oceans, 'ocean')} or more`;
  if (r.venus !== undefined) return r.max ? `${r.venus}% Venus or less` : `${r.venus}% Venus or more`;
  if (r.tag) return `${plural(n, `${cap(r.tag)} tag`)} of yours`;
  if (r.production) return `${r.production} production of yours`;
  if (r.greeneries !== undefined) return `${plural(r.greeneries, 'greenery', 'greeneries')} of yours`;
  if (r.cities !== undefined) return `${plural(r.cities, 'city', 'cities')}${r.all ? ' in play' : ' of yours'}`;
  if (r.tr !== undefined) return `TR ${r.tr}`;
  return null;
}

export function vpWords(vp: VictoryPoints, card: CardDef): string {
  if (typeof vp === 'number') return `${vp < 0 ? '−' : ''}${Math.abs(vp)} VP`;
  if (vp === 'special') return 'Special: see the card text';
  const per = vp.per && vp.per > 1 ? vp.per : 1;
  const each = vp.each ?? 1;
  if (vp.resourcesHere && vp.ifAny) return `${vp.ifAny} VP if it holds any ${(card.resourceType ?? 'resource').toLowerCase()}`;
  if (vp.resourcesHere) return `${each} VP per ${per > 1 ? resWord(card.resourceType, per) : (card.resourceType ?? 'resource').toLowerCase()} on it`;
  if (vp.tag) return `${each} VP per ${per > 1 ? `${per} ` : ''}${cap(vp.tag)} tag${per > 1 ? 's' : ''} you have`;
  if (vp.cities && vp.nextToThis) return '1 VP per adjacent city';
  if (vp.cities) return `1 VP per ${per > 1 ? `${per} cities` : 'city'}${vp.all ? ' in play' : ''}`;
  if (vp.oceans) return '1 VP per adjacent ocean';
  return 'See the card text';
}

/** Fitted lifted layouts by card, size and facts: moving back to a card (or lifting it again) lays it out once. */
const FIT_CACHE = new Map<string, {fs: number; hide: number}>();

function LiftedFace({card, cost, layoutId, resources, status, width, height, style, hints}: Props & {width: number; height: number}) {
  useRenderCount('LiftedFace');
  const box = card.text.filter((t) => /^(Action|Effect):/i.test(t));
  const rest = card.text.filter((t) => !/^(Action|Effect):/i.test(t));
  const text = card.description ?? rest.join(' ');
  const req = card.requirements.map(reqLabel).filter(Boolean) as ReactNode[];
  const isCorp = card.type === 'corporation' || card.type === 'ceo';
  const tags = card.tags.filter((t) => t !== 'event');
  // a requirement hint already says it with the current value ("Oxygen 7% max: now 5%"): no second Requires row
  const reqHinted = !!hints?.some((h) => h.key.startsWith('req'));
  const reqText = reqHinted ? '' : card.requirements.map(reqWords).filter(Boolean).join(', ');
  // facts, most useful last: when space runs out the first ones go first
  const facts: Array<{k: string; label: string; value: ReactNode}> = [
    {k: 'kind', label: 'Card', value: `${TYPE_WORDS[card.type] ?? cap(card.type)} · ${tags.length ? `${tags.map(cap).join(', ')} tag${tags.length > 1 ? 's' : ''}` : 'no tags'}`},
    ...(reqText ? [{k: 'req', label: 'Requires', value: reqText}] : []),
    ...(card.victoryPoints !== null ? [{k: 'vp', label: 'Points', value: vpWords(card.victoryPoints, card)}] : []),
    ...(card.resourceType && resources !== undefined ? [{k: 'res', label: 'On it', value: resWord(card.resourceType, resources)}] : []),
    ...(status ? [{k: 'act', label: 'Action', value: status === 'ready'
      ? <span style={{color: '#6FB8E8', fontWeight: 650}}>Ready to use</span> : 'Used this generation'}] : []),
  ];
  const ref = useRef<HTMLElement>(null);
  const art = useRef<HTMLDivElement>(null);
  const hintKey = hints?.map((h) => h.text).join('|') ?? '';
  const fitKey = `${card.name}|${width}x${height}|${resources ?? ''}|${status ?? ''}|${facts.length}|${hintKey}`;
  const rules = useRef<HTMLDivElement>(null);
  const factEls = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current, a = art.current, r = rules.current, f = factEls.current;
    if (!el || !a || !r) return;
    const rows = f ? Array.from(f.children) as HTMLElement[] : [];
    const apply = (fs: number, hide: number) => {
      r.style.fontSize = `${fs}px`;
      rows.forEach((row, i) => { row.style.display = i < hide ? 'none' : 'contents'; });
      if (f) f.style.display = hide >= rows.length ? 'none' : 'grid';
    };
    // A card fitted before at this size takes its result straight away: no measuring, one layout.
    const hit = FIT_CACHE.get(fitKey);
    if (hit) { apply(hit.fs, hit.hide); return; }
    const inner = width * 0.948;
    const artPref = Math.round(inner * 0.6), artMin = Math.round(inner * 0.34);
    const fits = (fs: number, hide: number, minArt: number) => {
      apply(fs, hide);
      return el.scrollHeight <= el.clientHeight + 1 && a.getBoundingClientRect().height >= minArt - 0.5;
    };
    const fit = (): {fs: number; hide: number} => {
      // largest rules size with the art at a 3:2-ish window; then the art gives way; then the facts, least
      // useful first, before the rules drop under 17 px
      for (let fs = 24; fs >= 17; fs--) if (fits(fs, 0, artPref)) return {fs, hide: 0};
      for (let hide = 0; hide <= rows.length; hide++) if (fits(17, hide, artMin)) return {fs: 17, hide};
      for (let fs = 16; fs >= 14; fs--) for (let hide = 0; hide <= rows.length; hide++) if (fits(fs, hide, artMin)) return {fs, hide};
      apply(13, rows.length);
      return {fs: 13, hide: rows.length};
    };
    const res = fit();
    // Only a fit measured in the card font is kept; one measured in the fallback font is redone once it loads.
    if (typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded') { FIT_CACHE.set(fitKey, res); return; }
    let live = true;
    void document.fonts.ready.then(() => {
      if (!live) return;
      const again = fit();
      FIT_CACHE.set(fitKey, again);
    });
    return () => { live = false; };
  }, [fitKey, width]);
  return (
    <motion.article ref={ref} layoutId={layoutId} className="tm-card" aria-label={card.name} data-lifted-card={card.name}
      style={{position: 'relative', containerType: 'inline-size', width, height, borderRadius: '5.5cqw', padding: '2.6cqw',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: 'linear-gradient(165deg, #3B2B26 0%, #251713 55%, #1B100D 100%)',
        boxShadow: `inset 0 0 0 0.55cqw color-mix(in oklab, ${TYPE_COLOR[card.type] ?? '#555'} 75%, #000), inset 0 0.8cqw 1.4cqw rgba(255,255,255,.07)${IS_IOS ? '' : ', 0 2.6cqw 7cqw rgba(0,0,0,.5)'}`,
        ...style}}>
      <div ref={art} data-lifted-art style={{position: 'relative', flex: '1 1 0', minHeight: 0, borderRadius: '3.4cqw', overflow: 'hidden',
        boxShadow: 'inset 0 0 0 0.35cqw rgba(0,0,0,.35)'}}>
        <Art card={card} />
        <div style={{position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,.28) 0%, transparent 32%, transparent 62%, rgba(0,0,0,.45) 100%)'}} />
        {card.cost !== null && card.group === 'project' && <CostChip cost={cost ?? card.cost} base={card.cost} />}
        {isCorp && card.startingMegaCredits !== null && <CostChip cost={card.startingMegaCredits} base={card.startingMegaCredits} label="M€" />}
        <div style={{position: 'absolute', top: '2.4cqw', right: '2.4cqw', display: 'flex', gap: '1cqw'}}>
          {card.tags.map((t, i) => <span key={i} className="tm-fill" style={{width: '8.6cqw', height: '8.6cqw', filter: TAG_SHADOW}}><TagIcon tag={t} /></span>)}
        </div>
        {req.length > 0 && (
          <div style={{position: 'absolute', left: '2.4cqw', bottom: '2.4cqw', display: 'flex', gap: '1.2cqw', alignItems: 'center', padding: '0.9cqw 2.2cqw',
            borderRadius: '2cqw', background: 'rgba(242,194,48,.92)', color: '#2A1A04', fontWeight: 750, fontSize: '3.6cqw', fontVariationSettings: "'wdth' 82",
            boxShadow: '0 0.8cqw 1.6cqw rgba(0,0,0,.4)'}}>
            {req}
          </div>
        )}
        {card.victoryPoints !== null && <VpBadge vp={card.victoryPoints} card={card} />}
      </div>

      <div style={{position: 'relative', flex: 'none', margin: '2cqw -0.2cqw 0', padding: '1.9cqw 3cqw', borderRadius: '2.4cqw', background: bandFill(card.type),
        boxShadow: 'inset 0 0.4cqw 0 rgba(255,255,255,.22), inset 0 -0.5cqw 0 rgba(0,0,0,.22), 0 0.8cqw 1.8cqw rgba(0,0,0,.35)'}}>
        <div style={{fontWeight: 780, fontSize: card.name.length > 24 ? '5.2cqw' : '6.2cqw', lineHeight: 1.05, fontVariationSettings: "'wdth' 74",
          textShadow: '0 0.3cqw 0.6cqw rgba(0,0,0,.45)', color: '#FFF8EE', letterSpacing: '0.01em'}}>{card.name}</div>
      </div>

      {/* font size set by the fit above (17 to 24 px), never by React, so a re-render does not undo it */}
      <div ref={rules} data-lifted-rules style={{flex: 'none', display: 'flex', flexDirection: 'column', gap: '0.45em', padding: '0.55em 0.8cqw 0', lineHeight: 1.3, color: 'var(--ice)'}}>
        {box.map((b, i) => (
          <p key={i} style={{margin: 0, padding: '0.35em 0.55em', borderRadius: '2cqw', background: 'rgba(255,255,255,.065)',
            boxShadow: `inset 0.7cqw 0 0 ${TYPE_COLOR[card.type] ?? '#666'}`}}>
            <strong style={{fontWeight: 720}}>{b.split(':')[0]}:</strong>{b.slice(b.indexOf(':') + 1)}
          </p>
        ))}
        {text && <p style={{margin: 0, color: 'rgba(234,242,244,.88)'}}>{text}</p>}
      </div>

      {hints && hints.length > 0 && <CardHintLines hints={hints} style={{marginTop: 9, padding: '0 0.8cqw'}} />}

      {facts.length > 0 && (
        <div ref={factEls} data-lifted-facts style={{flex: 'none', display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 10, rowGap: 3, marginTop: 10,
          padding: '8px 10px', borderRadius: '2.4cqw', background: 'rgba(0,0,0,.22)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06)', fontSize: 13.5, lineHeight: 1.3}}>
          {facts.map((x) => (
            <div key={x.k} data-fact={x.k} style={{display: 'contents'}}>
              <span style={{color: 'var(--ice-faint)', whiteSpace: 'nowrap'}}>{x.label}</span>
              <span style={{color: 'var(--ice-dim)', minWidth: 0}}>{x.value}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{flex: 'none', paddingTop: '1.4cqw', fontSize: '3cqw', color: 'var(--ice-faint)'}}>
        <span className="num" style={{fontWeight: 600, letterSpacing: '0.04em'}}>{card.number ? `#${card.number}` : ''}</span>
      </div>
      <div className="tm-sheen" aria-hidden="true" />
    </motion.article>
  );
}

const HINT_DOT: Record<CardHint['tone'], string> = {met: '#7FD1B9', unmet: '#E8A33D', info: 'var(--ice-faint)'};

/** Counts from the live game, quiet: one short line each, a dot for met (green) or not yet (amber). */
export function CardHintLines({hints, style}: {hints: CardHint[]; style?: CSSProperties}) {
  return (
    <div data-card-hints style={{flex: 'none', display: 'grid', rowGap: 3, fontSize: 13.5, lineHeight: 1.3, color: 'var(--ice-dim)', ...style}}>
      {hints.map((h) => (
        <div key={h.key} data-hint={h.key} data-tone={h.tone} style={{display: 'flex', gap: 7, alignItems: 'baseline'}}>
          <span aria-hidden="true" style={{flex: 'none', width: 6, height: 6, borderRadius: 3, background: HINT_DOT[h.tone], transform: 'translateY(-1px)'}} />
          <span style={{minWidth: 0}}>{h.text}</span>
        </div>
      ))}
    </div>
  );
}

function CostChip({cost, base, label}: {cost: number; base: number; label?: string}) {
  return (
    <div className="num" style={{position: 'absolute', top: '2.2cqw', left: '2.2cqw', minWidth: '12.5cqw', height: '12.5cqw', padding: '0 2cqw', borderRadius: '2.8cqw',
      display: 'grid', placeItems: 'center', fontSize: label ? '6.2cqw' : '8.4cqw', color: '#2A1A04',
      background: 'linear-gradient(160deg, #FFE27A, #F2C230 45%, #C9961A)', boxShadow: 'inset 0 0.5cqw 0 rgba(255,255,255,.55), inset 0 -0.6cqw 0 rgba(0,0,0,.2), 0 1cqw 2cqw rgba(0,0,0,.45)'}}>
      <span>{cost}{label && <span style={{fontSize: '0.6em', marginLeft: '0.6cqw'}}>{label}</span>}</span>
      {cost !== base && !label && <s style={{position: 'absolute', right: '-1.4cqw', top: '-2.4cqw', fontSize: '3.6cqw', padding: '0 1.2cqw', borderRadius: '1.6cqw', background: '#2A1A04', color: 'var(--mc)'}}>{base}</s>}
    </div>
  );
}

function VpBadge({vp, card}: {vp: VictoryPoints; card: CardDef}) {
  const neg = typeof vp === 'number' && vp < 0;
  let main: ReactNode = typeof vp === 'number' ? vp : vp === 'special' ? '★' : null;
  let sub: ReactNode = null;
  if (typeof vp === 'object' && vp) {
    if (vp.resourcesHere) { main = vp.each ? vp.each : 1; sub = <>/{vp.per && vp.per > 1 ? vp.per : ''} {shortRes(card.resourceType)}</>; }
    else if (vp.tag) { main = 1; sub = <>/{vp.per && vp.per > 1 ? vp.per : ''}<span className="tm-fill" style={{display: 'inline-block', width: '4.2cqw', height: '4.2cqw', verticalAlign: '-0.8cqw'}}><TagIcon tag={vp.tag} /></span></>; }
    else if (vp.cities) { main = 1; sub = <>/{vp.per && vp.per > 1 ? vp.per : ''} cit{vp.per && vp.per > 1 ? 'ies' : 'y'}</>; }
    else if (vp.oceans) { main = 1; sub = <>/ocean</>; }
    else main = '★';
  }
  return (
    <div style={{position: 'absolute', right: '2.2cqw', bottom: '2.2cqw', display: 'flex', alignItems: 'baseline', gap: '0.6cqw', padding: '1cqw 2.4cqw',
      borderRadius: '50% / 42%', background: neg ? 'linear-gradient(160deg, #8C2F22, #5A1A12)' : 'linear-gradient(160deg, #C7743C, #8A4420)',
      color: '#FFF1E0', boxShadow: 'inset 0 0.5cqw 0 rgba(255,255,255,.3), 0 1cqw 2cqw rgba(0,0,0,.45)'}}>
      <span className="num" style={{fontSize: '7cqw'}}>{main}</span>
      {sub && <span style={{fontSize: '3.4cqw', fontWeight: 700, fontVariationSettings: "'wdth' 80"}}>{sub}</span>}
    </div>
  );
}

function ResourcePill({n, type}: {n: number; type: string | null}) {
  return (
    <motion.span key={n} initial={{scale: 1.5}} animate={{scale: 1}} transition={{type: 'spring', stiffness: 500, damping: 18}}
      style={{display: 'inline-flex', alignItems: 'center', gap: '1.2cqw', padding: '0.6cqw 2.4cqw', borderRadius: 999, background: 'var(--ice)', color: 'var(--dusk-1)',
        fontWeight: 700, fontSize: '3.5cqw'}}>
      <span className="num" style={{fontSize: '4.6cqw'}}>{n}</span>{shortRes(type)}
    </motion.span>
  );
}

function shortRes(t: string | null | undefined): string {
  return t ? t.toLowerCase() : '';
}

// ---- requirement labels ----------------------------------------------------------------------
function reqLabel(r: Requirement, i: number): ReactNode {
  const pre = r.max ? 'max ' : '';
  if (r.temperature !== undefined) return <span key={i}>{pre}{fmtSigned(r.temperature)}°C</span>;
  if (r.oxygen !== undefined) return <span key={i}>{pre}{r.oxygen}% O₂</span>;
  if (r.oceans !== undefined) return <span key={i}>{pre}{r.oceans} ocean{r.oceans === 1 ? '' : 's'}</span>;
  if (r.venus !== undefined) return <span key={i}>{pre}{r.venus}% Venus</span>;
  if (r.tag) {
    return (
      <span key={i} style={{display: 'inline-flex', alignItems: 'center', gap: '0.22em'}}>
        {(r.count ?? 1) > 1 && (r.count ?? 1)}
        {/* em, not cqw: the chip sizes to its content, so it cannot be a size container */}
        <span className="tm-fill" style={{width: '1.28em', height: '1.28em', display: 'inline-block'}}><TagIcon tag={r.tag} /></span>
      </span>
    );
  }
  if (r.production) return <span key={i}>{r.production} prod</span>;
  if (r.greeneries !== undefined) return <span key={i}>{r.greeneries} greenery</span>;
  if (r.cities !== undefined) return <span key={i}>{r.cities} cit{r.cities === 1 ? 'y' : 'ies'}</span>;
  if (r.tr !== undefined) return <span key={i}>TR {r.tr}</span>;
  return null;
}
const fmtSigned = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

// ---- art -------------------------------------------------------------------------------------
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The card's illustration, or a generated plate: its type colour, a horizon, and its tag glyphs. */
export function Art({card, x}: {card: CardDef; x?: MotionValue<number>}) {
  const url = useArt(card.number);
  // The image is shown only once it is decoded (decodeArt), so it paints whole in its first frame. Art decoded
  // before this card mounted (a lifted card, a swiped-in neighbour) shows at once, with no plate and no fade.
  const [shown, setShown] = useState<string | null>(() => (isDecoded(url) ? url : null));
  const late = useRef(false);
  useEffect(() => {
    if (!url) return;
    if (isDecoded(url)) { setShown(url); return; }
    let live = true;
    late.current = true;
    void decodeArt(url).then(() => { if (live && isDecoded(url)) setShown(url); });
    return () => { live = false; };
  }, [url]);
  const ready = !!url && shown === url;
  const plate = useMemo(() => {
    const h = hashStr(card.name);
    const band = TYPE_COLOR[card.type] ?? '#6B4A3A';
    const tags = card.tags.length ? card.tags : [card.type === 'event' ? 'event' : 'building'];
    const marks = Array.from({length: 7}, (_, i) => {
      const r = (h >>> (i * 4)) & 0xff;
      return {tag: tags[i % tags.length], left: (i * 17 + (r % 23)) % 96, top: ((r * 7 + i * 29) % 70) + 4, size: 14 + (r % 12), rot: (r % 60) - 30};
    });
    const sky = `linear-gradient(170deg, color-mix(in oklab, ${band} 55%, #120806) 0%, color-mix(in oklab, ${band} 22%, #24130F) 58%, #3A1C12 100%)`;
    return {marks, sky, curve: 30 + (h % 25)};
  }, [card]);
  // Art that arrives after the card is on screen fades in, except on iPhones: an opacity animation on a clipped,
  // rounded image promotes it to its own layer and drops it again at full opacity, which WebKit re-rasterises.
  const fade = late.current && !IS_IOS;
  return (
    <div style={{position: 'absolute', inset: 0, overflow: 'hidden', background: plate.sky}}>
      {!ready && (
        <div style={{position: 'absolute', inset: 0}}>
          <div style={{position: 'absolute', left: '-20%', right: '-20%', top: `${plate.curve + 30}%`, height: '120%', borderRadius: '50%',
            background: 'radial-gradient(120% 60% at 50% 0%, rgba(240,120,70,.35), rgba(60,20,10,.6) 40%, rgba(20,8,5,.9))', boxShadow: '0 -1cqw 4cqw rgba(255,140,90,.25)'}} />
          {plate.marks.map((m, i) => (
            <span key={i} className="tm-fill" style={{position: 'absolute', left: `${m.left}%`, top: `${m.top}%`, width: `${m.size}cqw`, height: `${m.size}cqw`,
              transform: `rotate(${m.rot}deg)`, opacity: 0.13, filter: IS_IOS ? undefined : 'grayscale(.3)'}}><TagIcon tag={m.tag} /></span>
          ))}
        </div>
      )}
      {ready && (
        <motion.img src={url!} alt="" decoding="sync" draggable={false}
          initial={fade ? {opacity: 0} : false} animate={fade ? {opacity: 1} : undefined} transition={{duration: 0.35}}
          style={{position: 'absolute', inset: '-4%', width: '108%', height: '108%', objectFit: 'cover', x}} />
      )}
    </div>
  );
}

// ---- thumb & row -----------------------------------------------------------------------------
function ThumbCard({card, cost, layoutId, style}: Props) {
  return (
    <motion.article layoutId={layoutId} className="tm-card" aria-label={card.name}
      style={{position: 'relative', containerType: 'inline-size', borderRadius: '7cqw', padding: '3cqw', overflow: 'hidden',
        background: 'linear-gradient(165deg, #3B2B26, #1B100D)',
        boxShadow: `inset 0 0 0 0.8cqw color-mix(in oklab, ${TYPE_COLOR[card.type] ?? '#555'} 75%, #000), 0 2cqw 5cqw rgba(0,0,0,.45)`, ...style}}>
      <div style={{position: 'relative', aspectRatio: '3 / 2', borderRadius: '4.5cqw', overflow: 'hidden'}}>
        <Art card={card} />
        {card.cost !== null && card.group === 'project' && (
          <div className="num" style={{position: 'absolute', top: '3cqw', left: '3cqw', padding: '0.5cqw 3cqw', borderRadius: '3cqw', fontSize: '10cqw', color: '#2A1A04',
            background: 'linear-gradient(160deg, #FFE27A, #F2C230 45%, #C9961A)'}}>{cost ?? card.cost}</div>
        )}
        <div style={{position: 'absolute', top: '3cqw', right: '3cqw', display: 'flex', gap: '1cqw'}}>
          {card.tags.slice(0, 3).map((t, i) => <span key={i} className="tm-fill" style={{width: '12cqw', height: '12cqw'}}><TagIcon tag={t} /></span>)}
        </div>
      </div>
      <div style={{marginTop: '2.5cqw', padding: '2.5cqw 4cqw', borderRadius: '3.5cqw', background: bandFill(card.type),
        fontWeight: 760, fontSize: '8.4cqw', lineHeight: 1.08, fontVariationSettings: "'wdth' 72", color: '#FFF8EE', minHeight: '2.16em',
        display: 'flex', alignItems: 'center'}}>{card.name}</div>
      <div className="tm-sheen" aria-hidden="true" />
    </motion.article>
  );
}

function RowCard({card, cost, layoutId, resources, detail, style}: Props) {
  const req = card.requirements.map(reqLabel).filter(Boolean) as ReactNode[];
  const band = TYPE_COLOR[card.type] ?? '#555';
  return (
    <motion.article layoutId={layoutId} aria-label={card.name}
      style={{position: 'relative', display: 'flex', alignItems: 'stretch', gap: 12, padding: 7, paddingRight: 12, borderRadius: 16, overflow: 'hidden',
        background: 'linear-gradient(100deg, #3A2A26, #241814)', boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${band} 70%, #000), 0 10px 26px rgba(0,0,0,.35)`, ...style}}>
      <div style={{position: 'relative', width: 84, flex: 'none', aspectRatio: '3 / 2', borderRadius: 10, overflow: 'hidden', alignSelf: 'center', containerType: 'inline-size'}}>
        <Art card={card} />
        {card.cost !== null && card.group === 'project' && (
          <div className="num" style={{position: 'absolute', top: 4, left: 4, padding: '1px 6px', borderRadius: 6, fontSize: 17, color: '#2A1A04',
            background: 'linear-gradient(160deg, #FFE27A, #F2C230 45%, #C9961A)', boxShadow: '0 2px 6px rgba(0,0,0,.4)'}}>{cost ?? card.cost}</div>
        )}
        {card.type === 'corporation' && card.startingMegaCredits !== null && (
          <div className="num" style={{position: 'absolute', top: 4, left: 4, padding: '1px 6px', borderRadius: 6, fontSize: 13, color: '#2A1A04',
            background: 'linear-gradient(160deg, #FFE27A, #F2C230 45%, #C9961A)'}}>{card.startingMegaCredits} M€</div>
        )}
      </div>
      <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
          <span style={{width: 4, alignSelf: 'stretch', borderRadius: 2, background: bandFill(card.type), flex: 'none'}} />
          <span style={{flex: 1, minWidth: 0, fontWeight: 740, fontSize: 16.5, lineHeight: 1.12, fontVariationSettings: "'wdth' 78"}}>{card.name}</span>
          {/* the requirement rides with the tags, so the rules line below keeps its full width */}
          {req.length > 0 && <span style={{flex: 'none', padding: '1px 7px', borderRadius: 6, background: 'rgba(242,194,48,.18)', color: 'var(--mc)', fontWeight: 650, display: 'inline-flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap', fontSize: 12}}>{req}</span>}
          <span style={{display: 'flex', gap: 3, flex: 'none'}}>{card.tags.map((t, i) => <TagIcon key={i} tag={t} size={20} />)}</span>
        </div>
        {detail && <div style={{fontSize: 13, lineHeight: 1.3, color: 'var(--ice-dim)'}}>{detail}</div>}
      </div>
      {(resources ?? 0) > 0 && (
        <motion.span key={resources} initial={{scale: 1.6}} animate={{scale: 1}} className="num"
          style={{alignSelf: 'center', minWidth: 28, height: 28, padding: '0 8px', borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--ice)', color: 'var(--dusk-1)', fontSize: 15}}>
          {resources}
        </motion.span>
      )}
    </motion.article>
  );
}

// ---- back ------------------------------------------------------------------------------------
/** The back of a card: dark oxide with an orbit mark, for deals and face-down events. */
export function CardBack({style}: {style?: CSSProperties}) {
  return (
    <div aria-hidden="true" style={{position: 'relative', containerType: 'inline-size', aspectRatio: '63 / 88', borderRadius: '5.5cqw', overflow: 'hidden',
      background: 'radial-gradient(120% 80% at 50% 110%, #7A2E17 0%, #3A160C 45%, #160A07 100%)',
      boxShadow: 'inset 0 0 0 0.55cqw #6B3A22, inset 0 0 0 2.4cqw #1A0C08, inset 0 0 0 2.9cqw rgba(242,194,48,.35), 0 2.6cqw 7cqw rgba(0,0,0,.5)', ...style}}>
      <svg viewBox="0 0 100 140" style={{position: 'absolute', inset: 0, width: '100%', height: '100%'}}>
        <defs><radialGradient id="tmb-p" cx=".38" cy=".35"><stop offset="0" stopColor="#F08A55" /><stop offset=".6" stopColor="#C1502B" /><stop offset="1" stopColor="#4A180C" /></radialGradient></defs>
        <ellipse cx="50" cy="70" rx="40" ry="13" fill="none" stroke="rgba(242,194,48,.45)" strokeWidth=".8" transform="rotate(-18 50 70)" />
        <circle cx="50" cy="70" r="19" fill="url(#tmb-p)" />
        <path d="M38 76c5-2 9 3 22-1" stroke="#2F82C0" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".8" />
        <ellipse cx="50" cy="70" rx="40" ry="13" fill="none" stroke="rgba(242,194,48,.7)" strokeWidth=".8" transform="rotate(-18 50 70)" strokeDasharray="0 63 60" />
      </svg>
      <div className="tm-sheen" aria-hidden="true" />
    </div>
  );
}

// ---- styles (once) ---------------------------------------------------------------------------
function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById('tm-card-css')) return;
  const el = document.createElement('style');
  el.id = 'tm-card-css';
  el.textContent = `
.tm-fill{display:inline-block;line-height:0}
.tm-fill>svg{width:100%;height:100%}
.tm-sheen{position:absolute;inset:0;border-radius:inherit;pointer-events:none;mix-blend-mode:soft-light;opacity:var(--sheen,.55);
  background:
    radial-gradient(circle at calc(var(--sx,.5)*100%) calc(var(--sy,.25)*100%), rgba(255,255,255,.55), rgba(255,255,255,0) 42%),
    linear-gradient(calc(105deg + (var(--sx,.5) - .5)*50deg), rgba(255,255,255,0) 30%, rgba(255,236,200,.28) 46%, rgba(160,210,255,.18) 52%, rgba(255,255,255,0) 66%);
  background-size:100% 100%, 220% 100%;
  background-position:0 0, calc(var(--sx,.5)*100%) 0;}
@media (prefers-reduced-motion: reduce){.tm-sheen{opacity:.3}}
`;
  document.head.appendChild(el);
}
