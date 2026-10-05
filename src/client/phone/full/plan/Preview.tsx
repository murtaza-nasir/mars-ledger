// The effect preview ("−23 M€ · +1 heat production · places an ocean · +1 TR") and the projected numbers after a move.
// Shown only on this phone; nothing here is sent to the table.
import {useMemo} from 'react';
import type {GameState} from '../../../../shared/game';
import type {PreviewLine, Projection, Range, Snapshot, World} from '../../../../shared/projection';
import type {Resource} from '../../../../shared/types';
import {withVp} from '../../../../shared/vp';
import {RES_COLOR, RES_LABEL, ResIcon} from '../../../ui/Icons';
import {usePrefsContext} from '../../../ui/PhonePrefs';

const TONE: Record<string, string> = {cost: '#FFC9A8', loss: '#FFB39E', gain: '#9FE3AE', info: 'var(--ice)', unknown: 'var(--ice-dim)'};

/** The projection with VP added when this player turned "Show VP changes" on (and the caller gave the world it came from). */
export function useVpProjection(p: Projection | null, world: World | null | undefined, opts: {space?: string; base?: GameState} = {}): Projection | null {
  const {showVp} = usePrefsContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (showVp && p && world ? withVp(world, p, opts) : p), [showVp, p, world, opts.space, opts.base]);
}

/** The preview of a hovered space's VP: a line a player can read at a glance. */
export function VpLines({lines, testId = 'space-vp'}: {lines: PreviewLine[]; testId?: string}) {
  return (
    <div data-testid={testId} style={{margin: '8px 2px 0', fontSize: 14.5, fontWeight: 600, lineHeight: 1.4}}>
      <span className="faint" style={{fontWeight: 400}}>VP </span>
      {lines.map((l, i) => <span key={i}>{i > 0 && <span className="faint" style={{fontWeight: 400}}> · </span>}<span style={{color: TONE[l.tone]}}>{l.text}</span></span>)}
    </div>
  );
}

/**
 * One line of what a move does, then what is not known yet. With `world`, and "Show VP changes" on, the VP the move
 * changes is added (`space`: the space picked for its first tile; `base`: the state the move is made from).
 */
export function EffectPreview({p: given, world, space, base, label = 'What this does', compact, testId = 'effect-preview'}:
  {p: Projection | null; world?: World | null; space?: string; base?: GameState; label?: string; compact?: boolean; testId?: string}) {
  const p = useVpProjection(given, world, {space, base});
  if (!p) return null;
  if (!p.ok) {
    return (
      <div data-testid={testId} data-ok="false" style={{margin: compact ? '4px 0 0' : '0 0 12px', fontSize: 14, color: 'var(--ice-dim)'}}>
        {!compact && <span className="cond faint" style={{display: 'block', fontSize: 12.5, marginBottom: 2}}>{label}</span>}
        {p.reason}
      </div>
    );
  }
  return (
    <div data-testid={testId} data-ok="true" style={{margin: compact ? '4px 0 0' : '0 0 12px'}}>
      {!compact && <span className="cond faint" style={{display: 'block', fontSize: 12.5, marginBottom: 3}}>{label}</span>}
      <div data-testid={`${testId}-line`} style={{fontSize: compact ? 13.5 : 15, lineHeight: 1.4, fontWeight: 600}}>
        {p.lines.length ? p.lines.map((l, i) => (
          <span key={i}>{i > 0 && <span className="faint" style={{fontWeight: 400}}> · </span>}<span style={{color: TONE[l.tone]}}>{l.text}</span></span>
        )) : <span className="muted">No change to your numbers</span>}
      </div>
      {p.unknowns.length > 0 && (
        <ul data-testid={`${testId}-unknowns`} style={{listStyle: 'none', margin: '5px 0 0', padding: 0, display: 'grid', gap: 2}}>
          {p.unknowns.map((u) => (
            <li key={u.key} style={{display: 'flex', gap: 6, fontSize: 13, color: 'var(--ice-dim)', lineHeight: 1.35}}>
              <span aria-hidden="true" style={{flex: 'none', width: 15, height: 15, marginTop: 2, borderRadius: 8, display: 'grid', placeItems: 'center', fontSize: 10.5, fontWeight: 800,
                boxShadow: 'inset 0 0 0 1.2px var(--ice-faint)', color: 'var(--ice-dim)'}}>?</span>
              <span>{u.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

/** "12", "12 or more", "10 to 12". */
export function rangeText(r: Range): string {
  const n = (x: number) => (x < 0 ? `\u2212${-x}` : `${x}`);
  if (r.lo === -Infinity) return '?';
  if (r.lo === r.hi) return n(r.lo);
  if (r.hi === Infinity) return `${n(r.lo)}+`;
  return `${n(r.lo)} to ${n(r.hi)}`;
}

function changed(a: Range, b: Range) { return a.lo !== b.lo || a.hi !== b.hi; }

/** The player's numbers after the first move: stock with production under it, TR, hand and the tags it adds. */
export function AfterPanel({before, after}: {before: Snapshot; after: Snapshot}) {
  const newTags = Object.entries(after.tags).filter(([t, n]) => t !== 'event' && n > (before.tags[t] ?? 0));
  const handKnown = after.hand.lo - after.drawn.lo;
  return (
    <div data-testid="projected-state" style={{padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,.04)', boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6}}>
        {RES.map((r) => {
          const moved = changed(before.stock[r], after.stock[r]) || changed(before.production[r], after.production[r]);
          return (
            <div key={r} data-proj-res={r} style={{padding: '5px 7px', borderRadius: 10, background: moved ? `color-mix(in oklab, ${RES_COLOR[r]} 14%, transparent)` : 'transparent',
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${RES_COLOR[r]} ${moved ? 40 : 16}%, transparent)`}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--ice-dim)'}}><ResIcon r={r} size={13} />{RES_LABEL[r]}</div>
              <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 4}}>
                <span className="num" data-proj-stock={r} style={{fontSize: 21}}>{rangeText(after.stock[r])}</span>
                <span className="num" style={{fontSize: 13.5, color: changed(before.production[r], after.production[r]) ? 'var(--ice)' : 'var(--ice-faint)'}}>
                  {after.production[r].lo >= 0 && after.production[r].lo === after.production[r].hi ? '+' : ''}{rangeText(after.production[r])}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginTop: 8, fontSize: 14}}>
        <span data-testid="proj-tr"><span className="faint">TR </span><strong className="num">{rangeText(after.tr)}</strong></span>
        <span data-testid="proj-hand">
          <span className="faint">Cards in hand </span><strong className="num">{after.drawn.hi > 0 ? handKnown : rangeText(after.hand)}</strong>
          {after.drawn.hi > 0 && <span style={{color: 'var(--tr)'}}> {after.drawn.hi === Infinity ? 'and maybe more' : after.drawn.lo === after.drawn.hi ? `+${after.drawn.lo}` : `+${after.drawn.lo} to ${after.drawn.hi}`} not known yet</span>}
        </span>
        {newTags.length > 0 && (
          <span data-testid="proj-tags"><span className="faint">New tags </span>{newTags.map(([t, n]) => `${n - (before.tags[t] ?? 0)} ${t}`).join(', ')}</span>
        )}
      </div>
    </div>
  );
}

/** The small "Planned" label of a tentative move. */
export function PlannedLabel() {
  return (
    <span data-testid="planned-label" style={{flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700,
      color: 'var(--tr)', boxShadow: 'inset 0 0 0 1.2px var(--tr)'}}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 1.6" /></svg>
      Planned
    </span>
  );
}

/** The dashed outline every tentative plan wears. */
export const tentative: React.CSSProperties = {border: '1.5px dashed color-mix(in oklab, var(--tr) 75%, transparent)', borderRadius: 16, background: 'rgba(111,184,232,.06)'};
