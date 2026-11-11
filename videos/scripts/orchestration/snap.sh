#!/bin/bash
# Safe WIP snapshot of the studio's work on the branch. Usage: snap.sh "<message>"
cd /home/user/automated-content-pipeline || exit 1
# one snapshot at a time (the auto-snapshot monitor and a manual run must not race for .git/index.lock)
exec 9>/tmp/acp_snap.lock; flock -w 120 9 || { echo "snap: another snapshot is running"; exit 0; }
msg="${1:-studio WIP snapshot}"
# farm_bench.py (builders) touches the shared index too, without this lock: wait out its brief index.lock
for i in $(seq 1 60); do [ -e .git/index.lock ] || break; sleep 1; done
bad=0
for f in $(git status --porcelain videos/web videos/scripts videos/tools research | awk '{print $NF}' | grep -E '\.m?js$'); do
  [ -f "$f" ] || continue
  case "$f" in */orchestration/wf_*) continue;; esac
  node --check "$f" 2>/dev/null || { echo "SYNTAX-SKIP $f"; bad=1; }
done
git add -A research videos/web videos/scripts videos/tools videos/sources videos/blender videos/gpu 2>/dev/null
git add -u videos/review 2>/dev/null   # tracked review files (NOTES of other studios, tooling)
find videos/review/studio_human_c8 videos/review/studio_clothing_c1 videos/review/studio_clothing_c2 -type f \( -name '*.md' -o -name 'board*.jpg' -o -path '*/boards/*.jpg' -o -name '*.py' -o -name '*.json' -o -name '*.sh' -o -name '*.csv' -o -name '*.mjs' -o -name '*.js' \) 2>/dev/null \
  | grep -v -e refs_local -e /stills -e __pycache__ -e /dev/ -e /proof/ -e /scratch -e _scratch -e /export/ | xargs -r git add -f
# guard: never commit photographs (new images under figure_refs, or anything from the photo cache / refs_local)
for f in $(git diff --cached --name-only --diff-filter=A | grep -E '\.(jpe?g|png|webp)$'); do
  case "$f" in *figure_refs/*|*refs_local*|*figure_photos*|*photo*) git reset -q -- "$f"; echo "GUARD-UNSTAGED $f";; esac
done
# guard: package.json changed -> bring the lockfile along (the farm runs npm ci, which fails on a stale lock)
if git diff --cached --name-only | grep -qx 'videos/web/package.json'; then
  (cd videos/web && timeout 300 npm install --package-lock-only --ignore-scripts --no-audit --no-fund >/dev/null 2>&1) \
    && git add videos/web/package-lock.json && echo "LOCK-SYNCED videos/web/package-lock.json" \
    || { git reset -q -- videos/web/package.json; echo "GUARD-UNSTAGED videos/web/package.json (lockfile could not be synced)"; }
fi
# guard: render.mjs is the farm's verified renderer (1efc5034): the homelab worker refuses every bench whose commit's render.mjs differs
# ('Renderer changed: adapter needs review'; bf707c53 broke 19 benches that way). A change there needs the client to re-verify the adapter.
if ! git diff --cached --quiet 1efc5034 -- videos/web/render.mjs 2>/dev/null; then
  git reset -q -- videos/web/render.mjs; git checkout -q 1efc5034 -- videos/web/render.mjs 2>/dev/null
  echo "GUARD-RESTORED videos/web/render.mjs (the farm's verified renderer; a change needs the client's adapter review)"
fi
# unstage syntax-broken js so a half-written file never lands
if [ $bad = 1 ]; then for f in $(git diff --cached --name-only | grep -E '\.m?js$'); do [ -f "$f" ] && ! node --check "$f" 2>/dev/null && git reset -q -- "$f"; done; fi
git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
n=$(git diff --cached --name-only | wc -l)
git commit -q -m "$msg

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WuNoxBhnYSTQtApcjerFok" || exit 1
# (8 Oct, the client: 'we do not want to fan our completed work into siloed branches, it all gets merged into main') the studio works ON
# main: push there; main also takes the farm's queue commits every minute, so a refused push merges origin/main (only farm/ job files
# change on that side, never a file the builders touch) and pushes again
# a merge refuses while anything is staged in the shared index (farm_bench --include-deps stages there briefly): abort, wait, retry
pushed=0
for i in 1 2 3 4 5 6; do
  git push -q origin HEAD:main 2>/dev/null && { pushed=1; break; }
  git fetch -q origin main 2>/dev/null && { git merge -q --no-edit -m "Merge origin/main (the farm's queue) into the studio's work

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WuNoxBhnYSTQtApcjerFok" origin/main >/dev/null 2>&1 || git merge --abort 2>/dev/null; }
  sleep $((2**i))
done
[ $pushed = 1 ] || echo "snap: not pushed after 6 tries (merge of origin/main blocked: something staged, or a conflict): the next snapshot retries"
echo "committed $n files: $(git log --oneline -1)"
