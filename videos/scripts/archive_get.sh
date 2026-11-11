#!/bin/sh
# Download a published file (a Git LFS object) from the ARCHIVE repo by its path, e.g. a superseded version for comparison:
#   sh videos/scripts/archive_get.sh videos/out/archive/IRON_IS_HOT_v12_share.mp4 /tmp/iron12.mp4
# Reads the pointer through the contents API, asks the LFS batch API for a signed URL, downloads it, checks the sha256.
set -e
REPO=flip-engineer/automated-content-pipeline-video-studies-archive
P=$(gh api "repos/$REPO/contents/$1" --jq '.content' | base64 -d)
OID=$(echo "$P" | sed -n 's/^oid sha256://p'); SZ=$(echo "$P" | sed -n 's/^size //p')
[ -n "$OID" ] || { echo "not an LFS pointer: $1"; exit 1; }
URL=$(curl -sS -X POST -H "Accept: application/vnd.git-lfs+json" -H "Content-Type: application/vnd.git-lfs+json" \
  --data "{\"operation\":\"download\",\"transfers\":[\"basic\"],\"objects\":[{\"oid\":\"$OID\",\"size\":$SZ}]}" \
  "https://github.com/$REPO.git/info/lfs/objects/batch" | python3 -c "import json,sys; print(json.load(sys.stdin)['objects'][0]['actions']['download']['href'])")
curl -sSL -o "$2" "$URL"
[ "$(sha256sum "$2" | cut -d' ' -f1)" = "$OID" ] && echo "ok  $2 ($SZ bytes)" || { echo "BAD sha256: $2"; exit 1; }
