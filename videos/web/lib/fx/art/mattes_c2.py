"""ART c2b: cut real 1936-38 workers out of their film frames for the BANK frieze (burin2d.vignetteFrieze).
GrabCut (OpenCV) seeded by a rectangle and a few hand strokes per figure; the film's dark shop background goes to
paper so the engraving carries the FIGURE, not the murk around it (c2's soft ovals engraved the background too and
read as a moire photo). Busts fade out at the bottom as a banknote portrait does.

  python3 web/lib/fx/art/mattes_c2.py      -> review/studio_art_c2/after/mattes/<name>.png (grey + alpha) and sheet.jpg

Sources (public domain; log in the piece's source log): Steel: Man's Servant (1938, US Steel, PD Mark 1.0) 13:01;
Master Hands (1936, Jam Handy / Chevrolet, PD) Part III 00:48 and 00:34.
"""
import os
import cv2
import numpy as np

V = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
REF = f'{V}/review/studio_art_c2/before/ref'
OUT = f'{V}/review/studio_art_c2/after/mattes'

# name: (source, rect x0,y0,x1,y1, fg strokes [(x0,y0,x1,y1)], bg strokes, bust fade (y0, y1) as fractions or None)
FIGS = {
    'tapper_steel1938': ('steel_1250_12', (60, 20, 700, 720), [(330, 150, 360, 300), (300, 330, 360, 640), (360, 70, 400, 110)], [(760, 0, 960, 720), (0, 0, 60, 720), (560, 520, 960, 720), (440, 0, 520, 140), (290, 0, 335, 60)], None, {}),
    'glasses_mh1936': ('mh3_forge_21', (40, 0, 620, 480), [(230, 150, 420, 300), (200, 60, 420, 110)], [(0, 0, 40, 480), (600, 0, 640, 480), (150, 0, 242, 290), (505, 110, 640, 300)], (0.55, 1.0), {'ell': (360, 470, 290, 190), 'top': 0.1}),
    'kerchief_mh1936': ('mh3_forge_14', (150, 30, 640, 480), [(300, 150, 380, 260), (380, 300, 520, 440)], [(0, 0, 150, 480), (0, 0, 640, 25)], (0.75, 1.0), {}),
    'smile_mh1936': ('mh2_faces_03', (230, 110, 640, 480), [(470, 240, 580, 340), (470, 140, 600, 200), (350, 330, 520, 460)], [(0, 0, 220, 480), (230, 0, 640, 105), (300, 110, 440, 230)], (0.6, 1.0), {'ell': (470, 480, 220, 130), 'left': (230, 400)}),
}


def cut(name, src, rect, fg, bg, fade, extra=None):
    extra = extra or {}
    im = cv2.imread(f'{REF}/{src}.jpg')
    h, w = im.shape[:2]
    mask = np.full((h, w), cv2.GC_BGD, np.uint8)
    x0, y0, x1, y1 = rect
    mask[y0:y1, x0:x1] = cv2.GC_PR_FGD
    for a, b, c, d in bg:
        mask[b:d, a:c] = cv2.GC_BGD
    for a, b, c, d in fg:
        mask[b:d, a:c] = cv2.GC_FGD
    # the dark shop: anything near black inside the rect is probably background
    L = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    dark = (L < 22) & (mask == cv2.GC_PR_FGD)
    mask[dark] = cv2.GC_PR_BGD
    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(im, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
    a = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
    # keep the largest component, fill holes, soften 1.5 px
    n, lab, st, _ = cv2.connectedComponentsWithStats(a)
    if n > 1:
        k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        a = np.where(lab == k, 255, 0).astype(np.uint8)
    if 'ell' in extra:   # a bust's shoulders in a dark jacket: forced in (grabCut cannot tell them from the shop)
        cx, cy, rx, ry = extra['ell']
        e = np.zeros_like(a); cv2.ellipse(e, (cx, cy), (rx, ry), 0, 0, 360, 255, -1); a = np.maximum(a, e)
    a = cv2.morphologyEx(a, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    a = cv2.GaussianBlur(a, (0, 0), 1.5)
    if fade:
        f0, f1 = int(fade[0] * h), int(fade[1] * h)
        ramp = np.ones(h, np.float32)
        ramp[f0:f1] = np.linspace(1, 0, f1 - f0) ** 1.4
        ramp[f1:] = 0
        a = (a * ramp[:, None]).astype(np.uint8)
    if extra.get('left'):   # a vignette edge: fade in from the left over [x0, x1]
        x0, x1 = extra['left']; ramp = np.ones(w, np.float32); ramp[:x0] = 0; ramp[x0:x1] = np.linspace(0, 1, x1 - x0) ** 1.3
        a = (a * ramp[None, :]).astype(np.uint8)
    if extra.get('top'):
        t1 = int(extra['top'] * h); ramp = np.ones(h, np.float32); ramp[:t1] = np.linspace(0, 1, t1) ** 1.2
        a = (a * ramp[:, None]).astype(np.uint8)
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    out = np.dstack([g, g, g, a])
    cv2.imwrite(f'{OUT}/{name}.png', out)
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    tiles = []
    for n, spec in FIGS.items():
        o = cut(n, *spec)
        a = o[..., 3:4].astype(np.float32) / 255
        comp = (o[..., :3] * a + 235 * (1 - a)).astype(np.uint8)
        tiles.append(cv2.resize(comp, (int(comp.shape[1] * 360 / comp.shape[0]), 360)))
        print(n, o.shape, 'fg share', round(float((o[..., 3] > 128).mean()), 3))
    cv2.imwrite(f'{OUT}/sheet.jpg', np.hstack(tiles))
