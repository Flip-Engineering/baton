#!/usr/bin/env python3
"""REELEYES (Oct 2026; THE NIGHT OF 25 OCTOBER, ACP OCTOBER): the baker for lib/fx/nightprint.js's footage eyes. It reads the gray plates
reelbake.py baked and writes, per shot that carries an "eyes" block in reel.json, plates/<shot>/eyes.json (plate px, a row a frame), and
flags the shot in plates/index.json ("eyes": n pairs) so NightPrint.tracks() fetches only what exists.

    python3 videos/scripts/reeleyes.py videos/web/assets/<piece>/reel.json [shot ...] [--force]

Modes (research/capabilities/nightprint.md):
  field   blue-noise seeds inside the crowd's polygon, spacing from its bottom row to its top (heads shrink with distance), weighted by the
          plate's local light when "weight": "luma" (lit heads in a dark crowd) or away from it with "dark" (eyes in a room's darkness),
          carried frame to frame by cv2 DIS optical flow (PRESET_MEDIUM), clamped to the polygon; a pair whose forward-backward error passes
          "fb" px (1.5; a fast crowd needs more) or that leaves the polygon is dropped and re-seeded; open delays ripple out from open.from at
          open.speed (plate heights a second)
  faces   YuNet (cv2.FaceDetectorYN, /root/.cache/acp_models/archive/yunet.onnx) at several scales; both eye landmarks; linked by IoU, gaps of
          6 frames or less bridged, one-euro smoothed; frontal close-ups only
  keys    hand keys [[f, xL, yL, xR, yR], ...] in plate fractions, linearly interpolated
  points  fixed sites [[x, y], ...] (plate fractions) carried by the flow; a site whose flow fails holds; single sites (xL == xR)
eyes.json: { "w", "h", "n", "fps", "pairs": [{ "id", "delay", "glint", "f0", "f1", "xy": [[xL, yL, xR, yR], ...] }] }
Deterministic: the same plates and block give the same file.
"""
import json
import os
import sys

import cv2
import numpy as np

YUNET = '/root/.cache/acp_models/archive/yunet.onnx'


def load_frames(d):
    names = sorted(x for x in os.listdir(d) if x.endswith('.jpg'))
    return [cv2.imread(os.path.join(d, x), cv2.IMREAD_GRAYSCALE) for x in names]


def poly_px(poly, w, h):
    return np.array([[x * w, y * h] for x, y in poly], np.float32)


def inside(P, x, y):
    return cv2.pointPolygonTest(P, (float(x), float(y)), False) >= 0


def spacing_at(y, P, sp, h):
    """the seed spacing (px) at row y: sp[0] at the polygon's bottom row, sp[1] at its top (plate heights)"""
    y0, y1 = float(P[:, 1].min()), float(P[:, 1].max())
    u = 0.0 if y1 <= y0 else (y1 - y) / (y1 - y0)
    return (sp[0] + (sp[1] - sp[0]) * min(1.0, max(0.0, u))) * h


def seed_field(img, P, sp, n, rng, weight, taken=None, tries=6000):
    """blue-noise darts with a spacing that varies with y (and, with weight 'luma', a preference for lit spots)"""
    h, w = img.shape
    x0, y0, x1, y1 = P[:, 0].min(), P[:, 1].min(), P[:, 0].max(), P[:, 1].max()
    blur = cv2.GaussianBlur(img, (0, 0), 2.0).astype(np.float32) / 255.0
    lo, hi = np.percentile(blur, 50), np.percentile(blur, 99.5)
    pts = list(taken or [])
    out = []
    for _ in range(tries):
        if len(out) >= n:
            break
        x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
        if not inside(P, x, y):
            continue
        if weight in ('luma', 'dark'):
            l = min(1.0, max(0.0, (blur[int(min(h - 1, y)), int(min(w - 1, x))] - lo) / max(1e-3, hi - lo)))
            if weight == 'dark':
                l = 1.0 - l                                    # eyes in the room's darkness, not on its lit sheets
            if rng.uniform() > 0.08 + 0.92 * l:
                continue
        s = spacing_at(y, P, sp, h)
        if any((x - a) ** 2 + (y - b) ** 2 < (0.5 * (s + spacing_at(b, P, sp, h))) ** 2 for a, b in pts):
            continue
        pts.append((x, y)); out.append((x, y))
    return out


def flow_pair(dis, a, b):
    return dis.calc(a, b, None), dis.calc(b, a, None)


def sample(F, x, y):
    h, w = F.shape[:2]
    xi, yi = int(min(w - 1, max(0, round(x)))), int(min(h - 1, max(0, round(y))))
    return F[yi, xi]


def bake_field(frames, E, fps):
    h, w = frames[0].shape
    P = poly_px(E['poly'], w, h)
    sp = E.get('spacing', [0.022, 0.012]); n = int(E.get('n', 160)); fb = float(E.get('fb', 1.5))
    eyeK = float(E.get('eye', 0.34))                       # eye spacing as a share of the head spacing
    rng = np.random.default_rng(int(E.get('seed', 1)))
    op = E.get('open', {}); ofrom = op.get('from'); ospeed = float(op.get('speed', 0.9)); ojit = float(op.get('jitter', 0.25))
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    live = []; done = []; nid = 0

    def new(x, y, f):
        nonlocal nid
        d = 0.0
        if ofrom:
            d = (np.hypot(x / h - ofrom[0] * w / h, y / h - ofrom[1]) / max(1e-3, ospeed)) * fps
        d += rng.uniform(0, ojit * fps)
        p = {'id': nid, 'delay': round(float(d + f), 2), 'glint': False, 'f0': f, 'pts': [(x, y)]}
        nid += 1
        return p

    for x, y in seed_field(frames[0], P, sp, n, rng, E.get('weight', 'flat')):
        live.append(new(x, y, 0))
    for f in range(1, len(frames)):
        Ff, Fb = flow_pair(dis, frames[f - 1], frames[f])
        keep = []
        for p in live:
            x, y = p['pts'][-1]
            dx, dy = sample(Ff, x, y); x2, y2 = float(x + dx), float(y + dy)
            bx, by = sample(Fb, x2, y2); err = float(np.hypot(x2 + bx - x, y2 + by - y))
            if err > fb or not inside(P, x2, y2):
                done.append(p); continue
            p['pts'].append((x2, y2)); keep.append(p)
        live = keep
        if len(live) < n:                                     # re-seed where pairs were lost (later delays: they open as they arrive)
            for x, y in seed_field(frames[f], P, sp, n - len(live), rng, E.get('weight', 'flat'), taken=[q['pts'][-1] for q in live], tries=2500):
                live.append(new(x, y, f))
    done += live
    pairs = []
    for p in done:
        if len(p['pts']) < 3:
            continue
        xy = []
        for x, y in p['pts']:
            e = spacing_at(y, P, sp, h) * eyeK / 2
            xy.append([round(x - e, 2), round(y, 2), round(x + e, 2), round(y, 2)])
        pairs.append({'id': p['id'], 'delay': p['delay'], 'glint': False, 'f0': p['f0'], 'f1': p['f0'] + len(xy) - 1, 'xy': xy})
    return pairs


def bake_points(frames, E, fps):
    h, w = frames[0].shape
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM); fb = float(E.get('fb', 1.5))
    tr = [[(x * w, y * h)] for x, y in E['pts']]
    for f in range(1, len(frames)):
        Ff, Fb = flow_pair(dis, frames[f - 1], frames[f])
        for t in tr:
            x, y = t[-1]; dx, dy = sample(Ff, x, y); x2, y2 = float(x + dx), float(y + dy)
            bx, by = sample(Fb, x2, y2)
            if np.hypot(x2 + bx - x, y2 + by - y) > fb or not (0 <= x2 < w and 0 <= y2 < h):
                x2, y2 = x, y                                  # the flow failed here: hold the site
            t.append((x2, y2))
    delays = list(E.get('delays') or [])
    delays += [0] * (len(tr) - len(delays))                    # a short 'delays' list: the rest open at once (was an IndexError)
    return [{'id': i, 'delay': float(delays[i]), 'glint': bool(E.get('glint', False)), 'f0': 0, 'f1': len(t) - 1,
             'xy': [[round(x, 2), round(y, 2), round(x, 2), round(y, 2)] for x, y in t]} for i, t in enumerate(tr)]


def bake_keys(frames, E, fps):
    h, w = frames[0].shape
    K = sorted(E['pairs']); F = np.array([k[0] for k in K], float)
    xy = []
    for f in range(len(frames)):
        row = [float(np.interp(f, F, [k[j] for k in K])) for j in range(1, 5)]
        xy.append([round(row[0] * w, 2), round(row[1] * h, 2), round(row[2] * w, 2), round(row[3] * h, 2)])
    return [{'id': 0, 'delay': float(E.get('delay', 0)), 'glint': bool(E.get('glint', False)), 'f0': 0, 'f1': len(xy) - 1, 'xy': xy}]


class OneEuro:
    def __init__(self, fps, mincut=1.0, beta=0.3, dcut=1.0):
        self.fps, self.mc, self.b, self.dc, self.x, self.dx = fps, mincut, beta, dcut, None, 0.0

    def __call__(self, x):
        a = lambda c: 1.0 / (1.0 + self.fps / (2 * np.pi * c))
        if self.x is None:
            self.x = x; return x
        dx = (x - self.x) * self.fps; self.dx = self.dx + a(self.dc) * (dx - self.dx)
        c = self.mc + self.b * abs(self.dx); self.x = self.x + a(c) * (x - self.x)
        return self.x


def iou(a, b):
    ax0, ay0, aw, ah = a; bx0, by0, bw, bh = b
    ix = max(0, min(ax0 + aw, bx0 + bw) - max(ax0, bx0)); iy = max(0, min(ay0 + ah, by0 + bh) - max(ay0, by0))
    u = aw * ah + bw * bh - ix * iy
    return ix * iy / u if u > 0 else 0.0


def bake_faces(frames, E, fps):
    h, w = frames[0].shape
    det = cv2.FaceDetectorYN.create(YUNET, '', (320, 320), float(E.get('score', 0.75)), 0.3, 200)
    scales = E.get('scales', [0.5, 1, 2]); minEye = float(E.get('minEye', 6))
    dets = []
    for img in frames:
        bgr = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR); found = []
        for s in scales:
            im = cv2.resize(bgr, (max(16, int(w * s)), max(16, int(h * s))), interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_CUBIC)
            det.setInputSize((im.shape[1], im.shape[0])); _, fs = det.detect(im)
            for r in (fs if fs is not None else []):
                box = (r[0] / s, r[1] / s, r[2] / s, r[3] / s)
                eR, eL = (r[4] / s, r[5] / s), (r[6] / s, r[7] / s)     # YuNet: the subject's right eye (image left), then left
                if np.hypot(eL[0] - eR[0], eL[1] - eR[1]) < minEye:
                    continue
                if any(iou(box, q['box']) > 0.4 for q in found):
                    continue
                found.append({'box': box, 'L': eR, 'R': eL, 'score': float(r[-1])})
        dets.append(found)
    tracks = []
    for f, found in enumerate(dets):
        for d in found:
            best, bi = None, 0.3
            for t in tracks:
                if 0 < f - t['last'] <= 7 and iou(t['box'], d['box']) > bi:
                    best, bi = t, iou(t['box'], d['box'])
            if best is None:
                best = {'rows': {}, 'last': f, 'box': d['box']}; tracks.append(best)
            best['rows'][f] = [d['L'][0], d['L'][1], d['R'][0], d['R'][1]]; best['last'] = f; best['box'] = d['box']
    pairs = []
    for i, t in enumerate(tracks):
        fs = sorted(t['rows']); f0, f1 = fs[0], fs[-1]
        if f1 - f0 < 2:
            continue
        filt = [OneEuro(fps) for _ in range(4)]; xy = []
        for f in range(f0, f1 + 1):
            if f in t['rows']:
                r = t['rows'][f]
            else:                                              # bridge a gap (<= 6 frames, by the linking above) linearly
                a = max(k for k in fs if k < f); b = min(k for k in fs if k > f); u = (f - a) / (b - a)
                r = [t['rows'][a][j] + (t['rows'][b][j] - t['rows'][a][j]) * u for j in range(4)]
            xy.append([round(float(filt[j](float(r[j]))), 2) for j in range(4)])
        pairs.append({'id': i, 'delay': float(E.get('delay', 0)), 'glint': False, 'f0': f0, 'f1': f1, 'xy': xy})
    return pairs


MODES = {'field': bake_field, 'points': bake_points, 'keys': bake_keys, 'faces': bake_faces}


def main(argv):
    force = '--force' in argv
    args = [a for a in argv if not a.startswith('--')]
    cfg_path = os.path.abspath(args[0]); cfg = json.load(open(cfg_path))
    out = os.path.join(os.path.dirname(cfg_path), 'plates'); ip = os.path.join(out, 'index.json')
    idx = json.load(open(ip)) if os.path.exists(ip) else {}
    fps = cfg.get('fps', 24)
    names = args[1:] or [k for k, s in cfg['shots'].items() if 'eyes' in s]
    for name in names:
        if name not in cfg['shots']:
            print(name, 'not in', os.path.basename(cfg_path)); continue
        E = cfg['shots'][name].get('eyes')
        d = os.path.join(out, name); dst = os.path.join(d, 'eyes.json')
        if not E or not os.path.isdir(d):
            print(name, 'no eyes block or no plates'); continue
        if os.path.exists(dst) and not force:
            print(name, 'kept'); continue
        frames = load_frames(d)
        pairs = MODES[E['mode']](frames, E, fps)
        h, w = frames[0].shape
        json.dump({'w': w, 'h': h, 'n': len(frames), 'fps': fps, 'mode': E['mode'], 'pairs': pairs}, open(dst, 'w'), separators=(',', ':'))
        if name in idx:
            idx[name]['eyes'] = len(pairs)
        live = [sum(1 for p in pairs if p['f0'] <= f <= p['f1']) for f in range(len(frames))]
        print(name, E['mode'], len(pairs), 'pairs; alive per frame min %d max %d' % (min(live), max(live)), flush=True)
        json.dump(idx, open(ip, 'w'), indent=1)                 # after every shot: a later crash leaves the index matching the tracks written


if __name__ == '__main__':
    main(sys.argv[1:])
