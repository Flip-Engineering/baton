#!/usr/bin/env python3
"""ROTO: real workers from film to clean mattes (HUMAN studio, cycle 4, change A).

Why: every person on the slate that the viewer believes in is real (a 1936-38 film worker, or a silhouette traced from
real motion). The ART c2 frieze failed on its GrabCut mattes (rectangle seeds, a notch cut out of a cap, torn heads,
light halos), not on the film. This is the matte pipeline that makes real people a source every piece can call:

  1. SELECT   a film, a time and a box around the man (source px). The rule: he separates from the ground in value and
              no second man overlaps him. Hi-res pulls (NFPF Master Hands 1440x1080, Steel 1440x1080) for heroes; the
              640x480 Prelinger files are for silhouettes and texture ranks.
  2. PROPOSE  BiRefNet-lite (Zheng Peng et al. 2024, MIT licence) as ONNX on CPU, on the BOX CROP (1.15x the subject;
              uncropped it loses heads), at t-k, t, t+k. The neighbours are warped onto t by optical flow and the MEDIAN
              alpha is kept (kills flicker and one-frame errors without eroding a moving edge).
  3. REFINE   a trimap from the proposal (definite fg / bg / an unknown band a few px wide round the edge). Only the band
              is re-solved: a guided filter (He, Sun and Tang 2010, in numpy: box filters) with the film frame as guide,
              then clamped to the trimap. Nothing outside the band moves.
  4. CLEAN    colour decontamination in the band: the foreground colour is sampled INWARD (a normalised blur of the
              definite foreground), so no shop halo or light fringe survives into a print or an engraving.
  5. CORRECT  hand strokes per figure, applied last: {"fg": [[w, [[x,y],...]], ...], "bg": [...]} polylines in crop px.
  6. CHECK    a 1:1 sheet over mid-grey and over red, and measures: holes, halo (light pixels outside a 1 px ring),
              the largest component's share.
  7. OUTPUT   web/assets/roto/<name>.png (RGBA, straight alpha, colour decontaminated), <name>.json (source, time,
              licence, box, foot, head, contour (Douglas-Peucker 1 px), measures).

  python3 videos/scripts/roto.py figs            # every figure in FIGS below (skips ones already cut unless --force)
  python3 videos/scripts/roto.py figs tapper     # one figure
  python3 videos/scripts/roto.py seq wheel       # a frame sequence (SEQS below): one matte per frame, flow-stabilised
  python3 videos/scripts/roto.py sheet           # the 1:1 check sheet -> review/studio_human_c4/after/mattes_1to1.jpg

The model and onnxruntime live OUTSIDE the repo (ACP_ROTO_CACHE, default ~/.cache/acp_roto: birefnet_lite.onnx 224 MB,
py/ = pip --target onnxruntime). Fetch: see research/capabilities/human.md (cycle 4). Cost: ~20 s a proposal on 3 threads.
"""
import json, os, subprocess, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)
FOOT = os.path.join(VID, 'sources', 'footage')
OUT = os.path.join(VID, 'web', 'assets', 'roto')
CACHE = os.environ.get('ACP_ROTO_CACHE', os.path.expanduser('~/.cache/acp_roto'))
REVIEW = os.path.join(VID, 'review', 'studio_human_c4', 'after')
PD_MH = 'Master Hands (1936), Jam Handy for Chevrolet; NFPF scan master-hands-1936, Public Domain Mark 1.0'
PD_MHP = 'Master Hands (1936), Prelinger MasterHa1936_{}, CC Public Domain'
PD_ST = "Steel: Man's Servant (1938), NFPF, Public Domain Mark 1.0"

# name: file, t (s in file), box [x0, y0, x1, y1] source px, k (neighbour step in frames), strokes, note
FIGS = {
    'tapper': dict(file='steel_1258.mp4', t=4.0, box=[200, 90, 1000, 1080], lic=PD_ST, tc='Steel ~13:02',
                   note='the white-shirt tapper at the taphole, bar in both hands; silhouette figure',
                   # crop px: the furnace post above and behind his cap, the dark door frame and the spout (not him); the bar re-drawn
                   strokes={'bg': [[3, [[515, 0], [590, 0], [586, 322], [556, 322], [553, 236], [548, 104], [515, 92], [515, 0]]],
                                   [3, [[630, 268], [805, 268], [805, 682], [712, 690], [694, 640], [690, 560], [640, 470], [630, 268]]],
                                   [3, [[640, 792], [826, 792], [884, 834], [900, 1064], [640, 1064], [640, 792]]], [10, [[554, 80], [557, 336]]], [3, [[730, 640], [905, 640], [905, 792], [760, 792], [730, 640]]]],
                            'fg': [[7, [[676, 640], [915, 836]]]]}),
    'foundry': dict(file='hires/mhn_0900_foundry.mp4', t=2.05, box=[700, 150, 1440, 1080], lic=PD_MH, tc='NFPF 09:02 (Prelinger II 04:00)',
                    note='capped foundry man in profile at the pour, furnace light on his face; engraved figure'),
    'foundry_face': dict(file='hires/mhn_0900_foundry.mp4', t=1.55, box=[960, 250, 1440, 1000], lic=PD_MH, tc='NFPF 09:01.5 (Prelinger II 04:04)',
                         note='the same crew: a capped man turning to the light, three-quarter face; the world-scale face'),
    'profile': dict(file='MasterHa1936_4.mp4', t=330.0, box=[0, 0, 640, 480], lic=PD_MHP.format(4), tc='Prelinger IV 05:30',
                    note='older toolmaker in glasses and cap, head bowed to the work; print figure (640x480 source: print only)'),
    'handback': dict(file='hires/mhn_2334_handback.mp4', t=2.4, box=[0, 60, 1440, 1080], lic=PD_MH, tc='NFPF 23:36 (Prelinger IV 01:52)',
                     note='a veined worker hand on a lever: the surface reference for the fist'),
}
SEQS = {
    # the driver's grip, traced from the 1936 wheel coda (hands and grip only: the wardrobe is a consumer's, not a trucker's)
    'wheel': dict(file='hires/mhn_3104_wheel.mp4', t0=3.30, t1=4.60, step=2, box=[0, 60, 1440, 1080], lic=PD_MH, tc='NFPF 31:07-31:09 (Prelinger IV 09:16-09:19)',
                  note='both hands taking a 1936 Chevrolet wheel; grip anatomy for the OTF driver'),
}


def session():
    sys.path.insert(0, os.path.join(CACHE, 'py'))
    import onnxruntime as ort
    so = ort.SessionOptions(); so.intra_op_num_threads = int(os.environ.get('ACP_ROTO_THREADS', '3')); so.inter_op_num_threads = 1
    # memory: the default arena peaks ~10 GB on a 1024 input (OOM in the shared 14 GB cgroup); without it ~6.5 GB
    so.enable_cpu_mem_arena = False; so.enable_mem_pattern = False; so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    return ort.InferenceSession(os.path.join(CACHE, 'birefnet_lite.onnx'), so, providers=['CPUExecutionProvider'])


def frame(path, t):
    cap = cv2.VideoCapture(os.path.join(FOOT, path)); fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps))); ok, im = cap.read(); cap.release()
    if not ok: raise RuntimeError(f'no frame {path} @ {t}')
    return im, fps


def propose(S, crop):
    """BiRefNet on one crop (BGR uint8) -> alpha float32 in 0..1 at crop size."""
    h, w = crop.shape[:2]
    x = cv2.resize(crop, (1024, 1024), interpolation=cv2.INTER_AREA if max(h, w) > 1024 else cv2.INTER_CUBIC)[:, :, ::-1].astype(np.float32) / 255
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    y = S.run(None, {S.get_inputs()[0].name: x.transpose(2, 0, 1)[None].copy()})[0][0, 0]
    y = 1 / (1 + np.exp(-y)) if (y.min() < 0 or y.max() > 1) else y
    return cv2.resize(y.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)


def warp_to(alpha, src_gray, dst_gray):
    """warp an alpha computed on src onto dst's geometry (dense Farneback flow dst -> src)."""
    f = cv2.calcOpticalFlowFarneback(dst_gray, src_gray, None, 0.5, 4, 21, 4, 7, 1.5, 0)
    h, w = alpha.shape; gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(alpha, gx + f[..., 0], gy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def box_blur(a, r):
    return cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1), normalize=True, borderType=cv2.BORDER_REFLECT)


def guided(I, p, r=6, eps=1e-3):
    """He et al. guided filter, grey guide I, input p (float32)."""
    mI, mp = box_blur(I, r), box_blur(p, r)
    cov = box_blur(I * p, r) - mI * mp; var = box_blur(I * I, r) - mI * mI
    a = cov / (var + eps); b = mp - a * mI
    return box_blur(a, r) * I + box_blur(b, r)


def refine(img, a0, band=4, r=5, eps=4e-4):
    """trimap from the proposal; re-solve only the unknown band with a guided filter; keep fg and bg definite."""
    fg = (a0 > 0.92).astype(np.uint8); bg = (a0 < 0.08).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * band + 1, 2 * band + 1))
    fgd = cv2.erode(fg, k); bgd = cv2.erode(bg, k)
    unk = (1 - fgd) * (1 - bgd)
    I = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    g = np.clip(guided(I, a0.astype(np.float32), r, eps), 0, 1)
    a = np.where(fgd > 0, 1.0, np.where(bgd > 0, 0.0, g)).astype(np.float32)
    # a band pixel may not move more than 0.5 from the proposal (the filter follows film grain on flat dark grounds)
    a = np.where(unk > 0, np.clip(a, a0 - 0.5, a0 + 0.5), a)
    a[a < 0.02] = 0; a[a > 0.985] = 1
    return a, unk


def decontaminate(img, a, r=9):
    """foreground colour in the soft edge sampled inward: normalised blur of definite-fg colour."""
    f = img.astype(np.float32); m = (a > 0.97).astype(np.float32)
    out = f.copy(); soft = (a > 0) & (a < 0.97)
    for rr in (r, r * 2, r * 4):
        num = cv2.GaussianBlur(f * m[..., None], (0, 0), rr); den = cv2.GaussianBlur(m, (0, 0), rr)[..., None]
        est = num / np.maximum(den, 1e-4)
        take = soft & (den[..., 0] > 0.02)
        # blend: where alpha is high keep most of the film colour (texture), where low take the inward estimate
        w = np.clip((a - 0.35) / 0.6, 0, 1)[..., None]
        out[take] = (f * w + est * (1 - w))[take]
        soft = soft & ~take
    return np.clip(out, 0, 255).astype(np.uint8)


def strokes(a, spec):
    for kind, val in (('bg', 0.0), ('fg', 1.0)):   # bg first, so a fg stroke (a tool) can be drawn back through a removed region
        for w, pts in (spec or {}).get(kind, []):
            m = np.zeros(a.shape, np.uint8); cv2.polylines(m, [np.int32(pts)], False, 1, int(w))
            if len(pts) > 2 and pts[0] == pts[-1]: cv2.fillPoly(m, [np.int32(pts)], 1)   # a closed polyline fills
            a[m > 0] = val
    return a


def keep_main(a, min_share=0.02):
    """drop specks: keep components holding >= min_share of the largest one's area."""
    m = (a > 0.5).astype(np.uint8); n, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 2: return a
    big = st[1:, cv2.CC_STAT_AREA].max(); keep = np.zeros(n, bool); keep[1:] = st[1:, cv2.CC_STAT_AREA] >= big * min_share
    lab2 = keep[lab]; soft = cv2.dilate(lab2.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    return np.where(soft, a, 0).astype(np.float32)


def fill_holes(a, max_area=900):
    m = (a > 0.5).astype(np.uint8); inv = 1 - m; n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 4)
    h, w = a.shape; out = a.copy()
    for i in range(1, n):
        x, y, bw, bh, ar = st[i]
        if ar <= max_area and x > 0 and y > 0 and x + bw < w and y + bh < h: out[lab == i] = 1.0
    return out


def measures(img, a):
    m = (a > 0.5).astype(np.uint8)
    ring = cv2.dilate(m, np.ones((3, 3), np.uint8)) - m
    outer = cv2.dilate(m, np.ones((7, 7), np.uint8)) - cv2.dilate(m, np.ones((3, 3), np.uint8))
    L = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    inner = cv2.erode(m, np.ones((7, 7), np.uint8))
    lin = float(L[inner > 0].mean()) if inner.any() else 0
    # halo: residual alpha beyond 1 px outside the hard edge
    halo = float((a[outer > 0] > 0.1).mean()) if outer.any() else 0
    inv = 1 - m; n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 4)
    h, w = a.shape; holes = sum(1 for i in range(1, n) if st[i][0] > 0 and st[i][1] > 0 and st[i][0] + st[i][2] < w and st[i][1] + st[i][3] < h and st[i][4] > 30)
    n2, _, st2, _ = cv2.connectedComponentsWithStats(m, 8)
    parts = sorted(st2[1:, cv2.CC_STAT_AREA].tolist(), reverse=True)
    return dict(halo_gt1px=round(halo, 4), holes=holes, parts=len(parts), main_share=round(parts[0] / max(1, sum(parts)), 3) if parts else 0, fg_luma=round(lin, 1))


def contour(a, eps=1.0):
    m = (a > 0.5).astype(np.uint8); cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return [cv2.approxPolyDP(c, eps, True)[:, 0, :].tolist() for c in sorted(cs, key=cv2.contourArea, reverse=True) if cv2.contourArea(c) > 40]


def cut(S, name, spec, force=False, t=None, out_name=None, prev=None):
    out_name = out_name or name
    png = os.path.join(OUT, out_name + '.png')
    if os.path.exists(png) and not force: print('have', out_name); return
    t = spec['t'] if t is None else t
    img, fps = frame(spec['file'], t)
    H, W = img.shape[:2]; x0, y0, x1, y1 = spec['box']
    cx, cy, bw, bh = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 1.15, (y1 - y0) * 1.15
    X0, Y0, X1, Y1 = max(0, int(cx - bw / 2)), max(0, int(cy - bh / 2)), min(W, int(cx + bw / 2)), min(H, int(cy + bh / 2))
    crop = img[Y0:Y1, X0:X1]; g0 = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    k = spec.get('k', 2); t0 = time.time(); alphas = [propose(S, crop)]
    if spec.get('median', True):
        for dk in (-k, k):
            nb, _ = frame(spec['file'], t + dk / fps); nc = nb[Y0:Y1, X0:X1]
            alphas.append(warp_to(propose(S, nc), cv2.cvtColor(nc, cv2.COLOR_BGR2GRAY), g0))
    a0 = np.median(np.stack(alphas), 0).astype(np.float32) if len(alphas) == 3 else alphas[0]
    a, unk = refine(crop, a0, band=spec.get('band', 4))
    a = keep_main(a, spec.get('min_share', 0.02)); a = fill_holes(a, spec.get('hole', 900))
    a = strokes(a, spec.get('strokes'))
    rgb = decontaminate(crop, a)
    rgba = np.dstack([rgb, np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8)])
    os.makedirs(OUT, exist_ok=True); cv2.imwrite(png, rgba)
    cv2.imwrite(os.path.join(OUT, out_name + '_plate.jpg'), crop, [cv2.IMWRITE_JPEG_QUALITY, 88])   # the unmatted crop: the man's own world, for a ground
    ys, xs = np.nonzero(a > 0.5)
    meta = dict(name=out_name, source=spec['file'], t=round(t, 3), fps=fps, tc=spec.get('tc'), licence=spec['lic'], note=spec.get('note'),
                box=[X0, Y0, X1, Y1], size=[X1 - X0, Y1 - Y0], head=[int(xs[ys.argmin()]), int(ys.min())] if len(ys) else None,
                foot=[int(np.median(xs[ys > ys.max() - 6])), int(ys.max())] if len(ys) else None,
                bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(ys) else None,
                proposals=len(alphas), s=round(time.time() - t0, 1), measures=measures(crop, a), contour=contour(a))
    json.dump(meta, open(os.path.join(OUT, out_name + '.json'), 'w'))
    cv2.imwrite(os.path.join(OUT, '.' + out_name + '_proposal.png'), (a0 * 255).astype(np.uint8)) if os.environ.get('ACP_ROTO_DEBUG') else None
    print(out_name, meta['measures'], f"{meta['s']} s")


def seq(S, name, force=False):
    sp = SEQS[name]; cap = cv2.VideoCapture(os.path.join(FOOT, sp['file'])); fps = cap.get(cv2.CAP_PROP_FPS); cap.release()
    ks = list(range(int(round(sp['t0'] * fps)), int(round(sp['t1'] * fps)) + 1, sp['step']))
    for j, f in enumerate(ks):
        spec = dict(sp, t=f / fps, median=False)
        cut(S, name, spec, force=force, out_name=f'{name}_{j:02d}')
    json.dump(dict(name=name, frames=len(ks), fps=fps / sp['step'], src_fps=fps, t0=sp['t0'], t1=sp['t1'], licence=sp['lic'], tc=sp['tc'], note=sp['note']),
              open(os.path.join(OUT, name + '_seq.json'), 'w'))


def sheet(names=None):
    names = names or sorted(n[:-5] for n in os.listdir(OUT) if n.endswith('.json') and not n.endswith('_seq.json'))
    rows = []
    for n in names:
        im = cv2.imread(os.path.join(OUT, n + '.png'), cv2.IMREAD_UNCHANGED); a = im[..., 3:].astype(np.float32) / 255; c = im[..., :3].astype(np.float32)
        meta = json.load(open(os.path.join(OUT, n + '.json')))
        grey = c * a + 128 * (1 - a); red = c * a + np.array([30, 30, 200], np.float32) * (1 - a)
        # the 1:1 crop: 360x360 around the head (the place a notch or a halo shows first)
        hx, hy = meta['head'] or [im.shape[1] // 2, 0]; x0 = int(np.clip(hx - 180, 0, max(0, im.shape[1] - 360))); y0 = int(np.clip(hy - 40, 0, max(0, im.shape[0] - 360)))
        crop = lambda A: cv2.copyMakeBorder(A[y0:y0 + 360, x0:x0 + 360], 0, max(0, 360 - A[y0:y0 + 360].shape[0]), 0, max(0, 360 - A[:, x0:x0 + 360].shape[1]), cv2.BORDER_CONSTANT)
        fit = lambda A: cv2.resize(A, (int(360 * A.shape[1] / A.shape[0]), 360), interpolation=cv2.INTER_AREA)
        row = np.hstack([fit(grey), crop(grey), crop(red), fit(np.dstack([a * 255] * 3))]).astype(np.uint8)
        cv2.putText(row, f"{n}  {meta['measures']}", (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1, cv2.LINE_AA)
        rows.append(row)
    wmax = max(r.shape[1] for r in rows); rows = [cv2.copyMakeBorder(r, 2, 2, 0, wmax - r.shape[1], cv2.BORDER_CONSTANT, value=(20, 20, 20)) for r in rows]
    os.makedirs(REVIEW, exist_ok=True); p = os.path.join(REVIEW, 'mattes_1to1.jpg'); cv2.imwrite(p, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 90]); print(p)


if __name__ == '__main__':
    cmd, rest = sys.argv[1], [a for a in sys.argv[2:] if not a.startswith('--')]
    force = '--force' in sys.argv
    if cmd == 'figs':
        S = session()
        for n in (rest or FIGS): cut(S, n, FIGS[n], force)
    elif cmd == 'seq':
        S = session()
        for n in (rest or SEQS): seq(S, n, force)
    elif cmd == 'sheet': sheet(rest or None)
    elif cmd == 'wheelfit':   # the film wheel's rim ellipse (from the first frame, before the hands arrive) -> wheel_seq.json
        a = cv2.imread(os.path.join(OUT, 'wheel_00.png'), cv2.IMREAD_UNCHANGED)[..., 3]
        cs, _ = cv2.findContours((a > 128).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); c = max(cs, key=cv2.contourArea)
        (cx, cy), (ax1, ax2), ang = cv2.fitEllipse(c)
        p = os.path.join(OUT, 'wheel_seq.json'); m = json.load(open(p)); m['ellipse'] = dict(cx=round(cx, 1), cy=round(cy, 1), a=round(ax1 / 2, 1), b=round(ax2 / 2, 1), deg=round(ang, 1))
        json.dump(m, open(p, 'w')); print(m['ellipse'])
