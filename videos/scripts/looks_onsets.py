"""LOOKS c2: the strongest onsets of a song wav (spectral flux, 1/120 s hops) and its silences.

    python3 scripts/looks_onsets.py SONG.wav [--top 12] [--from 0 --to 30]

Prints the top onsets (s, normalised flux) and every silence >= 120 ms (RMS 30 dB under the song median), so a
picture hit is chosen from the waveform, not the beat grid.
"""
import argparse, json, wave
import numpy as np


def load(p):
    with wave.open(p) as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        b = w.readframes(n)
    dt = {2: np.int16, 4: np.int32}[sw]
    x = np.frombuffer(b, dt).astype(np.float32) / np.iinfo(dt).max
    return x.reshape(-1, ch).mean(1), sr


def analyse(path, top=12, t0=0, t1=1e9):
    x, sr = load(path)
    hop = sr // 120; win = 2048
    nfr = (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(nfr)[:, None]
    S = np.abs(np.fft.rfft(x[idx] * np.hanning(win), axis=1))
    L = np.log1p(S * 10)
    flux = np.r_[0, np.maximum(np.diff(L, axis=0), 0).sum(1)]
    flux /= flux.max()
    t = (np.arange(nfr) * hop + win / 2) / sr
    # peaks: local max within +-0.12 s
    k = 14; pk = [i for i in range(k, nfr - k) if flux[i] == flux[i - k:i + k + 1].max() and t0 <= t[i] <= t1]
    pk.sort(key=lambda i: -flux[i])
    rms = np.sqrt((x[idx] ** 2).mean(1)) + 1e-9; db = 20 * np.log10(rms); med = np.median(db)
    quiet = db < med - 30; sil = []; i = 0
    while i < nfr:
        if quiet[i]:
            j = i
            while j < nfr and quiet[j]: j += 1
            if (j - i) / 120 >= 0.12: sil.append([round(t[i], 3), round(t[j - 1], 3)])
            i = j
        else: i += 1
    return {'file': path, 'onsets': [[round(float(t[i]), 3), round(float(flux[i]), 2)] for i in pk[:top]], 'silences': sil}


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('wav', nargs='+'); ap.add_argument('--top', type=int, default=12)
    ap.add_argument('--from', dest='f', type=float, default=0); ap.add_argument('--to', type=float, default=1e9)
    a = ap.parse_args()
    for p in a.wav: print(json.dumps(analyse(p, a.top, a.f, a.to)))
