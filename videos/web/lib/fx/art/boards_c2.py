"""ART c2: before/after boards, the 1:1 pour crop, the fist turntable sheet, the wipe strip, the value wall and the
cost table for review/studio_art_c2/after/. Every board shows each frame large (540x960, i.e. the full frame at half
size; the full-res stills are in after/raw) with its 270 px twin underneath. valueStats is the same measure as
tokens.js (135 px wide, Rec.709 luma, near-black < 0.15, bright mean >= 0.45).

  python3 web/lib/fx/art/boards_c2.py [boards|wall|cost|all]
"""
import glob
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

V = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
BEF = f'{V}/review/studio_art_c2/before'
C1 = f'{V}/review/studio_art_c1/after/raw'
AFT = f'{V}/review/studio_art_c2/after'
RAW = f'{AFT}/raw'
PC = f'{V}/out/.pcache/art2'
try:
    FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
except Exception:
    FONT = ImageFont.load_default()


def vstats(im):
    a = np.asarray(im.convert('RGB').resize((135, round(135 * im.height / im.width))), dtype=np.float32) / 255
    L = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    return {'mean': round(float(L.mean()), 3), 'dark': round(float((L < 0.15).mean()), 3), 'clip': round(float((L > 0.85).mean()), 3)}


def fit(im, w, h):
    s = max(w / im.width, h / im.height)
    im2 = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    x, y = (im2.width - w) // 2, (im2.height - h) // 2
    return im2.crop((x, y, x + w, y + h))


def board(cells, out, big=(540, 960), twin=270):
    """cells: [(label, path, tag)] tag 'before' | 'after' | 'ref'"""
    n = len(cells)
    th = round(twin * big[1] / big[0])
    W, H = n * (big[0] + 10) + 10, 34 + big[1] + 44 + th + 34
    B = Image.new('RGB', (W, H), (22, 22, 22))
    d = ImageDraw.Draw(B)
    for i, (lab, p, tag) in enumerate(cells):
        im = Image.open(p).convert('RGB')
        x = 10 + i * (big[0] + 10)
        col = {'before': (255, 110, 90), 'after': (120, 230, 120), 'ref': (240, 220, 120)}[tag]
        vs = vstats(im)
        d.text((x, 8), f'{tag.upper()}: {lab}', fill=col, font=FONT)
        B.paste(fit(im, *big), (x, 34))
        d.text((x, 34 + big[1] + 10), f"mean {vs['mean']:.2f}  dark {vs['dark']:.2f}  clip {vs['clip']:.2f}", fill=(200, 200, 200), font=FONT)
        B.paste(fit(im, twin, th), (x, 34 + big[1] + 44))
        d.text((x + twin + 8, 34 + big[1] + 50), '270 px twin', fill=(150, 150, 150), font=FONT)
    B.save(out, quality=90)
    return out


def first(*pats):
    for p in pats:
        g = sorted(glob.glob(p))
        if g:
            return g[0]
    return None


def boards():
    R = lambda n: f'{RAW}/{n}'
    made = []
    made.append(board([
        ('kit c1 hook pour_2.00', f'{C1}/pour_2.00.jpg', 'before'),
        ('IRON v9 10.75 s', f'{BEF}/key/IRON_IS_HOT_v9_10.75.jpg', 'before'),
        ('c2 pour, lip cam 2.00', R('pour_2.00.jpg'), 'after'),
        ('c2 pour, close cam 2.00', R('pourclose_2.00.jpg'), 'after'),
        ('c2 reel plate 6.13 (pour breaks)', f'{PC}/lip/p_6.13.jpg', 'after'),
        ('Steel 1938 11:28', f'{BEF}/ref/steel_1120_09.jpg', 'ref'),
        ('Master Hands 1936 II 05:08', f'{BEF}/ref/mh2_pour_41.jpg', 'ref'),
    ], f'{AFT}/board_pour_after.jpg'))
    made.append(board([
        ('kit c1 tapper close', f'{BEF}/raw/pourclose_1.50.jpg', 'before'),
        ('IRON v9 7.75 s crowd', f'{BEF}/key/IRON_IS_HOT_v9_7.75.jpg', 'before'),
        ('c2 pass 1 tapper (upright)', f'{RAW}/pass1/tapper_1.50.jpg', 'before'),
        ('c2b tapper: braced split stance, bar in the mould', R('tapper_1.50.jpg'), 'after'),
        ('c2 pass 1 crowd (mean 0.18)', f'{RAW}/pass1/crowd_1.50.jpg', 'before'),
        ('c2b crowd, front rank keyed by the pour', R('crowd_1.50.jpg'), 'after'),
        ('Steel 1938 13:01 tapper', f'{BEF}/ref/steel_1250_12.jpg', 'ref'),
    ], f'{AFT}/board_tappers_after.jpg'))
    made.append(board([
        ('BANK v7 21.0 pictograms', f'{BEF}/key/PEOPLES_BANK_v7_21.0.jpg', 'before'),
        ('kit c1 BANK key', f'{C1}/key_bank_2.00.jpg', 'before'),
        ('BANK v7 24.5 WE BUILD IT', f'{BEF}/key/PEOPLES_BANK_v7_24.5.jpg', 'before'),
        ('c2 pass 1 frieze (soft ovals)', f'{RAW}/pass1/bank_frieze_0.00.jpg', 'before'),
        ('c2b frieze: 3 real workers cut out, red runner', R('bank_frieze_0.00.jpg'), 'after'),
        ('c2 WE BUILD IT: MH III hammerman', R('bank_portrait_0.00.jpg'), 'after'),
    ], f'{AFT}/board_bank_after.jpg'))
    made.append(board([
        ('ALL POWER v1 21.0', f'{BEF}/key/ALL_POWER_v1_21.0.jpg', 'before'),
        ('kit c1 bucket close', f'{C1}/bucketc_1.00.jpg', 'before'),
        ('c2 pass 1 storm (jacket clipped)', f'{RAW}/pass1/storm_0.50.jpg', 'before'),
        ('c2b storm: HUMAN lineman, hi-vis modelled', R('storm_0.50.jpg'), 'after'),
        ('c2b storm: arc flash frame', R('storm_1.00.jpg'), 'after'),
    ], f'{AFT}/board_lineman_after.jpg'))
    # the 1:1 pour crop beside the film at 1:1-ish scale
    p = Image.open(R('pourclose_2.00.jpg')).convert('RGB')
    a = np.asarray(p, dtype=np.float32).mean(2)
    ys, xs = np.nonzero(a > 235)
    cx, cy = (int(np.median(xs)), int(np.median(ys))) if len(xs) else (540, 1100)
    crop = p.crop((max(0, cx - 270), max(0, cy - 480), max(0, cx - 270) + 540, max(0, cy - 480) + 960))
    refs = [Image.open(f'{BEF}/ref/{n}.jpg').convert('RGB') for n in ('steel_1120_09', 'mh2_pour_41')]
    C = Image.new('RGB', (540 * 3 + 40, 1000), (22, 22, 22))
    d = ImageDraw.Draw(C)
    C.paste(crop, (10, 30)); d.text((10, 6), 'AFTER: c2 pour, 1:1 crop of the stream', fill=(120, 230, 120), font=FONT)
    for i, r in enumerate(refs):
        C.paste(fit(r, 540, 960), (20 + 540 * (i + 1), 30)); d.text((20 + 540 * (i + 1), 6), ['REF Steel 11:28', 'REF Master Hands II 05:08'][i], fill=(240, 220, 120), font=FONT)
    C.save(f'{AFT}/crop_pour_after_1to1.jpg', quality=92)
    made.append(f'{AFT}/crop_pour_after_1to1.jpg')
    # fist turntable
    angs = [0, 45, 90, 135, 180, 225, 270, 315]
    ims = [Image.open(R(f'fist_y{a}_0.00.jpg')).convert('RGB') for a in angs if os.path.exists(R(f'fist_y{a}_0.00.jpg'))]
    T = Image.new('RGB', (8 * 270 + 90, 480 + 240 + 560 + 120), (22, 22, 22))
    d = ImageDraw.Draw(T)
    d.text((10, 6), 'AFTER: fist_sdf.js, 8 angles at 45 deg, raking key (270 px twins)', fill=(120, 230, 120), font=FONT)
    for i, im in enumerate(ims):
        T.paste(fit(im, 270, 480), (10 + i * 280, 30))
        T.paste(fit(im, 135, 240), (10 + i * 280, 520))
    if ims:
        c0 = ims[1]
        a0 = np.asarray(c0, dtype=np.float32).mean(2)
        ys, xs = np.nonzero(a0 > 60)
        cy = int(np.percentile(ys, 8)) if len(ys) else 600
        T.paste(c0.crop((270, max(0, cy - 40), 810, max(0, cy - 40) + 520)), (10, 780)); d.text((10, 760), '1:1 crop (45 deg)', fill=(120, 230, 120), font=FONT)
    if os.path.exists(R('fist_eng_0.00.jpg')):
        T.paste(fit(Image.open(R('fist_eng_0.00.jpg')), 270, 480), (580, 780)); d.text((580, 760), 'engraved on stock (burin2d)', fill=(120, 230, 120), font=FONT)
    fb = Image.open(f'{BEF}/board_fist_before.jpg').convert('RGB')
    fb = fb.resize((round(fb.width * 520 / fb.height), 520))
    T.paste(fb.crop((0, 0, min(fb.width, 8 * 280 + 80 - 880), 520)), (880, 780)); d.text((880, 760), 'BEFORE: board_fist_before (kit c1 fist, GIANT v1 27.5)', fill=(255, 110, 90), font=FONT)
    T.save(f'{AFT}/fist_turntable.jpg', quality=90)
    made.append(f'{AFT}/fist_turntable.jpg')
    # the wipe strip (-4, 0, +4, +8, +12 frames)
    ws = [('-4', 'wipe_0.87.jpg'), ('0 (accent)', 'wipe_1.00.jpg'), ('+4', 'wipe_1.13.jpg'), ('+8', 'wipe_1.27.jpg'), ('+12', 'wipe_1.40.jpg')]
    S = Image.new('RGB', (5 * 280 + 10, 34 + 480 + 34 + 240), (22, 22, 22))
    d = ImageDraw.Draw(S)
    for i, (lab, f) in enumerate(ws):
        if not os.path.exists(R(f)):
            continue
        im = Image.open(R(f))
        S.paste(fit(im, 270, 480), (10 + i * 280, 34)); S.paste(fit(im, 135, 240), (10 + i * 280, 34 + 480 + 34))
        d.text((10 + i * 280, 8), f'AFTER wipe {lab}', fill=(120, 230, 120), font=FONT)
    S2 = Image.new('RGB', (S.width, S.height + 34 + 480 + 10), (22, 22, 22)); S2.paste(S, (0, 0)); d2 = ImageDraw.Draw(S2)
    for i, f in enumerate(['wipe_0.87.jpg', 'wipe_1.00.jpg', 'wipe_1.13.jpg']):
        if os.path.exists(f'{RAW}/pass1/{f}'):
            S2.paste(fit(Image.open(f'{RAW}/pass1/{f}'), 270, 480), (10 + i * 280, S.height + 34)); d2.text((10 + i * 280, S.height + 8), 'c2 pass 1 ' + ['-4', '0', '+4'][i], fill=(255, 110, 90), font=FONT)
    S = S2
    S.save(f'{AFT}/strip_wipe_after.jpg', quality=90)
    made.append(f'{AFT}/strip_wipe_after.jpg')
    return made


def wall():
    R = lambda n: f'{RAW}/{n}'
    frames = [('1 IRON pour close, fume lit', R('pourclose_2.00.jpg'), 'FURNACE'),
              ('2 IRON tapper', R('tapper_1.50.jpg'), 'FURNACE'),
              ('3 BANK frieze', R('bank_frieze_0.00.jpg'), 'ENGRAVING'),
              ('4 BANK portrait', R('bank_portrait_0.00.jpg'), 'ENGRAVING'),
              ('5 lineman in the flood', R('storm_0.50.jpg'), 'STORM'),
              ('6 fist engraved on stock', R('fist_eng_0.00.jpg'), 'ENGRAVING'),
              ('7 Steel 1938 eruption insert, graded', f'{AFT}/reel_frames/reel_iron_c2_f0288.jpg', 'FURNACE'),
              ('8 ladle wipe +4 (cracks)', R('wipe_1.13.jpg'), 'FURNACE')]
    rows = []
    for size in (120, 270):
        h = round(size * 16 / 9)
        Wl = Image.new('RGB', (8 * (size + 8) + 8, h + 60), (22, 22, 22))
        d = ImageDraw.Draw(Wl)
        for i, (lab, p, dia) in enumerate(frames):
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert('RGB')
            Wl.paste(fit(im, size, h), (8 + i * (size + 8), 8))
            vs = vstats(im)
            if size == 270:
                rows.append({'frame': lab, 'dialect': dia, **vs, 'bright': vs['mean'] >= 0.45, 'ok_dark': vs['dark'] <= 0.60, 'file': os.path.relpath(p, V)})
            d.text((8 + i * (size + 8), h + 14), f"{vs['mean']:.2f}", fill=(120, 230, 120) if vs['mean'] >= 0.45 else (200, 200, 200), font=FONT)
        Wl.save(f'{AFT}/wall_after_{size}px.jpg', quality=90)
    nb = sum(r['bright'] for r in rows)
    with open(f'{AFT}/value_wall.txt', 'w') as f:
        f.write(f'value wall, 8 signature frames (valueStats: 135 px wide, luma mean, share < 0.15, share > 0.85). bright = mean >= 0.45. bright {nb}/8 (rule >= 3); frames over 60% near-black: {sum(not r["ok_dark"] for r in rows)}\n')
        for r in rows:
            f.write(f"{r['frame']:32s} {r['dialect']:10s} mean {r['mean']:.3f} dark {r['dark']:.3f} clip {r['clip']:.3f} {'BRIGHT' if r['bright'] else ''}  {r['file']}\n")
    return rows


def cost():
    rows = []
    for p in sorted(glob.glob(f'{RAW}/*.cost.json')) + sorted(glob.glob(f'{PC}/*/p.cost.json')) + sorted(glob.glob(f'{AFT}/*.cost.json')):
        c = json.load(open(p))
        fr = c.get('frames', [])
        if not fr:
            continue
        ms = [f.get('wall_ms') or 0 for f in fr]
        med = float(np.median(ms[1:] if len(ms) > 2 else ms))
        rows.append((os.path.relpath(p, V), c.get('query', ''), len(fr), c.get('setup_ms', 0), ms[0], med, c.get('load', [0])[0]))
    with open(f'{AFT}/cost.md', 'w') as f:
        f.write('# ART c2 cost, measured (wall ms per frame as shoot.mjs reports it; load = 1-min loadavg at the end of the job, 4 cores)\n\n')
        f.write('| job | query | frames | setup s | first frame s | median s/frame | load |\n|---|---|---|---|---|---|---|\n')
        for r in rows:
            f.write(f'| {r[0]} | `{r[1]}` | {r[2]} | {r[3] / 1000:.1f} | {r[4] / 1000:.1f} | {r[5] / 1000:.2f} | {r[6]} |\n')
    return rows


if __name__ == '__main__':
    what = sys.argv[1] if len(sys.argv) > 1 else 'all'
    if what in ('boards', 'all'):
        print(boards())
    if what in ('wall', 'all'):
        for r in wall():
            print(r)
    if what in ('cost', 'all'):
        print(len(cost()), 'cost rows')
