"""Undo harness: is an undo immediate, visible and safe on every screen, measured against a real engine.

    engine: the production engine image (SQLite). The LOCAL_FS_DB engine the other harnesses use cannot undo: it
            restores the latest save, so its "undo" only raises undoCount.
            docker run -d --rm --name undo-engine -p 8441:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/undo.py --engine http://localhost:8441 --port 8450 --out DIR

Two seats, Ada (A) and Vera (B), answered by the soak bot over their own sockets, each answer naming the view it
was made against (`seen`); the TV and one Chromium phone page per seat watch. Scenarios, in one game:
  undo1     A acts, opens the turn menu on the phone page and taps Undo there.
  undo2     A acts again and undoes again (the engine repeats undoCount and lowers gameAge).
  race      A's phone page has the menu open; A's other device undoes and the page taps End Turn at the same moment.
  stale     A undoes; an answer made against the view before the undo arrives late (End Turn's old index).
  cross     A finishes the turn; B's page opens B's menu; A's stale Undo (from A's previous view) and B's answer land in
            the same second.
  research  both players answer research at the same instant (simultaneous moves are not refused for each other).
For each undo: per device, the time from the tap to the device's own store holding the engine's new moment, and to
the notice showing. Afterwards: every screen equals the engine, the TV's story counts the board's tiles once, and the
bot's answers (all with `seen`) are counted for refusals. Output: undo.json in --out, plus screenshots.
Needs: websockets, playwright.
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = soak.ROOT

PAGE_JS = r'''() => {
  const s = window.__net && window.__net.getState();
  const fv = s && s.fullView;
  const q = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
  if (!fv) return null;
  const g = fv.model.game;
  return {age: g.gameAge, undo: g.undoCount, epoch: fv.v ? (fv.v.epoch ?? null) : null, seq: fv.v ? fv.v.seq : null,
    active: (fv.model.players.find((p) => p.isActive) || {}).color || null, phase: g.phase, tiles: g.spaces.filter((x) => x.tileType !== undefined && x.tileType !== null).length,
    w: fv.role === 'player' && fv.model.waitingFor ? fv.model.waitingFor.title && (fv.model.waitingFor.title.message || fv.model.waitingFor.title) : null,
    notice: q('[data-testid=undo-notice]'), stale: q('[data-testid=stale-notice]'), dialog: !!document.querySelector('[role=dialog]'),
    historyTiles: s.history ? s.history.tiles.length : null, historyUndos: s.history && s.history.undos ? s.history.undos.length : 0};
}'''


def js_question_key(w):
    """src/shared/sync.ts questionKey, in Python (JSON.stringify, then djb2 over UTF-16 code units)."""
    s = json.dumps(w, separators=(',', ':'), ensure_ascii=False) if w is not None else 'null'
    units = s.encode('utf-16-le')
    h = 5381
    for i in range(0, len(units), 2):
        c = units[i] | (units[i + 1] << 8)
        h = ((h << 5) + h + c) & 0xFFFFFFFF
    n, digits = h, '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while True:
        out = digits[n % 36] + out; n //= 36
        if not n: break
    return f'{out}.{len(units) // 2}'


class Seat(soak.Seat):
    """soak's seat, also keeping each view's version, undo notices and refusal codes."""
    def __init__(self, *a):
        super().__init__(*a)
        self.v = None; self.notices = []; self.codes = {}

    async def reader(self):
        async for raw in self.ws:
            m = json.loads(raw); t = m.get('type')
            if t in ('state', 'tick', 'undone'): self.state = m['state']
            elif t == 'full': self.view = m['view']; self.v = m.get('v'); self.stamp += 1
            elif t == 'fullUndo': self.notices.append((time.time(), m['notice']))
            elif t in ('ack', 'nack'):
                if t == 'nack': self.codes[m['id']] = m.get('code')
                f = self.pending.pop(m['id'], None)
                if f and not f.done(): f.set_result(m.get('error'))

    def seen(self):
        m = self.model()
        if not m or not self.v: return None
        return {'boot': self.v['boot'], 'seq': self.v['seq'], 'epoch': self.v.get('epoch', 0), 'age': m['game']['gameAge'],
                'undo': m['game']['undoCount'], 'q': js_question_key(m.get('waitingFor'))}

    async def answer(self, response, seen='now'):
        return await self.rpc({'type': 'input', 'playerId': self.id, 'response': response, **({'seen': self.seen() if seen == 'now' else seen} if seen else {})})


class TvSocket:
    """A raw TV-role socket: when each view reaches a TV over the network, apart from any page's drawing (transport)."""
    def __init__(self): self.views = []; self.notices = []

    async def open(self, port):
        import websockets
        self.ws = await websockets.connect(f'ws://localhost:{port}/ws', max_size=2 ** 24)
        await self.ws.send(json.dumps({'type': 'hello', 'role': 'tv', 'playerId': None}))
        asyncio.create_task(self.reader())

    async def reader(self):
        async for raw in self.ws:
            m = json.loads(raw)
            if m.get('type') == 'full':
                g = m['view']['model']['game']; self.views.append((time.time(), g['gameAge'], g['undoCount'], (m.get('v') or {}).get('seq')))
            elif m.get('type') == 'fullUndo': self.notices.append(time.time())


LONGTASKS_JS = """window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Date.now() - (performance.now() - e.startTime), e.duration]); })
  .observe({type: 'longtask', buffered: true}); } catch (e) {}"""


def http_json(url):
    with urllib.request.urlopen(url, timeout=5) as r:
        return json.loads(r.read())


def undo_index(w):
    if not w or w.get('type') != 'or': return None
    return next((i for i, o in enumerate(w['options']) if soak.option_kind(o) == 'undo'), None)


def opt_index(w, kind):
    if not w or w.get('type') != 'or': return None
    return next((i for i, o in enumerate(w['options']) if soak.option_kind(o) == kind), None)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8441')
    ap.add_argument('--port', type=int, default=8450)
    ap.add_argument('--out', required=True)
    ap.add_argument('--generations', type=int, default=3, help='play on (bot answers with seen) until this generation, then check')
    ap.add_argument('--races', type=int, default=4)
    ap.add_argument('--seed', type=int, default=11)
    ap.add_argument('--gpu', action='store_true', help='Chromium with the GPU (as tests/full/drift.py): the TV draws at a real frame rate')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    import random
    rng = random.Random(args.seed)
    bot = soak.Bot(rng)
    data = tempfile.mkdtemp(prefix='tm-undo-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'VISION_ENABLED': 'false',
           'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')), 'BOT_DELAY_SCALE': '0'}
    srv_log = open(os.path.join(args.out, 'server.log'), 'w')
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=srv_log, stderr=subprocess.STDOUT, text=True)
    out = {'build': os.environ.get('SERVER_JS', 'dist-server'), 'undos': [], 'races': [], 'stale': [], 'cross': [], 'research': [],
           'answers': 0, 'refusals': [], 'offers_by_phase': {}, 'pageerrors': [], 'checks': {}}
    pw = browser = None
    try:
        for _ in range(150):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: time.sleep(0.1)
        A, B = Seat('sA', 'Ada', 'red'), Seat('sB', 'Vera', 'blue')
        for s in (A, B): await s.open(args.port)
        for s in (A, B):
            assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        err = await A.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': A.id, 'modules': ['base', 'corpera'], 'order': [A.id, B.id], 'mode': 'full', 'draft': True}})
        assert err is None, err
        for _ in range(100):
            if A.state and A.state.get('full'): break
            await asyncio.sleep(0.1)
        link = A.state['full']
        eng = {s.id: link['players'][s.id]['engineId'] for s in (A, B)}
        spectator = lambda: http_json(f"{args.engine}/api/spectator?id={link['spectatorId']}")
        engine_player = lambda s: http_json(f"{args.engine}/api/player?id={eng[s.id]}")

        pw = await async_playwright().start()
        browser = await pw.chromium.launch(args=['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-gpu'] if args.gpu else [])
        mobile = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
        pages = {}
        for s, name in ((A, 'phoneA'), (B, 'phoneB')):
            ctx = await browser.new_context(**mobile)
            await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
            s.page = await ctx.new_page(); pages[name] = s.page
            s.page.on('pageerror', lambda e, n=name: out['pageerrors'].append(f'{n}: {e}'))
            await s.page.goto(f'http://localhost:{args.port}/')
        tvctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        await tvctx.add_init_script(LONGTASKS_JS)
        tvsock = TvSocket(); await tvsock.open(args.port)
        pages['tv'] = await tvctx.new_page()
        pages['tv'].on('pageerror', lambda e: out['pageerrors'].append(f'tv: {e}'))
        await pages['tv'].goto(f'http://localhost:{args.port}/tv')

        # ---- the bot ------------------------------------------------------------------------------------------
        async def fresh_view(s, timeout=5):
            """Wait until the seat's socket holds the engine's current model for it (the bot answers what a phone shows)."""
            t0 = time.time()
            while time.time() - t0 < timeout:
                m = s.model(); e = engine_player(s)
                if m and (m['game']['gameAge'], m['game']['undoCount']) == (e['game']['gameAge'], e['game']['undoCount']) and \
                        js_question_key(m.get('waitingFor')) == js_question_key(e.get('waitingFor')):
                    return m
                await asyncio.sleep(0.05)
            return s.model()

        def note_offer(m):
            if undo_index(m.get('waitingFor')) is not None:
                ph = m['game']['phase']; out['offers_by_phase'][ph] = out['offers_by_phase'].get(ph, 0) + 1

        async def step(s, avoid_undo=True):
            """One bot answer for this seat, with seen. Returns the refusal text or None."""
            m = await fresh_view(s)
            w = m.get('waitingFor') if m else None
            if not w: return 'no question'
            note_offer(m)
            got = bot.answer(w, m['thisPlayer'], m, None)
            if not got: raise RuntimeError(f'bot stuck on {w.get("type")} {soak.text(w.get("title"))}')
            out['answers'] += 1
            err = await s.answer(got[0])
            if err:
                out['refusals'].append({'seat': s.name, 'error': err, 'phase': m['game']['phase'], 'w': soak.text(w.get('title'))})
                print('refused', s.name, err, flush=True)
            return err

        def has_q(s):
            e = engine_player(s); return bool(e.get('waitingFor'))

        async def play_until(cond, limit=400):
            for _ in range(limit):
                if cond(): return
                movers = [s for s in (A, B) if has_q(s)]
                if not movers: await asyncio.sleep(0.1); continue
                await step(rng.choice(movers))
            raise RuntimeError('play_until: condition not reached')

        def a_turn_start():
            """A's turn menu, before A's first action (generation 1 may still report the research phase here)."""
            e = engine_player(A)
            w = e.get('waitingFor')
            return bool(w) and e['thisPlayer']['isActive'] and e['thisPlayer']['actionsTakenThisRound'] == 0 and \
                soak.text(w.get('title')).lower().startswith('take your first action')

        async def a_one_action():
            """From A's turn start: A takes one action (any follow-ups answered) until the menu offers Undo."""
            for _ in range(20):
                e = engine_player(A)
                if undo_index(e.get('waitingFor')) is not None: return e
                await step(A)
            e = engine_player(A)
            raise RuntimeError(f"A never got an Undo offer: active={e['thisPlayer']['isActive']} actions={e['thisPlayer']['actionsTakenThisRound']} "
                               f"w={soak.text((e.get('waitingFor') or {}).get('title'))} refusals={out['refusals'][-4:]}")

        # ---- measuring the screens ----------------------------------------------------------------------------
        async def snap(name):
            try: return await pages[name].evaluate(PAGE_JS)
            except Exception: return None

        async def watch_undo(label, do_undo, prep=None):
            """prep() (opening the menu), then do_undo() timed from its start: per device, when its store holds the engine's
            new moment and when the notice shows."""
            if prep: await prep()
            before = {n: await snap(n) for n in pages}
            e0 = spectator()['game']
            t0 = time.time()
            res = await do_undo()
            e1 = spectator()['game']
            target = (e1['gameAge'], e1['undoCount'])
            seen_at, notice_at, notice_text = {}, {}, {}
            timeline = {n: [] for n in pages}
            target_tiles = len([x for x in spectator()['game']['spaces'] if x.get('tileType') is not None])

            async def sample(n):
                # one sampler per device: a busy page (the TV drawing in software) must not delay reading the others
                while time.time() - t0 < 8 and (n not in seen_at or n not in notice_at):
                    st = await snap(n)
                    now = round(time.time() - t0, 3)
                    if st:
                        if not timeline[n] or timeline[n][-1][1:] != [st['age'], st['undo'], st['seq'], st['tiles'], bool(st['notice'])]:
                            timeline[n].append([now, st['age'], st['undo'], st['seq'], st['tiles'], bool(st['notice'])])
                        fresh = st['seq'] != before[n]['seq'] if before[n] and st['seq'] is not None else True
                        if n not in seen_at and (st['age'], st['undo']) == target and fresh and st['tiles'] == target_tiles: seen_at[n] = now
                        if n not in notice_at and st['notice']: notice_at[n] = now; notice_text[n] = st['notice']
                    await asyncio.sleep(0.02)
            await asyncio.gather(*[sample(n) for n in pages])
            wire = next((round(t - t0, 3) for (t, age, undo, _) in tvsock.views if t >= t0 and (age, undo) == target), None)
            wire_notice = next((round(t - t0, 3) for t in tvsock.notices if t >= t0), None)
            longs = [[round(a / 1000 - t0, 3), round(d)] for a, d in (await pages['tv'].evaluate('() => window.__long || []')) if a / 1000 > t0 - 3]
            rec = {'label': label, 'engine_before': [e0['gameAge'], e0['undoCount']], 'engine_after': list(target), 'result': res,
                   'tv_socket_s': {'view': wire, 'notice': wire_notice}, 'tv_long_tasks': longs,
                   'store_s': {n: seen_at.get(n) for n in pages}, 'notice_s': {n: notice_at.get(n) for n in pages}, 'notice_text': notice_text,
                   'timeline': timeline, 'engine_tiles': len([x for x in spectator()['game']['spaces'] if x.get('tileType') is not None])}
            out['undos'].append(rec)
            for n in pages: await pages[n].screenshot(path=os.path.join(args.out, f'{label}-{n}.png'))
            print(json.dumps({k: v for k, v in rec.items() if k != 'timeline'}), flush=True)
            return rec

        async def caught_up(page, seat, timeout=6):
            """Wait until this phone page holds the engine's current moment and question for its seat."""
            t0 = time.time()
            while time.time() - t0 < timeout:
                e = engine_player(seat)
                got = await page.evaluate("() => { const v = window.__net.getState().fullView; return v ? [v.model.game.gameAge, v.model.game.undoCount, JSON.stringify(v.model.waitingFor ?? null)] : null }")
                if got and got[0] == e['game']['gameAge'] and got[1] == e['game']['undoCount'] and \
                        json.loads(got[2]) == e.get('waitingFor'):
                    return True
                await asyncio.sleep(0.05)
            return False

        async def open_menu(page):
            await caught_up(page, A if page is A.page else B)
            await page.wait_for_timeout(700)  # the dock lets "Your move" settle (it holds 0.6 s)
            if not await page.locator('[role=dialog]').count():
                await page.locator('[data-testid=dock-go]').click(timeout=8000)
            await page.locator('[role=dialog]').last.wait_for(state='visible', timeout=12000)
            await page.wait_for_timeout(400)

        async def open_a_menu():
            await open_menu(A.page)

        async def tap_undo_on_page():
            idx = undo_index((await fresh_view(A)).get('waitingFor'))
            try:
                await A.page.locator(f'[role=dialog] [data-opt="{idx}"]').first.click(timeout=5000)
            except Exception:
                await A.page.screenshot(path=os.path.join(args.out, 'tap-undo-failed.png'))
                open(os.path.join(args.out, 'tap-undo-failed.html'), 'w').write(await A.page.content())
                raise
            for _ in range(100):
                if spectator()['game']['undoCount'] > 0 and not undo_index(engine_player(A).get('waitingFor')): break
                await asyncio.sleep(0.02)
            return 'tapped Undo on phone A'

        # ---- the game: to A's first action turn ---------------------------------------------------------------
        await play_until(a_turn_start)
        print('A turn start', spectator()['game']['generation'], flush=True)

        out['errors'] = []

        async def ensure_a_turn():
            if not a_turn_start(): await play_until(a_turn_start)

        async def run_scenario(name, fn):
            """A scenario that fails (the old build lets a stale answer through and the game moves) is recorded; the next one
            starts again at A's turn."""
            try:
                if name != 'research': await ensure_a_turn()
                await fn()
            except Exception as e:
                out['errors'].append({'scenario': name, 'error': repr(e)[:400]}); print('scenario failed', name, repr(e)[:200], flush=True)
                for pg in pages.values():
                    if await pg.locator('[role=dialog]').count(): await pg.keyboard.press('Escape')

        # undo1 and undo2: tap Undo on A's phone page, twice in the same turn
        async def sc_undo12():
            for k in (1, 2):
                await a_one_action()
                await watch_undo(f'undo{k}', tap_undo_on_page, open_a_menu)
        await run_scenario('undo12', sc_undo12)

        # race: A's page has the menu open (with End Turn); A's other device undoes while the page taps End Turn
        async def sc_race():
            for r in range(args.races):
                await a_one_action()
                m = await fresh_view(A)
                end_i = opt_index(m['waitingFor'], 'end'); undo_i = undo_index(m['waitingFor'])
                await open_menu(A.page)
                await A.page.wait_for_timeout(300)
                seen = A.seen()

                async def tap_end():
                    try:
                        await A.page.locator(f'[role=dialog] [data-opt="{end_i}"]').first.click(timeout=1500)
                        return 'tapped'
                    except Exception as e:
                        return f'no tap ({str(e).splitlines()[0][:60]})'
                t0 = time.time()
                undo_res, tap_res = await asyncio.gather(A.answer({'type': 'or', 'index': undo_i, 'response': {'type': 'option'}}, seen), tap_end())
                await asyncio.sleep(1.2)
                e = engine_player(A)
                st = await snap('phoneA')
                rec = {'round': r, 'undo': undo_res or 'accepted', 'tap': tap_res, 'stale_notice': st and st['stale'], 'undo_notice': st and st['notice'],
                       'dialog_open_after': st and st['dialog'],
                       'engine_after': {'active': e['thisPlayer']['isActive'], 'actions': e['thisPlayer']['actionsTakenThisRound'], 'phase': e['game']['phase'],
                                        'menu': soak.text((e.get('waitingFor') or {}).get('title'))}}
                # safe outcomes: the tap was refused with the reason, or the sheet closed before the tap could land
                rec['ok'] = e['thisPlayer']['isActive'] and e['thisPlayer']['actionsTakenThisRound'] == 0 and e['game']['phase'] == 'action'
                out['races'].append(rec); print('race', json.dumps(rec), flush=True)
                await A.page.screenshot(path=os.path.join(args.out, f'race{r}-phoneA.png'))
                if await A.page.locator('[role=dialog]').count(): await A.page.keyboard.press('Escape')
        await run_scenario('race', sc_race)

        # stale: an answer made against the view before the undo arrives late (End Turn's old index)
        async def sc_stale():
            await a_one_action()
            m = await fresh_view(A)
            # End Turn's old index; once the other player has passed there is no End Turn, then the old Undo index
            old_seen = A.seen(); end_i = opt_index(m['waitingFor'], 'end')
            was = 'End Turn'
            if end_i is None: end_i, was = undo_index(m['waitingFor']), 'Undo last action'
            await watch_undo('undo-before-stale', tap_undo_on_page, open_a_menu)
            restored = [soak.text(o.get('title')) for o in engine_player(A)['waitingFor']['options']]
            err = await A.answer({'type': 'or', 'index': end_i, 'response': {'type': 'option'}}, old_seen)
            e = engine_player(A)
            rec = {'old_index': end_i, 'was': was, 'now_at_index': restored[end_i] if end_i < len(restored) else None, 'result': err or 'ACCEPTED',
                   'engine_after': {'active': e['thisPlayer']['isActive'], 'actions': e['thisPlayer']['actionsTakenThisRound'], 'phase': e['game']['phase']}}
            rec['ok'] = bool(err) and e['thisPlayer']['isActive'] and e['thisPlayer']['actionsTakenThisRound'] == 0
            out['stale'].append(rec); print('stale', json.dumps(rec), flush=True)
        await run_scenario('stale', sc_stale)

        # cross: A finishes the turn; B's page opens B's menu; A's stale Undo and B's answer land together
        async def sc_cross():
            await a_one_action()
            m = await fresh_view(A)
            a_seen = A.seen(); a_undo_i = undo_index(m['waitingFor'])
            for _ in range(20):  # A's second action (follow-ups included) until the turn passes to B
                if not engine_player(A)['thisPlayer']['isActive']: break
                await step(A)
            await play_until(lambda: engine_player(B)['thisPlayer']['isActive'] and bool(engine_player(B).get('waitingFor')))
            bm = await fresh_view(B)
            got = bot.answer(bm['waitingFor'], bm['thisPlayer'], bm, None)
            await open_menu(B.page)
            u0 = spectator()['game']['undoCount']
            t0 = time.time()
            a_res, b_res = await asyncio.gather(A.answer({'type': 'or', 'index': a_undo_i, 'response': {'type': 'option'}}, a_seen),
                                                soak.ui_answer(B, got[1], None, 'cross-b'))
            dt = round(time.time() - t0, 2)
            await asyncio.sleep(1.0)
            e = spectator()['game']
            rec = {'a_undo': a_res or 'ACCEPTED', 'b_answer_ui': b_res or 'accepted', 'within_s': dt, 'undoCount_before': u0, 'undoCount_after': e['undoCount'],
                   # B's answer went in: the engine asks B something else now (a follow-up, the next action) or B's turn is over
                   'b_moved': js_question_key(engine_player(B).get('waitingFor')) != js_question_key(bm['waitingFor'])}
            rec['ok'] = bool(a_res) and not b_res and e['undoCount'] == u0 and rec['b_moved']
            out['cross'].append(rec); print('cross', json.dumps(rec), flush=True)
            for n in pages: await pages[n].screenshot(path=os.path.join(args.out, f'cross-{n}.png'))
        await run_scenario('cross', sc_cross)

        # research: at the next research phase both players answer at the same instant
        async def sc_research():
            await play_until(lambda: engine_player(A).get('waitingFor') and engine_player(B).get('waitingFor') and spectator()['game']['phase'] in ('research', 'drafting'))
            ma, mb = await fresh_view(A), await fresh_view(B)
            ra = bot.answer(ma['waitingFor'], ma['thisPlayer'], ma, None); rb = bot.answer(mb['waitingFor'], mb['thisPlayer'], mb, None)
            ea, eb = await asyncio.gather(A.answer(ra[0]), B.answer(rb[0]))
            rec = {'phase': ma['game']['phase'], 'a': ea or 'accepted', 'b': eb or 'accepted'}
            rec['ok'] = not ea and not eb
            out['research'].append(rec); print('research', json.dumps(rec), flush=True)
        await run_scenario('research', sc_research)

        # play on with seen on every answer, then check every screen against the engine
        await play_until(lambda: spectator()['game']['generation'] >= args.generations and spectator()['game']['phase'] == 'action', limit=1500)
        await asyncio.sleep(2.0)
        s = spectator()['game']
        engine_tiles = len([x for x in s['spaces'] if x.get('tileType') is not None])
        screens = {n: await snap(n) for n in pages}
        out['checks'] = {'engine': {'age': s['gameAge'], 'undo': s['undoCount'], 'tiles': engine_tiles, 'generation': s['generation']},
                         'screens': screens,
                         'screens_match_engine': all(st and (st['age'], st['undo'], st['tiles']) == (s['gameAge'], s['undoCount'], engine_tiles) for st in screens.values()),
                         'story_tiles_match_board': screens['tv'] and screens['tv']['historyTiles'] == engine_tiles,
                         'story_undos': screens['tv'] and screens['tv']['historyUndos']}
    finally:
        out['server_log_warnings'] = []
        try:
            if browser: await browser.close()
            if pw: await pw.stop()
        finally:
            srv.terminate()
            try: srv.wait(5)
            except Exception: srv.kill()
            srv_log.close()
            out['server_log_warnings'] = [l.strip() for l in open(os.path.join(args.out, 'server.log')) if 'warn' in l.lower() or 'undid' in l]
            json.dump(out, open(os.path.join(args.out, 'undo.json'), 'w'), indent=1)
    lat = [v for u in out['undos'] for v in u['store_s'].values()]
    print(json.dumps({'undo_store_s_max': max([x for x in lat if x is not None], default=None), 'undo_store_missing': sum(1 for x in lat if x is None),
                      'notice_missing': sum(1 for u in out['undos'] for v in u['notice_s'].values() if v is None),
                      'races_ok': sum(1 for r in out['races'] if r['ok']), 'races': len(out['races']),
                      'stale_ok': all(r['ok'] for r in out['stale']), 'cross_ok': all(r['ok'] for r in out['cross']),
                      'research_ok': all(r['ok'] for r in out['research']), 'answers': out['answers'], 'refusals': len(out['refusals']),
                      'offers_by_phase': out['offers_by_phase'], 'checks': {k: v for k, v in out['checks'].items() if k != 'screens'},
                      'pageerrors': len(out['pageerrors'])}, indent=1))


if __name__ == '__main__':
    asyncio.run(main())
