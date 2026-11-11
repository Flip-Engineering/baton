#!/bin/sh
# when a scene's render exits: contact sheet, LUFS, share copy (<30 MB)
cd "$(dirname "$0")/.."
FF=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2
for s in "$@"; do
  until grep -q "^$s: wrote" logs/r_$s.log 2>/dev/null; do sleep 30; done
  d=$($FF -i out/$s.mp4 2>&1 | grep -o 'Duration: [0-9:.]*' | cut -d' ' -f2 | awk -F: '{print $2*60+$3}')
  $FF -y -loglevel error -i out/$s.mp4 -vf "fps=16/$d,scale=180:-1,tile=16x1" -frames:v 1 review/${s}_heat_sheet.jpg
  L=$($FF -i out/$s.mp4 -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *[-0-9.]*")
  $FF -y -loglevel error -i out/$s.mp4 -c:v libx264 -crf 25 -preset slow -vf scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a copy out/share/${s}_share.mp4
  echo "$s ${d}s $L share=$(du -m out/share/${s}_share.mp4 | cut -f1)MB"
done
