#!/usr/bin/env python3
"""Hit meter: the level at each script cue, as information. An optional diagnostic for a cue a listener cannot hear;
whether a cue lands, and whether the ending out-shouts the payoff, is heard on a phone, not read here (8 Oct).

For every on-screen line in out/.<scene>.hits.json (the 'text' cues make_audio.py writes) and for the
closer (logo_at.json beat) it reads the song master (out/.<scene>.wav) or any rendered clip and reports:

  rms150   150 ms RMS (dBFS) from 20 ms before the cue: the transient a phone speaker plays
  mom400   400 ms momentary loudness (LUFS, BS.1770 K-weighted) from 50 ms before the cue
  hi150    150 ms RMS above 150 Hz (dBFS): the hit without the sub (the sonic logo is sub-heavy)
  lead     400 ms momentary loudness of the lead-in (600-200 ms before the cue)
  jump     mom400 - lead

No verdicts and no ranking: the table is a readout. The declared payoff (hits.json 'payoff', else the last line before
the closer; --payoff to name it) is marked so a reader can find it.

Usage:
  scripts/hit_meter.py bank3                              # song master out/.bank3.wav
  scripts/hit_meter.py bank3 --media review/x/clip.mp4 --from 13.714   # a clip; --from = piece time at file 0
  scripts/hit_meter.py bank3 --payoff b64 --json
  scripts/hit_meter.py --selftest                         # synthetic check of the meter
Library: from hit_meter import meter; meter('bank3') -> dict (rows of numbers; no warnings).
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
OUT = os.path.join(VIDEOS, 'out')
LOGO_AT = os.path.join(VIDEOS, 'web', 'audio', 'logo_at.json')
SR = 48000
try:
    import shutil
    FFMPEG = shutil.which('ffmpeg') or __import__('imageio_ffmpeg').get_ffmpeg_exe()
except Exception:  # noqa: BLE001
    FFMPEG = 'ffmpeg'


def decode(path, sr=SR):
    """Any audio/video file -> float32 (n, 2) at sr, via ffmpeg."""
    r = subprocess.run([FFMPEG, '-v', 'error', '-i', path, '-vn', '-ac', '2', '-ar', str(sr), '-f', 'f32le', '-'],
                       capture_output=True, check=True)
    return np.frombuffer(r.stdout, dtype=np.float32).reshape(-1, 2)


def k_weight(x, sr=SR):
    """BS.1770-4 K-weighting (high shelf + RLB high-pass), designed for any sample rate."""
    f0, g, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = math.tan(math.pi * f0 / sr); vh = 10 ** (g / 20); vb = vh ** 0.4996667741545416
    a0 = 1 + k / q + k * k
    b1 = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0]
    a1 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    f0, q = 38.13547087602444, 0.5003270373238773
    k = math.tan(math.pi * f0 / sr)
    a0 = 1 + k / q + k * k
    b2 = [1, -2, 1]
    a2 = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def _win(x, t, pre, length, sr=SR):
    i0 = int(round((t - pre) * sr)); i1 = i0 + int(round(length * sr))
    i0, i1 = max(0, i0), min(len(x), i1)
    return x[i0:i1] if i1 - i0 > sr * 0.02 else None


def _db(v, floor=-120.0):
    return round(max(floor, 10 * math.log10(v)) if v > 0 else floor, 1)


def measure(x, t, sr=SR, kw=None, hp=None):
    """The five numbers for one cue at file time t (seconds)."""
    kw = k_weight(x, sr) if kw is None else kw
    hp = signal.sosfilt(signal.butter(4, 150, 'highpass', fs=sr, output='sos'), x, axis=0) if hp is None else hp
    ms = lambda w: float(np.mean(w ** 2) * 2) if w is not None else 0.0      # sum of 2 channels' mean square
    rms = lambda w: float(np.mean(w ** 2)) if w is not None else 0.0
    m = {'rms150': _db(rms(_win(x, t, 0.02, 0.15, sr))),
         'mom400': round(-0.691 + _db(ms(_win(kw, t, 0.05, 0.4, sr))), 1),
         'hi150': _db(rms(_win(hp, t, 0.02, 0.15, sr))),
         'lead': round(-0.691 + _db(ms(_win(kw, t, 0.6, 0.4, sr))), 1) if t >= 0.6 else None}
    m['jump'] = round(m['mom400'] - m['lead'], 1) if m['lead'] is not None else None
    return m


def cues_for(scene, hits):
    """[(piece_t, label, beat, emphasis)] from hits.json text cues + the closer from logo_at.json."""
    bpm = hits.get('bpm') or 120
    spb = 60.0 / bpm
    out = []
    for c in hits.get('text') or []:
        if c.get('name', 'line') not in ('line', 'stamp', 'payoff', 'emph', 'emphasis') and 'text' not in c:
            continue
        emph = bool(c.get('emphasis')) or c.get('name') in ('emph', 'emphasis', 'payoff')
        out.append((float(c['t']), c.get('text', c.get('name', '?')), round(float(c['t']) / spb, 2), emph))
    if not out:        # song wrote no text cues: fall back to the script's beats (research/scripts_final/<key>.json)
        for w in script_words(scene):
            if w.get('beat') is not None and w.get('text'):
                out.append((float(w['beat']) * spb, w['text'], float(w['beat']), bool(w.get('emphasis'))))
    try:
        at = json.load(open(LOGO_AT)).get(scene)
    except Exception:  # noqa: BLE001
        at = None
    if at is not None:
        out.append((at * spb, '[closer / sonic logo]', float(at), False))
    return sorted(out), spb, at


def script_words(scene):
    """research/scripts_final/<key>.json 'words' (key = scene minus trailing digits), or []."""
    sys.path.insert(0, os.path.join(VIDEOS, 'scripts'))
    from script_key import script_path   # TOOLING WM1: exact name first (machines_e1, gary2036)
    p = script_path(scene) or ''
    try:
        return json.load(open(p)).get('words', []) or []
    except Exception:  # noqa: BLE001
        return []


def script_emphasis(scene):
    """Upper-cased texts of the lines the script marks emphasis."""
    return {w['text'].strip().upper() for w in script_words(scene) if w.get('emphasis') and w.get('text')}


def _parse_t(v, spb):
    v = str(v).strip()
    return float(v[1:]) * spb if v.lower().startswith('b') else float(v.rstrip('s'))


def meter(scene, media=None, start=0.0, payoff=None):
    """Measure every cue of `scene`. media: file to read (default out/.<scene>.wav); start: piece time at file 0."""
    hp_ = os.path.join(OUT, f'.{scene}.hits.json')
    if not os.path.exists(hp_):
        raise SystemExit(f'hit_meter: no {hp_} (run make_audio.py {scene} or render once)')
    hits = json.load(open(hp_))
    media = media or os.path.join(OUT, f'.{scene}.wav')
    x = decode(media).astype(np.float64)
    kw = k_weight(x)
    hpf = signal.sosfilt(signal.butter(4, 150, 'highpass', fs=SR, output='sos'), x, axis=0)
    cues, spb, closer_beat = cues_for(scene, hits)
    emph_words = script_emphasis(scene)
    cues = [(t, l, b, e or l.strip().upper() in emph_words) for t, l, b, e in cues]
    dur = len(x) / SR
    rows = []
    for t, label, beat, emph in cues:
        ft = t - start
        if ft < -0.01 or ft > dur - 0.05:
            continue
        rows.append({'t': round(t, 3), 'beat': beat, 'text': label, 'emphasis': emph,
                     'closer': label.startswith('[closer'), **measure(x, max(0.0, ft), kw=kw, hp=hpf)})
    lines = [r for r in rows if not r['closer']]
    # the payoff is chosen from the whole script (not just the cues inside a clip), then looked up in the rows
    line_cues = [c for c in cues if not c[1].startswith('[closer')]
    closer_t = closer_beat * spb if closer_beat is not None else None
    if payoff is None and isinstance(hits.get('payoff'), dict) and hits['payoff'].get('t') is not None:
        payoff = float(hits['payoff']['t'])  # MUSIC c3: the song declares its payoff (the scene's authored one)
    if payoff is not None:
        pt = _parse_t(payoff, spb)
    else:
        before = [c[0] for c in line_cues if closer_t is None or c[0] < closer_t - 0.05]
        pt = before[-1] if before else (line_cues[-1][0] if line_cues else None)
    pay = next((r for r in lines if pt is not None and abs(r['t'] - pt) < 0.06), None) if payoff is None else \
        min(lines, key=lambda r: abs(r['t'] - pt), default=None)
    if pay:
        pay['payoff'] = True
    return {'scene': scene, 'media': os.path.relpath(media, VIDEOS) if media.startswith(VIDEOS) else media,
            'start': start, 'bpm': hits.get('bpm'), 'closer_beat': closer_beat,
            'payoff': pay and {'beat': pay['beat'], 'text': pay['text']}, 'rows': rows}


def show(res):
    w = sys.stdout.write
    w(f'hit meter: {res["scene"]}  ({res["media"]}, {res["bpm"]} BPM, closer b{res["closer_beat"]})\n')
    w(f'{"beat":>6} {"t":>7}  {"rms150":>7} {"mom400":>7} {"hi150":>7} {"lead":>7} {"jump":>6}  cue\n')
    for r in res['rows']:
        tag = ' <- payoff' if r.get('payoff') else ''
        lead = f'{r["lead"]:+7.1f}' if r['lead'] is not None else '      -'
        jump = f'{r["jump"]:+6.1f}' if r['jump'] is not None else '     -'
        w(f'{r["beat"]:>6g} {r["t"]:7.2f}  {r["rms150"]:+7.1f} {r["mom400"]:+7.1f} {r["hi150"]:+7.1f} {lead} {jump}  '
          f'{"!" if r["emphasis"] else " "}{r["text"]}{tag}\n')
    w('(! emphasis line; jump = mom400 - 400 ms lead-in; a readout: listen on a phone for whether a cue lands)\n')
    if not any(not r['closer'] for r in res['rows']):
        w('INFO  no line cues in hits.json or the script: only the closer was metered\n')


def selftest():
    """Synthetic song: quiet bed, three hits, the middle one loudest; the meter must rank them and see the jumps."""
    import tempfile
    import wave
    n = SR * 6
    rng = np.random.default_rng(1)
    x = rng.normal(0, 0.01, (n, 2))
    for t, a in ((1.0, 0.1), (3.0, 0.5), (5.0, 0.2)):
        i = int(t * SR); env = np.exp(-np.arange(int(0.3 * SR)) / (0.08 * SR))
        burst = rng.normal(0, 1, (len(env), 1)) * env[:, None] * a
        x[i:i + len(env)] += burst
    kw = k_weight(x)
    ms = [measure(x, t, kw=kw) for t in (1.0, 3.0, 5.0)]
    assert ms[1]['mom400'] > ms[2]['mom400'] > ms[0]['mom400'], ms
    assert ms[1]['hi150'] > ms[0]['hi150'], ms
    assert all(m['jump'] > 6 for m in ms), ms
    # BS.1770 calibration: a 997 Hz sine peaking at -20 dBFS in both channels reads -20.0 LUFS
    s = 0.1 * np.sin(2 * np.pi * 997 * np.arange(SR) / SR)
    m = measure(np.stack([s, s], 1), 0.3)
    assert abs(m['mom400'] + 20.0) < 0.2, m
    # round trip through a wav file + ffmpeg decode
    with tempfile.NamedTemporaryFile(suffix='.wav') as f:
        wv = wave.open(f.name, 'wb'); wv.setnchannels(2); wv.setsampwidth(2); wv.setframerate(SR)
        wv.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()); wv.close()
        y = decode(f.name)
        assert abs(measure(y.astype(np.float64), 3.0)['mom400'] - ms[1]['mom400']) < 0.3
    print('hit_meter selftest: OK', [m['mom400'] for m in ms])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__)
    ap.add_argument('scene', nargs='?')
    ap.add_argument('--media', help='audio or video to read (default out/.<scene>.wav)')
    ap.add_argument('--from', dest='start', default='0', help='piece time at file 0, seconds or b<beat>')
    ap.add_argument('--payoff', help='payoff cue, seconds or b<beat> (default: the last line before the closer)')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.scene:
        ap.error('scene required')
    media = a.media
    start = 0.0
    if media:
        media = os.path.abspath(media)
        hits = json.load(open(os.path.join(OUT, f'.{a.scene}.hits.json')))
        start = _parse_t(a.start, 60.0 / (hits.get('bpm') or 120))
        m = re.match(r'.*_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\.mp4$', media)
        if a.start == '0' and m:
            start = float(m.group(1))       # render.mjs clip names carry the piece window
    res = meter(a.scene, media, start, a.payoff)
    if a.json:
        json.dump(res, sys.stdout, indent=1); print()
    else:
        show(res)


if __name__ == '__main__':
    main()
