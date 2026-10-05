// The full-game board: the 3D board when this TV can carry it, else the flat SVG board. The flat one
// also stands in while the 3D one loads, if WebGL is missing or fails, and after the frame-time watch gives up.
import {Component, lazy, Suspense, useEffect, useMemo} from 'react';
import type {ReactNode} from 'react';
import {useReducedMotion} from 'motion/react';
import type {Hover, SpaceModel} from '../../../shared/full';
import type {SkyLight} from '../weather/sky';
import {useTvSettings} from '../settings';
import {Board} from './Board';
import type {Camera3Brief, ScreenRect} from './board3d/Board3D';
import {markBoardFallback, useBoardFallback} from './board3d/fallback';
import {FLAT, ladderState} from './board3d/quality';
import {reportTv3d} from './board3d/report';

const Board3D = lazy(() => import('./board3d/Board3D'));

type Props = {spaces: SpaceModel[]; fresh: Set<string>; hovers: Hover[]; names: Record<string, string>; progress: number;
  camera: Camera3Brief; light?: SkyLight;
  /** nothing covers the board right now (its frame times count toward the fallback) */
  inView: boolean;
  /** parts of the board's box that something else covers (viewport px): the resting 3D board keeps out of them */
  avoid?: ScreenRect[]};

let webgl: boolean | null = null;
function hasWebGL(): boolean {
  if (webgl === null) {
    try { webgl = !!document.createElement('canvas').getContext('webgl2'); } catch { webgl = false; }
  }
  return webgl;
}

/** A WebGL failure (lost context, shader error) drops this TV to the flat board instead of a blank one. */
class Guard extends Component<{fallback: ReactNode; children: ReactNode}, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  componentDidCatch(e: unknown) { markBoardFallback({at: Date.now(), kind: 'error', message: e instanceof Error ? e.message : String(e)}); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function BoardView(p: Props) {
  const {board3d, cameraMoves} = useTvSettings();
  const fellBack = useBoardFallback();
  const reduced = useReducedMotion();
  const use3d = board3d && !fellBack && hasWebGL();
  const camera = useMemo(() => ({...p.camera, enabled: p.camera.enabled && cameraMoves}), [p.camera, cameraMoves]);
  // a TV that starts on the flat board or at a reduced 3D level says so (the server forgets on a restart)
  useEffect(() => {
    const level = fellBack ? FLAT : ladderState().level;
    if (board3d && level > 0) reportTv3d({level, dir: 'start', p95: null, median: null, slow: null, size: `${innerWidth}x${innerHeight}@${Math.round(devicePixelRatio * 100) / 100}`, render: null});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  (window as unknown as {__boardMode?: string}).__boardMode = use3d ? '3d' : 'flat';
  const flat = <Board spaces={p.spaces} fresh={p.fresh} hovers={p.hovers} names={p.names} progress={p.progress} camera={camera} light={p.light} fill="map" />;
  if (!use3d) return flat;
  return (
    <Guard fallback={flat}>
      <Suspense fallback={flat}>
        <Board3D {...p} camera={{...camera, enabled: camera.enabled && !reduced}} onSlow={(st) => markBoardFallback({at: Date.now(), kind: 'slow', p95: st.p95, median: st.median, gaps: st.gaps, size: `${innerWidth}×${innerHeight} at ${devicePixelRatio}×`})} watch={p.inView} />
      </Suspense>
    </Guard>
  );
}
