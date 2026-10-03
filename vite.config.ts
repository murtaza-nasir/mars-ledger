import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {execSync} from 'node:child_process';
import {dataProblem} from './tools/check-data.mjs';

// The build id the phone's performance recorder reports: the git commit when there is one (BUILD_SHA in a
// Docker build, which has no .git), plus the build time.
function buildId() {
  let sha = process.env.BUILD_SHA ?? '';
  if (!sha) try { sha = execSync('git rev-parse --short HEAD', {stdio: ['ignore', 'pipe', 'ignore']}).toString().trim(); } catch { /* no git */ }
  return `${sha || 'nogit'}-${new Date().toISOString().slice(0, 16).replace(/[-:]/g, '')}`;
}

// The card and board data come from `npm run fetch-data`; say so instead of failing on a missing import.
const fetchedData = {name: 'fetched-data', buildStart() { const p = dataProblem(); if (p) throw new Error(`\n${p}\n`); }};

export default defineConfig({
  plugins: [react(), fetchedData],
  define: {__BUILD_ID__: JSON.stringify(buildId())},
  root: '.',
  build: {outDir: 'dist', chunkSizeWarningLimit: 1500},
  server: {
    host: true,
    port: 5173,
    proxy: {'/api': 'http://localhost:8080', '/ws': {target: 'ws://localhost:8080', ws: true}},
  },
});
