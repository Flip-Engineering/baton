"""subject_review.py: eye-review contact sheets of THE SUBJECT's layout, by how large each tile gets on screen (lead build, 30 Sep).

    python3 tools/subject_review.py sheets [--min-px 40] [--max-px 1e9] [--per 150] [--out DIR] [--skip reviewed_ids.txt]   # run from videos/
    python3 tools/subject_review.py where ID [ID ...]                                                # levels, cells, peak px, title

Every tile that reaches --min-px on screen, as the render crops it (droste.pool.crop: the 4:5 face-centred crop), numbered, 15 x 10 to a
sheet, ordered by level and first frame seen. The index -> id map is written next to the sheets (index.json), so a tile judged unfit
(a child, a soldier, a sign or document, an agency mark, anything the curation list excludes) goes into
videos/sources/record/subject/exclude_ids.txt with its reason, and solve_zoned.py drops it on the next solve.
"""
import argparse, json, os, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(VIDEOS, 'engine'))
OUT = os.path.join(VIDEOS, 'out', 'subject')


def exposure_by_id():
    L = json.load(open(os.path.join(OUT, 'layout.json')))
    ex = np.load(os.path.join(OUT, 'exposure.npz'))
    best, where = {}, {}
    for lv, cells in L.items():
        if lv not in ('M1', 'M2', 'M3'):
            continue
        e = ex[lv + '_px'].reshape(-1); fr = ex[lv + '_first'].reshape(-1)
        for c, i in cells:
            if not i:
                continue
            c = int(c)
            if float(e[c]) > best.get(i, (0,))[0]:
                best[i] = (float(e[c]), lv, int(fr[c]))
            where.setdefault(i, []).append((lv, c, round(float(e[c]), 1), int(fr[c])))
    return best, where


def sheets(min_px, max_px, per, outd, skip=None):
    from droste.pool import Pool
    P = Pool()
    best, _ = exposure_by_id()
    ids = [i for i, (s, lv, fr) in best.items() if min_px <= s < max_px]
    if skip and os.path.exists(skip):
        seen = {l.strip() for l in open(skip) if l.strip()}
        ids = [i for i in ids if i not in seen]
    ids.sort(key=lambda i: ({'M1': 0, 'M2': 1, 'M3': 2}[best[i][1]], best[i][2]))
    os.makedirs(outd, exist_ok=True)
    cols, rows, tw, th = 15, per // 15, 96, 120
    index = {}
    for k in range(0, len(ids), per):
        chunk = ids[k:k + per]
        W = np.full((rows * (th + 14), cols * tw, 3), 20, np.uint8)
        for j, i in enumerate(chunk):
            n = k + j
            index[n] = i
            try:
                t = P.crop(i)
            except Exception:
                continue
            t = cv2.resize(t, (tw - 2, th - 2), interpolation=cv2.INTER_AREA)
            y, x = (j // cols) * (th + 14), (j % cols) * tw
            W[y + 14:y + 14 + th - 2, x + 1:x + tw - 1] = t
            cv2.putText(W, str(n), (x + 2, y + 11), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 0), 1)
        cv2.imwrite(os.path.join(outd, 'sheet_%03d.jpg' % (k // per)), W[:, :, ::-1], [cv2.IMWRITE_JPEG_QUALITY, 88])
    json.dump(index, open(os.path.join(outd, 'index.json'), 'w'))
    print(len(ids), 'tiles on', -(-len(ids) // per), 'sheets in', outd)


def where(ids):
    best, wh = exposure_by_id()
    rec = {}
    for l in open(os.path.join(OUT, 'records.jsonl')):
        r = json.loads(l)
        if r['id'] in ids:
            rec[r['id']] = r
    for i in ids:
        print(i, wh.get(i), (rec.get(i) or {}).get('title', '')[:140])


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd')
    s = sp.add_parser('sheets'); s.add_argument('--min-px', type=float, default=40); s.add_argument('--max-px', type=float, default=1e9)
    s.add_argument('--per', type=int, default=150); s.add_argument('--skip', default=None); s.add_argument('--out', default=os.path.join(OUT, 'review'))
    w = sp.add_parser('where'); w.add_argument('ids', nargs='+')
    a = ap.parse_args()
    if a.cmd == 'sheets':
        sheets(a.min_px, a.max_px, a.per, a.out, a.skip)
    elif a.cmd == 'where':
        where(a.ids)
    else:
        ap.print_help()
