#!/usr/bin/env python3
"""ARCHIVE bake: one real photograph -> a photo pack web/lib/fx/living_photo.js plays.

  python3 videos/tools/archive_bake.py butte_forsyth --src PATH.jpg --crop 0,0,6000,4150 --long 3600 \
      --credit "L. A. Huffman, Forsyth, Montana, 1894" --rights "IN COPYRIGHT - EDUCATIONAL USE PERMITTED" \
      --source-url https://www.mtmemory.org/nodes/view/72260 [--regions regions.json] [--grain-from-crop x,y,w,h]

Writes videos/web/assets/archive/<name>/
  color.jpg      the crop at the largest size the shot needs (never more than the master has; `scale` in meta.json = pack px / master px)
  depth.png      Depth Anything V2 Small (Apache-2.0, ~/.cache/acp_roto) disparity, 0 far .. 255 near, normalised by the 2nd-98th percentile,
                 blurred at face scale; half resolution (the shader samples it by uv)
  meta.json      source url, credit (the SHORT on-screen caption), rights statement verbatim, native size, scale, grain measured on the plate,
                 depth range, regions (named polygons in plate uv: steam, dust, sky, ground, type surfaces, light sources)

The point of the pack's meta: the kit can tell a scene how far a view magnifies the master (`magnification`), and the rights text
travels with the pixels. Nothing here generates or super-resolves a face; depth is only used to move the camera.
"""
import argparse, json, os, sys, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(VID, 'scripts'))
import plate_bake as pb  # noqa: E402  depth_session / depth_raw

OUT = os.path.join(VID, 'web', 'assets', 'archive')


def measure_grain(g):
    """Grain of the plate in flat areas: sigma of the high-pass at ~1.5 px against local mean, by luminance band (3 bands)."""
    g = g.astype(np.float32) / 255
    hp = g - cv2.GaussianBlur(g, (0, 0), 1.6)
    lo = cv2.GaussianBlur(g, (0, 0), 6)
    gx = np.abs(cv2.Sobel(lo, cv2.CV_32F, 1, 0)) + np.abs(cv2.Sobel(lo, cv2.CV_32F, 0, 1))
    flat = gx < np.percentile(gx, 40)
    bands = []
    for a, b in ((0, .33), (.33, .66), (.66, 1.01)):
        m = flat & (lo >= a) & (lo < b)
        bands.append(float(hp[m].std()) if m.sum() > 500 else 0.0)
    # autocorrelation length in px (how coarse the grain is)
    s = hp[:512, :512] if hp.shape[0] >= 512 and hp.shape[1] >= 512 else hp
    s = s - s.mean()
    F = np.fft.rfft2(s)
    ac = np.fft.irfft2(F * np.conj(F))
    ac /= ac[0, 0] + 1e-9
    ln = 1.0
    for k in range(1, 8):
        if ac[0, k] < .37:
            ln = float(k)
            break
    return dict(sigma_by_luma=bands, corr_px=ln)


def bake(name, src, crop=None, long_side=3600, credit='', rights='', source_url='', regions=None, note='', depth_long=1400, extra=None, native=None):
    t0 = time.time()
    im = cv2.imread(src, cv2.IMREAD_COLOR)
    H0, W0 = im.shape[:2]
    x, y, w, h = crop or (0, 0, W0, H0)
    im = im[y:y + h, x:x + w]
    k = min(1.0, long_side / max(w, h))
    pk = cv2.resize(im, (int(round(w * k)), int(round(h * k))), interpolation=cv2.INTER_AREA) if k < 1 else im
    S = pb.depth_session()
    d = pb.depth_raw(S, im if max(w, h) <= depth_long else cv2.resize(im, (int(w * depth_long / max(w, h)), int(h * depth_long / max(w, h))), interpolation=cv2.INTER_AREA), depth_long)
    lo, hi = np.percentile(d, 2), np.percentile(d, 98)
    dn = np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)
    dn = cv2.GaussianBlur(dn, (0, 0), max(2.0, 0.006 * dn.shape[0]))
    dh = cv2.resize(dn, (max(2, pk.shape[1] // 2), max(2, pk.shape[0] // 2)), interpolation=cv2.INTER_AREA)
    od = os.path.join(OUT, name)
    os.makedirs(od, exist_ok=True)
    cv2.imwrite(os.path.join(od, 'color.jpg'), pk, [cv2.IMWRITE_JPEG_QUALITY, 92])
    cv2.imwrite(os.path.join(od, 'depth.png'), (dh * 255 + .5).astype(np.uint8))
    g = cv2.cvtColor(pk, cv2.COLOR_BGR2GRAY)
    meta = dict(name=name, source=src and os.path.basename(src), source_url=source_url, credit=credit, rights_verbatim=rights, note=note,
                master_px=[W0, H0], crop_px=[x, y, w, h], pack_px=[pk.shape[1], pk.shape[0]], scale=round(k, 4),
                depth=dict(model='Depth Anything V2 Small fp16 ONNX (Apache-2.0)', lo=float(lo), hi=float(hi)),
                grain=measure_grain(g), regions=regions or {}, baked=time.strftime('%Y-%m-%d %H:%M'), bake_s=round(time.time() - t0, 1))
    if native:      # the source was a decimated copy: scale is against the true master
        meta['master_px'] = list(native); meta['scale'] = round(k * W0 / native[0], 4)
    if extra:
        meta.update(extra)
    json.dump(meta, open(os.path.join(od, 'meta.json'), 'w'), indent=1, ensure_ascii=False)
    return meta


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('name'); ap.add_argument('--src', required=True)
    ap.add_argument('--crop'); ap.add_argument('--long', type=int, default=3600)
    ap.add_argument('--credit', default=''); ap.add_argument('--rights', default=''); ap.add_argument('--source-url', default='')
    ap.add_argument('--native', help='true master W,H when --src is a decimated copy of it'); ap.add_argument('--regions'); ap.add_argument('--note', default='')
    a = ap.parse_args()
    m = bake(a.name, a.src, tuple(int(v) for v in a.crop.split(',')) if a.crop else None, a.long, a.credit, a.rights, a.source_url,
             json.load(open(a.regions)) if a.regions else None, a.note, native=tuple(int(v) for v in a.native.split(',')) if a.native else None)
    print(json.dumps({k: m[k] for k in ('name', 'pack_px', 'scale', 'grain', 'bake_s')}))
