#!/usr/bin/env python3
"""Bounded qualification of the 60MB generated C shard split.

The serial baseline object/binary are produced elsewhere; this script never
recompiles the one-TU source.  It compiles the split translation units with
the baseline flags, links with the pinned native entry, and compares symbols,
CLI output and focused runtime output against the baseline binary.

Aggregate compiler RSS is sampled across every live compiler process tree and
the run is aborted if it exceeds --cap-kib.  PSS is sampled too because a PCH
arm shares file-backed pages between processes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

SAMPLE_S = 0.01


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def procs_children(pid: int) -> list[int]:
    try:
        return [int(x) for x in Path(f"/proc/{pid}/task/{pid}/children").read_text().split()]
    except OSError:
        return []


def tree(pid: int) -> list[int]:
    out, stack = [], [pid]
    while stack:
        p = stack.pop()
        out.append(p)
        stack.extend(procs_children(p))
    return out


def rss_kib(pid: int) -> int:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def pss_kib(pid: int) -> int:
    try:
        for line in Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines():
            if line.startswith("Pss:"):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def run_parallel(cmds: list[list[str]], cwd: Path, cap_kib: int) -> dict:
    t0 = time.perf_counter()
    procs = [(cmd, subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True))
             for cmd in cmds]
    peaks = [0] * len(procs)
    pss_peaks = [0] * len(procs)
    agg = 0
    agg_pss = 0
    aborted = False
    while any(p.poll() is None for _, p in procs):
        total = total_pss = 0
        for i, (_, p) in enumerate(procs):
            if p.poll() is None:
                t = tree(p.pid)
                r = sum(rss_kib(x) for x in t)
                q = sum(pss_kib(x) for x in t)
                peaks[i] = max(peaks[i], r)
                pss_peaks[i] = max(pss_peaks[i], q)
                total += r
                total_pss += q
        agg = max(agg, total)
        agg_pss = max(agg_pss, total_pss)
        if cap_kib and total > cap_kib:
            aborted = True
            for _, p in procs:
                p.kill()
            break
        time.sleep(SAMPLE_S)
    jobs = []
    for i, (cmd, p) in enumerate(procs):
        out, err = p.communicate()
        jobs.append({"cmd": cmd, "code": p.returncode, "stdout": out,
                     "stderr": err, "peak_kib": peaks[i],
                     "pss_peak_kib": pss_peaks[i]})
    return {"wall_s": round(time.perf_counter() - t0, 4),
            "aggregate_peak_kib": agg, "aggregate_pss_peak_kib": agg_pss,
            "aborted_over_cap": aborted, "jobs": jobs}


def run_sampled(cmd: list[str], cwd: Path) -> dict:
    t0 = time.perf_counter()
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    peak = pss_peak = 0
    while p.poll() is None:
        t = tree(p.pid)
        peak = max(peak, sum(rss_kib(x) for x in t))
        pss_peak = max(pss_peak, sum(pss_kib(x) for x in t))
        time.sleep(SAMPLE_S)
    out, err = p.communicate()
    return {"wall_s": round(time.perf_counter() - t0, 4), "peak_kib": peak,
            "pss_peak_kib": pss_peak, "code": p.returncode,
            "stdout": out, "stderr": err}


def nm_defined(path: Path) -> set[str]:
    r = subprocess.run(["nm", "--defined-only", str(path)],
                       capture_output=True, text=True, check=True)
    return {line.split()[-1] for line in r.stdout.splitlines() if line.split()}


def diff_behavior(a: subprocess.CompletedProcess, b: subprocess.CompletedProcess) -> dict:
    def h(s: bytes) -> str:
        return hashlib.sha256(s).hexdigest()
    return {
        "code_equal": a.returncode == b.returncode,
        "stdout_equal": a.stdout == b.stdout,
        "stderr_equal": a.stderr == b.stderr,
        "stdout_sha256": h(a.stdout),
        "stderr_sha256": h(a.stderr),
        "stdout_bytes": len(a.stdout),
        "stderr_bytes": len(a.stderr),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split-dir", required=True, type=Path)
    ap.add_argument("--baseline-obj", required=True, type=Path)
    ap.add_argument("--baseline-bin", required=True, type=Path)
    ap.add_argument("--native-entry", required=True, type=Path)
    ap.add_argument("--outdir", required=True, type=Path)
    ap.add_argument("--cap-kib", type=int, default=24 * 1024 * 1024)
    ap.add_argument("--pch", action="store_true")
    ap.add_argument("--cc", default="clang-19")
    args = ap.parse_args()

    split = args.split_dir.resolve()
    out = args.outdir.resolve()
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    manifest = json.loads((split / "manifest.json").read_text())
    names = ["baton_core", "baton_spins"] + [
        row["name"][:-2] for row in manifest["shards"]]
    cflags = ["-O1", "-pthread", "-Dmain=baton2_runtime_main"]

    result = {
        "split_dir": str(split),
        "input_sha256": manifest["input_sha256"],
        "input_bytes": manifest["input_bytes"],
        "segments": manifest["counts"]["segments"],
        "shards": manifest["counts"]["shards"],
        "dropped_split_declarations": manifest.get("dropped_split_declarations"),
        "cap_kib": args.cap_kib,
        "cc": args.cc,
        "cflags": cflags,
        "pch": args.pch,
    }

    if args.pch:
        pch = out / "baton_segments.pch"
        r = run_sampled([args.cc, *cflags, "-x", "c-header",
                         str(split / "baton_segments.h"), "-o", str(pch)], out)
        result["pch_build"] = {k: r[k] for k in
                               ("wall_s", "peak_kib", "pss_peak_kib", "code")}
        result["pch_build"]["stderr"] = r["stderr"][:2000]
        result["pch_bytes"] = pch.stat().st_size if pch.exists() else 0
        if r["code"]:
            result["status"] = "pch_build_failed"
            (out / "result.json").write_text(json.dumps(result, indent=2))
            print(json.dumps(result, indent=2))
            return 1
        extra = ["-include-pch", str(pch)]
    else:
        extra = []

    # A PCH built from baton_segments.h is only valid for shard TUs.  core and
    # spins do not include that header and define/redefine the dialect macros
    # themselves; preloading the segments PCH there changes WL_SPIN.
    cmds = []
    for n in names:
        use_pch = extra if n.startswith("shard_") else []
        cmds.append([args.cc, *cflags, *use_pch, "-c", f"{n}.c", "-o", f"{n}.o"])
    comp = run_parallel(cmds, split, args.cap_kib)
    result["compile"] = comp
    result["compile_aborted_over_cap"] = comp["aborted_over_cap"]
    if comp["aborted_over_cap"] or any(j["code"] for j in comp["jobs"]):
        result["status"] = "compile_failed"
        (out / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
        return 1

    # Move objects into the separate output directory.
    for n in names:
        shutil.move(str(split / f"{n}.o"), str(out / f"{n}.o"))
    objs = [str(out / f"{n}.o") for n in names]
    link = run_sampled([args.cc, "-O1", "-pthread", str(args.native_entry),
                        *objs, "-lsqlite3", "-lm", "-o", str(out / "baton2")],
                       out)
    result["link"] = {k: link[k] for k in
                      ("wall_s", "peak_kib", "pss_peak_kib", "code")}
    result["link"]["stderr"] = link["stderr"][:4000]
    if link["code"]:
        result["status"] = "link_failed"
        (out / "result.json").write_text(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
        return 1

    sharded = out / "baton2"
    baseline = args.baseline_bin.resolve()
    result["binaries"] = {
        "baseline": {"path": str(baseline), "sha256": sha256_file(baseline)},
        "sharded": {"path": str(sharded), "sha256": sha256_file(sharded)},
    }

    # CLI parity: --help is a pure stdout/exit path.
    a = subprocess.run([str(baseline), "--help"], capture_output=True,
                       text=True, timeout=60)
    b = subprocess.run([str(sharded), "--help"], capture_output=True,
                       text=True, timeout=60)
    result["cli_help"] = {
        "baseline": {"code": a.returncode, "stdout": a.stdout,
                     "stderr": a.stderr},
        "sharded": {"code": b.returncode, "stdout": b.stdout,
                    "stderr": b.stderr},
        **diff_behavior(subprocess.CompletedProcess([], a.returncode,
                                                    a.stdout.encode(),
                                                    a.stderr.encode()),
                        subprocess.CompletedProcess([], b.returncode,
                                                    b.stdout.encode(),
                                                    b.stderr.encode())),
    }

    # Symbol identity against the serial object.
    base_syms = nm_defined(args.baseline_obj.resolve())
    sh_syms = nm_defined(sharded)
    result["symbols"] = {
        "baseline_count": len(base_syms),
        "sharded_count": len(sh_syms),
        "missing_named": sorted(s for s in (base_syms - sh_syms)
                                if not s.startswith(".L")),
        "missing_all_count": len(base_syms - sh_syms),
        "extra_named_count": len({s for s in (sh_syms - base_syms)
                                  if not s.startswith(".L")}),
        "dynamic_sharded": sorted(subprocess.run(
            ["nm", "-D", "--defined-only", str(sharded)],
            capture_output=True, text=True, check=True).stdout.splitlines()),
    }
    result["status"] = "built"
    (out / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
