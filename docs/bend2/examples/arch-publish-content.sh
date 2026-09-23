#!/bin/sh
# arch-publish-content.sh — completion evidence from the published content, not from a ref read.
#
# arch-publish-target.sh claims completion by comparing the declared remote's ref with the intended
# commit. That establishes which commit the ref names; it does not establish that the content the
# destination holds is the content that was prepared. M-3a asks for evidence about the actual artifact,
# and this script supplies it at the pin:
#
#   git --git-dir=<declared> ls-tree -r <the commit the declared ref names>
#
# is read from the destination's own object store, hashed, and compared with the same listing taken
# from the prepared squash in the source repository. A destination that names another commit, or holds
# different content under that commit, reports no evidence.
#
# Run from the worktree root:
#
#   export PATH="$PWD/.bend/bin:$PATH" BEND_NO_TELEMETRY=1
#   sh docs/bend2/examples/arch-publish-content.sh
#
# All state is under .scratch/arch-publish-content/, which the repository ignores. Output is recorded
# verbatim in arch-publish-content.evidence.md.
set -eu

ROOT=$(pwd)
REF=refs/heads/main
WORK="$ROOT/.scratch/arch-publish-content"
DECLARED=$WORK/declared.git
SRC=$WORK/src

rm -rf "$WORK"
mkdir -p "$WORK"
git init -q --bare "$DECLARED"
git init -q "$SRC"
cd "$SRC"
git config user.email fixture@local
git config user.name fixture
export GIT_AUTHOR_DATE='2026-09-23T00:00:00Z'
export GIT_COMMITTER_DATE='2026-09-23T00:00:00Z'
printf 'base\n' > base.txt
git add -A
git commit -qm base
git branch -M main
git remote add declared "$DECLARED"
git push -q declared main
BASE=$(git rev-parse main)
printf 'landed\n' > landed.txt
git add -A
git commit -qm 'one squashed landing'
SQUASH=$(git rev-parse HEAD)

REF_HEAD=$(git ls-remote "$DECLARED" "$REF" | cut -f1)
declared_listing() { git --git-dir="$DECLARED" ls-tree -r "$REF_HEAD"; }
prepared_listing() { git ls-tree -r "$SQUASH"; }
digest_of() { shasum -a 256 | cut -d' ' -f1; }
content_digest() { digest_of <<EOF
$1
EOF
}
completion_with() {
  test "$(content_digest "$(declared_listing)")" = "$(content_digest "$(prepared_listing)")" \
    && echo observed_match || echo no_evidence
}

echo "### the artifact that was prepared"
echo "squash=$SQUASH"
echo "prepared_content_sha256=$(content_digest "$(prepared_listing)")"

echo "### stage 1: publish, then read the content the declared destination holds"
git push -q declared "$SQUASH:$REF"
REF_HEAD=$(git ls-remote "$DECLARED" "$REF" | cut -f1)
echo "declared_ref=$REF_HEAD"
echo "declared_content_sha256=$(content_digest "$(declared_listing)")"
echo "completion=$(completion_with)"

echo "### stage 2: a destination naming another commit supplies no evidence"
git --git-dir="$DECLARED" update-ref "$REF" "$BASE"
REF_HEAD=$(git ls-remote "$DECLARED" "$REF" | cut -f1)
echo "declared_ref=$REF_HEAD"
echo "declared_content_sha256=$(content_digest "$(declared_listing)")"
echo "completion=$(completion_with)"

echo "### stage 3: the prepared content read back from the destination after republication"
git push -q declared "$SQUASH:$REF"
REF_HEAD=$(git ls-remote "$DECLARED" "$REF" | cut -f1)
echo "declared_ref=$REF_HEAD"
echo "declared_content_sha256=$(content_digest "$(declared_listing)")"
echo "completion=$(completion_with)"
echo "evidence_source=destination_object_store"
echo "content_compared=ls-tree -r of the commit the declared ref names"
