#!/bin/sh
# Publish finished videos into videos/out on main (Git LFS) of the ARCHIVE repo flip-engineer/automated-content-pipeline-video-studies-archive,
# straight to main: no branches, no pull requests, no Action (the client, 1 Oct: "just have everything go to main").
# The videos are uploaded to the archive's LFS store with lfs_put.py, then one commit that adds their pointer files
# (and moves the piece's older versions into videos/out/archive/) is pushed to main, the same plumbing backup_all.sh
# uses: a blobless depth-1 fetch, read-tree, update-index, write-tree --missing-ok, commit-tree, push. If main moved
# in between, it refetches and redoes the commit. The pipeline repo no longer holds videos.
#   videos/scripts/publish.sh PIECE:VERSION:MASTER[:SHARE] [PIECE:VERSION:MASTER[:SHARE] ...]
#     e.g. publish.sh MELTDOWN:v7:videos/out/farm/meltdown7.mp4:videos/out/farm/meltdown7_share.mp4
#   ARCHIVE_URL=... overrides the target repo (default: the archive). Git push uses git credentials; LFS batch requests use
#   `gh auth token` unless an importer supplies an Authorization header.
#   Each lands as videos/out/PIECE_VERSION.mp4 (master, full quality) + PIECE_VERSION_share.mp4 (<30 MiB delivery copy); keep both. Older PIECE_v* move to videos/out/archive/.
#   (Until 1 Oct this pushed an incoming/<id> branch for the publish-videos Action to apply; that path is retired.)
#   GATE=1 runs the publish gate (videos/scripts/gate.py) on each SHARE (else MASTER) first, prints its report and
#   stops only on breakage (no audio, a file that won't decode); everything else it finds is printed as guidance.
#   Every file's audio is then checked for delivery (master_audio.py: decoded true peak <= -1 dBTP, master and share
#   carrying one tested stream) and the piece is drawn into the slate's feed ledger (videos/web/audio/finish/slate.json,
#   sheet at videos/out/finish_slate.png). PUBLISH_DRY=1 does all of that and stops before uploading anything.
#   GATE_SCENE=scene overrides the scene (default: from the file name, else the PIECE name); GATE_ARGS="..." is
#   passed through (e.g. GATE_ARGS="--script research/scripts_final/meltdown.json --skip text").
set -e
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
# File paths in the specs may be relative to the caller's cwd OR to the repo root (the videos/out/farm/... form in the
# examples above); resolve each to an absolute path up front so every later step (which cd's) sees the same file.
ABS() { case "$1" in "") ;; /*) echo "$1" ;; *) if [ -e "$1" ]; then echo "$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")"; elif [ -e "$REPO/$1" ]; then echo "$REPO/$1"; else echo "publish: file not found: $1" >&2; return 1; fi ;; esac; }
ARGS=""
for spec in "$@"; do
  P=$(echo "$spec" | cut -d: -f1); V=$(echo "$spec" | cut -d: -f2); M=$(ABS "$(echo "$spec" | cut -d: -f3)") || exit 1; SH=$(ABS "$(echo "$spec" | cut -d: -f4)") || exit 1
  ARGS="$ARGS $P:$V:$M${SH:+:$SH}"
done
# shellcheck disable=SC2086
set -- $ARGS
# Notes that arrived mid-round (research/inbox/<PIECE>.md): printed as a notice before anything is published; never blocks.
for spec in "$@"; do python3 "$SCRIPT_DIR/inbox.py" show "$(echo "$spec" | cut -d: -f1)" || true; done
if [ "${GATE:-0}" = 1 ]; then
  GFAIL=0
  for spec in "$@"; do
    P=$(echo "$spec" | cut -d: -f1); M=$(echo "$spec" | cut -d: -f3); SH=$(echo "$spec" | cut -d: -f4)
    F=${SH:-$M}
    # shellcheck disable=SC2086
    python3 "$SCRIPT_DIR/gate.py" "$F" --scene "${GATE_SCENE:-auto:$P}" $GATE_ARGS || GFAIL=1
  done
  if [ "$GFAIL" = 1 ]; then
    if [ "${GATE_FORCE:-0}" = 1 ]; then echo "gate: FAIL above, publishing anyway (GATE_FORCE=1)"
    else echo "gate: FAIL above: nothing was published (fix it, or GATE_FORCE=1 to publish anyway)"; exit 1; fi
  fi
fi
# The client's standing rulings (archive audit P5, publish_guard.py): a line he rejected or ruled off limits, or the stock sonic logo
# in the mix, stops the publish. PUBLISH_FLAGGED=1 publishes anyway (the report is printed either way); a guard error never stops it.
for spec in "$@"; do
  P=$(echo "$spec" | cut -d: -f1); M=$(echo "$spec" | cut -d: -f3); SH=$(echo "$spec" | cut -d: -f4)
  RC=0; python3 "$SCRIPT_DIR/publish_guard.py" "$P" "${SH:-$M}" --scene "${GATE_SCENE:-auto:$P}" || RC=$?
  if [ "$RC" = 2 ]; then
    if [ "${PUBLISH_FLAGGED:-0}" = 1 ]; then echo "publish guard: STOP above for $P, publishing anyway (PUBLISH_FLAGGED=1)"
    else echo "publish guard: STOP above for $P: nothing was published (fix it, or PUBLISH_FLAGGED=1 to publish anyway)"; exit 1; fi
  fi
done
R=${ARCHIVE_URL:-https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive}
if [ "${PUBLISH_DRY:-0}" = 1 ] && [ -z "${ACP_SLATE_LEDGER:-}" ]; then   # a dry run records on a copy of the ledger
  export ACP_SLATE_LEDGER=$(mktemp "${TMPDIR:-/tmp}/slate_dry.XXXXXX.json"); cp "$REPO/videos/web/audio/finish/slate.json" "$ACP_SLATE_LEDGER"
fi
G=$(mktemp -d "${TMPDIR:-/tmp}/acp-publish.XXXXXX")
trap 'rm -rf "${G:?}"' EXIT
PUTS="$G/puts.txt"; : > "$PUTS"; PIECES=""; MSG=""
for spec in "$@"; do
  P=$(echo "$spec" | cut -d: -f1); V=$(echo "$spec" | cut -d: -f2); M=$(echo "$spec" | cut -d: -f3); SH=$(echo "$spec" | cut -d: -f4)
  PIECES="$PIECES $P"; MSG="$MSG ${P}_$V"
  # audio at publish (AUDIO FINISH c1): the decoded true peak at or under -1 dBTP, master and share carrying ONE tested
  # stream (master_audio.py: a file already under is untouched; a repair is made once, from the PCM source when the
  # render's finish report names it), then the piece recorded in the ledger of what shipped (engine/finish.py slate:
  # a log of the measured loudness; it compares nothing and decides nothing)
  python3 "$SCRIPT_DIR/master_audio.py" "$M" ${SH:+--share "$SH"} --scene "${GATE_SCENE:-$(basename "$M" .mp4)}"
  (cd "$REPO/videos" && python3 -m engine.finish slate --add "${SH:-$M}" --piece "${P}_$V") \
     || echo "slate ledger: not updated (see above)"
  if [ "${PUBLISH_DRY:-0}" = 1 ]; then echo "PUBLISH_DRY=1: ${P}_$V checked and mastered locally, not uploaded"; continue; fi
  echo "videos/out/${P}_$V.mp4 $(python3 "$SCRIPT_DIR/lfs_put.py" "$M")" >> "$PUTS"
  [ -n "$SH" ] && echo "videos/out/${P}_${V}_share.mp4 $(python3 "$SCRIPT_DIR/lfs_put.py" "$SH")" >> "$PUTS"
done
if [ "${PUBLISH_DRY:-0}" = 1 ]; then echo "PUBLISH_DRY=1: nothing uploaded or committed"; exit 0; fi
cd "$G" && git init -q && git remote add origin "$R" && git config extensions.partialClone origin
for i in 1 2 3 4 5; do
  git fetch -q --filter=blob:none --depth=1 origin main
  BASE=$(git rev-parse FETCH_HEAD); rm -f .git/index; git read-tree "$BASE"
  for P in $PIECES; do   # retire: the piece's current versions move to videos/out/archive/
    git ls-files -s -- "videos/out/${P}_v*.mp4" | while read -r mode blob stage path; do
      git update-index --force-remove "$path"
      git update-index --add --cacheinfo "$mode,$blob,videos/out/archive/$(basename "$path")"
      echo "retired $path"
    done
  done
  while read -r dest oid size; do
    ptr=$(printf 'version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize %s\n' "$oid" "$size" | git hash-object -w --stdin)
    git update-index --add --cacheinfo "100644,$ptr,$dest"
  done < "$PUTS"
  C=$(echo "Publish videos:$MSG" | git -c user.name=Claude -c user.email=noreply@anthropic.com commit-tree "$(git write-tree --missing-ok)" -p "$BASE")
  git -c pack.window=0 -c core.bigFileThreshold=1 push -q --no-thin origin "$C:refs/heads/main" 2>&1 | grep -v '^remote:\|negotiation\|acknowledgments' || true
  if [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$C" ]; then
    echo "published to main ($C):$MSG"; exit 0
  fi
  echo "main moved, retrying ($i)"; sleep $((i * 5))
done
echo "publish: could not land on main after 5 tries (the videos are in LFS; rerun to retry the commit)"; exit 1
