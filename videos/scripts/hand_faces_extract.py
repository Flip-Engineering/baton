#!/usr/bin/env python3
"""MODELING c2: many distinct faces from the public-domain Master Hands (Chevrolet, Flint 1936) film, for the MELTDOWN hand build.
YuNet detector (cached model), 2 fps sampling over all four parts; keep confident, sharp, large-enough faces; drop near-duplicates
(same person in neighbouring frames) by crop similarity; write square-ish crops + index.json (source, time, box, score).
usage: hand_faces_extract.py [max]
Curated by eye after the run: hf_011 (a dark blob) and hf_019 (a pressure gauge) were dropped from index.json (the files stay; index.json is the list)."""
import cv2, numpy as np, json, os, sys
SRC = '/home/user/acp-agitprop/videos/sources/footage'; OUT = '/home/user/acp-agitprop/videos/web/assets/hand_faces'
det = cv2.FaceDetectorYN.create('/root/.cache/acp_models/archive/yunet.onnx', '', (640, 480), 0.7, 0.3, 500)
kept = []; thumbs = []; idx = []
for part in ['MasterHa1936.mp4', 'MasterHa1936_2.mp4', 'MasterHa1936_3.mp4', 'MasterHa1936_4.mp4']:
    cap = cv2.VideoCapture(os.path.join(SRC, part)); fps = cap.get(cv2.CAP_PROP_FPS) or 30; n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); step = int(fps / 2)
    last_t = -99
    for f in range(0, n, step):
        if f / fps - last_t < 3.0: continue        # one scene moment at a time (3 s): the same worker in neighbouring seconds is one face, not eight
        cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read()
        if not ok: break
        h, w = im.shape[:2]; det.setInputSize((w, h)); _, fs = det.detect(im)
        if fs is None: continue
        for r in fs:
            x, y, bw, bh = r[:4]; sc = float(r[-1])
            if bw < 34 or bh < 40 or sc < 0.8: continue
            cx, cy = x + bw / 2, y + bh / 2; s = max(bw, bh) * 1.7
            x0, y0 = int(max(0, cx - s / 2)), int(max(0, cy - s * .55)); x1, y1 = int(min(w, cx + s / 2)), int(min(h, cy + s * .45 + s * .1))
            c = im[y0:y1, x0:x1]
            if c.shape[0] < 50 or c.shape[1] < 40: continue
            g = cv2.cvtColor(c, cv2.COLOR_BGR2GRAY)
            if cv2.Laplacian(g, cv2.CV_64F).var() < 18: continue
            t = cv2.resize(g, (24, 30)).astype(np.float32); t = (t - t.mean()) / (t.std() + 1e-3)
            if any(float((t * u).mean()) > 0.62 for u in thumbs): continue        # the same face again
            last_t = f / fps; thumbs.append(t); name = f"hf_{len(idx):03d}.jpg"; cv2.imwrite(os.path.join(OUT, name), c, [cv2.IMWRITE_JPEG_QUALITY, 92])
            idx.append(dict(file=name, src=part, t=round(f / fps, 2), box=[int(x), int(y), int(bw), int(bh)], score=round(sc, 2), w=c.shape[1], h=c.shape[0]))
    print(part, len(idx), flush=True)
json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1); print('faces', len(idx))
