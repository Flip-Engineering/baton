#!/bin/sh
# Installs Bend: `curl -fsSL https://bend-lang.com/install.sh | sh`.
#
# release.ts writes this script from deploy/install.sh.in with the version
# and the sha256 of each release archive filled in, so the script (served by
# bend-lang.com) vouches for the archive (served by github.com). It downloads
# bend-<ver>-<os>-<arch>.tar.gz into a temp dir under $BEND_HOME (~/.bend),
# checks the sha256, moves bin/bend, bend2/ and guide/ into place and prints
# the PATH line to add. No sudo, no other install, no shell file edited,
# nothing sent. Run it again to upgrade; `bend update` runs it for you.
#
# The installed bend never updates itself. Once a day it asks bend-lang.com
# for the latest version (GET /check with its version, OS and CPU type, and
# nothing else) and prints a line when a newer one exists. Set
# BEND_NO_TELEMETRY=1 and it never asks.
set -eu

REPO="bendlang/bend"
VER="2.0.25"
SHA_DARWIN_ARM64="c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31"
SHA_DARWIN_X64="78e70cda4068f83736649c760575f4382259d5817be96d2eb04b9d078d943af0"
SHA_LINUX_ARM64="c7cce7508fd13201d544180cca531a87a89c41829876c431cdfa0ea7f5308481"
SHA_LINUX_X64="91c0e2640f8d2e3e73fd3dd62ed4d178ce9a6f7ce8f8980b4dc4abf7a6f9ccd4"

fail() { printf 'bend: %s\n' "$*" >&2; exit 1; }

main() {
  # under Termux uname says Linux/aarch64, but the build links glibc
  case ${PREFIX:-} in
    */com.termux/*) fail "Android is not supported yet: the Linux build needs glibc, and Android has bionic.
      Ask for an Android build at github.com/bendlang/bend/issues/877.";;
  esac
  case $(uname -s) in
    Darwin) os=darwin;;
    Linux) os=linux;;
    MINGW*|MSYS*|CYGWIN*|Windows*) fail "Bend needs Linux, macOS or WSL.";;
    *) fail "$(uname -s) is not supported: Bend runs on Linux and macOS.";;
  esac
  case $(uname -m) in
    arm64|aarch64) arch=arm64;;
    x86_64|amd64) arch=x64;;
    *) fail "$(uname -m) is not supported: Bend runs on arm64 and x64.";;
  esac
  case $os-$arch in
    darwin-arm64) sum=$SHA_DARWIN_ARM64;;
    darwin-x64) sum=$SHA_DARWIN_X64;;
    linux-arm64) sum=$SHA_LINUX_ARM64;;
    linux-x64) sum=$SHA_LINUX_X64;;
  esac
  home=${BEND_HOME:-$HOME/.bend}
  name="bend-$VER-$os-$arch.tar.gz"
  url="https://github.com/$REPO/releases/download/v$VER/$name"
  mkdir -p "$home/bin"
  tmp=$(mktemp -d "$home/tmp.XXXXXX")
  trap 'rm -rf "$tmp"' EXIT
  echo "downloading $url"
  curl --proto '=https' --tlsv1.2 -fsSL -o "$tmp/$name" "$url" \
    || fail "the download failed: $url"
  if command -v sha256sum >/dev/null 2>&1; then
    echo "$sum  $tmp/$name" | sha256sum -c - >/dev/null 2>&1 \
      || fail "$name does not match its sha256 in this script; not installed"
  elif command -v shasum >/dev/null 2>&1; then
    echo "$sum  $tmp/$name" | shasum -a 256 -c - >/dev/null 2>&1 \
      || fail "$name does not match its sha256 in this script; not installed"
  else
    fail "sha256sum or shasum is needed to verify the download"
  fi
  tar -xzf "$tmp/$name" -C "$tmp"
  # the 2.0.0-2.0.7 launcher's files (a release per version under app/,
  # current, id, last, rep, bad) go, and so does the launcher, replaced below
  rm -rf "$home/app" "$home/current" "$home/id" "$home/last" "$home/rep" \
    "$home/bad" "$home/bend2" "$home/guide"
  mv "$tmp/bend/bend2" "$tmp/bend/guide" "$home/"
  mv -f "$tmp/bend/bin/bend" "$home/bin/bend"
  card
}

card() {
  b=$(printf '\033[1m') p=$(printf '\033[38;5;103m') d=$(printf '\033[38;5;245m')
  r=$(printf '\033[0m') h=$(printf %s "$home" | sed "s|^$HOME|~|")
  e=$(printf %s "$home" | sed "s|^$HOME|\\\$HOME|")
  note() { printf '  %s%s%s\n' "$d" "$1" "$r"; }
  printf '\n  %sBend%s %s\342\226\210%s  %s%s%s\n\n' "$b" "$r" "$p" "$r" "$d" "$VER" "$r"
  note "Bend is installed at $h. Run ${p}bend guide$r$d to get started."
  echo
  case ":$PATH:" in
    *":$home/bin:"*) ;;
    *) case ${SHELL:-} in
         *fish) note "Add it to your PATH: fish_add_path $e/bin";;
         *) note "Add it to your PATH: export PATH=\"$e/bin:\$PATH\"";;
       esac;;
  esac
  note "Once a day, bend asks bend-lang.com for the latest version, sending"
  note "only its version, OS and CPU type. BEND_NO_TELEMETRY=1 turns that off."
  command -v cc >/dev/null 2>&1 || note "Install clang 19+ to build binaries."
  printf '\n  %sCongratulations! You'"'"'re now a %scode bender%s%s.%s\n\n' "$b" "$p" "$r" "$b" "$r"
}

main
