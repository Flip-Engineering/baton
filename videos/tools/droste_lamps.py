"""droste_lamps.py: the come-alive of a stage that has no film (droste c2): the IBM 704's own lamps.

There is no public-domain film of a 1950s computing room with people in it (checked 1 Oct: NASA video search, IA, NARA). The engine's rule is
"light moves; people never move", so the stage comes alive by light only: the 136 register lamps of the console (found in the still with a Hough
transform, hand-checked) light and go out as the machine counts, the status buttons glow; the operator, the cabinet and the room do not move.
Writes the same frame folder a film does (videos/out/<key>/films/<id>/%04d.jpg + meta.json), 15 fps, 9:16, so engine/droste/film.py plays it.

    python3 tools/droste_lamps.py --key subject_v4 --id lamps --still IB --seconds 3.0 [--seed 704]
Pattern: the accumulator row counts up in binary (a carry ripples left), the storage and M-Q rows take a new pseudo-random word every other frame
(shot on twos), the instruction counter steps by one, the index row follows the instruction counter; the trap lamp stays dark. Exposure is a little
over what the print could show: each lit lamp has a hard core and a halo, so the effect still reads at 270 px.
"""
import argparse, json, os, sys
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)


def find_lamps(img, region):
    x0, y0, x1, y1 = region
    c = img[y0:y1, x0:x1]
    g = cv2.GaussianBlur(cv2.cvtColor(c, cv2.COLOR_BGR2GRAY), (0, 0), 1.2)
    ci = cv2.HoughCircles(g, cv2.HOUGH_GRADIENT, dp=1, minDist=14, param1=70, param2=11, minRadius=5, maxRadius=9)
    pts = [(float(x + x0), float(y + y0), float(r)) for x, y, r in ci[0]]
    # rows: cluster by the slanted line each row of lamps lies on (y falls with x by a constant slope): fit by sorting on y - slope * x
    return pts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--key', required=True); ap.add_argument('--id', default='lamps'); ap.add_argument('--still', default='IB')
    ap.add_argument('--seconds', type=float, default=3.0); ap.add_argument('--seed', type=int, default=704); ap.add_argument('--out-w', type=int, default=810)
    ap.add_argument('--region', default='780,380,1687,1000'); ap.add_argument('--fps', type=float, default=15)
    a = ap.parse_args()
    from engine.droste import targets as T
    still = T.load(a.still)[:, :, ::-1].copy()
    H, W = still.shape[:2]
    region = [int(v) for v in a.region.split(',')]
    lamps = find_lamps(still, region)
    # slope of the rows from the lamp cloud itself (perspective: rows fall to the right)
    P = np.array(lamps)
    slope = 0.205
    key = P[:, 1] - slope * (P[:, 0] - P[:, 0].min())
    order = np.argsort(key)
    # bin into rows by gaps in the sorted key
    rows, cur = [], [order[0]]
    for i, j in zip(order[:-1], order[1:]):
        if key[j] - key[i] > 18:
            rows.append(cur); cur = []
        cur.append(j)
    rows.append(cur)
    rows = [sorted(r, key=lambda k: P[k, 0]) for r in rows if len(r) >= 4]
    rng = np.random.default_rng(a.seed)
    n = int(round(a.seconds * a.fps))
    out = os.path.join(VIDEOS, 'out', a.key, 'films', a.id)
    os.makedirs(out, exist_ok=True)
    OW = a.out_w; OH = int(round(OW * 16 / 9))
    base = still.astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W]
    state = [rng.integers(0, 2, len(r)) for r in rows]
    counter = 0
    for f in range(n):
        lit = np.zeros((H, W), np.float32)
        if f % 2 == 0:                                   # shot on twos
            counter += 1
        for ri, r in enumerate(rows):
            L = len(r)
            if ri == 0 or ri == len(rows) - 1:           # the index row and the instruction row: a slow ripple
                bits = [(1 if ((counter // 3 + k * 2) % 7) < 3 else 0) for k in range(L)]
            elif ri % 2 == 1:                            # accumulator-like: binary count
                v = counter * (3 + ri)
                bits = [(v >> (L - 1 - k)) & 1 for k in range(L)]
            else:                                        # storage-like: a fresh pseudo-random word each pair of frames
                rr = np.random.default_rng(a.seed + ri * 1000 + counter)
                bits = list((rr.random(L) < 0.42).astype(int))
            for k, j in enumerate(r):
                if bits[k]:
                    x, y, rad = lamps[j]
                    cv2.circle(lit, (int(x), int(y)), int(rad * 0.7), 1.0, -1, cv2.LINE_AA)
        halo = cv2.GaussianBlur(lit, (0, 0), 15.0)
        core = cv2.GaussianBlur(lit, (0, 0), 3.0)
        light = np.clip(core * 1.7 + halo * 3.4, 0, 2.4)
        # the status buttons (the white one) breathe a little
        img = base + light[..., None] * 215.0
        img = np.clip(img, 0, 255).astype(np.uint8)
        im = cv2.resize(img, (OW, OH), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(out, '%04d.jpg' % f), im, [cv2.IMWRITE_JPEG_QUALITY, 92])
    json.dump(dict(frames=n, fps=a.fps, src='IBM 704 console lamps lit procedurally over the NASA still (LRC-1957-B701_P-00989)', still=a.still, colour=False,
                   lamps=len(lamps), rows=[len(r) for r in rows]), open(os.path.join(out, 'meta.json'), 'w'))
    print('wrote', n, 'frames;', len(lamps), 'lamps in', len(rows), 'rows:', [len(r) for r in rows])


if __name__ == '__main__':
    main()
