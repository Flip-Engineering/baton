#!/bin/sh
# quick stills at beats + labelled sheet: scripts/stills_quick.sh <scene> <bpm> <out.jpg> <beat> ...
# TOOLING WM1 (2026-09-28): renders into a private temp dir (no longer deletes or overwrites out/stills, which git tracks,
# and two agents no longer clobber each other); beats use the song's own BPM (<bpm> is kept for old callers and only
# checked); ACP_REUSE_AUDIO=1 skips the song rebuild. Keep the stills with ACP_KEEP_STILLS=DIR.
cd "$(dirname "$0")/.." && export NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt
s=$1; bpm=$2; out=$3; shift 3
[ $# -gt 0 ] || { echo "stills_quick.sh: no beats given (usage: <scene> <bpm> <out.jpg> <beat> ...)" >&2; exit 2; }
B=$(printf '%s\n' "$@" | paste -sd,)
D=${ACP_KEEP_STILLS:-$(mktemp -d "${TMPDIR:-/tmp}/stillsq_${s}.XXXXXX")}
mkdir -p logs "$D"
L=logs/${s}_quick.$$.log
node web/render.mjs "$s" --beats "$B" --out "$D" --sheet "$out" > "$L" 2>&1 || { tail -5 "$L"; exit 1; }
python3 -c "import json,sys; h=json.load(open('out/.$s.hits.json')); b=float('$bpm' or 0); sys.exit(0) if not b or abs(h['bpm']-b)<0.01 else print(f'stills_quick: note, song BPM is {h[\"bpm\"]} (you passed {b}); beats used the song BPM')"
grep -i "error\|STALE" "$L" | head
[ -n "$ACP_KEEP_STILLS" ] || rm -rf "$D"
