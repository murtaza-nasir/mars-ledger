"""What the TV says was played, against what the engine says was played.

    engine: docker run -d --rm --name tvm-engine -p 9801:8080 -e PORT=8080 tm-engine:41a1b005de73
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/tv_moments.py --engine http://localhost:9801 --port 9802 --out DIR

Seats: Juno and Orin (people, answered over their sockets the way their phones answer: a card played from the hand is
flicked to the TV first, a person thinks for a moment before each answer, and now and then backs out of a card's
follow-up question with "Choose something else"), and two Normal bots at Quick. A TV page (1920x1080) records every card
it puts on screen: the move pipeline's card stage (data-card-stage, the caption names the player), the flick layer (the
card thrown from a phone) and card-action panels. At the end the engine's log gives what was really played ("X played
Y"). Every card on the TV must be one that player played, shown once.

Output: moments.json (TV records, engine plays, verdict) in --out.
"""
import argparse, asyncio, json, os, random, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = soak.ROOT
GPU = ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-gpu']

# Polls the TV every 40 ms and records each card it puts on screen once, with the text naming the player.
RECORDER = r'''
(() => {
  const seen = new WeakMap();
  window.__rec = [];
  window.__recStart = Date.now();
  window.__recFlicks = new Set();
  const note = (el, kind, read) => {
    const r = read();
    if (!r) return;
    const prev = seen.get(el);
    if (prev) {
      if (!prev.who && r.who) prev.who = r.who;
      // the caption changes as a flick is confirmed ("plays") or refused ("Not played"): keep each step with its time
      const last = prev.steps[prev.steps.length - 1];
      if (r.caption && r.caption !== last[1]) prev.steps.push([Date.now(), r.caption]);
      prev.caption = r.caption || prev.caption;
      return;
    }
    const x = {kind, t: Date.now(), ...r, steps: [[Date.now(), r.caption]]};
    seen.set(el, x);
    window.__rec.push(x);
  };
  setInterval(() => {
    for (const el of document.querySelectorAll('[data-card-stage]')) {
      note(el, 'stage', () => ({card: el.getAttribute('data-card-stage'), who: (el.getAttribute('data-moment-color') || ''), key: el.getAttribute('data-moment-key') || '',
        caption: (el.querySelector('.cond') || {}).textContent || ''}));
    }
    for (const el of document.querySelectorAll('[data-action-moment]')) {
      note(el, 'action', () => ({card: el.getAttribute('data-action-moment'), who: el.getAttribute('data-moment-color') || '', caption: (el.textContent || '').slice(0, 80)}));
    }
    for (const el of document.querySelectorAll('[data-flick-card]')) {
      note(el, 'flick', () => ({card: el.getAttribute('data-flick-card'), who: el.getAttribute('data-moment-color') || '', sent: +(el.getAttribute('data-flick-at') || 0) || null,
        caption: 'phase:' + (el.getAttribute('data-flick-phase') || '')}));
    }
    // builds without the data-flick-card hook: the flick layer is the fixed layer at z-index 70; it shows the flicks in
    // arrival order, one at a time, so a new card there is the oldest flick not yet shown
    const hooked = !!document.querySelector('[data-flick-card]') || window.__recHooked;
    if (hooked) window.__recHooked = true;
    for (const layer of hooked ? [] : document.querySelectorAll('div[aria-hidden="true"], div[aria-hidden]')) {
      if (layer.style.zIndex !== '70' || layer.style.position !== 'fixed') continue;
      for (const el of layer.children) {
        if (el.querySelector('[data-flick-card]')) continue;
        if (seen.has(el)) { note(el, 'flick', () => ({caption: (el.textContent || '').slice(0, 200)})); continue; }
        const txt = el.textContent || '';
        if (!/(is playing|plays|Not played)/.test(txt)) continue;
        const flicks = (window.__net && window.__net.getState().flicks) || [];
        const f = flicks.find((x) => x.at >= window.__recStart - 500 && !window.__recFlicks.has(x.id));
        if (f) window.__recFlicks.add(f.id);
        note(el, 'flick', () => ({card: f ? f.card : '', who: f ? f.color : '', sent: f ? f.at : null, caption: txt.slice(0, 200)}));
      }
    }
  }, 40);
})();
'''


def engine_plays(engine, spectator_id, generations):
    """The engine's 'X played Y' lines of every generation, in order: [(color, card)]."""
    lines = []
    for g in range(1, generations + 1):
        with urllib.request.urlopen(f'{engine}/api/game/logs?id={spectator_id}&generation={g}') as f:
            lines += json.loads(f.read())
    out = []
    for l in lines:
        if l.get('message') != '${0} played ${1}': continue
        d = l.get('data', [])
        if len(d) < 2: continue
        out.append((d[0].get('value'), d[1].get('value'), l.get('timestamp')))
    return out, lines


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:9801')
    ap.add_argument('--port', type=int, default=9802)
    ap.add_argument('--out', required=True)
    ap.add_argument('--generations', type=int, default=6)
    ap.add_argument('--minutes', type=float, default=12)
    ap.add_argument('--back-rate', type=float, default=0.35)
    ap.add_argument('--seed', type=int, default=11)
    ap.add_argument('--linger', type=float, default=0, help='keep the server up this many seconds after the check (for screenshots)')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    data = tempfile.mkdtemp(prefix='tm-tvm-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400',
           'VISION_ENABLED': 'false', 'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')),
           'ENGINE_GAME_OPTIONS': '{}'}
    log = open(os.path.join(args.out, 'server.log'), 'w')
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    rng = random.Random(args.seed)
    bot = soak.Bot(random.Random(args.seed + 1))
    report = {'notes': [], 'backs': 0, 'flicks': 0}
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        juno, orin = soak.Seat('juno', 'Juno', 'blue'), soak.Seat('orin', 'Orin', 'red')
        people = [juno, orin]
        for s in people: await s.open(args.port)
        for s in people: assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        for bid, name, color in [('x1', 'Ares', 'green'), ('x2', 'Deimos', 'yellow')]:
            assert (await orin.rpc({'type': 'cmd', 'command': {'t': 'addBot', 'playerId': orin.id, 'botId': bid, 'name': name, 'color': color, 'level': 'normal'}})) is None
        assert (await orin.rpc({'type': 'cmd', 'command': {'t': 'setBotSpeed', 'playerId': orin.id, 'speed': 'quick'}})) is None
        err = (await orin.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': orin.id, 'modules': ['base', 'corpera'], 'order': ['orin', 'x1', 'juno', 'x2'], 'mode': 'full', 'draft': False}}))
        assert err is None, err
        names = {'blue': 'Juno', 'red': 'Orin', 'green': 'Ares', 'yellow': 'Deimos'}

        async with async_playwright() as pw:
            br = await pw.chromium.launch(args=GPU)
            tvctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
            await tvctx.add_init_script(RECORDER)
            tv = await tvctx.new_page(); tv.on('pageerror', lambda e: report['notes'].append(f'pageerror TV: {e}'))
            await tv.goto(f'http://localhost:{args.port}/tv')

            def is_play(r):
                while r and r.get('type') == 'or': r = r.get('response')
                return r.get('card') if r and r.get('type') == 'projectCard' else None

            t0 = time.time()
            busy = {s.id: False for s in people}

            async def person(s):
                """One person's phone: think, flick a played card, answer; sometimes back out of a follow-up."""
                while time.time() - t0 < args.minutes * 60:
                    m = s.any_model()
                    if m and (m['game']['phase'] == 'end' or m['game']['generation'] > args.generations): return
                    w = s.wf()
                    if not w:
                        await asyncio.sleep(0.1); continue
                    ans = bot.answer(w, s.model()['thisPlayer'], s.model(), s.sig())
                    if not ans: report['notes'].append(f'no answer for {s.name}'); await asyncio.sleep(0.5); continue
                    await asyncio.sleep(rng.uniform(0.4, 2.2))
                    if s.wf() != w: continue
                    card = is_play(ans[0])
                    # the phone flicks cards from the hand only (standard projects are not flicked)
                    if card and soak.CARDS.get(card, {}).get('group') != 'project': card = None
                    fid = None
                    if card:
                        fid = f'fl-{s.id}-{s.n}-{rng.randrange(1 << 30)}'
                        await s.ws.send(json.dumps({'type': 'flick', 'flick': {'id': fid, 'playerId': s.id, 'card': card}}))
                        report['flicks'] += 1
                    before = s.sig()
                    err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': ans[0]})
                    if err:
                        if fid: await s.ws.send(json.dumps({'type': 'flickCancel', 'id': fid, 'playerId': s.id}))
                        r = ans[0]; where = ()
                        while r.get('type') == 'or': where += (r['index'],); r = r['response']
                        if r.get('type') == 'projectCard': where += ('card', r['card'])
                        if r.get('type') == 'card' and r.get('cards'): where += ('card', r['cards'][0])
                        bot.failed.add((before, where))
                        continue
                    for _ in range(60):
                        if s.sig() != before: break
                        await asyncio.sleep(0.05)
                    # "Choose something else": a card whose follow-up question is open, taken back after a moment
                    if card and (s.view or {}).get('back', {}) and (s.view.get('back') or {}).get('ok') and rng.random() < args.back_rate:
                        await asyncio.sleep(rng.uniform(0.8, 2.5))
                        err = await s.rpc({'type': 'rewind', 'playerId': s.id, 'what': 'back'})
                        if not err:
                            report['backs'] += 1
                            await s.ws.send(json.dumps({'type': 'flickCancel', 'id': fid, 'playerId': s.id}))
                            # the bot would choose the same again: make it pick something else this time
                            bot.failed.add((s.sig(), ('card', card)))
                        else: report['notes'].append(f'back refused: {err}')
                        for _ in range(60):
                            if s.wf() and not (s.view or {}).get('back'): break
                            await asyncio.sleep(0.05)

            await asyncio.gather(*(person(s) for s in people))
            await asyncio.sleep(8)  # the TV's queue drains
            rec = await tv.evaluate('() => window.__rec.map(({el, ...x}) => x)')
            await tv.screenshot(path=os.path.join(args.out, 'tv-end.png'))
            spectator = juno.state['full']['spectatorId']
            plays, lines = engine_plays(args.engine, spectator, (juno.any_model() or {'game': {'generation': 1}})['game']['generation'])
            report['pipeline'] = await tv.evaluate('() => window.__pipeline || []')
            report['skipped'] = await tv.evaluate('() => window.__momentsSkipped || 0')
            await br.close()

        verdict = judge(rec, plays, names)
        report.update({'tv': rec, 'plays': plays, 'verdict': verdict, 'generation': (juno.any_model() or {}).get('game', {}).get('generation')})
        json.dump(report, open(os.path.join(args.out, 'moments.json'), 'w'), indent=1)
        print(json.dumps({k: v for k, v in verdict.items() if k != 'rows'}, indent=1))
        for r in verdict['rows']:
            if r['ok'] is not True: print(r)
        if args.linger:
            print(f'LINGER {args.port}', flush=True)
            await asyncio.sleep(args.linger)
    finally:
        srv.terminate()


LATE_S = 30


def judge(rec, plays, names):
    """Each card the TV puts up as played must be a play of that card by that player that happened in the last LATE_S
    seconds (a card from minutes ago, or another player's, is what the table sees as "the wrong card"). Each play counts
    once. A flick that ends "Not played" (a refused play, or one taken back with Back) is fine."""
    by_name = {v: k for k, v in names.items()}
    unused = [list(p) + [False] for p in plays]  # color, card, ts, used
    rows = []
    shown = [r for r in rec if r['kind'] in ('stage', 'flick')]
    for r in sorted(shown, key=lambda x: x['t']):
        who = r.get('who') or ''
        card = r.get('card') or ''
        cap = r.get('caption') or ''
        if not who:
            who = next((by_name[n] for n in sorted(by_name, key=len, reverse=True)
                        if any(f'{n}{w}' in cap or f'{n} {w}' in cap for w in ('is playing', 'plays', 'Not played', 'played'))), '')
        cancelled = any('Not played' in (c or '') or c == 'phase:cancel' for _, c in r.get('steps', [])) or 'Not played' in cap
        row = {'kind': r['kind'], 'card': card, 'who': who, 't': r['t'], 'lag': round((r['t'] - r['sent']) / 1000, 1) if r.get('sent') else None}
        if cancelled:
            row['ok'] = 'cancelled'; rows.append(row); continue
        # a card moment that a cinematic interrupted starts again (the same moment: data-moment-key, or the same card
        # and player moments apart)
        prev = next((x for x in reversed(rows) if x['kind'] == 'stage' and x['card'] == card and x['who'] == who), None)
        if r['kind'] == 'stage' and prev and ((r.get('key') and r.get('key') == prev.get('key')) or (not r.get('key') and r['t'] - prev['t'] < 20000)):
            row['ok'] = 'restart'; row['key'] = r.get('key'); rows.append(row); continue
        row['key'] = r.get('key')
        def find(pred):
            return next((p for p in unused if not p[3] and p[1] == card and pred(p)), None)
        hit = find(lambda p: p[0] == who and p[2] is not None and -3000 <= r['t'] - p[2] <= LATE_S * 1000)
        if hit:
            hit[3] = True; row['ok'] = True; row['since_play_s'] = round((r['t'] - hit[2]) / 1000, 1)
        elif (other := find(lambda p: p[0] != who)):
            other[3] = True; row['ok'] = f'wrong player (played by {other[0]})'
        elif (late := find(lambda p: p[0] == who)):
            late[3] = True; row['ok'] = 'late'; row['since_play_s'] = round((r['t'] - late[2]) / 1000, 1)
        elif any(p[1] == card and p[0] == who for p in plays):
            row['ok'] = 'duplicate'
        else:
            row['ok'] = 'never played'
        rows.append(row)
    left = [(p[0], p[1]) for p in unused if not p[3] and soak.CARDS.get(p[1], {}).get('group') not in ('corporation', 'prelude')]
    wrong = [r for r in rows if r['ok'] not in (True, 'cancelled', 'restart')]
    lags = sorted(r['since_play_s'] for r in rows if r.get('since_play_s') is not None)
    flick = sorted(r['lag'] for r in rows if r.get('lag') is not None)
    played = len([p for p in plays if soak.CARDS.get(p[1], {}).get('group') not in ('corporation', 'prelude')])
    return {'played': played, 'shown_as_played': len([r for r in rows if r['ok'] not in ('cancelled', 'restart')]), 'wrong': len(wrong),
            'wrong_rate': round(len(wrong) / max(1, len([r for r in rows if r['ok'] not in ('cancelled', 'restart')])), 3),
            'kinds': {k: sum(1 for r in wrong if r['ok'] == k) for k in {r['ok'] for r in wrong}},
            'not_shown': len(left), 'not_shown_cards': left,
            'since_play_s': {'median': lags[len(lags) // 2] if lags else None, 'max': lags[-1] if lags else None},
            'flick_lag_s': {'median': flick[len(flick) // 2] if flick else None, 'max': flick[-1] if flick else None, 'n': len(flick)},
            'rows': rows}


if __name__ == '__main__':
    asyncio.run(main())
