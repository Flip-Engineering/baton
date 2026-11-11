#!/usr/bin/env python3
"""Admission-gated split-TU build for the focused-receiver C case.

The wrapper must run inside the prepared cgroup (default
baton2.slice/baton2-build.slice: 16 GiB, swap disabled).  It:

  1. verifies the immutable input and the existing native -O1 oracle;
  2. compiles a real serial baseline object from the exact input inside the cap;
  3. verifies that the native oracle is the link of that object;
  4. runs the committed split-TU build with the baseline object (not a binary);
  5. runs the deterministic negative dispatch fixture on both the serial
     oracle and the sharded binary and compares exit/stdout/stderr/db state;
  6. writes a v2 receipt with ABI/symbol, dispatch, ownership and cgroup data.

The receipt labels positive receiver semantic equivalence NOT CLAIMED and
union-of-units semantic equivalence NEGATIVE-PATH ONLY.  The live-handoff
fixture is not run here: this artifact (receive-focused.bend) does not
implement attach/recruit/player/delivery/turns; run_receiver_runtime.py is
the corrected-facade adapter for that fixture.

No one-TU emergency build is re-run outside this capped baseline-object step.
No deployed binary is replaced.
"""

from __future__ import annotations

import argparse
import hashlib
from collections import Counter
import json
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

TOOLS = Path(__file__).resolve().parent
DISPATCH_FIXTURE = TOOLS / "run_receiver_dispatch.py"
DISPATCH_FLAGS = ["--threads", "1", "--gpu", "off"]
DISPATCH_TIMEOUT = 60
ARTIFACT = Path(
    "/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/"
    "worktrees/runtime-memory-focus-luna-20261018/.scratch-runtime-memory-focus-20261018-6.c"
)
ARTIFACT_SHA = "be0f8d5bc981849d102fd6d8d46c94b7b2becacb044f6093af84957caa4565d5"
NATIVE_BINARY = Path(
    "/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/"
    "worktrees/runtime-memory-focus-luna-20261018/.scratch-runtime-memory-focus-20261018-6"
)
NATIVE_SHA = "b70a109d3d72509284089488607a64d8971e84c00ea4bfea1ef8821c1d4ebe0a"
NATIVE_TIME_LOG = Path(
    "/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/"
    "worktrees/runtime-memory-focus-luna-20261018/.scratch-runtime-memory-focus-link-o1.time"
)
DEFAULT_CGROUP = "/sys/fs/cgroup/baton2.slice/baton2-build.slice"
DEFAULT_OUTDIR = Path("/var/tmp/cgen-clang-parallel-20261018/receiver-sharded")


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


def cgroup_read(cgroup: str, name: str) -> str | None:
    try:
        return Path(cgroup, name).read_text().strip()
    except OSError:
        return None


def cgroup_int(cgroup: str, name: str) -> int | None:
    value = cgroup_read(cgroup, name)
    if value is None or value == "max":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def cgroup_cpu(cgroup: str) -> dict[str, int]:
    out: dict[str, int] = {}
    text = cgroup_read(cgroup, "cpu.stat") or ""
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].isdigit():
            out[parts[0]] = int(parts[1])
    return out


def parse_time_file(path: Path) -> dict:
    text = path.read_text(errors="replace") if path.exists() else ""
    values: dict[str, object] = {}
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("User time (seconds):"):
            values["user_s"] = float(line.split(":")[-1])
        elif line.startswith("System time (seconds):"):
            values["sys_s"] = float(line.split(":")[-1])
        elif line.startswith("Elapsed (wall clock) time"):
            raw = line.split("):", 1)[-1].strip()
            pieces = [float(x) for x in raw.split(":")]
            if len(pieces) == 2:
                values["wall_s"] = pieces[0] * 60 + pieces[1]
            elif len(pieces) == 3:
                values["wall_s"] = pieces[0] * 3600 + pieces[1] * 60 + pieces[2]
        elif line.startswith("Maximum resident set size (kbytes):"):
            values["maxrss_kib"] = int(line.split(":")[-1])
        elif line.startswith("Exit status:"):
            values["time_exit"] = int(line.split(":")[-1])
    return values


def run_timed(command: list[str], cwd: Path, tag: str) -> dict:
    time_path = cwd / f"{tag}.time"
    stdout_path = cwd / f"{tag}.stdout"
    stderr_path = cwd / f"{tag}.stderr"
    wrapped = ["/usr/bin/time", "-v", "-o", str(time_path), *command]
    started = time.monotonic()
    with stdout_path.open("wb") as out, stderr_path.open("wb") as err:
        proc = subprocess.run(wrapped, cwd=str(cwd), stdout=out, stderr=err)
    elapsed = time.monotonic() - started
    record = {
        "command": command,
        "cwd": str(cwd),
        "exit": proc.returncode,
        "elapsed_s": elapsed,
        "time": parse_time_file(time_path),
        "stdout": str(stdout_path),
        "stderr": str(stderr_path),
        "stdout_sha256": sha256_file(stdout_path),
        "stderr_sha256": sha256_file(stderr_path),
        "stderr_tail": stderr_path.read_text(errors="replace")[-4000:],
    }
    return record


def main_symbol(path: Path) -> str | None:
    try:
        out = subprocess.check_output(
            ["nm", "-g", "--defined-only", "--format=posix", str(path)],
            text=True,
        )
    except subprocess.CalledProcessError:
        return None
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0] in ("main", "baton2_runtime_main"):
            return parts[0]
    return None


def load_dispatch():
    import importlib.util
    spec = importlib.util.spec_from_file_location("receiver_dispatch_fixture", DISPATCH_FIXTURE)
    if spec is None or spec.loader is None:
        raise SystemExit(f"cannot load dispatch fixture: {DISPATCH_FIXTURE}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--artifact", type=Path, default=ARTIFACT)
    ap.add_argument("--artifact-sha256", default=ARTIFACT_SHA)
    ap.add_argument("--native-binary", type=Path, default=NATIVE_BINARY)
    ap.add_argument("--native-sha256", default=NATIVE_SHA)
    ap.add_argument("--outdir", type=Path, default=DEFAULT_OUTDIR)
    ap.add_argument("--shards", type=int, default=4)
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--expected-cgroup", default=DEFAULT_CGROUP)
    ap.add_argument("--max-aggregate-rss-mb", type=int, default=12288)
    ap.add_argument("--cc", default="/usr/bin/clang-19")
    ap.add_argument("--baseline-cflags", default="-O1 -pthread",
                    help="serial baseline object flags; do NOT add -Dmain for this non-main artifact")
    ap.add_argument("--link-flags", default="-lsqlite3 -lm")
    ap.add_argument("--dispatch-timeout", type=int, default=DISPATCH_TIMEOUT)
    ap.add_argument("--reset-cgroup-peak", action="store_true",
                    help="write 0 to memory.peak first (requires cgroup write access)")
    args = ap.parse_args(argv)

    artifact = args.artifact.resolve()
    native = args.native_binary.resolve()
    if not artifact.is_file():
        raise SystemExit(f"artifact is missing: {artifact}")
    if not native.is_file():
        raise SystemExit(f"native binary is missing: {native}")
    artifact_sha = sha256_file(artifact)
    native_sha = sha256_file(native)
    if artifact_sha != args.artifact_sha256:
        raise SystemExit(f"artifact hash mismatch: {artifact_sha}")
    if native_sha != args.native_sha256:
        raise SystemExit(f"native binary hash mismatch: {native_sha}")

    cgroup = current_cgroup()
    if args.expected_cgroup and args.expected_cgroup not in cgroup:
        raise SystemExit(
            "refusing unbounded compile: run this wrapper inside the prepared cgroup "
            f"{args.expected_cgroup!r}; current cgroup is {cgroup!r}"
        )
    budget = {
        "cgroup": cgroup,
        "memory_max": cgroup_int(cgroup, "memory.max"),
        "memory_swap_max": cgroup_int(cgroup, "memory.swap.max"),
        "pids_max": cgroup_read(cgroup, "pids.max"),
        "memory_peak_before": cgroup_int(cgroup, "memory.peak"),
        "memory_current_before": cgroup_int(cgroup, "memory.current"),
        "cpu_before": cgroup_cpu(cgroup),
    }
    if budget["memory_max"] != 17179869184 or budget["memory_swap_max"] != 0:
        args.outdir.mkdir(parents=True, exist_ok=True)
        receipt = {
            "schema": "baton-cgen-clang-parallel-receiver-case-v2",
            "status": "FAIL",
            "reason": "prepared cgroup budget mismatch; refusing to compile",
            "cgroup_budget": budget,
            "required": {"memory_max": 17179869184, "memory_swap_max": 0},
        }
        (args.outdir / "receiver-case-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        return 4
    if args.reset_cgroup_peak:
        try:
            Path(cgroup, "memory.peak").write_text("0\n")
            budget["memory_peak_before"] = cgroup_int(cgroup, "memory.peak")
            budget["reset_memory_peak"] = "ok"
        except OSError as error:
            budget["reset_memory_peak"] = f"unsupported: {error}"

    args.outdir.mkdir(parents=True, exist_ok=True)
    baseline_cflags = shlex.split(args.baseline_cflags)
    link_flags = shlex.split(args.link_flags)
    baseline_obj = args.outdir / "baseline.o"
    baseline_link = args.outdir / "baseline-linked"
    baseline_compile = run_timed(
        [args.cc, *baseline_cflags, "-c", str(artifact), "-o", str(baseline_obj)],
        args.outdir, "baseline-compile",
    )
    if baseline_compile["exit"] != 0:
        receipt = {
            "schema": "baton-cgen-clang-parallel-receiver-case-v2",
            "status": "FAIL",
            "reason": "serial baseline object compile failed",
            "baseline_compile": baseline_compile,
            "cgroup_budget": budget,
        }
        (args.outdir / "receiver-case-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        return 4
    baseline_obj_sha = sha256_file(baseline_obj)
    baseline_link_record = run_timed(
        [args.cc, *baseline_cflags, str(baseline_obj), *link_flags, "-o", str(baseline_link)],
        args.outdir, "baseline-link",
    )
    baseline_link_sha = sha256_file(baseline_link) if baseline_link.is_file() else None
    native_is_link = baseline_link_record["exit"] == 0 and baseline_link_sha == native_sha
    baseline_main = main_symbol(baseline_obj)
    native_main = main_symbol(native)

    if not native_is_link:
        receipt = {
            "schema": "baton-cgen-clang-parallel-receiver-case-v2",
            "status": "FAIL",
            "reason": "native oracle is not the link of the serial baseline object",
            "native_binary_is_link_of_object": False,
            "baseline_object": {"path": str(baseline_obj), "sha256": baseline_obj_sha},
            "baseline_link": {"path": str(baseline_link), "sha256": baseline_link_sha},
            "native_binary": {"path": str(native), "sha256": native_sha},
            "baseline_compile": baseline_compile,
            "baseline_link_record": baseline_link_record,
            "baseline_main_symbol": baseline_main,
            "native_main_symbol": native_main,
            "baseline_cflags": baseline_cflags,
            "cgroup_budget": budget,
            "required_review": "The native build command has no -Dmain; the artifact main is `main`. "
                               "Do not add -Dmain for this non-main receiver case.",
        }
        (args.outdir / "receiver-case-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        return 4

    sharded_dir = args.outdir / "sharded"
    build_command = [
        sys.executable,
        str(TOOLS / "build_and_measure.py"),
        "--source", str(artifact),
        "--outdir", str(sharded_dir),
        "--shards", str(args.shards),
        "--jobs", str(args.jobs),
        "--skip-oracle",
        "--baseline-object", str(baseline_obj),
        "--baseline-binary", str(native),
        "--link-flags", " ".join(link_flags),
        "--no-pch",
        "--max-aggregate-rss-mb", str(args.max_aggregate_rss_mb),
        "--run-args=--help",
    ]
    started = time.monotonic()
    proc = subprocess.run(build_command, cwd=str(TOOLS), text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    build_elapsed = time.monotonic() - started
    build_receipt_path = sharded_dir / "receipt.json"
    build_receipt = json.loads(build_receipt_path.read_text()) if build_receipt_path.is_file() else None
    manifest = build_receipt["split_manifest"] if build_receipt else None

    sharded_binary = Path(build_receipt["sharded_no_pch"]["binary"]) if build_receipt and build_receipt.get("sharded_no_pch") else None
    dispatch_expected = None
    if not baseline_link.is_file():
        raise SystemExit(f"baseline linked binary missing: {baseline_link}")
    if sharded_binary is None or not sharded_binary.is_file():
        sharded_binary_sha = None
        oracle_dispatch = None
        sharded_dispatch = None
        oracle_dispatch_check = {"pass": False, "mismatches": [{"key": "sharded_binary", "expected": "present", "actual": "missing"}]}
        sharded_dispatch_check = {"pass": False, "mismatches": []}
        dispatch_match = False
        dispatch_ok = False
        dispatch_label = "ORACLE-VS-SHARDED"
    else:
        sharded_binary_sha = sha256_file(sharded_binary)
        dispatch = load_dispatch()
        dispatch_expected = dispatch.EXPECTED
        dispatch_work = args.outdir / "dispatch"
        dispatch_work.mkdir(parents=True, exist_ok=True)
        oracle_dispatch = dispatch.run_dispatch(baseline_link, dispatch_work, DISPATCH_FLAGS, args.dispatch_timeout)
        sharded_dispatch = dispatch.run_dispatch(sharded_binary, dispatch_work, DISPATCH_FLAGS, args.dispatch_timeout)
        oracle_dispatch_check = dispatch.matches(oracle_dispatch)
        sharded_dispatch_check = dispatch.matches(sharded_dispatch)
        dispatch_match = all(
            oracle_dispatch.get(key) == sharded_dispatch.get(key)
            for key in ("exit", "stdout", "stderr", "db_exists")
        )
        dispatch_ok = bool(
            oracle_dispatch_check["pass"] and sharded_dispatch_check["pass"]
            and dispatch_match and not oracle_dispatch["timeout"] and not sharded_dispatch["timeout"]
        )
        dispatch_label = "SELF-SMOKE" if baseline_link_sha == sharded_binary_sha else "ORACLE-VS-SHARDED"

    after = {
        "memory_peak_after": cgroup_int(cgroup, "memory.peak"),
        "memory_current_after": cgroup_int(cgroup, "memory.current"),
        "memory_events_after": cgroup_read(cgroup, "memory.events"),
        "cpu_after": cgroup_cpu(cgroup),
    }
    cpu_delta = {
        key: after["cpu_after"].get(key, 0) - budget["cpu_before"].get(key, 0)
        for key in ("usage_usec", "user_usec", "system_usec")
    }
    per_shard = [
        {"name": s["name"], "segments": s["segments"], "bytes": s["bytes"], "sha256": s["sha256"]}
        for s in manifest["shards"]
    ] if manifest else []
    all_fids = [fid for s in manifest["shards"] for fid in s["fids"]] if manifest else []
    fid_counts = Counter(all_fids)
    coverage_ok = bool(
        manifest
        and manifest["counts"]["segments"] == 7910
        and manifest["counts"]["shards"] == args.shards
        and sum(s["segments"] for s in manifest["shards"]) == 7910
        and manifest["segment_text_preserved"] is True
        and len(fid_counts) == 7910
        and all(count == 1 for count in fid_counts.values())
    )
    symbols_ok = bool(build_receipt and build_receipt["symbols"]["identity_ok"])
    cli_smoke_ok = bool(build_receipt and build_receipt["runtime"]["oracle_matches_no_pch"])
    build_ok = proc.returncode == 0 and build_receipt is not None
    build_abi_ok = bool(
        coverage_ok and native_is_link and baseline_obj.is_file() and symbols_ok
        and cli_smoke_ok and build_ok
    )
    success = bool(build_abi_ok and dispatch_ok)
    status = (
        "SMOKE-PASS" if dispatch_label == "SELF-SMOKE" else "PASS-BUILD-ABI-NEGATIVE-RUNTIME"
    ) if success else "FAIL"
    receipt = {
        "schema": "baton-cgen-clang-parallel-receiver-case-v2",
        "status": status,
        "input": {
            "path": str(artifact),
            "bytes": artifact.stat().st_size,
            "sha256": artifact_sha,
            "segments": manifest["counts"]["segments"] if manifest else None,
            "segment_fill_sha256": manifest["segment_text_sha256"] if manifest else None,
            "segment_bytes": manifest["segment_bytes"] if manifest else None,
            "segment_text_preserved": manifest["segment_text_preserved"] if manifest else None,
            "per_shard_segment_counts": per_shard,
            "sum_shard_segments": sum(s["segments"] for s in per_shard),
            "unique_fids": len(set(all_fids)),
            "coverage_ok": coverage_ok,
            "missing_or_duplicate_fids": sorted(fid for fid, count in fid_counts.items() if count > 1),
            "gaps": "none (splitter fails closed on every inter-segment byte)",
            "dropped_split_declarations": manifest["dropped_split_declarations"] if manifest else None,
        },
        "ownership": {
            "core": ["baton_core.c (prefix + work + tail_template + requests)"],
            "spins": ["baton_spins.c"],
            "shards": [s["name"] for s in per_shard],
            "requests_location": "baton_core.c",
            "link_order": build_receipt["sharded_no_pch"]["objects"] if build_receipt and build_receipt.get("sharded_no_pch") else None,
        },
        "serial_oracle": {
            "object": {"path": str(baseline_obj), "sha256": baseline_obj_sha},
            "binary": {"path": str(native), "sha256": native_sha},
            "linked_binary": {"path": str(baseline_link), "sha256": baseline_link_sha},
            "compile_flags": baseline_cflags,
            "link_flags": link_flags,
            "compile": baseline_compile,
            "link": baseline_link_record,
            "native_binary_is_link_of_object": native_is_link,
            "baseline_main_symbol": baseline_main,
            "native_main_symbol": native_main,
            "native_build_time_log": str(NATIVE_TIME_LOG),
            "flags_note": "The native -O1 command has no -Dmain and the emitted main symbol is `main`; "
                          "-Dmain applies to the coordinator main-entry/native-entry route, not this artifact.",
        },
        "symbol_abi": {
            **(build_receipt["symbols"] if build_receipt else {}),
            "codegen_identity_claimed": False,
        },
        "dispatch": {
            "fixture": {
                "path": str(DISPATCH_FIXTURE),
                "sha256": sha256_file(DISPATCH_FIXTURE),
                "argv_template": "<binary> --threads 1 --gpu off <work>/dispatch-input.db unsupported-command",
                "runtime_flags": DISPATCH_FLAGS,
                "expected": dispatch_expected,
                "note": "deterministic negative dispatch path; not positive receiver semantic equivalence",
            },
            "oracle": {
                "binary": str(baseline_link),
                "sha256": baseline_link_sha,
                "run": oracle_dispatch,
                "matches_expected": oracle_dispatch_check,
            },
            "sharded": {
                "binary": str(sharded_binary) if sharded_binary else None,
                "sha256": sharded_binary_sha,
                "run": sharded_dispatch,
                "matches_expected": sharded_dispatch_check,
            },
            "oracle_sharded_match": dispatch_match,
            "comparison_label": dispatch_label,
            "dispatch_ok": dispatch_ok,
            "positive_receiver_semantic_equivalence": "NOT CLAIMED",
            "union_of_units_semantic_equivalence": "NEGATIVE-PATH ONLY",
            "cli_smoke": {
                "command": "--help",
                "oracle_matches_sharded": build_receipt["runtime"]["oracle_matches_no_pch"] if build_receipt else None,
                "note": "CLI smoke only; no coordinator-surface proof.",
            },
        },
        "cgroup_budget": budget,
        "cgroup_after": after,
        "cgroup_cpu_delta": cpu_delta,
        "build_command": build_command,
        "build_exit": proc.returncode,
        "build_elapsed_s": build_elapsed,
        "build_stdout_tail": proc.stdout[-4000:],
        "build_stderr_tail": proc.stderr[-4000:],
        "build_receipt": str(build_receipt_path) if build_receipt_path.is_file() else None,
        "build_receipt_sha256": sha256_file(build_receipt_path) if build_receipt_path.is_file() else None,
        "verdict": {
            "status": status,
            "build_abi_only": True,
            "union_of_units_semantic_equivalence": "NEGATIVE-PATH ONLY",
            "positive_receiver_semantic_equivalence": "NOT CLAIMED",
            "codegen_identity_claimed": False,
            "byte_identity_claimed": False,
            "coverage_ok": coverage_ok,
            "dispatch_ok": dispatch_ok,
            "note": "symbol/ABI identity plus deterministic negative dispatch equivalence; "
                    "not positive receiver semantics, instruction/codegen identity, or byte identity.",
        },
    }
    receipt_path = args.outdir / "receiver-case-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({
        "status": status,
        "baseline_object_sha256": baseline_obj_sha,
        "native_binary_is_link_of_object": native_is_link,
        "segments": receipt["input"]["segments"],
        "sum_shard_segments": receipt["input"]["sum_shard_segments"],
        "symbols_identity_ok": symbols_ok,
        "coverage_ok": coverage_ok,
        "cli_smoke_ok": cli_smoke_ok,
        "dispatch_ok": dispatch_ok,
        "dispatch_label": dispatch_label,
        "union_of_units_semantic_equivalence": "NEGATIVE-PATH ONLY",
        "positive_receiver_semantic_equivalence": "NOT CLAIMED",
        "cgroup": cgroup,
        "memory_max": budget["memory_max"],
        "memory_swap_max": budget["memory_swap_max"],
        "memory_peak_after": after["memory_peak_after"],
        "cpu_usage_usec": cpu_delta["usage_usec"],
        "receipt": str(receipt_path),
    }, indent=2))
    if not success:
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
