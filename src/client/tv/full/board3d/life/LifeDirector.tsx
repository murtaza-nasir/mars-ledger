// Board life, inside the 3D board's canvas: owns a LifeWorld, feeds it the board, the camera's situation and the game's
// events once per frame, and draws nothing itself. It reads the TV's stores without subscribing React to them, so a game
// moving along never re-renders it. Hidden while a card holds the board, a cinematic or the production show covers it,
// or the tab is in the background; static with reduced motion; off with the "Board life" option. Its "Terraformers"
// sub-option (and the quality ladder's terraformer level) leaves the sky and the ambient life running with no character
// built at all; the ladder's next level unmounts board life entirely.
import {useFrame, useThree} from '@react-three/fiber';
import {useEffect, useMemo, useRef} from 'react';
import type * as THREE from 'three';
import type {Hover, SpaceModel} from '../../../../../shared/full';
import {useNet} from '../../../../net';
import {useCinema} from '../../../cinema/queue';
import {terraformersOn, useTvSettings} from '../../../settings';
import {LEVELS, useQuality} from '../quality';
import {usePipeline} from '../../pipeline/store';
import type {Board3} from '../geometry3d';
import {cameraHold, world as boardWorld} from '../tiles3d';
import {useFly} from '../flyStore';
import {deriveLifeEvents} from './events';
import {GENERIC_SKINS} from './skins';
import {LifeWorld} from './world';
import type {FrameCtx} from './world';

export type BoardLifeProps = {
  geo: Board3; spaces: Map<string, SpaceModel>; hovers: Hover[];
  night: number; reduced: boolean;
  /** the camera moves toward placements (dives); off: nothing hides for them */
  moves: boolean;
  /** the board is on screen: no cinematic or production show covers it */
  watch: boolean;
  /** the hexes the brief camera plan looks at */
  focus: readonly string[];
};

const FOCUS_NONE: string[] = [];

export function BoardLife(p: BoardLifeProps) {
  const settings = useTvSettings();
  const q = LEVELS[useQuality().level];
  if (!settings.boardLife || !q.life) return null;
  return <Life {...p} terraformers={terraformersOn(settings) && q.terraformers} />;
}

function Life({geo, spaces, hovers, night, reduced, moves, watch, focus, terraformers}: BoardLifeProps & {terraformers: boolean}) {
  const world = useMemo(() => new LifeWorld(), []);
  const {scene, camera, gl} = useThree();
  const live = useRef({watch, moves, focus, night, reduced});
  live.current = {watch, moves, focus, night, reduced};
  const hoverIds = useRef<string[]>([]);
  hoverIds.current = hovers.map((h) => h.spaceId).filter((x): x is string => !!x);
  const busyKey = useRef('');

  useEffect(() => {
    scene.add(world.group);
    (window as unknown as {__boardLife?: unknown}).__boardLife = {
      world, spawn: (k: string) => world.spawn(k), stats: () => ({calls: world.drawCalls(), tris: world.triangles(), scenes: world.scenes.map((s) => s.kind), fall: world.fall?.kind ?? null, log: world.log, hidden: world.hidden,
        hexIds: world.scenes.map((s) => s.hexes.map((h) => world.grid.cells[h]?.id)), fallHex: world.fall ? (world.fall.target >= 0 ? world.grid.cells[world.fall.target]?.id : world.grid.cells[world.hexAt(world.fall.tx, world.fall.tz)]?.id) : null,
        chars: world.chars.map((c) => ({active: c.active, pose: c.ps.pose, x: c.x, z: c.z, hex: world.hexAt(c.x, c.z)})), particles: world.parts.active}),
      // test hook: n world ticks with the camera still, returning the heap growth the ticks caused (bytes, positive steps only)
      bench: (n: number) => { const mem = (performance as unknown as {memory?: {usedJSHeapSize: number}}).memory!; const c: FrameCtx = {hidden: false, night: 0, reduced: false, cam: [0, 5, 6], dive: 0, canVisit: false, focus: [], oxygen: 6, wallMs: Date.now()}; let grew = 0, last = mem.usedJSHeapSize; for (let i = 0; i < n; i++) { c.wallMs += 16; world.tick(0.016, c); if (i % 50 === 49) { const u = mem.usedJSHeapSize; if (u > last) grew += u - last; last = u; } } return grew; },
      visit: () => { world.forceVisit = true; }, fallNow: () => world.sched.fallNow(world.clock), manual: (v: boolean) => { world.manual = v; }, abort: () => { for (const s of [...world.scenes]) world.abort(s, 'done'); if (world.fall) world.abort(world.fall, 'done'); }, renderCalls: () => gl.info.render.calls,
    };
    return () => { scene.remove(world.group); world.dispose(); delete (window as unknown as {__boardLife?: unknown}).__boardLife; };
  }, [world, scene, gl]);

  // the two characters' looks; with Terraformers off there are none (nothing built, nothing ticked)
  useEffect(() => { if (terraformers) world.setSkins(GENERIC_SKINS, 'generic'); else world.clearChars(); }, [world, terraformers]);

  // the board: tiles on spaces, and hexes something is about to happen to
  const refresh = useRef(() => {});
  refresh.current = () => {
    const cells = geo.cells.map((c) => ({id: c.id, x: c.x, z: c.z, space: spaces.get(c.id) ?? c.space}));
    const busy = new Set<string>(hoverIds.current);
    const st = usePipeline.getState();
    if (st.reticle && performance.now() - st.reticle.at < 4000) busy.add(st.reticle.spaceId);
    for (const t of st.tiles) busy.add(t.spaceId);
    world.setBoard(cells, busy, Date.now());
  };
  const boardKey = `${[...spaces.values()].map((s) => s.tileType ?? '').join(',')}|${hoverIds.current.join(',')}`;
  useEffect(() => { refresh.current(); }, [boardKey, spaces, geo]);
  useEffect(() => usePipeline.subscribe((s, prev) => {
    if (s.reticle !== prev.reticle || s.tiles !== prev.tiles) { const k = `${s.reticle?.seq}|${s.tiles.map((t) => t.spaceId).join(',')}`; if (k !== busyKey.current) { busyKey.current = k; refresh.current(); } }
  }), []);

  // the game's events, after the move pipeline has them (reads only: nothing here can hold a move back)
  useEffect(() => {
    let prev = useNet.getState().fullView;
    return useNet.subscribe((s) => {
      const next = s.fullView;
      if (next === prev) return;
      const a = prev?.role === 'spectator' ? prev.model : null, b = next?.role === 'spectator' ? next.model : null;
      prev = next;
      if (a && b) world.onEvents(deriveLifeEvents(a, b), Date.now());
    });
  }, [world]);

  const ctx = useMemo<FrameCtx>(() => ({hidden: true, night: 0, reduced: false, cam: [0, 5, 6], dive: 0, canVisit: false, focus: FOCUS_NONE, oxygen: 0, wallMs: 0}), []);
  useFrame((_, dt) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const l = live.current, now = performance.now();
    const st = usePipeline.getState(), net = useNet.getState();
    const show = net.production;
    const showing = !!show && Date.now() >= show.localStart - 300 && Date.now() < show.localStart + show.durationMs + 800;
    const cinema = useCinema.getState().current;
    ctx.hidden = !l.watch || st.dim || showing || !!cinema || st.replays.length > 0;
    ctx.night = l.night; ctx.reduced = l.reduced;
    const c = camera as THREE.PerspectiveCamera;
    ctx.cam[0] = c.position.x; ctx.cam[1] = c.position.y; ctx.cam[2] = c.position.z;
    // a dive looks at the held placement; with camera moves off, nothing dives
    ctx.focus = l.moves ? (cameraHold.until > now ? cameraHold.ids : l.focus.length ? l.focus : FOCUS_NONE) : FOCUS_NONE;
    const v = net.fullView;
    ctx.oxygen = v?.role === 'spectator' ? v.model.game.oxygenLevel : v?.model.game.oxygenLevel ?? 0;
    ctx.wallMs = Date.now();
    ctx.dive = boardWorld.topFade;
    // a visit needs a quiet table: nothing held, pending or hovered, and nobody flying
    ctx.canVisit = l.moves && !l.reduced && !ctx.hidden && hoverIds.current.length === 0 && st.tiles.length === 0 && useFly.getState().phase === 'off'
      && !(st.reticle && now - st.reticle.at < 6000) && cameraHold.until < now;
    world.tick(dt, ctx);
  });
  return null;
}
