# Third-party material and asset licences

Mars Ledger is free software under the GNU Affero General Public License, version 3 only
(`AGPL-3.0-only`, see `LICENSE`). This file lists what is borrowed or derived from other projects, and the
licence of every asset in `public/` and `server-assets/`.

## Unofficial fan project

Mars Ledger is an unofficial fan-made companion for the Terraforming Mars board game. It is not affiliated with
or endorsed by FryxGames, Stronghold Games or Asmodee. Terraforming Mars is a trademark of FryxGames. You need a
copy of the board game to play.

The repository holds no FryxGames artwork, logos, box art or card scans. Card names, card text and map layouts
are not stored in the repository either; see the next section.

## The Terraforming Mars engine (GPL-3.0)

- Project: <https://github.com/terraforming-mars/terraforming-mars>
- Licence: GNU General Public License v3.0
- Pinned commit: the one in `ENGINE_COMMIT`
  (`41a1b005de737058fbb94249ed2ec5252a2e328f` at the time of writing)

How the engine is used:

- **Full-game mode:** the engine is run unmodified as a separate container and reached over HTTP. It is
  built from the upstream repository at the pinned commit with upstream's own Dockerfile, by
  `deploy/engine-image.sh` (or the `engine` service in `deploy/docker-compose.build.yml`).
- **Card and board data** come from the engine at build time. With `npm run fetch-data`, the engine is cloned at
  the pinned commit and `tools/extract-cards.ts` and `tools/extract-boards.ts` are run; both import the
  engine's card and board classes. The output (`cards-src/`, `src/shared/data/*.json`, `cards/REPORT.md`) is gitignored and
  rebuilt in every image. It holds card names, card text, card behaviours and the three maps.
- **Derived code in this repository:**
  - `tools/extract-cards.ts`, `tools/extract-boards.ts`: run inside the engine's source tree.
  - `src/shared/types.ts`: the card `behavior` format follows the engine's declarative format, so its data
    fits unchanged.
  - `cards/overrides/*.ts`: hand-written effects, in that format, for cards coded in the engine.
    A few short rule phrases there are paraphrased from card text.
  - `src/shared/board.ts`, `src/shared/engine.ts`: milestone, award and board rules follow the engine's
    implementation.
  - `src/server/full/` and `src/shared/full.ts`: the engine's HTTP routes and view models.

GPLv3 section 13 allows this GPL-3.0 material to be combined with the AGPL-3.0 code of Mars Ledger. The combined
work is distributed under the AGPL-3.0; the GPL-3.0 parts stay under the GPL-3.0.

If you publish an engine image, you distribute the engine's object code. Keep the corresponding source available
with it (see the image labels for the upstream repository and the exact commit), as GPLv3 section 6 requires.

## Fonts

| Asset | Source | Licence |
|---|---|---|
| Saira (variable), in the web client | npm `@fontsource-variable/saira`, from <https://github.com/Omnibus-Type/Saira> | SIL Open Font License 1.1 |
| `server-assets/poster/fonts/PosterSaira*.ttf` | Static instances cut from Saira by `tools/poster-assets.py`, renamed "Poster Saira" | SIL Open Font License 1.1 (`server-assets/poster/fonts/OFL.txt`) |

## Mars maps (public domain)

| File | Source | Licence |
|---|---|---|
| `public/assets/mars-color.jpg` (4096 x 2048) | USGS Astrogeology, Mars Viking Global Color Mosaic 925 m, <https://planetarymaps.usgs.gov/mosaic/Mars_Viking_ClrMosaic_global_925m.tif>, Lanczos-downsampled | Public domain (NASA/USGS) |
| `public/assets/mars-elevation.png` (2048 x 1024, 8-bit) | USGS Astrogeology, Mars MGS MOLA DEM 463 m, <https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif>; heights mapped linearly from -6507..8582 m to 0..255 | Public domain (NASA/USGS) |

Downsampled to the same size, the colour mosaic matches `mars-color.jpg` with a correlation of 0.998 per
channel. The elevation model, mapped as above, matches `mars-elevation.png` with a correlation of 0.997.

## Generated art (CC BY 4.0)

Every illustration in Mars Ledger was generated for this project with the Krea 2 Turbo text-to-image model. No
FryxGames card art was used as input, and no prompt contains the game's name. The prompts and seeds are in the manifests
next to the images.

| Folder | What | Prompts |
|---|---|---|
| `public/cards/*.webp` | card illustrations, one per card number | `public/cards/manifest.json`, `cards/art/prompts.json` |
| `public/portraits/*.webp` | corporation portraits | `public/portraits/manifest.json`, `cards/art/portrait_scenes.json` |
| `public/posters/*.webp` | the end-of-game poster paintings | `public/posters/manifest.json` |
| `public/assets/event-*.webp`, `tv-stage-*.webp`, `phone-lobby.webp` | event scenes and backdrops | `public/assets/manifest.json` |
| `server-assets/poster/paintings/*.jpg`, `server-assets/poster/portraits/*.jpg` | JPEG copies of the paintings and portraits for the poster renderer | as above |

These images are licensed under the Creative Commons Attribution 4.0 International licence (CC BY 4.0,
<https://creativecommons.org/licenses/by/4.0/>). Credit them as "Mars Ledger contributors". Where generated
images carry no copyright, they are offered on the same terms without restriction.

## Drawn and procedural assets (AGPL-3.0, with the code)

- `public/favicon.svg` and the resource and tag glyphs in `src/client/ui/Icons.tsx`: drawn for this project.
- The 3D tiles, cities, forests and oceans on the TV board are built in code
  (`src/client/tv/full/board3d/models/`).
- Every sound is synthesized in the browser with the Web Audio API (`src/client/tv/sound/`). No audio files are shipped.
- `tests/fixtures/narrator/tone.mp3`: a synthetic tone made with ffmpeg.

## npm packages

The image contains the runtime dependencies in `package.json` and their dependencies. All have permissive
licences: MIT (most), ISC, BSD-2/3-Clause, Apache-2.0, 0BSD and Blue Oak 1.0.0, with two exceptions:

- `@resvg/resvg-wasm` (Mozilla Public License 2.0): the poster renderer's WebAssembly module, shipped
  unmodified. Source: <https://github.com/yisibl/resvg-js>.
- `@fontsource-variable/saira` (SIL Open Font License 1.1): see Fonts.

Run `npx license-checker --production` (or read `package-lock.json`) for the full list.

## Optional online services

None of these is contacted unless you configure it (see `.env.example`):

- YouTube IFrame Player API, for the TV radio (`RADIO_PLAYLIST`). The videos are subject to YouTube's terms.
- OpenRouter or any OpenAI-compatible endpoint, for photo scanning and mission control.
- Google's Gemini text-to-speech through OpenRouter, for mission control's voice. Hume, for the same, until its
  TTS API ends on 13 November 2026.
- TypeSafe's Jev decision model, for the Hard (Jev) bots.
- A Stable Diffusion WebUI Forge server, for the one-off poster illustration.
