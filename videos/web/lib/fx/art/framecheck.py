"""ART c2 / FRAMECHECK: where the hits are in the wav the build will mux, so picture events can be placed on them.
A thin wrapper over scripts/type_sync.py (read-only use).

  python3 web/lib/fx/art/framecheck.py onsets <wav> [--from s] [--to s] [--grid 0.75] [--json out.json]
      the event score of the wav the build will MUX: RMS jump (0-150 ms after vs 200-600 ms before, on a grid of
      candidate beats) + spectral-flux peaks. Classes (sorting, not a verdict): ACCENT >= +3.5 dB, BEAT +1.5..+3.5 dB,
      PICKUP = a flux peak 60-250 ms before an accent. The JSON feeds art/score.js.
Whether a picture event lands on its hit is judged by watching the clip with its sound.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../../../scripts'))
import type_sync as TS  # noqa: E402



def rms_db(x, sr, t, a, b):
    i0, i1 = int((t + a) * sr), int((t + b) * sr)
    seg = x[max(0, i0):max(0, i1)]
    return 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) if len(seg) else -120


def score(wav, t0, t1, grid=0.75, phase=None):
    x, sr = TS.load_audio(wav)
    fl, _rms, hs = TS.flux_curve(x, sr)
    hop = hs / sr
    fl = fl / (fl.max() + 1e-9)
    # candidate points: the beat grid (found from the strongest flux peak's phase) plus every flux peak
    if phase is None:
        k = np.argmax(fl[int(t0 / hop):int(t1 / hop)]) + int(t0 / hop)
        phase = (k * hop) % grid
    cands = [round(phase + grid * n, 3) for n in range(int(t0 / grid) - 1, int(t1 / grid) + 2) if t0 - 0.3 <= phase + grid * n <= t1]
    ev = []
    for t in cands:
        jump = rms_db(x, sr, t, 0, 0.15) - rms_db(x, sr, t, -0.6, -0.2)
        j0 = int(t / hop)
        f = float(fl[max(0, j0 - 7):j0 + 8].max())
        cls = 'ACCENT' if jump >= 3.5 else 'BEAT' if jump >= 1.5 else 'none'
        ev.append({'t': t, 'jump_db': round(float(jump), 1), 'flux': round(f, 2), 'class': cls, 'level_db': round(float(rms_db(x, sr, t, 0, 0.15)), 1)})
    # pickups: flux peaks 60-250 ms before an accent that are not themselves on the grid
    peaks = [(i * hop, fl[i]) for i in range(1, len(fl) - 1) if fl[i] > fl[i - 1] and fl[i] >= fl[i + 1] and fl[i] > 0.3 and t0 <= i * hop <= t1]
    for e in [e for e in ev if e['class'] == 'ACCENT']:
        for (tp, v) in peaks:
            if 0.06 <= e['t'] - tp <= 0.25:
                ev.append({'t': round(tp, 3), 'flux': round(float(v), 2), 'class': 'PICKUP', 'before': e['t']})
                break
    ev.sort(key=lambda e: e['t'])
    return {'wav': os.path.abspath(wav), 'from': t0, 'to': t1, 'grid': grid, 'phase': round(phase, 3), 'events': ev}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['onsets'])
    ap.add_argument('path')
    ap.add_argument('--from', dest='t0', type=float, default=0)
    ap.add_argument('--to', dest='t1', type=float, default=1e9)
    ap.add_argument('--grid', type=float, default=0.75)
    ap.add_argument('--phase', type=float, default=0.0)   # the bar grid's phase; pass a value for songs off 0
    ap.add_argument('--json')
    a = ap.parse_args()
    r = score(a.path, a.t0, a.t1 if a.t1 < 1e8 else 60, a.grid, a.phase)
    for e in r['events']:
        print(f"{e['t']:7.3f}  {e['class']:7s}  jump {e.get('jump_db', ''):>5}  flux {e['flux']}")
    if a.json:
        json.dump(r, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
