"""(Since 8 Oct the measures it yields no longer judge the people: the landmarks serve the side-by-side boards. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread.)
REFMEASURE pose pass: refs/tools/derive.py's MediaPipe Pose Landmarker (heavy) + person mask + derive.measure(), on a photograph or on one of our
plates (a crop with ONE figure in it), plus what derive.measure() cannot do for clothed legs and for the arms:

  leg_widths(): the silhouette width of each leg at chosen heights (clothed legs touch: derive.measure() finds the crotch by a gap between the
                legs and returns no leg widths for trousers hanging together; here, when the two legs share one run of the mask the inner edge is
                the midpoint between the two leg axes (from the hip-knee-ankle landmarks), so a leg's width is its outer edge to that midpoint)
  arms_hang():  both arms hanging (shoulder elevation under 25 degrees in the image plane) for a standing front view
"""
import os, sys
import numpy as np
import cv2
import rm_common as C
import derive

_LMK = None


def landmarker():
    global _LMK
    if _LMK is None: _LMK = derive.load_landmarker()
    return _LMK


def run(rgb, rec):
    """-> (res, mask, det) from derive.measure on one figure; None when no pose or no mask. rec: dict(id, view, pose, crop)"""
    det = derive.detect(landmarker(), rgb)
    if det is None: return None
    r = derive.measure(rec, rgb, det)
    if r is None: return None
    res, m = r
    return res, m, det


def _runs(row):
    return [(a, b) for a, b in derive.runs(row) if b - a > 2]


def leg_widths(m, L, floor, unit, heights):
    """widths (fractions of the stature unit) of the left and right leg (the subject's, l_ and r_ landmarks) at each height (fraction of the unit
    above the floor). Returns {h: (wl, wr)}, None where the figure's run cannot be read."""
    g = lambda n: L[derive.I[n], :2]
    H, W = m.shape
    out = {}
    for hh in heights:
        y = int(round(floor - hh * unit))
        if not (0 <= y < H): out[hh] = (None, None); continue
        axes = {}
        for s in 'lr':
            hip, kn, an = g(f'{s}_hip'), g(f'{s}_knee'), g(f'{s}_ankle')
            ys = [hip[1], kn[1], an[1]]; xs = [hip[0], kn[0], an[0]]
            # axis x at height y: interpolate along hip-knee-ankle, extend below the ankle with the shin's direction
            if y >= an[1]:
                d = (an - kn); t = (y - an[1]) / max(1e-6, d[1]); axes[s] = an[0] + d[0] * t if d[1] > 1 else an[0]
            else: axes[s] = float(np.interp(y, ys, xs))
        rr = _runs(m[y]); res = []
        for s in 'lr':
            o = 'r' if s == 'l' else 'l'; ax, ox = axes[s], axes[o]
            on = [r for r in rr if r[0] <= ax < r[1]]
            if not on: res.append(None); continue
            a, b = on[0]
            if a <= ox < b:                                   # the legs share one run: the inner edge is the midpoint between the axes
                mid = (ax + ox) / 2
                a2, b2 = (a, mid) if ax < ox else (mid, b)
                res.append((b2 - a2) / unit)
            else: res.append((b - a) / unit)
        out[hh] = tuple(res)
    return out


def arms_hang_from(a):
    """both arms hanging: shoulder elevation under 25 degrees (the upper arm along the trunk) and the elbow under 45 degrees of flexion (the forearm
    carried on down, not folded across or raised), image plane"""
    return bool(a['l_shoulder_elev'] < 25 and a['r_shoulder_elev'] < 25 and a['l_elbow_flex'] < 45 and a['r_elbow_flex'] < 45)


def arms_hang(res):
    return arms_hang_from(res['angles_2d'])


def crop_cell(rgb, k, n, pad=0.1, gap=0.75):
    """the window of the k-th of n people in a lab_person row plate (gap m apart in the world, the camera fitted to the row: half the row's width is
    (n - 1) / 2 gap + 0.6 m, so the pitch in pixels is gap * W / (2 half) and the row is centred); a neighbour's limb can intrude, the detector
    takes the larger figure of two"""
    W = rgb.shape[1]; half = (n - 1) / 2 * gap + 0.6; pitch = gap * W / (2 * half); xc = W / 2 + (k - (n - 1) / 2) * pitch
    x0 = max(0, int(round(xc - (0.5 + pad) * pitch))); x1 = min(W, int(round(xc + (0.5 + pad) * pitch)))
    return rgb[:, x0:x1], x0
