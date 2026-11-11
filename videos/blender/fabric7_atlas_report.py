#!/usr/bin/env python3
# FABRIC7 (8 Oct, c3 iteration 1): WHAT THE GARMENT ATLAS CARRIES, IN MILLIMETRES. System python3 (numpy, scipy, PIL); no bpy; runs on the export folder of a person_job.py run after bake_post.py:
#   python3 videos/blender/fabric7_atlas_report.py <export dir (the dressed one)> <out dir> [--min-area 0.02] [--top 6]
# fabric7_job.py calls it after the job's last render and leaves the result in the job's out/ folder (atlas7/), so the lead can measure a bake the farm made without Blender or a browser here.
# Why: the first Cycles stills of rev 7 (1008-041751 / 041754) showed 3-9 mm swirls on knits that no node measure could attribute, because the atlas is baked on the farm. Per garment this writes
#   - texel_mm: millimetres of cloth per atlas texel (sqrt(3D area / UV area): the sampling grid every baked detail lives on; a thread of 0.6-0.9 mm is ~1 texel, so yarn drawn into the atlas aliases)
#   - the pattern's grain against the body: metres per UV unit along u and v (1.0 = the cut's true size), the angle between the axes (90 = no shear), and how vertical the wale axis (v) runs
#     (|cos| to the vertical, median / p10): the straight-grain check of the pattern uv Cycles lays its yarn tile on (person_scene._f6_detail)
#   - the albedo's luminance (linear) mean and std, and the std in five bands of spatial PERIOD (< 2 mm, 2-8, 8-30, 30-120 mm, > 120 mm): where the tone lives
#   - the 2-D spectrum of the albedo luminance and of the normal map's tilt on the largest clean square of the garment (Hann window): the five strongest peaks as (period in mm, direction in
#     degrees, share of the non-DC power); a knit beating against the texel grid shows as a peak at a period of several mm, never at the thread pitch
#   and the patch crops (albedo, tilt) as PNG. atlas7/atlas_report.json carries the numbers; atlas7/thumb_*.png the whole maps at 1024.
# c3 iteration 2 (8 Oct) adds three diagnostics for what the plates showed and no number could attribute:
#   overlaps   which parts' UV islands share atlas texels (rasterised per part at atlas size): a pair here paints one part's texels onto another (the grey disc on the L08 sneaker's sole wall?)
#   spots      small compact blobs in the albedo that differ from their surroundings by > 15 % (c3 it3; was 25 %, which missed the L08 sole disc at -19 / -22 %; area 8-600 texels, not a line): per spot the part that owns the texel (and any other that
#              overlaps it), its centre in atlas uv and texel, its size in mm and its mean colour; the six strongest are saved as 4x crops (spot_NN.png)
#   hem        the lowest 3.5 cm of each of the three biggest garments and of every sole: albedo and normal crops at atlas resolution (hem_*.png, sole_*.png): the stitch rows as the bake drew them,
#              so a row lost in a render can be told from a row never drawn
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from person_io import Person   # noqa: E402

BANDS_MM = [(0, 2), (2, 8), (8, 30), (30, 120), (120, 1e9)]


def srgb2lin(a):
    a = np.asarray(a, dtype=np.float32) / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def tri_stats(P, T, U, S):
    """per-triangle 3D area (m2), UV area in texels2, and the pattern axes' directions: returns dict"""
    p0, p1, p2 = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    a3 = 0.5 * np.linalg.norm(np.cross(p1 - p0, p2 - p0), axis=1)
    au = 0.5 * np.abs((U[:, 1, 0] - U[:, 0, 0]) * (U[:, 2, 1] - U[:, 0, 1]) - (U[:, 2, 0] - U[:, 0, 0]) * (U[:, 1, 1] - U[:, 0, 1])) * S * S
    return a3, au


def pattern_axes(P, T, UV):
    """metres per pattern-uv unit along u and v, the angle between the axes (deg) and |cos| of each axis to the vertical (z), per triangle (degenerate ones dropped)"""
    p0, p1, p2 = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    e1, e2 = p1 - p0, p2 - p0
    d1, d2 = UV[T[:, 1]] - UV[T[:, 0]], UV[T[:, 2]] - UV[T[:, 0]]
    det = d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]
    ok = np.abs(det) > 1e-12
    Pu = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2])[ok] / det[ok, None]
    Pv = (e2 * d1[:, 0:1] - e1 * d2[:, 0:1])[ok] / det[ok, None]
    lu, lv = np.linalg.norm(Pu, axis=1), np.linalg.norm(Pv, axis=1)
    good = (lu > 1e-6) & (lv > 1e-6)
    Pu, Pv, lu, lv = Pu[good], Pv[good], lu[good], lv[good]
    ang = np.degrees(np.arccos(np.clip((Pu * Pv).sum(1) / (lu * lv), -1, 1)))
    return lu, lv, ang, np.abs(Pu[:, 2]) / lu, np.abs(Pv[:, 2]) / lv


def pct(a, q):
    return [round(float(x), 4) for x in np.percentile(a, q)] if len(a) else None


def masked_blur(x, m, sigma):
    """gaussian low-pass of x over the mask (normalised convolution), sigma in texels; large sigmas on a block-mean pyramid (a 4096 px atlas with a 60 mm sigma would take minutes)"""
    k = 1
    while sigma / k > 6 and x.shape[0] % (k * 2) == 0:
        k *= 2
    if k == 1:
        return ndimage.gaussian_filter(x * m, sigma, mode='constant') / np.maximum(ndimage.gaussian_filter(m, sigma, mode='constant'), 1e-4)
    H, W = x.shape[0] // k, x.shape[1] // k
    num = (x * m).reshape(H, k, W, k).sum((1, 3)); den = m.reshape(H, k, W, k).sum((1, 3))
    low = ndimage.gaussian_filter(num, sigma / k, mode='constant') / np.maximum(ndimage.gaussian_filter(den, sigma / k, mode='constant'), 1e-4)
    return ndimage.zoom(low, k, order=1)


def band_stds(lum, mask, texel_mm):
    """std of the luminance in the cloth-scale bands, over the mask (normalised convolution: no edge leakage)"""
    m = mask.astype(np.float32)
    edges = [b[1] for b in BANDS_MM[:-1]]                               # 2, 8, 30, 120 mm of PERIOD: a Gaussian of sigma s passes half the amplitude at a period of 5.34 s, so sigma = edge / 5.34
    lows = [lum] + [masked_blur(lum, m, max(e / 5.34 / texel_mm, 0.3)) for e in edges]
    out = {}
    for i, (a, b) in enumerate(BANDS_MM):
        band = lows[i] - (lows[i + 1] if i + 1 < len(lows) else 0.0)
        out[f'{a:g}-{b:g}mm' if b < 1e8 else f'{a:g}-infmm'] = round(float(band[mask].std()), 5)
    return out


def peaks(patch, texel_mm, k=5):
    """the k strongest peaks of the windowed 2-D power spectrum: (period mm, direction deg of the wave vector from the atlas u axis, share of the non-DC power)"""
    n = patch.shape[0]
    w = np.hanning(n)[:, None] * np.hanning(n)[None, :]
    a = (patch - patch.mean()) * w
    F = np.fft.fftshift(np.abs(np.fft.fft2(a)) ** 2)
    c = n // 2
    F[c - 1:c + 2, c - 1:c + 2] = 0.0                       # DC and its leakage
    tot = max(F.sum(), 1e-20)
    G = ndimage.maximum_filter(F, size=5)
    cand = np.argwhere((F == G) & (F > 0))
    cand = sorted(cand, key=lambda ij: -F[ij[0], ij[1]])[:2 * k]
    out = []
    for iy, ix in cand:
        fx, fy = (ix - c) / n, (iy - c) / n                 # cycles per texel
        if fy < 0 or (fy == 0 and fx < 0):                  # the spectrum of a real image is symmetric: one of each pair
            continue
        f = float(np.hypot(fx, fy))
        if f <= 0:
            continue
        out.append(dict(period_mm=round(texel_mm / f, 2), dir_deg=round(float(np.degrees(np.arctan2(fy, fx)) % 180), 1), share=round(float(F[iy, ix] / tot), 4)))
    # the radial distribution: share of the power at periods below 1.5 mm, 1.5-4, 4-12, 12-40, above (mm)
    yy, xx = np.indices(F.shape); r = np.hypot(yy - c, xx - c) / n
    per = np.where(r > 0, texel_mm / np.maximum(r, 1e-9), 1e9)
    rad = {}
    for a_, b_ in ((0, 1.5), (1.5, 4), (4, 12), (12, 40), (40, 1e9)):
        rad[f'{a_:g}-{b_:g}mm' if b_ < 1e8 else f'{a_:g}-infmm'] = round(float(F[(per >= a_) & (per < b_)].sum() / tot), 4)
    return out[:k], rad


def diagnostics(rep, G, idx, guv, pp, alb, nrm, lum, S, out, rows):
    """overlaps of UV islands, spots in the albedo, hem and sole crops (see the header)"""
    n = min(len(G), len(idx))
    owner = np.full((S, S), -1, dtype=np.int16)
    pairs = {}
    boxes = {}
    for i in range(n):
        e, r = idx[i], G[i]
        T = pp.arr(r['index'], 3)
        U = guv[e['corner']:e['corner'] + e['corners']].reshape(-1, 3, 2).astype(np.float64)
        if len(U) != len(T):
            continue
        im = Image.new('L', (S, S), 0); dr = ImageDraw.Draw(im)
        for t in U:
            dr.polygon([(q[0] * S, (1 - q[1]) * S) for q in t], fill=255)
        m = np.asarray(im) > 0
        if not m.any():
            continue
        ys, xs = np.where(m.any(1))[0], np.where(m.any(0))[0]
        boxes[i] = (int(xs[0]), int(ys[0]), int(xs[-1]) + 1, int(ys[-1]) + 1)
        hit = m & (owner >= 0)
        if hit.any():
            for o, c in zip(*np.unique(owner[hit], return_counts=True)):
                pairs[(int(o), i)] = int(c)
        owner[m & (owner < 0)] = i
    names = [r['name'] for r in G]
    texel = {row['i']: row.get('texel_mm') for row, _, _ in rows}
    rep['overlaps'] = [dict(a=names[a], b=names[b], texels=c, mm2=round(c * ((texel.get(a) or texel.get(b) or 0.55) ** 2), 2)) for (a, b), c in sorted(pairs.items(), key=lambda kv: -kv[1])[:30]]
    # spots: compact blobs that differ from their surroundings
    core = owner >= 0
    low = masked_blur(lum, core.astype(np.float32), 6.0)
    rel = (lum - low) / (low + 0.02)
    cand = (np.abs(rel) > 0.15) & ndimage.binary_erosion(core, iterations=3)
    lab, nl = ndimage.label(cand)
    spots = []
    if nl:
        sl = ndimage.find_objects(lab)
        areas = ndimage.sum(cand, lab, index=np.arange(1, nl + 1))
        for k, (s_, a_) in enumerate(zip(sl, areas)):
            if not (8 <= a_ <= 600):
                continue
            h, w = s_[0].stop - s_[0].start, s_[1].stop - s_[1].start
            if max(h, w) > 3 * max(min(h, w), 1) or max(h, w) > 40:
                continue                                                           # a line (a stitch row, a seam), not a spot
            yy, xx = np.where(lab[s_] == k + 1); cy, cx = int(yy.mean()) + s_[0].start, int(xx.mean()) + s_[1].start
            o = int(owner[cy, cx]); c = alb[cy, cx].tolist()
            tm = texel.get(o) or 0.55
            others = sorted({a for (a, b), c_ in pairs.items() if b == o and boxes.get(a) and boxes[a][0] <= cx < boxes[a][2] and boxes[a][1] <= cy < boxes[a][3]} | {b for (a, b), c_ in pairs.items() if a == o and boxes.get(b) and boxes[b][0] <= cx < boxes[b][2] and boxes[b][1] <= cy < boxes[b][3]})
            spots.append(dict(part=names[o] if o >= 0 else None, uv=[round(cx / S, 4), round(1 - cy / S, 4)], texel=[cx, cy], area_texels=int(a_), diameter_mm=round(float(2 * np.sqrt(a_ / np.pi)) * tm, 2), rgb=c, rel_contrast=round(float(rel[lab == k + 1].mean()), 3), overlaps_with=[names[x] for x in others][:4]))
    spots.sort(key=lambda d: -abs(d['rel_contrast']) * d['area_texels'])
    rep['spots'] = spots[:40]; rep['spots_total'] = len(spots)
    for j, sp in enumerate(spots[:6]):
        cx, cy = sp['texel']; x0, y0 = max(cx - 32, 0), max(cy - 32, 0)
        Image.fromarray(alb[y0:y0 + 64, x0:x0 + 64]).resize((256, 256), Image.NEAREST).save(os.path.join(out, f'spot_{j:02d}.png'))
    # hem and sole crops
    big = sorted([(row['area_m2'], row['i']) for row, _, _ in rows], reverse=True)[:3]
    want = [(i, 'hem') for _, i in big] + [(i, 'sole') for i in range(n) if '.sole.' in names[i]]
    for i, kind in want:
        if i not in boxes:
            continue
        r = G[i]; e = idx[i]; P = pp.arr(r['position'], 3).astype(np.float64); T = pp.arr(r['index'], 3)
        U = guv[e['corner']:e['corner'] + e['corners']].reshape(-1, 3, 2).astype(np.float64)
        if len(U) != len(T):
            continue
        sel = np.ones(len(T), bool)
        if kind == 'hem':
            zc = P[T].mean(1)[:, 2]; sel = zc < zc.min() + 0.035
        if not sel.any():
            continue
        Us = U[sel].reshape(-1, 2); xs, ys = Us[:, 0] * S, (1 - Us[:, 1]) * S
        x0, x1, y0, y1 = int(max(xs.min() - 6, 0)), int(min(xs.max() + 6, S)), int(max(ys.min() - 6, 0)), int(min(ys.max() + 6, S))
        if x1 - x0 > 768:
            c = (x0 + x1) // 2; x0, x1 = c - 384, c + 384
        if y1 - y0 > 768:
            c = (y0 + y1) // 2; y0, y1 = c - 384, c + 384
        x0, y0 = max(x0, 0), max(y0, 0)
        nm = f"{kind}_{i:02d}_{names[i].replace('/', '_')}"
        Image.fromarray(alb[y0:y1, x0:x1]).save(os.path.join(out, nm + '_albedo.png'))
        if nrm is not None:
            Image.fromarray(nrm[y0:y1, x0:x1]).save(os.path.join(out, nm + '_normal.png'))
        rep.setdefault('crops', []).append(dict(file=nm, part=names[i], box_texels=[x0, y0, x1, y1], texel_mm=texel.get(i)))


def main():
    args = sys.argv[1:]
    d, out = args[0], args[1]
    opt = lambda k, dflt: type(dflt)(args[args.index('--' + k) + 1]) if '--' + k in args else dflt
    min_area, top = opt('min-area', 0.02), opt('top', 6)
    os.makedirs(out, exist_ok=True)
    pp = Person(d); m = pp.m
    maps = os.path.join(d, 'maps')
    alb_p, nrm_p = os.path.join(maps, 'cloth_albedo.png'), os.path.join(maps, 'cloth_normal.png')
    gj, gb = os.path.join(d, 'garment_uv.json'), os.path.join(d, 'garment_uv.bin')
    if not (os.path.exists(alb_p) and os.path.exists(gj) and os.path.exists(gb)):
        json.dump({'error': 'no garment atlas in ' + d}, open(os.path.join(out, 'atlas_report.json'), 'w'))
        print('atlas report: no garment atlas'); return
    alb = np.asarray(Image.open(alb_p).convert('RGB')); S = alb.shape[0]
    nrm = np.asarray(Image.open(nrm_p).convert('RGB')) if os.path.exists(nrm_p) else None
    idx = json.load(open(gj)); guv = np.fromfile(gb, dtype=np.float32).reshape(-1, 2)
    G = [r for r in m['meshes'][1:] if r.get('kind') == 'garment']
    lum = (0.2126 * srgb2lin(alb[..., 0]) + 0.7152 * srgb2lin(alb[..., 1]) + 0.0722 * srgb2lin(alb[..., 2]))
    f6 = {}
    try:
        f6 = json.load(open(os.path.join(d, 'fabric6.json')))
    except Exception:
        pass
    rep = dict(atlas_px=S, version7=f6.get('version7'), atlas7=f6.get('atlas7'), garments=[])
    rows = []
    for i, (r, e) in enumerate(zip(G, idx)):
        P = pp.arr(r['position'], 3).astype(np.float64); T = pp.arr(r['index'], 3)
        U = guv[e['corner']:e['corner'] + e['corners']].reshape(-1, 3, 2).astype(np.float64)
        if len(U) != len(T):
            continue
        a3, au = tri_stats(P, T, U, S)
        area = float(a3.sum())
        row = dict(i=i, name=r['name'], fabric=r.get('fabric'), tris=int(len(T)), area_m2=round(area, 4))
        if area >= min_area and au.sum() > 0:
            row['texel_mm'] = round(1000 * float(np.sqrt(area / au.sum())), 3)
            tm = 1000 * np.sqrt(a3 / np.maximum(au, 1e-9)); row['texel_mm_p10_p90'] = pct(tm, [10, 90])
        if 'uv' in r and area >= min_area:
            lu, lv, ang, cu, cv = pattern_axes(P, T, pp.arr(r['uv'], 2).astype(np.float64))
            row['grain'] = dict(m_per_uv_u=pct(lu, [10, 50, 90]), m_per_uv_v=pct(lv, [10, 50, 90]), axes_angle_deg=pct(ang, [10, 50, 90]), wale_v_abs_cos_vertical=pct(cv, [10, 50, 90]), course_u_abs_cos_vertical=pct(cu, [10, 50, 90]))
        rows.append((row, U, area))
    # the biggest garments get the full spectrum treatment
    big = sorted([x for x in rows if 'texel_mm' in x[0]], key=lambda x: -x[2])[:top]
    for row, U, area in rows:
        if any(row is b[0] for b in big):
            msk = Image.new('L', (S, S), 0); dr = ImageDraw.Draw(msk)
            for t in U:
                dr.polygon([(q[0] * S, (1 - q[1]) * S) for q in t], fill=255)
            mask = np.asarray(msk) > 0
            core = ndimage.binary_erosion(mask, iterations=4)
            if core.sum() < 2000:
                core = mask
            tm = row['texel_mm']
            row['texels'] = int(mask.sum()); row['lum_mean'] = round(float(lum[core].mean()), 4); row['lum_std'] = round(float(lum[core].std()), 5)
            row['lum_bands_std'] = band_stds(lum, core, tm)
            dist = ndimage.distance_transform_edt(core); cy, cx = np.unravel_index(int(dist.argmax()), dist.shape); half = int(min(dist.max(), 256))
            if half >= 48:
                n = 2 * half; y0, x0 = max(cy - half, 0), max(cx - half, 0); sl = (slice(y0, y0 + n), slice(x0, x0 + n))
                pk, rad = peaks(lum[sl], tm); row['patch'] = dict(px=n, mm=round(n * tm, 1), centre_uv=[round(cx / S, 3), round(1 - cy / S, 3)], lum_peaks=pk, lum_power_by_period=rad)
                nm = f"{row['i']:02d}_{row['name'].replace('/', '_')}"
                Image.fromarray(alb[sl]).save(os.path.join(out, f'patch_albedo_{nm}.png'))
                if nrm is not None:
                    tx, ty = (nrm[sl][..., 0].astype(np.float32) - 127.5) / 127.5, (nrm[sl][..., 1].astype(np.float32) - 127.5) / 127.5
                    pk2, rad2 = peaks(tx, tm); pk3, rad3 = peaks(ty, tm)
                    row['patch']['normal_x_peaks'] = pk2; row['patch']['normal_y_peaks'] = pk3; row['patch']['normal_power_by_period'] = rad2
                    row['patch']['tilt_std'] = round(float(np.hypot(tx, ty).std()), 5); row['patch']['tilt_mean'] = round(float(np.hypot(tx, ty).mean()), 5)
                    t8 = np.clip(np.hypot(tx, ty) * 4.0 * 255, 0, 255).astype(np.uint8)       # tilt x 4 as a grey image: relief at a glance
                    Image.fromarray(t8).save(os.path.join(out, f'patch_tilt_{nm}.png'))
        rep['garments'].append(row)
    try:
        diagnostics(rep, G, idx, guv, pp, alb, nrm, lum, S, out, rows)
    except Exception as e:   # a diagnostic never fails the report
        rep['diagnostics_error'] = repr(e); print('atlas report: diagnostics failed:', repr(e))
    json.dump(rep, open(os.path.join(out, 'atlas_report.json'), 'w'), indent=1)
    Image.fromarray(alb).resize((1024, 1024), Image.LANCZOS).save(os.path.join(out, 'thumb_albedo.png'))
    if nrm is not None:
        Image.fromarray(nrm).resize((1024, 1024), Image.LANCZOS).save(os.path.join(out, 'thumb_normal.png'))
    for g in rep['garments']:
        print('atlas report: %-24s %-12s %.3f m2  texel %s mm  %s' % (g['name'], g.get('fabric'), g['area_m2'], g.get('texel_mm'), ('lum std %s' % g['lum_std']) if 'lum_std' in g else ''))


if __name__ == '__main__':
    main()
