#!/bin/sh
# Focused fixture for bend2/scripts/bend-lineage-guard.sh.
# Each case is a release-shaped directory: bin/bend plus the manifest a real
# release carries at its root, so the walk from bin/ to the root is exercised.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
guard="$here/../scripts/bend-lineage-guard.sh"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT HUP INT TERM

mkdir -p "$temp/scripts" "$temp/toolchain"
cp "$guard" "$temp/scripts/bend-lineage-guard.sh"
chmod 0755 "$temp/scripts/bend-lineage-guard.sh"
guarded="$temp/scripts/bend-lineage-guard.sh"

line=f5185e384146d631b94676ade3d4b4ff68fb0563
other=0123456789abcdef0123456789abcdef01234567

release() {
  name=$1; commit=$2; cache=$3
  mkdir -p "$temp/$name/bin" "$temp/$name/bend2"
  printf '#!/bin/sh\necho "bend 2.0.25"\n' > "$temp/$name/bin/bend"
  chmod 0755 "$temp/$name/bin/bend"
  {
    printf '{\n  "source_commit": "%s",\n' "$commit"
    if [ "$cache" = cache ]; then
      printf '  "cgen_cache": {"state": "enabled by default"},\n'
      printf '// cached compiler\n' > "$temp/$name/bend2/cache.ts"
    fi
    printf '  "source_tree": "4ec78fe36a31a85ec1634de49034b6b803de1856"\n}\n'
  } > "$temp/$name/fork-manifest.json"
}

pin() {
  {
    printf 'lineage_commit=%s\n' "$line"
    printf 'release_name=2.0.25-pinned\n'
    printf 'cache_ts_sha256=%s\n' "$1"
    printf 'require_cgen_cache=%s\n' "$2"
  } > "$temp/toolchain/runtime-pin.txt"
}

expect_ok() {
  name=$1
  if "$guarded" "$temp/$name/bin/bend" > "$temp/$name.out" 2> "$temp/$name.err"; then
    echo "PASS $name"
  else
    echo "FAIL $name: guard refused a compiler it should accept"
    sed 's/^/  /' "$temp/$name.err"
    exit 1
  fi
}

expect_refused() {
  name=$1
  if "$guarded" "$temp/$name/bin/bend" > "$temp/$name.out" 2> "$temp/$name.err"; then
    echo "FAIL $name: guard accepted a compiler it should refuse"
    exit 1
  fi
  echo "PASS $name refuses"
}

# A stock upstream compiler carries no manifest; it is reported, not refused.
mkdir -p "$temp/stock/bin"
printf '#!/bin/sh\necho "bend 2.0.25"\n' > "$temp/stock/bin/bend"
chmod 0755 "$temp/stock/bin/bend"
pin '' 0
expect_ok stock
grep -q 'records no fork line' "$temp/stock.err" || { echo "FAIL stock: no notice"; exit 1; }
echo "PASS stock is reported as unrecorded"

# The pinned line, with the cache the pin names.
release withcache "$line" cache
pin "$(sha256sum "$temp/withcache/bend2/cache.ts" | cut -d' ' -f1)" 1
expect_ok withcache

# The same line with cache.ts altered is a different compiler.
printf '// altered\n' >> "$temp/withcache/bend2/cache.ts"
expect_refused withcache
grep -q 'and this tree pins' "$temp/withcache.err" || { echo "FAIL withcache: no hash in message"; exit 1; }
echo "PASS altered cache.ts is refused by hash"

# A different fork line, which also answers "bend 2.0.25".
release otherline "$other" ""
pin '' 0
expect_refused otherline
grep -q "$other" "$temp/otherline.err" || { echo "FAIL otherline: no observed commit"; exit 1; }
grep -q "$line" "$temp/otherline.err" || { echo "FAIL otherline: no pinned commit"; exit 1; }
echo "PASS the message names both lines"

# An operator's selector only execs the compiler; the guard follows it once to
# the release that carries the manifest.
release selected "$line" cache
pin "$(sha256sum "$temp/selected/bend2/cache.ts" | cut -d' ' -f1)" 1
mkdir -p "$temp/selector/bin"
printf '#!/bin/sh\nexec "%s" "$@"\n' "$temp/selected/bin/bend" > "$temp/selector/bin/bend"
chmod 0755 "$temp/selector/bin/bend"
expect_ok selector
echo "PASS a selector is followed to its release"
printf '#!/bin/sh\nexec "%s" "$@"\n' "$temp/otherline/bin/bend" > "$temp/selector/bin/bend"
expect_refused selector
grep -q "$other" "$temp/selector.err" || { echo "FAIL selector: no observed commit"; exit 1; }
echo "PASS a selector to another line is refused"

# The pinned line without the cache: a notice when not required, a refusal
# when required.
release nocache "$line" ""
pin '' 0
expect_ok nocache
grep -q 'carries no emitted-C cache' "$temp/nocache.err" || { echo "FAIL nocache: no notice"; exit 1; }
echo "PASS a missing cache is reported when not required"
pin '' 1
expect_refused nocache
grep -q 'without the emitted-C cache' "$temp/nocache.err" || { echo "FAIL nocache: no refusal message"; exit 1; }
echo "PASS a missing cache is refused when required"

# A manifest that cannot name its line is refused rather than trusted.
mkdir -p "$temp/nameless/bin"
printf '#!/bin/sh\necho "bend 2.0.25"\n' > "$temp/nameless/bin/bend"
chmod 0755 "$temp/nameless/bin/bend"
printf '{\n  "source_tree": "4ec78fe36a31a85ec1634de49034b6b803de1856"\n}\n' > "$temp/nameless/fork-manifest.json"
pin '' 0
expect_refused nameless
grep -q 'records no source_commit' "$temp/nameless.err" || { echo "FAIL nameless: no reason"; exit 1; }
echo "PASS a manifest without a source_commit is refused"

# A missing pin is a failure, not a silent pass.
rm -f "$temp/toolchain/runtime-pin.txt"
expect_refused withcache
grep -q 'no runtime pin' "$temp/withcache.err" || { echo "FAIL nopin: no reason"; exit 1; }
echo "PASS a missing pin is refused"

echo "PASS bend-lineage-guard"
