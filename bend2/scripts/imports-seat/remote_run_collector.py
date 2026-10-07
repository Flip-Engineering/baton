#!/usr/bin/env python3
"""Run the codec lane's existing collector over one immutable archive.

The collector itself is not modified: this records the toolchain identity, the
collector's own argv, working directory, stdout, stderr and status, and the
summary it prints, and keeps the collector's evidence directory beside it.
"""

import hashlib
import json
import os
import platform
import subprocess
import sys
import tarfile
from pathlib import Path

BEND = "/home/atari2036/baton-logging-686/toolchain-home/bin/bend"
CC = "/usr/bin/clang-19"
PATH_PREFIX = "/home/atari2036/baton-integrate-recovered-20261006"
COLLECTOR = "bend2/test/context-codec.py"


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def compile_env():
    env = dict(os.environ)
    env["BEND_NO_TELEMETRY"] = "1"
    env["CC"] = CC
    env["PATH"] = PATH_PREFIX + os.pathsep + env.get("PATH", "")
    return env


def main():
    label_dir = Path(sys.argv[1]).resolve()
    archive = label_dir / "source.tar.gz"
    source_root = label_dir / "source"
    out = label_dir / "out"
    out.mkdir(parents=True, exist_ok=True)

    if source_root.exists():
        raise SystemExit(f"refusing to reuse existing source directory {source_root}")
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(label_dir)

    collector_out = label_dir / "codec-qualification"
    argv = ["python3", str(source_root / COLLECTOR), "--bend", BEND,
            "--out", str(collector_out)]
    proc = subprocess.run(argv, cwd=str(source_root), env=compile_env(),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (out / "collector.stdout").write_bytes(proc.stdout)
    (out / "collector.stderr").write_bytes(proc.stderr)

    record = {
        "label": label_dir.name,
        "platform": {"platform": platform.platform(), "machine": platform.machine()},
        "archive": {"path": str(archive), "sha256": sha256_file(archive)},
        "toolchain": {"bend": BEND, "bend_sha256": sha256_file(BEND),
                      "cc": CC, "cc_sha256": sha256_file(CC)},
        "collector": {"path": COLLECTOR,
                      "sha256": sha256_file(source_root / COLLECTOR)},
        "command": {"argv": argv, "cwd": str(source_root), "status": proc.returncode,
                    "stdout_file": str(out / "collector.stdout"),
                    "stderr_file": str(out / "collector.stderr"),
                    "stdout": proc.stdout.decode("utf-8", "replace"),
                    "stderr": proc.stderr.decode("utf-8", "replace")},
    }
    evidence = collector_out / "evidence.json"
    if evidence.exists():
        kept = json.loads(evidence.read_text())
        record["collector_evidence"] = {
            "path": str(evidence),
            "qualification": kept.get("qualification"),
            "collection": kept.get("collection"),
            "exit": kept.get("exit"),
            "failures": kept.get("failures"),
            "unqualified": [u.get("module") for u in kept.get("unqualified", [])],
            "mutations": {
                "count": kept.get("mutations", {}).get("count"),
                "outcomes": kept.get("mutations", {}).get("outcomes"),
                "unqualified": kept.get("mutations", {}).get("unqualified"),
            },
        }
    else:
        record["collector_evidence"] = None
    record["exit"] = proc.returncode
    (label_dir / "evidence.json").write_text(json.dumps(record, indent=2))
    sys.stdout.write(proc.stdout.decode("utf-8", "replace"))
    sys.stderr.write(proc.stderr.decode("utf-8", "replace"))
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
