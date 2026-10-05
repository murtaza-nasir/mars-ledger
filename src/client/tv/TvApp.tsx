import {AnimatePresence, motion} from 'motion/react';
import {SourceLink, Unofficial} from '../ui/Unofficial';
import {SkyLayer} from './weather/Sky';
import {DustStorm, Mist} from './weather/Storm';
import {companionGenProgress, NO_LIGHT, skyLight} from './weather/sky';
import {useWeather} from './weather/useWeather';
import {Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {BOARDS, boardOf, GLOBAL} from '../../shared/board';
import {BoardAnnounce} from './BoardAnnounce';
import {MiniMap, RandomGlyph} from '../ui/BoardPick';
import {findCard} from '../../shared/cards';
import {allTags, awardPlaces, score, standingValue} from '../../shared/engine';
import type {GameState, PlayerState, Tick} from '../../shared/game';
import {useNet} from '../net';
import {TvCard} from './TvCard';
import {eventText} from '../ui/events';
import {PLAYER_HEX, ResIcon, TagIcon} from '../ui/Icons';
import {Rolling} from '../ui/Rolling';
import {InlineClock, OverTimeNote} from './StripClock';
import {diffLines} from '../phone/Resolve';
import {Planet} from './Planet';
import {FullTv} from './full/FullTv';
import {TableLayer} from './table/TableLayer';
import {wasFlicked} from './table/flicks';
import {SoundLayer, useBottomLaneRight} from './sound/SoundLayer';
import {TvOptions} from './options/TvOptions';
import {Radio} from './radio/Radio';
import {installNoZoom} from './noZoom';
import {applyTextScale, tvt, useTvSettings} from './settings';

// The TV's text size applies before the first paint.
applyTextScale();
import {CinemaLayer, useCinemaBusy, useCinemaIdle, useCinemaCovering} from './cinema/CinemaLayer';
import {markSeen, useCinema, wasSeen} from './cinema/queue';
import {milestoneCinematics} from './cinema/triggers';
import {Story} from './cinema/Story';
import type {FinalScore} from './cinema/Story';
import {useStage} from './stage';
import {ReactionLayer} from './reactions/ReactionLayer';
import {NarratorLayer, TickerFade} from './narrator/NarratorLayer';
import {FamePanel} from './fame/HallOfFame';
import {RollUp} from './fame/RollUp';
import {Avatar} from '../ui/Avatar';
import {BotMark} from '../ui/BotMark';
import {DeadEndNotice} from '../ui/DeadEndNotice';
import {LANE_LEFT} from './dock';

export function TvApp() {
  useEffect(() => installNoZoom(), []);
  return <><TvScreens /><FameAfterGame /><TableLayer /><NarratorLayer /><BoardAnnounce /><SoundLayer /><Radio /><TvOptions /></>;
}

/** After a finished game (either mode): the achievements roll-up, then the hall of fame. */
function FameAfterGame() {
  const state = useNet((s) => s.state);
  if (!state || state.phase === 'lobby') return null;
  return <RollUp key={state.mode === 'full' ? state.full?.gameId ?? state.id : state.id} state={state} />;
}

function TvScreens() {
  const {state, config} = useNet();
  if (!state) return null;
  if (state.mode === 'full' && state.phase !== 'lobby') {
    return <div style={{position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--dusk-0)'}}><FullTv state={state} /><ReactionLayer /><DeadEndNotice tv /></div>;
  }
  const progress = terraformed(state);
  const stage = Math.min(3, Math.floor(progress * 4));
  return (
    <div style={{position: 'fixed', inset: 0, overflow: 'hidden', background: 'var(--dusk-0)'}}>
      <AnimatePresence>
        <motion.div key={stage} initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 4}}
          style={{position: 'absolute', inset: 0, background: `url(/assets/tv-stage-${stage}.webp) center / cover no-repeat`, filter: 'brightness(.55) saturate(.9)'}} />
      </AnimatePresence>
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(80% 90% at 30% 50%, transparent, rgba(16,7,4,.85))'}} />
      {state.phase !== 'lobby' && <CompanionSky state={state} />}
      {state.phase === 'lobby' ? <TvLobby state={state} joinUrl={config?.joinUrl ?? location.origin} /> : <TvGame state={state} />}
      {/* stickers from phones: inside this container so cinematics (z 40) stay above them */}
      {state.phase !== 'lobby' && <ReactionLayer />}
    </div>
  );
}

/** The companion TV's sky: dusk to night to dawn across each generation, from the passes and recent moves. */
function CompanionSky({state}: {state: GameState}) {
  const recent = useNet((s) => s.recent);
  const {weather} = useTvSettings();
  const t = companionGenProgress(state, recent);
  const light = weather ? skyLight(t) : NO_LIGHT;
  (window as unknown as {__sky?: unknown}).__sky = {t, light, enabled: weather};
  return <SkyLayer light={light} />;
}

function terraformed(s: GameState) {
  const t = (s.global.temperature - GLOBAL.temperature.min) / (GLOBAL.temperature.max - GLOBAL.temperature.min);
  return (t + s.global.oxygen / GLOBAL.oxygen.max + s.global.oceans / GLOBAL.oceans.max) / 3;
}

function TvLobby({state, joinUrl}: {state: GameState; joinUrl: string}) {
  const fame = useNet((s) => s.fame);
  const withFame = !!(fame && (fame.leaderboard.length || fame.recent.length));
  const profiles = useNet((s) => s.profiles);
  return (
    <div style={{position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1.1fr 1fr', alignItems: 'center', padding: '0 7vw', gap: '6vw'}}>
      <div style={{display: 'flex', flexDirection: 'column', gap: withFame ? '2.4vh' : 0}}>
        <div>
        <motion.h1 initial={{opacity: 0, y: 30}} animate={{opacity: 1, y: 0}} transition={{duration: 1.2, ease: [0.2, 0.9, 0.25, 1]}}
          style={{fontSize: withFame ? '6vw' : '8.5vw', lineHeight: 0.9, margin: 0, fontWeight: 850, fontVariationSettings: "'wdth' 122", transition: 'font-size .8s'}}>Mars<br />Ledger</motion.h1>
        <motion.p initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 0.6, duration: 1}} style={{fontSize: '1.6vw', color: 'var(--ice-dim)', maxWidth: '32ch', marginTop: '1.8vh'}}>
          Scan the code with your phone camera to take a seat. Start the game from any phone once everyone is in.
        </motion.p>
        <AnimatePresence mode="wait">
          <motion.div key={state.boardChoice ?? 'tharsis'} initial={{opacity: 0, x: -16}} animate={{opacity: 1, x: 0}} exit={{opacity: 0, x: 16}} transition={{duration: 0.35}}
            style={{display: 'flex', alignItems: 'center', gap: '1.2vw', marginTop: '2vw'}}>
            {state.boardChoice === 'random'
              ? <RandomGlyph size={Math.round(window.innerWidth * 0.06)} />
              : <MiniMap board={state.boardChoice ?? 'tharsis'} size={Math.round(window.innerWidth * 0.06)} />}
            <span style={{fontSize: '1.5vw'}}>
              <span className="faint">Map </span>
              <strong style={{fontWeight: 700}}>{state.boardChoice === 'random' ? 'Random, drawn at the start' : BOARDS[state.boardChoice ?? 'tharsis'].title}</strong>
            </span>
          </motion.div>
        </AnimatePresence>
        <div style={{display: 'flex', flexWrap: 'wrap', gap: '1vw', marginTop: withFame ? '2vw' : '3vw'}}>
          <AnimatePresence>
            {state.players.map((p) => {
              const prof = profiles.find((x) => x.id === p.profileId);
              return (
                <motion.div key={p.id} layout initial={{opacity: 0, scale: 0.6, y: 20}} animate={{opacity: 1, scale: 1, y: 0}} exit={{opacity: 0, scale: 0.8}}
                  transition={{type: 'spring', stiffness: 260, damping: 18}}
                  style={{display: 'flex', alignItems: 'center', gap: '0.8vw', padding: prof ? '0.6vw 1.4vw 0.6vw 0.7vw' : '0.9vw 1.4vw', borderRadius: '1vw', background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(10px)', fontSize: '1.7vw', fontWeight: 650}}>
                  {prof
                    ? <Avatar name={prof.name} color={p.color} avatar={prof.avatar} size={Math.round(window.innerWidth * 0.026)} />
                    : <span style={{width: '1vw', height: '1vw', borderRadius: '0.25vw', background: PLAYER_HEX[p.color]}} />}
                  {p.name}{p.bot && <BotMark />}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
        </div>
        <FamePanel />
      </div>
      {/* the join code, with the fan-project notice and the source address under it (on the left they ran over the hall
          of fame's panels) */}
      <div data-lobby-join="" style={{justifySelf: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', width: 'calc(min(26vw, 50vh) + 4.8vw)'}}>
      <motion.div initial={{opacity: 0, rotateY: -25}} animate={{opacity: 1, rotateY: 0}} transition={{duration: 1.4, delay: 0.3}}
        style={{padding: '2.4vw', borderRadius: '2vw', background: 'var(--ice)', backdropFilter: 'blur(14px)', boxShadow: '0 0 0 1px var(--rim-strong), 0 40px 80px rgba(0,0,0,.5)'}}>
        <img src={`/api/qr.svg?url=${encodeURIComponent(joinUrl)}`} alt={`Join at ${joinUrl}`} style={{width: 'min(26vw, 50vh)', height: 'min(26vw, 50vh)', display: 'block'}} />
        <div className="cond" style={{textAlign: 'center', marginTop: '1.2vw', fontSize: '1.3vw', color: 'var(--dusk-2)'}}>{joinUrl.replace(/^https?:\/\//, '')}</div>
      </motion.div>
      {/* the group is centred, so the notice keeps clear of the sound prompt in the bottom-right corner */}
      <div data-lobby-notice="" style={{width: '100%', marginTop: '1.4vw', textAlign: 'center'}}>
        <Unofficial style={{fontSize: 'max(11px, 0.72vw)'}} />
        <SourceLink plain style={{fontSize: 'max(11px, 0.72vw)', marginTop: '0.3vh'}} />
      </div>
      </div>
    </div>
  );
}

function TvGame({state}: {state: GameState}) {
  const g = state.global;
  const [momentBusy, setMomentBusy] = useState(false);
  useEffect(() => { useStage.getState().set('moment', momentBusy); return () => useStage.getState().set('moment', false); }, [momentBusy]);
  const cinemaBusy = useCinemaBusy();
  const cinemaIdle = useCinemaIdle();
  const history = useNet((s) => s.history);
  const warmth = (g.temperature - GLOBAL.temperature.min) / (GLOBAL.temperature.max - GLOBAL.temperature.min);
  // Weather: an attack's own full-screen moment plays first, then the storm sweeps the planet.
  const cinemaCovering = useCinemaCovering();
  const weather = useWeather(momentBusy || cinemaBusy || cinemaCovering);
  const lastTick = useNet((s) => s.lastTick);
  const weatherSeen = useRef(0);
  useEffect(() => {
    if (!lastTick || lastTick.seq <= weatherSeen.current) return;
    weatherSeen.current = lastTick.seq;
    if (lastTick.events.some((e) => e.kind === 'attack')) weather.request('storm');
    if (lastTick.events.some((e) => e.kind === 'tile' && e.tile === 'ocean')) weather.request('mist', state.global.oxygen);
  }, [lastTick, weather, state.global.oxygen]);
  return (
    <>
      <div style={{position: 'absolute', left: '2vw', top: '44%', width: '56vw', height: '56vw', transform: 'translateY(-50%)'}}>
        <Suspense fallback={null}><Planet sea={g.oceans / GLOBAL.oceans.max} green={g.oxygen / GLOBAL.oxygen.max} warmth={warmth} /></Suspense>
        {weather.now.mist && <Mist key={`m${weather.now.mist.at}`} at={weather.now.mist.at} />}
        {weather.now.storm && <DustStorm key={`s${weather.now.storm.at}`} at={weather.now.storm.at} mode={weather.now.storm.mode} />}
      </div>
      <Globals state={state} />
      <div style={{position: 'absolute', right: '2.5vw', top: '3vw', bottom: '9vw', width: '36vw', display: 'flex', flexDirection: 'column', gap: '1vw'}}>
        <div style={{display: 'flex', alignItems: 'baseline', justifyContent: 'space-between'}}>
          <div className="cond" style={{fontSize: '1.4vw', color: 'var(--ice-dim)'}}>{phaseLabel(state)}</div>
          <div><span className="cond" style={{fontSize: '1.3vw', color: 'var(--ice-dim)'}}>Generation </span><Rolling value={state.generation} className="num" style={{fontSize: '3vw'}} /></div>
        </div>
        {state.order.map((id) => <PlayerStrip key={id} state={state} p={state.players.find((x) => x.id === id)!} />)}
        <Standings state={state} />
      </div>
      <TickerFade><Ticker state={state} /></TickerFade>
      <MomentLayer state={state} onBusy={setMomentBusy} paused={cinemaBusy} />
      <CompanionCinema state={state} momentBusy={momentBusy} />
      {state.phase === 'ended' && (history?.mode === 'companion' && history.id === state.id ? (cinemaIdle && !momentBusy && <CompanionStory state={state} />) : <Podium state={state} />)}
    </>
  );
}

function phaseLabel(s: GameState) {
  return {lobby: 'Lobby', setup: 'Choosing corporations', preludes: 'Preludes', research: 'Research', action: 'Action phase', production: 'Production',
    finalGreenery: 'Final greeneries', ended: 'Final score', full: 'Full game'}[s.phase];
}

function Globals({state}: {state: GameState}) {
  const g = state.global;
  const items = [
    {label: 'Temperature', value: g.temperature, unit: '°C', pct: (g.temperature + 30) / 38, color: 'var(--heat)'},
    {label: 'Oxygen', value: g.oxygen, unit: '%', pct: g.oxygen / 14, color: 'var(--plants)'},
    {label: 'Oceans', value: g.oceans, unit: '/9', pct: g.oceans / 9, color: 'var(--ocean)'},
  ];
  return (
    <div style={{position: 'absolute', left: '3vw', bottom: '9vw', display: 'flex', gap: '2.4vw'}}>
      {items.map((it) => (
        <div key={it.label} style={{width: '11vw'}}>
          <div className="cond" style={{fontSize: tvt(1.1), color: 'var(--ice-dim)'}}>{it.label}</div>
          <div><Rolling value={it.value} className="num" style={{fontSize: '3.4vw'}} /><span className="faint" style={{fontSize: tvt(1.2)}}> {it.unit}</span></div>
          <div style={{height: '0.35vw', borderRadius: 4, background: 'rgba(255,255,255,.1)', marginTop: '0.6vw', overflow: 'hidden'}}>
            <motion.div initial={false} animate={{width: `${it.pct * 100}%`}} transition={{type: 'spring', stiffness: 60, damping: 16}} style={{height: '100%', background: it.color}} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayerStrip({state, p}: {state: GameState; p: PlayerState}) {
  const current = state.current === p.id && state.phase === 'action';
  const vp = score(state, p).total;
  const tags = Object.entries(allTags(p)).filter(([t]) => t !== 'event').sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <motion.div layout data-strip-color={p.color} animate={{opacity: p.passed ? 0.45 : 1, scale: current ? 1.02 : 1}}
      style={{position: 'relative', display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '1.4vw', padding: '1vw 1.3vw', borderRadius: '1.1vw',
        background: 'rgba(12,5,3,.55)', backdropFilter: 'blur(12px)', boxShadow: `inset 0.35vw 0 0 ${PLAYER_HEX[p.color]}`}}>
      {current && <motion.div layoutId="turn-glow" style={{position: 'absolute', inset: 0, borderRadius: '1.1vw', boxShadow: `0 0 0 2px ${PLAYER_HEX[p.color]}, 0 0 3vw color-mix(in oklab, ${PLAYER_HEX[p.color]} 45%, transparent)`}} />}
      <div style={{minWidth: 0}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.6vw', minWidth: 0}}>
          <InlineClock color={p.color} sizeVw={1.7} />
          <div style={{minWidth: 0, fontSize: '1.7vw', fontWeight: 750, fontVariationSettings: "'wdth' 85", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
            {p.name}{p.passed && <span className="faint" style={{fontSize: tvt(1.1)}}> · passed</span>}
          </div>
        </div>
        <div className="faint" style={{fontSize: tvt(1), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{p.corporation ?? 'Choosing a corporation'}<OverTimeNote color={p.color} sizeVw={1} /></div>
        <div style={{display: 'flex', gap: '0.5vw', marginTop: '0.5vw'}}>
          {tags.map(([t, n]) => <span key={t} style={{display: 'inline-flex', alignItems: 'center', gap: '0.2vw', fontSize: tvt(1)}}><TagIcon tag={t} size={20} /><span className="num">{n}</span></span>)}
        </div>
      </div>
      <div style={{textAlign: 'center'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.3vw', justifyContent: 'center'}}><ResIcon r="megacredits" size={18} /><span className="num" style={{fontSize: '1.5vw', color: 'var(--mc)'}}>+{p.production.megacredits + p.tr}</span></div>
        <div className="faint cond" style={{fontSize: tvt(0.9), marginTop: '0.7vh'}}>income</div>
      </div>
      <div style={{textAlign: 'right', minWidth: '6vw'}}>
        <Rolling value={p.tr} className="num" style={{fontSize: '2.8vw', color: 'var(--tr)'}} />
        <div className="faint cond" style={{fontSize: tvt(0.9), marginTop: '0.4vh'}}>TR · {vp} pts now</div>
      </div>
    </motion.div>
  );
}

function Standings({state}: {state: GameState}) {
  // rotate between milestones and awards so the panel stays small
  const [page, setPage] = useState(0);
  useEffect(() => { const t = setInterval(() => setPage((x) => (x + 1) % 2), 12000); return () => clearInterval(t); }, []);
  const rows = page === 0
    ? boardOf(state).milestones.map((m) => {
      const claimed = state.milestones.find((x) => x.name === m.name);
      const vals = state.players.map((p) => ({p, v: standingValue(p, m)})).sort((a, b) => b.v - a.v);
      const tied = vals.length > 1 && vals[0].v === vals[1].v;
      // Standings the app cannot see (tile positions) are shown as counted on the board, never as a false lead.
      const sub = claimed ? 'claimed' : m.positional ? 'on the board'
        : !vals.length ? '' : tied ? `tied at ${vals[0].v}/${m.goal}` : `${vals[0].p.name} ${vals[0].v}/${m.goal}`;
      return {name: m.name, who: claimed ? state.players.find((p) => p.id === claimed.claimedBy) : undefined, sub};
    })
    : boardOf(state).awards.map((a) => {
      const funded = state.awards.find((x) => x.name === a.name);
      if (a.positional && !state.players.some((p) => p.manualScores?.[a.name] !== undefined)) return {name: a.name, who: undefined, sub: `${funded ? 'funded · ' : ''}on the board`};
      const firsts = awardPlaces(state, a.name).filter((r) => r.place === 1);
      const lp = firsts.length === 1 ? state.players.find((p) => p.id === firsts[0].player) : undefined;
      const lead = !firsts.length ? '' : lp ? `${lp.name} leads with ${firsts[0].value}` : `tied at ${firsts[0].value}`;
      return {name: a.name, who: funded ? lp : undefined, sub: `${funded ? 'funded · ' : ''}${lead}`};
    });
  return (
    <div style={{marginTop: 'auto', padding: '1vw 1.3vw', borderRadius: '1.1vw', background: 'rgba(12,5,3,.45)', backdropFilter: 'blur(12px)'}}>
      <AnimatePresence mode="wait">
        <motion.div key={page} initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: -8}}>
          <div className="cond" style={{fontSize: tvt(1.1), color: 'var(--ice-dim)', marginBottom: '0.5vw'}}>{page === 0 ? 'Milestones' : 'Awards'}</div>
          {rows.map((r) => (
            <div key={r.name} style={{display: 'flex', justifyContent: 'space-between', fontSize: tvt(1.05), padding: '0.2vw 0'}}>
              <span style={{color: r.who ? PLAYER_HEX[r.who.color] : 'var(--ice)'}}>{r.name}</span><span className="faint">{r.sub}</span>
            </div>
          ))}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Ticker({state}: {state: GameState}) {
  const recent = useNet((s) => s.recent);
  const right = useBottomLaneRight();
  const lines = recent.slice(-6).flatMap((t) => t.events.map((e, i) => ({k: `${t.seq}-${i}`, text: eventText(state, e), e}))).filter((l) => l.text && l.e.kind !== 'note').slice(-4);
  return (
    <div data-log-lane="" style={{position: 'absolute', left: LANE_LEFT, right, bottom: '2.2vw',
      maskImage: 'linear-gradient(90deg, #000 88%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, #000 88%, transparent)', display: 'flex', gap: '2.4vw', fontSize: tvt(1.2), overflow: 'hidden', whiteSpace: 'nowrap'}}>
      <AnimatePresence initial={false}>
        {lines.map((l, i) => (
          <motion.span key={l.k} layout initial={{opacity: 0, x: 40}} animate={{opacity: 0.35 + (i / lines.length) * 0.65, x: 0}} exit={{opacity: 0, x: -40}}>{l.text}</motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---- moments: the only times the TV asks for attention ---------------------------------------
type Moment = {k: number; kind: 'card' | 'attack' | 'production' | 'milestone' | 'generation' | 'terraform'; tick: Tick; before: GameState | null};

const TAG_BACKDROP: Record<string, string> = {
  space: 'space', jovian: 'jovian', earth: 'earth', science: 'science', power: 'power', plant: 'greenery', animal: 'animal',
  microbe: 'microbe', city: 'city', building: 'production',
};

function MomentLayer({state, onBusy, paused}: {state: GameState; onBusy: (b: boolean) => void; paused: boolean}) {
  const lastTick = useNet((s) => s.lastTick);
  const prevState = useRef<GameState | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  const seen = useRef(0);

  useEffect(() => {
    if (!lastTick || lastTick.seq <= seen.current) { prevState.current = state; return; }
    seen.current = lastTick.seq;
    const ev = lastTick.events;
    const kind: Moment['kind'] | null =
      ev.some((e) => e.kind === 'attack') ? 'attack'
        : ev.some((e) => e.kind === 'production') ? 'production'
          : ev.some((e) => e.kind === 'cardPlayed') ? 'card'
            : ev.some((e) => e.kind === 'milestone' || e.kind === 'award') ? 'milestone'
              : ev.some((e) => e.kind === 'global') && lastTick.command.t !== 'setGlobal' ? 'terraform'
                : null;
    // A card flicked from a phone is shown by the flick layer; don't announce it twice.
    const played = ev.find((e) => e.kind === 'cardPlayed');
    const actor = played && played.kind === 'cardPlayed' ? state.players.find((p) => p.id === played.player) : undefined;
    const flicked = kind === 'card' && played?.kind === 'cardPlayed' && !!actor && wasFlicked(actor.color, played.card);
    if (kind && !flicked) setQueue((q) => [...q, {k: lastTick.seq, kind, tick: lastTick, before: prevState.current}]);
    prevState.current = state;
  }, [lastTick, state]);

  const m = queue[0];
  useEffect(() => { onBusy(!!m && !paused); }, [m, paused, onBusy]);
  useEffect(() => {
    if (!m || paused) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), m.kind === 'card' || m.kind === 'attack' ? 5200 : 3800);
    return () => clearTimeout(t);
  }, [m, paused]);

  return <AnimatePresence>{m && !paused && <MomentView key={m.k} m={m} state={state} />}</AnimatePresence>;
}

function MomentView({m, state}: {m: Moment; state: GameState}) {
  const ev = m.tick.events;
  const card = ev.find((e) => e.kind === 'cardPlayed');
  const actorId = 'playerId' in m.tick.command ? m.tick.command.playerId : null;
  const actor = state.players.find((p) => p.id === actorId);
  const def = card && card.kind === 'cardPlayed' ? findCard(card.card) : undefined;
  const backdrop = useMemo(() => {
    if (m.kind === 'attack') return 'attack';
    if (m.kind === 'production') return 'production';
    if (m.kind === 'terraform') {
      const g = ev.find((e) => e.kind === 'global');
      return g && g.kind === 'global' ? (g.param === 'oceans' ? 'ocean' : g.param === 'oxygen' ? 'greenery' : 'heat') : 'heat';
    }
    if (ev.some((e) => e.kind === 'tile' && e.tile === 'ocean')) return 'ocean';
    if (ev.some((e) => e.kind === 'tile' && e.tile === 'city')) return 'city';
    if (def) {
      if (def.behavior?.global?.temperature && def.tags.includes('space')) return 'asteroid';
      for (const t of def.tags) if (TAG_BACKDROP[t]) return TAG_BACKDROP[t];
    }
    return 'space';
  }, [m, ev, def]);
  const color = actor ? PLAYER_HEX[actor.color] : 'var(--mc)';
  const {lines, globals} = m.before ? diffLines(m.before, state) : {lines: [], globals: []};
  const title = m.kind === 'production' ? 'Production'
    : m.kind === 'attack' ? ev.filter((e) => e.kind === 'attack').map((e) => eventText(state, e)).join(' · ')
      : m.kind === 'milestone' ? ev.map((e) => (e.kind === 'milestone' || e.kind === 'award' ? eventText(state, e) : null)).filter(Boolean).join(' · ')
        : m.kind === 'terraform' ? ev.map((e) => (e.kind === 'global' ? eventText(state, e) : null)).filter(Boolean).join(' · ')
          : def?.name ?? '';

  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} transition={{duration: 0.6}}
      style={{position: 'absolute', inset: 0, zIndex: 20, display: 'grid', placeItems: 'center'}}>
      <motion.div initial={{scale: 1.15}} animate={{scale: 1}} transition={{duration: 6, ease: 'linear'}}
        style={{position: 'absolute', inset: 0, background: `url(/assets/event-${backdrop}.webp) center / cover no-repeat`, filter: 'brightness(.62)'}} />
      <div style={{position: 'absolute', inset: 0, background: `linear-gradient(90deg, rgba(12,5,3,.9) 0%, rgba(12,5,3,.35) 55%, transparent), radial-gradient(60% 60% at 20% 80%, color-mix(in oklab, ${color} 25%, transparent), transparent)`}} />
      <div style={{position: 'relative', width: '100%', padding: '0 7vw', display: 'grid', gridTemplateColumns: def ? '1.2fr 1fr' : '1fr', gap: '5vw', alignItems: 'center'}}>
        <div>
          {actor && m.kind !== 'production' && (
            <motion.div initial={{opacity: 0, x: -30}} animate={{opacity: 1, x: 0}} transition={{delay: 0.2}} style={{display: 'flex', alignItems: 'center', gap: '1vw', fontSize: '2vw', fontWeight: 650}}>
              <span style={{width: '1.2vw', height: '1.2vw', borderRadius: '0.3vw', background: color}} />{actor.name}
            </motion.div>
          )}
          <motion.h2 initial={{opacity: 0, y: 30, letterSpacing: '0.12em'}} animate={{opacity: 1, y: 0, letterSpacing: '-0.01em'}} transition={{delay: 0.3, duration: 0.9, ease: [0.2, 0.9, 0.25, 1]}}
            style={{margin: '0.6vw 0 1.6vw', fontSize: title.length > 26 ? '4.2vw' : '6.4vw', lineHeight: 0.95, fontWeight: 850, fontVariationSettings: "'wdth' 118", color: m.kind === 'attack' ? 'var(--ember)' : 'var(--ice)'}}>
            {title}
          </motion.h2>
          <div style={{display: 'grid', gap: '0.8vw'}}>
            {lines.slice(0, 4).map((l, i) => (
              <motion.div key={l.who.id} initial={{opacity: 0, x: -20}} animate={{opacity: 1, x: 0}} transition={{delay: 0.9 + i * 0.12}}
                style={{display: 'flex', alignItems: 'center', gap: '1vw', flexWrap: 'wrap', fontSize: '1.5vw'}}>
                <span style={{color: PLAYER_HEX[l.who.color], fontWeight: 700, minWidth: '9vw'}}>{l.who.name}</span>
                {l.items.slice(0, 6).map((it, k) => (
                  <span key={k} style={{display: 'inline-flex', alignItems: 'center', gap: '0.4vw'}}>
                    {it.icon && <ResIcon r={it.icon} size={26} />}
                    <span className="num" style={{color: it.delta > 0 ? 'var(--plants)' : 'var(--ember)'}}>{it.delta > 0 ? '+' : '−'}{Math.abs(it.delta)}</span>
                    {it.prod && <span className="faint cond" style={{fontSize: tvt(1)}}>prod</span>}
                  </span>
                ))}
              </motion.div>
            ))}
            {globals.map((gl, i) => (
              <motion.div key={gl.label} initial={{opacity: 0}} animate={{opacity: 1}} transition={{delay: 1.2 + i * 0.1}} style={{fontSize: '1.5vw', color: 'var(--tr)'}}>
                {gl.label} <span className="num">{gl.from} → {gl.to}</span>
              </motion.div>
            ))}
          </div>
        </div>
        {def && (
          <motion.div initial={{opacity: 0, rotateY: 50, y: 40}} animate={{opacity: 1, rotateY: 0, y: 0}} transition={{delay: 0.4, type: 'spring', stiffness: 80, damping: 16}}
            style={{fontSize: '1.35vw', perspective: 1000}}>
            <div style={{width: '18vw'}}><TvCard card={def} vw={18} /></div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function Podium({state}: {state: GameState}) {
  const rows = state.players.map((p) => ({p, s: score(state, p)})).sort((a, b) => b.s.total - a.s.total);
  return (
    <motion.div initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 1.2}}
      style={{position: 'absolute', inset: 0, zIndex: 30, background: 'url(/assets/event-gameend.webp) center / cover', display: 'grid', placeItems: 'center'}}>
      <div style={{position: 'absolute', inset: 0, background: 'rgba(12,5,3,.55)'}} />
      <div style={{position: 'relative', width: '70vw'}}>
        <h2 style={{fontSize: '5vw', margin: '0 0 2vw', fontWeight: 850, fontVariationSettings: "'wdth' 120"}}>Mars is alive</h2>
        {rows.map(({p, s}, i) => (
          <motion.div key={p.id} initial={{opacity: 0, x: -60}} animate={{opacity: 1, x: 0}} transition={{delay: 0.8 + (rows.length - i) * 0.5, type: 'spring', stiffness: 90}}
            style={{display: 'grid', gridTemplateColumns: '4vw 1fr repeat(5, 7vw) 9vw', alignItems: 'center', padding: '1.2vw 1.6vw', marginBottom: '0.8vw', borderRadius: '1vw',
              background: 'rgba(12,5,3,.6)', boxShadow: `inset 0.4vw 0 0 ${PLAYER_HEX[p.color]}`, fontSize: '1.4vw'}}>
            <span className="num" style={{fontSize: '2.4vw'}}>{1 + rows.filter((x) => x.s.total > s.total).length}</span>
            <span style={{fontWeight: 750, fontSize: '2vw'}}>{p.name}</span>
            <span><span className="faint cond">TR </span>{s.tr}</span>
            <span><span className="faint cond">Tiles </span>{s.greenery + s.cities}</span>
            <span><span className="faint cond">Cards </span>{s.cards}</span>
            <span><span className="faint cond">Milestones </span>{s.milestones}</span>
            <span><span className="faint cond">Awards </span>{s.awards}</span>
            <span className="num" style={{fontSize: '3vw', textAlign: 'right'}}>{s.total}</span>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

// ---- cinematics (companion): corporation reveal, recaps, terraforming milestones, the story ---
function CompanionCinema({state, momentBusy}: {state: GameState; momentBusy: boolean}) {
  const lastTick = useNet((s) => s.lastTick);
  const history = useNet((s) => s.history);
  const enqueue = useCinema((s) => s.enqueue);
  // Everything comes from the newest move itself, so moves that arrive faster than the TV renders still count.
  useEffect(() => {
    if (!lastTick) return;
    const ev = lastTick.events;
    const cmd = lastTick.command;
    const actor = 'playerId' in cmd ? state.players.find((p) => p.id === (cmd as {playerId: string}).playerId) : undefined;
    // the last corporation chosen: reveal them all
    if (cmd.t === 'chooseCorp' && state.phase !== 'setup' && state.phase !== 'lobby') {
      enqueue({id: `${state.id}:reveal`, kind: 'reveal', seats: state.order.map((id) => state.players.find((p) => p.id === id)!).filter((p) => p?.corporation).map((p) => ({
        color: p.color, name: p.name, corporation: p.corporation!, megacredits: p.stock.megacredits, production: {...p.production},
        preludes: p.preludes?.length ? p.preludes : undefined}))});
    }
    const prod = ev.find((e) => e.kind === 'production');
    if (prod && prod.kind === 'production') {
      enqueue({id: `${state.id}:g${prod.generation}:recap`, kind: 'recap', generation: prod.generation, notBefore: Date.now() + 4200});
    }
    if (cmd.t !== 'setGlobal') {
      const b = {temperature: state.global.temperature, oxygen: state.global.oxygen, oceans: state.global.oceans};
      const a = {...b};
      for (const e of ev) if (e.kind === 'global' && e.param !== 'venus') a[e.param] = Math.min(a[e.param], e.from);
      if (a.temperature !== b.temperature || a.oxygen !== b.oxygen || a.oceans !== b.oceans) {
        for (const c of milestoneCinematics(state.id, a, b, actor ? {name: actor.name, color: actor.color} : undefined)) enqueue(c);
      }
    }
  }, [lastTick]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CinemaLayer blocked={momentBusy} history={history?.id === state.id ? history : null} />;
}

function CompanionStory({state}: {state: GameState}) {
  const history = useNet((s) => s.history)!;
  const id = `${state.id}:story`;
  const [again] = useState(() => wasSeen(id));
  useEffect(() => { markSeen(id); }, [id]);
  const scores: FinalScore[] = state.players.map((p) => {
    const sc = score(state, p);
    return {color: p.color, name: p.name, total: sc.total, parts: [
      {label: 'TR', value: sc.tr}, {label: 'Greenery', value: sc.greenery}, {label: 'Cities', value: sc.cities},
      {label: 'Cards', value: sc.cards}, {label: 'Milestones', value: sc.milestones}, {label: 'Awards', value: sc.awards},
    ]};
  });
  return <Story history={history} scores={scores} startAtPodium={again} />;
}
