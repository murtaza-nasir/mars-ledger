import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {AWARD_COSTS, boardOf, GLOBAL, MILESTONE_COST, STANDARD_PROJECTS} from '../../shared/board';
import {findCard, getCard} from '../../shared/cards';
import {allTags, cardsInPlay, canUseHeat, STANDING_HELPERS} from '../../shared/engine';
import type {GameState, PlayerState} from '../../shared/game';
import {RESOURCES} from '../../shared/types';
import type {CardDef, Resource} from '../../shared/types';
import {useNet} from '../net';
import {CardFace} from '../ui/CardFace';
import {eventText} from '../ui/events';
import {PLAYER_HEX, RES_COLOR, RES_LABEL, ResIcon, TagIcon} from '../ui/Icons';
import {Rolling} from '../ui/Rolling';
import {Sheet} from '../ui/Sheet';
import {TabBar, TabPanels} from '../ui/Tabs';
import {useRenderCount} from '../perf/recorder';
import {GameChip} from '../ui/GameChip';
import {GameMenuButton} from '../ui/GameMenu';
import {ReactionsButton} from '../ui/Reactions';
import {NudgeButton, useSince} from './Nudge';
import {PhoneClock} from '../ui/ClockRing';
import {useTurnClock} from '../ui/useTurnClock';
import {PlayCard} from './PlayCard';
import {companionHints, NO_HINTS} from '../../shared/hints';
import type {TurnHint} from '../../shared/hints';
import {HintLine, useHintsOn} from '../ui/Hints';
import {Resolver, Stepper} from './Resolve';

type Tab = 'board' | 'cards' | 'mars' | 'log';
type SheetKind = null | 'play' | 'actions' | 'projects' | {adjust: Resource | 'tr'};

export function Board({state, me}: {state: GameState; me: PlayerState}) {
  useRenderCount('Board');
  const [tab, setTab] = useState<Tab>('board');
  const [sheet, setSheet] = useState<SheetKind>(null);
  const myTurn = state.phase === 'action' && state.current === me.id;
  const current = state.players.find((p) => p.id === state.current);
  const since = useSince(`${state.current ?? ''}:${state.seq}`);
  const live = useTurnClock();
  const close = () => setSheet(null);
  // Smart hints (personal, off by default): computed from our own engine's state, shown only on your turn.
  const hintsOn = useHintsOn(state, me.id);
  const hints = useMemo(() => (hintsOn ? companionHints(state, me.id) : NO_HINTS), [hintsOn, state, me.id]);
  const hintLine = hints.turn.length > 0 && sheet === null;

  return (
    <div style={{minHeight: '100svh', display: 'flex', flexDirection: 'column', paddingBottom: `calc(${hintLine ? 136 : 96}px + env(safe-area-inset-bottom))`}}>
      <Moments state={state} me={me} />
      <header style={{padding: 'calc(14px + env(safe-area-inset-top)) 20px 6px', display: 'flex', alignItems: 'center', gap: 12}}>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4, minWidth: 0}}>
            {/* the generation number never truncates; on narrow phones the game chip wraps onto its own line rather than
                running under the TR block; the corporation after it gives way to the game chip first */}
            <span className="faint" style={{fontSize: 13, flex: 'none', whiteSpace: 'nowrap'}}>Generation {state.generation}</span>
            {me.corporation && <span className="faint" style={{fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 100 auto', marginLeft: -4}}>· {me.corporation}</span>}
            <span style={{minWidth: 30, maxWidth: '100%', flex: '0 1 auto', display: 'flex'}}>
              <GameChip state={state} generation={state.generation}
                seats={state.order.map((id) => state.players.find((p) => p.id === id)).filter((p) => !!p).map((p) => ({name: p!.name, color: p!.color, corporation: p!.corporation}))} />
            </span>
          </div>
          <TurnChip state={state} me={me} current={current} />
          {/* the turn clock gets its own row, where others see the nudge, so "Your turn" is never squeezed */}
          <AnimatePresence>
            {live && live.clock.playerId === me.id && (
              <motion.div key="clock" initial={{opacity: 0, y: -4}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -4}}
                transition={{type: 'spring', stiffness: 380, damping: 26}} style={{marginTop: 6}}><PhoneClock live={live} /></motion.div>
            )}
          </AnimatePresence>
          {state.phase === 'action' && current && current.id !== me.id && (
            <div style={{marginTop: 6}}><NudgeButton from={me.id} to={current.id} toName={current.name} toColor={current.color} since={since}
              overTime={!!live && live.clock.playerId === current.id && live.reading.overTime} /></div>
          )}
        </div>
        <button onClick={() => setSheet({adjust: 'tr'})} aria-label={`Terraform rating ${me.tr}`} style={{position: 'relative', width: 70, height: 70, flex: 'none', display: 'grid', placeItems: 'center'}}>
          <svg viewBox="0 0 70 70" width="70" height="70" style={{position: 'absolute', inset: 0}}>
            <path d="M35 4 62 19.5v31L35 66 8 50.5v-31z" fill="rgba(111,184,232,.14)" stroke="var(--tr)" strokeWidth="2" />
          </svg>
          <span style={{position: 'relative', textAlign: 'center'}}>
            <Rolling value={me.tr} className="num" style={{fontSize: 26}} />
            <div className="cond" style={{fontSize: 11, color: 'var(--tr)', marginTop: -2}}>TR</div>
          </span>
        </button>
        <ReactionsButton playerId={me.id} />
        <GameMenuButton state={state} playerId={me.id} />
      </header>

      <TabBar gap={22} style={{padding: '6px 20px 12px'}} value={tab} onChange={setTab}
        tabs={(['board', 'cards', 'mars', 'log'] as Tab[]).map((t) => ({id: t, label: {board: 'Board', cards: 'Cards', mars: 'Mars', log: 'Log'}[t]}))} />

      <TabPanels value={tab} style={{padding: '0 16px', flex: 1}} panels={{
        board: () => <><Resources me={me} onAdjust={(r) => setSheet({adjust: r})} /><TagStrip me={me} /></>,
        cards: () => <Cards state={state} me={me} />,
        mars: () => <Mars state={state} me={me} />,
        log: () => <Log state={state} />,
      }} />

      <Dock state={state} me={me} myTurn={myTurn} open={setSheet} hints={hintLine ? hints.turn : []} />

      <Sheet open={sheet === 'play'} onClose={close} title="Play a card" tall><PlayCard state={state} me={me} onClose={close} /></Sheet>
      <Sheet open={sheet === 'actions'} onClose={close} title="Card actions" tall><Actions state={state} me={me} onClose={close} /></Sheet>
      <Sheet open={sheet === 'projects'} onClose={close} title="Projects" tall><Projects state={state} me={me} onClose={close} /></Sheet>
      <Sheet open={typeof sheet === 'object' && sheet !== null} onClose={close} title="Correct your board">
        {typeof sheet === 'object' && sheet && <Adjust me={me} focus={sheet.adjust} onClose={close} />}
      </Sheet>
    </div>
  );
}

function TurnChip({state, me, current}: {state: GameState; me: PlayerState; current?: PlayerState}) {
  const text = state.phase === 'research' ? 'Others are researching'
    : state.phase === 'finalGreenery' ? 'Final greenery conversion'
      : me.passed ? 'You passed' : current?.id === me.id ? (me.turnActions ? 'One more action' : 'Your turn')
        : current ? `${current.name}'s turn` : '';
  const hot = current?.id === me.id && state.phase === 'action';
  return (
    <AnimatePresence mode="wait">
      <motion.div key={text} initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}}
        style={{display: 'flex', alignItems: 'center', gap: 8, fontSize: 22, fontWeight: 750, fontVariationSettings: "'wdth' 88", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
        {current && !hot && state.phase === 'action' && <span style={{width: 10, height: 10, borderRadius: 3, background: PLAYER_HEX[current.color]}} />}
        {hot && <motion.span animate={{scale: [1, 1.35, 1]}} transition={{duration: 1.6, repeat: Infinity}} style={{width: 10, height: 10, borderRadius: 5, background: 'var(--mc)'}} />}
        {text}
      </motion.div>
    </AnimatePresence>
  );
}

// ---- resources -------------------------------------------------------------------------------
function Resources({me, onAdjust}: {me: PlayerState; onAdjust: (r: Resource) => void}) {
  const sweep = useProductionSweep();
  return (
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
      {RESOURCES.map((r, i) => <ResourceTile key={r} r={r} me={me} i={i} sweep={sweep} onAdjust={() => onAdjust(r)} />)}
    </div>
  );
}

function useProductionSweep() {
  const lastEvents = useNet((s) => s.lastEvents);
  const [k, setK] = useState(0);
  useEffect(() => { if (lastEvents.some((e) => e.kind === 'production')) setK(Date.now()); }, [lastEvents]);
  return k;
}

function ResourceTile({r, me, i, sweep, onAdjust}: {r: Resource; me: PlayerState; i: number; sweep: number; onAdjust: () => void}) {
  const timer = useRef<number | null>(null);
  const press = () => { timer.current = window.setTimeout(() => { navigator.vibrate?.(20); onAdjust(); }, 450); };
  const release = () => { if (timer.current) clearTimeout(timer.current); };
  const prod = me.production[r];
  const note = r === 'steel' && me.steelValue !== 2 ? `worth ${me.steelValue}` : r === 'titanium' && me.titaniumValue !== 3 ? `worth ${me.titaniumValue}`
    : r === 'plants' ? `greenery at ${me.greeneryCost}` : r === 'heat' ? 'temperature at 8' : r === 'megacredits' ? `+${me.tr} from TR` : null;
  return (
    <motion.div
      onPointerDown={press} onPointerUp={release} onPointerLeave={release} onContextMenu={(e) => { e.preventDefault(); onAdjust(); }}
      initial={{opacity: 0, y: 14}} animate={{opacity: 1, y: 0}} transition={{delay: i * 0.04}}
      style={{position: 'relative', overflow: 'hidden', borderRadius: 20, padding: '14px 14px 12px', userSelect: 'none', WebkitUserSelect: 'none',
        background: `linear-gradient(160deg, color-mix(in oklab, ${RES_COLOR[r]} 16%, var(--dusk-2)), var(--dusk-1))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${RES_COLOR[r]} 32%, transparent)`}}>
      {sweep > 0 && (
        <motion.div key={sweep} initial={{x: '-120%'}} animate={{x: '120%'}} transition={{duration: 0.9, delay: 0.25 + i * 0.12, ease: 'easeInOut'}}
          style={{position: 'absolute', inset: 0, background: `linear-gradient(100deg, transparent 20%, color-mix(in oklab, ${RES_COLOR[r]} 45%, transparent) 50%, transparent 80%)`}} />
      )}
      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
        <ResIcon r={r} size={22} />
        <span className="cond" style={{fontSize: 15, fontWeight: 600, color: 'var(--ice-dim)'}}>{RES_LABEL[r]}</span>
      </div>
      <div style={{display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8}}>
        <Rolling value={me.stock[r]} className="num" style={{fontSize: 46}} />
        <div style={{textAlign: 'right'}}>
          <div className="num" style={{fontSize: 20, color: RES_COLOR[r], padding: '3px 9px', borderRadius: 9, background: 'rgba(0,0,0,.25)',
            boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${RES_COLOR[r]} 55%, transparent)`}}>
            {prod > 0 ? '+' : prod < 0 ? '−' : ''}<Rolling value={Math.abs(prod)} showDelta={false} />
          </div>
        </div>
      </div>
      {note && <div className="faint" style={{fontSize: 12, marginTop: 6}}>{note}</div>}
    </motion.div>
  );
}

function TagStrip({me}: {me: PlayerState}) {
  const tags = Object.entries(allTags(me)).filter(([t]) => t !== 'event' || true).sort((a, b) => b[1] - a[1]);
  if (!tags.length) return null;
  return (
    <div style={{display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16}}>
      {tags.map(([t, n]) => (
        <motion.span key={t} layout style={{display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px 4px 4px', borderRadius: 999, background: 'rgba(255,255,255,.05)'}}>
          <TagIcon tag={t} size={24} /><span className="num" style={{fontSize: 16}}>{n}</span>
        </motion.span>
      ))}
    </div>
  );
}

// ---- dock ------------------------------------------------------------------------------------
function Dock({state, me, myTurn, open, hints}: {state: GameState; me: PlayerState; myTurn: boolean; open: (s: SheetKind) => void; hints: TurnHint[]}) {
  const {send, undo, lastTick} = useNet();
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<void>) => p.then(() => setError(null)).catch((e) => setError(e.message));
  const ready = availableActions(me).length;
  const canUndo = lastTick && 'playerId' in lastTick.command && lastTick.command.playerId === me.id && !['join', 'start'].includes(lastTick.command.t);
  const finalGreenery = state.phase === 'finalGreenery';

  return (
    <div style={{position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '10px 12px calc(12px + env(safe-area-inset-bottom))',
      background: 'linear-gradient(180deg, transparent, rgba(20,9,6,.92) 30%)'}}>
      {hints.length > 0 && <HintLine hints={hints} />}
      <AnimatePresence>
        {error && <motion.p role="alert" initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} onClick={() => setError(null)}
          style={{margin: '0 4px 8px', color: 'var(--ember)', fontWeight: 600}}>{error}</motion.p>}
        {canUndo && (
          <motion.button key={lastTick!.seq} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}}
            onClick={() => run(undo(me.id))} style={{display: 'block', margin: '0 auto 8px', fontSize: 14, padding: '6px 14px', borderRadius: 999, background: 'rgba(255,255,255,.08)'}}>
            Undo your last move
          </motion.button>
        )}
        {me.preludeCardPlay && myTurn && (
          <motion.div key="prelude-card" initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} role="status"
            style={{margin: '0 2px 10px', padding: '12px 14px', borderRadius: 14, background: 'rgba(201,138,46,.16)', boxShadow: 'inset 0 0 0 1.5px #C98A2E'}}>
            <div style={{fontWeight: 650}}>{me.preludeCardPlay}</div>
            <div style={{display: 'flex', gap: 8, marginTop: 10}}>
              <button className="btn warm" style={{flex: 1, minHeight: 42}} onClick={() => open('play')}>Play a card</button>
              <button className="btn ghost" style={{flex: 1, minHeight: 42}} onClick={() => run(send({t: 'skipPreludeCard', playerId: me.id}))}>Play no card</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {finalGreenery ? (
        <button className="btn warm" style={{width: '100%'}} disabled={me.stock.plants < me.greeneryCost} onClick={() => open('projects')}>Convert plants to greenery</button>
      ) : (
        <div style={{display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 1fr', gap: 8, opacity: myTurn ? 1 : 0.45, transition: 'opacity .3s'}}>
          <button className="btn warm" style={{padding: 0}} disabled={!myTurn} onClick={() => open('play')}>Play card</button>
          <button className="btn ghost" style={{padding: 0, position: 'relative'}} disabled={!myTurn} onClick={() => open('actions')}>
            Actions{ready > 0 && <span className="num" style={{position: 'absolute', top: -6, right: -4, fontSize: 12, minWidth: 20, height: 20, borderRadius: 10, background: 'var(--tr)', color: 'var(--dusk-1)', display: 'grid', placeItems: 'center'}}>{ready}</span>}
          </button>
          <button className="btn ghost" style={{padding: 0}} disabled={!myTurn} onClick={() => open('projects')}>Projects</button>
          {me.turnActions > 0
            ? <button className="btn ghost" style={{padding: 0}} disabled={!myTurn} onClick={() => run(send({t: 'endTurn', playerId: me.id}))}>End turn</button>
            : <button className="btn ghost" style={{padding: 0}} disabled={!myTurn} onClick={() => run(send({t: 'pass', playerId: me.id}))}>Pass</button>}
        </div>
      )}
    </div>
  );
}

function availableActions(me: PlayerState): CardDef[] {
  const out: CardDef[] = [];
  for (const c of cardsInPlay(me)) {
    if (c.group === 'corporation' && c.firstAction && !me.usedActions.includes('first:' + c.name)) out.push(c);
    else if (c.action && !me.usedActions.includes(c.name)) out.push(c);
  }
  return out;
}

function Actions({state, me, onClose}: {state: GameState; me: PlayerState; onClose: () => void}) {
  const [pick, setPick] = useState<CardDef | null>(null);
  const all = cardsInPlay(me).filter((c) => c.action || (c.group === 'corporation' && c.firstAction));
  if (pick) {
    return <>
      <CardFace card={pick} compact />
      <div style={{height: 14}} />
      <Resolver state={state} command={{t: 'action', playerId: me.id, card: pick.name, payment: {}, answers: []}} confirmLabel={`Use ${pick.name}`} onDone={onClose} onBack={() => setPick(null)} />
    </>;
  }
  if (!all.length) return <p className="muted">Blue cards with actions appear here once you play them.</p>;
  return (
    <div style={{display: 'grid', gap: 10}}>
      {all.map((c) => {
        const first = c.group === 'corporation' && c.firstAction && !me.usedActions.includes('first:' + c.name);
        const used = !first && me.usedActions.includes(c.name);
        return (
          <motion.button key={c.name} layout disabled={used} onClick={() => setPick(c)} whileTap={{scale: 0.98}}
            style={{position: 'relative', textAlign: 'left', opacity: used ? 0.45 : 1, filter: used ? 'grayscale(.8)' : 'none'}}>
            <CardFace card={c} compact />
            <div style={{display: 'flex', justifyContent: 'space-between', padding: '6px 6px 0', fontSize: 14}}>
              <span className="muted">{first ? 'First action' : c.action ? actionText(c) : ''}</span>
              <span style={{color: used ? 'var(--ice-faint)' : 'var(--tr)', fontWeight: 650}}>{used ? 'Used this generation' : 'Ready'}</span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

function actionText(c: CardDef): string {
  const t = c.text.find((x) => /^Action/i.test(x)) ?? c.text[0] ?? '';
  return t.replace(/^\(?Action:\s*/i, '').replace(/\)$/, '');
}

function Projects({state, me, onClose}: {state: GameState; me: PlayerState; onClose: () => void}) {
  type P = {command: Parameters<typeof Resolver>[0]['command']; label: string};
  const [pick, setPick] = useState<P | null>(null);
  const {send} = useNet();
  const [error, setError] = useState<string | null>(null);
  if (pick) return <Resolver state={state} command={pick.command} confirmLabel={pick.label} onDone={onClose} onBack={() => setPick(null)} />;
  const heat = canUseHeat(me) ? me.stock.heat : 0;
  const row = (key: string, title: string, sub: string, cost: number | null, disabled: boolean, onClick: () => void, color = 'var(--mc)') => (
    <motion.button key={key} whileTap={{scale: 0.98}} disabled={disabled} onClick={onClick}
      style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,.05)', textAlign: 'left', opacity: disabled ? 0.4 : 1}}>
      <span style={{flex: 1}}><div style={{fontWeight: 650}}>{title}</div><div className="muted" style={{fontSize: 14}}>{sub}</div></span>
      {cost !== null && <span className="num" style={{fontSize: 22, color}}>{cost}</span>}
    </motion.button>
  );
  const final = state.phase === 'finalGreenery';
  return (
    <div style={{display: 'grid', gap: 8}}>
      {row('plants', 'Greenery from plants', me.stock.plants < me.greeneryCost ? `${me.greeneryCost} plants needed, you have ${me.stock.plants}` : `Spend ${me.greeneryCost} plants`, me.greeneryCost, me.stock.plants < me.greeneryCost,
        () => setPick({command: {t: 'convertPlants', playerId: me.id, answers: []}, label: 'Place greenery'}), 'var(--plants)')}
      {!final && row('heat', 'Temperature from heat', state.global.temperature >= GLOBAL.temperature.max ? 'Temperature is at its maximum'
        : me.stock.heat < 8 ? `8 heat needed, you have ${me.stock.heat}` : 'Spend 8 heat', 8, me.stock.heat < 8 || state.global.temperature >= GLOBAL.temperature.max,
        () => setPick({command: {t: 'convertHeat', playerId: me.id, answers: []}, label: 'Raise temperature'}), 'var(--heat)')}
      {!final && <>
        <h3 className="cond" style={{margin: '14px 0 2px', fontWeight: 600, color: 'var(--ice-dim)'}}>Standard projects</h3>
        {STANDARD_PROJECTS.map((sp) => row(sp.id, sp.name,
          sp.id === 'sellPatents' && me.handSize < 1 ? 'No cards to sell' : sp.cost > me.stock.megacredits + heat ? `${sp.cost} M€ needed, you have ${me.stock.megacredits + heat} M€` : sp.text,
          sp.cost || null, sp.cost > me.stock.megacredits + heat || (sp.id === 'sellPatents' && me.handSize < 1),
          () => setPick({command: {t: 'standardProject', playerId: me.id, project: sp.id, payment: {megacredits: Math.min(sp.cost, me.stock.megacredits), heat: Math.max(0, sp.cost - me.stock.megacredits)}, answers: []}, label: sp.name})))}
        <h3 className="cond" style={{margin: '14px 0 2px', fontWeight: 600, color: 'var(--ice-dim)'}}>{boardOf(state).title} milestones · {MILESTONE_COST} M€</h3>
        {boardOf(state).milestones.map((m) => {
          const claimed = state.milestones.find((x) => x.name === m.name);
          const v = m.value(me, STANDING_HELPERS);
          // Standings that depend on the physical board are claimed on trust: count them on the table.
          const detail = v === null ? `${m.text} · check it on the board` : m.manual ? `${m.text} · the table checks it` : `${m.text} · you have ${v}`;
          return row(m.name, m.name, claimed ? `Claimed by ${state.players.find((p) => p.id === claimed.claimedBy)?.name}` : detail, null,
            !!claimed || state.milestones.length >= 3 || me.stock.megacredits < MILESTONE_COST || (m.goal !== undefined && !m.manual && v !== null && v < m.goal),
            () => send({t: 'claimMilestone', playerId: me.id, milestone: m.name}).then(onClose).catch((e) => setError(e.message)));
        })}
        <h3 className="cond" style={{margin: '14px 0 2px', fontWeight: 600, color: 'var(--ice-dim)'}}>Awards · {AWARD_COSTS[state.awards.length] ?? '—'} M€</h3>
        {boardOf(state).awards.map((a) => {
          const funded = state.awards.find((x) => x.name === a.name);
          return row(a.name, a.name, funded ? `Funded by ${state.players.find((p) => p.id === funded.fundedBy)?.name}` : a.manual ? `${a.text} · counted on the board at the end` : a.text, null,
            !!funded || state.awards.length >= 3 || me.stock.megacredits < (AWARD_COSTS[state.awards.length] ?? 99),
            () => send({t: 'fundAward', playerId: me.id, award: a.name}).then(onClose).catch((e) => setError(e.message)));
        })}
      </>}
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
    </div>
  );
}

function Adjust({me, focus, onClose}: {me: PlayerState; focus: Resource | 'tr'; onClose: () => void}) {
  const send = useNet((s) => s.send);
  const [stock, setStock] = useState<Record<string, number>>({});
  const [prod, setProd] = useState<Record<string, number>>({});
  const [tr, setTr] = useState(0);
  const [hand, setHand] = useState(0);
  const list: Resource[] = focus === 'tr' ? [] : [focus, ...RESOURCES.filter((r) => r !== focus)];
  const save = () => send({t: 'adjust', playerId: me.id, target: me.id, stock, production: prod, tr, handSize: hand, note: `${me.name} corrected their board`}).then(onClose);
  return (
    <div>
      <p className="muted" style={{marginTop: 0}}>Use this when the app and the table disagree. Everyone sees the correction in the log.</p>
      <Stepper label={`TR (now ${me.tr})`} value={tr} set={setTr} min={-20} max={20} icon={<ResIcon r="tr" />} />
      <Stepper label={`Cards in hand (now ${me.handSize})`} value={hand} set={setHand} min={-me.handSize} max={20} />
      {list.map((r) => (
        <div key={r} style={{borderTop: '1px solid var(--rim)', marginTop: 6}}>
          <Stepper label={`${RES_LABEL[r]} (now ${me.stock[r]})`} value={stock[r] ?? 0} set={(n) => setStock((x) => ({...x, [r]: n}))} min={-me.stock[r]} max={99} icon={<ResIcon r={r} />} />
          <Stepper label={`${RES_LABEL[r]} production (now ${me.production[r]})`} value={prod[r] ?? 0} set={(n) => setProd((x) => ({...x, [r]: n}))} min={-10} max={10} icon={<span style={{width: 22}} />} />
        </div>
      ))}
      <button className="btn warm" style={{width: '100%', marginTop: 14}} onClick={save}>Save correction</button>
    </div>
  );
}

// ---- other tabs ------------------------------------------------------------------------------
function Cards({state, me}: {state: GameState; me: PlayerState}) {
  const send = useNet((s) => s.send);
  const cards = [...me.played].reverse();
  if (!cards.length && !me.corporation) return <p className="muted">Cards you play appear here with their tags and resources.</p>;
  return (
    <div style={{display: 'grid', gap: 10}}>
      {me.corporation && <CardFace card={getCard(me.corporation)} compact />}
      {cards.map((pc) => {
        const c = findCard(pc.name);
        if (!c) return null;
        return (
          <motion.div key={pc.name} layout initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}}>
            <CardFace card={c} compact />
            {c.resourceType && (
              <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 0'}}>
                <span className="muted" style={{flex: 1, fontSize: 14}}>{c.resourceType} on this card</span>
                <button aria-label="remove one" onClick={() => send({t: 'adjust', playerId: me.id, target: me.id, cardResources: {card: pc.name, delta: -1}})} style={{width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.06)'}}>−</button>
                <Rolling value={pc.resources} className="num" style={{fontSize: 22}} />
                <button aria-label="add one" onClick={() => send({t: 'adjust', playerId: me.id, target: me.id, cardResources: {card: pc.name, delta: 1}})} style={{width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.06)'}}>+</button>
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

function Mars({state, me}: {state: GameState; me: PlayerState}) {
  const send = useNet((s) => s.send);
  const g = state.global;
  const gauge = (param: 'temperature' | 'oxygen' | 'oceans', label: string, unit: string, color: string) => {
    const spec = GLOBAL[param];
    const pct = (g[param] - spec.min) / (spec.max - spec.min);
    return (
      <div style={{padding: '14px 16px', borderRadius: 16, background: 'rgba(255,255,255,.04)'}}>
        <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
          <span className="cond" style={{fontWeight: 600, color: 'var(--ice-dim)'}}>{label}</span>
          <span><Rolling value={g[param]} className="num" style={{fontSize: 30}} /><span className="faint"> {unit}</span></span>
        </div>
        <div style={{height: 8, borderRadius: 4, background: 'rgba(255,255,255,.08)', marginTop: 10, overflow: 'hidden'}}>
          <motion.div initial={false} animate={{width: `${pct * 100}%`}} transition={{type: 'spring', stiffness: 90, damping: 18}} style={{height: '100%', background: color, borderRadius: 4}} />
        </div>
        <div style={{display: 'flex', gap: 8, marginTop: 10}}>
          <button className="btn ghost" style={{minHeight: 36, flex: 1, fontSize: 14}} onClick={() => send({t: 'setGlobal', playerId: me.id, param, value: g[param] - spec.step})}>Lower</button>
          <button className="btn ghost" style={{minHeight: 36, flex: 1, fontSize: 14}} onClick={() => send({t: 'setGlobal', playerId: me.id, param, value: g[param] + spec.step})}>Raise</button>
        </div>
      </div>
    );
  };
  return (
    <div style={{display: 'grid', gap: 10}}>
      <p className="muted" style={{margin: '0 0 4px', fontSize: 14}}>These follow every card automatically. Correct them here only if the board shows something different; corrections give no TR.</p>
      {gauge('temperature', 'Temperature', '°C', 'linear-gradient(90deg, #6FB8E8, #F0643A)')}
      {gauge('oxygen', 'Oxygen', '%', 'var(--plants)')}
      {gauge('oceans', 'Oceans', 'of 9', 'var(--ocean)')}
    </div>
  );
}

function Log({state}: {state: GameState}) {
  const recent = useNet((s) => s.recent);
  const lines = [...recent].reverse().flatMap((t) => t.events.map((e, i) => ({k: `${t.seq}-${i}`, text: eventText(state, e), e})).filter((x) => x.text));
  return (
    <ol style={{listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2}}>
      {lines.map((l) => {
        const p = 'player' in l.e && l.e.player ? state.players.find((x) => x.id === (l.e as {player: string}).player) : undefined;
        return (
          <li key={l.k} style={{padding: '9px 0 9px 12px', borderLeft: `3px solid ${p ? PLAYER_HEX[p.color] : 'var(--rim)'}`, fontSize: 15}}>{l.text}</li>
        );
      })}
    </ol>
  );
}

// ---- moments: your turn, attacks, production -------------------------------------------------
function Moments({state, me}: {state: GameState; me: PlayerState}) {
  const lastTick = useNet((s) => s.lastTick);
  const [m, setM] = useState<{k: number; text: string; tone: 'turn' | 'attack' | 'production'} | null>(null);
  useEffect(() => {
    if (!lastTick) return;
    const ev = lastTick.events;
    const attack = ev.find((e) => e.kind === 'attack' && e.target === me.id);
    const prod = ev.find((e) => e.kind === 'production');
    const turn = ev.find((e) => e.kind === 'turn' && e.player === me.id);
    let next: typeof m = null;
    if (attack && attack.kind === 'attack') next = {k: lastTick.seq, tone: 'attack', text: `${state.players.find((p) => p.id === attack.player)?.name}: ${attack.what}`};
    else if (prod) next = {k: lastTick.seq, tone: 'production', text: 'Production'};
    else if (turn) next = {k: lastTick.seq, tone: 'turn', text: 'Your turn'};
    if (!next) return;
    setM(next);
    if (next.tone !== 'production') navigator.vibrate?.(next.tone === 'attack' ? [40, 60, 40] : 50);
    const t = setTimeout(() => setM(null), next.tone === 'production' ? 2200 : 1700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastTick?.seq]);
  const color = m?.tone === 'attack' ? 'var(--ember)' : m?.tone === 'production' ? 'var(--mc)' : 'var(--tr)';
  return (
    <AnimatePresence>
      {m && (
        <motion.div key={m.k} role="status" aria-live="polite"
          initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
          style={{position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', display: 'grid', placeItems: 'center',
            background: `radial-gradient(60% 40% at 50% 45%, color-mix(in oklab, ${color} 30%, transparent), transparent 70%)`}}>
          <motion.div initial={{scale: 0.6, opacity: 0, letterSpacing: '0.3em'}} animate={{scale: 1, opacity: 1, letterSpacing: '0em', x: m.tone === 'attack' ? [0, -10, 10, -6, 6, 0] : 0}}
            exit={{scale: 1.15, opacity: 0}} transition={{type: 'spring', stiffness: 260, damping: 20}}
            style={{fontSize: m.tone === 'attack' ? 30 : 54, fontWeight: 850, fontVariationSettings: "'wdth' 120", color, textAlign: 'center', padding: '0 24px', textShadow: '0 4px 30px rgba(0,0,0,.6)'}}>
            {m.text}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
