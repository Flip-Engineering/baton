#!/bin/sh
# Collect a finished farm render: fetch its renders/* branch from the pipeline repo (RENDER_REMOTE_URL overrides), reassemble the master, optionally fix the closer, make the share copy.
#   videos/scripts/collect.sh <scene> <bpm> <deliverName> [trim=<closerBeat>] [cut=<beatA>-<beatB>]
#     trim=64     re-cut the master to closerBeat + 1.4 s (for a closer that lands earlier than the farm's end beat)
#     cut=100-104 remove beats A..B (e.g. a second logo card before the closer); A..B should span whole bars
# Masters land in videos/out/farm/, superseded cuts in videos/archive/, share copies (<30 MiB) in the scratchpad deliver dir.
set -e
S=$1; BPM=$2; NAME=$3; shift 3
TRIM=; CUT=
for a in "$@"; do case $a in trim=*) TRIM=${a#trim=};; cut=*) CUT=${a#cut=};; esac; done
V=/home/user/acp-agitprop/videos; F=/home/user/farm/$S; OUT=$V/out/farm
DELIVER=/tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad/deliver
FF=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2
mkdir -p $OUT $V/archive $DELIVER
rm -rf $F && git clone -q --depth 1 --single-branch -b renders/$S ${RENDER_REMOTE_URL:-https://github.com/flip-engineer/automated-content-pipeline} $F
cat $F/videos/out/farm/$S.mp4.part* > $OUT/$S.mp4
cp $F/videos/out/farm/${S}_sheet.jpg $OUT/ 2>/dev/null || true
cat $F/videos/out/farm/REPORT.txt
rm -rf $F                                         # the clone is only transport; the render branch keeps the parts
dur() { $FF -i "$1" 2>&1 | grep -o "Duration: [0-9:.]*" | awk -F'[: ]' '{print $3*3600+$4*60+$5}'; }
if [ -n "$TRIM$CUT" ]; then
  # MUSIC c4: the picture is cut and re-encoded; the AUDIO is cut on the PCM and finished once through engine.finish
  # (AUDIO FINISH c1: a crossfade law chosen by how related the two sides are, a seam check, the one encode measured as
  # decoded, the measured stream muxed with -c:a copy; with set -e a failed finish stops the collect). The source PCM is the farm master's
  # own audio decoded (COLLECT_WAV=<path> uses a local master wav instead, when it is the same build).
  mv $OUT/$S.mp4 $V/archive/${S}_farm_raw.mp4; SRC=$V/archive/${S}_farm_raw.mp4
  WAV=${COLLECT_WAV:-$V/archive/${S}_farm_audio.wav}
  [ -n "$COLLECT_WAV" ] || $FF -y -loglevel error -i $SRC -vn -acodec pcm_f32le $WAV
  if [ -n "$CUT" ]; then
    A=$(python3 -c "print(round(${CUT%-*}*60/$BPM,3))"); B=$(python3 -c "print(round(${CUT#*-}*60/$BPM,3))"); D=$(dur $SRC)
    $FF -y -loglevel error -i $SRC -filter_complex "[0:v]trim=0:$A,setpts=PTS-STARTPTS[v1];[0:v]trim=$B:$D,setpts=PTS-STARTPTS[v2];[v1][v2]concat=n=2:v=1:a=0[v]" \
      -map "[v]" -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart $OUT/$S.v.mp4
    (cd $V && python3 -m engine.finish render --scene $S --wav $WAV --cut $A-$B --video $OUT/$S.v.mp4 -o $OUT/$S.mp4 --report $OUT/$S.finish.json > /dev/null)
  else
    END=$(python3 -c "print(round($TRIM*60/$BPM+1.4,3))")
    $FF -y -loglevel error -i $SRC -filter_complex "[0:v]trim=0:$END,setpts=PTS-STARTPTS[v]" \
      -map "[v]" -an -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -movflags +faststart $OUT/$S.v.mp4
    (cd $V && python3 -m engine.finish render --scene $S --wav $WAV --lock $(python3 -c "print(round($TRIM*60/$BPM,3))") --to $END --video $OUT/$S.v.mp4 -o $OUT/$S.mp4 --report $OUT/$S.finish.json > /dev/null)
  fi
  rm -f $OUT/$S.v.mp4; [ -n "$COLLECT_WAV" ] || rm -f $WAV
fi
END=$(dur $OUT/$S.mp4); VB=$(python3 -c "print(int(27*8*1024/$END - 330))")   # the audio is copied (256-320k), not re-encoded at 160k
$FF -y -loglevel error -i $OUT/$S.mp4 -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset medium -c:a copy $OUT/${S}_share.mp4
cp $OUT/${S}_share.mp4 $DELIVER/$NAME.mp4
# QA: 24-frame grid of the whole piece + the last 3 s at 4 fps
$FF -y -loglevel error -i $OUT/$S.mp4 -vf "fps=24/$END,scale=270:-1,tile=8x3" -frames:v 1 $V/review/${S}_qa.jpg
$FF -y -loglevel error -sseof -3 -i $OUT/$S.mp4 -vf "fps=4,scale=200:-1,tile=12x1" -frames:v 1 $V/review/${S}_tail.jpg
L=$($FF -i $OUT/$S.mp4 -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *[-0-9.]*")
echo "$S ${END}s $L share=$(du -m $DELIVER/$NAME.mp4 | cut -f1)MB -> $DELIVER/$NAME.mp4"
