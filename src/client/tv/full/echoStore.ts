// Map echo on the TV board (src/shared/tvlinks.ts): the spaces a phone asked the TV to point at, each glowing until
// `until`. The echo layer (Echo.tsx) fills it; the flat board (Board.tsx) and the 3D board (Board3D.tsx) draw the glow
// next to the hover ghosts. Kept apart from Echo.tsx so the lazily loaded 3D board pulls in nothing else.
import {create} from 'zustand';

export type EchoSpace = {key: string; spaceId: string; color: string; until: number};

export const useEchoSpaces = create<{spaces: EchoSpace[]}>(() => ({spaces: []}));

/** Light up `spaceIds` in `color` for `ms`; each goes out by itself. */
export function lightSpaces(key: string, spaceIds: string[], color: string, ms: number, now = Date.now()) {
  if (!spaceIds.length) return;
  const add = spaceIds.map((spaceId) => ({key: `${key}:${spaceId}`, spaceId, color, until: now + ms}));
  useEchoSpaces.setState((s) => ({spaces: [...s.spaces.filter((x) => x.until > now && !spaceIds.includes(x.spaceId)), ...add]}));
  setTimeout(() => useEchoSpaces.setState((s) => ({spaces: s.spaces.filter((x) => x.until > Date.now())})), ms + 30);
}

// Test hook: the spaces glowing now (window.__echoSpaces()).
if (typeof window !== 'undefined') (window as unknown as {__echoSpaces?: () => EchoSpace[]}).__echoSpaces = () => useEchoSpaces.getState().spaces;
