#!/usr/bin/env python3
"""Compiled-and-executed runtime qualification for the focused receiver case.

This is the option-(a) gate: the deterministic focused live-handoff receiver
fixture is run against the serial oracle binary and the sharded binary.  The
fixture adapter optionally appends runtime flags (default none; e.g.
``--threads 1 --gpu off``) and strips those option pairs from the observed
argv before checking the Baton action argv, so the deployment argv/CLI surface
is exercised unchanged.

Validated on the full coordinator binary with no flags.  The current focused
receiver program lacks the full receiver command surface (attach/recruit/
player/delivery/turns), so this fixture is intended for the corrected facade /
full coordinator when available; use run_receiver_dispatch.py for the current
focused receiver's deterministic dispatch evidence.

The harness does not compile anything.  It is intended to run after the
build/ABI arm produced a self-consistent baseline.bin and the sharded binary.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
ORACLE = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-buildabi/baseline.bin")
SHARDED = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-buildabi/build/sharded-nopch")
TEMPLATE = Path(
    "/var/tmp/baton-live-observer-public-recovery-sqlite-5142-boot644/"
    "focused-live-handoff-repeated.py"
)
DEFAULT_OUTDIR = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-runtime")
DEFAULT_CGROUP = "/sys/fs/cgroup/baton2.slice/baton2-build.slice"
EXPECTED = {
    "native": "native-parent",
    "firstTargetArgv": "receive",
    "secondTargetArgv": "recover-observer",
    "rawSizeBeforeTerminal": 344,
    "checkpointBytesFinal": 317,
    "checkpointOutputCursors": [175, 259, 344],
    "taskReceipt": "native-reviewed",
    "rawPresentAfterTerminalCleanup": False,
}
STRUCTURAL_KEYS = tuple(EXPECTED)
VARIABLE_KEYS = {
    "candidate", "candidateSha256", "providerPid", "attempt",
    "rawInodeBeforeTerminal",
}
PINNED_INPUT = "Read and complete the controlled live-handoff task."


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


ARGV_PATTERN = re.compile(
    r"(?m)^def argv\(pid\):\n    return \[x\.decode\(errors='replace'\) for x in "
    r"pathlib\.Path\(f'/proc/\{pid\}/cmdline'\)\.read_bytes\(\)\.split\(b'\\0'\)\[:-1\]\]\n"
)


def focused_program(template: Path, binary: Path, destination: Path,
                    runtime_flags: list[str]) -> Path:
    text = template.read_text()
    exe_pattern = re.compile(r"(?m)^exe=pathlib\.Path\(.*?\)\.resolve\(\)$")
    text, count = exe_pattern.subn(f"exe=pathlib.Path({str(binary)!r}).resolve()", text)
    if count != 1:
        raise SystemExit(f"focused template has {count} exe assignments, expected 1")

    argv_replacement = (
        "def argv(pid):\n"
        "    raw = [x.decode(errors='replace') for x in "
        "pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\\0')[:-1]]\n"
        "    out = []\n"
        "    i = 0\n"
        "    while i < len(raw):\n"
        "        if raw[i] in ('--threads', '--gpu'):\n"
        "            i += 2\n"
        "        else:\n"
        "            out.append(raw[i]); i += 1\n"
        "    return out\n"
    )
    text, count = ARGV_PATTERN.subn(lambda match: argv_replacement, text)
    if count != 1:
        raise SystemExit(f"focused template has {count} argv helpers, expected 1")

    patch = (
        f"mod._runtime_flags = {runtime_flags!r}\n"
        "mod._coord_original = mod.Receive.coord\n"
        "mod._spawn_original = mod.Receive.spawn\n"
        "exec(\n"
        "    'def _coord_with_runtime(self, *args, ok=True):\\n'\n"
        "    '    return _coord_original(self, *args, *_runtime_flags, ok=ok)\\n'\n"
        "    'def _spawn_with_runtime(self, *args):\\n'\n"
        "    '    return _spawn_original(self, *args, *_runtime_flags)\\n',\n"
        "    mod.__dict__,\n"
        ")\n"
        "mod.Receive.coord = mod.__dict__['_coord_with_runtime']\n"
        "mod.Receive.spawn = mod.__dict__['_spawn_with_runtime']\n"
    )
    anchor = "mod.EXE=exe\n"
    if text.count(anchor) != 1:
        raise SystemExit("focused template has no unique mod.EXE=exe assignment")
    text = text.replace(anchor, anchor + patch, 1)
    destination.write_text(text)
    destination.chmod(0o755)
    return destination


def run_focused(script: Path, cwd: Path, timeout: int) -> dict:
    started = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, str(script)],
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "script": str(script),
            "timeout": True,
            "exit": None,
            "stdout": (exc.stdout.decode(errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")),
            "stderr": (exc.stderr.decode(errors="replace") if isinstance(exc.stderr, bytes) else (exc.stderr or "")),
            "parsed": None,
            "ok": False,
            "elapsed_s": time.monotonic() - started,
        }
    parsed = None
    for line in proc.stdout.splitlines():
        at = line.find('{"candidate"')
        if at >= 0:
            try:
                parsed = json.loads(line[at:])
            except json.JSONDecodeError:
                parsed = None
    return {
        "script": str(script),
        "timeout": False,
        "exit": proc.returncode,
        "stdout": proc.stdout,
        "stderr": proc.stderr,
        "parsed": parsed,
        "ok": proc.returncode == 0 and "OK" in proc.stdout and parsed is not None,
        "elapsed_s": time.monotonic() - started,
    }


def compare(oracle: dict, sharded: dict) -> dict:
    if not oracle.get("ok") or not sharded.get("ok"):
        return {
            "pass": False,
            "reason": "focused receiver fixture did not pass on both binaries",
            "oracle_ok": oracle.get("ok"),
            "sharded_ok": sharded.get("ok"),
        }
    o = oracle["parsed"]
    s = sharded["parsed"]
    mismatches = [
        {"key": key, "oracle": o.get(key), "sharded": s.get(key)}
        for key in STRUCTURAL_KEYS
        if o.get(key) != s.get(key)
    ]
    expected_mismatch = [
        {"key": key, "expected": expected, "oracle": o.get(key)}
        for key, expected in EXPECTED.items()
        if o.get(key) != expected
    ]
    return {
        "pass": not mismatches and not expected_mismatch,
        "reason": "oracle and sharded observable receiver state match"
        if not mismatches and not expected_mismatch
        else "receiver observable state mismatch",
        "oracle_result": o,
        "sharded_result": s,
        "oracle_vs_sharded_mismatches": mismatches,
        "oracle_vs_expected_mismatches": expected_mismatch,
        "excluded_variable_keys": sorted(VARIABLE_KEYS),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--oracle", type=Path, default=ORACLE)
    ap.add_argument("--sharded", type=Path, default=SHARDED)
    ap.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    ap.add_argument("--focused-template", type=Path, default=TEMPLATE)
    ap.add_argument("--runtime-flags", default="", help="optional runtime flags; e.g. --threads 1 --gpu off")
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--label", default="receiver-runtime")
    args = ap.parse_args(argv)

    oracle = args.oracle.resolve()
    sharded = args.sharded.resolve()
    if not oracle.is_file():
        raise SystemExit(f"oracle binary missing: {oracle}")
    if not sharded.is_file():
        raise SystemExit(f"sharded binary missing: {sharded}")
    oracle_sha = sha256_file(oracle)
    sharded_sha = sha256_file(sharded)
    runtime_flags = shlex.split(args.runtime_flags)
    args.outdir.mkdir(parents=True, exist_ok=True)

    oracle_script = focused_program(
        args.focused_template, oracle, args.outdir / "focused-oracle.py", runtime_flags
    )
    sharded_script = focused_program(
        args.focused_template, sharded, args.outdir / "focused-sharded.py", runtime_flags
    )
    oracle_run = run_focused(oracle_script, args.outdir, args.timeout)
    sharded_run = run_focused(sharded_script, args.outdir, args.timeout)
    comparison = compare(oracle_run, sharded_run)
    self_comparison = oracle_sha == sharded_sha
    verdict = (
        "SMOKE-PASS" if self_comparison and comparison["pass"] else
        "PASS" if comparison["pass"] else
        "FAIL"
    )
    cgroup = current_cgroup()
    receipt = {
        "schema": "baton-cgen-clang-parallel-receiver-runtime-v1",
        "label": args.label,
        "status": verdict,
        "self_comparison": self_comparison,
        "oracle": {
            "path": str(oracle),
            "sha256": oracle_sha,
            "bytes": oracle.stat().st_size,
        },
        "sharded": {
            "path": str(sharded),
            "sha256": sharded_sha,
            "bytes": sharded.stat().st_size,
        },
        "fixture": {
            "template": str(args.focused_template),
            "template_sha256": sha256_file(args.focused_template),
            "pinned_input": PINNED_INPUT,
            "runtime_flags": runtime_flags,
            "invocation": "python3 focused-<label>.py (no CLI args; fixture spawns the binary with runtime_flags appended)",
            "expected": EXPECTED,
            "oracle_script": str(oracle_script),
            "sharded_script": str(sharded_script),
            "argv_adapter": "strips --threads/--gpu option pairs before Baton action argv checks",
        },
        "oracle_run": oracle_run,
        "sharded_run": sharded_run,
        "comparison": comparison,
        "cgroup": {
            "path": cgroup,
            "memory_max": cgroup_value(DEFAULT_CGROUP, "memory.max"),
            "memory_swap_max": cgroup_value(DEFAULT_CGROUP, "memory.swap.max"),
        },
        "verdict": {
            "union_of_units_semantic_equivalence": verdict,
            "byte_identity_claimed": False,
            "codegen_identity_claimed": False,
            "note": "compiled-and-executed focused receiver behavior; not instruction/codegen identity",
        },
    }
    receipt_path = args.outdir / "receiver-runtime-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({
        "status": verdict,
        "self_comparison": self_comparison,
        "oracle_sha256": oracle_sha,
        "sharded_sha256": sharded_sha,
        "oracle_exit": oracle_run.get("exit"),
        "sharded_exit": sharded_run.get("exit"),
        "comparison_pass": comparison["pass"],
        "reason": comparison.get("reason"),
        "expected_mismatches": comparison.get("oracle_vs_expected_mismatches"),
        "receipt": str(receipt_path),
    }, indent=2))
    return 0 if comparison["pass"] else 3


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
