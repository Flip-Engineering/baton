#!/bin/sh
# review stills for a scene at the given beats: scripts/sheet.sh <scene> <bpm> <beat> <beat> ...
# Writes review/<scene>_heat_stills.jpg, a contact sheet to look at at phone size. tools/hudlint.mjs lists what a scene's
# counters are doing on its impact beats, when you want that readout.
cd "$(dirname "$0")/.." && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
s=$1; bpm=$2; shift 2
T=$(for b in "$@"; do python3 -c "print(round($b*60/$bpm,3))"; done | paste -sd,)
rm -f out/stills/${s}_*
node web/render.mjs $s --stills $T > logs/${s}_stills.log 2>&1
python3 - "$s" <<'PY'
import glob, sys
from PIL import Image
s = sys.argv[1]
fs = sorted(glob.glob(f'out/stills/{s}_*.jpg'), key=lambda f: float(f.rsplit('_', 1)[-1][:-4]))
cols = min(11, len(fs)); rows = (len(fs) + cols - 1) // cols
c = Image.new('RGB', (216 * cols, 384 * rows))
for i, f in enumerate(fs): c.paste(Image.open(f).resize((216, 384)), ((i % cols) * 216, (i // cols) * 384))
c.save(f'review/{s}_heat_stills.jpg', quality=85)
PY
echo "$s sheet done"
