// "Who are you?": joining the table as a known person is one tap; a new person makes a profile once.
// The same chooser links a seat that joined without a profile.
import {Unofficial} from '../../ui/Unofficial';
import {AnimatePresence, motion} from 'motion/react';
import {useState} from 'react';
import {PLAYER_COLORS} from '../../../shared/game';
import type {GameState, PlayerColor} from '../../../shared/game';
import type {ProfileSummary} from '../../../shared/profiles';
import {newProfileId, rememberedProfile, rememberProfile, switchTo, useNet} from '../../net';
import {Avatar} from '../../ui/Avatar';
import {PLAYER_HEX} from '../../ui/Icons';
import {ColourRow, PortraitRow} from './ProfileSheet';

type Mode = {kind: 'join'; playerId: string} | {kind: 'claim'; playerId: string; onDone: () => void};

export function ProfileChooser({state, mode}: {state: GameState; mode: Mode}) {
  const {profiles, profilesKnown, mine, send, createProfile, phones} = useNet();
  const remembered = rememberedProfile() ?? mine;
  const atTable = new Set(state.players.map((p) => p.profileId).filter(Boolean) as string[]);
  // a person already seated (from another phone, or this one before its id changed): tapping them moves this phone
  // onto their seat instead of refusing
  const guests = state.players.filter((p) => !p.profileId && !p.bot && p.id !== mode.playerId);
  const seatOf = new Map(state.players.filter((p) => p.profileId && !p.bot).map((p) => [p.profileId as string, p.id]));
  const takenColors = new Set(state.players.filter((p) => p.id !== mode.playerId).map((p) => p.color));
  const ordered = [...profiles].sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered));
  // Until the person picks a path, the list decides: known people first, the form when there are none.
  const [chosen, setView] = useState<'pick' | 'new' | 'guest' | null>(null);
  const view = chosen ?? (profiles.length ? 'pick' : 'new');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const freeColor = (c: PlayerColor) => (takenColors.has(c) ? PLAYER_COLORS.find((x) => !takenColors.has(x)) ?? c : c);

  async function joinAs(p: {id: string; name: string; color: PlayerColor}) {
    setBusy(true); setError(null);
    try {
      if (mode.kind === 'join') await send({t: 'join', playerId: mode.playerId, name: p.name, color: freeColor(p.color), profileId: p.id});
      else { await send({t: 'claimProfile', playerId: mode.playerId, profileId: p.id}); mode.onDone(); }
      rememberProfile(p.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function createAndUse(name: string, color: PlayerColor, avatar: string | null) {
    setBusy(true); setError(null);
    const id = newProfileId();
    try {
      await createProfile({id, name, color, avatar});
      setBusy(false);
      await joinAs({id, name: name.trim(), color});
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (!profilesKnown) {
    return <motion.div aria-busy="true" animate={{opacity: [0.35, 0.7, 0.35]}} transition={{duration: 1.6, repeat: Infinity}}
      style={{height: 140, borderRadius: 16, background: 'rgba(0,0,0,.3)'}} />;
  }
  return (
    <div style={{display: 'grid', gap: 14}}>
      <AnimatePresence mode="wait" initial={false}>
        {view === 'pick' && (
          <motion.div key="pick" initial={{opacity: 0, x: -16}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: -16}} style={{display: 'grid', gap: 12}}>
            <h2 style={{margin: 0, fontSize: 24, fontWeight: 800, fontVariationSettings: "'wdth' 100"}}>Who are you?</h2>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10}}>
              {ordered.map((p, i) => (
                <ProfileChip key={p.id} p={p} i={i} remembered={p.id === remembered} busy={busy} taken={atTable.has(p.id)}
                  canTakeOver={mode.kind === 'join' && seatOf.has(p.id)} phoneCount={seatOf.has(p.id) ? phones[seatOf.get(p.id)!] ?? 0 : 0}
                  onPick={() => (mode.kind === 'join' && seatOf.has(p.id) ? (rememberProfile(p.id), switchTo(seatOf.get(p.id)!)) : joinAs(p))} />
              ))}
              <motion.button initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: Math.min(0.4, ordered.length * 0.04)}} whileTap={{scale: 0.97}}
                onClick={() => setView('new')} data-profile="new"
                style={{display: 'flex', alignItems: 'center', gap: 10, padding: '12px', borderRadius: 16, minHeight: 64, textAlign: 'left',
                  background: 'rgba(0,0,0,.25)', boxShadow: 'inset 0 0 0 1.5px var(--rim-strong)', backdropFilter: 'blur(8px)'}}>
                <span aria-hidden="true" style={{width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: 26, fontWeight: 300,
                  boxShadow: 'inset 0 0 0 1.5px var(--ice-dim)'}}>+</span>
                <span style={{fontWeight: 650}}>Someone new</span>
              </motion.button>
            </div>
          </motion.div>
        )}
        {view === 'new' && (
          <motion.div key="new" initial={{opacity: 0, x: 16}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: 16}}>
            <NewProfile busy={busy} taken={takenColors} onCreate={createAndUse} onBack={profiles.length ? () => setView('pick') : undefined} />
          </motion.div>
        )}
        {view === 'guest' && mode.kind === 'join' && (
          <motion.div key="guest" initial={{opacity: 0, x: 16}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: 16}}>
            <Guest playerId={mode.playerId} taken={takenColors} onBack={() => setView(profiles.length ? 'pick' : 'new')} />
          </motion.div>
        )}
      </AnimatePresence>
      {mode.kind === 'join' && view === 'pick' && guests.length > 0 && (
        <div style={{display: 'grid', gap: 8}}>
          <span className="faint" style={{fontSize: 14}}>Seated without a profile</span>
          {guests.map((g) => (
            <button key={g.id} className="btn ghost" data-seat={g.id} style={{justifyContent: 'flex-start', gap: 12}} onClick={() => switchTo(g.id)}>
              <span style={{width: 14, height: 14, borderRadius: 4, background: PLAYER_HEX[g.color]}} />I am {g.name}: use this phone
              <span className="faint" style={{marginLeft: 'auto', fontSize: 13}}>{phones[g.id] ? 'on another phone' : 'no phone'}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert" style={{margin: 0, color: 'var(--ember)'}}>{error}</p>}
      {mode.kind === 'join' && view !== 'guest' && (
        <button onClick={() => setView('guest')} className="faint" style={{justifySelf: 'center', fontSize: 14, textDecoration: 'underline', textUnderlineOffset: 3}}>
          Join without a profile
        </button>
      )}
      {mode.kind === 'join' && <Unofficial style={{marginTop: 6, textAlign: 'center'}} />}
    </div>
  );
}

function ProfileChip({p, i, remembered, busy, taken, canTakeOver, phoneCount = 0, onPick}: {p: ProfileSummary; i: number; remembered: boolean; busy: boolean; taken: boolean; canTakeOver?: boolean; phoneCount?: number; onPick: () => void}) {
  return (
    <motion.button initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: Math.min(0.4, i * 0.04)}} whileTap={{scale: 0.97}}
      disabled={busy || (taken && !canTakeOver)} onClick={onPick} data-profile={p.name}
      style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '12px', borderRadius: 16, minHeight: 64, textAlign: 'left',
        background: 'rgba(0,0,0,.38)', backdropFilter: 'blur(8px)', opacity: taken && !canTakeOver ? 0.4 : 1,
        boxShadow: remembered ? 'inset 0 0 0 1.5px var(--mc)' : 'inset 0 0 0 1px var(--rim)'}}>
      <Avatar name={p.name} color={p.color} avatar={p.avatar} size={40} />
      <span style={{minWidth: 0}}>
        <span style={{display: 'block', fontWeight: 700, fontSize: 17, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{p.name}</span>
        <span className="faint" style={{fontSize: 12.5}}>{taken ? (canTakeOver ? (phoneCount ? 'seated, on another phone · tap to move here' : 'seated, no phone · tap to take') : 'at the table') : p.games ? `${p.games} game${p.games === 1 ? '' : 's'} · ${p.wins} win${p.wins === 1 ? '' : 's'}` : 'new'}</span>
      </span>
      {remembered && !taken && <span className="cond" style={{position: 'absolute', top: -8, right: 10, fontSize: 11.5, fontWeight: 700, padding: '1px 8px', borderRadius: 999, background: 'var(--mc)', color: '#2A1A04'}}>last used here</span>}
    </motion.button>
  );
}

function NewProfile({busy, taken, onCreate, onBack}: {busy: boolean; taken: Set<string>; onCreate: (name: string, color: PlayerColor, avatar: string | null) => void; onBack?: () => void}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<PlayerColor>(PLAYER_COLORS.find((c) => !taken.has(c)) ?? 'red');
  const [avatar, setAvatar] = useState<string | null>(null);
  return (
    <div style={{display: 'grid', gap: 12}}>
      <h2 style={{margin: 0, fontSize: 24, fontWeight: 800, fontVariationSettings: "'wdth' 100"}}>Your profile</h2>
      <p className="muted" style={{margin: '-6px 0 0', fontSize: 15}}>Made once. Your games, wins and achievements follow you to every game night.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={20} autoFocus
        style={{padding: '16px 18px', fontSize: 20, borderRadius: 16, border: 0, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', outline: 'none'}} />
      <ColourRow value={color} onChange={setColor} taken={taken} />
      <PortraitRow name={name} color={color} value={avatar} onChange={setAvatar} />
      <button className="btn warm" disabled={!name.trim() || busy} onClick={() => onCreate(name, color, avatar)}>{busy ? 'Saving…' : 'Create and join'}</button>
      {onBack && <button className="btn ghost" onClick={onBack}>Back</button>}
    </div>
  );
}

function Guest({playerId, taken, onBack}: {playerId: string; taken: Set<string>; onBack: () => void}) {
  const send = useNet((s) => s.send);
  const [name, setName] = useState('');
  const [color, setColor] = useState<PlayerColor>(PLAYER_COLORS.find((c) => !taken.has(c)) ?? 'red');
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{display: 'grid', gap: 12}}>
      <h2 style={{margin: 0, fontSize: 24, fontWeight: 800, fontVariationSettings: "'wdth' 100"}}>Just this game</h2>
      <p className="muted" style={{margin: '-6px 0 0', fontSize: 15}}>Nothing is kept after the game. You can link a profile from the lobby later.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Your name" maxLength={20}
        style={{padding: '16px 18px', fontSize: 20, borderRadius: 16, border: 0, background: 'rgba(0,0,0,.35)', backdropFilter: 'blur(8px)', outline: 'none'}} />
      <ColourRow value={color} onChange={setColor} taken={taken} />
      <button className="btn warm" disabled={!name.trim()} onClick={() => send({t: 'join', playerId, name, color}).catch((e) => setError(e.message))}>Join the table</button>
      {error && <p role="alert" style={{margin: 0, color: 'var(--ember)'}}>{error}</p>}
      <button className="btn ghost" onClick={onBack}>Back</button>
    </div>
  );
}
