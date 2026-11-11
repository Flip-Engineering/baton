#!/usr/bin/env python3
"""PLATE bake (PLATE studio, cycle 1): a poster or a film shot -> a folder a scene reads with lib/fx/plate.js.

Why: the slate kept redrawing photographs (the client's trucker poster traced three ways; the Steel tapper as a CG
mannequin). A copy of a photograph keeps the outline and loses what makes it believable: the soft edge, the rim light,
the surface, the specific face. Here the photograph (or the film) stays the picture; the bake adds what a scene needs to
move it and light it a little: a matte, a depth map, and the background behind the subject.

  python3 videos/scripts/plate_bake.py trucker          # a PLATES entry below (skips the steps already baked; --force)
  python3 videos/scripts/plate_bake.py tapper --only depth,clean
  python3 videos/scripts/plate_bake.py list

Writes videos/web/assets/plate/<name>/:
  color.jpg | color_000.jpg...   the crop at SOURCE resolution (the GPU scales it; nothing is upscaled on disk)
  alpha.png | alpha_000.png...   the subject matte (roto.py's BiRefNet proposal -> trimap band guided filter), 8-bit
  normal.png | normal_000.png... normals from the FLOAT depth at face scale (the 8-bit depth would band)
  depth.png | depth_000.png...   Depth Anything V2 Small (Apache-2.0) disparity, 0 far .. 255 near, normalised ONCE
                                 over the whole shot (so the scale never pumps), blurred at face scale, and for film
                                 median-smoothed over flow-warped neighbours (so the parallax does not swim). 8-bit on
                                 purpose: browsers decode 16-bit PNG to 8 bits for WebGL anyway; 256 levels are 0.1 px
                                 steps for a 5 % push.
  clean.jpg / clean_depth.png    the background with the subject removed: film = temporal median of the frames where
                                 the man is not (a static camera reveals most of it), then inpaint; still = inpaint.
                                 This is what the 2.5D push reveals behind the edge.
  subj.json                      per frame: the subject's bbox, head point and median depth (for type slots and focus)
  meta.json                      source, licence, time, crop, sizes, fps, frames, and the bake settings

Models live OUTSIDE the repo in ~/.cache/acp_roto (ACP_ROTO_CACHE) beside BiRefNet:
  depth_anything_v2_small_fp16.onnx  49.6 MB  https://huggingface.co/onnx-community/depth-anything-v2-small
                                     (onnx/model_fp16.onnx). Small is Apache-2.0; Base/Large/Giant are CC-BY-NC: do not swap.
Cost on 3 threads: depth ~1.5 s a frame at 644 px; BiRefNet ~20 s a key frame (film mattes use keys every `step` frames
and flow-warp the matte to the frames between, then re-refine each against its own frame).
"""
import json, os, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import roto  # noqa: E402  reuse the matte pipeline; do not fork it

SRC = os.path.join(VID, 'sources')
OUT = os.path.join(VID, 'web', 'assets', 'plate')
CACHE = roto.CACHE
DEPTH_ONNX = os.path.join(CACHE, 'depth_anything_v2_small_fp16.onnx')
DEPTH_URL = 'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_fp16.onnx'

# crop: [x, y, w, h] in source px (9:16 unless a scene wants otherwise). box: the subject box in CROP px for BiRefNet
# (1.15x is added as roto.cut does). strokes: roto.strokes() spec in crop px, applied after refine.
PLATES = {
    'trucker': dict(
        src='acp_own_the_future.jpg', still=True,
        crop=[250, 0, 963, 1712],       # clears the poster's baked OWN THE FUTURE / Join the fight / ACP mark (y >= 1747)
        box=[0, 1000, 963, 1712],       # the man: cap back at x~17, chin ~x 640, shoulders to the crop foot
        lic="Client's own poster art (acp_own_the_future.jpg), supplied by the ACP organizer for ACP use",
        note='the OWN THE FUTURE trucker in profile under the red dot, dusk horizon, lit cab and mirror'),
    'tapper': dict(
        src='footage/steel_1258.mp4', t0=2.5, t1=5.6, step=3,
        crop=[300, 0, 1000, 1080],      # wider than 9:16: the scene picks its window (view cx) and can pan toward the taphole
        box=[0, 90, 620, 1080],         # the man (his back arm runs off the crop's left edge; the frame crops him)
        lic="Steel: Man's Servant (1938), NFPF, Public Domain Mark 1.0",
        tc='Steel ~13:00.5-13:03.6 (steel_1258.mp4 2.5-5.6 s)',
        note='the taphole man in a white shirt and cap working the bar; sparks; the pour glow off frame right'),
    'foundry_face': dict(
        src='footage/hires/mhn_0900_foundry.mp4', t=2.05,
        crop=[780, 0, 608, 1080],       # the capped foundry man in profile at the pour, cap to overalls
        box=[80, 150, 608, 1080],
        lic='Master Hands (1936), Jam Handy for Chevrolet; NFPF scan master-hands-1936, Public Domain Mark 1.0',
        tc='NFPF 09:02 (Prelinger II 04:00)',
        note='a lined 1936 face under a cloth cap, lit from the pour on the left; black and white'),
}


def depth_session():
    sys.path.insert(0, os.path.join(CACHE, 'py'))
    import onnxruntime as ort
    if not os.path.exists(DEPTH_ONNX):
        raise SystemExit(f'missing {DEPTH_ONNX}\n  curl -sSL -o {DEPTH_ONNX} {DEPTH_URL}')
    so = ort.SessionOptions(); so.intra_op_num_threads = int(os.environ.get('ACP_ROTO_THREADS', '3')); so.inter_op_num_threads = 1
    return ort.InferenceSession(DEPTH_ONNX, so, providers=['CPUExecutionProvider'])


def depth_raw(S, img, long_side=700):
    """BGR uint8 -> float32 disparity at image size (bigger = nearer), unnormalised."""
    h, w = img.shape[:2]; k = long_side / max(h, w)
    th, tw = max(14, int(round(h * k / 14)) * 14), max(14, int(round(w * k / 14)) * 14)
    x = cv2.resize(img, (tw, th), interpolation=cv2.INTER_AREA)[:, :, ::-1].astype(np.float32) / 255
    x = (x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)
    y = S.run(None, {S.get_inputs()[0].name: x.transpose(2, 0, 1)[None].copy()})[0][0]
    return cv2.resize(y.astype(np.float32), (w, h), interpolation=cv2.INTER_CUBIC)


def frames_of(spec):
    """list of BGR crops (source res) and the fps"""
    x, y, w, h = spec['crop']
    if spec.get('still'):
        im = cv2.imread(os.path.join(SRC, spec['src']), cv2.IMREAD_COLOR)
        return [im[y:y + h, x:x + w].copy()], 0
    cap = cv2.VideoCapture(os.path.join(SRC, spec['src'])); fps = cap.get(cv2.CAP_PROP_FPS)
    if 't' in spec:   # one film frame as a still plate
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(spec['t'] * fps))); ok, im = cap.read(); cap.release()
        return [im[y:y + h, x:x + w].copy()], 0
    f0, f1 = int(round(spec['t0'] * fps)), int(round(spec['t1'] * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, f0); out = []
    for _ in range(f1 - f0 + 1):
        ok, im = cap.read()
        if not ok: break
        out.append(im[y:y + h, x:x + w].copy())
    cap.release()
    return out, fps


def box_alpha(S, img, box):
    """BiRefNet on the subject box (1.15x, as roto.cut) placed back into a full-crop alpha"""
    H, W = img.shape[:2]; x0, y0, x1, y1 = box
    cx, cy, bw, bh = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 1.15, (y1 - y0) * 1.15
    X0, Y0, X1, Y1 = max(0, int(cx - bw / 2)), max(0, int(cy - bh / 2)), min(W, int(cx + bw / 2)), min(H, int(cy + bh / 2))
    a = np.zeros((H, W), np.float32); a[Y0:Y1, X0:X1] = roto.propose(S, img[Y0:Y1, X0:X1])
    return a


def finish_alpha(img, a0, spec):
    a, _ = roto.refine(img, a0, band=spec.get('band', 4))
    a = roto.keep_main(a, spec.get('min_share', 0.02)); a = roto.fill_holes(a, spec.get('hole', 900))
    return roto.strokes(a, spec.get('strokes'))


def mattes(frames, spec):
    S = roto.session(); n = len(frames)
    if n == 1:
        return [finish_alpha(frames[0], box_alpha(S, frames[0], spec['box']), spec)]
    step = spec.get('step', 3); keys = sorted(set(list(range(0, n, step)) + [n - 1]))
    gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
    K = {}
    for k in keys:
        t = time.time(); K[k] = box_alpha(S, frames[k], spec['box']); print(f'  matte key {k}/{n - 1} {time.time() - t:.1f} s', flush=True)
    out = []
    for i in range(n):
        if i in K: a0 = K[i]
        else:   # the two keys around i, warped onto i and blended by distance
            kl = max(k for k in keys if k < i); kr = min(k for k in keys if k > i); u = (i - kl) / (kr - kl)
            a0 = (1 - u) * roto.warp_to(K[kl], gray[kl], gray[i]) + u * roto.warp_to(K[kr], gray[kr], gray[i])
        out.append(finish_alpha(frames[i], a0.astype(np.float32), spec))
    return out


def depths(frames, blur_frac=0.006):
    S = depth_session(); raw = []
    for i, f in enumerate(frames):
        t = time.time(); raw.append(depth_raw(S, f))
        if i % 10 == 0: print(f'  depth {i}/{len(frames) - 1} {time.time() - t:.1f} s', flush=True)
    if len(frames) > 2:   # temporal: median of the flow-warped neighbours (the roto trick, for depth)
        gray = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]; sm = []
        for i in range(len(frames)):
            st = [raw[i]] + [roto.warp_to(raw[j], gray[j], gray[i]) for j in (i - 2, i + 2) if 0 <= j < len(frames)]
            sm.append(np.median(np.stack(st), 0) if len(st) == 3 else np.mean(np.stack(st), 0))
        raw = sm
    allv = np.concatenate([r[::4, ::4].ravel() for r in raw])
    lo, hi = np.percentile(allv, [1, 99.5])   # one normalisation for the whole shot
    r = max(1.0, blur_frac * max(frames[0].shape[:2]))
    return [np.clip(cv2.GaussianBlur((d - lo) / (hi - lo), (0, 0), r), 0, 1) for d in raw], dict(lo=float(lo), hi=float(hi), blur_px=round(r, 1))


def clean_plate(frames, alphas, dmaps):
    """background without the subject: temporal median where he is not, inpaint the rest (half res, then up)"""
    H, W = frames[0].shape[:2]
    keep = [cv2.dilate((a > 0.03).astype(np.uint8), np.ones((15, 15), np.uint8)) == 0 for a in alphas]
    if len(frames) > 1:
        stack = np.stack(frames).astype(np.float32); ks = np.stack(keep)
        cnt = ks.sum(0); col = np.zeros((H, W, 3), np.float32); dep = np.zeros((H, W), np.float32)
        # a masked median over time, per pixel (vectorised: sort the masked-out samples to +inf)
        big = np.where(ks[..., None], stack, np.inf); srt = np.sort(big, 0)
        idx = np.clip((cnt - 1) // 2, 0, len(frames) - 1)
        col = np.take_along_axis(srt, np.broadcast_to(idx[None, ..., None], (1, H, W, 3)), 0)[0]
        dstack = np.where(ks, np.stack(dmaps), np.inf); dsrt = np.sort(dstack, 0)
        dep = np.take_along_axis(dsrt, idx[None], 0)[0]
        hole = cnt == 0
        col[hole] = 0; dep[hole] = 0
    else:
        col = frames[0].astype(np.float32); dep = dmaps[0].copy(); hole = ~keep[0]
    hm = hole.astype(np.uint8) * 255
    # fill by normalised convolution, finest scale that has support first (a pull-push fill): big holes get the smooth
    # continuation of the ground around them (a dusk gradient stays a gradient) where Telea drags streaks inward
    fillc = pullpush(col, ~hole); dfill = pullpush(dep[..., None], ~hole)[..., 0]
    g = frames[len(frames) // 2].astype(np.float32); grain = g - cv2.GaussianBlur(g, (0, 0), 1.5)
    fillc += np.roll(grain, (37, 91), (0, 1)) * 0.8 * (1 - alphas[len(frames) // 2][..., None])   # the source's own grain back
    feather = cv2.GaussianBlur(hm.astype(np.float32) / 255, (0, 0), 2)[..., None]
    col = np.where(hole[..., None], fillc, col)
    col = col * (1 - feather) + fillc * feather
    dep = np.where(hole, dfill, dep)
    return np.clip(col, 0, 255).astype(np.uint8), cv2.GaussianBlur(dep, (0, 0), 3)


def pullpush(img, known):
    """fill unknown pixels of img (H,W,C float) from the known ones: the finest normalised Gaussian blur with support"""
    img = img.astype(np.float32); m = known.astype(np.float32); out = img.copy(); todo = ~known.copy()
    s = 2.0
    while todo.any() and s < 2048:
        num = cv2.GaussianBlur(img * m[..., None], (0, 0), s); den = cv2.GaussianBlur(m, (0, 0), s)
        if num.ndim == 2: num = num[..., None]
        ok = todo & (den > 0.08)
        out[ok] = (num / np.maximum(den, 1e-6)[..., None])[ok]
        todo &= ~ok; s *= 1.6
    return out


def half(im):
    """depth and normals are smooth at face scale: half resolution (plate.js samples them by uv) is a quarter of the disk"""
    return cv2.resize(im, (im.shape[1] // 2, im.shape[0] // 2), interpolation=cv2.INTER_AREA)


def normal_map(d_float, face_frac=0.012):
    """RGB normal from FLOAT depth (8-bit depth differentiated in the shader bands into contour lines): gradient in
    depth per plate height (x and y isotropic), at face scale, encoded n*0.5+0.5. The shader scales xy by its relief."""
    h, w = d_float.shape; r = max(1.5, face_frac * h)
    d = cv2.GaussianBlur(d_float.astype(np.float32), (0, 0), r)
    gx = cv2.Sobel(d, cv2.CV_32F, 1, 0, ksize=3) / 8 * h; gy = cv2.Sobel(d, cv2.CV_32F, 0, 1, ksize=3) / 8 * h
    n = np.dstack([-gx, -gy, np.ones_like(gx)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)[:, :, ::-1]   # BGR for cv2 -> RGB on disk


def subj_info(a, d):
    ys, xs = np.nonzero(a > 0.5)
    if not len(ys): return None
    return dict(bbox=[int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())], head=[int(xs[ys.argmin()]), int(ys.min())],
                depth=round(float(np.median(d[a > 0.5])), 3), area=round(float((a > 0.5).mean()), 4))


def bake(name, force=False, only=None):
    spec = PLATES[name]; od = os.path.join(OUT, name); os.makedirs(od, exist_ok=True)
    t0 = time.time(); frames, fps = frames_of(spec); n = len(frames); still = n == 1
    fn = (lambda k, i, ext: os.path.join(od, f'{k}.{ext}')) if still else (lambda k, i, ext: os.path.join(od, f'{k}_{i:03d}.{ext}'))
    want = lambda k: (only is None or k in only)
    print(f'{name}: {n} frame(s) {frames[0].shape[1]}x{frames[0].shape[0]}')
    have_alpha = all(os.path.exists(fn('alpha', i, 'png')) for i in range(n))
    if want('alpha') and (force or not have_alpha):
        for i, a in enumerate(mattes(frames, spec)): cv2.imwrite(fn('alpha', i, 'png'), np.clip(a * 255 + .5, 0, 255).astype(np.uint8))
    alphas = [cv2.imread(fn('alpha', i, 'png'), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255 for i in range(n)]
    if want('color'):   # colour decontaminated in the matte's soft band (roto.decontaminate): no dark or light fringe
        # stills only: plate.js draws a still as two layers (subject over clean plate), where a clean edge colour matters;
        # a film plate is drawn as one layer warped by its depth, and there the band IS the ground (a decontaminated band
        # smears the shirt's white into the shop around him)
        for i, f in enumerate(frames): cv2.imwrite(fn('color', i, 'jpg'), roto.decontaminate(f, alphas[i]) if still else f, [cv2.IMWRITE_JPEG_QUALITY, 94])
    have_depth = all(os.path.exists(fn('depth', i, 'png')) and os.path.exists(fn('normal', i, 'png')) for i in range(n))
    dinfo = {}
    if want('depth') and (force or not have_depth):
        dm, dinfo = depths(frames)
        for i, d in enumerate(dm):
            cv2.imwrite(fn('depth', i, 'png'), half(np.clip(d * 255 + .5, 0, 255).astype(np.uint8)))
            cv2.imwrite(fn('normal', i, 'png'), half(normal_map(d)))
    H0, W0 = frames[0].shape[:2]
    dmaps = [cv2.resize(cv2.imread(fn('depth', i, 'png'), cv2.IMREAD_GRAYSCALE), (W0, H0), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255 for i in range(n)]
    if want('clean'):
        c, cd = clean_plate(frames, alphas, dmaps)
        cv2.imwrite(os.path.join(od, 'clean.jpg'), c, [cv2.IMWRITE_JPEG_QUALITY, 92])
        cv2.imwrite(os.path.join(od, 'clean_depth.png'), half(np.clip(cd * 255 + .5, 0, 255).astype(np.uint8)))
        cv2.imwrite(os.path.join(od, 'clean_normal.png'), half(normal_map(cd)))
    subj = [subj_info(a, d) for a, d in zip(alphas, dmaps)]
    json.dump(subj, open(os.path.join(od, 'subj.json'), 'w'))
    mp = os.path.join(od, 'meta.json'); old = json.load(open(mp)) if os.path.exists(mp) else {}
    meta = dict(old, name=name, source=spec['src'], licence=spec['lic'], note=spec.get('note'), tc=spec.get('tc'),
                crop=spec['crop'], size=[frames[0].shape[1], frames[0].shape[0]], frames=n, fps=fps or None,
                t0=spec.get('t0'), t1=spec.get('t1'), still=still, depth_model='Depth Anything V2 Small fp16 ONNX (Apache-2.0)',
                matte='roto.py BiRefNet-lite + guided band refine' + ('' if still else f", keys every {spec.get('step', 3)} frames, flow-warped between"),
                baked=time.strftime('%Y-%m-%d %H:%M'), bake_s=round(time.time() - t0, 1))
    if dinfo: meta['depth_norm'] = dinfo
    json.dump(meta, open(mp, 'w'), indent=1)
    print(f'{name}: baked in {meta["bake_s"]} s -> {os.path.relpath(od, VID)}')


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] == 'list':
        for k, v in PLATES.items(): print(k, v['src'], v['crop'], v.get('note', ''))
        sys.exit(0)
    only = None
    if '--only' in a: only = set(a[a.index('--only') + 1].split(','))
    bake(a[0], force='--force' in a, only=only)
