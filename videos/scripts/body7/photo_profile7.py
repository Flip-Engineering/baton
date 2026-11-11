#!/usr/bin/env python3
"""BODY7 instrument 1: the photographs' front-silhouette profile table, by sex and build (numbers only, keyed by manifest id).

  python3 videos/scripts/body7/photo_profile7.py [--out videos/review/studio_human_c8/after/body7/measures/photo_profile7.json]

Photo selection = scripts/refmeasure/m_body.photo_records()'s rule: modern 'typical' rows of derived_typical.json that are either shard c4:new or nude /
semi-nude, view front (table 'front') or front + back (table 'fb', the sensitivity table; table 'c4' = front, shard c4:new only, REFMEASURE's gate set), crop full, a standing pose, unit == 'stature'. No photograph is
opened; the numbers are the ones refs/tools/derive.py already measured and committed. Nothing in this file writes a path to a photograph.

Per image (derive.measure() result):
  widths over stature  shoulder, shoulder_joints, chest, waist, hip, waist_hip (ratio), thigh / knee / calf / ankle (mean of the l_ and r_ values where both
                       exist, else the one). A width counts only where its 'how' is a clean read (m_body.GOOD; leg widths: 'clean'); else None.
  heights              h_shoulder h_elbow h_wrist h_hip h_knee h_ankle h_crotch h_eye (fractions of stature, res['heights']); heads (stature / head height)
  profile              the 51-row width profile (LEVELS 0..1 step 0.02): 'full' (whole silhouette extent), 'trunk' (the run under the midline, arm contact
                       included as derive.measure leaves it), 'trunk_clean' (the same without the rows flagged arm_contact: an extra)
Per group (f_all m_all f_healthy m_healthy and each (sex, build) pair): n, p10 p25 p50 p75 p90 (+ the sorted values, for percentile ranks) per key; the
profile per level as n / p25 / p50 / p75; build counts, shard counts, unit mix. A group with fewer than 8 images is flagged thin.
"""
import argparse, collections, csv, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'refmeasure'))
try:
    import cv2, mediapipe  # noqa  (the MediaPipe venv; m_body imports cv2 and derive)
except ImportError:
    py = os.path.expanduser('~/.cache/acp_human/figvenv/bin/python')
    if os.path.exists(py) and os.path.abspath(sys.executable) != os.path.abspath(py): os.execv(py, [py] + sys.argv)
    raise
import numpy as np
import rm_common as C
import m_body as MB
import derive

WIDTH_KEYS = ['shoulder', 'shoulder_joints', 'chest', 'waist', 'hip']
LEG_KEYS = ['thigh', 'knee', 'calf', 'ankle']
HEIGHT_KEYS = ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'crotch', 'eye']
KEYS = WIDTH_KEYS + ['waist_hip'] + LEG_KEYS + ['h_' + k for k in HEIGHT_KEYS] + ['heads']
KEY_SETS = dict(GATE=['shoulder', 'waist', 'hip'], PROPORTION=['h_' + k for k in HEIGHT_KEYS] + ['heads'], LEGS=LEG_KEYS,
                EXTRA=['shoulder_joints', 'chest', 'waist_hip'])
PROFILE_KINDS = ['full', 'trunk', 'trunk_clean']
HEALTHY = dict(f=('slim', 'average', 'athletic'), m=('lean', 'average', 'athletic'))
THIN = 8
LEVELS = derive.LEVELS


def record_from_res(res):
    """one derive.measure() result -> {vals, how, profile_*}: the SAME extraction for a photograph and for our rasterised body"""
    m = res['measures']; vals, how = {}, {}
    for k in WIDTH_KEYS:
        v = m.get(k); how[k] = v['how'] if v else None
        vals[k] = v['value'] if v and v['value'] and v['how'] in MB.GOOD else None
    vals['waist_hip'] = vals['waist'] / vals['hip'] if vals['waist'] and vals['hip'] else None
    for k in LEG_KEYS:
        xs, hs = [], []
        for s in 'lr':
            v = m.get(f'{s}_{k}')
            if v: hs.append(v['how'])
            if v and v['value'] and v['how'] == 'clean': xs.append(v['value'])
        vals[k] = float(np.mean(xs)) if xs else None; how[k] = ','.join(str(h) for h in hs) if hs else None
    for k in HEIGHT_KEYS: vals['h_' + k] = (res.get('heights') or {}).get(k)
    vals['heads'] = res.get('heads')
    vals = {k: (round(float(v), 4) if v is not None else None) for k, v in vals.items()}
    pf, pt, pc = [], [], []
    for e in res['profile']:
        pf.append(e.get('full') if e else None); pt.append(e.get('trunk') if e else None)
        pc.append(e.get('trunk') if e and 'arm_contact' not in e else None)
    return dict(vals=vals, how=how, profile_full=pf, profile_trunk=pt, profile_trunk_clean=pc)


def select(views):
    """m_body.photo_records()'s rule, for the given views: returns [(manifest row, derive result)]"""
    M = {r['id']: r for r in C.load_manifest()}
    d = json.load(open(os.path.join(C.REFS_DIR, 'derived_typical.json')))['images']
    out = []
    for i in d:
        r = M.get(i['id'])
        if 'error' in i or not r or not C.is_modern(r): continue
        cl = (r['clothing'] or '').lower()
        if r['shard'] != 'c4:new' and not (cl.startswith(('nude', 'semi-nude')) and r['use'] == 'typical'): continue
        if i['view'] not in views or i['crop'] not in ('full',) or i['pose'] not in MB.STAND: continue
        out.append((r, i))
    return out


def q5(vals):
    a = [float(v) for v in vals if v is not None]
    if not a: return dict(n=0)
    d = dict(n=len(a))
    for q in (10, 25, 50, 75, 90): d[f'p{q}'] = round(float(np.percentile(a, q)), 4)
    d['vals'] = sorted(round(x, 4) for x in a)
    d['thin'] = len(a) < THIN
    return d


def prof_stats(rows, kind):
    out = []
    for j, lv in enumerate(LEVELS):
        a = [r['profile_' + kind][j] for r in rows if r['profile_' + kind][j] is not None]
        if not a: out.append(dict(level=lv, n=0)); continue
        out.append(dict(level=lv, n=len(a), p25=round(float(np.percentile(a, 25)), 4), p50=round(float(np.percentile(a, 50)), 4), p75=round(float(np.percentile(a, 75)), 4)))
    return out


def group_table(rows, label):
    g = dict(label=label, n_images=len(rows), thin=len(rows) < THIN,
             builds=dict(collections.Counter(r['build'] for r in rows)), shards=dict(collections.Counter(r['shard'] for r in rows)),
             unit=dict(collections.Counter(r['unit'] for r in rows)), views=dict(collections.Counter(r['view'] for r in rows)))
    g['keys'] = {k: q5([r['vals'][k] for r in rows]) for k in KEYS}
    g['profile'] = {kind: prof_stats(rows, kind) for kind in PROFILE_KINDS}
    return g


def build(views, shard=None):
    recs = []
    for r, i in select(views):
        if shard and r['shard'] != shard: continue
        rec = record_from_res(i)
        rec.update(id=i['id'], sex=r['sex'], build=r['build'], age_band=r['age_band'], bg=r['background_group'], shard=r['shard'], view=i['view'], unit=i['unit'])
        recs.append(rec)
    n_all = len(recs); recs = [r for r in recs if r['unit'] == 'stature']
    groups = {}
    for s in 'fm':
        S = [r for r in recs if r['sex'] == s]
        groups[f'{s}_all'] = group_table(S, f'{s}_all')
        groups[f'{s}_healthy'] = group_table([r for r in S if r['build'] in HEALTHY[s]], f'{s}_healthy ({"/".join(HEALTHY[s])})')
        for b in sorted({r['build'] for r in S}): groups[f'{s}_{b}'] = group_table([r for r in S if r['build'] == b], f'{s}_{b}')
    return dict(views=list(views), shard=shard, n_selected=n_all, n_stature=len(recs), groups=groups,
                images={r['id']: {k: v for k, v in r.items() if k != 'id'} for r in recs})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=os.path.join(C.C8, 'after', 'body7', 'measures', 'photo_profile7.json'))
    a = ap.parse_args()
    tables = {'front': build(('front',)), 'fb': build(('front', 'back')), 'c4': build(('front',), 'c4:new')}
    obj = dict(about='BODY7 photo profile table: REFS derive.measure() numbers of the modern typical figure studies (shard c4:new or nude / semi-nude), full crop, standing, '
                     'unit == stature. Table front = view front (m_body.photo_records() rule); table fb = front + back pooled (sensitivity); table c4 = view front, shard c4:new only '
                     '(the set REFMEASURE gate 6 uses, kept to reproduce its numbers). Widths / heights are fractions '
                     'of stature; thigh / knee / calf / ankle = mean of l_ and r_ where both are clean reads; a measure counts only where its how is a clean read '
                     '(m_body.GOOD; leg widths clean). Keyed by manifest id; numbers only, no photograph and no path to one.',
               keys=KEYS, key_sets=KEY_SETS, levels=LEVELS, healthy={k: list(v) for k, v in HEALTHY.items()}, thin_below=THIN, tables=tables)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    json.dump(obj, open(a.out, 'w'), separators=(',', ':'))
    for t, T in tables.items():
        print(f'== table {t}: {T["n_stature"]} images (selected {T["n_selected"]}), groups:')
        for g, G in T['groups'].items():
            ns = {k: G['keys'][k]['n'] for k in KEYS}
            print(f'  {g:16s} images {G["n_images"]:3d}{" THIN" if G["thin"] else "     "} builds {G["builds"]} shards {G["shards"]} unit {G["unit"]}')
            print('     n per key: ' + ' '.join(f'{k}={v}' for k, v in ns.items()))
    print('wrote', a.out, os.path.getsize(a.out), 'bytes')


if __name__ == '__main__':
    main()
