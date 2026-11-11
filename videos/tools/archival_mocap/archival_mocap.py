#!/usr/bin/env python3
"""MOTION c1: archival motion capture, the CPU first step (and the shot manifest for the GPU run).

Film -> shots -> people (a detector and a tracker, so one man stays one man) -> a pose per person per frame (2D whole body
with feet) -> a contact sheet for a PERSON to pick the track -> a compact track file + a manifest line for the GPU run.

    python3 archival_mocap.py run --film <mp4> --ss 431 --t 8 --fps 15 --name mh4_fender --out <dir>
    python3 archival_mocap.py pick --out <dir> --name mh4_fender --track 3     (after looking at <name>_tracks.jpg)

Outputs in --out: <name>_tracks.jpg (the picker sheet: every track's id on sampled frames), <name>_tracks.json (all tracks:
boxes and 26 keypoints per frame), and after `pick`: <name>.track.json (the chosen person: keypoints, scores, contacts,
shot bounds, source, licence) + a line appended to gpu_manifest.jsonl (for SAM 3D Body + MHR when the homelab connects).
Frames are decoded to memory, never written; nothing large is left on disk.

Models (CPU, ONNX Runtime; ~/.cache/acp_motion, re-fetch with `fetch`): YOLOX-tiny trained on Human-Art (people in film,
paintings and drawings; Apache-2.0, OpenMMLab RTMPose/rtmlib release) and RTMPose-m Halpe-26 (body, feet with heels and toes;
Apache-2.0). 20 MB + 56 MB.
"""
import argparse, json, os, sys, subprocess, math
import numpy as np
sys.path.insert(0, os.path.expanduser('~/.cache/acp_roto/py'))
import onnxruntime as ort, cv2

CACHE = os.path.expanduser(os.environ.get('ACP_MOTION_CACHE', '~/.cache/acp_motion'))
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
URLS = {'det_end2end.onnx': 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_tiny_8xb8-300e_humanart-6f3252f9.zip',
        'pose_end2end.onnx': 'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmpose-m_simcc-body7_pt-body7-halpe26_700e-256x192-4d3e73dd_20230605.zip'}
HALPE = ['nose', 'eyeL', 'eyeR', 'earL', 'earR', 'shL', 'shR', 'elL', 'elR', 'wrL', 'wrR', 'hipL', 'hipR', 'knL', 'knR', 'anL', 'anR', 'head', 'neck', 'hip',
         'toL', 'toR', 'toL2', 'toR2', 'heL', 'heR']
SKEL = [(5, 7), (7, 9), (6, 8), (8, 10), (5, 6), (11, 12), (5, 11), (6, 12), (11, 13), (13, 15), (12, 14), (14, 16), (15, 24), (15, 20), (16, 25), (16, 21), (17, 18), (18, 19)]

def sess(name):
    p = os.path.join(CACHE, name)
    if not os.path.exists(p): sys.exit(f'missing {p}: run `archival_mocap.py fetch`')
    o = ort.SessionOptions(); o.intra_op_num_threads = 2; o.enable_cpu_mem_arena = False
    return ort.InferenceSession(p, o, providers=['CPUExecutionProvider'])

def frames(film, ss, t, fps, W=960):
    """decode a segment to memory (grey film -> 3 channels), scaled to width W"""
    cmd = [FF, '-loglevel', 'error', '-ss', str(ss), '-i', film, '-t', str(t), '-vf', f'fps={fps},scale={W}:-2', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    probe = subprocess.run([FF, '-loglevel', 'error', '-ss', str(ss), '-i', film, '-frames:v', '1', '-vf', f'scale={W}:-2', '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True).stdout
    h = cv2.imdecode(np.frombuffer(probe, np.uint8), 1).shape[0]
    n = len(raw) // (W * h * 3)
    return [np.frombuffer(raw, np.uint8, W * h * 3, i * W * h * 3).reshape(h, W, 3) for i in range(n)]

def shots(F, thr=0.55):
    """hard cuts: correlation of grey histograms between neighbouring frames"""
    cuts, prev = [0], None
    for i, f in enumerate(F):
        h = cv2.calcHist([cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)], [0], None, [64], [0, 256]); cv2.normalize(h, h)
        if prev is not None and cv2.compareHist(prev, h, cv2.HISTCMP_CORREL) < thr: cuts.append(i)
        prev = h
    return [(a, b) for a, b in zip(cuts, cuts[1:] + [len(F)])]

def detect(S, img, conf=0.35):
    H, W = img.shape[:2]; r = min(416 / H, 416 / W); im = cv2.resize(img, (int(W * r), int(H * r)))
    pad = np.full((416, 416, 3), 114, np.uint8); pad[:im.shape[0], :im.shape[1]] = im
    dets, labels = S.run(None, {'input': pad.transpose(2, 0, 1)[None].astype(np.float32)})
    d = dets[0]; keep = (d[:, 4] > conf) & (labels[0] == 0)
    out = d[keep].copy(); out[:, :4] /= r; return out

def iou(a, b):
    x1, y1, x2, y2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]); i = max(0, x2 - x1) * max(0, y2 - y1)
    return i / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i + 1e-9)

def track(D, shot_of, max_lost=4, thr=0.3):
    """greedy IoU association with a constant-velocity prediction; a new shot starts new tracks"""
    tracks, live, nid = {}, [], 0
    for i, dets in enumerate(D):
        if i > 0 and shot_of[i] != shot_of[i - 1]: live = []
        pred = []
        for t in live:
            b = np.array(tracks[t]['box'][-1][1]); v = (b - np.array(tracks[t]['box'][-2][1])) if len(tracks[t]['box']) > 1 else 0; pred.append(b + v)
        used, pairs = set(), sorted(((iou(pred[k], d), k, j) for k in range(len(live)) for j, d in enumerate(dets)), reverse=True)
        got = set()
        for s, k, j in pairs:
            if s < thr or k in got or j in used: continue
            got.add(k); used.add(j); tracks[live[k]]['box'].append((i, dets[j][:5].tolist())); tracks[live[k]]['lost'] = 0
        for k, t in enumerate(live):
            if k not in got: tracks[t]['lost'] += 1
        live = [t for t in live if tracks[t]['lost'] <= max_lost]
        for j, d in enumerate(dets):
            if j not in used: tracks[nid] = {'id': nid, 'shot': int(shot_of[i]), 'box': [(i, d[:5].tolist())], 'lost': 0}; live.append(nid); nid += 1
    return {k: v for k, v in tracks.items() if len(v['box']) >= 6}

MEAN, STD = np.array([123.675, 116.28, 103.53]), np.array([58.395, 57.12, 57.375])
def pose(S, img, box):
    x1, y1, x2, y2 = box[:4]; cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, (x2 - x1) * 1.25, (y2 - y1) * 1.25
    if w / h > 192 / 256: h = w * 256 / 192
    else: w = h * 192 / 256
    src = np.float32([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx - w / 2, cy + h / 2]]); dst = np.float32([[0, 0], [192, 0], [0, 256]])
    M = cv2.getAffineTransform(src, dst); crop = cv2.warpAffine(img, M, (192, 256), flags=cv2.INTER_LINEAR)
    x = ((cv2.cvtColor(crop, cv2.COLOR_BGR2RGB) - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    sx, sy = S.run(None, {'input': x}); px, py = sx[0].argmax(-1) / 2.0, sy[0].argmax(-1) / 2.0
    sc = np.minimum(sx[0].max(-1), sy[0].max(-1))
    Mi = cv2.invertAffineTransform(M); pts = np.stack([px, py, np.ones_like(px)], 1) @ Mi.T
    return np.concatenate([pts, sc[:, None]], 1)

def smooth(K, minc=0.3):
    """per joint: gap-fill low-confidence frames by interpolation, then a centred 5-tap Savitzky-Golay-like smoothing"""
    K = K.copy(); n = len(K)
    for j in range(K.shape[1]):
        good = K[:, j, 2] >= minc
        if good.sum() >= 2:
            idx = np.arange(n)
            for c in (0, 1): K[~good, j, c] = np.interp(idx[~good], idx[good], K[good, j, c])
    w = np.array([-3, 12, 17, 12, -3]) / 35.0; P = np.pad(K[:, :, :2], ((2, 2), (0, 0), (0, 0)), mode='edge')
    K[:, :, :2] = sum(w[k] * P[k:k + n] for k in range(5)); return K

def contacts(K, fps, hpx):
    """a foot is down when its lowest point (heel or toe) is near the track's floor line and nearly still"""
    out = np.zeros((len(K), 2), np.uint8)
    for s, (an, he, to) in enumerate([(15, 24, 20), (16, 25, 21)]):
        y = np.maximum(K[:, he, 1], K[:, to, 1]); floor = np.percentile(y, 92)
        v = np.r_[0, np.hypot(np.diff(K[:, he, 0]), np.diff(K[:, he, 1]))] * fps / hpx
        out[:, s] = (y > floor - 0.03 * hpx) & (v < 0.6)
    return out

def sheet(F, T, path, every=6):
    idx = list(range(0, len(F), every))[:12]; tiles = []
    for i in idx:
        im = F[i].copy()
        for t in T.values():
            for (fi, b) in t['box']:
                if fi == i:
                    x1, y1, x2, y2 = map(int, b[:4]); col = tuple(int(c) for c in np.random.default_rng(t['id']).integers(80, 255, 3))
                    cv2.rectangle(im, (x1, y1), (x2, y2), col, 2); cv2.putText(im, str(t['id']), (x1 + 4, y1 + 26), cv2.FONT_HERSHEY_SIMPLEX, 0.9, col, 2)
                    if 'kp' in t:
                        k = dict(t['kp'])[fi]
                        for a, c in SKEL: cv2.line(im, (int(k[a][0]), int(k[a][1])), (int(k[c][0]), int(k[c][1])), col, 2)
        cv2.putText(im, f'f{i}', (8, im.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2); tiles.append(cv2.resize(im, (480, int(480 * im.shape[0] / im.shape[1]))))
    while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[k:k + 4]) for k in range(0, len(tiles), 4)]; cv2.imwrite(path, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])

def run(a):
    F = frames(a.film, a.ss, a.t, a.fps); print(len(F), 'frames', F[0].shape)
    sh = shots(F); shot_of = np.zeros(len(F), int)
    for k, (s0, s1) in enumerate(sh): shot_of[s0:s1] = k
    print('shots', sh)
    Sd, Sp = sess('det_end2end.onnx'), sess('pose_end2end.onnx')
    D = [detect(Sd, f) for f in F]; T = track(D, shot_of)
    for t in T.values(): t['kp'] = [(fi, pose(Sp, F[fi], b).tolist()) for fi, b in t['box']]
    print('tracks', {k: len(v['box']) for k, v in T.items()})
    os.makedirs(a.out, exist_ok=True)
    sheet(F, T, os.path.join(a.out, f'{a.name}_tracks.jpg'))
    meta = {'film': os.path.basename(a.film), 'ss': a.ss, 't': a.t, 'fps': a.fps, 'size': list(F[0].shape[:2]), 'shots': sh, 'licence': a.licence, 'source': a.source}
    json.dump({'meta': meta, 'tracks': {k: {kk: vv for kk, vv in v.items() if kk != 'lost'} for k, v in T.items()}}, open(os.path.join(a.out, f'{a.name}_tracks.json'), 'w'))
    print('pick a track on', os.path.join(a.out, f'{a.name}_tracks.jpg'))

def pick(a):
    J = json.load(open(os.path.join(a.out, f'{a.name}_tracks.json'))); m = J['meta']; t = J['tracks'][str(a.track)]
    fi = [f for f, _ in t['kp']]; K = smooth(np.array([k for _, k in t['kp']], np.float32))
    hpx = float(np.median([b[3] - b[1] for _, b in t['box']]))
    C = contacts(K, m['fps'], hpx)
    q = lambda x: [round(float(v), 1) for v in x]
    out = {'name': a.name, 'meta': m, 'track': a.track, 'frames': fi, 'joints': HALPE, 'heightPx': round(hpx, 1),
           'kp': [[q(p) for p in k] for k in K.tolist()], 'contacts': C.tolist(), 'boxes': [q(b) for _, b in t['box']],
           'note': '2D image coordinates (x right, y down, px at the decoded width) + confidence; smoothed and gap-filled. Depth is NOT recovered on the CPU step.'}
    p = os.path.join(a.out, f'{a.name}.track.json'); json.dump(out, open(p, 'w'), separators=(',', ':')); print(p, os.path.getsize(p) // 1024, 'KB')
    man = {'name': a.name, 'film': m['film'], 'source': m.get('source'), 'licence': m.get('licence'), 'in': m['ss'] + fi[0] / m['fps'], 'out': m['ss'] + fi[-1] / m['fps'],
           'fps': m['fps'], 'size': m['size'], 'boxes': out['boxes'], 'frames': fi, 'model': 'sam-3d-body + MHR (Apache-2.0 body model)', 'status': 'queued'}
    with open(os.path.join(a.out, 'gpu_manifest.jsonl'), 'a') as f: f.write(json.dumps(man) + '\n')
    print('manifest line appended')

def crops(a):
    """the picked track's frames cropped round the person (a fixed square per shot, so the camera does not seem to move), for a
    3D pose model on the CPU (MediaPipe Pose in VIDEO-like order: web/labs/human5/pose_bake.mjs) and for the side-by-side"""
    T = json.load(open(os.path.join(a.out, f'{a.name}.track.json'))); m = T['meta']
    F = frames(os.path.join(a.film_dir, m['film']) if a.film_dir else a.film, m['ss'], m['t'], m['fps'])
    B = np.array(T['boxes'])[:, :4]; x1, y1 = B[:, 0].min(), B[:, 1].min(); x2, y2 = B[:, 2].max(), B[:, 3].max()
    cx, cy, s = (x1 + x2) / 2, (y1 + y2) / 2, max(x2 - x1, y2 - y1) * 1.15; H, W = F[0].shape[:2]
    x0, y0 = int(max(0, min(W - s, cx - s / 2))), int(max(0, min(H - s, cy - s / 2))); s = int(min(s, W, H))
    d = os.path.join(a.out, f'{a.name}_crops'); os.makedirs(d, exist_ok=True)
    for k, fi in enumerate(T['frames']): cv2.imwrite(os.path.join(d, f'f{k + 1:03d}.jpg'), cv2.resize(F[fi][y0:y0 + s, x0:x0 + s], (512, 512)), [cv2.IMWRITE_JPEG_QUALITY, 88])
    T['crop'] = [x0, y0, s, 512]; json.dump(T, open(os.path.join(a.out, f'{a.name}.track.json'), 'w'), separators=(',', ':'))
    print(d, len(T['frames']), 'crops; crop box', T['crop'])

def fetch(a):
    import urllib.request, zipfile, io
    os.makedirs(CACHE, exist_ok=True)
    for name, url in URLS.items():
        p = os.path.join(CACHE, name)
        if os.path.exists(p): continue
        z = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(url).read()))
        for i in z.infolist():
            if i.filename.endswith('.onnx'): open(p, 'wb').write(z.read(i))
        print(name, os.path.getsize(p))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); sp = ap.add_subparsers(dest='cmd', required=True)
    r = sp.add_parser('run'); r.add_argument('--film', required=True); r.add_argument('--ss', type=float, default=0); r.add_argument('--t', type=float, default=6); r.add_argument('--fps', type=float, default=15)
    r.add_argument('--name', required=True); r.add_argument('--out', required=True); r.add_argument('--licence', default=''); r.add_argument('--source', default='')
    p = sp.add_parser('pick'); p.add_argument('--out', required=True); p.add_argument('--name', required=True); p.add_argument('--track', type=int, required=True)
    c = sp.add_parser('crops'); c.add_argument('--out', required=True); c.add_argument('--name', required=True); c.add_argument('--film', default=''); c.add_argument('--film_dir', default='')
    sp.add_parser('fetch')
    a = ap.parse_args(); {'run': run, 'pick': pick, 'crops': crops, 'fetch': fetch}[a.cmd](a)
