#!/usr/bin/env python3
"""Build and run one native Bend entry from an immutable archive on the runner.

Records the toolchain identity, every command's argv, working directory, stdout,
stderr, status and signal, the source hashes before and after, and the digest of
the produced binary.
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


def run(record, out, name, argv, cwd):
    stdout_path = out / f"{name}.stdout"
    stderr_path = out / f"{name}.stderr"
    status = None
    spawn = "ok"
    try:
        proc = subprocess.run(argv, cwd=str(cwd), env=compile_env(),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        status = proc.returncode
        stdout_bytes, stderr_bytes = proc.stdout, proc.stderr
    except OSError as exc:
        spawn = f"error: {exc}"
        stdout_bytes, stderr_bytes = b"", b""
    stdout_path.write_bytes(stdout_bytes)
    stderr_path.write_bytes(stderr_bytes)
    entry = {
        "name": name,
        "argv": [str(a) for a in argv],
        "cwd": str(cwd),
        "spawn": spawn,
        "status": status,
        "stdout_file": str(stdout_path),
        "stderr_file": str(stderr_path),
        "stdout": stdout_bytes.decode("utf-8", "replace"),
        "stderr": stderr_bytes.decode("utf-8", "replace"),
        "completed": spawn == "ok" and status is not None,
    }
    record["commands"].append(entry)
    return entry


def main():
    label_dir = Path(sys.argv[1]).resolve()
    entry = sys.argv[2]
    out_name = sys.argv[3]
    archive = label_dir / "source.tar.gz"
    source_root = label_dir / "source"
    out = label_dir / "out"
    out.mkdir(parents=True, exist_ok=True)

    if source_root.exists():
        raise SystemExit(f"refusing to reuse existing source directory {source_root}")
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(label_dir)

    # A verification entry supplied beside the archive is written into the
    # extracted tree, so the run is against the recorded sources plus that entry.
    injected = None
    injected_src = label_dir / "entry.bend"
    if injected_src.exists():
        injected = source_root / entry
        injected.parent.mkdir(parents=True, exist_ok=True)
        injected.write_bytes(injected_src.read_bytes())

    record = {
        "label": label_dir.name,
        "entry": entry,
        "platform": {"platform": platform.platform(), "machine": platform.machine()},
        "archive": {"path": str(archive), "sha256": sha256_file(archive)},
        "toolchain": {
            "bend": BEND, "bend_sha256": sha256_file(BEND),
            "cc": CC, "cc_sha256": sha256_file(CC),
        },
        "commands": [],
    }
    if injected is not None:
        record["injected_entry"] = {
            "path": entry, "sha256": sha256_file(injected),
            "source_sha256": sha256_file(injected_src),
        }
        record["entry_compiled"] = entry
    else:
        record["injected_entry"] = None
    source_context = source_root / "bend2" / "src" / "context"
    record["sources_before"] = {
        str(p.relative_to(source_root)): sha256_file(p)
        for p in sorted(source_context.rglob("*.bend"))
    }

    c_path = label_dir / f"{out_name}.c"
    bin_path = label_dir / out_name
    run(record, out, "bend-build", [BEND, entry, "-o", str(c_path)], source_root)
    run(record, out, "clang-link",
        [CC, "-O1", "-pthread", str(c_path), "-lsqlite3", "-lm", "-o", str(bin_path)],
        source_root)
    if bin_path.exists():
        record["binary_sha256"] = sha256_file(bin_path)
        run(record, out, "run", [str(bin_path)], source_root)
    else:
        record["binary_sha256"] = None

    record["sources_after"] = {
        str(p.relative_to(source_root)): sha256_file(p)
        for p in sorted(source_context.rglob("*.bend"))
    }
    record["sources_stable"] = record["sources_before"] == record["sources_after"]

    by_name = {c["name"]: c for c in record["commands"]}
    record["failures"] = []
    for name in ("bend-build", "clang-link", "run"):
        c = by_name.get(name)
        if c is None:
            record["failures"].append(f"{name}: not executed")
        elif not c["completed"] or c["status"] != 0:
            record["failures"].append(f"{name}: status {c['status']} spawn {c['spawn']}")
    if not record["sources_stable"]:
        record["failures"].append("source hashes changed during the run")
    record["exit"] = 1 if record["failures"] else 0

    (label_dir / "evidence.json").write_text(json.dumps(record, indent=2))
    print(json.dumps({
        "label": record["label"], "exit": record["exit"],
        "failures": record["failures"],
        "binary_sha256": record["binary_sha256"],
        "run_stdout": record["commands"][-1]["stdout"] if record["commands"] else "",
        "sources_stable": record["sources_stable"],
    }, indent=2))
    return record["exit"]


if __name__ == "__main__":
    sys.exit(main())
