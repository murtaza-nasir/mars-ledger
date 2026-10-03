import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {MotionConfig} from 'motion/react';
import './styles.css';
import {identify, myId, startNet} from './net';
import {PhoneApp} from './phone/PhoneApp';
import {IS_IOS} from './ui/platform';
import {initPerf} from './perf/recorder';
import {UpdateWatcher} from './update';
const TvApp = lazy(() => import('./tv/TvApp').then((m) => ({default: m.TvApp})));
const PerfApp = lazy(() => import('./perf/PerfApp').then((m) => ({default: m.PerfApp})));

const isTv = location.pathname.startsWith('/tv');
// /perf and /perf/upload: the performance diagnostics pages; they never join the table.
const isPerf = /^\/perf(\/|$)/.test(location.pathname);
if (!isPerf) { identify(isTv ? 'tv' : 'phone', isTv ? null : myId()); startNet(); }
if (!isTv && !isPerf) initPerf();
document.body.classList.add(...(isPerf ? ['perf'] : ['grain', isTv ? 'tv' : 'phone']));
// Every iPhone and iPad browser is WebKit, which flickers on blended full-screen layers and glass blur;
// styles.css turns those off under .ios (iPadOS reports a Mac with touch).
if (IS_IOS) document.body.classList.add('ios');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      {isPerf ? <Suspense fallback={null}><PerfApp /></Suspense> : isTv ? <><Suspense fallback={null}><TvApp /></Suspense><UpdateWatcher tv /></> : <><PhoneApp /><UpdateWatcher tv={false} /></>}
    </MotionConfig>
  </StrictMode>,
);
