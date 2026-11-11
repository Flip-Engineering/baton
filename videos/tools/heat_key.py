#!/usr/bin/env python3
"""HEAT KEY: film -> "what is hot" (not "what is bright"), for the thermal look (PRODUCTIVE FORCES c12; usable by any piece).

A naive LUT over archive film makes skies and windows the hottest thing and faces go dark. A thermal camera sees people,
hands, molten metal, lit furnaces and running machines as warm, and skies, glass and paper as cold. This builds that field:

  person   YOLOS-tiny (ONNX, Xenova/yolos-tiny, ~10 MB, MIT/Apache) boxes -> soft body ellipses, hottest at the head
  face     YuNet (~/.cache/acp_models/archive/yunet.onnx) -> a hot oval on the face
  molten   saturated orange/yellow bright pixels in colour film; compact near-white blobs in B&W (not skies)
  motion   Farneback flow magnitude (running machines, moving hands) as a smaller term
  cold     big bright low-texture regions (sky, windows, paper) pulled down; the rest is a dim luminance base

Output: grey atlas JPEG(s) of heat 0..1 (cells CWxCH, COLS across, 15 fps: thermal cameras are slow anyway) + a json entry.
Models are fetched once into ~/.cache/acp_heat (YOLOS from huggingface.co); delete that folder when done (10 MB).

  python3 heat_key.py bake NAME SRC.mp4 T0 DUR [--fps 15] [--out DIR] [--people 1] [--molten 1] [--motion 0.25] [--sky 1]
  python3 heat_key.py sheet NAME [--out DIR]       # contact sheet of the baked atlas through ironbow (for the eye)
"""
import argparse, json, math, os, subprocess, sys, urllib.request
import numpy as np, cv2
os.environ.setdefault('OPENCV_LOG_LEVEL', 'ERROR'); cv2.setNumThreads(1)

FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__)); VID = os.path.dirname(HERE)
OUT = os.path.join(VID, 'web', 'assets', 'productive')
CACHE = os.path.expanduser('~/.cache/acp_heat')
YOLOS = os.path.join(CACHE, 'yolos_tiny_q.onnx')
YUNET = os.path.expanduser('~/.cache/acp_models/archive/yunet.onnx')
CW, CH, COLS = 480, 360, 8

_sess = None
def yolos():
    global _sess
    if _sess is None:
        import onnxruntime as ort
        if not os.path.exists(YOLOS):
            os.makedirs(CACHE, exist_ok=True)
            urllib.request.urlretrieve('https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model_quantized.onnx', YOLOS)
        so = ort.SessionOptions(); so.intra_op_num_threads = 1
        _sess = ort.InferenceSession(YOLOS, so, providers=['CPUExecutionProvider'])
    return _sess

def persons(rgb, thr=0.4):
    """boxes (x0,y0,x1,y1,score) in px of rgb (HxWx3 uint8)"""
    h, w = rgb.shape[:2]
    im = cv2.resize(rgb, (512, 384)).astype(np.float32) / 255
    im = (im - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
    x = im.transpose(2, 0, 1)[None].astype(np.float32)
    s = yolos(); lg, bx = s.run(None, {s.get_inputs()[0].name: x})
    lg = lg[0]; bx = bx[0]
    e = np.exp(lg - lg.max(1, keepdims=True)); p = e / e.sum(1, keepdims=True)
    out = []
    for i in range(len(p)):
        sc = p[i, 1]                                  # COCO id 1 = person
        if sc > thr and p[i].argmax() == 1:
            cx, cy, bw, bh = bx[i]
            out.append(((cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h, float(sc)))
    return out

_fd = None
def faces(rgb):
    global _fd
    if not os.path.exists(YUNET): return []
    h, w = rgb.shape[:2]
    if _fd is None: _fd = cv2.FaceDetectorYN.create(YUNET, '', (w, h), 0.6, 0.3, 50)
    d = _fd; d.setInputSize((w, h))
    _, f = d.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    return [] if f is None else [tuple(r[:4]) + (float(r[-1]),) for r in f]

def blob(shape, x0, y0, x1, y1, power=2.6, top=0.0):
    """soft superellipse inside a box, optionally weighted hotter toward the top (the head)"""
    h, w = shape; yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2; rx, ry = max((x1 - x0) / 2, 1), max((y1 - y0) / 2, 1)
    d = (np.abs((xx - cx) / rx) ** power + np.abs((yy - cy) / ry) ** power)
    m = np.clip(1.25 - d, 0, 1) ** 0.8
    if top: m = m * (1 + top * np.clip(1 - (yy - y0) / ry / 1.2, 0, 1))
    return m

def body_mask(f, x0, y0, x1, y1):
    """the person inside a detector box: GrabCut seeded by the box and an ellipse prior (a soft egg alone reads as a glowing blob)"""
    h, w = f.shape[:2]; k = 2; sm = cv2.resize(f, (w // k, h // k)); sh, sw = sm.shape[:2]
    x0, y0, x1, y1 = [int(round(v / k)) for v in (max(x0, 0), max(y0, 0), min(x1, w), min(y1, h))]
    if x1 - x0 < 8 or y1 - y0 < 8: return None
    pad = 6; X0, Y0, X1, Y1 = max(x0 - pad, 0), max(y0 - pad, 0), min(x1 + pad, sw), min(y1 + pad, sh)
    crop = cv2.cvtColor(sm[Y0:Y1, X0:X1], cv2.COLOR_RGB2BGR)
    m = np.full(crop.shape[:2], cv2.GC_BGD, np.uint8)
    inner = blob(crop.shape[:2], x0 - X0, y0 - Y0, x1 - X0, y1 - Y0, 2.4)
    m[inner > 0.02] = cv2.GC_PR_BGD; m[inner > 0.35] = cv2.GC_PR_FGD; m[inner > 0.8] = cv2.GC_FGD
    try:
        bg = np.zeros((1, 65)); fg = np.zeros((1, 65)); cv2.grabCut(crop, m, None, bg, fg, 3, cv2.GC_INIT_WITH_MASK)
    except cv2.error: return None
    fgm = ((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)).astype(np.float32)
    fgm = cv2.morphologyEx(fgm, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)); fgm = cv2.morphologyEx(fgm, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    if fgm.sum() < 0.18 * inner.sum() or fgm.sum() > 1.4 * inner.sum(): return None
    full = np.zeros((sh, sw), np.float32); full[Y0:Y1, X0:X1] = fgm
    return cv2.resize(full, (w, h))

def heat_frames(frames, o):
    n = len(frames); out = []; prevg = None; pm = None; motmax = 1e-3
    mots = []
    # motion first (needs a per-clip normaliser)
    gs = [cv2.resize(cv2.cvtColor(f, cv2.COLOR_RGB2GRAY), (240, 180)) for f in frames]
    for i in range(n):
        if i == 0: mots.append(np.zeros((180, 240), np.float32)); continue
        fl = cv2.calcOpticalFlowFarneback(gs[i - 1], gs[i], None, 0.5, 2, 15, 2, 5, 1.1, 0)
        m = np.linalg.norm(fl, axis=2); m = cv2.GaussianBlur(m, (0, 0), 3); mots.append(m)
    mn = np.percentile(np.stack(mots), 97) + 1e-3
    for i, f in enumerate(frames):
        h, w = f.shape[:2]; ff = f.astype(np.float32) / 255
        L = ff.mean(2); hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV).astype(np.float32); S = hsv[..., 1] / 255; Hh = hsv[..., 0] * 2
        base = 0.08 + o['bgain'] * np.clip(L, 0, 1) ** 1.4 + o['bdetail'] * np.clip(0.5 + (L - cv2.GaussianBlur(L, (0, 0), 12)) * 3, 0, 1)
        # cold: large bright flat regions (sky, windows, paper)
        if o['sky']:
            ls = cv2.GaussianBlur(L, (0, 0), 9); sd = np.sqrt(np.maximum(cv2.GaussianBlur(L * L, (0, 0), 9) - ls * ls, 0))
            bright = (ls > 0.62) & (sd < 0.07) & (S < 0.35)
            bright = cv2.morphologyEx(bright.astype(np.uint8), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
            nlab, lab, st, _ = cv2.connectedComponentsWithStats(bright)
            cold = np.zeros_like(L)
            for k in range(1, nlab):
                if st[k, cv2.CC_STAT_AREA] > 0.012 * h * w: cold[lab == k] = 1
            cold = cv2.GaussianBlur(cold, (0, 0), 6)
            base = base * (1 - 0.8 * cold)
        else: cold = np.zeros_like(L)
        T = base.copy()
        if o['molten']:
            col = np.clip((S - 0.40) / 0.3, 0, 1) * ((Hh > 8) & (Hh < 62)) * np.clip((L - 0.35) / 0.3, 0, 1)
            bw_ = np.clip((L - 0.9) / 0.08, 0, 1) * (1 - cold) * (1 - np.clip(S * 3, 0, 1))
            blobm = (bw_ > 0.5).astype(np.uint8); nlab, lab, st, _ = cv2.connectedComponentsWithStats(blobm)
            keep = np.zeros_like(L)
            for k in range(1, nlab):
                if st[k, cv2.CC_STAT_AREA] < 0.02 * h * w: keep[lab == k] = 1
            M = np.maximum(col, bw_ * keep * 0.8)
            T = T + 0.62 * cv2.GaussianBlur(M.astype(np.float32), (0, 0), 1.2)
        if o.get('whitehot'):                              # c18: a blown-out flame core (near white, not saturated) is the hottest thing, not a cold hole: PRODUCTIVE FORCES ladle
            T = np.maximum(T, o['whitehot'] * np.clip((cv2.GaussianBlur(L, (0, 0), 2.0) - 0.62) / 0.3, 0, 1) ** 1.2)
        if o['motion']:
            mo = cv2.resize(np.clip(mots[i] / mn, 0, 1), (w, h)); T = T + o['motion'] * mo * (1 - cold)
        # people and faces
        P = np.zeros_like(L); Fm = np.zeros_like(L)
        if o['people']:
            for (x0, y0, x1, y1, sc) in persons(f, o['pthr']):
                if (x1 - x0) * (y1 - y0) > 0.85 * h * w: continue
                bm = body_mask(f, x0, y0, x1, y1)
                if bm is None: bm = blob(L.shape, x0, y0, x1, y1, 3.2, 0.5) * 0.9
                else: bm = cv2.GaussianBlur(bm, (0, 0), 1.3) * (1 + 0.35 * np.clip(1 - (np.mgrid[0:h, 0:w][0] - y0) / max((y1 - y0) * 0.5, 1), 0, 1))
                P = np.maximum(P, np.clip(bm, 0, 1) * min(1, 0.7 + sc * 0.4))
            for (x, y, bw, bh, sc) in faces(f):
                fm = blob(L.shape, x - bw * .02, y - bh * .06, x + bw * 1.02, y + bh * 1.1, 3.0)
                reg = L[int(max(y, 0)):int(y + bh), int(max(x, 0)):int(x + bw)]
                if reg.size > 16:
                    a_, b_ = np.percentile(reg, [8, 92]); Ln = np.clip((L - a_) / max(b_ - a_, 0.05), 0, 1)       # eyes, mouth and shadow stay darker
                    Fm = np.maximum(Fm, fm * (0.45 + 0.55 * Ln))
        if o['pforce'] is not None:                      # hand-placed person boxes for shots the detector can't read (close-ups): normalised
            for (x0, y0, x1, y1) in o['pforce']:
                P = np.maximum(P, blob(L.shape, x0 * w, y0 * h, x1 * w, y1 * h, 2.2, 0.3))
        pm = P if pm is None else np.maximum(P, pm * 0.3)   # a little temporal memory: detections flicker
        Pm = cv2.GaussianBlur(pm, (0, 0), 2.5)
        tex = np.clip(0.55 + 0.9 * (L - cv2.GaussianBlur(L, (0, 0), 14)), 0.2, 1.0)    # keeps folds, faces, hands inside the body
        Ls = np.clip(0.5 + (cv2.GaussianBlur(L, (0, 0), 1.0) - cv2.GaussianBlur(L, (0, 0), 16)) * 2.4, 0, 1)   # folds, limbs and edges keep their own tones inside the body
        Lb = np.clip((cv2.GaussianBlur(L, (0, 0), 1.2) - 0.05) / 0.65, 0, 1)
        T = np.maximum(T, Pm * (0.34 + 0.34 * Ls + 0.26 * Lb))
        T = np.maximum(T, cv2.GaussianBlur(Fm, (0, 0), 1.2) * 0.98)
        if o['topcut']:                                    # a band of windows / skylights along the top of a hall shot reads hot by luminance: cold by physics
            yy = np.arange(h, dtype=np.float32)[:, None] / h
            T = T * (0.12 + 0.88 * np.clip((yy - o['topcut']) / 0.06, 0, 1))
        out.append(np.clip(T, 0, 1))
    return out

def read_frames(src, t0, dur, fps, cw=CW, ch=CH, cx=None):
    vf = f'fps={fps},scale={cw}:{ch}'
    if cx is not None: vf = f'fps={fps},crop=ih*9/16:ih:(iw-ih*9/16)*{cx}:0,scale={cw}:{ch}'      # a portrait window (hero shots), cx 0..1 across the frame
    cmd = [FF, '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', src, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    n = len(raw) // (cw * ch * 3)
    return list(np.frombuffer(raw, np.uint8)[:n * cw * ch * 3].reshape(n, ch, cw, 3))

def bake(name, src, t0, dur, fps=15, out=OUT, cx=None, **kw):
    o = dict(people=1, molten=1, motion=0.25, sky=1, pthr=0.55, pforce=None, bgain=0.28, bdetail=0.0, topcut=0.0, whitehot=0.0); o.update(kw)
    cw, ch, cols = (CW, CH, COLS) if cx is None else (405, 720, 9)
    fr = read_frames(src, t0, dur, fps, cw, ch, cx); hs = heat_frames(fr, o)
    n = len(hs); rows = math.ceil(n / cols)
    at = np.zeros((rows * ch, cols * cw), np.uint8)
    for i, h in enumerate(hs): at[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw] = (h * 255).astype(np.uint8)
    os.makedirs(out, exist_ok=True)
    cv2.imwrite(os.path.join(out, name + '.jpg'), at, [cv2.IMWRITE_JPEG_QUALITY, 88])
    mp = os.path.join(out, 'clips.json'); meta = json.load(open(mp)) if os.path.exists(mp) else {}
    meta[name] = dict(n=n, cols=cols, cw=cw, ch=ch, fps=fps, src=os.path.basename(src), t0=t0, portrait=cx is not None)
    json.dump(meta, open(mp, 'w'), indent=1)
    return n

IRON = [(0, '07001a'), (.12, '1c0350'), (.28, '5a078c'), (.42, 'a01582'), (.56, 'dc3c3a'), (.7, 'f4780e'), (.83, 'fdbd1c'), (.93, 'fff07a'), (1, 'fffff4')]
def ironbow(g):
    xs = [a for a, _ in IRON]; cs = np.array([[int(c[i:i + 2], 16) for i in (0, 2, 4)] for _, c in IRON], np.float32)
    return np.stack([np.interp(g, xs, cs[:, k]) for k in range(3)], -1).astype(np.uint8)

def sheet(name, out=OUT, step=None, ncols=8, nmax=24):  # portrait clips draw narrower tiles
    meta = json.load(open(os.path.join(out, 'clips.json')))[name]; at = cv2.imread(os.path.join(out, name + '.jpg'), 0) / 255.
    n = meta['n']; step = step or max(1, n // nmax); tiles = []; cw, ch, cols = meta['cw'], meta['ch'], meta['cols']
    for i in range(0, n, step):
        c = at[(i // cols) * ch:(i // cols + 1) * ch, (i % cols) * cw:(i % cols + 1) * cw]
        tiles.append(cv2.resize(ironbow(c), (240, 180) if cw > ch else (101, 180)))
    while len(tiles) % ncols: tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[r:r + ncols]) for r in range(0, len(tiles), ncols)]
    p = os.path.join(out, 'sheet_' + name + '.jpg'); cv2.imwrite(p, cv2.cvtColor(np.vstack(rows), cv2.COLOR_RGB2BGR)); return p

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('cmd'); ap.add_argument('name'); ap.add_argument('src', nargs='?'); ap.add_argument('t0', nargs='?', type=float); ap.add_argument('dur', nargs='?', type=float)
    ap.add_argument('--fps', type=int, default=15); ap.add_argument('--out', default=OUT); ap.add_argument('--people', type=int, default=1); ap.add_argument('--molten', type=int, default=1)
    ap.add_argument('--motion', type=float, default=0.25); ap.add_argument('--sky', type=int, default=1); ap.add_argument('--cx', type=float, default=None); ap.add_argument('--bgain', type=float, default=0.28); ap.add_argument('--bdetail', type=float, default=0.0)
    a = ap.parse_args()
    if a.cmd == 'sheet': print(sheet(a.name, a.out))
    if a.cmd == 'bake': print(a.name, bake(a.name, a.src, a.t0, a.dur, a.fps, a.out, people=a.people, molten=a.molten, motion=a.motion, sky=a.sky, cx=a.cx, bgain=a.bgain, bdetail=a.bdetail))
