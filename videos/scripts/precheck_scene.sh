#!/bin/sh
# precheck_scene.sh SCENE [SCENE ...]: syntax-check a scene and its sibling modules (scenes/SCENE.js, scenes/SCENE.*.js) before a farm post.
# A parse error otherwise only shows on the farm, as a page error the renderer waits out (THE BASIC LAW v2, 4 Oct 2026: a // comment
# swallowed a closing brace; the job hung for two hours). Exit 1 on the first failure.
cd "$(dirname "$0")/../web/scenes" || exit 2
[ $# -gt 0 ] || { echo "usage: precheck_scene.sh SCENE [SCENE ...]" >&2; exit 2; }
for s in "$@"; do
  for f in "$s.js" "$s".*.js; do
    [ -f "$f" ] || continue
    node --check "$f" || { echo "precheck: $f does not parse" >&2; exit 1; }
  done
  echo "precheck: $s ok"
done
