#!/bin/sh
# Share cut from a finished master (the step local_render.sh does inline), without rendering anything.
#   videos/scripts/make_share.sh MASTER.mp4 [OUT.mp4] [--mb 27] [--sheet]
# OUT defaults to MASTER with _share before .mp4. Video is re-encoded to fit --mb (default 27, the same budget as
# local_render.sh: video bitrate = MB*8192/duration - 330 kbit/s for the audio), BT.709 tagged; the audio is COPIED
# (the finished, measured stream, never a second encode). --sheet also writes OUT_sheet.jpg (16 frames in a row).
# Prints duration, size, and the audio-copy check. Refuses a master with no audio or no duration.
FF=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2
MB=27; SHEET=0; M=; O=
while [ $# -gt 0 ]; do case "$1" in
  --mb) MB=$2; shift;; --sheet) SHEET=1;;
  *) if [ -z "$M" ]; then M=$1; elif [ -z "$O" ]; then O=$1; fi;; esac; shift; done
[ -f "$M" ] || { echo "usage: make_share.sh MASTER.mp4 [OUT.mp4] [--mb N] [--sheet]"; exit 2; }
[ -z "$O" ] && O="${M%.mp4}_share.mp4"
[ "$O" = "$M" ] && { echo "OUT equals MASTER"; exit 2; }
INFO=$($FF -i "$M" 2>&1)
echo "$INFO" | grep -q "Audio:" || { echo "$M has no audio stream: refusing (a share cut of a silent file is a mistake)"; exit 1; }
DUR=$(echo "$INFO" | sed -n 's/.*Duration: \([0-9:.]*\).*/\1/p' | head -1 | awk -F: '{print $1*3600+$2*60+$3}')
[ -n "$DUR" ] && [ "$DUR" != "0" ] || { echo "no duration"; exit 1; }
VB=$(python3 -c "print(max(500,int($MB*8*1024/$DUR - 330)))")
C709="-vf scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
$FF -y -loglevel error -i "$M" -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset slow $C709 -c:a copy "$O" || { echo "encode failed"; rm -f "$O"; exit 1; }
[ "$SHEET" = 1 ] && $FF -y -loglevel error -i "$M" -vf "fps=16/$DUR,scale=180:-1,tile=16x1" -frames:v 1 "${O%.mp4}_sheet.jpg"
# audio-copy check: the audio packet bytes must be identical (md5 of the stream copy)
A=$($FF -loglevel error -i "$M" -vn -c:a copy -f md5 - 2>&1); B=$($FF -loglevel error -i "$O" -vn -c:a copy -f md5 - 2>&1)
[ "$A" = "$B" ] && AC="audio identical" || AC="AUDIO DIFFERS ($A vs $B)"
echo "$O  ${DUR}s  $(du -m "$O" | cut -f1) MB (master $(du -m "$M" | cut -f1) MB)  vb=${VB}k  $AC"
