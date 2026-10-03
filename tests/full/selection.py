"""A half-made card selection survives another player's move, end to end.

    engine: the production engine image
            docker run -d --rm --name sel-engine -p 8902:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    build:  a scratch build (CLIENT_DIST=<vite outDir>, SERVER_JS=<esbuild outfile>), as for tests/full/soak.py
    run:    CLIENT_DIST=... SERVER_JS=... python3 tests/full/selection.py --engine http://localhost:8902 \
                --port 8901 --out DIR [--bot]

Seats: Ada (a person: a 390x844 phone page), Vera and Cleo (people answering over their own sockets); with --bot,
Cleo is a Normal bot at Quick instead. On Ada's phone, for each question below, cards are ticked and the sheet is
scrolled; then another seat answers its own question (the engine moves on, every screen gets a new view). Checked: the
ticks, the step and the sheet's scroll survive, and Ada's answer is then accepted (not refused as stale).
  initial   game 1 (no draft): the corporation step (one corporation ticked) while Vera answers; then the buy step (two
            cards ticked) while Cleo answers; Ada buys
  research  game 1, generation 2: two cards ticked while Vera answers, still ticked while Cleo answers; Ada buys them;
            also an answer sent with the view from before Vera's move (a phone that had not heard of it yet): accepted
  draft     game 2 (draft): the first draft pick ticked while Vera and Cleo pick; Ada keeps it
Output: selection.json and screenshots in --out. Exit code 1 when any check fails.
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile, time, urllib.request

sys.path.insert(0, os.path.dirname(__file__))
import soak  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

ROOT = soak.ROOT

PAGE_JS = r'''() => {
  const s = window.__net && window.__net.getState();
  const fv = s && s.fullView;
  if (!fv || fv.role !== 'player') return null;
  const g = fv.model.game;
  const dlg = document.querySelector('[role=dialog]');
  const scroller = dlg ? [...dlg.children].find((e) => getComputedStyle(e).overflowY === 'auto') : null;
  const w = fv.model.waitingFor;
  return {age: g.gameAge, undo: g.undoCount, seq: fv.v ? fv.v.seq : null, boot: fv.v ? fv.v.boot : null, epoch: fv.v ? (fv.v.epoch || 0) : null, phase: g.phase, generation: g.generation,
    w: w ? (w.title && (w.title.message || w.title)) : null, wtype: w ? w.type : null,
    hand: fv.model.cardsInHand.map((c) => c.name),
    dialog: !!dlg, ticked: dlg ? [...dlg.querySelectorAll('[data-card][aria-pressed=true]')].map((e) => e.getAttribute('data-card')) : [],
    offered: dlg ? [...dlg.querySelectorAll('[data-card]')].map((e) => e.getAttribute('data-card')) : [],
    step: dlg ? (dlg.querySelector('[aria-label^="Step "]') || {}).ariaLabel || null : null,
    scroll: scroller ? scroller.scrollTop : null,
    stale: (document.querySelector('[data-testid=stale-notice]') || {}).textContent || null,
    seen: window.__seen || null};
}'''


def djb2_key(w):
    """The phone's questionKey (src/shared/sync.ts) of an engine question, for an answer sent from this script."""
    s = json.dumps(w, separators=(',', ':'), ensure_ascii=False)
    h = 5381
    for ch in s.encode('utf-16-le').decode('utf-16-le'):
        h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    n = 0
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    n = h
    while True:
        out = digits[n % 36] + out; n //= 36
        if not n: break
    return f'{out}.{len(s)}'


def is_pass(o): return soak.text(o.get('title')).strip().lower().startswith('pass')


async def until(f, secs=30, step=0.1):
    t0 = time.time()
    while time.time() - t0 < secs:
        v = await f()
        if v: return v
        await asyncio.sleep(step)
    return None


async def run_game(args, browser, draft, report, check, tag):
    data = tempfile.mkdtemp(prefix='tm-selection-')
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400', 'VISION_ENABLED': 'false',
           'NARRATOR_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')), 'BOT_DELAY_SCALE': '1',
           'ENGINE_GAME_OPTIONS': json.dumps({'customCorporationsList': ['CrediCor', 'Ecoline', 'Helion', 'Mining Guild', 'PhoboLog', 'Saturn Systems',
                                                                        'Teractor', 'Thorgate', 'Interplanetary Cinematics']})}
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=open(os.path.join(args.out, f'server-{tag}.log'), 'w'), stderr=subprocess.STDOUT, text=True)
    shot = lambda name: os.path.join(args.out, f'{tag}-{name}.png')
    try:
        for _ in range(100):
            try: urllib.request.urlopen(f'http://localhost:{args.port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        mz, vera = soak.Seat('m1', 'Ada', 'red'), soak.Seat('b1', 'Vera', 'blue')
        cleo = None if args.bot else soak.Seat('c1', 'Cleo', 'green')
        humans = [s for s in (mz, vera, cleo) if s]
        for s in humans: await s.open(args.port)
        for s in humans: assert (await s.rpc({'type': 'cmd', 'command': {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}})) is None
        order = ['m1', 'b1', 'c1']
        if args.bot:
            assert (await mz.rpc({'type': 'cmd', 'command': {'t': 'addBot', 'playerId': mz.id, 'botId': 'x1', 'name': 'Ares', 'color': 'green', 'level': 'normal'}})) is None
            assert (await mz.rpc({'type': 'cmd', 'command': {'t': 'setBotSpeed', 'playerId': mz.id, 'speed': 'quick'}})) is None
            order = ['m1', 'b1', 'x1']
        assert (await mz.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': mz.id, 'modules': ['base', 'corpera'], 'order': order, 'mode': 'full', 'draft': draft}})) is None
        ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        await ctx.add_init_script("try{localStorage.setItem('mars-ledger-player','m1')}catch(e){}")
        phone = await ctx.new_page(); phone.on('pageerror', lambda e: report['notes'].append(f'pageerror {tag}: {e}'))
        await phone.goto(f'http://localhost:{args.port}/')
        state = lambda: phone.evaluate(PAGE_JS)

        async def settle_after(seq0, secs=10):
            """Wait for a newer view on the phone than seq0, then for it to draw."""
            st = await until(lambda: _is(state(), lambda s: s and s['seq'] is not None and s['seq'] > seq0), secs)
            await phone.wait_for_timeout(900)
            return st

        async def scroll_sheet(px):
            await phone.evaluate(f'''() => {{ const d = document.querySelector('[role=dialog]'); if (!d) return;
              const s = [...d.children].find((e) => getComputedStyle(e).overflowY === 'auto'); if (s) s.scrollTop = {px}; }}''')

        async def tick(names):
            for n in names:
                await phone.locator(f'[role=dialog] [data-card="{n}"]').click()
                await phone.wait_for_timeout(250)

        async def other_moves(seat, label, ticked, step=None):
            """Seat answers its own question; Ada's ticks (and step, scroll) must survive the new view."""
            before = await state()
            if seat is None:  # the bot answers on its own
                after = await settle_after(before['seq'], 30)
            else:
                w = seat.wf()
                assert w, f'{seat.name} has no question'
                await seat.rpc({'type': 'input', 'playerId': seat.id, 'response': answer_for(w)})
                after = await settle_after(before['seq'])
            after = await state()
            await phone.screenshot(path=shot(f'{label}'))
            moved = after['seq'] != before['seq']
            ok = moved and sorted(after['ticked']) == sorted(ticked) and after['dialog'] and (step is None or after['step'] == step) \
                and (before['scroll'] is None or after['scroll'] == before['scroll'])
            check(f'{tag}: {label}: ticks survive {seat.name if seat else "the bot"}\'s answer', ok,
                  {'new_view': moved, 'age': [before['age'], after['age']], 'seq': [before['seq'], after['seq']], 'ticked_before': before['ticked'],
                   'ticked_after': after['ticked'], 'step': [before['step'], after['step']], 'scroll': [before['scroll'], after['scroll']],
                   'question': after['w']})
            return after

        async def sheet_ready(title_re):
            st = await until(lambda: _is(state(), lambda s: s and s['dialog'] and s['w'] and title_re(s['w']) and len(s['offered']) > 0), 60)
            await phone.wait_for_timeout(800)
            return st

        # ---- initial cards ------------------------------------------------------------------------------------------
        st = await sheet_ready(lambda t: True)
        check(f'{tag}: setup: the initial question opens on the phone', st, st and {'w': st['w'], 'offered': st['offered']})
        # not Helion: its heat pays for cards, which adds a payment question after the buy
        corp = next((c for c in st['offered'] if c != 'Helion'), st['offered'][0])
        await tick([corp])
        await phone.screenshot(path=shot('01-corp-ticked'))
        await other_moves(vera, '02-corporation step', [corp], step='Step 1 of 2')
        # next step: the buy step
        await phone.locator('[role=dialog] button.btn.warm').click()
        await phone.wait_for_timeout(900)
        st = await state()
        if st['step'] != 'Step 2 of 2':  # the tick was lost: tick again so the rest of the run goes on
            await tick([corp]); await phone.locator('[role=dialog] button.btn.warm').click(); await phone.wait_for_timeout(900)
            st = await state()
        buy = [c for c in st['offered']][:2]
        await tick(buy)
        await scroll_sheet(120)
        await phone.wait_for_timeout(200)
        if cleo:
            await other_moves(cleo, '03-initial buy step', buy, step='Step 2 of 2')
        else:
            report['notes'].append(f'{tag}: initial buy step: the bot answered on its own (not timed against the ticks)')
        await phone.locator('[role=dialog] button.btn.warm').click()
        got = await until(lambda: _is(state(), lambda s: s and all(c in s['hand'] for c in buy) and not s['stale']), 15)
        st = await state()
        check(f'{tag}: initial: Ada\'s answer accepted with the two cards bought', got, {'hand': st['hand'], 'stale': st['stale'], 'w': st['w']})

        # ---- generation 1: everyone passes ----------------------------------------------------------------------------
        async def drive_until(pred, secs=90):
            """Answer the sockets' questions (Ada's too, over his own socket) until pred(phone state)."""
            t0 = time.time()
            while time.time() - t0 < secs:
                s = await state()
                if s and pred(s): return s
                for seat in humans:
                    w = seat.wf(); m = seat.model()
                    if not w or not m: continue
                    if w.get('type') == 'or' and any(is_pass(o) for o in w['options']):
                        idx = next(i for i, o in enumerate(w['options']) if is_pass(o))
                        await seat.rpc({'type': 'input', 'playerId': seat.id, 'response': {'type': 'or', 'index': idx, 'response': {'type': 'option'}}})
                await asyncio.sleep(0.3)
            return None

        if draft:
            st = await drive_until(lambda s: s['generation'] == 2 and s['wtype'] == 'card' and s['w'] and 'keep' in s['w'].lower())
            check(f'{tag}: setup: the first draft pick of generation 2', st, st and {'w': st['w']})
            st = await sheet_ready(lambda t: 'keep' in t.lower())
            pick = [st['offered'][1 if len(st['offered']) > 1 else 0]]
            await tick(pick)
            await phone.screenshot(path=shot('04-draft-ticked'))
            await other_moves(vera, '05-draft pick', pick)
            if cleo: await other_moves(cleo, '06-draft pick', pick)
            await phone.locator('[role=dialog] button.btn.warm').click()
            await phone.wait_for_timeout(1500)
            st = await state()
            drafted = (mz.model() or {}).get('draftedCards') or []
            check(f'{tag}: draft: Ada\'s pick accepted', not st['stale'] and any(c['name'] == pick[0] for c in drafted),
                  {'stale': st['stale'], 'drafted': [c['name'] for c in drafted], 'w': st['w']})
            # finish the draft over the sockets (first card each time), up to the research buy
            t0 = time.time()
            while time.time() - t0 < 60:
                s = await state()
                if s and s['w'] and 'buy' in s['w'].lower(): break
                for seat in humans:
                    w = seat.wf()
                    if w and w.get('type') == 'card' and 'keep' in soak.text(w.get('title')).lower() and not w.get('optional'):
                        await seat.rpc({'type': 'input', 'playerId': seat.id, 'response': {'type': 'card', 'cards': [w['cards'][0]['name']]}})
                await asyncio.sleep(0.3)

        # ---- research ---------------------------------------------------------------------------------------------------
        st = await drive_until(lambda s: s['generation'] == 2 and s['wtype'] == 'card' and s['w'] and 'buy' in s['w'].lower())
        check(f'{tag}: setup: research of generation 2', st, st and {'w': st['w']})
        st = await sheet_ready(lambda t: 'buy' in t.lower())
        buy = st['offered'][:2]
        await tick(buy)
        await scroll_sheet(150)
        await phone.wait_for_timeout(200)
        await phone.screenshot(path=shot('07-research-ticked'))
        old = await state()
        old_w = mz.wf()
        old_seen = old['seen'] or {'boot': old['boot'], 'seq': old['seq'], 'epoch': old['epoch'],
                                   'age': old['age'], 'undo': old['undo'], 'q': djb2_key(old_w)}
        await other_moves(vera, '08-research', buy)
        if cleo: await other_moves(cleo, '09-research', buy)
        if not draft:
            # an answer made against the view before the others moved, as from a phone that had not heard of it yet:
            # Ada's own question did not change, so the answer must go through
            err = await mz.rpc({'type': 'input', 'playerId': mz.id, 'response': {'type': 'card', 'cards': buy}, 'seen': old_seen})
            check(f'{tag}: research: an answer made before the others moved is accepted (own question unchanged)', err is None,
                  {'error': err, 'seen': old_seen})
            got = await until(lambda: _is(state(), lambda s: s and all(c in s['hand'] for c in buy)), 10)
            check(f'{tag}: research: the two cards bought', got, got and {'hand': got['hand']})
        else:
            await phone.locator('[role=dialog] button.btn.warm').click()
            got = await until(lambda: _is(state(), lambda s: s and all(c in s['hand'] for c in buy) and not s['stale']), 10)
            st = await state()
            check(f'{tag}: research: Ada buys the two ticked cards from the phone', got, {'hand': st['hand'], 'stale': st['stale']})
        await phone.screenshot(path=shot('10-after-buy'))
        await ctx.close()
        for s in humans:
            try: await s.ws.close()
            except Exception: pass
    finally:
        srv.terminate()
        try: srv.wait(5)
        except Exception: srv.kill()


def answer_for(w):
    """A legal answer for an initial, draft or research question (the first corporation, the first card, nothing bought)."""
    t = w['type']
    if t == 'initialCards':
        return {'type': 'initialCards', 'responses': [{'type': 'card', 'cards': [w['options'][0]['cards'][0]['name']]}] +
                [{'type': 'card', 'cards': []} for _ in w['options'][1:]]}
    if t == 'card':
        n = max(w.get('min', 0), 0)
        return {'type': 'card', 'cards': [c['name'] for c in w['cards'][:n]]}
    raise AssertionError(f'unexpected question {t}')


async def _is(aw, pred):
    v = await aw
    return v if pred(v) else None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8902')
    ap.add_argument('--port', type=int, default=8901)
    ap.add_argument('--out', required=True)
    ap.add_argument('--bot', action='store_true', help='the third seat is a Normal bot at Quick')
    ap.add_argument('--only', choices=['plain', 'draft'], default=None)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    report = {'checks': {}, 'notes': []}
    def check(k, ok, info=None):
        report['checks'][k] = {'ok': bool(ok), **({'info': info} if info is not None else {})}
        print(('PASS ' if ok else 'FAIL ') + k, json.dumps(info) if info is not None else '', flush=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        try:
            if args.only in (None, 'plain'): await run_game(args, browser, False, report, check, 'plain')
            if args.only in (None, 'draft'): await run_game(args, browser, True, report, check, 'draft')
        finally:
            await browser.close()
    failed = [k for k, v in report['checks'].items() if not v['ok']]
    report['failed'] = failed
    json.dump(report, open(os.path.join(args.out, 'selection.json'), 'w'), indent=1)
    print(f'{len(report["checks"]) - len(failed)}/{len(report["checks"])} checks passed', *(['notes:'] + report['notes'] if report['notes'] else []), sep='\n')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    asyncio.run(main())
