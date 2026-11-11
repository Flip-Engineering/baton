#!/usr/bin/env python3
"""Hit shape: preview lead-in dips at the beats the builder names, for listening, without a song rebuild.

Applies a lead-in dip (engine/hitshape.py) before each named beat of the current master (out/.<scene>.wav, or --media),
puts the loudness and true peak back where they were (engine limiter), writes out/.<scene>.shape_preview.wav (--no-write
to skip) and prints the snippet to paste into the song if the dips sound right:

    master={..., 'shape': {'cues': {66: 3.0, 72: 2.0}}}     # beat: dip dB, chosen by ear

There is no target jump and nothing is picked for you (8 Oct): whether a cue lands is heard. A cue less than 0.7 s after
the previous one is noted, because its lead-in holds that cue's hit and a dip there would only hollow it out.

Usage:
  scripts/hit_shape.py meltdown8 --beats 8,26 [--dip 3]
  scripts/hit_shape.py meltdown8 --beats 8:2.5,26:4 --media review/x/clip.mp4 --from 0
  scripts/hit_shape.py --selftest
"""
import argparse
import json
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, VIDEOS)
import hit_meter  # noqa: E402
from engine import hitshape as hs  # noqa: E402

SR = hit_meter.SR


def restore_level(y, ref):
    """Match y's integrated loudness and true peak to ref's (engine lufs / limiter)."""
    from engine import audio
    g = 10 ** ((audio.lufs(ref) - audio.lufs(y)) / 20)
    tp = audio.true_peak_db(ref, 4)
    z = audio.limiter(y * g, tp - 0.1)
    return z


def preview(scene, beats, media=None, start=0.0, dip=3.0, write=True):
    """beats: {beat: dip_db or None}. Returns {'scene', 'rows', 'preview', 'snippet'}."""
    res = hit_meter.meter(scene, media, start)
    rows = [r for r in res['rows'] if not r['closer']]
    all_t = sorted(r['t'] for r in res['rows'])
    pick = [(r, d) for b, d in beats.items() for r in rows if abs(r['beat'] - b) < 0.3]
    x = hit_meter.decode(media or os.path.join(hit_meter.OUT, f'.{scene}.wav')).astype(np.float64)
    cues, out = [], []
    for r, d in pick:
        prev = [t for t in all_t if t < r['t'] - 0.01]
        run = bool(prev) and r['t'] - prev[-1] < 0.7
        dd = float(dip if d is None else d)
        if not run:
            cues.append({'t': r['t'] - start, 'dip': dd})
        out.append({'beat': r['beat'], 'text': r['text'], 'dip': 0.0 if run else dd, 'run': run})
    y = restore_level(hs.apply(x, cues), x) if cues else x
    path = None
    if write and cues:
        path = os.path.join(hit_meter.OUT, f'.{scene}.shape_preview.wav')
        w = wave.open(path, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype('<i2').tobytes()); w.close()
    snippet = {'cues': {(int(o['beat']) if float(o['beat']).is_integer() else o['beat']): o['dip'] for o in out if o['dip'] > 0}}
    return {'scene': scene, 'rows': out, 'preview': path, 'snippet': snippet}


def show(s):
    w = sys.stdout.write
    if not s['rows']:
        w(f"hit shape {s['scene']}: none of the named beats is a cue in hits.json\n")
        return
    w(f"hit shape {s['scene']}\n")
    for r in s['rows']:
        note = '   <- less than 0.7 s after the previous cue: its lead-in holds that hit; no dip (space the cues instead)' if r['run'] else ''
        w(f"{r['beat']:>6g}  dip {r['dip']:4.1f} dB  {r['text']}{note}\n")
    if s['preview']:
        w(f"listen: {os.path.relpath(s['preview'], VIDEOS)} (level- and peak-matched to the master)\n")
    w("if it sounds right, paste into the song's master={...}:\n")
    w(f"  'shape': {json.dumps(s['snippet'])}\n")


def selftest():
    b, a = hs.selftest()
    from engine import audio
    rng = np.random.default_rng(3)
    x = rng.standard_normal((SR * 4, 2)) * 0.2
    y = restore_level(hs.apply(x, [{'t': 2.0, 'dip': 4.0}]), x)
    assert abs(audio.lufs(y) - audio.lufs(x)) < 0.5, (audio.lufs(y), audio.lufs(x))
    assert audio.true_peak_db(y, 4) <= audio.true_peak_db(x, 4) + 0.2
    print('hit_shape selftest: OK; level restore within 0.5 LU')

def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__)
    ap.add_argument('scene', nargs='?')
    ap.add_argument('--media')
    ap.add_argument('--from', dest='start', default='0')
    ap.add_argument('--beats', help='comma list of beats to dip before, each optionally beat:dB (e.g. 8,26:4)')
    ap.add_argument('--dip', type=float, default=3.0, help='dip in dB where a beat names none (default 3)')
    ap.add_argument('--no-write', action='store_true')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.scene:
        ap.error('scene required')
    if not a.beats:
        ap.error('--beats required: name the cues to preview (nothing is picked for you)')
    beats = {}
    for b in a.beats.split(','):
        k, _, d = b.strip().lstrip('b').partition(':')
        beats[float(k)] = float(d) if d else None
    hits = json.load(open(os.path.join(hit_meter.OUT, f'.{a.scene}.hits.json')))
    start = hit_meter._parse_t(a.start, 60.0 / (hits.get('bpm') or 120))
    s = preview(a.scene, beats, a.media, start, a.dip, not a.no_write)
    if a.json:
        json.dump(s, sys.stdout, indent=1); print()
    else:
        show(s)


if __name__ == '__main__':
    main()
