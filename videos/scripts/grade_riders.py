#!/usr/bin/env python3
"""Pre-grade the riders footage offline so scenes do no per-frame grading.

Writes web/assets/riders_graded/NNNN.jpg  (a gradient map of the red channel: black -> blood -> ACP red -> ember -> cream,
                                           so the sky keeps its gradient instead of clipping to flat #FF0000)
   and web/assets/riders_dark/NNNN.jpg    (the graded frame crushed to 14 % over #060001, the "outside" plate)
   and web/assets/riders_dim/NNNN.jpg     (the graded frame under a 40 % rgb(20,0,3) wash: the MANY backdrop, no per-frame fill)
Only the frames the scenes read are graded (default: 1,3,...,27 as lab_type uses); pass --all for every frame.
Idempotent: skips outputs that are newer than their source.
"""
import sys, os, glob
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets')
SRC, GR, DK, DM = (os.path.join(ROOT, d) for d in ('riders', 'riders_graded', 'riders_dark', 'riders_dim'))

def css_grade(a, contrast=1.9, brightness=1.25, saturate=1.2):
    a = np.clip((a - 0.5) * contrast + 0.5, 0, 1)          # CSS clamps after every primitive
    a = np.clip(a * brightness, 0, 1)
    s = saturate                                            # CSS saturate() matrix (Rec.709 luma)
    m = np.array([[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
                  [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
                  [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]])
    return np.clip(a @ m.T, 0, 1)

RAMP = np.array([[0.02, 0.0, 0.004], [0.22, 0.02, 0.04], [0.79, 0.12, 0.2], [1.0, 0.45, 0.22], [1.0, 0.86, 0.66], [1.0, 0.97, 0.9]])
def gradient_map(a, lo=0.04, hi=0.74, gamma=1.35):
    v = np.clip((a[..., 0] - lo) / (hi - lo), 0, 1) ** gamma * (len(RAMP) - 1)
    i = np.minimum(v.astype(int), len(RAMP) - 2); f = (v - i)[..., None]
    return RAMP[i] * (1 - f) + RAMP[i + 1] * f

def main():
    for d in (GR, DK, DM): os.makedirs(d, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC, '*.jpg')))
    if '--all' not in sys.argv:
        want = {f'{i * 2 + 1:04d}.jpg' for i in range(14)}
        files = [f for f in files if os.path.basename(f) in want]
    n = 0
    for f in files:
        b = os.path.basename(f); g, d, m = os.path.join(GR, b), os.path.join(DK, b), os.path.join(DM, b)
        if '--force' not in sys.argv and os.path.exists(m) and os.path.getmtime(m) >= os.path.getmtime(f): continue
        a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32) / 255
        gr = gradient_map(a) if '--css' not in sys.argv else css_grade(a)
        Image.fromarray((gr * 255 + 0.5).astype(np.uint8)).save(g, quality=92)
        dk = gr * 0.14 + np.array([6, 0, 1]) / 255 * 0.86
        Image.fromarray((dk * 255 + 0.5).astype(np.uint8)).save(d, quality=92)
        dm = gr * 0.6 + np.array([20, 0, 3]) / 255 * 0.4
        Image.fromarray((dm * 255 + 0.5).astype(np.uint8)).save(m, quality=92)
        n += 1
    print(f'graded {n} riders frames -> {GR}, {DK}, {DM}')

if __name__ == '__main__':
    main()
