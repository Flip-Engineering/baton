#!/usr/bin/env python3
"""Construct a keeper service PATH that keeps every existing tool directory.

The keeper service starts with a small PATH. Native dispatches need the
Baton release bin, a Node bin and the native client bins on that PATH.
This script prepends the required directories to the service PATH and
keeps every directory the service already had, in its original order.

Usage:
  service-environment.py --existing PATH --require DIR [--require DIR ...]
  service-environment.py --existing PATH --require DIR --drop-in
  service-environment.py --existing PATH --require DIR --check
"""
import argparse
import os
import sys


def construct_path(existing, required):
    """Return required directories first, then every existing directory.

    Existing directories keep their original order. Duplicates and empty
    entries are dropped. No existing directory is removed.
    """
    seen = set()
    result = []
    for directory in list(required) + existing.split(os.pathsep):
        if directory and directory not in seen:
            seen.add(directory)
            result.append(directory)
    return os.pathsep.join(result)


def drop_in(path_value):
    return "[Service]\nEnvironment=PATH=" + path_value + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--existing", required=True,
                        help="current service PATH value")
    parser.add_argument("--require", action="append", default=[],
                        metavar="DIR",
                        help="required directory to add; repeatable")
    parser.add_argument("--drop-in", action="store_true",
                        help="print a systemd drop-in instead of the PATH")
    parser.add_argument("--check", action="store_true",
                        help="fail when a required directory does not exist")
    args = parser.parse_args(argv)
    if args.check:
        missing = [d for d in args.require if not os.path.isdir(d)]
        if missing:
            print("missing required directories: " + ", ".join(missing),
                  file=sys.stderr)
            return 1
    constructed = construct_path(args.existing, args.require)
    print(drop_in(constructed) if args.drop_in else constructed, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
