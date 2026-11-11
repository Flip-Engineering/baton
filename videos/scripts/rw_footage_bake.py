"""RED WEDGE footage bake: Steel: Man's Servant (1938, US Steel, PD Mark 1.0) frames -> four-ink silkscreen plates,
1080x1920 jpgs in web/assets/src/rw/. Deterministic. python3 scripts/rw_footage_bake.py"""
import subprocess, os, glob, numpy as np
from PIL import Image
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__)); V = os.path.dirname(HERE)
SRC = V + '/sources/footage/'; OUT = V + '/web/assets/src/rw/'; TMP = '/tmp/claude-0/scr/rwbake/'
os.makedirs(OUT, exist_ok=True); os.makedirs(TMP, exist_ok=True)
INKS = [(244, 226, 192), (240, 138, 42), (212, 16, 28), (90, 10, 8), (20, 6, 6)]
CUTS = [0.60, 0.42, 0.27, 0.13]
SEQ = {  # name: (file, start s, dur s, crop x0 of 1440, fps)
    'face': ('steel_0516.mp4', 5.5, 1.5, 340, 12),
    'rake': ('steel_1258.mp4', 0.0, 3.4, 176, 12),
    'pour': ('steel_0516.mp4', 11.0, 2.4, 300, 12),
}
def plate(im, seed):
    a = np.asarray(im.convert('RGB'), dtype=np.float32)
    L = (a[..., 0] * .3 + a[..., 1] * .55 + a[..., 2] * .15) / 255
    lo, hi = np.percentile(L, 3), np.percentile(L, 99.3)
    L = np.clip((L - lo) / (hi - lo + 1e-6), 0, 1) ** 0.85
    r = np.random.default_rng(seed); h, w = L.shape
    out = np.empty((h, w, 3), np.uint8); out[:] = INKS[0]
    for k, cut in enumerate(CUTS):
        dx, dy = r.integers(-3, 4, 2)
        Ls = np.roll(np.roll(L, dx, 1), dy, 0) + r.normal(0, 0.012, L.shape)
        out[Ls < cut] = INKS[k + 1]
    return Image.fromarray(out)
for name, (f, ss, dur, x0, fps) in SEQ.items():
    for p in glob.glob(TMP + name + '_*.png'): os.remove(p)
    subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', str(ss), '-t', str(dur), '-i', SRC + f, '-vf',
                    f'fps={fps},crop=608:1080:{x0}:0,scale=1080:1920:flags=lanczos', TMP + name + '_%03d.png'], check=True)
    fr = sorted(glob.glob(TMP + name + '_*.png'))
    for i, p in enumerate(fr):
        plate(Image.open(p), 5 + i % 3).save(OUT + f'{name}_{i:02d}.jpg', quality=88)
    print(name, len(fr))
