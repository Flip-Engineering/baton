#!/usr/bin/env python3
"""Build a Bend-emitted C fixture as one TU (oracle) and as deterministic
parallel shards, then compare source/link/runtime equivalence and measure the
whole build.

Bounded by design: only the named fixture is compiled, `--jobs` limits
concurrent compilers, and `--max-aggregate-rss-mb` can abort a runaway build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path

import importlib.util

MODULE_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "shard_emitted_c", MODULE_DIR / "shard_emitted_c.py"
)
shard = importlib.util.module_from_spec(_spec)
sys.modules["shard_emitted_c"] = shard
_spec.loader.exec_module(shard)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ProcessMonitor:
    """Sample aggregate resident memory of concurrently running children."""

    def __init__(self, cap_kib: int | None) -> None:
        self.cap_kib = cap_kib
        self.active: set[int] = set()
        self.lock = threading.Lock()
        self.peak_kib = 0
        self.exceeded = False
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)

    def reset_peak(self) -> None:
        with self.lock:
            self.peak_kib = 0
            self.exceeded = False

    def register(self, pid: int) -> None:
        with self.lock:
            self.active.add(pid)

    def unregister(self, pid: int) -> None:
        with self.lock:
            self.active.discard(pid)

    @staticmethod
    def _rss_kib(pid: int) -> int:
        try:
            with open(f"/proc/{pid}/status", "r", encoding="ascii") as handle:
                for line in handle:
                    if line.startswith("VmRSS:"):
                        return int(line.split()[1])
        except (FileNotFoundError, ProcessLookupError, ValueError):
            return 0
        return 0

    def _loop(self) -> None:
        while not self._stop.is_set():
            with self.lock:
                pids = list(self.active)
            total = sum(self._rss_kib(pid) for pid in pids)
            with self.lock:
                self.peak_kib = max(self.peak_kib, total)
                if self.cap_kib is not None and total > self.cap_kib:
                    self.exceeded = True
                    for pid in pids:
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            time.sleep(0.02)


class Builder:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.cc = args.cc
        self.compile_flags = list(args.cflags)
        if args.main_rename:
            self.compile_flags.append("-Dmain=baton2_runtime_main")
        self.link_flags = list(args.cflags)
        self.monitor = ProcessMonitor(args.max_aggregate_rss_mb * 1024 if args.max_aggregate_rss_mb else None)
        self.monitor.start()
        self.logs = args.outdir / "logs"
        self.logs.mkdir(parents=True, exist_ok=True)
        self.records: list[dict] = []
        self._counter = 0

    def close(self) -> None:
        self.monitor.stop()

    def run(self, cmd: list[str], cwd: Path, tag: str) -> dict:
        with self.monitor.lock:
            self._counter += 1
            index = self._counter
        out_path = self.logs / f"{index:04d}-{tag}.stdout"
        err_path = self.logs / f"{index:04d}-{tag}.stderr"
        started = time.monotonic()
        if self.args.ccache:
            cmd = [self.args.ccache, *cmd]
        with out_path.open("wb") as out, err_path.open("wb") as err:
            proc = subprocess.Popen(cmd, cwd=str(cwd), stdout=out, stderr=err)
            self.monitor.register(proc.pid)
            try:
                _, status, usage = os.wait4(proc.pid, 0)
            finally:
                self.monitor.unregister(proc.pid)
        wall = time.monotonic() - started
        proc.returncode = os.waitstatus_to_exitcode(status)
        record = {
            "tag": tag,
            "cmd": cmd,
            "cwd": str(cwd),
            "exit": proc.returncode,
            "wall_s": wall,
            "user_s": usage.ru_utime,
            "sys_s": usage.ru_stime,
            "maxrss_kib": usage.ru_maxrss,
            "stdout": str(out_path),
            "stdout_sha256": sha256_file(out_path),
            "stderr": str(err_path),
            "stderr_sha256": sha256_file(err_path),
            "stderr_tail": err_path.read_text(errors="replace")[-2000:],
        }
        self.records.append(record)
        if proc.returncode != 0:
            raise SystemExit(
                f"command failed ({proc.returncode}): {' '.join(cmd)}\n"
                f"{record['stderr_tail']}"
            )
        return record

    def run_many(self, jobs: list[tuple[list[str], Path, str]]) -> list[dict]:
        with ThreadPoolExecutor(max_workers=self.args.jobs) as pool:
            futures = [pool.submit(self.run, cmd, cwd, tag) for cmd, cwd, tag in jobs]
            results = [future.result() for future in futures]
        return results


def nm_symbols(obj: Path) -> dict[str, tuple[str, int]]:
    out = subprocess.check_output(
        ["nm", "-S", "--defined-only", "--format=posix", str(obj)],
        text=True,
    )
    symbols: dict[str, tuple[str, int]] = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 4:
            continue
        name, kind, _value, size = parts[0], parts[1], parts[2], parts[3]
        symbols[name] = (kind, int(size, 16) if size else 0)
    return symbols


def verify_symbols(oracle: Path, pieces: list[Path]) -> dict:
    oracle_all = nm_symbols(oracle)
    oracle_globals = {name: value for name, value in oracle_all.items() if value[0].isupper()}
    globals_by_piece: dict[str, list[tuple[str, str, int]]] = {}
    for piece in pieces:
        for name, (kind, size) in nm_symbols(piece).items():
            if kind.isupper():
                globals_by_piece.setdefault(name, []).append((piece.name, kind, size))
    duplicates = {name: value for name, value in globals_by_piece.items() if len(value) > 1}
    union = {name: (value[0][1], value[0][2]) for name, value in globals_by_piece.items()}
    missing = sorted(set(oracle_globals) - set(union))
    new = sorted(set(union) - set(oracle_globals))
    absent_from_oracle = [name for name in new if name not in oracle_all]
    type_mismatch = [
        (name, oracle_globals[name][0], union[name][1])
        for name in set(oracle_globals) & set(union)
        if oracle_globals[name][0] != union[name][0]
    ]
    size_changes = [
        (name, oracle_globals[name][1], union[name][1])
        for name in set(oracle_globals) & set(union)
        if oracle_globals[name][1] != union[name][1]
    ]
    oracle_locals = set(oracle_all) - set(oracle_globals)
    data_symbols = {
        name: value for name, value in union.items() if value[0] in ("B", "D", "R")
    }
    return {
        "oracle_global_count": len(oracle_globals),
        "oracle_local_count": len(oracle_locals),
        "piece_global_count": len(union),
        "global_data_symbol_count": len(data_symbols),
        "new_globals_present_as_oracle_locals": sum(
            1 for name in new if name in oracle_locals
        ),
        "duplicate_definitions": {name: value for name, value in list(duplicates.items())[:20]},
        "duplicate_definition_count": len(duplicates),
        "oracle_globals_missing": missing,
        "new_globals": new,
        "new_globals_absent_from_oracle_object": absent_from_oracle,
        "new_globals_absent_count": len(absent_from_oracle),
        "type_mismatches": type_mismatch,
        "size_changes": size_changes,
        "identity_ok": not duplicates and not missing and not type_mismatch,
    }


def run_binary(binary: Path, args: list[str], cwd: Path, timeout: float = 20.0) -> dict:
    started = time.monotonic()
    try:
        proc = subprocess.run(
            [str(binary), *args],
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "binary": str(binary),
            "timeout": True,
            "stdout": exc.stdout.decode(errors="replace") if exc.stdout else "",
            "stderr": exc.stderr.decode(errors="replace") if exc.stderr else "",
            "exit": None,
        }
    stdout_text = proc.stdout.decode(errors="replace")
    stderr_text = proc.stderr.decode(errors="replace")
    normalized_stdout = stdout_text.replace(str(binary), "<BIN>")
    normalized_stderr = stderr_text.replace(str(binary), "<BIN>")
    return {
        "binary": str(binary),
        "timeout": False,
        "wall_s": time.monotonic() - started,
        "stdout": stdout_text,
        "stderr": stderr_text,
        "stdout_sha256": sha256_bytes(proc.stdout),
        "stderr_sha256": sha256_bytes(proc.stderr),
        "stdout_normalized_sha256": sha256_bytes(normalized_stdout.encode()),
        "stderr_normalized_sha256": sha256_bytes(normalized_stderr.encode()),
        "exit": proc.returncode,
    }


def build_sharded(
    builder: Builder,
    label: str,
    source_dir: Path,
    object_dir: Path,
    shard_sources: list[Path],
    core_source: Path,
    spins_source: Path,
    link_extra: list[str],
    binary: Path,
    use_pch: bool,
) -> dict:
    object_dir.mkdir(parents=True, exist_ok=True)
    builder.monitor.reset_peak()
    started = time.monotonic()
    pch_record = None
    pch_path = source_dir / "baton_segments.h.pch"

    core_obj = object_dir / "baton_core.o"
    spins_obj = object_dir / "baton_spins.o"

    if use_pch:
        pch_record = builder.run(
            [builder.cc, *builder.compile_flags, "-x", "c-header", "baton_segments.h", "-o", pch_path.name],
            source_dir,
            f"{label}-pch",
        )
        pch_path = source_dir / pch_path.name
        # Compile core and spins while the PCH is already available.
        builder.run_many(
            [
                ([builder.cc, *builder.compile_flags, "-c", core_source.name, "-o", str(core_obj)], source_dir, f"{label}-core"),
                ([builder.cc, *builder.compile_flags, "-c", spins_source.name, "-o", str(spins_obj)], source_dir, f"{label}-spins"),
            ]
        )
        jobs = []
        for src in shard_sources:
            obj = object_dir / (src.stem + ".o")
            jobs.append(
                (
                    [
                        builder.cc,
                        *builder.compile_flags,
                        "-include-pch",
                        str(pch_path),
                        "-c",
                        src.name,
                        "-o",
                        str(obj),
                    ],
                    source_dir,
                    f"{label}-{src.stem}",
                )
            )
        shard_records = builder.run_many(jobs)
    else:
        jobs = [
            ([builder.cc, *builder.compile_flags, "-c", core_source.name, "-o", str(core_obj)], source_dir, f"{label}-core"),
            ([builder.cc, *builder.compile_flags, "-c", spins_source.name, "-o", str(spins_obj)], source_dir, f"{label}-spins"),
        ]
        for src in shard_sources:
            obj = object_dir / (src.stem + ".o")
            jobs.append(
                (
                    [builder.cc, *builder.compile_flags, "-c", src.name, "-o", str(obj)],
                    source_dir,
                    f"{label}-{src.stem}",
                )
            )
        shard_records = builder.run_many(jobs)

    objects = [core_obj, spins_obj] + [object_dir / (src.stem + ".o") for src in shard_sources]
    link_cmd = [builder.cc, *builder.link_flags, *[str(obj) for obj in objects], *link_extra, "-o", str(binary)]
    link_record = builder.run(link_cmd, source_dir, f"{label}-link")
    total_wall = time.monotonic() - started
    return {
        "label": label,
        "use_pch": use_pch,
        "pch": pch_record,
        "shard_compiles": shard_records,
        "link": link_record,
        "total_wall_s": total_wall,
        "aggregate_peak_kib": builder.monitor.peak_kib,
        "sum_process_maxrss_kib": sum(r["maxrss_kib"] for r in shard_records + [link_record])
        + (0 if use_pch else 0),
        "objects": [str(obj) for obj in objects],
        "binary": str(binary),
        "binary_sha256": sha256_file(binary),
    }


def build_oracle(
    builder: Builder,
    source: Path,
    object_dir: Path,
    link_extra: list[str],
    binary: Path,
) -> dict:
    object_dir.mkdir(parents=True, exist_ok=True)
    builder.monitor.reset_peak()
    started = time.monotonic()
    obj = object_dir / "oracle.o"
    compile_record = builder.run(
        [builder.cc, *builder.compile_flags, "-c", str(source), "-o", str(obj)],
        source.parent,
        "oracle-compile",
    )
    link_record = builder.run(
        [builder.cc, *builder.link_flags, str(obj), *link_extra, "-o", str(binary)],
        source.parent,
        "oracle-link",
    )
    total_wall = time.monotonic() - started
    return {
        "label": "oracle-one-tu",
        "compile": compile_record,
        "link": link_record,
        "total_wall_s": total_wall,
        "aggregate_peak_kib": builder.monitor.peak_kib,
        "object": str(obj),
        "object_sha256": sha256_file(obj),
        "binary": str(binary),
        "binary_sha256": sha256_file(binary),
    }


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", required=True, type=Path)
    ap.add_argument("--build-only", action="store_true", help="compile and link shards without an oracle run")
    ap.add_argument("--binary", type=Path, help="output binary path for --build-only")
    ap.add_argument("--ccache", help="optional ccache executable used as the compiler launcher")
    ap.add_argument("--outdir", required=True, type=Path)
    ap.add_argument("--shards", type=int, default=8)
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--cc", default="/usr/bin/clang-19")
    ap.add_argument("--cflags", nargs="+", default=["-O1", "-pthread"])
    ap.add_argument("--cflag", action="append", help="one compiler flag; repeat to preserve leading dashes")
    ap.add_argument("--link-extra", nargs="*", default=[])
    ap.add_argument("--link-flags", default="", help="extra compiler/linker flags, shell-split")
    ap.add_argument("--run-args", nargs="*", default=[])
    ap.add_argument("--max-aggregate-rss-mb", type=int, default=8192)
    ap.add_argument("--main-rename", action="store_true",
                    help="compile emitted C with -Dmain=baton2_runtime_main")
    ap.add_argument("--skip-oracle", action="store_true",
                    help="reuse an existing serial object/binary instead of recompiling")
    ap.add_argument("--baseline-object", type=Path)
    ap.add_argument("--baseline-binary", type=Path)
    ap.add_argument("--no-pch", action="store_true", help="skip the PCH arm")
    ap.add_argument("--pch-only", action="store_true", help="build only the PCH arm")
    ap.add_argument("--reuse-split", action="store_true",
                    help="reuse an existing split directory when its input hash matches")
    ap.add_argument("--determinism", action="store_true")
    args = ap.parse_args(argv)
    if args.cflag is not None:
        args.cflags = args.cflag
    link_extra = args.link_extra + shlex.split(args.link_flags)

    if args.pch_only and args.no_pch:
        raise SystemExit("--pch-only and --no-pch are mutually exclusive")
    args.outdir.mkdir(parents=True, exist_ok=True)
    source = args.source.resolve()
    split_dir = args.outdir / "split"
    split_started = time.monotonic()
    if args.reuse_split and (split_dir / "manifest.json").is_file():
        manifest = json.loads((split_dir / "manifest.json").read_text())
        if manifest.get("input_sha256") != sha256_file(source):
            raise SystemExit("reused split does not match the input hash")
    else:
        manifest = shard.build(source, split_dir, args.shards)
    split_wall = time.monotonic() - split_started
    (args.outdir / "split-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    shard_sources = sorted(split_dir.glob("shard_*.c"))
    core_source = split_dir / "baton_core.c"
    spins_source = split_dir / "baton_spins.c"

    builder = Builder(args)
    if args.build_only:
        binary = args.binary or (args.outdir / "sharded-nopch")
        try:
            build = build_sharded(
                builder,
                "nopch",
                split_dir,
                args.outdir / "nopch",
                shard_sources,
                core_source,
                spins_source,
                link_extra,
                binary,
                use_pch=False,
            )
        finally:
            builder.close()
        build["whole_route_wall_s"] = split_wall + build["total_wall_s"]
        receipt = {
            "schema": "baton-cgen-clang-parallel-build-v1",
            "mode": "sharded-build",
            "source": {
                "path": str(source),
                "bytes": source.stat().st_size,
                "sha256": sha256_file(source),
            },
            "compiler": {
                "path": args.cc,
                "version": subprocess.check_output(
                    [args.cc, "--version"], text=True
                ).splitlines()[0],
                "ccache": args.ccache,
            },
            "compile_flags": builder.compile_flags,
            "link_flags": builder.link_flags + link_extra,
            "shard_count": args.shards,
            "jobs": args.jobs,
            "split_manifest": manifest,
            "split_wall_s": split_wall,
            "build": build,
            "aggregate_rss_cap_kib": args.max_aggregate_rss_mb * 1024
                if args.max_aggregate_rss_mb else None,
            "process_records": builder.records,
        }
        receipt_path = args.outdir / "build-receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps({
            "binary": str(binary),
            "binary_sha256": build["binary_sha256"],
            "source_sha256": receipt["source"]["sha256"],
            "split_manifest": str(args.outdir / "split-manifest.json"),
            "receipt": str(receipt_path),
            "whole_route_wall_s": build["whole_route_wall_s"],
        }, indent=2))
        return 0
    try:
        if args.skip_oracle:
            if args.baseline_object is None or args.baseline_binary is None:
                raise SystemExit("--skip-oracle requires --baseline-object and --baseline-binary")
            oracle = {
                "label": "baseline-serial",
                "object": str(args.baseline_object),
                "object_sha256": sha256_file(args.baseline_object),
                "binary": str(args.baseline_binary),
                "binary_sha256": sha256_file(args.baseline_binary),
                "reused": True,
            }
        else:
            oracle = build_oracle(
                builder,
                source,
                args.outdir / "oracle",
                link_extra,
                args.outdir / "oracle-bin",
            )
        no_pch = None
        if not args.pch_only:
            no_pch = build_sharded(
                builder,
                "nopch",
                split_dir,
                args.outdir / "nopch",
                shard_sources,
                core_source,
                spins_source,
                link_extra,
                args.outdir / "sharded-nopch",
                use_pch=False,
            )
        pch = None
        if not args.no_pch:
            pch = build_sharded(
                builder,
                "pch",
                split_dir,
                args.outdir / "pch",
                shard_sources,
                core_source,
                spins_source,
                link_extra,
                args.outdir / "sharded-pch",
                use_pch=True,
            )
        primary = no_pch or pch
        if primary is None:
            raise SystemExit("nothing to build: both arms were disabled")
        for arm in (no_pch, pch):
            if arm is not None:
                arm["whole_route_wall_s"] = split_wall + arm["total_wall_s"]
        symbols = verify_symbols(
            Path(oracle["object"]),
            [Path(obj) for obj in primary["objects"]],
        )
        oracle_run = run_binary(Path(oracle["binary"]), args.run_args, args.outdir)
        nopch_run = run_binary(Path(no_pch["binary"]), args.run_args, args.outdir) if no_pch else None
        pch_run = run_binary(Path(pch["binary"]), args.run_args, args.outdir) if pch else None
    finally:
        builder.close()

    determinism = None
    if args.determinism and no_pch:
        det_builder = Builder(args)
        try:
            second = build_sharded(
                det_builder,
                "nopch-repeat",
                split_dir,
                args.outdir / "nopch-repeat",
                shard_sources,
                core_source,
                spins_source,
                link_extra,
                args.outdir / "sharded-nopch-repeat",
                use_pch=False,
            )
            determinism = {
                "object_hashes_match": [
                    sha256_file(Path(a)) == sha256_file(Path(b))
                    for a, b in zip(no_pch["objects"], second["objects"])
                ],
                "binary_hashes_match": no_pch["binary_sha256"] == second["binary_sha256"],
                "second": second,
            }
        finally:
            det_builder.close()

    def same(left: dict, right: dict) -> bool:
        return (
            not left["timeout"]
            and not right["timeout"]
            and left["exit"] == right["exit"]
            and left["stdout_normalized_sha256"] == right["stdout_normalized_sha256"]
            and left["stderr_normalized_sha256"] == right["stderr_normalized_sha256"]
        )

    receipt = {
        "schema": "baton-cgen-clang-parallel-receipt-v1",
        "source": {
            "path": str(source),
            "bytes": source.stat().st_size,
            "sha256": sha256_file(source),
        },
        "compiler": {
            "path": args.cc,
            "version": subprocess.check_output([args.cc, "--version"], text=True).splitlines()[0],
        },
        "flags": args.cflags,
        "shard_count": args.shards,
        "jobs": args.jobs,
        "split_manifest": manifest,
        "split_wall_s": split_wall,
        "oracle": oracle,
        "sharded_no_pch": no_pch,
        "sharded_pch": pch,
        "symbols": symbols,
        "runtime": {
            "oracle": oracle_run,
            "sharded_no_pch": nopch_run,
            "sharded_pch": pch_run,
            "oracle_matches_no_pch": same(oracle_run, nopch_run) if nopch_run else None,
            "oracle_matches_pch": same(oracle_run, pch_run) if pch_run else None,
        },
        "determinism": determinism,
        "aggregate_rss_cap_kib": args.max_aggregate_rss_mb * 1024,
        "process_records": builder.records,
    }
    receipt_path = args.outdir / "receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")

    summary = {
        "source": str(source),
        "source_sha256": receipt["source"]["sha256"],
        "segments": manifest["counts"]["segments"],
        "shards": args.shards,
        "oracle_wall_s": oracle.get("total_wall_s"),
        "split_wall_s": split_wall,
        "nopch_wall_s": no_pch["total_wall_s"] if no_pch else None,
        "pch_wall_s": pch["total_wall_s"] if pch else None,
        "nopch_whole_route_wall_s": (split_wall + no_pch["total_wall_s"]) if no_pch else None,
        "pch_whole_route_wall_s": (split_wall + pch["total_wall_s"]) if pch else None,
        "oracle_peak_kib": oracle.get("aggregate_peak_kib"),
        "nopch_peak_kib": no_pch["aggregate_peak_kib"] if no_pch else None,
        "pch_peak_kib": pch["aggregate_peak_kib"] if pch else None,
        "symbols_identity_ok": symbols["identity_ok"],
        "runtime_oracle_matches_no_pch": receipt["runtime"]["oracle_matches_no_pch"],
        "runtime_oracle_matches_pch": receipt["runtime"]["oracle_matches_pch"],
        "determinism": determinism and {
            "objects": all(determinism["object_hashes_match"]),
            "binary": determinism["binary_hashes_match"],
        },
        "receipt": str(receipt_path),
    }
    print(json.dumps(summary, indent=2))
    if not symbols["identity_ok"]:
        return 2
    if receipt["runtime"]["oracle_matches_no_pch"] is False:
        return 3
    if receipt["runtime"]["oracle_matches_pch"] is False:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
