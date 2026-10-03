# Development

You need Node.js 26 (the version in the image), npm and git.

```sh
git clone https://github.com/murtaza-nasir/mars-ledger.git
cd mars-ledger
npm ci
npm run fetch-data
npm run dev
```

With `npm run dev`, the server is started on port 8080 (and restarted on changes), and Vite on port 5173. Open
`http://localhost:5173/tv` and `http://localhost:5173/`. Requests to `/api` and `/ws` are passed on to the server. A `.env` file
in the repository root is read when it exists.

## Card data

Card names, card text and the maps are not kept in the repository. They come from the open-source Terraforming
Mars engine at the commit in `ENGINE_COMMIT`. You fetch them once:

```sh
npm run fetch-data
```

What happens (`tools/fetch-data.mjs`):

1. `github.com/terraforming-mars/terraforming-mars` is cloned at that commit into `vendor/tm`.
2. The engine's runtime dependencies are installed there, with install scripts turned off.
3. `tools/extract-cards.ts` and `tools/extract-boards.ts` are run inside the engine's source. Their output is
   `cards-src/` and `src/shared/data/boards.json`.
4. `npm run cards` (`tools/build-cards.ts`) is run. `cards-src/` and the hand-written effects in
   `cards/overrides/` are merged into `src/shared/data/base.json`, `corpera.json`, `prelude.json`, `card-names.json`
   and `cards/REPORT.md`.

5. The engine's full dependencies are installed and its server code is built in `vendor/tm/build`
   (`npm run make:json` and `npm run build:server` there). That code is run in-process by the bot tests
   (`tests/judge*.test.ts`) and tools in `tools/judge/`. Add `--no-engine-build` to skip this step; those
   two test files then cannot be loaded.

The first run takes a minute or two. All outputs are gitignored. When you run it again, nothing is extracted or
built unless `ENGINE_COMMIT` changed; add `--force` to do it all again. Set `TM_ENGINE_SRC` to use an engine
checkout elsewhere.

Without the data, `npm test`, `npm run typecheck`, `npm run build` and `npm run dev` exit with a request to run
`npm run fetch-data`.

`cards/REPORT.md` lists how much of each card is applied automatically in companion mode.

## Tests

```sh
npm test             # vitest: rules, every card, bots, sync, narrator, posters and more
npm run typecheck
npm run build        # client into dist/, server into dist-server/
npm start            # runs the built server
```

End-to-end browser tests are in `tests/full/`. In these Python Playwright scripts, phones and the TV are driven
against a real engine. How to run each script is in its header. They need `pip install playwright` and
`playwright install chromium`.

## Running the engine

Full games need the engine. The simplest way is its Docker image:

```sh
deploy/engine-image.sh
docker run -d --name tm-engine -p 8791:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
```

`ENGINE_URL` defaults to `http://localhost:8791`, so it is found by `npm run dev`.

You can also run it from the checkout in `vendor/tm`. Its dependencies and server code were already
installed and built there by `npm run fetch-data`, so only the styles are left:

```sh
cd vendor/tm
npm run make:css
mkdir -p db/files && PORT=8791 LOCAL_FS_DB=1 node build/src/server/server.js
```

## The model lab

With `npm run dev` running, open `http://localhost:5173/lab.html`. It shows one 3D tile model from
`src/client/tv/full/board3d/models/` on a patch of hexes, by day or night, and its placement is replayed.
You choose the model, the camera and the light with URL parameters.

## Adding an expansion

1. Add the module to `MODULES` in `tools/build-cards.ts`, write `cards/overrides/<module>.ts` until the report
   has no `manual` cards, and register the pack in `src/shared/cards.ts`.
2. Add any new board rules (Venus track, colonies, delegates) to `src/shared/engine.ts` as their own section,
   keyed on `state.modules`, plus the matching `Behavior` keys in `src/shared/types.ts`.
3. Add tests under `tests/` in the style of `tests/allcards.test.ts`.

## Building the images

```sh
docker build -t mars-ledger:local .
deploy/engine-image.sh
```

`npm run fetch-data` is part of the app image build, so the build needs access to github.com.
