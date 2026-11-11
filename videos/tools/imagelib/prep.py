#!/usr/bin/env python3
"""IMAGE PREP: turn a library photo into compositing plates (offline, once per image; zero per-frame cost).

    python3 videos/tools/imagelib/prep.py all            # rebuild every recipe in recipes.json
    python3 videos/tools/imagelib/prep.py one ID         # one recipe
    python3 videos/tools/imagelib/prep.py show ID        # write a 4-up check image to videos/review/lab_image2/prep_ID.jpg

Needs numpy + Pillow + OpenCV (`pip install opencv-python-headless`; PyPI is reachable).

For each recipe (recipes.json: { id: { crop, rect, fg, bg, feather, clean, depth, key } }) it writes, into
videos/sources/library/derived/:
  ID.cut.png     RGBA cutout, cropped to the subject box (+pad), straight alpha
  ID.clean.jpg   the plate with the subject removed (multi-scale inpaint + re-grained) for parallax / re-staging
  ID.nrm.png     'pillow' normals of the silhouette (xy from the alpha distance field, z up): lets a flat photo cutout
                 take a rim or key light from any direction in lib/fx/montage.js / project.js
  ID.depth.png   16-bit-in-RG depth for lib/fx/project.js: horizon-ramp ground + the subject as a raised card whose
                 relief follows the pillow height (near = 1)
and records the derived files, the recipe and the source hash in the manifest row (row.derived), so a changed
source invalidates it.

Matte: OpenCV GrabCut, initialised from the recipe's rect plus optional fg/bg polygons (probable/definite
scribbles) and a luma prior ('key': 'dark' for backlit silhouettes: pixels much darker than the local sky are
probable-fg). The hard GrabCut label is then refined to a soft alpha with a guided filter (He et al. 2010,
radius r, eps) on the photo's luma, which recovers hair/cap-brim edges without a learned model.
"""
import json, os, sys
import numpy as np
from PIL import Image
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.abspath(os.path.join(HERE, '..', '..'))
LIB = os.path.join(VID, 'sources', 'library')
DER = os.path.join(LIB, 'derived')
MAN = os.path.join(LIB, 'manifest.json')
REC = os.path.join(HERE, 'recipes.json')


def box(a, r):
    return cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1), borderType=cv2.BORDER_REFLECT)


def guided(I, p, r, eps):
    """He, Sun, Tang: guided filter, grey guide. I, p float32 0..1."""
    mI, mp = box(I, r), box(p, r)
    cov = box(I * p, r) - mI * mp; var = box(I * I, r) - mI * mI
    a = cov / (var + eps); b = mp - a * mI
    return box(a, r) * I + box(b, r)


def poly_mask(shape, polys, scale):
    m = np.zeros(shape[:2], np.uint8)
    for p in polys or []:
        cv2.fillPoly(m, [np.array([[x * scale, y * scale] for x, y in p], np.int32)], 1)
    return m.astype(bool)


def matte(img, R):
    h, w = img.shape[:2]
    s = min(1.0, 900 / max(h, w))                        # GrabCut at <= 900 px, refined at full res
    sm = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    mask = np.full(sm.shape[:2], cv2.GC_BGD, np.uint8)
    x0, y0, x1, y1 = [int(v * s) for v in R['rect']]
    mask[y0:y1, x0:x1] = cv2.GC_PR_BGD
    if R.get('key') == 'dark':                            # backlit: dark vs its own blurred surround
        L = cv2.cvtColor(sm, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
        sur = cv2.GaussianBlur(L, (0, 0), max(sm.shape) / 18)
        dark = (L < R.get('dark', 0.16)) | (L < sur * 0.45)
        mask[y0:y1, x0:x1][dark[y0:y1, x0:x1]] = cv2.GC_PR_FGD
    mask[poly_mask(sm.shape, R.get('fg'), s)] = cv2.GC_FGD
    mask[poly_mask(sm.shape, R.get('bg'), s)] = cv2.GC_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(sm, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    hard = np.isin(mask, (cv2.GC_FGD, cv2.GC_PR_FGD)).astype(np.float32)
    # keep the largest components only (GrabCut leaves specks on dark ground)
    n, lab, st, _ = cv2.connectedComponentsWithStats((hard > 0.5).astype(np.uint8))
    if n > 1:
        keep = np.zeros(n, bool); areas = st[1:, cv2.CC_STAT_AREA]; big = areas.max()
        keep[1:] = areas > big * R.get('keepFrac', 0.08)
        hard = keep[lab].astype(np.float32)
    hard = cv2.resize(hard, (w, h), interpolation=cv2.INTER_LINEAR)
    G = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    r = int(R.get('feather', 6) * max(h, w) / 1000) + 2
    a = guided(G, hard, r, R.get('eps', 1e-3))
    a = np.clip((a - 0.5) * R.get('sharp', 1.6) + 0.5, 0, 1)
    return a


def clean_plate(img, a, R):
    """Remove the subject: dilate the matte, inpaint at 1/4 (Telea), upsample, then put back luma grain from the
    plate's own high-pass so the fill does not read as a smear."""
    h, w = img.shape[:2]
    hole = (cv2.dilate((a > 0.05).astype(np.uint8), np.ones((9, 9), np.uint8), iterations=max(1, w // 400)))
    q = 4; sm = cv2.resize(img, (w // q, h // q), interpolation=cv2.INTER_AREA)
    hm = cv2.resize(hole, (w // q, h // q), interpolation=cv2.INTER_NEAREST)
    fill = cv2.inpaint(sm, hm, 7, cv2.INPAINT_TELEA)
    fill = cv2.GaussianBlur(fill, (0, 0), 2)
    fill = cv2.resize(fill, (w, h), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    hp = img.astype(np.float32) - cv2.GaussianBlur(img, (0, 0), 3).astype(np.float32)
    # re-grain the fill: noise with the plate's own high-pass spread (per channel), so it does not read as a smear
    sd = hp[hole == 0].std(0) if (hole == 0).any() else np.full(3, 4.0)
    rs = np.random.default_rng(7); fill += rs.standard_normal(img.shape).astype(np.float32) * sd * 0.9
    k = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 6)[..., None]
    out = img.astype(np.float32) * (1 - k) + fill * k
    return np.clip(out, 0, 255).astype(np.uint8)


def pillow(a):
    """Inflate the silhouette: height = sqrt of the normalised inside distance (a dome over the shape); normal from
    its gradient. Encoded 0..255 as (x*0.5+0.5, y*0.5+0.5, z)."""
    h, w = a.shape
    s = 512 / max(h, w); sm = cv2.resize(a, (max(8, int(w * s)), max(8, int(h * s))), interpolation=cv2.INTER_AREA)
    d = cv2.distanceTransform((sm > 0.5).astype(np.uint8), cv2.DIST_L2, 5).astype(np.float32)
    d = cv2.GaussianBlur(d, (0, 0), 1.5)
    ht = np.sqrt(np.clip(d / (np.percentile(d[d > 0], 97) + 1e-6), 0, 1.4))
    gy, gx = np.gradient(ht * 22)
    n = np.dstack([-gx, gy, np.ones_like(gx)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    n = cv2.resize(n, (w, h), interpolation=cv2.INTER_LINEAR)
    ht = cv2.resize(ht, (w, h), interpolation=cv2.INTER_LINEAR)
    return n, ht


def depth_map(a, ht, R):
    h, w = a.shape
    hz = R.get('depth', {}).get('horizon', 0.62)
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    ground = np.clip((y - hz) / (1 - hz), 0, 1) * 0.55 + 0.02          # sky = 0.02 (far), ground ramps toward camera
    ground = np.broadcast_to(ground, (h, w)).copy()
    sub = R.get('depth', {}).get('subject', 0.8) + ht * R.get('depth', {}).get('relief', 0.12)
    d = ground * (1 - a) + sub * a
    d16 = (np.clip(d, 0, 1) * 65535).astype(np.uint16)
    rgb = np.dstack([(d16 >> 8).astype(np.uint8), (d16 & 255).astype(np.uint8), np.zeros_like(d16, np.uint8)])
    return rgb


def run(id_, R, man):
    row = man[id_]
    img = cv2.imread(os.path.join(LIB, row['file']), cv2.IMREAD_COLOR)
    if 'crop' in R:
        x0, y0, x1, y1 = R['crop']; img = img[y0:y1, x0:x1]
    a = matte(img, R)
    os.makedirs(DER, exist_ok=True)
    ys, xs = np.where(a > 0.02); pad = int(max(img.shape) * 0.01)
    y0, y1 = max(0, ys.min() - pad), min(img.shape[0], ys.max() + pad); x0, x1 = max(0, xs.min() - pad), min(img.shape[1], xs.max() + pad)
    # denoise before anything stretches the tones: backlit plates are dark and JPEG-blocky, and levels: 'auto' in
    # montage.js / a halftone would otherwise print the 8x8 blocks. Non-local means, strength by recipe.
    dn = cv2.fastNlMeansDenoisingColored(img, None, R.get('denoise', 7), R.get('denoise', 7), 7, 21) if R.get('denoise', 7) else img
    rgba = np.dstack([dn[..., ::-1], (a * 255).astype(np.uint8)])
    Image.fromarray(rgba[y0:y1, x0:x1]).save(os.path.join(DER, f'{id_}.cut.png'), optimize=True)
    n, ht = pillow(a)
    nrm = np.dstack([(n[..., 0] * .5 + .5), (n[..., 1] * .5 + .5), n[..., 2], a]) * 255
    Image.fromarray(nrm.astype(np.uint8)[y0:y1, x0:x1], 'RGBA').save(os.path.join(DER, f'{id_}.nrm.png'), optimize=True)
    out = dict(cut=f'derived/{id_}.cut.png', nrm=f'derived/{id_}.nrm.png', box=[int(x0), int(y0), int(x1), int(y1)],
               size=[int(img.shape[1]), int(img.shape[0])], recipe=R, src_sha=row['sha256'])
    if R.get('clean', True):
        cv2.imwrite(os.path.join(DER, f'{id_}.clean.jpg'), clean_plate(img, a, R), [cv2.IMWRITE_JPEG_QUALITY, 92])
        out['clean'] = f'derived/{id_}.clean.jpg'
    if R.get('crop'):
        cv2.imwrite(os.path.join(DER, f'{id_}.plate.jpg'), img, [cv2.IMWRITE_JPEG_QUALITY, 93]); out['plate'] = f'derived/{id_}.plate.jpg'
    Image.fromarray(depth_map(a, ht, R)).save(os.path.join(DER, f'{id_}.depth.png')); out['depth'] = f'derived/{id_}.depth.png'
    row['derived'] = out
    print(f'{id_}: alpha cover {a.mean():.3f}, box {out["box"]}')
    return img, a


def show(id_, img, a):
    h, w = a.shape; s = 540 / h
    def sm(x): return cv2.resize(x, (int(w * s), 540), interpolation=cv2.INTER_AREA)
    chk = np.indices(a.shape).sum(0) // 24 % 2 * 60 + 90
    comp = img[..., ::-1] * a[..., None] + np.dstack([chk] * 3) * (1 - a[..., None])
    red = np.array([189, 24, 24], np.float32); onred = img[..., ::-1] * a[..., None] + red * (1 - a[..., None])
    cl = cv2.imread(os.path.join(DER, f'{id_}.clean.jpg'))
    tiles = [sm(img[..., ::-1]), sm((a * 255).astype(np.uint8)), sm(comp.astype(np.uint8)), sm(onred.astype(np.uint8))]
    if cl is not None: tiles.append(sm(cl[..., ::-1]))
    tiles = [t if t.ndim == 3 else np.dstack([t] * 3) for t in tiles]
    out = os.path.join(VID, 'review', 'lab_image2', f'prep_{id_}.jpg'); os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.fromarray(np.hstack(tiles).astype(np.uint8)).save(out, quality=88); print('wrote', out)


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'all'
    man = json.load(open(MAN)); rec = json.load(open(REC))
    ids = list(rec) if cmd == 'all' else [sys.argv[2]]
    for i in ids:
        img, a = run(i, rec[i], man)
        if cmd == 'show': show(i, img, a)
    json.dump(man, open(MAN, 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
