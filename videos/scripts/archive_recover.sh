#!/bin/sh
# Put finished videos that exist only on this machine into the archive WITHOUT publishing them as a piece version (nothing is retired):
#   sh videos/scripts/archive_recover.sh SUBDIR file.mp4 [file2.mp4 ...]   -> archive main: videos/out/recovered/SUBDIR/<basename>
# Same mechanism as publish.sh (lfs_put.py uploads the bytes to the archive's LFS store; the pointer is committed onto main).
set -e
SUB=$1; shift
[ -n "$SUB" ] && [ $# -gt 0 ] || { echo "usage: archive_recover.sh SUBDIR file ..." >&2; exit 2; }
R=${ARCHIVE_URL:-https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive}
mkdir -p /home/user/farm; G=$(mktemp -d /home/user/farm/_rec.XXXXXX); PUTS=$G.puts; : > "$PUTS"
for f in "$@"; do
  echo "videos/out/recovered/$SUB/$(basename "$f") $(python3 /home/user/acp-agitprop/videos/scripts/lfs_put.py "$f")" >> "$PUTS"
done
cd "$G" && git init -q && git remote add origin "$R" && git config extensions.partialClone origin
for i in 1 2 3 4 5; do
  git fetch -q --filter=blob:none --depth=1 origin main
  BASE=$(git rev-parse FETCH_HEAD); rm -f .git/index; git read-tree "$BASE"
  while read -r dest oid size; do
    ptr=$(printf 'version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize %s\n' "$oid" "$size" | git hash-object -w --stdin)
    git update-index --add --cacheinfo "100644,$ptr,$dest"
  done < "$PUTS"
  C=$(echo "Recover local-only videos into videos/out/recovered/$SUB" | git -c user.name=Claude -c user.email=noreply@anthropic.com commit-tree "$(git write-tree --missing-ok)" -p "$BASE")
  git -c pack.window=0 -c core.bigFileThreshold=1 push -q --no-thin origin "$C:refs/heads/main" 2>&1 | grep -v '^remote:\|negotiation\|acknowledgments' || true
  if [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$C" ]; then echo "recovered to main ($C):"; cat "$PUTS"; rm -rf "$G" "$PUTS"; exit 0; fi
  echo "main moved, retrying ($i)"; sleep $((i * 5))
done
echo "archive_recover: could not land on main (the bytes are in LFS; rerun)"; exit 1
