// Renders whatever the engine is asking this player (a PlayerInputModel tree) and builds the exact
// InputResponse it expects. Each level owns its own step; nested answers are wrapped on the way up.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {payment} from '../../../shared/full';
import type {CardModel, Color, InputResponse, PlayerInputModel, PlayerViewModel} from '../../../shared/full';
import type {Resource} from '../../../shared/types';
import {PLAYER_HEX, RES_LABEL, ResIcon} from '../../ui/Icons';
import {Stepper} from '../Resolve';
import {CardPicker, FullCard, KeepPile} from './Cards';
import {CardRow, RowWithInfo, useCardPeek} from './CardRow';
import {SpacePicker} from './Hex';
import {cardDef, isBuyTitle, isTurnMenu, MENU_ROWS, msg, OPTION_LABEL, OPTION_ORDER, optionKind, standardProject, standardProjectReason, tileFromTitle, unavailableReason} from './model';
import type {OptionKind} from './model';
import {defaultPayment, moveLabel, previewText, project, spaceBonus, worldFromView} from '../../../shared/projection';
import type {Move, World} from '../../../shared/projection';
import {EffectPreview} from './plan/Preview';
import {DuePlan, PlanSlot, WaitingPlan} from './plan/Planner';
import {planPreselect} from './plan/rules';
import type {PlannedMove} from './plan/rules';

export type Submit = (r: InputResponse) => Promise<void>;
type Ctx = {model: PlayerViewModel; onHover: (spaceId: string | null, tile: 'greenery' | 'ocean' | 'city' | 'special' | null) => void; busy: boolean;
  /** M€ available for buying cards when it is not the current stock (the initial buy counts from the corporation). */
  budget?: number;
  /** smart hints (when the player turned them on): card actions still unused, shown on the Pass row */
  unusedActions?: string[];
  /** Why the turn menu has no Undo (the engine offers it only after your own action this turn), e.g. "Vera has already moved" */
  undoReason?: string | null;
  /** only bots moved since your last move: Undo takes it back together with their moves */
  undoMine?: {bots: number; onUndo: () => void} | null;
  /** the turn-menu option this question belongs to (for the effect preview and planning) */
  first?: OptionKind};

/** The companion world of this phone's own view, for previews: computed once per view. */
function useWorld(model: PlayerViewModel): World | null {
  return useMemo(() => (isTurnMenu(model.waitingFor) ? worldFromView(model) : null), [model]);
}
type Props = {input: PlayerInputModel; ctx: Ctx; onSubmit: Submit; onBack?: () => void; preselect?: string};

const title = (t: string) => <h3 style={{margin: '2px 0 14px', fontSize: 21, fontWeight: 750, fontVariationSettings: "'wdth' 84", lineHeight: 1.15}}>{t}</h3>;
const Back = ({onBack}: {onBack?: () => void}) => onBack ? <button className="btn ghost" style={{width: '100%', marginTop: 10}} onClick={onBack}>Back</button> : null;

export function InputView(props: Props) {
  const {input} = props;
  switch (input.type) {
  case 'or': return <OrInput {...props} />;
  case 'and': return <AndInput {...props} />;
  case 'initialCards': return <InitialCards {...props} />;
  case 'option': return <OptionInput {...props} />;
  case 'projectCard': return <ProjectCardInput {...props} />;
  case 'card': return <CardInput {...props} />;
  case 'space': return <SpaceInput {...props} />;
  case 'player': return <PlayerInput {...props} />;
  case 'amount': return <AmountInput {...props} />;
  case 'payment': return <PaymentInput {...props} />;
  case 'productionToLose': return <ProductionToLose {...props} />;
  case 'resource': return <ResourceInput {...props} />;
  case 'resources': return <ResourcesInput {...props} />;
  default: return <Unknown {...props} />;
  }
}

// ---- or: the turn menu and every "choose one" ------------------------------------------------
const ICON: Record<OptionKind, React.ReactNode> = {
  play: <Glyph d="M7 4h9l3 3v13H7zM16 4v3h3" />, action: <Glyph d="M13 3 6 14h5l-1 7 7-11h-5z" />,
  standard: <Glyph d="M4 20V9l8-5 8 5v11M9 20v-6h6v6" />, plants: <ResIcon r="plants" size={24} />, heat: <ResIcon r="heat" size={24} />,
  milestone: <Glyph d="M6 21V4M6 4h11l-2 4 2 4H6" />, award: <Glyph d="M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM8.5 13 7 21l5-3 5 3-1.5-8" />,
  sell: <ResIcon r="megacredits" size={24} />, pass: <Glyph d="M5 12h14M13 6l6 6-6 6" />, end: <Glyph d="M6 6h12v12H6z" />,
  undo: <Glyph d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />, other: <Glyph d="M12 5v14M5 12h14" />,
};
function Glyph({d}: {d: string}) {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden><path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function optionSubtitle(o: PlayerInputModel, model: PlayerViewModel): string | null {
  if (o.type === 'projectCard') {
    const cards = (o as {cards: CardModel[]}).cards;
    const n = cards.filter((c) => !c.isDisabled).length;
    return optionKind(o) === 'standard' ? `${n} affordable` : `${n} card${n === 1 ? '' : 's'} you can play`;
  }
  if (o.type === 'card') {
    const n = (o as {cards: CardModel[]}).cards.length;
    return optionKind(o) === 'action' ? `${n} ready this generation` : null;
  }
  if (o.type === 'or') return `${(o.options as PlayerInputModel[]).length} choices`;
  if (o.type === 'space' && optionKind(o) === 'plants') return `${model.thisPlayer.plants} plants`;
  return null;
}

function OrInput({input, ctx, onSubmit, onBack, preselect}: Props) {
  const options = (input as {options: PlayerInputModel[]}).options;
  // Jump straight into "play a card" when the player tapped a card in their hand.
  const pre = preselect ? options.findIndex((o) => o.type === 'projectCard' && (o as {cards: CardModel[]}).cards.some((c) => c.name === preselect)) : -1;
  const [open, setOpen] = useState<number | null>(pre >= 0 ? pre : null);
  const [confirm, setConfirm] = useState<number | null>(null);
  // a planned move confirmed from the top of the menu: its option opens with the card (or project) already chosen
  const [planPre, setPlanPre] = useState<string | undefined>();
  const [leaf, setLeaf] = useState<number | null>(null);
  const world = useWorld(ctx.model);
  const previewOf = (k: OptionKind): string | null => {
    if (!world || (k !== 'heat' && k !== 'plants')) return null;
    return previewText(project(world, {kind: k}));
  };
  const confirmPlan = (option: number, m: PlannedMove) => {
    const o = options[option];
    if (o.type === 'option') { setLeaf(option); return; }
    setPlanPre(planPreselect(m));
    setOpen(option);
  };
  // On the main turn menu every main option is always listed in the same order; the ones the engine does not
  // offer right now stay visible, disabled, with the reason (so "Play a card" never just disappears).
  const turnMenu = isTurnMenu(input);
  const order = useMemo(() => {
    // An offered card list whose every entry is disabled (the engine still lists standard projects when none is
    // affordable) is shown like an option the engine left out: greyed, with the reason.
    const empty = (o: PlayerInputModel) => o.type === 'projectCard' && (o as {cards: CardModel[]}).cards.every((c) => c.isDisabled);
    const offered: Array<{o: PlayerInputModel | null; i: number; k: OptionKind}> = options.map((o, i) => {
      const k = optionKind(o);
      return turnMenu && MENU_ROWS.includes(k) && empty(o) ? {o: null, i: -1, k} : {o, i, k};
    });
    if (turnMenu) for (const k of MENU_ROWS) if (!offered.some((x) => x.k === k)) offered.push({o: null, i: -1, k});
    // Undo stays in its place at the bottom, greyed with the reason, when there is nothing this player may undo
    if (turnMenu && (ctx.undoReason || ctx.undoMine) && !offered.some((x) => x.k === 'undo')) offered.push({o: null, i: -1, k: 'undo'});
    return offered.sort((a, b) => OPTION_ORDER.indexOf(a.k) - OPTION_ORDER.indexOf(b.k));
  }, [options, turnMenu, ctx.undoReason, ctx.undoMine]);
  const wrap = (i: number): Submit => (r) => onSubmit({type: 'or', index: i, response: r});

  if (open !== null) {
    const k = turnMenu ? optionKind(options[open]) : undefined;
    return (
      <Slide k={`or-${open}`}>
        <InputView input={options[open]} ctx={k ? {...ctx, first: k} : ctx} onSubmit={wrap(open)} preselect={preselect ?? planPre}
          onBack={pre >= 0 && preselect ? onBack : () => { setOpen(null); setPlanPre(undefined); }} />
      </Slide>
    );
  }
  if (leaf !== null) {
    // a planned move with no questions of its own (heat into temperature): one more tap, never by itself
    const k = optionKind(options[leaf]);
    return (
      <Slide k={`leaf-${leaf}`}>
        {title(msg(ctx.model, options[leaf].title) || OPTION_LABEL[k])}
        {world && <EffectPreview p={project(world, {kind: k === 'heat' ? 'heat' : 'plants'})} />}
        <button className="btn warm" data-testid="plan-leaf-confirm" style={{width: '100%'}} disabled={ctx.busy} onClick={() => void wrap(leaf)({type: 'option'})}>
          {options[leaf].buttonLabel || 'Confirm'}
        </button>
        <Back onBack={() => setLeaf(null)} />
      </Slide>
    );
  }
  const menuTitle = msg(ctx.model, input.title);
  return (
    <Slide k="or-list">
      {menuTitle.trim() && title(menuTitle)}
      {turnMenu && <DuePlan model={ctx.model} onConfirm={confirmPlan} />}
      {turnMenu && <WaitingPlan />}
      <div style={{display: 'grid', gap: 8}}>
        {order.map(({o, i, k}) => {
          if (!o && k === 'undo' && ctx.undoMine) {
            const mine = ctx.undoMine;
            return (
              <motion.button key="undo-mine" data-testid="menu-undo-mine" whileTap={{scale: 0.98}} disabled={ctx.busy} onClick={mine.onUndo}
                style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '12px 16px', borderRadius: 16, textAlign: 'left',
                  background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--rim)'}}>
                <span style={{width: 28, display: 'grid', placeItems: 'center', color: 'var(--ice-dim)'}}>{ICON.undo}</span>
                <span style={{flex: 1, minWidth: 0}}>
                  <span style={{display: 'block', fontWeight: 650, fontSize: 17}}>Undo my last move</span>
                  <span className="muted" style={{display: 'block', fontSize: 13.5}}>{undoMineLine(mine.bots)}</span>
                </span>
              </motion.button>
            );
          }
          if (!o) {
            return (
              <div key={`off-${k}`} data-opt-off={k} aria-disabled="true"
                style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 16px', borderRadius: 16, opacity: 0.5,
                  boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
                <span style={{width: 28, display: 'grid', placeItems: 'center', color: 'var(--ice-faint)'}}>{ICON[k]}</span>
                <span style={{flex: 1, minWidth: 0}}>
                  <span style={{display: 'block', fontWeight: 650, fontSize: 17}}>{OPTION_LABEL[k]}</span>
                  <span className="muted" style={{display: 'block', fontSize: 13.5}}>{k === 'undo' ? ctx.undoReason : unavailableReason(k, ctx.model)}</span>
                </span>
              </div>
            );
          }
          const label = k === 'other' || k === 'milestone' || k === 'award' ? msg(ctx.model, o.title) || OPTION_LABEL[k] : OPTION_LABEL[k];
          const unused = k === 'pass' ? ctx.unusedActions ?? [] : [];
          const sub = unused.length ? `${unused.length === 1 ? 'Card action' : 'Card actions'} not used yet: ${unused.join(', ')}` : (turnMenu && previewOf(k)) || optionSubtitle(o, ctx.model);
          const leaf = o.type === 'option';
          const quiet = k === 'undo' || k === 'end' || k === 'pass';
          const warn = k === 'pass' && confirm === i;
          return (
            <motion.button key={i} data-opt={i} whileTap={{scale: 0.98}} disabled={ctx.busy}
              onClick={() => {
                if (!leaf) return setOpen(i);
                if (k === 'pass' && confirm !== i) return setConfirm(i);
                void wrap(i)({type: 'option'});
              }}
              style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: quiet ? '12px 16px' : '15px 16px', borderRadius: 16, textAlign: 'left',
                background: warn ? 'rgba(226,80,46,.2)' : quiet ? 'transparent' : 'rgba(255,255,255,.06)',
                boxShadow: warn ? 'inset 0 0 0 1.5px var(--ember)' : quiet ? 'inset 0 0 0 1.5px var(--rim)' : 'none'}}>
              <span style={{width: 28, display: 'grid', placeItems: 'center', color: k === 'play' ? 'var(--mc)' : 'var(--ice-dim)'}}>{ICON[k]}</span>
              <span style={{flex: 1, minWidth: 0}}>
                <span style={{display: 'block', fontWeight: 650, fontSize: 17}}>{warn ? 'Tap again to pass' : label}</span>
                {sub && <span data-opt-sub={k} className={unused.length ? undefined : 'muted'} style={{display: 'block', fontSize: 13.5, color: unused.length ? 'var(--tr)' : undefined}}>{sub}</span>}
              </span>
              {!leaf && <span className="faint" aria-hidden>›</span>}
            </motion.button>
          );
        })}
      </div>
      <Back onBack={onBack} />
    </Slide>
  );
}

/** What "Choose something else" undoes, in a line. */
export function backOutLine(what: {card: string; play: boolean} | null): string {
  if (what?.play) return `${what.card} goes back to your hand, and you get back what you paid.`;
  if (what) return `The ${what.card} action stays unused, and you get back anything you paid.`;
  return 'The game goes back to before this move, and you get back what you paid.';
}

/** "Also takes back 2 bot moves" (the bots' moves after yours go with it). */
export function undoMineLine(bots: number): string {
  return bots > 0 ? `Also takes back ${bots === 1 ? 'the bot move' : `${bots} bot moves`} after it` : 'Also takes back what the bots did after it';
}

/**
 * Leave your own move while its follow-up questions are open (whom to target, where to place, which resource): the game
 * goes back to just before the move, so the card returns to your hand and what you paid comes back. Shown under the
 * question, quieter than its answers. `reason`: why it is not possible (the move drew cards).
 */
export function BackOut({what, reason, busy, onBack}: {what: {card: string; play: boolean} | null; reason?: string | null; busy: boolean; onBack: () => void}) {
  if (reason) {
    return <p data-testid="back-out-off" className="muted" style={{margin: '16px 0 0', fontSize: 13.5, textAlign: 'center'}}>{reason}</p>;
  }
  return (
    <motion.button data-testid="back-out" whileTap={{scale: 0.98}} disabled={busy} onClick={onBack}
      style={{display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 16, padding: '11px 14px', borderRadius: 14, textAlign: 'left',
        background: 'transparent', boxShadow: 'inset 0 0 0 1.5px var(--rim)'}}>
      <span style={{width: 24, display: 'grid', placeItems: 'center', color: 'var(--ice-dim)'}}><Glyph d="M15 5l-7 7 7 7" /></span>
      <span style={{flex: 1, minWidth: 0}}>
        <span style={{display: 'block', fontWeight: 650, fontSize: 16}}>Choose something else</span>
        <span className="muted" style={{display: 'block', fontSize: 13}}>
          {backOutLine(what)}
        </span>
      </span>
    </motion.button>
  );
}

function Slide({k, children}: {k: string; children: React.ReactNode}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div key={k} initial={{opacity: 0, x: 26}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: -26}} transition={{duration: 0.2}}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// ---- and / initialCards: step through sub-questions -----------------------------------------
function Steps({inputs, ctx, onDone, onBack, header, stepCtx}: {
  inputs: PlayerInputModel[]; ctx: Ctx; onDone: (rs: InputResponse[]) => Promise<void>; onBack?: () => void;
  header?: (step: number, answers: InputResponse[]) => React.ReactNode;
  stepCtx?: (step: number, answers: InputResponse[]) => Ctx;
}) {
  const [answers, setAnswers] = useState<InputResponse[]>([]);
  const step = answers.length;
  if (step >= inputs.length) return null;
  const next: Submit = async (r) => {
    const all = [...answers, r];
    if (all.length === inputs.length) await onDone(all);
    else setAnswers(all);
  };
  return (
    <Slide k={`step-${step}`}>
      {inputs.length > 1 && (
        <div style={{display: 'flex', gap: 6, marginBottom: 14}} aria-label={`Step ${step + 1} of ${inputs.length}`}>
          {inputs.map((_, i) => <motion.span key={i} animate={{background: i <= step ? 'var(--ice)' : 'rgba(255,255,255,.14)'}} style={{flex: 1, height: 4, borderRadius: 2}} />)}
        </div>
      )}
      {header?.(step, answers)}
      <InputView input={inputs[step]} ctx={stepCtx?.(step, answers) ?? ctx} onSubmit={next} onBack={step ? () => setAnswers((a) => a.slice(0, -1)) : onBack} />
    </Slide>
  );
}

function AndInput({input, ctx, onSubmit, onBack}: Props) {
  const options = (input as {options: PlayerInputModel[]}).options;
  if (options.length > 1 && options.every((o) => o.type === 'amount')) return <DistributeInput {...{input, ctx, onSubmit, onBack}} />;
  return <Steps inputs={(input as {options: PlayerInputModel[]}).options} ctx={ctx} onBack={onBack} onDone={(rs) => onSubmit({type: 'and', responses: rs})} />;
}

/** The engine's "distribute N resources across your cards": amounts that must add up to N (each max is N). */
function DistributeInput({input, ctx, onSubmit, onBack}: Props) {
  const options = (input as {options: Array<{title: PlayerInputModel['title']; min: number; max: number}>}).options;
  const total = Math.max(...options.map((o) => o.max));
  const [v, setV] = useState<number[]>(options.map((o) => o.min));
  const sum = v.reduce((a, b) => a + b, 0);
  return (
    <Slide k="distribute">
      {title(msg(ctx.model, input.title) || `Distribute ${total}`)}
      <p className="muted" style={{marginTop: -6}}>Split {total} between these cards. {total - sum} left.</p>
      {options.map((o, i) => (
        <Stepper key={i} label={msg(ctx.model, o.title)} value={v[i]} min={o.min} max={Math.min(o.max, v[i] + total - sum)}
          set={(n) => setV((xs) => xs.map((x, j) => (j === i ? n : x)))} />
      ))}
      <button className="btn warm" style={{width: '100%', marginTop: 12}} disabled={ctx.busy || sum !== total}
        onClick={() => onSubmit({type: 'and', responses: v.map((n) => ({type: 'amount', amount: n}))})}>{input.buttonLabel || 'Confirm'}</button>
      <Back onBack={onBack} />
    </Slide>
  );
}

function InitialCards({input, ctx, onSubmit, onBack}: Props) {
  const inputs = (input as {options: PlayerInputModel[]}).options;
  return (
    <Steps inputs={inputs} ctx={ctx} onBack={onBack} onDone={(rs) => onSubmit({type: 'initialCards', responses: rs})}
      stepCtx={(step, answers) => {
        const corp = answers[0] && answers[0].type === 'card' ? answers[0].cards[0] : null;
        const start = corp ? cardDef(corp).startingMegaCredits : null;
        return step > 0 && start !== null ? {...ctx, budget: start} : ctx;
      }}
      header={(step, answers) => {
        // After the corporation is chosen, show its starting M€ so the buy step can count down from it.
        const corp = answers[0] && answers[0].type === 'card' ? answers[0].cards[0] : null;
        if (step === 0 || !corp) return null;
        const start = cardDef(corp).startingMegaCredits;
        return <p className="muted" style={{margin: '-4px 0 12px'}}>{corp}{start !== null ? ` starts with ${start} M€.` : '.'}</p>;
      }} />
  );
}

// ---- simple leaves ---------------------------------------------------------------------------
function OptionInput({input, ctx, onSubmit, onBack}: Props) {
  return (
    <Slide k="option">
      {title(msg(ctx.model, input.title))}
      {input.warning && <p style={{color: 'var(--mc)'}}>{msg(ctx.model, input.warning)}</p>}
      <button className="btn warm" style={{width: '100%'}} disabled={ctx.busy} onClick={() => onSubmit({type: 'option'})}>{input.buttonLabel || 'Confirm'}</button>
      <Back onBack={onBack} />
    </Slide>
  );
}

function PlayerInput({input, ctx, onSubmit, onBack}: Props) {
  const players = (input as {players: Color[]}).players;
  return (
    <Slide k="player">
      {title(msg(ctx.model, input.title))}
      <div style={{display: 'grid', gap: 10}}>
        {players.map((c) => {
          const p = ctx.model.players.find((x) => x.color === c);
          return (
            <motion.button key={c} data-player={c} whileTap={{scale: 0.97}} disabled={ctx.busy} onClick={() => onSubmit({type: 'player', player: c})}
              style={{display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderRadius: 14, background: 'rgba(255,255,255,.06)', boxShadow: `inset 4px 0 0 ${PLAYER_HEX[c]}`, fontSize: 17, fontWeight: 650, textAlign: 'left'}}>
              {p?.name ?? c}{c === ctx.model.color && <span className="faint"> · you</span>}
            </motion.button>
          );
        })}
      </div>
      <Back onBack={onBack} />
    </Slide>
  );
}

function AmountInput({input, ctx, onSubmit, onBack}: Props) {
  const a = input as {min: number; max: number; maxByDefault?: boolean};
  const [v, setV] = useState(a.maxByDefault ? a.max : a.min);
  return (
    <Slide k="amount">
      {title(msg(ctx.model, input.title))}
      <Stepper label="Amount" value={v} set={setV} min={a.min} max={a.max} />
      <button className="btn warm" style={{width: '100%', marginTop: 12}} disabled={ctx.busy} onClick={() => onSubmit({type: 'amount', amount: v})}>{input.buttonLabel || `Confirm ${v}`}</button>
      <Back onBack={onBack} />
    </Slide>
  );
}

const STANDARD_RES: Resource[] = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat'];

function ResourceInput({input, ctx, onSubmit, onBack}: Props) {
  const include = ((input as {include?: string[]}).include ?? STANDARD_RES) as Resource[];
  return (
    <Slide k="resource">
      {title(msg(ctx.model, input.title))}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10}}>
        {include.map((r) => (
          <button key={r} className="btn ghost" disabled={ctx.busy} onClick={() => onSubmit({type: 'resource', resource: r})} style={{flexDirection: 'column', minHeight: 76, gap: 4}}>
            {STANDARD_RES.includes(r) && <ResIcon r={r} />}<span style={{fontSize: 14}}>{RES_LABEL[r] ?? r}</span>
          </button>
        ))}
      </div>
      <Back onBack={onBack} />
    </Slide>
  );
}

function ResourcesInput({input, ctx, onSubmit, onBack}: Props) {
  const count = (input as {count: number}).count;
  const [u, setU] = useState<Record<string, number>>({});
  const total = Object.values(u).reduce((a, b) => a + b, 0);
  return (
    <Slide k="resources">
      {title(msg(ctx.model, input.title))}
      <p className="muted" style={{marginTop: -6}}>Choose {count} in any mix. {count - total} left.</p>
      {STANDARD_RES.map((r) => <Stepper key={r} icon={<ResIcon r={r} />} label={RES_LABEL[r]} value={u[r] ?? 0} max={(u[r] ?? 0) + count - total} set={(n) => setU((x) => ({...x, [r]: n}))} />)}
      <button className="btn warm" style={{width: '100%', marginTop: 12}} disabled={ctx.busy || total !== count}
        onClick={() => onSubmit({type: 'resources', units: Object.fromEntries(STANDARD_RES.map((r) => [r, u[r] ?? 0]))})}>{input.buttonLabel || 'Confirm'}</button>
      <Back onBack={onBack} />
    </Slide>
  );
}

function ProductionToLose({input, ctx, onSubmit, onBack}: Props) {
  const pay = (input as {payProduction: {cost: number; units: Record<string, number>}}).payProduction;
  const [u, setU] = useState<Record<string, number>>({});
  const total = Object.values(u).reduce((a, b) => a + b, 0);
  return (
    <Slide k="ptl">
      {title(msg(ctx.model, input.title))}
      <p className="muted" style={{marginTop: -6}}>Lose {pay.cost} production steps in total. {pay.cost - total} left.</p>
      {STANDARD_RES.filter((r) => (pay.units[r] ?? 0) > 0).map((r) => (
        <Stepper key={r} icon={<ResIcon r={r} />} label={`${RES_LABEL[r]} (have ${pay.units[r]})`} value={u[r] ?? 0}
          max={Math.min(pay.units[r], (u[r] ?? 0) + pay.cost - total)} set={(n) => setU((x) => ({...x, [r]: n}))} />
      ))}
      <button className="btn warm" style={{width: '100%', marginTop: 12}} disabled={ctx.busy || total !== pay.cost}
        onClick={() => onSubmit({type: 'productionToLose', units: Object.fromEntries(STANDARD_RES.map((r) => [r, u[r] ?? 0]))})}>{input.buttonLabel || 'Confirm'}</button>
      <Back onBack={onBack} />
    </Slide>
  );
}

function Unknown({input, ctx, onBack}: Props) {
  return (
    <Slide k="unknown">
      {title(msg(ctx.model, input.title))}
      <p className="muted">The engine is asking a “{input.type}” question that this phone cannot show yet. Answer it from the engine's own page, or skip it if it is optional.</p>
      <Back onBack={onBack} />
    </Slide>
  );
}

// ---- space -----------------------------------------------------------------------------------
function SpaceInput({input, ctx, onSubmit, onBack}: Props) {
  const t = msg(ctx.model, input.title);
  const kind = tileFromTitle(t);
  const [at, setAt] = useState<string | null>(null);
  const bonus = at ? spaceBonus(ctx.model, at) : null;
  const plants = ctx.first === 'plants' && isTurnMenu(ctx.model.waitingFor);
  const world = useWorld(ctx.model);
  const greenery: Move = {kind: 'plants'};
  return (
    <Slide k="space">
      {title(t)}
      {plants && world && <EffectPreview p={project(world, greenery, at ? {space: at} : {})} />}
      <SpacePicker spaces={ctx.model.game.spaces} valid={(input as {spaces: string[]}).spaces} color={ctx.model.color} kind={kind} busy={ctx.busy}
        title={kind === 'special' ? 'Place tile' : `Place ${kind}`}
        onHover={(id) => { setAt(id); ctx.onHover(id, id ? kind : null); }} onConfirm={(id) => { ctx.onHover(null, null); return onSubmit({type: 'space', spaceId: id}); }} />
      {bonus && (
        <p data-testid="space-bonus" className="muted" style={{margin: '8px 2px 0', fontSize: 14}}>
          {bonus.words.length ? `This space gives ${bonus.words.join(' · ')}` : 'This space gives no placement bonus'}
        </p>
      )}
      {plants && <PlanSlot model={ctx.model} first={greenery} firstLabel="turn plants into a greenery" />}
      <Back onBack={onBack && (() => { ctx.onHover(null, null); onBack(); })} />
    </Slide>
  );
}

// ---- cards -----------------------------------------------------------------------------------
function CardInput({input, ctx, onSubmit, onBack, preselect}: Props) {
  const c = input as {cards: CardModel[]; min: number; max: number; selectBlueCardAction?: boolean};
  const t = msg(ctx.model, input.title);
  const buying = isBuyTitle(t);
  const [sel, setSel] = useState<Set<string>>(() => new Set(preselect && c.cards.some((x) => x.name === preselect && !x.isDisabled) ? [preselect] : []));
  const world = useWorld(ctx.model);
  const action: Move | null = c.selectBlueCardAction && sel.size === 1 && ctx.first === 'action' ? {kind: 'action', card: [...sel][0]} : null;
  const mc = ctx.budget ?? ctx.model.thisPlayer.megacredits;
  const cost = buying ? sel.size * 3 : 0;
  const single = c.max === 1 && c.min === 1;
  const corpPick = /corporation/i.test(t) && single;
  const toggle = (name: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(name)) n.delete(name);
    else {
      if (single) n.clear();
      if (n.size >= c.max) return s;
      if (buying && (n.size + 1) * 3 > mc) { navigator.vibrate?.([20, 40, 20]); return s; }
      n.add(name);
    }
    return n;
  });
  const ok = sel.size >= c.min && sel.size <= c.max;
  return (
    <Slide k="card">
      {title(t)}
      {buying && (
        <div style={{position: 'sticky', top: -8, zIndex: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 14px', margin: '0 -4px 12px',
          borderRadius: 14, background: 'rgba(36,19,15,.92)', backdropFilter: 'blur(8px)', boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
          <span className="muted">{sel.size} card{sel.size === 1 ? '' : 's'} · 3 M€ each</span>
          <span><span className="num" style={{fontSize: 24, color: 'var(--mc)'}}>{mc - cost}</span><span className="faint"> M€ left</span></span>
        </div>
      )}
      {!buying && c.max > 1 && <p className="muted" style={{marginTop: -6}}>Pick {c.min === c.max ? c.min : `${c.min} to ${c.max}`}.</p>}
      {/keep and pass/i.test(t) && <p className="muted" style={{marginTop: -6}}>Keep one. The others move on, and you buy from what you kept after the draft.</p>}
      {input.optional && c.cards.some((x) => x.isDisabled) && (
        <p className="muted" style={{marginTop: -6}}>Your pick so far: <strong style={{color: 'var(--ice)'}}>{c.cards.filter((x) => x.isDisabled).map((x) => x.name).join(', ')}</strong>. Choose another card to switch.</p>
      )}
      <CardPicker cards={c.cards} selected={sel} onToggle={toggle} compact={c.selectBlueCardAction || c.cards.length > 6 && !buying} />
      {action && world && (
        <div style={{marginTop: 12}}>
          <EffectPreview p={project(world, action)} label={`What ${action.kind === 'action' ? action.card : ''} does`} />
          <PlanSlot model={ctx.model} first={action} firstLabel={moveLabel(action)} />
        </div>
      )}
      <div style={{position: 'sticky', bottom: -20, zIndex: 8, paddingTop: 14, paddingBottom: 4, background: 'linear-gradient(180deg, transparent, var(--dusk-1) 35%)'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
        {!single && sel.size > 0 && <KeepPile names={[...sel]} label={buying ? `${sel.size} to buy` : `${sel.size} picked`} />}
        <button className="btn warm" style={{flex: 1}} disabled={!ok || ctx.busy} onClick={() => onSubmit({type: 'card', cards: [...sel]})}>
          {buying ? (sel.size ? `Buy ${sel.size} for ${cost} M€` : 'Buy nothing') : c.selectBlueCardAction && sel.size ? `Use ${[...sel][0]}` : corpPick && sel.size ? `Found ${[...sel][0]}` : sel.size && single ? `Choose ${[...sel][0]}` : input.buttonLabel || 'Confirm'}
        </button>
        </div>
        <Back onBack={onBack} />
      </div>
    </Slide>
  );
}

function ProjectCardInput({input, ctx, onSubmit, onBack, preselect}: Props) {
  const pc = input as {cards: CardModel[]; paymentOptions: {heat?: boolean}};
  const isStandard = optionKind(input) === 'standard';
  const initial = preselect && pc.cards.find((c) => c.name === preselect && !c.isDisabled);
  const [card, setCard] = useState<CardModel | null>(initial || null);
  // the payment as it stands in the adjuster, for the preview ("−3 titanium · −14 M€ · ...")
  const [pay, setPay] = useState<ReturnType<typeof payment> | null>(null);
  const world = useWorld(ctx.model);
  if (card) {
    const def = cardDef(card.name);
    const cost = card.calculatedCost ?? def.cost ?? 0;
    const steel = !isStandard && def.tags.includes('building');
    const titanium = !isStandard && def.tags.includes('space');
    const move: Move = isStandard ? {kind: 'standard', project: card.name, ...(pay ? {payment: pay} : {})} : {kind: 'play', card: card.name, ...(pay ? {payment: pay} : {})};
    return (
      <Slide k={`pay-${card.name}`}>
        <FullCard card={card} cost={cost} compact={isStandard} />
        <div style={{height: 14}} />
        {world && <MovePreview world={world} move={move} />}
        <PaymentAdjuster model={ctx.model} cost={cost} steel={steel} titanium={titanium} heat={!!pc.paymentOptions?.heat}
          label={isStandard ? `Build ${def.name.toLowerCase()}` : `Play ${def.name}`} busy={ctx.busy} onChange={setPay}
          onPay={(p) => onSubmit({type: 'projectCard', card: card.name, payment: p})} />
        {world && <PlanSlot model={ctx.model} first={move} firstLabel={moveLabel(move)} />}
        <Back onBack={() => (initial ? onBack?.() : setCard(null))} />
      </Slide>
    );
  }
  if (isStandard) {
    return (
      <Slide k="sp">
        {title('Standard projects')}
        <div style={{display: 'grid', gap: 8}}>
          {pc.cards.map((c) => {
            const sp = standardProject(c.name);
            return (
              <motion.button key={c.name} data-card={c.name} whileTap={{scale: 0.98}} disabled={c.isDisabled} onClick={() => setCard(c)}
                style={{display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,.06)', textAlign: 'left', opacity: c.isDisabled ? 0.4 : 1}}>
                <span style={{flex: 1}}><div style={{fontWeight: 650}}>{sp?.name ?? c.name}</div><div className="muted" style={{fontSize: 13.5}}>{c.isDisabled ? standardProjectReason(c.name, c.calculatedCost ?? 0, ctx.model) : sp?.text}</div></span>
                <span className="num" style={{fontSize: 22, color: 'var(--mc)'}}>{c.calculatedCost}</span>
              </motion.button>
            );
          })}
        </div>
        <Back onBack={onBack} />
      </Slide>
    );
  }
  return <PlayList cards={pc.cards} onPick={setCard} onBack={onBack} />;
}

/** The effect preview of a move, worked out once per view and payment. */
function MovePreview({world, move}: {world: World; move: Move}) {
  const key = JSON.stringify(move);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const p = useMemo(() => project(world, move), [world, key]);
  return <EffectPreview p={p} />;
}

/** "Play a card": one row per playable card with what it does; the info button opens the full card. */
function PlayList({cards, onPick, onBack}: {cards: CardModel[]; onPick: (c: CardModel) => void; onBack?: () => void}) {
  const {peek, viewer} = useCardPeek(useMemo(() => cards.map((c) => ({name: c.name, def: cardDef(c.name), cost: c.calculatedCost ?? undefined})), [cards]));
  return (
    <Slide k="play">
      {title('Play a card')}
      <div style={{display: 'grid', gap: 8}}>
        {cards.map((c) => (
          <RowWithInfo key={c.name} name={c.name} onInfo={() => peek(c.name)}>
            <motion.button data-card={c.name} whileTap={{scale: 0.98}} disabled={c.isDisabled} onClick={() => onPick(c)}
              style={{display: 'block', width: '100%', textAlign: 'left', borderRadius: 16, opacity: c.isDisabled ? 0.4 : 1}}>
              <CardRow card={cardDef(c.name)} cost={c.calculatedCost ?? undefined} info />
            </motion.button>
          </RowWithInfo>
        ))}
      </div>
      {viewer}
      <Back onBack={onBack} />
    </Slide>
  );
}

function PaymentInput({input, ctx, onSubmit, onBack}: Props) {
  const p = input as {amount: number; paymentOptions: {heat?: boolean; steel?: boolean; titanium?: boolean}};
  return (
    <Slide k="payment">
      {title(msg(ctx.model, input.title))}
      <PaymentAdjuster model={ctx.model} cost={p.amount} steel={!!p.paymentOptions?.steel} titanium={!!p.paymentOptions?.titanium} heat={!!p.paymentOptions?.heat}
        label={input.buttonLabel || `Pay ${p.amount} M€`} busy={ctx.busy} onPay={(pay) => onSubmit({type: 'payment', payment: pay})} />
      <Back onBack={onBack} />
    </Slide>
  );
}

/** Steel/titanium/heat sliders that keep the total at the cost by moving M€ opposite. */
export function PaymentAdjuster({model, cost, steel, titanium, heat, label, busy, onPay, onChange}: {
  model: PlayerViewModel; cost: number; steel: boolean; titanium: boolean; heat: boolean; label: string; busy: boolean;
  onPay: (p: ReturnType<typeof payment>) => void;
  /** Reports the current payment (null when it does not cover the cost), e.g. for swipe-to-play. */
  onChange?: (p: ReturnType<typeof payment> | null) => void;
}) {
  const me = model.thisPlayer;
  const sv = me.steelValue, tv = me.titaniumValue;
  // titanium, then steel, then M€, then heat; a metal rounds up when M€ cannot cover the rest (shared with the preview)
  const suggest = () => defaultPayment(me, cost, {steel, titanium, heat});
  const [pay, setPay] = useState(suggest);
  const value = pay.megacredits + pay.steel * sv + pay.titanium * tv + pay.heat;
  useEffect(() => {
    onChange?.(value >= cost ? payment({megacredits: pay.megacredits, steel: pay.steel, titanium: pay.titanium, heat: pay.heat}) : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pay, cost]);
  const set = (k: 'steel' | 'titanium' | 'heat', n: number) => setPay((p) => {
    const next = {...p, [k]: n};
    const other = next.steel * sv + next.titanium * tv + next.heat;
    next.megacredits = Math.max(0, Math.min(me.megacredits, cost - other));
    return next;
  });
  return (
    <div>
      {titanium && me.titanium > 0 && <Stepper icon={<ResIcon r="titanium" />} label={`Titanium · ${tv} M€ each`} value={pay.titanium} max={me.titanium} set={(n) => set('titanium', n)} />}
      {steel && me.steel > 0 && <Stepper icon={<ResIcon r="steel" />} label={`Steel · ${sv} M€ each`} value={pay.steel} max={me.steel} set={(n) => set('steel', n)} />}
      {heat && me.heat > 0 && <Stepper icon={<ResIcon r="heat" />} label="Heat · 1 M€ each" value={pay.heat} max={me.heat} set={(n) => set('heat', n)} />}
      <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0'}}>
        <ResIcon r="megacredits" /><span style={{flex: 1}}>M€</span>
        <span className="num" style={{fontSize: 24}}>{pay.megacredits}</span><span className="faint">of {me.megacredits}</span>
      </div>
      {value < cost && <p role="alert" style={{color: 'var(--ember)', margin: '4px 0'}}>{cost - value} M€ short.</p>}
      <button className="btn warm" style={{width: '100%', marginTop: 10}} disabled={busy || value < cost}
        onClick={() => onPay(payment({megacredits: pay.megacredits, steel: pay.steel, titanium: pay.titanium, heat: pay.heat}))}>
        {busy ? 'Sending…' : `${label} · ${cost} M€`}
      </button>
    </div>
  );
}
