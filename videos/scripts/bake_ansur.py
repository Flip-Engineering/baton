#!/usr/bin/env python3
"""RIG c1: bake real bodies from ANSUR II (US Army Anthropometric Survey 2012; 4,082 men, 1,986 women; a US Government work, public).
Usage: python3 scripts/bake_ansur.py MALE.csv FEMALE.csv  -> web/assets/rig/ansur_subjects.json
Rows are REAL SUBJECTS (a sub-sample: every 4th man, every 2nd woman), not a fitted distribution: sampling one row gives a body whose
measurements are correlated the way a real person's are (a short broad man, a tall lanky one), which independent sliders cannot do.
Fields (mm, except kg and years): the columns below in order; sex 0 = man, 1 = woman."""
import csv, json, sys
COLS = ['stature','sittingheight','acromialheight','trochanterionheight','crotchheight','kneeheightmidpatella','biacromialbreadth','bicristalbreadth','hipbreadth',
        'chestbreadth','chestdepth','waistbreadth','waistdepth','waistcircumference','chestcircumference','neckcircumference','shoulderelbowlength','forearmhandlength',
        'handlength','handbreadth','footlength','weightkg','Age']
def rows(path, step):
    r = list(csv.DictReader(open(path, encoding='latin-1')))[::step]
    out = []
    for x in r:
        try: v = [float(x[c]) for c in COLS]
        except Exception: continue
        v[COLS.index('weightkg')] /= 10.0
        out.append([round(a, 1) for a in v])
    return out
m, f = rows(sys.argv[1], 4), rows(sys.argv[2], 2)
json.dump({'source': 'ANSUR II (2012), public release; every 4th man, every 2nd woman', 'cols': COLS, 'units': 'mm; weightkg in kg; Age in years', 'men': m, 'women': f}, open('web/assets/rig/ansur_subjects.json', 'w'), separators=(',', ':'))
print(len(m), 'men', len(f), 'women')
