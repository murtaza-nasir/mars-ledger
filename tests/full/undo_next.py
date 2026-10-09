"""Undo my last move after the turn has passed to another person who has not moved yet (no bots in between).

    engine: the production engine image (SQLite; the LOCAL_FS_DB engine cannot undo or reload saves)
            docker run -d --rm --name next-engine -p 8841:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
            (or the same build tagged tm-engine:41a1b005de73)
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/undo_next.py --engine http://localhost:8841 --port 8850 --out DIR

Seats in turn order: Ada and Vera, both people (a phone page each, answered over their own sockets with `seen`), and the
TV. Ada's actions are the Power Plant standard project (no follow-up question). Each undo below is tapped on Ada's dock
("Undo my last move" / "Before the next player moves") while Vera has the turn and her menu open on her phone, unanswered;
then every screen says "Ada undid their last move" ("You undid your last move" on Ada's), Vera's phone is back to
waiting with no sheet open, and Ada's M€, energy production and actions taken are as before the move. In one game:
  pass    Ada passes at the start of her turn; undo returns to her turn menu.
  end     Ada builds one power plant (no offer yet: still her turn) and ends her turn; undo returns to before the power
          plant (End Turn alone changes nothing on the table).
  second  Ada builds two power plants, the second passes the turn; undo returns to before the second one.
  end-after-undo  Ada ends her turn; the power plant before it went with the undo's history, so undo returns to her menu
          with one action taken (the engine's own Undo covers that action there).
  closed  Ada builds a power plant (her second action); Vera starts the Aquifer standard project (its ocean question is
          still open): Ada's offer is gone (the window names Vera), and stays gone once Vera's move is finished.
  genend  Vera passes; Ada passes last, the generation ends: Ada is not offered the undo.
After each undo every screen equals the engine (gameAge, active player). Output: undo_next.json and screenshots in --out.
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402
from undo import Seat, opt_index  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = soak.ROOT

PAGE_JS = r'''() => {
  const s = window.__net && window.__net.getState();
  const fv = s && s.fullView;
  if (!fv) return null;
  const g = fv.model.game;
  const q = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
  const me = fv.role === 'player' ? fv.model.thisPlayer : null;
  return {age: g.gameAge, undo: g.undoCount, phase: g.phase, active: (fv.model.players.find((p) => p.isActive) || {}).color || null,
    mc: me ? (me.megacredits ?? me.megaCredits) : null, energyProd: me ? me.energyProduction : null, acts: me ? me.actionsTakenThisRound : null,
    w: fv.role === 'player' && fv.model.waitingFor ? (fv.model.waitingFor.title && (fv.model.waitingFor.title.message || fv.model.waitingFor.title)) : null,
    undoMine: fv.undoMine || null, dock: q('[data-testid=dock-undo-mine]'),
    notice: q('[data-testid=undo-notice]'), dialog: !!document.querySelector('[role=dialog]')};
}'''


def http_json(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8841')
    ap.add_argument('--port', type=int, default=8850)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    shot = lambda name: os.path.join(args.out, name)
    data = tempfile.mkdtemp(prefix='tm-undo-next-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400', 'VISION_ENABLED': 'false',
           'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')), 'BOT_DELAY_SCALE': '0',
           # rich corporations without a forced first action: enough M€ for every power plant and Vera's aquifer
           'ENGINE_GAME_OPTIONS': json.dumps({'customCorporationsList': ['CrediCor', 'Helion', 'Saturn Systems', 'Teractor', 'Thorgate',
                                                                        'Interplanetary Cinematics']})}
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=open(os.path.join(args.out, 'server.log'), 'w'), stderr=subprocess.STDOUT, text=True)
    report = {'checks': {}, 'notes': []}
    check = lambda k, ok, info=None: (report['checks'].__setitem__(k, {'ok': bool(ok), **({'info': info} if info is not None else {})}), print(('PASS ' if ok else 'FAIL ') + k, info if info is not None else '', flush=True))
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        A, B = Seat('m1', 'Ada', 'red'), Seat('b1', 'Vera', 'blue')
        for s in (A, B): await s.open(args.port)
        for s in (A, B): assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        assert (await A.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': A.id, 'modules': ['base', 'corpera'], 'order': ['m1', 'b1'], 'mode': 'full', 'draft': False}})) is None
        for _ in range(100):
            if A.state and A.state.get('full'): break
            await asyncio.sleep(0.1)
        link = A.state['full']
        eng = {s.id: link['players'][s.id]['engineId'] for s in (A, B)}
        spectator = lambda: http_json(f"{args.engine}/api/spectator?id={link['spectatorId']}")
        engine_player = lambda s: http_json(f"{args.engine}/api/player?id={eng[s.id]}")

        async def until(f, secs=30, step=0.1):
            t0 = time.time()
            while time.time() - t0 < secs:
                v = await f()
                if v: return v
                await asyncio.sleep(step)
            return None

        async def fresh(s, secs=8):
            """The seat's socket holds the engine's current moment (answers are made against what the engine shows)."""
            async def f():
                m = s.model(); e = engine_player(s)
                return m if m and (m['game']['gameAge'], m['game']['undoCount']) == (e['game']['gameAge'], e['game']['undoCount']) and \
                    json.dumps(m.get('waitingFor'), sort_keys=True) == json.dumps(e.get('waitingFor'), sort_keys=True) else None
            return await until(f, secs, 0.05)

        async with async_playwright() as p:
            browser = await p.chromium.launch()
            pages = {}
            for s in (A, B):
                ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, n=s.name: report['notes'].append(f'pageerror {n}: {e}'))
                await pg.goto(f'http://localhost:{args.port}/'); pages[s.name] = pg
            tv = await (await browser.new_context(viewport={'width': 1920, 'height': 1080})).new_page()
            tv.on('pageerror', lambda e: report['notes'].append(f'pageerror TV: {e}'))
            await tv.goto(f'http://localhost:{args.port}/tv'); pages['TV'] = tv
            phone, vp = pages['Ada'], pages['Vera']
            async def state(name): return await pages[name].evaluate(PAGE_JS)

            # initial cards: the richest corporation offered, no cards bought
            for _ in range(300):
                if A.wf() and B.wf(): break
                await asyncio.sleep(0.1)
            for s in (A, B):
                w = s.wf()
                corps = [c['name'] for c in w['options'][0]['cards']]
                corp = max(corps, key=lambda n: soak.CARDS.get(n, {}).get('startingMegaCredits') or 0)
                rs = [{'type': 'card', 'cards': [corp]}] + [{'type': 'card', 'cards': []} for _ in w['options'][1:]]
                assert (await s.answer({'type': 'initialCards', 'responses': rs}, seen=None)) is None

            def ada_menu():
                e = engine_player(A); w = e.get('waitingFor')
                return e if w and e['thisPlayer']['isActive'] and opt_index(w, 'pass') is not None else None

            async def menu_answer(s, kind, sub=None):
                m = await fresh(s)
                w = m and m.get('waitingFor')
                i = opt_index(w, kind)
                assert i is not None, f'{s.name}: no {kind} option in {soak.text((w or {}).get("title"))}'
                err = await s.answer({'type': 'or', 'index': i, 'response': sub(w['options'][i], m) if sub else {'type': 'option'}})
                assert err is None, f'{s.name} {kind}: {err}'

            def project(name):
                def sub(o, m):
                    c = next(c for c in o['cards'] if c['name'] == name)
                    return {'type': 'projectCard', 'card': name, 'payment': soak.pay_for(m['thisPlayer'], c['calculatedCost'], [], {})}
                return sub

            power_plant = lambda: menu_answer(A, 'standard', project('Power Plant:SP'))

            async def snapshot():
                e = engine_player(A)['thisPlayer']
                return {'age': engine_player(A)['game']['gameAge'], 'mc': e['megaCredits'] if 'megaCredits' in e else e['megacredits'],
                        'energyProd': e['energyProduction'], 'acts': e['actionsTakenThisRound']}

            async def vera_turn_with_sheet():
                """Vera has the turn, her menu open on her phone (not answered)."""
                ok = await until(lambda: _is(state('Vera'), lambda s: s and s['active'] == 'blue' and s['w']), 20)
                await vp.wait_for_timeout(700)
                if not await vp.locator('[role=dialog]').count(): await vp.click('[data-testid=dock-go]')
                await vp.locator('[role=dialog]').last.wait_for(state='visible', timeout=10000)
                return ok

            async def equal_engine(label):
                key = lambda sp: {'age': sp['game']['gameAge'], 'active': next((q['color'] for q in sp['players'] if q['isActive']), None)}
                for _ in range(40):
                    e0 = key(spectator())
                    screens = {n: {k: (await state(n))[k] for k in ('age', 'active')} for n in ('Ada', 'Vera', 'TV')}
                    e1 = key(spectator())
                    if e0 == e1 and all(v == e1 for v in screens.values()): break
                    await asyncio.sleep(0.25)
                check(f'{label}: every screen equals the engine', all(v == e1 for v in screens.values()), {'engine': e1, 'screens': screens})

            async def undo_and_check(label, want):
                """Ada's dock offers the undo with no bot moves; tap it; the game is at `want`; notices, Vera waiting, screens equal."""
                mine = await until(lambda: _is(state('Ada'), lambda s: s and s['undoMine'] and s['undoMine'].get('ok') and s['dock']), 10)
                check(f'{label}: Ada\'s dock offers "Undo my last move" (no bot moves)', mine and mine['undoMine'].get('bots') == 0 and
                      'Undo my last move' in mine['dock'] and 'Before the next player moves' in mine['dock'], mine and {'undoMine': mine['undoMine'], 'dock': mine['dock']})
                await phone.screenshot(path=shot(f'{label}-1-ada-offered.png'))
                await vp.screenshot(path=shot(f'{label}-2-vera-before.png'))
                await phone.click('[data-testid=dock-undo-mine]')
                back = await until(lambda: _is(state('Ada'), lambda s: s and s['active'] == 'red' and s['age'] == want['age']), 15)
                await phone.wait_for_timeout(400)
                texts = {n: (await state(n))['notice'] for n in ('Ada', 'Vera', 'TV')}
                check(f'{label}: every screen says what happened', texts['Ada'] == 'You undid your last move' and
                      (texts['Vera'] or '').startswith('Ada undid their last move') and texts['TV'] == 'Ada undid their last move', texts)
                now = await snapshot()
                check(f'{label}: back at Ada\'s turn before the move', back and now == want, {'now': now, 'want': want})
                vs = await until(lambda: _is(state('Vera'), lambda s: s and not s['w'] and not s['dialog'] and s['active'] == 'red'), 5)
                vs = vs or await state('Vera')
                check(f'{label}: Vera\'s phone is back to waiting (no question, no open sheet)', vs and not vs['w'] and not vs['dialog'], vs and {k: vs[k] for k in ('w', 'dialog', 'active')})
                gone = await until(lambda: _is(state('Ada'), lambda s: s and not s['dock'] and not s['undoMine']), 5)
                check(f'{label}: the offer is gone after the undo (Ada\'s own turn again)', gone)
                for n, pg in pages.items(): await pg.screenshot(path=shot(f'{label}-3-after-{n.lower()}.png'))
                await equal_engine(label)

            start = await until(lambda: _is_sync(ada_menu), 60)
            check('setup: Ada\'s first turn menu', start)
            await asyncio.sleep(1)
            await fresh(A)

            start_snap = await snapshot()
            check('setup: Ada\'s turn start (no action taken)', start_snap['acts'] == 0, start_snap)
            one_action = lambda: until(lambda: _is_sync(lambda: engine_player(A)['thisPlayer']['actionsTakenThisRound'] == 1 and ada_menu()), 10)

            # ---- pass: the first action of the turn ------------------------------------------------------------------
            await menu_answer(A, 'pass')
            await vera_turn_with_sheet()
            await undo_and_check('pass', start_snap)

            # ---- end: End Turn after one action goes back to before that action ---------------------------------------
            await power_plant()
            await one_action(); await fresh(A)
            off = await state('Ada')
            check('end: no offer while it is still Ada\'s turn', not off['dock'] and not (off['undoMine'] or {}).get('ok'), off['undoMine'])
            await menu_answer(A, 'end')
            await vera_turn_with_sheet()
            await undo_and_check('end', start_snap)

            # ---- second: two actions, the turn passes to Vera ---------------------------------------------------------
            await power_plant()
            await one_action(); await fresh(A)
            mid = await snapshot()
            await power_plant()
            check('second: the turn passed to Vera, her sheet open', await vera_turn_with_sheet())
            await undo_and_check('second', mid)

            # ---- end after an undo: the action before End Turn went with the undo's history, so End Turn alone goes
            # (Ada is back at her menu with one action taken, where the engine's own Undo covers that action)
            await fresh(A)
            await menu_answer(A, 'end')
            await vera_turn_with_sheet()
            await undo_and_check('end-after-undo', mid)

            # ---- closed: Vera starts a move, the window closes -------------------------------------------------------
            await fresh(A)
            await power_plant()
            await vera_turn_with_sheet()
            open_ = await until(lambda: _is(state('Ada'), lambda s: s and s['dock']), 10)
            check('closed: offered before Vera answers', open_)
            # Vera answers on her socket while her sheet is open: the Aquifer standard project, its ocean question pending
            await menu_answer(B, 'standard', project('Aquifer'))
            follow = await fresh(B)
            check('closed: Vera is in her move\'s follow-up question', follow and follow.get('waitingFor') and follow['waitingFor']['type'] == 'space',
                  follow and soak.text((follow.get('waitingFor') or {}).get('title')))
            gone = await until(lambda: _is(state('Ada'), lambda s: s and not s['dock'] and not (s['undoMine'] or {}).get('ok')), 8)
            check('closed: Ada\'s offer is gone once Vera started her move', gone, gone and gone['undoMine'])
            await phone.screenshot(path=shot('closed-1-ada.png'))
            m = await fresh(B)
            assert (await B.answer({'type': 'space', 'spaceId': m['waitingFor']['spaces'][0]})) is None
            await until(lambda: _is_sync(lambda: not engine_player(B).get('waitingFor') or engine_player(B)['thisPlayer']['actionsTakenThisRound'] == 1), 10)
            await asyncio.sleep(1)
            st = await state('Ada')
            check('closed: still gone once Vera\'s move is finished', not st['dock'] and not (st['undoMine'] or {}).get('ok'), st['undoMine'])

            # ---- genend: the last pass of the generation is not offered --------------------------------------------
            await fresh(B)
            if engine_player(B)['thisPlayer']['isActive']: await menu_answer(B, 'pass')
            await until(lambda: _is_sync(ada_menu), 15)
            await menu_answer(A, 'pass')
            research = await until(lambda: _is(state('Ada'), lambda s: s and s['phase'] != 'action'), 20)
            await asyncio.sleep(1.5)
            st = await state('Ada')
            check('genend: the generation ended, Ada is not offered the undo', research and not st['dock'] and not (st['undoMine'] or {}).get('ok'),
                  {'phase': st['phase'], 'undoMine': st['undoMine']})
            await phone.screenshot(path=shot('genend-ada.png'))
            await browser.close()
    finally:
        srv.terminate()
        try: srv.wait(5)
        except Exception: srv.kill()
        report['server_log_tail'] = open(os.path.join(args.out, 'server.log')).read().splitlines()[-60:]
        json.dump(report, open(os.path.join(args.out, 'undo_next.json'), 'w'), indent=1)
    bad = [k for k, v in report['checks'].items() if not v['ok']]
    print('FAILED:' if bad else 'ALL PASSED', bad, f"({len(report['checks']) - len(bad)}/{len(report['checks'])})")
    print('notes:', report['notes'][:10])


async def _is(coro, pred):
    v = await coro
    return v if pred(v) else None


async def _is_sync(f):
    return f()


if __name__ == '__main__':
    asyncio.run(main())
