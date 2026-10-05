// The Table tab's top row (whose table, and their tags) and another player's table, read-only: their corporation, preludes and cards in
// play (events face down), tags, stock and production, TR and cards in hand. Nothing here can act for them.
import {AnimatePresence, motion} from 'motion/react';
import {memo, useEffect, useState} from 'react';
import type {CardModel, Color, PublicPlayerModel} from '../../../shared/full';
import {Avatar} from '../../ui/Avatar';
import {BotMark, BotMarkFor, useIsBotColor} from '../../ui/BotMark';
import {PLAYER_HEX, RES_COLOR, RES_LABEL, ResIcon, TagIcon} from '../../ui/Icons';
import {useNet} from '../../net';
import {CardViewer, type ViewerNav} from '../../ui/deck/Viewer';
import {Piles, type Pile} from '../../ui/deck/Piles';
import type {DeckItem} from '../../ui/deck/Deck';
import {cardDef, groupTableau, prod, RES, stock} from './model';
import {chipName, otherActionNote, tableSignature, tableTitle} from './tableFocus';
import {useDisplayName} from '../../names';

/** The profile portrait of the seat playing this engine colour, if it has one. */
function useSeatAvatar(color: Color): string | null {
  return useNet((s) => {
    const st = s.state;
    if (!st?.full) return null;
    const id = Object.keys(st.full.players).find((k) => st.full!.players[k].color === color);
    const profileId = st.players.find((p) => p.id === id)?.profileId;
    return s.profiles.find((x) => x.id === profileId)?.avatar ?? null;
  });
}

/** The seat picker: one small chip naming whose table is shown, which opens a menu of every seat. */
function Picker({me, others, focus, onPick}: {me: PublicPlayerModel; others: PublicPlayerModel[]; focus: Color | null; onPick: (c: Color | null) => void}) {
  const [open, setOpen] = useState(false);
  const cur = (focus && others.find((p) => p.color === focus)) || me;
  const mine = cur === me;
  const avatar = useSeatAvatar(cur.color);
  const nameFor = useDisplayName();
  const curName = nameFor(cur.color, cur.name);
  const bot = useIsBotColor(cur.color);
  // the menu never outlives the table it was opened on (a tab change or my turn sends the table back to me)
  useEffect(() => { setOpen(false); }, [focus]);
  const hex = PLAYER_HEX[cur.color];
  return (
    <div data-testid="table-selector" style={{position: 'relative', flex: 'none'}}>
      <button type="button" data-testid="table-picker" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={mine ? 'Your table. Show another player\'s table' : `${tableTitle(curName)}. Show another table`}
        style={{display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 9px 0 4px', borderRadius: 999,
          fontSize: 13.5, fontWeight: 650, fontVariationSettings: "'wdth' 86", color: 'var(--ice)',
          background: mine ? 'rgba(255,255,255,.06)' : `color-mix(in oklab, ${hex} 26%, var(--dusk-2))`,
          boxShadow: mine ? 'inset 0 0 0 1px var(--rim)' : `inset 0 0 0 1.5px ${hex}`}}>
        <Avatar name={curName} color={cur.color} avatar={avatar} size={24} ring={false} />
        {mine ? 'You' : chipName(curName)}
        {bot && <BotMark style={{marginLeft: 0}} />}
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" style={{opacity: 0.7, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s'}}>
          <path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div aria-hidden="true" onClick={() => setOpen(false)} style={{position: 'fixed', inset: 0, zIndex: 29}} />}
      <AnimatePresence>
        {open && (
          <motion.div role="menu" aria-label="Whose table" initial={{opacity: 0, y: -6, scale: 0.96}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, y: -6, scale: 0.96}}
            transition={{duration: 0.16}}
            style={{position: 'absolute', top: 38, left: 0, zIndex: 30, minWidth: 220, padding: 6, borderRadius: 14, background: 'var(--dusk-2)', transformOrigin: '20% 0',
              boxShadow: '0 0 0 1px var(--rim-strong), 0 18px 40px rgba(0,0,0,.55)'}}>
            <Seat p={me} label="You" on={mine} onPick={() => onPick(null)} />
            {others.map((p) => <Seat key={p.color} p={p} label={nameFor(p.color, p.name)} on={cur.color === p.color} onPick={() => onPick(p.color)} />)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Seat({p, label, on, onPick}: {p: PublicPlayerModel; label: string; on: boolean; onPick: () => void}) {
  const avatar = useSeatAvatar(p.color);
  const bot = useIsBotColor(p.color);
  const name = useDisplayName()(p.color, p.name);
  return (
    <button type="button" role="menuitemradio" aria-checked={on} data-table-seat={p.color} onClick={onPick}
      aria-label={label === 'You' ? 'Your table' : tableTitle(name)}
      style={{display: 'flex', alignItems: 'center', gap: 10, width: '100%', minHeight: 44, padding: '0 10px 0 6px', borderRadius: 10, fontSize: 15,
        fontWeight: on ? 700 : 550, background: on ? `color-mix(in oklab, ${PLAYER_HEX[p.color]} 22%, transparent)` : 'transparent', textAlign: 'left'}}>
      <Avatar name={name} color={p.color} avatar={avatar} size={28} ring={false} />
      <span style={{flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{label}{bot && <BotMark />}</span>
      <span className="num faint" style={{fontSize: 13}}>TR {p.terraformRating}</span>
    </button>
  );
}

/** Tags as one quiet strip: icon and count, scrolling sideways when they do not fit. */
function TagStrip({tags, label}: {tags: Array<[string, number]>; label: string}) {
  if (!tags.length) return <div style={{flex: 1}} />;
  return (
    <div role="list" aria-label={label} data-testid="tag-strip"
      style={{flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 11, height: 32, overflowX: 'auto', scrollbarWidth: 'none', padding: '0 18px 0 2px',
        maskImage: 'linear-gradient(90deg, #000 calc(100% - 20px), transparent)', WebkitMaskImage: 'linear-gradient(90deg, #000 calc(100% - 20px), transparent)'}}>
      {tags.map(([t, n]) => (
        <span key={t} role="listitem" aria-label={`${n} ${t}`} style={{flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4}}>
          <TagIcon tag={t} size={20} /><span className="num" style={{fontSize: 14}}>{n}</span>
        </span>
      ))}
    </div>
  );
}

/** The one row between the tabs and the collections: whose table (when others sit at the table) and their tags. */
export function TableBar({me, others, focus, onPick, tags}: {me: PublicPlayerModel; others: PublicPlayerModel[]; focus: Color | null; onPick: (c: Color | null) => void;
  tags: Array<[string, number]>}) {
  const who = focus ? others.find((p) => p.color === focus) : undefined;
  return (
    <div data-testid="table-bar" style={{display: 'flex', alignItems: 'center', gap: 10, margin: '6px -16px 6px 0'}}>
      {others.length > 0 && <Picker me={me} others={others} focus={who ? focus : null} onPick={onPick} />}
      <TagStrip tags={tags} label={who ? `${who.name}'s tags` : 'Your tags'} />
    </div>
  );
}

const hasAction = (c: CardModel) => cardDef(c.name).text.some((t) => /^Action:/i.test(t));

function OtherTableView({p, passed}: {p: PublicPlayerModel; passed: boolean}) {
  const name = useDisplayName()(p.color, p.name);
  const g = groupTableau(p.tableau);
  const used = new Set(p.actionsThisGeneration ?? []);
  const [lifted, setLifted] = useState<{pile: string; card: CardModel} | null>(null);
  const item = (c: CardModel): DeckItem => {
    const action = hasAction(c);
    const u = used.has(c.name);
    return {key: c.name, card: cardDef(c.name), resources: c.resources, dim: action && u,
      note: action ? (u ? <span className="faint">{otherActionNote(true)}</span> : <span style={{color: '#6FB8E8', fontWeight: 650}}>{otherActionNote(false)}</span>) : undefined};
  };
  // No action status on the lifted card ("Ready to use" reads as mine); the note says whose it is. No "ready" counts on the collection chips: their line says "lift a card to use it", which is never true here
  const piles: Pile[] = [
    {key: 'corp', label: 'Corporation', items: g.corporation.map(item)},
    {key: 'prelude', label: 'Preludes', items: g.prelude.map(item)},
    {key: 'active', label: 'Active', items: g.active.map(item)},
    {key: 'automated', label: 'Automated', items: [...g.automated, ...g.other].map(item)},
    {key: 'events', label: 'Events', items: g.event.map(item), faceDown: true},
  ];
  const all = [...g.corporation, ...g.prelude, ...g.active, ...g.automated, ...g.other, ...g.event];
  const pileKeys = lifted ? piles.find((x) => x.key === lifted.pile)?.items.map((i) => i.key) ?? [] : [];
  const nav: ViewerNav | undefined = lifted && pileKeys.length > 1 ? {index: pileKeys.indexOf(lifted.card.name), count: pileKeys.length, go: (d) => {
    const c = all.find((x) => x.name === pileKeys[pileKeys.indexOf(lifted.card.name) + d]);
    if (c) setLifted({pile: lifted.pile, card: c});
  }, peek: (d) => {
    const c = all.find((x) => x.name === pileKeys[pileKeys.indexOf(lifted.card.name) + d]);
    return c ? {card: cardDef(c.name), resources: c.resources} : null;
  }} : undefined;
  const hex = PLAYER_HEX[p.color];
  return (
    <div data-testid="other-table" data-color={p.color}>
      <div style={{display: 'flex', alignItems: 'center', gap: 10, margin: '2px 2px 8px'}}>
        <span aria-hidden="true" style={{width: 12, height: 12, borderRadius: 3, background: hex, flex: 'none'}} />
        <div style={{flex: 1, minWidth: 0}}>
          <h3 data-testid="other-table-title" style={{margin: 0, fontWeight: 750, fontSize: 18, fontVariationSettings: "'wdth' 86", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
            {tableTitle(name)}<BotMarkFor color={p.color} />
          </h3>
          <div className="faint" style={{fontSize: 13}}>
            {p.cardsInHandNbr} {p.cardsInHandNbr === 1 ? 'card' : 'cards'} in hand
            {p.isActive && <span style={{color: 'var(--mc)'}}> · playing</span>}{passed && <span> · passed</span>}
          </div>
        </div>
        <div aria-label={`Terraform rating ${p.terraformRating}`} style={{position: 'relative', width: 46, height: 46, flex: 'none', display: 'grid', placeItems: 'center'}}>
          <svg viewBox="0 0 70 70" width="46" height="46" style={{position: 'absolute', inset: 0}}><path d="M35 4 62 19.5v31L35 66 8 50.5v-31z" fill="rgba(111,184,232,.14)" stroke="var(--tr)" strokeWidth="2.4" /></svg>
          <span style={{position: 'relative', textAlign: 'center'}}>
            <span className="num" style={{fontSize: 17}}>{p.terraformRating}</span>
            <div className="cond" style={{fontSize: 9, color: 'var(--tr)', marginTop: -2}}>TR</div>
          </span>
        </div>
      </div>
      {/* one quiet row: stock large, production beside the icon (not the big tiles of my own header) */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 5, marginBottom: 10}}>
        {RES.map((r) => {
          const n = prod(p, r);
          return (
            <div key={r} data-other-res={r} aria-label={`${RES_LABEL[r]} ${stock(p, r)}, production ${n}`}
              style={{borderRadius: 10, padding: '5px 0 4px', textAlign: 'center',
                background: `color-mix(in oklab, ${RES_COLOR[r]} 10%, var(--dusk-1))`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${RES_COLOR[r]} 24%, transparent)`}}>
              <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3}}>
                <ResIcon r={r} size={13} />
                <span className="num" style={{fontSize: 11.5, color: RES_COLOR[r]}}>{n > 0 ? '+' : n < 0 ? '−' : ''}{Math.abs(n)}</span>
              </div>
              <div className="num" style={{fontSize: 19, marginTop: 1}}>{stock(p, r)}</div>
            </div>
          );
        })}
      </div>
      {p.tableau.length
        ? <Piles piles={piles} openKey={lifted?.card.name ?? null}
            onOpen={(pile, k) => { const c = all.find((x) => x.name === k); if (c) setLifted({pile, card: c}); }} />
        : <p className="muted" style={{margin: '8px 2px'}}>No cards on this table yet.</p>}
      <CardViewer card={lifted ? cardDef(lifted.card.name) : null} resources={lifted?.card.resources}
        layoutId={lifted ? `pile-${lifted.pile}-${lifted.card.name}` : undefined} onClose={() => setLifted(null)} nav={nav}
        note={lifted ? `This card is on ${tableTitle(p.name)}.${hasAction(lifted.card) ? (used.has(lifted.card.name) ? ' Its action is used for this generation.' : ' Its action is ready.') : ''}` : undefined} />
    </div>
  );
}

/** Another player's table. Re-renders only when something it shows changed, never on unrelated game updates. */
export const OtherTable = memo(OtherTableView, (a, b) => a.passed === b.passed && tableSignature(a.p) === tableSignature(b.p));
