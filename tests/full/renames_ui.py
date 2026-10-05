"""A player renamed mid-game, end to end: two phones and a TV in a full game; one player edits her profile name on her
phone, and without a reload every screen shows the new name (src/shared/names.ts).

    engine: docker run -d --rm --name renames-engine -p 9701:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    CLIENT_DIST=<build dir> SERVER_JS=<dist-server/index.js> python3 tests/full/renames_ui.py --engine http://localhost:9701 --port 9702 --shots <dir>

Checked after the rename, with no reload: the TV player panels, milestone/award chips, the log ticker and the whole TV
text; the other phone's table picker, other-table title, Mars tab, log tab and hit notices (including a notice stored with
the old name, the format before this change); the renamed phone itself; then, at the end, both phones' final scores,
the TV podium and story, and the hall of fame's recent game. Nothing anywhere may still read the old name.
"""
import argparse, asyncio, glob, json, os, random, sqlite3, subprocess, sys, tempfile, time, urllib.request
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(__file__))
from soak import Bot, Seat, focus_options, text  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OLD, NEW = 'NOVA', 'Nova Lane'
checks = []


def check(name, ok, detail=''):
    checks.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''), flush=True)


async def body(page):
    return await page.evaluate('() => document.body.innerText')


async def until(fn, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        if await fn(): return True
        await asyncio.sleep(0.25)
    return False


async def play(seats, bot, stop, limit=4000):
    """Answer every open question through the seats' sockets until stop() says so."""
    for _ in range(limit):
        m0 = seats[0].any_model()
        if stop(m0): return True
        moved = False
        for s in seats:
            w = s.wf()
            if not w or w.get('optional'): continue
            ans = bot.answer(w, s.model()['thisPlayer'], s.model(), s.sig())
            if not ans: raise RuntimeError(f'no answer for {s.name}: {w["type"]} {text(w.get("title"))}')
            before = s.sig()
            err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': ans[0]})
            if err:
                where = (); r = ans[0]
                while r.get('type') == 'or': where += (r['index'],); r = r['response']
                if r.get('type') == 'projectCard': where += ('card', r['card'])
                if r.get('type') == 'card' and r.get('cards'): where += ('card', r['cards'][0])
                bot.failed.add((before, where))
            for _ in range(60):
                if s.sig() != before: break
                await asyncio.sleep(0.05)
            moved = True
            break
        if not moved: await asyncio.sleep(0.1)
    return False


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:9701')
    ap.add_argument('--port', type=int, default=9702)
    ap.add_argument('--shots', required=True)
    args = ap.parse_args()
    os.makedirs(args.shots, exist_ok=True)
    shot = lambda n: os.path.join(args.shots, n)
    data = tempfile.mkdtemp(prefix='tm-renames-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400',
           'VISION_ENABLED': 'false', 'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')),
           'ENGINE_GAME_OPTIONS': json.dumps(focus_options(2))}
    log = open(os.path.join(data, 'server.log'), 'w')
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    url = f'http://localhost:{args.port}'
    errors = []
    try:
        for _ in range(100):
            try: urllib.request.urlopen(url + '/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        A, B = Seat('ra', 'Ada', 'red'), Seat('rb', OLD, 'blue')
        for s in (A, B): await s.open(args.port)
        for s in (A, B):
            pid = 'prof-' + s.id
            assert (await s.rpc({'type': 'profile', 'op': 'create', 'device': s.id, 'profile': {'id': pid, 'name': s.name, 'color': s.color, 'avatar': None}})) is None
            assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color, 'profileId': pid}})) is None
            s.profile_id = pid
        err = await A.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': A.id, 'modules': ['base', 'corpera'], 'order': [A.id, B.id], 'mode': 'full', 'draft': False}})
        assert err is None, err

        async with async_playwright() as pw:
            br = await pw.chromium.launch(args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])

            async def phone(dev, profile):
                ctx = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{dev}');localStorage.setItem('mars-ledger-profile','{profile}')}}catch(e){{}}")
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, d=dev: errors.append(f'{d}: {e}'))
                await pg.goto(url); await pg.wait_for_timeout(1500)
                return pg

            tvctx = await br.new_context(viewport={'width': 1920, 'height': 1080})
            tv = await tvctx.new_page(); tv.on('pageerror', lambda e: errors.append(f'tv: {e}'))
            await tv.goto(url + '/tv')
            pa, pb = await phone(A.id, A.profile_id), await phone(B.id, B.profile_id)

            # play into generation 2 (both players have moved, so the log, ticker and story name them)
            bot = Bot(random.Random(7))
            for _ in range(200):
                if A.wf() and B.wf(): break
                await asyncio.sleep(0.1)
            ok = await play([A, B], bot, lambda m: m and m['game']['generation'] >= 2 and m['game']['phase'] == 'action'
                            and any(p['color'] == 'blue' and p['isActive'] for p in m['players']))
            check('the game reached generation 2 with NOVA to move', ok)
            await asyncio.sleep(3)

            # an old notice for Ada naming NOVA, stored as notices were stored before this change (colour + byName)
            db = glob.glob(os.path.join(data, '*.db'))[0]
            age = A.model()['game']['gameAge']
            n = {'id': 'seeded-old-hit', 'kind': 'hit', 'at': int(time.time() * 1000), 'generation': 2, 'age': age, 'undo': 0, 'by': 'blue', 'byName': OLD,
                 'cause': {'how': 'played', 'card': 'Herbivores'}, 'changes': [{'what': 'stock', 'resource': 'plants', 'amount': 2, 'stolen': False}], 'sticky': True}
            game = A.state['full']['gameId']
            con = sqlite3.connect(db, timeout=10)
            con.execute('INSERT INTO notices (id, game, seat, at, age, kind, cleared, json) VALUES (?, ?, ?, ?, ?, ?, 0, ?)', (n['id'], game, A.id, n['at'], age, 'hit', json.dumps(n)))
            con.commit(); con.close()
            await pa.reload(); await pa.wait_for_timeout(2500)
            check('before: Ada sees the stored hit naming NOVA', OLD in await pa.locator('[data-testid=hit-row]').first.inner_text())
            check('before: the TV shows NOVA', OLD in await body(tv))
            await tv.screenshot(path=shot('01-before-tv.png'))
            await pa.screenshot(path=shot('01-before-phone-ada.png'))

            # the rename, on NOVA's own phone: menu, Your profile, Edit, new name, Save
            await pb.click('button[aria-label="Game menu"]'); await pb.wait_for_timeout(700)
            await pb.click('button:has-text("Your profile")'); await pb.wait_for_timeout(1200)
            await pb.screenshot(path=shot('02-profile-sheet.png'))
            await pb.click('button:has-text("Edit")'); await pb.wait_for_timeout(400)
            await pb.fill('input[aria-label="Name"]', NEW)
            await pb.screenshot(path=shot('02-rename-on-phone.png'))
            t_rename = time.time()
            await pb.click('button:has-text("Save profile")'); await pb.wait_for_timeout(800)
            await pb.keyboard.press('Escape'); await pb.wait_for_timeout(600)

            # every screen, without a reload
            await asyncio.sleep(1.0)
            linger = await tv.evaluate('''(old) => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && (e.textContent || '').includes(old)).map((e) => e.outerHTML.slice(0, 160))''', OLD)
            print('TV elements with the old name 1 s after saving:', linger[:5], flush=True)
            gone = await until(lambda: _no_old(tv))
            check('TV: no screen text reads NOVA any more', gone, f'{time.time() - t_rename:.1f}s after saving')
            check('TV player panel shows the new name', NEW in ' '.join(await tv.locator('[data-player-name]').all_inner_texts()))
            ticker = await tv.locator(f'[aria-label^="{NEW}:"]').count()
            check('TV ticker names the new name', ticker > 0, f'{ticker} items')
            check('TV ticker has no item for NOVA', await tv.locator(f'[aria-label^="{OLD}:"]').count() == 0)
            await tv.screenshot(path=shot('03-after-tv.png'))
            check("Ada's phone: no text reads NOVA", await until(lambda: _no_old(pa)))
            check("Ada's stored hit now names the new name", NEW in await pa.locator('[data-testid=hit-row]').first.inner_text())
            await pa.screenshot(path=shot('04-after-phone-ada-hits.png'))
            # the other phone's table picker and the other table
            await pa.click('button[role=tab]:has-text("Table"), [role=tab]:has-text("Table")'); await pa.wait_for_timeout(600)
            await pa.click('button[aria-label*="Show another"]'); await pa.wait_for_timeout(500)
            seat = await pa.locator('[data-table-seat=blue]').inner_text()
            check("Ada's table picker lists the new name", NEW in seat, seat.strip())
            await pa.screenshot(path=shot('05-after-phone-ada-picker.png'))
            await pa.click('[data-table-seat=blue]'); await pa.wait_for_timeout(700)
            title = await pa.locator('[data-testid=other-table-title]').inner_text()
            check("Ada's view of the other table is titled with the new name", NEW in title, title.strip())
            await pa.screenshot(path=shot('06-after-phone-ada-other-table.png'))
            await pa.click('[role=tab]:has-text("Log")'); await pa.wait_for_timeout(800)
            logtxt = await body(pa)
            check("Ada's log names the new name, never NOVA", NEW in logtxt and OLD not in logtxt)
            await pa.screenshot(path=shot('07-after-phone-ada-log.png'))
            await pa.click('[role=tab]:has-text("Mars")'); await pa.wait_for_timeout(600)
            check("Ada's Mars tab (milestones and awards) has no NOVA", OLD not in await body(pa))
            check("NOVA's own phone has no NOVA", await until(lambda: _no_old(pb)))
            await pb.screenshot(path=shot('08-after-phone-nova.png'))
            st = await pa.evaluate('() => { const s = window.__net.getState(); return {view: s.fullView.model.players.map((p) => p.name), story: (s.history?.players ?? []).map((p) => p.name), notices: (s.notices?.notices ?? []).map((n) => n.byName)} }')
            check("Ada's store: views, story and notices carry the new name", OLD not in json.dumps(st) and NEW in json.dumps(st), json.dumps(st))
            check('the server state renamed the seat (a command in the log)', next(p for p in A.state['players'] if p['id'] == B.id)['name'] == NEW)

            # to the end: results on both phones, the TV podium and story, the hall of fame
            ok = await play([A, B], bot, lambda m: m and m['game']['phase'] == 'end', limit=20000)
            check('the game finished', ok)
            await asyncio.sleep(5)
            for nm, pg in (('ada', pa), ('nova', pb)):
                try: await pg.locator('[data-testid=final-score]').wait_for(timeout=30000)
                except Exception: await pg.screenshot(path=shot(f'09-results-phone-{nm}-missing.png'))
                fs = await pg.locator('[data-testid=final-score]').inner_text() if await pg.locator('[data-testid=final-score]').count() else await body(pg)
                check(f"{nm}'s final score names the new name, never NOVA", NEW in fs and OLD not in fs)
                await pg.screenshot(path=shot(f'09-results-phone-{nm}.png'))
            seen = set()
            for k in range(24):
                t = await body(tv)
                if OLD in t: seen.add('old')
                if NEW in t: seen.add('new')
                if k % 4 == 0: await tv.screenshot(path=shot(f'10-results-tv-{k:02d}.png'))
                await asyncio.sleep(1.5)
            check('TV end story and podium show the new name and never NOVA', seen == {'new'}, str(seen))
            for _ in range(40):
                if A.fame and A.fame.get('recent'): break
                await asyncio.sleep(0.25)
            recent = json.dumps((A.fame or {}).get('recent', [])[:1])
            check('hall of fame recent game names the new name', NEW in recent and OLD not in recent)
            await br.close()
    finally:
        srv.terminate()
        try: srv.wait(5)
        except Exception: srv.kill()
        log.close()
    warnings = [l for l in open(os.path.join(data, 'server.log')) if 'warn' in l.lower() or 'error' in l.lower()]
    check('no page errors', not errors, '; '.join(errors[:3]))
    print('server warnings:', len(warnings)); [print('  ', l.rstrip()) for l in warnings[:15]]
    print(f'{sum(ok for _, ok, _ in checks)}/{len(checks)} checks passed')
    sys.exit(0 if all(ok for _, ok, _ in checks) else 1)


async def _no_old(page):
    return OLD not in await body(page)


if __name__ == '__main__':
    asyncio.run(main())
