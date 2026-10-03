#!/usr/bin/env node
// Fails with a clear message when the generated card and board data are missing or were built from another engine
// commit. Runs before npm test, typecheck, build and dev, inside the vitest setup and from the Vite config.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_FILES = ['base.json', 'corpera.json', 'prelude.json', 'card-names.json', 'boards.json'].map((f) => `src/shared/data/${f}`);

/** null when the data is in place, otherwise the message to show. */
export function dataProblem(root = ROOT) {
  const missing = DATA_FILES.filter((f) => !fs.existsSync(path.join(root, f)));
  if (missing.length) {
    return `The card and board data have not been fetched yet (missing ${missing.join(', ')}).\n`
      + 'Run `npm run fetch-data` once. It clones the open-source Terraforming Mars engine at the commit in ENGINE_COMMIT\n'
      + 'and extracts the cards and maps from it (git and network access needed; about a minute).';
  }
  const want = fs.readFileSync(path.join(root, 'ENGINE_COMMIT'), 'utf8').trim();
  const stampFile = path.join(root, 'src/shared/data/.engine-commit');
  const have = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';
  if (have && have !== want) {
    return `The card data were built from engine ${have.slice(0, 12)}, but ENGINE_COMMIT is ${want.slice(0, 12)}.\n`
      + 'Run `npm run fetch-data` again.';
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problem = dataProblem();
  if (problem) { console.error(`\n${problem}\n`); process.exit(1); }
}
