#!/usr/bin/env python3
"""film_matte: matte ONE object across a film shot (hand-keyed polygon, tracked), then tint it.

Lifted from the MECHA_PROLETARIAT_ARCHIVE builder's bake_archive.py and made a shared tool. Not segmentation: you draw
a polygon (0..1 coords) on one key frame, Lucas-Kanade features inside it are followed frame to frame (forward and back
from the key) with a RANSAC similarity transform, and the polygon rides along. It drifts on deforming or fast-rotating
objects (hands, lever arms in perspective), so always run `check` and look at the contact sheet.

  film_matte.py check  FRAMES_DIR SPEC.json OUT.jpg   # mask as a blue wash on ~8 frames (do this first)
  film_matte.py bake   FRAMES_DIR SPEC.json OUT_DIR   # writes NNN.jpg: grey film with the object tinted
  film_matte.py selftest                              # synthetic moving box, no files needed

SPEC.json: {"fr":[a,b], "mode":"poly"|"hue", "key":[frame, [[[x,y],...], ...]], "gate":[lo,hi], "feather":5,
            "tint":[[r,g,b] x4 dark->light] (default red-lead primer), "grey":true}
  fr    frames [a,b) of the sorted *.jpg/png in FRAMES_DIR (key frame number is in the same numbering as FRAMES_DIR)
  gate  luma window the tint may sit on, so it lands on the metal and not the hand around it
  hue   no polygon: key by hue (for colour film where the object is already that colour); "hue_deg":19 "sat":.55
Shared helpers importable: track(frames, kf, polys) -> per-frame polygons; poly_masks(...); tint_ramp(y, ramp).
"""
import sys, os, json, glob
import numpy as np, cv2

PRIMER = [[10, 3, 3], [64, 16, 12], [142, 36, 25], [218, 88, 60]]   # red-lead primer, oxblood to lit orange-red


def tint_ramp(y, ramp=PRIMER):
    r = np.array(ramp, np.float32); xs = np.linspace(0, 1, len(r))
    return np.stack([np.interp(y, xs, r[:, c]) for c in range(3)], -1) / 255


def track(frames, kf, polys):
    """polys (pixel coords, list of Nx2 float arrays) on frame index kf -> list (per frame) of polygon lists."""
    n = len(frames); gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
    H, W = gray[0].shape
    out = [None] * n; out[kf] = [np.asarray(p, np.float32).copy() for p in polys]

    def step(i, j):
        m = np.zeros((H, W), np.uint8)
        for p in out[i]: cv2.fillPoly(m, [p.astype(np.int32)], 255)
        m = cv2.dilate(m, np.ones((25, 25), np.uint8))
        pts = cv2.goodFeaturesToTrack(gray[i], 200, .01, 5, mask=m)
        if pts is None or len(pts) < 6: out[j] = out[i]; return
        q, st, _ = cv2.calcOpticalFlowPyrLK(gray[i], gray[j], pts, None, winSize=(31, 31), maxLevel=3)
        ok = st.ravel() == 1
        if ok.sum() < 6: out[j] = out[i]; return
        M, _ = cv2.estimateAffinePartial2D(pts[ok], q[ok], method=cv2.RANSAC, ransacReprojThreshold=2.5)
        if M is None: out[j] = out[i]; return
        out[j] = [cv2.transform(p.reshape(-1, 1, 2).astype(np.float32), M).reshape(-1, 2) for p in out[i]]
    for i in range(kf, n - 1): step(i, i + 1)
    for i in range(kf, 0, -1): step(i, i - 1)
    return out


def poly_masks(frames, kf, polys01, feather=5):
    H, W = frames[0].shape[:2]
    polys = [np.array([[x * W, y * H] for x, y in p], np.float32) for p in polys01]
    tr = track(frames, kf, polys); ms = []
    for i in range(len(frames)):
        m = np.zeros((H, W), np.uint8)
        for p in tr[i]: cv2.fillPoly(m, [p.astype(np.int32)], 255)
        ms.append(cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), feather))
    return ms


def hue_mask(f, deg=19, sat=.55):
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV).astype(np.float32)
    h, s, v = hsv[..., 0] * 2, hsv[..., 1] / 255, hsv[..., 2] / 255
    m = np.clip((deg - np.minimum(h, 360 - h)) / 6, 0, 1) * np.clip((s - sat) / .2, 0, 1) * np.clip((v - .12) / .15, 0, 1)
    m = cv2.GaussianBlur(m, (0, 0), 1.5)
    return cv2.GaussianBlur(cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)), (0, 0), 1.2)


def load(d, spec):
    fs = sorted(glob.glob(d + '/*.jpg') + glob.glob(d + '/*.png'))
    a, b = spec.get('fr', [0, len(fs)])
    return [cv2.imread(f) for f in fs[a:b]], a


def masks_for(frames, a, spec):
    if spec.get('mode', 'poly') == 'hue':
        return [hue_mask(f, spec.get('hue_deg', 19), spec.get('sat', .55)) for f in frames]
    kf, polys = spec['key']
    ms = poly_masks(frames, kf - a, polys, spec.get('feather', 5))
    if 'gate' in spec:
        lo, hi = spec['gate']
        for i, f in enumerate(frames):
            y = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
            ms[i] = ms[i] * np.clip((y - lo) / .12, 0, 1) * np.clip((hi - y) / .08 + 1, 0, 1)
    return ms


def check(d, spec, out):
    frames, a = load(d, spec); ms = masks_for(frames, a, spec); k = max(1, len(frames) // 8); tiles = []
    for f, m in list(zip(frames, ms))[::k][:8]:
        o = f.astype(np.float32); o[..., 0] = o[..., 0] * (1 - m * .6) + 255 * m * .6
        tiles.append(cv2.resize(o.clip(0, 255).astype(np.uint8), (240, int(240 * f.shape[0] / f.shape[1]))))
    while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
    cv2.imwrite(out, np.vstack([np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]))
    print('wrote', out, f'{len(frames)} frames; coverage per frame (min/mean/max):',
          '%.3f %.3f %.3f' % (min(m.mean() for m in ms), np.mean([m.mean() for m in ms]), max(m.mean() for m in ms)))


def bake(d, spec, od):
    frames, a = load(d, spec); ms = masks_for(frames, a, spec); os.makedirs(od, exist_ok=True)
    for i, (f, m) in enumerate(zip(frames, ms)):
        y = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        grey = np.repeat(y[..., None], 3, -1)
        out = grey * (1 - m[..., None]) + tint_ramp(np.clip(y * 1.1 + .1, 0, 1), spec.get('tint', PRIMER)) * m[..., None]
        cv2.imwrite(f'{od}/{i:03d}.jpg', (out[..., ::-1] * 255 + .5).clip(0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])
    print('baked', len(frames), 'frames to', od)


def selftest():
    rng = np.random.default_rng(1); H, W, N = 240, 320, 20
    bg = (rng.random((H, W)) * 120 + 60).astype(np.uint8)
    frames = []; truth = []
    for i in range(N):
        dx, dy = i * 3, i * 1.5
        M = np.float32([[1, 0, dx], [0, 1, dy]]); f = cv2.warpAffine(bg, M, (W, H), borderMode=cv2.BORDER_REFLECT)
        # moving textured box: same motion as the texture, so features lie on it
        f = cv2.cvtColor(f, cv2.COLOR_GRAY2BGR); frames.append(f)
        truth.append((dx, dy))
    box = [(.3, .3), (.6, .3), (.6, .6), (.3, .6)]
    ms = poly_masks(frames, 0, [box], 2)
    cx = []
    for m in ms:
        ys, xs = np.nonzero(m > .5); cx.append((xs.mean(), ys.mean()))
    err = max(abs(cx[i][0] - (cx[0][0] + truth[i][0])) + abs(cx[i][1] - (cx[0][1] + truth[i][1])) for i in range(N))
    print('max centroid error px: %.2f' % err); assert err < 3, err
    print('selftest ok')


if __name__ == '__main__':
    c = sys.argv[1] if len(sys.argv) > 1 else ''
    if c == 'selftest': selftest()
    elif c == 'check' and len(sys.argv) == 5: check(sys.argv[2], json.load(open(sys.argv[3])), sys.argv[4])
    elif c == 'bake' and len(sys.argv) == 5: bake(sys.argv[2], json.load(open(sys.argv[3])), sys.argv[4])
    else: print(__doc__)
