import json, urllib.request, concurrent.futures as cf, re, os
import sys
# Usage: LLM_URL=http://host:port/v1 LLM_MODEL=<model> python prompts.py [module ...]   (default base corpera)
# Scenes are merged into prompts.json. Reads the fetched card data (npm run fetch-data) and asks any
# OpenAI-compatible chat endpoint for one painting description per card.
R=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'src', 'shared', 'data', '')
LLM_URL=os.environ.get('LLM_URL', 'http://127.0.0.1:8000/v1').rstrip('/')
LLM_MODEL=os.environ.get('LLM_MODEL', 'default')
modules=sys.argv[1:] or ['base','corpera']
cards=[c for m in modules for c in json.load(open(R+m+'.json'))]
print(len(cards))
SYS=("You write image-generation prompts for card illustrations in a science-fiction game about terraforming Mars. "
"Given a card, describe ONE concrete scene a painter would paint: the main subject, its setting on or around Mars (or Earth, Jupiter's moons, orbit, as the card implies), and the camera view, in 1-2 sentences, max 45 words. "
"Describe only what is visible: machines, landscapes, plants, animals, structures, spacecraft, weather. People only as small distant figures if needed. "
"No text, signs, logos, letters, numbers, UI, card frames, or game terms (no 'tag', 'VP', 'production', 'M€'). Do not name any game. "
"For corporations, paint their signature operation or headquarters. For prelude cards (an early head start), paint the founding moment of that venture. Output the scene description only.")
def ask(c):
    txt=' '.join([c.get('description') or '']+c.get('text',[]))[:600]
    user=f"Card: {c['name']}\nType: {c['type']}\nTags: {', '.join(c['tags']) or 'none'}\nRules: {txt}"
    body={'model':LLM_MODEL,'temperature':0.7,'max_tokens':160,'chat_template_kwargs':{'enable_thinking':False},
          'messages':[{'role':'system','content':SYS},{'role':'user','content':user}]}
    r=urllib.request.Request(LLM_URL+'/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    out=json.load(urllib.request.urlopen(r,timeout=120))['choices'][0]['message']['content'].strip()
    out=re.sub(r'\s+',' ',out).strip('"')
    return c['number'], {'name':c['name'],'type':c['type'],'scene':out}
res={}
with cf.ThreadPoolExecutor(8) as ex:
    for n,v in ex.map(ask,cards): res[n]=v
P=json.load(open('prompts.json'))
P['scenes'].update(res)
P['scenes']=dict(sorted(P['scenes'].items()))
json.dump(P,open('prompts.json','w'),indent=1)
for n in list(res)[:6]: print(n,res[n])
