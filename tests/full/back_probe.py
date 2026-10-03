"""Probe: how the engine image takes moves back, mid-move and across another player's moves (no app server involved).

    engine: docker run -d --rm --name back-engine -p 8841:8080 -e PORT=8080 mars-ledger-engine:41a1b005de73
    run:    python tests/full/back_probe.py http://localhost:8841 back-engine OUT.json

Two seats. Ada's hand gets Hired Raiders written into the newest save (docker exec, test setup only).
  1. Ada plays Hired Raiders; its target question is open. Is Undo offered there? (no: the engine's Undo is an option
     of the turn menu only.) PUT /load_game {rollbackCount: 0}: the newest save is the turn menu before the card, so the
     card is back in hand, the M€ refunded, gameAge back, undoCount unchanged.
  2. Ada plays it for real, ends the turn, the other seat makes two moves. Then /load_game {rollbackCount: 1} step by
     step: each step drops one save (one per turn menu opened), until Ada's menu before End Turn; the engine's own
     Undo then works from there.
Prints every step with the saves table (save_id, gameAge, active player, lastSaveId).
"""
import json, subprocess, sys, urllib.request

BASE, CONTAINER, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
log = []


def req(path, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method or ('POST' if data else 'GET'))
    try:
        with urllib.request.urlopen(r) as f:
            return json.loads(f.read())
    except urllib.error.HTTPError as e:
        return {'error': e.code, 'body': e.read().decode()[:300]}


def create():
    expansions = dict(corpera=True, promo=False, venus=False, colonies=False, prelude=False, prelude2=False, turmoil=False, community=False,
                      ares=False, moon=False, pathfinders=False, ceo=False, starwars=False, underworld=False, deltaProject=False)
    body = dict(players=[dict(name='Ada', color='red', beginner=False, handicap=0, first=True), dict(name='Bot', color='blue', beginner=False, handicap=0, first=False)],
                expansions=expansions, board='tharsis', seed=0.42, randomFirstPlayer=False, undoOption=True, showTimers=False, fastModeOption=False,
                showOtherPlayersVP=True, aresExtremeVariant=False, politicalAgendasExtension='Standard', solarPhaseOption=False,
                removeNegativeGlobalEventsOption=False, modularMA=False, draftVariant=False, initialDraft=False, preludeDraftVariant=False,
                ceosDraftVariant=False, startingCorporations=2, shuffleMapOption=False, randomMA='No randomization', includeFanMA=False, soloTR=False,
                customCorporationsList=[], bannedCards=[], includedCards=[], customColoniesList=[], customPreludes=[], requiresMoonTrackCompletion=False,
                requiresVenusTrackCompletion=False, moonStandardProjectVariant=False, moonStandardProjectVariant1=False, altVenusBoard=False,
                twoCorpsVariant=False, customCeos=[], startingCeos=3, startingPreludes=4)
    return req('/api/creategame', body)


def player(pid): return req(f'/api/player?id={pid}')
def inp(pid, r): return req(f'/player/input?id={pid}', r)
def load(gid, n): return req('/load_game', {'gameId': gid, 'rollbackCount': n}, 'PUT')


def title(w):
    if not w: return None
    t = w.get('title')
    return t.get('message') if isinstance(t, dict) else t


def snap(m, who):
    me = m['thisPlayer']
    w = m.get('waitingFor')
    return {'who': who, 'age': m['game']['gameAge'], 'undo': m['game']['undoCount'], 'phase': m['game']['phase'],
            'active': next((p['color'] for p in m['players'] if p['isActive']), None), 'mc': me['megaCredits'] if 'megaCredits' in me else me.get('megacredits'),
            'acts': me.get('actionsTakenThisRound'), 'hand': [c['name'] for c in m.get('cardsInHand', [])], 'tableau': [c['name'] for c in me['tableau']],
            'w': w and w.get('type'), 'wt': title(w), 'opts': [title(o) for o in (w or {}).get('options', [])] if w and w.get('type') == 'or' else None}


def note(label, **kw):
    log.append({'step': label, **kw}); print(label, json.dumps(kw)[:400])


def db(js):
    return subprocess.run(['docker', 'exec', CONTAINER, 'node', '-e', js], capture_output=True, text=True, cwd='/')


def saves(gid):
    r = db(f"const D=require('/usr/src/app/node_modules/better-sqlite3');const d=new D('/usr/src/app/db/game.db');"
           f"console.log(JSON.stringify(d.prepare('SELECT save_id, game FROM games WHERE game_id=? ORDER BY save_id').all('{gid}').map(r=>{{const g=JSON.parse(r.game);return [r.save_id,g.gameAge,g.activePlayer,g.lastSaveId]}})))")
    return json.loads(r.stdout or '[]')


def inject(gid, pid, cards, mc):
    """Put cards into a player's hand in the latest save, then reload it (test setup only)."""
    js = (f"const D=require('/usr/src/app/node_modules/better-sqlite3');const d=new D('/usr/src/app/db/game.db');"
          f"const r=d.prepare('SELECT save_id, game FROM games WHERE game_id=? ORDER BY save_id DESC LIMIT 1').get('{gid}');"
          f"const g=JSON.parse(r.game);const p=g.players.find(x=>x.id==='{pid}');p.cardsInHand=[...new Set([...p.cardsInHand, ...{json.dumps(cards)}])];p.megaCredits={mc};"
          f"for(const q of g.players) if(q.id!=='{pid}') q.megaCredits=Math.max(q.megaCredits,20);"
          f"d.prepare('UPDATE games SET game=? WHERE game_id=? AND save_id=?').run(JSON.stringify(g),'{gid}',r.save_id);console.log('ok',r.save_id)")
    r = db(js); print('inject', r.stdout.strip(), r.stderr.strip()[:200])
    return load(gid, 0)


def menu_index(w, pred):
    for i, o in enumerate(w['options']):
        if pred(o): return i
    return -1


g = create()
gid = g['id']; A = g['players'][0]['id']; B = g['players'][1]['id']
for pid in (A, B):
    m = player(pid); w = m['waitingFor']
    corp = w['options'][0]['cards'][0]['name']
    rs = [{'type': 'card', 'cards': [corp]}] + [{'type': 'card', 'cards': []} for _ in w['options'][1:]]
    r = inp(pid, {'type': 'initialCards', 'responses': rs})
    note('initial', pid=pid, err=r.get('error'), body=r.get('body'))
m = player(A); note('A menu', **snap(m, 'A'), saves=saves(gid))

# ---- Part 1: a card with a follow-up, backed out --------------------------------------------------------------
inject(gid, A, ['Hired Raiders', 'Sabotage'], 30)
before = player(A); note('A before', **snap(before, 'A'), saves=saves(gid))
w = before['waitingFor']
i = menu_index(w, lambda o: o['type'] == 'projectCard')
pay = {'megacredits': 1, 'steel': 0, 'titanium': 0, 'heat': 0, 'plants': 0, 'microbes': 0, 'floaters': 0, 'lunaArchivesScience': 0, 'spireScience': 0, 'seeds': 0, 'auroraiData': 0, 'graphene': 0, 'kuiperAsteroids': 0}
r = inp(A, {'type': 'or', 'index': i, 'response': {'type': 'projectCard', 'card': 'Hired Raiders', 'payment': pay}})
note('A played Hired Raiders', err=r.get('error'), body=r.get('body'), **(snap(r, 'A') if 'game' in r else {}))
mid = player(A); note('A mid-move', **snap(mid, 'A'), saves=saves(gid))
# the engine's own undo route: only an UndoActionOption inside an 'or' at the top counts; try index of 'Undo' if present
has_undo = mid['waitingFor'] and mid['waitingFor'].get('type') == 'or' and any(title(o) and title(o).lower().startswith('undo') for o in mid['waitingFor']['options'])
note('undo offered mid-move?', offered=bool(has_undo))
r = load(gid, 0)
note('load_game rollback 0', resp=r)
after = player(A); note('A after back', **snap(after, 'A'), saves=saves(gid))
note('check', hand_back='Hired Raiders' in snap(after, 'A')['hand'], mc_back=snap(after, 'A')['mc'] == snap(before, 'A')['mc'],
     menu=snap(after, 'A')['opts'] == snap(before, 'A')['opts'], age_fell=after['game']['gameAge'] < mid['game']['gameAge'])

# Engine undo after a full action (for comparison): play Sabotage? It also has a follow-up. Use the standard turn: sell nothing; take a simple action
# Play Hired Raiders for real and answer the follow-up, then undo from the menu.
w = after['waitingFor']; i = menu_index(w, lambda o: o['type'] == 'projectCard')
inp(A, {'type': 'or', 'index': i, 'response': {'type': 'projectCard', 'card': 'Hired Raiders', 'payment': pay}})
mid = player(A)
r = inp(A, {'type': 'or', 'index': len(mid['waitingFor']['options']) - 1, 'response': {'type': 'option'}})
done1 = player(A); note('A after action 1', **snap(done1, 'A'), saves=saves(gid))

# ---- Part 2: A ends the turn, B makes two moves, then rewind step by step ---------------------------------------
target = snap(done1, 'A')
w = done1['waitingFor']
i = menu_index(w, lambda o: (title(o) or '').lower().startswith('end turn'))
r = inp(A, {'type': 'or', 'index': i, 'response': {'type': 'option'}})
note('A end turn', **snap(player(A), 'A'), saves=saves(gid))
for k in range(2):
    mb = player(B); w = mb['waitingFor']
    # B: standard project "Sell patents" needs cards; use "Power plant" SP when affordable, else pass
    sp = menu_index(w, lambda o: o['type'] == 'projectCard' and (title(o) or '').lower().startswith('standard'))
    cards = [c for c in w['options'][sp]['cards'] if not c.get('isDisabled')] if sp >= 0 else []
    if cards:
        c = cards[0]['name']
        r = inp(B, {'type': 'or', 'index': sp, 'response': {'type': 'projectCard', 'card': c, 'payment': {**pay, 'megacredits': cards[0]['calculatedCost']}}})
        mb2 = player(B)
        if (mb2.get('waitingFor') or {}).get('type') == 'space':
            inp(B, {'type': 'space', 'spaceId': mb2['waitingFor']['spaces'][0]})
    else:
        r = inp(B, {'type': 'or', 'index': menu_index(w, lambda o: (title(o) or '').lower().startswith('pass')), 'response': {'type': 'option'}})
    note(f'B move {k + 1}', err=r.get('error'), body=r.get('body'), B=snap(player(B), 'B'), A=snap(player(A), 'A'), saves=saves(gid))
now = player(A); note('A now', **snap(now, 'A'))
note('target (A menu before End turn)', **target)
steps = 0
while steps < 10:
    r = load(gid, 1); steps += 1
    m = player(A); s = snap(m, 'A')
    note(f'rollback step {steps}', **s, saves=saves(gid))
    if s['age'] <= target['age'] and s['active'] == 'red': break
note('rolled back', steps=steps, matches=dict(age=snap(player(A), 'A')['age'] == target['age'], opts=snap(player(A), 'A')['opts'] == target['opts'], mc=snap(player(A), 'A')['mc'] == target['mc']))
# Then the engine's own undo works from here (A has an action this turn)
m = player(A); w = m['waitingFor']; i = menu_index(w, lambda o: (title(o) or '').lower().startswith('undo'))
if i >= 0:
    r = inp(A, {'type': 'or', 'index': i, 'response': {'type': 'option'}})
    note('engine undo after rollback', **snap(player(A), 'A'), saves=saves(gid))
json.dump(log, open(OUT, 'w'), indent=1)
