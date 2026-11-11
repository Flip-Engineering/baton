#!/usr/bin/env python3
"""REFMEASURE: side-by-side boards of our renders beside the references, and the landmark passes behind them (8 Oct 2026).
RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread.
The measure commands below (face | skin | clothing | motion | hair | body | all) and `table` are retired with them: they print this note and exit.
The boards, the photo-side landmark tables they read and the selftest of the face pass remain.

  python3 videos/scripts/refmeasure/refmeasure.py <measure> --ours <dir> [<dir> ...] --tag <v5|v6> [--photos c3|all] [--stage studio5] [--persp-ref 2.0|0] [--allow-jpeg]
      measure: face | skin | clothing | motion | hair | body | all        (re-executes itself under the MediaPipe venv)
      --persp-ref M   re-project the landmark proportions of OUR plates to a camera M metres from the face (default 2.0; 0 = off); --allow-jpeg  measure JPEG plates too
                      (diagnostic only: they are refused by default, and cheek_hf is never measured on one). 8 Oct 2026 revision: read NOTES.md 'INSTRUMENTS REVISED' first.
  python3 videos/scripts/refmeasure/refmeasure.py table [--tags v6,v7a]    results table v5 | v6 | photos (or the tags given), PASS / FAIL (results_table.csv / .json / .md; results_table_<tags>.* for other tags)
  --tag is v<number> plus an optional label (v6 baseline, v7a a candidate): the number picks the plate names, the whole tag names the outputs. READ NOTES.md (USE) first.
  python3 videos/scripts/refmeasure/refmeasure.py photos [--force]         rebuild the photo-side tables (numbers only, keyed by manifest id)
  python3 videos/scripts/refmeasure/refmeasure.py board --tag v6           the annotated board of OUR renders (committed) from the plates

--ours takes plate folders (searched recursively; default: videos/out/bench/human8_integ* and human8_refm*, and integration6/clips). Plates are found by name:
  face / skin / hair   tele<5|6|7..>_<stage>_<name>.png (lab_front.html with tele=1: a 2.5 m camera, fov ~9.6 deg; preferred), front<n>_<stage>_<name>.png (square-on faces from
                       labs/refmeasure/lab_front.html) or face<n>_<stage>_<name>.png (lab_person's face camera: 16 degrees off-axis and the dressed pose turns some heads, so
                       those are kept only when frontal enough: |yaw index| < 0.2). PNG only: a JPEG plate is refused (listed in the row's note) unless --allow-jpeg
  clothing, hanging arms   row<5|6>_dressed_studio5_full.png (the twelve dressed, front band on top)
  body                 the posed nude body of each person: labs/refmeasure/body_export.mjs writes <ver>_<name>.json/.bin to a folder (--bodies, default the scratch folder)
  motion               lift.mp4 (v6, review/.../integration6/clips) or lift_*.png atlases (v5, out/bench/human8_integ5d)
Outputs (committed, review/studio_human_c8/refmeasure/): results_<measure>_<tag>.json and .csv, photo_dist_<measure>.json and .csv, results_table.*, plus the numbers-only
photo tables photo_facepass.json, photo_cloth.json, photo_body.json, photo_motion.json and hair_labels.csv (keyed by manifest id only). No photograph is written anywhere.
"""
import argparse, glob, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
try:
    import cv2, mediapipe  # noqa
except ImportError:
    py = os.path.expanduser('~/.cache/acp_human/figvenv/bin/python')
    if os.path.exists(py) and os.path.abspath(sys.executable) != os.path.abspath(py): os.execv(py, [py] + sys.argv)
    raise

import csv
import numpy as np
from PIL import Image
import rm_common as C
import compare as CMP
import facepass as FP
import m_face as MF
import m_cloth as MC
import m_body as MB
import m_motion as MM
import posepass as PP

YAW_GEO, YAW_SOFT = 0.2, 0.35


def tag_type(t):
    """a run tag: v<number> plus an optional label (v5, v6, v7, v7b): the number picks the plate names (front7_studio5_<name>, row7_dressed_studio5_full), the whole tag names the outputs"""
    if not re.fullmatch(r'v\d+[a-z0-9_]*', t): raise argparse.ArgumentTypeError('tag must be v<number> with an optional label, e.g. v6, v7, v7b')
    return t


def tag_n(tag): return re.match(r'v(\d+)', tag).group(1)
CLOSED = 0.06
MEASURES = ['face', 'skin', 'clothing', 'motion', 'hair', 'body']

# key: (label, unit, gate, photo filter) ; primary keys are the ones PERSON_TARGETS names, the others are extras for the reader
FACE_KEYS = [('midface_h_w', 'midface height / face width (pupil line to stomion over bizygomatic width)', 'ratio', 'iqr', 'geo', True),
             ('face_w', 'cheek width (bizygomatic width / IPD)', 'IPD', 'iqr', 'geo', True),
             ('lower_verm', 'lower vermilion / IPD (closed mouths)', 'IPD', 'iqr', 'closed', True),
             ('brow_img', 'brow thickness / IPD (from the picture)', 'IPD', 'iqr', 'geo', True),
             ('cheek_full', 'face width at the mouth / bizygomatic width (buccal fullness)', 'ratio', 'iqr', 'geo', False),
             ('upper_verm', 'upper vermilion / IPD (closed mouths)', 'IPD', 'iqr', 'closed', False),
             ('len_w', 'nasion-menton / bizygomatic width (closed mouths)', 'ratio', 'iqr', 'closed', False),
             ('brow_lm', 'brow thickness / IPD (landmark mesh, for comparison: it barely varies)', 'IPD', 'iqr', 'geo', False)]
# SKIN, 8 Oct: the redness gate is forehead a*, forehead hue and flush_a (cheek a* minus forehead a*); the cheek colours are reported (clean cheek only) but are NOT gate keys
# (lamp, shadow and hair move them); cheek_hf is the pore-scale floor test, PNG plates with IPD >= 200 px only
GATED_SKIN = ('forehead_a', 'forehead_h', 'flush_a', 'cheek_hf')
SKIN_KEYS = [(f'{r}_{c}', f'{r} {c}', u, 'wide', 'skin', f'{r}_{c}' in GATED_SKIN) for r in ('forehead', 'cheek') for c, u in (('L', 'L*'), ('a', 'a*'), ('b', 'b*'), ('C', 'C*'), ('h', 'hue deg'))] + \
            [('flush_a', 'cheek a* minus forehead a* (the regional flush; clean cheek only)', 'a*', 'wide', 'skin', True),
             ('cheek_hf', 'cheek high-pass energy (std of L* minus its 1.5 px blur, face resampled to 100 px IPD; clean cheeks, IPD >= 200 px, PNG only)', 'L* units', 'wide', 'skin_hf', True),
             ('forehead_hf', 'forehead high-pass energy, the same measure on the forehead patch (reported, not a gate key)', 'L* units', 'wide', 'skin_hf', False)]
LIP_KEYS = ('lower_verm', 'upper_verm')      # not gated for a person whose background has fewer than LIP_BG_MIN closed-mouth photographs
LIP_BG_MIN = 15
HAIR_KEYS = [('hair_face_Y', 'hair / face luminance at the temple (linear Y of the patch outside the temple over the skin)', 'ratio', 'iqr', 'hair', True),
             ('hairline', 'hairline height above the brow (IPD)', 'IPD', 'iqr', 'hair', True)]
CLOTH_KEYS = [('knee_w', 'leg width at the knee / stature', 'stature', 'iqr', 'cloth', True), ('ankle_w', 'leg width at the ankle (narrowest 0.05-0.11 stature) / stature', 'stature', 'iqr', 'cloth', True),
              ('hem_ankle', 'hem / ankle: width at 0.12 stature over the ankle width', 'ratio', 'iqr', 'cloth', True), ('knee_ankle', 'knee / ankle width (the taper)', 'ratio', 'iqr', 'cloth', False)]
BODY_KEYS = [('shoulder', 'shoulder width (silhouette at the shoulder line) / stature', 'stature', 'iqr', 'body', True), ('shoulder_joints', 'shoulder joints (landmarks) / stature: RETIRED as a gate key (our joint is the skeleton centre, the photographs\' MediaPipe\'s landmark)', 'stature', 'iqr', 'body', False),
             ('chest', 'chest width / stature', 'stature', 'iqr', 'body', False), ('waist', 'waist width / stature', 'stature', 'iqr', 'body', True), ('hip', 'hip width / stature', 'stature', 'iqr', 'body', True),
             ('waist_hip', 'waist / hip', 'ratio', 'iqr', 'body', False)]

OUR_HAIR = {   # hair colour group of each cast person, by eye on the plates (the same groups as hair_labels.csv: black, brown, light = blond / grey / red)
    'L08_f24_hispanic': 'black', 'L21_m32_black': 'black', 'L22_f27_black': 'black', 'L11_m23_white': 'light', 'L20_f29_asian': 'black', 'L17_m28_hispanic': 'black',
    'L12_f39_white': 'light', 'L03_m38_asian': 'black', 'L14_f42_black': 'black', 'L23_m45_white': 'light', 'L06_f53_white': 'light', 'L05_m59_black': 'light'}


def people_list():
    out = []
    for n in C.TWELVE:
        i = C.person_info(n); out.append(dict(name=n, sex=i['sex'], age=i['age'], bg=i['bg'], age_band=C.age_band(i['age'])))
    return out


def rel(p): return os.path.relpath(p, C.REPO)


# ---------------------------------------------------------------- face family (face, skin, hair): one pass per plate
REV = 2                    # bumps when the face pass changes: an older ours_facepass_<tag>.json cache is re-measured (8 Oct 2026: judged patches, mirror, perspective)
KIND_RANK = {'tele': 0, 'front': 1, 'face': 2}      # a long-lens square-on plate first, then a square-on one, then lab_person's own (off-axis) face plate


def our_face_plates(dirs, ver, stage, allow_jpeg=False, refused=None):
    """-> {name: (kind, path)}. kind: tele (lab_front tele=1) | front (lab_front) | face (lab_person's). PNG only: a JPEG plate adds JPEG blocking to every pixel measure and a
    half-size one cannot reach IPD 200 (CHECK.md H4, L1); it is refused unless allow_jpeg, and listed in `refused` ({name: path}) when that dict is given."""
    n = tag_n(ver)
    pool = {}
    for kind in KIND_RANK:
        for k, p in C.find_plates(dirs, f'{kind}{n}_{stage}_L*.*').items():
            if p.lower().endswith(('.png', '.jpg', '.jpeg')):
                nm = re.sub(r'_0\.00$', '', k.split(f'_{stage}_', 1)[1])
                pool.setdefault(nm, []).append((kind, p))
    out = {}
    for nm in C.TWELVE:
        c = pool.get(nm, [])
        if not c: continue
        if not allow_jpeg:
            if refused is not None:
                for kind, p in c:
                    if not p.lower().endswith('.png'): refused.setdefault(nm, p)
            c = [kp for kp in c if kp[1].lower().endswith('.png')]
            if not c: continue
        c.sort(key=lambda kp: (KIND_RANK[kp[0]], not kp[1].lower().endswith('.png')))
        out[nm] = c[0]
    return out


def ours_facepass(args, force=False):
    """one analyse_mirror() per plate (plate + mirror, the landmark proportions re-projected to args.persp_ref from the plate's camera distance), cached in ours_facepass_<tag>.json"""
    cache = os.path.join(C.OUT, f'ours_facepass_{args.tag}.json')
    refused = {}
    plates = our_face_plates(args.ours, args.tag, args.stage, getattr(args, 'allow_jpeg', False), refused)
    ref = getattr(args, 'persp_ref', FP.PERSP_REF_M)
    old = json.load(open(cache)) if os.path.exists(cache) and not force else {}
    people = []
    for P in people_list():
        nm = P['name']; e = dict(P)
        if nm in plates:
            kind, path = plates[nm]
            prev = old.get(nm)
            if prev and prev.get('plate') == rel(path) and os.path.getmtime(path) <= prev.get('mtime', 0) and prev.get('rev') == REV and prev.get('persp_ref') == ref: e.update(prev)
            else:
                m, fr = FP.analyse_mirror(FP.load_rgb(path), cam_m=FP.PLATE_CAM_M[kind], ref_m=(ref or None))
                e.update(plate=rel(path), kind=kind, m=m, mtime=os.path.getmtime(path), rev=REV, persp_ref=ref)
            if nm in refused: e['refused_jpeg'] = rel(refused[nm])
        elif nm in refused: e.update(plate=rel(refused[nm]), kind=None, m={'error': 'JPEG plate refused (JPEG blocking; use a PNG; --allow-jpeg for a diagnostic)'})
        else: e.update(plate=None, kind=None, m={'error': 'no plate'})
        people.append(e)
    C.write_json(cache, {p['name']: {k: v for k, v in p.items() if k in ('plate', 'kind', 'm', 'mtime', 'rev', 'persp_ref', 'refused_jpeg')} for p in people})
    return people


def flat_m(m):
    o = {}
    for k, v in m.items():
        if isinstance(v, dict):
            for kk, vv in v.items(): o[f'{k}_{kk}'] = vv
        else: o[k] = v
    return o


def face_photo_items(mode, labels=None):
    """flat rows of the portraits that pass a measure's frame filter; mode: geo | closed | skin | skin_hf | hair"""
    its = MF.photo_records(); rows = []
    lab = labels
    for it in its:
        m = it['m']
        if 'error' in m: continue
        f = flat_m(m); y = abs(m['yaw'])
        r = dict(f, id=it['id'], sex=it['sex'], bg=it['bg'], age_band=it['age_band'], light=it.get('light'))
        if mode in ('geo', 'closed'):
            if y >= YAW_GEO: continue
            if mode == 'closed' and m['mouth_open'] >= CLOSED: continue
        elif mode in ('skin', 'skin_hf'):
            if y >= YAW_SOFT or m.get('grey_image'): continue
        elif mode == 'hair':
            if y >= YAW_SOFT: continue
            c = (lab or {}).get(it['id'])
            if c is None or c['hair_colour'] in ('covered', 'bald'): continue
            r['hair_group'] = {'black': 'black', 'brown': 'brown'}.get(c['hair_colour'], 'light'); r['bg'] = r['hair_group']
            r['sex'] = it['sex']
        rows.append(r)
    return rows


def load_hair_labels():
    p = os.path.join(C.OUT, 'hair_labels.csv')
    return {r['id']: r for r in csv.DictReader(open(p))} if os.path.exists(p) else {}


NOT_GATED = {'forehead_L', 'forehead_b', 'forehead_C', 'cheek_L', 'cheek_a', 'cheek_b', 'cheek_C', 'cheek_h', 'forehead_hf'}     # SKIN keys that are reported, not gate keys


def why_none(m, key):
    """the reason a plate gave no value for `key` (shown in the row's note and in the verdict's not_judged list)"""
    if key == 'forehead_hf': return 'forehead patch rejected or IPD < 200 px'
    if key.startswith('forehead_'): return 'forehead patch rejected: ' + ('; '.join(m.get('forehead_reject') or []) or 'not measurable')
    if key == 'cheek_hf':
        w = m.get('cheek_hf_why') or 'not measurable'
        return w + (': ' + '; '.join(m.get('cheek_reject') or []) if w == 'no clean cheek' else '')
    if key == 'flush_a':
        bits = []
        if not m.get('cheek'): bits.append('no clean cheek (' + '; '.join(m.get('cheek_reject') or ['not measurable']) + ')')
        if not m.get('forehead'): bits.append('forehead patch rejected (' + '; '.join(m.get('forehead_reject') or ['not measurable']) + ')')
        return '; '.join(bits) or 'not measurable'
    if key.startswith('cheek_') and key != 'cheek_full': return 'no clean cheek: ' + ('; '.join(m.get('cheek_reject') or []) or 'not measurable')
    if key == 'brow_img': return 'brow not 8 L* darker than its skin (blonde, grey, plucked) or off the picture'
    if key == 'hairline': return 'no hairline found in the scan (fringe, hat, bald crown or frame edge)'
    if key == 'hair_face_Y': return 'temple patch outside the image or no skin colour'
    return 'not measurable'


def our_rows(people, mode, key):
    """per person dicts with sex, bg, name and key -> value (None, with `note` saying why, when this plate fails the measure's frame filter or the key cannot be read)"""
    out = []
    for p in people:
        m = p['m']; r = dict(name=p['name'], sex=p['sex'], bg=p['bg'], plate=p.get('plate'), kind=p.get('kind'))
        if 'error' in m: r[key] = None; r['note'] = m['error']; out.append(r); continue
        f = flat_m(m); y = abs(m['yaw']); r['yaw'] = m['yaw']; v = f.get(key)
        tol = YAW_GEO if mode in ('geo', 'closed') else YAW_SOFT
        if y >= tol: v = None; r['note'] = f"turned (yaw index {m['yaw']:+.2f}, limit {tol})"
        elif mode == 'closed' and m['mouth_open'] >= CLOSED: v = None; r['note'] = 'mouth open'
        elif v is None: r['note'] = why_none(m, key)
        r[key] = v
        if mode == 'hair': r['bg'] = OUR_HAIR[p['name']]
        out.append(r)
    return out


def write_results(measure, tag, keys_out, meta, dists_out):
    base = os.path.join(C.OUT, f'results_{measure}_{tag}')
    C.write_json(base + '.json', dict(measure=measure, tag=tag, **meta, keys=keys_out))
    rows = []
    for k, ko in keys_out.items(): rows += CMP.comparison_rows_csv(measure, tag, ko['people'])
    if rows: C.write_csv(base + '.csv', rows)
    if dists_out is not None:
        C.write_json(os.path.join(C.OUT, f'photo_dist_{measure}.json'), dists_out)
        drows = []
        for k, d in dists_out['keys'].items():
            for g, q in d['groups'].items(): drows.append(dict(key=k, group=g, **q))
        if drows:
            cols = ['key', 'group', 'n', 'p10', 'p25', 'p50', 'p75', 'p90']
            C.write_csv(os.path.join(C.OUT, f'photo_dist_{measure}.csv'), drows, cols)


def run_keys(KEYS, people, items_for, mode_of, by=('sex', 'bg'), by_age=True, min_n=15, our_mode=None):
    keys_out, dists_out = {}, {}
    for key, label, unit, gate, mode, primary in KEYS:
        items = items_for(mode)
        dists = C.group_dists([r for r in items if r.get(key) is not None], key, by_age=by_age)
        rows, summ = CMP.compare_people(our_rows(people, our_mode(mode) if our_mode else mode, key), key, dists, gate=gate, min_n=min_n, by=by, bg_min=LIP_BG_MIN if key in LIP_KEYS else None)
        gated = key not in NOT_GATED
        summ.update(label=label, unit=unit, gate=gate, primary=primary, gated=gated)
        if not gated: summ['verdict_text'] = (summ.get('verdict_text') or '') + ' [reported, not a gate key]'
        keys_out[key] = dict(label=label, unit=unit, gate=gate, primary=primary, gated=gated, summary=summ, people=rows, photo_groups={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in dists.items() if g[1] is None or not str(g[1]).startswith('age')})
        dists_out[key] = dict(label=label, unit=unit, mode=mode, groups={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in dists.items()})
    return keys_out, dict(about='REFMEASURE photo distributions (n, p10 p25 p50 p75 p90) by sex x background, sex, all, and sex x age band where n >= 5. 8 Oct revision: photographs are mirror-averaged, skin patches judged and rejected as ours are', keys=dists_out)


def plate_meta(args, people):
    return dict(plates={p['name']: (p.get('plate'), p.get('kind')) for p in people}, persp_ref_m=getattr(args, 'persp_ref', FP.PERSP_REF_M) or None,
                perspective='landmark proportions of our plates re-projected from the plate camera (tele 2.47 m, front / face 0.96 m) to persp_ref_m with MediaPipe z (facepass.persp_xy); photographs are not corrected (distance unknown); the uncorrected values are in ours_facepass_<tag>.json as <key>_raw',
                mirror='every plate and photograph = mean of the image and its mirror image for the landmark-based keys, hairline, hair_face_Y; colour patches from the image itself',
                jpeg_refused={p['name']: p.get('refused_jpeg') or p['plate'] for p in people if p.get('refused_jpeg') or str(p['m'].get('error', '')).startswith('JPEG')},
                thresholds=dict(spread_max=FP.SPREAD_MAX, cmf_min=FP.CMF_MIN, hair_frac_max=FP.HAIR_FRAC_MAX, hf_min_ipd=FP.HF_MIN_IPD_FACTOR * FP.HF_IPD, yaw_geo=YAW_GEO, yaw_soft=YAW_SOFT))


def run_face(args):
    people = ours_facepass(args)
    ko, do = run_keys(FACE_KEYS, people, lambda mode: face_photo_items(mode), None)
    meta = dict(photo_set='REFS c3 head-and-shoulders portraits (manifest: typical, kept, modern, head and neck in frame), frontal: |yaw index| < 0.2; mouth keys on closed mouths (mouth_open < 0.06); '
                          'the lip keys are NOT gated for a person whose background has fewer than %d closed-mouth photographs; no verdict when more than 2 of 12 people could not be judged' % LIP_BG_MIN,
                n_photos=len(face_photo_items('geo')), n_photos_closed=len(face_photo_items('closed')), **plate_meta(args, people))
    write_results('face', args.tag, ko, meta, do); return ko


def photo_patch_rejection(items):
    """how many photographs lose a patch to each rule (the same judgement as ours): numbers for NOTES / the skin json"""
    n = len(items); out = dict(n_photos=n, forehead_rejected=0, cheek_both_clean=0, cheek_one_clean=0, cheek_none_clean=0, reasons={})
    for r in items:
        if r.get('forehead_a') is None: out['forehead_rejected'] += 1
        nc = sum(bool(r.get(f'cheek_{s}_ok')) for s in 'RL')
        out['cheek_both_clean' if nc == 2 else 'cheek_one_clean' if nc == 1 else 'cheek_none_clean'] += 1
        for s in 'RL':
            for x in (r.get(f'cheek_{s}_reasons') or []):
                k = 'L* spread' if x.startswith('L*') else 'hair' if x.startswith('hair') else 'cheek - forehead L* (shadow)' if x.startswith('cheek') else 'skin-like fraction'
                out['reasons'][k] = out['reasons'].get(k, 0) + 1
    return out


def run_skin(args):
    people = ours_facepass(args)
    ko, do = run_keys(SKIN_KEYS, people, lambda mode: face_photo_items(mode), None, by=('bg',), by_age=False, min_n=15)
    meta = dict(photo_set='REFS c3 portraits, colour photographs, |yaw index| < 0.35, patches judged (spread, hair, cheek-minus-forehead L*); the gate is the photos of the same background group (both sexes, n >= 15, else all photos) at p10-p90; '
                          'gate keys: forehead a*, forehead hue, flush_a (cheek a* minus forehead a*), cheek_hf (PNG plates with IPD >= 200 px only)',
                n_photos=len(face_photo_items('skin')), n_photos_hf=len(face_photo_items('skin_hf')), photo_patch_rejection=photo_patch_rejection(face_photo_items('skin')), **plate_meta(args, people))
    write_results('skin', args.tag, ko, meta, do); return ko


def run_hair(args):
    people = ours_facepass(args); lab = load_hair_labels()
    if not lab: raise SystemExit('no hair_labels.csv: label the c3 portraits first (hair_sheets.py)')
    ko, do = run_keys(HAIR_KEYS, people, lambda mode: face_photo_items('hair', lab), None, by=('bg',), by_age=False, min_n=12, our_mode=lambda m: 'hair')
    for k in ko.values():          # the hair group sits in the 'bg' slot: tidy the labels
        for r in k['people']: r['group'] = r['group'].replace('all|', 'hair group ')
    meta = dict(photo_set='REFS c3 portraits labelled by eye (hair_labels.csv), covered and bald excluded, |yaw index| < 0.35; groups black, brown, light (blond + grey + red); our people grouped by eye (OUR_HAIR)',
                our_hair=OUR_HAIR, n_photos=len(face_photo_items('hair', lab)), **plate_meta(args, people))
    write_results('hair', args.tag, ko, meta, do); return ko


# ---------------------------------------------------------------- clothing (leg line)
def cloth_reference_sets(ph_modern, ph_work, trousered, key):
    """the two reference sets we HAVE, read beside each other (NOT a gate): our median and its z against each; the SIGN flips, which is why neither gates (CHECK.md H2)"""
    out = {}
    for nm, items in (('modern trousers (7 women: leggings, a uniform, fashion)', ph_modern), ('LoC / c2_f2 work trousers 1935-45 (4 men, 2 women)', ph_work)):
        v = [r[key] for r in items if r.get(key) is not None]
        q = C.quant(v)
        mine = [r[key] for r in trousered if r.get(key) is not None]
        om = float(np.median(mine)) if mine else None
        out[nm] = dict(n=q['n'], p25=q.get('p25'), p50=q.get('p50'), p75=q.get('p75'), ours_median=None if om is None else round(om, 4),
                       z=None if (om is None or q['n'] < 3 or CMP.z_of(om, q) is None) else round(CMP.z_of(om, q), 2))
    return out


def run_clothing(args):
    n = tag_n(args.tag)
    plates = C.find_plates(args.ours, f'row{n}_dressed_studio5_full.png'); path = plates.get(f'row{n}_dressed_studio5_full')
    if not path: raise SystemExit(f'no row{n}_dressed_studio5_full.png under {args.ours}')
    rgb = np.asarray(Image.open(path).convert('RGB'))[:1000]
    ours = []
    for k, P in enumerate(people_list()):
        crop, x0 = PP.crop_cell(rgb, k, 12)
        o = MC.analyse(crop, dict(id=P['name'], view='front', pose='standing', crop='full'))
        r = dict(P, **(o if o and 'error' not in o else {}))
        if not o or 'error' in o: r['note'] = (o or {}).get('error', 'no pose')
        r['skirted'] = P['name'].startswith('L20')
        ours.append(r)
    C.write_json(os.path.join(C.OUT, f'ours_cloth_{args.tag}.json'), [{k: v for k, v in r.items()} for r in ours])
    recs = MC.photo_records(); okp = lambda i: 'error' not in i['m'] and i['m'].get('knee_w') and i['m'].get('ankle_w') and i.get('legwear') == 'trousers'
    ph = [dict(id=i['id'], sex=i['sex'], bg=i['bg'], **i['m']) for i in recs if okp(i) and i['modern']]
    ph_all = [dict(id=i['id'], sex=i['sex'], bg=i['bg'], **i['m']) for i in recs if okp(i)]
    M = {r['id']: r for r in C.load_manifest()}
    ph_work = [dict(id=i['id'], sex=i['sex'], bg=i['bg'], **i['m']) for i in recs if okp(i) and (M[i['id']].get('source') or '').startswith('loc')]
    census = MC.work_trouser_census()
    keys_out, dists_out = {}, {}
    trousered = [r for r in ours if not r['skirted']]
    for key, label, unit, gate, mode, primary in CLOTH_KEYS:
        d = C.group_dists([r for r in ph if r.get(key) is not None], key); d_all = C.group_dists([r for r in ph_all if r.get(key) is not None], key)
        people = [dict(name=r['name'], sex=r['sex'], bg=r['bg'], note=r.get('note', ''), **{key: r.get(key)}) for r in trousered]
        # 8 Oct: each person is read against HIS OWN SEX's trouser photographs and a cell with fewer than 15 cannot PASS or FAIL (men: 0 modern trouser photographs, women: 7)
        rows, summ = CMP.compare_people(people, key, {k: v for k, v in d.items() if k[1] is None}, gate='iqr', min_n=15, by=('sex',), no_gate_below=15)
        summ.update(label=label, unit=unit, gate='iqr', primary=primary, photo_n_modern=d.get((None, None), {}).get('n', 0), photo_n_with_loc=d_all.get((None, None), {}).get('n', 0))
        keys_out[key] = dict(label=label, unit=unit, gate='iqr (n >= 15 per sex or NO GATE)', primary=primary, summary=summ, people=rows,
                             photo_groups={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in d.items() if g[1] is None},
                             photo_groups_with_loc={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in d_all.items() if g[1] is None},
                             reference_sets_not_a_gate=cloth_reference_sets(ph, ph_work, trousered, key))
        dists_out[key] = dict(label=label, unit=unit, mode='cloth', groups={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in d.items()})
    meta = dict(photo_set='clothed standing front and back full figures of the manifest (typical, kept; not nude, swim, leotard, underwear), modern, labelled by eye as long trousers / jeans / leggings / overalls (cloth_legwear_labels.csv; the rest are skirts, dresses, shorts, bare legs): '
                          'n is 7 and all 7 are WOMEN (men 0), so NO sex group reaches 15 and the gate is NO GATE; the 1935-45 LoC / c2_f2 work-trouser rows (n 6: 4 men, 2 women) beside it in photo_groups_with_loc and reference_sets_not_a_gate',
                ours=f'row{n}_dressed_studio5_full.png front band, 12 cells; L20 wears a skirt and is left out of the trouser gate (her legs are measured and listed)', plate=rel(path),
                work_trouser_census=census,
                skirted=[{k: r.get(k) for k in ('name', 'knee_w', 'ankle_w', 'hem_ankle')} for r in ours if r['skirted']])
    write_results('clothing', args.tag, keys_out, meta, dict(about='REFMEASURE clothing photo distributions', keys=dists_out)); return keys_out


# ---------------------------------------------------------------- body (c2 + knee-normalised c4)
def qgroups(dd): return {f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in dd.items() if g[1] is None}


def body_verdict_text(summ, dec, verdict):
    rd = lambda t: (t[0] or '?') + ((' ' + t[1]) if t[1] else '')
    if verdict == 'RETIRED': return 'RETIRED as a gate key (our joint is the skeleton centre, the photographs\' is a MediaPipe landmark)'
    if verdict == 'NO VERDICT':
        return 'NO VERDICT (%d of %d not judged: %s); survivors read %s' % (summ['n_failed'], summ['n'], '; '.join(sorted({v.split(' (')[0].split(':')[0] for v in summ['not_judged'].values()})), dec['verdict'])
    if verdict == 'UNDECIDED': return 'UNDECIDED (pooled %s; c2 %s; c4 knee-normalised %s)' % (rd(dec['reads']['pooled']), rd(dec['reads']['c2']), rd(dec['reads']['c4kn']))
    return verdict + (' ' + summ['direction'] if summ.get('direction') else '') + ' (c2, c4 knee-normalised and pooled agree' + (f"; at the edge in {', '.join(summ['edge_sets'])}" if summ.get('edge_sets') else '') + ')'


def run_body(args):
    ver = args.tag
    ours = []
    for P in people_list():
        o, img, res = MB.measure_body(args.bodies, f'{ver}_{P["name"]}')
        o['waist_hip'] = (o['waist'] / o['hip']) if o['waist'] and o['hip'] else None
        ours.append(dict(P, **{k: v for k, v in o.items() if k != 'name'}))
    C.write_json(os.path.join(C.OUT, f'ours_body_{ver}.json'), ours)
    ph = [MB.with_ratio(r) for r in MB.photo_records()]
    keys_out, dists_out = {}, {}
    for key, label, unit, gate, mode, primary in BODY_KEYS:
        sets = MB.compare_sets(ph, ours, key, min_n=8)
        rows, summ, dd = sets['pooled']
        dec = MB.decide(sets)
        retired = key in MB.RETIRED_KEYS
        verdict = 'RETIRED' if retired else dec['verdict']
        if not retired and summ['verdict'] == 'NO VERDICT': verdict = 'NO VERDICT'
        summ = dict(summ, label=label, unit=unit, gate='c2 + knee-normalised c4 together', primary=primary, decided=dec['verdict'], pooled_verdict=summ['verdict'], verdict=verdict,
                    edge_sets=[sid for sid in ('c2', 'c4kn', 'pooled') if sets[sid][1].get('edge')])
        summ['verdict_text'] = body_verdict_text(summ, dec, verdict)
        if retired:
            for r in rows: r.update(gate_iqr=None, gate_wide=None, side='', z=None, note='RETIRED as a gate key')
        keys_out[key] = dict(label=label, unit=unit, gate=summ['gate'], primary=primary, summary=summ, people=rows, photo_groups=qgroups(dd),
                             sets={sid: dict(label=lab, read=[sets[sid][1].get('read'), sets[sid][1].get('read_direction')], median_z=sets[sid][1].get('median_z'), in_p10_p90=sets[sid][1].get('n_in_p10_p90'),
                                             n_measured=sets[sid][1].get('n_measured'), photo_n=sets[sid][2].get((None, None), {}).get('n'), photo_groups=qgroups(sets[sid][2])) for sid, lab, _, _ in MB.SETS},
                             by_sex=dec['by_sex'])
        dists_out[key] = dict(label=label, unit=unit, mode='body', groups={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in dd.items()}, c2={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in sets['c2'][2].items()},
                              c4_knee_normalised={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in sets['c4kn'][2].items()}, c4_raw={f"{g[0] or 'all'}|{g[1] or 'all'}": q for g, q in sets['c4raw'][2].items()})
    c4 = [r for r in ph if r['shard'] == 'c4:new']; c2 = [r for r in ph if r['shard'].startswith('c2')]
    med = lambda rs, k: None if not [r[k] for r in rs if r.get(k) is not None] else round(float(np.median([r[k] for r in rs if r.get(k) is not None])), 3)
    kn_c4 = [dict(r, hip_h=None) for r in c4]
    meta = dict(photo_set='REFS figure studies (manifest shards c4:new, c2_*; modern, front, full, standing; derived_typical.json). The v6 gate used c4 alone with its statures as measured; 8 Oct: the c4 silhouettes lack the feet '
                          f"(bottom of the silhouette a median {med(c4, 'bottom_gap')} stature above the floor line, c2 {med(c2, 'bottom_gap')}; feet in the picture for {sum(r['feet_ok'] for r in c4)} of {len(c4)} c4 rows, {sum(r['feet_ok'] for r in c2)} of {len(c2)} c2), so the c4 statures are extrapolated and "
                          f"knee-normalised (rows with a guessed floor only, factor (1 - {MB.KNEE_REF}) / (1 - knee height)); c2 (floor measured) is left as it is. The gate is c2 + knee-normalised c4 TOGETHER: PASS / FAIL only when c2, c4 and the pooled set read the same, else UNDECIDED. shoulder_joints is RETIRED.",
                ours='the posed nude body mesh plus K3 underwear of each person (arms hanging), front silhouette at 1000 px per stature, measured by derive.measure() (gen_silhouette.py method)',
                diagnostics=dict(landmark_height_over_stature_median={'c4_raw': dict(knee=med(c4, 'knee_h'), hip=med(c4, 'hip_h'), shoulder=med(c4, 'shoulder_h')), 'c2': dict(knee=med(c2, 'knee_h'), hip=med(c2, 'hip_h'), shoulder=med(c2, 'shoulder_h')),
                                                                     'ours_skeleton_joints': 'knee 0.286-0.296, hip 0.536-0.557, shoulder 0.797-0.814 (CHECK.md H1)'},
                                 kn_factor_c4_median=med(c4, 'kn_factor'), feet_ok=dict(c4=sum(r['feet_ok'] for r in c4), c4_n=len(c4), c2=sum(r['feet_ok'] for r in c2), c2_n=len(c2)),
                                 chosen='knee-normalise (not drop): only %d of %d c4 rows have their feet in the picture' % (sum(r['feet_ok'] for r in c4), len(c4))))
    write_results('body', args.tag, keys_out, meta, dict(about='REFMEASURE body photo distributions (c2 + knee-normalised c4 pooled; c2, c4 knee-normalised and c4 raw beside)', keys=dists_out)); return keys_out


# ---------------------------------------------------------------- motion
LIFT_T, CARRY_T = 3.5, 4.2        # the lift6 clip: loaded frames before 3.5 s are the lift (reach, squat, rise), from 4.2 s the carry
PHASE_N_MIN = 15                  # a phase-matched photo set needs this many rows to gate; the library has 6 lifting and 13 carrying rows


def run_motion(args):
    ph = MM.photo_records()
    lc = ph['lift_carry']
    frames, fps = MM.frames_for(args.tag, args.ours, args.ours_given)
    stride = args.stride
    series = MM.lift_series(frames, fps, args.tag, stride=stride)
    names = ['L22_f27_black', 'L17_m28_hispanic']
    QS = (5, 10, 25, 50, 75, 90, 95)
    in_phase = {'lift': lambda x: x['t'] < LIFT_T, 'carry': lambda x: x['t'] >= CARRY_T}
    phases = {nm: {p: {k: C.quant([x[k] for x in series[i] if x['loaded'] and in_phase[p](x)], (5, 25, 50, 75, 95)) for k in ('elbow', 'hip', 'trunk')} for p in ('lift', 'carry')} for i, nm in enumerate(names)}
    rows_of = {'lift': [r for r in lc if 'lifting' in r['action']], 'carry': [r for r in lc if 'lifting' not in r['action']]}       # phase-matched photographs: lifting rows / the carrying (and walking-with-load) rows
    span = {k: C.quant([r[k] for r in lc if r.get(k) is not None], QS) for k in ('elbow', 'hip', 'trunk')}
    LAB = (('elbow', 'elbow flexion (deg, 3-D, mean of the two sides)'), ('hip', 'hip flexion (deg, 3-D)'), ('trunk', 'trunk lean from vertical (deg, 3-D)'))
    keys_out = {}
    # (1) the pooled span of v6 and before: lift and carry frames of a person against all 19 rows mixed. NOT A GATE (CHECK.md M5: our lift squat, hip 127-133 deg, passed against rows at 29-69)
    for key, label in LAB:
        q = span[key]; rows = []
        for k, nm in enumerate(names):
            P = C.person_info(nm); s = [x[key] for x in series[k] if x['loaded']]
            v = float(np.median(s)) if s else None
            inside = [x for x in s if q['p5'] <= x <= q['p95']] if q.get('n') else []
            rows.append(dict(name=nm, sex=P['sex'], bg=P['bg'], key=key, value=None if v is None else round(v, 1), frames=len(s), group='lifting+carrying rows, pooled (mixes the phases)', n_photos=q.get('n', 0),
                             p5=q.get('p5'), p10=q.get('p10'), p25=q.get('p25'), p50=q.get('p50'), p75=q.get('p75'), p90=q.get('p90'), p95=q.get('p95'),
                             frames_p5=None if not s else round(float(np.percentile(s, 5)), 1), frames_p95=None if not s else round(float(np.percentile(s, 95)), 1),
                             share_frames_inside=None if not s else round(len(inside) / len(s), 2), gate_iqr=None, gate_wide=None, side='', z=None, small_n=True,
                             note='NO GATE: the pooled span mixes the lift and the carry (the median over both phases sits in the span whatever the squat does); read the phase-matched keys'))
        keys_out[key] = dict(label=label + ' - pooled over both phases, NO GATE', unit='deg', gate='none (pooled span of 19 rows mixes the phases)', primary=False, people=rows, photo_groups={'all|all': q},
                             summary=dict(key=key, label=label, n=len(rows), n_measured=0, n_failed=0, n_no_gate=len(rows), median=None, median_value=None if not [r['value'] for r in rows if r['value'] is not None] else round(float(np.median([r['value'] for r in rows if r['value'] is not None])), 1), verdict='NO GATE', verdict_text='NO GATE (pooled over the phases)', median_z=None, n_in_iqr=None, n_in_p10_p90=None,
                                          gate='none', primary=False, unit='deg', median_ours=[r['value'] for r in rows]))
    # (2) phase-matched: the lift frames against the lifting rows, the carry frames against the carrying rows. A set under PHASE_N_MIN rows cannot gate.
    for p in ('lift', 'carry'):
        R = rows_of[p]
        for key, label in LAB:
            q = C.quant([r[key] for r in R if r.get(key) is not None], QS); vmin = min([r[key] for r in R], default=None); vmax = max([r[key] for r in R], default=None); gated = q.get('n', 0) >= PHASE_N_MIN
            rows = []
            for k, nm in enumerate(names):
                P = C.person_info(nm); s = [x[key] for x in series[k] if x['loaded'] and in_phase[p](x)]
                v = float(np.median(s)) if s else None; f5 = None if not s else round(float(np.percentile(s, 5)), 1); f95 = None if not s else round(float(np.percentile(s, 95)), 1)
                where = '' if v is None or vmin is None else (f'ABOVE all {q["n"]} {p} rows (max {vmax:.0f})' if f95 > vmax + 5 else f'below all {q["n"]} {p} rows (min {vmin:.0f})' if f5 < vmin - 5 else f'inside the range of the {q["n"]} {p} rows')
                note = '' if v is None else (f'frames p5-p95 {f5:.0f}-{f95:.0f} deg against the {q["n"]} {p} rows {vmin:.0f}-{vmax:.0f}: {where}' + ('' if gated else f'; NO GATE: only {q["n"]} {p} photographs (< {PHASE_N_MIN})'))
                rows.append(dict(name=nm, sex=P['sex'], bg=P['bg'], key=f'{key}_{p}', value=None if v is None else round(v, 1), frames=len(s), group=f'{p} rows (phase-matched, all views)', n_photos=q.get('n', 0),
                                 p5=q.get('p5'), p10=q.get('p10'), p25=q.get('p25'), p50=q.get('p50'), p75=q.get('p75'), p90=q.get('p90'), p95=q.get('p95'), photo_min=vmin, photo_max=vmax, frames_p5=f5, frames_p95=f95,
                                 gate_iqr=None, gate_wide=(('PASS' if (q['p5'] <= v <= q['p95']) else 'FAIL') if (gated and v is not None) else None), side='', z=None, small_n=not gated, no_gate=not gated, note=note, where=where))
            ok = [r for r in rows if r['gate_wide']]
            verdict = 'NO GATE' if not gated else ('NO DATA' if not ok else ('PASS' if all(r['gate_wide'] == 'PASS' for r in ok) else 'FAIL'))
            keys_out[f'{key}_{p}'] = dict(label=f'{label} - {p} phase against the {q.get("n", 0)} {p} rows', unit='deg', gate=f'span p5-p95 of the {p} rows, n >= {PHASE_N_MIN} or NO GATE', primary=True, people=rows, photo_groups={'all|all': q},
                                          summary=dict(key=f'{key}_{p}', label=label, n=len(rows), n_measured=len(ok), n_failed=sum(r['value'] is None for r in rows), n_no_gate=0 if gated else len(rows), n_in_p10_p90=sum(r['gate_wide'] == 'PASS' for r in ok),
                                                       median=None, median_value=[r['value'] for r in rows], verdict=verdict, verdict_text=verdict if gated else f'NO GATE (n={q.get("n", 0)} {p} rows): ours (frames p5-p95) ' + ' and '.join(f"{r['frames_p5']:.0f}-{r['frames_p95']:.0f}" for r in rows if r['frames_p5'] is not None) + f' deg against the {p} rows {vmin:.0f}-{vmax:.0f}: ' + (rows[0].get('where', '') if rows else ''),
                                                       median_z=None, n_in_iqr=None, gate='span', primary=True, unit='deg', photo_n=q.get('n', 0)))
    # (3) hanging arms: the share of standing figures whose arms hang. The photo share's own sampling error (n 35) is added to our 12 draws' (CHECK.md M5: x1.16)
    n = tag_n(args.tag)
    rowp = C.find_plates(args.ours, f'row{n}_dressed_studio5_full.png').get(f'row{n}_dressed_studio5_full')
    arms = MM.dressed_arms(rowp) if rowp else []
    st = ph['standing']; pm = [x for x in st if x['modern']]
    share_p = float(np.mean([x['hang'] for x in pm])) if pm else None
    meas = [a for a in arms if a]; share_o = float(np.mean([a['hang'] for a in meas])) if meas else None
    band = 1.645 * float(np.sqrt(share_p * (1 - share_p) * (1.0 / max(1, len(meas)) + 1.0 / max(1, len(pm))))) if share_p is not None else None
    verdict = 'NO DATA' if share_o is None or share_p is None else ('PASS' if abs(share_o - share_p) <= band else 'FAIL')
    rows = [dict(name=P['name'], sex=P['sex'], bg=P['bg'], key='arms_hang', value=None if not a else int(a['hang']), group='clothed standing front photos (modern)', n_photos=len(pm), gate_iqr=None, gate_wide=None, side='', z=None, small_n=True,
                 l_elev=None if not a else a['l_elev'], r_elev=None if not a else a['r_elev'], note='') for P, a in zip(people_list(), arms + [None] * (12 - len(arms)))]
    keys_out['arms_hang'] = dict(label='share of standing figures with both arms hanging (shoulder elevation < 25 deg, image plane)', unit='share', gate='our share within the photos\' share +- the 90 % band of 12 draws and 35 photographs', primary=True, people=rows,
                                 photo_groups={'all|all': dict(n=len(pm), share=None if share_p is None else round(share_p, 3), share_all_eras=round(float(np.mean([x['hang'] for x in st])), 3) if st else None, n_all_eras=len(st))},
                                 summary=dict(key='arms_hang', label='share of standing figures with hanging arms', n=len(rows), n_measured=len(meas), median=None if share_o is None else round(share_o, 3), photo_share=None if share_p is None else round(share_p, 3), band=None if band is None else round(band, 3),
                                              verdict=verdict, verdict_text=verdict + ' (weak: 12 draws against 35 photographs)', median_z=None, n_in_iqr=None, n_in_p10_p90=None, gate='share', primary=True, unit='share'))
    meta = dict(photo_set=f"REFS lifting / carrying rows with a pose (n={len(lc)}, {sum(1 for r in lc if r['modern'])} modern; derived_typical.json, 3-D MediaPipe angles): {len(rows_of['lift'])} lifting rows and {len(rows_of['carry'])} carrying / walking-with-load rows; "
                          f"standing clothed front rows for the hanging-arms share (n={len(st)}, {len(pm)} modern). 8 Oct: the lift and the carry are read against their own rows and neither set reaches {PHASE_N_MIN}, so MOTION has NO GATE for elbow, hip and trunk; only the hanging-arms share gates (weak)",
                ours=f'lift6 ({args.tag}): {len(frames)} frames at {fps} fps, stride {stride}; the woman L22 and the man L17; loaded frames = from the first wrist-to-box contact (<0.3 stature) on; lift = loaded frames before {LIFT_T} s, carry = from {CARRY_T} s',
                phases=phases, phase_rows={p: dict(n=len(R), views=sorted({r['view'] for r in R}), actions=sorted({r['action'] for r in R})) for p, R in rows_of.items()}, frames={nm: [dict(f) for f in series[k]] for k, nm in enumerate(names)})
    write_results('motion', args.tag, keys_out, meta, dict(about='REFMEASURE motion photo reference', keys={**{k: dict(label=k, unit='deg', mode='motion', groups={'all|all': span[k]}) for k in span},
                                                                                                      **{f'{k}_{p}': dict(label=f'{k} {p}', unit='deg', mode='motion', groups={'all|all': C.quant([r[k] for r in R if r.get(k) is not None], QS)}) for p, R in rows_of.items() for k in span}}))
    return keys_out


RUN = dict(face=run_face, skin=run_skin, clothing=run_clothing, motion=run_motion, hair=run_hair, body=run_body)


# ---------------------------------------------------------------- the table
def table(args):
    """results_table.{csv,json,md}: one column group per tag (default v5 and v6; --tags v6,v7 for a before | after of a round-7 lane: then results_table_v6_v7.*); primary keys in the .md"""
    tags = [t for t in (args.tags or 'v5,v6').split(',') if t]
    stem = 'results_table' if tags == ['v5', 'v6'] else 'results_table_' + '_'.join(tags)
    rows = []; md = ['| measure | key | ' + ' | '.join(f'{t} median' for t in tags) + ' | photos p25-p75 (p50) | ' + ' | '.join(f'{t} in IQR / p10-p90' for t in tags) + ' | ' + ' | '.join(tags) + ' |', '|---|---|' + '---|' * (1 + 3 * len(tags))]
    for m in MEASURES:
        R = {}
        for tag in tags:
            p = os.path.join(C.OUT, f'results_{m}_{tag}.json')
            if os.path.exists(p): R[tag] = json.load(open(p))
        if not R: continue
        first = next(t for t in reversed(tags) if t in R)
        keys = list(R[first]['keys'].keys())
        for k in keys:
            g = {t: R[t]['keys'].get(k) for t in R}
            ref = next((x for x in g.values() if x), None)
            if not ref: continue
            pg = ref['photo_groups']; allq = pg.get('all|all') or next(iter(pg.values()), {})
            S = {t: (g.get(t) or {}).get('summary', {}) for t in tags}
            def inn(s):
                if not s: return ''
                if s.get('n_in_iqr') is not None: return f"{s.get('n_in_iqr')} IQR, {s.get('n_in_p10_p90')} p10-90 of {s.get('n_measured')}"
                if s.get('n_in_p10_p90') is not None: return f"{s.get('n_in_p10_p90')} of {s.get('n_measured')} in p5-p95"
                return ''
            row = dict(measure=m, key=k, label=ref['label'], unit=ref['unit'], gate=ref['gate'])
            for t in tags: row[f'{t}_median'] = S[t].get('median') if S[t].get('median') is not None else S[t].get('median_value')
            for t in tags: row[f'{t}_median_z'] = S[t].get('median_z')
            row.update(photo_p25=allq.get('p25', allq.get('share')), photo_p50=allq.get('p50', allq.get('share')), photo_p75=allq.get('p75', allq.get('share')), photo_n=allq.get('n'))
            for t in tags: row.update({f'{t}_in_iqr': S[t].get('n_in_iqr'), f'{t}_in_p10_p90': S[t].get('n_in_p10_p90'), f'{t}_n': S[t].get('n_measured')})
            for t in tags: row[f'{t}_verdict'] = S[t].get('verdict', ''); row[f'{t}_verdict_text'] = S[t].get('verdict_text') or S[t].get('verdict', '')
            row['primary'] = ref.get('primary')
            rows.append(row)
            if ref.get('primary'):
                fmt = lambda x: ' / '.join(map(str, x)) if isinstance(x, list) else str(x)
                md.append(f"| {m} | {k} | " + ' | '.join(fmt(row[f'{t}_median']) for t in tags) + f" | {row['photo_p25']}-{row['photo_p75']} ({row['photo_p50']}), n={row['photo_n']} | " +
                          ' | '.join(inn(S[t]) for t in tags) + ' | ' + ' | '.join(row[f'{t}_verdict_text'] for t in tags) + ' |')
    C.write_csv(os.path.join(C.OUT, stem + '.csv'), rows); C.write_json(os.path.join(C.OUT, stem + '.json'), rows)
    open(os.path.join(C.OUT, stem + '.md'), 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md))


def localboard(args, which):
    import localboards as LB
    M = {r['id']: r for r in C.load_manifest()}
    P = people_list(); tag = args.tag
    def group_items(items, g, by_bg_only=False):
        out = [it for it in items if (g[0] is None or it['sex'] == g[0]) and (g[1] is None or it['bg'] == g[1])]
        for it in out: it['_row'] = M[it['id']]
        return out
    if which in ('face', 'skin', 'hair'):
        people = ours_facepass(args); fp = our_face_plates(args.ours, tag, args.stage); lab = load_hair_labels()
        mode, key = dict(face=('geo', 'midface_h_w'), skin=('skin', 'cheek_a'), hair=('hair', 'hair_face_Y'))[which]
        items = face_photo_items(mode, lab if which == 'hair' else None)
        dists = C.group_dists([r for r in items if r.get(key) is not None], key)
        tiles = []
        for p in people:
            if p['name'] not in fp: continue
            kind, path = fp[p['name']]
            t = Image.fromarray(FP.load_rgb(path)).convert('RGB'); w, h = t.size; t = t.crop((int(w * 0.1), int(h * 0.05), int(w * 0.9), int(h * 0.85)))
            m = p['m']; f = flat_m(m) if 'error' not in m else {}
            if which == 'hair': g = (None, OUR_HAIR[p['name']])
            elif which == 'skin': g = next(((None, p['bg']) for _ in [0] if dists.get((None, p['bg']), {}).get('n', 0) >= 15), (None, None))
            else: g = C.pick_dist(dists, p['sex'], p['bg'], 15)[0]
            tiles.append((p['name'].split('_')[0] + ' ' + p['sex'].upper() + str(p['age']) + ' ' + p['bg'], t, f.get(key), g))
        LB.make_board(f'REFMEASURE {which} {tag}: {key}', tiles, None, key, lambda g: group_items(items, g), f'board_{which}_{tag}.jpg', 'face')
    elif which == 'clothing':
        n = tag_n(tag); rowp = C.find_plates(args.ours, f'row{n}_dressed_studio5_full.png').get(f'row{n}_dressed_studio5_full')
        rgb = np.asarray(Image.open(rowp).convert('RGB'))[:1000]; key = 'ankle_w'
        ph = [dict(id=i['id'], sex=i['sex'], bg='all', **i['m']) for i in MC.photo_records() if 'error' not in i['m'] and i['m'].get(key) and i['modern'] and not i['skirted']]
        ours = {r['name']: r for r in json.load(open(os.path.join(C.OUT, f'ours_cloth_{tag}.json')))}
        tiles = []
        for k, p in enumerate(P):
            crop, x0 = PP.crop_cell(rgb, k, 12); tiles.append((p['name'].split('_')[0] + ' ' + p['sex'].upper() + str(p['age']), Image.fromarray(crop), ours[p['name']].get(key), (p['sex'], None)))
        def items_for(g):
            out = [it for it in ph if it['sex'] == g[0]] if len([it for it in ph if it['sex'] == g[0]]) >= 8 else list(ph)
            for it in out: it['_row'] = M[it['id']]
            return out
        LB.make_board(f'REFMEASURE clothing {tag}: {key} (leg width at the ankle / stature)', tiles, None, key, items_for, f'board_clothing_{tag}.jpg', 'full')
    elif which == 'body':
        key = 'hip'; ph = [dict(i) for i in MB.photo_records() if i.get(key)]
        ours = {r['name']: r for r in json.load(open(os.path.join(C.OUT, f'ours_body_{tag}.json')))}; tiles = []
        for p in P:
            meta, Pv, T = MB.load_body(args.bodies, f"{tag}_{p['name']}"); img, fr = MB.silhouette(Pv, T)
            t = Image.fromarray(img * 255).convert('RGB'); tiles.append((p['name'].split('_')[0] + ' ' + p['sex'].upper() + str(p['age']), t, ours[p['name']].get(key), (p['sex'], None)))
        def items_for(g):
            out = [it for it in ph if it['sex'] == g[0]]
            for it in out: it['_row'] = M[it['id']]
            return out
        LB.make_board(f'REFMEASURE body {tag}: {key} (hip width / stature) against REFS c4 figure studies', tiles, None, key, items_for, f'board_body_{tag}.jpg', 'full')


def selftest(args):
    """the face pass against FACE2's ref_measure.py (committed after/face2/ref_measures.json) on the photos both measured: the shared keys must agree"""
    ref = {i['id']: i['m'] for i in json.load(open(os.path.join(C.C8, 'after', 'face2', 'ref_measures.json')))['items'] if 'm' in i and 'error' not in i['m']}
    mine = {i['id']: (i['m'].get('single') or i['m']) for i in MF.photo_records() if 'error' not in i['m']}      # the single-pass values (the cached m is plate + mirror since 8 Oct)
    common = [k for k in mine if k in ref]; ok = True
    for k in ('face_w', 'lower_verm', 'upper_verm', 'mouth_w', 'len_w'):
        pairs = [(mine[i][k], ref[i][k]) for i in common if mine[i].get(k) is not None and ref[i].get(k) is not None]
        x, y = np.array(pairs).T; r = float(np.corrcoef(x, y)[0, 1]); d = float(np.max(np.abs(x - y))); good = r > 0.99 and d < 0.02; ok &= good
        print(f'  {k:11s} n={len(pairs)} corr {r:.4f} max |diff| {d:.4f} {"ok" if good else "FAIL"}')
    print('selftest', 'ok' if ok else 'FAILED'); return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('measure', choices=MEASURES + ['all', 'table', 'photos', 'board', 'localboard', 'selftest'])
    ap.add_argument('which', nargs='?', default=None)
    ap.add_argument('--ours', nargs='+', default=None); ap.add_argument('--tag', default='v6', type=tag_type)
    ap.add_argument('--tags', default=None, help='table only: comma list of tags, default v5,v6'); ap.add_argument('--photos', default='c3'); ap.add_argument('--stage', default='studio5'); ap.add_argument('--force', action='store_true')
    ap.add_argument('--bodies', default=os.path.join(C.SCRATCH, 'bodies')); ap.add_argument('--stride', type=int, default=1)
    ap.add_argument('--persp-ref', type=float, default=FP.PERSP_REF_M, help='face / skin / hair: re-project the landmark proportions of OUR plates to a camera this many metres from the face (default 2.0; 0 = off)')
    ap.add_argument('--allow-jpeg', action='store_true', help='face / skin / hair: measure JPEG plates too (diagnostic only; refused by default, cheek_hf never on one)')
    args = ap.parse_args()
    args.ours_given = args.ours is not None
    if args.ours_given and args.tag in ('v5', 'v6') and args.measure in MEASURES + ['all', 'board']:
        print(f'WARNING: --tag {args.tag} is the committed baseline (results_*_{args.tag}.*, board_refmeasure_{args.tag}.jpg): a candidate run should take its own tag, e.g. --tag v7a', file=sys.stderr)
    args.ours = [os.path.abspath(d) for d in (args.ours or C.default_ours_dirs())]
    if args.measure in MEASURES + ['all', 'table']:
        print(__doc__.split('\n')[1] + '\n' + __doc__.split('\n')[2] + '\n' + __doc__.split('\n')[3]); return 0
    if args.measure == 'photos':
        MF.photo_records(args.force); MC.photo_records(args.force); MB.photo_records(args.force); MM.photo_records(args.force); return
    if args.measure == 'selftest': return selftest(args)
    if args.measure == 'localboard': return localboard(args, args.which)
    if args.measure == 'board':
        import board; return board.make(args)
    for m in (MEASURES if args.measure == 'all' else [args.measure]):
        ko = RUN[m](args)
        print(f'== {m} {args.tag}')
        for k, v in ko.items():
            s = v['summary']
            print(f"  {k:16s} median {s.get('median') if s.get('median') is not None else s.get('median_value')}  in IQR {s.get('n_in_iqr')} / p10-p90 {s.get('n_in_p10_p90')} of {s.get('n_measured')}  median z {s.get('median_z')}  {s.get('verdict_text') or s.get('verdict')}")


if __name__ == '__main__':
    main()
