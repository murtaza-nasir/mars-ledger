// A tiny "v<gameAge>.<undo>" tag, so devices can be compared at a glance: shown on a phone while the perf
// recorder is on (?perf=1 or the game menu) and on any screen opened with ?debug=1 (the TV). It turns amber with a
// circular arrow while the screen is behind the version the server says it sent (a resync is on its way).
import {useSyncExternalStore} from 'react';
import {useNet} from '../net';
import {compareVersions, versionTag} from '../../shared/sync';
import {perfStatus, subscribePerf} from '../perf/recorder';

const debugParam = (() => {
  try { return new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; }
})();

export function VersionTag() {
  const v = useNet((s) => s.fullVersion);
  const heard = useNet((s) => s.heardVersion);
  const perf = useSyncExternalStore(subscribePerf, () => perfStatus().on);
  if (!perf && !debugParam) return null;
  const behind = !!heard && (!v || compareVersions(v, heard) < 0);
  return (
    <span data-sync-version="" data-behind={behind ? '' : undefined} className="num"
      style={{position: 'fixed', right: 4, bottom: 'calc(env(safe-area-inset-bottom) + 2px)', zIndex: 2147483000, pointerEvents: 'none',
        fontSize: 10, lineHeight: 1.2, padding: '1px 5px', borderRadius: 6, letterSpacing: 0,
        background: 'rgba(0,0,0,.55)', color: behind ? '#F2C230' : 'rgba(234,242,244,.8)'}}>
      {versionTag(v)}{behind ? ' ↻' : ''}
    </span>
  );
}
