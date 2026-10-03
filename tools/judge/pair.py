# Paired comparison of two arena runs (tools/judge/arena.ts): the same seed and seat in both, test minus base.
# 95 % intervals are clustered by deal (the three seats of one seed share it).  python3 tools/judge/pair.py BASE_DIR TEST_DIR
import json, sys, math, statistics as st
def load(p):
    d={}
    for l in open(p+'/games.jsonl'):
        g=json.loads(l); d[(g['seed'],g['seat'])]=g
    return d
base, test = load(sys.argv[1]), load(sys.argv[2])
keys=sorted(set(base)&set(test))
def ci(xs):
    m=st.mean(xs); se=st.stdev(xs)/math.sqrt(len(xs)); return m,se
over=[k for k in keys if base[k]['over'] and test[k]['over']]
print(f"games {len(keys)} both over {len(over)}; not over test {sum(not test[k]['over'] for k in keys)} base {sum(not base[k]['over'] for k in keys)}")
for name,f in [('margin',lambda g:g['margin']),('win',lambda g:1.0 if g['win'] else 0.0),('vp',lambda g:g['vp']),('tr',lambda g:g['tr']),('oppVp',lambda g:g['meanOppVp']),('gens',lambda g:g['generation'])]:
    b=[f(base[k]) for k in over]; t=[f(test[k]) for k in over]; d=[x-y for x,y in zip(t,b)]
    m,se=ci(d)
    seeds=sorted(set(k[0] for k in over)); per=[st.mean([x for k,x in zip(over,d) if k[0]==sd]) for sd in seeds]
    _,se=ci(per)  # clustered by deal: the three seats of one seed are not independent
    print(f"{name:7s} base {st.mean(b):6.2f} test {st.mean(t):6.2f}  Δ {m:+.2f} [95% {m-1.96*se:+.2f}, {m+1.96*se:+.2f}] (SE {se:.2f})")
bk=['terraformRating','milestones','awards','greenery','city','cards']
print('breakdown Δ:', ', '.join(f"{k} {st.mean(test[x]['breakdown'][k]-base[x]['breakdown'][k] for x in over):+.2f}" for k in bk))
