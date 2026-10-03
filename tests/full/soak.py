"""Full-game soak: plays complete games lobby -> final score through our server and a real engine.

    engine: (cd vendor/tm && mkdir -p db/files && PORT=8841 LOCAL_FS_DB=1 node build/src/server/server.js)
    build:  npm run build
    run:    python3 tests/full/soak.py [--games 3] [--ui-rate 0.08] [--shots DIR]

A bot answers every waitingFor over our WebSocket. Decisions whose input tree holds a type the phone UI
must prove (player, amount, payment, productionToLose, resource, resources, and) are instead clicked
through the real phone UI in Playwright (the page is seated as that player and submits over its own
socket), and a random share of ordinary decisions goes through the UI too. The engine must accept every
response. Game options come from ENGINE_GAME_OPTIONS (see src/server/full/engine.ts): some games use a
thinned deck so the cards that raise those inputs turn up.
Needs Python packages: websockets, playwright (chromium).
"""
import argparse, asyncio, collections, json, os, random, subprocess, sys, tempfile, time
import websockets
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CARDS = {c['name']: c for m in ('base', 'corpera', 'prelude') for c in json.load(open(os.path.join(ROOT, 'src/shared/data', m + '.json')))}

UI_TYPES = {'player', 'amount', 'payment', 'productionToLose', 'resource', 'resources', 'and'}

# Cards that raise the inputs above (base + Corporate Era), and enough terraforming to finish a game.
TARGETS = ['Flooding', 'Birds', 'Fish', 'Herbivores', 'Small Animals', 'Heat Trappers', 'Biomass Combustors', 'Energy Tapping',
           'Hackers', 'Great Escarpment Consortium', 'Asteroid Mining Consortium', 'Power Supply Consortium', 'Cloud Seeding',
           'Insulation', 'Power Infrastructure', 'Robotic Workforce', 'Search For Life', 'Sabotage', 'Hired Raiders', 'Virus',
           'Imported Nitrogen']
TERRAFORM = ['Asteroid', 'Comet', 'Big Asteroid', 'Giant Ice Asteroid', 'Deimos Down', 'Ice Cap Melting', 'Lake Marineris', 'Mangrove',
             'Tundra Farming', 'Kelp Farming', 'Plantation', 'Nitrogen-Rich Asteroid', 'Towing A Comet', 'Imported Hydrogen',
             'Imported GHG', 'GHG Factories', 'Power Plant', 'Geothermal Power', 'Solar Power', 'Mine', 'Lichen', 'Grass', 'Heather',
             'Trees', 'Bushes', 'Algae', 'Permafrost Extraction', 'Subterranean Reservoir', 'Water Import From Europa', 'Nuclear Zone',
             'Mohole Area', 'Magnetic Field Dome', 'Space Mirrors', 'Soletta', 'Strip Mine', 'Moss', 'Farming', 'Greenhouses',
             'Building Industries', 'Steelworks', 'Ironworks', 'Titanium Mine', 'Aquifer Pumping', 'Convoy From Europa']
FOCUS_CORPS = ['Helion', 'United Nations Mars Initiative', 'Tharsis Republic', 'Ecoline', 'CrediCor', 'Mining Guild']
PREFER = set(TARGETS)


def focus_options(n_players):
    # Ban every other remaining card: targets turn up often, and the deck (about 120 cards) still lasts a game.
    keep = set(TARGETS) | set(TERRAFORM)
    rest = sorted(n for n, c in CARDS.items() if c['group'] == 'project' and n not in keep)
    banned = rest[::2]
    return {'bannedCards': banned, 'customCorporationsList': FOCUS_CORPS[:max(6, n_players * 2)]}


def text(m):
    if m is None: return ''
    if isinstance(m, str): return m
    msg = m.get('message', '')
    for i, d in enumerate(m.get('data', [])): msg = msg.replace('${%d}' % i, str(d.get('value', '')))
    return msg


# ---------------------------------------------------------------------------------------------
class Seat:
    def __init__(self, sid, name, color):
        self.id, self.name, self.color = sid, name, color
        self.ws = None; self.view = None; self.state = None
        self.pending = {}; self.n = 0; self.page = None; self.stamp = 0
        self.fame = None; self.unlocks = None; self.profiles = None; self.posters = {}
        self.clock = None; self.clock_msgs = 0

    async def open(self, port, visible=True):
        self.ws = await websockets.connect(f'ws://localhost:{port}/ws', max_size=2 ** 24)
        # With --away the bot's socket is not a person looking: only the phone pages count as present.
        await self.ws.send(json.dumps({'type': 'hello', 'role': 'phone', 'playerId': self.id, 'visible': visible}))
        asyncio.create_task(self.reader())

    async def reader(self):
        async for raw in self.ws:
            m = json.loads(raw)
            t = m.get('type')
            if t in ('state', 'tick', 'undone'): self.state = m['state']
            elif t == 'full': self.view = m['view']; self.stamp += 1
            elif t == 'fame': self.fame = m['fame']
            elif t == 'unlocks': self.unlocks = m['unlocks']
            elif t == 'poster': self.posters[m['poster']['gameId']] = m['poster']
            elif t == 'profiles': self.profiles = m['profiles']
            elif t == 'turnClock': self.clock = m['clock']; self.clock_msgs += 1
            elif t in ('ack', 'nack'):
                f = self.pending.pop(m['id'], None)
                if f and not f.done(): f.set_result(m.get('error'))

    async def rpc(self, msg):
        self.n += 1; mid = f'{self.id}-{self.n}'
        f = asyncio.get_event_loop().create_future(); self.pending[mid] = f
        await self.ws.send(json.dumps({**msg, 'id': mid}))
        return await asyncio.wait_for(f, 60)

    def model(self): return self.view['model'] if self.view and self.view.get('role') == 'player' else None
    def any_model(self): return self.view['model'] if self.view else None
    def wf(self):
        m = self.model(); return m.get('waitingFor') if m else None
    def age(self):
        m = self.model(); return (m['game']['gameAge'], m['game']['undoCount']) if m else None
    def sig(self):
        """Changes whenever this player's situation changes (draft picks do not move gameAge)."""
        m = self.model(); return json.dumps([self.age(), m.get('waitingFor'), len(m['cardsInHand']), len(m.get('draftedCards') or [])], sort_keys=True) if m else None


# ---- the bot ----------------------------------------------------------------------------------
def pay_for(me, cost, tags, opts):
    """A legal payment: titanium for space, steel for building, heat when allowed, the rest M€."""
    left = cost; p = {'megacredits': 0, 'steel': 0, 'titanium': 0, 'heat': 0}
    if 'space' in tags and me['titanium']:
        n = min(me['titanium'], left // me['titaniumValue']); p['titanium'] = n; left -= n * me['titaniumValue']
    if 'building' in tags and me['steel']:
        n = min(me['steel'], left // me['steelValue']); p['steel'] = n; left -= n * me['steelValue']
    if opts.get('heat') and me['heat']:
        n = min(me['heat'], left); p['heat'] = n; left -= n
    n = min(me['megacredits'], left); p['megacredits'] = n; left -= n
    if left > 0 and 'space' in tags and me['titanium'] > p['titanium']: p['titanium'] += 1; left -= me['titaniumValue']
    if left > 0 and 'building' in tags and me['steel'] > p['steel']: p['steel'] += 1; left -= me['steelValue']
    if left > 0: return None
    full = {k: 0 for k in ['megacredits', 'steel', 'titanium', 'heat', 'plants', 'microbes', 'floaters', 'lunaArchivesScience',
                           'spireScience', 'seeds', 'auroraiData', 'graphene', 'kuiperAsteroids']}
    full.update(p); return full


def option_kind(o):
    t = text(o.get('title')).lower(); ty = o['type']
    if ty == 'projectCard': return 'standard' if 'standard' in t else 'play'
    if ty == 'card' and o.get('selectBlueCardAction'): return 'action'
    if 'sell patents' in t: return 'sell'
    if 'milestone' in t: return 'milestone'
    if 'award' in t: return 'award'
    if ty == 'space' and 'greenery' in t: return 'plants'
    if 'heat' in t and 'temperature' in t: return 'heat'
    if t.startswith('pass'): return 'pass'
    if t == 'end turn': return 'end'
    if 'undo' in t: return 'undo'
    return 'other'


class Bot:
    def __init__(self, rng): self.rng = rng; self.failed = set()

    def answer(self, w, me, model, key):
        """Return (response, path) or None. path = list of steps the UI can replay."""
        return self._ans(w, me, model, key, ())

    def _ans(self, w, me, model, key, where):
        ty = w['type']
        if ty == 'or':
            opts = w['options']
            order = sorted(range(len(opts)), key=lambda i: self.rank(opts[i], me, model))
            for i in order:
                if (key, where + (i,)) in self.failed: continue
                if self.rank(opts[i], me, model) >= 90: continue
                sub = self._ans(opts[i], me, model, key, where + (i,))
                if sub: return {'type': 'or', 'index': i, 'response': sub[0]}, [('or', i)] + sub[1]
            # nothing good: pass / end / first option that works
            for want in ('pass', 'end', 'other', 'option'):
                for i, o in enumerate(opts):
                    if (key, where + (i,)) in self.failed: continue
                    if option_kind(o) == want or (want == 'option' and o['type'] == 'option' and option_kind(o) != 'undo'):
                        sub = self._ans(o, me, model, key, where + (i,))
                        if sub: return {'type': 'or', 'index': i, 'response': sub[0]}, [('or', i)] + sub[1]
            return None
        if ty == 'and':
            rs, path = [], [('and', len(w['options']))]
            for j, o in enumerate(w['options']):
                sub = self._ans(o, me, model, key, where + (j,))
                if not sub: return None
                rs.append(sub[0]); path += sub[1]
            return {'type': 'and', 'responses': rs}, path
        if ty == 'initialCards':
            # Steps arrive in the engine's order: corporation, then (with Prelude) two preludes, then cards to buy.
            by_kind = {}
            for o in w['options']:
                t = text(o.get('title')).lower()
                by_kind['corp' if 'corporation' in t else 'prelude' if 'prelude' in t else 'buy'] = o
            names = [c['name'] for c in by_kind['corp']['cards']]
            corp = next((n for n in ('Helion', 'United Nations Mars Initiative') if n in names), names[0])
            start = CARDS.get(corp, {}).get('startingMegaCredits') or 40
            preludes = []
            if 'prelude' in by_kind:
                pnames = [c['name'] for c in by_kind['prelude']['cards']]
                # prefer preludes that exercise more of the flow (a card from hand, a tile), then any
                liked = ('Eccentric Sponsor', 'Ecology Experts', 'Great Aquifer', 'Early Settlement', 'Huge Asteroid')
                preludes = sorted(pnames, key=lambda n: (n not in liked, pnames.index(n)))[:by_kind['prelude']['max']]
            buy_in = by_kind['buy']
            buy = self.pick_buy(buy_in['cards'], min(buy_in['max'], (start - 15) // 3))
            responses = []
            for o in w['options']:
                k = next(k for k, v in by_kind.items() if v is o)
                responses.append({'type': 'card', 'cards': [corp] if k == 'corp' else preludes if k == 'prelude' else buy})
            return {'type': 'initialCards', 'responses': responses}, [('initialCards', corp, buy, preludes)]
        if ty == 'option': return {'type': 'option'}, [('option',)]
        if ty == 'projectCard':
            cards = [c for c in w['cards'] if not c.get('isDisabled')]
            std = 'standard' in text(w.get('title')).lower()
            if std:
                prefs = ['Aquifer', 'Asteroid:SP', 'Greenery', 'City', 'Power Plant:SP']
                cards.sort(key=lambda c: prefs.index(c['name']) if c['name'] in prefs else 9)
                budget_ok = [c for c in cards if me['megacredits'] >= c['calculatedCost']]
                cards = budget_ok
            else:
                cards.sort(key=lambda c: (c['name'] not in PREFER, -c.get('calculatedCost', 0)))
            for c in cards:
                if (key, where + ('card', c['name'])) in self.failed: continue
                tags = [] if std else CARDS.get(c['name'], {}).get('tags', [])
                p = pay_for(me, c.get('calculatedCost', 0), tags, w.get('paymentOptions') or {})
                if p: return {'type': 'projectCard', 'card': c['name'], 'payment': p}, [('projectCard', c['name'])]
            return None
        if ty == 'card':
            cards = w['cards']; t = text(w.get('title')).lower()
            if w.get('selectBlueCardAction'):
                for c in cards:
                    if (key, where + ('card', c['name'])) not in self.failed:
                        return {'type': 'card', 'cards': [c['name']]}, [('card', [c['name']])]
                return None
            if 'sell patents' in t: return None
            if 'buy' in t:
                useful = [c for c in cards if c['name'] in PREFER or c['name'] in TERRAFORM]
                sel = self.pick_buy(useful, min(w['max'], 2, me['megacredits'] // 3 - 5))
            elif 'keep' in t:
                avail = [c for c in cards if not c.get('isDisabled')] or cards
                sel = self.pick_buy(avail, 1)
            else:
                k = max(w['min'], min(1, w['max']))
                sel = [c['name'] for c in cards[:k]]
            if len(sel) < w['min']: sel = [c['name'] for c in cards[:w['min']]]
            return {'type': 'card', 'cards': sel}, [('card', sel)]
        if ty == 'space':
            spaces = w['spaces']
            return {'type': 'space', 'spaceId': self.rng.choice(spaces)}, [('space',)]
        if ty == 'player':
            others = [p for p in w['players'] if p != model['color']] or w['players']
            return {'type': 'player', 'player': others[0]}, [('player', others[0])]
        if ty == 'amount':
            return {'type': 'amount', 'amount': w['max']}, [('amount',)]
        if ty == 'payment':
            po = w.get('paymentOptions') or {}
            p = pay_for(me, w['amount'], (['space'] if po.get('titanium') else []) + (['building'] if po.get('steel') else []), po)
            return ({'type': 'payment', 'payment': p}, [('payment',)]) if p else None
        if ty == 'productionToLose':
            pp = w['payProduction']; left = pp['cost']; u = {}
            for r, n in pp['units'].items():
                k = min(n, left); u[r] = k; left -= k
            return {'type': 'productionToLose', 'units': u}, [('productionToLose',)]
        if ty == 'resource':
            return {'type': 'resource', 'resource': w['include'][0]}, [('resource',)]
        if ty == 'resources':
            return {'type': 'resources', 'units': {'megacredits': w['count'], 'steel': 0, 'titanium': 0, 'plants': 0, 'energy': 0, 'heat': 0}}, [('resources',)]
        return None

    def pick_buy(self, cards, n):
        if n <= 0: return []
        ranked = sorted(cards, key=lambda c: (c['name'] not in PREFER, c['name'] not in TERRAFORM, c.get('calculatedCost', 99)))
        return [c['name'] for c in ranked[:n]]

    def rank(self, o, me, model):
        k = option_kind(o)
        mc = me['megacredits']
        if k == 'undo': return 99
        if k == 'sell': return 95
        if k == 'plants': return 0
        if k == 'heat': return 1
        if k == 'milestone': return 2
        if k == 'play': return 3
        if k == 'standard' and mc >= 18: return 3.5
        if k == 'action': return 4
        if k == 'award': return 5 if mc >= 30 and model['game']['generation'] >= 4 else 96
        if k == 'standard': return 6
        if k == 'other': return 7
        if k in ('end', 'pass'): return 97
        return 8


# ---- driving the real phone UI ---------------------------------------------------------------
async def ui_answer(seat, path, shots, tag):
    """Replay the bot's chosen path by clicking the phone page. The page submits over its own socket."""
    pg = seat.page
    want = seat.sig()
    wf_json = json.dumps(seat.wf(), sort_keys=True)
    # wait until the page shows the same question the bot saw
    for _ in range(150):
        a = await pg.evaluate("() => { const v = window.__net.getState().fullView; return v && v.model && v.model.waitingFor ? JSON.stringify(v.model.waitingFor) : null }")
        if a and json.dumps(json.loads(a), sort_keys=True) == wf_json: break
        await asyncio.sleep(0.1)
    else:
        return 'page never showed the question the bot saw'
    await pg.wait_for_timeout(250)
    pg.set_default_timeout(6000)
    try:
        # Let a closing sheet finish its exit animation, then open the question if it is not showing.
        await pg.wait_for_timeout(500)
        dlg = pg.locator('[role=dialog]')
        if not await dlg.count():
            await pg.locator('[data-testid=dock-go]').click()
        # The production show holds questions back for ~7 s after a generation turns over.
        await pg.locator('[role=dialog]').last.wait_for(state='visible', timeout=12000)
        await pg.wait_for_timeout(350)
        return await _ui_steps(seat, pg, path, shots, tag, want)
    except Exception as e:
        w = seat.wf() or {}
        await pg.screenshot(path=os.path.join(SHOT_ERR, f'{tag}.png'))
        return f'UI step failed on {w.get("type")} "{text(w.get("title"))}": {str(e).splitlines()[0]}'


SHOT_ERR = tempfile.mkdtemp(prefix='tm-soak-err-')


async def _ui_steps(seat, pg, path, shots, tag, want):
    warm = lambda: pg.locator('[role=dialog] button.btn.warm:visible').last
    prev = None
    for step in path:
        kind = step[0]
        if kind == 'or':
            b = pg.locator(f'[role=dialog] [data-opt="{step[1]}"]').first
            await b.click(); await pg.wait_for_timeout(250)
            try:
                if 'Tap again' in (await b.text_content(timeout=400) or ''): await b.click()
            except Exception:
                pass  # the row navigated away or submitted
            await pg.wait_for_timeout(300)
        elif kind == 'option' and prev and prev[0] == 'or':
            pass  # a leaf option inside an 'or' submits on the row tap
        elif kind == 'and':
            pass
        elif kind == 'initialCards':
            await pg.locator(f'[role=dialog] [data-card="{step[1]}"]').click(); await warm().click(); await pg.wait_for_timeout(400)
            if len(step) > 3 and step[3]:
                for n in step[3]: await pg.locator(f'[role=dialog] [data-card="{n}"]').click()
                if shots: await pg.screenshot(path=os.path.join(shots, f'{tag}-preludes-picked.png'))
                await warm().click(); await pg.wait_for_timeout(400)
            for n in step[2]: await pg.locator(f'[role=dialog] [data-card="{n}"]').click()
            await warm().click()
        elif kind == 'projectCard':
            await pg.locator(f'[role=dialog] [data-card="{step[1]}"]').first.click(); await pg.wait_for_timeout(350)
            if shots: await pg.screenshot(path=os.path.join(shots, f'{tag}-projectCard.png'))
            await warm().click()
        elif kind == 'card':
            for n in step[1]: await pg.locator(f'[role=dialog] [data-card="{n}"]').first.click()
            if shots: await pg.screenshot(path=os.path.join(shots, f'{tag}-card.png'))
            await warm().click()
        elif kind == 'space':
            await pg.locator('[role=dialog] g[data-space][style*="cursor: pointer"]').first.click(); await pg.wait_for_timeout(250)
            if shots: await pg.screenshot(path=os.path.join(shots, f'{tag}-space.png'))
            await warm().click()
        elif kind == 'player':
            await pg.locator(f'[role=dialog] [data-player="{step[1]}"]').click()
        elif kind in ('amount', 'payment', 'option', 'resources', 'productionToLose'):
            if kind == 'resources' or kind == 'productionToLose':
                # fill the steppers up to the required total
                for _ in range(30):
                    if await warm().is_enabled(): break
                    await pg.locator('[role=dialog] button[aria-label="more"]').first.click()
            if shots: await pg.screenshot(path=os.path.join(shots, f'{tag}-{kind}.png'))
            await warm().click()
        elif kind == 'resource':
            await pg.locator('[role=dialog] .btn.ghost').first.click()
        await pg.wait_for_timeout(150)
        prev = step
    # wait for the engine to move on or for an error to show
    for _ in range(150):
        if seat.sig() != want: return None
        err = pg.locator('[role=dialog] [role=alert]')
        if await err.count() and await err.first.is_visible():
            return (await err.first.text_content()) or 'error'
        await asyncio.sleep(0.1)
    return 'engine did not move after the UI submitted'


# ---- smart hints: re-derive every hint the phone shows from the engine model -------------------
SCALE = {'temperature': 2, 'oxygen': 1, 'oceans': 1}
MAXV = {'temperature': 8, 'oxygen': 14, 'oceans': 9}
PARAM_KEY = {'temperature': 'temperature', 'oxygen': 'oxygenLevel', 'oceans': 'oceans'}


def expected_badges(model):
    """Card badges, derived independently: exactly one requirement unmet and within reach, all others met."""
    me = model['thisPlayer']; g = model['game']
    tags = me['tags'] if isinstance(me['tags'], dict) else {t['tag']: t['count'] for t in me['tags']}
    tag = lambda t: tags.get(t, 0) + (0 if t == 'wild' else tags.get('wild', 0))
    bonus = sum((CARDS.get(c['name']) or {}).get('requirementBonus') or 0 for c in me['tableau'])
    if me['tableau'] and me['tableau'][-1]['name'] == 'Special Design': bonus += 2
    prod = {'megacredits': me['megacreditProduction'], 'steel': me['steelProduction'], 'titanium': me['titaniumProduction'],
            'plants': me['plantProduction'], 'energy': me['energyProduction'], 'heat': me['heatProduction']}
    greeneries = sum(1 for s in g['spaces'] if s.get('color') == model['color'] and s.get('tileType') == 0)
    out = {}
    for c in model['cardsInHand']:
        d = CARDS.get(c['name'])
        if not d or d['group'] != 'project' or not d['requirements']: continue
        near = None; ok = True
        for r in d['requirements']:
            par = next((k for k in ('temperature', 'oxygen', 'oceans', 'venus') if k in r), None)
            if par == 'venus': ok = False; break
            if par:
                have = g[PARAM_KEY[par]]; tol = bonus * SCALE[par]
                if r.get('max'):
                    if have <= r[par] + tol: continue
                    ok = False; break
                target = r[par] - tol
                if have >= target: continue
                steps = -(-(target - have) // SCALE[par])
                if steps > 2 or target > MAXV[par] or near: ok = False; break
                near = (par, target, steps); continue
            if 'tag' in r:
                if r.get('all') or r.get('max'): ok = False; break
                need = r.get('count', 1)
                if tag(r['tag']) >= need: continue
                if need - tag(r['tag']) > 1 or near: ok = False; break
                near = ('tag', r['tag'], 1); continue
            if 'production' in r:
                if prod.get(r['production'], -99) >= r.get('count', 1): continue
                ok = False; break
            if 'greeneries' in r:
                if not r.get('all') and greeneries >= r.get('count', r['greeneries']): continue
                ok = False; break
            if 'tr' in r:
                if me['terraformRating'] >= r.get('count', r['tr']): continue
                ok = False; break
            ok = False; break
        if ok and near:
            par, target, steps = near
            out[c['name']] = (f'1 more {target} tag' if par == 'tag' else f'{steps} more ocean{"s" if steps > 1 else ""}' if par == 'oceans'
                              else f'{target} °C · {steps} step{"s" if steps > 1 else ""} to go' if par == 'temperature'
                              else f'{target}% O₂ · {steps} step{"s" if steps > 1 else ""} to go')
    return out


def engine_playable(w):
    names = set()
    for o in (w or {}).get('options', []) if (w or {}).get('type') == 'or' else []:
        if o['type'] == 'projectCard' and 'standard' not in text(o.get('title')).lower():
            names |= {c['name'] for c in o['cards'] if not c.get('isDisabled')}
    return names


def check_turn_hints(model, w, shown):
    """Every turn hint must be true by the engine's own data; every hint the menu supports must be shown."""
    errs = []
    me = model['thisPlayer']; g = model['game']; color = model['color']
    opts = {text(o.get('title')): o for o in w.get('options', [])}
    expect = set()
    mil = opts.get('Claim a milestone')
    for o in (mil or {}).get('options', []):
        expect.add('milestone:' + text(o['title']))
    award = next((o for t, o in opts.items() if t.startswith('Fund an award')), None)
    if award and len(model['players']) > 1:
        for o in award['options']:
            name = text(o['title']); a = next((x for x in g['awards'] if x['name'] == name), None)
            if not a or a.get('color'): continue
            mine = next((s['score'] for s in a['scores'] if s['color'] == color), None)
            others = [s['score'] for s in a['scores'] if s['color'] != color]
            if mine and others and mine >= max(others): expect.add('award:' + name)
    if any(t.endswith('plants into greenery') for t in opts): expect.add('plants')
    if 'Convert 8 heat into temperature' in opts and g['temperature'] < 8: expect.add('heat')
    acts = next((o for o in w.get('options', []) if o['type'] == 'card' and o.get('selectBlueCardAction')), None)
    if acts and acts['cards']: expect.add('actions')
    got = {h['id'] for h in shown}
    if got != expect: errs.append(f'turn hints {sorted(got)} != expected {sorted(expect)}')
    for h in shown:
        kind = h['kind']
        if kind == 'milestone':
            name = h['id'].split(':', 1)[1]
            m = next((x for x in g['milestones'] if x['name'] == name), None)
            sc = next((s for s in (m or {}).get('scores', []) if s['color'] == color), None)
            if not m or m.get('color') or not sc or not sc.get('claimable'): errs.append(f'milestone {name} not claimable by the engine')
            if me['megacredits'] < 8: errs.append(f'milestone {name} hinted with {me["megacredits"]} M€')
        elif kind == 'award':
            name = h['id'].split(':', 1)[1]
            a = next(x for x in g['awards'] if x['name'] == name)
            mine = next(s['score'] for s in a['scores'] if s['color'] == color)
            best = max(s['score'] for s in a['scores'] if s['color'] != color)
            lead = mine - best
            want = f'{name}: you lead by {lead}' if lead > 0 else f'{name}: you share the lead'
            if lead < 0 or h['line'] != want: errs.append(f'award line {h["line"]!r}, engine scores say {want!r}')
        elif kind == 'plants':
            cost = 7 if any(c['name'] == 'Ecoline' for c in me['tableau']) else 8
            if me['plants'] < cost or f'a greenery costs {cost}' not in h['facts'][0]: errs.append(f'plants hint with {me["plants"]} plants (cost {cost}): {h["facts"]}')
        elif kind == 'heat':
            if me['heat'] < 8 or g['temperature'] >= 8: errs.append(f'heat hint with {me["heat"]} heat at {g["temperature"]} °C')
        elif kind == 'actions':
            names = [c['name'] for c in acts['cards']] if acts else []
            for n in names:
                if n not in [c['name'] for c in me['tableau']] or n in me.get('actionsThisGeneration', []):
                    errs.append(f'action {n} is not an unused card in play')
    return errs


async def check_hand(seat, stats, tag):
    """Hand tools: with the hand filtered to "playable", the deck shows exactly the engine's playable set."""
    model = seat.model(); w = seat.wf()
    age = (model['game']['gameAge'], model['game']['undoCount'])
    h = None
    for _ in range(40):
        h = await seat.page.evaluate('() => window.__hand || null')
        if h and (h['age'], h['undo']) == age: break
        await asyncio.sleep(0.1)
    else:
        if model.get('cardsInHand'): stats['hand_errors'].append(f'{tag}: the hand never showed this model ({h and h.get("age")})')
        return
    stats['hand_checks'] += 1
    want = engine_playable(w) & {c['name'] for c in model.get('cardsInHand', [])}
    if h['view']['filter'] == 'playable' and set(h['shown']) != want:
        stats['hand_errors'].append(f"{tag}: playable filter shows {sorted(h['shown'])}, engine offers {sorted(want)}")
    stats['hand_synergy'] += sum(1 for v in h['synergy'].values() if v)


async def check_hints(seat, stats, shots, tag):
    """Wait for the phone to compute hints for the current model, then verify them."""
    model = seat.model(); w = seat.wf()
    age = (model['game']['gameAge'], model['game']['undoCount'])
    h = None
    for _ in range(40):
        h = await seat.page.evaluate('() => window.__hints || null')
        if h and (h['age'], h['undo']) == age and h['on']: break
        await asyncio.sleep(0.1)
    else:
        stats['hint_errors'].append(f'{tag}: the phone never showed hints for this model ({h and (h.get("age"), h.get("on"))})'); return
    stats['hint_checks'] += 1
    errs = []
    want_badges = expected_badges(model)
    got_badges = {c['card']: c['badge'] for c in h['cards']}
    if got_badges != want_badges: errs.append(f'badges {got_badges} != expected {want_badges}')
    playable = engine_playable(w)
    for name in got_badges:
        if name in playable: errs.append(f'{name} has a badge but the engine says it is playable now')
    if w and w.get('type') == 'or' and text(w.get('title')).lower().startswith('take your'):
        errs += check_turn_hints(model, w, h['turn'])
        for x in h['turn']: stats['hints_shown'][x['kind']] += 1
        line = seat.page.locator('[data-testid=hint-line]')
        if h['turn'] and not await line.count():
            # The line waits while the production show (~7 s after a generation turns over) owns the screen,
            # and must appear once it is over (unless the model moved on meanwhile).
            if not h.get('showing'):
                errs.append('turn hints computed but no hint line on the dock (no production show playing)')
            else:
                stats['hint_line_waits'] += 1
                for _ in range(120):
                    if await line.count() or seat.model()['game']['gameAge'] != age[0]: break
                    await asyncio.sleep(0.1)
                if seat.model()['game']['gameAge'] == age[0] and not await line.count():
                    errs.append('no hint line after the production show ended')
        if h['turn'] and shots and stats['hint_shots'] < 6:
            stats['hint_shots'] += 1
            await seat.page.screenshot(path=os.path.join(shots, f'{tag}-hints.png'))
    elif h['turn']:
        errs.append(f'turn hints outside the turn menu: {[x["id"] for x in h["turn"]]}')
    stats['badges_shown'] += len(got_badges)
    for e in errs: stats['hint_errors'].append(f'{tag}: {e}')


# ---- bots: what the server's bot seats did (BOT_LOG, one JSON line per decision) ------------------
def bot_report(path, stats):
    rows = [json.loads(l) for l in open(path)] if os.path.exists(path) else []
    out = {}
    for r in rows:
        b = out.setdefault(r['name'], {'level': r['level'], 'decisions': 0, 'refused': 0, 'defaults': 0, 'stuck': 0, 'waits_ms': [], 'kinds': collections.Counter()})
        if r['outcome'] in ('ok', 'default'):
            b['decisions'] += 1
            if r.get('waitedMs') is not None: b['waits_ms'].append(r['waitedMs'])
            b['kinds'][(r.get('choice') or '').split(' ')[0]] += 1
        if r['outcome'] == 'default': b['defaults'] += 1
        if r['outcome'] == 'refused':
            b['refused'] += 1
            stats['bot_refusals'].append(f"{r['name']} gen{r['generation']} {r['prompt']}: {r.get('choice')} -> {r.get('error')}")
        if r['outcome'] == 'stuck': b['stuck'] += 1
    for b in out.values():
        w = sorted(b.pop('waits_ms'))
        b['wait_ms'] = {'n': len(w), 'median': w[len(w) // 2] if w else None, 'max': w[-1] if w else None}
        b['kinds'] = dict(b['kinds'].most_common(8))
    return out


# ---- a game ---------------------------------------------------------------------------------
async def set_visible(page, visible):
    """Stand-in for a phone locking its screen: the page reports hidden/visible to the app."""
    await page.evaluate('''(v) => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => v ? 'visible' : 'hidden'});
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => !v}); document.dispatchEvent(new Event('visibilitychange')); }''', visible)


async def away_step(a, seat, g, args, stats, tag):
    """--away: hide seat 1's page in generation 2, return after the next production, check the summary it gets."""
    m = seat.model()
    if not m: return
    if a['phase'] == 'idle' and g >= 2 and m['game']['phase'] == 'action':
        await set_visible(seat.page, False)
        a.update(phase='hidden', hide_gen=g, hid_at=time.time(), pre=m)
        return
    if a['phase'] != 'hidden': return
    # the last model before each production pays this player: M€ production + TR
    if m['game']['generation'] == (a['pre'] or m)['game']['generation']:
        a['pre'] = m
    else:
        p = a['pre']['thisPlayer']
        a['income'].append(p['megacreditProduction'] + p['terraformRating'])
        a['pre'] = m
    if g > a['hide_gen'] and m['game']['phase'] == 'action' and time.time() - a['hid_at'] > args.away / 1000 + 1:
        await set_visible(seat.page, True)
        a['phase'] = 'back'
        summary = None
        for _ in range(60):
            summary = await seat.page.evaluate('() => window.__net.getState().away')
            if summary: break
            await asyncio.sleep(0.1)
        shown = await seat.page.locator('[data-testid=away-card]').count()
        if args.shots:
            await seat.page.wait_for_timeout(700)
            await seat.page.screenshot(path=os.path.join(args.shots, f'{tag}-away-{seat.name}.png'))
        rec = {'shown': bool(shown), 'summary': summary, 'expected_income_mc': sum(a['income']), 'hide_gen': a['hide_gen'], 'back_gen': g}
        errs = []
        if not summary: errs.append('no summary arrived')
        else:
            gens = summary.get('generations') or {}
            if gens.get('from') != a['hide_gen'] or gens.get('to') != g: errs.append(f"generations {gens} != {a['hide_gen']}->{g}")
            got = (summary.get('income') or {}).get('gains', {}).get('megacredits')
            if got != sum(a['income']): errs.append(f'income M€ {got} != expected {sum(a["income"])}')
            if (summary.get('income') or {}).get('times') != len(a['income']): errs.append(f"income times {(summary.get('income') or {}).get('times')} != {len(a['income'])}")
        # the card dismisses itself after 8 s
        gone = False
        for _ in range(110):
            if not await seat.page.locator('[data-testid=away-card]').count(): gone = True; break
            await asyncio.sleep(0.1)
        rec['dismissed_by_itself'] = gone
        if not gone: errs.append('card did not dismiss itself')
        rec['errors'] = errs
        stats['away'].append(rec)
        if errs: stats['ui_errors'].append(f'{tag} away: {errs}')
        print(f'  {tag} away check: {rec}', flush=True)


async def play_game(args, gi, n_players, draft, focus, stats, browser):
    port = args.port
    data = args.shared_data or (os.path.join(args.data, f'game{gi}') if args.data else tempfile.mkdtemp(prefix='tm-soak-'))
    os.makedirs(data, exist_ok=True)
    env = {**os.environ, 'PORT': str(port), 'DATA_DIR': data, 'ENGINE_URL': args.engine, 'ENGINE_POLL_MS': '400',
           'VISION_ENABLED': 'false', 'CLIENT_DIST': os.environ.get('CLIENT_DIST', os.path.join(ROOT, 'dist')),
           **({'AWAY_MIN_MS': str(args.away)} if args.away else {}),
           'BOT_DELAY_SCALE': str(args.bot_delay), 'BOT_LOG': os.path.join(data, 'bots.jsonl'),
           'ENGINE_GAME_OPTIONS': json.dumps({**(focus_options(n_players) if focus else {}),
                                              **({'customPreludes': args.custom_preludes.split(',')} if args.custom_preludes else {})})}
    srv = subprocess.Popen(['node', os.environ.get('SERVER_JS', os.path.join(ROOT, 'dist-server/index.js'))], cwd=ROOT, env=env,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    rng = random.Random(1000 + gi)
    bot = Bot(rng)
    tag = f'g{gi}-{n_players}p-{"draft" if draft else "nodraft"}{"-focus" if focus else ""}'
    t0 = time.time()
    try:
        for _ in range(100):
            try:
                import urllib.request; urllib.request.urlopen(f'http://localhost:{port}/api/config', timeout=1); break
            except Exception: await asyncio.sleep(0.1)
        colors = ['red', 'blue', 'green', 'yellow', 'black']
        seats = [Seat(f's{gi}{i}', ['Ada', 'Vera', 'Nova', 'Ada', 'Lee'][i], colors[i]) for i in range(n_players)]
        for s in seats: await s.open(port, visible=not args.away)
        # With no people at the table, a seatless phone runs the lobby and watches the spectator view.
        host = seats[0] if seats else Seat(f'w{gi}', 'Watcher', 'red')
        if not seats: await host.open(port)
        bot_specs = [b for b in (args.bots or '').split(',') if b]
        obs = lambda: host.any_model()
        if args.profiles:
            # a shared data dir resumes the previous (finished) game: open a new lobby, as players do
            for _ in range(50):
                if host.state: break
                await asyncio.sleep(0.1)
            if host.state and host.state['phase'] != 'lobby':
                assert (await host.rpc({'type': 'newGame', 'force': True})) is None
                await asyncio.sleep(0.3)
            # the same people every game of the run: profiles persist in the shared data dir
            for s in seats:
                pid = 'prof-' + s.name.lower()
                err = await s.rpc({'type': 'profile', 'op': 'create', 'device': s.id, 'profile': {'id': pid, 'name': s.name, 'color': s.color, 'avatar': None}})
                assert err is None, err
                s.profile_id = pid
        for s in seats:
            cmd = {'t': 'join', 'playerId': s.id, 'name': s.name, 'color': s.color}
            if args.profiles: cmd['profileId'] = s.profile_id
            assert (await s.rpc({'type': 'cmd', 'command': cmd})) is None
        if args.hints:
            # seat 0 plays with smart hints on: on the profile when there is one, else on the seat
            if args.profiles:
                assert (await host.rpc({'type': 'profile', 'op': 'update', 'profileId': seats[0].profile_id, 'patch': {'hints': True}})) is None
            else:
                assert (await host.rpc({'type': 'seatPref', 'playerId': seats[0].id, 'hints': True})) is None
        if args.narrator:
            assert (await host.rpc({'type': 'cmd', 'command': {'t': 'narrator', 'playerId': host.id, 'mode': args.narrator}})) is None
        if args.poster_unique:
            assert (await host.rpc({'type': 'cmd', 'command': {'t': 'posterArt', 'playerId': host.id, 'unique': True}})) is None
        if args.board:
            assert (await host.rpc({'type': 'cmd', 'command': {'t': 'setBoard', 'playerId': host.id, 'board': args.board}})) is None
        if args.prelude:
            assert (await host.rpc({'type': 'cmd', 'command': {'t': 'setPrelude', 'playerId': host.id, 'on': True}})) is None
        if args.fast_mode:
            assert (await host.rpc({'type': 'cmd', 'command': {'t': 'setFastMode', 'playerId': host.id, 'on': True}})) is None
        if args.turn_clock:
            assert (await host.rpc({'type': 'cmd', 'command': {'t': 'setTurnClock', 'playerId': host.id, 'clock': args.turn_clock}})) is None
        # Bot seats: added from the lobby like the phone's "Add a bot", in the next free colours.
        bot_ids = []
        if not seats:
            for _ in range(50):
                if host.state: break
                await asyncio.sleep(0.1)
            if host.state and host.state['phase'] != 'lobby':
                assert (await host.rpc({'type': 'newGame', 'force': True})) is None
                await asyncio.sleep(0.3)
        for k, level in enumerate(bot_specs):
            bid = f'b{gi}{k}'
            err = await host.rpc({'type': 'cmd', 'command': {'t': 'addBot', 'playerId': host.id, 'botId': bid, 'name': ['Ares', 'Deimos', 'Phobos', 'Olympus'][k],
                                                             'color': colors[n_players + k], 'level': level}})
            assert err is None, err
            bot_ids.append(bid)
        err = await host.rpc({'type': 'cmd', 'command': {'t': 'start', 'playerId': host.id, 'modules': ['base', 'corpera'],
                                  'order': [s.id for s in seats] + bot_ids, 'mode': 'full', 'draft': draft}})
        assert err is None, err
        if bot_ids:
            # A phone can never answer for a bot: the server refuses the input and seats a page that names the bot as a guest.
            err = await host.rpc({'type': 'input', 'playerId': bot_ids[0], 'response': {'type': 'option'}})
            stats['bot_guard'].append(f'input for a bot: {err}')
            if not err: stats['ui_errors'].append(f'{tag}: the server accepted an input for a bot seat')
        # a seated phone page per player, and the TV
        for s in seats:
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
            await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{s.id}')}}catch(e){{}}")
            if args.hand_view:
                await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-hand-view', {json.dumps(args.hand_view)})}}catch(e){{}}")
            s.page = await ctx.new_page()
            s.page.on('pageerror', lambda e, s=s: stats['pageerrors'].append(f'{s.name}: {e}'))
            await s.page.goto(f'http://localhost:{port}/')
        tvctx = await browser.new_context(viewport={'width': 1920, 'height': 1080})
        tv = await tvctx.new_page(); tv.on('pageerror', lambda e: stats['pageerrors'].append(f'TV: {e}'))
        await tv.goto(f'http://localhost:{port}/tv')
        tv4 = None
        if args.prelude and args.shots:
            tv4ctx = await browser.new_context(viewport={'width': 3840, 'height': 2160})
            tv4 = await tv4ctx.new_page(); await tv4.goto(f'http://localhost:{port}/tv')
        reveal_shot = False
        if bot_ids:
            ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1, has_touch=True, is_mobile=True)
            await ctx.add_init_script(f"try{{localStorage.setItem('mars-ledger-player','{bot_ids[0]}')}}catch(e){{}}")
            spy = await ctx.new_page(); spy.on('pageerror', lambda e: stats['pageerrors'].append(f'bot-seat page: {e}'))
            await spy.goto(f'http://localhost:{port}/'); await spy.wait_for_timeout(2500)
            role = await spy.evaluate("() => { const v = window.__net.getState().fullView; return v ? v.role : null }")
            dock = await spy.locator('[data-testid=dock-go]').count()
            stats['bot_guard'].append(f'page naming a bot: view {role}, dock {dock}')
            if role == 'player' or dock: stats['ui_errors'].append(f'{tag}: a phone was seated as a bot')
            if args.shots: await spy.screenshot(path=os.path.join(args.shots, f'{tag}-bot-seat-page.png'))
            await ctx.close()
        for _ in range(200):
            if all(s.wf() for s in seats): break  # initial cards
            await asyncio.sleep(0.1)
        decisions = 0; idle = 0; last_gen = 0
        last_key = None; last_change = time.time()
        bot_names = set(['Ares', 'Deimos', 'Phobos', 'Olympus'][:len(bot_ids)])
        tv_shots = 0; last_tv_shot = 0.0
        # --away: hide one phone (seat 1) through a production, then bring it back and check what it is told
        away = {'phase': 'idle', 'pre': None, 'income': [], 'hide_gen': None, 'hid_at': 0.0} if args.away and len(seats) > 1 else None
        while True:
            m0 = obs()
            if m0 and m0['game']['phase'] == 'end': break
            okey = m0 and (m0['game']['gameAge'], m0['game']['undoCount'], m0['game']['phase'], sum(p['cardsInHandNbr'] for p in m0['players']))
            if okey != last_key: last_key = okey; last_change = time.time()
            # --tv-shots: the TV while a bot is the active player (what the table sees during a bot's turn)
            if args.shots and args.tv_shots and tv_shots < args.tv_shots and m0 and m0['game']['phase'] == 'action' and time.time() - last_tv_shot > args.tv_every:
                active = next((p for p in m0['players'] if p['isActive']), None)
                if active and active['name'] in bot_names:
                    await asyncio.sleep(args.tv_lag)
                    await tv.screenshot(path=os.path.join(args.shots, f'{tag}-tv-botturn-{tv_shots}.png'))
                    tv_shots += 1; last_tv_shot = time.time()
            elif bot_ids and time.time() - last_change > args.stall: raise RuntimeError(f'{tag}: nothing moved for {args.stall}s (phase {m0 and m0["game"]["phase"]}, generation {m0 and m0["game"]["generation"]})')
            if time.time() - t0 > args.timeout: raise RuntimeError(f'{tag}: timed out in generation {m0 and m0["game"]["generation"]}')
            moved = False
            # Prelude games: record the TV reveal (founders with their preludes) when the prelude phase ends.
            if tv4 and not reveal_shot and m0 and m0['game']['phase'] not in ('preludes', 'research', 'drafting') and \
                    all(len([c for c in p['tableau'] if (CARDS.get(c['name']) or {}).get('type') == 'prelude']) >= 2 for p in m0['players']):
                reveal_shot = True
                for k in range(16):
                    await tv.screenshot(path=os.path.join(args.shots, f'{tag}-reveal-1080-{k:02d}.png'))
                    if k % 4 == 1: await tv4.screenshot(path=os.path.join(args.shots, f'{tag}-reveal-2160-{k:02d}.png'))
                    await asyncio.sleep(0.6)
            for s in seats:
                w = s.wf()
                if not w or w.get('optional'): continue  # e.g. "change your draft pick until everyone has picked"
                model = s.model(); me = model['thisPlayer']; key = s.sig()
                # Fast mode and the turn clock: count the engine's End Turn offers, and check the clock names the decider.
                if w['type'] == 'or' and 'action' in text(w.get('title')).lower():
                    stats['action_menus'] += 1
                    if any(option_kind(o) == 'end' for o in w['options']): stats['end_turn_offers'] += 1
                    if args.turn_clock and stats['action_menus'] % 8 == 0:
                        for _ in range(30):
                            if (seats[0].clock or {}).get('playerId') == s.id: break
                            await asyncio.sleep(0.1)
                        c = seats[0].clock or {}
                        stats['clock_checks'] += 1
                        if c.get('playerId') != s.id: stats['clock_mismatch'].append(f"{tag} d{decisions}: clock={c.get('playerId')} decider={s.id}")
                if args.hints and s is seats[0] and (w['type'] == 'or' or rng.random() < 0.2):
                    await check_hints(s, stats, args.shots, f'{tag}-d{decisions}')
                if args.hand_view and w['type'] == 'or':
                    await check_hand(s, stats, f'{tag}-d{decisions}')
                ans = bot.answer(w, me, model, key)
                if not ans: raise RuntimeError(f'{tag}: bot has no answer for {s.name}: {w["type"]} {text(w.get("title"))}')
                resp, path = ans
                kinds = {step[0] for step in path} | ({w['type']} if w['type'] in UI_TYPES else set())
                final_greenery = 'final greenery' in text(w.get('title')).lower()
                # With Prelude, the setup and every prelude play go through the phone so the new steps are proven.
                prelude_step = bool(args.prelude) and (w['type'] == 'initialCards' or 'prelude' in text(w.get('title')).lower()
                                                       or model['game']['phase'] == 'preludes')
                via_ui = bool(kinds & UI_TYPES) or final_greenery or prelude_step or rng.random() < args.ui_rate
                before = s.sig()
                if via_ui:
                    uitag = f'{tag}-d{decisions}-{s.name}'
                    err = await ui_answer(s, path, args.shots if (kinds & UI_TYPES or final_greenery or prelude_step) else None, uitag)
                    stats['ui'] += 1
                    for k in kinds: stats['ui_types'][k] += 1
                    if final_greenery: stats['ui_types']['finalGreenery'] += 1
                    if err:
                        stats['ui_errors'].append(f'{uitag} {path}: {err}')
                        bot.failed.add((key, tuple(x for st in path for x in (st[1:] if st[0] == 'or' else ()))))
                        # fall back to the bot so the game continues (only if the question is still open)
                        await asyncio.sleep(0.5)
                        if s.sig() == before:
                            err2 = await s.rpc({'type': 'input', 'playerId': s.id, 'response': resp})
                            if err2: bot.failed.add((key, (resp.get('index'),))); stats['bot_rejects'].append(f'{uitag}: {err2}')
                        else:
                            stats['ui_errors'][-1] += ' (the page had submitted; harness timing only)'
                else:
                    err = await s.rpc({'type': 'input', 'playerId': s.id, 'response': resp})
                    if err:
                        stats['bot_rejects'].append(f'{s.name} gen{model["game"]["generation"]} {text(w.get("title"))}: {err} :: {json.dumps(resp)[:200]}')
                        # remember the failing choice so the bot tries something else
                        where = ()
                        r = resp
                        while r.get('type') == 'or': where += (r['index'],); r = r['response']
                        if r.get('type') == 'projectCard': where += ('card', r['card'])
                        if r.get('type') == 'card' and r.get('cards'): where += ('card', r['cards'][0])
                        bot.failed.add((key, where))
                        if len(stats['bot_rejects']) > 400: raise RuntimeError('too many rejects')
                for _ in range(50):
                    if s.sig() != before: break
                    await asyncio.sleep(0.05)
                decisions += 1; moved = True
                for k in kinds: stats['types'][k] += 1
                stats['types'][w['type']] += 0
                break
            g = obs()['game']['generation'] if obs() else 0
            if away is not None:
                await away_step(away, seats[1], g, args, stats, tag)
            if g != last_gen:
                last_gen = g
                gm = obs()['game']
                print(f'  {tag} gen {g} ({round(time.time() - t0)}s): T {gm["temperature"]} O {gm["oxygenLevel"]} oceans {gm["oceans"]}  decisions {decisions}', flush=True)
            if not moved:
                idle += 1
                if idle > 300 and not bot_ids: raise RuntimeError(f'{tag}: nobody has a decision (phase {m0 and m0["game"]["phase"]})')
                await asyncio.sleep(0.05)
            else: idle = 0
        # the end: final score on phones, podium on the TV
        await asyncio.sleep(2.5)
        await asyncio.sleep(1.5)  # the last model reaches every socket
        end_model = obs()
        if args.shots:
            for s in seats: await s.page.screenshot(path=os.path.join(args.shots, f'{tag}-final-{s.name}.png'))
            await tv.wait_for_timeout(4000); await tv.screenshot(path=os.path.join(args.shots, f'{tag}-tv-podium.png'))
        final = await seats[0].page.locator('[data-testid=final-score]').count() if seats else None
        if len(end_model['players']) == 1 and seats:
            # solo: the verdict on the phone, and on the TV once its end story reaches the podium
            stats['solo_screens'] = {'phone': await seats[0].page.locator('[data-testid=solo-result]').get_attribute('data-result') if await seats[0].page.locator('[data-testid=solo-result]').count() else None}
            for _ in range(240):
                if await tv.locator('[data-testid=solo-result]').count(): break
                await asyncio.sleep(0.5)
            stats['solo_screens']['tv'] = await tv.locator('[data-testid=solo-result]').first.get_attribute('data-result') if await tv.locator('[data-testid=solo-result]').count() else None
            if args.shots:
                await tv.wait_for_timeout(5000)
                await tv.screenshot(path=os.path.join(args.shots, f'{tag}-tv-solo-final.png'))
                await seats[0].page.screenshot(path=os.path.join(args.shots, f'{tag}-phone-solo-final.png'))
        vp = {p['name']: (p.get('victoryPointsBreakdown') or {}).get('total') for p in end_model['players']}
        board = end_model['game']['gameOptions'].get('boardName')
        milestones = [m['name'] for m in end_model['game']['milestones']]
        if args.board and args.board != 'random':
            assert board == args.board, f'engine played {board}, asked for {args.board}'
        fast = bool(end_model['game']['gameOptions'].get('fastModeOption'))
        assert fast == bool(args.fast_mode), f'engine fastModeOption={fast}, asked {args.fast_mode}'
        expansions = end_model['game']['gameOptions'].get('expansions', {})
        assert bool(expansions.get('prelude')) == bool(args.prelude), f"engine prelude={expansions.get('prelude')}, asked {args.prelude}"
        played_preludes = {p['name']: [c['name'] for c in p['tableau'] if (CARDS.get(c['name']) or {}).get('type') == 'prelude']
                           for p in end_model['players']}
        if args.prelude:
            assert all(len(v) >= 2 for v in played_preludes.values()), f'preludes not all played: {played_preludes}'
        stats['games'].append({'tag': tag, 'board': board, 'milestones': milestones,
                               'generations': end_model['game']['generation'], 'decisions': decisions,
                               'seconds': round(time.time() - t0), 'score': vp, 'phone_final_screen': bool(final),
                               'preludes': played_preludes if args.prelude else None, 'fastMode': fast,
                               'clockMessages': seats[0].clock_msgs if args.turn_clock and seats else None,
                               'tr': {p['name']: p['terraformRating'] for p in end_model['players']},
                               'globals': {'temperature': end_model['game']['temperature'], 'oxygen': end_model['game']['oxygenLevel'], 'oceans': end_model['game']['oceans']}})
        if len(end_model['players']) == 1:
            stats['games'][-1]['solo'] = {'lastSoloGeneration': end_model['game'].get('lastSoloGeneration'), 'won': end_model['game'].get('isSoloModeWin')}
        stats['games'][-1]['bots'] = bot_report(os.path.join(data, 'bots.jsonl'), stats)
        if args.profiles:
            engine_game = seats[0].state['full']['gameId']
            for _ in range(100):
                if seats[0].unlocks and seats[0].unlocks.get('gameId') == engine_game: break
                await asyncio.sleep(0.1)
            u = seats[0].unlocks if seats[0].unlocks and seats[0].unlocks.get('gameId') == engine_game else None
            recorded = any(g['gameId'] == engine_game for g in (seats[0].fame or {}).get('recent', []))
            stats['games'][-1]['recorded'] = recorded
            stats['games'][-1]['unlocks'] = {p['name']: p['achievements'] for p in (u or {}).get('players', [])}
            if not recorded: stats['ui_errors'].append(f'{tag}: finished game was not recorded')
            if args.shots:
                # phones reveal their new badges; the TV rolls them up after the podium, then the hall of fame
                await asyncio.sleep(1.0)
                for s in seats: await s.page.screenshot(path=os.path.join(args.shots, f'{tag}-reveal-{s.name}.png'))
                for label in ('New achievements', 'Hall of fame'):
                    for _ in range(240):
                        if await tv.locator(f'h1:has-text("{label}")').count(): break
                        await asyncio.sleep(0.5)
                    await tv.wait_for_timeout(3500)
                    await tv.screenshot(path=os.path.join(args.shots, f'{tag}-tv-{label.split()[0].lower()}.png'))
        if args.posters:
            # the end-of-game poster: rendered in the background after the recording
            engine_game = seats[0].state['full']['gameId']
            want_unique = args.poster_unique
            for _ in range(900):
                p = seats[0].posters.get(engine_game)
                if p and p['library'] != 'pending' and (not want_unique or p['unique'] not in ('pending', 'off')): break
                await asyncio.sleep(0.1)
            p = seats[0].posters.get(engine_game)
            stats['games'][-1]['poster'] = p
            stats['games'][-1]['data'] = data
            if not p or p['library'] != 'ready': stats['ui_errors'].append(f'{tag}: poster not ready: {p}')
            if args.shots and p and p['library'] == 'ready':
                # the phone's save flow and the TV's reveal after the hall of fame
                s0 = seats[0]
                await s0.page.wait_for_timeout(1500)
                await s0.page.screenshot(path=os.path.join(args.shots, f'{tag}-poster-card.png'))
                for _ in range(600):
                    if await tv.locator('img[alt="The poster of this game"]').count(): break
                    await asyncio.sleep(0.5)
                await tv.wait_for_timeout(4000)
                await tv.screenshot(path=os.path.join(args.shots, f'{tag}-tv-poster.png'))
        print(f'GAME OK {tag}: {stats["games"][-1]}', flush=True)
        for s in seats:
            await s.ws.close(); await s.page.context.close()
        if not seats: await host.ws.close()
        await tvctx.close()
    finally:
        srv.terminate()
        try: out = srv.communicate(timeout=5)[0]
        except Exception: out = ''
        warn = [l for l in (out or '').splitlines() if ('warn' in l.lower() or 'error' in l.lower()) and not l.startswith('bot: ')]
        if warn: stats['server_warnings'] += warn[-10:]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8841')
    ap.add_argument('--port', type=int, default=8842)
    ap.add_argument('--ui-rate', type=float, default=0.08)
    ap.add_argument('--timeout', type=int, default=1500)
    ap.add_argument('--shots', default=None)
    ap.add_argument('--prelude', action='store_true', help='play with the Prelude expansion')
    ap.add_argument('--fast-mode', action='store_true', help="the engine's fast mode (two actions every turn)")
    ap.add_argument('--turn-clock', default=None, choices=['relaxed', 'brisk'], help='turn the table clock on')
    ap.add_argument('--custom-preludes', default=None, help='comma-separated prelude pool (at least 4 per player) to deal from')
    ap.add_argument('--board', default=None, choices=['tharsis', 'hellas', 'elysium', 'random'], help='map for the table')
    ap.add_argument('--narrator', default=None, choices=['off', 'text', 'voice'], help='mission control mode for the table')
    ap.add_argument('--plan', default='2:1:1,3:0:1,2:0:0,3:1:0', help='players:draft:focus per game')
    ap.add_argument('--profiles', action='store_true', help='players join with persistent profiles (one data dir for the whole run)')
    ap.add_argument('--posters', action='store_true', help='wait for each game\'s end-of-game poster and record its status')
    ap.add_argument('--poster-unique', action='store_true', help='turn on the one-off poster illustration (calls the shared image server)')
    ap.add_argument('--hand-view', default=None, help='JSON hand view preset on every phone, e.g. {"sort":"cost","filter":"playable"}; the playable filter is checked against the engine at each turn menu')
    ap.add_argument('--hints', action='store_true', help='seat 0 turns smart hints on; every hint its phone shows is re-derived from the engine model')
    ap.add_argument('--away', type=int, default=0, help='AWAY_MIN_MS for the server; seat 1 hides its phone through a production and checks its summary')
    ap.add_argument('--bots', default=None, help='bot seats added in the lobby, e.g. "normal,easy" (plan players may be 0 for a bots-only game)')
    ap.add_argument('--bot-delay', type=float, default=1.0, help='BOT_DELAY_SCALE for the server (1 = human-feeling waits, 0 = instant)')
    ap.add_argument('--tv-shots', type=int, default=0, help='with --shots: this many TV screenshots while a bot is the active player')
    ap.add_argument('--tv-every', type=float, default=25, help='seconds between those TV screenshots')
    ap.add_argument('--tv-lag', type=float, default=1.2, help='seconds into a bot turn before the TV screenshot')
    ap.add_argument('--gpu', action='store_true', help='launch Chromium with the GPU (ANGLE/GL) for the TV pages')
    ap.add_argument('--stall', type=int, default=90, help='with bots: fail when nothing moves for this many seconds')
    ap.add_argument('--data', default=None, help='keep each game\'s data dir under this folder (to inspect posters afterwards)')
    args = ap.parse_args()
    args.shared_data = tempfile.mkdtemp(prefix='tm-soak-profiles-') if args.profiles else None
    if args.shots: os.makedirs(args.shots, exist_ok=True)
    stats = {'games': [], 'ui': 0, 'types': collections.Counter(), 'ui_types': collections.Counter(), 'ui_errors': [], 'bot_rejects': [],
             'pageerrors': [], 'server_warnings': [], 'action_menus': 0, 'end_turn_offers': 0, 'clock_checks': 0, 'clock_mismatch': [],
             'hint_checks': 0, 'hint_errors': [], 'hints_shown': collections.Counter(), 'badges_shown': 0, 'hint_shots': 0, 'hint_line_waits': 0,
             'away': [], 'hand_checks': 0, 'hand_errors': [], 'hand_synergy': 0, 'bot_refusals': [], 'bot_guard': [], 'solo_screens': None}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-gpu'] if args.gpu else [])
        for gi, spec in enumerate(args.plan.split(',')):
            n, d, f = (int(x) for x in spec.split(':'))
            try:
                await play_game(args, gi, n, bool(d), bool(f), stats, browser)
            except Exception as e:
                import traceback; traceback.print_exc()
                print(f'GAME FAILED {gi} {spec}: {e}', flush=True); stats.setdefault('failures', []).append(f'{spec}: {e}')
        await browser.close()
    print(json.dumps({k: (dict(v) if isinstance(v, collections.Counter) else v) for k, v in stats.items()}, indent=1)[:6000])
    ok = len(stats['games']) == len(args.plan.split(',')) and not stats['ui_errors'] and not stats['pageerrors'] and not stats['clock_mismatch'] and not stats['hint_errors'] and not stats['hand_errors']
    if args.away and len(stats['away']) < sum(1 for spec in args.plan.split(',') if int(spec.split(':')[0]) > 1): ok = False; print('AWAY: a game finished without the away check')
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    asyncio.run(main())
