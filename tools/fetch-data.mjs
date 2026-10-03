#!/usr/bin/env node
// npm run fetch-data: build the card and board data from the open-source Terraforming Mars engine.
//
// Card names, card text and the map layouts are not kept in this repository. This script fetches them from
// github.com/terraforming-mars/terraforming-mars (GPL-3.0) at the commit pinned in ENGINE_COMMIT, the same commit
// the engine image is built from, and writes:
//   cards-src/<module>.json          every card in every engine module (tools/extract-cards.ts)
//   src/shared/data/boards.json      Tharsis, Hellas and Elysium as the engine builds them (tools/extract-boards.ts)
//   src/shared/data/{base,corpera,prelude}.json, card-names.json, cards/REPORT.md   (npm run cards: tools/build-cards.ts)
// and finally builds the engine's server code in the checkout (vendor/tm/build), which the bot tests
// (tests/judge*.test.ts) and the bot tools in tools/judge/ run in-process. All of these are gitignored.
// Only git and Node are needed; the engine's dependencies are installed inside the clone with scripts disabled.
//
//   node tools/fetch-data.mjs                    fetch if needed, build the card packs and the engine's server code
//   node tools/fetch-data.mjs --extract-only     stop after cards-src/ and boards.json (the Dockerfile caches this step)
//   node tools/fetch-data.mjs --no-engine-build  skip the engine build (the app image does not need it)
//   node tools/fetch-data.mjs --force            extract and build again even when everything matches ENGINE_COMMIT
//
// TM_ENGINE_SRC=<dir> uses (or creates) the engine checkout there instead of vendor/tm.
import {execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'https://github.com/terraforming-mars/terraforming-mars.git';
const args = new Set(process.argv.slice(2));
const commit = fs.readFileSync(path.join(ROOT, 'ENGINE_COMMIT'), 'utf8').trim();
if (!/^[0-9a-f]{40}$/.test(commit)) fail(`ENGINE_COMMIT must hold a full 40-character commit, not "${commit}"`);
const src = path.resolve(ROOT, process.env.TM_ENGINE_SRC ?? 'vendor/tm');
const stamp = path.join(ROOT, 'cards-src', '.engine-commit');
const boards = path.join(ROOT, 'src/shared/data/boards.json');
const tsx = path.join(ROOT, 'node_modules/.bin/tsx');

function fail(msg) { console.error(`fetch-data: ${msg}`); process.exit(1); }
function run(cmd, argv, cwd = ROOT, quiet = false) {
  execFileSync(cmd, argv, {cwd, stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit', env: {...process.env, npm_config_update_notifier: 'false'}});
}
function out(cmd, argv, cwd) {
  try { return execFileSync(cmd, argv, {cwd, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch { return ''; }
}

/** The engine source at the pinned commit (a shallow fetch of that one commit). */
function ensureCheckout() {
  if (!fs.existsSync(path.join(src, '.git'))) {
    console.log(`fetch-data: cloning ${UPSTREAM} at ${commit.slice(0, 12)} into ${path.relative(ROOT, src) || src}`);
    fs.mkdirSync(src, {recursive: true});
    run('git', ['init', '-q'], src);
    run('git', ['remote', 'add', 'origin', UPSTREAM], src);
  }
  if (out('git', ['rev-parse', 'HEAD'], src) !== commit) {
    if (out('git', ['status', '--porcelain', '--untracked-files=no'], src)) fail(`${src} has local changes; commit or discard them first`);
    if (out('git', ['cat-file', '-t', commit], src) !== 'commit') run('git', ['fetch', '-q', '--depth', '1', 'origin', commit], src);
    run('git', ['-c', 'advice.detachedHead=false', 'checkout', '-q', '--detach', commit], src);
  }
}

/** The engine's dependencies, with install scripts off: 'prod' for the extract tools, 'full' to build its server code. */
function ensureDeps(kind) {
  const lockHash = out('git', ['rev-parse', `${commit}:package-lock.json`], src);
  const depsStamp = path.join(src, 'node_modules', '.fetch-data-lock');
  const had = fs.existsSync(depsStamp) ? fs.readFileSync(depsStamp, 'utf8').trim() : null;
  // A checkout that already has node_modules but no stamp (installed by hand, with dev dependencies) is trusted once.
  const have = had ?? (fs.existsSync(path.join(src, 'node_modules')) ? `${lockHash}:full` : '');
  const ok = have === `${lockHash}:full` || (kind === 'prod' && have === `${lockHash}:prod`);
  if (!ok) {
    console.log(`fetch-data: installing the engine's ${kind === 'prod' ? 'runtime ' : ''}dependencies (no install scripts)`);
    run('npm', ['ci', ...(kind === 'prod' ? ['--omit=dev'] : []), '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], src);
  }
  fs.mkdirSync(path.dirname(depsStamp), {recursive: true});
  fs.writeFileSync(depsStamp, (ok ? have : `${lockHash}:${kind}`) + '\n');
}

if (!fs.existsSync(tsx)) fail('run `npm ci` (or `npm install`) first: tsx is missing from node_modules');

const current = fs.existsSync(stamp) && fs.existsSync(boards) ? fs.readFileSync(stamp, 'utf8').trim() : '';
if (current === commit && !args.has('--force')) {
  console.log(`fetch-data: cards-src/ and boards.json already match engine ${commit.slice(0, 12)}`);
} else {
  ensureCheckout();
  ensureDeps('prod');
  // 3. Extract. The tools import the engine by relative path, so they run from inside the checkout.
  try {
    for (const t of ['extract-cards.ts', 'extract-boards.ts']) fs.copyFileSync(path.join(ROOT, 'tools', t), path.join(src, `.fetch-${t}`));
    fs.rmSync(path.join(ROOT, 'cards-src'), {recursive: true, force: true});
    run(tsx, [`.fetch-extract-cards.ts`, path.join(ROOT, 'cards-src')], src, true);
    fs.mkdirSync(path.dirname(boards), {recursive: true});
    run(tsx, [`.fetch-extract-boards.ts`, boards], src);
  } finally {
    for (const t of ['extract-cards.ts', 'extract-boards.ts']) fs.rmSync(path.join(src, `.fetch-${t}`), {force: true});
  }
  fs.writeFileSync(stamp, commit + '\n');
  console.log(`fetch-data: extracted engine ${commit.slice(0, 12)} into cards-src/ and src/shared/data/boards.json`);
}

if (args.has('--extract-only')) process.exit(0);

// 4. The card packs: cards-src + cards/overrides -> src/shared/data/*.json, card-names.json and cards/REPORT.md.
run(tsx, ['tools/build-cards.ts']);
fs.writeFileSync(path.join(ROOT, 'src/shared/data/.engine-commit'), commit + '\n');

// 5. The engine's server code (vendor/tm/build), for the bot tests and tools/judge/. The app image skips it.
if (!args.has('--no-engine-build')) {
  const buildStamp = path.join(src, 'build', '.fetch-data-build');
  if (!args.has('--force') && fs.existsSync(buildStamp) && fs.readFileSync(buildStamp, 'utf8').trim() === commit) {
    console.log(`fetch-data: the engine's server code is already built at ${commit.slice(0, 12)}`);
  } else {
    ensureCheckout();
    ensureDeps('full');
    console.log('fetch-data: building the engine\'s server code (for the bot tests)');
    run('npm', ['run', '-s', 'make:json'], src, true);
    run('npm', ['run', '-s', 'build:server'], src, true);
    fs.writeFileSync(buildStamp, commit + '\n');
  }
}
console.log('fetch-data: done');
