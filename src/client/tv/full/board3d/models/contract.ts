// The contract every 3D tile model in this folder follows. Each model file default-exports a component and
// exports `meta`. Models are picked up automatically by the model lab (/lab.html in the Vite dev server) and wired
// into the board by tiles3d.tsx (TILE_RENDERERS / SPECIAL_PARTS).
import type {TileModelProps} from '../tiles3d';

export type ModelProps = TileModelProps & {
  /** seconds since this tile was placed (a large number when it has stood for a while): drive the build-in from it */
  age: () => number;
  /** detailed tile sets (models/<set>/): 'full' close up (a dive), 'lite' at the board's resting view. Classic models
   *  ignore it. Absent = 'full'. */
  detail?: 'full' | 'lite';
  /** which of the hex's six edges border another ocean tile, clockwise from the edge between the +z corner and the
   *  next corner clockwise (seen from above). Oceans use it to leave out the beach where the sea continues.
   *  Absent = no neighbouring ocean known (draw the full shore). */
  oceanEdges?: readonly boolean[];
};

export type ModelMeta = {
  /** the tile set this model belongs to: 'classic' (models/*.tsx, the default) or e.g. 'detailed' (models/detailed/) */
  set?: string;
  /** shown in the lab */
  name: string;
  /** the engine tile types this model draws (src/shared/full.ts TILE), e.g. [TILE.CITY] */
  tileTypes: number[];
  kind: 'city' | 'greenery' | 'ocean' | 'special';
  /** seconds the placement animation lasts (the board holds the camera for it) */
  buildSeconds: number;
};

/**
 * Rules for models (see the README in this folder):
 * - Stand on the prism top: y = p.top is the hex's upper face; stay within radius p.radius in x/z (the hex is
 *   pointy-top, circumradius p.radius) and below ~2.5 × p.radius in height.
 * - All geometry and textures procedural (three.js primitives, BufferGeometry, shaders, CanvasTexture); no files.
 * - Animate from the shared clock `world.t` (seconds) in useFrame; `world.reduced` true → no idle motion, and the
 *   build-in jumps to its end state; `p.night` 0..1 drives windows, glows and emissive lights.
 * - Variation per space from `seeded(p.id)` so two cities never look identical.
 * - Owner identity: a visible accent in p.color (PLAYER_HEX[p.color]) that reads from the default camera.
 * - Budget per instance: ≤ 6 draw calls (use InstancedMesh / merged geometry for repeated parts), ≤ 6k triangles,
 *   no allocations inside useFrame, memoise geometries/materials (share them across instances where possible).
 */
export type {TileModelProps};
