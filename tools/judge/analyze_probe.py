# python3 tools/judge/analyze_probe.py PROBE_DIR [arm tags...]
# Probe analysis: per arm, the rollout gain of the model's pick over Normal's pick (VP margin), overall and per type,
# and the same under simulated gates (confidence >= t and Normal's score gap <= m).
import json, sys, glob, math, statistics as st, os
D = sys.argv[1]
vals = {}
for f in glob.glob(D + '/values16-*.jsonl'):
    for l in open(f):
        r = json.loads(l); vals[r['id']] = r
def mean(xs):
    xs = [x for x in xs if x is not None and not (isinstance(x, float) and math.isnan(x))]
    return st.mean(xs) if xs else None
def se(xs): return st.stdev(xs) / math.sqrt(len(xs)) if len(xs) > 1 else 0
arms = sys.argv[2:] or sorted(os.path.basename(f)[4:-6] for f in glob.glob(D + '/ask-*.jsonl') if 'dry' not in f)
grid_t = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9]
grid_m = [1, 2, 3, 5, 8, 1000]
print(f"states with values: {len(vals)}")
for arm in arms:
    rows = [json.loads(l) for l in open(f"{D}/ask-{arm}.jsonl")]
    out = {'all': [], 'turn': [], 'draft': []}
    agree = 0; n = 0; toks = []; ms = []; conf = []
    sim = {(t, m): [] for t in grid_t for m in grid_m}; over = {(t, m): 0 for t in grid_t for m in grid_m}
    for r in rows:
        v = vals.get(r['id'])
        if not v or r.get('error') or r.get('invalid'): continue
        cand = {c['key']: c for c in v['cands']}
        top = cand.get(v['top'])
        pk = cand.get(r['pick'])
        if not top or not pk: continue
        vt, vp = mean(top['v']), mean(pk['v'])
        if vt is None or vp is None: continue
        g = vp - vt; n += 1; agree += r['pick'] == v['top']
        out['all'].append(g); out[r['type']].append(g)
        toks.append(r.get('tokens') or 0); ms.append(r.get('ms') or 0); conf.append(r.get('confidence') or 0)
        for (t, m) in sim:
            take = r['pick'] != v['top'] and (r.get('confidence') or 0) >= t and top['score'] - pk['score'] <= m
            sim[(t, m)].append(g if take else 0.0); over[(t, m)] += take
    if not n: print(arm, 'no rows'); continue
    def fmt(xs): return f"{mean(xs):+.2f} (SE {se(xs):.2f}, n {len(xs)})" if xs else '-'
    print(f"\n== {arm}: agree {agree/n:.2f}; gain all {fmt(out['all'])}; turn {fmt(out['turn'])}; draft {fmt(out['draft'])}; tokens p50 {st.median(toks):.0f}; ms p50/p95 {st.median(ms):.0f}/{sorted(ms)[int(.95*len(ms))]}; conf p50 {st.median(conf):.2f}")
    best = sorted(sim, key=lambda k: -mean(sim[k]))[:5]
    print('   best gates:', '; '.join(f"t{t} m{m}: {mean(sim[(t,m)]):+.2f} ({se(sim[(t,m)]):.2f}) over {over[(t,m)]}" for t, m in best))
    print('   t0.7 row:', ' '.join(f"m{m} {mean(sim[(0.7,m)]):+.2f}/{over[(0.7,m)]}" for m in grid_m))
# Oracle: best single offered candidate vs Normal (how much there is to gain at all)
orc = []; rnd = []
for v in vals.values():
    ms_ = [(mean(c['v']), c) for c in v['cands'][:6]]
    ms_ = [x for x in ms_ if x[0] is not None]
    top = [x for x in ms_ if x[1]['key'] == v['top']]
    if not top: continue
    orc.append(max(x[0] for x in ms_) - top[0][0]); rnd.append(st.mean(x[0] for x in ms_) - top[0][0])
print(f"\noracle best-of-top6 minus Normal {mean(orc):+.2f}; random-of-top6 minus Normal {mean(rnd):+.2f} (n {len(orc)})")
