#!/usr/bin/env python3
"""REFMEASURE body gate: does photograph RESOLUTION move derive.measure()'s widths? (8 Oct, the finisher; BODY7's helper found the two photo sets disagree and asked.)

The c4 figure studies are low-resolution and broader, the c2 high-resolution and narrower. Resolution is confounded with studio, era and build in the library, so the verdict
flips (results_body_sets_*.md) say nothing about the cause. This isolates one factor: take the SAME photographs the gate uses (46: c4:new + c2 nude / semi-nude, front, full, standing),
measure each at derive's own working size (long side 1600 px, the cached numbers) and again resampled DOWN (INTER_AREA, never up) to a stature of 700 / 500 / 350 / 250 px with the same
detector and mask, and compare the widths PAIRED per photograph. If widths do not move with stature in pixels, the c2 / c4 gap is the people or the studio, not the pixels.

  python3 videos/scripts/refmeasure/body_resolution.py [--force]      (nice it; MediaPipe on the CPU, ~46 x 5 pose passes; the photographs are read from the local cache, never copied)
  -> review/studio_human_c8/refmeasure/resolution_effect_body.json (numbers, keyed by manifest id) and .md (the table)
"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
try:
    import cv2, mediapipe  # noqa
except ImportError:
    py = os.path.expanduser('~/.cache/acp_human/figvenv/bin/python')
    if os.path.exists(py) and os.path.abspath(sys.executable) != os.path.abspath(py): os.execv(py, [py] + sys.argv)
    raise
import numpy as np
import rm_common as C
import m_body as MB
import posepass as PP
import derive

KEYS = MB.KEYS
TARGETS = [700, 500, 350, 250]
OUTJ = os.path.join(C.OUT, 'resolution_effect_body.json')


def measure_at(bgr, rec):
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    out = PP.run(rgb, rec)
    if out is None: return None
    res, m, det = out
    o = dict(stature_px=round(float(res['stature_px']), 1), unit=res['unit'])
    for k in KEYS:
        v = res['measures'].get(k); o[k] = round(float(v['value']), 4) if v and v['value'] and v['how'] in MB.GOOD else None
    return o


def run(force=False):
    if os.path.exists(OUTJ) and not force: return json.load(open(OUTJ))
    M = {r['id']: r for r in C.load_manifest()}
    items = MB.photo_records()
    out = dict(about='REFMEASURE body gate: derive.measure() widths over stature on the gate photographs at derive\'s working size and resampled down to a stature of 700 / 500 / 350 / 250 px; numbers only, keyed by manifest id', targets=TARGETS, items=[])
    for n, it in enumerate(items):
        rec = dict(id=it['id'], view='front', pose='standing', crop='full'); path = C.photo_path(M[it['id']])
        bgr = cv2.imread(path)
        if bgr is None: continue
        s = 1600 / max(bgr.shape[:2])
        if s < 1: bgr = cv2.resize(bgr, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
        base = measure_at(bgr, rec)
        row = dict(id=it['id'], shard=it['shard'], sex=it['sex'], source_px=list(cv2.imread(path).shape[:2]), base=base, cached={k: it.get(k) for k in KEYS}, scaled={})
        if base and base['unit'] == 'stature':
            for S in TARGETS:
                f = S / base['stature_px']
                if f >= 0.97: continue                                  # already that small: never enlarge
                small = cv2.resize(bgr, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
                row['scaled'][str(S)] = measure_at(small, rec)
        out['items'].append(row); print(n + 1, len(items), it['id'][:40], None if not base else base['stature_px'], flush=True)
    C.write_json(OUTJ, out)
    return out


def summarise(d):
    md = ['Body widths over stature, paired per photograph, as the same photograph is resampled DOWN to a smaller stature in pixels (derive.measure(), same detector and mask). '
          'Cell = median change from the base size, in percent of the base width (n pairs). The gate photographs: c4:new low-res, c2 high-res.', '']
    sets = [('c4', lambda r: r['shard'] == 'c4:new'), ('c2', lambda r: r['shard'].startswith('c2'))]
    head = '| set | stature px at base (p10 / p50 / p90) | n | ' + ' | '.join(f'{k} @{S}' for S in d['targets'] for k in ('shoulder', 'waist', 'hip')) + ' |'
    md += [head, '|' + '---|' * (3 + 3 * len(d['targets']))]
    summ = {}
    for sid, sel in sets:
        rows = [r for r in d['items'] if sel(r) and r['base'] and r['base']['unit'] == 'stature']
        st = [r['base']['stature_px'] for r in rows]
        cells = []
        for S in d['targets']:
            for k in ('shoulder', 'waist', 'hip'):
                ch = [100 * (r['scaled'][str(S)][k] / r['base'][k] - 1) for r in rows if str(S) in r['scaled'] and r['scaled'][str(S)] and r['scaled'][str(S)].get(k) and r['base'].get(k)]
                cells.append(f'{np.median(ch):+.1f}% ({len(ch)})' if ch else 'n/a'); summ[f'{sid}_{k}_{S}'] = None if not ch else round(float(np.median(ch)), 2)
        md.append(f'| {sid} | {np.percentile(st, 10):.0f} / {np.percentile(st, 50):.0f} / {np.percentile(st, 90):.0f} | {len(rows)} | ' + ' | '.join(cells) + ' |')
    # reproduction of the cached numbers at the base size
    diffs = [abs(r['base'][k] - r['cached'][k]) for r in d['items'] if r['base'] for k in ('shoulder', 'waist', 'hip') if r['base'].get(k) and r['cached'].get(k)]
    md += ['', f'Check: the base-size numbers reproduce the cached gate numbers (photo_body.json) to a median |difference| of {np.median(diffs):.4f} over {len(diffs)} values (max {np.max(diffs):.4f}).' if diffs else '']
    return '\n'.join(md) + '\n', summ


if __name__ == '__main__':
    d = run(force='--force' in sys.argv)
    txt, summ = summarise(d)
    d['summary'] = summ; C.write_json(OUTJ, d)
    open(os.path.join(C.OUT, 'resolution_effect_body.md'), 'w').write(txt)
    print(txt)
