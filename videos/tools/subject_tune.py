"""Tuning aid for THE SUBJECT's delivered contrast (MUSIC): re-runs the master stage on the written mix without a rebuild.

    ACP_SUBJECT_RAW=/tmp/x/subject_raw.npy python3 web/audio/songs2/subject.py      (writes the raw written mix; slow: 1-2 minutes)
    python3 videos/tools/subject_tune.py --raw /tmp/x/subject_raw.npy --logo /tmp/x/subject_logo.npy [--post "0:0,44:-3"] [--clip 0.35]

applies a post gain curve (beats:dB, piecewise linear), the soft clip, the seam ramps, mixes the logo with logo_gain.json's shape for
`subject`, runs make_audio.finish (the delivery stage) and writes a copy to listen to (--listen, default review/subject_tune.wav),
with the delivered section loudness as a readout. Whether the lock lands is heard. Nothing is written to out/ (use --write to save
the wav there).
"""
import argparse
import os
import sys
import types

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
for p in (VIDEOS, os.path.join(VIDEOS, "web", "audio"), HERE):
    sys.path.insert(0, p)

SR = 44100
SPB = 0.625


def curve(spec, n):
    pts = [tuple(float(v) for v in a.split(":")) for a in spec.split(",")] if spec else [(0, 0)]
    b = np.arange(n) / SR / SPB
    return 10 ** (np.interp(b, [p[0] for p in pts], [p[1] for p in pts]) / 20)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--logo", required=True)
    ap.add_argument("--post", default="")
    ap.add_argument("--clip", type=float, default=0.35)
    ap.add_argument("--lockclip", type=float, default=1.0)
    ap.add_argument("--gain", type=float, default=0.0)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--listen", default=os.path.join(VIDEOS, "review", "subject_tune.wav"))
    a = ap.parse_args()
    import make_audio as MA
    from engine import audio
    import measure_subject as M
    x = np.load(a.raw).astype(np.float64) * 10 ** (a.gain / 20)
    x = x * curve(a.post, len(x))[:, None]
    y = a.clip * np.tanh(x / a.clip)
    i0, i1 = int(27.5 * SR), int((27.5 + 0.09) * SR)
    w = np.ones(len(x))
    w[i0:i1] = 0.0
    k = int(0.004 * SR)
    w = np.convolve(w, np.hanning(k) / np.hanning(k).sum(), mode="same")[:, None]
    x = y * w + a.lockclip * np.tanh(x / a.lockclip) * (1 - w)
    r = int(0.0015 * SR)
    x[:r] *= np.linspace(0, 1, r)[:, None]
    x[-r:] *= np.linspace(1, 0, r)[:, None]
    logo = np.load(a.logo)
    song = types.SimpleNamespace(bpm=96, logo=lambda: logo, logo_duck_db=-6.0, payoff={"t": 27.5, "beat": 44.0}, master_cfg={"lufs": -10.0, "tp": -1.8},
                                 lra_until=None)
    z = MA.mix_sonic_logo("subject", song, x, quiet=True)
    z, fin = MA.finish(song, z, codec=False)
    secs = {}
    for nm, b0, b1 in (("drop", 0, 4), ("face", 4, 12), ("flood1", 12, 28), ("loco", 28, 32), ("flood2", 32, 43), ("lock", 44, 52), ("withheld", 52, 56)):
        secs[nm] = round(M.lufs_win(z, SR, b0 * SPB, min(35.0, b1 * SPB)), 1)
    print("sections (delivered, LUFS):", secs, f"  integrated {M.lufs_win(z, SR, 0, 35.0):.2f}")
    os.makedirs(os.path.dirname(a.listen), exist_ok=True)
    audio.write_wav(a.listen, z)
    print("listen:", a.listen)
    if a.write:
        audio.write_wav(os.path.join(VIDEOS, "out", ".subject.wav"), z)


if __name__ == "__main__":
    main()
