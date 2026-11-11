#!/usr/bin/env python3
"""plate_tone.py: levels for source plates, photographs and archive film frames (TOOLING c12, 2026-10-01).

ACCELERATE c10: "archive film still comes out as dim halftone". Dim, low-contrast sources (newsreel, NASA film scans, 1890s prints) can lose most of
their tone when a look ramps them to two or three colours or a halftone. This reads a plate's tonal range BEFORE the look, suggests levels, and
writes a before | after strip with histograms; whether a plate needs lifting is judged on the strip. `fix` writes a copy at the levels the builder
dials, so the piece's own look starts from it. Nothing here is a gate or a verdict, and it never edits an asset in place.

    python3 videos/tools/plate_tone.py report A.jpg B.png clip.mp4 [--every 2.0] [--json out.json]
    python3 videos/tools/plate_tone.py strip IN [IN...] -o strip.jpg [--black B --white W --gamma G | --target-mid M]   # before | after tiles
    python3 videos/tools/plate_tone.py fix IN OUT [--black B --white W --gamma G | --target-mid M] [--gamma-only]  # one image, or an mp4
    python3 videos/tools/plate_tone.py --selftest

report: per plate (a video is sampled every --every seconds, and reported as its darkest and median frames): luma percentiles p1/p50/p99, the share of
pixels under 0.12 and over 0.9, RMS contrast (plain information), and the suggested levels: the plate's own p1 and p99 as black and white points (a
stretch to the full range), gamma 1 unless you give --target-mid. Numbers you can paste into a look (`{black, white, gamma}` on a 0..1 scale).
fix / strip: those levels, or yours: --black / --white / --gamma set them directly; --target-mid M picks the gamma (never above 1: it lifts, it does not
darken) that puts the median at M; --gamma-only keeps black 0 and white 1. There is no default target: dial it on the strip.
Applied to luma only, colour ratios kept, so a duotone look still gets its hue from the look. mp4 in, mp4 out (libx264 crf 12, audio copied).
Python API: measure(rgb_uint8) -> dict; suggest(m, target_mid=None, gamma_only=False, black=None, white=None, gamma=None) -> {black, white, gamma};
apply(rgb_uint8, s) -> rgb_uint8.
Exit 0 always for report; 1 on failure; 2 usage.
"""
import argparse, json, os, subprocess, sys, tempfile
import numpy as np
from PIL import Image


def ffmpeg():
    import shutil
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg') or 'ffmpeg'


def luma(rgb):
    a = rgb.astype(np.float32) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def measure(rgb):
    y = luma(rgb)
    p = np.percentile(y, [1, 5, 50, 95, 99])
    return {'p1': float(p[0]), 'p5': float(p[1]), 'p50': float(p[2]), 'p95': float(p[3]), 'p99': float(p[4]), 'under_0.12': float((y < 0.12).mean()),
            'over_0.9': float((y > 0.9).mean()), 'rms': float(y.std())}


def suggest(m, target_mid=None, gamma_only=False, black=None, white=None, gamma=None):
    # black and white points: yours, else the plate's own p1 and p99 (a stretch to the full range)
    lo, hi = (0.0, 1.0) if gamma_only else (m['p1'], m['p99'])
    if hi - lo < 0.08:
        lo, hi = 0.0, 1.0
    lo = lo if black is None else float(black)
    hi = hi if white is None else float(white)
    mid = (m['p50'] - lo) / max(hi - lo, 1e-3)
    mid = min(max(mid, 0.02), 0.98)
    if gamma is not None:
        g = float(gamma)
    elif target_mid is not None:
        g = float(np.log(target_mid) / np.log(mid))      # out = in**g puts the median at target_mid
        g = min(max(g, 0.45), 1.0)                        # lift only: a plate already bright enough is not darkened
    else:
        g = 1.0
    out = {'black': round(lo, 3), 'white': round(hi, 3), 'gamma': round(g, 3)}
    out['median_after'] = round(float(min(max((m['p50'] - lo) / max(hi - lo, 1e-3), 0), 1) ** g), 3)
    return out


def apply(rgb, s):
    a = rgb.astype(np.float32) / 255.0
    y = luma(rgb)
    y2 = np.clip((y - s['black']) / max(s['white'] - s['black'], 1e-3), 0, 1) ** s['gamma']
    out = a * (y2 / np.maximum(y, 1e-3))[..., None]          # luma changes, colour ratios kept
    out = out / np.maximum(out.max(-1, keepdims=True), 1.0)    # a channel past 1 scales the pixel down (hue kept) rather than clipping
    return (np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)


def _video_frames(path, every):
    with tempfile.TemporaryDirectory() as td:
        subprocess.run([ffmpeg(), '-v', 'error', '-i', path, '-vf', 'fps=1/%g,scale=640:-2' % every, os.path.join(td, 'f%04d.png')], check=True)
        for f in sorted(os.listdir(td)):
            yield np.array(Image.open(os.path.join(td, f)).convert('RGB'))


def _plates(path, every):
    if path.lower().endswith(('.mp4', '.mov', '.mkv', '.webm', '.mpeg', '.mpg')):
        return list(_video_frames(path, every))
    return [np.array(Image.open(path).convert('RGB'))]


def report(paths, every=2.0):
    res = {}
    for p in paths:
        ms = [measure(f) for f in _plates(p, every)]
        med = sorted(ms, key=lambda m: m['p50'])[len(ms) // 2]
        dark = min(ms, key=lambda m: m['p50'])
        res[p] = {'frames': len(ms), 'median_frame': med, 'darkest_frame': dark, 'suggest': suggest(med)}
        print('%s  (%d frame%s)' % (p, len(ms), '' if len(ms) == 1 else 's'))
        for nm, m in (('median', med), ('darkest', dark)):
            print('  %-8s p1 %.2f  p50 %.2f  p99 %.2f  under 0.12 %2.0f%%  over 0.9 %2.0f%%  rms %.2f' % (nm, m['p1'], m['p50'], m['p99'], 100 * m['under_0.12'], 100 * m['over_0.9'], m['rms']))
        s = res[p]['suggest']
        print('  levels   black %.3f  white %.3f  gamma %.3f   -> median %.2f (look at it on a strip)' % (s['black'], s['white'], s['gamma'], s['median_after']))
    return res


def _hist_tile(rgb, w=320, h=200, hh=48):
    im = Image.fromarray(rgb)
    im.thumbnail((w, h))
    t = Image.new('RGB', (w, h + hh), (20, 20, 20))
    t.paste(im, ((w - im.width) // 2, 0))
    hist, _ = np.histogram(luma(rgb), bins=32, range=(0, 1))
    hist = hist / max(hist.max(), 1)
    px = t.load()
    for i, v in enumerate(hist):
        for x in range(i * w // 32 + 1, (i + 1) * w // 32):
            for y in range(int(hh * (1 - v)), hh):
                px[x, h + y] = (200, 200, 200)
    return t


def strip(paths, out, **kw):
    rows = []
    for p in paths:
        f = _plates(p, 2.0)
        f = f[len(f) // 2]
        s = suggest(measure(f), **kw)
        rows.append((_hist_tile(f), _hist_tile(apply(f, s))))
    W, H = rows[0][0].size
    sheet = Image.new('RGB', (2 * W + 4, len(rows) * (H + 4)), (0, 0, 0))
    for i, (a, b) in enumerate(rows):
        sheet.paste(a, (0, i * (H + 4)))
        sheet.paste(b, (W + 4, i * (H + 4)))
    sheet.save(out, quality=90)


def fix(src, dst, **kw):
    if src.lower().endswith(('.mp4', '.mov', '.mkv', '.webm')):
        ms = [measure(f) for f in _plates(src, 2.0)]
        s = suggest(sorted(ms, key=lambda m: m['p50'])[len(ms) // 2], **kw)       # one curve for the whole clip: no flicker
        # a global curve through ffmpeg's lutyuv: luma only, so colour ratios are the source's own
        ex = "clip((val/255-%g)/%g\\,0\\,1)^%g*255" % (s['black'], max(s['white'] - s['black'], 1e-3), s['gamma'])
        ex = "pow(clip((val/255-%g)/%g,0,1),%g)*255" % (s['black'], max(s['white'] - s['black'], 1e-3), s['gamma'])
        ex = ex.replace(',', '\\,')
        subprocess.run([ffmpeg(), '-v', 'error', '-y', '-i', src, '-vf', "lutyuv=y='%s'" % ex, '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'copy', dst], check=True)
        return s
    rgb = np.array(Image.open(src).convert('RGB'))
    s = suggest(measure(rgb), **kw)
    Image.fromarray(apply(rgb, s)).save(dst, quality=95)
    return s


def selftest():
    rng = np.random.default_rng(1)
    base = rng.random((120, 160)) ** 1.0
    dim = (0.05 + 0.25 * base)                       # a dim, flat plate: 0.05..0.30
    rgb = (np.stack([dim * 1.0, dim * .9, dim * .8], -1) * 255).astype(np.uint8)
    m = measure(rgb)
    assert 'verdict' not in m, m
    s = suggest(m, target_mid=0.42)
    out = apply(rgb, s)
    m2 = measure(out)
    assert m2['p50'] >= 0.40 and m2['p99'] - m2['p1'] > .8, (m2, s)
    # colour ratio survives where nothing clipped
    mid = (np.abs(luma(out) - 0.42) < .05)
    r = out[..., 0].astype(float)[mid] / np.maximum(out[..., 2].astype(float)[mid], 1)
    assert abs(np.median(r) - 1.0 / .8) < .12, np.median(r)
    assert suggest(m)['gamma'] == 1.0, 'no target unless one is given'
    with tempfile.TemporaryDirectory() as td:
        a = os.path.join(td, 'a.png'); b = os.path.join(td, 'b.png'); Image.fromarray(rgb).save(a)
        fix(a, b, target_mid=0.42)
        assert measure(np.array(Image.open(b)))['p50'] > .35
        strip([a], os.path.join(td, 's.jpg'), target_mid=0.42)
        v = os.path.join(td, 'v.mp4'); w = os.path.join(td, 'w.mp4')
        subprocess.run([ffmpeg(), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=10:duration=2', '-vf', 'eq=brightness=-0.35:contrast=0.5', '-pix_fmt', 'yuv420p', v], check=True)
        mv = measure(_plates(v, 1.0)[0])
        fix(v, w, target_mid=0.42)
        mw = measure(_plates(w, 1.0)[0])
        assert mw['p50'] >= mv['p50'] - 1e-3, (mv, mw)
    print('selftest ok')


def main():
    if '--selftest' in sys.argv:
        return selftest()
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    r = sp.add_parser('report'); r.add_argument('paths', nargs='+'); r.add_argument('--every', type=float, default=2.0); r.add_argument('--json')
    f = sp.add_parser('fix'); f.add_argument('src'); f.add_argument('dst')
    s = sp.add_parser('strip'); s.add_argument('paths', nargs='+'); s.add_argument('-o', required=True)
    for q in (f, s):
        q.add_argument('--target-mid', type=float); q.add_argument('--gamma-only', action='store_true')
        q.add_argument('--black', type=float); q.add_argument('--white', type=float); q.add_argument('--gamma', type=float)
    n = ap.parse_args()
    if n.cmd == 'report':
        res = report(n.paths, n.every)
        if n.json:
            json.dump(res, open(n.json, 'w'), indent=1)
    elif n.cmd == 'fix':
        if os.path.abspath(n.src) == os.path.abspath(n.dst):
            sys.exit('refusing to write over the input')
        print(fix(n.src, n.dst, target_mid=n.target_mid, gamma_only=n.gamma_only, black=n.black, white=n.white, gamma=n.gamma))
    else:
        strip(n.paths, n.o, target_mid=n.target_mid, gamma_only=n.gamma_only, black=n.black, white=n.white, gamma=n.gamma)


if __name__ == '__main__':
    main()
