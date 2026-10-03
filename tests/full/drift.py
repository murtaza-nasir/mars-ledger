"""Drift harness: do the numbers each screen shows match the engine, and how long are they allowed to be off?

    engine: (cd vendor/tm && mkdir -p db/files && PORT=8941 LOCAL_FS_DB=1 node build/src/server/server.js)
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/drift.py --engine http://localhost:8941 --port 8950 \
              --out DIR [--webkit ws://localhost:8949/] [--stress all|none|hide,freeze,reset,zombie,restart,undo]

The game: two human seats answered by the soak bot (tests/full/soak.py; a share of answers through the real phone UI)
and one server bot (BOT_DELAY_SCALE 0, so moves come as fast as the engine takes them). On screen at once: the TV and
one Chromium phone page per seat, plus optionally a WebKit iPhone page (Playwright's Docker image, `--webkit`).
Every page reaches the server through its own small TCP proxy, so the harness can drop a device's connection (reset)
or turn it into a zombie that looks open but carries nothing (as iOS leaves a socket after the phone slept).

Every --every seconds each page's DOM is read: the TV player panels (M€, steel, titanium, plants, energy, heat, each
production, TR) and each phone's resource header, as the user sees them (odometer digits are read from where each
digit column actually sits, not from the label). Right before and after each read the engine's spectator model is
fetched directly. A field is "stale" when the value on screen is none the engine had within the last --lag seconds
(a screen may run that far behind; an odometer still rolling counts by the value it is rolling to). Staleness counts
from when the page became visible and outside the production show's documented hold (show message until the show
ends, plus --lag); a divergence is staleness lasting more than --min-stale (more than one read). Each is recorded with
its device, player, field, duration beyond the lag, the game phase, whether the device's own store was stale too
(transport) or only its drawing (render), its view version and the server's, its frame rate, and the events before it.
Needs: websockets, playwright.
"""
import argparse, asyncio, collections, json, os, random, signal, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402  (the bot, the seat and the UI driver)
import websockets  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = soak.ROOT
FIELDS = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat']
PROD = {'megacredits': 'megacreditProduction', 'steel': 'steelProduction', 'titanium': 'titaniumProduction',
        'plants': 'plantProduction', 'energy': 'energyProduction', 'heat': 'heatProduction'}
ALL_FIELDS = FIELDS + [f + 'Prod' for f in FIELDS] + ['tr']

# What a page shows, read from the DOM. An odometer (src/client/ui/Rolling.tsx) shows each digit by sliding a 0-9
# column; the shown digit is where the column sits now (its transform), so a stuck or half-run animation reads wrong.
READ_JS = r'''(sel) => {
  const odo = (el) => {
    if (!el) return null;
    let neg = false, digits = [], moving = false;
    for (const c of el.children) {
      if (c.textContent === '−' && c.children.length === 0) { neg = true; continue; }
      const col = c.children[1];
      if (!col || col.children.length !== 10) continue;
      const unit = col.children[1].offsetTop - col.children[0].offsetTop || 1;
      const m = new DOMMatrixReadOnly(getComputedStyle(col).transform === 'none' ? undefined : getComputedStyle(col).transform);
      const d = -m.m42 / unit;
      if (Math.abs(d - Math.round(d)) > 0.08) moving = true;
      digits.push(Math.max(0, Math.min(9, Math.round(d))));
    }
    if (!digits.length) return null;
    const v = Number(digits.join(''));
    return {v: neg ? -v : v, label: Number(el.getAttribute('aria-label')), moving};
  };
  const num = (t) => { if (t == null) return null; t = t.replace(/\s/g, ''); const n = Number(t.replace(/[▲+]/g, '').replace(/[▼−-]/g, '')); return /[▼−-]/.test(t) ? -n : n; };
  const net = window.__net && window.__net.getState();
  const fv = net && net.fullView;
  const nums = (p) => p ? Object.fromEntries([...%FIELDS%.map((f) => [f, p[f]]), ...%FIELDS%.map((f) => [f + 'Prod', p[f === 'megacredits' ? 'megacreditProduction' : f + 'Production']]), ['tr', p.terraformRating]]) : null;
  const storeNums = {};
  if (fv && fv.role === 'spectator') for (const p of fv.model.players) storeNums[p.color] = nums(p);
  if (fv && fv.role === 'player') storeNums[fv.model.color] = nums(fv.model.thisPlayer);
  const out = {visible: document.visibilityState, connected: !!(net && net.connected), store: fv ? [fv.model.game.gameAge, fv.model.game.undoCount] : null,
    storeNums, frames: window.__frames || 0, labels: {},
    show: !!(net && net.production && Date.now() < net.production.localStart + net.production.durationMs), players: {},
    tag: (document.querySelector('[data-sync-version]') || {}).textContent || null,
    held: (window.__actionHeld && window.__actionHeld()) || {}};
  if (sel === 'tv') {
    for (const strip of document.querySelectorAll('[data-strip-color]')) {
      const color = strip.getAttribute('data-strip-color');
      const p = {};
      for (const r of %FIELDS%) {
        const cell = strip.querySelector(`[data-res-cell="${r}"]`);
        if (!cell) continue;
        const o = odo(cell.querySelector('[data-odometer]'));
        if (o) { p[r] = o.v; if (o.moving) { p._moving = true; (p._target = p._target || {})[r] = o.label; } }
        const pill = cell.querySelector('[data-prod-pill]');
        if (pill) p[r + 'Prod'] = num(pill.textContent);
      }
      const tr = [...strip.querySelectorAll('[data-odometer]')].find((e) => !e.closest('[data-res-cell]'));
      const o = odo(tr); if (o) { p.tr = o.v; if (o.moving) (p._target = p._target || {}).tr = o.label; }
      out.players[color] = p;
    }
  } else {
    const p = {};
    for (const r of %FIELDS%) {
      const tile = document.querySelector(`[data-res-tile="${r}"]`);
      if (!tile) continue;
      const o = odo(tile.querySelector('[data-odometer]'));
      if (o) { p[r] = o.v; if (o.moving) { p._moving = true; (p._target = p._target || {})[r] = o.label; } }
      const pt = tile.querySelector('div > span.num');
      if (pt) p[r + 'Prod'] = num(pt.textContent || '0') || 0;
    }
    const tr = document.querySelector('[aria-label^="Terraform rating"] [data-odometer]');
    const o = odo(tr); if (o) { p.tr = o.v; if (o.moving) (p._target = p._target || {}).tr = o.label; }
    if (fv && fv.role === 'player') out.players[fv.model.color] = p;
  }
  return out;
}'''.replace('%FIELDS%', json.dumps(FIELDS))


FRAMES_JS = "window.__frames = 0; (function f() { window.__frames++; requestAnimationFrame(f); })();"


def http_json(url, timeout=3):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read())


def truth_of(model):
    """The engine's numbers per player colour, plus the version and phase."""
    out = {}
    for p in model['players']:
        t = {f: p[f] for f in FIELDS}
        t.update({f + 'Prod': p[PROD[f]] for f in FIELDS})
        t['tr'] = p['terraformRating']
        out[p['color']] = t
    g = model['game']
    return {'players': out, 'v': (g['gameAge'], g['undoCount']), 'phase': g['phase'], 'gen': g['generation']}


# ---- a TCP proxy per device: pass, reset (drop every connection) or zombie (looks open, carries nothing) ---------
class Conn:
    def __init__(self, cw, uw): self.cw, self.uw, self.dead = cw, uw, False

    def abort(self):
        for w in (self.cw, self.uw):
            try: w.transport.abort()
            except Exception: pass


class Proxy:
    def __init__(self, name, listen, target, log):
        self.name, self.listen, self.target, self.log = name, listen, target, log
        self.conns = set()

    async def start(self):
        self.server = await asyncio.start_server(self.handle, '0.0.0.0', self.listen)

    async def handle(self, cr, cw):
        try:
            ur, uw = await asyncio.open_connection('127.0.0.1', self.target)
        except Exception:
            cw.transport.abort(); return
        c = Conn(cw, uw)
        self.conns.add(c)

        async def pipe(r, w):
            try:
                while True:
                    data = await r.read(65536)
                    if not data: break
                    if c.dead: continue  # a zombie swallows everything
                    w.write(data); await w.drain()
            except Exception:
                pass
            # a zombie never tells the other side; a live connection closes both ways
            if not c.dead: c.abort()
        await asyncio.gather(pipe(cr, uw), pipe(ur, cw))
        self.conns.discard(c)

    def reset(self):
        n = len(self.conns)
        for c in list(self.conns): c.abort()
        self.log('reset', self.name, f'{n} connections dropped')

    def zombie(self, secs):
        live = [c for c in self.conns if not c.dead]
        for c in live: c.dead = True
        self.log('zombie', self.name, f'{len(live)} connections go silent for {secs}s, then close')

        async def later():
            await asyncio.sleep(secs)
            for c in live: c.abort()
            self.log('zombie-closed', self.name, 'the silent connections finally close')
        asyncio.create_task(later())

    def close(self):
        self.server.close()
        for c in list(self.conns): c.abort()


# ---- seats that survive a server restart -------------------------------------------------------------------------
class Seat(soak.Seat):
    async def open(self, port, visible=True):
        self.port, self.visible = port, visible
        await self._connect()
        asyncio.create_task(self._keep())

    async def _connect(self):
        self.ws = await websockets.connect(f'ws://localhost:{self.port}/ws', max_size=2 ** 24)
        await self.ws.send(json.dumps({'type': 'hello', 'role': 'phone', 'playerId': self.id, 'visible': self.visible}))

    async def _keep(self):
        while not getattr(self, 'closed', False):
            try:
                await self.reader()
            except Exception:
                pass
            for f in self.pending.values():
                if not f.done(): f.set_result('connection lost')
            self.pending.clear()
            while not getattr(self, 'closed', False):
                await asyncio.sleep(0.5)
                try: await self._connect(); break
                except Exception: pass

    async def rpc(self, msg):
        try: return await super().rpc(msg)
        except Exception as e: return f'rpc failed: {e}'


class Observer:
    """A bare socket on the server (no hello): it receives what the server pushes to spectators, and every show."""
    def __init__(self, port, log):
        self.port, self.log = port, log
        self.version = None; self.shows = []; self.closed = False; self.pushes = 0; self.push_log = []

    async def run(self):
        while not self.closed:
            try:
                async with websockets.connect(f'ws://localhost:{self.port}/ws', max_size=2 ** 24) as ws:
                    async for raw in ws:
                        m = json.loads(raw); t = m.get('type'); now = time.time()
                        if t == 'full':
                            g = m['view']['model']['game']; self.version = (g['gameAge'], g['undoCount']); self.pushes += 1
                            self.push_log.append((now, self.version))
                        elif t == 'version':
                            self.log('heartbeat', 'server', str(m.get('v')), quiet=True)
                        elif t == 'production':
                            s = m['show']
                            start = now + (s['startAt'] - s['serverNow']) / 1000
                            if not any(x['id'] == s['id'] for x in self.shows):
                                self.shows.append({'id': s['id'], 'recv': now, 'start': start, 'end': start + s['durationMs'] / 1000})
                                self.log('production', 'server', s['id'])
            except Exception:
                await asyncio.sleep(0.4)


# ---- the run -----------------------------------------------------------------------------------------------------
class Run:
    def __init__(self, args):
        self.args = args
        self.t0 = time.time()
        self.events = []  # (t, kind, device, detail)
        self.episodes = []
        self.open = {}  # (device, color, field) -> episode
        self.visible_since = {}  # device -> t
        self.unreadable = collections.Counter()
        self.samples = 0
        self.truth_log = []
        self.store_log = {}
        self.truth_hist = collections.deque(maxlen=200)
        self.fps = collections.defaultdict(list)
        self.held_reads, self.held_max = 0, 0.0  # TV cells held for an action's flights, and the longest time left on one
        self.last_truth = None
        self.srv = None

    def log(self, kind, device, detail='', quiet=False):
        self.events.append((time.time(), kind, device, detail))
        if not quiet: print(f'  [{time.time() - self.t0:7.1f}s] {kind:14s} {device:10s} {detail}', flush=True)

    def excused(self, device, t, obs):
        """Inside a production show's documented hold: from its message until it ends, plus the allowed lag."""
        for s in obs.shows:
            if s['recv'] - 0.3 <= t <= s['end'] + self.args.lag: return s['end'] + self.args.lag
        return None

    def valid(self, color, f, t):
        """Every value the engine had for this field within the allowed lag before t (a screen may be that far behind)."""
        return {P.get(color, {}).get(f) for (tt, P) in self.truth_hist if tt >= t - self.args.lag}

    def note(self, device, readings, before, after, t, obs):
        """Is each field on screen a value the engine had within the allowed lag? Open, extend or close stale stretches.
        An odometer still rolling counts by the value it is rolling to (its label); one that stopped counts as drawn."""
        seen = set()
        held = readings.get('held') or {}
        for color, shown in readings.get('players', {}).items():
            for f in ALL_FIELDS:
                if f not in shown: continue
                key = (device, color, f)
                seen.add(key)
                # an action's gains still flying into this TV cell: the page holds it, by a hard deadline
                if f in (held.get(color) or {}):
                    self.held_reads += 1
                    self.held_max = max(self.held_max, held[color][f] / 1000)
                    if key in self.open: self.close(key, t)
                    continue
                ta = after['players'].get(color, {}).get(f)
                valid = self.valid(color, f, t) | {before['players'].get(color, {}).get(f), ta}
                target = (shown.get('_target') or {}).get(f)
                ok = shown[f] in valid or (target is not None and target in valid)
                store_val = ((readings.get('storeNums') or {}).get(color) or {}).get(f)
                ep = self.open.get(key)
                if ok:
                    if ep: self.close(key, t)
                    continue
                if not ep:
                    ep = {'device': device, 'color': color, 'field': f, 'start': t, 'shown': shown[f], 'truth': ta,
                          'phase': after['phase'], 'gen': after['gen'], 'truth_v': list(after['v']),
                          'store_v': readings.get('store'), 'server_v': list(obs.version) if obs.version else None,
                          'tag': readings.get('tag'), 'moving': bool(shown.get('_moving')), 'connected': readings.get('connected'),
                          'show_flag': readings.get('show'), 'fps': readings.get('fps'),
                          # transport: the device's own store is stale too; render: the store is right, the drawing is not
                          'kind': 'render' if store_val in valid else 'transport', 'store_val': store_val,
                          'events': [(round(e[0] - self.t0, 2), e[1], e[2], e[3]) for e in self.events if e[0] <= t and e[1] not in ('heartbeat',)][-6:]}
                    self.open[key] = ep
                ep['last'] = t; ep['last_shown'] = shown[f]; ep['last_truth'] = ta
                ep['last_store_v'] = readings.get('store'); ep['last_server_v'] = list(obs.version) if obs.version else None
        # fields no longer on screen (a panel folded, a page reloaded) close their stretches
        for key in [k for k in self.open if k[0] == device and k not in seen]:
            self.close(key, t)

    def close(self, key, t):
        ep = self.open.pop(key)
        ep['end'] = t
        self.finish(ep)

    def finish(self, ep):
        # counted from when the page was last made visible, without the production show holds (message until the show
        # ends, plus the allowed lag): the longest stretch left over must stay within the lag
        segs = [(max(ep['start'], self.visible_since.get(ep['device'], 0)), ep['end'])]
        for sh in self.obs.shows:
            a, b = sh['recv'] - 0.3, sh['end'] + self.args.lag
            segs = [p for (x, y) in segs for p in ((x, min(y, a)), (max(x, b), y)) if p[1] > p[0]]
        ep['duration'] = round(ep['end'] - ep['start'], 2)
        ep['unexcused'] = round(max((y - x for x, y in segs), default=0.0), 2)
        ep['divergence'] = ep['unexcused'] > self.args.min_stale
        # a device on a zombie socket (silent since the stress step, not yet reconnected) can only be as quick as its
        # dead-link detection; such divergences are reported apart
        link = [e for e in self.events if e[2] == ep['device'] and e[1] in ('zombie', 'zombie-closed', 'reconnect')]
        z = next((e for e in reversed(link) if e[0] <= ep['start']), None)
        during = any(e[1] == 'zombie' and ep['start'] < e[0] < ep['end'] for e in link)
        ep['cause'] = 'zombie' if (z and z[1] == 'zombie') or during else 'other'
        ep['zombie_since'] = round(ep['start'] - z[0], 2) if z and z[1] == 'zombie' else None
        ep['t'] = round(ep['start'] - self.t0, 2)
        self.episodes.append(ep)
        if ep['divergence']:
            print(f"  DIVERGENCE {ep['device']} {ep['color']} {ep['field']}: shown {ep['shown']} vs {ep['truth']} for {ep['duration']}s "
                  f"(store {ep['store_v']} server {ep['server_v']} truth {ep['truth_v']}; {ep['phase']} g{ep['gen']}; last {ep['events'][-1:]})", flush=True)

    def suspend(self, device, now):
        """The user cannot see this page (hidden, frozen): close its stretches without counting them."""
        for key in [k for k in self.open if k[0] == device]:
            self.open.pop(key)
        self.visible_since[device] = float('inf')

    def resume(self, device, now):
        self.visible_since[device] = now


async def sampler(run, devices, spectator_url, obs, stop):
    while not stop.is_set():
        t_loop = time.time()
        try:
            before = truth_of(await asyncio.to_thread(http_json, spectator_url))
        except Exception:
            await asyncio.sleep(run.args.every); continue

        async def read(d):
            if d['frozen'] or d.get('gone'): return d, None
            try:
                return d, await asyncio.wait_for(d['page'].evaluate(READ_JS, 'tv' if d['kind'] == 'tv' else 'phone'), 1.5)
            except Exception:
                return d, None
        results = await asyncio.gather(*(read(d) for d in devices))
        t = time.time()
        try:
            after = truth_of(await asyncio.to_thread(http_json, spectator_url))
        except Exception:
            await asyncio.sleep(run.args.every); continue
        run.samples += 1
        run.last_truth = after
        run.truth_hist.append((t_loop, before['players'])); run.truth_hist.append((t, after['players']))
        if not run.truth_log or run.truth_log[-1]['v'] != list(after['v']):
            run.truth_log.append({'t': round(t - run.t0, 2), 'v': list(after['v']), 'phase': after['phase'], 'gen': after['gen']})
        for d, r in results:
            name = d['name']
            if r is None:
                run.unreadable[name] += 1
                run.suspend(name, t)
                continue
            if r['visible'] != 'visible':
                run.suspend(name, t); continue
            if run.visible_since.get(name) == float('inf') or name not in run.visible_since:
                # a page that just loaded (or came back) is judged from --warmup seconds on
                run.resume(name, t + (run.args.warmup if name not in run.visible_since else 0))
            prev = d.get('last')
            if prev and 'frames' in prev and d.get('last_t'):
                r['fps'] = round((r['frames'] - prev['frames']) / max(0.05, t - d['last_t']), 1)
                run.fps[name].append(r['fps'])
            d['last'] = r; d['last_t'] = t
            sv = r.get('store')
            log = run.store_log.setdefault(name, [])
            if not log or log[-1][1] != sv: log.append((round(t - run.t0, 2), sv))
            run.note(name, r, before, after, t, obs)
        await asyncio.sleep(max(0.0, run.args.every - (time.time() - t_loop)))


async def freeze(page, frozen):
    """Suspend a Chromium page like iOS does when the phone sleeps: no timers, no frames, no script at all."""
    cdp = await page.context.new_cdp_session(page)
    await cdp.send('Page.setWebLifecycleState', {'state': 'frozen' if frozen else 'active'})
    await cdp.detach()


async def stress(run, devices, proxies, srv_ctl, gen_of, stop, wanted):
    """The stress schedule, by generation. Each step names the device it hits."""
    by = {d['name']: d for d in devices}
    steps = [
        (2, 'hide', 'phoneB'), (3, 'freeze', 'phoneA'), (4, 'reset', 'tv'), (5, 'zombie', 'phoneB'),
        (6, 'restart', 'server'), (7, 'zombie', 'tv'), (8, 'reset', 'phoneA'), (9, 'freeze', 'phoneB'),
        (10, 'hide', 'phoneA'), (11, 'zombie', 'phoneA'), (12, 'restart', 'server'),
    ]
    if 'webkit' in by: steps += [(3, 'hide', 'webkit'), (6, 'zombie', 'webkit'), (9, 'reset', 'webkit')]
    if wanted != 'all' and 'restarts' in wanted: steps = [(g, 'restart', 'server') for g in range(2, 16)]
    steps.sort()
    done = set()
    while not stop.is_set():
        g = gen_of()
        for i, (gen, kind, dev) in enumerate(steps):
            if i in done or g < gen or (wanted != 'all' and kind not in wanted and 'restarts' not in wanted): continue
            done.add(i)
            d = by.get(dev)
            # land mid-generation, while people are acting
            await asyncio.sleep(random.uniform(2, 6))
            if kind == 'hide' and d:
                run.log('hide', dev, '15 s'); await soak.set_visible(d['page'], False)
                await asyncio.sleep(15)
                await soak.set_visible(d['page'], True); run.log('show', dev)
            elif kind == 'freeze' and d and d['kind'] != 'webkit':
                run.log('freeze', dev, '20 s (hidden, frozen)'); await soak.set_visible(d['page'], False)
                d['frozen'] = True; await freeze(d['page'], True)
                await asyncio.sleep(20)
                await freeze(d['page'], False); d['frozen'] = False
                await soak.set_visible(d['page'], True); run.log('thaw', dev)
            elif kind == 'reset':
                proxies[dev].reset()
            elif kind == 'zombie':
                proxies[dev].zombie(run.args.zombie)
            elif kind == 'restart':
                await srv_ctl()
        await asyncio.sleep(0.5)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8941')
    ap.add_argument('--port', type=int, default=8950)
    ap.add_argument('--out', required=True)
    ap.add_argument('--every', type=float, default=0.4, help='seconds between reads')
    ap.add_argument('--lag', type=float, default=1.5, help='allowed lag, seconds: a screen may show any value the engine had this recently')
    ap.add_argument('--min-stale', type=float, default=0.5, help='a divergence is staler than the lag for longer than this (more than one read)')
    ap.add_argument('--ui-rate', type=float, default=0.12)
    ap.add_argument('--undo-rate', type=float, default=0.25, help='share of human turn menus answered with the engine\'s undo')
    ap.add_argument('--bots', default='normal')
    ap.add_argument('--bot-delay', type=float, default=0)
    ap.add_argument('--poll-ms', type=int, default=1200, help='ENGINE_POLL_MS for the server (production default 1200)')
    ap.add_argument('--stress', default='all', help='all, none, or a comma list of hide,freeze,reset,zombie,restart')
    ap.add_argument('--zombie', type=float, default=45, help='seconds a zombie connection stays silent before it closes')
    ap.add_argument('--webkit', default=None, help='Playwright run-server endpoint for a WebKit iPhone page (Docker)')
    ap.add_argument('--webkit-host', default='localhost', help='host the WebKit browser uses to reach the proxies')
    ap.add_argument('--timeout', type=int, default=1800)
    ap.add_argument('--warmup', type=float, default=4, help='seconds after a page first reads before it is judged')
    ap.add_argument('--draft', type=int, default=1)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--gpu', action='store_true', help='Chromium with the GPU (ANGLE/GL), so the pages draw at a real frame rate')
    ap.add_argument('--shots', type=int, default=0, help='screenshot every page in this generation (version tags, layout)')
    ap.add_argument('--debug-tag', action='store_true', help='open the TV with ?debug=1 and phones with ?perf=1 (version tag)')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    random.seed(args.seed)
    wanted = 'all' if args.stress == 'all' else set(args.stress.split(',')) if args.stress != 'none' else set()
    run = Run(args)
    port = args.port
    data = tempfile.mkdtemp(prefix='tm-drift-')
    env = {**os.environ, 'PORT': str(port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': str(args.poll_ms),
           'VISION_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')),
           'BOT_DELAY_SCALE': str(args.bot_delay), 'BOT_LOG': os.path.join(data, 'bots.jsonl'),
           'ENGINE_GAME_OPTIONS': json.dumps(soak.focus_options(3))}
    server_js = os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))
    srv_log = open(os.path.join(args.out, 'server.log'), 'a')

    def start_server():
        run.srv = subprocess.Popen(['node', server_js], cwd=ROOT, env=env, stdout=srv_log, stderr=subprocess.STDOUT, text=True)

    def wait_server():
        for _ in range(150):
            try: urllib.request.urlopen(f'http://localhost:{port}/api/config', timeout=1); return
            except Exception: time.sleep(0.1)
        raise RuntimeError('server did not come up')

    async def restart_server():
        run.log('restart', 'server', 'kill and start again')
        run.srv.send_signal(signal.SIGTERM)
        try: run.srv.wait(5)
        except Exception: run.srv.kill()
        await asyncio.sleep(1.0)
        start_server(); await asyncio.to_thread(wait_server)
        run.log('restarted', 'server')

    start_server(); wait_server()
    obs = Observer(port, run.log)
    run.obs = obs
    asyncio.create_task(obs.run())
    names = ['phoneA', 'phoneB', 'tv'] + (['webkit'] if args.webkit else [])
    proxies = {n: Proxy(n, port + 1 + i, port, run.log) for i, n in enumerate(names)}
    for p in proxies.values(): await p.start()
    stats = {'ui': 0, 'ui_errors': [], 'bot_rejects': [], 'undos': 0, 'undo_offers': 0, 'decisions': 0, 'pageerrors': []}
    stop = asyncio.Event()
    devices = []
    browsers = []
    t_start = time.time()
    try:
        seats = [Seat('sA', 'Ada', 'red'), Seat('sB', 'Vera', 'blue')]
        for s in seats: await s.open(port)
        host = seats[0]
        for s in seats:
            assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        for k, level in enumerate([b for b in args.bots.split(',') if b]):
            err = await host.rpc({'type': 'cmd', 'command': {'t': 'addBot', 'playerId': host.id, 'botId': f'b{k}', 'name': ['Ares', 'Deimos'][k],
                                                             'color': ['green', 'yellow'][k], 'level': level}})
            assert err is None, err
        bot_ids = [f'b{k}' for k in range(len([b for b in args.bots.split(',') if b]))]
        err = await host.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': host.id, 'modules': ['base', 'corpera'],
                                                         'order': [s.id for s in seats] + bot_ids, 'mode': 'full', 'draft': bool(args.draft)}})
        assert err is None, err
        for _ in range(100):
            if host.state and host.state.get('full'): break
            await asyncio.sleep(0.1)
        spectator_url = f"{args.engine}/api/spectator?id={host.state['full']['spectatorId']}"

        pw = await async_playwright().start()
        chromium = await pw.chromium.launch(args=['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-gpu'] if args.gpu else [])
        browsers.append(chromium)
        q_phone = '?perf=1' if args.debug_tag else ''
        q_tv = '?debug=1' if args.debug_tag else ''

        async def phone(browser, seat, name, host_name='localhost', **ctx_kw):
            ctx = await browser.new_context(**ctx_kw)
            await ctx.add_init_script(FRAMES_JS)
            await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{seat.id}')}}catch(e){{}}")
            page = await ctx.new_page()
            page.on('pageerror', lambda e, n=name: stats['pageerrors'].append(f'{n}: {e}'))
            page.on('console', lambda m, n=name: m.text.startswith('net: reconnecting') and run.log('reconnect', n, m.text[4:]))
            await page.goto(f'http://{host_name}:{proxies[name].listen}/{q_phone}')
            return page
        mobile = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        for s, name in zip(seats, ['phoneA', 'phoneB']):
            s.page = await phone(chromium, s, name, **mobile)
            devices.append({'name': name, 'kind': 'phone', 'page': s.page, 'frozen': False, 'color': s.color})
        tvctx = await chromium.new_context(viewport={'width': 1920, 'height': 1080})
        await tvctx.add_init_script(FRAMES_JS)
        tv = await tvctx.new_page()
        tv.on('pageerror', lambda e: stats['pageerrors'].append(f'tv: {e}'))
        tv.on('console', lambda m: m.text.startswith('net: reconnecting') and run.log('reconnect', 'tv', m.text[4:]))
        await tv.goto(f'http://localhost:{proxies["tv"].listen}/tv{q_tv}')
        devices.append({'name': 'tv', 'kind': 'tv', 'page': tv, 'frozen': False})
        if args.webkit:
            try:
                wk = await pw.webkit.connect(args.webkit)
                browsers.append(wk)
                iphone = {k: v for k, v in pw.devices['iPhone 13'].items() if k != 'default_browser_type'}
                page = await phone(wk, seats[0], 'webkit', host_name=args.webkit_host, **iphone)
                devices.append({'name': 'webkit', 'kind': 'webkit', 'page': page, 'frozen': False, 'color': seats[0].color})
                run.log('webkit', 'webkit', 'iPhone 13 page open (seat A)')
            except Exception as e:
                run.log('webkit-failed', 'webkit', str(e).splitlines()[0])

        gen = lambda: (run.last_truth or {}).get('gen', 0)
        tasks = [asyncio.create_task(sampler(run, devices, spectator_url, obs, stop)),
                 asyncio.create_task(stress(run, devices, proxies, restart_server, gen, stop, wanted))]

        # the game: the soak bot answers both human seats; a share goes through the phone UI; some turns are undone
        bot = soak.Bot(random.Random(args.seed))
        rng = random.Random(args.seed + 1)
        last_gen = 0; last_phase = None; last_v = None
        last_undo = 0.0
        shot = False
        while True:
            if args.shots and not shot and gen() >= args.shots:
                shot = True
                for d in devices:
                    try: await asyncio.wait_for(d['page'].screenshot(path=os.path.join(args.out, f"shot-{d['name']}.png")), 10)
                    except Exception as e: run.log('shot-failed', d['name'], str(e)[:80])
                run.log('shots', 'harness', 'every page saved')
            if time.time() - t_start > args.timeout: raise RuntimeError('timed out')
            tr = run.last_truth
            if tr and tr['phase'] == 'end': break
            if tr and (tr['gen'] != last_gen or tr['phase'] != last_phase):
                run.log('phase', 'engine', f"g{tr['gen']} {tr['phase']}"); last_gen, last_phase = tr['gen'], tr['phase']
            if tr and tr['v'] != last_v:
                run.log('move', 'engine', f"v{tr['v'][0]}.{tr['v'][1]}", quiet=True); last_v = tr['v']
            moved = False
            for s in seats:
                w = s.wf()
                if not w or w.get('optional'): continue
                model = s.model(); me = model['thisPlayer']; key = s.sig()
                before = s.sig()
                # undo: the engine offers it on the turn menu after this player's own action
                undo_i = next((i for i, o in enumerate(w.get('options') or []) if w['type'] == 'or' and soak.option_kind(o) == 'undo'), None)
                if undo_i is not None: stats['undo_offers'] += 1
                if undo_i is not None and rng.random() < args.undo_rate and time.time() - last_undo > 20:
                    last_undo = time.time()
                    err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': {'type': 'or', 'index': undo_i, 'response': {'type': 'option'}}})
                    run.log('undo', s.name, err or 'accepted'); stats['undos'] += 0 if err else 1
                else:
                    ans = bot.answer(w, me, model, key)
                    if not ans: raise RuntimeError(f'no answer for {s.name}: {w["type"]} {soak.text(w.get("title"))}')
                    resp, path = ans
                    kinds = {step[0] for step in path} | ({w['type']} if w['type'] in soak.UI_TYPES else set())
                    page_ok = not next(d for d in devices if d['page'] is s.page)['frozen']
                    via_ui = page_ok and rng.random() < args.ui_rate and not (kinds & {'and'})
                    err = None
                    if via_ui:
                        err = await soak.ui_answer(s, path, None, f'd{stats["decisions"]}-{s.name}')
                        stats['ui'] += 1
                        if err:
                            stats['ui_errors'].append(err)
                            await asyncio.sleep(0.5)
                            if s.sig() == before: err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': resp})
                            else: err = None
                    else:
                        err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': resp})
                    if err:
                        stats['bot_rejects'].append(f'{s.name}: {err}'[:200])
                        where = (); r = resp
                        while r.get('type') == 'or': where += (r['index'],); r = r['response']
                        if r.get('type') == 'projectCard': where += ('card', r['card'])
                        if r.get('type') == 'card' and r.get('cards'): where += ('card', r['cards'][0])
                        bot.failed.add((key, where))
                for _ in range(40):
                    if s.sig() != before: break
                    await asyncio.sleep(0.05)
                stats['decisions'] += 1; moved = True
                break
            if not moved: await asyncio.sleep(0.05)
        run.log('end', 'engine', 'game over; settling 6 s')
        await asyncio.sleep(6)
        stop.set()
        for t in tasks: t.cancel()
    finally:
        stop.set()
        for key in list(run.open): run.close(key, time.time())
        obs.closed = True
        for s in locals().get('seats', []):
            s.closed = True
            try: await s.ws.close()
            except Exception: pass
        for b in browsers:
            try: await b.close()
            except Exception: pass
        for p in proxies.values(): p.close()
        if run.srv:
            run.srv.terminate()
            try: run.srv.wait(5)
            except Exception: run.srv.kill()
        srv_log.close()
        report(run, stats, args, time.time() - t_start)


def pct(xs, q):
    if not xs: return None
    xs = sorted(xs); return xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))]


def report(run, stats, args, secs):
    div = [e for e in run.episodes if e['divergence']]
    durs = [e['duration'] for e in div]
    by = lambda k: dict(collections.Counter(e[k] for e in div).most_common())
    # one divergence "incident" per device and start second, however many fields were off together
    incidents = collections.OrderedDict()
    for e in sorted(div, key=lambda e: e['start']):
        k = (e['device'], round(e['start']))
        incidents.setdefault(k, []).append(e)
    summary = {
        'seconds': round(secs), 'samples': run.samples, 'generations': (run.last_truth or {}).get('gen'), 'final_phase': (run.last_truth or {}).get('phase'),
        'lag_allowed_s': args.lag, 'off_stretches': len(run.episodes),
        'action_hold_reads': run.held_reads, 'action_hold_max_left_s': round(run.held_max, 2),
        'divergences': len(div), 'incidents': len(incidents),
        'divergences_outside_zombie': sum(1 for e in div if e['cause'] != 'zombie'),
        'zombie_bound': {'n': sum(1 for e in div if e['cause'] == 'zombie'), 'max_s': max([e['unexcused'] for e in div if e['cause'] == 'zombie'], default=0)},
        'max_unexcused_s': max([e['unexcused'] for e in div], default=0),
        'reconnects': dict(collections.Counter(e[2] for e in run.events if e[1] == 'reconnect')),
        'max_s': max(durs) if durs else 0, 'p95_s': pct(durs, 0.95) or 0, 'median_s': pct(durs, 0.5) or 0,
        'by_device': by('device'), 'by_field': by('field'),
        'by_kind': dict(collections.Counter(e['kind'] for e in div)),
        'fps_p50': {k: pct(v, 0.5) for k, v in run.fps.items()}, 'fps_p10': {k: pct(v, 0.1) for k, v in run.fps.items()},
        'definition': f'stale = the value on screen is none the engine had in the last {args.lag} s (a rolling odometer counts by its target); '
                      f'divergence = stale for more than {args.min_stale} s, outside production-show holds; durations are time beyond the lag',
        'by_last_event': dict(collections.Counter((e['events'][-1][1] if e['events'] else 'none') for e in div).most_common()),
        'store_behind_truth': sum(1 for e in div if e['store_v'] and tuple(e['store_v']) != tuple(e['truth_v'])),
        'store_matches_truth_dom_wrong': sum(1 for e in div if e['store_v'] and tuple(e['store_v']) == tuple(e['truth_v'])),
        'unreadable_reads': dict(run.unreadable), 'stats': {k: v for k, v in stats.items() if k != 'pageerrors'}, 'pageerrors': stats['pageerrors'][:20],
        'shows': len(run.obs.shows), 'server_pushes_seen': run.obs.pushes,
    }
    # how long after the server first sent a version each screen's store showed it (0.4 s sampling; shown versions only)
    first = {}
    for t, v in run.obs.push_log: first.setdefault(tuple(v), t)
    lat = {}
    for dev, log in run.store_log.items():
        xs = sorted(round(t + run.t0 - first[tuple(v)], 2) for t, v in log if v and tuple(v) in first)
        if xs: lat[dev] = {'n': len(xs), 'p50': pct(xs, 0.5), 'p95': pct(xs, 0.95), 'max': xs[-1]}
    summary['push_to_store_s'] = lat
    per_s = collections.Counter(int(t) for t, _ in run.obs.push_log)
    summary['max_pushes_per_s'] = max(per_s.values(), default=0)
    out = {'summary': summary, 'incidents': [{'device': k[0], 't': round(k[1] - run.t0, 1), 'fields': [f"{e['color']}.{e['field']}" for e in v],
                                              'max_s': max(e['duration'] for e in v), 'store_v': v[0]['store_v'], 'server_v': v[0]['server_v'],
                                              'truth_v': v[0]['truth_v'], 'phase': v[0]['phase'], 'gen': v[0]['gen'], 'events': v[0]['events'],
                                              'connected': v[0]['connected'], 'moving': v[0]['moving'], 'cause': v[0]['cause'],
                                              'unexcused_s': max(e['unexcused'] for e in v)} for k, v in incidents.items()],
           'divergences': div, 'events': [(round(t - run.t0, 2), k, d, x) for t, k, d, x in run.events if k != 'heartbeat'],
           'truth_versions': run.truth_log[-400:],
           'store_versions': run.store_log, 'server_pushes': [(round(t - run.t0, 2), v) for t, v in run.obs.push_log],
           'short_stretches': collections.Counter(round(e['duration'], 1) for e in run.episodes if not e['divergence']).most_common(12)}
    with open(os.path.join(args.out, 'drift.json'), 'w') as f: json.dump(out, f, indent=1, default=str)
    print(json.dumps(summary, indent=1, default=str))
    for i in out['incidents'][:40]: print('  INCIDENT', json.dumps(i, default=str)[:400])


if __name__ == '__main__':
    asyncio.run(main())
