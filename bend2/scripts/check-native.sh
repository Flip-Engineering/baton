#!/bin/sh
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project"
python3 docs/bend2/laws-check.py
