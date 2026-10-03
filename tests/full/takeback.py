"""Taking moves back, end to end: "Back" out of a card's follow-up question, and undo through bot moves.

    engine: the production engine image (SQLite; the LOCAL_FS_DB engine cannot undo or reload saves)
            docker run -d --rm --name back-engine -p 8841:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/takeback.py --engine http://localhost:8841 \
                --container back-engine --port 8850 --out DIR

Seats in turn order: Ada (a person: phone page), Ares and Deimos (Normal bots at Quick), Vera (a person: phone
page). Ada's hand gets Hired Raiders and Sabotage written into the engine's newest save (test setup only).
  back    On Ada's phone (390x844): Play a card, Hired Raiders, pay. The target question opens with "Choose
          something else". The TV is sampled every 100 ms meanwhile: no card moment for Hired Raiders. Tap it: the card
          is back in hand, the M€ refunded, the turn menu open again, and no screen shows an undo notice.
  bots    Ada plays Hired Raiders for real (steals), ends the turn, the bots play at Quick until it is Vera's turn,
          and Vera's menu opens on her phone. Ada's dock shows "Undo my last move"; tap it: every screen says
          "Ada took back their move and N bot moves", the game is back at Ada's turn before Hired Raiders, Vera's
          sheet closes, and no bot moves until Ada moves again (then they do).
Afterwards every screen equals the engine (gameAge, active player). Output: takeback.json and screenshots in --out.
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402
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
    mc: me ? (me.megacredits ?? me.megaCredits) : null, hand: fv.role === 'player' ? fv.model.cardsInHand.map((c) => c.name) : null,
    w: fv.role === 'player' && fv.model.waitingFor ? (fv.model.waitingFor.title && (fv.model.waitingFor.title.message || fv.model.waitingFor.title)) : null,
    moving: fv.moving || null, back: fv.back || null, undoMine: fv.undoMine || null,
    lane: q('[data-log-lane]'), notice: q('[data-testid=undo-notice]'), stale: q('[data-testid=stale-notice]'), dialog: !!document.querySelector('[role=dialog]'),
    cardMoment: [...document.querySelectorAll('h2')].map((h) => h.textContent).filter((t) => t === 'Hired Raiders' || t === 'Sabotage')};
}'''


def http_json(url, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    with urllib.request.urlopen(r) as f:
        return json.loads(f.read())


def inject(container, game_id, engine_player, cards, mc):
    """Test setup: put cards into a player's hand in the engine's newest save and reload it."""
    js = (f"const D=require('/usr/src/app/node_modules/better-sqlite3');const d=new D('/usr/src/app/db/game.db');"
          f"const r=d.prepare('SELECT save_id, game FROM games WHERE game_id=? ORDER BY save_id DESC LIMIT 1').get('{game_id}');"
          f"const g=JSON.parse(r.game);const p=g.players.find(x=>x.id==='{engine_player}');p.cardsInHand=[...new Set([...p.cardsInHand, ...{json.dumps(cards)}])];"
          f"p.megaCredits=Math.max(p.megaCredits,{mc});d.prepare('UPDATE games SET game=? WHERE game_id=? AND save_id=?').run(JSON.stringify(g),'{game_id}',r.save_id);console.log(r.save_id)")
    out = subprocess.run(['docker', 'exec', container, 'node', '-e', js], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8841')
    ap.add_argument('--container', default='back-engine')
    ap.add_argument('--port', type=int, default=8850)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    shot = lambda name: os.path.join(args.out, name)
    data = tempfile.mkdtemp(prefix='tm-takeback-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400', 'VISION_ENABLED': 'false',
           'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')), 'BOT_DELAY_SCALE': '1',
           'BOT_LOG': os.path.join(data, 'bots.jsonl'),
           # corporations without a forced first action, so Ada's first menu can play a card
           'ENGINE_GAME_OPTIONS': json.dumps({'customCorporationsList': ['CrediCor', 'Ecoline', 'Helion', 'Mining Guild', 'PhoboLog', 'Saturn Systems',
                                                                        'Teractor', 'Thorgate', 'Interplanetary Cinematics']})}
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=open(os.path.join(args.out, 'server.log'), 'w'), stderr=subprocess.STDOUT, text=True)
    report = {'checks': {}, 'samples': [], 'notes': []}
    check = lambda k, ok, info=None: (report['checks'].__setitem__(k, {'ok': bool(ok), **({'info': info} if info is not None else {})}), print(('PASS ' if ok else 'FAIL ') + k, info if info is not None else ''))
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        mz, vera = soak.Seat('m1', 'Ada', 'red'), soak.Seat('b1', 'Vera', 'blue')
        for s in (mz, vera): await s.open(args.port)
        for s in (mz, vera): assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        for k, (bid, name, color) in enumerate([('x1', 'Ares', 'green'), ('x2', 'Deimos', 'yellow')]):
            assert (await mz.rpc({'type': 'cmd', 'command': {'t': 'addBot', 'playerId': mz.id, 'botId': bid, 'name': name, 'color': color, 'level': 'normal'}})) is None
        assert (await mz.rpc({'type': 'cmd', 'command': {'t': 'setBotSpeed', 'playerId': mz.id, 'speed': 'quick'}})) is None
        assert (await mz.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': mz.id, 'modules': ['base', 'corpera'], 'order': ['m1', 'x1', 'x2', 'b1'], 'mode': 'full', 'draft': False}})) is None
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            pages = {}
            for s in (mz, vera):
                ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, n=s.name: report['notes'].append(f'pageerror {n}: {e}'))
                await pg.goto(f'http://localhost:{args.port}/'); pages[s.name] = pg
            tvctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
            tv = await tvctx.new_page(); tv.on('pageerror', lambda e: report['notes'].append(f'pageerror TV: {e}'))
            await tv.goto(f'http://localhost:{args.port}/tv'); pages['TV'] = tv
            phone = pages['Ada']
            # initial cards over the sockets: the first corporation, no cards bought
            for _ in range(300):
                if mz.wf() and vera.wf(): break
                await asyncio.sleep(0.1)
            for s in (mz, vera):
                w = s.wf()
                rs = [{'type': 'card', 'cards': [w['options'][0]['cards'][0]['name']]}] + [{'type': 'card', 'cards': []} for _ in w['options'][1:]]
                assert (await s.rpc({'type': 'input', 'playerId': s.id, 'response': {'type': 'initialCards', 'responses': rs}})) is None
            # wait for Ada's turn menu (he goes first)
            async def until(f, secs=30, step=0.1):
                t0 = time.time()
                while time.time() - t0 < secs:
                    v = await f()
                    if v: return v
                    await asyncio.sleep(step)
                return None
            async def state(name): return await pages[name].evaluate(PAGE_JS)
            st = await until(lambda: state('Ada'), 30)
            await until(lambda: _is(state('Ada'), lambda s: s and s['phase'] == 'action' and s['active'] == 'red' and (s['w'] or '').startswith('Take your')), 40)
            game_id = mz.state['full']['gameId']; engine_m = mz.state['full']['players']['m1']['engineId']
            inject(args.container, game_id, engine_m, ['Hired Raiders', 'Sabotage'], 30)
            http_json(f'{args.engine}/load_game', {'gameId': game_id, 'rollbackCount': 0}, 'PUT')
            before = await until(lambda: _is(state('Ada'), lambda s: s and 'Hired Raiders' in (s['hand'] or [])), 10)
            check('setup: Hired Raiders in hand on the phone', before, before and {'mc': before['mc'], 'hand': before['hand']})
            await phone.screenshot(path=shot('01-phone-before.png'))

            # ---- back ----------------------------------------------------------------------------------------------
            # the TV first finishes the corporation reveal (a card moment would wait behind it and prove nothing)
            idle = await until(lambda: tv.evaluate("() => !document.body.innerText.includes('The corporations of Mars')"), 60, 0.3)
            await asyncio.sleep(2)
            check('setup: the TV is idle (reveal over)', idle)
            await phone.click('[data-testid=dock-go]')
            await phone.wait_for_timeout(600)
            await phone.screenshot(path=shot('01b-phone-menu.png'))
            await phone.get_by_text('Play a card', exact=True).click()
            await phone.wait_for_timeout(600)
            await phone.screenshot(path=shot('01c-phone-play-list.png'))
            await phone.click('[data-card="Hired Raiders"]')
            await phone.get_by_role('button', name='Play Hired Raiders', exact=False).click()
            back_btn = phone.locator('[data-testid=back-out]')
            await back_btn.wait_for(state='visible', timeout=10000)
            await phone.wait_for_timeout(400)
            mid = await state('Ada')
            check('back: the follow-up question offers "Choose something else"', mid and mid['back'] and mid['back'].get('ok'), mid and {'w': mid['w'], 'back': mid['back'], 'mc': mid['mc']})
            await phone.screenshot(path=shot('02-phone-follow-up-with-back.png'))
            # the TV, sampled while the question is open: no card moment for Hired Raiders
            tv_moments, tv_lane = [], []
            for _ in range(30):
                t = await state('TV'); tv_moments += t['cardMoment'] if t else []
                if t and 'Hired Raiders' in (t['lane'] or ''): tv_lane.append(t['lane'])
                await asyncio.sleep(0.1)
            check('back: the TV ticker holds the move while its question is open', not tv_lane, tv_lane[:1])
            await tv.screenshot(path=shot('03-tv-during-follow-up.png'))
            tv_state = await state('TV')
            check('back: the TV has not announced the card while its question is open', not tv_moments, {'moments': tv_moments, 'moving': tv_state and tv_state['moving']})
            await back_btn.click()
            after = await until(lambda: _is(state('Ada'), lambda s: s and 'Hired Raiders' in (s['hand'] or []) and (s['w'] or '').startswith('Take your')), 10)
            await phone.wait_for_timeout(700)
            after = await state('Ada')
            menu_open = await phone.locator('[data-opt]').count()
            check('back: card back in hand, M€ refunded, turn menu open again', after and after['mc'] == before['mc'] and 'Hired Raiders' in after['hand'] and menu_open > 0,
                  after and {'mc': after['mc'], 'before_mc': before['mc'], 'hand': after['hand'], 'menu_rows': menu_open, 'dialog': after['dialog']})
            await phone.screenshot(path=shot('04-phone-after-back.png'))
            notices = {n: (await state(n))['notice'] for n in ('Ada', 'Vera', 'TV')}
            check('back: no undo notice on any screen', not any(notices.values()), notices)
            await pages['Vera'].screenshot(path=shot('05-vera-after-back.png'))
            await tv.screenshot(path=shot('06-tv-after-back.png'))
            tv_after = []
            for _ in range(15):
                t = await state('TV'); tv_after += t['cardMoment'] if t else []
                await asyncio.sleep(0.1)
            check('back: the TV never shows the taken-back card', not tv_after, tv_after)

            # ---- bots -----------------------------------------------------------------------------------------------
            pre = await state('Ada')
            await phone.get_by_text('Play a card', exact=True).click()
            await phone.click('[data-card="Hired Raiders"]')
            await phone.get_by_role('button', name='Play Hired Raiders', exact=False).click()
            await phone.locator('[data-testid=back-out]').wait_for(state='visible', timeout=10000)
            steal = phone.locator('button', has_text='Steal').first
            await steal.click()
            done = await until(lambda: _is(state('Ada'), lambda s: s and (s['w'] or '').startswith('Take your next action')), 10)
            # the card moment shows once the move is done
            seen_after_done = await until(lambda: _is(state('TV'), lambda s: s and 'Hired Raiders' in s['cardMoment']), 8, 0.1)
            check('bots: the card moment shows once the move is finished', seen_after_done)
            # the finished move closes the sheet; open the menu from the dock once it has settled
            await phone.wait_for_timeout(1500)
            if not await phone.locator('[data-opt]').count(): await phone.click('[data-testid=dock-go]')
            await phone.wait_for_timeout(600)
            await phone.get_by_text('End turn', exact=True).click()
            t_end = time.time()
            # the bots play at Quick until it is Vera's turn
            vera_turn = await until(lambda: _is(state('Vera'), lambda s: s and s['active'] == 'blue' and s['w']), 90, 0.2)
            bots_time = time.time() - t_end
            check('bots: Ares and Deimos played their turns at Quick, now Vera', vera_turn, {'seconds': round(bots_time, 1)})
            bp = pages['Vera']
            await bp.click('[data-testid=dock-go]')
            await bp.wait_for_timeout(500)
            mine = await until(lambda: _is(state('Ada'), lambda s: s and s['undoMine'] and s['undoMine'].get('ok')), 10)
            check('bots: Ada\'s phone offers "Undo my last move" with the bot moves', mine and await phone.locator('[data-testid=dock-undo-mine]').count() == 1,
                  mine and mine['undoMine'])
            await phone.screenshot(path=shot('07-phone-undo-mine-offered.png'))
            await bp.screenshot(path=shot('08-vera-menu-open.png'))
            n_bots = mine['undoMine']['bots'] if mine else None
            bot_log = os.path.join(data, 'bots.jsonl')
            lines_before = sum(1 for _ in open(bot_log)) if os.path.exists(bot_log) else 0
            await phone.click('[data-testid=dock-undo-mine]')
            back_at = await until(lambda: _is(state('Ada'), lambda s: s and s['active'] == 'red' and s['age'] == pre['age']), 15)
            await phone.wait_for_timeout(300)
            texts = {}
            for n in ('Ada', 'Vera', 'TV'):
                texts[n] = (await state(n))['notice']
            await phone.screenshot(path=shot('09-phone-after-undo.png'))
            await bp.screenshot(path=shot('10-vera-after-undo.png'))
            await tv.screenshot(path=shot('11-tv-after-undo.png'))
            want_other = f'Ada took back their move and {n_bots} bot moves'
            check('bots: every screen says what happened', texts['Ada'] == f'You took back your move and {n_bots} bot moves' and (texts['Vera'] or '').startswith(want_other) and texts['TV'] == want_other, texts)
            back_state = await state('Ada')
            check('bots: back at Ada\'s turn before Hired Raiders (card in hand, M€ as before)',
                  back_at and 'Hired Raiders' in back_state['hand'] and back_state['mc'] == pre['mc'] and back_state['active'] == 'red',
                  {'age': back_state['age'], 'pre_age': pre['age'], 'mc': back_state['mc'], 'pre_mc': pre['mc'], 'hand': back_state['hand']})
            bs = await state('Vera')
            check('bots: Vera\'s phone is not stuck (no question, no open sheet)', bs and not bs['w'] and not bs['dialog'], bs and {'w': bs['w'], 'dialog': bs['dialog'], 'active': bs['active']})
            # the bots hold: nothing for a few seconds (it is Ada's turn anyway), then Ada moves and they play again
            await asyncio.sleep(4)
            lines_hold = sum(1 for _ in open(bot_log)) if os.path.exists(bot_log) else 0
            check('bots: no bot move after the undo while Ada has not moved', lines_hold == lines_before, {'bot_log_lines': [lines_before, lines_hold]})
            await phone.wait_for_timeout(1000)
            if not await phone.locator('[data-opt]').count(): await phone.click('[data-testid=dock-go]')
            await phone.wait_for_timeout(600)
            await phone.get_by_text('Pass for this generation', exact=True).click()
            await phone.get_by_text('Tap again to pass', exact=True).click()
            moved = await until(lambda: _is_sync(lambda: (sum(1 for _ in open(bot_log)) if os.path.exists(bot_log) else 0) > lines_hold), 30, 0.2)
            check('bots: they play again once Ada has moved', moved)
            await asyncio.sleep(1.5)
            # every screen equals the engine, read at a quiet moment (the engine the same before and after the screens)
            spec = lambda: http_json(f"{args.engine}/api/spectator?id={mz.state['full']['spectatorId']}")
            key = lambda sp: {'age': sp['game']['gameAge'], 'active': next((q['color'] for q in sp['players'] if q['isActive']), None)}
            for _ in range(40):
                e0 = key(spec())
                screens = {n: {k: (await state(n))[k] for k in ('age', 'active')} for n in ('Ada', 'Vera', 'TV')}
                eng = key(spec())
                if eng == e0 and all(v == eng for v in screens.values()): break
                await asyncio.sleep(0.5)
            check('end: every screen equals the engine', all(v['age'] == eng['age'] and v['active'] == eng['active'] for v in screens.values()), {'engine': eng, 'screens': screens})
            for n, pg in pages.items(): await pg.screenshot(path=shot(f'12-end-{n.lower()}.png'))
            await browser.close()
    finally:
        srv.terminate()
        try: srv.wait(5)
        except Exception: srv.kill()
        report['server_log_tail'] = open(os.path.join(args.out, 'server.log')).read().splitlines()[-60:]
        json.dump(report, open(os.path.join(args.out, 'takeback.json'), 'w'), indent=1)
    bad = [k for k, v in report['checks'].items() if not v['ok']]
    print('FAILED:' if bad else 'ALL PASSED', bad)
    print('notes:', report['notes'][:10])


async def _is(coro, pred):
    v = await coro
    return v if pred(v) else None


async def _is_sync(f):
    return f()


if __name__ == '__main__':
    asyncio.run(main())
