"""RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread. What remains here serves the boards (crops, annotations).

REFMEASURE measure 4 (MOTION): joint angles on the lift-and-carry frames of our clips (elbow flexion, hip flexion, trunk lean from vertical, MediaPipe
3-D world landmarks, the same angles() as derive.py) against the photographs' lifting and carrying rows; and the share of standing figures whose arms
hang (both shoulder elevations under 25 and both elbows under 45 degrees of flexion, image plane) against the clothed standing front photographs.

Photo side: derived_typical.json (numbers already committed). The library holds only 19 lifting / carrying rows (11 modern, all views), so the
reference is the pooled span (p5-p95) of those rows and says so; it is too few to judge a movement by.
Our side: lift6 (v6: review/.../integration6/clips/lift.mp4, a woman and a man, 960x540, 15 fps, the person ~270 px tall; v5: out/bench/human8_integ5d lift_*.png
atlases of MOTION c1's lift). Each frame is cut into one window per person (the woman by her blue scrubs, the man to her right), enlarged 2.5x, run through the
pose landmarker; a frame counts as loaded from the first time a wrist is within 0.3 stature of the box (found by its colour) until the person leaves the frame."""
import glob, json, os, sys
import numpy as np
import cv2
import rm_common as C
import posepass as PP
import derive

PHOTO_JSON = os.path.join(C.OUT, 'photo_motion.json')
STAND = ('standing', 'standing_attention', 'standing_relaxed', 'standing_contrapposto', 'contrapposto')


def mean_lr(a, k): return 0.5 * (a[f'l_{k}'] + a[f'r_{k}'])


def photo_records(force=False):
    if os.path.exists(PHOTO_JSON) and not force: return json.load(open(PHOTO_JSON))
    M = {r['id']: r for r in C.load_manifest()}
    d = json.load(open(os.path.join(C.REFS_DIR, 'derived_typical.json')))['images']
    lc, hang = [], []
    for i in d:
        r = M.get(i['id'])
        if 'error' in i or not r: continue
        a3, a2 = i['angles_3d'], i['angles_2d']
        if any(a in r['action'] for a in ('lifting', 'carrying')):
            lc.append(dict(id=i['id'], action=r['action'], view=i['view'], sex=r['sex'], modern=C.is_modern(r), elbow=round(mean_lr(a3, 'elbow_flex'), 1), hip=round(mean_lr(a3, 'hip_flex'), 1),
                           trunk=a3['trunk_from_vertical'], shoulder_elev=round(mean_lr(a3, 'shoulder_elev'), 1)))
        cl = (r['clothing'] or '').lower()
        if r['pose'] in STAND and i['view'] == 'front' and i['crop'] in ('full', 'cut', 'thigh_up') and not any(b in cl for b in ('nude', 'semi-nude', 'swim', 'leotard', 'underwear')):
            hang.append(dict(id=i['id'], sex=r['sex'], modern=C.is_modern(r), hang=PP.arms_hang_from(a2),
                             l_elev=a2['l_shoulder_elev'], r_elev=a2['r_shoulder_elev'], l_elbow=a2['l_elbow_flex'], r_elbow=a2['r_elbow_flex']))
    out = dict(about='REFMEASURE MOTION photo side: lifting/carrying rows (3-D angles, mean of the two sides) and clothed standing front rows (arms hanging) from derived_typical.json; numbers only, keyed by manifest id',
               lift_carry=lc, standing=hang)
    C.write_json(PHOTO_JSON, out)
    return out


# ---------------------------------------------------------------- our clips
def frames_v6(path=None):
    path = path or os.path.join(C.C8, 'after', 'integration6', 'clips', 'lift.mp4')
    cap = cv2.VideoCapture(path); out = []
    while True:
        ok, bgr = cap.read()
        if not ok: break
        out.append(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    return out, 15.0


def frames_v5(dirs):
    fs = []
    for d in dirs: fs += glob.glob(os.path.join(d, '**', 'lift_[0-9][0-9][0-9].png'), recursive=True)
    out = []
    for f in sorted(set(os.path.abspath(x) for x in fs)):
        im = cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGB); H, W = im.shape[:2]
        for r in range(H // 540):
            for c in range(W // 960): out.append(im[r * 540:(r + 1) * 540, c * 960:(c + 1) * 960])
    return out, 15.0


def frames_for(tag, dirs, explicit=True):
    """the lift frames of a run. v6: the delivered lift6 clip; v5: the integ5d atlases (plus any under dirs). ANY OTHER TAG (v7 ...): only what is found under the --ours
    folders the caller named (lift.mp4 first, else lift_NNN.png atlases), never the v5 or v6 clips (8 Oct: v7 runs used to have the v5 atlases appended to their series)."""
    if tag == 'v6': return frames_v6()
    if tag == 'v5': return frames_v5(list(dirs) + [os.path.join(C.VIDEOS, 'out', 'bench', 'human8_integ5d')])
    if not explicit: raise SystemExit(f'motion --tag {tag}: name the folder with the new clip or atlases: --ours <dir> (lift.mp4 or lift_NNN.png); the defaults are the v5 / v6 clips')
    clips = sorted(set(os.path.abspath(f) for d in dirs for f in glob.glob(os.path.join(d, '**', 'lift.mp4'), recursive=True)))
    if clips:
        print('motion: clip', clips[0], '(first of %d found)' % len(clips) if len(clips) > 1 else '')
        return frames_v6(clips[0])
    fr = frames_v5(dirs)
    if not fr[0]: raise SystemExit(f'motion --tag {tag}: no lift.mp4 or lift_NNN.png under {list(dirs)}')
    return fr


def hsv(rgb): return cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV_FULL).astype(float) / 255.0


def box_mask(rgb):
    h = hsv(rgb)
    return ((h[..., 0] > 0.07) & (h[..., 0] < 0.13) & (h[..., 1] > 0.38) & (h[..., 2] > 0.5)).astype(np.uint8)


def blue_x(rgb):
    h = hsv(rgb); m = (h[..., 0] > 0.55) & (h[..., 0] < 0.68) & (h[..., 1] > 0.35) & (h[..., 2] > 0.35)
    ys, xs = np.nonzero(m)
    return float(np.median(xs)) if len(xs) > 200 else None


def detect_window(rgb, x0, x1, scale=2.5):
    x0, x1 = int(max(0, x0)), int(min(rgb.shape[1], x1))
    if x1 - x0 < 60: return None
    crop = rgb[:, x0:x1]; big = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    det = derive.detect(PP.landmarker(), big)
    if det is None: return None
    L = det['L'].copy(); L[:, 0] = L[:, 0] / scale + x0; L[:, 1] = L[:, 1] / scale
    return dict(L=L, W=det['W'])


def frame_angles(rgb):
    """-> list of dicts for the woman and the man (None where not found): 3-D angles, wrist points, box centroid"""
    bx = blue_x(rgb)
    if bx is None: return None
    bm = box_mask(rgb)
    res, boxes = [], []
    for k, (x0, x1) in enumerate(((bx - 230, bx + 180), (bx + 180, rgb.shape[1]))):
        sub = bm[:, int(max(0, x0)):int(min(rgb.shape[1], x1))]; ys, xs = np.nonzero(sub)
        boxes.append(None if len(xs) < 60 else (float(np.median(xs)) + max(0, x0), float(np.median(ys)), float(np.max(ys))))
        d = detect_window(rgb, x0, x1)
        if d is None: res.append(None); continue
        L, Wd = d['L'], d['W']
        if np.any(L[derive.I['l_ankle'], 1] > rgb.shape[0] - 3) or np.any((L[:, 0] < 2) | (L[:, 0] > rgb.shape[1] - 3))[()] and False: res.append(None); continue
        a3 = derive.angles(Wd, 'profile', '3d'); a2 = derive.angles(L[:, :2], 'profile', '2d')
        wr = [L[derive.I['l_wrist'], :2], L[derive.I['r_wrist'], :2]]
        stat = float(np.linalg.norm(L[derive.I['nose'], :2] - (L[derive.I['l_ankle'], :2] + L[derive.I['r_ankle'], :2]) / 2)) * 1.12
        res.append(dict(elbow=mean_lr(a3, 'elbow_flex'), hip=mean_lr(a3, 'hip_flex'), trunk=a3['trunk_from_vertical'], shoulder_elev=mean_lr(a3, 'shoulder_elev'),
                        wrists=wr, stature_px=stat, x=float((L[derive.I['l_hip'], 0] + L[derive.I['r_hip'], 0]) / 2), cutoff=bool(L[:, 0].max() > rgb.shape[1] - 4)))
    return dict(boxes=boxes, people=res)


def overlay_frame(rgb):
    """the frame with each person's skeleton drawn and the three angles written beside them (for the committed board; our render only)"""
    im = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy(); bx = blue_x(rgb)
    if bx is None: return im
    pairs = [(11, 12), (11, 13), (13, 15), (12, 14), (14, 16), (11, 23), (12, 24), (23, 24), (23, 25), (25, 27), (24, 26), (26, 28)]
    for k, (x0, x1) in enumerate(((bx - 230, bx + 180), (bx + 180, rgb.shape[1]))):
        d = detect_window(rgb, x0, x1)
        if d is None: continue
        L = d['L']; a3 = derive.angles(d['W'], 'profile', '3d')
        for a, b in pairs: cv2.line(im, (int(L[a, 0]), int(L[a, 1])), (int(L[b, 0]), int(L[b, 1])), (0, 0, 255), 2)
        top = int(L[derive.I['nose'], 1]) - 12; x = int(L[23:25, 0].mean()) - 40
        cv2.putText(im, f"el {mean_lr(a3, 'elbow_flex'):.0f} hip {mean_lr(a3, 'hip_flex'):.0f} lean {a3['trunk_from_vertical']:.0f}", (max(2, x - 20), max(12, top)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 3)
        cv2.putText(im, f"el {mean_lr(a3, 'elbow_flex'):.0f} hip {mean_lr(a3, 'hip_flex'):.0f} lean {a3['trunk_from_vertical']:.0f}", (max(2, x - 20), max(12, top)), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1)
    return im


def lift_series(frames, fps, label, stride=1):
    """per person (0 woman, 1 man): the list of per-frame angle dicts with 'loaded' set"""
    per = [[], []]; started = [False, False]
    for n in range(0, len(frames), stride):
        fa = frame_angles(frames[n])
        for k in (0, 1):
            if fa is None or fa['people'][k] is None: continue
            p = fa['people'][k]; box = fa['boxes'][k]
            if not started[k] and box is not None:
                near = min(float(np.hypot(w[0] - box[0], w[1] - box[1])) for w in p['wrists'])
                if near < 0.3 * p['stature_px']: started[k] = True
            if p['cutoff']: continue
            per[k].append(dict(frame=n, t=round(n / fps, 2), loaded=started[k], **{kk: round(float(p[kk]), 1) for kk in ('elbow', 'hip', 'trunk', 'shoulder_elev')}))
    return per


def summarise_loaded(series):
    out = {}
    for key in ('elbow', 'hip', 'trunk', 'shoulder_elev'):
        v = [s[key] for s in series if s['loaded']]
        out[key] = C.quant(v, (5, 25, 50, 75, 95)) if v else dict(n=0)
    return out


def dressed_arms(rowplate_path, n=12):
    """arms hanging per person on a dressed row's front band (the plate's top 1000 px)"""
    from PIL import Image
    rgb = np.asarray(Image.open(rowplate_path).convert('RGB'))[:1000]
    res = []
    for k in range(n):
        crop, x0 = PP.crop_cell(rgb, k, n)
        o = PP.run(crop, dict(id=str(k), view='front', pose='standing', crop='full'))
        if o is None: res.append(None); continue
        r, m, det = o
        res.append(dict(hang=PP.arms_hang(r), l_elev=r['angles_2d']['l_shoulder_elev'], r_elev=r['angles_2d']['r_shoulder_elev'],
                        l_elbow=r['angles_2d']['l_elbow_flex'], r_elbow=r['angles_2d']['r_elbow_flex']))
    return res


if __name__ == '__main__':
    d = photo_records(force='--force' in sys.argv)
    print(len(d['lift_carry']), 'lift/carry rows;', len(d['standing']), 'standing rows')
