#!/usr/bin/env python3
"""moments: the same moment of several versions of a piece, side by side, labelled. Report only.

Why: piece_board lays versions on one time axis, but a re-timed version (HORDE v13 36.7 s, v14 49.7 s) puts the same
idea at different seconds, so equal steps compare different things. This compares by MOMENT: rows are versions,
columns are the moment (a time, a beat, a fraction of the piece, an authored beat through a beat map, or a text card
found by its words). Labels are PIL (this box's ffmpeg has no drawtext). It is also the labelled contact sheet:
one video, many moments.

  moments.py A.mp4 B.mp4 --label v13 --label v14 --at 0,4,12,30            seconds (same for every row)
  moments.py A.mp4 B.mp4 --beats 12,40.5,64.5 --bpm 170 [--bpm 150]          final beats, each row at its own bpm
  moments.py A.mp4 B.mp4 --beats 12,64.5 --bpm 170 --beatmap none --beatmap horde3
                                      authored beats: a row with a beat map is stretched through it, 'none' is as written
  moments.py A.mp4 B.mp4 --frac 0,.25,.5,.75,.98                            fractions of each piece's own length
  moments.py A.mp4 B.mp4 --by-text tlA.md --by-text tlB.md                  one column per text card, matched by words
                                      across timelines (piece_board's timeline formats); a version without the card shows "absent"
  moments.py A.mp4 --every 2 [--from 10 --to 30]                            one video, a frame every 2 s
Options: --tw 150 (cell width, 9:16), --cols 8 (columns per block, then it wraps), --out sheet.jpg, --json cells.json
  moments.py --selftest
Frames are decoded at the stamped time; the stamp is under each cell. Missing time (past the end) shows "past end".
"""
import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from piece_board import FFMPEG, font, probe, read_timeline  # noqa: E402
import beatmap as _bm  # noqa: E402


def grab(path, t, tw, th):
    r = subprocess.run([FFMPEG, '-hide_banner', '-v', 'error', '-ss', f'{t:.3f}', '-i', path, '-frames:v', '1', '-vf',
                        f'scale={tw}:{th}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    b = np.frombuffer(r.stdout, np.uint8)
    return Image.fromarray(b.reshape(th, tw, 3)) if b.size == tw * th * 3 else None


def _norm(s):
    return re.sub(r'[^A-Z0-9 ]', '', re.sub(r'[—\-/]', ' ', s.upper())).strip()


def match_cards(timelines, thresh=0.8):
    """Columns across versions: [{'text', 'by': [row or None per version]}], first timeline's order, then extras."""
    cols = []
    for vi, rows in enumerate(timelines):
        used = set()
        for r in rows:
            n = _norm(r['text'])
            best, bs = None, thresh
            for ci, c in enumerate(cols):
                if c['by'][vi] is not None or ci in used:
                    continue
                s = difflib.SequenceMatcher(None, n, c['n']).ratio()
                if s >= bs:
                    best, bs = ci, s
            if best is None:
                cols.append({'text': r['text'], 'n': n, 'by': [None] * len(timelines), 't0': r['t']})
                best = len(cols) - 1
            cols[best]['by'][vi] = r
            used.add(best)
    # keep order of first appearance by earliest time in the earliest version that has it
    return cols


def build(videos, labels, moments, tw=150, cols=8, out='moments.jpg'):
    """moments: [{'name': str, 't': [seconds or None per video], 'note': [str per video]}]. Returns cell records."""
    th = tw * 16 // 9
    info = [probe(v) for v in videos]
    f, fs = font(max(11, tw // 13)), font(max(10, tw // 15))
    lab_w = 70
    blocks = [moments[i:i + cols] for i in range(0, len(moments), cols)] or [[]]
    cell_h = th + 34
    head = 30
    W = lab_w + min(cols, len(moments) or 1) * (tw + 4)
    H = sum(head + len(videos) * (cell_h + 4) + 6 for _ in blocks)
    img = Image.new('RGB', (W, H), (18, 18, 20))
    d = ImageDraw.Draw(img)
    rec, y = [], 0
    for blk in blocks:
        for ci, mo in enumerate(blk):
            x = lab_w + ci * (tw + 4)
            d.text((x + 2, y + 2), str(mo['name'])[:max(8, tw // 8)], fill=(235, 200, 90), font=f)
        y += head
        for vi, v in enumerate(videos):
            dur = info[vi][0]
            d.text((4, y + th // 2), labels[vi], fill=(220, 220, 220), font=f)
            for ci, mo in enumerate(blk):
                x = lab_w + ci * (tw + 4)
                t = mo['t'][vi]
                note = mo['note'][vi] if mo.get('note') else ''
                im = None
                if t is not None and t <= dur + 0.01:
                    im = grab(v, min(max(t, 0), max(dur - 0.04, 0)), tw, th)
                if im is None:
                    d.rectangle([x, y, x + tw - 1, y + th - 1], fill=(36, 30, 30), outline=(90, 50, 50))
                    d.text((x + 8, y + th // 2 - 6), 'absent' if t is None else 'past end', fill=(150, 90, 90), font=f)
                    stamp = '-' if t is None else f'{t:.2f}s'
                else:
                    img.paste(im, (x, y))
                    stamp = f'{t:.2f}s'
                d.text((x + 1, y + th + 2), stamp + (' ' + note if note else ''), fill=(190, 190, 190), font=fs)
                rec.append({'video': labels[vi], 'moment': mo['name'], 't': t})
            y += cell_h + 4
        y += 6
    img.save(out, quality=88)
    return rec


def moments_from_args(a, videos, labels):
    n = len(videos)
    durs = [probe(v)[0] for v in videos]
    allv = lambda lst, i: lst[i] if len(lst) > 1 else lst[0]   # noqa: E731
    ms = []
    if a.by_text:
        tls = [read_timeline(p) for p in a.by_text]
        if len(tls) != n:
            sys.exit('--by-text needs one timeline per video')
        for c in match_cards(tls):
            ts = [None if r is None else r['t'] + min(0.35, r['hold'] * 0.5) for r in c['by']]
            ms.append({'name': c['text'].replace(' / ', ' ')[:22], 't': ts, 'note': [''] * n})
        ms.sort(key=lambda m: min(t for t in m['t'] if t is not None))
    elif a.beats:
        beats = [float(x) for x in a.beats.split(',')]
        bpms = [float(x) for x in a.bpm] or sys.exit('--beats needs --bpm')
        maps = [None if m in ('none', '') else _bm.load(m) for m in (a.beatmap or ['none'])]
        for b in beats:
            ts = []
            for i in range(n):
                bm, bp = allv(maps, i), allv(bpms, i)
                fb = bm.m(b) if bm else b
                ts.append(fb * 60 / bp)
            ms.append({'name': f'b{b:g}', 't': ts, 'note': [''] * n})
    elif a.frac:
        for fr in [float(x) for x in a.frac.split(',')]:
            ms.append({'name': f'{fr:.0%}', 't': [fr * d for d in durs], 'note': [''] * n})
    elif a.every:
        lo, hi = a.from_ or 0, a.to or max(durs)
        t = lo
        while t <= hi + 1e-6:
            ms.append({'name': f'{t:g}s', 't': [t] * n, 'note': [''] * n})
            t += a.every
    elif a.at:
        for t in [float(x) for x in a.at.split(',')]:
            ms.append({'name': f'{t:g}s', 't': [t] * n, 'note': [''] * n})
    else:
        sys.exit('give one of --at --beats --frac --every --by-text')
    return ms


def selftest():
    tmp = tempfile.mkdtemp(prefix='moments_')
    vids = []
    for name, dur in (('a', 4), ('b', 6)):
        p = os.path.join(tmp, name + '.mp4')
        r = subprocess.run([FFMPEG, '-y', '-v', 'error', '-f', 'lavfi', '-i', f'testsrc2=s=144x256:r=30:d={dur}', '-c:v',
                            'libx264', '-pix_fmt', 'yuv420p', p], capture_output=True)
        assert r.returncode == 0, r.stderr
        vids.append(p)
    # card matching: b has FOUR twice the hold, A lacks THREE
    ta = [{'t': 0, 'hold': 1, 'words': 1, 'wps': 1, 'text': 'ONE'}, {'t': 1, 'hold': 1, 'words': 2, 'wps': 2, 'text': 'TWO — THEY'}]
    tb = [{'t': 0, 'hold': 2, 'words': 1, 'wps': 1, 'text': 'ONE'}, {'t': 2, 'hold': 1, 'words': 2, 'wps': 2, 'text': 'TWO THEY'},
          {'t': 3, 'hold': 1, 'words': 1, 'wps': 1, 'text': 'THREE'}]
    cs = match_cards([ta, tb])
    assert len(cs) == 3 and cs[1]['by'][0] is not None and cs[1]['by'][1]['t'] == 2 and cs[2]['by'][0] is None
    out = os.path.join(tmp, 's.jpg')
    ms = [{'name': 'x', 't': [1.0, 1.0], 'note': ['', '']}, {'name': 'y', 't': [None, 5.0], 'note': ['', '']},
          {'name': 'z', 't': [9.0, 3.0], 'note': ['', '']}]
    rec = build(vids, ['A', 'B'], ms, tw=72, cols=2, out=out)
    assert os.path.getsize(out) > 3000 and len(rec) == 6
    im = Image.open(out)
    assert im.size[0] > 150 and im.size[1] > 2 * 128
    # CLI shapes
    class A: pass
    a = A(); a.by_text = None; a.beats = '8,16'; a.bpm = ['120', '60']; a.beatmap = ['none']; a.frac = a.every = a.at = None
    m = moments_from_args(a, vids, ['A', 'B'])
    assert m[0]['t'] == [4.0, 8.0], m
    a.beats = '40.5'; a.bpm = ['170']; a.beatmap = ['none', 'horde3']
    m = moments_from_args(a, vids, ['A', 'B'])
    assert abs(m[0]['t'][0] - 40.5 * 60 / 170) < 1e-9
    print('selftest ok')
    for p in vids + [out]:
        os.remove(p)
    os.rmdir(tmp)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('videos', nargs='*')
    ap.add_argument('--label', action='append', default=[])
    ap.add_argument('--at'), ap.add_argument('--beats'), ap.add_argument('--frac')
    ap.add_argument('--bpm', action='append', default=[])
    ap.add_argument('--beatmap', action='append')
    ap.add_argument('--by-text', action='append')
    ap.add_argument('--every', type=float)
    ap.add_argument('--from', dest='from_', type=float), ap.add_argument('--to', type=float)
    ap.add_argument('--tw', type=int, default=150), ap.add_argument('--cols', type=int, default=8)
    ap.add_argument('--out', default='moments.jpg'), ap.add_argument('--json')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.videos:
        ap.error('no videos')
    labels = a.label + [os.path.splitext(os.path.basename(v))[0] for v in a.videos[len(a.label):]]
    ms = moments_from_args(a, a.videos, labels)
    rec = build(a.videos, labels, ms, tw=a.tw, cols=a.cols, out=a.out)
    if a.json:
        json.dump(rec, open(a.json, 'w'), indent=1)
    print(f'{a.out}: {len(ms)} moments x {len(a.videos)} versions')


if __name__ == '__main__':
    main()
