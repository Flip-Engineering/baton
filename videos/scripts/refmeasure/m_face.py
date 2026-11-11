"""RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread. What remains here serves the boards (crops, annotations).

REFMEASURE measures 1 (FACE), 2 (SKIN) and 5 (HAIR beside the face): the photo side (c3's portraits through facepass.py, cached as numbers keyed by
manifest id) and our side (our face plates through the same pass), and the comparison tables."""
import json, os, re, sys
import numpy as np
import rm_common as C
import facepass as FP

PHOTO_JSON = os.path.join(C.OUT, 'photo_facepass.json')


def photo_records(force=False):
    if os.path.exists(PHOTO_JSON) and not force:
        return json.load(open(PHOTO_JSON))['items']
    items = []
    rows = C.portraits()
    for i, r in enumerate(rows):
        try:
            m, fr = FP.analyse_mirror(FP.load_rgb(C.photo_path(r)))       # 8 Oct: plate + mirror; skin patches judged and rejected (facepass.judge_patch)
        except Exception as e:
            m = {'error': str(e)[:80]}
        it = dict(id=r['id'], sex=r['sex'], bg=r['background_group'], age_band=r['age_band'], light=r['light'], view=r['view'], m=m)
        items.append(it)
        if i % 40 == 0: print('photos', i, len(rows), file=sys.stderr, flush=True)
    C.write_json(PHOTO_JSON, dict(about='REFMEASURE facepass over the manifest portraits (typical, kept, modern, head_neck in frame): numbers only, keyed by manifest id; '
                                        'facepass.py defines every key (IPD units from the pupil midpoint). 8 Oct revision: landmark keys are the mean of the photograph and its mirror '
                                        '(m.single holds the single-pass values), skin patches carry spread / hair_frac / cmf / ok / reasons per cheek and the forehead, '
                                        'cheek_hf is measured only on faces with >= 200 px between the pupils on clean cheeks; no perspective correction (the camera distance of a photograph is unknown)',
                      n=len(items), items=items))
    return items


def usable(it, need=()):
    m = it['m']
    if 'error' in m or abs(m.get('yaw', 1)) >= FP.YAW_MAX: return False
    return all(m.get(k) is not None for k in need)


def flat(it):
    """one row of plain numbers for a face-pass item (skin and hair expanded)"""
    m = it['m']; o = dict(id=it['id'], sex=it['sex'], bg=it['bg'], age_band=it.get('age_band'))
    for k, v in m.items():
        if isinstance(v, dict):
            for kk, vv in v.items(): o[f'{k}_{kk}'] = vv
        else: o[k] = v
    return o


if __name__ == '__main__':
    its = photo_records(force='--force' in sys.argv)
    ok = [it for it in its if 'error' not in it['m']]
    fr = [it for it in ok if usable(it)]
    print(len(its), 'items;', len(ok), 'detected;', len(fr), 'frontal')
