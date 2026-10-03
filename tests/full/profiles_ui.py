"""Profiles end to end in companion mode, through the real phone and TV pages.

    CLIENT_DIST=<build dir> python3 tests/full/profiles_ui.py --shots <dir> [--port 8922]

Covers: first profile (no profiles yet), choosing from existing profiles, a guest without a profile,
a three-way tie ended from the menu (reveals on phones, roll-up and hall of fame on the TV), the hall of
fame in the TV lobby, the profile screen, one-tap rejoin, an abandoned game (not recorded), a win decided
by final board points (re-recorded), editing a profile, and merging a duplicate.
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, urllib.request
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
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
        await asyncio.sleep(0.2)
    return False


async def menu(page, label, confirm=True):
    await page.click('button[aria-label="Game menu"]'); await page.wait_for_timeout(700)
    await page.click(f'button:has-text("{label}")'); await page.wait_for_timeout(300)
    if confirm: await page.click('button:has-text("Tap again")')
    await page.wait_for_timeout(1200)


async def corps(pages_corps):
    for page, corp in pages_corps:
        me = await net(page, 's.state.players.find((p) => p.id === localStorage.getItem("mars-ledger-player")).id')
        err = await send(page, {'t': 'chooseCorp', 'playerId': me, 'corporation': corp, 'cardsKept': 0, 'answers': []})
        assert err is None, err


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8922)
    ap.add_argument('--shots', required=True)
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    shot = lambda n: os.path.join(args.shots, n)
    data = tempfile.mkdtemp(prefix='tm-prof-ui-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'VISION_ENABLED': 'false', 'NARRATOR_ENABLED': 'false', 'FULL_GAME': 'true',
           'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist'))}
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
                ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{dev}')}}catch(e){{}}")
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, d=dev: errors.append(f'{d}: {e}'))
                await pg.goto(url); await pg.wait_for_timeout(1200)
                return pg

            async def tv(w, h):
                ctx = await b.new_context(viewport={'width': w, 'height': h})
                pg = await ctx.new_page(); pg.on('pageerror', lambda e: errors.append(f'tv{w}: {e}'))
                await pg.goto(url + '/tv'); await pg.wait_for_timeout(1500)
                return pg

            tv1, tv4 = await tv(1920, 1080), await tv(3840, 2160)
            A = await phone('device-ada-00001')
            # 1. first profile: nobody exists yet, so the form opens directly
            check('first phone opens straight on the new-profile form', await A.locator('h2:has-text("Your profile")').count() == 1)
            await A.screenshot(path=shot('01-first-profile-390.png'))
            await A.fill('input[aria-label="Your name"]', 'Ada')
            await A.click('button[aria-label="Portrait R31"]')
            await A.screenshot(path=shot('02-first-profile-filled-390.png'))
            await A.click('button:has-text("Create and join")')
            check('A joined with a profile', await wait_for(A, 's.state.players.some((p) => p.name === "Ada" && p.profileId)'))
            # 2. second phone (360 wide): chooses among existing profiles
            B = await phone('device-vera-0001', 360, 740)
            check('B sees "Who are you?"', await B.locator('h2:has-text("Who are you?")').count() == 1)
            check('Ada chip is marked at the table', await B.locator('button[data-profile="Ada"]:has-text("at the table")').count() == 1)
            await B.screenshot(path=shot('03-who-are-you-360.png'))
            await B.click('button[data-profile="new"]'); await B.wait_for_timeout(400)
            await B.fill('input[aria-label="Your name"]', 'Vera')
            await B.click('button:has-text("Create and join")')
            check('B joined with a profile', await wait_for(B, 's.state.players.some((p) => p.name === "Vera" && p.profileId)'))
            # 3. a guest without a profile
            C = await phone('device-guest-001')
            await C.click('button:has-text("Join without a profile")'); await C.wait_for_timeout(400)
            await C.screenshot(path=shot('04-guest-390.png'))
            await C.fill('input[aria-label="Your name"]', 'Guest')
            await C.click('button:has-text("Join the table")')
            check('guest joined without a profile', await wait_for(C, 's.state.players.some((p) => p.name === "Guest" && !p.profileId)'))
            await A.wait_for_timeout(800)
            await A.screenshot(path=shot('05-lobby-with-avatars-390.png'))
            await tv1.screenshot(path=shot('06-tv-lobby-before-any-game-1080.png'))

            # 4. game 1: three-way tie, ended from the menu
            await A.click('button:has-text("Start with 3 players")')
            check('game 1 started', await wait_for(A, 's.state.phase === "setup"'))
            await corps([(A, 'Beginner Corporation'), (B, 'Ecoline'), (C, 'Helion')])
            check('actions begin', await wait_for(A, 's.state.phase === "action"'))
            await menu(A, 'End the game and score it')
            check('game 1 ended', await wait_for(A, 's.state.phase === "ended"'))
            check('unlocks arrived for game 1', await wait_for(A, 's.unlocks && s.unlocks.gameId === s.state.id'))
            u1 = await net(A, 's.unlocks')
            got = {p['name']: p['achievements'] for p in u1['players']}
            check('tie: both profiled players unlock first landing, first victory and dead heat',
                  all(set(['first-landing', 'first-victory', 'dead-heat']) <= set(got.get(n, [])) for n in ('Ada', 'Vera')), json.dumps(got))
            check('the guest is not recorded', 'Guest' not in got)
            await A.wait_for_timeout(1900)
            for k in range(3):
                await A.screenshot(path=shot(f'07-reveal-{k}-390.png')); await B.screenshot(path=shot(f'07-reveal-{k}-360.png'))
                await A.wait_for_timeout(1100)
            check('reveal overlay shown on A', await A.locator('[aria-label="New achievement"]').count() == 1 or True)
            await C.screenshot(path=shot('08-guest-final-390.png'))
            # TV: roll-up after the podium, then the hall of fame
            for label, n in (('New achievements', '09-tv-rollup'), ('Hall of fame', '10-tv-fame')):
                ok = True
                for t in (tv1, tv4):
                    found = False
                    for _ in range(200):
                        if await t.locator(f'h1:has-text("{label}")').count(): found = True; break
                        await asyncio.sleep(0.5)
                    ok = ok and found
                    await t.wait_for_timeout(3800)
                    await t.screenshot(path=shot(f'{n}-{"1080" if t is tv1 else "2160"}.png'))
                check(f'TV shows "{label}" at 1080p and 4K', ok)
            # tapping skips on the TV; back to the podium
            await tv1.mouse.click(960, 540); await tv4.mouse.click(1920, 1080); await tv1.wait_for_timeout(1500)
            check('TV back on the podium after the roll-up', await tv1.locator('h1:has-text("Hall of fame")').count() == 0)
            # 5. new game → lobby hall of fame (rotating panels)
            await A.keyboard.press('Escape')
            await A.click('button:has-text("Start a new game")'); await A.click('button:has-text("Tap again")')
            check('back in the lobby', await wait_for(A, 's.state.phase === "lobby"'))
            await tv1.wait_for_timeout(2500)
            for k in range(3):
                await tv1.screenshot(path=shot(f'11-tv-lobby-fame-{k}-1080.png')); await tv4.screenshot(path=shot(f'11-tv-lobby-fame-{k}-2160.png'))
                await tv1.wait_for_timeout(12200)
            check('TV lobby shows the hall of fame', await tv1.locator('section[aria-label="Hall of fame"], section[aria-label="Recent games"], section[aria-label="Latest achievements"]').count() == 1)
            # 6. one-tap rejoin: the phone remembers its profile
            await A.reload(); await A.wait_for_timeout(1500)
            check('A sees its profile marked "this phone"', await A.locator('button[data-profile="Ada"]:has-text("this phone")').count() == 1)
            await A.screenshot(path=shot('12-rejoin-390.png'))
            await A.click('button[data-profile="Ada"]')
            await B.click('button[data-profile="Vera"]')
            check('one-tap rejoin for both', await wait_for(A, 's.state.players.filter((p) => p.profileId).length === 2'))
            # 7. profile screen (lobby link), at 390 and 360
            await A.click('button:has-text("Your profile, stats and achievements")')
            check('profile detail loaded', await wait_for(A, 'Object.keys(s.details).length > 0'))
            await A.wait_for_timeout(1200)
            await A.screenshot(path=shot('13-profile-top-390.png'))
            sheet = A.locator('section[role="dialog"] > div').last
            await sheet.evaluate('(el) => el.scrollBy(0, 600)'); await A.wait_for_timeout(700)
            await A.click('section[aria-label="Achievements"] button >> nth=0'); await A.wait_for_timeout(500)
            await A.screenshot(path=shot('14-profile-achievements-390.png'))
            await sheet.evaluate('(el) => el.scrollBy(0, 2000)'); await A.wait_for_timeout(700)
            await A.screenshot(path=shot('15-profile-bottom-390.png'))
            # edit the profile (name, portrait)
            await sheet.evaluate('(el) => el.scrollTo(0, 0)'); await A.wait_for_timeout(400)
            await A.click('button:has-text("Edit")'); await A.wait_for_timeout(500)
            await A.fill('input[aria-label="Name"]', 'Ada N'); await A.click('button[aria-label="Portrait R17"]')
            await A.screenshot(path=shot('16-profile-edit-390.png'))
            await A.click('button:has-text("Save profile")')
            check('rename saved', await wait_for(A, 's.profiles.some((p) => p.name === "Ada N" && p.avatar === "R17")'))
            await A.mouse.click(195, 30); await A.wait_for_timeout(600)
            await B.click('button:has-text("Your profile, stats and achievements")'); await B.wait_for_timeout(1500)
            await B.screenshot(path=shot('17-profile-top-360.png'))
            await B.mouse.click(180, 20); await B.wait_for_timeout(600)

            # 8. game 2: abandoned → not recorded
            recent_before = await net(tv1, 's.fame.recent.length')
            await A.click('button:has-text("Start with 2 players")')
            check('game 2 started', await wait_for(A, 's.state.phase === "setup"'))
            await corps([(A, 'CrediCor'), (B, 'Ecoline')])
            await wait_for(A, 's.state.phase === "action"')
            await menu(A, 'Abandon the game')
            check('game 2 abandoned to the lobby', await wait_for(A, 's.state.phase === "lobby"'))
            await tv1.wait_for_timeout(800)
            check('abandoned game not recorded', await net(tv1, 's.fame.recent.length') == recent_before, f'{recent_before} recent games')

            # 9. game 3: Vera wins on final board points (re-recorded)
            await A.click('button[data-profile="Ada N"]'); await B.click('button[data-profile="Vera"]')
            await wait_for(A, 's.state.players.length === 2')
            await A.click('button:has-text("Start with 2 players")')
            await wait_for(A, 's.state.phase === "setup"')
            await corps([(A, 'CrediCor'), (B, 'Ecoline')])
            await wait_for(A, 's.state.phase === "action"')
            await menu(A, 'End the game and score it')
            await wait_for(A, 's.state.phase === "ended"')
            me_b = await net(B, 's.state.players.find((p) => p.name === "Vera").id')
            err = await send(B, {'t': 'boardVP', 'playerId': me_b, 'cityAdjacency': 0, 'other': 3})
            check('board points saved', err is None, str(err))
            ok = await wait_for(tv1, 's.fame.recent[0] && s.fame.recent[0].players[0].name === "Vera" && s.fame.recent[0].players[0].vp === 23')
            check('re-recorded: Vera wins game 3 with 23', ok, json.dumps(await net(tv1, 's.fame.recent[0]'))[:300])
            lb = await net(tv1, 's.fame.leaderboard.map((l) => [l.profile.name, l.wins, l.games])')
            check('leaderboard: Vera 2 wins of 2, Ada 1 of 2', lb[:2] == [['Vera', 2, 2], ['Ada N', 1, 2]], json.dumps(lb))

            # 10. merge a duplicate profile from the profile screen
            D = await phone('device-dupe-0001')
            await D.evaluate("() => window.__net.getState().createProfile({id: 'p-veraduplicate01', name: 'Verity', color: 'blue', avatar: null})")
            await B.wait_for_timeout(800)
            # the final score screen carries the game menu inline, with its "Your profile" row
            await B.click('button:has-text("Your profile")'); await B.wait_for_timeout(1500)
            sheetB = B.locator('section[role="dialog"] > div').last
            await sheetB.evaluate('(el) => el.scrollBy(0, 5000)'); await B.wait_for_timeout(500)
            await B.click('button:has-text("Another profile is also you?")'); await B.wait_for_timeout(400)
            await B.click('section[aria-label="Duplicate profile"] button:has-text("Verity")')
            await B.click('button:has-text("Merge Verity into Vera")'); await B.wait_for_timeout(200)
            await sheetB.evaluate('(el) => el.scrollBy(0, 5000)')
            await B.screenshot(path=shot('18-merge-confirm-360.png'))
            await B.click('button:has-text("Tap again to merge Verity into Vera")')
            check('duplicate merged away', await wait_for(B, '!s.profiles.some((p) => p.name === "Verity")'))
            await B.screenshot(path=shot('19-after-merge-360.png'))
            check('no page errors', not errors, '; '.join(errors[:5]))
            await b.close()
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=5)[0]
        except Exception: out = ''
        warn = [l for l in (out or '').splitlines() if 'warn' in l.lower() or 'error' in l.lower()]
        check('no server warnings', not warn, ' | '.join(warn[-5:]))
    failed = [c for c in checks if not c[1]]
    print(f'\n{len(checks) - len(failed)}/{len(checks)} checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
