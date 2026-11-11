#!/usr/bin/env python3
"""RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread.

REFMEASURE body gate against each photo set (8 Oct 2026 revision of the finisher's table, after CHECK.md H1).

The c4 figure studies (shard c4:new, n 24) are low-resolution and CUT AT THE FEET (the silhouette ends a median 0.12 stature above the floor line; 2 of 24 have their feet in the
picture), so derive.measure() extrapolates their stature from guessed foot landmarks and every c4 width over stature is inflated (c4 knee height 0.241 stature, c2 0.302, ours 0.29).
They are KNEE-NORMALISED (m_body.py: rows with a guessed floor, widths x (1 - 0.295) / (1 - knee height)). The gate is c2 + knee-normalised c4 together: PASS / FAIL only when c2, the
knee-normalised c4 and the pooled set read the same, else UNDECIDED. This script puts the same twelve people against every set, the per-sex reads, and how much the choice of
normalising landmark matters. It uses only the cached numbers (photo_body.json, ours_body_<tag>.json): no photograph, no render.

  python3 videos/scripts/refmeasure/body_sets.py [--tag v6]     -> review/studio_human_c8/refmeasure/results_body_sets_<tag>.csv / .md
"""
import argparse, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
try:
    import cv2  # noqa  (m_body needs the MediaPipe venv: derive.py)
except ImportError:
    py = os.path.expanduser('~/.cache/acp_human/figvenv/bin/python')
    if os.path.exists(py) and os.path.abspath(sys.executable) != os.path.abspath(py): os.execv(py, [py] + sys.argv)
    raise
import numpy as np
import rm_common as C
import m_body as MB

KEYS = ['shoulder', 'shoulder_joints', 'chest', 'waist', 'hip', 'waist_hip']


def main():
    print("body_sets.py: RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread."); return 0
    ap = argparse.ArgumentParser(); ap.add_argument('--tag', default='v6'); a = ap.parse_args()
    ph = [MB.with_ratio(r) for r in MB.photo_records()]
    ours = json.load(open(os.path.join(C.OUT, f'ours_body_{a.tag}.json')))
    for o in ours: o['waist_hip'] = (o['waist'] / o['hip']) if o.get('waist') and o.get('hip') else None
    rows, md = [], [f'Body gate {a.tag} against each photo set (IQR = per-person inside p25-p75; cast read as compare.py: median z within 0.67 and >= 75 % inside p10-p90; edge = within 0.15 of 0.67)', '',
                    '| key | set | photo n (f / m) | photo p50 f / m | our median f / m | median z | in IQR | in p10-p90 | of | read |', '|---|---|---|---|---|---|---|---|---|---|']
    dec_md = ['', 'Decision per key (PASS / FAIL only when c2, c4 knee-normalised and pooled read the same; else UNDECIDED) and per sex (the sets agree when their median z are within 0.5, or both beyond 0.67 the same way):', '',
              '| key | decision | women: z c2 / c4 kn / pooled | women read | men: z c2 / c4 kn / pooled | men read |', '|---|---|---|---|---|---|']
    for key in KEYS:
        sets = MB.compare_sets(ph, ours, key)
        for sid, label, _, _ in MB.SETS:
            prow, s, dd = sets[sid]
            f, m = dd.get(('f', None), {}), dd.get(('m', None), {})
            of = [o[key] for o in ours if o['sex'] == 'f' and o.get(key) is not None]; om = [o[key] for o in ours if o['sex'] == 'm' and o.get(key) is not None]
            read = (s.get('read') or '-') + ((' ' + s['read_direction']) if s.get('read_direction') else '') + (' (edge)' if s.get('edge') else '')
            md.append(f"| {key} | {label} | {f.get('n', 0)} / {m.get('n', 0)} | {f.get('p50', '')} / {m.get('p50', '')} | {np.median(of).round(4) if of else ''} / {np.median(om).round(4) if om else ''} | {s['median_z']} | {s['n_in_iqr']} | {s['n_in_p10_p90']} | {s['n_measured']} | {read} |")
            rows.append(dict(key=key, photo_set=sid, photo_n=dd.get((None, None), {}).get('n', 0), n_f=f.get('n', 0), n_m=m.get('n', 0), p50_f=f.get('p50'), p50_m=m.get('p50'), ours_median_f=None if not of else round(float(np.median(of)), 4),
                             ours_median_m=None if not om else round(float(np.median(om)), 4), median_z=s['median_z'], in_iqr=s['n_in_iqr'], in_p10_p90=s['n_in_p10_p90'], n_measured=s['n_measured'], read=s.get('read'), read_direction=s.get('read_direction'), edge=s.get('edge')))
        d = MB.decide(sets); bs = d['by_sex']
        dec = 'RETIRED' if key in MB.RETIRED_KEYS else d['verdict']
        zf, zm = bs['f']['median_z'], bs['m']['median_z']
        dec_md.append(f"| {key} | {dec} | {zf['c2']} / {zf['c4kn']} / {zf['pooled']} | {bs['f']['read']}{' (edge)' if bs['f']['edge'] else ''} | {zm['c2']} / {zm['c4kn']} / {zm['pooled']} | {bs['m']['read']}{' (edge)' if bs['m']['edge'] else ''} |")
    # sensitivity: how much the normalising landmark matters (c4 rows with a guessed floor; target = c2's median height of that landmark)
    c4 = [r for r in ph if r['shard'] == 'c4:new' and r['kn_usable']]; c2 = [r for r in ph if r['shard'].startswith('c2')]
    tgt = {'knee': MB.KNEE_REF, 'hip': float(np.median([r['hip_h'] for r in c2 if r.get('hip_h')])), 'shoulder': float(np.median([r['shoulder_h'] for r in c2 if r.get('shoulder_h')]))}
    sens = ['', 'How much the normalising landmark matters (c4 only, rows with a guessed floor; factor (1 - target) / (1 - height); target: knee 0.295, hip and shoulder = the c2 median height): the knee is the GENTLEST, so UNDECIDED is the conservative reading.', '',
            '| c4 widths, photo p50 f / m | raw | knee-normalised (the gate) | hip-normalised | shoulder-normalised | c2 (floor measured) |', '|---|---|---|---|---|---|']
    for key in ('shoulder', 'waist', 'hip'):
        cell = []
        for nm in ('raw', 'knee', 'hip', 'shoulder'):
            out = []
            for sx in 'fm':
                v = []
                for r in c4:
                    if r.get(key) is None or r['sex'] != sx: continue
                    h = {'raw': None, 'knee': r['knee_h'], 'hip': r.get('hip_h'), 'shoulder': r.get('shoulder_h')}[nm]
                    f = 1.0 if (nm == 'raw' or h is None or r['bottom_gap'] <= MB.GAP_MAX) else (1 - tgt[nm]) / (1 - h)
                    v.append(r[key] * f)
                out.append(round(float(np.median(v)), 3) if v else '-')
            cell.append(' / '.join(map(str, out)))
        c2v = [' / '.join(str(round(float(np.median([r[key + '_kn'] for r in c2 if r['sex'] == sx and r.get(key + '_kn') is not None])), 3)) for sx in 'fm')]
        sens.append(f"| {key} | " + ' | '.join(cell) + f" | {c2v[0]} |")
    C.write_csv(os.path.join(C.OUT, f'results_body_sets_{a.tag}.csv'), rows)
    open(os.path.join(C.OUT, f'results_body_sets_{a.tag}.md'), 'w').write('\n'.join(md + dec_md + sens) + '\n')
    print('\n'.join(md + dec_md + sens))


if __name__ == '__main__':
    main()
