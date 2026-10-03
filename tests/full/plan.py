"""Turn planning on the phone, end to end: the effect preview, a planned second action, a plan that stops working,
and the off-turn tray. Everything here is private to Ada's phone: the TV and Vera's phone must not change while she
plans, and no message about it may leave her phone.

    engine: the production engine image (SQLite: test setup writes cards into the newest save and reloads it)
            docker run -d --rm --name plan-engine -p 9121:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/plan.py --engine http://localhost:9121 --container plan-engine \
                --port 9122 --out DIR

Seats: Ada (red, first) and Vera (blue), each a phone page at 390x844, and a TV page at 1920x1080. Ada's hand gets
Nuclear Power, Comet, Lichen, Mining Expedition and Colonizer Training Camp written into the engine's save (oxygen 5%).
  preview    Play a card, Nuclear Power: the payment sheet shows "−10 M€ · −2 M€ production · +3 energy production ...".
  plan       "Plan my second action": the projected numbers after Nuclear Power, Comet possible; plan it (dashed, Planned).
             While planning, the TV and Vera's phone show the same game, and Ada's phone sends nothing.
  confirm    Pay for Nuclear Power: the menu opens with "Your planned move: Play Comet"; Confirm opens Comet's payment
             (nothing is played by itself); pay, place the ocean; the engine has Comet played, the plan is gone.
  tray       Vera's turn: Ada's Hand tab chip opens the tray; pin two cards; totals against M€ plus income. Vera
             moves (a standard project) and the pins stay; a reload keeps them.
  invalid    Ada's next turn: plan Colonizer Training Camp (5% oxygen at most) after Lichen, then play Mining Expedition
             instead (oxygen to 6%): "Oxygen is now 6%, above this card's 5% maximum." and Confirm is off; Drop clears it.
Output: plan.json and screenshots in --out.
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
  const me = fv.role === 'player' ? fv.model.thisPlayer : null;
  return {age: g.gameAge, undo: g.undoCount, phase: g.phase, gen: g.generation, oxygen: g.oxygenLevel, oceans: g.oceans, temperature: g.temperature,
    active: (fv.model.players.find((p) => p.isActive) || {}).color || null,
    mc: me ? me.megacredits : null, acts: me ? me.actionsTakenThisRound : null, hand: fv.role === 'player' ? fv.model.cardsInHand.map((c) => c.name) : null,
    tableau: me ? me.tableau.map((c) => c.name) : null,
    w: fv.role === 'player' && fv.model.waitingFor ? (fv.model.waitingFor.title && (fv.model.waitingFor.title.message || fv.model.waitingFor.title)) : null,
    players: fv.model.players.map((p) => [p.color, p.megacredits, p.terraformRating, p.cardsInHandNbr, p.tableau.length].join(':')).join('|'),
    plans: (() => { try { return localStorage.getItem('mars-ledger-plans'); } catch (e) { return null; } })(),
    sent: (window.__sent || []).slice()};
}'''

# every message a page sends over its socket, by type (a plan must add none)
SPY = r'''(() => {
  const orig = WebSocket.prototype.send;
  window.__sent = [];
  WebSocket.prototype.send = function (d) { try { const m = JSON.parse(d); window.__sent.push(m.type + (m.command ? ':' + m.command.t : '')); } catch (e) { window.__sent.push('raw'); } return orig.call(this, d); };
})();'''


def http_json(url, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method or ('POST' if data else 'GET'))
    with urllib.request.urlopen(r) as f:
        return json.loads(f.read())


def patch_save(container, game_id, engine_player, cards, fields, game_fields):
    """Test setup: cards into a player's hand and numbers into the engine's newest save (then reload it)."""
    js = (f"const D=require('/usr/src/app/node_modules/better-sqlite3');const d=new D('/usr/src/app/db/game.db');"
          f"const r=d.prepare('SELECT save_id, game FROM games WHERE game_id=? ORDER BY save_id DESC LIMIT 1').get('{game_id}');"
          f"const g=JSON.parse(r.game);const p=g.players.find(x=>x.id==='{engine_player}');p.cardsInHand=[...new Set([...p.cardsInHand, ...{json.dumps(cards)}])];"
          f"Object.assign(p,{json.dumps(fields)});Object.assign(g,{json.dumps(game_fields)});"
          f"d.prepare('UPDATE games SET game=? WHERE game_id=? AND save_id=?').run(JSON.stringify(g),'{game_id}',r.save_id);console.log(r.save_id)")
    out = subprocess.run(['docker', 'exec', container, 'node', '-e', js], capture_output=True, text=True)
    assert out.returncode == 0, out.stderr


PAY_KEYS = ['megacredits', 'steel', 'titanium', 'heat', 'plants', 'microbes', 'floaters', 'lunaArchivesScience', 'spireScience', 'seeds',
            'auroraiData', 'graphene', 'kuiperAsteroids']


def title(o):
    t = o.get('title')
    return (t.get('message') if isinstance(t, dict) else t) or ''


async def _is(coro, pred):
    v = await coro
    return v if pred(v) else None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:9121')
    ap.add_argument('--container', default='plan-engine')
    ap.add_argument('--port', type=int, default=9122)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    shot = lambda name: os.path.join(args.out, name)
    data = tempfile.mkdtemp(prefix='tm-plan-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400', 'VISION_ENABLED': 'false',
           'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')),
           'ENGINE_GAME_OPTIONS': json.dumps({'customCorporationsList': ['CrediCor', 'Ecoline', 'Helion', 'Mining Guild', 'PhoboLog', 'Saturn Systems',
                                                                        'Teractor', 'Thorgate', 'Interplanetary Cinematics']})}
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=open(os.path.join(args.out, 'server.log'), 'w'), stderr=subprocess.STDOUT, text=True)
    report = {'checks': {}, 'notes': []}
    check = lambda k, ok, info=None: (report['checks'].__setitem__(k, {'ok': bool(ok), **({'info': info} if info is not None else {})}), print(('PASS ' if ok else 'FAIL ') + k, info if info is not None else ''))
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        ada, vera = soak.Seat('m1', 'Ada', 'red'), soak.Seat('b1', 'Vera', 'blue')
        for s in (ada, vera): await s.open(args.port)
        for s in (ada, vera): assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        assert (await ada.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': ada.id, 'modules': ['base', 'corpera'], 'order': ['m1', 'b1'], 'mode': 'full', 'draft': False}})) is None
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            pages = {}
            for s in (ada, vera):
                ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
                await ctx.add_init_script(SPY)
                pg = await ctx.new_page(); pg.on('pageerror', lambda e, n=s.name: report['notes'].append(f'pageerror {n}: {e}'))
                await pg.goto(f'http://localhost:{args.port}/'); pages[s.name] = pg
            tvctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
            tv = await tvctx.new_page(); tv.on('pageerror', lambda e: report['notes'].append(f'pageerror TV: {e}'))
            await tv.goto(f'http://localhost:{args.port}/tv'); pages['TV'] = tv
            phone = pages['Ada']
            for _ in range(300):
                if ada.wf() and vera.wf(): break
                await asyncio.sleep(0.1)
            for s in (ada, vera):
                w = s.wf()
                rs = [{'type': 'card', 'cards': [w['options'][0]['cards'][0]['name']]}] + [{'type': 'card', 'cards': []} for _ in w['options'][1:]]
                assert (await s.rpc({'type': 'input', 'playerId': s.id, 'response': {'type': 'initialCards', 'responses': rs}})) is None

            async def until(f, secs=30, step=0.1):
                t0 = time.time()
                while time.time() - t0 < secs:
                    v = await f()
                    if v: return v
                    await asyncio.sleep(step)
                return None
            async def state(name): return await pages[name].evaluate(PAGE_JS)

            await until(lambda: _is(state('Ada'), lambda s: s and s['phase'] == 'action' and s['active'] == 'red' and (s['w'] or '').startswith('Take your')), 40)
            game_id = ada.state['full']['gameId']; engine_m = ada.state['full']['players']['m1']['engineId']
            hand = ['Nuclear Power', 'Comet', 'Lichen', 'Mining Expedition', 'Colonizer Training Camp']
            patch_save(args.container, game_id, engine_m, hand, {'megaCredits': 40, 'heat': 8}, {'oxygenLevel': 5, 'temperature': -20})
            http_json(f'{args.engine}/load_game', {'gameId': game_id, 'rollbackCount': 0}, 'PUT')
            before = await until(lambda: _is(state('Ada'), lambda s: s and 'Comet' in (s['hand'] or []) and s['mc'] == 40), 10)
            check('setup: the cards are in hand on the phone, 40 M€, oxygen 5%', before, before and {'mc': before['mc'], 'hand': before['hand'], 'oxygen': before['oxygen']})
            await until(lambda: tv.evaluate("() => !document.body.innerText.includes('The corporations of Mars')"), 60, 0.3)
            await asyncio.sleep(2)

            # ---- preview on the turn menu and the payment sheet ------------------------------------------------------
            await phone.click('[data-testid=dock-go]')
            await phone.wait_for_timeout(700)
            heat_sub = await phone.locator('[data-opt-sub=heat]').text_content()
            check('preview: the heat option says what it does', heat_sub == '−8 heat · raises temperature 1 step · +1 TR', heat_sub)
            await phone.screenshot(path=shot('01-turn-menu-preview.png'))
            await phone.get_by_text('Play a card', exact=True).click()
            await phone.wait_for_timeout(500)
            await phone.click('[data-card="Nuclear Power"]')
            await phone.wait_for_timeout(600)
            np_cost = await phone.evaluate("() => window.__net.getState().fullView.model.cardsInHand.find((c) => c.name === 'Nuclear Power').calculatedCost")
            line = await phone.locator('[data-testid=effect-preview-line]').text_content()
            check('preview: the payment sheet shows the effect before paying',
                  line.startswith(f'\u2212{np_cost} M€ · \u22122 M€ production · +3 energy production'), line)
            await phone.screenshot(path=shot('02-payment-preview.png'))

            # ---- plan the second action (private) ------------------------------------------------------------------
            tv_before = await state('TV'); vera_before = await state('Vera')
            sent_before = (await state('Ada'))['sent']
            await tv.screenshot(path=shot('03a-tv-before-planning.png'))
            await phone.click('[data-testid=plan-second]')
            await phone.locator('[data-testid=planner]').wait_for(state='visible', timeout=5000)
            await phone.wait_for_timeout(500)
            proj_mc = await phone.locator('[data-proj-stock=megacredits]').text_content()
            proj_hand = await phone.locator('[data-testid=proj-hand]').text_content()
            check('plan: the projected numbers after Nuclear Power (40 M€ less its price, 4 cards left in hand)', proj_mc == str(40 - np_cost) and '4' in proj_hand, {'mc': proj_mc, 'hand': proj_hand})
            comet = phone.locator('[data-plan-candidate="play:Comet"]')
            verdict = await comet.get_attribute('data-verdict')
            check('plan: Comet is possible after the first move', verdict == 'yes', verdict)
            await phone.screenshot(path=shot('03-planner.png'), full_page=True)
            await comet.click()
            await phone.wait_for_timeout(400)
            second = await phone.locator('[data-testid=second-preview-line]').text_content()
            check('plan: the second move is previewed against the projection (an ocean, paid for)', 'places an ocean' in second, second)
            await phone.screenshot(path=shot('04-planner-pick.png'))
            await phone.click('[data-testid=plan-this]')
            await phone.wait_for_timeout(500)
            pending = phone.locator('[data-testid=plan-pending]')
            ptxt = await pending.text_content()
            style = await pending.evaluate("e => getComputedStyle(e).borderTopStyle")
            check('plan: shown as tentative (dashed outline, "Planned")', 'Planned' in ptxt and 'Play Comet' in ptxt and style == 'dashed', {'text': ptxt, 'border': style})
            await phone.screenshot(path=shot('05-plan-pending.png'))
            # nothing left the phone, and the TV and Vera show the same game
            mid = await state('Ada')
            sent = mid['sent'][len(sent_before):]
            moves = [m for m in sent if m.split(':')[0] in ('input', 'cmd', 'hover', 'flick', 'rewind', 'react', 'reaction')]
            check('private: planning sent nothing from the phone (no input, hover, flick or command)', not moves, {'sent': sent})
            tv_now = await state('TV'); vera_now = await state('Vera')
            check('private: the TV shows the same game while Ada plans', tv_now['age'] == tv_before['age'] and tv_now['players'] == tv_before['players'],
                  {'before': tv_before['players'], 'now': tv_now['players']})
            check('private: Vera\'s phone shows the same game', vera_now['age'] == vera_before['age'] and vera_now['players'] == vera_before['players'])
            tv_text = await tv.evaluate("() => document.body.innerText")
            check('private: the TV never mentions the plan', 'Planned' not in tv_text and 'planned' not in tv_text.lower())
            await tv.screenshot(path=shot('06-tv-while-planning.png'))
            check('plan: kept in this phone\'s storage', mid['plans'] and 'Comet' in mid['plans'], mid['plans'])

            # reload: the plan survives
            await phone.reload()
            await until(lambda: _is(state('Ada'), lambda s: s and (s['w'] or '').startswith('Take your')), 15)
            await phone.wait_for_timeout(800)
            await phone.click('[data-testid=dock-go]')
            await phone.wait_for_timeout(600)
            waiting = await phone.locator('[data-testid=plan-waiting]').count()
            check('plan: survives a reload (shown on the turn menu while the first move is open)', waiting == 1)
            await phone.screenshot(path=shot('07-plan-after-reload.png'))

            # ---- first action, then the planned move ------------------------------------------------------------------
            await phone.get_by_text('Play a card', exact=True).click()
            await phone.wait_for_timeout(400)
            await phone.click('[data-card="Nuclear Power"]')
            await phone.wait_for_timeout(400)
            await phone.get_by_role('button', name='Play Nuclear Power', exact=False).click()
            await until(lambda: _is(state('Ada'), lambda s: s and s['acts'] == 1 and (s['w'] or '').startswith('Take your next')), 15)
            due = phone.locator('[data-testid=plan-due]')
            await due.wait_for(state='visible', timeout=8000)
            await phone.wait_for_timeout(500)
            dtxt = await due.text_content()
            valid = await due.get_attribute('data-valid')
            check('confirm: after the first move the menu shows "Your planned move: Play Comet", still valid', 'Your planned move' in dtxt and 'Play Comet' in dtxt and valid == 'true', dtxt)
            await phone.screenshot(path=shot('08-plan-due.png'))
            pre = await state('Ada')
            await phone.click('[data-testid=plan-confirm]')
            await phone.wait_for_timeout(700)
            pay_btn = phone.get_by_role('button', name='Play Comet', exact=False)
            await pay_btn.wait_for(state='visible', timeout=5000)
            after_confirm = await state('Ada')
            check('confirm: one tap opens Comet\'s payment; nothing played by itself', after_confirm['age'] == pre['age'] and 'Comet' in after_confirm['hand'],
                  {'age': [pre['age'], after_confirm['age']]})
            await phone.screenshot(path=shot('09-confirm-opens-payment.png'))
            await pay_btn.click()
            await phone.locator('[role=dialog] g[data-space][style*="cursor: pointer"]').first.wait_for(timeout=8000)
            await phone.locator('[role=dialog] g[data-space][style*="cursor: pointer"]').first.click()
            await phone.wait_for_timeout(300)
            bonus = await phone.locator('[data-testid=space-bonus]').count()
            await phone.screenshot(path=shot('10-ocean-space-bonus.png'))
            await phone.locator('[role=dialog] button.btn.warm', has_text='Place').click()
            # plants from another player: Vera has none, so the question may not come; answer it if it does
            for _ in range(20):
                s = await state('Ada')
                if s and s['active'] != 'red': break
                if s and s['w'] and not s['w'].startswith('Take your'):
                    btns = phone.locator('[role=dialog] button[data-player]')
                    if await btns.count(): await btns.first.click()
                await asyncio.sleep(0.4)
            done = await until(lambda: _is(state('Ada'), lambda s: s and 'Comet' not in s['hand'] and s['active'] == 'blue'), 15)
            check('confirm: Comet was played through the usual questions and the turn passed to Vera', done, done and {'tableau': done['tableau'], 'oceans': done['oceans']})
            check('confirm: the space step named the space\'s bonus', bonus == 1)
            await phone.wait_for_timeout(600)
            gone = await state('Ada')
            plans = json.loads(gone['plans'] or '{}').get('plans', {})
            check('confirm: the plan is gone once the turn ended', not plans, plans)

            # ---- off-turn tray -------------------------------------------------------------------------------------
            await phone.screenshot(path=shot('11-off-turn-hand.png'))
            chip = phone.locator('[data-testid=tray-chip]')
            check('tray: the Hand tab shows the chip off-turn', await chip.count() == 1)
            await chip.click()
            await phone.locator('[data-testid=tray-sheet]').wait_for(state='visible', timeout=4000)
            await phone.click('[data-tray-card="Lichen"]')
            await phone.click('[data-tray-card="Mining Expedition"]')
            await phone.wait_for_timeout(400)
            cost = await phone.locator('[data-testid=tray-cost]').text_content()
            money = await phone.locator('[data-testid=tray-money]').text_content()
            verdict = await phone.locator('[data-testid=tray-verdict]').text_content()
            m = await phone.evaluate("() => { const v = window.__net.getState().fullView.model; const c = (n) => v.cardsInHand.find((x) => x.name === n).calculatedCost; return {cost: c('Lichen') + c('Mining Expedition'), mc: v.thisPlayer.megacredits, income: v.thisPlayer.terraformRating + v.thisPlayer.megacreditProduction}; }")
            check('tray: total cost and money with next generation\'s income', int(cost) == m['cost'] and money.startswith(f"{m['mc']} M€ now, plus {m['income']} M€ next generation"),
                  {'cost': cost, 'money': money, 'verdict': verdict, 'expected': m})
            await phone.screenshot(path=shot('12-tray.png'))
            await phone.click('[data-testid=tray-close]')
            await phone.wait_for_timeout(400)
            # Vera moves: a power plant standard project over her socket
            w = vera.wf()
            idx = next(i for i, o in enumerate(w['options']) if o.get('type') == 'projectCard' and 'standard' in title(o).lower())
            pay = {k: 0 for k in PAY_KEYS}; pay['megacredits'] = 11
            err = await vera.rpc({'type': 'input', 'playerId': vera.id, 'response': {'type': 'or', 'index': idx, 'response': {'type': 'projectCard', 'card': 'Power Plant:SP', 'payment': pay}}})
            moved = await until(lambda: _is(state('Ada'), lambda s: s and s['players'] != gone['players']), 10)
            chip_txt = await chip.text_content()
            check('tray: Vera moved and Ada\'s pins stay', err is None and moved and 'Intended' in chip_txt and '2' in chip_txt, {'err': err, 'chip': chip_txt})
            await phone.reload()
            await phone.locator('[data-testid=tray-chip]').wait_for(timeout=10000)
            chip_txt = await phone.locator('[data-testid=tray-chip]').text_content()
            check('tray: the pins survive a reload', 'Intended' in chip_txt and '2' in chip_txt, chip_txt)
            await phone.screenshot(path=shot('13-tray-chip-after-reload.png'))
            # test setup: Ada gets 40 M€ again for her next turn (written into the save Vera's menu was made from)
            patch_save(args.container, game_id, engine_m, [], {'megaCredits': 40}, {})
            http_json(f'{args.engine}/load_game', {'gameId': game_id, 'rollbackCount': 0}, 'PUT')
            await until(lambda: _is(state('Ada'), lambda s: s and s['mc'] == 40), 10)
            # Vera passes: Ada's turn again
            w = vera.wf()
            idx = next(i for i, o in enumerate(w['options']) if title(o).lower().startswith('pass') or title(o).lower() == 'end turn')
            await vera.rpc({'type': 'input', 'playerId': vera.id, 'response': {'type': 'or', 'index': idx, 'response': {'type': 'option'}}})
            await until(lambda: _is(state('Ada'), lambda s: s and s['active'] == 'red' and s['acts'] == 0 and (s['w'] or '').startswith('Take your')), 20)
            await phone.wait_for_timeout(1500)

            # ---- a plan that stops working --------------------------------------------------------------------------
            if not await phone.locator('[data-opt]').count(): await phone.click('[data-testid=dock-go]')
            await phone.wait_for_timeout(600)
            await phone.get_by_text('Play a card', exact=True).click()
            await phone.wait_for_timeout(400)
            await phone.click('[data-card="Lichen"]')
            await phone.wait_for_timeout(400)
            await phone.click('[data-testid=plan-second]')
            await phone.locator('[data-testid=planner]').wait_for(state='visible', timeout=5000)
            camp = phone.locator('[data-plan-candidate="play:Colonizer Training Camp"]')
            check('invalid: Colonizer Training Camp is possible after Lichen (oxygen stays 5%)', await camp.get_attribute('data-verdict') == 'yes')
            await camp.click()
            await phone.click('[data-testid=plan-this]')
            await phone.wait_for_timeout(400)
            # the player changes their mind: back to the list, Mining Expedition instead (oxygen goes to 6%)
            await phone.get_by_role('button', name='Back', exact=True).last.click()
            await phone.wait_for_timeout(400)
            await phone.click('[data-card="Mining Expedition"]')
            await phone.wait_for_timeout(400)
            await phone.screenshot(path=shot('14-other-first-move.png'))
            await phone.get_by_role('button', name='Play Mining Expedition', exact=False).click()
            for _ in range(20):
                s = await state('Ada')
                if s and s['acts'] == 1 and (s['w'] or '').startswith('Take your next'): break
                if s and s['w'] and not s['w'].startswith('Take your'):
                    btns = phone.locator('[role=dialog] button[data-player]')
                    if await btns.count(): await btns.first.click()
                await asyncio.sleep(0.4)
            due = phone.locator('[data-testid=plan-due]')
            await due.wait_for(state='visible', timeout=8000)
            await phone.wait_for_timeout(500)
            reason = await phone.locator('[data-testid=plan-due-reason]').text_content()
            disabled = await phone.locator('[data-testid=plan-confirm]').is_disabled()
            check('invalid: the due plan says why it no longer works, and Confirm is off',
                  reason == "Oxygen is now 6%, above this card's 5% maximum." and disabled, {'reason': reason, 'disabled': disabled})
            await phone.screenshot(path=shot('15-plan-invalid.png'))
            await phone.click('[data-testid=plan-drop]')
            await phone.wait_for_timeout(400)
            left = await phone.locator('[data-testid=plan-due]').count()
            st = await state('Ada')
            check('invalid: Drop clears the plan', left == 0 and not json.loads(st['plans'] or '{}').get('plans'), st['plans'])
            await phone.screenshot(path=shot('16-after-drop.png'))
            await tv.screenshot(path=shot('17-tv-end.png'))
            report['notes'] += [n for n in report['notes']]
    finally:
        srv.terminate()
        try: srv.wait(5)
        except Exception: srv.kill()
    json.dump(report, open(os.path.join(args.out, 'plan.json'), 'w'), indent=1)
    bad = [k for k, v in report['checks'].items() if not v['ok']]
    print('page errors:', [n for n in report['notes'] if 'pageerror' in n])
    print('FAILED' if bad else 'ALL PASSED', bad)


if __name__ == '__main__':
    asyncio.run(main())
