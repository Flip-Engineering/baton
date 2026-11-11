#!/usr/bin/env python3
"""Fetch the extra CC0 MakeHuman targets the HUMAN c6 population bake needs (women, older bodies, face variety).

    python3 videos/scripts/fetch_mh_targets.py          # -> videos/sources/makehuman/targets/... (skips files already there)

Source: github.com/makehumancommunity/makehuman at the same commit as the cycle-1 vendoring (a8bc2d5), makehuman/data/targets/.
The bundled assets are CC0 1.0 (see videos/sources/makehuman/README.md). Each file is a plain-text delta list on the hm08 base
mesh; the bake (scripts/bake_hero.py) mixes them into a variant.
"""
import os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, '..', 'sources', 'makehuman', 'targets')
BASE = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d5/makehuman/data/targets/'

M = 'macrodetails/'
FILES = []
for race in ('african', 'asian', 'caucasian'):
    for g in ('male', 'female'):
        for a in ('young', 'old'):
            FILES.append(f'{M}{race}-{g}-{a}.target')
for g in ('male', 'female'):
    for a in ('young', 'old'):
        for mu in ('minmuscle', 'averagemuscle', 'maxmuscle'):
            for w in ('minweight', 'averageweight', 'maxweight'):
                FILES.append(f'{M}universal-{g}-{a}-{mu}-{w}.target')
for g in ('male', 'female'):
    for h in ('minheight', 'maxheight'):
        FILES.append(f'{M}height/{g}-young-averagemuscle-averageweight-{h}.target')
    FILES.append(f'{M}proportions/{g}-young-averagemuscle-averageweight-idealproportions.target')
for a in ('young', 'old'):
    for c in ('maxcup', 'mincup'):
        FILES.append(f'breast/female-{a}-averagemuscle-averageweight-{c}-averagefirmness.target')
FILES += [
    'head/head-age-incr.target', 'head/head-oval.target', 'head/head-round.target', 'head/head-triangular.target', 'head/head-rectangular.target',
    'head/head-fat-incr.target', 'head/head-scale-vert-incr.target',
    'nose/nose-scale-horiz-incr.target', 'nose/nose-scale-horiz-decr.target', 'nose/nose-width1-incr.target', 'nose/nose-nostrils-width-incr.target',
    'nose/nose-trans-up.target', 'nose/nose-curve-concave.target', 'nose/nose-point-width-incr.target',
    'mouth/mouth-scale-horiz-incr.target', 'mouth/mouth-scale-horiz-decr.target', 'mouth/mouth-lowerlip-height-incr.target', 'mouth/mouth-upperlip-height-incr.target',
    'ears/r-ear-scale-incr.target', 'ears/l-ear-scale-incr.target', 'ears/r-ear-flap-incr.target', 'ears/l-ear-flap-incr.target',
    'eyes/r-eye-scale-incr.target', 'eyes/l-eye-scale-incr.target', 'eyes/r-eye-scale-decr.target', 'eyes/l-eye-scale-decr.target',
    'forehead/forehead-trans-backward.target', 'forehead/forehead-scale-vert-incr.target',
    'cheek/l-cheek-inner-incr.target', 'cheek/r-cheek-inner-incr.target', 'cheek/l-cheek-volume-incr.target', 'cheek/r-cheek-volume-incr.target',
    'cheek/l-cheek-bones-decr.target', 'cheek/r-cheek-bones-decr.target',
    'chin/chin-height-incr.target', 'chin/chin-height-decr.target', 'chin/chin-width-decr.target', 'chin/chin-prominent-decr.target',
    'eyebrows/eyebrows-trans-up.target', 'eyebrows/eyebrows-angle-up.target',
    'stomach/stomach-pregnant-incr.target', 'torso/torso-vshape-incr.target', 'torso/torso-vshape-decr.target',
    'hip/hip-scale-horiz-incr.target', 'buttocks/buttocks-volume-incr.target', 'neck/neck-scale-horiz-decr.target',
]

# HUMAN c8 lane A (the body studio, lib/fx/body/): more CC0 raw material for the shape basis, all from the same commit.
#  - the breast FIRMNESS axis (MakeHuman's ptosis proxy) and its cup x weight variants at average muscle, young and old;
#  - breast position / projection / splay targets; MakeHuman's measure targets (lengths for the frame fit: shoulder distance, arm
#    and leg segment lengths, nape-to-waist; the circumference ones are kept as references, the fit uses our own depots);
#  - leg lengths, knee valgus, head, neck and face targets the cast sampler varies (faces: a few per cent around the group mean).
# bake_hero.py does not read any of these, so the CREW8 bake is unchanged.
for a in ('young', 'old'):
    for w in ('minweight', 'averageweight', 'maxweight'):
        for c in ('mincup', 'averagecup', 'maxcup'):
            for f in ('minfirmness', 'averagefirmness', 'maxfirmness'):
                if c == 'averagecup' and f == 'averagefirmness': continue
                FILES.append(f'breast/female-{a}-averagemuscle-{w}-{c}-{f}.target')
FILES += [f'breast/breast-{k}.target' for k in ('dist-decr', 'dist-incr', 'point-decr', 'point-incr', 'trans-down', 'trans-up', 'volume-vert-down', 'volume-vert-up')]
FILES += [f'measure/measure-{k}-{d}.target' for k in ('shoulder-dist', 'upperarm-length', 'lowerarm-length', 'upperleg-height', 'lowerleg-height', 'napetowaist-dist',
          'waisttohip-dist', 'neck-height', 'neck-circ', 'bust-circ', 'underbust-circ', 'waist-circ', 'hips-circ', 'thigh-circ', 'calf-circ', 'upperarm-circ', 'knee-circ',
          'ankle-circ', 'wrist-circ', 'frontchest-dist') for d in ('decr', 'incr')]
FILES += [f'armslegs/{k}-{d}.target' for k in ('upperlegs-height', 'lowerlegs-height') for d in ('decr', 'incr')]
FILES += [f'armslegs/{s}-{k}-{d}.target' for s in 'lr' for k in ('leg-valgus', 'hand-scale', 'foot-scale') for d in ('decr', 'incr')]
FILES += ['neck/neck-double-incr.target', 'neck/neck-double-decr.target', 'stomach/stomach-navel-in.target', 'stomach/stomach-navel-out.target',
          'buttocks/buttocks-volume-decr.target', 'pelvis/pelvis-tone-decr.target', 'pelvis/pelvis-tone-incr.target', 'hip/hip-scale-horiz-decr.target',
          'torso/torso-scale-depth-incr.target', 'torso/torso-scale-depth-decr.target', 'torso/torso-scale-horiz-incr.target', 'torso/torso-scale-horiz-decr.target']
for k in ('head-scale-depth', 'head-scale-horiz', 'head-scale-vert', 'head-fat', 'head-age'):
    for d in ('decr', 'incr'): FILES.append(f'head/{k}-{d}.target')
FILES += [f'head/head-{k}.target' for k in ('square', 'diamond')]
for grp, keys in (('nose', ('nose-scale-vert', 'nose-scale-depth', 'nose-width2', 'nose-width3', 'nose-hump', 'nose-nostrils-width', 'nose-point-width', 'nose-septumangle')),
                  ('mouth', ('mouth-scale-vert', 'mouth-scale-depth', 'mouth-lowerlip-height', 'mouth-upperlip-height', 'mouth-lowerlip-width', 'mouth-upperlip-width', 'mouth-cupidsbow-width')),
                  ('chin', ('chin-bones', 'chin-height', 'chin-width', 'chin-prominent', 'chin-jaw-drop')),
                  ('forehead', ('forehead-scale-vert', 'forehead-nubian', 'forehead-temple')),
                  ('eyebrows', ('eyebrows-angle', 'eyebrows-trans'))):
    for k in keys:
        for d in ('decr', 'incr') if not k.endswith(('-angle', '-trans')) else (('up', 'down') if k.endswith('angle') else ('up', 'down', 'forward', 'backward')):
            FILES.append(f'{grp}/{k}-{d}.target')
for s in 'lr':
    for k in ('cheek-bones', 'cheek-volume', 'cheek-inner'):
        for d in ('decr', 'incr'): FILES.append(f'cheek/{s}-{k}-{d}.target')
    FILES += [f'eyes/{s}-{k}.target' for k in ['eye-bag-decr', 'eye-bag-in', 'eye-bag-incr', 'eye-bag-out', 'eye-corner1-down', 'eye-corner1-up', 'eye-corner2-down', 'eye-corner2-up', 'eye-epicanthus-in', 'eye-epicanthus-out', 'eye-height1-decr', 'eye-height1-incr', 'eye-height2-decr', 'eye-height2-incr', 'eye-push1-in', 'eye-push1-out', 'eye-push2-in', 'eye-push2-out', 'eye-scale-decr', 'eye-scale-incr', 'eye-trans-down', 'eye-trans-in', 'eye-trans-out', 'eye-trans-up']]
    FILES += [f'ears/{s}-{k}.target' for k in ['ear-flap-decr', 'ear-flap-incr', 'ear-lobe-decr', 'ear-lobe-incr', 'ear-rot-backward', 'ear-rot-forward', 'ear-scale-decr', 'ear-scale-incr']]
FILES = list(dict.fromkeys(FILES))

# HUMAN c8 P2 (the face generator, lib/fx/face/): more CC0 face raw material from the same commit, for feature variation as data
# (mouth position and lip volumes, philtrum, laugh lines, nose base / flare / tip / Greek line, ear shape and position, chin cleft,
# cheek height). Names that do not exist upstream fail quietly (404) and are skipped. Nothing that bakes CREW8 reads these.
for k, ds in (('mouth-trans', ('up', 'down', 'forward', 'backward', 'in', 'out')), ('mouth-angles', ('up', 'down')), ('mouth-dimples', ('in', 'out')),
              ('mouth-laugh-lines', ('in', 'out')), ('mouth-lowerlip-ext', ('up', 'down')), ('mouth-upperlip-ext', ('up', 'down')),
              ('mouth-lowerlip-middle', ('up', 'down')), ('mouth-upperlip-middle', ('up', 'down')), ('mouth-lowerlip-volume', ('decr', 'incr')),
              ('mouth-upperlip-volume', ('decr', 'incr')), ('mouth-philtrum-volume', ('decr', 'incr'))):
    FILES += [f'mouth/{k}-{d}.target' for d in ds]
for k, ds in (('nose-trans', ('down', 'forward', 'backward', 'in', 'out')), ('nose-point', ('up',)), ('nose-greek', ('decr', 'incr')), ('nose-curve', ('convex',)),
              ('nose-flaring', ('decr', 'incr')), ('nose-compression', ('compress', 'uncompress')), ('nose-base', ('up', 'down')),
              ('nose-nostrils-angle', ('up', 'down')), ('nose-width1', ('decr',))):
    FILES += [f'nose/{k}-{d}.target' for d in ds]
for s in 'lr':
    for k, ds in (('ear-scale-vert', ('decr', 'incr')), ('ear-scale-depth', ('decr', 'incr')), ('ear-trans', ('up', 'down', 'backward', 'forward')),
                  ('ear-wing', ('decr', 'incr')), ('cheek-trans', ('up', 'down'))):
        FILES += [f'{"cheek" if k.startswith("cheek") else "ears"}/{s}-{k}-{d}.target' for d in ds]
    FILES += [f'ears/{s}-ear-shape-{k}.target' for k in ('pointed', 'triangle', 'round', 'square')]
FILES += [f'chin/chin-cleft-{d}.target' for d in ('decr', 'incr')] + [f'chin/chin-prognathism-{d}.target' for d in ('decr', 'incr')] + ['forehead/forehead-trans-forward.target']
FILES = list(dict.fromkeys(FILES))

# the upstream file list (so the generated name combinations above only fetch files that exist); None = try every name
KNOWN = None
def _known():
    global KNOWN
    try:
        import json as _j
        t = _j.loads(urllib.request.urlopen('https://api.github.com/repos/makehumancommunity/makehuman/git/trees/a8bc2d5?recursive=1', timeout=60).read())
        KNOWN = {e['path'][len('makehuman/data/targets/'):] for e in t.get('tree', []) if e['path'].startswith('makehuman/data/targets/')} or None
    except Exception: KNOWN = None

def main():
    _known()
    ok = miss = have = 0
    for f in FILES:
        p = os.path.join(DST, f)
        if os.path.exists(p): have += 1; continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        if KNOWN is not None and f not in KNOWN: continue     # c8: name combinations that do not exist upstream are skipped quietly
        try:
            data = urllib.request.urlopen(BASE + f, timeout=60).read()
            open(p, 'wb').write(data); ok += 1
        except Exception as e:
            print('missing', f, e); miss += 1
    print(f'fetched {ok}, already had {have}, missing {miss}')

if __name__ == '__main__':
    sys.exit(main())
