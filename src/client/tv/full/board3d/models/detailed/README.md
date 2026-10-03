# The Detailed tile set

A second tile set for the 3D board, chosen per TV in **TV options → Tile style** (Classic | Detailed). The owner's
brief: "rich beautiful tiles with a lot of detail". Classic stays as it is (`models/*.tsx`); a tile with no Detailed
model falls back to Classic.

Each file here follows `../contract.ts` exactly like a Classic model (default export + `meta` with `set: 'detailed'`),
plus one extra prop: `detail: 'full' | 'lite'`.

- **`full`** (close up, in a dive and in the lab's close camera): the showpiece. Budget per instance **≤ 16 draw
  calls, ≤ 25k triangles**. Spend it on silhouette and small parts: scaffolding, pipes, vehicles, tiny people,
  antennas, railings, rock strata, wave detail, flocks, steam.
- **`lite`** (the board's resting view, a whole late-game board on screen): **≤ 6 draw calls, ≤ 6k triangles**, and it
  must read as the same tile (same layout, same colours, same lights), so the switch between the two is not noticed.
  Share geometry and materials with `full` where you can (e.g. drop the small-part meshes, merge the rest).

Materials and texture: procedural only (no image files): `MeshStandardMaterial`/`MeshPhysicalMaterial` with
`CanvasTexture`s or shader-generated detail (panel lines, weathering, dust, grime, window grids, metal roughness
variation, glass with fresnel). Normal or bump detail from generated canvases is welcome. Everything memoised and shared
across instances; nothing allocated in `useFrame`.

Motion: richer idle life than Classic (traffic, cranes, flocks, steam, turning radars, flickering signs, water
caustics), all driven by `world.t`, all still when `world.reduced`. Build-in animations as in Classic, but more
dramatic: construction sequences with parts arriving, scaffolds rising and falling away.

Night: windows, signs, beacons and glows carry the scene, as in Classic (`p.night`).

Owner colour: a clear accent in `PLAYER_HEX[p.color]`, as in Classic. The board also draws its own owner rim.

Stand on `y = p.top`, inside `p.radius` (the hex is pointy-top: corners on ±z, like the prism), at most about
2.5 × radius tall.
