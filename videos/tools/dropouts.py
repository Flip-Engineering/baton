"""Find single-frame dropouts in a rendered video: frames much darker than both neighbours (a 3D canvas copied before the GPU
finished: THE LADDER v1 on the farm, 4 Oct 2026; the print plates in CIVILIZATION v12). A cut is two frames that differ and
stay different; a dropout is one frame that dips and comes back.

usage: python3 videos/tools/dropouts.py VIDEO [--drop 0.25]     exit 1 when any dropout is found
"""
import argparse
import re
import subprocess
import sys


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return 'ffmpeg'


def lumas(path):
    p = subprocess.run([ffmpeg(), '-hide_banner', '-nostats', '-i', path, '-an', '-vf', 'scale=108:-1,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
                        '-f', 'null', '-'], capture_output=True, text=True, check=True)
    ts, ys = [], []
    for ln in p.stdout.splitlines():
        m = re.search(r'pts_time:([0-9.]+)', ln)
        if m: ts.append(float(m.group(1)))
        m = re.search(r'YAVG=([0-9.]+)', ln)
        if m: ys.append(float(m.group(1)))
    return list(zip(ts, ys))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('video')
    ap.add_argument('--drop', type=float, default=0.25, help='a frame this fraction darker than both neighbours (which agree within half that) is a dropout')
    a = ap.parse_args()
    L = lumas(a.video)
    bad = []
    for i in range(1, len(L) - 1):
        (_, p), (t, y), (_, q) = L[i - 1], L[i], L[i + 1]
        ref = (p + q) / 2
        if ref > 12 and y < ref * (1 - a.drop) and abs(p - q) < ref * a.drop / 2:
            bad.append((t, y, ref))
    print(f'{a.video}: {len(L)} frames, {len(bad)} dropout(s)')
    for t, y, ref in bad[:40]:
        print(f'  {t:7.3f} s  luma {y:5.1f} (neighbours {ref:5.1f})')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
