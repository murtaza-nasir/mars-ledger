"""Production show capture: plays generation 1 of a full game through our server and a real engine,
then records the TV and two phones every 250 ms while the production show plays, and checks that the
phones' numbers end exactly on the engine's post-production values.

    engine: (cd vendor/tm && mkdir -p db/files && PORT=8851 LOCAL_FS_DB=1 node build/src/server/server.js)
    build:  npm run build
    run:    python3 tests/full/production_show.py --engine http://localhost:8851 --shots DIR
"""
import argparse, asyncio, json, os, random, subprocess, sys, tempfile, time, urllib.request
import websockets
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(__file__))
from soak import Bot, Seat, ROOT, text  # noqa: E402

RES = ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat']


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8851')
    ap.add_argument('--port', type=int, default=8852)
    ap.add_argument('--shots', required=True)
    ap.add_argument('--players', type=int, default=2)
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    data = tempfile.mkdtemp(prefix='tm-show-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400',
           'VISION_ENABLED': 'false', 'CLIENT_DIST': os.path.join(ROOT, 'dist')}
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'dist-server/index.js')], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        colors = ['red', 'blue', 'green']
        seats = [Seat(f'p{i}', ['Ada', 'Vera', 'Nova'][i], colors[i]) for i in range(args.players)]
        for s in seats: await s.open(args.port)
        for s in seats: await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})
        err = await seats[0].rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': seats[0].id, 'modules': ['base', 'corpera'],
                                  'order': [s.id for s in seats], 'mode': 'full', 'draft': False}})
        assert err is None, err
        shows = []
        mon = await websockets.connect(f'ws://localhost:{args.port}/ws', max_size=2 ** 24)
        await mon.send(json.dumps({'type': 'hello', 'role': 'tv', 'playerId': None}))

        async def watch():
            async for raw in mon:
                m = json.loads(raw)
                if m.get('type') == 'production': shows.append((time.time(), m['show']))
        asyncio.create_task(watch())

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
            errors = []
            for s in seats[:2]:
                ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
                s.page = await ctx.new_page(); s.page.on('pageerror', lambda e, s=s: errors.append(f'{s.name}: {e}'))
                await s.page.goto(f'http://localhost:{args.port}/')
            tvctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
            tv = await tvctx.new_page(); tv.on('pageerror', lambda e: errors.append(f'TV: {e}'))
            await tv.goto(f'http://localhost:{args.port}/tv')
            bot = Bot(random.Random(7))
            for _ in range(200):
                if all(s.wf() for s in seats): break
                await asyncio.sleep(0.1)
            # generation 1: the bot plays until production pays out
            t0 = time.time()
            while not shows:
                if time.time() - t0 > 400: raise RuntimeError('no production show within 400 s')
                moved = False
                for s in seats:
                    w = s.wf()
                    if not w or w.get('optional'): continue
                    model = s.model(); ans = bot.answer(w, model['thisPlayer'], model, s.sig())
                    if not ans: raise RuntimeError(f'no answer for {w["type"]} {text(w.get("title"))}')
                    before = s.sig()
                    e = await s.rpc({'type': 'input', 'playerId': s.id, 'response': ans[0]})
                    if e: bot.failed.add((s.sig(), ()))
                    for _ in range(40):
                        if s.sig() != before or shows: break
                        await asyncio.sleep(0.05)
                    moved = True
                    break
                if not moved: await asyncio.sleep(0.05)
            got, show = shows[0]
            print('show', json.dumps(show)[:600])
            # frames every 250 ms across the whole show (the bot is paused)
            start_local = got + (show['startAt'] - show['serverNow']) / 1000
            frame = 0
            while time.time() < start_local + show['durationMs'] / 1000 + 0.3:
                t = time.time() - start_local
                shots = [tv.screenshot(path=os.path.join(args.shots, f'tv-{frame:02d}.jpg'), type='jpeg', quality=70)]
                for i, s in enumerate(seats[:2]): shots.append(s.page.screenshot(path=os.path.join(args.shots, f'phone{i}-{frame:02d}.jpg'), type='jpeg', quality=75))
                await asyncio.gather(*shots)
                with open(os.path.join(args.shots, 'times.txt'), 'a') as f: f.write(f'{frame} {t:.2f}\n')
                frame += 1
                await asyncio.sleep(max(0, 0.25 - (time.time() - start_local - t)))
            await asyncio.sleep(1.0)
            # the phones' numbers must end on the engine's values
            ok = True
            for s in seats[:2]:
                me = s.model()['thisPlayer']
                shown = {}
                for r in RES:
                    lab = await s.page.locator(f'[data-res-tile="{r}"] [aria-label]').last.get_attribute('aria-label')
                    shown[r] = int(lab)
                want = {r: me[r] for r in RES}
                exp = next(p for p in show['players'] if p['color'] == s.color)
                calc = {r: exp['before'][r] + exp['gains'][r] for r in RES}; calc['energy'] = exp['before']['energy'] - exp['energyToHeat'] + exp['gains']['energy']
                print(s.name, 'shown', shown, 'engine', want, 'show-computed', calc)
                ok = ok and shown == want == calc
            print('NUMBERS MATCH' if ok else 'NUMBERS DIFFER')
            print('page errors:', errors or 'none')
            await browser.close()
    finally:
        srv.terminate()
        out = srv.communicate(timeout=5)[0]
        warn = [l for l in (out or '').splitlines() if 'warn' in l.lower() or 'error' in l.lower()]
        print('server warnings:', warn[-8:] or 'none')

asyncio.run(main())
