#!/bin/sh
# after a render lands: cut the master to its closer beat + 1.4 s (short ☭≡/acc closer), fade the audio,
# re-render the closer tail first if the master was rendered with the old long card. Then sheet, LUFS, share copy.
#   scripts/reclose.sh scene:endBeat:bpm[:old] ...
cd "$(dirname "$0")/.." && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
FF=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2
for spec in "$@"; do
  s=$(echo $spec | cut -d: -f1); e=$(echo $spec | cut -d: -f2); bpm=$(echo $spec | cut -d: -f3); old=$(echo $spec | cut -d: -f4)
  until grep -q "^$s: wrote" logs/r_$s.log 2>/dev/null; do sleep 30; done
  E=$(python3 -c "print('%g' % round($e*60/$bpm,3))"); END=$(python3 -c "print('%g' % round($E+1.4,3))"); FO=$(python3 -c "print('%g' % round($END-0.5,3))")
  cp out/$s.mp4 archive/${s}_heat_full.mp4
  if [ "$old" = old ]; then
    node web/render.mjs $s --from $E --to $END > logs/r_${s}_tail.log 2>&1
    $FF -y -loglevel error -i archive/${s}_heat_full.mp4 -i out/${s}_$E-$END.mp4 -i out/.$s.wav \
      -filter_complex "[0:v]trim=0:$E,setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=1:a=0[v];[2:a]atrim=0:$END,afade=t=out:st=$FO:d=0.5,alimiter=limit=0.891:level=false[au]" \
      -map "[v]" -map "[au]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -r 30 -ar 48000 -c:a aac -b:a 256k -movflags +faststart out/$s.mp4
    mv out/${s}_$E-$END.mp4 archive/
  else
    $FF -y -loglevel error -i archive/${s}_heat_full.mp4 -i out/.$s.wav \
      -filter_complex "[0:v]trim=0:$END,setpts=PTS-STARTPTS[v];[1:a]atrim=0:$END,afade=t=out:st=$FO:d=0.5,alimiter=limit=0.891:level=false[au]" \
      -map "[v]" -map "[au]" -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -r 30 -ar 48000 -c:a aac -b:a 256k -movflags +faststart out/$s.mp4
  fi
  # the audio finished once from the wav (engine/finish.py; the picture copied); the share copy below copies this
  # exact stream. A failed finish ships nothing: the render with its preview audio is set aside as .unfinished.mp4
  python3 -m engine.finish render --scene "$s" --wav out/.$s.wav --lock $E --to $END --video out/$s.mp4 -o out/$s.mp4.fin.mp4 \
    --report out/$s.finish.json > /dev/null 2> logs/r_${s}_finish.log && mv out/$s.mp4.fin.mp4 out/$s.mp4 \
    || { cat logs/r_${s}_finish.log; echo "$s: FINISH FAILED: not shipped"; mv out/$s.mp4 out/$s.unfinished.mp4; rm -f out/$s.mp4.fin.mp4; continue; }
  sed 's/^/  /' logs/r_${s}_finish.log
  $FF -y -loglevel error -i out/$s.mp4 -vf "fps=16/$END,scale=180:-1,tile=16x1" -frames:v 1 review/${s}_heat_sheet.jpg
  L=$($FF -i out/$s.mp4 -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *[-0-9.]*")
  VB=$(python3 -c "print(int(27*8*1024/$END - 330))")   # share copy sized under the 30 MiB upload limit (audio copied)
  $FF -y -loglevel error -i out/$s.mp4 -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset slow -vf scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a copy out/share/${s}_share.mp4
  mkdir -p /tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad/deliver && cp out/share/${s}_share.mp4 /tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad/deliver/
  echo "$s ${END}s $L share=$(du -m out/share/${s}_share.mp4 | cut -f1)MB"
done
