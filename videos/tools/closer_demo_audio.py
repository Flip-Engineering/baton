"""CLOSER c1: before (stock logo, as mixed today) vs after (the piece's own closer) for the pieces that have a world.
python3 videos/tools/closer_demo_audio.py [piece ...]  -> review/studio_closer_c1/after/audio/<piece>_{before,after}.wav (last 12 s), to listen to."""
import os, sys, json, wave, types
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); V = os.path.dirname(HERE)
sys.path.insert(0, V); sys.path.insert(0, os.path.join(V, 'web', 'audio'))
from engine import audio, closer
import make_audio as MA
OUT = os.path.join(V, 'review', 'studio_closer_c1', 'after', 'audio'); os.makedirs(OUT, exist_ok=True)
AT = json.load(open(os.path.join(V, 'web', 'audio', 'logo_at.json')))

def load(p):
    w = wave.open(p); x = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, w.getnchannels()).astype(float) / 32768
    return x if x.shape[1] == 2 else np.repeat(x, 2, 1)

def limit(x, peak=0.89):
    return x * min(1.0, peak / (np.abs(x).max() + 1e-9))

for name in (sys.argv[1:] or list(closer.WORLDS)):
    h = json.load(open(os.path.join(V, 'out', f'.{name}.hits.json'))); bpm = h['bpm']; at = AT[name]
    pre = load(os.path.join(V, 'out', f'.{name}.prelogo.wav'))
    song = types.SimpleNamespace(bpm=bpm, payoff=h.get('payoff'))
    before = MA.mix_sonic_logo(name, song, pre, quiet=True)
    after = closer.mix(name, pre, bpm, at)
    before, after = limit(before), limit(after)
    L = at * 60 / bpm
    s = int((L - 9) * audio.SR); e = int((L + 1.4) * audio.SR)
    for tag, y in (('before', before), ('after', after)):
        seg = y[s:e].copy(); f = int(0.4 * audio.SR); seg[-f:] *= np.linspace(1, 0, f)[:, None]
        audio.write_wav(os.path.join(OUT, f'{name}_{tag}.wav'), seg)
    print(name, 'wrote', os.path.join(OUT, f'{name}_before.wav'), 'and', f'{name}_after.wav')
