// Table-wide game controls: end and score, start over, abandon. Each needs a second tap,
// because it changes the game for everyone at the table.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useState} from 'react';
import type {GameState} from '../../shared/game';
import {switchTo, useNet} from '../net';
import {SourceLink, Unofficial} from './Unofficial';
import {PLAYER_HEX} from './Icons';
import {Sheet} from './Sheet';
import {NarratorPick} from './NarratorPick';
import {PosterArtPick} from './PosterArtPick';
import {TurnClockPick} from './TurnClockPick';
import {BotSpeedPick} from './BotSpeedPick';
import {HintsPick} from './Hints';
import {PhonePrefPick} from './PhonePrefs';
import {useProfileSheet} from '../phone/profile/ProfileSheet';
import {RadioRemote} from '../tv/radio/RadioRemote';
import {PerfPick} from '../perf/PerfMenu';
import {FlyRemoteHost, FlyRemoteItem} from './FlyRemote';
import {LastMoveMenuItem} from '../phone/full/TvLinks';

export function GameMenuButton({state, playerId}: {state: GameState; playerId: string}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-label="Game menu" onClick={() => setOpen(true)}
        style={{width: 40, height: 40, flex: 'none', borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.06)'}}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="3" cy="9" r="1.8" fill="currentColor" /><circle cx="9" cy="9" r="1.8" fill="currentColor" /><circle cx="15" cy="9" r="1.8" fill="currentColor" /></svg>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Game">
        <GameMenu state={state} playerId={playerId} onDone={() => setOpen(false)} />
      </Sheet>
      {state.mode === 'full' && <FlyRemoteHost state={state} playerId={playerId} />}
    </>
  );
}

export function GameMenu({state, playerId, onDone, gameOver}: {state: GameState; playerId: string; onDone: () => void; gameOver?: boolean}) {
  const {send, newGame} = useNet();
  const [error, setError] = useState<string | null>(null);
  const run = (p: Promise<void>) => p.then(onDone).catch((e) => setError(e.message));
  const full = state.mode === 'full';
  const ended = state.phase === 'ended' || !!gameOver;
  const radio = useNet((s) => !!s.config?.radioPlaylist);
  const profileId = state.players.find((p) => p.id === playerId)?.profileId;
  return (
    <div style={{display: 'grid', gap: 10}}>
      {profileId && (
        <button className="btn ghost" style={{justifyContent: 'space-between'}} onClick={() => { onDone(); useProfileSheet.getState().open(profileId); }}>
          <span>Your profile</span><span className="faint" style={{fontSize: 14}}>stats and achievements</span>
        </button>
      )}
      <SwitchPlayer state={state} playerId={playerId} />
      {!ended && radio && state.players.some((p) => p.id === playerId) && <RadioRemote playerId={playerId} />}
      {!ended && full && !gameOver && state.players.some((p) => p.id === playerId) && (
        <div style={{paddingBottom: 12, borderBottom: '1px solid var(--rim)'}}><LastMoveMenuItem /></div>
      )}
      {!ended && full && !gameOver && state.players.some((p) => p.id === playerId) && (
        <div style={{paddingBottom: 12, borderBottom: '1px solid var(--rim)'}}><FlyRemoteItem onDone={onDone} /></div>
      )}
      {!ended && state.players.some((p) => p.id === playerId) && (
        <div style={{paddingBottom: 12, borderBottom: '1px solid var(--rim)', display: 'grid', gap: 12}}>
          <HintsPick state={state} playerId={playerId} />
          {full && <PhonePrefPick state={state} playerId={playerId} which="showVp" />}
          <PhonePrefPick state={state} playerId={playerId} which="confirmBuy" />
        </div>
      )}
      <div style={{paddingBottom: 12, marginBottom: 4, borderBottom: '1px solid var(--rim)', display: 'grid', gap: 12}}>
        <NarratorPick state={state} playerId={playerId} />
        {!ended && <TurnClockPick state={state} playerId={playerId} />}
        {!ended && full && state.players.some((p) => p.bot) && <BotSpeedPick state={state} playerId={playerId} />}
        <PosterArtPick state={state} playerId={playerId} />
      </div>
      {!full && !ended && (
        <Confirm label="End the game and score it" confirm="Tap again to end for everyone"
          text="Everyone moves to final scoring and enters their board points." onConfirm={() => run(send({t: 'endGame', playerId}))} />
      )}
      {ended ? (
        <Confirm label="Start a new game" confirm="Tap again to open a new lobby" warm
          text="Everyone returns to the lobby. This game stays in the history." onConfirm={() => run(newGame(true))} />
      ) : (
        <Confirm label="Abandon the game" confirm="Tap again to abandon for everyone" danger
          text={full ? 'The game stops without scoring and everyone returns to the lobby.' : 'Nobody is scored; everyone returns to the lobby. The game stays in the history.'}
          onConfirm={() => run(newGame(true))} />
      )}
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
      <div style={{paddingTop: 12, marginTop: 4, borderTop: '1px solid var(--rim)'}}><PerfPick /></div>
      <Unofficial style={{padding: '4px 2px 0'}} />
      <SourceLink style={{padding: '2px 2px 0'}} />
    </div>
  );
}

function Confirm({label, confirm, text, onConfirm, danger, warm}: {label: string; confirm: string; text: string; onConfirm: () => void; danger?: boolean; warm?: boolean}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <div>
      <motion.button whileTap={{scale: 0.98}} className={`btn ${armed ? (danger ? 'danger' : 'warm') : warm ? 'warm' : 'ghost'}`} style={{width: '100%'}}
        onClick={() => (armed ? onConfirm() : setArmed(true))}>
        <AnimatePresence mode="wait">
          <motion.span key={String(armed)} initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}}>{armed ? confirm : label}</motion.span>
        </AnimatePresence>
      </motion.button>
      <p className="muted" style={{margin: '6px 4px 0', fontSize: 14}}>{text}</p>
    </div>
  );
}

/** One phone, several seats (a shared phone, or a player who sat down on the wrong device): play as another person at
 *  the table. Bots' seats are the server's and are not offered. */
function SwitchPlayer({state, playerId}: {state: GameState; playerId: string}) {
  const [open, setOpen] = useState(false);
  const me = state.players.find((p) => p.id === playerId);
  const others = state.players.filter((p) => p.id !== playerId && !p.bot);
  if (!others.length) return null;
  return (
    <div style={{paddingBottom: 12, borderBottom: '1px solid var(--rim)', display: 'grid', gap: 10}}>
      <button className="btn ghost" data-testid="switch-player" aria-expanded={open} style={{justifyContent: 'space-between'}} onClick={() => setOpen((o) => !o)}>
        <span style={{display: 'inline-flex', alignItems: 'center', gap: 10}}>
          {me && <span style={{width: 12, height: 12, borderRadius: 3, background: PLAYER_HEX[me.color]}} />}
          {me ? `Playing as ${me.name}` : 'Not seated'}
        </span>
        <span className="faint" style={{fontSize: 14}}>{open ? 'Cancel' : 'Switch player'}</span>
      </button>
      {open && (
        <div style={{display: 'grid', gap: 8}}>
          {others.map((p) => (
            <button key={p.id} className="btn ghost" data-testid={`switch-to-${p.id}`} style={{justifyContent: 'flex-start', gap: 12}} onClick={() => switchTo(p.id)}>
              <span style={{width: 14, height: 14, borderRadius: 4, background: PLAYER_HEX[p.color]}} />Play as {p.name}
            </button>
          ))}
          <p className="faint" style={{margin: 0, fontSize: 14}}>This phone becomes that player. Their own phone keeps working too.</p>
        </div>
      )}
    </div>
  );
}
