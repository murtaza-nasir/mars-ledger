// "The story of your Mars", at game end: the board filling generation by generation, the complete
// TR race, a title for every player, then the podium with each score built up bar by bar.
// Tap the TV (or press any key) to skip ahead a chapter. The podium stays until the next game.
import {useSolo} from '../../ui/useSolo';
import {soloVerdict} from '../../../shared/solo';
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useState} from 'react';
import {useStage} from '../stage';
import type {Color, SpaceModel} from '../../../shared/full';
import {titles, trRace} from '../../../shared/history';
import type {GameHistory} from '../../../shared/history';
import {PLAYER_HEX} from '../../ui/Icons';
import {Rolling} from '../../ui/Rolling';
import {Board} from '../full/Board';
import {TrRace} from './TrRace';
import {tvt} from '../settings';
import {useDisplayName} from '../../names';

export type FinalScore = {color: Color; name: string; total: number; parts: Array<{label: string; value: number}>};

type Chapter = 'title' | 'timelapse' | 'race' | 'titles' | 'podium';
const LAPSE = 7.5;

export function Story({history, scores, startAtPodium}: {history: GameHistory; scores: FinalScore[]; startAtPodium?: boolean}) {
  const board = !!history.finalSpaces?.length && history.tiles.some((t) => t.spaceId);
  // a solo game the player lost: the podium stands on the bare planet, not the living one
  const soloLost = useSolo()?.result === 'lost';
  const chapters: Chapter[] = board ? ['title', 'timelapse', 'race', 'titles', 'podium'] : ['title', 'race', 'titles', 'podium'];
  const lengths: Record<Chapter, number> = {title: 2.2, timelapse: LAPSE + 1.2, race: 5, titles: 1.2 + history.players.length * 1.7, podium: Infinity};
  const [chapter, setChapter] = useState(startAtPodium ? chapters.length - 1 : 0);
  const current = chapters[chapter];
  // Mission control's captions wait while an animated chapter plays; the podium can share the screen.
  useEffect(() => {
    useStage.getState().set('story', current !== 'podium');
    useStage.getState().set('podium', current === 'podium');
  }, [current]);
  useEffect(() => {
    useStage.getState().setStoryStartedAt(Date.now());
    return () => {
      const st = useStage.getState();
      st.set('story', false); st.set('podium', false); st.setStoryStartedAt(null);
    };
  }, []);
  useEffect(() => {
    const len = lengths[current];
    if (!isFinite(len)) return;
    const t = setTimeout(() => setChapter((c) => Math.min(chapters.length - 1, c + 1)), len * 1000);
    return () => clearTimeout(t);
  }, [chapter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const skip = () => setChapter((c) => Math.min(chapters.length - 1, c + 1));
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => { window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); };
  }, [chapters.length]);

  const stage = current === 'title' ? 0 : current === 'timelapse' ? 1 : current === 'race' ? 2 : 3;
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 1}}
      style={{position: 'absolute', inset: 0, zIndex: 45, overflow: 'hidden', background: 'var(--dusk-0)', cursor: current === 'podium' ? 'default' : 'pointer'}}>
      <AnimatePresence>
        <motion.div key={stage} initial={{opacity: 0, scale: 1.08}} animate={{opacity: 1, scale: 1}} exit={{opacity: 0}} transition={{duration: 2.4}}
          style={{position: 'absolute', inset: 0, background: `url(/assets/${current === 'podium' ? (soloLost ? 'tv-stage-0' : 'event-gameend') : `tv-stage-${stage}`}.webp) center / cover`, filter: 'brightness(.42)'}} />
      </AnimatePresence>
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(75% 75% at 50% 50%, transparent, rgba(8,4,3,.85))'}} />
      <AnimatePresence>
        {current === 'title' && <TitleCard key="title" />}
        {current === 'timelapse' && <Timelapse key="lapse" history={history} />}
        {current === 'race' && <Race key="race" history={history} />}
        {current === 'titles' && <Titles key="titles" history={history} />}
        {current === 'podium' && <Podium key="podium" scores={scores} history={history} />}
      </AnimatePresence>
      {current !== 'podium' && (
        <div className="cond faint" style={{position: 'absolute', right: '3vw', bottom: '3vh', fontSize: tvt(1)}}>Tap to skip ahead</div>
      )}
    </motion.div>
  );
}

function TitleCard() {
  return (
    <motion.div exit={{opacity: 0, y: -30}} transition={{duration: 0.5}}
      style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center'}}>
      <div>
        <motion.div className="cond" initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.2}} style={{fontSize: '1.8vw', color: 'var(--ice-dim)'}}>The story of</motion.div>
        <motion.div initial={{opacity: 0, letterSpacing: '0.4em', filter: 'blur(14px)'}} animate={{opacity: 1, letterSpacing: '-0.01em', filter: 'blur(0px)'}}
          transition={{delay: 0.3, duration: 1.3, ease: [0.2, 0.9, 0.25, 1]}}
          style={{fontSize: '10vw', fontWeight: 900, lineHeight: 0.9, fontVariationSettings: "'wdth' 125"}}>your Mars</motion.div>
      </div>
    </motion.div>
  );
}

function Timelapse({history}: {history: GameHistory}) {
  const tiles = useMemo(() => history.tiles.filter((t) => t.spaceId).sort((a, b) => a.order - b.order), [history.tiles]);
  const base = useMemo<SpaceModel[]>(() => (history.finalSpaces ?? []).map((s) => ({...s, tileType: undefined, color: undefined})), [history.finalSpaces]);
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / (LAPSE * 1000));
      // ease-in-out so the first tiles and the last land slowly enough to see
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setN(Math.round(e * tiles.length));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [tiles.length]);
  const shown = tiles.slice(0, n);
  const byId = new Map(shown.map((t) => [t.spaceId, t]));
  const spaces = base.map((s) => { const t = byId.get(s.id); return t ? {...s, tileType: t.tileType, color: t.color} : s; });
  const fresh = new Set(shown.slice(-6).map((t) => t.spaceId));
  // The camera follows the newest tiles, then heads back for the whole board once 85% are down, so it has
  // settled on the full map before the chapter ends (the last tiles land slowly; the story spring takes ~2 s).
  const generation = shown.length ? shown[shown.length - 1].generation : 1;
  const counts = shown.reduce((a, t) => { const k = t.tileType === 0 ? 'greenery' : t.tileType === 1 ? 'ocean' : t.tileType === 2 || t.tileType === 3 ? 'city' : 'special'; a[k]++; return a; }, {greenery: 0, ocean: 0, city: 0, special: 0});
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0, scale: 0.96}} transition={{duration: 0.6}} style={{position: 'absolute', inset: 0}}>
      <div style={{position: 'absolute', left: '22vw', right: '22vw', top: '4vh', bottom: '4vh'}}>
        <Board spaces={spaces} fresh={fresh} hovers={[]} names={{}} progress={Math.min(1, n / Math.max(1, tiles.length))}
          camera={{focus: n < tiles.length * 0.85 ? shown.slice(-6).map((t) => t.spaceId!) : [], enabled: true, mode: 'story'}} />
      </div>
      <div style={{position: 'absolute', left: '4vw', top: '8vh'}}>
        <div className="cond" style={{fontSize: '1.4vw', color: 'var(--ice-dim)'}}>Generation</div>
        <Rolling value={generation} className="num" style={{fontSize: '9vw'}} showDelta={false} />
      </div>
      <div style={{position: 'absolute', left: '4vw', bottom: '8vh', display: 'grid', gap: '1.2vh'}}>
        {([['city', 'Cities', '#9AA3B8'], ['greenery', 'Greeneries', 'var(--plants)'], ['ocean', 'Oceans', 'var(--ocean)'], ['special', 'Special tiles', 'var(--mc)']] as const).map(([k, label, color]) => (
          <div key={k} style={{display: 'flex', alignItems: 'baseline', gap: '0.8vw'}}>
            <Rolling value={counts[k]} className="num" style={{fontSize: '3vw', color}} showDelta={false} />
            <span className="cond" style={{fontSize: '1.3vw', color: 'var(--ice-dim)'}}>{label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function Race({history}: {history: GameHistory}) {
  const nameFor = useDisplayName();
  const series = trRace(history).map((s) => ({...s, name: nameFor(s.color, history.players.find((p) => p.color === s.color)?.name ?? '')}));
  return (
    <motion.div initial={{opacity: 0, y: 30}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -30}} transition={{duration: 0.6}}
      style={{position: 'absolute', left: '7vw', right: '7vw', top: '6vh', bottom: '6vh'}}>
      <div style={{fontSize: '4vw', fontWeight: 900, fontVariationSettings: "'wdth' 120", lineHeight: 1}}>The race for Mars</div>
      <div className="cond muted" style={{fontSize: '1.4vw', margin: '1vh 0 3vh'}}>Terraform rating, generation by generation</div>
      <div style={{height: '70vh'}}><TrRace series={series} delay={0.4} draw={3.2} /></div>
    </motion.div>
  );
}

function Titles({history}: {history: GameHistory}) {
  const list = titles(history);
  const nameFor = useDisplayName();
  const nameOf = (c: Color) => nameFor(c, history.players.find((p) => p.color === c)?.name ?? '');
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.5}}
      style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2vw', padding: '0 4vw', flexWrap: 'wrap'}}>
      {list.map((t, i) => (
        <motion.div key={t.color} initial={{opacity: 0, y: 80, rotateX: 50, scale: 0.9}} animate={{opacity: 1, y: 0, rotateX: 0, scale: 1}}
          transition={{delay: 0.4 + i * 1.7, type: 'spring', stiffness: 90, damping: 14}}
          style={{width: `${Math.min(26, 88 / list.length)}vw`, padding: '4vh 1.8vw', borderRadius: '1.6vw', textAlign: 'center', perspective: 900,
            background: 'rgba(12,5,3,.72)', backdropFilter: 'blur(12px)', boxShadow: `0 0 0 0.15vw ${PLAYER_HEX[t.color]}, 0 2vw 5vw rgba(0,0,0,.55), 0 0 5vw color-mix(in oklab, ${PLAYER_HEX[t.color]} 25%, transparent)`}}>
          <div style={{fontSize: '2.2vw', fontWeight: 800, color: PLAYER_HEX[t.color], fontVariationSettings: "'wdth' 95"}}>{nameOf(t.color)}</div>
          <motion.div initial={{letterSpacing: '0.25em', opacity: 0}} animate={{letterSpacing: '-0.01em', opacity: 1}} transition={{delay: 0.9 + i * 1.7, duration: 0.8}}
            style={{fontSize: '3vw', fontWeight: 900, lineHeight: 1, margin: '2.4vh 0 1.6vh', fontVariationSettings: "'wdth' 118"}}>{t.title}</motion.div>
          <div className="muted" style={{fontSize: '1.4vw'}}>{t.detail}</div>
        </motion.div>
      ))}
    </motion.div>
  );
}

function LateTotal({value, delay, big}: {value: number; delay: number; big: boolean}) {
  const [v, setV] = useState(0);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return <div style={{textAlign: 'right'}}><Rolling value={v} className="num" style={{fontSize: big ? '5.6vw' : '4vw'}} showDelta={false} /></div>;
}

const PART_COLORS = ['var(--tr)', 'var(--plants)', '#9AA3B8', 'var(--mc)', 'var(--energy)', 'var(--heat)'];

function Podium({scores, history}: {scores: FinalScore[]; history: GameHistory}) {
  const rows = [...scores].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...rows.map((r) => r.total));
  const labels = rows[0]?.parts.map((p) => p.label) ?? [];
  const title = new Map(titles(history).map((t) => [t.color, t.title]));
  // Solo: the engine's verdict (terraformed in time or not) is the headline; there is no place to rank.
  const solo = useSolo();
  const verdict = solo && rows.length === 1 ? soloVerdict(solo) : null;
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 1}}
      style={{position: 'absolute', left: '7vw', right: '7vw', top: '7vh', bottom: '7vh', display: 'flex', flexDirection: 'column'}}>
      <motion.div initial={{opacity: 0, y: 20}} animate={{opacity: 1, y: 0}} transition={{delay: 0.2}}
        style={{fontSize: '6vw', fontWeight: 900, fontVariationSettings: "'wdth' 122", lineHeight: 1, marginBottom: '1.4vh'}}>{verdict?.title ?? 'Mars is alive'}</motion.div>
      {verdict && (
        <motion.div data-testid="solo-result" data-result={solo!.result} initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.6}}
          style={{fontSize: '2vw', fontWeight: 650, margin: '0 0 2vh', color: solo!.result === 'won' ? 'var(--plants)' : 'var(--mc)'}}>{verdict.line}</motion.div>
      )}
      <div style={{display: 'flex', gap: '2vw', margin: '0 0 2vh'}}>
        {labels.map((l, i) => <span key={l} className="cond" style={{display: 'inline-flex', alignItems: 'center', gap: '0.5vw', fontSize: '1.4vw', color: 'var(--ice-dim)'}}>
          <span style={{width: '1.1vw', height: '1.1vw', borderRadius: '0.25vw', background: PART_COLORS[i % PART_COLORS.length]}} />{l}</span>)}
      </div>
      <div style={{display: 'grid', gap: rows.length > 3 ? '2.4vh' : '4vh', flex: 1, alignContent: 'center'}}>
        {rows.map((r, i) => {
          const delay = 0.8 + (rows.length - 1 - i) * 0.7;
          // Ties share a place: two players on 20 are both first.
          const place = 1 + rows.filter((x) => x.total > r.total).length;
          const first = place === 1;
          let acc = 0;
          return (
            <motion.div key={r.color} initial={{opacity: 0, x: -60}} animate={{opacity: 1, x: 0}} transition={{delay, type: 'spring', stiffness: 90, damping: 16}}
              style={{display: 'grid', gridTemplateColumns: '6vw 20vw 1fr 10vw', alignItems: 'center', gap: '1.4vw'}}>
              <span className="num" style={{fontSize: first ? '6.4vw' : '4vw', color: first ? 'var(--mc)' : 'var(--ice)'}}>{verdict ? '' : place}</span>
              <div>
                <div style={{fontSize: first ? '3.2vw' : '2.5vw', fontWeight: 800, color: PLAYER_HEX[r.color], lineHeight: 1}}>{r.name}</div>
                {title.get(r.color) && <div className="cond" style={{fontSize: '1.4vw', marginTop: '0.6vh', color: 'var(--ice-dim)'}}>{title.get(r.color)}</div>}
              </div>
              <div style={{position: 'relative', height: first ? '8vh' : '6vh', borderRadius: '1vh', background: 'rgba(255,255,255,.05)', overflow: 'hidden'}}>
                {r.parts.map((p, k) => {
                  const left = (acc / max) * 100; acc += Math.max(0, p.value);
                  return (
                    <motion.div key={p.label} initial={{width: 0}} animate={{width: `${(Math.max(0, p.value) / max) * 100}%`}}
                      transition={{delay: delay + 0.4 + k * 0.28, duration: 0.6, ease: [0.2, 0.9, 0.25, 1]}}
                      style={{position: 'absolute', left: `${left}%`, top: 0, bottom: 0, background: PART_COLORS[k % PART_COLORS.length], opacity: 0.88,
                        boxShadow: 'inset -1px 0 0 rgba(0,0,0,.35)'}} />
                  );
                })}
              </div>
              <LateTotal value={r.total} delay={(delay + 0.4 + r.parts.length * 0.28) * 1000} big={first} />
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
