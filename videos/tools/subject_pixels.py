"""subject_pixels.py: one pass over THE SUBJECT's layout that fetches each used photograph once (lead build, 30 Sep).

    python3 tools/subject_pixels.py [--hi-px 110] [--mid-px 24]        # run from videos/

For every id in videos/out/subject/layout.json it fetches the LoC 640 px derivative ("r.jpg", tile.loc.gov, at most 6 requests/s
through archive.harvest.Rate, custom User-Agent) and, from that one download:
  * counts the faces for N (archive.count.per_tile: YuNet >= 0.8 on the 640 px copy, SFace embeddings for the dedupe) into
    out/subject/counts_cache.json, the cache `python3 -m archive.count run --layout ... --no-boxes` reads (person boxes are not run:
    N is stated as a floor of faces, see subject_counts.json);
  * writes the 150 px copy the renderer draws from 24 px up (thumbs150u.pack, recompressed q60, as archive.harvest.fetch_used would);
  * keeps the 640 px file in out/subject/r640/<id>.jpg only when a cell of that id gets larger than --hi-px on screen (droste.pool
    reads it as the tile's hi copy); every other 640 px download is discarded at once.
Resumable: ids already in both the pack and the count cache (and r640/ where needed) are skipped.
"""
import argparse, io, json, os, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(VIDEOS, 'engine'))
OUT = os.path.join(VIDEOS, 'out', 'subject')


CHAIN = None          # droste c2: --chain subject_v3 reads out/<key>/layout.json + exposure.npz (every mosaic level of the chain)


def sizes():
    root = os.path.join(VIDEOS, 'out', CHAIN) if CHAIN else OUT
    L = json.load(open(os.path.join(root, 'layout.json')))
    ex = np.load(os.path.join(root, 'exposure.npz'))
    best = {}
    for lv, cells in L.items():
        if not CHAIN and lv not in ('M1', 'M2', 'M3'):
            continue
        e = ex[lv + '_px'].reshape(-1)
        for c, i in cells:
            if i:
                best[i] = max(best.get(i, 0.0), float(e[int(c)]))
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--hi-px', type=float, default=110)
    ap.add_argument('--mid-px', type=float, default=24)
    ap.add_argument('--chain', default=None)
    a = ap.parse_args()
    global CHAIN
    CHAIN = a.chain
    from archive import harvest, count
    best = sizes()
    ids = sorted(best, key=lambda i: -best[i])              # biggest on screen first: they matter most if the pass is cut short
    rec = {}
    want = set(ids)
    for line in open(harvest.REC):
        r = json.loads(line)
        if r['id'] in want:
            rec[r['id']] = r.get('img640')
    pk = harvest.Pack('thumbs150u')
    cache = json.load(open(count.CACHE)) if os.path.exists(count.CACHE) else {}
    hid = os.path.join(OUT, 'r640'); os.makedirs(hid, exist_ok=True)
    def need(i):
        hi = best[i] > a.hi_px
        return (i not in pk) or (i not in cache) or (hi and not os.path.exists(os.path.join(hid, i + '.jpg')))
    todo = [i for i in ids if rec.get(i) and need(i)]
    print('used ids %d; to fetch %d (> %g px kept at 640: %d)' % (len(ids), len(todo), a.hi_px, sum(best[i] > a.hi_px for i in ids)), flush=True)
    sf = count.sface()
    rate = harvest.Rate(6)
    import concurrent.futures as cf
    t0 = time.time(); n = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for i, b in zip(todo, ex.map(lambda i: harvest.fetch_bytes(rec[i], rate), todo)):
            if not b:
                continue
            im = cv2.imdecode(np.frombuffer(b, np.uint8), cv2.IMREAD_COLOR)
            if im is None:
                continue
            if i not in cache:
                cache[i] = count.per_tile(im[:, :, ::-1], sf, None)
            if i not in pk:
                pk.add(i, harvest.recompress(b, 150, 60))
            if best[i] > a.hi_px:
                open(os.path.join(hid, i + '.jpg'), 'wb').write(b)
            n += 1
            if n % 250 == 0:
                pk.flush(); json.dump(cache, open(count.CACHE, 'w'))
                print('%d/%d  %.1f/s' % (n, len(todo), n / (time.time() - t0)), flush=True)
    pk.flush(); json.dump(cache, open(count.CACHE, 'w'))
    tot = sum(os.path.getsize(os.path.join(hid, f)) for f in os.listdir(hid))
    print('done %d of %d; r640 dir %.0f MB; pack150u %.0f MB' % (n, len(todo), tot / 1e6, os.path.getsize(pk.path) / 1e6), flush=True)


if __name__ == '__main__':
    main()
