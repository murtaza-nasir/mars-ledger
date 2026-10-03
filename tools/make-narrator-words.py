# Common English words for mission control's validator (a sentence may begin with any of them).
# Run: python tools/make-narrator-words.py   (needs: pip install wordfreq)
import json
from wordfreq import top_n_list
words = [w for w in top_n_list('en', 8000) if w.isalpha() and w.isascii()]
json.dump(sorted(set(words)), open('src/server/narrator/words.json', 'w'), separators=(',', ':'))
print(len(words))
