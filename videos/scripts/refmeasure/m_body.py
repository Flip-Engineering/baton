"""RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread. What remains here serves the boards (crops, annotations).

REFMEASURE measure 6 (BODY): widths over stature (shoulder, chest, waist, hip; shoulder joints RETIRED) of our cast against REFS figure studies.
Photo side: refs/tools/derive.py's numbers already committed in photo_derived/derived_typical.json (c2 and c4, modern, front, standing), no photo is
opened. Our side: the posed nude body of each person (labs/refmeasure/body_export.mjs, node: the body mesh and its joint centres, arms hanging)
rasterised to a front silhouette at 1000 px per stature and measured by the SAME derive.measure() (gen_silhouette.py method), so a width
means the same thing on both sides: the trunk width at the landmark-relative level, arm contact handled by derive's own rules.

8 Oct 2026 revision (CHECK.md H1, M6): the c4 silhouettes lack the feet, so their statures are extrapolated and every c4 width over stature is inflated; c4 rows with a guessed
floor are KNEE-NORMALISED (see KNEE_REF below) and the gate is c2 + knee-normalised c4 TOGETHER (SETS, compare_sets, decide). The raw c4 gate is kept as a set for the record.
"""
import json, os, sys, glob
import numpy as np
import cv2
import rm_common as C
import derive

PHOTO_JSON = os.path.join(C.OUT, 'photo_body.json')
KEYS = ['shoulder', 'shoulder_joints', 'chest', 'waist', 'hip']
GOOD = ('clean', 'mirrored', 'arm_subtracted', 'full', 'landmarks')
STAND = ('standing', 'contrapposto', 'standing_attention', 'standing_relaxed')
PX = 1000
# 8 Oct revision (CHECK.md H1, M6). The c4 figure studies are mostly CUT AT THE FEET: derive.measure() takes their floor from guessed foot landmarks (the silhouette ends a
# median 0.123 stature ABOVE the floor line for c4, 0.000 for c2; ankle / foot visibility 0.39 against 0.77), so the c4 STATURES are extrapolated and every width over
# stature is inflated (c4 knee height 0.241 stature against c2 0.302 and our skeleton's 0.286-0.296). We therefore KNEE-NORMALISE (not drop: only 2 of 24 c4 rows have
# feet): a row whose silhouette ends more than GAP_MAX stature above the floor has its stature re-derived from its knee landmark, assuming the head top is right and the
# floor is too high by e: knee_h / stature = KNEE_REF  =>  widths x (1 - KNEE_REF) / (1 - knee_h)  (widths are fractions of the stature: S_true = S_old + e). Rows with a
# measured floor (c2: 19 of 22) are left alone. Rows with a knee height outside KNEE_OK (a broken pose) are dropped from the normalised sets.
KNEE_REF = 0.295
GAP_MAX = 0.03
FOOT_VIS_MIN = 0.5
KNEE_OK = (0.18, 0.38)
RETIRED_KEYS = ('shoulder_joints',)     # our shoulder 'joint' is the skeleton's upperarm01 centre, the photographs' is MediaPipe's shoulder landmark: not the same point (CHECK.md M6)


def photo_records(force=False):
    if os.path.exists(PHOTO_JSON) and not force:
        its = json.load(open(PHOTO_JSON))['items']
        if its and 'kn_factor' in its[0]: return its
    M = {r['id']: r for r in C.load_manifest()}
    d = json.load(open(os.path.join(C.REFS_DIR, 'derived_typical.json')))['images']
    items = []
    for i in d:
        r = M.get(i['id'])
        if 'error' in i or not r or not C.is_modern(r): continue
        cl = (r['clothing'] or '').lower()
        if r['shard'] != 'c4:new' and not (cl.startswith(('nude', 'semi-nude')) and r['use'] == 'typical'): continue
        if i['view'] != 'front' or i['crop'] not in ('full',) or i['pose'] not in STAND: continue
        o = dict(id=i['id'], shard=r['shard'], sex=r['sex'], bg=r['background_group'], age_band=r['age_band'], build=r['build'], unit=i['unit'], clothing=r['clothing'], arms_down=None)
        for k in KEYS:
            v = i['measures'].get(k)
            o[k] = v['value'] if v and v['value'] and v['how'] in GOOD else None
        a = i['angles_2d']; o['arms_down'] = bool(a['l_shoulder_elev'] < 25 and a['r_shoulder_elev'] < 25)
        # the floor: how far the silhouette ends above it, and how well the feet were seen
        c = np.array(i['contour']); gap = float(c[:, 1].min()); lm = np.array(i['landmarks'])
        fv = float(np.mean([lm[derive.I[n]][2] for n in ('l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_foot', 'r_foot')]))
        h = i.get('heights', {}); kh = h.get('knee')
        usable = kh is not None and KNEE_OK[0] <= kh <= KNEE_OK[1]
        f_rule = (1 - KNEE_REF) / (1 - kh) if (usable and gap > GAP_MAX) else 1.0      # the revision's rule: only rows with a guessed floor
        f_all = (1 - KNEE_REF) / (1 - kh) if usable else 1.0                           # every row (the checker's variant; sensitivity only)
        o.update(stature_px=i['stature_px'], bottom_gap=round(gap, 3), foot_vis=round(fv, 2), feet_ok=bool(gap <= GAP_MAX and fv >= FOOT_VIS_MIN), knee_h=kh, hip_h=h.get('hip'), shoulder_h=h.get('shoulder'),
                 kn_usable=bool(usable), kn_factor=round(f_rule, 4), kn_factor_all=round(f_all, 4))
        for k in KEYS:
            o[k + '_kn'] = None if (o[k] is None or not usable) else round(o[k] * f_rule, 4)
            o[k + '_knall'] = None if (o[k] is None or not usable) else round(o[k] * f_all, 4)
        items.append(o)
    C.write_json(PHOTO_JSON, dict(about='REFMEASURE BODY: REFS c4 and c2 (modern, front, full, standing) widths over stature from derived_typical.json (unit says whether the stature was measured or nominal 7.5 heads for figures cut at the feet): numbers only, keyed by manifest id. '
                                        '8 Oct revision: bottom_gap = how far the silhouette ends above the floor line (stature), foot_vis = mean visibility of the ankle / heel / foot landmarks, feet_ok = gap <= 0.03 and vis >= 0.5, '
                                        'kn_factor = (1 - 0.295) / (1 - knee_h) for rows with gap > 0.03 (the floor is a guess: knee-normalised), <key>_kn = the knee-normalised width, <key>_knall = normalised on every row',
                                  n=len(items), items=items))
    return items


def with_ratio(r):
    """adds waist_hip (raw and knee-normalised: the ratio does not change, the stature cancels) to a photo record"""
    r = dict(r)
    r['waist_hip'] = (r['waist'] / r['hip']) if r.get('waist') and r.get('hip') else None
    r['waist_hip_kn'] = (r['waist_kn'] / r['hip_kn']) if r.get('waist_kn') and r.get('hip_kn') else None
    r['waist_hip_knall'] = (r['waist_knall'] / r['hip_knall']) if r.get('waist_knall') and r.get('hip_knall') else None
    return r


# the photo sets a body key is read against: (id, label, selector, which value)
SETS = [('pooled', 'c2 + knee-normalised c4 pooled (the distribution shown in results_table)', lambda r: r['kn_usable'], '_kn'),
        ('c2', 'c2 only (high-res, 22 studies; the floor is measured)', lambda r: r['shard'].startswith('c2') and r['kn_usable'], '_kn'),
        ('c4kn', 'c4 only, knee-normalised (24 studies, mostly low-res and cut at the feet)', lambda r: r['shard'] == 'c4:new' and r['kn_usable'], '_kn'),
        ('c4raw', 'c4 only, RAW stature (the v6 gate; statures extrapolated: kept for the record, NOT a gate)', lambda r: r['shard'] == 'c4:new', ''),
        ('feet', 'only rows whose feet are in the picture (bottom_gap <= 0.03 and foot visibility >= 0.5), raw', lambda r: r['feet_ok'], '')]


def set_items(ph, sid, key):
    """the photo records of one set with `key` set to the value that set reads (raw or knee-normalised); records without a value are left out"""
    sel, suffix = next((s[2], s[3]) for s in SETS if s[0] == sid)
    return [dict(r, **{key: r.get(key + suffix)}) for r in ph if sel(r) and r.get(key + suffix) is not None]


def resolve_stem(dirpath, name):
    """name = <tag>_<person>. body_export.mjs names its files after the spec it was given (v6_<person>), so a candidate tag (v7a) finds them under its version number, then v6, then v5"""
    import re
    if os.path.exists(os.path.join(dirpath, name + '.json')): return name
    m = re.search(r'(L\d\d_.*)$', name); tv = re.match(r'v(\d+)', name)
    if m:
        for pre in ([f'v{tv.group(1)}'] if tv else []) + ['v6', 'v5']:
            if os.path.exists(os.path.join(dirpath, f'{pre}_{m.group(1)}.json')): return f'{pre}_{m.group(1)}'
    return name


def load_body(dirpath, name):
    name = resolve_stem(dirpath, name)
    meta = json.load(open(os.path.join(dirpath, name + '.json'))); b = open(os.path.join(dirpath, name + '.bin'), 'rb').read()
    nv, nt = meta['verts'], meta['tris']
    P = np.frombuffer(b, np.float32, nv * 3, 0).reshape(-1, 3); T = np.frombuffer(b, np.uint32, nt * 3, nv * 12).reshape(-1, 3).astype(int)
    return meta, P, T


def silhouette(P, T):
    u = P[:, 0]; y = P[:, 2]                      # exporter frame: x lateral, z up
    H = y.max() - y.min(); s = PX / H; pad = 60
    X = (u - u.min()) * s + pad; Y = (y.max() - y) * s + pad
    w = int(X.max() + pad); h = int(Y.max() + pad)
    img = np.zeros((h, w), np.uint8)
    tri = np.stack([X[T], Y[T]], -1).round().astype(np.int32)
    for t in tri: cv2.fillConvexPoly(img, t, 1)
    return img, (u.min(), y.max(), y.min(), s, pad)


def landmarks(meta, fr):
    ux0, ytop, ybot, s, pad = fr
    J = {k: np.array(v) for k, v in meta['joints'].items() if v}
    def px(p3, dx=0.0, dy=0.0): return [(p3[0] + dx - ux0) * s + pad, (ytop - (p3[1] + dy)) * s + pad, 0.0, 1.0]
    L = np.zeros((33, 4)); I = derive.I
    eL, eR = J['eye.L'], J['eye.R']; em = (eL + eR) / 2
    pts = {'nose': px(em, 0, -0.03), 'l_eye_in': px(eL), 'l_eye': px(eL), 'l_eye_out': px(eL), 'r_eye_in': px(eR), 'r_eye': px(eR), 'r_eye_out': px(eR),
           'l_ear': px(eL, 0.035, -0.01), 'r_ear': px(eR, -0.035, -0.01), 'mouth_l': px(em, 0.02, -0.06), 'mouth_r': px(em, -0.02, -0.06)}
    for sd, S in (('l', 'L'), ('r', 'R')):
        f3 = J.get(f'finger3-1.{S}', J[f'wrist.{S}']); ank = J[f'foot.{S}']
        pts.update({f'{sd}_shoulder': px(J[f'upperarm01.{S}']), f'{sd}_elbow': px(J[f'lowerarm01.{S}']), f'{sd}_wrist': px(J[f'wrist.{S}']),
                    f'{sd}_pinky': px(f3), f'{sd}_index': px(f3), f'{sd}_thumb': px(f3), f'{sd}_hip': px(J[f'upperleg01.{S}']), f'{sd}_knee': px(J[f'lowerleg01.{S}']),
                    f'{sd}_ankle': px(ank), f'{sd}_heel': [px(ank)[0], (ytop - ybot) * s + pad, 0, 1], f'{sd}_foot': [px(ank)[0], (ytop - ybot) * s + pad, 0, 1]})
    for n, p in pts.items(): L[I[n]] = p
    return L


def measure_body(dirpath, name):
    meta, P, T = load_body(dirpath, name)
    img, fr = silhouette(P, T)
    L = landmarks(meta, fr)
    det = dict(L=L, W=np.zeros((33, 3)), M=img.astype(np.float32), n=1)
    res, m = derive.measure(dict(id=name, view='front', pose='standing', crop='full'), np.zeros(img.shape + (3,), np.uint8), det)
    o = dict(name=name, height_m=meta.get('height'), unit=res['unit'], heads=res['heads'])
    for k in KEYS:
        v = res['measures'].get(k); o[k] = v['value'] if v and v['value'] else None; o[k + '_how'] = v['how'] if v else None
    a = res['angles_2d']; o['arms_down'] = bool(a['l_shoulder_elev'] < 25 and a['r_shoulder_elev'] < 25)
    return o, img, res


# ---------------------------------------------------------------- the gate: our twelve against each photo set, and the decision
def our_people(ours, key):
    out = []
    for o in ours:
        v = o.get(key); note = ''
        if v is None:
            if key == 'shoulder' and not o.get('arms_down'): note = 'arm off the trunk (shoulder elevation >= 25 deg): the silhouette at the shoulder line includes the arm'
            elif key == 'waist_hip': note = 'waist or hip not measured'
            else: note = f"no clean trunk width at the {key} level ({o.get(key + '_how')})"
        out.append(dict(name=o['name'], sex=o['sex'], bg=o['bg'], note=note, **{key: v}))
    return out


def compare_sets(ph, ours, key, min_n=8):
    """-> {set id: (rows, summary, {sex|all: quant})}: our people against every photo set in SETS (cast read and per-person rows)"""
    import compare as CMP
    out = {}
    for sid, label, sel, suf in SETS:
        items = set_items(ph, sid, key)
        d = C.group_dists(items, key); dd = {k: v for k, v in d.items() if k[1] is None}
        rows, s = CMP.compare_people(our_people(ours, key), key, dd, gate='iqr', min_n=min_n)
        out[sid] = (rows, s, dd)
    return out


def zclass(z):
    return None if z is None else ('in' if abs(z) < 0.67 else ('above' if z > 0 else 'below'))


def decide(sets):
    """PASS / FAIL only when c2, the knee-normalised c4 and the two pooled all read the same (both FAIL the same way); anything else is UNDECIDED. Also per sex: the median
    z of that sex's people against c2 and against the knee-normalised c4; the sets AGREE when their z are within 0.5 of each other, or both lie beyond +-0.67 on the same side;
    a women's hip that is inside c2 (z +0.14) and narrow in the knee-normalised c4 (z -1.07) reads UNDECIDED."""
    reads = {sid: (sets[sid][1].get('read'), sets[sid][1].get('read_direction')) for sid in ('pooled', 'c2', 'c4kn')}
    agree = len(set(reads.values())) == 1 and reads['pooled'][0] is not None
    verdict = reads['pooled'][0] if agree else 'UNDECIDED'
    by_sex = {}
    for sx in 'fm':
        zs = {}
        for sid in ('c2', 'c4kn', 'pooled'):
            z = [r['z'] for r in sets[sid][0] if r['sex'] == sx and r['z'] is not None]
            zs[sid] = None if not z else round(float(np.median(z)), 2)
        a, b = zs['c2'], zs['c4kn']
        if a is None or b is None: read, edge = 'UNDECIDED', False
        elif abs(a - b) <= 0.5: mean = (a + b) / 2; read = zclass(mean); edge = abs(abs(mean) - 0.67) <= 0.15      # the two sets sit within half a photo-spread of each other: they agree
        elif zclass(a) == zclass(b) != 'in': read, edge = zclass(a), False                                         # both well outside on the same side
        else: read, edge = 'UNDECIDED', False                                                                       # one set says inside, the other outside (or opposite sides)
        by_sex[sx] = dict(median_z=zs, n_people=sum(1 for r in sets['pooled'][0] if r['sex'] == sx and r['z'] is not None), read=read, edge=edge, c2=zclass(a), c4kn=zclass(b))
    return dict(verdict=verdict, reads={k: list(v) for k, v in reads.items()}, by_sex=by_sex)


if __name__ == '__main__':
    its = photo_records(force='--force' in sys.argv)
    import collections
    print(len(its), collections.Counter((i['sex'], i['unit']) for i in its))
