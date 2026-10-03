// Play a project card: find it (number, name or photo), check cost and requirements, pay, resolve.
import Fuse from 'fuse.js';
import {AnimatePresence, motion, useAnimationControls} from 'motion/react';
import {useMemo, useRef, useState} from 'react';
import {cardsFor, findCard} from '../../shared/cards';
import {canUseHeat, cardCost, paymentValue, resourcePayer, suggestPayment, unmetRequirements} from '../../shared/engine';
import type {GameState, Payment, PlayerState} from '../../shared/game';
import type {CardDef} from '../../shared/types';
import {useNet} from '../net';
import {CardFace, CardHintLines} from '../ui/CardFace';
import {cardHints, hintWorldFromCompanion} from '../ui/cardHints';
import {ResIcon} from '../ui/Icons';
import {Resolver, Stepper} from './Resolve';

type Mode = 'number' | 'name' | 'scan';

export function FindCard({state, group, onPick, exclude}: {state: GameState; group: 'project' | 'corporation' | 'prelude'; onPick: (c: CardDef) => void; exclude?: Set<string>}) {
  const vision = useNet((s) => s.config?.vision ?? false);
  const [mode, setMode] = useState<Mode>('number');
  const pool = useMemo(() => cardsFor(state.modules, group).filter((c) => !exclude?.has(c.name)), [state.modules, group, exclude]);
  const modes: Array<[Mode, string]> = [['number', 'Number'], ['name', 'Name'], ...(vision ? [['scan', 'Photo'] as [Mode, string]] : [])];
  return (
    <div>
      <div role="tablist" style={{display: 'flex', gap: 4, padding: 4, borderRadius: 14, background: 'rgba(255,255,255,.05)', marginBottom: 16}}>
        {modes.map(([m, label]) => (
          <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
            style={{flex: 1, position: 'relative', padding: '10px 0', fontWeight: 650, fontVariationSettings: "'wdth' 85", color: mode === m ? 'var(--dusk-1)' : 'var(--ice-dim)'}}>
            {mode === m && <motion.span layoutId="find-tab" style={{position: 'absolute', inset: 0, borderRadius: 10, background: 'var(--ice)'}} transition={{type: 'spring', stiffness: 400, damping: 34}} />}
            <span style={{position: 'relative'}}>{label}</span>
          </button>
        ))}
      </div>
      {mode === 'number' && <NumberPad pool={pool} group={group} onPick={onPick} />}
      {mode === 'name' && <NameSearch pool={pool} onPick={onPick} />}
      {mode === 'scan' && <Scan group={group} onPick={onPick} />}
    </div>
  );
}

function NumberPad({pool, group, onPick}: {pool: CardDef[]; group: string; onPick: (c: CardDef) => void}) {
  const [digits, setDigits] = useState('');
  const prefix = group === 'corporation' ? 'R' : group === 'prelude' ? 'P' : '';
  const norm = (s: string) => s.replace(/^[RP]/i, '').replace(/^0+/, '');
  const match = digits ? pool.find((c) => norm(c.number ?? '') === norm(digits)) : undefined;
  const press = (k: string) => setDigits((d) => (k === '⌫' ? d.slice(0, -1) : d.length < 3 ? d + k : d));
  return (
    <div>
      <div style={{textAlign: 'center', minHeight: 118}}>
        <div className="num" style={{fontSize: 64, letterSpacing: '0.06em', color: digits ? 'var(--ice)' : 'var(--ice-faint)'}}>
          {prefix}{digits.padStart(prefix ? 2 : 3, '·')}
        </div>
        <AnimatePresence mode="wait">
          {match ? (
            <motion.button key={match.name} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0}} onClick={() => onPick(match)}
              className="btn warm" style={{marginTop: 6}}>{match.name}</motion.button>
          ) : digits.length >= 2 ? (
            <motion.p key="none" initial={{opacity: 0}} animate={{opacity: 1}} className="muted">No card with that number</motion.p>
          ) : <p key="hint" className="faint">Type the number printed next to the cost</p>}
        </AnimatePresence>
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 8}}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k ? (
          <motion.button key={i} whileTap={{scale: 0.92, backgroundColor: 'rgba(255,255,255,.16)'}} onClick={() => press(k)}
            className="num" aria-label={k === '⌫' ? 'delete' : k}
            style={{height: 62, borderRadius: 14, fontSize: 28, background: 'rgba(255,255,255,.06)'}}>{k}</motion.button>
        ) : <span key={i} />)}
      </div>
    </div>
  );
}

function NameSearch({pool, onPick}: {pool: CardDef[]; onPick: (c: CardDef) => void}) {
  const [q, setQ] = useState('');
  const fuse = useMemo(() => new Fuse(pool, {keys: ['name'], threshold: 0.4, ignoreLocation: true}), [pool]);
  const hits = q.trim() ? fuse.search(q).slice(0, 8).map((h) => h.item) : [];
  return (
    <div>
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Card name" aria-label="Card name"
        style={{width: '100%', padding: '14px 16px', fontSize: 19, borderRadius: 14, border: 0, background: 'rgba(255,255,255,.08)', outline: 'none'}} />
      <div style={{marginTop: 12, display: 'grid', gap: 8}}>
        {hits.map((c) => (
          <motion.button key={c.name} layout initial={{opacity: 0}} animate={{opacity: 1}} onClick={() => onPick(c)} style={{textAlign: 'left'}}>
            <CardFace card={c} compact />
          </motion.button>
        ))}
      </div>
    </div>
  );
}

async function shrink(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

function Scan({group, onPick}: {group: string; onPick: (c: CardDef) => void}) {
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cands, setCands] = useState<Array<{name: string; score: number}>>([]);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setError(null); setCands([]); setBusy(true);
    try {
      const image = await shrink(f);
      setPhoto(image);
      const r = await fetch('/api/recognize', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({image, group})});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Recognition failed');
      setCands(j.candidates);
      if (!j.candidates.length) setError('No card matched. Try the number or the name instead.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onFile(e.target.files?.[0])} />
      <motion.button whileTap={{scale: 0.97}} onClick={() => input.current?.click()}
        style={{position: 'relative', width: '100%', aspectRatio: '4 / 3', borderRadius: 18, overflow: 'hidden', background: 'rgba(255,255,255,.05)',
          boxShadow: 'inset 0 0 0 1.5px var(--rim-strong)'}}>
        {photo ? <img src={photo} alt="" style={{width: '100%', height: '100%', objectFit: 'cover', opacity: busy ? 0.55 : 1}} />
          : <span className="muted" style={{fontSize: 18}}>Take a photo of the card</span>}
        {busy && (
          <motion.span initial={{y: '-10%'}} animate={{y: '1000%'}} transition={{duration: 1.1, repeat: Infinity, ease: 'easeInOut'}}
            style={{position: 'absolute', left: 0, right: 0, top: 0, height: '10%', background: 'linear-gradient(180deg, transparent, rgba(111,184,232,.55), transparent)'}} />
        )}
      </motion.button>
      {error && <p role="alert" style={{color: 'var(--ember)'}}>{error}</p>}
      <div style={{display: 'grid', gap: 8, marginTop: 12}}>
        {cands.map((c, i) => {
          const card = findCard(c.name);
          return card && (
            <motion.button key={c.name} initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: i * 0.05}} onClick={() => onPick(card)} style={{textAlign: 'left'}}>
              <CardFace card={card} compact />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ---- review + pay ----------------------------------------------------------------------------
export function PlayCard({state, me, onClose}: {state: GameState; me: PlayerState; onClose: () => void}) {
  const [card, setCard] = useState<CardDef | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [resolving, setResolving] = useState(false);
  const launch = useAnimationControls();
  const played = useMemo(() => new Set(state.players.flatMap((p) => p.played.map((c) => c.name))), [state.players]);

  if (!card) return <FindCard state={state} group="project" exclude={played} onPick={(c) => { setCard(c); setPayment(null); }} />;

  const cost = cardCost(me, card);
  const opts = {steel: card.tags.includes('building'), titanium: card.tags.includes('space'), tags: card.tags};
  const payer = resourcePayer(me, card.tags);
  const pay = payment ?? suggestPayment(me, cost, opts);
  const value = paymentValue(me, pay, opts);
  const unmet = unmetRequirements(state, me, card);
  // relevant counts (tags, cities, current parameters); an unmet requirement already has the alert below
  const hints = cardHints(card, hintWorldFromCompanion(state, me.id), {owner: me.id, place: 'hand'}).filter((h) => !(h.key.startsWith('req') && h.tone === 'unmet'));
  const set = (k: keyof Payment, n: number) => {
    const next = {...pay, [k]: n};
    // keep the total at the cost by moving M€ opposite the slider
    const other = paymentValue(me, {...next, megacredits: 0}, opts);
    next.megacredits = Math.max(0, Math.min(me.stock.megacredits, cost - other));
    setPayment(next);
  };

  if (resolving) {
    return (
      <div>
        <motion.div animate={launch}>
          <CardFace card={card} cost={cost} compact layoutId="play-card" />
        </motion.div>
        <div style={{height: 16}} />
        <Resolver state={state} command={{t: 'playCard', playerId: me.id, card: card.name, payment: pay, answers: []}}
          confirmLabel={`Play ${card.name}`} onDone={onClose} onBack={() => setResolving(false)}
          onLaunch={(phase) => {
            if (phase === 'go') void launch.start({y: -window.innerHeight * 1.1, rotate: -8, scale: 0.85, opacity: 0.9, transition: {duration: 0.55, ease: [0.45, 0, 0.7, 0.2]}});
            else void launch.start({y: 0, rotate: 0, scale: 1, opacity: 1, transition: {type: 'spring', stiffness: 220, damping: 22}});
          }} />
      </div>
    );
  }

  return (
    <div>
      <CardFace card={card} cost={cost} layoutId="play-card" />
      {hints.length > 0 && <CardHintLines hints={hints} style={{marginTop: 12, padding: '0 4px'}} />}
      {unmet.length > 0 && (
        <motion.div initial={{opacity: 0, scale: 0.97}} animate={{opacity: 1, scale: 1}} role="alert"
          style={{marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(226,80,46,.14)', boxShadow: 'inset 0 0 0 1.5px rgba(226,80,46,.5)'}}>
          <strong>Requirement not met here:</strong> {unmet.join(', ')}.
          <div className="muted" style={{fontSize: 14}}>If the board says otherwise, correct the global parameters on the Mars tab and carry on.</div>
        </motion.div>
      )}
      <div style={{marginTop: 18}}>
        {opts.steel && me.stock.steel > 0 && <Stepper icon={<ResIcon r="steel" />} label={`Steel (${me.steelValue} M€ each)`} value={pay.steel ?? 0} max={me.stock.steel} set={(n) => set('steel', n)} />}
        {opts.titanium && me.stock.titanium > 0 && <Stepper icon={<ResIcon r="titanium" />} label={`Titanium (${me.titaniumValue} M€ each)`} value={pay.titanium ?? 0} max={me.stock.titanium} set={(n) => set('titanium', n)} />}
        {canUseHeat(me) && me.stock.heat > 0 && <Stepper icon={<ResIcon r="heat" />} label="Heat (1 M€ each)" value={pay.heat ?? 0} max={me.stock.heat} set={(n) => set('heat', n)} />}
        {payer && payer.available > 0 && <Stepper icon={<span style={{width: 22}} />} label={`Resources on ${payer.card} (${payer.value} M€ each)`}
          value={pay.cardResources ?? 0} max={payer.available} set={(n) => set('cardResources', n)} />}
        <div style={{display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0'}}>
          <ResIcon r="megacredits" /><span style={{flex: 1}}>M€</span>
          <span className="num" style={{fontSize: 24}}>{pay.megacredits ?? 0}</span><span className="faint">of {me.stock.megacredits}</span>
        </div>
      </div>
      {value < cost && <p role="alert" style={{color: 'var(--ember)'}}>You are {cost - value} M€ short.</p>}
      <div style={{display: 'flex', gap: 10, marginTop: 14}}>
        <button className="btn ghost" onClick={() => setCard(null)}>Other card</button>
        <button className="btn warm" style={{flex: 1}} disabled={value < cost || (pay.megacredits ?? 0) > me.stock.megacredits} onClick={() => setResolving(true)}>
          Pay {cost} M€
        </button>
      </div>
    </div>
  );
}
