#!/bin/sh
# Local render (no farm session): the same render/finish/share/sheet steps as farm_job.sh, without git.
#   videos/scripts/local_render.sh scene:closerBeat[:bpm] [...]   -> out/farm/<scene>.mp4, _share.mp4, _sheet.jpg,
#   .finish.json (every audio move, the delivered stream measured) and _finish.png (the level plan over the cues)
# bpm is read from the song when omitted.
#   local_render.sh --reuse-audio scene[:closerBeat[:bpm]] ...   (or REUSE_AUDIO=1)
#     keeps the existing out/.<scene>.wav (+ .hits.json) instead of rebuilding the song through songs.py. For a piece whose
#     live score is a standalone script (e.g. web/audio/songs2/ascended_c13.py, not wired as songs.ascended) that was
#     rendered to out/.<scene>.wav: without this the script silently rebuilds the OLD song. Refuses (nothing rendered
#     for that scene) if the wav is missing. bpm must then be given in the spec (the old song's bpm is not read).
#   local_render.sh --seg [--span T0-T1[,T2-T3] | --span-beats B0-B1[,..]] [--seg-s S] [--wait-disk MIN] [--reuse-audio] scene:closer[:bpm]
#     opt-in SEGMENTED mode (TOOLING c23): the picture is rendered through tools/segrender.py's persistent per-scene cache
#     (out/<scene>.seg/, about one master's size on disk), then the same finish, share copy, sheet and report run as
#     above. The first --seg run renders every segment once; later runs with --span re-render only the segments that
#     overlap the span and rejoin. --span / --span-beats imply --seg. If the song's length or the segment plan changed,
#     unchanged segments are reused and the rest re-rendered (it says so). Without --span, --seg resumes whatever is
#     cached. Default (no --seg) is unchanged. Drop the cache:  python3 tools/segrender.py <scene> --drop-cache
#   local_render.sh --silent [--seg] scene:closerBeat:bpm ...
#     a picture with NO soundtrack (farm benches: the client, 8 Oct, 'bench doesnt need a soundtrack'): no song is built,
#     no finish, no loudness; the picture runs to the closer + 1.4 s and the master is that picture as drawn, with no audio
#     stream. render.mjs stays the farm-verified one: it reads a silent stand-in (tools/silent_input.py) and the audio is dropped.
#     The bpm in the spec is only the unit the closer is given in.
#   Options may come in any order before the specs; all apply to every spec given.
cd "$(dirname "$0")/.."
REUSE_AUDIO=${REUSE_AUDIO:-0}; SILENT=0
SEG=${LOCAL_RENDER_SEG:-0}; SPAN=""; SPANB=""; SEGS=""; WAITD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --reuse-audio) REUSE_AUDIO=1; shift ;;
    --silent) SILENT=1; shift ;;
    --seg) SEG=1; shift ;;
    --span) SEG=1; SPAN="$2"; shift 2 ;;
    --span=*) SEG=1; SPAN="${1#--span=}"; shift ;;
    --span-beats) SEG=1; SPANB="$2"; shift 2 ;;
    --span-beats=*) SEG=1; SPANB="${1#--span-beats=}"; shift ;;
    --seg-s) SEGS="$2"; shift 2 ;;
    --wait-disk) WAITD="$2"; shift 2 ;;
    *) break ;;
  esac
done
FF=/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2
mkdir -p out/farm logs
# BT.709 colour for every re-encode (web/enc_args.mjs): converts an old untagged (601) input, no-op on a 709 one
C709="-vf scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv"
for spec in "$@"; do
  s=$(echo $spec | cut -d: -f1); e=$(echo $spec | cut -d: -f2); bpm=$(echo $spec | cut -d: -f3)
  if [ "$SILENT" = 1 ]; then
    [ -z "$bpm" ] && { echo "$s: --silent needs the bpm in the spec ($s:$e:BPM), the unit of the closer"; continue; }
    END=$(python3 -c "print('%g' % round($e*60/$bpm + 1.4, 3))")
    echo "== $s (silent: closer b$e at $bpm bpm, picture to ${END}s, no soundtrack)"
    python3 tools/silent_input.py "$s" $END --bpm $bpm || continue
    if [ "$SEG" = 1 ]; then
      python3 tools/segrender.py "$s" --silent --cache --duration $END --final out/farm/$s.mp4 ${SPAN:+--span "$SPAN"} ${SEGS:+--seg-s "$SEGS"} \
        ${WAITD:+--wait-disk "$WAITD"} > logs/local_$s.log 2>&1 || { tail -20 logs/local_$s.log; python3 tools/silent_input.py "$s" --clean; continue; }
      grep -E "NOTICE|span invalidates|no cached|segment .* attempt|joined|seam check|cache kept|stalled" logs/local_$s.log | sed 's/^/  /'
    else
      node web/render.mjs "$s" --reuse-audio --to $END --file out/$s.mp4 > logs/local_$s.log 2>&1 || { tail -20 logs/local_$s.log; python3 tools/silent_input.py "$s" --clean; continue; }
      $FF -y -loglevel error -i out/$s.mp4 -map 0:v -c copy -an -movflags +faststart out/farm/$s.mp4 && rm -f out/$s.mp4
    fi
    python3 tools/silent_input.py "$s" --clean
    VB=$(python3 -c "print(int(27*8*1024/$END - 330))")
    $FF -y -loglevel error -i out/farm/$s.mp4 -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset slow $C709 -an out/farm/${s}_share.mp4
    $FF -y -loglevel error -i out/farm/$s.mp4 -vf "fps=16/$END,scale=180:-1,tile=16x1" -frames:v 1 out/farm/${s}_sheet.jpg
    echo "$s ${END}s silent" | tee -a out/farm/REPORT.txt
    continue
  fi
  if [ "$REUSE_AUDIO" = 1 ] && [ -z "$bpm" ]; then echo "$s: --reuse-audio needs the bpm in the spec ($s:$e:BPM)"; continue; fi
  [ -z "$bpm" ] && bpm=$(cd web/audio && python3 -c "import sys; sys.path.insert(0,'../..'); import songs; print(getattr(songs,'$s')().bpm)")
  E=$(python3 -c "print('%g' % round($e*60/$bpm,3))")
  echo "== $s (closer b$e at $bpm bpm)"
  # the song first (what render.mjs would build), so the finish stage can say where the piece ends: the song's own
  # built ending is kept (AUDIO FINISH c1: engine/finish.py span; the piece's finish sheet can ask for the old
  # lock + 1.4 s fade), and the picture is drawn to that end
  if [ "$REUSE_AUDIO" = 1 ]; then
    [ -s out/.$s.wav ] || { echo "$s: --reuse-audio but out/.$s.wav is missing, nothing rendered"; continue; }
    echo "  keeping existing out/.$s.wav ($(date -r out/.$s.wav '+%F %T'))"
  else python3 web/audio/make_audio.py "$s" --quiet > logs/local_${s}_song.log 2>&1; fi || { tail -20 logs/local_${s}_song.log; echo "$s: SONG FAILED, nothing rendered"; continue; }
  END=$(python3 -m engine.finish span --scene "$s" --wav out/.$s.wav --lock $E) || { echo "$s: finish span failed"; continue; }
  if [ "$SEG" = 1 ]; then
    # segmented: segrender's per-scene cache; the join writes out/$s.mp4 (picture generation one, as the single render).
    # segrender never fails on a changed plan or a stale cache: it prints what it re-rendered and why (logs/local_$s.log).
    python3 tools/segrender.py "$s" --cache --duration $END --final out/$s.mp4 ${SPAN:+--span "$SPAN"} ${SPANB:+--span-beats "$SPANB"} \
      ${SEGS:+--seg-s "$SEGS"} ${WAITD:+--wait-disk "$WAITD"} > logs/local_$s.log 2>&1 || { tail -20 logs/local_$s.log; continue; }
    grep -E "NOTICE|span invalidates|no cached|segment .* attempt|joined|seam check|cache kept|stalled" logs/local_$s.log | sed 's/^/  /'
  else
  node web/render.mjs "$s" --reuse-audio --to $END --file out/$s.mp4 > logs/local_$s.log 2>&1 || { tail -20 logs/local_$s.log; continue; }
  fi
  # one picture generation (STUDIO FINISH c1): render.mjs drew only up to $END, so the picture is copied, never
  # re-encoded. The audio is finished once from the song's PCM (engine/finish.py: span, sub, the piece's rides,
  # stops, its level against the slate, the pre-encode ceiling, ONE encode measured as decoded); the share copy
  # below copies that exact stream. If the finish fails nothing ships: there is no second, different master.
  python3 -m engine.finish render --scene "$s" --wav out/.$s.wav --lock $E --to $END --video out/$s.mp4 \
    -o out/farm/$s.mp4 --report out/farm/$s.finish.json > /dev/null 2> logs/local_${s}_finish.log \
    || { cat logs/local_${s}_finish.log; echo "$s: FINISH FAILED: nothing shipped (out/$s.mp4 is the unfinished render)"; rm -f out/farm/$s.mp4; continue; }
  sed 's/^/  /' logs/local_${s}_finish.log
  python3 -m engine.finish plan out/farm/$s.mp4 --scene "$s" --report out/farm/$s.finish.json -o out/farm/${s}_finish.png > /dev/null || true
  VB=$(python3 -c "print(int(27*8*1024/$END - 330))")
  $FF -y -loglevel error -i out/farm/$s.mp4 -c:v libx264 -b:v ${VB}k -maxrate $((VB*2))k -bufsize $((VB*2))k -preset slow $C709 -c:a copy out/farm/${s}_share.mp4
  $FF -y -loglevel error -i out/farm/$s.mp4 -vf "fps=16/$END,scale=180:-1,tile=16x1" -frames:v 1 out/farm/${s}_sheet.jpg
  L=$($FF -i out/farm/$s.mp4 -af ebur128 -f null - 2>&1 | grep -A1 "Integrated loudness" | grep -o "I: *[-0-9.]*")
  echo "$s ${END}s $L" | tee -a out/farm/REPORT.txt
done
