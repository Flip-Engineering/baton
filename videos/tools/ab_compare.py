#!/usr/bin/env python3
"""AB COMPARE (GRAPHICS 4.0, 8 Oct 2026; research/GRAPHICS_UPGRADE_20261008.md section 4.0 step 5): studio side, decode only.

Reads fetched farm masters (farm.py fetch JOB --only .mp4) with ffmpeg (imageio_ffmpeg's binary), all of them in lockstep, one
frame of each in memory at a time, and lays the same frames side by side for a person to compare. Whether a change looks
better is judged on the sheet, by eye. The numbers are only differences and capture faults:
  psnr      RGB PSNR of each master against the first (the base, e.g. the control): how far apart they are, and the
            equality floor (an unchanged master should match the control)
  flicker   mean |high-pass(f) - high-pass(f-1)| of luma, a readout for chasing a shimmer fault (high-pass = the Laplacian)
  step      mean |Y(f) - Y(f-1)|, and its ratio to the window's median step (the seam audit; over 3 is a jump)
Seams: a jump in a --range window is CUT when every master jumps at that frame (the scene cuts there) and CAPTURE when only one
does (a capture fault: a missing fence, a stale frame). --receipt adds each job's own record: picture_seconds, frames, the 12
ranges and their preroll, and the worker's seam ratios, classified the same way across masters.
Sheet: rows are the --frames (or the flagged seams), columns the masters (a | b | ref), each frame at 270x480 with its frame,
beat and time; --diff adds |base - other| x4.

  ab_compare.py LABEL=MASTER.mp4 LABEL=MASTER.mp4 [LABEL=MASTER.mp4 ...]
      [--frames 87,294,865,1160 | --beats 5,17,50,67] [--range 1205-1215 ...] [--all]
      [--crop NAME=X,Y,W,H ...] [--hits videos/out/.SCENE.hits.json | --bpm 104] [--receipt LABEL=receipt.json ...]
      [--out DIR] [--diff]

  e.g. the 4.0 calibration and seam audit (EVERY DOLLAR v3 against the unchanged control):
    ab_compare.py v3=videos/out/farm/1008-013353/everydollar.mp4 ctl=videos/out/farm/<ctl job>/everydollar__ab_ctl.mp4 \\
        --all --range 1205-1215 --frames 87,294,865,1160 --hits videos/out/.everydollar.hits.json \\
        --receipt v3=videos/out/farm/1008-013353/receipt.json --receipt ctl=videos/out/farm/<ctl job>/receipt.json

Nothing renders. Writes report.json and sheet.jpg (small) to --out (default videos/out/ab/<labels>/).
"""
import argparse, json, math, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)
W, H, FPS = 1080, 1920, 30
JUMP = 3.0


def die(msg):
    sys.exit('ab_compare: ' + msg)


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        if os.path.exists('/usr/bin/ffmpeg'):
            return '/usr/bin/ffmpeg'
        die('no ffmpeg: pip install imageio-ffmpeg')


def probe(mp4):
    err = subprocess.run([ffmpeg(), '-hide_banner', '-i', mp4], capture_output=True, text=True).stderr
    m = re.search(r'Stream #\S+.*?Video:.*?(\d{2,5})x(\d{2,5})', err)
    if not m:
        die('cannot read %s' % mp4)
    d = re.search(r'Duration: (\d+):(\d+):([\d.]+)', err)
    dur = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else None
    return int(m.group(1)), int(m.group(2)), dur


def frames_of(mp4, idx):
    """yield (n, HxWx3 uint8) for the sorted frame indices idx (None: every frame), BT.709 tv-range decoded to RGB"""
    import numpy as np
    vf = 'scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=rgb24'
    if idx is not None:
        runs, s = [], None                       # select as runs: between(n,a,b) terms
        for n in idx:
            if s is None:
                s = e = n
            elif n == e + 1:
                e = n
            else:
                runs.append((s, e)); s = e = n
        if s is not None:
            runs.append((s, e))
        sel = '+'.join('between(n\\,%d\\,%d)' % r for r in runs)
        vf = "select='%s',%s" % (sel, vf)
    p = subprocess.Popen([ffmpeg(), '-v', 'error', '-i', mp4, '-map', '0:v:0', '-vf', vf, '-fps_mode', 'passthrough',
                          '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    sz, k = W * H * 3, 0
    try:
        while True:
            b = p.stdout.read(sz)
            if len(b) < sz:
                break
            yield (idx[k] if idx is not None else k), np.frombuffer(b, np.uint8).reshape(H, W, 3)
            k += 1
            if idx is not None and k >= len(idx):
                break
    finally:
        p.stdout.close(); p.kill(); p.wait()


def luma(rgb):
    import numpy as np
    f = rgb.astype(np.float32)
    return 0.2126 * f[..., 0] + 0.7152 * f[..., 1] + 0.0722 * f[..., 2]


def lap(y):
    return 4 * y[1:-1, 1:-1] - y[:-2, 1:-1] - y[2:, 1:-1] - y[1:-1, :-2] - y[1:-1, 2:]


def psnr(a, b):
    import numpy as np
    mse = float(((a.astype(np.int16) - b.astype(np.int16)).astype(np.float32) ** 2).mean())
    return round(10 * math.log10(255 ** 2 / mse), 2) if mse > 0 else 99.0


def crop(a, c):
    x, y, w, h = c
    return a[y:y + h, x:x + w]


def ints(spec):
    out = []
    for part in str(spec).split(','):
        part = part.strip()
        if not part:
            continue
        if '-' in part:
            a, b = part.split('-', 1); out += list(range(int(a), int(b) + 1))
        else:
            out.append(int(part))
    return out


def stats(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return {'n': len(xs), 'mean': round(sum(xs) / len(xs), 3), 'min': round(xs[0], 3), 'p05': round(xs[int(0.05 * (len(xs) - 1))], 3),
            'median': round(xs[len(xs) // 2], 3), 'max': round(xs[-1], 3)}


def receipt_info(path):
    r = json.load(open(path))
    return {'frames': r.get('frames'), 'seconds': r.get('seconds'), 'picture_seconds': (r.get('timings') or {}).get('picture_seconds'),
            'prepare_seconds': (r.get('timings') or {}).get('prepare_seconds'), 'commit': r.get('commit'), 'scene': r.get('scene'),
            'ranges': [{'first': g.get('first'), 'end': g.get('end_exclusive'), 'preroll': g.get('preroll'),
                        'gpu': (g.get('gpu') or {}).get('label')} for g in r.get('ranges') or []],
            'rendered_frames': sum((g.get('end_exclusive', 0) - g.get('first', 0)) + (g.get('preroll') or 0) for g in r.get('ranges') or []),
            'seams': [{'frame': s.get('frame'), 'ratio': s.get('ratio'), 'step': s.get('step')} for s in r.get('seams') or []]}


def classify(flags, labels):
    """flags: {label: bool} at one frame -> CUT (all jump), CAPTURE (one), PARTIAL (some), '' (none)"""
    j = [l for l in labels if flags.get(l)]
    return '' if not j else 'CUT' if len(j) == len(labels) else 'CAPTURE (%s)' % j[0] if len(j) == 1 else 'PARTIAL (%s)' % ', '.join(j)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('masters', nargs='+', help='LABEL=MASTER.mp4 (2-4; the first is the base)')
    ap.add_argument('--frames', default='', help='frames to measure and sheet (comma list, a-b ranges allowed)')
    ap.add_argument('--beats', default='', help='as --frames, in beats (needs --hits or --bpm)')
    ap.add_argument('--range', action='append', default=[], help='F0-F1: a seam-audit window (every frame decoded)')
    ap.add_argument('--all', action='store_true', help='PSNR (and the rest) over every frame: the equality floor')
    ap.add_argument('--crop', action='append', default=[], help='NAME=X,Y,W,H (output pixels)')
    ap.add_argument('--hits', help='out/.SCENE.hits.json: the bpm for beat labels')
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--receipt', action='append', default=[], help='LABEL=receipt.json (the job\'s own record)')
    ap.add_argument('--out')
    ap.add_argument('--diff', action='store_true', help='sheet: add |base - other| x4 columns')
    a = ap.parse_args()
    import numpy as np
    from PIL import Image, ImageDraw

    M = []
    for s in a.masters:
        lab, eq, p = s.partition('=')
        if not eq or not re.fullmatch(r'[A-Za-z0-9_.-]+', lab):
            die('masters are LABEL=PATH (got %r)' % s)
        if not os.path.isfile(p):
            die('no file %s' % p)
        w, h, dur = probe(p)
        if (w, h) != (W, H):
            die('%s is %dx%d, not %dx%d' % (p, w, h, W, H))
        M.append({'label': lab, 'path': p, 'duration': dur})
    if not 2 <= len(M) <= 4:
        die('2 to 4 masters')
    labels = [m['label'] for m in M]
    if len(set(labels)) != len(labels):
        die('labels must differ')
    crops = {}
    for c in a.crop:
        n, _, v = c.partition('=')
        try:
            x, y, w, h = [int(t) for t in v.split(',')]
        except ValueError:
            die('--crop NAME=X,Y,W,H (got %r)' % c)
        if not (0 <= x < W and 0 <= y < H and w > 8 and h > 8 and x + w <= W and y + h <= H):
            die('crop %s is outside the frame' % n)
        crops[n] = (x, y, w, h)
    bpm = a.bpm
    if a.hits:
        bpm = json.load(open(a.hits)).get('bpm') or bpm
    spb = 60.0 / bpm if bpm else None
    sheet = ints(a.frames)
    if a.beats:
        if not spb:
            die('--beats needs --hits or --bpm')
        sheet += [int(round(float(b) * spb * FPS)) for b in a.beats.split(',') if b.strip()]
    ranges = [tuple(int(t) for t in r.split('-')) for r in a.range]
    need = set()
    for f in sheet:
        need |= {f, f - 1}
    for f0, f1 in ranges:
        need |= set(range(f0 - 1, f1 + 1))
    idx = None if a.all else sorted(n for n in need if n >= 0)
    if idx is not None and not idx:
        die('nothing to measure: --frames, --beats, --range or --all')
    out = a.out or os.path.join(VID, 'out', 'ab', '_'.join(labels))
    os.makedirs(out, exist_ok=True)

    label_of = lambda f: 'f%d  %s t%.2f' % (f, ('b%.1f' % (f / FPS / spb)) if spb else '', f / FPS)
    regions = {'frame': None, **crops}
    rows = {}                                      # frame -> {label: {...}}
    prev = {l: None for l in labels}               # (n, Y, HP)
    thumbs = {}
    gens = [frames_of(m['path'], idx) for m in M]
    for items in zip(*gens):
        ns = {n for n, _ in items}
        if len(ns) != 1:
            die('the masters went out of step (%s)' % ns)
        n = items[0][0]
        base = items[0][1]
        row = {}
        for (_, fr), l in zip(items, labels):
            Y = luma(fr)
            L = lap(Y)
            r = {}
            for rn, c in regions.items():
                yc = Y if c is None else crop(Y, c)
                lc = L if c is None else lap(yc)
                e = {}
                if l != labels[0]:
                    e['psnr'] = psnr(fr if c is None else crop(fr, c), base if c is None else crop(base, c))
                p = prev[l]
                if p is not None and p[0] == n - 1:
                    py = p[1] if c is None else crop(p[1], c)
                    e['step'] = round(float(np.abs(yc - py).mean()), 3)
                    pl = p[2] if c is None else crop(p[2], (c[0], c[1], c[2] - 2, c[3] - 2))   # Laplacian is 2 px smaller
                    lc2 = lc[:pl.shape[0], :pl.shape[1]]
                    e['flicker'] = round(float(np.abs(lc2 - pl[:lc2.shape[0], :lc2.shape[1]]).mean()), 3)
                r[rn] = e
            row[l] = r
            prev[l] = (n, Y, L)
            if n in sheet:
                thumbs[(n, l)] = Image.fromarray(fr).resize((270, 480), Image.BOX)
                if a.diff and l != labels[0]:
                    d = np.clip(np.abs(fr.astype(np.int16) - base.astype(np.int16)).max(2) * 4, 0, 255).astype(np.uint8)
                    thumbs[(n, l + '-diff')] = Image.fromarray(d).resize((270, 480), Image.BOX).convert('RGB')
        rows[n] = row
    frames_seen = sorted(rows)
    if idx is not None and len(frames_seen) < len(idx):
        print('ab_compare: NOTE %d of %d frames decoded (a master is shorter)' % (len(frames_seen), len(idx)))

    rep = {'masters': M, 'base': labels[0], 'crops': crops, 'bpm': bpm, 'frames_measured': len(frames_seen)}
    # summaries
    summ = {}
    for l in labels:
        s = {}
        for rn in regions:
            col = lambda k, fs=frames_seen: [rows[f][l][rn].get(k) for f in fs if l in rows[f]]
            s[rn] = {'psnr_vs_base': stats(col('psnr')) if l != labels[0] else None,
                     'flicker': stats(col('flicker'))}
        summ[l] = s
    rep['summary'] = summ
    rep['sheet_frames'] = [{'frame': f, 'label': label_of(f), **{l: rows[f][l] for l in labels}} for f in sheet if f in rows]
    # seam audit over the --range windows: each frame's step against the window's median step
    audit = []
    for f0, f1 in ranges:
        win = [f for f in range(f0, f1 + 1) if f in rows]
        res = {'range': [f0, f1], 'frames': []}
        for f in win:
            fl, e = {}, {'frame': f, 'label': label_of(f)}
            for l in labels:
                st = rows[f][l]['frame'].get('step')
                others = sorted(rows[g][l]['frame'].get('step') for g in win if g != f and rows[g][l]['frame'].get('step') is not None)
                med = others[len(others) // 2] if others else None
                ratio = round(st / med, 2) if st is not None and med else None
                e[l] = {'step': st, 'ratio': ratio}
                fl[l] = ratio is not None and ratio > JUMP
            e['verdict'] = classify(fl, labels)
            res['frames'].append(e)
        audit.append(res)
    rep['seam_audit'] = audit
    # receipts
    rec = {}
    for s in a.receipt:
        l, _, p = s.partition('=')
        if l not in labels:
            die('--receipt %s: no master labelled %s' % (s, l))
        rec[l] = receipt_info(p)
    if rec:
        rep['receipts'] = rec
        sf = sorted({x['frame'] for r in rec.values() for x in r['seams'] if x.get('ratio') is not None and x['ratio'] > JUMP})
        rl = [l for l in labels if l in rec]
        rep['receipt_seams'] = []
        for f in sf:
            ratios = {l: next((x['ratio'] for x in rec[l]['seams'] if x['frame'] == f), None) for l in rl}
            rep['receipt_seams'].append({'frame': f, 'label': label_of(f), 'ratios': ratios,
                                         'verdict': classify({l: (v or 0) > JUMP for l, v in ratios.items()}, rl) +
                                         ('' if all(v is not None for v in ratios.values()) else ' (not a seam in every job)')})
    json.dump(rep, open(os.path.join(out, 'report.json'), 'w'), indent=1)

    # the sheet: rows are frames, columns the masters (+ diffs)
    flagged = [e['frame'] for r in audit for e in r['frames'] if e['verdict']]
    sframes = [f for f in (sheet or flagged) if any((f, l) in thumbs for l in labels)]
    cols = labels + ([l + '-diff' for l in labels[1:]] if a.diff else [])
    if sframes:
        cw, chh, top = 270, 480, 22
        img = Image.new('RGB', (cw * len(cols), (chh + top) * len(sframes)), (16, 16, 16))
        g = ImageDraw.Draw(img)
        for i, f in enumerate(sframes):
            for j, l in enumerate(cols):
                t = thumbs.get((f, l))
                if t is not None:
                    img.paste(t, (j * cw, i * (chh + top) + top))
                g.text((j * cw + 4, i * (chh + top) + 4), '%s  %s' % (l, label_of(f)), fill=(235, 235, 235))
        img.save(os.path.join(out, 'sheet.jpg'), quality=88)
    # the console
    print('ab_compare: %d frames measured; base %s' % (len(frames_seen), labels[0]))
    for l in labels[1:]:
        for rn in regions:
            ps = summ[l][rn]['psnr_vs_base']
            if ps:
                print('  psnr %-8s vs %-8s %-8s mean %.2f  min %.2f  p05 %.2f dB' % (l, labels[0], rn, ps['mean'], ps['min'], ps['p05']))
    for rn in regions:
        for l in labels:
            fk = summ[l][rn]['flicker']
            if fk:
                print('  %-8s %-8s flicker %s' % (l, rn, fk['mean']))
    for r in audit:
        for e in r['frames']:
            if e['verdict']:
                print('  seam %s: %s  %s' % (e['label'], e['verdict'], '  '.join('%s x%s' % (l, e[l]['ratio']) for l in labels)))
    for l, r in rec.items():
        print('  receipt %-8s frames %s  picture %s s  prepare %s s  rendered %s frames' % (l, r['frames'], r['picture_seconds'], r['prepare_seconds'], r['rendered_frames']))
    for e in rep.get('receipt_seams', []):
        print('  receipt seam %s: %s %s' % (e['label'], e['verdict'], e['ratios']))
    print('ab_compare: %s' % os.path.join(out, 'report.json') + (', sheet.jpg' if sframes else ''))


if __name__ == '__main__':
    main()
