// A card as one row of a picking list (play a card, sell patents, card actions, buying): the art with its cost
// and tags, the name as the strongest line, then a two-line summary of what the card does with its requirement
// as a chip in front. An info button beside the row opens the full card without picking the row.
import {useState, type ReactNode} from 'react';
import type {CardDef} from '../../../shared/types';
import {Art, bandFill, reqWords, TYPE_COLOR} from '../../ui/CardFace';
import {CardViewer, type ViewerNav} from '../../ui/deck/Viewer';
import {TagIcon} from '../../ui/Icons';
import {reqChips, summaryParts, vpChip} from './cardSummary';

/** Width the info button takes at the right of a row; rows that have one keep this clear. */
export const INFO_W = 42;

const chip = {flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 3, padding: '0 6px', marginRight: 6, borderRadius: 6,
  fontSize: 12, fontWeight: 650, lineHeight: '18px', verticalAlign: 1, whiteSpace: 'nowrap'} as const;

export function CardRow({card, cost, resources, info}: {card: CardDef; cost?: number; resources?: number;
  /** leave room on the right for the info button */
  info?: boolean}) {
  const band = TYPE_COLOR[card.type] ?? '#555';
  const reqs = reqChips(card);
  const reqText = card.requirements.map(reqWords).filter(Boolean).join(', ');
  const vp = vpChip(card);
  const parts = summaryParts(card);
  return (
    <article aria-label={card.name} data-row-type={card.type}
      style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: 7, paddingRight: info ? INFO_W : 12, borderRadius: 16, overflow: 'hidden',
        background: 'linear-gradient(100deg, #3A2A26, #241814)', boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${band} 70%, #000), 0 8px 20px rgba(0,0,0,.3)`}}>
      <div style={{position: 'relative', width: 76, flex: 'none', aspectRatio: '3 / 2', borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start', containerType: 'inline-size'}}>
        <Art card={card} />
        {card.cost !== null && card.group === 'project' && (
          <div className="num" style={{position: 'absolute', top: 3, left: 3, padding: '0 5px', borderRadius: 6, fontSize: 16, color: '#2A1A04',
            background: 'linear-gradient(160deg, #FFE27A, #F2C230 45%, #C9961A)', boxShadow: '0 2px 6px rgba(0,0,0,.4)'}}>{cost ?? card.cost}</div>
        )}
        {card.type === 'corporation' && card.startingMegaCredits !== null && (
          <div className="num" style={{position: 'absolute', top: 3, left: 3, padding: '0 5px', borderRadius: 6, fontSize: 12.5, color: '#2A1A04',
            background: 'linear-gradient(160deg, #FFE27A, #F2C230 45%, #C9961A)'}}>{card.startingMegaCredits} M€</div>
        )}
        {card.tags.length > 0 && (
          <span style={{position: 'absolute', right: 3, bottom: 3, display: 'flex', gap: 2}}>
            {card.tags.map((t, i) => <TagIcon key={i} tag={t} size={17} />)}
          </span>
        )}
      </div>
      <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 7}}>
          <span aria-hidden="true" style={{width: 4, alignSelf: 'stretch', borderRadius: 2, background: bandFill(card.type), flex: 'none'}} />
          <span style={{flex: 1, minWidth: 0, fontWeight: 740, fontSize: 16.5, lineHeight: 1.12, fontVariationSettings: "'wdth' 78",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{card.name}</span>
          {(resources ?? 0) > 0 && (
            <span className="num" style={{flex: 'none', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 11, display: 'grid', placeItems: 'center',
              background: 'var(--ice)', color: 'var(--dusk-1)', fontSize: 13}}>{resources}</span>
          )}
        </div>
        {(reqs.length > 0 || vp || parts.length > 0) && (
          <div data-testid="card-summary" style={{fontSize: 13, lineHeight: '18px', color: 'var(--ice-dim)', display: '-webkit-box', WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2, overflow: 'hidden', overflowWrap: 'anywhere'}}>
            {reqs.length > 0 && (
              <span data-testid="card-req" aria-label={`Requires ${reqText}`} style={{...chip, background: 'rgba(242,194,48,.18)', color: 'var(--mc)'}}>
                {reqs.map((r, i) => r.kind === 'text' ? <span key={i}>{r.text}</span>
                  : <span key={i} style={{display: 'inline-flex', alignItems: 'center', gap: 2}}>{r.max ? 'max ' : ''}{r.count > 1 ? r.count : ''}<TagIcon tag={r.tag} size={13} /></span>)}
              </span>
            )}
            {vp && <span style={{...chip, background: 'rgba(255,255,255,.08)', color: 'var(--ice)'}}>{vp}</span>}
            {parts.map((p, i) => (
              <span key={i}>{i > 0 ? ' ' : ''}{p.lead && <span style={{color: '#8CC8F0', fontWeight: 650}}>{p.lead} </span>}{p.text}</span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/** The small "i" at the right of a row: opens the full card. A sibling of the row's button, so it never picks the row. */
export function InfoButton({name, onOpen, disabled}: {name: string; onOpen: () => void; disabled?: boolean}) {
  return (
    <button type="button" data-card-info={name} aria-label={`Show the full card: ${name}`} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
      style={{position: 'absolute', top: 0, right: 0, bottom: 0, width: INFO_W, display: 'grid', placeItems: 'center', zIndex: 2, borderRadius: '0 16px 16px 0',
        color: 'var(--ice-dim)', touchAction: 'manipulation'}}>
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <circle cx="11" cy="11" r="9.5" fill="rgba(255,255,255,.06)" stroke="currentColor" strokeOpacity=".55" strokeWidth="1.3" />
        <circle cx="11" cy="6.9" r="1.25" fill="currentColor" />
        <path d="M11 10v6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** A row with its info button: the row stays one tap target, the button sits on its right edge. */
export function RowWithInfo({name, onInfo, children}: {name: string; onInfo: () => void; children: ReactNode}) {
  return (
    <div style={{position: 'relative'}}>
      {children}
      <InfoButton name={name} onOpen={onInfo} />
    </div>
  );
}

type PeekCard = {name: string; def: CardDef; cost?: number; resources?: number};

/** The full card for a row, in the same lifted viewer as the hand, with the list's other cards a swipe away. */
export function useCardPeek(cards: PeekCard[]): {peek: (name: string) => void; viewer: ReactNode} {
  const [open, setOpen] = useState<string | null>(null);
  const i = open ? cards.findIndex((c) => c.name === open) : -1;
  const cur = i >= 0 ? cards[i] : null;
  const at = (d: number) => cards[i + d] ?? null;
  const nav: ViewerNav | undefined = cur && cards.length > 1 ? {
    index: i, count: cards.length,
    go: (d) => { const n = at(d); if (n) setOpen(n.name); },
    peek: (d) => { const n = at(d); return n ? {card: n.def, cost: n.cost, resources: n.resources} : null; },
  } : undefined;
  const viewer = (
    <CardViewer card={cur?.def ?? null} cost={cur?.cost} resources={cur?.resources} onClose={() => setOpen(null)} nav={nav} backLabel="Back to the list" />
  );
  return {peek: setOpen, viewer};
}
