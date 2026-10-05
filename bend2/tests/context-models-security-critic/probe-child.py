#!/usr/bin/env python3
"""Child fixture for the semantic context host-boundary discriminator.

Every mode writes what it actually observed to stderr, which the native host
redirects into the private retained log file. The parent driver reads that file
and the child's stdout bytes; it never trusts a value the child reports on a
channel the host could have reconstructed.

Modes:
  env          report os.environ; emit b"first\nA\\x00B\nC" and exit 7
  eof          read stdin to EOF; emit "stdin:<n>"; exit 0
  big <n>      emit b"x"*n + b"!"; exit 3
  spill        create a private temp file; emit its path, mode and uid; exit 0
  touch <path> append a marker line to <path> and print its real path; exit 0
"""

import json
import os
import stat
import sys
import tempfile
import time


def report(payload):
    sys.stderr.buffer.write(json.dumps(payload, sort_keys=True).encode("utf-8"))
    sys.stderr.buffer.write(b"\n")
    sys.stderr.buffer.flush()


def main(argv):
    mode = argv[1] if len(argv) > 1 else "env"
    if mode == "env":
        report({"mode": "env", "env": dict(os.environ)})
        sys.stdout.buffer.write(b"first\nA\x00B\nC")
        sys.stdout.buffer.flush()
        return 7
    if mode == "eof":
        data = sys.stdin.buffer.read()
        report({"mode": "eof", "stdin_len": len(data), "stdin_hex": data.hex()})
        sys.stdout.buffer.write(b"stdin:" + str(len(data)).encode() + b"\n")
        sys.stdout.buffer.flush()
        return 0
    if mode == "big":
        count = int(argv[2])
        report({"mode": "big", "count": count})
        sys.stdout.buffer.write(b"x" * count + b"!")
        sys.stdout.buffer.flush()
        return 3
    if mode == "spill":
        handle, path = tempfile.mkstemp(prefix="context-critic-")
        with os.fdopen(handle, "wb") as spill:
            spill.write(b"spill")
        info = os.stat(path)
        report(
            {
                "mode": "spill",
                "tmpdir": os.environ.get("TMPDIR"),
                "home": os.environ.get("HOME"),
                "path": path,
                "mode": stat.S_IMODE(info.st_mode),
                "uid": info.st_uid,
            }
        )
        os.unlink(path)
        sys.stdout.buffer.write(b"spill\n")
        sys.stdout.buffer.flush()
        return 0
    if mode == "sleep":
        seconds = float(argv[2]) if len(argv) > 2 else 30.0
        report({"mode": "sleep", "seconds": seconds})
        time.sleep(seconds)
        return 0
    if mode == "touch":
        target = os.path.realpath(argv[2])
        with open(target, "ab") as handle:
            handle.write(b"marker\n")
        report({"mode": "touch", "path": target})
        sys.stdout.buffer.write(b"touched\n")
        sys.stdout.buffer.flush()
        return 0
    report({"mode": mode, "error": "unknown mode"})
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
