#!/usr/bin/env python3
"""BODY7 instrument 2: OUR bodies through the same front-silhouette measurer as the photographs.

  python3 videos/scripts/body7/ours_profile7.py --bodies <dir> --tag <tag> [--names a,b,..] --out <json> [--sil <dir>]

<dir> holds <tag>_<name>.json / .bin written by videos/web/labs/refmeasure/body_export.mjs (node; the posed nude body + K3 underwear of a person, arms
hanging; <tag> e.g. v6). For each person m_body.measure_body(dir, '<tag>_<name>') rasterises the front silhouette at 1000 px per stature and runs
derive.measure() (the SAME function that measured the photographs), and photo_profile7.record_from_res() keeps the SAME keys as the photo table:
widths, thigh / knee / calf / ankle (mean of l_ and r_ clean reads), h_* heights, heads, the 51-row profile (full / trunk / trunk_clean).
Also, as a labelled SUPPLEMENT ('legs_alt'), the leg widths and crotch height with the midline moved into the crotch gap (see legs_alt()): the strict read never finds
the crotch on our asymmetric stances. Also saves one front silhouette PNG per person (OUR render, white on black, cropped) to --sil (default ~/.cache/acp_human/body7_scratch/sil/<tag>_<name>.png).
Re-executes itself under the MediaPipe venv (cv2) like refmeasure.py. Numbers and our own renders only; no photograph is read.
"""
import argparse, glob, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'refmeasure'))
try:
    import cv2, mediapipe  # noqa
except ImportError:
    py = os.path.expanduser('~/.cache/acp_human/figvenv/bin/python')
    if os.path.exists(py) and os.path.abspath(sys.executable) != os.path.abspath(py): os.execv(py, [py] + sys.argv)
    raise
import numpy as np
import rm_common as C
import m_body as MB
import derive
import photo_profile7 as PP


def person_meta(name):
    try: i = C.person_info(name); return dict(sex=i['sex'], age=i['age'], group=i['group'], bg=i['bg'], age_band=C.age_band(i['age']))
    except Exception: return dict(sex=None, age=None, group=None, bg=None, age_band=None)


def legs_alt(dirpath, name):
    """SUPPLEMENT (not the brief's strict read): the legs and the crotch height with the midline landmark moved into the crotch gap.
    derive.measure() finds the crotch only where NO run of the silhouette contains mid_x (mean x of the four shoulder / hip landmarks) and there are >= 2 runs; our
    bodies stand with an asymmetric stance (one leg angled out), so mid_x falls inside a leg and the crotch (hence thigh / knee / calf / ankle, h_crotch) is never
    found. Pass B: find the first row below the hip line where the left and right hip-knee-ankle lines lie in different runs, take the centre of that gap as the
    midline, move the two SHOULDER landmarks' x so that mid_x lands there (shoulders only move the upper-arm capsule, which no thigh row touches; hips, knees
    and ankles stay), and run the SAME derive.measure() again. Only the leg widths and the crotch height are taken from pass B."""
    meta, P, T = MB.load_body(dirpath, name)
    img, fr = MB.silhouette(P, T); L = MB.landmarks(meta, fr); I = derive.I
    mk = derive.clean_mask(img.astype(np.float32), L)        # the mask derive.measure() itself works on (it fills 1-px cracks between the legs)
    g = lambda n: L[I[n], :2]
    hip_y, knee_y = (g('l_hip')[1] + g('r_hip')[1]) / 2, (g('l_knee')[1] + g('r_knee')[1]) / 2
    def kx(side, yy): return float(np.interp(yy, [g(f'{side}_hip')[1], g(f'{side}_knee')[1], g(f'{side}_ankle')[1]], [g(f'{side}_hip')[0], g(f'{side}_knee')[0], g(f'{side}_ankle')[0]]))
    gap = None
    for yy in range(int(hip_y), int(knee_y)):
        rr = [r for r in derive.runs(mk[yy]) if r[1] - r[0] > 2]
        a = [r for r in rr if r[0] <= kx('l', yy) < r[1]]; b = [r for r in rr if r[0] <= kx('r', yy) < r[1]]
        if a and b and a[0] != b[0]:
            lo, hi = sorted((a[0], b[0])); gap = ((lo[1] + hi[0]) / 2.0, yy); break
    if gap is None: return dict(vals={}, note='no row below the hip line where the two leg lines lie in different runs')
    mid0 = (g('l_hip')[0] + g('r_hip')[0] + g('l_shoulder')[0] + g('r_shoulder')[0]) / 4; d = gap[0] - mid0
    L[I['l_shoulder'], 0] += 2 * d; L[I['r_shoulder'], 0] += 2 * d
    det = dict(L=L, W=np.zeros((33, 3)), M=img.astype(np.float32), n=1)
    res, _ = derive.measure(dict(id=name, view='front', pose='standing', crop='full'), np.zeros(img.shape + (3,), np.uint8), det)
    rec = PP.record_from_res(res)
    keep = PP.LEG_KEYS + ['h_crotch']
    return dict(vals={k: rec['vals'][k] for k in keep}, how={k: rec['how'].get(k) for k in PP.LEG_KEYS}, mid_shift_px=round(float(d), 1), gap_x_px=round(float(gap[0]), 1),
                crotch_row_first_split=int(gap[1]), note='pass B: midline moved into the crotch gap (shoulder landmarks shifted); derive.measure() otherwise unchanged')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bodies', required=True); ap.add_argument('--tag', required=True); ap.add_argument('--names', default=None)
    ap.add_argument('--out', required=True); ap.add_argument('--sil', default=os.path.expanduser('~/.cache/acp_human/body7_scratch/sil'))
    a = ap.parse_args()
    if a.names: names = a.names.split(',')
    else:
        have = sorted(os.path.basename(p)[len(a.tag) + 1:-5] for p in glob.glob(os.path.join(a.bodies, a.tag + '_*.json')))
        names = [n for n in C.TWELVE if n in have] + [n for n in have if n not in C.TWELVE]
    os.makedirs(a.sil, exist_ok=True); people = {}
    for n in names:
        o, img, res = MB.measure_body(a.bodies, f'{a.tag}_{n}')
        rec = PP.record_from_res(res)
        rec.update(person_meta(n), height_m=o['height_m'], unit=res['unit'], stature_px=res['stature_px'], head_px=res['head_px'], heads_note=res['heads_note'],
                   arms_down=o['arms_down'], measure_at={k: v['at'] for k, v in res['measures'].items() if v.get('at') is not None})
        rec['legs_alt'] = legs_alt(a.bodies, f'{a.tag}_{n}')
        people[n] = rec
        ys, xs = np.where(img > 0); m = 6
        crop = (img[max(ys.min() - m, 0):ys.max() + m + 1, max(xs.min() - m, 0):xs.max() + m + 1] * 255).astype(np.uint8)
        cv2.imwrite(os.path.join(a.sil, f'{a.tag}_{n}.png'), crop)
        v = rec['vals']
        print(f"{n:20s} shoulder {v['shoulder']} waist {v['waist']} hip {v['hip']} thigh {v['thigh']} knee {v['knee']} calf {v['calf']} ankle {v['ankle']} heads {v['heads']} | legs_alt {rec['legs_alt']['vals']}", flush=True)
    obj = dict(about='BODY7 ours profile: the posed nude body (+ K3 underwear) of each person, arms hanging, front silhouette at 1000 px per stature, measured by derive.measure() '
                     '(m_body.measure_body); same keys as photo_profile7.json. Numbers only.', tag=a.tag, keys=PP.KEYS, levels=PP.LEVELS, people=people)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    json.dump(obj, open(a.out, 'w'), separators=(',', ':'))
    print('wrote', a.out, len(people), 'people; silhouettes in', a.sil)


if __name__ == '__main__':
    main()
