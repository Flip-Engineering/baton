"""Demo sheets for the PRINT AND FILM LAB (python3 tools/printlab/sheets.py SRC_DIR PAGE_DIR OUT_DIR [only]).

One sheet per process, all on the same neutral material: the 1940s FSA/OWI Kodachrome 'girl with doll' (LOC
fsac-1a34429), the neutral type set (WOOD TYPE / Specimen / of Printing Types, 1874 in Ultra wood letter and IM Fell
metal), and the critic's chart. Each sheet puts the real thing first where a scan of it exists (the untouched Kodachrome
scan, the Atkins cyanotype, a page of the 1874 Page wood-type specimen).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from engine.printlab import chart, core, film, press as P, sorts  # noqa: E402

SRC, PAGES, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
ONLY = sys.argv[4].split(',') if len(sys.argv) > 4 else None
os.makedirs(OUT, exist_ok=True)
PW, PH = 540, 960
LABEL = ImageFont.truetype(os.path.join(chart.FONTS, 'ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff'), 17)


def panel(img, title):
    a = core.to_u8(img) if img.dtype != np.uint8 else img
    im = Image.fromarray(a).resize((PW, int(PW * a.shape[0] / a.shape[1])), Image.LANCZOS) if a.shape[1] != PW else Image.fromarray(a)
    if im.height > PH: im = im.crop((0, 0, PW, PH))
    c = Image.new('RGB', (PW, PH + 64), (18, 18, 18)); c.paste(im, (0, 64))
    d = ImageDraw.Draw(c)
    for i, line in enumerate(title.split('\n')[:3]): d.text((10, 6 + i * 19), line, font=LABEL, fill=(230, 230, 230))
    return c


def crop1x(img, x, y, w=PW, h=PH):
    return img[y:y + h, x:x + w]


def save(name, panels):
    w = sum(p.width for p in panels); s = Image.new('RGB', (w, PH + 64), (0, 0, 0)); x = 0
    for p in panels: s.paste(p, (x, 0)); x += p.width
    s.save(os.path.join(OUT, name), quality=88); print('wrote', name, flush=True)


girl = chart.archival('girl', SRC)
CH = chart.chart()


def type_forme(cam, seed=3):
    F = sorts.set_line('WOOD', cam, 14, 70, lines=9, face='ultra', seed=seed)
    F = sorts.set_line('TYPE', cam, 14, 112, lines=9, face='ultra', seed=seed + 1, forme=F)
    F = sorts.merge(F, sorts.set_line('Specimen', cam, 14, 160, lines=4, face='fell', material='metal', seed=seed + 2))
    F = sorts.merge(F, sorts.set_line('of Printing Types, 1874', cam, 14, 185, lines=1.6, face='fell', material='metal', seed=seed + 3))
    return F


def type_page(cam=None, pressure=0.45):
    cam = cam or P.Camera(view_mm=200)
    sh = P.paper('book1874', cam, seed=2)
    a = P.letterpress(sh, type_forme(cam), ink='black1874', pressure=pressure)
    return P.letterpress(a, sorts.set_line('No. 5', cam, 120, 200, lines=3, face='ultra', seed=9), ink='vermilion', misreg=(0.6, -0.3, 0.2))


def want(k): return ONLY is None or k in ONLY


# ---------------------------------------------------------------- film sheets
TYPECARD = None
if any(want(k) for k in ['kodachrome25', 'trix7266', 'technicolor_ib', 'orwocolor', 'nitrate_bw', 'letterpress']):
    TYPECARD = type_page().srgb()
FILMS = [('kodachrome25', 'still135', dict(), 'Kodachrome 25, 35 mm slide (E-55 curves, RMS 9)'),
         ('kodachrome25', '16mm', dict(), 'the same emulsion on 16 mm (2x the film per pixel)'),
         ('trix7266', '16mm', dict(), 'Tri-X Reversal 7266, 16 mm (datasheet curve, grain vs D)'),
         ('technicolor_ib', '35mm', dict(), 'Technicolor three-strip + IB dye transfer (EST curves)'),
         ('orwocolor', '35mm', dict(fade_years=35), 'ORWOCOLOR neg + print, 35 years of dye fade (EST)'),
         ('nitrate_bw', '35mm', dict(), '35 mm nitrate b/w, pan neg -> positive print')]
for st, gauge, kw, title in FILMS:
    key = st if gauge != '16mm' or st != 'kodachrome25' else 'kodachrome25_16mm'
    if not want(st): continue
    g = film.develop(girl, st, frame=5, gauge=gauge, source_gamma=1.8, **kw)
    t = film.develop(TYPECARD, st, frame=6, gauge=gauge, **kw)
    c = film.develop(CH, st, frame=7, gauge=gauge, headroom=6, **kw)
    panels = [panel(girl, 'REAL: LOC fsac-1a34429, untouched\n1940s Kodachrome scan (the bar)'),
              panel(g, f'{title}\nsame scan, de-rendered (source_gamma 1.8)'),
              panel(t, f'the type set, letterpress-printed,\nthen filmed on {gauge}'),
              panel(c, 'chart: 21-step tablet, ColorChecker,\nramps, line pairs, point source x6'),
              panel(crop1x(g, 330, 160), '1:1 crop (grain, MTF at real scale)')]
    if st == 'nitrate_bw':
        for stage in (1.5, 2.6, 3.6, 4.4):
            panels.append(panel(film.develop(girl, st, frame=5, source_gamma=1.8, decay=stage), f'decay stage {stage}\n(fade, sticky, bubbles, froth, powder)'))
    save(f'sheet_film_{key}.jpg', panels)

# ---------------------------------------------------------------- print sheets
L = P.tone(girl)
if want('letterpress'):
    pg = np.asarray(Image.open(os.path.join(PAGES, 'ldpd_10147342_000_0024.jp2')).convert('RGB'), np.float32) / 255
    macro = type_page(P.Camera(view_mm=40, x_mm=20, y_mm=40)).srgb()
    lowp = type_page(P.Camera(view_mm=40, x_mm=20, y_mm=40), pressure=0.28).srgb()
    save('sheet_print_letterpress.jpg', [
        panel(pg, 'REAL: Wm. H. Page & Co., Specimens of\nChromatic Wood Type, 1874 (p.24)'),
        panel(TYPECARD, 'the type set as sorts, pulled: black 1874\n(measured), vermilion pass 0.6 mm off'),
        panel(macro, 'camera 40 mm across the sheet: salt from\npaper pits, per-sort figure, squash rim'),
        panel(lowp, 'same forme, pressure 0.28 (a kiss):\nlow sorts and paper pits go unprinted'),
        panel(crop1x(macro, 200, 500), '1:1')])
if want('riso'):
    cam = P.Camera(view_mm=180); sh = P.paper('riso_bond', cam, 3)
    warm = P.levels(np.clip(girl[..., 0] - girl[..., 2], 0, 1), 0.5, 0.995)
    r = P.riso(sh, (1 - L) * 0.92, ink='riso_federal_blue')
    r = P.riso(r, warm, ink='riso_fluo_pink', misreg=(0.7, -0.4, 0.15)).srgb()
    F = type_forme(P.Camera(view_mm=200))
    camt = P.Camera(view_mm=200); t = P.riso(P.paper('riso_bond', camt, 3), F['face'], ink='riso_federal_blue')
    t = P.riso(t, sorts.set_line('No. 5', camt, 120, 200, lines=3, face='ultra')['face'], ink='riso_fluo_pink', misreg=(0.8, -0.5, 0.2)).srgb()
    camm = P.Camera(view_mm=25, x_mm=80, y_mm=40); m = P.riso(P.paper('riso_bond', camm, 3), np.asarray(Image.fromarray(core.to_u8(1 - L)).crop((480, 213, 630, 480)).resize((1080, 1920), Image.BICUBIC), np.float32) / 255 * 0.92, ink='riso_federal_blue').srgb()
    save('sheet_print_riso.jpg', [panel(r, 'riso: Federal Blue + Fluorescent Pink\n300 dpi FM master, drums 0.8 mm adrift'),
                                  panel(t, 'the type set on two drums'), panel(m, 'camera 25 mm across: the master\'s\nstochastic dots appear'),
                                  panel(crop1x(r, 300, 200), '1:1 at 180 mm (dots integrate to tone)')])
if want('silkscreen'):
    cam = P.Camera(view_mm=300); s = P.paper('poster', cam, 4)
    q = np.quantile(L, [0.18, 0.45, 0.75])
    for thr, ink, mr in [(1.01, 'screen_cream', None), (q[2], 'screen_ochre', (0.3, 0.2)), (q[1], 'screen_red', (-0.4, 0.3, 0.1)), (q[0], 'screen_black', (0.2, -0.3))]:
        s = P.silkscreen(s, (core.blur((L < thr).astype(np.float32), 3) > 0.5).astype(np.float32), ink=ink, misreg=mr)
    camt = P.Camera(view_mm=200); F = type_forme(camt)
    t = P.silkscreen(P.paper('poster', camt, 4), F['face'], ink='screen_red', tusche=0.0)
    t2 = P.silkscreen(P.paper('poster', camt, 4), F['face'], ink='screen_blue_tr')
    t2 = P.silkscreen(t2, sorts.set_line('WOOD', camt, 22, 78, lines=9, face='ultra')['face'], ink='screen_pink_tr').srgb()
    camm = P.Camera(view_mm=6, x_mm=18, y_mm=45); mm_ = P.silkscreen(P.paper('poster', camm, 4), type_forme(camm)['face'], ink='screen_red').srgb()
    save('sheet_print_silkscreen.jpg', [panel(s.srgb(), 'silkscreen: 4 opaque stencils (cream,\nochre, red, black), 150 t/in, off register'),
                                        panel(t.srgb(), 'the type set, hand-cut film stencil,\nopaque red'),
                                        panel(t2, 'transparent inks overprinted\n(Corita-style): blue + pink'),
                                        panel(mm_, 'camera 6 mm across: the mesh saw-tooth\non the letter edge (150 threads/in)')])
if want('cyanotype'):
    ref = np.asarray(Image.open(os.path.join(SRC, 'ref_atkins_spiraea_1200.jpg')).convert('RGB'), np.float32) / 255
    cam = P.Camera(view_mm=200); sh = P.paper('whatman', cam, 5)
    tr = np.power(1 - L, 1.8)   # a contact negative made dense for cyanotype (its long exposure scale)
    states = [(0.0, 0.0, 'exposed, before the wash'), (0.5, 0.0, 'the wash front halfway'), (1.0, 0.0, 'washed'), (1.0, 1.0, 'a day later (oxidised)')]
    pans = [panel(ref, 'REAL: Anna Atkins, Spiraea aruncus,\ncyanotype 1851-54 (Met 285421, CC0)')]
    for w_, ox, nm in states:
        pans.append(panel(P.cyanotype(sh, tr, dose=1.7, wash=w_, oxidise=ox).srgb(), f'cyanotype contact print: {nm}\n(colour + Dmax measured from Atkins)'))
    camt = P.Camera(view_mm=200)
    pans.append(panel(P.cyanotype(P.paper('whatman', camt, 5), 1 - type_forme(camt)['face'] * 0.96, dose=1.7).srgb(), 'the type set as a photogram: the sorts\nlaid on the coated sheet, as Atkins laid leaves'))
    save('sheet_print_cyanotype.jpg', pans)
if want('gravure'):
    cam = P.Camera(view_mm=200); g = P.gravure(P.paper('supercal', cam, 6), 1 - L)
    camt = P.Camera(view_mm=200); F = type_forme(camt)
    t = P.gravure(P.paper('supercal', camt, 6), F['face'] * 0.97 + 0.0, ink='green_gravure')
    camm = P.Camera(view_mm=10, x_mm=14, y_mm=50); mm_ = P.gravure(P.paper('supercal', camm, 6), type_forme(camm)['face'] * 0.97, ink='green_gravure').srgb()
    camg = P.Camera(view_mm=12, x_mm=75, y_mm=30)
    Lc = np.asarray(Image.fromarray(core.to_u8(L)).crop((405, 180, 470, 296)).resize((1080, 1920), Image.BICUBIC), np.float32) / 255
    gm = P.gravure(P.paper('supercal', camg, 6), 1 - Lc).srgb()
    save('sheet_print_gravure.jpg', [panel(g.srgb(), 'rotogravure: 150 lpi, equal-area cells\nof variable depth, sepia on supercal.'),
                                     panel(t.srgb(), 'the type set in green-black gravure\n(whole page: continuous, crisp)'),
                                     panel(mm_, 'camera 10 mm across: saw-tooth type\nedges, faint walls in the solid'),
                                     panel(gm, 'camera 12 mm across the face: cells\nof depth, light tones snowflake')])
