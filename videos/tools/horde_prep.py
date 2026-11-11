"""HORDE v7 prep: per-shot median plates, difference mattes, rider-cel atlas, far-ridge strip.

    python3 tools/horde_prep.py          -> web/assets/horde/{plate_A,plate_B,plate_C,plain}.jpg,
                                            atlas.png, cels.json, ridge.png, diag.jpg

The client's own red riders footage is the only source. Frames are 0-indexed here
(file NNNN.jpg = index + 1), like horde.js.
"""
import json, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'web', 'assets', 'riders')
OUT = os.path.join(HERE, '..', 'web', 'assets', 'horde')
os.makedirs(OUT, exist_ok=True)
SHOTS = {'A': (16, 82), 'B': (90, 166), 'C': (406, 488)}
CEL_SHOTS = ('A', 'B')     # shot C's riders sit below its horizon: plate only
CEL = 512          # atlas cel size (px): 512 so the foreground ranks and cycle A stay sharp at 720p
FS = 2             # mattes are computed at 540x960; the cels are cut from the full-res 1080x1920 frame
PER_SHOT = 14      # cels per gallop cycle


def load(i, scale=1):
    im = Image.open(os.path.join(SRC, f'{i + 1:04d}.jpg')).convert('RGB')
    if scale != 1: im = im.resize((im.width // scale, im.height // scale), Image.BILINEAR)
    return np.asarray(im, dtype=np.uint8)


def draw_horse(box, cx, gy, U, ph):
    """A galloping horse silhouette under the footage rider: alpha (uint8, box x box), x forward."""
    from PIL import ImageDraw
    import math
    S = 4
    im = Image.new('L', (box * S, box * S), 0); d = ImageDraw.Draw(im)
    bob = 0.04 * U * math.sin(2 * math.pi * ph * 2)
    P = lambda x, y: ((cx + x * U) * S, (gy - y * U - bob) * S)
    def ell(x, y, rx, ry):
        (a, b), (c, e) = P(x - rx, y + ry), P(x + rx, y - ry); d.ellipse([a, b, c, e], fill=255)
    ell(0, 0.8, 0.6, 0.2); ell(0.44, 0.76, 0.22, 0.21); ell(-0.48, 0.82, 0.24, 0.21)
    d.polygon([P(0.36, 0.95), P(0.6, 0.7), P(0.95, 1.08), P(0.8, 1.22)], fill=255)      # neck, stretched forward
    d.polygon([P(0.78, 1.2), P(0.9, 1.26), P(1.2, 1.02), P(1.15, 0.94), P(0.92, 1.0)], fill=255)   # head
    d.polygon([P(0.78, 1.18), P(0.8, 1.34), P(0.88, 1.2)], fill=255)                    # ear
    d.polygon([P(-0.62, 0.95), P(-1.0, 1.0), P(-1.12, 0.82), P(-0.66, 0.8)], fill=255)  # tail streaming
    d.polygon([P(0.5, 1.12), P(0.2, 1.05), P(0.1, 0.98), P(0.46, 1.0)], fill=255)        # mane
    for hx, hy, off, fore in [(-0.46, 0.74, 0.0, 0), (-0.4, 0.74, 0.12, 0), (0.44, 0.7, 0.5, 1), (0.5, 0.7, 0.62, 1)]:
        phi = 2 * math.pi * (ph + off)
        th = 0.62 * math.sin(phi)
        kap = 1.3 * max(0.0, math.sin(phi + 1.7))
        L1, L2 = 0.36, 0.42
        kx, ky = hx + L1 * math.sin(th), hy - L1 * math.cos(th)
        th2 = th - kap if fore else th + 0.6 * kap
        fx, fy = kx + L2 * math.sin(th2), ky - L2 * math.cos(th2)
        fy = max(fy, 0.0)
        d.line([P(hx, hy), P(kx, ky)], fill=255, width=int(0.13 * U * S))
        d.line([P(kx, ky), P(fx, fy)], fill=255, width=int(0.065 * U * S))
        ell(fx, fy + 0.02, 0.05, 0.035)
    im = im.resize((box, box), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    a = ndi.uniform_filter1d(a, size=max(3, int(U * 0.12)), axis=1)             # motion blur, like the footage
    a = ndi.gaussian_filter(a, 0.8)
    return np.clip(a, 0, 255).astype(np.uint8)


def draw_rider(box, cx, gy, U, ph, seed):
    """The rider seated on draw_horse's back: a forward-leaning torso, a pointed steppe helmet, a cloak streaming
    behind and a raised sabre arm (alpha, box x box). The footage supplies the texture and the motion trail."""
    from PIL import ImageDraw
    import math
    S = 4
    im = Image.new('L', (box * S, box * S), 0); d = ImageDraw.Draw(im)
    bob = 0.04 * U * math.sin(2 * math.pi * ph * 2)
    P = lambda x, y: ((cx + x * U) * S, (gy - y * U - bob) * S)
    def ell(x, y, rx, ry):
        (a, b), (c, e) = P(x - rx, y + ry), P(x + rx, y - ry); d.ellipse([a, b, c, e], fill=255)
    lean = 0.06 * math.sin(2 * math.pi * ph)
    hip, sh = (-0.04, 1.0), (0.14 + lean, 1.46)
    d.polygon([P(hip[0] - 0.1, hip[1] - 0.02), P(hip[0] + 0.12, hip[1] - 0.02), P(sh[0] + 0.1, sh[1]), P(sh[0] - 0.11, sh[1] + 0.02)], fill=255)   # torso
    d.line([P(hip[0] + 0.02, hip[1]), P(0.1, 0.8), P(0.06, 0.68)], fill=255, width=int(0.09 * U * S))                # thigh and boot
    ell(sh[0] + 0.03, sh[1] + 0.13, 0.085, 0.095)                                                                   # head
    d.polygon([P(sh[0] - 0.07, sh[1] + 0.17), P(sh[0] + 0.13, sh[1] + 0.17), P(sh[0] + 0.02, sh[1] + 0.38)], fill=255)   # pointed helmet
    d.polygon([P(sh[0] - 0.1, sh[1] + 0.18), P(sh[0] + 0.15, sh[1] + 0.18), P(sh[0] + 0.14, sh[1] + 0.14), P(sh[0] - 0.12, sh[1] + 0.13)], fill=255)  # fur brim
    w = math.sin(2 * math.pi * (ph * 2 + seed))
    d.polygon([P(sh[0] - 0.08, sh[1] + 0.02), P(-0.55, 1.42 + 0.08 * w), P(-0.78, 1.26 - 0.06 * w), P(-0.5, 1.12 + 0.05 * w), P(hip[0] - 0.05, hip[1] + 0.12)], fill=255)   # cloak
    if seed < 0.5:                                                                                                   # sabre raised
        hand = (sh[0] + 0.3, sh[1] + 0.3 + 0.05 * w)
        d.line([P(sh[0], sh[1] - 0.02), P(sh[0] + 0.2, sh[1] + 0.1), P(*hand)], fill=255, width=int(0.07 * U * S))
        d.line([P(*hand), P(hand[0] - 0.12, hand[1] + 0.42), P(hand[0] - 0.3, hand[1] + 0.62)], fill=255, width=max(2, int(0.035 * U * S)))
    else:                                                                                                            # rein arm forward, low
        d.line([P(sh[0], sh[1] - 0.02), P(sh[0] + 0.22, sh[1] - 0.2), P(0.5, 1.12)], fill=255, width=int(0.07 * U * S))
    im = im.resize((box, box), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    a = ndi.uniform_filter1d(a, size=max(3, int(U * 0.06)), axis=1)
    return np.clip(ndi.gaussian_filter(a, 0.6), 0, 255).astype(np.uint8)


def lum(a): return a[..., 0] * 0.6 + a[..., 1] * 0.3 + a[..., 2] * 0.1   # the footage is nearly all red


def main():
    plates, cels, meta, boxes = {}, [], [], {}
    for name, (a, b) in SHOTS.items():
        fr = np.stack([load(i) for i in range(a, b + 1)])
        plate = np.median(fr, axis=0).astype(np.uint8)
        plates[name] = plate
        Image.fromarray(plate).save(os.path.join(OUT, f'plate_{name}.jpg'), quality=92)
        # rider matte: each frame against its own row-wise background (a wide horizontal median), so the
        # handheld drift of the source does not matter; riders are local dark blobs in horizontal bands
        scored = []
        for k in range(len(fr)):
            f = np.asarray(Image.fromarray(fr[k]).resize((540, 960), Image.BILINEAR)).astype(np.float32)
            L = ndi.uniform_filter(lum(f), 3)
            bg = ndi.uniform_filter(ndi.median_filter(L, size=(1, 241), mode='reflect'), (9, 1))
            d = np.clip(bg - L, 0, None) / np.maximum(bg, 8)
            m = np.clip((d - 0.10) / 0.16, 0, 1)
            m[:120] = 0; m[860:] = 0
            lab, n = ndi.label(ndi.binary_dilation(m > 0.35, iterations=6))
            if n == 0: continue
            sizes = ndi.sum(m > 0.35, lab, range(1, n + 1))
            j = int(np.argmax(sizes)) + 1
            comp = lab == j
            ys, xs = np.nonzero(comp & (m > 0.35))
            if sizes[j - 1] < 1200 or ys.max() - ys.min() < 90: continue
            scored.append((k, sizes[j - 1], xs.mean(), ys.min(), ys.max(), xs.min(), xs.max(), m, comp))
        for sc_ in scored:            # rider bbox per frame, full-res coords (leaps and the hook crop by these)
            k_, _, cx_, y0_, y1_, x0_, x1_ = sc_[:7]
            boxes[str(a + k_)] = [int(x0_ * FS), int(y0_ * FS), int(x1_ * FS), int(y1_ * FS)]
        if not scored or name not in CEL_SHOTS: continue
        ok = [s for s in scored if s[5] > 20 and s[6] < 520]
        best, run = [], []
        for s in ok:
            if run and s[0] != run[-1][0] + 1: run = []
            run.append(s)
            if len(run) > len(best): best = list(run)
        pick = best[:PER_SHOT] if len(best) >= PER_SHOT else sorted(ok, key=lambda s: -s[1])[:PER_SHOT]
        pick.sort(key=lambda s: s[0])
        # the footage keys the rider cleanly against the sky, and loses the horse against the dark plain:
        # keep the footage above the horizon and rebuild the horse beneath it, galloping, motion-blurred
        Lp = lum(np.asarray(Image.fromarray(plate).resize((540, 960))).astype(np.float32)).mean(axis=1)
        gp = np.convolve(np.diff(Lp), np.ones(5) / 5, 'same')
        hr = int(np.argmin(gp[350:620]) + 350)
        for j, s in enumerate(pick):
            k, _, cx, y0, y1, x0, x1, m, comp = s
            f0 = np.asarray(Image.fromarray(fr[k]).resize((540, 960), Image.BILINEAR)).astype(np.float32)
            L0 = lum(f0)
            bg0 = ndi.uniform_filter(ndi.median_filter(L0, size=(1, 241), mode='reflect'), (9, 1))
            dd = np.clip(bg0 - L0, 0, None) / np.maximum(bg0, 8)
            win = ndi.gaussian_filter(ndi.binary_dilation(comp, iterations=14).astype(np.float32), 6)
            al = np.clip((dd - 0.05) / 0.30, 0, 1) ** 0.8 * np.clip(win * 1.4, 0, 1)
            rows = np.arange(960)[:, None]
            al = al * np.clip((hr + 8 - rows) / 10, 0, 1)                 # rider only: above the horizon
            cols_ = np.arange(540)[None, :]
            al = al * np.exp(-((cols_ - cx) / 55.0) ** 2)                  # one rider, not the ridge behind him
            ys, xs = np.nonzero((al > 0.4) & comp)
            if len(ys) < 50: ys, xs = np.array([hr - 60, hr]), np.array([int(cx), int(cx)])
            yt = ys.min(); cxr = xs.mean()
            T = max(20, hr - yt)
            U = float(np.clip((0.62 if name == 'A' else 0.8) * T, 30, 110))
            al = al * np.exp(-((cols_ - cxr) / (0.42 * U)) ** 2 * 0.5)
            wy = hr + 0.1 * U; gy = wy + 0.78 * U / 0.78
            box = int(max(gy - yt + 14, 2.6 * U))
            X0 = int(cxr - box / 2); Y0 = int(gy + 6 - box)
            # cut from the full-res frame: the alpha is upsampled, the rider pixels are native
            F = np.asarray(Image.fromarray(fr[k])).astype(np.float32)
            AL = np.asarray(Image.fromarray((al * 255).astype(np.uint8)).resize((540 * FS, 960 * FS), Image.BICUBIC)).astype(np.float32) / 255
            bx, X0f, Y0f = box * FS, X0 * FS, Y0 * FS
            sil = np.clip(F * 0.35 - 4, 0, 255)
            rgba = np.dstack([sil, AL * 255]).astype(np.uint8)
            canvas = np.zeros((bx, bx, 4), np.uint8)
            sx0, sy0 = max(0, X0f), max(0, Y0f); sx1, sy1 = min(540 * FS, X0f + bx), min(960 * FS, Y0f + bx)
            canvas[sy0 - Y0f:sy1 - Y0f, sx0 - X0f:sx1 - X0f] = rgba[sy0:sy1, sx0:sx1]
            horse = draw_horse(bx, (cxr - X0 + 0.06 * U) * FS, (gy - Y0) * FS, U * FS, j / len(pick))
            ha = horse.astype(np.float32) / 255
            ra = canvas[..., 3].astype(np.float32) / 255
            out = canvas.astype(np.float32)
            out[..., :3] = out[..., :3] * (1 - ha[..., None]) + np.array([16, 1, 3]) * ha[..., None]
            rider = draw_rider(bx, (cxr - X0 + 0.06 * U) * FS, (gy - Y0) * FS, U * FS, j / len(pick), 0.2 if name == 'A' else 0.7).astype(np.float32) / 255
            fig = np.maximum(ha, rider)
            out[..., :3] = out[..., :3] * (1 - rider[..., None]) + np.array([14, 1, 3]) * rider[..., None]
            out[..., 3] = np.maximum(ra * 0.4, fig) * 255          # the footage blob stays as a faint motion trail
            cel = Image.fromarray(out.astype(np.uint8), 'RGBA').resize((CEL, CEL), Image.LANCZOS)
            cels.append(cel)
            meta.append({'shot': name, 'frame': a + k})
        print(name, 'plate ok; run', len(best), 'cels', len(pick), 'box', box)
    # atlas
    cols = 8; rows = (len(cels) + cols - 1) // cols
    atlas = Image.new('RGBA', (cols * CEL, rows * CEL), (0, 0, 0, 0))
    for i, c in enumerate(cels): atlas.paste(c, ((i % cols) * CEL, (i // cols) * CEL))
    atlas.save(os.path.join(OUT, 'atlas.png'), optimize=True)
    groups = {}
    for i, m in enumerate(meta): groups.setdefault(m['shot'], []).append(i)
    json.dump({'cel': CEL, 'cols': cols, 'rows': rows, 'n': len(cels), 'cycles': groups, 'meta': meta, 'boxes': boxes},
              open(os.path.join(OUT, 'cels.json'), 'w'), indent=1)

    # the American plain: plate B's sky with the steppe ridge removed (a dead-flat horizon)
    p = plates['B'].astype(np.float32)
    L = lum(p)
    prof = L.mean(axis=1)
    # horizon = strongest downward luminance step in the middle band
    g = np.convolve(np.diff(prof), np.ones(9) / 9, 'same')
    hz = int(np.argmin(g[700:1250]) + 700)
    sky_end = hz - 70
    plain = p.copy()
    ref = p[sky_end - 60:sky_end]                    # the sky just above the ridge, stretched down to the line
    for y in range(sky_end, hz + 6):
        u = (y - sky_end) / (hz + 6 - sky_end)
        row = ref[int((1 - u) * 59)] * (1 + 0.25 * u)   # brighten into the horizon glow
        plain[y] = np.clip(row, 0, 255)
    Image.fromarray(plain.astype(np.uint8)).save(os.path.join(OUT, 'plain.jpg'), quality=92)
    # the steppe ridge as a separate strip (for parallax), alpha = darker than the sky it replaces
    band = p[sky_end - 40:hz + 30]
    skyb = plain[sky_end - 40:hz + 30]
    al = np.clip((lum(skyb) - lum(band) - 4) / 20, 0, 1)
    al[-30:] = 1
    al = ndi.gaussian_filter(al, 1.5)
    ridge = np.dstack([band, al * 255]).astype(np.uint8)
    Image.fromarray(ridge, 'RGBA').save(os.path.join(OUT, 'ridge.png'))
    json.dump({'horizon': hz, 'ridgeTop': sky_end - 40, 'cels': 'cels.json'}, open(os.path.join(OUT, 'plates.json'), 'w'))
    print('horizon', hz)
    # diag
    d = Image.new('RGB', (1080, 600))
    d.paste(Image.fromarray(plates['B']).resize((270, 480)), (0, 0))
    d.paste(Image.fromarray(plain.astype(np.uint8)).resize((270, 480)), (270, 0))
    at = atlas.resize((atlas.width // 4, atlas.height // 4))
    bg = Image.new('RGB', at.size, (200, 30, 30)); bg.paste(at, (0, 0), at)
    d.paste(bg, (540, 0))
    d.save(os.path.join(OUT, 'diag.jpg'))


if __name__ == '__main__':
    main()
