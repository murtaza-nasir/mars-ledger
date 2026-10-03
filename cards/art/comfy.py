import json, time, urllib.request, urllib.parse, random
import os
# ComfyUI instances to spread the work over, comma-separated: COMFY_URLS=http://127.0.0.1:8188,http://127.0.0.1:8189
# The workflow below needs the Krea 2 Turbo model files named in wf() in ComfyUI's models folders.
HOSTS=[u.strip().rstrip('/') for u in os.environ.get('COMFY_URLS', 'http://127.0.0.1:8188').split(',') if u.strip()]
def wf(prompt, seed, w=1152, h=768, model='krea2_turbo_fp8_scaled.safetensors', prefix='tmcard'):
    return {
     "1":{"class_type":"UNETLoader","inputs":{"unet_name":model,"weight_dtype":"default"}},
     "2":{"class_type":"CLIPLoader","inputs":{"clip_name":"qwen3vl_4b_fp8_scaled.safetensors","type":"krea2"}},
     "3":{"class_type":"VAELoader","inputs":{"vae_name":"qwen_image_vae.safetensors"}},
     "4":{"class_type":"CLIPTextEncode","inputs":{"text":prompt,"clip":["2",0]}},
     "5":{"class_type":"CLIPTextEncode","inputs":{"text":"","clip":["2",0]}},
     "6":{"class_type":"EmptySD3LatentImage","inputs":{"width":w,"height":h,"batch_size":1}},
     "7":{"class_type":"KSampler","inputs":{"model":["1",0],"positive":["4",0],"negative":["5",0],"latent_image":["6",0],"seed":seed,"steps":8,"cfg":1.0,"sampler_name":"euler","scheduler":"simple","denoise":1.0}},
     "8":{"class_type":"VAEDecode","inputs":{"samples":["7",0],"vae":["3",0]}},
     "9":{"class_type":"SaveImage","inputs":{"images":["8",0],"filename_prefix":prefix}}}
def post(host, path, body):
    r=urllib.request.Request(host+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=60))
def get(host, path): return json.load(urllib.request.urlopen(host+path, timeout=60))
def submit(host, prompt, seed):
    return post(host,'/prompt',{'prompt':wf(prompt,seed)})['prompt_id']
def fetch(host, pid):
    h=get(host,f'/history/{pid}')
    if pid not in h: return None
    e=h[pid]
    if e.get('status',{}).get('status_str')=='error': raise RuntimeError(json.dumps(e['status'])[:500])
    for o in e['outputs'].values():
        for im in o.get('images',[]):
            q=urllib.parse.urlencode({'filename':im['filename'],'subfolder':im['subfolder'],'type':im['type']})
            return urllib.request.urlopen(f'{host}/view?{q}', timeout=60).read()
    return None
