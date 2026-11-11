"""☭≡/acc sonic logo: ~2.4 s, the ident's build in sound.
   the mark (a struck anvil over a sub) -> ≡ three rising bars (A, C#, E) -> the / slash (a fast upward swipe)
   -> /acc locks on an A-major brass chord with a gong tail.  One motif, the same everywhere it is used.
   python3 videos/tools/sonic_logo.py  -> videos/web/assets/acc_sonic_logo.wav (+ .m4a), -14 LUFS
   MUSIC c7: python3 videos/tools/sonic_logo.py --key D --mode minor  -> web/assets/acc_sonic_logo_D_minor.wav: the same pattern in another key
   (root and third moved; the unpitched clang and gong, whose partials read Ab, C and D in most keys, are left out).  Songs on engine/daw
   voice the mark with their own players instead (engine/daw/logo.py: horde, empire)."""
import os, sys, subprocess
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, VIDEOS)
from engine import audio as A

SR = A.SR
T = 2.6
# MUSIC c7: --key C|C#|D|Eb|E|F|F#|G|Ab|A|Bb|B  --mode major|minor  (default: the c1 A-major mark, unchanged)
KEY = sys.argv[sys.argv.index('--key') + 1] if '--key' in sys.argv else None
MODE = sys.argv[sys.argv.index('--mode') + 1] if '--mode' in sys.argv else 'major'
if KEY:
    pc = 'C C# D Eb E F F# G Ab A Bb B'.split().index(KEY)
    SH = (pc - 9 + 6) % 12 - 6                     # semitones from A, kept in -6..5 so every voice stays in range
    TH = 4 if MODE == 'major' else 3
else:
    SH, TH = 0, 4
out = np.zeros(int(T * SR))

def put(sig, t, gain=1.0):
    sig = np.asarray(sig, dtype=float)
    if sig.ndim > 1: sig = sig.mean(axis=1)
    i = int(t * SR); n = min(len(sig), len(out) - i)
    out[i:i + n] += sig[:n] * gain

# the mark: anvil + sub
if not KEY: put(A.clang(), 0.0, 0.9)
put(A.impact(), 0.0, 0.8); put(A.bass808(33 + SH, dur=0.5, drive=2.0), 0.0, 0.7)
# ≡: three rising bars, tight metallic stabs
for k, (n, t) in enumerate([(57 + SH, 0.34), (57 + SH + TH, 0.48), (64 + SH, 0.62)]):
    put(A.square_lead(n + 12, 0.12, decay=14.0), t, 0.45)
    if not KEY: put(A.clang(), t, 0.25 + 0.1 * k)
# /: the slash, a fast rising noise swipe
sw = A.riser(0.22); put(sw[-int(0.16 * SR):], 0.74, 0.5)
# acc: the lock, A major in brass + pad, gong tail
put(A.brass([45 + SH, 57 + SH, 57 + SH + TH, 64 + SH, 69 + SH], 1.6), 0.9, 0.8); put(A.pad([57 + SH, 57 + SH + TH, 64 + SH, 69 + SH], 1.7), 0.9, 0.35)
put(A.impact(), 0.9, 0.7); put(A.bass808(33 + SH, dur=1.2, drive=1.5), 0.9, 0.6)
if not KEY: put(A.gong(), 0.9, 0.5)

out[-int(0.35 * SR):] *= np.linspace(1, 0, int(0.35 * SR))
g = 10 ** ((-14.0 - A.lufs(out)) / 20); out *= g
pk = np.max(np.abs(out)); out *= min(1.0, 0.89 / pk)
st = np.stack([out, out], axis=1)
dst = os.path.join(VIDEOS, 'web', 'assets', 'acc_sonic_logo.wav' if not KEY else f'acc_sonic_logo_{KEY}_{MODE}.wav')
A.write_wav(dst, st)
ff = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
subprocess.run([ff, '-y', '-loglevel', 'error', '-i', dst, '-c:a', 'aac', '-b:a', '256k', dst[:-4] + '.m4a'])
print(dst, f'{len(out)/SR:.2f}s', f'LUFS {A.lufs(out):.1f}', f'peak {20*np.log10(np.max(np.abs(out))):.1f} dBFS')
