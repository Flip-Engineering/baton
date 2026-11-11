#!/bin/sh
# Pre-PR checks for the studio branch (orchestrator, 8 Oct): every Python file changed against main compiles, every changed JS module
# parses (videos/web is "type": "module"), farm.py answers. Usage: sh videos/scripts/orchestration/pr_checks.sh [base ref, default origin/main]
cd "$(git rev-parse --show-toplevel)" || exit 2
BASE=${1:-origin/main}; fail=0; np=0; nj=0
git diff --name-only --diff-filter=ACMR "$BASE"...HEAD > /tmp/pr_changed.$$ || exit 2
while read -r f; do
  case "$f" in
    *.py) np=$((np+1)); python3 -c "import ast,sys; ast.parse(open(sys.argv[1],'rb').read(), sys.argv[1])" "$f" 2>/tmp/pr_err.$$ || { echo "PY  FAIL $f: $(tail -1 /tmp/pr_err.$$)"; fail=$((fail+1)); } ;;
    videos/web/*.js|videos/web/*.mjs|*.mjs) nj=$((nj+1)); node --check "$f" 2>/tmp/pr_err.$$ || { echo "JS  FAIL $f: $(grep -m1 -E 'Error' /tmp/pr_err.$$)"; fail=$((fail+1)); } ;;
  esac
done < /tmp/pr_changed.$$
echo "python files: $np, js modules: $nj, failures: $fail"
timeout 120 python3 videos/scripts/farm.py list --state claimed >/dev/null 2>&1 && echo "farm.py: answers" || { echo "farm.py: FAILED"; fail=$((fail+1)); }
rm -f /tmp/pr_changed.$$ /tmp/pr_err.$$
exit $fail
