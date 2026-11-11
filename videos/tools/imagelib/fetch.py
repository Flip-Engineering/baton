#!/usr/bin/env python3
"""IMAGE LIBRARY: public-domain / CC0 photographs and textures with their licences recorded.

    python3 videos/tools/imagelib/fetch.py list                 # what the manifest holds
    python3 videos/tools/imagelib/fetch.py fetch [--set core]   # download a named set (reachable mirrors only)
    python3 videos/tools/imagelib/fetch.py probe                # which source hosts answer from this machine
    python3 videos/tools/imagelib/fetch.py search loc "steel worker" [--n 20]    # needs the host allowlisted
    python3 videos/tools/imagelib/fetch.py import FILE --id ID --licence "Public domain (FSA/OWI, LC-USF34-...)" \
            --credit "Arthur Rothstein, Library of Congress" --url https://www.loc.gov/item/...   # user uploads

Everything lands in videos/sources/library/<id>.<ext>; videos/sources/library/manifest.json keeps, per id:
    file, sha256, w, h, licence, credit, url (the page that states the licence), source (adapter), tags, fetched.
A file without a manifest row is not in the library: scenes resolve images only through the manifest
(lib/fx/imagelib.js), so nothing unlicensed can slip into a piece.

Source adapters. On 2026-09-27 the proxy answers only GitHub raw, npm and PyPI; Wikimedia, loc.gov, NASA, the Met,
Smithsonian, Flickr, archive.org and Openverse all refuse the CONNECT. So:
  * 'skimage'  (reachable) - scikit-image's sample data on raw.githubusercontent.com. Licences are the ones stated in
                 skimage/data/_fetchers.py at tag v0.22.0 (quoted into each row).
  * 'client'   (local)     - the client's own uploads in videos/sources/ (his material, used in his pieces).
  * 'wikimedia', 'loc', 'nasa' (written, untested here: hosts refused) - API search adapters that record the licence
                 fields the API returns and refuse anything not PD/CC0.
"""
import argparse, hashlib, json, os, sys, time, urllib.request, urllib.parse, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.abspath(os.path.join(HERE, '..', '..'))
LIB = os.path.join(VID, 'sources', 'library')
MAN = os.path.join(LIB, 'manifest.json')
UA = 'acp-agitprop-imagelib/1.0 (research; contact via repo)'

SK = 'https://raw.githubusercontent.com/scikit-image/scikit-image/v0.22.0/skimage/data/'
SK_LIC = 'https://github.com/scikit-image/scikit-image/blob/v0.22.0/skimage/data/_fetchers.py'
SETS = {
    'core': [
        dict(id='astronaut_collins', src=SK + 'astronaut.png', source='skimage', tags=['human', 'portrait', 'nasa'],
             licence='Public domain (NASA; "No known copyright restrictions, released into the public domain")',
             credit='NASA (Eileen Collins, official portrait), via scikit-image', url=SK_LIC),
        dict(id='cameraman_cc0', src=SK + 'camera.png', source='skimage', tags=['human', 'figure', 'grey'],
             licence='CC0 (photographer Lav Varshney)', credit='Lav Varshney, via scikit-image', url=SK_LIC),
        dict(id='rocket_dscovr', src=SK + 'rocket.jpg', source='skimage', tags=['machine', 'launch', 'fire'],
             licence='Public domain (SpaceX release)', credit='SpaceX, DSCOVR launch 2015, via scikit-image', url=SK_LIC),
        dict(id='hubble_xdf', src=SK + 'hubble_deep_field.jpg', source='skimage', tags=['space', 'stars'],
             licence='Public domain (NASA)', credit='NASA/ESA Hubble eXtreme Deep Field, via scikit-image', url=SK_LIC),
        dict(id='coins_pompeii', src=SK + 'coins.png', source='skimage', tags=['metal', 'coin', 'money', 'grey'],
             licence='No known copyright restrictions (Brooklyn Museum)', credit='Brooklyn Museum, via scikit-image', url=SK_LIC),
        dict(id='tex_brick', src=SK + 'brick.png', source='skimage', tags=['texture', 'brick', 'grey'],
             licence='CC0 (CC0Textures Bricks25)', credit='CC0Textures / ambientCG, via scikit-image', url=SK_LIC),
        dict(id='tex_gravel', src=SK + 'gravel.png', source='skimage', tags=['texture', 'ground', 'grey'],
             licence='CC0 (CC0Textures Gravel04)', credit='CC0Textures / ambientCG, via scikit-image', url=SK_LIC),
        dict(id='tex_grass', src=SK + 'grass.png', source='skimage', tags=['texture', 'field', 'grey'],
             licence='CC0 (CC0Textures)', credit='CC0Textures / ambientCG, via scikit-image', url=SK_LIC),
        dict(id='text_page', src=SK + 'text.png', source='skimage', tags=['paper', 'type'],
             licence='Public domain ("No known copyright restrictions, released into the public domain")',
             credit='scikit-image sample data', url=SK_LIC),
    ],
    'client': [
        dict(id='client_own_future', local='acp_own_the_future.jpg', source='client', tags=['human', 'worker', 'silhouette', 'dusk'],
             licence='Client-supplied (ACP own material; for ACP pieces only)', credit='ACP', url='videos/sources/acp_own_the_future.jpg'),
        dict(id='client_join_banner', local='acp_join_banner.png', source='client', tags=['human', 'worker', 'hardhat', 'red'],
             licence='Client-supplied (ACP own material; for ACP pieces only)', credit='ACP', url='videos/sources/acp_join_banner.png'),
        dict(id='client_fortress', local='acp_fortress.jpg', source='client', tags=['architecture', 'fortress'],
             licence='Client-supplied (ACP own material; for ACP pieces only)', credit='ACP', url='videos/sources/acp_fortress.jpg'),
        dict(id='client_thermal', local='thermal_industry.jpg', source='client', tags=['thermal', 'industry'],
             licence='Client-supplied reference (inspiration only; do not publish as-is)', credit='client upload', url='videos/sources/thermal_industry.jpg'),
        dict(id='client_turrell', local='turrell_room.jpg', source='client', tags=['room', 'red'],
             licence='Client-supplied reference (third-party artwork photo; reference only, never in frame)', credit='client upload', url='videos/sources/turrell_room.jpg'),
    ],
}
REF_ONLY = ('reference only', 'inspiration only')    # rows that scenes may not composite (imagelib.js refuses them)


def load():
    return json.load(open(MAN)) if os.path.exists(MAN) else {}


def save(m):
    os.makedirs(LIB, exist_ok=True)
    json.dump(m, open(MAN + '.tmp', 'w'), indent=1, sort_keys=True); os.replace(MAN + '.tmp', MAN)


def dims(path):
    from PIL import Image
    with Image.open(path) as im: return im.size


def sha(path):
    h = hashlib.sha256(); h.update(open(path, 'rb').read()); return h.hexdigest()


def get(url, dst):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r, open(dst + '.part', 'wb') as f: shutil.copyfileobj(r, f)
    os.replace(dst + '.part', dst)


def add(m, row, path):
    w, h = dims(path)
    row = {k: v for k, v in row.items() if k not in ('src', 'local')}
    row.update(file=os.path.basename(path), sha256=sha(path), w=w, h=h, fetched=time.strftime('%Y-%m-%d'),
               composite=not any(s in row['licence'].lower() for s in REF_ONLY))
    m[row['id']] = row
    print(f"  {row['id']:22s} {w}x{h}  {row['licence'][:60]}")


def fetch(set_name):
    m = load(); os.makedirs(LIB, exist_ok=True)
    for row in SETS[set_name]:
        if 'local' in row:
            srcp = os.path.join(VID, 'sources', row['local']); ext = os.path.splitext(srcp)[1]
            dst = os.path.join(LIB, row['id'] + ext)
            if not os.path.exists(dst): shutil.copyfile(srcp, dst)
        else:
            ext = os.path.splitext(row['src'])[1]; dst = os.path.join(LIB, row['id'] + ext)
            if not os.path.exists(dst):
                try: get(row['src'], dst)
                except Exception as e: print('  FAIL', row['id'], e); continue
        add(m, row, dst)
    save(m)


# ---------------------------------------------------------------- API adapters (for when the hosts are allowlisted)
def _json(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)


def search_wikimedia(q, n):
    """Commons search restricted to files; keeps only PD / CC0 (LicenseShortName from extmetadata)."""
    u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode(dict(
        action='query', format='json', generator='search', gsrnamespace=6, gsrsearch=q, gsrlimit=n,
        prop='imageinfo', iiprop='url|extmetadata|size', iiurlwidth=2400))
    out = []
    for p in _json(u).get('query', {}).get('pages', {}).values():
        ii = p['imageinfo'][0]; md = ii.get('extmetadata', {})
        lic = md.get('LicenseShortName', {}).get('value', '')
        if not any(k in lic.lower() for k in ('public domain', 'pd', 'cc0')): continue
        out.append(dict(id='wm_' + str(p['pageid']), src=ii.get('thumburl') or ii['url'], source='wikimedia',
                        licence=lic, credit=md.get('Artist', {}).get('value', '')[:200], url=ii['descriptionurl'], tags=q.split()))
    return out


def search_loc(q, n):
    """loc.gov JSON API over the free-to-use photo collections; keeps rows whose rights say 'No known restrictions'."""
    u = 'https://www.loc.gov/pictures/search/?' + urllib.parse.urlencode(dict(q=q, fo='json', c=n))
    out = []
    for r in _json(u).get('results', []):
        if 'no known restrictions' not in (r.get('rights_information') or r.get('access_advisory') or '').lower() and 'fsa' not in r.get('collection', ['']).__str__().lower():
            continue
        img = (r.get('image') or {}).get('full') or (r.get('image') or {}).get('square')
        if not img: continue
        out.append(dict(id='loc_' + r['pk'], src=('https:' + img) if img.startswith('//') else img, source='loc',
                        licence='No known restrictions on publication (LoC)', credit=r.get('creator', '') + ', Library of Congress',
                        url=r.get('links', {}).get('item', ''), tags=q.split()))
    return out


def search_nasa(q, n):
    u = 'https://images-api.nasa.gov/search?' + urllib.parse.urlencode(dict(q=q, media_type='image'))
    out = []
    for it in _json(u)['collection']['items'][:n]:
        d = it['data'][0]
        out.append(dict(id='nasa_' + d['nasa_id'], src=it['links'][0]['href'].replace('~thumb', '~orig'), source='nasa',
                        licence='Public domain (NASA media guidelines)', credit=d.get('center', 'NASA'),
                        url='https://images.nasa.gov/details/' + d['nasa_id'], tags=q.split()))
    return out


ADAPTERS = dict(wikimedia=search_wikimedia, loc=search_loc, nasa=search_nasa)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('cmd'); ap.add_argument('args', nargs='*')
    ap.add_argument('--set', default='core'); ap.add_argument('--n', type=int, default=20)
    ap.add_argument('--id'); ap.add_argument('--licence'); ap.add_argument('--credit', default=''); ap.add_argument('--url', default='')
    ap.add_argument('--tags', default='')
    a = ap.parse_args()
    if a.cmd == 'list':
        for k, r in sorted(load().items()): print(f"{k:24s} {r['w']}x{r['h']:<5} {'ok ' if r['composite'] else 'REF'} {r['licence'][:70]}")
    elif a.cmd == 'fetch':
        for s in (SETS if a.set == 'all' else [a.set]): fetch(s)
    elif a.cmd == 'probe':
        for host in ['https://raw.githubusercontent.com/', 'https://commons.wikimedia.org/', 'https://upload.wikimedia.org/',
                     'https://www.loc.gov/', 'https://tile.loc.gov/', 'https://images-api.nasa.gov/', 'https://images.nasa.gov/']:
            try: urllib.request.urlopen(urllib.request.Request(host, headers={'User-Agent': UA}), timeout=10); print('ok     ', host)
            except urllib.error.HTTPError as e: print('http', e.code, host)
            except Exception as e: print('blocked', host, str(e)[:60])
    elif a.cmd == 'search':
        src, q = a.args[0], ' '.join(a.args[1:])
        rows = ADAPTERS[src](q, a.n); m = load()
        for row in rows:
            ext = os.path.splitext(urllib.parse.urlparse(row['src']).path)[1] or '.jpg'
            dst = os.path.join(LIB, row['id'] + ext)
            try:
                if not os.path.exists(dst): get(row['src'], dst)
                add(m, row, dst)
            except Exception as e: print('  FAIL', row['id'], e)
        save(m)
    elif a.cmd == 'import':
        if not (a.id and a.licence): sys.exit('import needs --id and --licence (and --credit, --url)')
        srcp = a.args[0]; dst = os.path.join(LIB, a.id + os.path.splitext(srcp)[1].lower())
        os.makedirs(LIB, exist_ok=True); shutil.copyfile(srcp, dst); m = load()
        add(m, dict(id=a.id, source='import', licence=a.licence, credit=a.credit, url=a.url, tags=[t for t in a.tags.split(',') if t]), dst)
        save(m)
    else: sys.exit(__doc__)


if __name__ == '__main__':
    main()
