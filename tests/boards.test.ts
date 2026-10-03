// Our map drawings against the engine's own boards (src/shared/data/boards.json, extracted from
// vendor/tm by tools/extract-boards.ts). If every space's drawn neighbours are exactly the engine's
// adjacent spaces, positions, rows and indentation are right on every map.
import {describe, expect, it} from 'vitest';
import boards from '../src/shared/data/boards.json';
import {BOARD_NAMES} from '../src/shared/board';
import {BONUS_NAME} from '../src/shared/full';
import type {SpaceModel} from '../src/shared/full';
import {HEX_W, layout} from '../src/client/tv/full/geometry';
import {hexCenter} from '../src/client/phone/full/Hex';

type BoardSpace = SpaceModel & {adjacent: string[]; volcanic?: boolean};
const DATA = boards as unknown as Record<string, BoardSpace[]>;
const PHONE_W = Math.sqrt(3) * 22;

function drawnNeighbours(centres: Map<string, {x: number; y: number}>, width: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, a] of centres) {
    const n: string[] = [];
    for (const [other, b] of centres) if (other !== id && Math.hypot(a.x - b.x, a.y - b.y) < width * 1.1) n.push(other);
    out.set(id, n.sort());
  }
  return out;
}

describe.each(BOARD_NAMES)('%s board', (name) => {
  const spaces = DATA[name];
  const onMap = spaces.filter((s) => s.x >= 0);

  it('has the engine\'s 61 map spaces in 9 rows of 5-9, plus Ganymede and Phobos off the map', () => {
    expect(onMap).toHaveLength(61);
    const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((y) => onMap.filter((s) => s.y === y).length);
    expect(rows).toEqual([5, 6, 7, 8, 9, 8, 7, 6, 5]);
    expect(spaces.filter((s) => s.x < 0).map((s) => s.id).sort()).toEqual(['01', '02']);
  });

  it('draws every space on the TV next to exactly its engine neighbours', () => {
    const geo = layout(spaces);
    expect(geo.cells).toHaveLength(61);
    expect(geo.offMap.map((s) => s.id).sort()).toEqual(['01', '02']);
    const drawn = drawnNeighbours(new Map(geo.cells.map((c) => [c.id, {x: c.cx, y: c.cy}])), HEX_W);
    for (const s of onMap) expect({id: s.id, n: drawn.get(s.id)}).toEqual({id: s.id, n: s.adjacent});
  });

  it('draws every space on the phone next to exactly its engine neighbours', () => {
    const drawn = drawnNeighbours(new Map(onMap.map((s) => [s.id, hexCenter(s)])), PHONE_W);
    for (const s of onMap) expect({id: s.id, n: drawn.get(s.id)}).toEqual({id: s.id, n: s.adjacent});
  });

  it('has a drawing for every placement bonus on the map', () => {
    for (const s of onMap) for (const b of s.bonus) expect({id: s.id, b, name: BONUS_NAME[b]}).toMatchObject({name: expect.any(String)});
  });
});

describe('board-specific spaces', () => {
  it('Hellas: the south-pole space (61) carries the extra-ocean bonus', () => {
    const pole = DATA.hellas.find((s) => s.id === '61')!;
    expect(pole).toMatchObject({x: 6, y: 8, spaceType: 'land'});
    expect(pole.bonus.map((b) => BONUS_NAME[b])).toEqual(['ocean']);
  });

  it('Elysium and Tharsis have 4 volcanic spaces, Hellas none', () => {
    expect(DATA.tharsis.filter((s) => s.volcanic)).toHaveLength(4);
    expect(DATA.elysium.filter((s) => s.volcanic)).toHaveLength(4);
    expect(DATA.hellas.filter((s) => s.volcanic)).toHaveLength(0);
  });

  it('Hellas has a triple-heat ocean and Elysium a triple-card volcano', () => {
    expect(DATA.hellas.some((s) => s.spaceType === 'ocean' && s.bonus.filter((b) => BONUS_NAME[b] === 'heat').length === 3)).toBe(true);
    expect(DATA.elysium.some((s) => s.volcanic && s.bonus.filter((b) => BONUS_NAME[b] === 'card').length === 3)).toBe(true);
  });
});
