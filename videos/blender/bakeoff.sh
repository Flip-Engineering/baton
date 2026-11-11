#!/bin/sh
# CYCLES bake-off: every Cycles shot of the matrix in review/studio_human_c8/after/cycles/tools/plates.py, one render at a time, niced.
#   sh videos/blender/bakeoff.sh [scale 0.5] [samples 64] [people "L14 L01"]
# BLENDER (env) defaults to ~/.cache/acp_human/blender/blender-5.2.2-linux-x64/blender; THREADS (env) to 2.
cd "$(dirname "$0")/.." || exit 1
BL=${BLENDER:-$HOME/.cache/acp_human/blender/blender-5.2.2-linux-x64/blender}
E=review/studio_human_c8/after/cycles/export; OUT=review/studio_human_c8/after/cycles/renders
SCALE=${1:-0.5}; SPP=${2:-64}; PEOPLE=${3:-"L14 L01"}
for P in $PEOPLE; do
  for S in face:over:bare face:sun:bare bust:over:bare bust:sun:work full:over:bare full:over:work full:sun:work; do
    shot=${S%%:*}; r=${S#*:}; light=${r%%:*}; wear=${r#*:}
    tag=cyc_${P}_${shot}_${light}_${wear}
    [ -f "$OUT/$tag.png" ] && continue
    nice -n 15 "$BL" -b --factory-startup -t ${THREADS:-2} -P blender/render_person.py -- --export $E/${P}_${wear} --maps $E/${P}_bare/maps \
      --shot $shot --light $light --samples $SPP --scale $SCALE --threads ${THREADS:-2} --out $OUT --tag $tag 2>&1 | grep -E "^frame|^meter|Error|Traceback"
  done
done
