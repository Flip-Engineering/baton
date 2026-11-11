#!/usr/bin/env python3
"""BODY7: our posed nude body through the SAME derive.measure the photographs go through, once with the arms in (the instrument, REFMEASURE's gate 6)
and once with the arms taken OUT of the silhouette (trunk and legs only), so an arm hanging against the trunk cannot bias the trunk widths.

REFMEASURE's gate 6 rasterises our body and runs derive.measure on it. With our arms hanging against the trunk its 'mirrored' / 'arm_subtracted' reads
double an asymmetric half or subtract a forearm's width (L08's waist reads 0.142 'mirrored', the trunk's own width at that level is 0.153). Here the
trunk and legs are measured on a second silhouette made from the triangles that touch no arm or hand vertex, with the arm landmarks moved out of the
frame so derive's contact rules never fire: every width is then its 'clean' read. The shoulder (a full-silhouette measure: deltoids and arms hanging)
comes from the arms-in silhouette. The photos' own reads keep derive's contact handling (they cannot be cleaned): that bias stays on the photo side.

  sil7.py --bodies <dir> --tag <tag> [--names a,b] --out <json>      (bodies from labs/human8/body7_export.mjs: '<tag>_<name>.json/.bin')
Run under the MediaPipe venv python (cv2): ~/.cache/acp_human/figvenv/bin/python.
Frame of the exporter: x lateral, y depth, z up (metres); joints in three's frame (x lateral, y up, z forward). Regions (hero.js): 0 head 1 neck
2 torso 3 upper arm 4 forearm 5 hand 6 finger 7 pelvis 8 thigh 9 shin 10 foot 11 jaw."""
import json, os, sys, argparse
import numpy as np
import cv2
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'refmeasure'))
import rm_common as C   # noqa: puts refs/tools on sys.path
import derive
import m_body as MB

ARMS = (3, 4, 5, 6)
KEYS = ['shoulder', 'shoulder_joints', 'chest', 'waist', 'hip']


def load(d, name):
    meta = json.load(open(os.path.join(d, name + '.json'))); b = open(os.path.join(d, name + '.bin'), 'rb').read()
    nv, nt = meta['verts'], meta['tris']
    P = np.frombuffer(b, np.float32, nv * 3, 0).reshape(-1, 3); T = np.frombuffer(b, np.uint32, nt * 3, nv * 12).reshape(-1, 3).astype(int)
    R = np.frombuffer(b, np.uint8, nv, nv * 12 + nt * 12) if len(b) >= nv * 13 + nt * 12 else np.zeros(nv, np.uint8)
    return meta, P, T, R


def landmarks_far(meta, fr):
    """MB.landmarks with the arm points (elbows, wrists, hand points) moved far out of the frame: no derive arm-contact rule can fire"""
    L = MB.landmarks(meta, fr)
    for n in ('elbow', 'wrist', 'pinky', 'index', 'thumb'):
        for s in 'lr': L[derive.I[f'{s}_{n}']][0] += 1.0e5
    return L


def run(meta, img, L):
    det = dict(L=L, W=np.zeros((33, 3)), M=img.astype(np.float32), n=1)
    res, m = derive.measure(dict(id=meta['spec'], view='front', pose='standing', crop='full'), np.zeros(img.shape + (3,), np.uint8), det)
    return res


def measure(d, name):
    meta, P, T, R = load(d, name)
    img_full, fr = MB.silhouette(P, T)
    keep = ~np.isin(R[T], ARMS).any(axis=1)
    img_noarm, _ = MB.silhouette(P, T[keep])
    A = run(meta, img_full, MB.landmarks(meta, fr))      # the instrument as REFMEASURE runs it
    B = run(meta, img_noarm, landmarks_far(meta, fr))    # arms out
    g = lambda res, k: (res['measures'].get(k) or {}).get('value')
    gh = lambda res, k: (res['measures'].get(k) or {}).get('how')
    out = dict(name=name, height=float(P[:, 2].max() - P[:, 2].min()))
    out['shoulder'] = g(A, 'shoulder'); out['shoulder_joints'] = g(A, 'shoulder_joints')
    for k in ('chest', 'waist', 'hip'):
        out[k] = g(B, k); out[k + '_instr'] = g(A, k); out[k + '_how'] = gh(B, k); out[k + '_instr_how'] = gh(A, k)
    out['waist_hip'] = (out['waist'] / out['hip']) if out['waist'] and out['hip'] else None
    out['waist_hip_instr'] = (out['waist_instr'] / out['hip_instr']) if out['waist_instr'] and out['hip_instr'] else None
    for k in ('thigh', 'knee', 'calf', 'ankle'):
        v = [g(B, f'{s}_{k}') for s in 'lr']; v = [x for x in v if x]
        out[k] = float(np.mean(v)) if v else None
        v = [g(A, f'{s}_{k}') for s in 'lr']; v = [x for x in v if x]
        out[k + '_instr'] = float(np.mean(v)) if v else None
    out['at'] = {k: (B['measures'].get(k) or {}).get('at') for k in ('chest', 'waist', 'hip')}
    for k, v in B['heights'].items(): out['h_' + k] = v
    out['h_crotch'] = B['heights'].get('crotch'); out['heads'] = B['heads']
    out['profile_trunk'] = [(e or {}).get('trunk') for e in B['profile']]
    out['profile_full'] = [(e or {}).get('full') for e in A['profile']]
    return out, img_full, img_noarm


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--bodies', required=True); ap.add_argument('--tag', required=True); ap.add_argument('--names', default=None)
    ap.add_argument('--out', default=None); ap.add_argument('--png', default=None, help='folder for the two silhouettes (OUR renders)')
    a = ap.parse_args()
    names = a.names.split(',') if a.names else sorted(f[len(a.tag) + 1:-5] for f in os.listdir(a.bodies) if f.startswith(a.tag + '_') and f.endswith('.json'))
    res = {}
    for n in names:
        r, imf, ima = measure(a.bodies, a.tag + '_' + n); res[n] = r
        f = lambda v: '  -  ' if v is None else f'{v:.3f}'
        print(f"{n:20s} sh {f(r['shoulder'])} chest {f(r['chest'])} waist {f(r['waist'])} (instr {f(r['waist_instr'])}) hip {f(r['hip'])} (instr {f(r['hip_instr'])}) w/h {f(r['waist_hip'])}"
              f" | thigh {f(r['thigh'])} knee {f(r['knee'])} calf {f(r['calf'])} ankle {f(r['ankle'])} crotch {f(r.get('h_crotch'))}")
        if a.png:
            os.makedirs(a.png, exist_ok=True); cv2.imwrite(os.path.join(a.png, f'{a.tag}_{n}_full.png'), imf * 255); cv2.imwrite(os.path.join(a.png, f'{a.tag}_{n}_noarm.png'), ima * 255)
    if a.out: json.dump(res, open(a.out, 'w'), indent=1)
