import json, sys, time, io, threading, queue, zlib, os
from PIL import Image
import comfy
STYLE=(' Centered subject in a square emblem composition with space around it, cinematic painterly matte painting, realistic science fiction, '
       'Mars at dusk, oxide rust and deep indigo palette, volumetric haze, warm rim light, no text, no letters, no logos, no border.')
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'portraits', ''); os.makedirs(OUT,exist_ok=True)
sc=json.load(open('portrait_scenes.json'))
todo=sys.argv[1].split(',') if len(sys.argv)>1 else list(sc)
bump=int(sys.argv[2]) if len(sys.argv)>2 else 0
man=json.load(open(OUT+'manifest.json')) if os.path.exists(OUT+'manifest.json') else {}
q=queue.Queue(); [q.put(n) for n in todo]; lock=threading.Lock()
def worker(host):
    while True:
        try: n=q.get_nowait()
        except queue.Empty: return
        prompt=sc[n]['scene']+STYLE; seed=(zlib.crc32(('p'+n).encode())+bump*7919)%2**31
        body={'prompt':comfy.wf(prompt,seed,1024,1024,prefix='tmportrait')}
        pid=comfy.post(host,'/prompt',body)['prompt_id']; b=None
        while b is None: time.sleep(1.5); b=comfy.fetch(host,pid)
        im=Image.open(io.BytesIO(b)).convert('RGB').resize((640,640),Image.LANCZOS)
        qv=80
        while True:
            buf=io.BytesIO(); im.save(buf,'WEBP',quality=qv,method=6)
            if buf.tell()<=60_000 or qv<=50: break
            qv-=5
        open(OUT+n+'.webp','wb').write(buf.getvalue())
        with lock: man[n]={'name':sc[n]['name'],'prompt':prompt,'seed':seed}
ths=[threading.Thread(target=worker,args=(h,)) for h in comfy.HOSTS]; [t.start() for t in ths]; [t.join() for t in ths]
json.dump(dict(sorted(man.items())),open(OUT+'manifest.json','w'),indent=1)
# circle-masked contact sheet
keys=sorted(man); W=220; s=Image.new('RGB',(7*W,2*(W+18)),(0,0,0))
from PIL import ImageDraw
d=ImageDraw.Draw(s)
mask=Image.new('L',(W,W),0); ImageDraw.Draw(mask).ellipse((0,0,W-1,W-1),fill=255)
for i,k in enumerate(keys):
    x=(i%7)*W; y=(i//7)*(W+18)
    s.paste(Image.open(OUT+k+'.webp').convert('RGB').resize((W,W)),(x,y),mask); d.text((x+4,y+W+2),f"{k} {man[k]['name']}"[:30],fill=(255,255,255))
s.save('portraits-sheet.jpg',quality=88); print('ok', len(keys))
