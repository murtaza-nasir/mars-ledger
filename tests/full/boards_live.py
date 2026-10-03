"""Compare src/shared/data/boards.json with boards from real engine games.

For each map, creates an engine game through its HTTP API and checks every space the engine reports
(id, x, y, space type, bonuses, volcanic highlight) against our data, which the TV and phone draw from.

    run: python3 tests/full/boards_live.py --engine http://localhost:8901
"""
import argparse, json, os, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def post(url, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method='POST', headers={'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))


def new_game(engine, board):
    expansions = {k: False for k in ['promo', 'venus', 'colonies', 'prelude', 'prelude2', 'turmoil', 'community', 'ares', 'moon',
                                     'pathfinders', 'ceo', 'starwars', 'underworld', 'deltaProject']}
    expansions['corpera'] = True
    return post(engine + '/api/creategame', {
        'players': [{'name': 'A', 'color': 'red', 'beginner': False, 'handicap': 0, 'first': True},
                    {'name': 'B', 'color': 'blue', 'beginner': False, 'handicap': 0, 'first': False}],
        'expansions': expansions, 'board': board, 'seed': 0.5, 'randomFirstPlayer': False, 'undoOption': False, 'showTimers': False,
        'fastModeOption': False, 'showOtherPlayersVP': True, 'aresExtremeVariant': False, 'politicalAgendasExtension': 'Standard',
        'solarPhaseOption': False, 'removeNegativeGlobalEventsOption': False, 'modularMA': False, 'draftVariant': False,
        'initialDraft': False, 'preludeDraftVariant': False, 'ceosDraftVariant': False, 'startingCorporations': 2,
        'shuffleMapOption': False, 'randomMA': 'No randomization', 'includeFanMA': False, 'soloTR': False,
        'customCorporationsList': [], 'bannedCards': [], 'includedCards': [], 'customColoniesList': [], 'customPreludes': [],
        'requiresMoonTrackCompletion': False, 'requiresVenusTrackCompletion': False, 'moonStandardProjectVariant': False,
        'moonStandardProjectVariant1': False, 'altVenusBoard': False, 'twoCorpsVariant': False, 'customCeos': [],
        'startingCeos': 3, 'startingPreludes': 4})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://localhost:8901')
    args = ap.parse_args()
    ours = json.load(open(os.path.join(ROOT, 'src/shared/data/boards.json')))
    failures = 0
    for board in ['tharsis', 'hellas', 'elysium']:
        g = new_game(args.engine, board)
        spec = json.load(urllib.request.urlopen(f"{args.engine}/api/spectator?id={g['spectatorId']}"))
        game = spec['game']
        assert game['gameOptions']['boardName'] == board, (board, game['gameOptions']['boardName'])
        theirs = {s['id']: s for s in game['spaces']}
        mine = {s['id']: s for s in ours[board]}
        diffs = []
        if set(theirs) != set(mine):
            diffs.append(f'ids differ: {sorted(set(theirs) ^ set(mine))}')
        for sid in sorted(set(theirs) & set(mine)):
            t, m = theirs[sid], mine[sid]
            for k in ['x', 'y', 'spaceType']:
                if t[k] != m[k]:
                    diffs.append(f'{sid}.{k}: engine {t[k]} ours {m[k]}')
            if sorted(t.get('bonus', [])) != sorted(m['bonus']):
                diffs.append(f"{sid}.bonus: engine {t.get('bonus')} ours {m['bonus']}")
            if (t.get('highlight') == 'volcanic') != bool(m.get('volcanic')):
                diffs.append(f"{sid}.volcanic: engine {t.get('highlight')} ours {m.get('volcanic')}")
        names = ([m['name'] for m in game['milestones']], [a['name'] for a in game['awards']])
        print(f'{board}: {len(theirs)} spaces compared, {len(diffs)} differences; milestones {names[0]}; awards {names[1]}')
        for d in diffs[:20]:
            print('   ', d)
        failures += len(diffs)
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
