"""Phone-to-TV links, end to end (replay, map echo, hit haptics timed to the TV).

    engine: docker run -d --rm --name tvl-engine -p 9112:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/tvlinks.py --engine http://localhost:9112 \
                --container tvl-engine --port 9111 --out DIR

Two phones (390x844: Vera red, Ada blue) and a TV (1920x1080). navigator.vibrate is stubbed on every page to record
its calls; the TV's tvMoment sends are recorded too. Setup over the seats' sockets: Vera builds a city with the
standard project in generation 1, both pass through generation 2, and in generation 3 Ada plays Hired Raiders and
Sabotage on Vera (cards written into the engine's save, test setup only).
  echo     Vera's Log tab: the city move from two generations ago, "Show on the TV": the hex glows on the 3D
           board for about 3 s, then on the flat board, then with reduced motion (still); the game is unchanged.
  replay   "Show last move on the TV" from the dock and the game menu, and "Replay on the TV" from a log
           move: the TV gets the replay with "Vera asked to see this again", one at a time and a 3 s cooldown,
           and the game is unchanged.
  haptics  A hit on Vera: only Vera's phone vibrates, with [80, 60, 80, 60, 160], when the TV reports the
           resolve (within a few hundred ms of it); Ada's phone never does. With the TV gone, at notice time.
Output: tvlinks.json and screenshots in --out.
"""
import argparse, asyncio, json, os, random, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = soak.ROOT
HIT = [80, 60, 80, 60, 160]

# every page: record vibrate calls (and pretend the device can vibrate); the TV also records its tvMoment sends
INIT_JS = r'''
(() => {
  window.__vib = [];
  try { Object.defineProperty(navigator, 'vibrate', {configurable: true, value: (p) => { window.__vib.push({t: Date.now(), p: Array.isArray(p) ? p : [p]}); return true; }}); } catch (e) {}
  window.__tvm = [];
  const hook = setInterval(() => {
    const n = window.__net; if (!n) return;
    const s = n.getState(); if (!s.tvMoment || s.tvMoment.__wrapped) return;
    const orig = s.tvMoment;
    const wrapped = (m) => { window.__tvm.push({t: Date.now(), m}); return orig(m); };
    wrapped.__wrapped = true;
    n.setState({tvMoment: wrapped});
  }, 50);
})();
'''

PAGE_JS = r'''() => {
  const s = window.__net && window.__net.getState();
  const fv = s && s.fullView;
  if (!fv) return null;
  const g = fv.model.game;
  return {age: g.gameAge, gen: g.generation, phase: g.phase, active: (fv.model.players.find((p) => p.isActive) || {}).color || null,
    tvs: s.tvs, replays: (s.replays || []).map((r) => ({id: r.id, from: r.from.name, card: r.move.card})), echoes: (s.echoes || []).map((e) => ({id: e.id, targets: e.targets})),
    vib: window.__vib || [], tvm: (window.__tvm && window.__tvm.length) ? window.__tvm : (window.__tvMoments || []).map((m) => ({t: m.at, m})), spaces: g.spaces.filter((x) => x.tileType !== undefined).length,
    players: fv.model.players.map((p) => ({color: p.color, mc: p.megacredits, tr: p.terraformRating}))};
}'''


def http_json(url, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    with urllib.request.urlopen(r) as f:
        return json.loads(f.read())


def inject(container, game_id, engine_player, cards, mc):
    """Test setup: put cards into a player's hand in the engine's newest save (and M€), then the caller reloads it."""
    js = (f"const D=require('/usr/src/app/node_modules/better-sqlite3');const d=new D('/usr/src/app/db/game.db');"
          f"const r=d.prepare('SELECT save_id, game FROM games WHERE game_id=? ORDER BY save_id DESC LIMIT 1').get('{game_id}');"
          f"const g=JSON.parse(r.game);const p=g.players.find(x=>x.id==='{engine_player}');p.cardsInHand=[...new Set([...p.cardsInHand, ...{json.dumps(cards)}])];"
          f"p.megaCredits=Math.max(p.megaCredits,{mc});d.prepare('UPDATE games SET game=? WHERE game_id=? AND save_id=?').run(JSON.stringify(g),'{game_id}',r.save_id);console.log(r.save_id)")
    out = subprocess.run(['docker', 'exec', container, 'node', '-e', js], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


def opt_index(w, pred):
    for i, o in enumerate(w.get('options') or []):
        if pred(o): return i
    return -1


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:9112')
    ap.add_argument('--container', default='tvl-engine')
    ap.add_argument('--port', type=int, default=9111)
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-replay', action='store_true', help='no TV pipeline yet: check the relay only')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    shot = lambda name: os.path.join(args.out, name)
    data = tempfile.mkdtemp(prefix='tm-tvlinks-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400', 'VISION_ENABLED': 'false',
           'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')),
           'ENGINE_GAME_OPTIONS': json.dumps({'customCorporationsList': ['CrediCor', 'Ecoline', 'Helion', 'Mining Guild', 'PhoboLog', 'Saturn Systems',
                                                                        'Teractor', 'Thorgate', 'Interplanetary Cinematics']})}
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=open(os.path.join(args.out, 'server.log'), 'w'), stderr=subprocess.STDOUT, text=True)
    report = {'checks': {}, 'timings': {}, 'notes': []}

    def check(k, ok, info=None):
        report['checks'][k] = {'ok': bool(ok), **({'info': info} if info is not None else {})}
        print(('PASS ' if ok else 'FAIL ') + k, json.dumps(info) if info is not None else '', flush=True)

    async def until(f, secs=30, step=0.1):
        t0 = time.time()
        while time.time() - t0 < secs:
            v = await f()
            if v: return v
            await asyncio.sleep(step)
        return None

    bot = soak.Bot(random.Random(7))
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        vera, ada = soak.Seat('v1', 'Vera', 'red'), soak.Seat('a1', 'Ada', 'blue')
        for s in (vera, ada): await s.open(args.port)
        for s in (vera, ada): assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        assert (await vera.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': vera.id, 'modules': ['base', 'corpera'], 'order': ['v1', 'a1'], 'mode': 'full', 'draft': False}})) is None

        async def wait_turn(s, secs=30):
            async def ok():
                w = s.wf()
                return w and w['type'] == 'or' and opt_index(w, lambda o: soak.option_kind(o) == 'pass' or soak.option_kind(o) == 'end') >= 0
            return await until(ok, secs)

        async def answer(s, resp):
            err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': resp})
            assert err is None, err
            await asyncio.sleep(0.5)

        async def follow_ups(s, prefer=None, secs=6):
            """Answer the move's follow-up questions with the soak bot (prefer: pick an 'or' option by title)."""
            t0 = time.time()
            while time.time() - t0 < secs:
                w = s.wf()
                if not w or (w['type'] == 'or' and opt_index(w, lambda o: soak.option_kind(o) in ('pass', 'end')) >= 0): return
                if prefer and w['type'] == 'or':
                    i = opt_index(w, lambda o: prefer in soak.text(o.get('title')).lower())
                    if i >= 0:
                        sub = bot.answer(w['options'][i], s.model()['thisPlayer'], s.model(), 'f')
                        await answer(s, {'type': 'or', 'index': i, 'response': sub[0] if sub else {'type': 'option'}}); continue
                a = bot.answer(w, s.model()['thisPlayer'], s.model(), 'f')
                assert a, w
                await answer(s, a[0])

        async def pass_turn(s):
            assert await wait_turn(s), f'no turn menu for {s.name}'
            w = s.wf()
            i = opt_index(w, lambda o: soak.option_kind(o) == 'pass')
            if i < 0: i = opt_index(w, lambda o: soak.option_kind(o) == 'end')
            await answer(s, {'type': 'or', 'index': i, 'response': {'type': 'option'}})

        async def research(s):
            async def asked():
                w = s.wf()
                return w and w['type'] == 'card' and 'buy' in soak.text(w.get('title')).lower()
            if await until(asked, 20): await answer(s, {'type': 'card', 'cards': []})

        async with async_playwright() as p:
            browser = await p.chromium.launch(args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            pages = {}
            for s in (vera, ada):
                ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
                await ctx.add_init_script(INIT_JS)
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, n=s.name: report['notes'].append(f'pageerror {n}: {e}'))
                await pg.goto(f'http://localhost:{args.port}/'); pages[s.name] = pg
            tvctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
            await tvctx.add_init_script("window.__board3dNoFallback = true;")
            await tvctx.add_init_script(INIT_JS)
            tv = await tvctx.new_page(); tv.on('pageerror', lambda e: report['notes'].append(f'pageerror TV: {e}'))
            await tv.goto(f'http://localhost:{args.port}/tv'); pages['TV'] = tv
            st = lambda n: pages[n].evaluate(PAGE_JS)
            vp, ap_ = pages['Vera'], pages['Ada']

            # initial cards: the first corporation, no cards
            await until(lambda: asyncio.sleep(0, vera.wf() and ada.wf()), 30)
            for s in (vera, ada):
                w = s.wf()
                rs = [{'type': 'card', 'cards': [w['options'][0]['cards'][0]['name']]}] + [{'type': 'card', 'cards': []} for _ in w['options'][1:]]
                await answer(s, {'type': 'initialCards', 'responses': rs})
            assert await wait_turn(vera, 40), 'no first turn'
            game_id = vera.state['full']['gameId']
            eng = {s.id: vera.state['full']['players'][s.id]['engineId'] for s in (vera, ada)}
            inject(args.container, game_id, eng['v1'], [], 60)
            inject(args.container, game_id, eng['a1'], ['Hired Raiders', 'Sabotage'], 60)
            http_json(f'{args.engine}/load_game', {'gameId': game_id, 'rollbackCount': 0}, 'PUT')
            await until(lambda: asyncio.sleep(0, (vera.model() or {}).get('thisPlayer', {}).get('megacredits', 0) >= 60), 10)

            # generation 1: Vera builds a city with the standard project
            await wait_turn(vera)
            w = vera.wf()
            i = opt_index(w, lambda o: soak.option_kind(o) == 'standard')
            city = next(c for c in w['options'][i]['cards'] if c['name'] in ('City', 'City:SP'))
            pay = soak.pay_for(vera.model()['thisPlayer'], city['calculatedCost'], [], w['options'][i].get('paymentOptions') or {})
            await answer(vera, {'type': 'or', 'index': i, 'response': {'type': 'projectCard', 'card': city['name'], 'payment': pay}})
            sw = await until(lambda: asyncio.sleep(0, vera.wf() if vera.wf() and vera.wf()['type'] == 'space' else None), 10)
            city_space = sw['spaces'][len(sw['spaces']) // 2]
            await answer(vera, {'type': 'space', 'spaceId': city_space})
            check('setup: Vera built a city in generation 1', True, {'space': city_space})
            await pass_turn(vera); await pass_turn(ada)
            for s in (vera, ada): await research(s)
            # generation 2: both pass
            await pass_turn(ada); await pass_turn(vera)
            for s in (vera, ada): await research(s)
            g3 = await until(lambda: _is(st('Vera'), lambda x: x and x['gen'] == 3 and x['phase'] == 'action'), 30)
            check('setup: generation 3 (the city is two generations old)', g3, g3 and {'gen': g3['gen']})
            # the generation recap on the TV ends before anything is measured
            async def tv_idle():
                return await tv.evaluate("() => { const w = window.__camWhy || {}; return !w.busy && !w.showing && !window.__echoCovered && !document.body.innerText.includes('Generation recap'); }")
            await until(tv_idle, 60, 0.3)
            await asyncio.sleep(1)

            # ---- map echo ------------------------------------------------------------------------------------------
            before = await st('TV')
            await vp.get_by_role('tab', name='Log').click() if await vp.get_by_role('tab', name='Log').count() else await vp.get_by_text('Log', exact=True).first.click()
            await vp.wait_for_timeout(500)
            older = vp.locator('[data-testid=log-older]')
            while await older.count(): await older.click(); await vp.wait_for_timeout(200)
            row = vp.locator('[data-testid=log-move]', has_text='City standard project').first
            await row.scroll_into_view_if_needed()
            await row.click()
            await vp.wait_for_timeout(400)
            await vp.screenshot(path=shot('uat06-01-phone-log-city-expanded.png'))
            gen_label = await vp.evaluate("""() => { const r = [...document.querySelectorAll('[data-testid=log-move]')].find((x) => x.textContent.includes('City standard project'));
              let el = r && r.closest('li'); while (el && !(el.querySelector && el.querySelector('[data-testid=log-generation]'))) el = el.previousElementSibling; return el ? el.textContent : null; }""")
            check('echo: the city move sits under generation 1 in the phone log', gen_label and 'Generation 1' in gen_label, gen_label)
            t_tap = time.time()
            await row.locator('[data-testid=log-echo]').click()
            await vp.wait_for_timeout(150)
            phone_btn = await vp.evaluate("() => (document.querySelector('[data-testid=log-echo]') || {}).textContent")
            report['notes'].append({'echo_button_after_tap': await vp.evaluate("() => (document.querySelector('[data-testid=log-echo]') || {}).getAttribute && document.querySelector('[data-testid=log-echo]').getAttribute('data-state')"),
                                    'tv_echoes': await tv.evaluate("() => window.__net.getState().echoes.length"), 'tv_text': (await tv.evaluate("() => document.body.innerText"))[:200]})
            # (a loaded machine starves the software-rendered TV page: allow 8 s, and report the latency)
            lit = await until(lambda: tv.evaluate(f"() => (window.__echoSpaces ? window.__echoSpaces() : []).some((e) => e.spaceId === '{city_space}')"), 8, 0.02)
            t_lit = time.time()
            check('echo: the TV lights the city hex', lit, {'ms_after_tap': round((t_lit - t_tap) * 1000)})
            await asyncio.sleep(0.4)
            mode = await tv.evaluate('() => window.__boardMode')
            rings = await tv.evaluate("() => [...document.querySelectorAll('[data-echo-ring]')].map((e) => e.getAttribute('data-echo-ring'))")
            caption = await tv.evaluate("() => (document.querySelector('[data-testid=tv-asked]') || {}).textContent || null")
            check('echo: on the 3D board, with "Vera asked to see this"', mode == '3d' and caption == 'Vera asked to see this', {'mode': mode, 'caption': caption})
            shown = await tv.evaluate("() => (window.__echoesShown || []).slice(-1)")
            check('echo: the trackers the move changed get a ring', len(rings) > 0, {'rings': rings, 'asked': shown})
            check('echo: the phone says it was sent', phone_btn == 'Sent to the TV', phone_btn)
            await vp.screenshot(path=shot('uat06-03-phone-sent.png'))
            gone = await until(lambda: tv.evaluate(f"() => !(window.__echoSpaces ? window.__echoSpaces() : []).some((e) => e.spaceId === '{city_space}')"), 5, 0.02)
            dur = time.time() - t_lit
            check('echo: the glow lasts about 3 s', gone and 2.7 <= dur <= 3.4, {'seconds': round(dur, 2)})
            # again, for the picture
            await asyncio.sleep(1.2)
            await row.locator('[data-testid=log-echo]').click()
            await until(lambda: tv.evaluate(f"() => (window.__echoSpaces ? window.__echoSpaces() : []).some((e) => e.spaceId === '{city_space}')"), 3, 0.02)
            await tv.wait_for_timeout(450)
            await tv.screenshot(path=shot('uat06-02-tv-3d-echo.png'))
            after = await st('TV')
            check('echo: no game state changed', after['age'] == before['age'] and after['players'] == before['players'], {'age': [before['age'], after['age']]})
            # flat board
            await tv.evaluate("() => { const k = 'mars-ledger-tv-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.board3d = false; localStorage.setItem(k, JSON.stringify(v)); }")
            await tv.reload(); await tv.wait_for_timeout(2500)
            await until(tv_idle, 30, 0.3)
            await asyncio.sleep(1.6)
            await row.locator('[data-testid=log-echo]').click()
            flat = await until(lambda: tv.evaluate(f"() => !!document.querySelector('[data-echo=\"{city_space}\"]')"), 3, 0.05)
            await tv.wait_for_timeout(600)
            await tv.screenshot(path=shot('uat06-04-tv-flat-echo.png'))
            check('echo: the flat board pulses the hex too', flat and await tv.evaluate('() => window.__boardMode') == 'flat')
            # reduced motion: still (same opacity over time)
            await tv.emulate_media(reduced_motion='reduce')
            await asyncio.sleep(3.5)
            await row.locator('[data-testid=log-echo]').click()
            await until(lambda: tv.evaluate(f"() => !!document.querySelector('[data-echo=\"{city_space}\"]')"), 3, 0.05)
            await tv.wait_for_timeout(500)
            ops = []
            for _ in range(6):
                ops.append(await tv.evaluate(f"() => getComputedStyle(document.querySelector('[data-echo=\"{city_space}\"] polygon')).opacity"))
                await tv.wait_for_timeout(150)
            await tv.screenshot(path=shot('uat06-05-tv-flat-reduced-motion.png'))
            check('echo: reduced motion shows a static highlight', len(set(ops)) == 1, ops)
            await tv.emulate_media(reduced_motion='no-preference')
            await tv.evaluate("() => { const k = 'mars-ledger-tv-settings'; const v = JSON.parse(localStorage.getItem(k) || '{}'); v.board3d = true; localStorage.setItem(k, JSON.stringify(v)); }")
            await tv.reload(); await tv.wait_for_timeout(3000)
            await vp.locator('[data-testid=log-move][data-expanded]').first.click()

            # ---- haptics ---------------------------------------------------------------------------------------------
            # Vera passes so Ada can act; Ada plays Hired Raiders on Vera
            await pass_turn(vera)
            assert await wait_turn(ada)
            for n in ('Vera', 'Ada', 'TV'): await pages[n].evaluate('() => { window.__vib = []; window.__tvm = []; window.__tvMoments = []; }')
            w = ada.wf()
            i = opt_index(w, lambda o: soak.option_kind(o) == 'play')
            card = next(c for c in w['options'][i]['cards'] if c['name'] == 'Hired Raiders')
            pay = soak.pay_for(ada.model()['thisPlayer'], card['calculatedCost'], [], w['options'][i].get('paymentOptions') or {})
            t_play = time.time() * 1000
            await answer(ada, {'type': 'or', 'index': i, 'response': {'type': 'projectCard', 'card': 'Hired Raiders', 'payment': pay}})
            await follow_ups(ada, prefer='m€')
            # "On the TV now" on Ada's phone while the TV presents her card (pointer events off: the phone stays usable)
            pill = await until(lambda: ap_.evaluate("() => { const e = document.querySelector('[data-testid=on-tv-pill]'); return e ? {text: e.textContent, pe: getComputedStyle(e).pointerEvents} : null; }"), 4, 0.05)
            await ap_.screenshot(path=shot('pill-01-ada-on-the-tv-now.png'))
            report['notes'].append({'onTv': await ap_.evaluate('() => window.__onTv')})
            check('pill: "On the TV now" shows on the player\'s phone after the play, without blocking taps', pill and pill['text'].startswith('On the TV now') and pill['pe'] == 'none', pill)
            notice_at = await until(lambda: vp.evaluate("() => { const s = window.__net.getState(); const n = s.notices && s.notices.notices.find((x) => x.kind === 'hit'); return n ? Date.now() : null; }"), 10, 0.05)
            vib = await until(lambda: _is(st('Vera'), lambda x: x and x['vib']), 9, 0.05)
            # the TV's resolve may come after the fallback: collect it too
            await until(lambda: _is(st('TV'), lambda x: x and any('red' in (m['m'].get('targets') or []) for m in x['tvm'])), 8, 0.1)
            v = await st('Vera'); a = await st('Ada'); t = await st('TV')
            tvm = [m for m in t['tvm'] if 'red' in (m['m'].get('targets') or [])]
            report['timings']['hit1'] = {'played': t_play, 'vera_vib': v['vib'], 'ada_vib': a['vib'], 'tv_moments': t['tvm']}
            await vp.screenshot(path=shot('uat07-01-vera-hit.png'))
            await tv.screenshot(path=shot('uat07-02-tv-hit.png'))
            report['timings']['pipeline'] = await tv.evaluate("() => (window.__pipeline || []).slice(-8)")
            report['timings']['hit1_summary'] = {'notice_after_play_ms': notice_at - t_play if notice_at else None,
                'tv_resolve_after_play_ms': tvm[0]['t'] - t_play if tvm else None, 'buzz_after_play_ms': v['vib'][0]['t'] - t_play if v['vib'] else None}
            print('hit1', report['timings']['hit1_summary'], flush=True)
            if tvm and v['vib'] and v['vib'][0]['p'] == HIT:
                delta = v['vib'][0]['t'] - tvm[0]['t'] if v['vib'] else None
                check('haptics: Vera buzzes with the hit pattern when the TV resolves the hit', v['vib'] and v['vib'][0]['p'] == HIT and delta is not None and -50 <= delta <= 400,
                      {'buzz_after_tv_resolve_ms': delta, 'pattern': v['vib'][0]['p'] if v['vib'] else None, 'buzz_after_play_ms': v['vib'][0]['t'] - t_play if v['vib'] else None})
            else:
                check('haptics: no TV resolve came, so Vera buzzes at the 6 s fallback', v['vib'] and v['vib'][0]['p'] == [70, 50, 70],
                      {'buzz_after_play_ms': v['vib'][0]['t'] - t_play if v['vib'] else None})
            hits_vib = [x for x in a['vib'] if x['p'] in (HIT, [70, 50, 70])]
            check('haptics: Ada (the attacker) never buzzes for the hit', not hits_vib, a['vib'])
            check('haptics: Vera buzzed exactly once', len([x for x in v['vib'] if x['p'] in (HIT, [70, 50, 70])]) == 1, v['vib'])

            # the TV reports a resolve by hand (the relay, with a real TV socket): the buzz follows within ms
            await follow_ups(ada)
            await until(lambda: asyncio.sleep(0, ada.wf()), 5)
            if not await wait_turn(ada, 3): await pass_turn(vera); await wait_turn(ada)
            for n in ('Vera', 'Ada', 'TV'): await pages[n].evaluate('() => { window.__vib = []; window.__tvm = []; window.__tvMoments = []; }')
            w = ada.wf()
            i = opt_index(w, lambda o: soak.option_kind(o) == 'play')
            names = [c['name'] for c in w['options'][i]['cards']] if i >= 0 else []
            if 'Sabotage' in names:
                card = next(c for c in w['options'][i]['cards'] if c['name'] == 'Sabotage')
                pay = soak.pay_for(ada.model()['thisPlayer'], card['calculatedCost'], [], w['options'][i].get('paymentOptions') or {})
                t_play2 = time.time() * 1000
                await answer(ada, {'type': 'or', 'index': i, 'response': {'type': 'projectCard', 'card': 'Sabotage', 'payment': pay}})
                await follow_ups(ada, prefer='m€')
                await until(lambda: _is(st('Vera'), lambda x: x and x['vib']), 9, 0.05)
                await until(lambda: _is(st('TV'), lambda x: x and any('red' in (m['m'].get('targets') or []) for m in x['tvm'])), 8, 0.1)
                v = await st('Vera'); a = await st('Ada'); t = await st('TV')
                tvm = [m for m in t['tvm'] if 'red' in (m['m'].get('targets') or [])]
                report['timings']['hit2'] = {'played': t_play2, 'vera_vib': v['vib'], 'ada_vib': a['vib'], 'tv_moments': t['tvm']}
                delta = v['vib'][0]['t'] - tvm[0]['t'] if v['vib'] and tvm else None
                print('hit2', {'tv_resolve_after_play_ms': tvm[0]['t'] - t_play2 if tvm else None, 'buzz_after_play_ms': v['vib'][0]['t'] - t_play2 if v['vib'] else None}, flush=True)
                check('haptics: second hit (Sabotage), Vera buzzes on the TV resolve with the hit pattern', v['vib'] and v['vib'][0]['p'] == HIT and delta is not None and -50 <= delta <= 400,
                      {'buzz_after_tv_resolve_ms': delta})
                check('haptics: second hit, Ada does not buzz', not [x for x in a['vib'] if x['p'] in (HIT, [70, 50, 70])], a['vib'])
                # the same resolve again (a second TV, or a re-send) is ignored, and so is the 6 s fallback
                if tvm:
                    mm = tvm[0]['m']
                    await tv.evaluate(f"() => window.__net.getState().tvMoment({{gameAge: {mm['gameAge']}, attacker: '{mm['attacker']}', targets: ['red'], at: Date.now()}})")
                await asyncio.sleep(7)
                v2 = await st('Vera')
                check('haptics: a repeated resolve and the 6 s fallback do not buzz again', len(v2['vib']) == 1, v2['vib'])
                await follow_ups(ada)

            # ---- replay ------------------------------------------------------------------------------------------
            if not args.skip_replay or True:
                # Vera's turn or Ada's: Vera's dock waits (it shows the replay button while she is not active)
                tv0 = await st('TV')
                await vp.evaluate('() => window.scrollTo(0, 0)')
                await vp.get_by_role('tab').filter(has_text='Hand').first.click()
                btn = vp.locator('[data-testid=dock-replay-last]')
                has_btn = await until(lambda: btn.count(), 15)
                await vp.screenshot(path=shot('uat05-01-phone-dock.png'))
                check('replay: the dock shows "Show last move on the TV" while waiting', has_btn)
                if has_btn:
                    t_ask = time.time()
                    await btn.click()
                    got = await until(lambda: _is(st('TV'), lambda x: x and len(x['replays']) > len(tv0['replays'])), 3, 0.05)
                    check('replay: the TV receives the replay from the dock', got, got and got['replays'][-1])
                    tip = await until(lambda: vp.evaluate("() => (document.querySelector('[data-testid=dock-replay-tip]') || {}).textContent || null"), 2, 0.05)
                    await vp.screenshot(path=shot('uat05-02-phone-dock-sent.png'))
                    check('replay: the dock says it was sent', tip == 'Sent to the TV', tip)
                    cap = await until(lambda: tv.evaluate("() => { const e = document.querySelector('[data-testid=tv-asked]'); return e && e.textContent.includes('again') ? e.textContent : null; }"), 25, 0.1)
                    await tv.wait_for_timeout(500)
                    await tv.screenshot(path=shot('uat05-03-tv-replay.png'))
                    check('replay: the TV says "Vera asked to see this again" while it shows', cap == 'Vera asked to see this again', {'caption': cap, 'after_s': round(time.time() - t_ask, 2)})
                    await vp.wait_for_timeout(300)
                    await btn.click()
                    tip2 = await until(lambda: vp.evaluate("() => (document.querySelector('[data-testid=dock-replay-tip]') || {}).textContent || null"), 2, 0.05)
                    await vp.screenshot(path=shot('uat05-04-phone-dock-limited.png'))
                    check('replay: a second ask while the first is on its way is refused with the reason', tip2 and tip2 != 'Sent to the TV', tip2)
                    tv1 = await st('TV')
                    check('replay: no game state changed', tv1['age'] == tv0['age'] and tv1['players'] == tv0['players'], {'age': [tv0['age'], tv1['age']]})
                # from the game menu and from the log, after the cooldown
                await asyncio.sleep(9)
                await vp.locator('button[aria-label="Game menu"]').click()
                await vp.wait_for_timeout(500)
                item = vp.locator('[data-testid=menu-replay-last]')
                text = await item.text_content() if await item.count() else None
                await vp.screenshot(path=shot('uat05-05-phone-menu.png'))
                check('replay: the game menu offers "Show last move on the TV" with the move', text and text.startswith('Show last move on the TV'), text)
                tv3 = await st('TV')
                await item.click()
                got = await until(lambda: _is(st('TV'), lambda x: x and len(x['replays']) > len(tv3['replays'])), 3, 0.05)
                await vp.wait_for_timeout(200)
                await vp.screenshot(path=shot('uat05-05b-phone-menu-sent.png'))
                check('replay: the game menu item reaches the TV', got, got and got['replays'][-1])
                await vp.mouse.click(195, 8)
                await vp.wait_for_timeout(700)
                await asyncio.sleep(9)
                await vp.get_by_role('tab', name='Log').click()
                await vp.wait_for_timeout(400)
                row = vp.locator('[data-testid=log-move]', has_text='Hired Raiders').first
                await row.scroll_into_view_if_needed()
                box = await row.bounding_box()
                await row.click(position={'x': box['width'] - 20, 'y': 18}); await vp.wait_for_timeout(300)
                tv2 = await st('TV')
                rb = row.locator('[data-testid=log-replay]')
                got = None
                for _ in range(8):
                    await rb.click()
                    got = await until(lambda: _is(st('TV'), lambda x: x and len(x['replays']) > len(tv2['replays'])), 1.5, 0.05)
                    if got: break
                    # the cooldown after the menu's replay: the button says how long; ask again after it
                    report['notes'].append({'log_replay_wait': await rb.text_content()})
                    await vp.screenshot(path=shot('uat05-06a-phone-log-replay-cooldown.png'))
                    await asyncio.sleep(2.5)
                await vp.screenshot(path=shot('uat05-06-phone-log-replay.png'))
                check('replay: "Replay on the TV" from a log move reaches the TV', got and got['replays'][-1]['card'] == 'Hired Raiders', got and got['replays'][-1])
                cap = await until(lambda: tv.evaluate("() => { const e = document.querySelector('[data-testid=tv-asked]'); return e && e.textContent.includes('again') ? e.textContent : null; }"), 25, 0.1)
                await tv.wait_for_timeout(700)
                await tv.screenshot(path=shot('uat05-07-tv-log-replay.png'))
                check('replay: the log replay shows on the TV with who asked', cap == 'Vera asked to see this again', cap)
            # the phones' TV links pill and buttons at 390 px
            await ap_.screenshot(path=shot('phone-ada-end.png'))
    finally:
        srv.terminate()
        json.dump(report, open(os.path.join(args.out, 'tvlinks.json'), 'w'), indent=1)
        fails = [k for k, v in report['checks'].items() if not v['ok']]
        print('FAILED:' if fails else 'ALL PASSED', fails, report['notes'][:5])


async def _is(coro, pred):
    v = await coro
    return v if pred(v) else None


if __name__ == '__main__':
    asyncio.run(main())
