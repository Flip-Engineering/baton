#!/usr/bin/env python3
"""Compile the imported-engine and codec-wire/convert modules from one immutable archive.

Runs only on the validation runner. Extracts the supplied archive into a fresh
directory, records the toolchain identity and the source hashes, runs the pinned
Bend over the requested modules, and writes every command's argv, working
directory, stdout, stderr, status and signal to a JSON record beside the raw
stream files.
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
PATH_PREFIX = "/home/atari2036/baton-integrate-recovered-20261006"
CC = "/usr/bin/clang-19"


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
    spawn = "ok"
    status = None
    signal = None
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
        "signal": signal,
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
    modules = [m for m in sys.argv[2].split(",") if m]
    archive = label_dir / "source.tar.gz"
    source_root = label_dir / "source"
    out = label_dir / "out"
    out.mkdir(parents=True, exist_ok=True)

    if source_root.exists():
        raise SystemExit(f"refusing to reuse existing source directory {source_root}")
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(label_dir)

    record = {
        "label": label_dir.name,
        "platform": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": platform.python_version(),
        },
        "archive": {"path": str(archive), "sha256": sha256_file(archive)},
        "toolchain": {
            "bend": BEND,
            "bend_sha256": sha256_file(BEND) if Path(BEND).exists() else None,
            "cc": CC,
            "cc_sha256": sha256_file(CC) if Path(CC).exists() else None,
        },
        "modules": modules,
        "commands": [],
    }

    context = source_root / "bend2" / "src" / "context"
    if not context.is_dir():
        raise SystemExit(f"archive did not produce {context}")
    record["probe"] = None
    probe_src = label_dir / "probe.bend"
    if probe_src.exists():
        probe_dst = context / "zz-probe.bend"
        probe_dst.write_bytes(probe_src.read_bytes())
        record["probe"] = {
            "path": str(probe_dst),
            "sha256": sha256_file(probe_dst),
            "source_sha256": sha256_file(probe_src),
        }
    record["context_sources"] = {
        p.name: sha256_file(p) for p in sorted(context.glob("*.bend"))
    }

    run(record, out, "bend-version", [BEND, "--version"], source_root)

    for module in modules:
        path = context / module
        run(record, out, f"check-{module[:-5]}", [BEND, "--check-only", path],
            source_root)

    if record["probe"]:
        run(record, out, "check-zz-probe",
            [BEND, "--check-only", record["probe"]["path"]], source_root)

    record["failures"] = [
        f"--check-only failed for {c['name'][len('check-'):]}"
        for c in record["commands"]
        if c["name"].startswith("check-") and c["status"] != 0
    ]
    record["exit"] = 1 if record["failures"] else 0

    context_sources_after = {
        p.name: sha256_file(p) for p in sorted(context.glob("*.bend"))
    }
    record["context_sources_after"] = context_sources_after
    record["sources_stable"] = record["context_sources"] == context_sources_after

    (label_dir / "evidence.json").write_text(json.dumps(record, indent=2))
    print(json.dumps({
        "label": record["label"],
        "exit": record["exit"],
        "failures": record["failures"],
        "bend_sha256": record["toolchain"]["bend_sha256"],
        "sources_stable": record["sources_stable"],
    }, indent=2))
    return record["exit"]


if __name__ == "__main__":
    sys.exit(main())
