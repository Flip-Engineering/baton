"""MECHA c7: bake four short Master Hands (1936, Jam Handy for Chevrolet, public domain) clips into the piece's
red-and-cream print grade: web/assets/mecha_mh/<clip>_<nn>.jpg (30 fps, 810x608). Picture only; the film's score is not used.
  A1 Part I  01:58.3  hands, a vernier caliper and a part       (the workman makes use of a tool)
  A2 Part I  02:02.6  a toolmaker's face, eyes on the work      (the workman)
  B1 Part IV 06:36.5  men at the stamping press, backs to us    (the machine makes use of him)
  B2 Part IV 05:16.5  men at the big press, following it        (the machine makes use of him)
"""
import subprocess, sys, os, shutil, glob
import numpy as np
from PIL import Image, ImageFilter
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
SRC = '/home/user/acp-agitprop/videos/sources/footage/'
OUT = '/home/user/acp-agitprop/videos/web/assets/mecha_mh/'
CLIPS = {'A1': ('MasterHa1936.mp4', 118.3, 1.1), 'A2': ('MasterHa1936.mp4', 122.6, 1.1),
         'B1': ('MasterHa1936_4.mp4', 396.5, 1.3), 'B2': ('MasterHa1936_4.mp4', 316.5, 1.3)}
STOPS = [(0.0, '#0b0203'), (0.28, '#5a0a14'), (0.55, '#c91f37'), (0.8, '#ee9a86'), (1.0, '#f4e6d0')]
def hexc(h): return np.array([int(h[i:i+2], 16) for i in (1, 3, 5)], float)
xs = np.array([s[0] for s in STOPS]); cs = np.stack([hexc(s[1]) for s in STOPS])
lut = np.stack([np.interp(np.linspace(0, 1, 256), xs, cs[:, k]) for k in range(3)], 1).astype(np.uint8)
os.makedirs(OUT, exist_ok=True); tmp = '/tmp/claude-0/mh_bake'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
for k, (f, ss, d) in CLIPS.items():
    subprocess.run([FF, '-y', '-loglevel', 'error', '-ss', str(ss), '-t', str(d), '-i', SRC + f, '-vf', 'fps=30,scale=810:608:flags=lanczos', f'{tmp}/{k}_%02d.png'], check=True)
    for p in sorted(glob.glob(f'{tmp}/{k}_*.png')):
        im = Image.open(p).convert('L').filter(ImageFilter.UnsharpMask(2, 120, 2))
        a = np.asarray(im, float) / 255
        lo, hi = np.percentile(a, 2), np.percentile(a, 99.3)
        a = np.clip((a - lo) / (hi - lo + 1e-6), 0, 1); a = a * a * (3 - 2 * a) * 0.6 + a * 0.4        # S-curve
        rgb = lut[(a * 255).astype(np.uint8)]
        Image.fromarray(rgb).save(OUT + os.path.basename(p).replace('.png', '.jpg'), quality=82)
    print(k, len(glob.glob(f'{OUT}{k}_*.jpg')))
shutil.rmtree(tmp)
