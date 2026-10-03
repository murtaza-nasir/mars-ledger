// Between generations: the TR race so far and the generation's highlights. The TV plays it while
// players do their research on their phones; it never waits for anyone.
import {motion} from 'motion/react';
import {useEffect, useState} from 'react';
import type {Color} from '../../../shared/full';
import {highlights, trRace} from '../../../shared/history';
import type {GameHistory} from '../../../shared/history';
import {PLAYER_HEX, ResIcon} from '../../ui/Icons';
import {Rolling} from '../../ui/Rolling';
import type {Resource} from '../../../shared/types';
import {CardArt} from './CardArt';
import {TrRace} from './TrRace';
import {tvt} from '../settings';

function useLater<T>(value: T, zero: T, ms: number): T {
  const [v, setV] = useState(zero);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function Recap({history, generation}: {history: GameHistory; generation: number}) {
  const g = history.generations.find((x) => x.generation === generation);
  const nameOf = (c?: Color) => history.players.find((p) => p.color === c)?.name ?? '';
  const race = trRace(history).map((s) => ({...s, name: nameOf(s.color), points: s.points.filter((p) => p.generation <= generation)}));
  const hi = g ? highlights(g) : null;
  const cards: React.ReactNode[] = [];
  if (hi?.biggestPlay) {
    const b = hi.biggestPlay;
    cards.push(
      <Highlight key="big" label="Biggest play" color={PLAYER_HEX[b.color]}>
        <div style={{display: 'flex', gap: '1.1vw', alignItems: 'center'}}>
          <CardArt name={b.name} style={{width: '11vw', aspectRatio: '3 / 2', borderRadius: '0.7vw', flexShrink: 0}} />
          <div style={{minWidth: 0}}>
            <div style={{fontSize: '2.2vw', fontWeight: 800, lineHeight: 1.05, fontVariationSettings: "'wdth' 88"}}>{b.name}</div>
            <div style={{fontSize: '1.6vw', marginTop: '0.8vh'}}><span style={{color: PLAYER_HEX[b.color], fontWeight: 700}}>{nameOf(b.color)}</span>
              <span className="faint"> · </span><Counter value={b.cost} delay={1500} /> <span className="faint">M€</span></div>
          </div>
        </div>
      </Highlight>,
    );
  }
  if (hi?.harshestAttack) {
    const a = hi.harshestAttack;
    cards.push(
      <Highlight key="atk" label="Harshest attack" color="var(--ember)">
        <div style={{fontSize: '2.2vw', fontWeight: 800, fontVariationSettings: "'wdth' 88"}}>
          <span style={{color: PLAYER_HEX[a.attacker]}}>{nameOf(a.attacker)}</span>
          <span className="faint" style={{fontWeight: 500}}> hit </span>
          {a.targets.map((t, i) => <span key={t.color} style={{color: PLAYER_HEX[t.color]}}>{i ? ', ' : ''}{nameOf(t.color)}</span>)}
        </div>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.6vw', marginTop: '0.8vh'}}>
          {a.targets.flatMap((t) => t.losses).slice(0, 5).map((l, k) => (
            <span key={k} style={{display: 'inline-flex', alignItems: 'center', gap: '0.4vw', fontSize: '1.5vw', padding: '0.4vh 0.9vw', borderRadius: 999, background: 'rgba(226,80,46,.16)'}}>
              {l.resource && <ResIcon r={l.resource as Resource} size={Math.round(window.innerWidth * 0.017)} />}
              <span className="num" style={{color: 'var(--ember)'}}>−{l.amount}</span>
              <span className="faint">{l.what === 'production' ? 'prod' : l.what === 'card' ? (l.card ?? '') : l.what === 'tr' ? 'TR' : ''}</span>
            </span>
          ))}
        </div>
      </Highlight>,
    );
  }
  if (hi?.mostTiles) {
    const m = hi.mostTiles;
    cards.push(
      <Highlight key="tiles" label="Most tiles" color={PLAYER_HEX[m.color]}>
        <div style={{display: 'flex', alignItems: 'baseline', gap: '1vw'}}>
          <span style={{fontSize: '2.2vw', fontWeight: 800, color: PLAYER_HEX[m.color]}}>{nameOf(m.color)}</span>
          <Counter value={m.count} delay={2400} big />
          <span className="faint" style={{fontSize: '1.5vw'}}>{[m.tiles.city && `${m.tiles.city} city`, m.tiles.greenery && `${m.tiles.greenery} greenery`, m.tiles.ocean && `${m.tiles.ocean} ocean`, m.tiles.special && `${m.tiles.special} special`].filter(Boolean).join(' · ')}</span>
        </div>
      </Highlight>,
    );
  }
  if (hi) {
    const tf = hi.terraforming;
    cards.push(
      <Highlight key="tf" label="Terraforming this generation" color="var(--tr)">
        <div style={{display: 'flex', gap: '2.2vw'}}>
          <Delta label="Temperature" unit="°C" value={tf.temperature * 2} delay={3200} color="var(--heat)" />
          <Delta label="Oxygen" unit="%" value={tf.oxygen} delay={3350} color="var(--plants)" />
          <Delta label="Oceans" unit="" value={tf.oceans} delay={3500} color="var(--ocean)" />
        </div>
      </Highlight>,
    );
  }

  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, scale: 1.02}} transition={{duration: 0.6}}
      style={{position: 'absolute', inset: 0, zIndex: 40, overflow: 'hidden'}}>
      {/* no backdrop blur (a full-screen blur at 4K, redone through every fade); a slightly more opaque panel instead
          (97 % rather than 93 % over a blur) keeps the board behind as faint as it was. The board is paused meanwhile. */}
      <div style={{position: 'absolute', inset: 0, background: 'rgba(12,5,3,.97)'}} />
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(60% 60% at 30% 40%, rgba(111,184,232,.10), transparent), radial-gradient(50% 50% at 85% 80%, rgba(242,194,48,.08), transparent)'}} />
      {/* a fixed width: the title's tracking animates, and a shrink-to-fit box would change size every frame */}
      <div style={{position: 'absolute', left: '5vw', top: '5vh', width: '60vw'}}>
        <motion.div className="cond" initial={{opacity: 0, x: -20}} animate={{opacity: 1, x: 0}} transition={{delay: 0.1}} style={{fontSize: '1.5vw', color: 'var(--ice-dim)'}}>
          Generation recap
        </motion.div>
        <motion.div initial={{opacity: 0, y: 24, letterSpacing: '0.2em'}} animate={{opacity: 1, y: 0, letterSpacing: '-0.01em'}} transition={{delay: 0.2, duration: 0.9, ease: [0.2, 0.9, 0.25, 1]}}
          style={{fontSize: '5.4vw', fontWeight: 900, lineHeight: 0.95, fontVariationSettings: "'wdth' 122", whiteSpace: 'nowrap'}}>
          Generation {generation}
        </motion.div>
      </div>
      <motion.div initial={{opacity: 0, y: 30}} animate={{opacity: 1, y: 0}} transition={{delay: 0.5, duration: 0.7}}
        style={{position: 'absolute', left: '4vw', top: '22vh', width: '54vw', height: '70vh', padding: '2.4vh 1.6vw', borderRadius: '1.4vw',
          background: 'rgba(255,255,255,.035)', boxShadow: 'inset 0 0 0 1px var(--rim)'}}>
        <div className="cond" style={{fontSize: '1.5vw', color: 'var(--ice-dim)', marginBottom: '1vh'}}>Terraform rating</div>
        <div style={{height: 'calc(100% - 5vh)'}}><TrRace series={race} delay={0.8} draw={2.2} highlight={generation} /></div>
      </motion.div>
      <div style={{position: 'absolute', right: '3.5vw', top: '8vh', bottom: '8vh', width: '36vw', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2.2vh'}}>
        {cards.length ? cards.map((c, i) => (
          <motion.div key={i} initial={{opacity: 0, x: 60, rotateY: -25}} animate={{opacity: 1, x: 0, rotateY: 0}}
            transition={{delay: 1.2 + i * 0.95, type: 'spring', stiffness: 110, damping: 16}} style={{perspective: 900}}>{c}</motion.div>
        )) : <div className="muted" style={{fontSize: '1.6vw'}}>A quiet generation.</div>}
      </div>
    </motion.div>
  );
}

function Highlight({label, color, children}: {label: string; color: string; children: React.ReactNode}) {
  return (
    <div style={{padding: '2.2vh 1.7vw', borderRadius: '1.2vw', background: 'rgba(255,255,255,.045)', boxShadow: `inset 0.35vw 0 0 ${color}, 0 1.5vw 3vw rgba(0,0,0,.4)`}}>
      <div className="cond" style={{fontSize: '1.3vw', color, marginBottom: '1vh', fontWeight: 700}}>{label}</div>
      {children}
    </div>
  );
}

function Counter({value, delay, big}: {value: number; delay: number; big?: boolean}) {
  const v = useLater(value, 0, delay);
  return <Rolling value={v} className="num" style={{fontSize: big ? '3.2vw' : '1.7vw'}} showDelta={false} />;
}

function Delta({label, unit, value, delay, color}: {label: string; unit: string; value: number; delay: number; color: string}) {
  const v = useLater(value, 0, delay);
  return (
    <div>
      <div className="cond faint" style={{fontSize: tvt(1.25)}}>{label}</div>
      <div style={{color, display: 'flex', alignItems: 'flex-start'}}>
        <span className="num" style={{fontSize: '3.2vw'}}>+</span>
        <Rolling value={Math.max(0, v)} className="num" style={{fontSize: '3.2vw'}} showDelta={false} />
        <span className="num" style={{fontSize: '1.6vw', marginLeft: '0.3vw', marginTop: '0.3vw'}}>{unit}</span>
      </div>
    </div>
  );
}
