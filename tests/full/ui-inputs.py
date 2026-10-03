"""Phone UI -> engine round trip for inputs a base-game deck rarely or never raises.

The engine's own input classes build each model (tests/full/engine-inputs.ts dump); this script shows each one
on a seated phone page, clicks through the real Decide.tsx flow, captures the InputResponse the page submits,
and hands the responses back to the engine classes (engine-inputs.ts check), which must accept them.

    npm run build   (or: npx vite build --outDir dist-ui and pass --dist dist-ui)
    python3 tests/full/ui-inputs.py [--port 8843] [--shots DIR]
"""
import argparse, asyncio, json, os, subprocess, sys, tempfile
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VENDOR = os.path.join(ROOT, 'vendor', 'tm')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8843)
    ap.add_argument('--dist', default='dist')
    ap.add_argument('--shots', default=None)
    args = ap.parse_args()
    work = tempfile.mkdtemp(prefix='tm-ui-inputs-')
    models_path = os.path.join(work, 'models.json'); resp_path = os.path.join(work, 'responses.json')
    subprocess.run(['cp', os.path.join(ROOT, 'tests/full/engine-inputs.ts'), VENDOR], check=True)
    subprocess.run(['npx', 'tsx', 'engine-inputs.ts', 'dump', models_path], cwd=VENDOR, check=True, capture_output=True)
    models = json.load(open(models_path))
    fixture = json.load(open(os.path.join(ROOT, 'tests/fixtures/full/player-action.json')))
    fixture['thisPlayer'].update({'heat': 10, 'megacredits': 3})
    env = {**os.environ, 'PORT': str(args.port), 'DATA_DIR': work, 'VISION_ENABLED': 'false', 'CLIENT_DIST': os.path.join(ROOT, args.dist),
           'ENGINE_URL': 'http://localhost:9'}
    srv = subprocess.Popen(['node', os.path.join(ROOT, 'dist-server/index.js')], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    responses = {}
    try:
        await asyncio.sleep(1.2)
        async with async_playwright() as pw:
            b = await pw.chromium.launch()
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            await ctx.add_init_script("try{localStorage.setItem('mars-ledger-player','me')}catch(e){}")
            pg = await ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await pg.goto(f'http://localhost:{args.port}/')
            await pg.wait_for_timeout(800)
            z = {k: 0 for k in ['megacredits', 'steel', 'titanium', 'plants', 'energy', 'heat']}
            player = {'id': 'me', 'name': 'Ada', 'color': 'red', 'corporation': None, 'tr': 20, 'stock': z, 'production': z, 'steelValue': 2,
                      'titaniumValue': 3, 'greeneryCost': 8, 'played': [], 'usedActions': [], 'milestones': [], 'handSize': 0, 'ready': False,
                      'passed': False, 'turnActions': 0, 'nextCardRequirementBonus': 0, 'nextCardDiscount': 0,
                      'tiles': {'cityOnMars': 0, 'cityOffMars': 0, 'greenery': 0, 'special': 0, 'oceans': 0}}
            gs = {'id': 'x', 'phase': 'full', 'mode': 'full', 'modules': ['base', 'corpera'], 'players': [player], 'order': ['me'], 'current': None,
                  'generation': 1, 'global': {'temperature': -30, 'oxygen': 0, 'oceans': 0, 'venus': 0}, 'awards': [], 'milestones': [], 'seq': 1,
                  'startedAt': 1, 'endedAt': None}
            await pg.evaluate("(gs) => window.__net.setState({state: gs, connected: true, input: async (pid, r) => { window.__captured = r; }})", gs)
            warm = lambda: pg.locator('[role=dialog] button.btn.warm:visible').last
            more = pg.locator('[role=dialog] button[aria-label="more"]')
            for kind, model in models.items():
                m = json.loads(json.dumps(fixture)); m['waitingFor'] = model; m['game']['gameAge'] += 1 + len(responses)
                await pg.evaluate("(m) => { window.__captured = null; window.__net.setState({fullView: {role: 'player', playerId: 'me', model: m, logs: []}}); }", m)
                await pg.wait_for_timeout(700)
                if kind == 'player':
                    await pg.locator('[role=dialog] [data-player="blue"]').click()
                elif kind == 'resource':
                    await pg.locator('[role=dialog] .btn.ghost').nth(3).click()
                else:
                    for _ in range(12):
                        if await warm().is_enabled(): break
                        await more.first.click()
                    if args.shots: await pg.screenshot(path=os.path.join(args.shots, f'ui-{kind}.png'))
                    await warm().click()
                await pg.wait_for_timeout(300)
                responses[kind] = await pg.evaluate('() => window.__captured')
                print(kind, '->', json.dumps(responses[kind]))
            await b.close()
            if errors: print('PAGE ERRORS', errors)
    finally:
        srv.terminate()
    json.dump(responses, open(resp_path, 'w'))
    r = subprocess.run(['npx', 'tsx', 'engine-inputs.ts', 'check', models_path, resp_path], cwd=VENDOR, capture_output=True, text=True)
    print('\n'.join(l for l in r.stdout.splitlines() if l.startswith(('OK', 'REJECTED', 'MISSING'))))
    sys.exit(r.returncode)

if __name__ == '__main__':
    asyncio.run(main())
