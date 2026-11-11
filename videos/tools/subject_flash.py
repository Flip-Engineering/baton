"""subject_flash.py: the photosensitive-flash screen of THE SUBJECT (v3, 1 Oct), on the rendered video. A safety and accessibility
spec, not a judgement of the picture; whether the lock reads is judged by watching.

    python3 tools/subject_flash.py VIDEO.mp4 [--json OUT]       # run from videos/

1. Photosensitive flashes (a Harding/WCAG-style screen, not a certified test): per frame the mean relative luminance of the whole frame
   and of the brightest-changing quarter (a 2x2 grid of regions); a "flash" is a pair of opposing changes of at least 0.1 in relative
   luminance where the darker state is under 0.8. WCAG 2.3.1's general threshold: no more than 3 flashes in any one-second window.
"""
import argparse, json, subprocess, sys
import numpy as np

FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'


def frames(path, w=270, h=480):
    p = subprocess.Popen([FF, '-v', 'error', '-i', path, '-vf', 'scale=%d:%d' % (w, h), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    n = w * h * 3
    while True:
        b = p.stdout.read(n)
        if len(b) < n:
            break
        yield np.frombuffer(b, np.uint8).reshape(h, w, 3)


def rel_lum(im):
    x = im.astype(np.float32) / 255.0
    x = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    return 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]


def flashes(Y, fps=30):
    """Y: (n,) luminance -> frames where a flash completes. Changes are counted with 0.1 hysteresis between turning points (a slow ramp
    is one change); two opposing changes make one flash; a change counts only when its darker end is under 0.8."""
    out, changes = [], []
    ext, dirn = Y[0], 0
    for f in range(1, len(Y)):
        y = Y[f]
        if dirn != 1 and y - ext >= 0.1 and min(y, ext) < 0.8:
            changes.append((f, 1)); dirn, ext = 1, y
        elif dirn != -1 and ext - y >= 0.1 and min(y, ext) < 0.8:
            changes.append((f, -1)); dirn, ext = -1, y
        elif dirn == 1 and y > ext:
            ext = y
        elif dirn == -1 and y < ext:
            ext = y
    k = 1
    while k < len(changes):                      # non-overlapping pairs: up-down-up-down is two flashes
        if changes[k][1] == -changes[k - 1][1]:
            out.append(changes[k][0]); k += 2
        else:
            k += 1
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video'); ap.add_argument('--beats', type=float, help='(unused; kept for old command lines)'); ap.add_argument('--lock', type=float, help='(unused)')
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    Ys, Yq = [], []
    for im in frames(a.video):
        L = rel_lum(im)
        Ys.append(float(L.mean()))
        h, w = L.shape
        Yq.append([float(L[:h // 2, :w // 2].mean()), float(L[:h // 2, w // 2:].mean()), float(L[h // 2:, :w // 2].mean()), float(L[h // 2:, w // 2:].mean())])
    Ys, Yq = np.array(Ys), np.array(Yq)
    n = len(Ys)
    res = {'frames': n}
    worst = 0
    allf = {}
    for name, Y in [('whole', Ys)] + [('quarter%d' % k, Yq[:, k]) for k in range(4)]:
        fl = flashes(Y)
        c = max((sum(1 for x in fl if s <= x < s + 30) for s in range(0, n)), default=0)
        allf[name] = dict(flashes=len(fl), max_per_second=c, at=[round(x / 30.0, 2) for x in fl][:20])
        worst = max(worst, c)
    res['flash'] = dict(per_region=allf, worst_max_per_second=worst, wcag_2_3_1_general=('PASS' if worst <= 3 else 'FAIL'))

    print(json.dumps(res, indent=1))
    if a.json:
        json.dump(res, open(a.json, 'w'), indent=1)


if __name__ == '__main__':
    main()
