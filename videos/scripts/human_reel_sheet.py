#!/usr/bin/env python3
"""Sheets for the HUMAN studio reel (cycle 1): the 6 x 3 grid, and the gallop overlay against Muybridge.

    python3 videos/scripts/human_reel_sheet.py [after_dir]
      -> reel_grid.jpg               rows: profile, hand, climb, crowd, rider, face; columns: lit 3D, rim, print
      -> ref_gallop_overlay.jpg      (needs clip_rider_rim.mp4) each of the 15 Muybridge frames beside the clip frame
                                     on the same phase, and the two silhouettes overlaid (red = photo, cyan = render)
"""
import os, sys, json, subprocess
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
AFTER = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'review', 'studio_human_c1', 'after')
ROWS = ['profile', 'hand', 'climb', 'crowd', 'rider', 'face']
COLS = [('lit', 'LIT 3D'), ('rim', 'RIM / SILHOUETTE'), ('print', 'PRINT')]
CW, CH = 360, 640

def label(img, text, y=28, scale=0.75):
    cv2.putText(img, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(img, text, (10, y), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 1, cv2.LINE_AA)

def grid():
    rows = []
    for r in ROWS:
        cells = []
        for m, name in COLS:
            f = os.path.join(AFTER, f'{r}_{m}.jpg')
            if os.path.exists(f): im = cv2.resize(cv2.imread(f), (CW, CH), interpolation=cv2.INTER_AREA)
            else: im = np.full((CH, CW, 3), 40, np.uint8); label(im, 'MISSING', CH // 2)
            label(im, f'{r} / {name}'); cells.append(im)
        rows.append(np.hstack(cells))
    out = os.path.join(AFTER, 'reel_grid.jpg'); cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out)

def gallop():
    clip = os.path.join(AFTER, 'clip_rider_rim.mp4')
    if not os.path.exists(clip): return
    J = json.load(open(os.path.join(HERE, '..', 'web', 'assets', 'muybridge', 'gallop.json')))
    ff = subprocess.check_output(['python3', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).decode().strip()
    tmp = os.path.join(AFTER, '.gallop_frames'); os.makedirs(tmp, exist_ok=True)
    subprocess.run([ff, '-y', '-loglevel', 'error', '-i', clip, '-vframes', '15', os.path.join(tmp, 'f%02d.png')], check=True)
    from PIL import Image, ImageSequence
    photos = [np.array(f.convert('L')) for f in ImageSequence.Iterator(Image.open(os.path.join(HERE, '..', 'sources', 'muybridge', 'Muybridge_race_horse_animated.gif')))]
    cells = []
    for k in range(15):
        ph = cv2.resize(cv2.cvtColor(photos[k].astype(np.uint8), cv2.COLOR_GRAY2BGR), (300, 200))
        fr = cv2.imread(os.path.join(tmp, f'f{k + 1:02d}.png'))
        # the clip's hero horse: the rider scene places it at x=560, ground y=1500, s=0.8 over the 1200x800 trace
        s = 0.8; x0 = int(560 - 600 * s); y0 = int(1500 - J['frames'][k]['ground'] * s)
        crop = fr[max(0, y0):y0 + int(800 * s), max(0, x0):x0 + int(1200 * s)]
        crop = cv2.resize(crop, (300, 200))
        sil = np.zeros((800, 1200), np.uint8); cv2.drawContours(sil, [np.array(p, np.int32) for p in J['frames'][k]['polys']], -1, 255, -1)
        sil = cv2.resize(sil, (300, 200)); ov = np.full((200, 300, 3), 250, np.uint8)
        ov[(photos[k] < 105)] = (60, 60, 220); ov[sil > 127] = (ov[sil > 127] * 0.4 + np.array([200, 180, 40]) * 0.6).astype(np.uint8)
        cell = np.hstack([ph, crop, ov]); label(cell, f'frame {k + 1}', 22, 0.55); cells.append(cell)
    out = os.path.join(AFTER, 'ref_gallop_overlay.jpg'); cv2.imwrite(out, np.vstack([np.hstack(cells[i:i + 3]) for i in range(0, 15, 3)]), [cv2.IMWRITE_JPEG_QUALITY, 86]); print(out)
    for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)

if __name__ == '__main__':
    grid(); gallop()
