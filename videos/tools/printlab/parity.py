"""Renderer <-> Python parity for printlab (python3 tools/printlab/parity.py SCRATCH_DIR [OUT_JSON]).

Renders the chart through every film stock, and four print processes from the same plates, in the renderer
(web/lib/printlab.js via tools/printlab/drive.mjs, SwiftShader) and in Python (engine/printlab), and reports CIE76 dE.
Film is compared twice: with grain/dust off (the deterministic chain: curves, matrices, END, halation, MTF) and with
everything on (the grain is the same PCG3D lattice on both sides, so it should match pixel for pixel).
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..'))
from engine.printlab import chart, core, film, press as P  # noqa: E402

D = sys.argv[1]; OUTJ = sys.argv[2] if len(sys.argv) > 2 else os.path.join(D, 'parity.json')
os.makedirs(D, exist_ok=True)
Image.fromarray(core.to_u8(chart.chart())).save(os.path.join(D, 'chart.png'))
yy, xx = np.mgrid[0:1920, 0:1080].astype(np.float32)
plate = np.clip(0.5 + 0.45 * np.sin(xx / 90) * np.cos(yy / 140), 0, 1)        # a smooth neutral tone plate
plate[1200:1500, 100:980] = 1.0; plate[1250:1450, 300:500] = 0.0                  # a solid and a knock-out
Image.fromarray(core.to_u8(plate)).save(os.path.join(D, 'plate.png'))
plate8 = np.asarray(Image.open(os.path.join(D, 'plate.png')).convert('L'), np.float32) / 255

STOCKS = ['kodachrome25', 'trix7266', 'technicolor_ib', 'orwocolor', 'nitrate_bw']
OFF = '{"grain":0,"dust_amt":0,"weave_amt":0,"flicker_amt":0,"headroom":6}'
ON = '{"headroom":6}'
jobs = [f'film|{s}|chart.png|3|{OFF}' for s in STOCKS] + [f'film|{s}|chart.png|3|{ON}' for s in STOCKS]
jobs += ['print|riso|plate.png|{}', 'print|gravure|plate.png|{}', 'print|cyanotype|plate.png|{}', 'print|silkscreen|plate.png|{}']
r = subprocess.run(['node', os.path.join(HERE, 'drive.mjs'), D, os.path.join(D, 'js'), ';'.join(jobs)], capture_output=True, text=True, timeout=1800)
print(r.stdout[-3000:], r.stderr[-2000:])
lines = [l for l in r.stdout.splitlines() if l.startswith('ok ')]
res = {}
c = np.asarray(Image.open(os.path.join(D, 'chart.png')).convert('RGB'), np.float32) / 255
for j, l in zip(jobs, lines):
    f = l.split()[-1]
    js = np.asarray(Image.open(f).convert('RGB'), np.float32) / 255
    kind, a = j.split('|')[:2]
    if kind == 'film':
        on = j.endswith(ON)
        py = film.develop(c, a, frame=3, headroom=6, **({} if on else dict(grain=0, dust_amt=0, weave_amt=0, flicker_amt=0)))
        key = f'film {a} ' + ('all on' if on else 'grain/dust/weave off')
    else:
        cam = P.Camera(view_mm=180)
        if a == 'riso': py = P.riso(P.paper('riso_bond', cam, 3), plate8, ink='riso_federal_blue').srgb()
        if a == 'gravure': py = P.gravure(P.paper('supercal', cam, 6), plate8).srgb()
        if a == 'cyanotype': py = P.cyanotype(P.paper('whatman', cam, 5), plate8, dose=1.0).srgb()
        if a == 'silkscreen': py = P.silkscreen(P.paper('poster', cam, 4), plate8, ink='screen_red').srgb()
        key = f'print {a}'
    d = core.de76(py, js)
    db = core.de76(core.blur(py, 3), core.blur(js, 3))
    res[key] = dict(dE_mean=round(float(d.mean()), 3), dE_p95=round(float(np.percentile(d, 95)), 3), dE_max=round(float(d.max()), 2),
                    dE_mean_3px=round(float(db.mean()), 3))
    print(key, res[key], flush=True)
json.dump(res, open(OUTJ, 'w'), indent=1)
print('wrote', OUTJ)
