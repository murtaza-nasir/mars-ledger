// A person's page on the phone: lifetime stats, the achievement collection, recent games, and
// editing (name, colour, portrait) plus folding a duplicate profile into this one.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {ProfileHintsSwitch} from '../../ui/Hints';
import {create} from 'zustand';
import {ACHIEVEMENTS, ACHIEVEMENT_BY_ID} from '../../../shared/achievements';
import {BOARDS} from '../../../shared/board';
import {PLAYER_COLORS} from '../../../shared/game';
import type {PlayerColor} from '../../../shared/game';
import type {ProfileDetail} from '../../../shared/profiles';
import {WIN_RATE_MIN_GAMES} from '../../../shared/profiles';
import {rememberedProfile, useNet} from '../../net';
import {Avatar, PORTRAITS} from '../../ui/Avatar';
import {Badge} from '../../ui/Badge';
import {MiniMap} from '../../ui/BoardPick';
import {PLAYER_HEX} from '../../ui/Icons';
import {Sheet} from '../../ui/Sheet';

/** One profile screen at a time, opened from the lobby, the ⋯ menu or a player row. */
export const useProfileSheet = create<{profileId: string | null; open: (id: string) => void; close: () => void}>((set) => ({
  profileId: null,
  open: (profileId) => set({profileId}),
  close: () => set({profileId: null}),
}));

const dateFmt = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short', year: 'numeric'});
const shortDate = new Intl.DateTimeFormat(undefined, {day: 'numeric', month: 'short'});

export function ProfileSheetHost() {
  const {profileId, close} = useProfileSheet();
  const summary = useNet((s) => s.profiles.find((p) => p.id === profileId));
  return (
    <Sheet open={!!profileId} onClose={close} title={summary ? summary.name : 'Profile'} tall>
      {profileId && <ProfileBody profileId={profileId} />}
    </Sheet>
  );
}

function ProfileBody({profileId}: {profileId: string}) {
  const {details, loadProfile, mine} = useNet();
  const detail = details[profileId];
  const [error, setError] = useState<string | null>(null);
  // Always refresh on open: stats change after every game.
  useEffect(() => { loadProfile(profileId).catch((e) => setError(e.message)); }, [profileId, loadProfile]);
  if (error && !detail) return <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>;
  if (!detail) return <Skeleton />;
  const own = profileId === mine || profileId === rememberedProfile();
  return <Loaded detail={detail} own={own} />;
}

function Skeleton() {
  return (
    <div aria-busy="true" style={{display: 'grid', gap: 12}}>
      {[64, 120, 180].map((h, i) => (
        <motion.div key={i} animate={{opacity: [0.35, 0.7, 0.35]}} transition={{duration: 1.6, repeat: Infinity, delay: i * 0.15}}
          style={{height: h, borderRadius: 16, background: 'rgba(255,255,255,.06)'}} />
      ))}
    </div>
  );
}

function Loaded({detail, own}: {detail: ProfileDetail; own: boolean}) {
  const {profile, stats} = detail;
  const [editing, setEditing] = useState(false);
  const unlocked = new Map(detail.unlocked.map((u) => [u.achievement, u]));
  const [focus, setFocus] = useState<string | null>(null);
  const tiles: Array<[string, string]> = [
    ['Games', String(stats.games)],
    ['Wins', String(stats.wins)],
    ['Win rate', stats.winRate === null ? '—' : `${Math.round(stats.winRate * 100)}%`],
    ['Best score', stats.bestScore === null ? '—' : String(stats.bestScore)],
    ['Average', stats.averageVp === null ? '—' : String(stats.averageVp)],
    ['Cards played', String(stats.cards)],
  ];
  const small: Array<[string, number]> = [['Cities', stats.cities], ['Greeneries', stats.greeneries], ['Oceans', stats.oceans],
    ['Attacks', stats.attacksDealt], ['M€ spent', stats.mcSpent]];
  return (
    <div style={{display: 'grid', gap: 22}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 16}}>
        <Avatar name={profile.name} color={profile.color} avatar={profile.avatar} size={72} />
        <div style={{flex: 1, minWidth: 0}}>
          <div className="muted" style={{fontSize: 14}}>On Mars since {dateFmt.format(profile.created)}</div>
          {stats.favouriteCorporation && (
            <div style={{fontSize: 15, marginTop: 2}}><span className="faint">Favourite </span>{stats.favouriteCorporation.name}
              <span className="faint"> · {stats.favouriteCorporation.games} game{stats.favouriteCorporation.games === 1 ? '' : 's'}</span></div>
          )}
        </div>
        {own && <button className="btn ghost" style={{minHeight: 40, padding: '0 14px', fontSize: 15}} onClick={() => setEditing((e) => !e)}>{editing ? 'Done' : 'Edit'}</button>}
      </div>

      {own && <ProfileHintsSwitch profileId={profile.id} />}

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div key="edit" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: 'auto'}} exit={{opacity: 0, height: 0}} style={{overflow: 'hidden'}}>
            <EditProfile detail={detail} onSaved={() => setEditing(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8}}>
        {tiles.map(([label, value], i) => (
          <motion.div key={label} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} transition={{delay: 0.03 * i}}
            style={{padding: '12px 12px 10px', borderRadius: 14, background: 'rgba(255,255,255,.05)'}}>
            <div className="num" style={{fontSize: 26}}>{value}</div>
            <div className="cond faint" style={{fontSize: 13, marginTop: 4}}>{label}</div>
          </motion.div>
        ))}
      </div>
      {stats.games > 0 && stats.games < WIN_RATE_MIN_GAMES && <p className="faint" style={{margin: '-12px 2px 0', fontSize: 13}}>The win rate appears after {WIN_RATE_MIN_GAMES} games.</p>}
      <div style={{display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 14}}>
        {small.map(([label, n]) => <span key={label}><span className="num" style={{fontSize: 16}}>{n}</span> <span className="faint">{label}</span></span>)}
      </div>

      <section aria-label="Maps">
        <h3 className="cond" style={{margin: '0 0 8px', fontWeight: 600, color: 'var(--ice-dim)'}}>Maps</h3>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8}}>
          {(['tharsis', 'hellas', 'elysium'] as const).map((b) => {
            const played = stats.mapsPlayed.includes(b);
            const wonIt = stats.mapsWon.includes(b);
            return (
              <div key={b} style={{display: 'grid', justifyItems: 'center', gap: 4, padding: '10px 6px', borderRadius: 14, background: 'rgba(255,255,255,.04)', opacity: played ? 1 : 0.45}}>
                <MiniMap board={b} size={56} />
                <span style={{fontSize: 14, fontWeight: 650}}>{BOARDS[b].title}</span>
                <span className="faint" style={{fontSize: 12.5, color: wonIt ? 'var(--mc)' : undefined}}>{wonIt ? 'Won here' : played ? 'Played' : 'Not yet'}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-label="Achievements">
        <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '0 0 10px'}}>
          <h3 className="cond" style={{margin: 0, fontWeight: 600, color: 'var(--ice-dim)'}}>Achievements</h3>
          <span className="faint" style={{fontSize: 14}}><span className="num" style={{fontSize: 17, color: 'var(--ice)'}}>{unlocked.size}</span> of {ACHIEVEMENTS.length}</span>
        </div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px 6px'}}>
          {[...ACHIEVEMENTS].sort((a, b) => Number(unlocked.has(b.id)) - Number(unlocked.has(a.id))).map((a, i) => {
            const u = unlocked.get(a.id);
            return (
              <motion.button key={a.id} layout initial={{opacity: 0, scale: 0.8}} animate={{opacity: 1, scale: 1}} transition={{delay: Math.min(0.6, i * 0.02)}}
                whileTap={{scale: 0.94}} onClick={() => setFocus(focus === a.id ? null : a.id)} aria-expanded={focus === a.id}
                style={{display: 'grid', justifyItems: 'center', gap: 4, padding: '4px 0', borderRadius: 12, background: focus === a.id ? 'rgba(255,255,255,.07)' : 'transparent'}}>
                <Badge id={a.id} size={58} locked={!u} />
                <span style={{fontSize: 12, lineHeight: 1.2, textAlign: 'center', color: u ? 'var(--ice)' : 'var(--ice-faint)', fontVariationSettings: "'wdth' 82"}}>{a.name}</span>
              </motion.button>
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          {focus && (() => {
            const a = ACHIEVEMENT_BY_ID.get(focus)!;
            const u = unlocked.get(focus);
            return (
              <motion.div key={focus} role="status" initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -6}}
                style={{marginTop: 12, padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,.06)', display: 'flex', gap: 12, alignItems: 'center'}}>
                <Badge id={focus} size={48} locked={!u} />
                <div style={{fontSize: 15}}>
                  <strong style={{fontWeight: 700}}>{a.name}</strong>{' '}<span className="faint cond">{a.tier}</span>
                  <div className="muted">{a.rule}</div>
                  {a.note && <div className="faint" style={{fontSize: 13}}>{a.note}</div>}
                  <div style={{fontSize: 13, marginTop: 2, color: u ? 'var(--mc)' : 'var(--ice-faint)'}}>{u ? `Unlocked ${dateFmt.format(u.at)}` : 'Not unlocked yet'}</div>
                </div>
              </motion.div>
            );
          })()}
        </AnimatePresence>
      </section>

      <section aria-label="Recent games">
        <h3 className="cond" style={{margin: '0 0 8px', fontWeight: 600, color: 'var(--ice-dim)'}}>Recent games</h3>
        {detail.recent.length === 0 ? <p className="muted" style={{margin: 0}}>Finished games appear here.</p> : (
          <ol style={{listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 6}}>
            {detail.recent.map((r) => (
              <li key={r.gameId} style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.04)',
                boxShadow: `inset 3px 0 0 ${r.placement === 1 && r.players > 1 ? 'var(--mc)' : 'var(--rim-strong)'}`}}>
                <span className="num" style={{fontSize: 20, width: 34, color: r.placement === 1 && r.players > 1 ? 'var(--mc)' : 'var(--ice)'}}>{r.players > 1 ? ordinal(r.placement) : 'Solo'}</span>
                <span style={{flex: 1, minWidth: 0}}>
                  <span style={{display: 'block', fontWeight: 650, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{r.corporations[0] ?? 'No corporation'}</span>
                  <span className="faint" style={{fontSize: 13}}>{BOARDS[r.board].title} · {r.mode === 'full' ? 'Full game' : 'Companion'} · gen {r.generations} · {shortDate.format(r.endedAt)}</span>
                </span>
                <span className="num" style={{fontSize: 22}}>{r.vp}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {own && <MergeDuplicate detail={detail} />}
    </div>
  );
}

const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

function EditProfile({detail, onSaved}: {detail: ProfileDetail; onSaved: () => void}) {
  const {updateProfile, loadProfile} = useNet();
  const [name, setName] = useState(detail.profile.name);
  const [color, setColor] = useState<PlayerColor>(detail.profile.color);
  const [avatar, setAvatar] = useState<string | null>(detail.profile.avatar);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true); setError(null);
    try { await updateProfile(detail.profile.id, {name, color, avatar}); await loadProfile(detail.profile.id); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div style={{display: 'grid', gap: 14, padding: 14, borderRadius: 16, background: 'rgba(255,255,255,.04)'}}>
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} aria-label="Name"
        style={{padding: '12px 14px', fontSize: 18, borderRadius: 12, border: 0, background: 'rgba(0,0,0,.35)', outline: 'none'}} />
      <ColourRow value={color} onChange={setColor} />
      <PortraitRow name={name} color={color} value={avatar} onChange={setAvatar} />
      {error && <p role="alert" style={{margin: 0, color: 'var(--ember)'}}>{error}</p>}
      <button className="btn warm" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save profile'}</button>
    </div>
  );
}

export function ColourRow({value, onChange, taken}: {value: PlayerColor; onChange: (c: PlayerColor) => void; taken?: Set<string>}) {
  return (
    <div role="radiogroup" aria-label="Colour" style={{display: 'flex', gap: 8}}>
      {PLAYER_COLORS.map((c) => (
        <motion.button key={c} role="radio" aria-checked={value === c} aria-label={c} whileTap={{scale: 0.9}} disabled={taken?.has(c)} onClick={() => onChange(c)}
          style={{flex: 1, height: 40, borderRadius: 12, background: PLAYER_HEX[c], opacity: taken?.has(c) ? 0.2 : 1,
            boxShadow: value === c ? '0 0 0 3px var(--dusk-1), 0 0 0 5px var(--ice)' : 'none'}} />
      ))}
    </div>
  );
}

/** Optional face: the colour monogram, or one of the corporation portraits. */
export function PortraitRow({name, color, value, onChange}: {name: string; color: string; value: string | null; onChange: (a: string | null) => void}) {
  return (
    <div role="radiogroup" aria-label="Portrait" style={{display: 'flex', gap: 10, overflowX: 'auto', padding: '6px 4px 8px', scrollSnapType: 'x mandatory'}}>
      {[null, ...PORTRAITS].map((a) => (
        <motion.button key={a ?? 'mono'} role="radio" aria-checked={value === a} aria-label={a ? `Portrait ${a}` : 'Monogram'} whileTap={{scale: 0.9}} onClick={() => onChange(a)}
          style={{flex: 'none', scrollSnapAlign: 'start', borderRadius: '50%', padding: 3, boxShadow: value === a ? '0 0 0 2.5px var(--ice)' : 'none'}}>
          <Avatar name={name || '?'} color={color} avatar={a} size={46} ring={false} />
        </motion.button>
      ))}
    </div>
  );
}

function MergeDuplicate({detail}: {detail: ProfileDetail}) {
  const {profiles, mergeProfiles, loadProfile} = useNet();
  const others = useMemo(() => profiles.filter((p) => p.id !== detail.profile.id), [profiles, detail.profile.id]);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  if (!others.length) return null;
  const dup = others.find((p) => p.id === pick);
  async function merge() {
    if (!dup) return;
    try { await mergeProfiles(dup.id, detail.profile.id); await loadProfile(detail.profile.id); setOpen(false); setPick(null); setArmed(false); }
    catch (e) { setError((e as Error).message); }
  }
  return (
    <section aria-label="Duplicate profile" style={{borderTop: '1px solid var(--rim)', paddingTop: 16}}>
      {!open ? (
        <button onClick={() => setOpen(true)} className="muted" style={{fontSize: 15, textDecoration: 'underline', textUnderlineOffset: 3}}>Another profile is also you?</button>
      ) : (
        <div style={{display: 'grid', gap: 10}}>
          <p className="muted" style={{margin: 0, fontSize: 15}}>Pick the duplicate. Its games and achievements move into {detail.profile.name}, and it disappears from the list.</p>
          <div style={{display: 'grid', gap: 6}}>
            {others.map((p) => (
              <button key={p.id} onClick={() => { setPick(p.id); setArmed(false); }} aria-pressed={pick === p.id}
                style={{display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, textAlign: 'left',
                  background: pick === p.id ? 'rgba(226,80,46,.14)' : 'rgba(255,255,255,.04)', boxShadow: pick === p.id ? 'inset 0 0 0 1.5px var(--ember)' : 'none'}}>
                <Avatar name={p.name} color={p.color} avatar={p.avatar} size={32} />
                <span style={{flex: 1, fontWeight: 650}}>{p.name}</span>
                <span className="faint" style={{fontSize: 13}}>{p.games} game{p.games === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
          <button className={`btn ${armed ? 'danger' : 'ghost'}`} disabled={!dup} onClick={() => (armed ? merge() : setArmed(true))}>
            {dup ? (armed ? `Tap again to merge ${dup.name} into ${detail.profile.name}` : `Merge ${dup.name} into ${detail.profile.name}`) : 'Pick the duplicate first'}
          </button>
          {error && <p role="alert" style={{margin: 0, color: 'var(--ember)'}}>{error}</p>}
          <button className="btn ghost" onClick={() => { setOpen(false); setPick(null); setArmed(false); }}>Cancel</button>
        </div>
      )}
    </section>
  );
}
