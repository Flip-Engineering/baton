#!/bin/sh
# Re-synthesize a finished video's audio (current songs, current engine flags, sonic logo) and swap it in without
# re-rendering the picture. Only valid when the song's BPM and beat grid are the ones the picture was rendered to.
#   videos/scripts/remux_audio.sh <scene> <master.mp4>   -> <master>_remux.mp4 and <master>_remux_share.mp4
set -e
cd "$(dirname "$0")/.."
FF=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2
S=$1; M=$2; O=${M%.mp4}_remux.mp4
python3 web/audio/make_audio.py "$S" --quiet > /dev/null
END=$($FF -i "$M" 2>&1 | grep -o "Duration: [0-9:.]*" | awk -F'[: ]' '{print $3*3600+$4*60+$5}')
# the picture is fixed, so the span is the master's length; LOCK=<seconds> (env) lets the finish stage say whether the
# song's built ending fits inside it. The audio is finished once from the PCM (engine/finish.py); a failure stops here.
python3 -m engine.finish render --scene "$S" --wav out/.$S.wav ${LOCK:+--lock $LOCK} --to $END --video "$M" -o "$O" \
  --report "${O%.mp4}.finish.json" > /dev/null
VB=$(python3 -c "print(int(27*8*1024/$END - 330))")
$FF -y -loglevel error -i "$O" -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset slow -vf scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a copy "${O%.mp4}_share.mp4"
L=$($FF -i "$O" -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *[-0-9.]*")
echo "$S remuxed ${END}s $L -> $O"
