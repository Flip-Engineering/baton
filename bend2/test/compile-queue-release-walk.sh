#!/bin/sh
# Regression for the maintained-release walk: a directory listing ends with a
# newline, so String.lines returns a trailing empty name. release_items must
# drop that empty name or release_walk re-enters the same directory forever.
#
# Requires the built queue executable. The test hashes a synthetic release
# layout; it never executes the compiler, the runtime, or a build.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
QUEUE=${BATON2_COMPILE_QUEUE_BIN:?Set BATON2_COMPILE_QUEUE_BIN to the built queue executable}
[ -x "$QUEUE" ] || { printf 'queue executable is missing or not executable: %s\n' "$QUEUE" >&2; exit 2; }

T=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue-release-walk.XXXXXX") || exit 2
trap 'rm -rf -- "$T"' EXIT

# Synthetic maintained release layout: bend2/ with files, a nested directory
# and an empty directory; bin/bun; bin/bend as the wrapper exec target.
mkdir -p "$T/release/bend2/sub" "$T/release/bend2/empty" "$T/release/bin"
printf 'release\n' > "$T/release/bend2/main.ts"
printf 'child\n' > "$T/release/bend2/sub/child.txt"
printf '#!/bin/sh\nexit 0\n' > "$T/release/bin/bend"
printf '#!/bin/sh\nexit 0\n' > "$T/release/bin/bun"
chmod 0755 "$T/release/bin/bend" "$T/release/bin/bun"
# Nontrivial sibling breadth; each listing ends with a newline.
i=1
while [ "$i" -le 64 ]; do
  printf 'sibling %s\n' "$i" > "$T/release/bend2/sibling-$i.txt"
  i=$((i + 1))
done

cat > "$T/bend-wrapper" <<EOF
#!/bin/sh
exec "$T/release/bin/bend" "\$@"
EOF
chmod 0755 "$T/bend-wrapper"

mkdir -p "$T/src/bend2/src" "$T/state"
printf 'import Base\ndef main() -> IO(Unit): IO.die(Unit,0,"fixture")\n' > "$T/src/bend2/src/fixture.bend"

key_once() {
  "$QUEUE" -- key --kind cgen --state-root "$T/state" --cwd "$T/src" \
    --root "$T/src" --source-root "$T/src" \
    --entry bend2/src/fixture.bend --compiler "$T/bend-wrapper" \
    --artifact "c.c=$T/out.c" -- "$T/bend-wrapper" bend2/src/fixture.bend -o "$T/out.c"
}

first=$(key_once)
second=$(key_once)
case "$first" in
  *[!0-9a-f]*|'') printf 'bad key: %s\n' "$first" >&2; exit 1 ;;
esac
[ ${#first} -eq 64 ] || { printf 'bad key length: %s\n' "$first" >&2; exit 1; }
[ "$first" = "$second" ] || { printf 'unstable key: %s vs %s\n' "$first" "$second" >&2; exit 1; }
printf 'pass release walk terminates: %s\n' "$first"

if [ -n "${BATON2_RELEASE_WALK_COMPILER:-}" ]; then
  installed_once() {
    "$QUEUE" -- key --kind cgen --state-root "$T/state" --cwd "$T/src" \
      --root "$T/src" --source-root "$T/src" \
      --entry bend2/src/fixture.bend --compiler "$BATON2_RELEASE_WALK_COMPILER" \
      --artifact "c.c=$T/installed.c" -- "$BATON2_RELEASE_WALK_COMPILER" bend2/src/fixture.bend -o "$T/installed.c"
  }
  installed_first=$(installed_once)
  installed_second=$(installed_once)
  case "$installed_first" in
    *[!0-9a-f]*|'') printf 'bad installed-release key: %s\n' "$installed_first" >&2; exit 1 ;;
  esac
  [ ${#installed_first} -eq 64 ] || { printf 'bad installed-release key length: %s\n' "$installed_first" >&2; exit 1; }
  [ "$installed_first" = "$installed_second" ] || { printf 'unstable installed-release key: %s vs %s\n' "$installed_first" "$installed_second" >&2; exit 1; }
  printf 'pass installed release walk terminates: %s\n' "$installed_first"
fi
