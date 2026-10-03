// The global parameters, drawn as the board's instrument column: generation, temperature, oxygen, oceans.
import {motion, useReducedMotion} from 'motion/react';
import {Rolling} from '../../ui/Rolling';
import {tvt, useTvSettings} from '../settings';
import {RADIO_SLOT_H} from '../radio/Radio';
import {useRadio} from '../radio/store';
import {useSolo} from '../../ui/useSolo';

const TEMP = Array.from({length: 19}, (_, i) => -28 + i * 2); // raised values
const OXY = Array.from({length: 14}, (_, i) => i + 1);
const TEMP_MARK: Record<number, string> = {[-24]: 'heat', [-20]: 'heat', 0: 'ocean'};
const OXY_MARK: Record<number, string> = {8: 'temp'};
/** Numbers beside the tubes: the bonus steps in their reward's colour, a few round values faint between them. */
const TEMP_LABEL = [-24, -20, -10, 0, 8];
const OXY_LABEL = [4, 8, 14];

function Mark({kind}: {kind: string}) {
  const c = kind === 'ocean' ? 'var(--ocean)' : 'var(--heat)';
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      {kind === 'ocean' ? <path d="M12 3C15 8 18 12 18 15.5a6 6 0 0 1-12 0C6 12 9 8 12 3z" fill={c} />
        : kind === 'temp' ? <g><rect x="10" y="3" width="4" height="13" rx="2" fill="var(--heat)" /><circle cx="12" cy="18" r="4" fill="var(--heat)" /></g>
          : <path d="M12 2.5c1 3.5 5.5 5.5 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.5 1.3-4 2.3-5 .2 1.8.9 2.8 2 3.3C10.4 8.5 11 5.5 12 2.5z" fill={c} />}
    </svg>
  );
}

/** A slim thermometer: a tube filled to the current value with a tick per step, the bonus steps marked beside it,
 *  and the value above. Narrow enough that two sit side by side in the left column. */
function Gauge({values, current, marks, labels, color, label, unit, tank}: {
  values: number[]; current: number; marks: Record<number, string>; labels: number[]; color: string; label: string; unit: string;
  /** oxygen: a gas cylinder (valve on top, a foot below, bubbles rising) instead of a second thermometer */
  tank?: boolean;
}) {
  const reduced = useReducedMotion();
  const n = values.length;
  const filled = values.filter((v) => v <= current).length;
  return (
    <div data-gauge={label} style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8vh', height: '100%', minWidth: 0}}>
      <div style={{textAlign: 'center'}}>
        <div className="cond" style={{fontSize: tvt(1), color: 'var(--ice-dim)', whiteSpace: 'nowrap'}}>{label}</div>
        <div style={{whiteSpace: 'nowrap', display: 'flex', alignItems: 'flex-end', justifyContent: 'center'}}>
          <Rolling value={current} className="num" style={{fontSize: '1.75vw'}} /><span className="faint" style={{fontSize: tvt(0.9), marginLeft: '0.15vw'}}>{unit}</span>
        </div>
      </div>
      <div style={{flex: 1, minHeight: 0, width: '100%', display: 'flex', justifyContent: 'center', position: 'relative'}}>
        <div style={{position: 'relative', width: tank ? '1.45vw' : '1.1vw', height: '100%', paddingBottom: '1.5vw'}}>
          {/* the tank's valve: a neck and a hand wheel above the cylinder */}
          {tank && (
            <div aria-hidden="true" style={{position: 'absolute', left: '50%', top: 0, transform: 'translateX(-50%)', width: '1.2vw', height: '1.1vw'}}>
              <div style={{position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', width: '0.42vw', height: '0.55vw', borderRadius: '0.1vw 0.1vw 0 0',
                background: 'linear-gradient(90deg, #6d7480, #b9c0cb 45%, #6d7480)'}} />
              <div style={{position: 'absolute', left: 0, right: 0, top: 0, height: '0.42vw', borderRadius: '0.2vw',
                background: 'linear-gradient(180deg, #c9cfd8, #7b828d)', boxShadow: '0 0.1vw 0.3vw rgba(0,0,0,.5)'}} />
            </div>
          )}
          {/* the tube (the tank's cylinder: rounder shoulders, a metal rim) */}
          <div style={{position: 'absolute', left: 0, right: 0, top: tank ? '1.1vw' : 0, bottom: '1.1vw', borderRadius: tank ? '0.65vw 0.65vw 0.4vw 0.4vw' : '0.5vw', background: 'rgba(255,255,255,0.07)',
            boxShadow: tank ? 'inset 0 0 0 1.5px rgba(200,210,220,.32), inset 0.3vw 0 0.4vw -0.2vw rgba(255,255,255,.12)' : 'inset 0 0 0 1px rgba(255,196,160,.14)', overflow: 'hidden'}}>
            <motion.div initial={false} animate={{height: `${(filled / n) * 100}%`}} transition={{type: 'spring', stiffness: 90, damping: 18}}
              style={{position: 'absolute', left: 0, right: 0, bottom: 0, background: `linear-gradient(0deg, ${color}, color-mix(in oklab, ${color} 70%, white))`,
                boxShadow: `0 0 1vw color-mix(in oklab, ${color} 50%, transparent)`}} />
            {values.slice(0, -1).map((v, i) => (
              <div key={v} style={{position: 'absolute', left: 0, right: 0, bottom: `${((i + 1) / n) * 100}%`, height: tank ? 2 : 1, background: 'rgba(16,7,4,.55)'}} />
            ))}
            {/* bubbles rising through the oxygen */}
            {tank && filled > 0 && !reduced && [0.25, 0.6, 0.42].map((x, i) => (
              <motion.span key={i} aria-hidden="true" initial={{bottom: '0%', opacity: 0}}
                animate={{bottom: [`0%`, `${(filled / n) * 100 - 4}%`], opacity: [0, 0.8, 0]}}
                transition={{duration: 2.6 + i * 0.7, repeat: Infinity, delay: i * 1.1, ease: 'easeIn'}}
                style={{position: 'absolute', left: `${x * 100}%`, width: '0.22vw', height: '0.22vw', minWidth: 3, minHeight: 3, borderRadius: '50%',
                  background: 'rgba(235,255,240,.85)'}} />
            ))}
            {/* the glass and metal sheen down one side */}
            {tank && <div aria-hidden="true" style={{position: 'absolute', top: '4%', bottom: '4%', left: '18%', width: '0.16vw', borderRadius: 2, background: 'rgba(255,255,255,.18)'}} />}
          </div>
          {tank ? (
            /* the cylinder's foot */
            <div aria-hidden="true" style={{position: 'absolute', left: '50%', bottom: '0.55vw', width: '1.7vw', height: '0.5vw', transform: 'translateX(-50%)', borderRadius: '0.15vw 0.15vw 0.3vw 0.3vw',
              background: 'linear-gradient(180deg, #8a919c, #4f555e)', boxShadow: '0 0.2vw 0.4vw rgba(0,0,0,.45)'}} />
          ) : (
            /* the bulb */
            <div style={{position: 'absolute', left: '50%', bottom: 0, width: '1.7vw', height: '1.7vw', transform: 'translateX(-50%)', borderRadius: '50%',
              background: filled ? color : 'rgba(255,255,255,0.1)', boxShadow: filled ? `0 0 1vw color-mix(in oklab, ${color} 50%, transparent)` : 'none'}} />
          )}
          {values.map((v, i) => labels.includes(v) && (
            <div key={`l${v}`} data-scale={v} className="num" style={{position: 'absolute', right: '150%', bottom: `calc(1.1vw + (100% - ${tank ? 3.7 : 2.6}vw) * ${(i + 0.5) / n})`,
              transform: 'translateY(50%)', fontSize: 'calc(0.8vw * var(--tvt, 1))', fontWeight: marks[v] ? 750 : 600, letterSpacing: '-0.02em', lineHeight: 1, whiteSpace: 'nowrap',
              color: marks[v] ? (marks[v] === 'ocean' ? 'var(--ocean)' : 'var(--heat)') : 'var(--ice-faint)', opacity: v <= current ? 0.45 : 1}}>
              {v < 0 ? `−${-v}` : v}
            </div>
          ))}
          {values.map((v, i) => marks[v] && (
            <div key={v} data-mark={v} style={{position: 'absolute', left: '135%', bottom: `calc(1.1vw + (100% - ${tank ? 3.7 : 2.6}vw) * ${(i + 0.5) / n})`, width: '1.15vw', height: '1.15vw',
              transform: 'translateY(50%)', opacity: v <= current ? 0.35 : 1}}>
              <Mark kind={marks[v]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Globals({generation, temperature, oxygen, oceans}: {generation: number; temperature: number; oxygen: number; oceans: number}) {
  const solo = useSolo();
  // the radio deck's corner (src/client/tv/radio): the foot of this column, out of the board's and the players' way
  const radioOn = useTvSettings().radio;
  const radioStatus = useRadio((s) => s.status);
  const radioSlot = radioOn && (radioStatus === 'ready' || radioStatus === 'loading');
  return (
    <div data-globals="" style={{display: 'flex', flexDirection: 'column', height: '100%', gap: '1.6vh'}}>
      <div>
        <div className="cond" style={{fontSize: tvt(1.05), color: 'var(--ice-dim)'}}>Generation</div>
        <div style={{display: 'flex', alignItems: 'baseline', whiteSpace: 'nowrap'}}>
          <Rolling value={generation} className="num" style={{fontSize: '3.8vw'}} />
          {solo && <span className="num faint" data-solo-limit={solo.last} style={{fontSize: '1.7vw', marginLeft: '0.3vw'}}>/{solo.last}</span>}
        </div>
        {/* Solo: the engine's generation limit is the clock; say how many generations are left, this one included */}
        {solo && (
          <div className="cond" data-testid="solo-left" style={{fontSize: tvt(0.95), color: solo.left <= 2 ? 'var(--mc)' : 'var(--ice-dim)', lineHeight: 1.2, marginTop: '0.3vh'}}>
            Solo · {solo.left === 1 ? 'last generation' : `${solo.left} left`}
          </div>
        )}
      </div>
      <div style={{flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6vw', minHeight: 0}}>
        <Gauge values={TEMP} current={temperature} marks={TEMP_MARK} labels={TEMP_LABEL} color="var(--heat)" label="Temp" unit="°C" />
        <Gauge tank values={OXY} current={oxygen} marks={OXY_MARK} labels={OXY_LABEL} color="var(--plants)" label="Oxygen" unit="%" />
      </div>
      <div>
        <div className="cond" style={{fontSize: tvt(1.05), color: 'var(--ice-dim)', marginBottom: '0.6vh', whiteSpace: 'nowrap'}}>Oceans <span className="num" style={{color: 'var(--ice)'}}>{oceans}</span><span className="faint">/9</span></div>
        {/* one compact row of nine, so the gauges above keep the height */}
        <div data-ocean-pips="" style={{display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: '0.12vw', width: '100%'}}>
          {Array.from({length: 9}, (_, i) => (
            <svg key={i} viewBox="0 0 24 26" style={{width: '100%'}} aria-hidden>
              <motion.path d="M12 1 23 7v12L12 25 1 19V7z" initial={false}
                animate={{fill: i < oceans ? '#2F82C0' : 'rgba(255,255,255,0.1)', scale: i < oceans ? 1 : 0.85}}
                transition={{type: 'spring', stiffness: 200, damping: 16}} />
            </svg>
          ))}
        </div>
      </div>
      {radioSlot && <div data-radio-slot="" style={{height: RADIO_SLOT_H, flex: 'none'}} />}
    </div>
  );
}
