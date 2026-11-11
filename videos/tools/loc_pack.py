#!/usr/bin/env python3
"""loc_pack: a Library of Congress item -> crop of the TIFF master -> baked photo pack (colour + depth + meta) in one call.

IRON IS HOT v11's prep_loc.py made general. The crop box is given in the 1024-px-wide JPEG preview that loc.gov lists (look at it
first: `loc_pack.py info ID` prints the preview and master URLs and sizes); it is scaled up to the master. The master TIFF is fetched to
scratch, cropped, deleted; only the crop is kept, and only until the bake is done.

  python3 videos/tools/loc_pack.py info 2017691657
  python3 videos/tools/loc_pack.py pack 2017691657 pal_pair --box 35,45,990,785 --long 3000 --out videos/web/assets/iron13 \
          --credit "Alfred T. Palmer, Office of War Information, Nov. 1941. Library of Congress"
  python3 videos/tools/loc_pack.py --selftest

--out is the assets folder the pack goes into (default web/assets/archive); the scene reads <out>/<name>/color.jpg, depth.png, meta.json
(see archive_bake.py). --rights defaults to the FSA/OWI public-domain statement; for any other LoC collection pass the item's own
rights text (`archive_find.py search` prints it). Without --box the whole master is packed. Needs ~1.2 GB scratch for a big TIFF
(LoC masters run 80-200 MB; scratch is ACP scratch under /tmp/loc_pack and is emptied on exit); check disk_hygiene first.
Rate limits: loc.gov answers 429 under load; this retries with a pause, three times, then stops with the status.
"""
import argparse, json, os, shutil, subprocess, sys, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
FSA = ('The contents of the Library of Congress Farm Security Administration/Office of War Information Black-and-White Negatives are in the '
       'public domain and are free to use and reuse.')
TMP = '/tmp/loc_pack'


def item(iid, tries=3):
    for k in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request('https://www.loc.gov/item/%s/?fo=json' % iid, headers={'User-Agent': 'acp-agitprop-research'}), timeout=60))
        except Exception as e:
            err = e
            if k < tries - 1: time.sleep(20 * (k + 1))
    raise SystemExit('loc.gov: %s' % err)


def files(d):
    return [f for r in d.get('resources', []) for grp in r.get('files', []) for f in (grp if isinstance(grp, list) else [grp])]


def pick(d):
    fs = files(d)
    tif = next((f for f in fs if f.get('mimetype') == 'image/tiff'), None)
    prev = [f for f in fs if f.get('mimetype') == 'image/jpeg']
    p1024 = next((f for f in prev if f.get('width') == 1024), None) or (sorted(prev, key=lambda f: f.get('width') or 0)[-1] if prev else None)
    return tif, p1024


def info(iid):
    d = item(iid); tif, prev = pick(d)
    print(d.get('item', {}).get('title'), '|', d.get('item', {}).get('date'))
    print('rights:', (d.get('item', {}).get('rights') or d.get('item', {}).get('rights_information') or ['?'])[0] if isinstance(d.get('item', {}).get('rights'), list) else d.get('item', {}).get('rights'))
    print('preview:', prev and (prev.get('width'), prev.get('height'), prev['url'])); print('master :', tif and (tif.get('size'), tif['url']))


def pack(iid, name, box, long_side, out, credit, rights, note=''):
    import cv2, archive_bake as ab
    ab.OUT = out
    if os.path.exists(os.path.join(out, name, 'meta.json')): print('have', name); return
    d = item(iid); tif, prev = pick(d)
    if not tif or not prev: raise SystemExit('no TIFF master or no JPEG preview on %s' % iid)
    pw = prev.get('width') or 1024
    os.makedirs(TMP, exist_ok=True)
    try:
        f = os.path.join(TMP, name + '.tif')
        for k in range(3):
            r = subprocess.run(['curl', '-sS', '-m', '900', '-L', '-f', '-o', f, tif['url']])
            if r.returncode == 0: break
            time.sleep(30 * (k + 1))
        else: raise SystemExit('master download failed (rate limit? try later)')
        im = cv2.imread(f, cv2.IMREAD_COLOR); os.remove(f)
        H0, W0 = im.shape[:2]; k = W0 / pw
        x0, y0, x1, y1 = [int(round(v * k)) for v in box] if box else (0, 0, W0, H0)
        print(name, 'master', W0, H0, 'crop', x0, y0, x1 - x0, y1 - y0, flush=True)
        cp = os.path.join(TMP, name + '.png'); cv2.imwrite(cp, im[y0:y1, x0:x1]); del im
        ab.bake(name, cp, None, long_side, credit, rights, 'https://www.loc.gov/item/%s/' % iid,
                note=(note + ' ' if note else '') + 'LoC %s; master %dx%d; crop %d,%d,%d,%d' % (iid, W0, H0, x0, y0, x1 - x0, y1 - y0), native=(x1 - x0, y1 - y0))
        print('baked', name)
    finally:
        shutil.rmtree(TMP, ignore_errors=True)


def selftest():
    d = {'resources': [{'files': [[{'mimetype': 'image/tiff', 'url': 'http://x/m.tif', 'size': 9}, {'mimetype': 'image/jpeg', 'width': 640, 'url': 'a'}, {'mimetype': 'image/jpeg', 'width': 1024, 'url': 'b'}]]}]}
    t, p = pick(d); assert t['url'].endswith('.tif') and p['url'] == 'b'
    d['resources'][0]['files'] = [d['resources'][0]['files'][0][2:]]
    assert pick(d)[0] is None
    assert [round(v * 4.0) for v in (35, 45)] == [140, 180]
    print('loc_pack selftest ok (parsing only; the fetch and bake are live)')


if __name__ == '__main__':
    if '--selftest' in sys.argv: selftest(); sys.exit(0)
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd', required=True)
    i = sp.add_parser('info'); i.add_argument('id')
    p = sp.add_parser('pack'); p.add_argument('id'); p.add_argument('name'); p.add_argument('--box'); p.add_argument('--long', type=int, default=3000)
    p.add_argument('--out', default=os.path.join(os.path.dirname(HERE), 'web', 'assets', 'archive')); p.add_argument('--credit', default=''); p.add_argument('--rights', default=FSA); p.add_argument('--note', default='')
    a = ap.parse_args()
    if a.cmd == 'info': info(a.id)
    else: pack(a.id, a.name, [int(v) for v in a.box.split(',')] if a.box else None, a.long, a.out, a.credit, a.rights, a.note)
