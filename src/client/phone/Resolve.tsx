// Runs a move through the engine locally, asks for each decision it needs,
// then shows what will change before anything is sent to the table.
import {AnimatePresence, motion} from 'motion/react';
import {useMemo, useState} from 'react';
import {preview} from '../../shared/engine';
import type {Prompt} from '../../shared/engine';
import type {Answer, Command, GameState, PlayerState} from '../../shared/game';
import {RESOURCES} from '../../shared/types';
import type {Resource} from '../../shared/types';
import {useNet} from '../net';
import {PLAYER_HEX, RES_LABEL, ResIcon} from '../ui/Icons';
import {FindCard} from './PlayCard';

type WithAnswers = Extract<Command, {answers: Answer[]}>;

export function Resolver({state, command, confirmLabel, onDone, onBack, onLaunch}: {
  state: GameState; command: WithAnswers; confirmLabel: string; onDone: () => void; onBack?: () => void;
  /** Playing a card: 'go' when it leaves for the table, 'back' if the table refused it. */
  onLaunch?: (phase: 'go' | 'back') => void;
}) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const send = useNet((s) => s.send);
  const flick = useNet((s) => s.flick);
  const cancelFlick = useNet((s) => s.cancelFlick);
  const full = useMemo(() => ({...command, answers}) as WithAnswers, [command, answers]);
  const result = useMemo(() => preview(state, full), [state, full]);

  const answer = (a: Answer) => setAnswers((xs) => [...xs, a]);
  const back = () => { if (answers.length) setAnswers((xs) => xs.slice(0, -1)); else onBack?.(); };

  async function commit() {
    setSending(true); setSendError(null);
    // A played card flies off the phone toward the TV as the move is sent.
    const fid = full.t === 'playCard' ? flick(full.playerId, full.card) : null;
    if (fid) { onLaunch?.('go'); navigator.vibrate?.(18); }
    const t0 = Date.now();
    try {
      await send(full);
      // let the card finish leaving the phone before the sheet closes
      if (fid) await new Promise((r) => setTimeout(r, Math.max(0, 520 - (Date.now() - t0))));
      onDone();
    } catch (e) {
      if (fid) { cancelFlick(fid, full.playerId); onLaunch?.('back'); }
      setSendError((e as Error).message);
    } finally { setSending(false); }
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div key={answers.length + (result.ok ? 'ok' : 'p')}
        initial={{opacity: 0, x: 28}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: -28}} transition={{duration: 0.22}}>
        {!result.ok && 'prompt' in result && <PromptView prompt={result.prompt} state={state} me={command.playerId} onAnswer={answer} />}
        {!result.ok && 'error' in result && <p role="alert" style={{color: 'var(--ember)', fontWeight: 600}}>{result.error}</p>}
        {result.ok && (
          <>
            <Diff before={state} after={result.state} me={command.playerId} />
            {result.events.filter((e) => e.kind === 'note').map((e, i) => (
              <p key={i} className="muted" style={{margin: '6px 0', fontSize: 15}}>{'text' in e ? e.text : ''}</p>
            ))}
            {sendError && <p role="alert" style={{color: 'var(--ember)', fontWeight: 600}}>{sendError}</p>}
            <button className="btn warm" style={{width: '100%', marginTop: 16}} disabled={sending} onClick={commit}>
              {sending ? 'Sending…' : confirmLabel}
            </button>
          </>
        )}
        {(answers.length > 0 || onBack) && (
          <button className="btn ghost" style={{width: '100%', marginTop: 10}} onClick={back}>
            {answers.length ? 'Change last answer' : 'Back'}
          </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

// ---- what changes ----------------------------------------------------------------------------
type Line = {who: PlayerState; items: Array<{label: string; icon?: Resource | 'tr'; delta: number; prod?: boolean}>};

export function diffLines(before: GameState, after: GameState): {lines: Line[]; globals: Array<{label: string; from: number; to: number}>} {
  const lines: Line[] = [];
  for (const b of before.players) {
    const a = after.players.find((p) => p.id === b.id)!;
    const items: Line['items'] = [];
    for (const r of RESOURCES) {
      if (a.production[r] !== b.production[r]) items.push({label: RES_LABEL[r], icon: r, delta: a.production[r] - b.production[r], prod: true});
    }
    for (const r of RESOURCES) if (a.stock[r] !== b.stock[r]) items.push({label: RES_LABEL[r], icon: r, delta: a.stock[r] - b.stock[r]});
    if (a.tr !== b.tr) items.push({label: 'TR', icon: 'tr', delta: a.tr - b.tr});
    if (a.handSize !== b.handSize) items.push({label: 'cards in hand', delta: a.handSize - b.handSize});
    for (const pc of a.played) {
      const old = b.played.find((x) => x.name === pc.name);
      if (old && old.resources !== pc.resources) items.push({label: `on ${pc.name}`, delta: pc.resources - old.resources});
    }
    if (items.length) lines.push({who: a, items});
  }
  const globals: Array<{label: string; from: number; to: number}> = [];
  if (after.global.temperature !== before.global.temperature) globals.push({label: 'Temperature °C', from: before.global.temperature, to: after.global.temperature});
  if (after.global.oxygen !== before.global.oxygen) globals.push({label: 'Oxygen %', from: before.global.oxygen, to: after.global.oxygen});
  if (after.global.oceans !== before.global.oceans) globals.push({label: 'Oceans', from: before.global.oceans, to: after.global.oceans});
  return {lines, globals};
}

function Diff({before, after, me}: {before: GameState; after: GameState; me: string}) {
  const {lines, globals} = diffLines(before, after);
  const sorted = [...lines].sort((x) => (x.who.id === me ? -1 : 1));
  return (
    <div style={{display: 'grid', gap: 14}}>
      {sorted.map((l, i) => (
        <motion.div key={l.who.id} initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: i * 0.06}}>
          <div style={{fontWeight: 700, fontVariationSettings: "'wdth' 80", color: PLAYER_HEX[l.who.color], marginBottom: 6}}>
            {l.who.id === me ? 'You' : l.who.name}
          </div>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
            {l.items.map((it, k) => (
              <span key={k} style={{display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 999,
                background: it.prod ? 'rgba(176,122,69,.18)' : 'rgba(255,255,255,.06)', boxShadow: it.prod ? 'inset 0 0 0 1.5px rgba(176,122,69,.55)' : 'none'}}>
                {it.icon && <ResIcon r={it.icon} size={18} />}
                <span className="num" style={{fontSize: 17, color: it.delta > 0 ? 'var(--plants)' : 'var(--ember)'}}>{it.delta > 0 ? '+' : '−'}{Math.abs(it.delta)}</span>
                <span style={{fontSize: 14}} className="muted">{it.prod ? `${it.label} production` : it.label}</span>
              </span>
            ))}
          </div>
        </motion.div>
      ))}
      {globals.map((g) => (
        <div key={g.label} style={{display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 12, background: 'rgba(47,130,192,.14)'}}>
          <span>{g.label}</span><span className="num">{g.from} → {g.to}</span>
        </div>
      ))}
      {!lines.length && !globals.length && <p className="muted">Nothing on the player boards changes.</p>}
    </div>
  );
}

// ---- questions -------------------------------------------------------------------------------
function PromptView({prompt, state, me, onAnswer}: {prompt: Prompt; state: GameState; me: string; onAnswer: (a: Answer) => void}) {
  const title = <h3 style={{margin: '4px 0 14px', fontSize: 20, fontWeight: 700, fontVariationSettings: "'wdth' 85"}}>{prompt.title}</h3>;
  const opt = (label: React.ReactNode, onClick: () => void, key: string | number, accent?: string) => (
    <motion.button key={key} whileTap={{scale: 0.97}} onClick={onClick}
      style={{width: '100%', textAlign: 'left', padding: '16px 18px', borderRadius: 14, marginBottom: 10, fontSize: 17, fontWeight: 600,
        background: 'rgba(255,255,255,.06)', boxShadow: `inset 3px 0 0 ${accent ?? 'var(--rim-strong)'}`}}>{label}</motion.button>
  );
  switch (prompt.kind) {
  case 'or':
    return <>{title}{prompt.options.map((o, i) => opt(o, () => onAnswer({kind: 'or', index: i}), i))}</>;
  case 'player':
    return <>{title}
      {prompt.candidates.map((id) => {
        const p = state.players.find((x) => x.id === id)!;
        return opt(id === me ? `${p.name} (you)` : p.name, () => onAnswer({kind: 'player', playerId: id}), id, PLAYER_HEX[p.color]);
      })}
      {prompt.allowNone && opt('Nobody', () => onAnswer({kind: 'player', playerId: null}), 'none')}
    </>;
  case 'card':
    return <>{title}
      {prompt.candidates.map((c) => {
        const p = state.players.find((x) => x.id === c.owner)!;
        return opt(<span>{c.card} <span className="faint">· {c.owner === me ? 'yours' : p.name} · {c.resources} here</span></span>,
          () => onAnswer({kind: 'card', owner: c.owner, card: c.card}), c.owner + c.card, PLAYER_HEX[p.color]);
      })}
      {prompt.allowNone && opt('None', () => onAnswer({kind: 'card', owner: me, card: null}), 'none')}
    </>;
  case 'yesno':
    return <>{title}<div style={{display: 'flex', gap: 10}}>
      <button className="btn warm" style={{flex: 1}} onClick={() => onAnswer({kind: 'yesno', yes: true})}>Yes</button>
      <button className="btn ghost" style={{flex: 1}} onClick={() => onAnswer({kind: 'yesno', yes: false})}>No</button>
    </div></>;
  case 'resource':
    return <>{title}<div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10}}>
      {prompt.options.map((r) => <button key={r} className="btn ghost" onClick={() => onAnswer({kind: 'resource', resource: r})}><ResIcon r={r} /> {RES_LABEL[r]}</button>)}
    </div></>;
  case 'amount':
    return <AmountPrompt title={title} min={prompt.min} max={prompt.max} onAnswer={(v) => onAnswer({kind: 'amount', value: v})} />;
  case 'tile':
    return <TilePrompt prompt={prompt} title={title} onAnswer={onAnswer} />;
  case 'manual':
    return <>{title}<p style={{fontSize: 17}}>{prompt.text}</p>
      <p className="muted" style={{fontSize: 14}}>Adjust any numbers afterwards by pressing and holding a resource on your board.</p>
      <button className="btn warm" style={{width: '100%'}} onClick={() => onAnswer({kind: 'ack'})}>Done</button></>;
  case 'pickCard':
    return <>{title}
      <p className="muted" style={{marginTop: -6}}>Enter the one you play: its number, its name, or a photo.</p>
      <FindCard state={state} group={prompt.group} exclude={new Set(prompt.exclude)} onPick={(c) => onAnswer({kind: 'pickCard', card: c.name})} />
    </>;
  default:
    return <>{title}<p className="muted">This question type is not supported on this phone yet.</p></>;
  }
}

export function Stepper({value, set, min = 0, max = 99, label, icon}: {value: number; set: (n: number) => void; min?: number; max?: number; label: React.ReactNode; icon?: React.ReactNode}) {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0'}}>
      {icon}
      <span style={{flex: 1, fontSize: 16}}>{label}</span>
      <button className="btn ghost" style={{minHeight: 44, width: 44, padding: 0}} aria-label="less" onClick={() => set(Math.max(min, value - 1))}>−</button>
      <span className="num" style={{width: 44, textAlign: 'center', fontSize: 24}}>{value}</span>
      <button className="btn ghost" style={{minHeight: 44, width: 44, padding: 0}} aria-label="more" onClick={() => set(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

function AmountPrompt({title, min, max, onAnswer}: {title: React.ReactNode; min: number; max: number; onAnswer: (n: number) => void}) {
  const [v, setV] = useState(min);
  return <>{title}<Stepper value={v} set={setV} min={min} max={max} label="Amount" />
    <button className="btn warm" style={{width: '100%', marginTop: 10}} onClick={() => onAnswer(v)}>Confirm {v}</button></>;
}

const TILE_BONUS: Array<{key: Resource | 'cards'; label: string}> = [
  {key: 'steel', label: 'Steel'}, {key: 'titanium', label: 'Titanium'}, {key: 'plants', label: 'Plants'},
  {key: 'cards', label: 'Cards drawn'}, {key: 'megacredits', label: 'M€ from adjacent oceans'},
];

function TilePrompt({prompt, title, onAnswer}: {prompt: Extract<Prompt, {kind: 'tile'}>; title: React.ReactNode; onAnswer: (a: Answer) => void}) {
  const [bonus, setBonus] = useState<Record<string, number>>({});
  const [onMars, setOnMars] = useState(true);
  return <>
    {title}
    <p className="muted" style={{marginTop: -6}}>Put the tile on the board, then enter what the space gave you.</p>
    {TILE_BONUS.map((b) => (
      <Stepper key={b.key} value={bonus[b.key] ?? 0} set={(n) => setBonus((x) => ({...x, [b.key]: n}))} label={b.label}
        max={b.key === 'megacredits' ? 12 : 4} icon={b.key !== 'cards' ? <ResIcon r={b.key as Resource} size={20} /> : <span style={{width: 20}} />} />
    ))}
    {prompt.askOnMars && (
      <label style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0'}}>
        <input type="checkbox" checked={onMars} onChange={(e) => setOnMars(e.target.checked)} style={{width: 22, height: 22}} />
        The city is on Mars
      </label>
    )}
    <button className="btn warm" style={{width: '100%', marginTop: 10}}
      onClick={() => onAnswer({kind: 'tile', bonus, onMars: prompt.askOnMars ? onMars : undefined})}>Tile placed</button>
  </>;
}
