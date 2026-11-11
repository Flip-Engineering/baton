#!/usr/bin/env python3
"""beatmap: the authored-to-final beat map as one file, read by scene, song, shot table and review tools.

Why (HORDE c10 TOOLING NEED 1): a piece is authored on a clean beat grid and stretched afterwards where a card needs
reading time. The stretch lived twice (ANCH in the scene, ANCH in the song) and shot_table.py listed unstretched beats.
Now: web/beatmaps/<piece>.json  {"bpm": 170, "anchors": [[authored, final], ...]}  and the same maths in
web/lib/fx/beatmap.js (scene) and here (song, tools). Report only; no gate rule, no scene touched.

Python:
  sys.path.insert(0, 'videos/tools'); from beatmap import load
  bm = load('horde3');  bm.m(64.5) -> 69.5   bm.inv(69.5) -> 64.5   bm.sec(64.5) -> final seconds   bm.authored_sec(b)
  bm.stretch() -> [(a0, a1, m0, m1, factor)]   where time was added
  bm.apply_cuts([0, 12, 40.5]) -> final beats (for shot_table: pass the declared cuts through the map)
In a song:  M = load('horde3').m   instead of a pasted ANCH.
CLI:
  beatmap.py show horde3                 # the segments, factor per segment, total added seconds
  beatmap.py convert horde3 64.5 127     # authored -> final beat and seconds   (--inv: final -> authored)
  beatmap.py check horde3                # compare the JSON to ANCH copies still in the scene / song (drift detector)
  beatmap.py --selftest
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
DIR = os.path.join(VIDEOS, 'web', 'beatmaps')


class BeatMap:
    def __init__(self, anchors, bpm=120.0, piece=''):
        a = [(float(x), float(y)) for x, y in anchors]
        if len(a) < 2:
            raise ValueError('need at least two anchors')
        for p, q in zip(a, a[1:]):
            if not (q[0] > p[0] and q[1] > p[1]):
                raise ValueError(f'anchors must increase in both columns: {p} -> {q}')
        self.a, self.bpm, self.piece = a, float(bpm), piece

    def _seg(self, v, col):
        a = self.a
        for i in range(1, len(a)):
            if v <= a[i][col]:
                return a[i - 1], a[i]
        return None

    def m(self, b):
        s = self._seg(b, 0)
        if s is None:
            return b + (self.a[-1][1] - self.a[-1][0])
        (a0, m0), (a1, m1) = s
        return m0 + (b - a0) * (m1 - m0) / (a1 - a0)

    def inv(self, f):
        s = self._seg(f, 1)
        if s is None:
            return f - (self.a[-1][1] - self.a[-1][0])
        (a0, m0), (a1, m1) = s
        return a0 + (f - m0) * (a1 - a0) / (m1 - m0)

    @property
    def spb(self):
        return 60.0 / self.bpm

    def sec(self, b):
        return self.m(b) * self.spb

    def authored_sec(self, b):
        return b * self.spb

    def apply_cuts(self, beats):
        return [self.m(b) for b in beats]

    def stretch(self):
        return [(a0, a1, m0, m1, (m1 - m0) / (a1 - a0)) for (a0, m0), (a1, m1) in zip(self.a, self.a[1:])]


def load(piece):
    p = piece if piece.endswith('.json') else os.path.join(DIR, piece + '.json')
    d = json.load(open(p))
    return BeatMap(d['anchors'], d.get('bpm', 120), d.get('piece', piece))


def _parse_anch(text):
    m = re.search(r'ANCH\s*=\s*(\[\[.*?\]\])\s*;?', text, re.S)
    return json.loads(m.group(1)) if m else None


def check(piece):
    d = json.load(open(os.path.join(DIR, piece + '.json')))
    bad = 0
    for src in d.get('sources', []):
        p = os.path.join(VIDEOS, src)
        a = _parse_anch(open(p).read()) if os.path.exists(p) else None
        if a is None:
            print(f'  ? {src}: no ANCH literal found (already reads the map file, or moved)')
        elif a == d['anchors']:
            print(f'  ok {src}: same anchors')
        else:
            bad += 1
            print(f'  DRIFT {src}: {a} != {d["anchors"]}')
    return bad


def show(piece):
    bm = load(piece)
    print(f'{bm.piece}: {bm.bpm:g} BPM, {len(bm.a)} anchors')
    for a0, a1, m0, m1, f in bm.stretch():
        tag = '' if abs(f - 1) < 1e-9 else f'  <- x{f:.2f}, +{(m1 - m0 - (a1 - a0)) * bm.spb:.2f} s'
        print(f'  authored b{a0:g}-{a1:g} -> final b{m0:g}-{m1:g}{tag}')
    extra = bm.a[-1][1] - bm.a[-1][0]
    print(f'  total added: {extra:g} beats = {extra * bm.spb:.2f} s')


def selftest():
    bm = BeatMap([[0, 0], [10, 10], [20, 25], [100, 105]], 120)
    assert bm.m(5) == 5 and bm.m(15) == 17.5 and bm.m(20) == 25 and bm.m(150) == 155
    for b in (0, 3, 10, 14.2, 20, 77, 150):
        assert abs(bm.inv(bm.m(b)) - b) < 1e-9, b
    assert abs(bm.sec(20) - 12.5) < 1e-9 and bm.apply_cuts([10, 20]) == [10, 25]
    assert [round(s[4], 2) for s in bm.stretch()] == [1.0, 1.5, 1.0]
    try:
        BeatMap([[0, 0], [5, 3], [4, 9]])
        raise SystemExit('non-monotonic anchors accepted')
    except ValueError:
        pass
    h = load('horde3')
    assert abs(h.m(64.5) - 69.5) < 1e-9 and abs(h.m(127) - 133) < 1e-9
    # the maths must match the scene's and song's own copies: check the JSON against them
    assert check('horde3') == 0, 'horde3.json drifted from scene or song'
    # JS twin gives the same numbers
    import subprocess
    js = ("import {beatMap} from '%s/web/lib/fx/beatmap.js';import fs from 'fs';"
          "const B=beatMap(JSON.parse(fs.readFileSync('%s/web/beatmaps/horde3.json')));"
          "console.log(JSON.stringify([0,12,47,64.5,99,127,150,250].map(b=>[B.m(b),B.inv(B.m(b))])))" % (VIDEOS, VIDEOS))
    r = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True)
    if r.returncode == 0:
        for b, (mm, ii) in zip([0, 12, 47, 64.5, 99, 127, 150, 250], json.loads(r.stdout)):
            assert abs(mm - h.m(b)) < 1e-9 and abs(ii - b) < 1e-9, (b, mm)
        print('selftest ok (python, JSON vs scene+song ANCH, JS twin)')
    else:
        print('selftest ok (python, JSON vs scene+song ANCH); node unavailable:', r.stderr[:80])


def main(argv):
    if not argv or argv[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    if argv[0] == '--selftest':
        selftest()
        return 0
    cmd, piece = argv[0], argv[1]
    if cmd == 'show':
        show(piece)
    elif cmd == 'check':
        return 1 if check(piece) else 0
    elif cmd == 'convert':
        bm = load(piece)
        inv = '--inv' in argv
        for v in [float(x) for x in argv[2:] if x != '--inv']:
            if inv:
                print(f'final b{v:g} ({v * bm.spb:.2f} s) <- authored b{bm.inv(v):.2f}')
            else:
                print(f'authored b{v:g} -> final b{bm.m(v):.2f} ({bm.sec(v):.2f} s; unstretched {bm.authored_sec(v):.2f} s)')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
