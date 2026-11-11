"""REFMEASURE local-only boards: OUR render beside the photographs at the quantiles of a measure in the person's gate group (p10 p25 p50 p75 p90: the photograph
whose value is nearest each quantile). The photographs are LOCAL ONLY: these boards go to videos/review/studio_human_c8/refs_local/refmeasure/ (never committed;
refs_local is excluded from commits) and the tool refuses any other folder.
    refmeasure.py localboard <face|skin|hair|clothing|body> --tag v6      (one board per measure: a row per person)
"""
import json, os, sys, csv
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont, ImageOps
import rm_common as C
import facepass as FP

TILE = 250


def font(sz):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/dejavu/DejaVuSansMono.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def safe_out(name):
    d = C.LOCAL
    assert 'refs_local' in d
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


def photo_tile(row, kind, w=TILE, h=TILE * 5 // 4):
    im = ImageOps.exif_transpose(Image.open(C.photo_path(row))).convert('RGB')
    if kind == 'face':
        rgb = np.asarray(im)
        if max(rgb.shape[:2]) > 1600: s = 1600 / max(rgb.shape[:2]); rgb = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        d = FP.detect(rgb)
        if d is not None:
            fr = FP.Frame(d['L'][:, :2]); c = fr.P(0, 0.62); half = 1.55 * fr.ipd * 1.15
            x0, y0, x1, y1 = int(c[0] - half), int(c[1] - half * 1.25), int(c[0] + half), int(c[1] + half * 1.25)
            im = Image.fromarray(rgb); im = ImageOps.expand(im, border=int(half * 2), fill=(128, 128, 128))
            b = int(half * 2); im = im.crop((x0 + b, y0 + b, x1 + b, y1 + b))
    return ImageOps.fit(im, (w, h), Image.LANCZOS)


def nearest(items, key, q, used):
    best = None
    for it in items:
        if it['id'] in used or it.get(key) is None: continue
        d = abs(it[key] - q)
        if best is None or d < best[0]: best = (d, it)
    return best[1] if best else None


def make_board(title, our_tiles, groups, key, items_for, fname, kind, fmt='{:.3f}'):
    """our_tiles: list of (label, PIL image, value, (sex, bg) group key used); items_for(group) -> photo rows with key. A row per person."""
    F = font(13); Fs = font(11)
    cols = 6; W = cols * TILE + 8; rowh = TILE * 5 // 4 + 40
    board = Image.new('RGB', (W, 60 + rowh * len(our_tiles)), (20, 20, 20)); d = ImageDraw.Draw(board)
    d.text((8, 6), title, font=font(16), fill=(255, 255, 255))
    d.text((8, 30), 'LOCAL ONLY (photographs): never committed.  left: ours; then the photograph nearest p10 p25 p50 p75 p90 of the key in the same gate group', font=Fs, fill=(255, 200, 120))
    for r, (label, tile, val, g) in enumerate(our_tiles):
        y = 60 + r * rowh
        board.paste(tile.resize((TILE, TILE * 5 // 4)), (0, y)); d.text((4, y + TILE * 5 // 4 + 2), f"{label}  {key} = {fmt.format(val) if val is not None else 'n/a'}", font=Fs, fill=(255, 255, 255))
        items = items_for(g); vals = [it[key] for it in items if it.get(key) is not None]
        if len(vals) < 5: continue
        qs = np.percentile(vals, [10, 25, 50, 75, 90]); used = set()
        d.text((4, y + TILE * 5 // 4 + 18), f"photos {g[0] or 'all'}|{g[1] or 'all'} n={len(vals)}", font=Fs, fill=(170, 170, 170))
        for c, (qq, nm) in enumerate(zip(qs, ('p10', 'p25', 'p50', 'p75', 'p90'))):
            it = nearest(items, key, qq, used)
            if not it: continue
            used.add(it['id'])
            try: t = photo_tile(it['_row'], kind)
            except Exception: continue
            board.paste(t, ((c + 1) * TILE, y)); d.text(((c + 1) * TILE + 4, y + TILE * 5 // 4 + 2), f"{nm} {fmt.format(it[key])}", font=Fs, fill=(255, 230, 120))
    out = safe_out(fname); board.save(out, quality=85); print(out, board.size); return out
