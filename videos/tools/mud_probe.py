#!/usr/bin/env python3
"""mud_probe: what a phone viewer sees of a print-style frame (STUDIO CIV ASSETS c1, 1 Oct; from the critic's probe).

A seeing aid: it re-encodes the frames the way a platform will (H.264, 1080x1920 at 8 Mb/s, and the 540x960 2.8 Mb/s copy
CIVILIZATION was delivered as), decodes them again, and writes a sheet of each frame's crop that changes most in the round
trip, side by side (master | 8 Mb/s | 540p), for a person to look at. A dot screen finer than a phone resolves is averaged
by the eye and by the encoder into its mean colour; whether the print reads as ink or as mud is judged on the sheet.

    python3 videos/tools/mud_probe.py DIR_OF_JPGS --sheet out.jpg
"""
import sys, os, glob, argparse, subprocess, tempfile, shutil
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

FFMPEG = shutil.which('ffmpeg') or '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'

def encode_roundtrip(frames, tmp):
    """encode the frames as a 2-fps clip at platform-like bitrates, decode back; returns {label: [PIL images]}"""
    out = {}
    for i, f in enumerate(frames): Image.open(f).convert('RGB').resize((1080, 1920)).save(os.path.join(tmp, f'f{i:04d}.png'))
    for label, size, rate in (('8M', '1080x1920', '8M'), ('540p', '540x960', '2.8M')):
        mp4 = os.path.join(tmp, label + '.mp4')
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-framerate', '2', '-i', os.path.join(tmp, 'f%04d.png'), '-s', size, '-c:v', 'libx264',
                        '-b:v', rate, '-maxrate', rate, '-bufsize', rate, '-pix_fmt', 'yuv420p', '-preset', 'medium', mp4], check=True)
        dec = os.path.join(tmp, label + '_%04d.png')
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', mp4, '-s', '1080x1920', dec], check=True)
        out[label] = [Image.open(dec % (i + 1)).convert('RGB') for i in range(len(frames))]
    return out

def hf(a):  # fine-detail energy: the image minus its 3-px blur
    g = a.convert('L'); b = g.filter(ImageFilter.GaussianBlur(1.5)); return np.abs(np.asarray(g, float) - np.asarray(b, float))

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('--sheet', required=True); ap.add_argument('--inks', help='(unused; kept for old command lines)')
    ap.add_argument('--encode', action='store_true', help='(always on; kept for old command lines)')
    a = ap.parse_args()
    files = sorted(glob.glob(os.path.join(a.dir, '*.jpg')) + glob.glob(os.path.join(a.dir, '*.png')))
    if not files:
        sys.exit('mud_probe: no jpg/png in ' + a.dir)
    tmp = tempfile.mkdtemp(prefix='mud_')
    try:
        enc = encode_roundtrip(files, tmp)
        tiles = []
        for i, f in enumerate(files):
            im = Image.open(f).convert('RGB')
            if im.size != (1080, 1920): im = im.resize((1080, 1920), Image.LANCZOS)
            # where to look: the 360x360 crop whose fine detail changes most at 8 Mb/s (a locator, not a score)
            m = hf(im); lost = np.abs(m - hf(enc['8M'][i])); best, by = -1, (0, 0)
            for y in range(0, 1920 - 360, 120):
                for x in range(0, 1080 - 360, 120):
                    v = lost[y:y + 360, x:x + 360].mean()
                    if v > best: best, by = v, (x, y)
            x, y = by; t = Image.new('RGB', (1080, 380), (20, 20, 20))
            for j, src in enumerate((im, enc['8M'][i], enc['540p'][i])): t.paste(src.crop((x, y, x + 360, y + 360)), (j * 360, 0))
            ImageDraw.Draw(t).text((6, 362), f"{os.path.basename(f)}  master | 8 Mb/s | 540p 2.8 Mb/s   crop at {x},{y}", fill=(230, 230, 230)); tiles.append(t)
        sh = Image.new('RGB', (1080, 380 * len(tiles))); [sh.paste(t, (0, 380 * i)) for i, t in enumerate(tiles)]; sh.save(a.sheet, quality=88); print('sheet', a.sheet)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == '__main__': main()
