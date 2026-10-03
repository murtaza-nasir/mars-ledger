#!/usr/bin/env python3
"""End-of-game poster, end to end in companion mode, through real phones and TVs.

    CLIENT_DIST=<build dir> python3 tests/full/poster_ui.py --shots <dir> [--port 8943] [--data <dir>] [--unique]

Game 1: three players end right after setup (barely terraformed, a shared win on 20 and a third place):
  the barren painting, the phones' poster card and full-screen viewer at 390 and 360 wide, the download,
  the wide variant, and the TV's poster reveal after the podium at 1920x1080 and 3840x2160.
Game 2: the table turns the one-off illustration on, raises the parameters and ends: a terraformed poster,
  and with --unique one real request to the shared image server (only when it is idle; its checkpoint is
  read before and after and must not change).
"""
import argparse, asyncio, json, os, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# The image server for --unique (a Stable Diffusion Forge/A1111 API); the same variable the app reads.
FORGE = os.environ.get('POSTER_FORGE_URL', '').rstrip('/')
checks = []


def check(name, ok, detail=''):
    checks.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


async def net(page, expr):
    return await page.evaluate(f'() => {{ const s = window.__net.getState(); return {expr}; }}')


async def send(page, cmd):
    return await page.evaluate('(c) => window.__net.getState().send(c).then(() => null, (e) => e.message)', cmd)


async def wait_for(page, expr, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        if await net(page, expr): return True
        await asyncio.sleep(0.25)
    return False


def forge_get(path):
    try: return json.load(urllib.request.urlopen(FORGE + path, timeout=5))
    except Exception as e: return {'error': str(e)}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8943)
    ap.add_argument('--shots', required=True)
    ap.add_argument('--data', default=None)
    ap.add_argument('--unique', action='store_true', help='make one real request to the shared image server')
    ap.add_argument('--fallback', action='store_true', help='run with no poster assets: the phones must show the styled fallback card')
    args = ap.parse_args()
    if args.unique and not FORGE:
        print('--unique needs POSTER_FORGE_URL (the image server); running without the one-off illustration', flush=True)
        args.unique = False
    os.makedirs(args.shots, exist_ok=True)
    shot = lambda n: os.path.join(args.shots, n)
    data = args.data or os.path.join(args.shots, 'data')
    os.makedirs(data, exist_ok=True)
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'VISION_ENABLED': 'false', 'NARRATOR_ENABLED': 'false',
           **({'POSTER_ASSETS': os.path.join(data, 'no-assets')} if args.fallback else {}),
           'POSTER_UNIQUE_ENABLED': 'true' if args.unique else 'false', **({'POSTER_FORGE_URL': FORGE} if args.unique else {}), 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist'))}
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'dist-server/index.js')], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url = f'http://localhost:{args.port}'
    errors = []
    try:
        for _ in range(100):
            try: urllib.request.urlopen(url + '/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        async with async_playwright() as pw:
            b = await pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])

            async def phone(dev, w=390, h=844):
                ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=True, is_mobile=True, accept_downloads=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{dev}')}}catch(e){{}}")
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, d=dev: errors.append(f'{d}: {e}'))
                await pg.goto(url); await pg.wait_for_timeout(1000)
                return pg

            async def tv(w, h):
                ctx = await b.new_context(viewport={'width': w, 'height': h})
                pg = await ctx.new_page(); pg.on('pageerror', lambda e: errors.append(f'tv{w}: {e}'))
                await pg.goto(url + '/tv'); await pg.wait_for_timeout(1200)
                return pg

            people = [('dev-ada-000001', 'Ada', 'red'), ('dev-vera-00001', 'Vera', 'blue'), ('dev-nova-00001', 'Nova', 'green')]
            A = await phone(people[0][0]); B = await phone(people[1][0], 360, 740); C = await phone(people[2][0])
            pages = [A, B, C]

            async def seat_everyone():
                for pg, (dev, name, color) in zip(pages, people):
                    assert (await send(pg, {'t': 'join', 'playerId': dev, 'name': name, 'color': color})) is None
                await A.wait_for_timeout(500)

            async def start_and_corps(corps):
                assert (await send(A, {'t': 'start', 'playerId': people[0][0], 'modules': ['base', 'corpera'], 'order': [p[0] for p in people]})) is None
                for pg, (dev, _, _), corp in zip(pages, people, corps):
                    err = await send(pg, {'t': 'chooseCorp', 'playerId': dev, 'corporation': corp, 'cardsKept': 0, 'answers': []})
                    assert err is None, err
                check('actions begin', await wait_for(A, 's.state.phase === "action"'))

            async def end_from_menu():
                await A.click('button[aria-label="Game menu"]'); await A.wait_for_timeout(700)
                await A.click('button:has-text("End the game and score it")'); await A.wait_for_timeout(300)
                await A.click('button:has-text("Tap again")'); await A.wait_for_timeout(1500)

            async def poster_of(pg):
                return await net(pg, 's.posters[s.state.id] ?? null')

            # ---- game 1: barren, shared win ------------------------------------------------------
            tv1 = await tv(1920, 1080); tv4 = await tv(3840, 2160)
            await seat_everyone()
            await start_and_corps(['Beginner Corporation', 'Ecoline', 'Helion'])
            assert (await send(C, {'t': 'adjust', 'playerId': people[2][0], 'target': people[2][0], 'tr': -2})) is None
            await end_from_menu()
            check('game 1 ended', await wait_for(A, 's.state.phase === "ended"'))
            if args.fallback:
                check('without assets the poster reports failed, not an error', await wait_for(A, 's.posters[s.state.id]?.library === "failed"', 60))
                card = A.locator('section[aria-label="Your poster"]')
                await card.scroll_into_view_if_needed(); await A.wait_for_timeout(1200)
                await A.screenshot(path=shot('fallback-card-390.png'))
                txt = await card.inner_text()
                check('the phone shows the styled fallback card with the result', 'could not be drawn' in txt and 'Mars Ledger' in txt, txt[:160])
                check('no Save button on a failed poster', await A.locator('[data-testid="poster-open"]').count() == 0)
                check('no page errors', not errors, '; '.join(errors[:5]))
                await b.close()
                return
            check('game 1 poster ready (library)', await wait_for(A, 's.posters[s.state.id]?.library === "ready"', 60))
            p1 = await poster_of(A)
            check('an early game gets a barren painting', (p1 or {}).get('painting', '').startswith('barren'), (p1 or {}).get('painting'))
            game1 = await net(A, 's.state.id')
            # the achievement reveal (none here without profiles) must not hide the card; scroll to it
            for pg, tag in ((A, '390'), (B, '360')):
                card = pg.locator('section[aria-label="Your poster"]')
                check(f'poster card on the final score ({tag})', await card.count() == 1)
                await card.scroll_into_view_if_needed(); await pg.wait_for_timeout(1800)
                await pg.screenshot(path=shot(f'g1-final-card-{tag}.png'))
                await pg.click('[data-testid="poster-open"]'); await pg.wait_for_timeout(1400)
                await pg.screenshot(path=shot(f'g1-viewer-portrait-{tag}.png'))
                img = pg.locator('img[alt="The poster of this game"]')
                size = await img.evaluate('(i) => [i.naturalWidth, i.naturalHeight]')
                check(f'viewer shows the portrait poster ({tag})', size == [1080, 1920], str(size))
                async with pg.expect_download(timeout=15000) as dl:
                    await pg.click('[data-testid="poster-save"]')
                d = await dl.value
                path = shot(f'g1-download-{tag}.png'); await d.save_as(path)
                with open(path, 'rb') as f: head = f.read(24)
                check(f'Save downloads the PNG over plain http ({tag})', head[1:4] == b'PNG' and int.from_bytes(head[16:20], 'big') == 1080, d.suggested_filename)
                await pg.click('button[role="radio"]:has-text("Wide")'); await pg.wait_for_timeout(1400)
                await pg.screenshot(path=shot(f'g1-viewer-wide-{tag}.png'))
                size = await img.evaluate('(i) => [i.naturalWidth, i.naturalHeight]')
                check(f'wide variant is 1920x1080 ({tag})', size == [1920, 1080], str(size))
                await pg.click('button:has-text("Close")'); await pg.wait_for_timeout(500)
            # the TV: story → podium → (no profiles, no hall of fame) → the poster reveal
            for t, tag in ((tv1, '1080'), (tv4, '2160')):
                seen = False
                for _ in range(240):
                    if await t.locator('img[alt="The poster of this game"]').count(): seen = True; break
                    await asyncio.sleep(0.5)
                check(f'TV reveals the poster after the podium ({tag})', seen)
                await t.wait_for_timeout(1000); await t.screenshot(path=shot(f'g1-tv-reveal-early-{tag}.png'))
                await t.wait_for_timeout(3500); await t.screenshot(path=shot(f'g1-tv-reveal-{tag}.png'))
            # the endpoint refuses what it should
            for bad in ('/api/poster/..%2Fetc.png', f'/api/poster/{game1}.png?variant=nope', f'/api/poster/{game1}.png?orientation=square', '/api/poster/nosuchgame.png'):
                try: urllib.request.urlopen(url + bad, timeout=3); code = 200
                except urllib.error.HTTPError as e: code = e.code
                check(f'endpoint refuses {bad}', code in (400, 404), str(code))
            thumb = urllib.request.urlopen(f'{url}/api/poster/{game1}.png?variant=library&orientation=landscape&size=thumb', timeout=3).read()
            check('thumbnail is 480x270', int.from_bytes(thumb[16:20], 'big') == 480 and int.from_bytes(thumb[20:24], 'big') == 270)

            # ---- game 2: terraformed, with the one-off illustration --------------------------------
            # the final score screen carries the game menu inline
            await A.locator('button:has-text("Start a new game")').scroll_into_view_if_needed()
            await A.click('button:has-text("Start a new game")'); await A.wait_for_timeout(300)
            await A.click('button:has-text("Tap again")'); await A.wait_for_timeout(1500)
            check('new lobby', await wait_for(A, 's.state.phase === "lobby"'))
            await seat_everyone()
            if args.unique:
                sw = A.locator('button[data-poster-unique]')
                await sw.scroll_into_view_if_needed()
                await A.screenshot(path=shot('g2-lobby-switch-off-390.png'))
                await sw.click(); await A.wait_for_timeout(600)
                check('the lobby switch turns the one-off illustration on for the table', await wait_for(B, 's.state.posterUnique === true'))
                await A.screenshot(path=shot('g2-lobby-switch-on-390.png'))
            await start_and_corps(['Tharsis Republic', 'Ecoline', 'Helion'])
            for param, value in (('temperature', 8), ('oxygen', 14), ('oceans', 9)):
                assert (await send(A, {'t': 'setGlobal', 'playerId': people[0][0], 'param': param, 'value': value})) is None
            assert (await send(B, {'t': 'adjust', 'playerId': people[1][0], 'target': people[1][0], 'tr': 12})) is None
            before = forge_get('/sdapi/v1/options').get('sd_model_checkpoint') if args.unique else None
            progress = forge_get('/sdapi/v1/progress') if args.unique else {}
            idle = (progress.get('state') or {}).get('job_count', 1) == 0 and not progress.get('progress')
            if args.unique: print('forge before:', before, 'idle:', idle, flush=True)
            await end_from_menu()
            check('game 2 poster ready (library)', await wait_for(A, 's.posters[s.state.id]?.library === "ready"', 60))
            p2 = await poster_of(A)
            check('a terraformed game gets a full-ocean painting', (p2 or {}).get('painting', '').startswith('full-'), (p2 or {}).get('painting'))
            if args.unique:
                done = await wait_for(A, '["ready", "skipped"].includes(s.posters[s.state.id]?.unique)', 120)
                p2 = await poster_of(A)
                check('the one-off illustration finished or was skipped quietly', done, str(p2))
                if idle: check('with the image server idle, the one-off illustration is ready', (p2 or {}).get('unique') == 'ready', str(p2))
                after = forge_get('/sdapi/v1/options').get('sd_model_checkpoint')
                check('the shared image server kept its checkpoint', before == after, f'{before} -> {after}')
                card = A.locator('section[aria-label="Your poster"]')
                await card.scroll_into_view_if_needed(); await A.wait_for_timeout(2000)
                await A.screenshot(path=shot('g2-final-card-unique-390.png'))
                if (p2 or {}).get('unique') == 'ready':
                    await A.click('[data-testid="poster-open"]'); await A.wait_for_timeout(1500)
                    await A.screenshot(path=shot('g2-viewer-unique-390.png'))
                    await A.click('button:has-text("Close")'); await A.wait_for_timeout(400)
                    await A.click('button[role="radio"]:has-text("Painting")'); await A.wait_for_timeout(1500)
                    await A.screenshot(path=shot('g2-final-card-library-390.png'))
            async def reveal(t):
                for _ in range(240):
                    if await t.locator('img[alt="The poster of this game"]').count(): return True
                    await asyncio.sleep(0.5)
                return False
            seen = await asyncio.gather(reveal(tv1), reveal(tv4))
            check('TV reveals game 2 poster (1080)', seen[0]); check('TV reveals game 2 poster (2160)', seen[1])
            await asyncio.sleep(5)
            await asyncio.gather(tv1.screenshot(path=shot('g2-tv-reveal-1080.png')), tv4.screenshot(path=shot('g2-tv-reveal-2160.png')))
            if args.unique and (p2 or {}).get('unique') == 'ready':
                await asyncio.sleep(9.5)  # the one-off follows halfway through the reveal
                await asyncio.gather(tv1.screenshot(path=shot('g2-tv-reveal-unique-1080.png')), tv4.screenshot(path=shot('g2-tv-reveal-unique-2160.png')))
                cap = await tv4.locator('text=The one-off illustration').count()
                check('the TV moves on to the one-off illustration', cap > 0)
            check('no page errors', not errors, '; '.join(errors[:5]))
            await b.close()
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=5)[0]
        except Exception: out = ''
        warn = [l for l in (out or '').splitlines() if 'warn' in l.lower() or 'error' in l.lower()]
        print('server log (warnings):', warn[-10:], flush=True)
    failed = [c for c in checks if not c[1]]
    print(f'\n{len(checks) - len(failed)}/{len(checks)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
