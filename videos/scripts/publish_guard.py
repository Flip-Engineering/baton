#!/usr/bin/env python3
"""PUBLISH GUARD (8 Oct 2026; archive audit P5): two things the client has already ruled on, checked before anything is uploaded.

    python3 videos/scripts/publish_guard.py PIECE FILE [--scene SCENE]

  lines  the piece's scene sources (scenes/<scene>*.js), its script JSON and its name are searched for text_check.py's FLAGGED lines.
         A line the client rejected or ruled off limits STOPS the publish (UNITED GATES was published on 2 Oct with its rejected line
         reported by the gate as advisory). Optics and asset/date flags only print.
  logo   ADVISORY (8 Oct): the last 8 s of FILE's audio (the closer, where the mark sat) is cross-correlated with the stock sonic logo (web/assets/acc_sonic_logo.wav). The client: "the
         annoying and stereotypical closing sound mark" (1 Oct); task #50 took it out of every closer. A match prints a note to listen;
         it no longer stops: two clean Surge scores (bank_note_e 0.60, red_wedge_e 0.58, their raw stems) matched as high as the real mark (0.61).
Exit 0 clear, 2 stopped (publish.sh honours PUBLISH_FLAGGED=1 to publish anyway, printing why), 1 a tool error (never stops a publish).
"""
import argparse
import glob
import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
SCENES = os.path.join(VIDEOS, 'web', 'scenes')
LOGO = os.path.join(VIDEOS, 'web', 'assets', 'acc_sonic_logo.wav')
SR = 16000
STOP_CLASSES = ('client rejected this line', 'client ruled off limits')
LOGO_STOP, LOGO_NOTE = 0.55, 0.45   # calibrated 8 Oct: COMMON_WEALTH_v13 (stock mark) 0.63; the logo laid 12 dB under a mix 0.54;
                                    # clean mixes and endings 0.20-0.41, a sting stem 0.48 (research/capabilities/publish_guard.md)


def norm(s):
    s = (s or '').upper().replace('’', "'").replace('‘', "'")
    return re.sub(r'[^A-Z0-9%]+', ' ', s.replace("'", '')).strip()


def flagged():
    sys.path.insert(0, HERE)
    import text_check
    return text_check.FLAGGED


def scene_text(scene):
    """the picture text a scene can draw: its own .js files and its script JSON, as normalised text"""
    out = []
    for p in sorted(glob.glob(os.path.join(SCENES, scene + '.js')) + glob.glob(os.path.join(SCENES, scene + '.*.js'))):
        src = open(p, encoding='utf-8', errors='replace').read()
        src = re.sub(r'(?m)^\s*//.*$', ' ', src)                              # whole-line comments are notes, not picture text
        strs = [m[1] for m in re.findall(r'''(['"`])((?:\\.|(?!\1).)*)\1''', src)]   # string literals: where picture text lives
        out.append((os.path.relpath(p, VIDEOS), '\n'.join(strs)))
    for p in glob.glob(os.path.join(VIDEOS, '..', 'research', 'scripts_final', scene + '.json')):
        try:
            words = json.load(open(p)).get('words') or []      # the on-screen words only (notes and old_snippet are history)
            out.append((os.path.relpath(p, VIDEOS), '\n'.join(w['text'] for w in words if isinstance(w, dict) and w.get('text'))))
        except (OSError, ValueError):
            pass
    return out


def check_lines(piece, scene):
    stops, notes = [], []
    texts = [('piece name', piece.replace('_', ' '))] + (scene_text(scene) if scene else [])
    for cls, lines in flagged().items():
        for line in lines:
            pat = r'(?<![A-Z0-9])' + re.escape(norm(line)).replace(r'\ ', r'\s+') + r'(?![A-Z0-9])'
            for where, txt in texts:
                if re.search(pat, norm(txt.replace('|', ' '))):
                    (stops if cls in STOP_CLASSES else notes).append(f'"{line}" ({cls}) in {where}')
    return stops, notes


def decode(path, start=None):
    ff = os.environ.get('FFMPEG', 'ffmpeg')
    try:
        import imageio_ffmpeg
        ff = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    a = [ff, '-v', 'error'] + (['-sseof', str(start)] if start else []) + ['-i', path, '-vn', '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    r = subprocess.run(a, capture_output=True)
    if r.returncode:
        raise RuntimeError(r.stderr.decode(errors='replace')[-300:])
    return np.frombuffer(r.stdout, np.float32).astype(np.float64)


def bands(x):
    """log energy in 48 log-spaced bands, 80 Hz-7 kHz, 10 ms hop"""
    from scipy.signal import stft
    f, _, Z = stft(x, fs=SR, nperseg=1024, noverlap=1024 - 160)
    M, edges = np.abs(Z), np.geomspace(80, 7000, 49)
    return np.log(np.stack([M[(f >= edges[i]) & (f < edges[i + 1])].sum(0) for i in range(48)]) + 1e-6)


def logo_score(path, tail=8):
    """How strongly the stock logo's spectro-temporal shape appears in the file's last `tail` s. Both are whitened by the tail's mean
    spectrum (so the music's tilt is not a match), then z-scored and correlated at every 10 ms lag. A plain waveform correlation
    missed the real case: COMMON_WEALTH_v13's closer scored 0.31, the same as clean mixes. The window is the closer (8 s): over 20 s
    PEOPLES_BANK_NOTE v5's own Surge stem scored 0.60 mid-piece (its jubilee stab, 25.7 s of 44), a false stop."""
    X = bands(decode(path, -tail))
    L = bands(decode(LOGO))
    e = L.max(0)
    keep = e > e.max() - 6                                   # the logo's sounding frames
    L = L[:, int(np.argmax(keep)):len(keep) - int(np.argmax(keep[::-1]))]
    T, mu = L.shape[1], X.mean(1, keepdims=True)
    if X.shape[1] <= T:
        return 0.0, 0.0
    z = lambda a: (a - a.mean()) / (a.std() + 1e-9)
    Lz = z(L - mu)
    r = np.array([(z(X[:, k:k + T] - mu) * Lz).mean() for k in range(X.shape[1] - T)])
    k = int(np.argmax(r))
    return float(r[k]), k * 160 / SR - tail


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('piece')
    ap.add_argument('file')
    ap.add_argument('--scene')
    a = ap.parse_args(argv)
    scene = a.scene
    if not scene or scene.startswith('auto'):
        try:
            sys.path.insert(0, HERE)
            import gate
            scene = gate.resolve_scene(a.file, scene or 'auto:' + a.piece)
        except Exception:
            scene = None
    stop = False
    try:
        stops, notes = check_lines(a.piece, scene)
        for s in stops:
            print(f'publish guard: STOP: {s}')
        for s in notes:
            print(f'publish guard: note: {s}')
        stop |= bool(stops)
    except Exception as e:                                     # a guard failure never stops a publish
        print(f'publish guard: lines not checked ({e})')
    try:
        r, at = logo_score(a.file)
        if r >= LOGO_NOTE:
            print(f'publish guard: note: something like the stock logo at {at:+.1f} s from the end (match {r:.2f}); listen to the closer '
                  '(advisory: the detector does not separate the real mark, 0.61, from Surge chord stabs, 0.58-0.60)')
        else:
            print(f'publish guard: logo clear (best match {r:.2f})')
    except Exception as e:
        print(f'publish guard: logo not checked ({e})')
    if not stop:
        print(f'publish guard: {a.piece} clear' + (f' (scene {scene})' if scene else ' (no scene found: name and audio only)'))
    return 2 if stop else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
