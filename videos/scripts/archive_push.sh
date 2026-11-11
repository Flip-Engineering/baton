#!/bin/sh
# Push every rendered MP4 to the repo's `archive` branch as plain git files (no LFS: the environment blocks lfs.github.com).
# Files over 95 MB are split into .partNN pieces; restore.sh rejoins them. Pushed in ~1.2 GB batches.
set -e
SRC=/home/user/acp-agitprop/videos; A=/home/user/mvs-archive; URL=https://github.com/flip-engineer/automated-content-pipeline
mkdir -p $A && cd $A
[ -d .git ] || { git init -q && git remote add origin $URL && git checkout -q --orphan archive; }
cat > README.md <<'R'
# Video archive (branch `archive`)

Every rendered master, share copy and superseded version of the ACP music videos, as plain git files.
Files larger than 95 MB are split into `.partNN` pieces. Run `sh restore.sh` to rejoin them into `.mp4`s.

- `current/` masters as of the last sync
- `share/` share copies (under 30 MiB)
- `versions/` superseded versions, kept on the client's instruction: nothing is deleted
R
cat > restore.sh <<'R'
#!/bin/sh
# Rejoin split videos: every name.mp4.part00, part01, ... becomes name.mp4
for p in $(find . -name '*.mp4.part00'); do b=${p%.part00}; cat "$b".part* > "$b" && echo "restored $b"; done
R
batch=0; size=0
commit_push() { git add -A && git -c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "Archive batch $batch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XkFQQwGRpJN2GiVpXu9H78" && git push -q -u origin archive && echo "pushed batch $batch"; batch=$((batch+1)); size=0; }
add() {   # add <src> <dest-dir>
  mkdir -p "$2"; n=$(basename "$1"); b=$(stat -c %s "$1")
  if [ -e "$2/$n" ] || [ -e "$2/$n.part00" ]; then return; fi
  if [ $b -gt 99614720 ]; then split -b 95m -d "$1" "$2/$n.part"; else cp "$1" "$2/$n"; fi
  size=$((size + b)); [ $size -gt 1200000000 ] && commit_push || true
}
for f in $SRC/out/*.mp4; do add "$f" current; done
for f in $SRC/out/share/*.mp4; do add "$f" share; done
for f in $SRC/archive/*.mp4; do add "$f" versions; done
commit_push
ls -R | grep -c mp4
