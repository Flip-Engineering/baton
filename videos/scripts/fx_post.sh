#!/bin/sh
# Post path for rendered clips (ffmpeg only; complements lib/fx/footage.js in-browser effects).
#   scripts/fx_post.sh out/lab_footage_10-13.5.mp4 [cuts=0.29,2.0] [bloom=1.2:10]
#   SMEAR=start:dur scripts/fx_post.sh ...   (opt-in, dur <= 1 s: minterpolate costs ~2 s per output frame)
# writes next to the input:
#   *_smear.mp4    only with SMEAR=: 2x slow-mo of [start, start+dur] through minterpolate (warped in-betweens)
#   *_tmix.mp4     tmix: weighted average of the last 8 frames (long-exposure echo, heavier on the present)
#   *_lagfun.mp4   lagfun on the negative: dark riders leave decaying ink trails (plain lagfun = light trails)
#   *_mosh.mp4     I-frame-drop datamosh at the cuts (scripts/fx_datamosh.py), optional P-frame bloom
#   *_post.jpg     contact strip of all four for review
set -e
cd "$(dirname "$0")/.."
in=$1; cuts=${2:-}; bloom=${3:-}
FF=$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')
b=${in%.mp4}
ENC="-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart"
t0=$(date +%s)
if [ -n "$SMEAR" ]; then                       # routine use skips smear; a <= 1 s moment only
  ss=${SMEAR%%:*}; sd=${SMEAR##*:}
  sd=$(python3 -c "print(min(1.0, float('$sd')))")
  $FF -y -loglevel error -ss "$ss" -t "$sd" -i "$in" -filter_complex \
    "[0:v]setpts=2.0*PTS,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none[v];[0:a]atempo=0.5[a]" \
    -map "[v]" -map "[a]" $ENC -c:a aac -b:a 192k "${b}_smear.mp4"
fi
t1=$(date +%s)
$FF -y -loglevel error -i "$in" -vf "tmix=frames=8:weights='1 1 1 1 2 2 3 5'" $ENC -c:a copy "${b}_tmix.mp4"
t2=$(date +%s)
$FF -y -loglevel error -i "$in" -vf "negate,lagfun=decay=0.93,negate" $ENC -c:a copy "${b}_lagfun.mp4"
t3=$(date +%s)
python3 scripts/fx_datamosh.py "$in" "${b}_mosh.mp4" ${cuts:+--cuts $cuts} ${bloom:+--bloom $bloom} --q 4
t4=$(date +%s)
echo "fx_post: smear $((t1-t0))s  tmix $((t2-t1))s  lagfun $((t3-t2))s  mosh $((t4-t3))s"
# review strip: 4 rows (smear/tmix/lagfun/mosh) x 8 frames
KS="tmix lagfun mosh"; [ -n "$SMEAR" ] && KS="smear $KS"
for k in $KS; do
  $FF -y -loglevel error -i "${b}_$k.mp4" -vf "select='not(mod(n\,12))',scale=180:320,tile=8x1" -frames:v 1 "${b}_strip_$k.jpg"
done
python3 - "$b" $KS <<'PY'
import sys
from PIL import Image
b = sys.argv[1]; ks = sys.argv[2:]
ims = [Image.open(f"{b}_strip_{k}.jpg") for k in ks]
c = Image.new('RGB', (ims[0].width, sum(i.height for i in ims)))
y = 0
for i in ims: c.paste(i, (0, y)); y += i.height
c.save(f'{b}_post.jpg', quality=85)
import os
for k in ks: os.remove(f'{b}_strip_{k}.jpg')
print(f'{b}_post.jpg')
PY
