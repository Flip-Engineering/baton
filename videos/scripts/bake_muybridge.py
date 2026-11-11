#!/usr/bin/env python3
"""Rotoscope Muybridge's gallop (public domain) into vector horse silhouettes for scenes/horde_riders.js.

    python3 videos/scripts/bake_muybridge.py      # -> videos/web/assets/muybridge/gallop.json (+ gallop_check.png)

Per frame of the 15-frame race-horse sequence: threshold the dark horse off the pale ground, take the jockey off
(everything above the horse's back line between croup and withers), fill the white breeches that crossed the flank,
upsample 4x with a smooth threshold, keep the horse's connected body, and trace the outline (OpenCV contours, lightly
simplified). Tracking per frame, in the traced space (1200 x 800, y down): the saddle point, croup and withers,
body pitch, the ground line, hoof contacts, the head (for the bit and reins), and the jockey's measured head offset
from the saddle (the real rider bob, which drives the cut-out rider's torso).
"""
import json, os
import numpy as np
import cv2
from PIL import Image, ImageSequence

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'sources', 'muybridge', 'Muybridge_race_horse_animated.gif')
OUT = os.path.join(HERE, '..', 'web', 'assets', 'muybridge')
UP = 4

def top_of(mask, x, y0=0, y1=None):
    col = mask[y0:y1, x]; ys = np.nonzero(col)[0]
    return (ys[0] + y0) if len(ys) else None

def main():
    os.makedirs(OUT, exist_ok=True)
    frames = [np.array(f.convert('L'), dtype=np.float32) for f in ImageSequence.Iterator(Image.open(SRC))]
    out, checks = [], []
    for k, g in enumerate(frames):
        h, w = g.shape
        gb = cv2.GaussianBlur(g, (0, 0), 0.8)
        ground = h - 14                                    # the track line sits ~14 px above the frame bottom
        dark = (gb < 105).astype(np.uint8)
        dark[ground + 2:, :] = 0
        dark[:, :6] = 0; dark[:, w - 6:] = 0
        # the jockey: the topmost dark run in the middle band is his helmet
        band = dark[:, int(w * 0.35):int(w * 0.72)]
        ys, xs = np.nonzero(band[: int(h * 0.45)])
        i = np.argmin(ys); hx = xs[i] + int(w * 0.35); hy = ys[i]
        # back line: horse top at the croup (behind the jockey) and the withers (in front)
        xc, xw = hx - 48, hx + 22
        yc = top_of(dark, xc, int(h * 0.25)); yw = top_of(dark, xw, int(h * 0.25))
        back = lambda x: yc + (yw - yc) * (x - xc) / (xw - xc)
        x0, x1 = hx - 42, hx + 20
        m = dark.copy()
        for x in range(x0, x1 + 1):
            b = int(round(back(x)))
            m[:max(0, b - 1), x] = 0                        # jockey off
            m[b: b + 34, x] |= (gb[b: b + 34, x] > 105).astype(np.uint8)   # breeches that crossed the flank -> horse
        # keep the largest component (the horse), fill small holes
        n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
        big = 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])
        m = (lab == big).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        # 4x smooth upsample: blur the binary mask and threshold at 0.5 (sub-pixel edges from the grey mask)
        soft = cv2.resize(cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.9), (w * UP, h * UP), interpolation=cv2.INTER_CUBIC)
        M = (soft > 0.42).astype(np.uint8)
        cs, hier = cv2.findContours(M, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        for c, hh in zip(cs, hier[0]):                       # coat highlights read as holes: fill all but the leg gaps
            if hh[3] >= 0 and cv2.contourArea(c) < 2500: cv2.drawContours(M, [c], -1, 1, -1)
        cs, _ = cv2.findContours(M, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        polys = [cv2.approxPolyDP(c, 1.2, True)[:, 0, :].tolist() for c in cs if cv2.contourArea(c) > 60]
        # tracking (4x space)
        sx = hx - 14; sy = back(sx)
        pitch = float(np.degrees(np.arctan2(yw - yc, xw - xc)))
        feet = []
        for x in range(w):
            col = np.nonzero(m[:, x])[0]
            if len(col) and col[-1] >= ground - 20: feet.append((x, int(col[-1])))
        contacts = []
        for x, y in feet:
            if y >= ground - 9 and (not contacts or x - contacts[-1][0] > 6): contacts.append((x, y))
        head_x = max(x for x in range(w) if m[:, x].any()); head_col = np.nonzero(m[:, head_x - 3])[0]
        rec = {'saddle': [sx * UP, sy * UP], 'croup': [xc * UP, yc * UP], 'withers': [xw * UP, yw * UP], 'pitch': pitch,
               'ground': ground * UP, 'contacts': [[x * UP, y * UP] for x, y in contacts], 'nose': [head_x * UP, float(head_col.mean()) * UP if len(head_col) else 0],
               'jockeyHead': [(hx - sx) * UP, (hy - sy) * UP], 'polys': polys}
        out.append(rec)
        vis = cv2.cvtColor((g).astype(np.uint8), cv2.COLOR_GRAY2BGR); vis = cv2.resize(vis, (w * UP, h * UP))
        sil = np.zeros_like(vis); cv2.drawContours(sil, [np.array(p, np.int32) for p in polys], -1, (40, 40, 200), -1)
        vis = cv2.addWeighted(vis, 0.45, sil, 0.9, 0)
        cv2.circle(vis, (int(sx * UP), int(sy * UP)), 8, (0, 255, 0), -1)
        for c in contacts: cv2.circle(vis, (c[0] * UP, c[1] * UP), 6, (255, 0, 0), -1)
        checks.append(cv2.resize(vis, (w * 2, h * 2)))
    conv = lambda o: o.item() if hasattr(o, 'item') else o
    json.dump({'size': [300 * UP, 200 * UP], 'fps_note': '15 frames = one full stride; ~0.45 s at a race gallop', 'frames': out,
               'source': 'Muybridge, race horse at a gallop (Animal Locomotion, 1887), PD; Commons animation by Waugsberg'},
              open(os.path.join(OUT, 'gallop.json'), 'w'), default=conv)
    # the photographs themselves (4x, 5 x 3 sheet at half size = 600 x 400 per frame): the horse's own modelling for
    # the lit and print passes (drawHorsePhoto clips it to the traced outline)
    up = [cv2.resize(f.astype(np.uint8), (1200, 800), interpolation=cv2.INTER_CUBIC) for f in frames]
    sheet = np.vstack([np.hstack(up[i:i + 5]) for i in range(0, 15, 5)])
    cv2.imwrite(os.path.join(OUT, 'gallop_photo.jpg'), cv2.resize(sheet, (sheet.shape[1] // 2, sheet.shape[0] // 2), interpolation=cv2.INTER_AREA), [cv2.IMWRITE_JPEG_QUALITY, 86])
    rows = [np.hstack(checks[i:i + 5]) for i in range(0, 15, 5)]
    cv2.imwrite(os.path.join(OUT, '..', '..', '..', 'review', 'studio_human_c1', 'after', 'ref_muybridge_trace.jpg'), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print('gallop: 15 frames, polys', sum(len(r['polys']) for r in out), 'pts', sum(len(p) for r in out for p in r['polys']))

if __name__ == '__main__':
    main()
