#!/bin/sh
# Remote validation gate for bend2/context/sqlite/. Compiles the planner and
# replay operations with their fixture test harness and runs the suite. This
# script performs compilation and test execution; run it only on an admitted
# validation runner. Exact provenance (compiler, platform, linked SQLite
# runtime identity) is printed by the run itself.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
CC=${CC:-cc}
extra_inc=""
case "$(uname -s)" in
  Darwin) extra_inc="-I$(xcrun --show-sdk-path 2>/dev/null)/usr/include" ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
printf 'uname: ' && uname -a
printf 'compiler: ' && "$CC" --version 2>&1 | sed -n 1p
"$CC" -O1 -g -Wall -Wextra -Wno-unused-parameter $extra_inc \
  -DBATON_CTX_SQL_TEST_TRACE \
  -Ibend2/context/sqlite \
  bend2/tests/context-sqlite/test-context-sqlite.c \
  bend2/context/sqlite/context_sqlite.c \
  -lsqlite3 -o "$work/test-context-sqlite"
"$work/test-context-sqlite"
