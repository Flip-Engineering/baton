"""RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread. What remains here serves the boards (crops, annotations).

REFMEASURE measure 3 (CLOTHING leg line): the silhouette width of each leg at the knee, at the ankle and just above it (the hem zone),
over the stature, on the clothed standing front rows of the photo library and on our dressed front rows, the same pass (posepass.py)."""
import json, os, re, sys
import numpy as np
import cv2
from PIL import Image, ImageOps
import rm_common as C
import posepass as PP
import derive

PHOTO_JSON = os.path.join(C.OUT, 'photo_cloth.json')
HEIGHTS = [round(0.02 * k, 2) for k in range(1, 24)]            # 0.02 .. 0.46 of stature above the floor
ANKLE_BAND = (0.05, 0.11)                                        # the ankle: the narrowest width of the lower leg in this band (clothing included)
HEM_H = 0.12                                                     # the hem zone: where a full-length trouser hem and the shin meet
BARE = ('nude', 'semi-nude', 'swim', 'leotard', 'underwear', 'bikini', 'briefs', 'detail', 'drape', 'shirtless')
SKIRTED = ('dress', 'sari', 'skirt', 'gown', 'robe', 'kilt')
STAND = ('standing', 'standing_attention', 'standing_relaxed', 'standing_contrapposto', 'contrapposto')


def clothed_rows():
    rows = []
    for r in C.typical(modern=False):
        if r['view'] not in ('front', 'back') or r['crop'] != 'full' or r['pose'] not in STAND: continue
        cl = (r['clothing'] or '').lower()
        if any(cl.startswith(b) or b in cl for b in BARE): continue
        p = C.photo_path(r)
        if p and os.path.isfile(p): rows.append(r)
    return rows


def features(res, m, det, floor_unit=None):
    L = det['L']; unit = res['_unit'] if '_unit' in res else None
    return None


def analyse(rgb, rec):
    """-> dict or None. Uses derive's own floor and unit (stature, standing full figures)."""
    out = PP.run(rgb, rec)
    if out is None: return None
    res, m, det = out
    if res['unit'] != 'stature': return {'error': 'not a full standing figure', 'unit': res['unit']}
    # derive.measure() keeps _floor and _unit in its result before the caller strips them (derive.main does)
    floor, unit = res['_floor'], res['_unit']
    L = det['L']; g = lambda n: L[derive.I[n], :2]
    kh = float(np.mean([(floor - g(f'{s}_knee')[1]) / unit for s in 'lr'])); ah = float(np.mean([(floor - g(f'{s}_ankle')[1]) / unit for s in 'lr']))
    hs = sorted(set(HEIGHTS + [round(kh, 3)]))
    W = PP.leg_widths(m, L, floor, unit, hs)
    mean = lambda h: (None if W[h][0] is None or W[h][1] is None else 0.5 * (W[h][0] + W[h][1]))
    band = [mean(h) for h in HEIGHTS if ANKLE_BAND[0] <= h <= ANKLE_BAND[1] and mean(h) is not None]
    ankle_w = min(band) if band else None
    o = dict(knee_h=round(kh, 3), ankle_lm_h=round(ah, 3), stature_px=res['stature_px'], heads=res['heads'],
             knee_w=mean(round(kh, 3)), ankle_w=ankle_w, hem_w=mean(HEM_H),
             profile={str(h): (None if mean(h) is None else round(mean(h), 4)) for h in HEIGHTS},
             arms_hang=PP.arms_hang(res), mask_cover=res['mask_cover'])
    o['hem_ankle'] = (o['hem_w'] / o['ankle_w']) if (o['hem_w'] and o['ankle_w']) else None
    o['knee_ankle'] = (o['knee_w'] / o['ankle_w']) if (o['knee_w'] and o['ankle_w']) else None
    for k in ('knee_w', 'ankle_w', 'hem_w', 'hem_ankle', 'knee_ankle'):
        if o[k] is not None: o[k] = round(float(o[k]), 4)
    return o


def legwear_labels():
    p = os.path.join(C.OUT, 'cloth_legwear_labels.csv')
    import csv
    return {r['id']: r['legwear'] for r in csv.DictReader(open(p))} if os.path.exists(p) else {}


def photo_records(force=False):
    if os.path.exists(PHOTO_JSON) and not force:
        its = json.load(open(PHOTO_JSON))['items']; lw = legwear_labels()
        for it in its: it['legwear'] = lw.get(it['id'], it.get('legwear', 'unlabelled'))
        return its
    items = []
    for r in clothed_rows():
        try:
            im = ImageOps.exif_transpose(Image.open(C.photo_path(r))).convert('RGB'); s = 1600 / max(im.size)
            if s < 1: im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
            o = analyse(np.asarray(im), dict(id=r['id'], view=r['view'], pose='standing', crop='full'))
        except Exception as e:
            o = {'error': str(e)[:80]}
        items.append(dict(id=r['id'], sex=r['sex'], bg=r['background_group'], age_band=r['age_band'], clothing=r['clothing'], modern=C.is_modern(r),
                          skirted=any(k in (r['clothing'] or '').lower() for k in SKIRTED), source=r['source'], m=o or {'error': 'no pose'}))
    lw = legwear_labels()
    for it in items: it['legwear'] = lw.get(it['id'], 'unlabelled')
    C.write_json(PHOTO_JSON, dict(about='REFMEASURE leg line on the manifest\'s clothed standing front full rows (typical, kept): numbers only, keyed by manifest id', n=len(items), items=items))
    return items


def work_trouser_census():
    """How many WORKING-genre trouser photographs the library really has, by sex (the count behind the CLOTHING 'NO GATE', 8 Oct 2026). A trouser reference needs n >= 15 per sex of
    front / back, full-length (feet in the picture, so a pose and a floor), standing figures in trousers from the genre our cast wears (the LoC FSA / OWI work-clothes rows, 1935-45,
    and the c2_f2 work rows). Counts come from the manifest and the measured photo_cloth.json, nothing is opened."""
    rows = C.load_manifest(); its = photo_records(); lw = legwear_labels()
    isloc = lambda r: (r.get('source') or '').startswith('loc')
    both = lambda f: {'f': sum(1 for r in f if r['sex'] == 'f'), 'm': sum(1 for r in f if r['sex'] == 'm')}
    loc_rows = [r for r in rows if isloc(r) and r['status'] != 'rejected' and r['use'] != 'drop']
    stand = lambda r: r['pose'] in STAND and r['crop'] in ('full', 'full_props')
    fb = [r for r in loc_rows if stand(r) and r['view'] in ('front', 'back')]
    other = [r for r in loc_rows if stand(r) and r['view'] not in ('front', 'back')]
    M = {r['id']: r for r in rows}
    meas = [i for i in its if 'error' not in i['m'] and i['m'].get('knee_w') and i['m'].get('ankle_w') and lw.get(i['id']) == 'trousers']
    work = [i for i in meas if isloc(M[i['id']])]; modern = [i for i in meas if i['modern']]
    cut = [i for i in its if isloc(M[i['id']]) and 'error' in i['m']]
    c = dict(rule='n >= 15 front / back full-length standing trouser photographs per sex, working genre', need_per_sex=15,
             loc_rows_all=both(loc_rows), loc_standing_full_front_back=both(fb), loc_standing_full_other_views_not_usable_for_a_front_leg_width=both(other),
             loc_front_back_rows_the_pose_pass_could_not_use_feet_cut_off=both([M[i['id']] for i in cut]),
             work_trousers_measured=both([M[i['id']] for i in work]), modern_trousers_measured=both([M[i['id']] for i in modern]),
             work_trouser_ids=[i['id'] for i in work])
    c['loc_standing_full_any_view'] = both([r for r in loc_rows if stand(r)])
    c['trousers_any_genre_any_era'] = {'m': c['work_trousers_measured']['m'] + c['modern_trousers_measured']['m'], 'f': c['work_trousers_measured']['f'] + c['modern_trousers_measured']['f']}
    c['found'] = (f"working trousers (LoC / c2_f2 work rows, front or back, feet in the picture, a pose): {c['work_trousers_measured']['m']} men, {c['work_trousers_measured']['f']} women (need 15 each); modern trousers (c3 / c2_f2 everyday): "
                  f"{c['modern_trousers_measured']['m']} men, {c['modern_trousers_measured']['f']} women; trousers of any genre and era: {c['trousers_any_genre_any_era']['m']} men, {c['trousers_any_genre_any_era']['f']} women. The women cannot reach 15 under any relaxation: the library has "
                  f"{c['loc_standing_full_any_view']['f']} standing full-figure LoC women rows in ANY view (men {c['loc_standing_full_any_view']['m']}, of which {c['loc_front_back_rows_the_pose_pass_could_not_use_feet_cut_off']['m']} front / back rows are cut off above the feet)")
    c['can_build'] = bool(c['work_trousers_measured']['m'] >= 15 and c['work_trousers_measured']['f'] >= 15)
    return c


if __name__ == '__main__':
    its = photo_records(force='--force' in sys.argv)
    ok = [i for i in its if 'error' not in i['m']]
    print(len(its), 'rows;', len(ok), 'measured;', sum(1 for i in ok if i['m'].get('knee_w') and i['m'].get('ankle_w')), 'with knee and ankle', 'modern', sum(1 for i in ok if i['modern']))
