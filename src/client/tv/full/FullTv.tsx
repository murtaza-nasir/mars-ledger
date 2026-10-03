// Full-game TV: the board is the hero; instruments on the left, players on the right,
// and moments that answer what just happened without hiding the board.
import {AnimatePresence, motion} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {GameState} from '../../../shared/game';
import type {PublicPlayerModel, SpectatorModel} from '../../../shared/full';
import {useNet} from '../../net';
import {BoardView} from './BoardView';
import {useBoardRegion} from './boardRegion';
import {diffModels} from './diff';
import {Globals} from './Globals';
import {AttackMoment, Banner, LogTicker, Podium} from './Moments';
import type {CardMomentModel, Moment as BaseMoment} from './Moments';
import {PlayerStrip, Standings} from './Players';
import {useFold} from './useFold';
import {ActionWatcher} from './actions';
import {ActionMoment} from './ActionMoment';
import type {ActionMomentModel} from './ActionMoment';
import {heldPanel, holdsFor, useActionHolds, useHeldPanels} from './actionHolds';
import {prefersReducedMotion} from '../../ui/tokens';
import {isRewind} from '../../../shared/sync';
import {useTvSettings} from '../settings';
import {ProductionShowTv, stripOverride, useLiveShow} from './Production';
import {findCard} from '../../../shared/cards';
import {wasFlicked} from '../table/flicks';
import {TickerFade} from '../narrator/NarratorLayer';
import {useBottomLaneRight, useSoundChipVisible} from '../sound/SoundLayer';
import {CinemaLayer, useCinemaBusy, useCinemaCovering, useCinemaIdle} from '../cinema/CinemaLayer';
import {markSeen, useCinema, wasSeen} from '../cinema/queue';
import type {RevealSeat} from '../cinema/queue';
import {milestoneCinematics} from '../cinema/triggers';
import {Story} from '../cinema/Story';
import type {FinalScore} from '../cinema/Story';
import {SkyLayer} from '../weather/Sky';
import {DustStorm, Mist} from '../weather/Storm';
import {fullGenProgress, NO_LIGHT, skyLight} from '../weather/sky';
import {useWeather} from '../weather/useWeather';
import {TILE} from '../../../shared/full';
import {VersionTag} from '../../ui/VersionTag';
import {UndoNotice} from '../../ui/UndoNotice';
import {useRadio} from '../radio/store';
import {LANE_LEFT} from '../dock';
import {summarizeAction} from './actions';
import {CardStage, cardTextLength, PanelPulse, StageDim, travelDistance} from './pipeline/CardStage';
import {actionMs, attackMs, holdDeadline, planCard, skipBehind} from './pipeline/pacing';
import type {CardPlan, CardShape, PaceInput} from './pipeline/pacing';
import {cardKey, clearPipeline, doneWaiting, holdTiles, markWaiting, releaseTiles, replayStarted, usePipeline} from './pipeline/store';
import type {TileHold} from './pipeline/store';
import {sequencedBy} from './pipeline/sequence';
import {sendResolve} from './pipeline/resolve';
import {director} from '../sound/director';
import {tileCue} from '../sound/cues';
import type {Color} from '../../../shared/full';
import {EchoLayer} from './Echo';

type Moment = BaseMoment | ActionMomentModel;

/** Card action moments older than this when their turn comes are dropped rather than shown late. */
const ACTION_STALE_MS = 20000;

function progressOf(m: SpectatorModel): number {
  const g = m.game;
  return ((g.temperature + 30) / 38 + g.oxygenLevel / 14 + g.oceans / 9) / 3;
}

export function FullTv({state}: {state: GameState}) {
  const view = useNet((s) => s.fullView);
  const hovers = useNet((s) => s.hovers);
  const model = view?.role === 'spectator' ? view.model : null;
  const logs = view?.logs ?? [];

  const prev = useRef<SpectatorModel | null>(null);
  // A person still answering their own move's follow-up questions may back out of it ("Choose something else"): that
  // player's card moments wait here until the move is done, and are dropped if it is taken back.
  const heldMoments = useRef<{color: string; moments: Moment[]} | null>(null);
  // Card actions: what each one changed is known once its effect reaches the model.
  const actionWatch = useRef(new ActionWatcher());
  /** Prelude games: whether the founders (with their preludes) have been revealed yet */
  const preludesRevealed = useRef(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  // the latest bonus step or maximum: the 3D board flies over once its cinematic has gone
  const [moment, setMoment] = useState<{at: number; strength: 'step' | 'max'} | undefined>();
  const [cards, setCards] = useState<Moment[]>([]);
  const [banners, setBanners] = useState<Moment[]>([]);
  const [sweep, setSweep] = useState(0);
  const [hits, setHits] = useState<Record<string, number>>({});
  // the move pipeline (pipeline/): the head card's phase plan, when the last moment's update arrived (pacing), tiles
  // held back until their card's drop phase, replays asked for by other layers
  const [headPlan, setHeadPlan] = useState<{k: string; plan: CardPlan; shape: CardShape; started: number; lagMs: number; sinceLastMs: number | null} | null>(null);
  const lastArrival = useRef<number | null>(null);
  const heldTiles = usePipeline((s) => s.tiles);
  const pendingReplays = usePipeline((s) => s.replays);
  const queuedReplays = useRef(new Set<string>());
  const cardsRef = useRef<Moment[]>([]);
  cardsRef.current = cards;
  // While the production show plays, card moments wait their turn.
  const live = useLiveShow();
  const actionHolds = useHeldPanels();
  const showing = !!live;
  const busy = useCinemaBusy();
  const idle = useCinemaIdle();
  const history = useNet((s) => s.history);
  const production = useNet((s) => s.production);
  const enqueue = useCinema((s) => s.enqueue);
  const gameKey = state.full?.gameId ?? state.id;
  // Weather waits while a cinematic or the production show covers the board, or a cinematic is about
  // to (the generation recap starts just after the show, and a storm in that gap would play under it).
  const covering = useCinemaCovering();
  const weather = useWeather(showing || busy || covering);
  const genStart = useGenerationStart(gameKey, model);
  // A new game on the same TV starts unrevealed.
  useEffect(() => { preludesRevealed.current = false; }, [gameKey]);

  // A generation recap follows every production show, once the show has finished.
  useEffect(() => {
    if (!production) return;
    enqueue({id: `${production.id}:recap`, kind: 'recap', generation: production.generation - 1, notBefore: production.localStart + production.durationMs + 300});
  }, [production, enqueue]);

  useEffect(() => {
    if (!model) return;
    const wasTerraformed = prev.current?.game.isTerraformed ?? model.game.isTerraformed;
    const before = prev.current;
    // An undo: moments and big beats waiting for the undone move describe something that no longer happened.
    const rewound = !!before && before.id === model.id && isRewind(before.game, model.game);
    if (rewound || (before && before.id !== model.id)) {
      // replays waiting in the queue are dropped with it
      for (const c of cardsRef.current) if (c.kind === 'card' && c.replay) { replayStarted(c.k); c.replay.onDone?.(); }
      clearPipeline();
    }
    if (rewound) {
      setCards([]); setBanners([]);
      useCinema.setState((s) => ({queue: s.queue.filter((c) => c.kind !== 'milestone')}));
    }
    const moving = useNet.getState().fullView?.moving ?? null;
    if (rewound || (before && before.id !== model.id)) heldMoments.current = null;
    else if (heldMoments.current && heldMoments.current.color !== moving) {
      const done = heldMoments.current.moments;
      heldMoments.current = null;
      setCards((q) => [...q, ...done.slice(0, 3)]);
    }
    /** Moments of the player who is mid-move wait for the move to finish; the rest show now. */
    const admit = (ms: Moment[]): Moment[] => {
      if (!moving) return ms;
      const mine = ms.filter((m) => ((m as {color?: string}).color ?? (m as {attacker?: string}).attacker) === moving);
      if (mine.length) heldMoments.current = {color: moving, moments: [...(heldMoments.current?.color === moving ? heldMoments.current.moments : []), ...mine]};
      return ms.filter((m) => !mine.includes(m));
    };
    const events = diffModels(prev.current, model);
    // what the pipeline presents in sequence (the sound layer leaves these cues to it)
    const seq = sequencedBy(prev.current, model, wasFlicked);
    const arrived = Date.now();
    const gap = lastArrival.current === null ? null : arrived - lastArrival.current;
    const acted = actionWatch.current.feed(prev.current, model);
    // an undo or another game: gains in the air belong to a timeline that is gone
    if (before && (before.id !== model.id || isRewind(before.game, model.game))) useActionHolds.getState().clear();
    prev.current = model;
    const stamp = `${model.game.gameAge}-${model.game.undoCount}`;
    // Card actions show first (an attack by an action follows its card); like the other moments, at most three per update.
    // Test hook: every card action this TV has seen, with its line.
    if (acted.length) { const w = window as unknown as {__actionsSeen?: unknown[]}; w.__actionsSeen = [...(w.__actionsSeen ?? []), ...acted.map((x) => ({color: x.color, cards: x.cards, line: x.line}))]; }
    const attackers = new Map(events.flatMap((e) => (e.kind === 'attack' ? [[e.attacker, e.targets.map((t) => t.color as Color)] as const] : [])));
    const actionMoments: ActionMomentModel[] = acted.map((a, i) => ({k: `${stamp}-u${i}`, kind: 'action', at: arrived, color: a.color, cards: a.cards, line: a.line, summary: a.summary,
      gameAge: model.game.gameAge, targets: attackers.get(a.color as Color) ?? [], gap}));
    if (actionMoments.length) lastArrival.current = arrived;
    // the panel cells wait for the gains flying into them (at most three moments are queued per update)
    if (!prefersReducedMotion()) useActionHolds.getState().add(holdsFor(actionMoments.slice(0, 3).map((m) => ({k: m.k, color: m.color, flights: m.summary.flights})), Date.now()));
    if (!events.length && wasTerraformed === model.game.isTerraformed) {
      const now = admit(actionMoments.slice(0, 3));
      if (now.length) setCards((q) => [...q, ...now]);
      return;
    }
    const tiles = events.filter((e) => e.kind === 'tile').map((e) => (e.kind === 'tile' ? e.spaceId : ''));
    const newCards: Moment[] = [...actionMoments];
    const newBanners: Moment[] = [];
    // Corporations are revealed together in their own cinematic rather than as card moments.
    const seatOf = (p: PublicPlayerModel, corporation: string, preludes?: string[]): RevealSeat => ({color: p.color, name: p.name, corporation,
      megacredits: p.megacredits, production: {megacredits: p.megacreditProduction, steel: p.steelProduction, titanium: p.titaniumProduction,
        plants: p.plantProduction, energy: p.energyProduction, heat: p.heatProduction}, preludes});
    // With Prelude, the engine keeps chosen preludes private until they are played, so the reveal waits for the
    // prelude phase to finish and shows each founder with both preludes (and the money and production after them).
    const preludeGame = !!model.game.gameOptions?.expansions?.prelude;
    // Preludes in this very update are part of the reveal too, even when it is the update that triggers it.
    const revealedBefore = preludesRevealed.current;
    const seats: RevealSeat[] = [];
    if (!preludeGame) {
      for (const e of events) {
        if (e.kind !== 'card' || findCard(e.name)?.group !== 'corporation') continue;
        const p = model.players.find((x) => x.color === e.color);
        if (p) seats.push(seatOf(p, e.name));
      }
      if (seats.length) enqueue({id: `${gameKey}:reveal:${seats.map((x) => x.color).join('-')}`, kind: 'reveal', seats});
    } else if (!preludesRevealed.current) {
      const corp = (p: PublicPlayerModel) => p.tableau.find((c) => findCard(c.name)?.group === 'corporation')?.name;
      const preludes = (p: PublicPlayerModel) => p.tableau.filter((c) => findCard(c.name)?.group === 'prelude').map((c) => c.name);
      const ready = model.players.length > 0 && model.game.phase !== 'preludes' &&
        model.players.every((p) => corp(p) && preludes(p).length >= 2);
      if (ready) {
        preludesRevealed.current = true;
        enqueue({id: `${gameKey}:reveal:preludes`, kind: 'reveal', seats: model.players.map((p) => seatOf(p, corp(p)!, preludes(p).slice(0, 2)))});
      }
    }
    if (before) {
      const actor = before.players.find((p) => p.isActive);
      const by = actor ? {name: actor.name, color: actor.color} : undefined;
      const a = {temperature: before.game.temperature, oxygen: before.game.oxygenLevel, oceans: before.game.oceans};
      const b = {temperature: model.game.temperature, oxygen: model.game.oxygenLevel, oceans: model.game.oceans};
      const big = milestoneCinematics(gameKey, a, b, by);
      for (const c of big) enqueue(c);
      if (big.length) setMoment({at: Date.now(), strength: big.some((c) => c.kind === 'milestone' && !c.milestone.endsWith('-bonus')) ? 'max' : 'step'});
    }
    const gained = new Set<string>();
    const movers = new Set<string>(actionMoments.map((a) => a.color));
    events.forEach((e, i) => {
      // A card flicked from a phone is shown by the flick layer; don't announce it twice.
      // Preludes played before the reveal are shown in it, not one by one.
      const heldForReveal = e.kind === 'card' && preludeGame && !revealedBefore && findCard(e.name)?.group === 'prelude';
      if (e.kind === 'card' && findCard(e.name)?.group !== 'corporation' && !heldForReveal && !wasFlicked(e.color, e.name)) {
        const key = cardKey(e.color, e.name);
        const sequenced = seq.cards.includes(key);
        // the gains fly from the first card a player played in this update; its tiles drop in its Phase 4
        const gains = sequenced && before && !gained.has(e.color) ? summarizeAction(before, model, e.color).flights : [];
        gained.add(e.color);
        movers.add(e.color);
        newCards.push({k: `${stamp}-c${i}`, kind: 'card', color: e.color, name: e.name, at: arrived, gap, gameAge: model.game.gameAge,
          targets: attackers.get(e.color) ?? [], gains, sequenced,
          tiles: sequenced ? [...seq.tiles].filter(([, t]) => t.card === key).map(([spaceId, t]) => ({spaceId, tileType: t.tileType})) : []});
      }
      if (e.kind === 'attack') {
        weather.request('storm');
        // the card or action that caused it sent the resolve with its targets; the attack sounds as it shows when the
        // sound layer left its cue to the pipeline
        newCards.push({k: `${stamp}-a${i}`, kind: 'attack', attacker: e.attacker, targets: e.targets, at: arrived, gap, gameAge: model.game.gameAge,
          covered: movers.has(e.attacker), cue: seq.cards.length > 0});
      }
      if (e.kind === 'tile' && e.tileType === TILE.OCEAN) weather.request('mist', model.game.oxygenLevel);
      // A new generation is celebrated by the production show (Production.tsx), sent by the server.
    });
    void wasTerraformed; // Mars being terraformed is its own cinematic (cinema/Milestone.tsx)
    // A corporation reveal lands for everyone at once; show at most three card moments per update.
    // The card that caused an attack shows first, then the attack. At most three moments per update.
    const shown = admit(newCards.slice(0, 3));
    if (newCards.some((c) => c.kind !== 'action')) lastArrival.current = arrived;
    // Played cards shown now: their gains hold the panel cells back and their tiles wait for the drop phase. Tiles of
    // a card that waits for its player's follow-up questions (or is not shown) appear at once, as before.
    const reduce = prefersReducedMotion();
    const queued = cardsRef.current.length;
    const heldIds = new Set<string>();
    shown.forEach((c, i) => {
      if (c.kind !== 'card' || !c.sequenced) return;
      const est = planCard({textLen: cardTextLength(c.name), distance: 0.4, gains: !!c.gains?.length, tile: !!c.tiles?.length, reduced: reduce},
        {waiting: queued + i, lagMs: 0, sinceLastMs: gap});
      const ms = holdDeadline(est, (queued + i) * 3500);
      if (!reduce && c.gains?.length) useActionHolds.getState().add(holdsFor([{k: c.k, color: c.color, flights: c.gains}], arrived, ms));
      if (c.tiles?.length) { holdTiles(c.k, c.tiles, arrived + ms); c.tiles.forEach((t) => heldIds.add(t.spaceId)); }
      markWaiting([cardKey(c.color, c.name)], arrived + ms);
    });
    // sequenced tiles not held: their cue now (the sound layer left it to the pipeline)
    for (const [id, t] of seq.tiles) if (!heldIds.has(id)) director.cue(tileCue(t.tileType));
    const now = tiles.filter((t) => !heldIds.has(t));
    if (now.length) {
      setFresh((f) => new Set([...f, ...now]));
      setTimeout(() => setFresh((f) => { const n = new Set(f); now.forEach((t) => n.delete(t)); return n; }), 2600);
    }
    if (shown.length) setCards((q) => [...q, ...shown]);
    if (newBanners.length) setBanners((q) => [...q, ...newBanners]);
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = cards[0];
  const banner = banners[0];
  // Replays asked for by other layers (phone-to-TV links) join the queue; they leave the store's list as they start.
  useEffect(() => {
    const add: CardMomentModel[] = [];
    for (const r of pendingReplays) {
      if (queuedReplays.current.has(r.k)) continue;
      queuedReplays.current.add(r.k);
      if (!r.card && !r.spaceId) { replayStarted(r.k); r.onDone?.(); continue; }
      add.push({k: r.k, kind: 'card', color: r.color, name: r.card ?? '', at: Date.now(), gains: r.gains ?? [],
        replay: {verb: r.verb, spaceId: r.spaceId, onDone: r.onDone}});
    }
    if (add.length) setCards((q) => [...q, ...add]);
  }, [pendingReplays]);

  // A tile let go (its card's drop phase, a skipped moment or its deadline): it drops now, with its sound and the
  // camera's dive. Tiles cleared by an undo or another game are not dropped.
  const prevHeld = useRef<{tiles: TileHold[]; epoch: number}>({tiles: [], epoch: 0});
  useEffect(() => {
    const epoch = usePipeline.getState().epoch;
    const was = prevHeld.current;
    prevHeld.current = {tiles: heldTiles, epoch};
    if (was.epoch !== epoch) return;
    const gone = was.tiles.filter((t) => !heldTiles.some((h) => h.spaceId === t.spaceId));
    if (!gone.length) return;
    const ids = gone.map((t) => t.spaceId);
    for (const kind of new Set(gone.map((t) => tileCue(t.tileType)))) director.cue(kind);
    setFresh((f) => new Set([...f, ...ids]));
    setTimeout(() => setFresh((f) => { const n = new Set(f); ids.forEach((t) => n.delete(t)); return n; }), 2600);
  }, [heldTiles]);

  useEffect(() => {
    if (!card || showing || busy) return;
    const now = Date.now();
    const pop = () => setCards((q) => q.slice(1));
    const at = (card as {at?: number}).at ?? now;
    const pace: PaceInput = {waiting: cards.length - 1, lagMs: now - at, sinceLastMs: (card as {gap?: number | null}).gap ?? null};
    // An action moment that waited too long behind shows and cinematics is old news: skip it. So is any moment while
    // the TV runs too far behind the game with more waiting (pacing.skipBehind): its effects show at once.
    const replay = card.kind === 'card' && !!card.replay;
    if ((card.kind === 'action' && now - card.at > ACTION_STALE_MS) || (!replay && skipBehind(pace))) {
      useActionHolds.getState().release((h) => h.moment === card.k);
      if (card.kind === 'card') {
        releaseTiles((t) => t.moment === card.k);
        doneWaiting(cardKey(card.color, card.name));
        if (card.gameAge !== undefined) sendResolve(card.k, card.gameAge, card.color, card.targets ?? []);
      } else if (card.kind === 'action' && card.gameAge !== undefined) sendResolve(card.k, card.gameAge, card.color, card.targets ?? []);
      else if (card.kind === 'attack' && !card.covered && card.gameAge !== undefined) sendResolve(card.k, card.gameAge, card.attacker, card.targets.map((t) => t.color as Color));
      // test hook: moments skipped to catch up, with why
      const w = window as unknown as {__momentsSkipped?: number; __pipeline?: unknown[]};
      w.__momentsSkipped = (w.__momentsSkipped ?? 0) + 1;
      w.__pipeline = [...(w.__pipeline ?? []).slice(-99), {k: card.k, kind: card.kind, skipped: true, lag: pace.lagMs, waiting: pace.waiting, t: now}];
      pop();
      return;
    }
    let ms: number;
    if (card.kind === 'card') {
      if (card.replay) replayStarted(card.k);
      const shape: CardShape = {textLen: card.name ? cardTextLength(card.name) : 0, distance: travelDistance(card.color, boardRef.current?.getBoundingClientRect() ?? null),
        gains: !!card.gains?.length, reduced: prefersReducedMotion(), replay: !!card.replay,
        // a tile still held back for this card (one placed while its player was mid-move is on the board already)
        tile: usePipeline.getState().tiles.some((t) => t.moment === card.k) || !!card.replay?.spaceId};
      const plan = planCard(shape, pace);
      // the card leaves the queue on its own timer (below), which follows the plan as it hurries
      setHeadPlan({k: card.k, plan, shape, started: now, lagMs: pace.lagMs, sinceLastMs: pace.sinceLastMs});
      // test hook: each card moment as it starts (lag behind its update, pacing factor, length)
      const w = window as unknown as {__pipeline?: unknown[]};
      w.__pipeline = [...(w.__pipeline ?? []).slice(-99), {k: card.k, name: card.name, lag: now - at, waiting: pace.waiting, factor: plan.factor, total: plan.total, pings: plan.pings, replay: !!card.replay, t: now}];
      return;
    } else if (card.kind === 'attack') {
      // Phase 4 of an attack: the targets' panels shake as it lands (and phones buzz with it)
      setHits((h) => ({...h, ...Object.fromEntries(card.targets.map((t) => [t.color, Date.now()]))}));
      if (card.cue) director.cue('attack');
      if (!card.covered && card.gameAge !== undefined) sendResolve(card.k, card.gameAge, card.attacker, card.targets.map((t) => t.color as Color));
      ms = attackMs(pace);
    } else ms = actionMs(pace);
    const t = setTimeout(pop, ms);
    return () => clearTimeout(t);
  }, [card, showing, busy]); // eslint-disable-line react-hooks/exhaustive-deps

  // A played card on screen hurries when moments pile up behind it: its plan is redone with the queue as it is now
  // (never slower than before), and it leaves the queue when that plan ends.
  const waitingNow = cards.length - 1;
  useEffect(() => {
    if (!card || card.kind !== 'card' || !headPlan || headPlan.k !== card.k || card.replay) return;
    const p = planCard(headPlan.shape, {waiting: waitingNow, lagMs: headPlan.lagMs, sinceLastMs: headPlan.sinceLastMs});
    if (p.factor < headPlan.plan.factor) {
      setHeadPlan({...headPlan, plan: p});
      const w = window as unknown as {__pipeline?: unknown[]};
      w.__pipeline = [...(w.__pipeline ?? []).slice(-99), {k: card.k, name: card.name, hurried: true, waiting: waitingNow, factor: p.factor, total: p.total, pings: p.pings, t: Date.now()}];
    }
  }, [waitingNow]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!card || card.kind !== 'card' || !headPlan || headPlan.k !== card.k || showing || busy) return;
    const t = setTimeout(() => setCards((q) => (q[0]?.k === headPlan.k ? q.slice(1) : q)), Math.max(0, headPlan.plan.total - (Date.now() - headPlan.started)));
    return () => clearTimeout(t);
  }, [headPlan, card, showing, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanners((q) => q.slice(1)), 2800);
    return () => clearTimeout(t);
  }, [banner]);

  // Test hook (like window.__cam): what covers the board right now, for the TV camera checks.
  const curKind = useCinema((s) => s.current ? `${s.current.kind}:${(s.current as {milestone?: string}).milestone ?? ''}` : '');
  (window as unknown as {__camWhy?: unknown}).__camWhy = {showing, busy, curKind};
  const boardRef = useRef<HTMLDivElement>(null);
  const stripRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // When the side column runs short of height the panels fold (tag row first, then a compact header); useFold
  // also unfolds once the room is back. While the "tap for sound" chip shows, the column ends above it.
  const columnRef = useRef<HTMLDivElement>(null);
  const {textSize} = useTvSettings();
  const chip = useSoundChipVisible();
  const [screen, setScreen] = useState(() => `${window.innerWidth}x${window.innerHeight}`);
  useEffect(() => {
    const on = () => setScreen(`${window.innerWidth}x${window.innerHeight}`);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const foldKey = `${model?.players.length ?? 0}|${screen}|${textSize}|${model?.id ?? ''}|${chip}`;
  const {fold, zoom: standingsZoom} = useFold(columnRef, foldKey, `${model?.game.generation ?? 0}|${model?.game.phase ?? ''}`);
  (window as unknown as {__panelFold?: number}).__panelFold = fold;

  const names = useMemo(() => Object.fromEntries(state.players.map((p) => [p.id, p.name])), [state.players]);
  const laneRight = useBottomLaneRight();
  // the radio deck sits in the bottom-left corner; the log lane starts after it
  const deckRight = useRadio((s) => s.deckRight);
  const hoverList = useMemo(() => Object.values(hovers).filter((h) => h.spaceId), [hovers]);
  // the board's box: all the room between the columns, above the log lane (measured from the page)
  const region = useBoardRegion(columnRef, [!!model]);
  // tiles waiting for their card's drop phase stay off the board (and out of the oceans count) until then
  const rawSpaces = model?.game.spaces;
  const shownSpaces = useMemo(() => {
    if (!rawSpaces || !heldTiles.length) return rawSpaces;
    const held = new Set(heldTiles.map((t) => t.spaceId));
    return rawSpaces.map((sp) => (held.has(sp.id) ? {...sp, tileType: undefined, color: undefined} : sp));
  }, [rawSpaces, heldTiles]);
  const heldOceans = heldTiles.filter((t) => t.tileType === TILE.OCEAN).length;

  if (!model) {
    return (
      <div style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center'}}>
        <motion.div animate={{opacity: [0.35, 1, 0.35]}} transition={{duration: 2, repeat: Infinity}} className="muted" style={{fontSize: '1.6vw'}}>
          Setting up the board
        </motion.div>
      </div>
    );
  }

  const g = model.game;
  const progress = progressOf(model);
  // Test hook: window.__skyOverride pins the time of day (0 dusk … 1 dawn) for legibility and frame-time checks.
  const forced = (window as unknown as {__skyOverride?: number}).__skyOverride;
  const dayT = typeof forced === 'number' ? forced : fullGenProgress(model, genStart);
  const light = weather.enabled ? skyLight(dayT) : NO_LIGHT;
  (window as unknown as {__sky?: unknown}).__sky = {t: dayT, light, enabled: weather.enabled, genStart};
  const stage = Math.min(3, Math.floor(progress * 4));
  // Turn order as the engine lists players; the active one glows.
  return (
    <div style={{position: 'absolute', inset: 0}}>
      <AnimatePresence>
        <motion.div key={stage} initial={{opacity: 0}} animate={{opacity: 0.35}} exit={{opacity: 0}} transition={{duration: 4}}
          style={{position: 'absolute', inset: 0, background: `url(/assets/tv-stage-${stage}.webp) center / cover no-repeat`, filter: 'blur(6px) brightness(.5)'}} />
      </AnimatePresence>
      <div style={{position: 'absolute', inset: 0, background: 'radial-gradient(60% 75% at 42% 50%, transparent, rgba(16,7,4,.9))'}} />
      <SkyLayer light={light} />

      {/* the board fills the room between the columns; the planet behind it reaches under them (they come later, on top) */}
      <div ref={boardRef} data-board-box="" style={{position: 'absolute',
        ...(region ? {left: region.left, top: region.top, width: region.width, height: region.height} : {left: '11.6vw', top: '3vh', bottom: '8vh', width: '55.6vw'})}}>
        <BoardView spaces={shownSpaces ?? g.spaces} fresh={fresh} hovers={hoverList} names={names} progress={progress} avoid={region?.avoid}
          camera={{focus: [...fresh], enabled: !showing && !busy, moment}} light={light} inView={!showing && !busy && !covering} />
        {weather.now.mist && <Mist key={`m${weather.now.mist.at}`} at={weather.now.mist.at} />}
        {weather.now.storm && <DustStorm key={`s${weather.now.storm.at}`} at={weather.now.storm.at} mode={weather.now.storm.mode} />}
      </div>
      {/* the gauges have no panels of their own: a soft shade keeps the planet's rim from showing through their numbers */}
      {region && <div aria-hidden="true" data-board-shade="" style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: region.left,
        background: 'linear-gradient(90deg, rgba(16,7,4,.82), rgba(16,7,4,.72) 70%, rgba(16,7,4,0))', pointerEvents: 'none'}} />}
      {/* and the log lane keeps a dark floor when a dive fills the screen behind it */}
      {region && <div aria-hidden="true" data-board-shade="" style={{position: 'absolute', left: 0, right: 0, bottom: 0, top: region.top + region.height - 8,
        background: 'linear-gradient(180deg, rgba(16,7,4,0), rgba(16,7,4,.62) 45%, rgba(16,7,4,.72))', pointerEvents: 'none'}} />}

      <div style={{position: 'absolute', left: '2.4vw', top: '4vh', bottom: '9vh', width: '8.6vw'}}>
        <Globals generation={g.generation} temperature={g.temperature} oxygen={g.oxygenLevel} oceans={Math.max(0, g.oceans - heldOceans)} />
      </div>

      {/* the board darkens behind a parked card (pipeline/CardStage) */}
      <StageDim />

      {/* the chip ("tap for sound") sits at 1.6vw from the bottom-right corner, about 1vw + 1.25 lines of tvt(0.95) tall */}
      <div style={{position: 'absolute', right: '2vw', top: '4vh', bottom: chip ? 'max(9vh, calc(3.4vw + 1.3vw * var(--tvt, 1)))' : '9vh', width: '30vw'}}>
        <div ref={columnRef} data-side-column="" style={{position: 'relative', height: '100%', display: 'flex', flexDirection: 'column', gap: fold >= 3 ? '0.7vh' : '1.1vh'}}>
          {model.players.map((p, i) => { const held = heldPanel(actionHolds, p, Date.now()); return (
            <div key={p.color} data-strip-color={p.color} ref={(el) => { stripRefs.current[p.color] = el; }} style={{flexShrink: 0, position: 'relative'}}>
              <PanelPulse color={p.color} />
              <PlayerStrip p={p} passed={g.passedPlayers.includes(p.color)} sweep={sweep} index={i} fold={fold} hit={hits[p.color]}
                override={stripOverride(live, p.color) ?? held.amounts} prodOverride={held.prod} />
            </div>
          ); })}
          <div data-standings-box="" style={{marginTop: 'auto'}}><div style={{zoom: standingsZoom < 1 ? standingsZoom : undefined}}><Standings game={g} players={model.players} compact={fold >= 3} /></div></div>
          <AnimatePresence mode="wait">
            {!live && !busy && card?.kind === 'attack' && <AttackMoment key={card.k} m={card} players={model.players} />}
            {!live && !busy && card?.kind === 'action' && Date.now() - card.at <= ACTION_STALE_MS && <ActionMoment key={card.k} m={card} players={model.players} />}
          </AnimatePresence>
        </div>
      </div>

      {/* the log lane starts clear of the options gear and stops clear of the sound controls */}
      {/* the newest line is never masked: only the older lines trailing after it fade out (LogTicker) */}
      <div data-log-lane="" style={{position: 'absolute', left: deckRight ? `max(${LANE_LEFT}, calc(${deckRight}px + 1.4vw))` : LANE_LEFT, right: laneRight, bottom: '2.6vh', overflow: 'hidden'}}>
        <TickerFade><LogTicker logs={logs} players={model.players} /></TickerFade>
      </div>

      {/* a played card's four phases (pipeline/CardStage): from the player's panel to the centre of the board and back */}
      {!live && !busy && card?.kind === 'card' && headPlan?.k === card.k && <CardStage key={card.k} m={card} plan={headPlan.plan} players={model.players} boardRef={boardRef} />}

      <AnimatePresence>{banner?.kind === 'banner' && <Banner key={banner.k} m={banner} />}</AnimatePresence>
      {live && <ProductionShowTv live={live} boardRef={boardRef} stripRefs={stripRefs} />}
      {/* phone-to-TV links: map echoes and asked-for replays (Echo.tsx) */}
      <EchoLayer />
      <CinemaLayer blocked={showing} history={history} />
      <VersionTag />
      <UndoNotice tv />
      {g.phase === 'end' && (history?.id === state.full?.gameId && history ? (idle && !showing && <EndStory gameKey={gameKey} history={history} players={model.players} />) : <Podium players={model.players} />)}
    </div>
  );
}

/**
 * The engine's gameAge when this generation's action phase began, remembered for the session so a reload keeps
 * the night where it was. A TV that joins mid-generation does not know it (null): the sky then follows the passes.
 */
function useGenerationStart(gameKey: string, model: SpectatorModel | null): number | null {
  const seen = useRef<{gen: number; acting: boolean} | null>(null);
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    if (!model) return;
    const gen = model.game.generation;
    const key = `mars-ledger-genstart:${gameKey}:${gen}`;
    const acting = model.game.phase === 'action' || (model.game.phase === 'research' && model.players.some((p) => p.isActive));
    let stored: number | null = null;
    try { const v = sessionStorage.getItem(key); stored = v === null ? null : Number(v); } catch { /* storage blocked */ }
    const before = seen.current;
    // Only a transition this TV saw (a new generation, or the start of acting in this one) marks the start.
    if (stored === null && acting && before && (before.gen !== gen || !before.acting)) {
      stored = model.game.gameAge;
      try { sessionStorage.setItem(key, String(stored)); } catch { /* storage blocked */ }
    }
    seen.current = {gen, acting};
    setStart(stored);
  }, [gameKey, model]);
  return start;
}

function EndStory({gameKey, history, players}: {gameKey: string; history: NonNullable<ReturnType<typeof useNet.getState>['history']>; players: SpectatorModel['players']}) {
  // The story plays once per TV; after a reload it opens straight on the podium.
  const id = `${gameKey}:story`;
  const [again] = useState(() => wasSeen(id));
  useEffect(() => { markSeen(id); }, [id]);
  const scores: FinalScore[] = players.map((p) => {
    const b = p.victoryPointsBreakdown;
    return {color: p.color, name: p.name, total: b?.total ?? p.terraformRating, parts: [
      {label: 'TR', value: b?.terraformRating ?? p.terraformRating}, {label: 'Greenery', value: b?.greenery ?? 0}, {label: 'Cities', value: b?.city ?? 0},
      {label: 'Cards', value: b?.victoryPoints ?? 0}, {label: 'Milestones', value: b?.milestones ?? 0}, {label: 'Awards', value: b?.awards ?? 0},
    ]};
  });
  return <Story history={history} scores={scores} startAtPodium={again} />;
}
