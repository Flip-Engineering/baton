#!/usr/bin/env python3
"""HUMAN c4 demo sheets: every cell at full screen (shown at 540 wide) and at feed size (270 px), beside its source or
the published bar. Reads review/studio_human_c4/after/cells/*.jpg, the two clips and before/ (published frames, refs).

  python3 videos/scripts/human_c4_sheets.py      -> review/studio_human_c4/after/sheet_*.jpg
"""
import os
import subprocess
import cv2
import numpy as np

VID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
A = os.path.join(VID, 'review', 'studio_human_c4', 'after')
B = os.path.join(VID, 'review', 'studio_human_c4', 'before')
C = os.path.join(A, 'cells')
FF = subprocess.check_output(['python3', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).decode().strip()


def rd(p):
    im = cv2.imread(p)
    if im is None: raise FileNotFoundError(p)
    return im


def fit(im, h):
    return cv2.resize(im, (int(round(im.shape[1] * h / im.shape[0])), h), interpolation=cv2.INTER_AREA)


def lab(im, text, col=(0, 230, 255)):
    im = im.copy(); cv2.rectangle(im, (0, 0), (im.shape[1], 22), (0, 0, 0), -1)
    cv2.putText(im, text, (5, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, col, 1, cv2.LINE_AA); return im


def row(ims, gap=6, bg=(24, 24, 24)):
    h = max(i.shape[0] for i in ims); out = []
    for i in ims:
        out.append(cv2.copyMakeBorder(i, 0, h - i.shape[0], 0, gap, cv2.BORDER_CONSTANT, value=bg))
    return np.hstack(out)


def col(rows, gap=6, bg=(24, 24, 24)):
    w = max(r.shape[1] for r in rows)
    return np.vstack([cv2.copyMakeBorder(r, 0, gap, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=bg) for r in rows])


def frames(mp4, idx):
    cap = cv2.VideoCapture(mp4); out = []
    for i in idx:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, im = cap.read(); out.append(im if ok else np.zeros((1920, 1080, 3), np.uint8))
    return out


def cell(im, name):   # a cell at full screen shown at 960 px tall, and its 270 px twin beside it
    return row([lab(fit(im, 960), name), lab(fit(im, 480), '270 px')])


def save(name, im):
    p = os.path.join(A, name); cv2.imwrite(p, im, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(p)


# 1. the surge (RED WEDGE 15.4-17.4 s; the hit on the measured ACCENT at 16.8 = clip frame 42)
fr = frames(os.path.join(A, 'surge_redwedge_15.4-17.4.mp4'), [18, 39, 42, 43, 50, 58])
names = ['f18 16.0 EVERYBODY. beat', 'f39 anticipation (freeze)', 'f42 THE HIT (plates swap)', 'f43 overshoot', 'f50 settle, fists pumping', 'f58 17.33']
bar = [lab(fit(rd(os.path.join(B, 'published', 'RED_WEDGE_v10_16.0.jpg')), 480), 'RED WEDGE v10 16.0 (bar)'),
       lab(fit(rd(os.path.join(B, 'published', 'HORDE_v12_14.5.jpg')), 480), 'HORDE v12 14.5 (bar)')]
c3 = os.path.join(VID, 'review', 'studio_human_c3', 'after', 'clips', 'strip_surge_raw_hit.jpg')
rows = [row([lab(fit(f, 960), n) for f, n in zip(fr[1:4], names[1:4])]),
        row([lab(fit(f, 480), '270: ' + n) for f, n in zip(fr, names)] + bar)]
if os.path.exists(c3): rows.append(lab(fit(rd(c3), 300), 'HUMAN c3 surge strip (before)'))
save('sheet_1_surge.jpg', col(rows))

# 2-4. three archival workers into figures, each three ways, beside the source frame and the matte
rows = []
for who, src in [('tapper', 'steel_1302_tapper.jpg'), ('foundry', 'mh2_0400_face_goggles.jpg'), ('profile', 'mh4_0530_profile.jpg')]:
    plate = rd(os.path.join(VID, 'web', 'assets', 'roto', who + '_plate.jpg'))
    rgba = cv2.imread(os.path.join(VID, 'web', 'assets', 'roto', who + '.png'), cv2.IMREAD_UNCHANGED); a = rgba[..., 3:] / 255.
    mat = (rgba[..., :3] * a + np.array([30, 30, 200]) * (1 - a)).astype(np.uint8)
    ims = [lab(fit(plate, 480), f'{who}: film crop (source)'), lab(fit(mat, 480), 'matte over red')]
    for m in ('sil', 'engrave', 'print'):
        im = rd(os.path.join(C, f'fig_{m}_{who}.jpg')); ims += [lab(fit(im, 480), f'{m} (full, shown 480)'), lab(fit(im, 240), '270 px')]
    rows.append(row(ims))
save('sheet_2-4_workers.jpg', col(rows))
g = [[fit(rd(os.path.join(C, f'fig_{m}_{w}.jpg')), 480) for m in ('sil', 'engrave', 'print')] for w in ('tapper', 'foundry', 'profile')]
save('board_workers_270.jpg', col([row(r, gap=4) for r in g], gap=4))

# 5. a face at world scale
ims = [cell(rd(os.path.join(C, 'face_engrave_foundry_face.jpg')), 'face ENGRAVED in his own world (face ~540 px)'),
       cell(rd(os.path.join(C, 'face_print_foundry_face.jpg')), 'face PRINT'),
       lab(fit(rd(os.path.join(C, 'face_source_foundry_face.jpg')), 480), 'source: NFPF 09:01.5'),
       lab(fit(rd(os.path.join(VID, 'review', 'studio_human_c3', 'after', 'profile_raw.jpg')), 480), 'c3 profile_raw (CG, before)'),
       lab(fit(rd(os.path.join(B, 'crop_CW_farmer_face_1to1.jpg')), 480), 'CW v11 3.5 s farmer 1:1 (published)')]
save('sheet_5_face.jpg', col([row(ims[:2]), row(ims[2:])]))

# 6. the fist turntable (baked cards) beside the published GIANT fist
at = cv2.imread(os.path.join(VID, 'web', 'assets', 'sil', 'fist_cards.png'), cv2.IMREAD_UNCHANGED)
a = at[..., 3:] / 255.; cards = (at[..., :3] * a + np.array([207, 230, 239]) * (1 - a)).astype(np.uint8)
giant = rd(os.path.join(B, 'published', 'THE_GIANT_v1_27.0.jpg'))
c2 = os.path.join(VID, 'review', 'studio_art_c2', 'after', 'fist_turntable.jpg')
rows = [lab(fit(cards, 640), 'baked turntable: 8 angles x [silhouette, lit], hero.fistBridgman + forearm(1.4), ROTFRONT (measureArm: interior 91, no flags)'),
        row([lab(fit(rd(os.path.join(C, 'fist_disc_a0.jpg')), 480), 'bridgman fist vs the disc (a0)'), lab(fit(rd(os.path.join(C, 'fist_disc_a7.jpg')), 480), 'a7, his head in the disc'),
             lab(fit(giant, 480), 'GIANT v1 27.0 (published bar)'), lab(fit(rd(os.path.join(C, 'fist_lit_a1.jpg')), 480), 'lit a1'),
             lab(fit(rd(os.path.join(C, 'fist_lit_close_a1.jpg')), 480), 'close a1: thumb over the index'), lab(fit(rd(os.path.join(C, 'fist_lit_default_a0.jpg')), 480), 'OLD hero.fist() (default)')])]
rows.append(row([lab(fit(rd(os.path.join(C, 'fist_disc_a0.jpg')), 240), '270 new'), lab(fit(giant, 240), '270 GIANT')] + ([lab(fit(rd(c2), 240), 'ART c2 SDF fist')] if os.path.exists(c2) else [])))
save('sheet_6_fist.jpg', col(rows))

# 7. the driver's hands
ims = [cell(rd(os.path.join(C, 'driver_print_hit.jpg')), 'driver ON the hit (OTF 22.94, legend lands)'),
       lab(fit(rd(os.path.join(C, 'driver_print_before_hit.jpg')), 480), '22.60 hands closing, sweep coming'),
       lab(fit(rd(os.path.join(C, 'driver_print_after_hit.jpg')), 480), '23.10 settle'),
       lab(fit(rd(os.path.join(B, 'ref', 'mh4_0917_wheel_hands.jpg')), 360), 'source grip: Master Hands IV 09:17'),
       lab(fit(rd(os.path.join(B, 'published', 'OWN_THE_FUTURE_v7_21.3.jpg')), 480), 'OTF v7 21.3 (published claws)'),
       lab(fit(rd(os.path.join(VID, 'review', 'studio_human_c3', 'after', 'driver_raw.jpg')), 480), 'c3 driver_raw')]
save('sheet_7_driver.jpg', col([row(ims[:3]), row(ims[3:])]))
