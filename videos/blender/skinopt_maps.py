#!/usr/bin/env python3
# SKIN OPTICS: the person's baked skin maps as JPEGs (system python3: PIL, numpy), called by skinopt_job.py after each person.
#   python3 videos/blender/skinopt_maps.py <person work dir> <out maps dir> <who>
# every skin_albedo*_a*.png (full size), skin_spec / skin_rough / skin_normal / skin_ld_a*.png (half size; skin_ld: SKIN OPTICS iteration 13's transport, sqrt(l_d / 4 mm)) under the work dir -> <out>/<who>__<folder>__<name>.jpg
import sys, os, glob, json
import numpy as np
from PIL import Image

pw, out, who = sys.argv[1:4]
os.makedirs(out, exist_ok=True); rec = []
files = sorted(set(sum((glob.glob(os.path.join(pw, '**', pat), recursive=True) for pat in ('skin_albedo*_a*.png', 'skin_spec_a*.png', 'skin_rough_a*.png', 'skin_normal_a*.png', 'skin_ld_a*.png')), [])))
for f in files:
    try:
        im = Image.open(f)
        if im.mode.startswith('I'):   # a 16-bit single-channel map: to 8 bits by its own range
            a = np.asarray(im).astype(np.float64); im = Image.fromarray(np.clip(a / (65535.0 if a.max() > 255 else 255.0) * 255.0, 0, 255).astype(np.uint8))
        im = im.convert('RGB')
        if not os.path.basename(f).startswith('skin_albedo'):
            im = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
        folder = os.path.basename(os.path.dirname(os.path.dirname(f))) or 'x'
        name = who.replace(':', '_') + '__' + folder + '__' + os.path.splitext(os.path.basename(f))[0] + '.jpg'
        im.save(os.path.join(out, name), quality=90); rec.append({'src': os.path.relpath(f, pw), 'out': name, 'size': [im.width, im.height]})
    except Exception as e:
        rec.append({'src': os.path.relpath(f, pw), 'error': repr(e)[:200]})
print(json.dumps({'who': who, 'maps': rec}))
