import json, sys, time, io, threading, queue, zlib
from PIL import Image
from comfy import *
STYLE=(' Cinematic painterly matte painting, realistic science fiction illustration, Mars at dusk, oxide rust and deep indigo palette, '
       'volumetric dust haze, soft warm rim light, restrained detail, wide 3:2 composition, no text, no letters, no logos, no border.')
import os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'cards', '')
os.makedirs(OUT, exist_ok=True)
# scenes live in prompts.json (scenes.json was the first run's working file)
scenes=json.load(open('scenes.json')) if os.path.exists('scenes.json') else json.load(open('prompts.json'))['scenes']
todo=sys.argv[1].split(',') if len(sys.argv)>1 else list(scenes)
seedbump=int(sys.argv[2]) if len(sys.argv)>2 else 0
man=json.load(open(OUT+'manifest.json')) if os.path.exists(OUT+'manifest.json') else {}
q=queue.Queue(); [q.put(n) for n in todo]
lock=threading.Lock(); t0=time.time(); done=[0]
def worker(host):
    while True:
        try: n=q.get_nowait()
        except queue.Empty: return
        s=scenes[n]; prompt=s['scene']+STYLE; seed=(zlib.crc32(n.encode())+seedbump*7919)%2**31
        for attempt in range(3):
            try:
                pid=submit(host,prompt,seed); b=None
                while b is None: time.sleep(1.5); b=fetch(host,pid)
                im=Image.open(io.BytesIO(b)).convert('RGB').resize((900,600),Image.LANCZOS)
                qv=80
                while True:
                    buf=io.BytesIO(); im.save(buf,'WEBP',quality=qv,method=6)
                    if buf.tell()<=70_000 or qv<=55: break
                    qv-=5
                open(OUT+f'{n}.webp','wb').write(buf.getvalue())
                with lock:
                    man[n]={'name':s['name'],'prompt':prompt,'seed':seed,'model':'krea2_turbo_fp8_scaled (ComfyUI, 8 steps, euler/simple, CFG 1.0, 1152x768 -> 900x600)'}
                    done[0]+=1
                    if done[0]%20==0: print(done[0], round(time.time()-t0), flush=True)
                break
            except Exception as e: print('retry',n,host,e,flush=True); time.sleep(3)
ths=[threading.Thread(target=worker,args=(h,)) for h in HOSTS]; [t.start() for t in ths]; [t.join() for t in ths]
json.dump(dict(sorted(man.items())),open(OUT+'manifest.json','w'),indent=1)
print('done',done[0],'secs',round(time.time()-t0))
