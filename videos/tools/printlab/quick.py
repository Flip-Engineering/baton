"""Quick look: every stock on the chart and the archival frames at half size (development aid)."""
import sys, os
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from engine.printlab import film, chart, core
out = sys.argv[1]; src = sys.argv[2]
W, H = 540, 960
ims = {'chart': chart.chart()[::2, ::2], 'girl': chart.archival('girl', src, W, H), 'farm': chart.archival('farm', src, W, H)}
SG = {'chart': 1.0, 'girl': 1.8, 'farm': 1.3}
runs = [('src', None)] + [(s, g) for s, g in [('kodachrome25', 'still135'), ('kodachrome25', '16mm'), ('trix7266', '16mm'), ('technicolor_ib', '35mm'), ('orwocolor', '35mm'), ('nitrate_bw', '35mm')]]
rows = []
for nm, im in ims.items():
    row = []
    for st, g in runs:
        o = im if st == 'src' else film.develop(im, st, frame=3, gauge=g, source_gamma=SG[nm], headroom=6 if nm == 'chart' else 1)
        row.append(core.to_u8(o)[::2, ::2])
    rows.append(np.concatenate(row, 1))
Image.fromarray(np.concatenate(rows, 0)).save(out, quality=88)
