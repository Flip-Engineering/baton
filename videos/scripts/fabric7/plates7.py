#!/usr/bin/env python3
"""FABRIC7 plate lists for farm_bench.py (--plates). OUR renders of CAST's lineup people (women half): no reference photographs. EVERY plate is the CURRENT person (the one person system; bare names); a before | after
   pair differs in ONE thing, the change under measurement, and both sides are in the same bench (same pin, same lights): the person's own fabric is ON (v7lanes/FABRIC7.json: the strain-driven wrinkle cascade, the creases
   as geometry, the engine's fuzz shells) and an A/B arm turns one off through the lab's query (fold=0, cascade=0, fuzz=0 -> popts.fabric7: fabric7_lab.js).
   python3 videos/scripts/fabric7/plates7.py <set> > plates.json
   python3 videos/scripts/farm_bench.py fabric7_<x> --by FABRIC7 --plates plates.json --include-deps --yes --no-wait
Every plate loads labs/clothing2/fabric7_lab.html: a thin entry that turns the fabric on at the render tier's K (film 16 for a person) and then loads the integrator's own lab_person.js (every mode, view and stage unchanged).
Sets:
   c6i3  (c6 it3, 15 Oct: the worn lines as set creases (relief + cover), no zones on bones; 16 plates, one pin: on = latest | arm = latest with ONE thing off (setrelief=0 / motion=0 / contact=0); tags c12<view>_<arm>_<person>).
   c6i2  (c6 it2, 15 Oct: the fold's touching layers (the slit) and the wear from the body's motion; 15 plates, one pin: on = latest | arm = latest with ONE thing off (contact=0 / motion=0); hip, knee and back-of-knee
         close-ups at 1:1 (look=hip|knee, lookyaw), the busts of the slit's person, solos, the row at 270 px; tags c11<view>_<arm>_<person>).
   c6i1  (19 plates, one pin: on = latest | nofold = latest with fold 0; the row at 270 px, four busts at 1:1, solos incl. the back of the legs, one fuzz arm (L21), the feet; tags c10<view>_<arm>_<person>).
   book  (2 plates: the fabric book's swatches, a band 7 % too short, single-scale wrinkles | the cascade, per fabric, at 1:1 / 2:1 and 4:1 / 6:1; tags bookl_ / bookh_)."""
import json, sys, urllib.parse
LP, LF = 'labs/human8/lab_person.html', 'labs/clothing2/fabric7_lab.html'
SET = sys.argv[1] if len(sys.argv) > 1 else 'c6i1'
P = []
def add(tag, q, ready=3000, lab=LF): P.append({'tag': tag, 'lab': lab, 'query': q, 't': 0, 'ready_s': ready})
if SET == 'c6i1':
    # c6 it1 (15 Oct): the person's own fabric is ON (v7lanes/FABRIC7.json: the cascade, the creases as geometry, the engine's fuzz shells). 'on' = latest as it is; 'nofold' = latest with ONE thing changed (popts.fabric7.fold 0: the
    # same garments without the creases as geometry); 'nofuzz' (L21 only) = latest without the shells. Bare person names; tags c10<view>_<arm>_<person>. The back of the legs (solo view 3) is where it4's ribs would show.
    ROWB = urllib.parse.quote(';'.join(('L08_f24_hispanic', 'L21_m32_black', 'L22_f27_black', 'L11_m23_white', 'L20_f29_asian', 'L17_m28_hispanic', 'L12_f39_white', 'L03_m38_asian',
                                         'L14_f42_black', 'L23_m45_white', 'L06_f53_white', 'L05_m59_black')), safe='')
    ARMS = (('on', ''), ('nofold', '&fold=0'))
    for k, extra in ARMS:
        add(f'c10row_{k}_studio5_270', f'mode=row&who={ROWB}&reg=dressed&stage=studio@5&gap=0.75&views=0,1,3&vstack=1&w=1560&h=1080{extra}')
    for nm in ('L08_f24_hispanic', 'L21_m32_black', 'L22_f27_black', 'L23_m45_white'):
        for k, extra in ARMS:
            add(f'c10bust_{k}_{nm.split("_")[0]}', f'mode=bust&who={nm}&reg=dressed&stage=studio@5&w=1080&h=1350{extra}')
    add('c10bust_nofuzz_L21', 'mode=bust&who=L21_m32_black&reg=dressed&stage=studio@5&w=1080&h=1350&fuzz=0')
    for nm, views in (('L08_f24_hispanic', (0, 3)), ('L23_m45_white', (0,))):
        for vw in views:
            for k, extra in ARMS:
                add(f'c10solo{"" if vw == 0 else "b"}_{k}_{nm.split("_")[0]}', f'mode=solo&who={nm}&reg=dressed&stage=studio@5&w=1080&h=1350&view={vw}{extra}')
    for nm in ('L08_f24_hispanic', 'L21_m32_black'):   # the shoes at 1:1 (the camera on the feet): the current construction
        add(f'c10feet_on_{nm.split("_")[0]}', f'mode=bust&feet=1&who={nm}&reg=dressed&stage=studio@5&w=1080&h=1350')
if SET == 'c6i2':
    # c6 it2: 'on' = latest (everything on: the cascade, the creases as geometry with touching layers folding together (fold7 `contact`), the fuzz shells, wear from the body's motion (wear7)). The arms change ONE thing:
    # contact=0 (the creases as in it1: a layer that touches another rises on its own) and motion=0 (no wear field: seams, hems and crests only). Bare person names; the jeans are L08's (a woman in a tee and stretch denim),
    # the coat is L23's (the person of the it1 slit).
    L08, L23 = 'L08_f24_hispanic', 'L23_m45_white'
    def near(tag, who, look, yaw=0, extra='', d=None, el=None):
        add(f'{tag}', f'mode=bust&who={who}&reg=dressed&stage=studio@5&w=1080&h=1350&look={look}&lookyaw={yaw}' + (f'&lookd={d}' if d else '') + (f'&lookel={el}' if el is not None else '') + extra)
    near('c11hip_on_L08', L08, 'hip', 0); near('c11hip_nomotion_L08', L08, 'hip', 0, '&motion=0')
    near('c11seat_on_L08', L08, 'hip', 180); near('c11seat_nomotion_L08', L08, 'hip', 180, '&motion=0')
    near('c11knee_on_L08', L08, 'knee', 0, d=0.9); near('c11kneeb_on_L08', L08, 'knee', 180, d=0.9); near('c11kneeb_nomotion_L08', L08, 'knee', 180, '&motion=0', d=0.9)
    for k, extra in (('on', ''), ('nocontact', '&contact=0')):
        add(f'c11bust_{k}_L23', f'mode=bust&who={L23}&reg=dressed&stage=studio@5&w=1080&h=1350{extra}')
    near('c11elbow_on_L23', L23, 'elbow', 0, d=0.9); near('c11elbow_nocontact_L23', L23, 'elbow', 0, '&contact=0', d=0.9)
    for vw in (0, 3):
        add(f'c11solo{"" if vw == 0 else "b"}_on_L08', f'mode=solo&who={L08}&reg=dressed&stage=studio@5&w=1080&h=1350&view={vw}')
    add('c11solo_on_L23', f'mode=solo&who={L23}&reg=dressed&stage=studio@5&w=1080&h=1350&view=0')
    ROWB = urllib.parse.quote(';'.join(('L08_f24_hispanic', 'L21_m32_black', 'L22_f27_black', 'L11_m23_white', 'L20_f29_asian', 'L17_m28_hispanic', 'L12_f39_white', 'L03_m38_asian',
                                         'L14_f42_black', 'L23_m45_white', 'L06_f53_white', 'L05_m59_black')), safe='')
    add('c11row_on_studio5_270', f'mode=row&who={ROWB}&reg=dressed&stage=studio@5&gap=0.75&views=0,1,3&vstack=1&w=1560&h=1080')
if SET == 'c6i3':
    # c6 it3: 'on' = latest (the worn lines are the crests of SET CREASES: pale cover and relief from the one kernel; directions a fan; no zones on bones in the program). The arms change ONE thing: setrelief=0 (the lines as colour only,
    # the it2 look) and motion=0 (no wear field at all: the control of 'do the lines come from the postures'). contact=0 is it2's arm for the slit (still unseen). Bare person names. L08 is a woman in a tee and stretch denim (a light
    # wash), L23 a man in a darker blue jean and the coat of the slit.
    L08, L23 = 'L08_f24_hispanic', 'L23_m45_white'
    def near(tag, who, look, yaw=0, extra='', d=None, el=None):
        add(f'{tag}', f'mode=bust&who={who}&reg=dressed&stage=studio@5&w=1080&h=1350&look={look}&lookyaw={yaw}' + (f'&lookd={d}' if d else '') + (f'&lookel={el}' if el is not None else '') + extra)
    near('c12hip_on_L08', L08, 'hip', 0); near('c12hip_norelief_L08', L08, 'hip', 0, '&setrelief=0'); near('c12hip_nomotion_L08', L08, 'hip', 0, '&motion=0')
    near('c12seat_on_L08', L08, 'hip', 180)
    near('c12knee_on_L08', L08, 'knee', 0, d=0.9); near('c12kneeb_on_L08', L08, 'knee', 180, d=0.9); near('c12kneeb_norelief_L08', L08, 'knee', 180, '&setrelief=0', d=0.9)
    near('c12hip_on_L23', L23, 'hip', 0)
    for k, extra in (('on', ''), ('nocontact', '&contact=0')):
        add(f'c12bust_{k}_L23', f'mode=bust&who={L23}&reg=dressed&stage=studio@5&w=1080&h=1350{extra}')
    near('c12elbow_on_L23', L23, 'elbow', 0, d=0.9); near('c12elbow_nocontact_L23', L23, 'elbow', 0, '&contact=0', d=0.9)
    for vw in (0, 3):
        add(f'c12solo{"" if vw == 0 else "b"}_on_L08', f'mode=solo&who={L08}&reg=dressed&stage=studio@5&w=1080&h=1350&view={vw}')
    add('c12solo_on_L23', f'mode=solo&who={L23}&reg=dressed&stage=studio@5&w=1080&h=1350&view=0')
    ROWB = urllib.parse.quote(';'.join(('L08_f24_hispanic', 'L21_m32_black', 'L22_f27_black', 'L11_m23_white', 'L20_f29_asian', 'L17_m28_hispanic', 'L12_f39_white', 'L03_m38_asian',
                                         'L14_f42_black', 'L23_m45_white', 'L06_f53_white', 'L05_m59_black')), safe='')
    add('c12row_on_studio5_270', f'mode=row&who={ROWB}&reg=dressed&stage=studio@5&gap=0.75&views=0,1,3&vstack=1&w=1560&h=1080')
if SET == 'book':
    BOOK = 'teeJersey:#9b9a98,heatherJersey:#6f7377,fleece:#5a2a33,rib:#5a2a33,stretchDenim:#5d7899,denim:#263a5a,chino:#b49d78,canvas:#8a6a43,oxford:#9fb6d4,scrub:#2b4a74,woolFlannel:#4a4a4f'
    for sc, nm in (('1,2', 'l'), ('4,6', 'h')):        # left panel of each cell: single-scale wrinkles; right: the cascade
        add(f'book{nm}', f'mode=swatch&scales={sc}&cw=400&ch=400&w=1600&h=4400&q=film&book={urllib.parse.quote(BOOK, safe=":,")}', lab=LF)
print(json.dumps({'plates': P}, indent=1))
print(len(P), 'plates', file=sys.stderr)
