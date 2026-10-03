// "While you were away": a compact card that slides down from the top of the phone when it comes back
// after being hidden or offline for a while. Not a modal: it never covers an open decision (then it
// shrinks to a slim pill above the sheet), dismisses on tap, swipe up, or after AWAY_SHOW_MS.
import {AnimatePresence, motion, useReducedMotion} from 'motion/react';
import type {ReactNode} from 'react';
import {useEffect, useState} from 'react';
import {AWAY_SHOW_MS, awayFor} from '../../shared/away';
import type {AwaySummary, Who} from '../../shared/away';
import type {Loss} from '../../shared/attack';
import {RESOURCES} from '../../shared/types';
import type {Resource} from '../../shared/types';
import {useNet} from '../net';
import {PLAYER_HEX, ResIcon} from '../ui/Icons';

const PARAM_UNIT = {temperature: '°C', oxygen: '% O₂', oceans: ''} as const;

/** Is a decision sheet open right now? (Sheets are dialogs; the card must not sit on top of one.) */
function useDecisionOpen(on: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!on) return;
    const check = () => setOpen(!!document.querySelector('section[role=dialog]'));
    check();
    const t = setInterval(check, 300);
    return () => clearInterval(t);
  }, [on]);
  return open;
}

function usePageVisible(): boolean {
  const [v, setV] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const f = () => setV(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  return v;
}

/** Hold the card while the production show is playing (its tokens pour in from the top edge). */
function useShowPlaying(): boolean {
  const show = useNet((s) => s.production);
  const [, tick] = useState(0);
  const end = show ? show.localStart + show.durationMs : 0;
  useEffect(() => {
    if (!end || end <= Date.now()) return;
    const t = setTimeout(() => tick((n) => n + 1), end - Date.now() + 50);
    return () => clearTimeout(t);
  }, [end]);
  return end > Date.now();
}

export function AwayCard() {
  const summary = useNet((s) => s.away);
  const dismiss = useNet((s) => s.dismissAway);
  const visible = usePageVisible();
  const showPlaying = useShowPlaying();
  const ready = !!summary && visible && !showPlaying;
  const decision = useDecisionOpen(ready);
  const [expanded, setExpanded] = useState(false);
  const reduce = useReducedMotion();

  // A new summary starts collapsed-if-needed and gets its own timer, counted from when it is on screen.
  useEffect(() => { setExpanded(false); }, [summary?.id]);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(dismiss, AWAY_SHOW_MS);
    return () => clearTimeout(t);
  }, [ready, summary?.id, dismiss]);

  const pill = decision && !expanded;
  return (
    <AnimatePresence>
      {ready && summary && (
        <motion.aside key={summary.id} data-testid="away-card" data-mode={pill ? 'pill' : 'card'} aria-live="polite"
          aria-label="While you were away"
          initial={reduce ? {opacity: 0} : {opacity: 0, y: -80, scale: 0.96}}
          animate={{opacity: 1, y: 0, scale: 1}}
          exit={reduce ? {opacity: 0} : {opacity: 0, y: -70, transition: {duration: 0.22}}}
          transition={{type: 'spring', stiffness: 360, damping: 30}}
          drag="y" dragConstraints={{top: 0, bottom: 0}} dragElastic={{top: 0.7, bottom: 0.08}}
          onDragEnd={(_, i) => { if (i.offset.y < -36 || i.velocity.y < -500) dismiss(); }}
          onClick={() => (pill ? setExpanded(true) : dismiss())}
          style={{position: 'fixed', zIndex: 60, left: 10, right: 10, top: pill ? 'calc(4px + env(safe-area-inset-top))' : 'calc(10px + env(safe-area-inset-top))',
            maxWidth: 520, margin: '0 auto', cursor: 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
            borderRadius: pill ? 999 : 20, overflow: 'hidden',
            background: 'linear-gradient(180deg, rgba(58,32,24,.97), rgba(36,19,15,.97))',
            boxShadow: '0 0 0 1px var(--rim-strong), 0 18px 44px rgba(0,0,0,.55)', backdropFilter: 'blur(14px)'}}>
          {pill ? <Pill s={summary} /> : <Card s={summary} />}
          {/* the time left, as a thin bar along the bottom edge */}
          <motion.div key={`bar-${summary.id}`} initial={{scaleX: 1}} animate={{scaleX: 0}} transition={{duration: AWAY_SHOW_MS / 1000, ease: 'linear'}}
            style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, transformOrigin: 'left', background: 'var(--tr)', opacity: 0.55}} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

// ---- pieces ------------------------------------------------------------------------------------
const Dot = ({color, size = 9}: {color: string; size?: number}) => (
  <span aria-hidden style={{display: 'inline-block', width: size, height: size, borderRadius: size / 3, background: PLAYER_HEX[color] ?? '#888', flex: 'none'}} />
);
const Name = ({who}: {who: Who}) => <span style={{color: PLAYER_HEX[who.color] ?? 'var(--ice)', fontWeight: 700}}>{who.name}</span>;

function count(s: AwaySummary): number {
  return s.attacks.length + (s.params ? 1 : 0) + s.tiles.length + s.cards.shown.length + s.cards.more + s.claims.length + (s.income ? 1 : 0);
}

function TurnLine({s, big}: {s: AwaySummary; big?: boolean}) {
  const t = s.turn;
  if (t.mine) {
    return <span style={{display: 'inline-flex', alignItems: 'center', gap: 7, padding: big ? '5px 12px' : '2px 9px', borderRadius: 999, background: 'var(--mc)',
      color: '#2A1A04', fontWeight: 800, fontSize: big ? 15 : 13, fontVariationSettings: "'wdth' 92"}}>It's your turn</span>;
  }
  if (t.who) return <span style={{display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: big ? 14.5 : 13}}><Dot color={t.who.color} /><Name who={t.who} /><span className="muted">is playing</span></span>;
  if (t.phase) return <span className="muted" style={{fontSize: big ? 14.5 : 13}}>{t.phase}</span>;
  return null;
}

function Pill({s}: {s: AwaySummary}) {
  const n = count(s);
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 10, height: 36, padding: '0 14px'}}>
      <span className="cond" style={{fontSize: 13.5, fontWeight: 650, color: 'var(--ice-dim)', whiteSpace: 'nowrap'}}>While you were away</span>
      <span style={{fontSize: 13.5, whiteSpace: 'nowrap'}}>{n} change{n === 1 ? '' : 's'}</span>
      <span style={{flex: 1}} />
      {s.turn.mine ? <TurnLine s={s} /> : <span className="faint" style={{fontSize: 12.5, whiteSpace: 'nowrap'}}>Tap to read</span>}
    </div>
  );
}

function Row({icon, children, tone}: {icon: ReactNode; children: ReactNode; tone?: string}) {
  return (
    <div style={{display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--rim)'}}>
      <span aria-hidden style={{width: 22, flex: 'none', display: 'grid', placeItems: 'center', paddingTop: 1, color: tone}}>{icon}</span>
      <div style={{flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 1.4}}>{children}</div>
    </div>
  );
}

const lossLabel = (l: Loss): ReactNode => {
  if (l.what === 'tr') return <>−{l.amount} TR</>;
  if (l.what === 'card') return <>−{l.amount} from {l.card}</>;
  const r = l.resource as Resource | undefined;
  return (
    <>{r && <ResIcon r={r} size={15} />}−{l.amount}{l.what === 'production' ? ' production' : r ? '' : ''}</>
  );
};

const Chip = ({children, tone}: {children: ReactNode; tone?: string}) => (
  <span className="num" style={{display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 13.5,
    fontVariationSettings: "'wdth' 100", fontWeight: 700, background: 'rgba(255,255,255,.06)', color: tone, marginRight: 5, marginTop: 3}}>{children}</span>
);

function plural(n: number, one: string, many: string) { return `${n} ${n === 1 ? one : many}`; }
function tileText(t: {city: number; greenery: number; ocean: number; special: number}): string {
  return [t.city && plural(t.city, 'city', 'cities'), t.greenery && plural(t.greenery, 'greenery', 'greeneries'),
    t.ocean && plural(t.ocean, 'ocean', 'oceans'), t.special && plural(t.special, 'special tile', 'special tiles')].filter(Boolean).join(' · ');
}

function Card({s}: {s: AwaySummary}) {
  return (
    <div style={{padding: '12px 16px 14px', maxHeight: '62svh', overflowY: 'auto'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8}}>
        <span className="cond" style={{fontSize: 14, fontWeight: 650, color: 'var(--ice-dim)'}}>While you were away</span>
        <span className="faint" style={{fontSize: 13}}>{awayFor(s.until - s.since)}</span>
        <span style={{flex: 1}} />
        <span aria-hidden className="faint" style={{fontSize: 18, lineHeight: 1}}>×</span>
      </div>
      <div style={{marginBottom: 8}}><TurnLine s={s} big /></div>

      {s.attacks.map((a, i) => (
        <Row key={`a${i}`} tone="var(--ember)" icon={<svg width="16" height="16" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="currentColor" /></svg>}>
          <Name who={a.by} /> <span style={{color: 'var(--ember)'}}>hit you</span>
          <div>{a.losses.map((l, k) => <Chip key={k} tone="var(--ember)">{lossLabel(l)}</Chip>)}</div>
        </Row>
      ))}

      {s.income && (
        <Row tone="var(--mc)" icon={<ResIcon r="megacredits" size={17} />}>
          <span>Production paid you{s.income.times > 1 ? ` (${s.income.times} times)` : ''}</span>
          <div>{RESOURCES.filter((r) => s.income!.gains[r] > 0).map((r) => <Chip key={r}><ResIcon r={r} size={15} />+{s.income!.gains[r]}</Chip>)}</div>
          {s.income.energyToHeat > 0 && <div className="faint" style={{fontSize: 13}}>{s.income.energyToHeat} energy turned into heat</div>}
        </Row>
      )}

      {s.generations && (
        <Row tone="var(--ice-dim)" icon={<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20 4v5h-5" /></svg>}>
          Generation {s.generations.from} <span className="faint">→</span> <strong>{s.generations.to}</strong>
        </Row>
      )}

      {s.params && (
        <Row tone="var(--tr)" icon={<svg width="17" height="17" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M5 10c4 2 9-2 14 1" stroke="currentColor" strokeWidth="2" fill="none" /></svg>}>
          <span>Mars changed</span>
          <div>
            {s.params.temperature > 0 && <Chip tone="var(--heat)">+{s.params.temperature}{PARAM_UNIT.temperature}</Chip>}
            {s.params.oxygen > 0 && <Chip tone="var(--plants)">+{s.params.oxygen}{PARAM_UNIT.oxygen}</Chip>}
            {s.params.oceans > 0 && <Chip tone="var(--ocean)">+{plural(s.params.oceans, 'ocean', 'oceans')}</Chip>}
          </div>
          {s.params.by.length > 0 && (
            <div className="faint" style={{fontSize: 13}}>raised by {s.params.by.map((b, i) => <span key={b.color}>{i ? ', ' : ''}<Name who={b} /></span>)}</div>
          )}
        </Row>
      )}

      {s.tiles.length > 0 && (
        <Row icon={<svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 2 21 7v10l-9 5-9-5V7z" fill="none" stroke="var(--ice-dim)" strokeWidth="2" /></svg>}>
          {s.tiles.map((t) => <div key={t.color}><Name who={t} /> <span className="muted">placed {tileText(t)}</span></div>)}
        </Row>
      )}

      {s.cards.shown.length > 0 && (
        <Row icon={<svg width="15" height="17" viewBox="0 0 20 24"><rect x="2" y="2" width="16" height="20" rx="3" fill="none" stroke="var(--ice-dim)" strokeWidth="2" /></svg>}>
          <span className="muted">Played</span>
          <div style={{display: 'flex', flexWrap: 'wrap', gap: '2px 12px'}}>
            {s.cards.shown.map((c, i) => <span key={i} style={{display: 'inline-flex', alignItems: 'center', gap: 6}}><Dot color={c.by.color} size={8} />{c.card}</span>)}
            {s.cards.more > 0 && <span className="faint">+{s.cards.more} more</span>}
          </div>
        </Row>
      )}

      {s.claims.map((c, i) => (
        <Row key={`c${i}`} tone="var(--mc)" icon={<svg width="16" height="16" viewBox="0 0 24 24"><path d="M6 3v18M6 4h11l-2.5 4L17 12H6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>}>
          <Name who={c.by} /> <span className="muted">{c.kind === 'milestone' ? 'claimed' : 'funded'}</span> {c.name}
        </Row>
      ))}
    </div>
  );
}
