#!/usr/bin/env python3
"""MODELING c1: plates a modelled object is built INTO (web/assets/plate/<name>/, read by lib/fx/plate.js and by
lib/fx/modeling/composite.js, which turns the depth into an invisible proxy that occludes, catches shadow and lights).

Uses plate_bake.py's depth and normal steps unchanged; adds what a modelled subject needs and the stock bake does not:
  hand36   the 1936 hand on a lever (Master Hands, NFPF 23:36) with the LEVER REMOVED from the matte and painted out of
           the clean plate, so a modelled cobot wrist can sit where the lever was and the fingers stay on top of it.
  steel_rod  a film shot (Steel 1938) baked DEPTH-ONLY: no matte, a proxy of the room for shadows and occlusion, and a
           per-frame `glow.json` (where the hot metal is, how bright) that drives a light on the model.
  trucker_wide  the client's poster with the real cab painted out to sky and ground, so a modelled cab takes its place
           (the match test lays the model over the photograph at 50 %).

  python3 videos/scripts/modeling_plates.py hand36
  python3 videos/scripts/modeling_plates.py steel_rod
  python3 videos/scripts/modeling_plates.py trucker_wide
"""
import json, os, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import plate_bake as pb   # noqa: E402
import roto               # noqa: E402

VID = pb.VID; OUT = pb.OUT; SRC = pb.SRC


def write_common(name, od, frame_bgr, alpha, clean_bgr, d, meta):
    os.makedirs(od, exist_ok=True)
    cv2.imwrite(os.path.join(od, 'color.jpg'), frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(os.path.join(od, 'alpha.png'), np.clip(alpha * 255 + .5, 0, 255).astype(np.uint8))
    cv2.imwrite(os.path.join(od, 'depth.png'), pb.half(np.clip(d * 255 + .5, 0, 255).astype(np.uint8)))
    cv2.imwrite(os.path.join(od, 'normal.png'), pb.half(pb.normal_map(d)))
    cv2.imwrite(os.path.join(od, 'clean.jpg'), clean_bgr, [cv2.IMWRITE_JPEG_QUALITY, 94])
    cv2.imwrite(os.path.join(od, 'clean_depth.png'), pb.half(np.clip(d * 255 + .5, 0, 255).astype(np.uint8)))
    cv2.imwrite(os.path.join(od, 'clean_normal.png'), pb.half(pb.normal_map(d)))
    json.dump([pb.subj_info(alpha, d)], open(os.path.join(od, 'subj.json'), 'w'))
    json.dump(meta, open(os.path.join(od, 'meta.json'), 'w'), indent=1)


def hand36():
    od = os.path.join(OUT, 'hand36'); t0 = time.time()
    img = cv2.imread(os.path.join(VID, 'web/assets/roto/handback_plate.jpg'))
    a0 = cv2.imread(os.path.join(VID, 'web/assets/roto/handback.png'), cv2.IMREAD_UNCHANGED)[..., 3].astype(np.float32) / 255
    H, W = img.shape[:2]
    # the lever (a bright strip below the fingers, x 985-1130, y > 885) and the rod at the right edge (x > 1340) are not the hand
    lever = np.array([[985, 880], [1000, 890], [1090, 957], [1122, 1000], [1128, 1085], [975, 1085]], np.int32)
    cut = np.zeros((H, W), np.uint8); cv2.fillPoly(cut, [lever], 255)
    cut = cv2.GaussianBlur(cut, (0, 0), 1.2).astype(np.float32) / 255
    a = a0 * (1 - cut); a[:, 1330:] = 0
    a = cv2.GaussianBlur(a, (0, 0), 0.8)
    frame = roto.decontaminate(img, a)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    known = (a < 0.02) & (g < 24)
    known[:, 1330:] = False                                   # the rod
    known &= ~(cut > 0.01)                                    # the lever
    known = cv2.erode(known.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    fill = pb.pullpush(img.astype(np.float32), known)
    grain = img.astype(np.float32) - cv2.GaussianBlur(img.astype(np.float32), (0, 0), 1.5)
    clean = np.clip(fill + np.roll(grain, (37, 91), (0, 1)) * 0.6, 0, 255).astype(np.uint8)
    S = pb.depth_session(); dr = pb.depth_raw(S, img)
    lo, hi = np.percentile(dr[::4, ::4], [1, 99.5]); d = np.clip(cv2.GaussianBlur((dr - lo) / (hi - lo), (0, 0), 6), 0, 1)
    meta = dict(name='hand36', source='footage/hires/mhn_2334_handback.mp4', t=2.4, tc='NFPF 23:36 (Prelinger IV 01:52)',
                licence='Master Hands (1936), Jam Handy for Chevrolet; NFPF scan master-hands-1936, Public Domain Mark 1.0',
                note='a veined worker hand on a lever; lever and right-hand rod painted out so a modelled wrist can take the lever\'s place',
                crop=[0, 0, W, H], size=[W, H], frames=1, fps=None, still=True,
                depth_model='Depth Anything V2 Small fp16 ONNX (Apache-2.0)', matte='roto handback.png (BiRefNet) minus lever polygon',
                baked=time.strftime('%Y-%m-%d %H:%M'), bake_s=round(time.time() - t0, 1))
    frame = (frame.astype(np.float32) * a[..., None] + clean.astype(np.float32) * (1 - a[..., None])).clip(0, 255).astype(np.uint8)   # the lever is painted out of the colour too
    write_common('hand36', od, frame, a, clean, d, meta)
    print('hand36 baked', meta['bake_s'], 's')


def wide_image():
    """compose the 1350 x 2400 plate image (no bake): title painted out, cab painted out, sky extended"""
    im = cv2.imread(os.path.join(SRC, 'acp_own_the_future.jpg')).astype(np.float32)   # 2048 x 2048
    H0, W0 = im.shape[:2]
    g0 = im - cv2.GaussianBlur(im, (0, 0), 1.6)
    tile = g0[80:592, 300:812]                                    # the source's own grain from clean sky, tiled
    grain = np.tile(tile, (H0 // 512 + 1, W0 // 512 + 1, 1))[:H0, :W0]
    # 1. the title and the Join line out (source y 1715..1985, x 30..1350): fill from the dark around it, then grain
    m = np.zeros((H0, W0), np.uint8); m[1715:1985, 30:1350] = 1
    known = cv2.dilate(m, np.ones((15, 15), np.uint8)) == 0
    fill2 = pb.pullpush(im, known) + grain * 0.9
    fm = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 3)[..., None]
    im = im * (1 - fm) + fill2 * fm
    # 2. the cab out: right of x = 1090. Sky rows: a clean strip right of the dot's halo; lower rows: the strip left of the mirror arms
    up = im[:, 1110:1170].mean(1); lo = im[:, 1000:1090].mean(1)
    row = np.where((np.arange(H0) < 800)[:, None], up, lo)
    row = cv2.GaussianBlur(row[:, None, :].astype(np.float32), (0, 0), 3)[:, 0, :] if False else row
    fill = np.repeat(row[:, None, :], W0 - 1090, 1) + grain[:, :W0 - 1090] * 0.9
    im[:, 1090:] = fill
    # feather the seam: blend the original into the fill over source x 1060..1160 where the original is still clean sky (rows < 800) or ground
    for i in range(100):
        t = i / 100.0; x = 1060 + i
        ref = np.where((np.arange(H0) < 800)[:, None], im[:, 1170][:, :] , im[:, 1090][:, :])
        im[:, x] = np.where((np.arange(H0) < 800)[:, None], im[:, x] * (1 - t) + ref * t, im[:, x])
    # 3. crop and extend the sky upward
    CX0, CW, PAD = 240, 1350, 352
    crop = im[:, CX0:CX0 + CW]
    top = cv2.GaussianBlur(crop[:20].mean(0)[None].repeat(3, 0), (0, 0), 8)[0]
    ext = np.zeros((PAD, CW, 3), np.float32)
    for r in range(PAD): ext[r] = top * (1.0 - 0.06 * (1 - r / PAD))
    ext += np.random.RandomState(9).randn(PAD, CW, 1).astype(np.float32) * 2.2
    return np.clip(np.vstack([ext, crop]), 0, 255).astype(np.uint8)


def trucker_wide(img=None):
    """The client's poster as a 9:16 plate WIDE enough to hold the man and the truck: the real cab and trailer are painted out to
    sky and ground (the model takes their place), the baked title and mark are painted out, and the sky is extended upward. The
    man is the matte. 1350 x 2400 (9:16): source x 240..1590, source y -352..2048."""
    od = os.path.join(OUT, 'trucker_wide'); t0 = time.time(); CX0, CW, PAD = 240, 1350, 352
    if img is None: img = wide_image()
    else: img = cv2.imread(img)
    Hn, Wn = img.shape[:2]
    spec = dict(box=[0, 1300, 1000, Hn], band=4)
    a = pb.mattes([img], spec)[0]
    dm, dinfo = pb.depths([img])
    cl, cd = pb.clean_plate([img], [a], [dm[0]])
    meta = dict(name='trucker_wide', source='acp_own_the_future.jpg', licence="Client's own poster art (acp_own_the_future.jpg), supplied by the ACP organizer for ACP use",
                note='the poster widened to 9:16 with the real cab and trailer painted out to sky and ground, the title and mark painted out, the sky extended upward; the man is the matte',
                crop=[CX0, -PAD, CW, Hn], size=[Wn, Hn], frames=1, fps=None, still=True, depth_model='Depth Anything V2 Small fp16 ONNX (Apache-2.0)',
                matte='roto BiRefNet-lite + guided band refine', baked=time.strftime('%Y-%m-%d %H:%M'), bake_s=round(time.time() - t0, 1), depth_norm=dinfo,
                horizon_px=[1640 + PAD], dot_px=[757 + 0, 220 + PAD], mirror_px=[1180 - CX0, 1180 + PAD])
    os.makedirs(od, exist_ok=True)
    cv2.imwrite(os.path.join(od, 'color.jpg'), roto.decontaminate(img, a), [cv2.IMWRITE_JPEG_QUALITY, 95])
    cv2.imwrite(os.path.join(od, 'alpha.png'), np.clip(a * 255 + .5, 0, 255).astype(np.uint8))
    cv2.imwrite(os.path.join(od, 'depth.png'), pb.half(np.clip(dm[0] * 255 + .5, 0, 255).astype(np.uint8)))
    cv2.imwrite(os.path.join(od, 'normal.png'), pb.half(pb.normal_map(dm[0])))
    cv2.imwrite(os.path.join(od, 'clean.jpg'), cl, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(od, 'clean_depth.png'), pb.half(np.clip(cd * 255 + .5, 0, 255).astype(np.uint8)))
    cv2.imwrite(os.path.join(od, 'clean_normal.png'), pb.half(pb.normal_map(cd)))
    json.dump([pb.subj_info(a, dm[0])], open(os.path.join(od, 'subj.json'), 'w')); json.dump(meta, open(os.path.join(od, 'meta.json'), 'w'), indent=1)
    print('trucker_wide baked', meta['bake_s'], 's')


def steel_rod(src='footage/steel_2425.mp4', t0=14.3, t1=18.3, crop=(0, 0, 1440, 1080)):
    od = os.path.join(OUT, 'steel_rod'); os.makedirs(od, exist_ok=True); tt = time.time()
    cap = cv2.VideoCapture(os.path.join(SRC, src)); fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t0 * fps))); n = int(round((t1 - t0) * fps)); fr = []
    x, y, w, h = crop
    for _ in range(n):
        ok, im = cap.read()
        if not ok: break
        fr.append(im[y:y + h, x:x + w].copy())
    cap.release(); n = len(fr)
    dm, dinfo = pb.depths(fr)
    glow = []
    for i, f in enumerate(fr):
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        r = f[..., 2].astype(np.float32) / 255
        hot = np.clip((g - 0.72) / 0.28, 0, 1) * np.clip((r - 0.7) / 0.3, 0, 1)
        s = hot.sum()
        if s > 20:
            ys, xs = np.mgrid[0:h, 0:w]; cx = float((hot * xs).sum() / s) / w; cy = float((hot * ys).sum() / s) / h
        else: cx, cy = 0.5, 0.3
        glow.append([round(cx, 4), round(cy, 4), round(float(hot.mean()), 5), round(float(g.mean()), 4)])
        cv2.imwrite(os.path.join(od, f'color_{i:03d}.jpg'), f, [cv2.IMWRITE_JPEG_QUALITY, 93])
        cv2.imwrite(os.path.join(od, f'depth_{i:03d}.png'), pb.half(np.clip(dm[i] * 255 + .5, 0, 255).astype(np.uint8)))
        cv2.imwrite(os.path.join(od, f'normal_{i:03d}.png'), pb.half(pb.normal_map(dm[i])))
        cv2.imwrite(os.path.join(od, f'alpha_{i:03d}.png'), np.zeros((h, w), np.uint8))
    cl = np.median(np.stack(fr), 0).astype(np.uint8)
    cv2.imwrite(os.path.join(od, 'clean.jpg'), cl, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(od, 'clean_depth.png'), pb.half(np.clip(np.median(np.stack(dm), 0) * 255 + .5, 0, 255).astype(np.uint8)))
    cv2.imwrite(os.path.join(od, 'clean_normal.png'), pb.half(pb.normal_map(np.median(np.stack(dm), 0))))
    json.dump(glow, open(os.path.join(od, 'glow.json'), 'w'))
    json.dump([None] * n, open(os.path.join(od, 'subj.json'), 'w'))
    meta = dict(name='steel_rod', source=src, licence="Steel: Man's Servant (1938), NFPF, Public Domain Mark 1.0",
                note='depth-only film plate (no matte); glow.json = [cx, cy, hot area, mean luma] per frame', tc='see meta.t0',
                crop=list(crop), size=[w, h], frames=n, fps=fps, t0=t0, t1=t1, still=False, depth_norm=dinfo,
                baked=time.strftime('%Y-%m-%d %H:%M'), bake_s=round(time.time() - tt, 1))
    json.dump(meta, open(os.path.join(od, 'meta.json'), 'w'), indent=1)
    print('steel_rod baked', n, 'frames', meta['bake_s'], 's')


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: print(__doc__); sys.exit(0)
    kw = {}
    for k in a[1:]:
        if '=' in k: kk, v = k.split('='); kw[kk] = v if kk == 'src' else float(v)
    globals()[a[0]](**kw)
