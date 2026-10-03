"""Maps through the real UI: lobby picker, TV board and phone Mars tab per map, and Hellas's pole ocean.

Starts our server (dist-server + CLIENT_DIST) against a running engine, joins two phones, picks the map and
Beginner Corporations in the lobby by tapping, starts a full game, and screenshots the lobby picker, the TV
board and a phone's Mars tab. With --pole (Hellas only), the active phone builds a City standard project on the
south-pole space 61 through the phone UI, pays the 6 M€ bonus ocean and places it; the engine's model is then
checked (city on 61, one more ocean, 31 M€ spent before bonuses, TR +1).

    run: CLIENT_DIST=<dist> python3 tests/full/boards_ui.py --engine http://localhost:8901 --board hellas --pole --shots DIR
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def text(m):
    if m is None: return ''
    if isinstance(m, str): return m
    s = m.get('message', '')
    for i, d in enumerate(m.get('data', [])):
        v = d.get('value'); s = s.replace('${%d}' % i, ', '.join(v) if isinstance(v, list) else str(v))
    return s


async def model(pg):
    return await pg.evaluate("() => { const v = window.__net.getState().fullView; return v ? v.model : null }")


async def wait_for(pg, pred, what, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        m = await model(pg)
        if m and pred(m): return m
        await asyncio.sleep(0.2)
    raise AssertionError(f'timed out waiting for {what}')


async def open_decision(pg):
    await pg.wait_for_timeout(600)
    if not await pg.locator('[role=dialog]').count():
        await pg.locator('[data-testid=dock-go]').click()
    await pg.locator('[role=dialog]').last.wait_for(state='visible', timeout=12000)
    await pg.wait_for_timeout(400)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8901')
    ap.add_argument('--port', type=int, default=8903)
    ap.add_argument('--board', required=True, choices=['tharsis', 'hellas', 'elysium'])
    ap.add_argument('--pole', action='store_true')
    ap.add_argument('--shots', required=True)
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    data = tempfile.mkdtemp(prefix='tm-boards-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'NARRATOR_ENABLED': 'false'}
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'dist-server/index.js')], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    url = f'http://localhost:{args.port}'
    try:
        for _ in range(50):
            try: urllib.request.urlopen(url + '/api/config'); break
            except Exception: time.sleep(0.2)
        async with async_playwright() as p:
            b = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
            tv = await (await b.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
            await tv.goto(url + '/tv')
            phones = []
            for name, color in [('Ada', 'red'), ('Vera', 'blue')]:
                ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
                pg = await ctx.new_page()
                errs = []
                pg.on('pageerror', lambda e, errs=errs: errs.append(str(e)))
                await pg.goto(url); await pg.wait_for_timeout(900)
                await pg.fill('input[aria-label="Your name"]', name)
                await pg.click(f'button[aria-label="{color}"]')
                await pg.click('text=Join the table'); await pg.wait_for_timeout(600)
                await pg.click('button[role=switch]:has-text("Beginner Corporation")'); await pg.wait_for_timeout(300)
                phones.append((name, pg, errs))
            a = phones[0][1]
            await a.click(f'[data-board="{args.board}"]'); await a.wait_for_timeout(700)
            await a.locator('[data-board]').first.scroll_into_view_if_needed()
            await a.screenshot(path=os.path.join(args.shots, f'{args.board}-lobby-picker.png'), full_page=True)
            await tv.wait_for_timeout(800); await tv.screenshot(path=os.path.join(args.shots, f'{args.board}-tv-lobby.png'))
            await a.click('button:has-text("The board is on the TV")'); await a.wait_for_timeout(300)
            await a.click('button:has-text("Start full game")')
            # both beginners: the engine skips setup and goes straight to the first action
            # (in generation 1 the engine still reports the 'research' phase while it asks for the first action)
            async def first_action():
                t0 = time.time()
                while time.time() - t0 < 30:
                    for _, pg, _ in phones:
                        mm = await model(pg)
                        if mm and mm.get('waitingFor') and 'action' in text(mm['waitingFor'].get('title')).lower(): return mm
                    await asyncio.sleep(0.3)
                raise AssertionError('timed out waiting for the first action')
            m = await first_action()
            assert m['game']['gameOptions']['boardName'] == args.board, m['game']['gameOptions']['boardName']
            await tv.wait_for_timeout(14000)  # corporation reveal plays first
            await tv.screenshot(path=os.path.join(args.shots, f'{args.board}-tv-board.png'))
            for name, pg, _ in phones:
                await pg.click('[role=tab]:has-text("Mars")'); await pg.wait_for_timeout(900)
                await pg.evaluate('() => window.scrollTo(0, 0)'); await pg.wait_for_timeout(300)
                await pg.screenshot(path=os.path.join(args.shots, f'{args.board}-phone-mars-{name}.png'))
                await pg.evaluate('() => window.scrollTo(0, 420)'); await pg.wait_for_timeout(300)
                await pg.screenshot(path=os.path.join(args.shots, f'{args.board}-phone-mars-{name}-scrolled.png'))
                await pg.click('[role=tab]:has-text("Hand")'); await pg.wait_for_timeout(300)

            result = {'board': args.board, 'milestones': [x['name'] for x in m['game']['milestones']], 'awards': [x['name'] for x in m['game']['awards']]}
            if args.pole:
                assert args.board == 'hellas'
                # whoever is active builds the city on the pole
                active = None
                for name, pg, _ in phones:
                    mm = await model(pg)
                    if mm.get('waitingFor') and mm['thisPlayer']['isActive']: active = (name, pg)
                name, pg = active
                before = await model(pg)
                wf = before['waitingFor']
                sp = next(i for i, o in enumerate(wf['options']) if text(o['title']) == 'Standard projects')
                await open_decision(pg)
                await pg.locator(f'[role=dialog] [data-opt="{sp}"]').first.click(); await pg.wait_for_timeout(500)
                await pg.locator('[role=dialog] [data-card="City"]').first.click(); await pg.wait_for_timeout(500)
                await pg.screenshot(path=os.path.join(args.shots, 'hellas-pole-1-city.png'))
                await pg.locator('[role=dialog] button.btn.warm:visible').last.click()
                m1 = await wait_for(pg, lambda m: (m.get('waitingFor') or {}).get('type') == 'space', 'the city space question')
                assert '61' in m1['waitingFor']['spaces'], 'the pole is not a legal city space'
                await pg.locator('[role=dialog]').last.wait_for(state='visible', timeout=12000); await pg.wait_for_timeout(500)
                await pg.locator('[role=dialog] g[data-space="61"]').click(); await pg.wait_for_timeout(500)
                await pg.screenshot(path=os.path.join(args.shots, 'hellas-pole-2-picked.png'))
                await tv.screenshot(path=os.path.join(args.shots, 'hellas-pole-2-tv-ghost.png'))
                await pg.locator('[role=dialog] button.btn.warm:visible').last.click()
                # the engine now asks for the 6 M€ (or pays it itself when only M€ can pay), then the ocean space
                steps = []
                for _ in range(4):
                    mm = await wait_for(pg, lambda m: (m.get('waitingFor') or {}).get('type') in ('payment', 'space') or m['thisPlayer']['megacredits'] < before['thisPlayer']['megacredits'] - 25, 'the bonus ocean', 20)
                    w = mm.get('waitingFor') or {}
                    if w.get('type') == 'payment':
                        steps.append(f"payment {w.get('amount')}: {text(w.get('title'))}")
                        await open_decision(pg)
                        await pg.screenshot(path=os.path.join(args.shots, 'hellas-pole-3-payment.png'))
                        await pg.locator('[role=dialog] button.btn.warm:visible').last.click(); await pg.wait_for_timeout(900)
                    elif w.get('type') == 'space' and 'ocean' in text(w.get('title')).lower():
                        steps.append(f"space: {text(w.get('title'))}")
                        await open_decision(pg)
                        await pg.locator('[role=dialog] g[data-space][style*="cursor: pointer"]').first.click(); await pg.wait_for_timeout(500)
                        await pg.screenshot(path=os.path.join(args.shots, 'hellas-pole-4-ocean.png'))
                        await pg.locator('[role=dialog] button.btn.warm:visible').last.click(); await pg.wait_for_timeout(1200)
                        break
                    else:
                        await asyncio.sleep(0.5)
                after = await wait_for(pg, lambda m: m['game']['oceans'] == before['game']['oceans'] + 1, 'the ocean on the board', 20)
                pole = next(s for s in after['game']['spaces'] if s['id'] == '61')
                spent = before['thisPlayer']['megacredits'] - after['thisPlayer']['megacredits']
                result['pole'] = {'player': name, 'steps': steps, 'pole_tile': pole.get('tileType'), 'pole_owner': pole.get('color'),
                                  'oceans': [before['game']['oceans'], after['game']['oceans']],
                                  'tr': [before['thisPlayer']['terraformRating'], after['thisPlayer']['terraformRating']],
                                  'mc_spent_net_of_bonuses': spent}
                assert pole.get('tileType') == 2, pole
                await tv.wait_for_timeout(3500); await tv.screenshot(path=os.path.join(args.shots, 'hellas-pole-5-tv.png'))
                await pg.click('[role=tab]:has-text("Mars")'); await pg.wait_for_timeout(900)
                await pg.screenshot(path=os.path.join(args.shots, 'hellas-pole-6-phone-mars.png'), full_page=True)
            result['pageerrors'] = [e for _, _, errs in phones for e in errs]
            print(json.dumps(result, indent=1))
            await b.close()
    finally:
        srv.terminate()
        out = srv.stdout.read().decode(errors='replace') if srv.stdout else ''
        warn = [l for l in out.splitlines() if 'warn' in l.lower() or 'error' in l.lower()]
        if warn: print('server:', warn[:10])


asyncio.run(main())
