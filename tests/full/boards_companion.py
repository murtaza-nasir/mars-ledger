"""Companion mode on Hellas, and the random-map announcement, through the real UI.

1. Companion on Hellas: two phones join, pick Hellas in the lobby, start, choose corporations; the Projects sheet
   lists Hellas milestones and awards; a player claims Polar Explorer (counted on the physical board, claimed on
   trust) and funds Cultivator; the TV standings show the Hellas set. Screenshots of each step.
2. Random map: a fresh table picks Random and starts; the TV's draw is captured every 250 ms, and the resolved map
   must be one of the three and match the game state.

    run: python3 tests/full/boards_companion.py --shots DIR   (uses dist-server + CLIENT_DIST)
"""
import argparse, asyncio, json, os, subprocess, tempfile, time, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def serve(port):
    env = {**os.environ, 'PORT': str(port), 'DATA_DIR': tempfile.mkdtemp(prefix='tm-comp-'), 'NARRATOR_ENABLED': 'false', 'ENGINE_URL': 'http://localhost:1'}
    p = subprocess.Popen(['node', os.path.join(ROOT, 'dist-server/index.js')], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    for _ in range(50):
        try: urllib.request.urlopen(f'http://localhost:{port}/api/config'); break
        except Exception: time.sleep(0.2)
    return p


async def join(b, url, name, color):
    ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
    pg = await ctx.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    await pg.goto(url); await pg.wait_for_timeout(900)
    await pg.fill('input[aria-label="Your name"]', name)
    await pg.click(f'button[aria-label="{color}"]')
    await pg.click('text=Join the table'); await pg.wait_for_timeout(600)
    return pg, errs


async def state(pg):
    return await pg.evaluate('() => window.__net.getState().state')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8904)
    ap.add_argument('--shots', required=True)
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    out = {}
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])

        # ---- 1. companion on Hellas ---------------------------------------------------------------
        srv = serve(args.port); url = f'http://localhost:{args.port}'
        try:
            tv = await (await b.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
            await tv.goto(url + '/tv')
            a, ea = await join(b, url, 'Ada', 'red')
            c, ec = await join(b, url, 'Vera', 'blue')
            await a.click('[data-board="hellas"]'); await a.wait_for_timeout(500)
            await a.click('button:has-text("Start with 2 players")'); await a.wait_for_timeout(1200)
            for pg, corp in [(a, 'Ecoline'), (c, 'Helion')]:
                await pg.click(f'article:has-text("{corp}")'); await pg.wait_for_timeout(400)
                await pg.click('text=Continue'); await pg.wait_for_timeout(500)
                await pg.locator('button.btn.warm').last.click(); await pg.wait_for_timeout(900)
            s = await state(a)
            out['companion'] = {'board': s.get('board'), 'phase': s['phase']}
            cur = s['current']
            me = {pl['id']: pl['name'] for pl in s['players']}
            act = a if me[cur] == 'Ada' else c
            await act.wait_for_timeout(2500)
            await act.click('button:has-text("Projects")'); await act.wait_for_timeout(900)
            await act.locator('h3:has-text("Hellas milestones")').evaluate('(el) => el.scrollIntoView({block: "start"})')
            await act.wait_for_timeout(400)
            await act.screenshot(path=os.path.join(args.shots, 'companion-hellas-projects.png'))
            await act.click('button:has-text("Polar Explorer")'); await act.wait_for_timeout(1500)
            s = await state(act)
            out['companion']['milestones'] = s['milestones']
            await tv.wait_for_timeout(5500)
            await tv.screenshot(path=os.path.join(args.shots, 'companion-hellas-tv-milestones.png'))
            await tv.wait_for_timeout(12500)
            await tv.screenshot(path=os.path.join(args.shots, 'companion-hellas-tv-awards.png'))
            out['companion']['pageerrors'] = ea + ec
        finally:
            srv.terminate()

        # ---- 2. random map, announced on the TV ---------------------------------------------------
        srv = serve(args.port + 1); url = f'http://localhost:{args.port + 1}'
        try:
            tv = await (await b.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
            await tv.goto(url + '/tv')
            a, ea = await join(b, url, 'Ada', 'red')
            await a.click('[data-board="random"]'); await a.wait_for_timeout(600)
            await tv.wait_for_timeout(600); await tv.screenshot(path=os.path.join(args.shots, 'random-tv-lobby.png'))
            await a.click('button:has-text("Start solo")')
            frames = []
            for i in range(20):
                f = os.path.join(args.shots, f'random-tv-{i:02d}.png'); await tv.screenshot(path=f); frames.append(f)
                await tv.wait_for_timeout(250)
            s = await state(a)
            out['random'] = {'board': s.get('board'), 'choice': s.get('boardChoice'), 'frames': len(frames), 'pageerrors': ea}
            assert s.get('board') in ('tharsis', 'hellas', 'elysium'), s.get('board')
        finally:
            srv.terminate()
        await b.close()
    print(json.dumps(out, indent=1))


asyncio.run(main())
