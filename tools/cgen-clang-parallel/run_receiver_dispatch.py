#!/usr/bin/env python3
"""Deterministic runtime/dispatch qualification for the focused receiver case.

The focused receiver binary (`receive-focused.bend`) exposes a fixed dispatch
surface.  This harness runs the same pinned dispatch input on the serial oracle
and the sharded binary:

    <binary> --threads 1 --gpu off <outdir>/dispatch-input.db unsupported-command

The expected result is deterministic: exit 2, empty stdout, stderr
``unsupported focused receive command``, and no database file.  This exercises
the compiled runtime and the focused dispatch/error path; it is NOT a positive
receiver-behavior fixture.  A positive fixture needs a root decision because
the full live-handoff test's `attach` command is not implemented by
`receive-focused.bend`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

ORACLE = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-buildabi/baseline.bin")
SHARDED = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-buildabi/build/sharded-nopch")
DEFAULT_OUTDIR = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-runtime-dispatch")
DEFAULT_CGROUP = "/sys/fs/cgroup/baton2.slice/baton2-build.slice"
EXPECTED = {
    "exit": 2,
    "stdout": "",
    "stderr": "unsupported focused receive command\n",
    "db_exists": False,
}
DISPATCH_INPUT = "unsupported-command"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def current_cgroup() -> str:
    for line in Path("/proc/self/cgroup").read_text().splitlines():
        if line.startswith("0::"):
            return line[3:]
    return ""


def cgroup_value(path: str, name: str) -> str | None:
    try:
        return Path(path, name).read_text().strip()
    except OSError:
        return None


def run_dispatch(binary: Path, work: Path, flags: list[str], timeout: int) -> dict:
    db = work / "dispatch-input.db"
    if db.exists():
        db.unlink()
    command = [str(binary), *flags, str(db), DISPATCH_INPUT]
    started = time.monotonic()
    try:
        proc = subprocess.run(command, cwd=str(work), text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        return {
            "binary": str(binary),
            "command": command,
            "timeout": True,
            "exit": None,
            "stdout": (exc.stdout.decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")),
            "stderr": (exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")),
            "db_exists": db.exists(),
            "elapsed_s": time.monotonic() - started,
        }
    return {
        "binary": str(binary),
        "command": command,
        "timeout": False,
        "exit": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "db_exists": db.exists(),
        "elapsed_s": time.monotonic() - started,
    }


def matches(record: dict) -> dict:
    mismatches = []
    for key, expected in EXPECTED.items():
        actual = record.get(key)
        if actual != expected:
            mismatches.append({"key": key, "expected": expected, "actual": actual})
    return {"pass": not mismatches and not record.get("timeout"), "mismatches": mismatches}


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--oracle", type=Path, default=ORACLE)
    ap.add_argument("--sharded", type=Path, default=SHARDED)
    ap.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    ap.add_argument("--runtime-flags", default="--threads 1 --gpu off")
    ap.add_argument("--timeout", type=int, default=60)
    ap.add_argument("--label", default="receiver-dispatch")
    args = ap.parse_args(argv)

    oracle = args.oracle.resolve()
    sharded = args.sharded.resolve()
    if not oracle.is_file():
        raise SystemExit(f"oracle binary missing: {oracle}")
    if not sharded.is_file():
        raise SystemExit(f"sharded binary missing: {sharded}")
    oracle_sha = sha256_file(oracle)
    sharded_sha = sha256_file(sharded)
    flags = shlex.split(args.runtime_flags)
    args.outdir.mkdir(parents=True, exist_ok=True)

    oracle_run = run_dispatch(oracle, args.outdir, flags, args.timeout)
    sharded_run = run_dispatch(sharded, args.outdir, flags, args.timeout)
    oracle_check = matches(oracle_run)
    sharded_check = matches(sharded_run)
    oracle_sharded_match = all(
        oracle_run.get(key) == sharded_run.get(key)
        for key in ("exit", "stdout", "stderr", "db_exists")
    )
    comparison_pass = (
        oracle_check["pass"] and sharded_check["pass"] and oracle_sharded_match
        and not oracle_run["timeout"] and not sharded_run["timeout"]
    )
    self_comparison = oracle_sha == sharded_sha
    verdict = (
        "SMOKE-PASS" if self_comparison and comparison_pass else
        "PASS" if comparison_pass else
        "FAIL"
    )
    cgroup = current_cgroup()
    receipt = {
        "schema": "baton-cgen-clang-parallel-receiver-runtime-dispatch-v1",
        "label": args.label,
        "status": verdict,
        "self_comparison": self_comparison,
        "mode": "dispatch",
        "oracle": {"path": str(oracle), "sha256": oracle_sha, "bytes": oracle.stat().st_size},
        "sharded": {"path": str(sharded), "sha256": sharded_sha, "bytes": sharded.stat().st_size},
        "fixture": {
            "pinned_input": DISPATCH_INPUT,
            "runtime_flags": flags,
            "invocation": "<binary> --threads 1 --gpu off <outdir>/dispatch-input.db unsupported-command",
            "expected": EXPECTED,
        },
        "oracle_run": oracle_run,
        "sharded_run": sharded_run,
        "checks": {
            "oracle_matches_expected": oracle_check,
            "sharded_matches_expected": sharded_check,
            "oracle_sharded_match": oracle_sharded_match,
        },
        "cgroup": {
            "path": cgroup,
            "memory_max": cgroup_value(DEFAULT_CGROUP, "memory.max"),
            "memory_swap_max": cgroup_value(DEFAULT_CGROUP, "memory.swap.max"),
        },
        "verdict": {
            "runtime_dispatch_equivalence": verdict,
            "positive_receiver_semantic_equivalence": "NOT CLAIMED",
            "codegen_identity_claimed": False,
            "byte_identity_claimed": False,
            "reason": (
                "deterministic focused dispatch/error path only; the full live-handoff "
                "fixture's attach command is not implemented by receive-focused.bend, "
                "so a positive receiver fixture needs a root decision"
            ),
        },
    }
    receipt_path = args.outdir / "receiver-runtime-dispatch-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({
        "status": verdict,
        "self_comparison": self_comparison,
        "oracle_sha256": oracle_sha,
        "sharded_sha256": sharded_sha,
        "oracle_exit": oracle_run.get("exit"),
        "sharded_exit": sharded_run.get("exit"),
        "oracle_stderr": oracle_run.get("stderr"),
        "sharded_stderr": sharded_run.get("stderr"),
        "comparison_pass": comparison_pass,
        "receipt": str(receipt_path),
    }, indent=2))
    return 0 if comparison_pass else 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
