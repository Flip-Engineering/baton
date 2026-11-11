#!/bin/sh
# Render-farm worker job. Run inside a cloud session that has this repo checked out.
#   videos/scripts/farm_job.sh <branch-name> scene:endBeat:bpm [scene:endBeat:bpm ...]
# Renders each scene to the end its song's ending needs (engine/finish.py span: the closer beat + the built ending,
# or + 1.4 s with a fade), finishes the audio once (engine/finish.py), makes a <30 MiB share copy,
# splits the master into <95 MB parts, commits them under videos/out/farm/ and pushes branch <branch-name> to the
# worker's own repo (origin, the pipeline repo) by default; RENDER_REMOTE_URL overrides. The branch is an orphan commit
# holding only videos/out/farm/, so it carries no pipeline history. The coordinator collects it (collect.sh) and
# publishes master + share to the archive repo with publish.sh, then deletes the render branch.
set -e
BR=$1; shift
cd "$(dirname "$0")/.."                       # videos/
[ -f /root/.ccr/ca-bundle.crt ] && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
(cd web && (npm ci --no-audit --no-fund || npm install --no-audit --no-fund) >/dev/null 2>&1)
python3 -c "import numpy, scipy, PIL, imageio_ffmpeg" 2>/dev/null || pip install -q numpy scipy pillow imageio-ffmpeg
FF=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())")
sh scripts/fetch_voice_model.sh || echo "voice model: fetch failed (neural voices fall back to the formant path)"
mkdir -p out/farm logs
# BT.709 colour for every re-encode (web/enc_args.mjs): converts an old untagged (601) input, no-op on a 709 one
C709="-vf scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
for spec in "$@"; do
  s=$(echo $spec | cut -d: -f1); e=$(echo $spec | cut -d: -f2); bpm=$(echo $spec | cut -d: -f3)
  E=$(python3 -c "print('%g' % round($e*60/$bpm,3))")
  echo "== $s"
  # the song first, so the finish stage can say where the piece ends (the song's own built ending kept unless the
  # piece's finish sheet says otherwise: engine/finish.py span), then the picture drawn to that end
  python3 web/audio/make_audio.py "$s" --quiet > logs/farm_${s}_song.log 2>&1 || { tail -20 logs/farm_${s}_song.log; exit 1; }
  END=$(python3 -m engine.finish span --scene "$s" --wav out/.$s.wav --lock $E)
  node web/render.mjs "$s" --reuse-audio --to $END --file out/$s.mp4 > logs/farm_$s.log 2>&1 || { tail -20 logs/farm_$s.log; exit 1; }
  # one picture generation: the picture copied; the audio finished once from the song's PCM (engine/finish.py) and
  # the measured stream muxed in; a failed finish stops the job (no fallback master)
  python3 -m engine.finish render --scene "$s" --wav out/.$s.wav --lock $E --to $END --video out/$s.mp4 \
    -o out/farm/$s.mp4 --report out/farm/$s.finish.json > /dev/null 2> logs/farm_${s}_finish.log \
    || { cat logs/farm_${s}_finish.log; echo "$s: FINISH FAILED: nothing shipped"; exit 1; }
  sed 's/^/  /' logs/farm_${s}_finish.log | tee -a out/farm/REPORT.txt
  python3 -m engine.finish plan out/farm/$s.mp4 --scene "$s" --report out/farm/$s.finish.json -o out/farm/${s}_finish.png > /dev/null || true
  VB=$(python3 -c "print(int(27*8*1024/$END - 330))")
  $FF -y -loglevel error -i out/farm/$s.mp4 -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset slow $C709 -c:a copy out/farm/${s}_share.mp4
  $FF -y -loglevel error -i out/farm/$s.mp4 -vf "fps=16/$END,scale=180:-1,tile=16x1" -frames:v 1 out/farm/${s}_sheet.jpg
  L=$($FF -i out/farm/$s.mp4 -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *[-0-9.]*")
  echo "$s ${END}s $L" >> out/farm/REPORT.txt
  split -b 95m -d out/farm/$s.mp4 out/farm/$s.mp4.part && rm out/farm/$s.mp4
done
cd ..
# Default: push the render branch back to this worker's own repo (origin), which every worker can push to.
# RENDER_REMOTE_URL sends it elsewhere (e.g. the archive) when the session has push access there.
if [ -n "${RENDER_REMOTE_URL:-}" ]; then git remote add renders "$RENDER_REMOTE_URL" 2>/dev/null || git remote set-url renders "$RENDER_REMOTE_URL"; R=renders; else R=origin; fi
git checkout -q --orphan "$BR" && git rm -rq --cached . 2>/dev/null || true
git add -f videos/out/farm && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "Farm render: $*" && git push -u "$R" "$BR"
cat videos/out/farm/REPORT.txt
