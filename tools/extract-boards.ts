// Run from vendor/tm: npx tsx ../../tools/extract-boards.ts ../../src/shared/data/boards.json
// Dumps the Tharsis, Hellas and Elysium boards (spaces and adjacency) exactly as the engine builds them.
import * as fs from 'fs';
import './src/server/Game'; // load order: the engine's modules are circular
import {DEFAULT_GAME_OPTIONS} from './src/server/game/GameOptions';
import {ConstRandom} from './src/common/utils/Random';
import {TharsisBoard} from './src/server/boards/TharsisBoard';
import {HellasBoard} from './src/server/boards/HellasBoard';
import {ElysiumBoard} from './src/server/boards/ElysiumBoard';

const out: Record<string, unknown> = {};
for (const [name, B] of [['tharsis', TharsisBoard], ['hellas', HellasBoard], ['elysium', ElysiumBoard]] as const) {
  const board = (B as any).newInstance({...DEFAULT_GAME_OPTIONS, boardName: name}, new ConstRandom(0));
  out[name] = board.spaces.map((s: any) => ({
    id: s.id, x: s.x, y: s.y, spaceType: s.spaceType, bonus: [...s.bonus],
    ...(s.volcanic ? {volcanic: true} : {}),
    adjacent: s.x >= 0 ? board.getAdjacentSpaces(s).map((a: any) => a.id).sort() : [],
  }));
}
fs.writeFileSync(process.argv[2], JSON.stringify(out));
console.log(Object.entries(out).map(([k, v]) => `${k} ${(v as unknown[]).length}`).join(', '));
