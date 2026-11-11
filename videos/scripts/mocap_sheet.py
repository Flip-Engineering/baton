#!/usr/bin/env python3
"""Contact sheet of a BVH take as stick figures (side view), to choose frames and to overlay the source skeleton.

    python3 videos/scripts/mocap_sheet.py 62_07 [--from 0 --to 10 --step 0.5 --out file.jpg]
"""
import sys, os, argparse
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
MOC = os.path.join(HERE, '..', 'sources', 'mocap', 'cmu')

def parse(path):
    tok = open(path).read().split(); i = 0; joints = []; nch = 0
    def rd(name, parent):
        nonlocal i, nch
        j = {'name': name, 'parent': parent, 'off': np.zeros(3), 'ch': [], 'c0': nch}; joints.append(j); me = len(joints) - 1
        assert tok[i] == '{'; i += 1
        while tok[i] != '}':
            t = tok[i]; i += 1
            if t == 'OFFSET': j['off'] = np.array([float(tok[i]), float(tok[i + 1]), float(tok[i + 2])]); i += 3
            elif t == 'CHANNELS': n = int(tok[i]); i += 1; j['ch'] = tok[i:i + n]; i += n; nch += n
            elif t == 'JOINT': nm = tok[i]; i += 1; rd(nm, me)
            elif t == 'End': i += 1; rd(name + '_end', me)
        i += 1
    assert tok[i] == 'HIERARCHY'; i += 2; nm = tok[i]; i += 1; rd(nm, -1)
    assert tok[i] == 'MOTION'; nf = int(tok[i + 2]); dt = float(tok[i + 5]); i += 6
    fr = np.array(tok[i:i + nf * nch], dtype=float).reshape(nf, nch)
    return joints, fr, dt

def rot(axis, deg):
    a = np.radians(deg); c, s = np.cos(a), np.sin(a)
    if axis == 'X': return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    if axis == 'Y': return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def fk(joints, row):
    P = []; Rw = []
    for j in joints:
        R = np.eye(3); off = j['off'].copy()
        for k, c in enumerate(j['ch']):
            v = row[j['c0'] + k]
            if c.endswith('position'): off['XYZ'.index(c[0])] += v
            else: R = R @ rot(c[0], v)
        if j['parent'] < 0: Rw.append(R); P.append(off)
        else: Rw.append(Rw[j['parent']] @ R); P.append(Rw[j['parent']] @ off + P[j['parent']])
    return np.array(P)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('take'); ap.add_argument('--from', dest='t0', type=float, default=0); ap.add_argument('--to', type=float, default=None)
    ap.add_argument('--step', type=float, default=0.5); ap.add_argument('--out', default=None); ap.add_argument('--view', default='side')
    a = ap.parse_args()
    joints, fr, dt = parse(os.path.join(MOC, a.take + '.bvh'))
    t1 = a.to if a.to is not None else (len(fr) - 2) * dt
    ts = np.arange(a.t0, t1 + 1e-6, a.step)
    cells = []
    allp = np.array([fk(joints, fr[min(len(fr) - 1, 1 + int(round(t / dt)))]) for t in ts])
    # face the take along +Z (hips at frame 1), so 'side' is a true side view (x = forward)
    nm = [j['name'] for j in joints]; P1 = fk(joints, fr[1]); side = P1[nm.index('LeftUpLeg')] - P1[nm.index('RightUpLeg')]
    fwd = np.array([-side[2], 0, side[0]]); yaw = np.arctan2(fwd[0], fwd[2]); c, s_ = np.cos(-yaw), np.sin(-yaw)
    Ry = np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]]); allp = allp @ Ry.T
    ax = (2, 1) if a.view == 'side' else (0, 1)          # side: forward (+z) to the right
    lo = allp[:, :, list(ax)].min(axis=(0, 1)); hi = allp[:, :, list(ax)].max(axis=(0, 1))
    S = 360 / max(hi - lo) * 0.9
    for t, P in zip(ts, allp):
        img = np.full((400, 400, 3), 245, np.uint8)
        q = lambda p: (int(20 + (p[ax[0]] - lo[0]) * S), int(380 - (p[ax[1]] - lo[1]) * S))
        for k, j in enumerate(joints):
            if j['parent'] >= 0:
                col = (40, 40, 200) if 'Right' in j['name'] or j['name'].startswith('R') else (40, 40, 40)
                cv2.line(img, q(P[j['parent']]), q(P[k]), col, 3)
        cv2.putText(img, f'{t:.2f}s', (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
        cells.append(img)
    while len(cells) % 6: cells.append(np.full((400, 400, 3), 255, np.uint8))
    sheet = np.vstack([np.hstack(cells[i:i + 6]) for i in range(0, len(cells), 6)])
    out = a.out or os.path.join(HERE, '..', 'review', 'studio_human_c1', 'after', f'ref_mocap_{a.take}.jpg')
    cv2.imwrite(out, sheet, [cv2.IMWRITE_JPEG_QUALITY, 85]); print(out, sheet.shape)

if __name__ == '__main__':
    main()
