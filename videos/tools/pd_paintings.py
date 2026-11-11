#!/usr/bin/env python3
"""Fetch public-domain paintings from The Met's Open Access API into web/assets/art_pd/ (STUDIO CIV ASSETS c1).

A blur in a gilt frame stands in for nothing: when a shot needs recognisable European art, use the real picture.
The Met's open-access objects are CC0 (isPublicDomain true); the tool refuses anything else and writes the
provenance (title, artist, date, object URL, image URL, licence) next to each image in art_pd/index.json.

  python3 videos/tools/pd_paintings.py 437394 435809 437881      # by Met object id
  python3 videos/tools/pd_paintings.py --search "Rembrandt"       # list candidates (id, title, artist, date)

Images are stored at <= 1000 px on the long side (JPEG q88): enough for a framed painting in a 1080 frame, small on
disk. Print them through print.js (engrave / halftone) or lib/fx/plates.js `photo()` so they sit in the piece's inks.
"""
import json, os, sys, time, urllib.request, urllib.parse, io
from PIL import Image

API = 'https://collectionapi.metmuseum.org/public/collection/v1/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'art_pd')
UA = {'User-Agent': 'acp-studio-pd-paintings/1.0'}

def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=40) as r: return r.read()
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(2 + 3 * k)

def slug(s): return ''.join(c.lower() if c.isalnum() else '_' for c in s).strip('_')[:48]

def fetch(oid, long_side=1000):
    d = json.loads(get(API + f'objects/{oid}'))
    if not d.get('isPublicDomain'): raise SystemExit(f'{oid}: not public domain at the Met; refusing')
    url = d.get('primaryImage') or d.get('primaryImageSmall')
    im = Image.open(io.BytesIO(get(url))).convert('RGB'); im.thumbnail((long_side, long_side), Image.LANCZOS)
    name = f"met{oid}_{slug(d['title'])}.jpg"; os.makedirs(OUT, exist_ok=True); im.save(os.path.join(OUT, name), quality=88)
    rec = {'file': name, 'title': d['title'], 'artist': d.get('artistDisplayName'), 'date': d.get('objectDate'),
           'size': im.size, 'object': d.get('objectURL'), 'image': url, 'licence': 'CC0 (The Met Open Access)', 'met_id': oid}
    idx_p = os.path.join(OUT, 'index.json'); idx = json.load(open(idx_p)) if os.path.exists(idx_p) else {}
    idx[str(oid)] = rec; json.dump(idx, open(idx_p, 'w'), indent=1, ensure_ascii=False)
    print(f"{oid}: {rec['title']} / {rec['artist']} {rec['date']} -> {name} {im.size}")

if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == '--search':
        q = urllib.parse.quote(' '.join(a[1:]))
        ids = json.loads(get(API.replace('/v1/', '/v1.1/') + f'search?hasImages=true&isPublicDomain=true&q={q}&limit=100')).get('objectIDs') or []   # v1/search retired 2026-10-01
        for oid in ids[:25]:
            d = json.loads(get(API + f'objects/{oid}')); print(oid, '|', d['title'], '|', d.get('artistDisplayName'), '|', d.get('objectDate'), '|', d.get('classification'))
    else:
        for oid in a: fetch(int(oid)); time.sleep(1)
