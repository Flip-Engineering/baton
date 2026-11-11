#!/usr/bin/env python3
"""DEVPLATE bake (Oct 2026, built for BY AUTHORITY; research/capabilities/devplate.md): a photograph -> a silver glass plate that
web/lib/fx/devplate.js develops on its lightbox by RULE. Renamed from the concept's tools/plate_bake.py so it does not collide with
videos/scripts/plate_bake.py (the PLATE studio's subject-and-clean-plate tool, which archive_bake.py imports for its depth session).

  python3 videos/tools/devplate_bake.py NAME (--pack web/assets/archive/<pack> | --src FILE [--depth PNG]) [--stock nitrate_bw | orwocolor]
         [--plate 5x7 | 8x10] [--orient auto | landscape | portrait] [--crop x0,y0,x1,y1] [--seed N] [--source-gamma G]
  python3 videos/tools/devplate_bake.py NAME --card SCAN --holes card_holes.json        the card (DevCard): albedo, relief, transmission
  python3 videos/tools/devplate_bake.py --selftest
    -> videos/web/assets/devplate/<NAME>/
         logH.png   16-bit (one channel for b/w, RGB for colour): the scene's log exposure, de-rendered from the source (source_gamma as
                    in printlab's film.develop: 1.0 for Cycles renders, about 1.1 for film frames), placed so the source's p2..p98 spans
                    the stock's straight line; encoded 0..65535 over meta.logH.lo..hi
         mask.png   8-bit RGB at the plate's glass size: R emulsion coverage with a poured margin 2-4 mm in from the glass edge (seeded),
                    G chips (255: the glass is gone; 1-6 mm conchoidal, at 0-2 corners) and hairline scratches (1..127: emulsion lifted),
                    B the glass edge bevel (the ground edge and the fracture faces, 255 at the edge)
         depth.png  8-bit, copied from the archive pack and cropped with the picture (parallax inside the plate only); flat when none
         meta.json  source, rights verbatim, credit, stock, plate size in mm, px per mm, the image rect in glass uv, the placement, the
                    measured grain of the source
  The card mode writes albedo.jpg (the scan cropped to the paper), normal.png (relief from luminance: the letterpress deboss 0.05-0.1 mm,
  the fold a ridge, the paper's tooth; xy encoded n*0.5+0.5 in mm-true slopes), dt.png (8-bit RGB: the ink's extra density in transmitted
  light, D = value / 255 * 2.0 over the paper's own) and meta.json (paper size in mm, holes in paper uv, the fold, the named features).

PNG files are written by this file's own writer (zlib, filter 1), so the same input writes the same bytes; the scene decodes them itself
(devplate.js decodePNG), so no browser colour conversion or 8-bit decode touches the 16-bit data.
"""
import argparse, hashlib, json, math, os, shutil, struct, sys, tempfile, zlib
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)
WEB = os.path.join(VID, 'web')
OUT = os.path.join(WEB, 'assets', 'devplate')
FILM = os.path.join(WEB, 'lib', 'printlab', 'data', 'film')
PLATES = {'5x7': (177.8, 127.0), '8x10': (254.0, 203.2), '4x5': (127.0, 101.6)}   # inches -> mm, long x short
LOGH = (-3.0, 1.0)                                                                  # the encoding range of logH.png
INSET_MM = 2.0                                                                      # the image rect: the glass inset by this


# ---------------------------------------------------------------- PNG (write and read, 8/16-bit, gray/RGB)
def png_write(path, a):
    """a: uint8 or uint16 array (H, W) or (H, W, 3). Filter 1 (sub) on every row; zlib level 9."""
    a = np.asarray(a)
    if a.dtype not in (np.uint8, np.uint16):
        raise ValueError('png_write: uint8 or uint16')
    h, w = a.shape[:2]; ch = 1 if a.ndim == 2 else a.shape[2]
    ctype = {1: 0, 3: 2, 4: 6}[ch]; depth = 16 if a.dtype == np.uint16 else 8; bpp = ch * depth // 8
    raw = a.astype('>u2').tobytes() if depth == 16 else a.tobytes()
    rows = np.frombuffer(raw, np.uint8).reshape(h, w * bpp)
    sub = rows.astype(np.int16).copy(); sub[:, bpp:] -= rows[:, :-bpp].astype(np.int16)
    data = np.concatenate([np.ones((h, 1), np.uint8), (sub & 0xFF).astype(np.uint8)], axis=1).tobytes()
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', w, h, depth, ctype, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(data, 9)) + chunk(b'IEND', b''))


def png_read(path):
    """-> uint8/uint16 array (H, W[, C]); non-interlaced 8/16-bit gray, gray+alpha, RGB, RGBA (what this file and most tools write)."""
    b = open(path, 'rb').read(); assert b[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    i = 8; idat = b''; w = h = depth = ctype = None
    while i < len(b):
        n = struct.unpack('>I', b[i:i + 4])[0]; t = b[i + 4:i + 8]; d = b[i + 8:i + 8 + n]; i += 12 + n
        if t == b'IHDR':
            w, h, depth, ctype, _, _, il = struct.unpack('>IIBBBBB', d)
            assert il == 0, 'interlaced PNG'
        elif t == b'IDAT':
            idat += d
        elif t == b'IEND':
            break
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]; bpp = max(1, ch * depth // 8); stride = w * ch * depth // 8
    raw = np.frombuffer(zlib.decompress(idat), np.uint8)
    out = np.zeros((h, stride), np.uint8); prev = np.zeros(stride, np.int32)
    for y in range(h):
        f = raw[y * (stride + 1)]; line = raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)].astype(np.int32)
        if f == 0:
            cur = line
        elif f == 1:
            cur = line.copy()
            for x in range(bpp, stride):
                cur[x] = (cur[x] + cur[x - bpp]) & 255
        elif f == 2:
            cur = (line + prev) & 255
        elif f == 3:
            cur = line.copy()
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0
                cur[x] = (cur[x] + ((a + prev[x]) >> 1)) & 255
        else:
            cur = line.copy()
            for x in range(stride):
                a = cur[x - bpp] if x >= bpp else 0; c = prev[x - bpp] if x >= bpp else 0; bb = prev[x]
                p = a + bb - c; pa, pb, pc = abs(p - a), abs(p - bb), abs(p - c)
                cur[x] = (cur[x] + (a if pa <= pb and pa <= pc else bb if pb <= pc else c)) & 255
        out[y] = cur; prev = cur
    if depth == 16:
        a = out.view('>u2').astype(np.uint16).reshape(h, w, ch)
    else:
        a = out.reshape(h, w, ch)
    return a[:, :, 0] if ch == 1 else a


def png_read_fast(path):
    """Filter-1 files from png_write decode quickly (the cumulative sum per row); anything else goes through png_read."""
    b = open(path, 'rb').read()
    try:
        i = 8; idat = b''
        while i < len(b):
            n = struct.unpack('>I', b[i:i + 4])[0]; t = b[i + 4:i + 8]; d = b[i + 8:i + 8 + n]; i += 12 + n
            if t == b'IHDR':
                w, h, depth, ctype, _, _, il = struct.unpack('>IIBBBBB', d)
            elif t == b'IDAT':
                idat += d
        ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]; bpp = ch * depth // 8; stride = w * bpp
        raw = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, stride + 1)
        if not np.all(raw[:, 0] == 1):
            return png_read(path)
        rows = raw[:, 1:].reshape(h, w, bpp).astype(np.uint32)
        rows = np.cumsum(rows, axis=1) & 255
        flat = rows.astype(np.uint8).reshape(h, stride)
        a = flat.view('>u2').astype(np.uint16).reshape(h, w, ch) if depth == 16 else flat.reshape(h, w, ch)
        return a[:, :, 0] if ch == 1 else a
    except Exception:  # noqa: BLE001
        return png_read(path)


# ---------------------------------------------------------------- the stock (printlab's data)
def stock(name):
    return json.load(open(os.path.join(FILM, name + '.json')))


def straight_line(st):
    """The logH span of the stock's straight line: where the curve's slope is at least 0.8 of its steepest (G layer). For a stock with
    a print curve (a negative stock) the negative curve; without one (printlab keeps the colour stocks' chain to the print) that curve."""
    lh = np.array(st['curves']['logH'], float); D = np.array(st['curves']['G'], float)
    g = np.abs(np.gradient(D, lh)); ok = np.where(g >= 0.8 * g.max())[0]
    return float(lh[ok[0]]), float(lh[ok[-1]])


def srgb_to_lin(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def place(lin, st, p_lo=2, p_hi=98):
    """lin (H, W, 3) linear RGB -> per-layer exposure through the stock's spectral sensitivities -> log10 -> placed so the G layer's
    p2..p98 spans the stock's straight line (one affine for every layer, so the colour balance stays). Returns logH (H, W, 3), info."""
    S = np.array(st.get('sens_matrix') or np.eye(3).tolist(), float)
    E = np.einsum('ij,hwj->hwi', S, lin)
    LE = np.log10(np.clip(E, 1e-5, None))
    a, b = np.percentile(LE[..., 1], [p_lo, p_hi]); lo, hi = straight_line(st)
    k = (hi - lo) / max(1e-6, b - a)
    logH = lo + (LE - a) * k
    return np.clip(logH, LOGH[0], LOGH[1]), {'p': [p_lo, p_hi], 'logE': [round(float(a), 5), round(float(b), 5)], 'straight': [round(lo, 4), round(hi, 4)],
                                             'gain': round(float(k), 5), 'mid': round((lo + hi) / 2, 4)}


def grain_of(gray):
    """the source's own grain: sigma of a 1.6 px high-pass in its flattest 40 %, and its correlation length (px)"""
    import cv2
    g = gray.astype(np.float32)
    hp = g - cv2.GaussianBlur(g, (0, 0), 1.6); lo = cv2.GaussianBlur(g, (0, 0), 6)
    gx = np.abs(cv2.Sobel(lo, cv2.CV_32F, 1, 0)) + np.abs(cv2.Sobel(lo, cv2.CV_32F, 0, 1)); flat = gx < np.percentile(gx, 40)
    s = hp[:256, :256] - hp[:256, :256].mean(); F = np.fft.rfft2(s); ac = np.fft.irfft2(F * np.conj(F)); ac /= ac[0, 0] + 1e-9
    ln = next((float(k) for k in range(1, 8) if ac[0, k] < .37), 8.0)
    return {'sigma': round(float(hp[flat].std()), 5), 'corr_px': ln}


# ---------------------------------------------------------------- the glass: margin, chips, scratches, bevel (seeded)
def _noise1(n, seed, cells):
    """smooth 1-D value noise in -1..1, n samples, `cells` lattice cells across"""
    R = np.random.default_rng(seed); v = R.uniform(-1, 1, cells + 2)
    x = np.linspace(0, cells, n); i = np.floor(x).astype(int); f = x - i; s = f * f * (3 - 2 * f)
    return v[i] * (1 - s) + v[i + 1] * s


def make_mask(w_mm, h_mm, ppm, seed):
    """-> (mask uint8 (H, W, 3), info). Coordinates: x right, y down (image rows); mm = px / ppm."""
    W, H = int(round(w_mm * ppm)), int(round(h_mm * ppm))
    R = np.random.default_rng(seed)
    xs = (np.arange(W) + 0.5) / ppm; ys = (np.arange(H) + 0.5) / ppm
    X, Y = np.meshgrid(xs, ys)
    # the poured margin: per edge, 3 mm +- 1 mm of slow wobble with a little fast ripple, clamped to 2..4 mm
    def edge(n, k):
        m = 3.0 + 0.85 * _noise1(n, seed * 31 + k, 5) + 0.12 * _noise1(n, seed * 31 + k + 9, 40)
        return np.clip(m, 2.05, 3.95)
    mt, mb, ml, mr = edge(W, 1), edge(W, 2), edge(H, 3), edge(H, 4)
    inside = (Y >= mt[None, :]) & (Y <= h_mm - mb[None, :]) & (X >= ml[:, None]) & (X <= w_mm - mr[:, None])
    # a soft poured edge (the emulsion thins over ~0.25 mm)
    d = np.minimum.reduce([Y - mt[None, :], (h_mm - mb[None, :]) - Y, X - ml[:, None], (w_mm - mr[:, None]) - X])
    Rch = np.clip(d / 0.25 + 0.5, 0, 1)
    # chips: 0-2 corners, conchoidal: a scalloped arc 1-6 mm from the corner
    G = np.zeros((H, W), np.float32); chips = []
    corners = [(0, 0), (w_mm, 0), (0, h_mm), (w_mm, h_mm)]
    for c in R.choice(4, size=int(R.integers(0, 3)), replace=False):
        cx, cy = corners[c]; r0 = float(R.uniform(1.2, 6.0))
        dx, dy = X - cx, Y - cy; rr = np.hypot(dx, dy); th = np.arctan2(np.abs(dy), np.abs(dx))
        scallop = r0 * (0.82 + 0.18 * np.cos(th * float(R.uniform(5, 9)) + float(R.uniform(0, 6.28))))
        chip = rr < scallop
        G[chip] = 1.0; chips.append({'corner': int(c), 'r_mm': round(r0, 2), 'area_frac': round(float(chip.mean()), 5)})
    # hairline scratches: 1-3 straight-ish lines across the emulsion, 0.06-0.12 mm wide (sub-pixel at most scales: coverage)
    scr = np.zeros((H, W), np.float32); nsc = int(R.integers(1, 4))
    for _ in range(nsc):
        x0, y0 = R.uniform(0.15, 0.85) * w_mm, R.uniform(0.1, 0.9) * h_mm; a = R.uniform(0, math.pi); L = R.uniform(15, 60)
        ux, uy = math.cos(a), math.sin(a); wid = R.uniform(0.06, 0.12)
        t = (X - x0) * ux + (Y - y0) * uy; n = np.abs(-(X - x0) * uy + (Y - y0) * ux)
        cov = np.clip(wid * ppm / 2 + 0.5 - n * ppm, 0, 1) * (np.abs(t) < L / 2)
        scr = np.maximum(scr, cov * 0.9)
    Gch = np.where(G > 0.5, 255, np.round(scr * Rch * 127)).astype(np.uint8)
    # the bevel: the ground edge (0.8 mm) and the chips' fracture faces (0.5 mm)
    de = np.minimum.reduce([X, w_mm - X, Y, h_mm - Y])
    bev = np.clip(1 - de / 0.8, 0, 1)
    if G.any():
        import cv2
        dist = cv2.distanceTransform((G < 0.5).astype(np.uint8), cv2.DIST_L2, 5) / ppm
        bev = np.maximum(bev, np.clip(1 - dist / 0.5, 0, 1) * (G < 0.5))
    Rch = Rch * (G < 0.5)
    mask = np.stack([np.round(Rch * 255), Gch, np.round(bev * 255)], -1).astype(np.uint8)
    margin = {'top': [round(float(mt.min()), 3), round(float(mt.max()), 3)], 'bottom': [round(float(mb.min()), 3), round(float(mb.max()), 3)],
              'left': [round(float(ml.min()), 3), round(float(ml.max()), 3)], 'right': [round(float(mr.min()), 3), round(float(mr.max()), 3)]}
    return mask, {'margin_mm': margin, 'chips': chips, 'scratches': nsc}


# ---------------------------------------------------------------- one plate
def bake_plate(name, img, st_name, plate='5x7', orient='auto', seed=1, source_gamma=1.1, depth=None, meta_in=None, out_dir=None):
    """img: float sRGB (H, W, 3) 0..1 (already cropped to the picture), depth: uint8 (h, w) or None"""
    import cv2
    st = stock(st_name); colour = bool(st.get('colour'))
    L_mm, S_mm = PLATES[plate]
    h0, w0 = img.shape[:2]
    land = (w0 >= h0) if orient == 'auto' else orient == 'landscape'
    w_mm, h_mm = (L_mm, S_mm) if land else (S_mm, L_mm)
    iw_mm, ih_mm = w_mm - 2 * INSET_MM, h_mm - 2 * INSET_MM
    # crop the picture to the image rect's aspect (centred), never scaled up: the plate keeps the source's own pixels
    want = iw_mm / ih_mm
    if w0 / h0 > want:
        nw = int(round(h0 * want)); x0 = (w0 - nw) // 2; img = img[:, x0:x0 + nw]; crop = [x0, 0, x0 + nw, h0]
    else:
        nh = int(round(w0 / want)); y0 = (h0 - nh) // 2; img = img[y0:y0 + nh]; crop = [0, y0, w0, y0 + nh]
    h, w = img.shape[:2]; ppm = w / iw_mm
    lin = srgb_to_lin(img) ** (1.0 / source_gamma)
    logH, plc = place(lin, st)
    q = np.round((logH - LOGH[0]) / (LOGH[1] - LOGH[0]) * 65535).astype(np.uint16)
    out_dir = out_dir or os.path.join(OUT, name); os.makedirs(out_dir, exist_ok=True)
    png_write(os.path.join(out_dir, 'logH.png'), q if colour else q[..., 1])
    mask, minfo = make_mask(w_mm, h_mm, ppm, seed)
    png_write(os.path.join(out_dir, 'mask.png'), mask)
    if depth is not None:
        dh, dw = depth.shape[:2]; sx, sy = dw / w0, dh / h0
        d = depth[int(round(crop[1] * sy)):int(round(crop[3] * sy)), int(round(crop[0] * sx)):int(round(crop[2] * sx))]
        png_write(os.path.join(out_dir, 'depth.png'), d.astype(np.uint8))
    else:
        png_write(os.path.join(out_dir, 'depth.png'), np.full((max(2, h // 2), max(2, w // 2)), 128, np.uint8))
    gray = (cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY))
    meta = dict(meta_in or {})
    meta.update({'name': name, 'stock': st_name, 'colour': colour, 'plate': plate, 'glass_mm': [round(w_mm, 2), round(h_mm, 2)],
                 'thick_mm': 2.0, 'px_per_mm': round(ppm, 5), 'image_px': [w, h],
                 'img_uv': [INSET_MM / w_mm, INSET_MM / h_mm, 1 - INSET_MM / w_mm, 1 - INSET_MM / h_mm],
                 'mask_px': [mask.shape[1], mask.shape[0]], 'logH': {'lo': LOGH[0], 'hi': LOGH[1], 'bits': 16, 'channels': 3 if colour else 1},
                 'source_gamma': source_gamma, 'placement': plc, 'crop_px': crop, 'seed': seed, 'glass': minfo,
                 'grain_source': grain_of(gray / 255.0),
                 'stock_note': 'EST stand-in data (printlab/data/film/%s.json provenance); a dry plate\'s own contrast is the director\'s gammaScale' % st_name})
    json.dump(meta, open(os.path.join(out_dir, 'meta.json'), 'w'), indent=1)
    return meta, logH


def load_src(path):
    """-> float sRGB (H, W, 3) 0..1 from 8- or 16-bit files"""
    import cv2
    a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if a is None:
        raise SystemExit(f'devplate_bake: cannot read {path}')
    if a.ndim == 2:
        a = np.stack([a] * 3, -1)
    a = a[..., :3][..., ::-1]
    return a.astype(np.float32) / (65535.0 if a.dtype == np.uint16 else 255.0)


# ---------------------------------------------------------------- the card
def bake_card(name, scan, holes_json, out_dir=None, relief=0.08):
    """scan: the LAC jpg (the card on a black ground). holes_json: { paper_px: [x0,y0,x1,y1] in the scan, paper_mm: [w, h], holes: [[[x, y]...],...]
    in scan px, fold: [[x, y], [x, y]] scan px, features: {name: {box: [x0,y0,x1,y1] scan px, rot_deg}} }"""
    import cv2
    J = json.load(open(holes_json))
    img = load_src(scan)
    x0, y0, x1, y1 = J['paper_px']; pw, ph = x1 - x0, y1 - y0
    pap = img[y0:y1, x0:x1].copy()
    out_dir = out_dir or os.path.join(OUT, name); os.makedirs(out_dir, exist_ok=True)
    # albedo: the scan itself, cropped to the paper (the ground outside the paper's ragged edge stays: the alpha comes from `edge`)
    cv2.imwrite(os.path.join(out_dir, 'albedo.jpg'), (np.clip(pap, 0, 1)[..., ::-1] * 255).round().astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 95])
    mm_w, mm_h = J['paper_mm']; ppm = pw / mm_w
    lin = srgb_to_lin(pap)
    paperc = np.median(lin.reshape(-1, 3)[(lin.mean(-1) > np.percentile(lin.mean(-1), 60)).reshape(-1)], axis=0)
    ratio = np.clip(lin / paperc[None, None, :], 0.02, 1.0)
    dt = np.clip(-np.log10(ratio) * 1.15, 0, 2.0)                       # the ink's extra density in transmission (black ink ~1.4)
    # the paper's own edge (the card is ragged; outside it the scanner's black): alpha by luminance, cleaned
    lum = pap.mean(-1)
    alpha = (lum > 0.18).astype(np.uint8)
    alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(alpha, 8)
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])); paper = (lab == big).astype(np.uint8)
    paper = cv2.morphologyEx(paper, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))   # ink letters are not holes: fill them back
    # holes: the traced polygons are through-holes whatever the scan says
    holes = np.zeros((ph, pw), np.uint8)
    for poly in J['holes']:
        pts = np.array([[x - x0, y - y0] for x, y in poly], np.int32)
        cv2.fillPoly(holes, [pts], 1)
    # fill the paper's interior (the letters and stamp are paper): flood from outside
    inv = (1 - paper).astype(np.uint8); ff = inv.copy(); m = np.zeros((ph + 2, pw + 2), np.uint8); cv2.floodFill(ff, m, (0, 0), 2)
    edge = ((ff != 2) | (paper == 1)).astype(np.uint8) * (1 - holes)
    # relief: ink is debossed (`relief` mm), the fold a ridge, the paper's tooth from the scan's own fine luminance
    ink = np.clip((0.55 - lum) / 0.35, 0, 1)
    hgt = -relief * cv2.GaussianBlur(ink.astype(np.float32), (0, 0), 0.9)
    (fx0, fy0), (fx1, fy1) = J['fold']
    yy, xx = np.mgrid[0:ph, 0:pw].astype(np.float32)
    fx = (fx0 - x0) + (yy - (fy0 - y0)) / max(1, (fy1 - fy0)) * (fx1 - fx0)
    hgt += 0.06 * np.exp(-((xx - fx) / (0.8 * ppm)) ** 2)
    tooth = lum - cv2.GaussianBlur(lum, (0, 0), 2.0)
    hgt += 0.015 * tooth / (tooth.std() + 1e-6) * (1 - ink) * 0.4
    gy, gx = np.gradient(hgt * ppm)                                     # mm of height per mm (the texel is 1/ppm mm)
    nrm = np.stack([-gx, gy, np.ones_like(gx)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    enc = np.round((nrm * 0.5 + 0.5) * 255).astype(np.uint8)
    enc[..., 2] = np.round(edge * 255).astype(np.uint8)                 # B carries the paper's own edge (alpha; 0 = no paper or a hole)
    png_write(os.path.join(out_dir, 'normal.png'), enc)
    png_write(os.path.join(out_dir, 'dt.png'), np.round(dt / 2.0 * 255).astype(np.uint8))
    feats = {}
    for k, f in (J.get('features') or {}).items():
        bx0, by0, bx1, by1 = f['box']
        feats[k] = {'uv': [(bx0 - x0) / pw, 1 - (by1 - y0) / ph, (bx1 - x0) / pw, 1 - (by0 - y0) / ph], 'rot_deg': f.get('rot_deg', 0), 'note': f.get('note', '')}
    meta = {'name': name, 'source': J.get('source'), 'credit': J.get('credit'), 'rights': J.get('rights'), 'paper_mm': [mm_w, mm_h],
            'px': [pw, ph], 'px_per_mm': round(ppm, 4), 'relief_mm': relief,
            'holes_uv': [[[(x - x0) / pw, 1 - (y - y0) / ph] for x, y in poly] for poly in J['holes']],
            'fold_uv': [[(fx0 - x0) / pw, 1 - (fy0 - y0) / ph], [(fx1 - x0) / pw, 1 - (fy1 - y0) / ph]],
            'features': feats, 'paper_lin': [round(float(v), 4) for v in paperc],
            'dt': {'scale': 2.0, 'note': 'extra density over the paper in transmitted light: -log10(ink / paper) x 1.15 (black ink ~1.4, printlab letterpress black 1.33-1.38)'},
            'normal': {'xy': 'n*0.5+0.5 (x right, y up on the paper)', 'b': 'the paper edge mask (1 paper, 0 none or a hole)'}}
    json.dump(meta, open(os.path.join(out_dir, 'meta.json'), 'w'), indent=1)
    return meta


# ---------------------------------------------------------------- selftest
def selftest():
    ok = True
    def rep(good, msg):
        nonlocal ok; ok &= bool(good); print(('ok   ' if good else 'FAIL ') + msg)
    tmp = tempfile.mkdtemp(prefix='devplate_selftest_')
    try:
        # 1. a synthetic wedge round-trips logH through the 16-bit file
        w, h = 712, 480
        wedge = np.tile(np.linspace(0.02, 0.98, w, dtype=np.float32)[None, :, None], (h, 1, 3))
        meta, logH = bake_plate('wedge', wedge, 'nitrate_bw', seed=3, source_gamma=1.0, out_dir=os.path.join(tmp, 'wedge'))
        q = png_read(os.path.join(tmp, 'wedge', 'logH.png')).astype(np.float64)
        back = LOGH[0] + q / 65535 * (LOGH[1] - LOGH[0]); err = float(np.abs(back - logH[..., 1]).max())
        rep(err < 0.002, f'wedge round trip: max |logH error| {err:.6f} log units (< 0.002)')
        q2 = png_read_fast(os.path.join(tmp, 'wedge', 'logH.png')); rep(np.array_equal(q2, png_read(os.path.join(tmp, 'wedge', 'logH.png'))), 'fast and full PNG decoders agree')
        lo, hi = straight_line(stock('nitrate_bw')); pl = meta['placement']
        rep(abs(np.percentile(logH[..., 1], 2) - lo) < 0.01 and abs(np.percentile(logH[..., 1], 98) - hi) < 0.01, f'placement: p2..p98 -> {lo:.2f}..{hi:.2f} (the straight line)')
        # 2. the margin is 2-4 mm at the plate's px per mm; chips no larger than 1.5 % of the plate
        worst_lo, worst_hi, worst_chip = 9, 0, 0
        for seed in range(1, 41):
            m, info = make_mask(177.8, 127.0, 4.1, seed)
            ppm = 4.1; R = m[..., 0] > 127
            for row in (m.shape[0] // 3, m.shape[0] // 2):
                xs = np.where(R[row])[0]
                if len(xs): worst_lo = min(worst_lo, xs[0] / ppm, (m.shape[1] - 1 - xs[-1]) / ppm); worst_hi = max(worst_hi, xs[0] / ppm, (m.shape[1] - 1 - xs[-1]) / ppm)
            for col in (m.shape[1] // 3, m.shape[1] // 2):
                ys = np.where(R[:, col])[0]
                if len(ys): worst_lo = min(worst_lo, ys[0] / ppm, (m.shape[0] - 1 - ys[-1]) / ppm); worst_hi = max(worst_hi, ys[0] / ppm, (m.shape[0] - 1 - ys[-1]) / ppm)
            worst_chip = max([worst_chip] + [c['area_frac'] for c in info['chips']])
        rep(1.8 <= worst_lo and worst_hi <= 4.25, f'margin over 40 seeds: {worst_lo:.2f}-{worst_hi:.2f} mm measured at the px grid (2-4 mm, +-1 px)')
        rep(worst_chip <= 0.015, f'largest chip over 40 seeds: {worst_chip * 100:.3f} % of the plate (<= 1.5 %)')
        # 3. the same seed writes byte-identical masks
        a1 = os.path.join(tmp, 'm1.png'); a2 = os.path.join(tmp, 'm2.png')
        png_write(a1, make_mask(177.8, 127.0, 4.1, 11)[0]); png_write(a2, make_mask(177.8, 127.0, 4.1, 11)[0])
        h1, h2 = hashlib.sha256(open(a1, 'rb').read()).hexdigest(), hashlib.sha256(open(a2, 'rb').read()).hexdigest()
        rep(h1 == h2, f'same seed, same bytes ({h1[:12]})')
        png_write(a2, make_mask(177.8, 127.0, 4.1, 12)[0]); rep(hashlib.sha256(open(a2, 'rb').read()).hexdigest() != h1, 'another seed, another mask')
        # 4. a colour plate writes three 16-bit channels
        rgb = np.random.default_rng(1).uniform(0.05, 0.95, (240, 320, 3)).astype(np.float32)
        bake_plate('col', rgb, 'orwocolor', seed=2, source_gamma=1.0, out_dir=os.path.join(tmp, 'col'))
        qc = png_read(os.path.join(tmp, 'col', 'logH.png')); rep(qc.ndim == 3 and qc.shape[2] == 3 and qc.dtype == np.uint16, 'colour logH: RGB, 16-bit')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print('selftest ' + ('ok' if ok else 'FAILED'))
    return ok


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('name', nargs='?')
    ap.add_argument('--pack'); ap.add_argument('--src'); ap.add_argument('--card'); ap.add_argument('--holes')
    ap.add_argument('--stock', default='nitrate_bw'); ap.add_argument('--plate', default='5x7'); ap.add_argument('--orient', default='auto')
    ap.add_argument('--crop'); ap.add_argument('--seed', type=int, default=1); ap.add_argument('--source-gamma', type=float, default=None)
    ap.add_argument('--relief', type=float, default=0.08)
    ap.add_argument('--credit'); ap.add_argument('--rights'); ap.add_argument('--source-url')
    ap.add_argument('--depth', help='a depth png (0 far .. 255 near) for --src, aligned with it (e.g. an archive pack of the same picture)')
    ap.add_argument('--note', default='')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)
    if not a.name:
        ap.error('NAME is required')
    if a.card:
        m = bake_card(a.name, a.card, a.holes, relief=a.relief); print(json.dumps({k: m[k] for k in ('name', 'paper_mm', 'px', 'px_per_mm')})); return
    meta_in, depth = {}, None
    if a.pack:
        pk = a.pack if os.path.isabs(a.pack) else os.path.join(VID, a.pack)
        pm = json.load(open(os.path.join(pk, 'meta.json')))
        img = load_src(os.path.join(pk, 'color.jpg'))
        import cv2
        dp = os.path.join(pk, 'depth.png'); depth = cv2.imread(dp, cv2.IMREAD_GRAYSCALE) if os.path.exists(dp) else None
        meta_in = {'source': pm.get('source_url') or pm.get('source'), 'credit': pm.get('credit'), 'rights': pm.get('rights'), 'pack': os.path.relpath(pk, VID)}
        for k in ('note', 'native'):
            if k in pm: meta_in['pack_' + k] = pm[k]
    elif a.src:
        img = load_src(a.src); meta_in = {'source': a.source_url or a.src, 'credit': a.credit, 'rights': a.rights}
        if a.depth:
            import cv2
            d = cv2.imread(a.depth, cv2.IMREAD_GRAYSCALE)
            depth = cv2.resize(d, (img.shape[1] // 2, img.shape[0] // 2), interpolation=cv2.INTER_AREA) if d is not None else None
    if a.note:
        meta_in['note'] = a.note
    else:
        ap.error('--pack, --src or --card')
    if a.crop:                                                          # a crop in the source's pixels; the depth is cropped with it
        x0, y0, x1, y1 = map(int, a.crop.split(','))
        if depth is not None:
            sy, sx = depth.shape[0] / img.shape[0], depth.shape[1] / img.shape[1]
            depth = depth[int(round(y0 * sy)):int(round(y1 * sy)), int(round(x0 * sx)):int(round(x1 * sx))]
        img = img[y0:y1, x0:x1]; meta_in['crop_src_px'] = [x0, y0, x1, y1]
    sg = a.source_gamma if a.source_gamma is not None else (1.0 if a.stock == 'orwocolor' else 1.1)
    m, _ = bake_plate(a.name, img, a.stock, a.plate, a.orient, a.seed, sg, depth, meta_in)
    print(json.dumps({k: m[k] for k in ('name', 'stock', 'glass_mm', 'px_per_mm', 'image_px', 'placement')}))


if __name__ == '__main__':
    main()
