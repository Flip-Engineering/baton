#!/usr/bin/env python3
"""night_grade.py: grade a daylight photograph into the night (TOOLING c18, 2026-10-01; from ALL_POWER v4's two crew faces).

A daylight plate set into a night scene reads as a cut-out: flat sky-lit fill, bright shadows, neutral colour. This does the grade in one
pass on a photograph or an extracted frame, with every move a number so the piece can tune it by eye on a sheet.

    python3 videos/tools/night_grade.py grade IN OUT [--key warm|cool|none] [--dir left|right|top|bottom|front]
            [--depth 0.8] [--sat 0.55] [--lift 0.03] [--gamma 1.0] [--vignette 0.5] [--grain 0.02] [--seed 1] [--tint 0.08,0.14,0.30]
    python3 videos/tools/night_grade.py strip IN [IN...] -o strip.jpg          # day | night tiles, to judge by eye
    python3 videos/tools/night_grade.py --selftest

Moves, in order (luma-first, so the photograph's own tone survives):
 1. desaturate to --sat (night colour is nearly gone except the lamp);
 2. darken: luma is raised to a curve that holds highlights and sinks mids, then scaled by --depth (1 = daylight, 0.5 = deep night);
 3. lamp: a --key light from --dir (a soft gradient, 1.0 at the lit side to 0.35 at the far side) multiplies luma, so one side of a face is lit and
    the other falls into shadow; --key warm gives the lit side a sodium/tungsten tint, cool a moon/LED one; front is a flat centre-weighted pool;
 4. shadow tint: shadows are pulled toward --tint (rgb 0..1, default a deep blue), blended by (1 - luma)^2, so blacks are blue, not grey;
 5. --lift raises the black point a little (a printed night never reaches 0), --vignette darkens the corners, --grain adds film grain (luma, seeded).
Python API: grade(rgb_uint8, **opts) -> rgb_uint8.
Reads any PIL image; writes png/jpg by extension. Never edits in place (refuses OUT == IN). Exit 0 ok, 1 failure, 2 usage.
"""
import argparse, sys
import numpy as np
from PIL import Image

KEYS = {'warm': (1.00, 0.68, 0.38), 'cool': (0.55, 0.75, 1.00), 'none': (1.0, 1.0, 1.0)}


def luma(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def lamp_field(h, w, direction):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    x /= max(w - 1, 1); y /= max(h - 1, 1)
    if direction == 'left': t = 1 - x
    elif direction == 'right': t = x
    elif direction == 'top': t = 1 - y
    elif direction == 'bottom': t = y
    else:
        t = 1 - np.clip(np.hypot(x - .5, y - .45) / .7, 0, 1)
    t = t * t * (3 - 2 * t)
    return 0.35 + 0.65 * t


def grade(rgb, key='warm', direction='left', depth=0.8, sat=0.55, lift=0.03, gamma=1.0,
          vignette=0.5, grain=0.02, seed=1, tint=(0.08, 0.14, 0.30)):
    a = rgb[..., :3].astype(np.float32) / 255.0
    h, w = a.shape[:2]
    L = luma(a)[..., None]
    a = L + (a - L) * sat
    L = luma(a)[..., None]
    curved = np.power(np.clip(L, 0, 1), 1.0 + 0.35 * (1 - depth)) / np.maximum(L, 1e-4)
    a = a * curved * depth
    field = lamp_field(h, w, direction)[..., None]
    k = np.array(KEYS[key], np.float32)
    L = luma(a)[..., None]
    lit = a * field
    if key != 'none':                               # the lamp's colour, strongest where the lamp reaches
        a = lit * (1 + (field - .35) / .65 * (k / k.mean() - 1) * 1.2)
    else:
        a = lit
    L = luma(a)[..., None]
    t = np.array(tint, np.float32)
    sh = np.clip(1 - L * 2.5, 0, 1) ** 2
    a = a * (1 - sh * 0.5) + t * sh * 0.5 * (0.6 + L * 2)
    if gamma != 1.0:
        a = np.power(np.clip(a, 0, 1), gamma)
    a = lift + a * (1 - lift)
    if vignette > 0:
        y, x = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.hypot((x / max(w - 1, 1) - .5) * 2, (y / max(h - 1, 1) - .5) * 2) / 1.41
        a = a * (1 - vignette * np.clip(r, 0, 1) ** 2.2)[..., None]
    if grain > 0:
        n = np.random.default_rng(seed).normal(0, grain, (h, w, 1)).astype(np.float32)
        a = a + n * (0.4 + luma(a)[..., None])
    return (np.clip(a, 0, 1) * 255 + .5).astype(np.uint8)


def stats(u8):
    L = luma(u8.astype(np.float32) / 255)
    return float(np.percentile(L, 50)), float(np.percentile(L, 99)), float((L < .12).mean())


def strip(paths, out, **kw):
    tiles = []
    for p in paths:
        im = np.array(Image.open(p).convert('RGB'))
        s = 360 / im.shape[0]
        sm = np.array(Image.fromarray(im).resize((max(1, int(im.shape[1] * s)), 360)))
        tiles += [sm, grade(sm, **kw)]
    H = 360
    Image.fromarray(np.concatenate([np.pad(t, ((0, H - t.shape[0]), (0, 6), (0, 0))) for t in tiles], 1)).save(out, quality=90)


def selftest():
    h, w = 120, 160
    y, x = np.mgrid[0:h, 0:w]
    day = np.stack([200 + 30 * np.sin(x / 9), 190 + 30 * np.cos(y / 7), 170 + 0 * x], -1).clip(0, 255).astype(np.uint8)
    night = grade(day)
    m0, p0, _ = stats(day); m1, p1, c1 = stats(night)
    assert m1 < 0.7 * m0, ('median not darkened', m0, m1)
    assert night.shape == day.shape and night.dtype == np.uint8
    assert (grade(day) == night).all(), 'not deterministic'
    # lit side brighter than far side; warm lit side redder than blue-biased shadow
    L = luma(night.astype(np.float32) / 255)
    assert L[:, :40].mean() > L[:, -40:].mean() * 1.3, 'lamp direction missing'
    nr = grade(day, key='warm', vignette=0, grain=0)
    assert nr[:, :40, 0].mean() > nr[:, :40, 2].mean(), 'warm key not warm'
    nc = grade(day, key='cool', vignette=0, grain=0)
    assert nc[:, :40, 2].mean() > nc[:, :40, 0].mean(), 'cool key not cool'
    print('selftest ok: median %.2f -> %.2f, p99 %.2f -> %.2f' % (m0, m1, p0, p1))


def main():
    if '--selftest' in sys.argv: return selftest()
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd')
    def opts(p):
        p.add_argument('--key', default='warm', choices=list(KEYS)); p.add_argument('--dir', default='left', dest='direction',
                       choices=['left', 'right', 'top', 'bottom', 'front'])
        p.add_argument('--depth', type=float, default=.8); p.add_argument('--sat', type=float, default=.55)
        p.add_argument('--lift', type=float, default=.03); p.add_argument('--gamma', type=float, default=1.0)
        p.add_argument('--vignette', type=float, default=.5); p.add_argument('--grain', type=float, default=.02)
        p.add_argument('--seed', type=int, default=1); p.add_argument('--tint', default='0.08,0.14,0.30')
    g = sp.add_parser('grade'); g.add_argument('i'); g.add_argument('o'); opts(g)
    s = sp.add_parser('strip'); s.add_argument('i', nargs='+'); s.add_argument('-o', required=True); opts(s)
    a = ap.parse_args()
    if not a.cmd: ap.print_usage(); return 2
    kw = dict(key=a.key, direction=a.direction, depth=a.depth, sat=a.sat, lift=a.lift, gamma=a.gamma, vignette=a.vignette,
              grain=a.grain, seed=a.seed, tint=tuple(float(v) for v in a.tint.split(',')))
    if a.cmd == 'grade':
        if a.i == a.o: print('refusing to overwrite the input', file=sys.stderr); return 2
        im = np.array(Image.open(a.i).convert('RGB')); out = grade(im, **kw)
        Image.fromarray(out).save(a.o, quality=95)
        m, p, c = stats(out); print('%s: median %.2f p99 %.2f crushed %.0f%%' % (a.o, m, p, 100 * c))
    else:
        strip(a.i, a.o, **kw); print(a.o)
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
