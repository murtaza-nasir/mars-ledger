// The off-turn plan tray: while others play, pin cards from your hand as "intended" and see what they would cost
// against your M€ now plus next generation's income (and steel or titanium where they pay). A chip on the Hand tab
// opens it. Private to this phone: the pins live in its storage only.
import {AnimatePresence, motion} from 'motion/react';
import {useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import type {PlayerViewModel} from '../../../../shared/full';
import {CardRow} from '../CardRow';
import {cardDef} from '../model';
import {tentative} from './Preview';
import {trayTotals} from './rules';
import {usePins, usePlans} from './store';

/** The Hand tab's chip: "Intended · 2 cards · 31 M€", or "Plan for next turn" while nothing is pinned. Shown when it
 *  is not your turn, or while something is pinned. */
export function IntendedChip({model, myTurn}: {model: PlayerViewModel; myTurn: boolean}) {
  const pins = usePins();
  const [open, setOpen] = useState(false);
  const totals = useMemo(() => trayTotals(model, pins), [model, pins]);
  if (myTurn && !pins.length) return null;
  if (!model.cardsInHand.length && !pins.length) return null;
  return (
    <>
      <motion.button data-testid="tray-chip" whileTap={{scale: 0.95}} onClick={() => setOpen(true)} aria-haspopup="dialog"
        style={{flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 10px', borderRadius: 999, fontSize: 13.5, fontWeight: 650,
          color: 'var(--tr)', border: '1.5px dashed color-mix(in oklab, var(--tr) 70%, transparent)', background: 'transparent'}}>
        {pins.length ? (
          <>
            <span>Intended</span>
            <span className="num" style={{fontSize: 12.5}}>{pins.length}</span>
            <span className="num" style={{fontSize: 12.5, color: totals.left < 0 ? '#FFB39E' : 'var(--tr)'}}>· {totals.cost} M€</span>
          </>
        ) : <span>Plan ahead</span>}
      </motion.button>
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>{open && <TraySheet key="tray" model={model} onClose={() => setOpen(false)} />}</AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function TraySheet({model, onClose}: {model: PlayerViewModel; onClose: () => void}) {
  const pins = usePins();
  const toggle = usePlans((s) => s.togglePin);
  const clear = usePlans((s) => s.clearPins);
  const t = useMemo(() => trayTotals(model, pins), [model, pins]);
  const me = model.thisPlayer;
  const hand = [...model.cardsInHand].sort((a, b) => Number(pins.includes(b.name)) - Number(pins.includes(a.name)));
  return (
    <>
      {/* a plain scrim: no blur (iPhones repaint blurred layers on every frame) */}
      <motion.div key="scrim" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} onClick={onClose}
        style={{position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(10,4,2,.7)'}} />
      <motion.section key="sheet" role="dialog" aria-label="Intended cards" data-testid="tray-sheet"
        initial={{y: '100%'}} animate={{y: 0}} exit={{y: '100%'}} transition={{type: 'spring', stiffness: 320, damping: 34}}
        style={{position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 51, maxHeight: '88svh', display: 'flex', flexDirection: 'column',
          background: 'linear-gradient(180deg, var(--dusk-2), var(--dusk-1) 60%)', borderRadius: '22px 22px 0 0', boxShadow: '0 -1px 0 var(--rim-strong)',
          paddingBottom: 'env(safe-area-inset-bottom)'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 6px'}}>
          <h2 style={{margin: 0, flex: 1, fontSize: 21, fontWeight: 700, fontVariationSettings: "'wdth' 80"}}>Intended cards</h2>
          <button className="btn ghost" data-testid="tray-close" style={{minHeight: 36, padding: '0 14px', fontSize: 15}} onClick={onClose}>Done</button>
        </div>
        <div style={{overflowY: 'auto', padding: '0 16px 20px'}}>
          <p className="muted" style={{margin: '0 2px 10px', fontSize: 14}}>Pin the cards you mean to play next. Only you see this list.</p>
          <div data-testid="tray-totals" style={{...tentative, padding: '10px 12px', marginBottom: 14}}>
            <div style={{display: 'flex', alignItems: 'baseline', gap: 8}}>
              <span style={{flex: 1, fontWeight: 650}}>{t.cards.length ? `${t.cards.length} card${t.cards.length === 1 ? '' : 's'} pinned` : 'Nothing pinned yet'}</span>
              <span className="num" data-testid="tray-cost" style={{fontSize: 22}}>{t.cost}</span><span className="faint">M€</span>
            </div>
            <div className="muted" style={{fontSize: 13.5, marginTop: 4, lineHeight: 1.45}}>
              <div data-testid="tray-money">{t.mc} M€ now, plus {t.income} M€ next generation (TR {me.terraformRating}, M€ production {me.megacreditProduction < 0 ? `\u2212${-me.megacreditProduction}` : me.megacreditProduction})</div>
              {t.steel > 0 && <div data-testid="tray-steel">Steel can pay {t.steel} M€ of the building cards ({me.steel} now, +{me.steelProduction} next generation, {me.steelValue} M€ each)</div>}
              {t.titanium > 0 && <div data-testid="tray-titanium">Titanium can pay {t.titanium} M€ of the space cards ({me.titanium} now, +{me.titaniumProduction} next generation, {me.titaniumValue} M€ each)</div>}
            </div>
            {t.cards.length > 0 && (
              <div data-testid="tray-verdict" style={{marginTop: 6, fontWeight: 650, color: t.left >= 0 ? '#9FE3AE' : '#FFB39E'}}>
                {t.left >= 0 ? `Covered, with ${t.left} M€ to spare` : `${-t.left} M€ short`}
              </div>
            )}
            <div className="faint" style={{fontSize: 12.5, marginTop: 4}}>Counts costs only, not requirements or what happens before then.</div>
          </div>
          <div style={{display: 'grid', gap: 8}}>
            {hand.map((c) => {
              const on = pins.includes(c.name);
              return (
                <motion.button key={c.name} data-tray-card={c.name} data-pinned={on ? 'true' : 'false'} whileTap={{scale: 0.985}} onClick={() => toggle(c.name)} aria-pressed={on}
                  style={{position: 'relative', display: 'block', width: '100%', textAlign: 'left', borderRadius: 16, ...(on ? {...tentative, padding: 3} : {padding: 3})}}>
                  <CardRow card={cardDef(c.name)} cost={c.calculatedCost} />
                  <span style={{position: 'absolute', top: 8, right: 10, padding: '1px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                    color: on ? '#24130F' : 'var(--ice-dim)', background: on ? 'var(--tr)' : 'rgba(0,0,0,.4)'}}>{on ? 'Intended' : 'Pin'}</span>
                </motion.button>
              );
            })}
          </div>
          {pins.length > 0 && <button className="btn ghost" data-testid="tray-clear" style={{width: '100%', marginTop: 14}} onClick={clear}>Clear the list</button>}
        </div>
      </motion.section>
    </>
  );
}
