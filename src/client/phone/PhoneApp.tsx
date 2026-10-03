import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import {cardsFor, getCard} from '../../shared/cards';
import {boardOf, CARD_BUY_COST} from '../../shared/board';
import {score} from '../../shared/engine';
import {PLAYER_COLORS} from '../../shared/game';
import {BOT_LEVEL_INFO, BOT_LEVELS, MAX_SEATS, nextBotName} from '../../shared/bots';
import type {BotLevel} from '../../shared/bots';
import {BotMark} from '../ui/BotMark';
import type {GameMode, GameState, PlayerColor, PlayerState} from '../../shared/game';
import type {CardDef} from '../../shared/types';
import {identify, myId, useNet} from '../net';
import {useRenderCount} from '../perf/recorder';
import {FullPhone} from './full/FullPhone';
import {CardFace} from '../ui/CardFace';
import {PLAYER_HEX} from '../ui/Icons';
import {Board} from './Board';
import {NudgeReceiver} from './Nudge';
import {AwayCard} from './Away';
import {GameMenu, GameMenuButton} from '../ui/GameMenu';
import {ReactionsButton} from '../ui/Reactions';
import {BoardPick} from '../ui/BoardPick';
import {NarratorPick} from '../ui/NarratorPick';
import {PosterArtPick} from '../ui/PosterArtPick';
import {PosterCard, summarize} from '../ui/PosterCard';
import {FindCard, PlayCard} from './PlayCard';
import {PreludePick} from '../ui/PreludePick';
import {TurnClockPick} from '../ui/TurnClockPick';
import {BotSpeedPick} from '../ui/BotSpeedPick';
import {Resolver, Stepper} from './Resolve';
import {ProfileSheetHost, useProfileSheet} from './profile/ProfileSheet';
import {ProfileChooser} from './profile/Join';
import {UnlockReveal} from './profile/Unlocks';
import {Avatar} from '../ui/Avatar';
import {Sheet} from '../ui/Sheet';

export function PhoneApp() {
  useRenderCount('PhoneApp');
  // two selectors, not the whole store: every reaction, hover or narration message re-rendered the whole phone
  const state = useNet((s) => s.state);
  const connected = useNet((s) => s.connected);
  const [claimed, setClaimed] = useState<string | null>(null);
  const id = claimed ?? myId();
  if (!state) return <Splash text={connected ? 'Loading the table' : 'Connecting to the table'} />;
  // A bot's seat is the server's: a phone that names it is a guest (it can pick a person's seat instead).
  const me = state.players.find((p) => p.id === id && !p.bot);
  return (
    <div style={{minHeight: '100%', background: 'radial-gradient(120% 60% at 50% 0%, var(--dusk-3), var(--dusk-1) 70%)'}}>
      {me && state.phase !== 'lobby' && <NudgeReceiver me={me.id} />}
      {me && state.phase !== 'lobby' && <AwayCard />}
      <ProfileSheetHost />
      {me && <UnlockReveal state={state} playerId={me.id} />}
      {!connected && <div role="status" style={{position: 'fixed', top: 0, left: 0, right: 0, zIndex: 90, textAlign: 'center', padding: 6, background: 'var(--ember)', fontSize: 14, fontWeight: 600}}>Reconnecting…</div>}
      <AnimatePresence mode="wait">
        <motion.div key={me ? state.phase : 'guest-' + state.phase} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.25}} style={{minHeight: '100%'}}>
          {state.phase === 'lobby' ? <Lobby state={state} me={me} id={id} />
            : !me ? <Takeover state={state} onPick={(pid) => { try { localStorage.setItem('mars-ledger-player', pid); } catch { /* private mode */ } identify('phone', pid); setClaimed(pid); }} />
              : state.mode === 'full' ? <FullPhone state={state} me={me} />
                : state.phase === 'setup' ? <><TopMenu state={state} me={me} /><Setup state={state} me={me} /></>
                : state.phase === 'preludes' ? <><TopMenu state={state} me={me} /><PreludePhase state={state} me={me} /></>
                : state.phase === 'research' && !me.ready ? <><TopMenu state={state} me={me} /><Research state={state} me={me} /></>
                  : state.phase === 'ended' ? <Final state={state} me={me} />
                    : <Board state={state} me={me} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function TopMenu({state, me}: {state: GameState; me: PlayerState}) {
  return <div style={{position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', right: 16, zIndex: 5, display: 'flex', gap: 8}}><ReactionsButton playerId={me.id} /><GameMenuButton state={state} playerId={me.id} /></div>;
}

function Splash({text}: {text: string}) {
  return (
    <div style={{height: '100%', display: 'grid', placeItems: 'center', background: 'var(--dusk-1)'}}>
      <motion.div animate={{opacity: [0.4, 1, 0.4]}} transition={{duration: 1.8, repeat: Infinity}} className="muted">{text}</motion.div>
    </div>
  );
}

function Lobby({state, me, id}: {state: GameState; me?: PlayerState; id: string}) {
  const send = useNet((s) => s.send);
  const phones = useNet((s) => s.phones);
  const taken = new Set(state.players.filter((p) => p.id !== id).map((p) => p.color));
  const [error, setError] = useState<string | null>(null);
  const act = (p: Promise<void>) => p.then(() => setError(null)).catch((e) => setError(e.message));
  // Bots play full games: a table with bots seated (carried over from the last game) opens on Full game.
  const [mode, setMode] = useState<GameMode>(() => (state.players.some((p) => p.bot) ? 'full' : 'companion'));
  const [draft, setDraft] = useState(true);
  const [starting, setStarting] = useState(false);

  const people = state.players.filter((p) => !p.bot).length;
  const bots = state.players.length - people;

  function start() {
    const order = [...state.players.map((p) => p.id)].sort(() => Math.random() - 0.5);
    setStarting(true);
    act(send({t: 'start', playerId: id, modules: ['base', 'corpera'], order, mode, draft: mode === 'full' ? draft : undefined}).finally(() => setStarting(false)));
  }

  return (
    <div style={{minHeight: '100svh', display: 'flex', flexDirection: 'column', padding: '0 20px calc(24px + env(safe-area-inset-bottom))',
      background: 'url(/assets/phone-lobby.webp) center top / cover no-repeat, var(--dusk-1)'}}>
      <div style={{flex: 1, minHeight: 180}} />
      <motion.h1 initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} transition={{duration: 0.6}}
        style={{fontSize: 52, lineHeight: 0.95, margin: '0 0 6px', fontWeight: 800, fontVariationSettings: "'wdth' 118"}}>Mars Ledger</motion.h1>
      <p className="muted" style={{margin: '0 0 22px'}}>Your player board, kept in your pocket.</p>

      {!me ? (
        <ProfileChooser state={state} mode={{kind: 'join', playerId: id}} />
      ) : (
        <div style={{display: 'grid', gap: 14}}>
          <div style={{display: 'grid', gap: 8}}>
            <AnimatePresence>
              {state.players.map((p) => (
                <motion.div key={p.id} layout initial={{opacity: 0, x: -20}} animate={{opacity: 1, x: 0}} exit={{opacity: 0}}
                  style={{display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 14, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)'}}>
                  <PlayerFace p={p} />
                  <span style={{flex: 1, minWidth: 0, fontWeight: 650}}>{p.name}{p.bot && <BotMark />}{p.id === id && <span className="faint"> · you</span>}
                    {p.bot && <span className="faint" style={{display: 'block', fontSize: 13, fontWeight: 500}}>{BOT_LEVEL_INFO[p.bot].label}</span>}
                    {!p.bot && <PhoneStatus n={phones[p.id] ?? 0} />}</span>
                  {p.bot && (
                    <button className="btn ghost" data-remove-bot={p.name} aria-label={`Remove ${p.name}`} style={{minHeight: 36, padding: '0 12px', fontSize: 14}}
                      onClick={() => act(send({t: 'leave', playerId: p.id}))}>Remove</button>
                  )}
                  {!p.bot && p.id !== id && <RemoveSeat name={p.name} onRemove={() => act(send({t: 'leave', playerId: p.id}))} />}
                  <AnimatePresence>
                    {p.beginner && (
                      <motion.span key="b" initial={{opacity: 0, scale: 0.7}} animate={{opacity: 1, scale: 1}} exit={{opacity: 0, scale: 0.7}}
                        className="cond" style={{fontSize: 13, fontWeight: 650, padding: '3px 9px', borderRadius: 999, color: 'var(--mc)', boxShadow: 'inset 0 0 0 1.5px var(--mc)'}}>Beginner</motion.span>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {me.profileId
            ? <button onClick={() => useProfileSheet.getState().open(me.profileId!)} className="faint" style={{justifySelf: 'start', margin: '-6px 4px 0', fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 3}}>Your profile, stats and achievements</button>
            : <LinkProfile state={state} playerId={id} />}
          <ColorPick value={me.color} taken={taken} onChange={(c) => act(send({t: 'rename', playerId: id, name: me.name, color: c}))} />
          <BoardPick value={state.boardChoice ?? 'tharsis'} onChange={(b) => act(send({t: 'setBoard', playerId: id, board: b}))} />
          <PreludePick state={state} playerId={id} glass />
          <BeginnerPick on={!!me.beginner} onChange={(b) => act(send({t: 'rename', playerId: id, name: me.name, color: me.color, beginner: b}))} />
          <ModePick mode={mode} setMode={setMode} draft={draft} setDraft={setDraft} fast={!!state.fastMode}
            setFast={(on) => act(send({t: 'setFastMode', playerId: id, on}))} />
          <AnimatePresence initial={false}>
            {mode === 'full' && (
              <motion.div key="bots" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: 'auto'}} exit={{opacity: 0, height: 0}} style={{overflow: 'hidden'}}>
                <BotSeats state={state} playerId={id} onError={setError} />
                {bots > 0 && <div style={{marginTop: 12}}><BotSpeedPick state={state} playerId={id} glass /></div>}
              </motion.div>
            )}
          </AnimatePresence>
          {mode === 'full' && people === 1 && bots === 0 && (
            <p className="muted" data-testid="solo-note" style={{margin: '-4px 6px 0', fontSize: 14}}>
              Solo: you play against a neutral player who holds two cities. Terraform Mars by the end of generation {state.prelude ? 12 : 14} to win.
            </p>
          )}
          {mode === 'companion' && bots > 0 && (
            <p role="note" style={{margin: '-4px 6px 0', fontSize: 14, color: 'var(--mc)'}}>Bots play full games only. Choose Full game, or remove the bots.</p>
          )}
          <TurnClockPick state={state} playerId={id} glass />
          <NarratorPick state={state} playerId={id} glass />
          <PosterArtPick state={state} playerId={id} glass />
          <button className="btn warm" data-testid="start-game" disabled={state.players.length < 1 || starting || (mode === 'companion' && bots > 0)} onClick={start}>
            {starting ? 'Setting up Mars…' : startLabel(mode, people, bots)}
          </button>
          <button className="btn ghost" onClick={() => act(send({t: 'leave', playerId: id}))}>Leave</button>
        </div>
      )}
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
    </div>
  );
}

/** A lobby row's face: the profile portrait or monogram (tap it for the profile), or the colour chip for a guest. */
function PlayerFace({p}: {p: PlayerState}) {
  const profile = useNet((s) => s.profiles.find((x) => x.id === p.profileId));
  if (!profile) return <span style={{width: 14, height: 14, borderRadius: 4, background: PLAYER_HEX[p.color], margin: '0 13px'}} />;
  return (
    <button onClick={() => useProfileSheet.getState().open(profile.id)} aria-label={`${profile.name}'s profile`} style={{borderRadius: '50%'}}>
      <Avatar name={profile.name} color={p.color} avatar={profile.avatar} size={40} />
    </button>
  );
}

/** A seat that joined without a profile can link one before the game ends (its result is then kept). */
function LinkProfile({state, playerId}: {state: GameState; playerId: string}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="faint" style={{justifySelf: 'start', margin: '-6px 4px 0', fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 3}}>
        Keep your games and achievements: link a profile
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} tall>
        <ProfileChooser state={state} mode={{kind: 'claim', playerId, onDone: () => setOpen(false)}} />
      </Sheet>
    </>
  );
}

function startLabel(mode: GameMode, people: number, bots: number): string {
  if (people + bots < 2) return `Start solo${mode === 'full' ? ' full game' : ''}`;
  if (!bots) return `Start ${mode === 'full' ? 'full game ' : ''}with ${people} players`;
  const who = [people ? `${people} ${people === 1 ? 'player' : 'players'}` : '', `${bots} ${bots === 1 ? 'bot' : 'bots'}`].filter(Boolean).join(' and ');
  return `Start full game with ${who}`;
}

/** Full games: bot seats the server plays. Any seated phone adds one (name, colour, level) or removes it from its row. */
function BotSeats({state, playerId, onError}: {state: GameState; playerId: string; onError: (e: string | null) => void}) {
  // Hard (Jev) needs the server's Jev key; the lobby offers it only then
  const jevBots = useNet((st) => !!st.config?.jevBots);
  const levels = BOT_LEVELS.filter((l) => l !== 'jev' || jevBots);
  const send = useNet((s) => s.send);
  const [open, setOpen] = useState(false);
  const taken = new Set(state.players.map((p) => p.color));
  const free = PLAYER_COLORS.filter((c) => !taken.has(c));
  const [name, setName] = useState('');
  const [color, setColor] = useState<PlayerColor | null>(null);
  const [level, setLevel] = useState<BotLevel>('normal');
  const [busy, setBusy] = useState(false);
  const full = state.players.length >= MAX_SEATS;
  const pickColor = color && free.includes(color) ? color : free[0];
  const suggested = nextBotName(state);

  async function add() {
    if (!pickColor) return;
    setBusy(true);
    try {
      await send({t: 'addBot', playerId, botId: `bot-${Math.random().toString(36).slice(2, 10)}`, name: name.trim() || suggested, color: pickColor, level});
      onError(null);
      setName(''); setColor(null); setOpen(false);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button className="btn ghost" data-testid="add-bot" disabled={full} style={{width: '100%', justifyContent: 'space-between'}} onClick={() => setOpen(true)}>
        <span>Add a bot</span><span className="faint" style={{fontSize: 14}}>{full ? 'the table is full' : 'a server player for an empty seat'}</span>
      </button>
    );
  }
  return (
    <div data-testid="bot-form" style={{display: 'grid', gap: 12, padding: '14px 14px 16px', borderRadius: 16, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(8px)', boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
      <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
        <strong style={{fontWeight: 700, fontSize: 17}}>New bot</strong>
        <button className="faint" style={{fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 3}} onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <label style={{display: 'grid', gap: 6}}>
        <span className="faint" style={{fontSize: 13}}>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 20))} placeholder={suggested} data-testid="bot-name"
          style={{height: 44, padding: '0 12px', borderRadius: 12, border: 'none', background: 'rgba(255,255,255,.08)', color: 'var(--ice)', fontSize: 17}} />
      </label>
      <div role="radiogroup" aria-label="Bot colour" style={{display: 'flex', gap: 8}}>
        {PLAYER_COLORS.map((c) => (
          <motion.button key={c} role="radio" aria-checked={pickColor === c} aria-label={c} disabled={taken.has(c)} whileTap={{scale: 0.9}} onClick={() => setColor(c)}
            style={{flex: 1, height: 38, borderRadius: 11, background: PLAYER_HEX[c], opacity: taken.has(c) ? 0.18 : 1,
              boxShadow: pickColor === c ? '0 0 0 3px var(--dusk-1), 0 0 0 5px var(--ice)' : 'none'}} />
        ))}
      </div>
      <div role="radiogroup" aria-label="Bot level" style={{display: 'grid', gridTemplateColumns: `repeat(${levels.length}, 1fr)`, gap: 4, padding: 4, borderRadius: 14, background: 'rgba(0,0,0,.35)'}}>
        {levels.map((l) => (
          <button key={l} role="radio" aria-checked={level === l} data-level={l} onClick={() => setLevel(l)}
            style={{position: 'relative', padding: '8px 10px', borderRadius: 10, fontWeight: 700, color: level === l ? 'var(--dusk-1)' : 'var(--ice)'}}>
            {level === l && <motion.span layoutId="bot-level-pill" style={{position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--ice)'}} transition={{type: 'spring', stiffness: 420, damping: 34}} />}
            <span style={{position: 'relative'}}>{BOT_LEVEL_INFO[l].label}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{margin: '-4px 2px 0', fontSize: 14}}>{BOT_LEVEL_INFO[level].text}</p>
      <button className="btn warm" data-testid="seat-bot" disabled={busy || !pickColor} onClick={add}>{busy ? 'Seating…' : `Seat ${name.trim() || suggested}`}</button>
    </div>
  );
}

const MODES: Array<{id: GameMode; name: string; text: string}> = [
  {id: 'companion', name: 'Companion', text: 'Play on the physical board. Phones keep the resources.'},
  {id: 'full', name: 'Full game', text: 'The board is on the TV. Cards and resources live on your phone.'},
];

/** Full game only: the engine deals this player the Beginner Corporation and ten free cards. */
function BeginnerPick({on, onChange}: {on: boolean; onChange: (b: boolean) => void}) {
  return (
    <motion.button role="switch" aria-checked={on} whileTap={{scale: 0.98}} onClick={() => onChange(!on)}
      style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '12px 16px', borderRadius: 16,
        background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', boxShadow: on ? 'inset 0 0 0 1.5px var(--mc)' : 'inset 0 0 0 1px var(--rim)'}}>
      <span style={{flex: 1}}>
        <strong style={{fontWeight: 650}}>Beginner Corporation</strong>
        <span className="muted" style={{display: 'block', fontSize: 14}}>Full game: skip choosing a corporation and keep all ten starting cards for free.</span>
      </span>
      <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: on ? 'var(--mc)' : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
        <motion.span animate={{x: on ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
          style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: on ? '#2A1A04' : 'var(--ice)'}} />
      </span>
    </motion.button>
  );
}

function ModePick({mode, setMode, draft, setDraft, fast, setFast}: {mode: GameMode; setMode: (m: GameMode) => void; draft: boolean; setDraft: (d: boolean) => void;
  fast: boolean; setFast: (on: boolean) => void}) {
  return (
    <div style={{display: 'grid', gap: 10}}>
      <div role="radiogroup" aria-label="How to play" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, padding: 4, borderRadius: 16, background: 'rgba(0,0,0,.4)', backdropFilter: 'blur(8px)'}}>
        {MODES.map((m) => (
          <button key={m.id} role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
            style={{position: 'relative', padding: '10px 12px', borderRadius: 12, textAlign: 'left', color: mode === m.id ? 'var(--dusk-1)' : 'var(--ice)'}}>
            {mode === m.id && <motion.span layoutId="mode-pill" style={{position: 'absolute', inset: 0, borderRadius: 12, background: 'var(--ice)'}} transition={{type: 'spring', stiffness: 420, damping: 34}} />}
            <span style={{position: 'relative', display: 'block', fontWeight: 700, fontVariationSettings: "'wdth' 85"}}>{m.name}</span>
            <span style={{position: 'relative', display: 'block', fontSize: 12.5, lineHeight: 1.3, opacity: mode === m.id ? 0.75 : 0.55}}>{m.text}</span>
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {mode === 'full' && (
          <motion.label key="draft" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: 'auto'}} exit={{opacity: 0, height: 0}}
            style={{display: 'flex', alignItems: 'center', gap: 12, padding: '0 6px', overflow: 'hidden'}}>
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} style={{width: 22, height: 22, accentColor: 'var(--mc)'}} />
            <span><strong style={{fontWeight: 650}}>Draft</strong> <span className="muted" style={{fontSize: 14}}>pass research cards around the table</span></span>
          </motion.label>
        )}
        {mode === 'full' && (
          <motion.label key="fast" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: 'auto'}} exit={{opacity: 0, height: 0}}
            style={{display: 'flex', alignItems: 'center', gap: 12, padding: '0 6px', overflow: 'hidden'}}>
            <input type="checkbox" data-fast-mode={fast ? 'on' : 'off'} checked={fast} onChange={(e) => setFast(e.target.checked)} style={{width: 22, height: 22, accentColor: 'var(--mc)', flex: 'none'}} />
            <span><strong style={{fontWeight: 650}}>Fast mode</strong> <span className="muted" style={{fontSize: 14}}>every turn is two actions; you cannot end a turn after one (passing still works)</span></span>
          </motion.label>
        )}
      </AnimatePresence>
    </div>
  );
}

function ColorPick({value, taken, onChange}: {value: PlayerColor; taken: Set<string>; onChange: (c: PlayerColor) => void}) {
  return (
    <div role="radiogroup" aria-label="Player colour" style={{display: 'flex', gap: 10, justifyContent: 'space-between'}}>
      {PLAYER_COLORS.map((c) => (
        <motion.button key={c} role="radio" aria-checked={value === c} aria-label={c} disabled={taken.has(c)} whileTap={{scale: 0.9}}
          onClick={() => onChange(c)}
          style={{flex: 1, height: 48, borderRadius: 14, background: PLAYER_HEX[c], opacity: taken.has(c) ? 0.2 : 1,
            boxShadow: value === c ? '0 0 0 3px var(--dusk-1), 0 0 0 5px var(--ice)' : 'none'}} />
      ))}
    </div>
  );
}

/** A phone that is not a player during a running game: pick who you are (new phone, cleared browser). */
function Takeover({state, onPick}: {state: GameState; onPick: (id: string) => void}) {
  return (
    <div style={{padding: '48px 20px'}}>
      <h1 style={{fontWeight: 800, fontVariationSettings: "'wdth' 110", margin: 0}}>Game in progress</h1>
      <p className="muted">New players can join when the next game starts. If you are already playing on another device, pick your name to continue here.</p>
      <div style={{display: 'grid', gap: 10, marginTop: 20}}>
        {state.players.filter((p) => !p.bot).map((p) => (
          <button key={p.id} className="btn ghost" style={{justifyContent: 'flex-start', gap: 12}} onClick={() => onPick(p.id)}>
            <span style={{width: 14, height: 14, borderRadius: 4, background: PLAYER_HEX[p.color]}} />{p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Setup({state, me}: {state: GameState; me: PlayerState}) {
  const [corp, setCorp] = useState<CardDef | null>(null);
  const [kept, setKept] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const withPreludes = state.modules.includes('prelude');
  const [preludes, setPreludes] = useState<CardDef[]>([]);
  const [pickingPreludes, setPickingPreludes] = useState(false);
  const corps = cardsFor(state.modules, 'corporation');
  const waiting = state.players.filter((p) => !p.ready);
  if (me.ready) {
    return (
      <div style={{padding: '48px 20px'}}>
        <CardFace card={getCard(me.corporation!)} />
        {me.preludes && (
          <div style={{display: 'grid', gap: 8, marginTop: 14}}>
            {me.preludes.map((n) => <CardFace key={n} card={getCard(n)} compact />)}
          </div>
        )}
        <p className="muted" style={{marginTop: 24}}>Waiting for {waiting.map((p) => p.name).join(', ')} to choose.</p>
      </div>
    );
  }
  const beginner = corp?.name === 'Beginner Corporation';
  const mc = (corp?.startingMegaCredits ?? 0) - (beginner ? 0 : kept * CARD_BUY_COST);
  return (
    <div style={{padding: '28px 20px 40px'}}>
      <h1 style={{fontWeight: 800, fontVariationSettings: "'wdth' 110", margin: '0 0 4px'}}>Your corporation</h1>
      {!corp ? (
        <>
          <p className="muted">Enter its number, search, or pick it below.</p>
          <FindCard state={state} group="corporation" onPick={setCorp} />
          <div style={{display: 'grid', gap: 8, marginTop: 20}}>
            {corps.map((c) => <button key={c.name} onClick={() => setCorp(c)} style={{textAlign: 'left'}}><CardFace card={c} compact /></button>)}
          </div>
        </>
      ) : pickingPreludes && !confirm ? (
        <PreludeChoice state={state} me={me} chosen={preludes} setChosen={setPreludes}
          onBack={() => setPickingPreludes(false)} onDone={() => setConfirm(true)} />
      ) : !confirm ? (
        <>
          <CardFace card={corp} />
          <div style={{marginTop: 18}}>
            <Stepper label={beginner ? 'Cards kept (free)' : `Cards kept (${CARD_BUY_COST} M€ each)`} value={kept} set={setKept} max={10} />
            <p style={{fontSize: 18}}>You start with <span className="num" style={{fontSize: 26, color: mc < 0 ? 'var(--ember)' : 'var(--mc)'}}>{mc}</span> M€</p>
          </div>
          <div style={{display: 'flex', gap: 10}}>
            <button className="btn ghost" onClick={() => setCorp(null)}>Back</button>
            <button className="btn warm" style={{flex: 1}} disabled={mc < 0} onClick={() => (withPreludes ? setPickingPreludes(true) : setConfirm(true))}>Continue</button>
          </div>
        </>
      ) : (
        <Resolver state={state} command={{t: 'chooseCorp', playerId: me.id, corporation: corp.name, cardsKept: kept, answers: [],
          preludes: withPreludes ? preludes.map((c) => c.name) : undefined}}
          confirmLabel={`Found ${corp.name}`} onDone={() => setConfirm(false)} onBack={() => setConfirm(false)} />
      )}
    </div>
  );
}

/** Prelude setup: record the two preludes this player keeps (they are physical cards). */
function PreludeChoice({state, me, chosen, setChosen, onBack, onDone}: {state: GameState; me: PlayerState; chosen: CardDef[];
  setChosen: (c: CardDef[]) => void; onBack: () => void; onDone: () => void}) {
  const taken = new Set([...state.players.filter((p) => p.id !== me.id).flatMap((p) => p.preludes ?? []), ...chosen.map((c) => c.name)]);
  return (
    <div>
      <h2 style={{fontWeight: 750, fontVariationSettings: "'wdth' 92", margin: '4px 0 2px'}}>Your preludes</h2>
      <p className="muted" style={{marginTop: 0}}>Keep two of the four you were dealt. Enter each one: its number, its name, or a photo.</p>
      <div style={{display: 'grid', gap: 8, margin: '10px 0 16px'}}>
        <AnimatePresence>
          {chosen.map((c) => (
            <motion.div key={c.name} layout initial={{opacity: 0, y: -10, scale: 0.97}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, scale: 0.95}}
              style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <div style={{flex: 1}}><CardFace card={c} compact /></div>
              <button className="btn ghost" style={{minHeight: 40, padding: '0 12px'}} aria-label={`Remove ${c.name}`}
                onClick={() => setChosen(chosen.filter((x) => x.name !== c.name))}>Remove</button>
            </motion.div>
          ))}
        </AnimatePresence>
        {chosen.length < 2 && <div className="faint" style={{fontSize: 14}}>{chosen.length ? 'One more to go.' : 'None yet.'}</div>}
      </div>
      {chosen.length < 2 && <FindCard state={state} group="prelude" exclude={taken} onPick={(c) => setChosen([...chosen, c].slice(0, 2))} />}
      <div style={{display: 'flex', gap: 10, marginTop: 16}}>
        <button className="btn ghost" onClick={onBack}>Back</button>
        <button className="btn warm" style={{flex: 1}} disabled={chosen.length !== 2} onClick={onDone}>Keep these two</button>
      </div>
    </div>
  );
}

/** The prelude phase: in turn order, each player plays both preludes (and any card a prelude allows). */
function PreludePhase({state, me}: {state: GameState; me: PlayerState}) {
  const send = useNet((s) => s.send);
  const [playing, setPlaying] = useState<CardDef | null>(null);
  const [cardSheet, setCardSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = state.players.find((p) => p.id === state.current);
  const mine = state.current === me.id;
  const left = (me.preludes ?? []).filter((n) => !(me.preludesPlayed ?? []).includes(n));
  return (
    <div style={{padding: '28px 20px 40px'}}>
      <p className="faint" style={{margin: 0}}>Before the first round</p>
      <h1 style={{fontWeight: 800, fontVariationSettings: "'wdth' 110", margin: '0 0 8px'}}>Preludes</h1>
      {!mine ? (
        <>
          <p className="muted">{current ? `${current.name} is playing preludes.` : 'Waiting.'} Yours come in turn order.</p>
          <div style={{display: 'grid', gap: 8, marginTop: 12}}>
            {(me.preludes ?? []).map((n) => (
              <div key={n} style={{opacity: (me.preludesPlayed ?? []).includes(n) ? 0.5 : 1}}><CardFace card={getCard(n)} compact /></div>
            ))}
          </div>
        </>
      ) : me.preludeCardPlay ? (
        <motion.div initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}}>
          <p style={{fontSize: 18}}>{me.preludeCardPlay}</p>
          <div style={{display: 'grid', gap: 10}}>
            <button className="btn warm" onClick={() => setCardSheet(true)}>Play a card</button>
            <button className="btn ghost" onClick={() => send({t: 'skipPreludeCard', playerId: me.id}).catch((e) => setError(e.message))}>Play no card</button>
          </div>
          <Sheet open={cardSheet} onClose={() => setCardSheet(false)} title="Play a card" tall><PlayCard state={state} me={me} onClose={() => setCardSheet(false)} /></Sheet>
        </motion.div>
      ) : playing ? (
        <>
          <CardFace card={playing} compact />
          <div style={{height: 14}} />
          <Resolver state={state} command={{t: 'playPrelude', playerId: me.id, card: playing.name, answers: []}}
            confirmLabel={`Play ${playing.name}`} onDone={() => setPlaying(null)} onBack={() => setPlaying(null)} />
        </>
      ) : (
        <>
          <p className="muted">Your turn: play your {left.length === 2 ? 'two preludes, in the order you like' : 'last prelude'}.</p>
          <div style={{display: 'grid', gap: 12, marginTop: 12}}>
            {left.map((n, i) => (
              <motion.button key={n} initial={{opacity: 0, y: 14, rotate: i ? 1.5 : -1.5}} animate={{opacity: 1, y: 0, rotate: 0}}
                transition={{delay: i * 0.08, type: 'spring', stiffness: 220, damping: 22}} whileTap={{scale: 0.98}}
                onClick={() => setPlaying(getCard(n))} style={{textAlign: 'left'}} data-card={n}>
                <CardFace card={getCard(n)} />
              </motion.button>
            ))}
          </div>
        </>
      )}
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
    </div>
  );
}

function Research({state, me}: {state: GameState; me: PlayerState}) {
  const send = useNet((s) => s.send);
  const [n, setN] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const max = Math.min(4, Math.floor(me.stock.megacredits / CARD_BUY_COST));
  return (
    <div style={{padding: '48px 20px'}}>
      <p className="faint" style={{margin: 0}}>Generation {state.generation}</p>
      <h1 style={{fontWeight: 800, fontVariationSettings: "'wdth' 110", margin: '0 0 8px'}}>Research</h1>
      <p className="muted">Draw four cards and keep the ones you buy.</p>
      <Stepper label={`Cards bought (${CARD_BUY_COST} M€ each)`} value={n} set={setN} max={max} />
      <p>You have <span className="num" style={{fontSize: 22, color: 'var(--mc)'}}>{me.stock.megacredits - n * CARD_BUY_COST}</span> M€ after buying.</p>
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
      <button className="btn warm" style={{width: '100%'}} onClick={() => send({t: 'research', playerId: me.id, cardsBought: n}).catch((e) => setError(e.message))}>
        {n ? `Buy ${n} card${n > 1 ? 's' : ''}` : 'Buy nothing'}
      </button>
    </div>
  );
}

function Final({state, me}: {state: GameState; me: PlayerState}) {
  const send = useNet((s) => s.send);
  const [adj, setAdj] = useState(me.boardVP?.cityAdjacency ?? 0);
  const [other, setOther] = useState(me.boardVP?.other ?? 0);
  // Funded awards that depend on where tiles sit (Desert Settler, Estate Dealer) are counted on the physical board.
  const counted = boardOf(state).awards.filter((a) => a.positional && state.awards.some((f) => f.name === a.name));
  const [manual, setManual] = useState<Record<string, number>>(() => Object.fromEntries(counted.map((a) => [a.name, me.manualScores?.[a.name] ?? 0])));
  const rows = state.players.map((p) => ({p, s: score(state, p)})).sort((a, b) => b.s.total - a.s.total);
  // Ties share a place (two players on 20 are both first).
  const place = (total: number) => 1 + rows.filter((r) => r.s.total > total).length;
  return (
    <div style={{position: 'relative', padding: '40px 20px'}}>
      <div style={{position: 'absolute', top: 'calc(12px + env(safe-area-inset-top))', right: 16}}><ReactionsButton playerId={me.id} /></div>
      <h1 style={{fontWeight: 800, fontVariationSettings: "'wdth' 110", margin: 0}}>Final score</h1>
      <p className="muted">Count the greeneries next to each of your cities on the board.</p>
      <Stepper label="Greeneries next to your cities" value={adj} set={setAdj} max={60} />
      <Stepper label="Other points (by hand)" value={other} set={setOther} min={-20} max={60} />
      {counted.map((a) => (
        <Stepper key={a.name} label={`${a.name}: ${a.manual}`} value={manual[a.name] ?? 0} set={(n) => setManual((m) => ({...m, [a.name]: n}))} max={40} />
      ))}
      <button className="btn ghost" style={{width: '100%'}}
        onClick={() => send({t: 'boardVP', playerId: me.id, cityAdjacency: adj, other, manual: counted.length ? manual : undefined})}>Save my board points</button>
      <div style={{display: 'grid', gap: 10, marginTop: 24}}>
        {rows.map(({p, s}, i) => (
          <motion.div key={p.id} initial={{opacity: 0, y: 12}} animate={{opacity: 1, y: 0}} transition={{delay: i * 0.1}}
            style={{display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,.05)', boxShadow: `inset 4px 0 0 ${PLAYER_HEX[p.color]}`}}>
            <span className="num" style={{fontSize: 22, width: 26, color: place(s.total) === 1 ? 'var(--mc)' : undefined}}>{place(s.total)}</span>
            <span style={{flex: 1, fontWeight: 650}}>{p.name}</span>
            <span className="num" style={{fontSize: 28}}>{s.total}</span>
          </motion.div>
        ))}
      </div>
      <PosterCard gameId={state.id} summary={summarize(rows.map(({p, s}) => ({name: p.name, color: p.color, vp: s.total, place: place(s.total)})))} />
      <div style={{marginTop: 28}}><GameMenu state={state} playerId={me.id} onDone={() => {}} /></div>
    </div>
  );
}

/** Whether a seat has a phone on the table right now, so a seat nobody holds is easy to spot (and remove or take over). */
function PhoneStatus({n}: {n: number}) {
  return (
    <span className="faint" style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500}} data-phones={n}>
      <span style={{width: 7, height: 7, borderRadius: '50%', background: n ? 'var(--plants)' : 'var(--ice-faint)'}} />
      {n === 0 ? 'no phone connected' : n === 1 ? 'phone connected' : `${n} phones connected`}
    </span>
  );
}

/** Remove someone else's seat from the lobby (an idle or duplicate seat): tap, then tap again to confirm. */
function RemoveSeat({name, onRemove}: {name: string; onRemove: () => void}) {
  const [arm, setArm] = useState(false);
  useEffect(() => { if (!arm) return; const t = setTimeout(() => setArm(false), 3000); return () => clearTimeout(t); }, [arm]);
  return (
    <button className="btn ghost" data-remove-seat={name} aria-label={`Remove ${name}`}
      style={{minHeight: 36, padding: '0 12px', fontSize: 14, color: arm ? 'var(--ember)' : undefined}}
      onClick={() => (arm ? onRemove() : setArm(true))}>{arm ? 'Tap to remove' : 'Remove'}</button>
  );
}
