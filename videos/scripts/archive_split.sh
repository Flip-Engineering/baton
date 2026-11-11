#!/bin/sh
# One-off: copy the published-video and review history out of music-video-studies into
# automated-content-pipeline-video-studies-archive, keeping every commit that touched those paths and every LFS video.
# Run it in a fresh cloud session with plenty of disk (not the working container): it needs a full,
# non-shallow clone plus every LFS object. The source repo is only read; its history is never rewritten.
#
#   sh videos/scripts/archive_split.sh [SRC_URL] [DST_URL]
#
# What moves: videos/out (published versions, archive/, stills, farm sheets), videos/review
# (review clips and contact sheets), .gitattributes, and the publish Action with its helpers.
# Uses git fast-export/fast-import into a fresh repo (no history rewriting anywhere).
# Paths stay the same inside the archive, so publish.sh and ops.sh keep working unchanged.
set -eu
SRC=${1:-https://github.com/flip-engineer/automated-content-pipeline.git}
DST=${2:-https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive.git}
W=${WORK:-$HOME/archive_split}
mkdir -p "$W" && cd "$W"

git lfs version >/dev/null

# 1. Full clone of main with every LFS object any commit on main ever pointed at. This clone is only read.
rm -rf src new && git clone --no-local --single-branch --branch main "$SRC" src
git -C src lfs fetch --all origin main
echo "commits on main: $(git -C src rev-list --count HEAD)   LFS objects: $(git -C src lfs ls-files --all | wc -l)"

# 2. Write the archive paths' history into a NEW repository (fast-export | fast-import). Nothing is rewritten:
#    commits that touched only code drop out, renames and every version of the kept files survive.
git init -q -b main new
git -C src fast-export --signed-tags=strip --tag-of-filtered-object=drop main -- \
  videos/out videos/review .gitattributes .github/workflows/publish-videos.yml | git -C new fast-import --quiet
cd new
git config lfs.storage "$W/src/.git/lfs"      # read the LFS objects straight from the source clone's store
export GIT_LFS_SKIP_SMUDGE=1                   # keep videos as pointers in the working tree (saves disk)
git reset -q --hard main
echo "commits kept: $(git rev-list --count HEAD)"

# 3. Check nothing was lost: every LFS pointer resolves to an object we hold.
MISSING=$(git lfs ls-files --all | awk '$2=="-"' | wc -l)
echo "LFS pointers whose object is missing locally: $MISSING"

# 4. Upload the LFS objects first, so every pointer in the pushed history resolves.
git remote add archive "$DST"
git lfs push --all archive HEAD

# 5. Push the transferred history in batches (one huge push can be refused with HTTP 413) to a side branch,
#    so nothing already on the archive's main is touched until the whole history is there.
N=0; for c in $(git rev-list --reverse --first-parent HEAD); do
  N=$((N+1)); [ $((N % 40)) -eq 0 ] && git push -q archive "$c:refs/heads/import/history"
done
git push archive HEAD:refs/heads/import/history

# 6. Join it with whatever main already holds (e.g. the repo's initial README) by a merge, never a force push.
git fetch archive main 2>/dev/null && {
  git -c user.name="Claude" -c user.email=noreply@anthropic.com \
    merge --allow-unrelated-histories --no-edit -m "Import published-video and review history from music-video-studies" FETCH_HEAD
}
git push archive HEAD:main
git push archive --delete import/history
echo "done: $(git rev-parse --short HEAD) on $DST main; commits: $(git rev-list --count HEAD)"
