// "Plan my second action": the numbers after the first move (projected, with what is not known yet) and the moves
// that would be possible then. The chosen move is kept on this phone as a tentative plan (dashed, "Planned"); once the
// first move is really done the turn menu shows it with Confirm, Change and Drop. Nothing is ever sent or done by itself.
import {AnimatePresence, motion} from 'motion/react';
import {useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {findCard} from '../../../../shared/cards';
import type {PlayerViewModel} from '../../../../shared/full';
import {canMakeIn, moveKey, project, SP_IDS, worldFromView} from '../../../../shared/projection';
import type {Move, Projection, Verdict, World} from '../../../../shared/projection';
import {STANDARD_PROJECTS} from '../../../../shared/board';
import {CardRow} from '../CardRow';
import {cardDef} from '../model';
import {AfterPanel, EffectPreview, PlannedLabel, tentative} from './Preview';
import {canPlan, checkPlan, newPlan, planLabel} from './rules';
import type {PlannedMove} from './rules';
import {dropPlan, usePlan, usePlans} from './store';

const SP_NAMES = ['Power Plant:SP', 'Asteroid:SP', 'Aquifer', 'Greenery', 'City'];
const spName = (n: string) => STANDARD_PROJECTS.find((s) => s.id === SP_IDS[n])?.name ?? n;

type Candidate = {move: PlannedMove; group: 'hand' | 'standard' | 'convert' | 'action'; title: string; verdict: Verdict; cost?: number};

/** Every second move worth showing, with whether it would be possible after the first. */
function candidates(world: World, first: Move | null, firstInfo: {outcomes: import('../../../../shared/game').GameState[]; open?: boolean; tiles?: number}): Candidate[] {
  const m = world.model;
  const out: Candidate[] = [];
  const firstCard = first && (first.kind === 'play' || first.kind === 'action') ? first.card : null;
  for (const c of m.cardsInHand) {
    if (first?.kind === 'play' && c.name === firstCard) continue;
    if (!findCard(c.name)) continue;
    const move: PlannedMove = {kind: 'play', card: c.name};
    out.push({move, group: 'hand', title: c.name, verdict: canMakeIn(world, move, firstInfo)});
  }
  for (const n of SP_NAMES) {
    const move: PlannedMove = {kind: 'standard', project: n};
    out.push({move, group: 'standard', title: spName(n), verdict: canMakeIn(world, move, firstInfo)});
  }
  out.push({move: {kind: 'plants'}, group: 'convert', title: 'Plants into a greenery', verdict: canMakeIn(world, {kind: 'plants'}, firstInfo)});
  out.push({move: {kind: 'heat'}, group: 'convert', title: 'Heat into temperature', verdict: canMakeIn(world, {kind: 'heat'}, firstInfo)});
  const used = new Set(m.thisPlayer.actionsThisGeneration);
  for (const c of m.thisPlayer.tableau) {
    const d = findCard(c.name);
    if (!d?.action || used.has(c.name) || (first?.kind === 'action' && first.card === c.name)) continue;
    const move: PlannedMove = {kind: 'action', card: c.name};
    out.push({move, group: 'action', title: c.name, verdict: canMakeIn(world, move, firstInfo)});
  }
  return out;
}

const ORDER = {yes: 0, maybe: 1, no: 2} as const;
const GROUP_TITLE = {hand: 'Cards in your hand', standard: 'Standard projects', convert: 'Plants and heat', action: 'Card actions'} as const;

/**
 * The planning page. `first` is the move being made now (null when it is already done: the plan is then changed
 * against the real state).
 */
export function Planner({model, first, firstLabel, onClose}: {model: PlayerViewModel; first: Move | null; firstLabel: string; onClose: () => void}) {
  const plan = usePlan();
  const setPlan = usePlans((s) => s.setPlan);
  const world = useMemo(() => worldFromView(model), [model]);
  const firstKey = first ? `${moveKey(first)}:${JSON.stringify((first as {payment?: unknown}).payment ?? null)}` : '';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p1 = useMemo<Projection | null>(() => (first ? project(world, first) : null), [world, firstKey]);
  const info = p1?.ok ? p1 : {outcomes: [world.state], open: false, tiles: 0};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => candidates(world, first, info), [world, p1]);
  const [pick, setPick] = useState<string | null>(plan ? moveKey(plan.second as Move) : null);
  const picked = list.find((c) => moveKey(c.move as Move) === pick) ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p2 = useMemo(() => (picked ? project(world, picked.move as Move, {}, info.outcomes[0]) : null), [picked, world, p1]);
  const groups = (['hand', 'standard', 'convert', 'action'] as const).map((g) => ({g, items: list.filter((c) => c.group === g).sort((a, b) => ORDER[a.verdict.state] - ORDER[b.verdict.state])}))
    .filter((x) => x.items.length);
  // a portal: the decision sheet moves with a transform, which would pin a fixed page to the sheet instead of the screen
  return createPortal(
    <motion.div data-testid="planner" role="dialog" aria-label="Plan my second action" initial={{x: '100%'}} animate={{x: 0}} exit={{x: '100%'}} transition={{type: 'spring', stiffness: 340, damping: 36}}
      style={{position: 'fixed', inset: 0, zIndex: 60, overflowY: 'auto', background: 'var(--dusk-1)', padding: 'calc(14px + env(safe-area-inset-top)) 16px calc(110px + env(safe-area-inset-bottom))'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4}}>
        <h3 style={{margin: 0, flex: 1, fontSize: 21, fontWeight: 750, fontVariationSettings: "'wdth' 84"}}>{first ? 'Plan my second action' : 'Change my planned move'}</h3>
        <button className="btn ghost" style={{minHeight: 38, padding: '0 14px', fontSize: 15}} onClick={onClose} data-testid="planner-close">Close</button>
      </div>
      <p className="muted" style={{margin: '0 0 12px', fontSize: 14}}>
        {first ? `After you ${lowerFirst(firstLabel)}. ` : ''}Only you see this. Nothing is sent to the table, and nothing happens until you confirm.
      </p>
      {p1 && <EffectPreview p={p1} label="Your first move" testId="first-preview" />}
      {p1?.ok && (
        <>
          <span className="cond faint" style={{display: 'block', fontSize: 12.5, margin: '0 0 4px'}}>Your numbers after it</span>
          <AfterPanel before={p1.before} after={p1.after} />
        </>
      )}
      {groups.map(({g, items}) => (
        <section key={g} style={{marginTop: 18}}>
          <h4 className="cond" style={{margin: '0 2px 8px', fontWeight: 600, color: 'var(--ice-dim)', fontSize: 15}}>{GROUP_TITLE[g]}</h4>
          <div style={{display: 'grid', gap: 8}}>
            {items.map((c) => {
              const k = moveKey(c.move as Move);
              const on = k === pick;
              const off = c.verdict.state === 'no';
              return (
                <div key={k} style={on ? {...tentative, padding: 6} : undefined}>
                  <motion.button data-plan-candidate={k} data-verdict={c.verdict.state} whileTap={{scale: 0.985}} disabled={off}
                    onClick={() => setPick(on ? null : k)}
                    style={{display: 'block', width: '100%', textAlign: 'left', borderRadius: 16, opacity: off ? 0.45 : 1}}>
                    {c.group === 'hand' ? <CardRow card={cardDef(c.title)} cost={model.cardsInHand.find((x) => x.name === c.title)?.calculatedCost} />
                      : (
                        <div style={{padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.05)', fontWeight: 650, fontSize: 16}}>{c.title}</div>
                      )}
                  </motion.button>
                  <VerdictLine v={c.verdict} />
                  {on && (
                    <div style={{padding: '8px 6px 4px'}}>
                      <EffectPreview p={p2} label={first ? 'What it would do then' : 'What it would do'} testId="second-preview" />
                      <button className="btn warm" data-testid="plan-this" style={{width: '100%'}}
                        onClick={() => { setPlan(newPlan(model, plan && !first ? plan.after : firstLabel, c.move)); onClose(); }}>
                        {plan && moveKey(plan.second as Move) === k ? 'Keep this plan' : 'Plan this'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </motion.div>,
    document.body,
  );
}

function VerdictLine({v}: {v: Verdict}) {
  const text = v.state === 'yes' ? 'Possible after your first move' : v.reason;
  const color = v.state === 'yes' ? '#9FE3AE' : v.state === 'maybe' ? 'var(--mc)' : 'var(--ice-faint)';
  return <div data-testid="verdict" style={{fontSize: 13, color, margin: '4px 4px 0'}}>{v.state === 'maybe' ? `Not sure yet: ${lowerFirst(text)}` : text}</div>;
}

const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^(Mars|Earth|Venus|Jovian)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * Under the first move's payment (or its card-action pick): "Plan my second action", or the plan already made, dashed and
 * labelled "Planned", with Change and Drop. Only on the player's own turn menu before the turn's first action.
 */
export function PlanSlot({model, first, firstLabel}: {model: PlayerViewModel; first: Move; firstLabel: string}) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  if (!canPlan(model)) return null;
  return (
    <>
      {plan ? (
        <div data-testid="plan-pending" style={{...tentative, marginTop: 12, padding: '10px 12px'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <PlannedLabel />
            <span style={{flex: 1, minWidth: 0, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{planLabel(plan.second)}</span>
          </div>
          <div className="muted" style={{fontSize: 13, marginTop: 3}}>Your second action. Checked again once this move is done.</div>
          <div style={{display: 'flex', gap: 8, marginTop: 8}}>
            <button className="btn ghost" data-testid="plan-change" style={{flex: 1, minHeight: 38, fontSize: 15}} onClick={() => setOpen(true)}>Change</button>
            <button className="btn ghost" data-testid="plan-drop" style={{flex: 1, minHeight: 38, fontSize: 15}} onClick={() => dropPlan()}>Drop</button>
          </div>
        </div>
      ) : (
        <button data-testid="plan-second" className="btn ghost" onClick={() => setOpen(true)}
          style={{width: '100%', marginTop: 12, minHeight: 44, fontSize: 15.5, boxShadow: 'none', border: '1.5px dashed color-mix(in oklab, var(--tr) 70%, transparent)', color: 'var(--tr)'}}>
          Plan my second action
        </button>
      )}
      <AnimatePresence>
        {open && <Planner model={model} first={first} firstLabel={firstLabel} onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

/**
 * At the top of the turn menu once the first action is done: "Your planned move: Play X", checked against the real
 * game. Confirm opens that move's usual questions (payment, targets); it never makes the move by itself.
 */
export function DuePlan({model, onConfirm}: {model: PlayerViewModel; onConfirm: (option: number, m: PlannedMove) => void}) {
  const plan = usePlan();
  const fate = usePlans((s) => s.fate);
  const [changing, setChanging] = useState(false);
  const check = useMemo(() => (plan ? checkPlan(model, plan.second) : null), [model, plan]);
  if (!plan || !check || fate?.s !== 'ready') return null;
  return (
    <div data-testid="plan-due" data-valid={check.ok ? 'true' : 'false'} style={{...tentative, padding: '12px 12px 10px', marginBottom: 12}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
        <PlannedLabel />
        <span className="muted" style={{fontSize: 13}}>Your planned move</span>
      </div>
      <div style={{fontWeight: 700, fontSize: 18, margin: '4px 0 2px'}} data-testid="plan-due-title">{planLabel(plan.second)}</div>
      {check.ok
        ? <EffectPreview p={check.preview} compact testId="plan-due-preview" />
        : <p role="alert" data-testid="plan-due-reason" style={{margin: '2px 0 0', color: '#FFB39E', fontWeight: 600, fontSize: 14.5}}>{check.reason}</p>}
      <div style={{display: 'flex', gap: 8, marginTop: 10}}>
        <button className="btn warm" data-testid="plan-confirm" style={{flex: 1.4, minHeight: 42, fontSize: 16}} disabled={!check.ok}
          onClick={() => check.ok && onConfirm(check.option, plan.second)}>Confirm</button>
        <button className="btn ghost" data-testid="plan-change" style={{flex: 1, minHeight: 42, fontSize: 15}} onClick={() => setChanging(true)}>Change</button>
        <button className="btn ghost" data-testid="plan-drop" style={{flex: 1, minHeight: 42, fontSize: 15}} onClick={() => dropPlan()}>Drop</button>
      </div>
      <AnimatePresence>
        {changing && <Planner model={model} first={null} firstLabel={plan.after} onClose={() => setChanging(false)} />}
      </AnimatePresence>
    </div>
  );
}

/** While the first move is still open: a quiet reminder of the plan on the turn menu. */
export function WaitingPlan() {
  const plan = usePlan();
  const fate = usePlans((s) => s.fate);
  if (!plan || (fate && fate.s !== 'waiting')) return null;
  return (
    <div data-testid="plan-waiting" style={{...tentative, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 12}}>
      <PlannedLabel />
      <span style={{flex: 1, minWidth: 0, fontSize: 14.5}}><span className="muted">Second action: </span><strong>{planLabel(plan.second)}</strong></span>
      <button className="btn ghost" data-testid="plan-drop" style={{minHeight: 34, padding: '0 12px', fontSize: 14}} onClick={() => dropPlan()}>Drop</button>
    </div>
  );
}
