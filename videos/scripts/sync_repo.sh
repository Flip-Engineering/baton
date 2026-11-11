#!/bin/sh
# Sync the working project into the GitHub repo clone (flip-engineer/automated-content-pipeline) and push main.
# Published videos and review material now live in flip-engineer/automated-content-pipeline-video-studies-archive (videos/scripts/publish.sh),
# not here: new files under videos/out/** and videos/review/** aren't added (kept in git: videos/out/.*.hits.json), and
# whatever the repo already tracks there (e.g. the client's own commits) is left as it is.
# videos/out and videos/review are never copied into the mirror or deleted from it; what the repo tracks there stays tracked. Heavy local files (videos/archive,
# renders, node_modules) stay local.
#   videos/scripts/sync_repo.sh "commit message"
SRC=/home/user/acp-agitprop; DST=/home/user/music-video-studies
# one sync at a time (builders may sync before posting a farm job while the hourly backup runs)
exec 9>/tmp/acp_sync_repo.lock; flock 9
# Every sync is a delta sync since 8 Oct: only the paths the project's own COMMITS changed go onto main, through a blobless
# fetch (videos/scripts/sync_delta.py). Uncommitted work is not pushed; commit it to sync it. The client now merges other
# studios' work into main (a8726ff, 2749 files), which the working-tree snapshot below would refuse or delete, and the
# snapshot's fetch of main pulled over 1.3 GB of blobs into the mirror, more than the disk holds (two failed runs left
# 1.35 GB of tmp_pack files there). SYNC_HEAD=1 is accepted as before. SYNC_SNAPSHOT=1 runs the old snapshot; do not
# use it while other studios write to main.
if [ "${SYNC_SNAPSHOT:-0}" != 1 ]; then exec python3 "$SRC/videos/scripts/sync_delta.py" "$1"; fi
export GIT_LFS_SKIP_SMUDGE=1
# The mirror's files are hard links to the project's (below), so an in-place edit in the project shows in the mirror as a
# local change and `git pull` would refuse. Fetch instead and move only the branch and index onto origin/main
# (reset --mixed writes nothing to the working tree); the snapshot below replaces the tree anyway.
cd "$DST" && git fetch -q origin main && git reset -q --mixed origin/main || { echo "fetch failed; not syncing"; exit 1; }
# Refuse loudly if someone else changed files upstream that the project doesn't have yet (3 Oct: a sync silently reverted the
# client's farm --dependencies work, because the snapshot below replaces the tree with the project's). Commits by others since the
# last commit this script made; every file they touched (outside farm/, videos/out, videos/review) must match the project's copy.
BASE=$(git log origin/main --format=%H --author='^Claude <' --grep='^farm: ' --invert-grep -1)
if [ -n "$BASE" ]; then
  STALE=$(git log "$BASE..origin/main" --format= --name-only --perl-regexp --author='^(?!Claude <)' -- . ':!farm' ':!videos/out' ':!videos/review' | sort -u | while read -r f; do
    [ -n "$f" ] || continue
    up=$(git rev-parse -q --verify "origin/main:$f" 2>/dev/null)
    if [ -z "$up" ]; then [ -e "$SRC/$f" ] && echo "$f (deleted upstream)"
    elif [ ! -e "$SRC/$f" ] || [ "$(git hash-object "$SRC/$f")" != "$up" ]; then echo "$f"; fi
  done)
  if [ -n "$STALE" ]; then
    echo "sync_repo: upstream changed these since the last sync and the project differs; bring them into $SRC first" >&2
    echo "  (git -C $DST show origin/main:PATH > $SRC/PATH, merging any local edits), then sync again. Not syncing:" >&2
    echo "$STALE" | sed 's/^/  /' >&2; exit 1
  fi
fi
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name README.md ! -name .gitattributes ! -name videos ! -name farm -exec rm -rf {} +
[ -d videos ] && find videos -mindepth 1 -maxdepth 1 ! -name out ! -name review -exec rm -rf {} +
# The snapshot is hard links to the project's files, not copies (2 Oct: a copied mirror cost 1.3 GB on a disk that kept
# stopping renders). git replaces files on checkout or pull (unlink, then write) rather than writing into them, so
# nothing done in the mirror reaches the project's files through a link.
cd "$SRC" && python3 - "$SRC" "$DST" <<'EOF'
import os, sys, shutil
src, dst = sys.argv[1:3]
skip_names = {'.git', 'node_modules', '__pycache__'}
skip_rel = {'farm', 'videos/archive', 'videos/out', 'videos/review', 'videos/models'}
for root, dirs, files in os.walk(src):
    rel = os.path.relpath(root, src)
    rel = '' if rel == '.' else rel
    dirs[:] = [d for d in dirs if d not in skip_names and os.path.join(rel, d) not in skip_rel]
    os.makedirs(os.path.join(dst, rel), exist_ok=True)
    for f in files:
        if f.endswith('.mp4'): continue
        s, d = os.path.join(root, f), os.path.join(dst, rel, f)
        if os.path.islink(s): os.symlink(os.readlink(s), d); continue
        try: os.link(s, d)
        except OSError: shutil.copy2(s, d)
EOF
# keep the repo's engine if the local one is mid-edit (it must import Song and render a song)
if ! (cd "$SRC/videos" && python3 -c "import sys; sys.path.insert(0,'web/audio'); import songs; songs.productive().render()" >/dev/null 2>&1); then
  echo "local engine/songs not importable: keeping the repo's engine/audio.py and songs.py"; (cd "$DST" && git checkout -- videos/engine/audio.py videos/web/audio/songs.py 2>/dev/null || true)
fi
# PIN="path ..." keeps the repo's copy of files that are mid-edit locally (e.g. an engine rewrite still being judged)
for f in $PIN; do (cd "$DST" && git checkout -- "$f" 2>/dev/null && echo "pinned $f"); done
# SYNC_HEAD=1: the pipeline gets the project's committed HEAD, not its working tree. Files mid-edit in the project (modified or deleted
# against HEAD) are written from HEAD, with HEAD's mode; untracked files are left out. Use it before posting farm jobs while other
# agents work in the checkout: a job pins the pipeline commit, and on 8 Oct one working-tree sync carried a dozen unreviewed lib, scene
# and song edits from other agents into the renders it pinned.
if [ "${SYNC_HEAD:-0}" = 1 ]; then
python3 - "$SRC" "$DST" <<'EOF'
import os, subprocess, sys
src, dst = sys.argv[1:3]
ex = [':!farm', ':!videos/out', ':!videos/review', ':!videos/archive', ':!videos/models']
g = lambda *a: subprocess.run(['git', '-C', src, *a], capture_output=True)
n = u = 0
for p in filter(None, g('diff', '--name-only', '-z', 'HEAD', '--', '.', *ex).stdout.split(b'\0')):
    p = p.decode(); d = os.path.join(dst, p)
    if os.path.lexists(d): os.unlink(d)
    t = g('ls-tree', 'HEAD', '--', p).stdout.decode().split()
    if not t: continue                                        # not in HEAD (staged-new): left out
    blob = g('cat-file', 'blob', t[2]).stdout
    os.makedirs(os.path.dirname(d), exist_ok=True)
    if t[0] == '120000': os.symlink(blob.decode(), d)
    else:
        open(d, 'wb').write(blob); os.chmod(d, 0o755 if t[0] == '100755' else 0o644)
    n += 1
for p in filter(None, g('ls-files', '--others', '--exclude-standard', '-z', '--', '.', *ex).stdout.split(b'\0')):
    d = os.path.join(dst, p.decode())
    if os.path.lexists(d): os.unlink(d); u += 1
print(f'SYNC_HEAD: {n} mid-edit files written from HEAD, {u} untracked files left out')
EOF
fi
cd "$DST" && printf 'node_modules/\n__pycache__/\nvideos/logs/\nvideos/archive/\nvideos/models/kokoro/\nvideos/out/*\n!videos/out/.*.hits.json\nvideos/review/\n' > .gitignore
# farm/ (the render queue, videos/scripts/farm.py) lives only in the repo: workers commit to it there, so the snapshot
# never copies, deletes or stages it.
# Files under videos/out and videos/review that are tracked in the repo stay tracked: the snapshot never copies those
# folders, so it must not record them as deleted. (2 Oct: the client committed "Bring the archived farm renders into
# main" and the old untracking step here removed them from main on the next backup.) New files there are still not
# added (.gitignore), so renders go to the archive repo as before.
git add -A -- . ':!farm' ':!videos/out' ':!videos/review' && git add -A -- videos/out/.*.hits.json 2>/dev/null; git diff --cached --quiet || git -c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XkFQQwGRpJN2GiVpXu9H78"
for i in 1 2 3; do git push -q origin HEAD:main 2>&1 | tail -3 && git fetch -q origin main && git merge-base --is-ancestor HEAD origin/main && { echo "pushed main $(git rev-parse --short HEAD)"; break; }
  # main moved: put the same snapshot on top of the new main (index from origin, tree re-added from the working tree)
  git reset -q --mixed origin/main && git add -A -- . ':!farm' ':!videos/out' ':!videos/review' && git add -A -- videos/out/.*.hits.json 2>/dev/null
  git diff --cached --quiet || git -c user.name=Claude -c user.email=noreply@anthropic.com commit -qm "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XkFQQwGRpJN2GiVpXu9H78"; done
