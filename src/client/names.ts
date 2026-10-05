// The name to show for a seat, on the TV and the phones: the seat's own record in the game state (a profile edit renames
// it), never the name the engine stored when the game was created (src/shared/names.ts). Engine names are a fallback for
// seats the state does not know.
import {useMemo} from 'react';
import {useNet} from './net';
import {displayName, namesKey, NO_NAMES, seatNames} from '../shared/names';
import type {SeatNames} from '../shared/names';

let cache: {key: string; names: SeatNames} = {key: '', names: NO_NAMES};
/** The seats' names from the store's state, the same object while no name changes (a stable selector result). */
function currentNames(state: Parameters<typeof seatNames>[0]): SeatNames {
  const names = seatNames(state);
  const key = namesKey(names);
  if (key !== cache.key) cache = {key, names};
  return cache.names;
}

export function useSeatNames(): SeatNames {
  return useNet((s) => currentNames(s.state));
}

/** `nameFor(colorOrPlayerId, engineName?)`: the seat's current display name. */
export function useDisplayName(): (key: string | null | undefined, fallback?: string | null) => string {
  const names = useSeatNames();
  return useMemo(() => (key: string | null | undefined, fallback?: string | null) => displayName(names, key, fallback), [names]);
}
