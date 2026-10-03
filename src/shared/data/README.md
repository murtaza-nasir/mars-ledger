# Generated data

The JSON files in this folder are not in git. `npm run fetch-data` makes them from the open-source Terraforming
Mars engine (github.com/terraforming-mars/terraforming-mars, GPL-3.0) at the commit in `ENGINE_COMMIT`:

- `boards.json`: the Tharsis, Hellas and Elysium maps (`tools/extract-boards.ts`).
- `base.json`, `corpera.json`, `prelude.json`: the card packs, the engine's card data plus `cards/overrides`
  (`tools/build-cards.ts`).
- `card-names.json`: every card name in every engine module (mission control's validator uses it).

If typecheck or the tests say a file here is missing, run `npm run fetch-data`.
