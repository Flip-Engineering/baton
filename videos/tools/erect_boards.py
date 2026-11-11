#!/usr/bin/env python3
"""MODELING c4 boards: the ERECTOR giant after, beside c3's FRAME before. Every board at full size plus a 270 px row (the phone
feed width). Inputs: review/studio_modeling_c4/after/{turn,hero,clips,work} and before/work. Skips a board whose inputs are missing.

  python3 tools/erect_boards.py [names...]   (default: all)
"""
import os, sys, subprocess, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

V = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
A = os.path.join(V, 'review', 'studio_modeling_c4', 'after'); B = os.path.join(V, 'review', 'studio_modeling_c4', 'before', 'work')
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
BG, INK, INK2 = (236, 234, 228), (20, 20, 20), (82, 81, 78)
def font(sz, bold=False):
    for f in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F1, F2, F3 = font(30, True), font(19), font(16)
def P(*a): return os.path.join(*a)
def im(p, w=None, h=None):
    if not os.path.exists(p): return None
    x = Image.open(p).convert('RGB')
    if w and h: x = x.resize((w, h), Image.LANCZOS)
    elif w: x = x.resize((w, round(x.height * w / x.width)), Image.LANCZOS)
    return x
def frame_at(mp4, t, w=None):
    out = P(A, 'work', f'_f_{os.path.basename(mp4)}_{t:.2f}.jpg')
    if not os.path.exists(out):
        r = subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', f'{t:.3f}', '-i', mp4, '-frames:v', '1', '-q:v', '2', out])
        if r.returncode or not os.path.exists(out): return None   # a clip still rendering (no index yet)
    return im(out, w)
def board(title, sub, cells, cols, cw, ch, cap_h=46, pad=14, foot=None):
    rows = (len(cells) + cols - 1) // cols, ; rows = rows[0]
    W = pad + cols * (cw + pad); H = 130 + rows * (ch + cap_h + pad) + (foot[1] if foot else 0)
    c = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(c); d.text((pad, 14), title, font=F1, fill=INK)
    words, cur, ln = sub.split(' '), '', 0
    for wd in words + ['\0']:
        if wd == '\0' or (d.textlength(cur + ' ' + wd, font=F3) > W - 2 * pad and cur): d.text((pad, 52 + ln * 19), cur, font=F3, fill=INK2); ln += 1; cur = wd if wd != '\0' else ''
        else: cur = (cur + ' ' + wd).strip()
    for i, (img, cap) in enumerate(cells):
        x, y = pad + (i % cols) * (cw + pad), 120 + (i // cols) * (ch + cap_h + pad)
        if img is not None: c.paste(img.resize((cw, ch), Image.LANCZOS) if img.size != (cw, ch) else img, (x, y))
        else: d.rectangle([x, y, x + cw, y + ch], outline=INK2)
        lines = []
        for k, para in enumerate(cap.split('\n')):
            words, cur = para.split(' '), ''
            for wd in words:
                if d.textlength(cur + ' ' + wd, font=F3) > cw and cur: lines.append((cur, k)); cur = wd
                else: cur = (cur + ' ' + wd).strip()
            lines.append((cur, k))
        for j, (line, k) in enumerate(lines[:max(2, cap_h // 20)]): d.text((x, y + ch + 4 + j * 19), line, font=F3, fill=INK if k == 0 else INK2)
    if foot: c.paste(foot[0], (pad, H - foot[1]))
    return c
def strip270(imgs, label):
    w = 270; hs = [round(i.height * w / i.width) for i in imgs if i is not None]; h = max(hs) if hs else 480
    c = Image.new('RGB', (14 + len(imgs) * (w + 10), h + 40), BG); d = ImageDraw.Draw(c); d.text((14, 6), label, font=F3, fill=INK2)
    for k, i in enumerate(imgs):
        if i is not None: c.paste(i.resize((w, round(i.height * w / i.width)), Image.LANCZOS), (14 + k * (w + 10), 30))
    return c
def save(c, name): c.save(P(A, name), quality=90); print('wrote', name, c.size)
def stats(img):
    """value and colour measures for the before/after (my own: luminance percentiles and mean chroma in CIELAB / 100)"""
    a = np.asarray(img.convert('RGB')).astype(np.float32) / 255
    lin = np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)
    Y = lin @ np.array([.2126, .7152, .0722]); L = np.where(Y > .008856, 116 * np.cbrt(Y) - 16, 903.3 * Y) / 100
    X = lin @ np.array([.4124, .3576, .1805]) / .9505; Z = lin @ np.array([.0193, .1192, .9505]) / 1.089
    f = lambda t: np.where(t > .008856, np.cbrt(t), 7.787 * t + 16 / 116)
    aa, bb = 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))
    return dict(p2=float(np.percentile(L, 2)), p98=float(np.percentile(L, 98)), chroma=float(np.mean(np.hypot(aa, bb)) / 100))
def notan(img, w=270):
    g = np.asarray(img.convert('L').resize((w, round(img.height * w / img.width)))).astype(np.float32) / 255
    o = np.where(g < .33, 30, np.where(g < .66, 128, 225)).astype(np.uint8); return Image.fromarray(o).convert('RGB')

def b01():
    views = [0, 45, 90, 135, 180, 225, 270, 315]; cells = [(im(P(A, 'turn', f'turn_{v:03d}.jpg')), f'{v} deg' + ('  (front)' if v == 0 else '  (back)' if v == 180 else '')) for v in views]
    if not all(c[0] for c in cells): return
    s = strip270([c[0] for c in cells] + [im(P(A, 'turn', 'sil_030.jpg'))], 'the same at 270 px (phone feed width), with the silhouette')
    save(board('MODELING c4 after 01: ERECTOR, turnaround (finished, standing at work)', 'FRAME developed deep: riveted angle-iron lattice limbs, plate hung by plan (painted / left in red lead / not hung), plate-girder shoulder beam with walkway and lamp masts, cab behind the chest portal, power house and stacks on the back. 52 m to the beam top.',
               cells, 4, 540, 960, foot=(s, s.height + 10)), '01_turnaround.jpg')
def b02():
    names = [('mat_shin', 'shin: lattice (angle chords, X lacing, gussets, battens), greave plates, a red-lead repair course'), ('mat_knee', 'knee: pinned bearing in cheek plates, knee pad worn to bare steel, twin rams'),
             ('mat_chest', 'chest: the portal, the cab glazing, ring girders and decks, the one red mark plate'), ('mat_beam', 'shoulder beam: plate girder, stiffeners, flange angles, lamps, stencils'),
             ('mat_hand', 'forearm and hand: plated box, chipped to primer at the edges, knuckle pins'), ('mat_foot', 'foot: plated box on a grousered sole, mud thrown up it, hazard band on the toe')]
    cells = []
    for n, cap in names:
        x = im(P(A, 'turn', n + '.jpg'))
        if x is None: return
        # the 1:1 window with the most detail (local contrast), not the centre
        g = np.asarray(x.convert('L').resize((108, 192))).astype(np.float32); best, bx, by = -1, 27, 48
        for yy in range(0, 192 - 96 + 1, 6):
            for xx in range(0, 108 - 54 + 1, 6):
                win = g[yy:yy + 96, xx:xx + 54]; v = float(np.std(win)) + .5 * float(np.mean(np.abs(np.diff(win, axis=1))))
                if v > best: best, bx, by = v, xx, yy
        cells.append((x.crop((bx * 10, by * 10, bx * 10 + 540, by * 10 + 960)), n.replace('mat_', '') + ' (1:1 crop of 1080x1920)\n' + cap))
    # (cap_h below leaves room for wrapped captions)
    # notan: before (c3 FRAME) vs after, three values, plus measures
    bf, af = im(P(B, 'FULL_tile_FRAME_three.jpg')), im(P(A, 'turn', 'turn_045.jpg'))
    if bf and af:
        sb, sa = stats(bf), stats(af)
        cells.append((notan(bf, 540).resize((540, 960)), f"c3 FRAME, three values\nluminance p2-p98 {sb['p2']:.2f}-{sb['p98']:.2f}, chroma {sb['chroma']:.3f}"))
        cells.append((notan(af, 540).resize((540, 960)), f"c4 ERECTOR, three values\nluminance p2-p98 {sa['p2']:.2f}-{sa['p98']:.2f}, chroma {sa['chroma']:.3f}"))
    save(board('MODELING c4 after 02: materials and values', 'One stack on every steel part (steel.js): red-lead primer -> top coat chipped at the flame-cut edges -> rivet rows -> rust runs from rivets and laps -> cavity grime from designed occlusion -> ground mud -> joint oil -> snow on what faces up. Dark matte iron against a light sky.',
               cells, 4, 540, 960, cap_h=86), '02_materials.jpg')
def b03():
    mp4 = P(A, 'clips', 'build_sequence.mp4'); mp4 = mp4 if os.path.exists(mp4) else P(A, 'clips', 'build_sequence_720.mp4')
    if not os.path.exists(mp4): return
    ts = [.5, 2.0, 3.5, 5.0, 6.3, 7.6, 9.0, 10.4, 12.6]; cells = [(frame_at(mp4, t, 540), f't {t:.1f} s') for t in ts]
    full = [(im(P(A, 'hero', f'build{u}_1080.jpg')), f'build {u}% (1080x1920 still)') for u in ('30', '62', '88')]
    s = strip270([c[0] for c in cells], 'the build at 270 px')
    save(board('MODELING c4 after 03: the build sequence (time-lapse, 13 s)', 'Erection order, footings up. Big members come by crane (one lift per crane, slung to the hook); small ones are bolted from the scaffold. Erection towers round the legs, shoring under the beam until the arms are pinned, trestles under the hands; red lead is the construction front; struck in order.',
               cells + [c for c in full if c[0]], 4, 540, 960, foot=(s, s.height + 10)), '03_build_sequence.jpg')
def b04():
    mp4 = P(A, 'clips', 'kneel_stand.mp4'); mp4 = mp4 if os.path.exists(mp4) else P(A, 'clips', 'kneel_stand_720.mp4')
    if not os.path.exists(mp4): return
    ts = [.5, 2.0, 2.95, 3.5, 4.4, 5.3, 5.72, 6.0, 6.6, 7.4, 8.4, 9.4]; cells = [(frame_at(mp4, t, 540), f't {t:.2f} s' + {2.95: '  knee leaves the ground', 5.72: '  the plant', 6.0: '  dust, clods, shake', 7.4: '  snow slides off the beam', 9.4: '  the powder curtain'}.get(t, '')) for t in ts]
    s = strip270([c[0] for c in cells], 'at 270 px')
    save(board('MODELING c4 after 04: kneel to stand, with a foot-plant scale event (9.8 s, sound)', 'Three cuts, all low and part-hidden. Knee pinned to the ground while the hip swings over it; weight over the front foot; up on the left leg; the right foot steps through and PLANTS: dust rolls out, clods fall at g, the camera takes a ground jolt, snow slides off the beam and streams down as a powder curtain.',
               cells, 6, 360, 640, foot=(s, s.height + 10)), '04_kneel_stand.jpg')
def b05():
    mp4 = P(A, 'clips', 'girder_carry.mp4'); mp4 = mp4 if os.path.exists(mp4) else P(A, 'clips', 'girder_carry_720.mp4')
    if not os.path.exists(mp4): return
    ts = [.5, 2.5, 4.4, 6.0, 7.4, 9.0, 10.4, 11.2, 11.7, 13.2]; cells = [(frame_at(mp4, t, 540), f't {t:.1f} s') for t in ts]
    s = strip270([c[0] for c in cells], 'at 270 px')
    save(board('MODELING c4 after 05: the giant at work, setting a girder (13.4 s, sound)', 'A 26 m riveted plate girder (240 t, new steel in red lead) staged on timber trestles: crouch, grip it by the ends, stand with it (the load hangs from straight arms and the COM stays over the feet), raise it clear, across, and down onto two new columns where their crews wait.',
               cells, 5, 432, 768, foot=(s, s.height + 10)), '05_girder.jpg')
def b06():
    h = im(P(A, 'hero', 'hero_1080.jpg'))
    if h is None: return
    crops = [(h.crop((300, 1460, 840, 1920)), '1:1: HUMAN workers (people.js), not mannequins'), (h.crop((300, 380, 840, 840)), '1:1: the chest, cab, mark plate, the girder in the hands')]
    c = Image.new('RGB', (1080 + 540 + 270 + 60, 2060), BG); d = ImageDraw.Draw(c)
    d.text((14, 14), 'MODELING c4 after 06: the hero frame (1080x1920)', font=F1, fill=INK); d.text((14, 56), 'Low sun behind, haze, steam; the yard worked (snow over mud, ruts, footprints, puddles); cranes, trucks, stock, trestles; the giant at work.', font=F3, fill=INK2)
    c.paste(h, (14, 100)); y = 100
    for img, cap in crops: c.paste(img, (1110, y)); d.text((1110, y + img.height + 4), cap, font=F3, fill=INK2); y += img.height + 40
    c.paste(h.resize((270, 480), Image.LANCZOS), (1110, y)); d.text((1110, y + 484), 'at 270 px', font=F3, fill=INK2)
    hp = im(P(A, 'hero', 'hero_1080_paint.jpg'))
    if hp is not None: c.paste(hp.resize((270, 480), Image.LANCZOS), (1110 + 290, y)); d.text((1110 + 290, y + 484), 'option: oil print (paint.js)', font=F3, fill=INK2)
    save(c, '06_hero.jpg')
def b07():
    pairs = [('tile_FRAME_three.jpg', P(A, 'turn', 'turn_045.jpg'), 'three-quarter'), ('tile_FRAME_low.jpg', P(A, 'hero', 'low_1080.jpg'), 'low'),
             ('build_FRAME_30.jpg', P(A, 'hero', 'build30_1080.jpg'), 'build at 0.30'), ('site_FRAME_yard.jpg', P(A, 'hero', 'hero_1080.jpg'), 'the site'),
             ('tile_FRAME_carry.jpg', None, 'carrying'), ('reveal_FRAME_t6.jpg', None, 'the reveal / the stand')]
    cm = P(A, 'clips', 'girder_carry.mp4'); km = P(A, 'clips', 'kneel_stand.mp4')
    cells = []; meas = []
    for bf, af, lab in pairs:
        b = im(P(B, bf)); a = im(af) if af else (frame_at(cm, 8.6) if lab == 'carrying' and os.path.exists(cm) else frame_at(km, 7.2) if os.path.exists(km) else None)
        if b is None or a is None: continue
        sb, sa = stats(b), stats(a); meas.append((lab, sb, sa))
        cells += [(b, f'before (c3 FRAME): {lab}\nL {sb["p2"]:.2f}-{sb["p98"]:.2f}, chroma {sb["chroma"]:.3f}'), (a, f'after (c4 ERECTOR): {lab}\nL {sa["p2"]:.2f}-{sa["p98"]:.2f}, chroma {sa["chroma"]:.3f}')]
    s = strip270([c[0] for c in cells], 'the same pairs at 270 px')
    save(board('MODELING c4 07: before and after, against c3 FRAME', 'Before: fresh renders of c3 FRAME by the c4 critic (before/work). After: this round. Measures are mine: CIELAB lightness percentiles 2-98 and mean chroma/100 over the frame.',
               cells, 4, 405, 720, cap_h=50, foot=(s, s.height + 10)), '07_before_after.jpg')
    json.dump([{'shot': l, 'before': b, 'after': a} for l, b, a in meas], open(P(A, 'work', 'value_measures.json'), 'w'), indent=1)
ALL = {'01': b01, '02': b02, '03': b03, '04': b04, '05': b05, '06': b06, '07': b07}
if __name__ == '__main__':
    for k in (sys.argv[1:] or ALL):
        ALL[k]()
