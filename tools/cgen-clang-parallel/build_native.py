#!/usr/bin/env python3
"""Build the coordinator's emitted C with the qualified Linux Clang route."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path


SHARDS = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def qualified_linux_clang(cc: str, system: str | None = None,
                          machine: str | None = None) -> bool:
    system = system or platform.system()
    machine = machine or platform.machine()
    if system != "Linux" or machine not in ("x86_64", "amd64"):
        return False
    try:
        version = subprocess.run([cc, "--version"], check=True, text=True,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout
    except (OSError, subprocess.CalledProcessError):
        return False
    return re.search(r"\bclang version 19(?:\.\d+)?\b", version) is not None


def command_output(command: list[str], log: Path, cwd: Path) -> float:
    started = time.monotonic()
    with log.open("wb") as output:
        result = subprocess.run(command, cwd=cwd, stdout=output,
                                stderr=subprocess.STDOUT, check=False)
    elapsed = time.monotonic() - started
    if result.returncode:
        detail = log.read_text(errors="replace")
        raise RuntimeError(
            f"command failed with exit {result.returncode}: {' '.join(command)}\n"
            f"{detail}\nfull build artifacts retained in {cwd}"
        )
    return elapsed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--entry", required=True, type=Path)
    parser.add_argument("--cc", required=True)
    parser.add_argument("--ccache", default="")
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    entry = args.entry.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    compile_prefix = [args.ccache, args.cc] if args.ccache else [args.cc]
    flags = ["-O1", "-pthread", "-Dmain=baton2_runtime_main"]

    if not qualified_linux_clang(args.cc):
        object_file = output.with_name(output.name + ".o")
        subprocess.run([*compile_prefix, *flags, "-c", str(source), "-o", str(object_file)],
                       check=True)
        subprocess.run([args.cc, "-O1", "-pthread", str(entry), str(object_file),
                        "-lsqlite3", "-lm", "-o", str(output)], check=True)
        stale_receipt = output.with_name(output.name + ".build.json")
        if stale_receipt.exists():
            stale_receipt.unlink()
        return 0

    staging = Path(tempfile.mkdtemp(prefix=f".{output.name}.clang-shards-",
                                    dir=output.parent))
    succeeded = False
    try:
        split_dir = staging / "split"
        split_log = staging / "split.log"
        split_cmd = [sys.executable,
                     str(Path(__file__).with_name("shard_emitted_c.py")),
                     "--input", str(source), "--outdir", str(split_dir),
                     "--shards", str(SHARDS)]
        command_output(split_cmd, split_log, staging)
        manifest = json.loads((split_dir / "manifest.json").read_text())
        shard_sources = sorted(split_dir.glob("shard_*.c"))
        core = split_dir / "baton_core.c"
        spins = split_dir / "baton_spins.c"
        sources = [core, spins, *shard_sources]
        if len(shard_sources) != SHARDS:
            raise RuntimeError(f"expected {SHARDS} C shards, found {len(shard_sources)}")

        jobs: list[tuple[Path, Path]] = []
        for item in sources:
            obj = staging / (item.stem + ".o")
            log = staging / (item.stem + ".compile.log")
            jobs.append((item, obj))

        started = time.monotonic()
        def compile_one(job: tuple[Path, Path]) -> tuple[Path, float]:
            item, obj = job
            elapsed = command_output([*compile_prefix, *flags, "-c", str(item), "-o", str(obj)],
                                     staging / (item.stem + ".compile.log"), staging)
            return obj, elapsed

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            objects = list(pool.map(compile_one, jobs))
        compile_wall = time.monotonic() - started
        ordered_objects = [obj for obj, _ in objects]
        staged_object = staging / (output.name + ".o")
        aggregate_log = staging / "aggregate.log"
        aggregate_command = [args.cc, "-r", *map(str, ordered_objects),
                             "-o", str(staged_object)]
        aggregate_wall = command_output(aggregate_command, aggregate_log, staging)
        staged_binary = staging / output.name
        link_log = staging / "link.log"
        link_command = [args.cc, "-O1", "-pthread", str(entry),
                        str(staged_object), "-lsqlite3", "-lm",
                        "-o", str(staged_binary)]
        link_wall = command_output(link_command, link_log, staging)
        artifact_object = output.with_name(output.name + ".o")
        artifact_receipt = output.with_name(output.name + ".build.json")
        receipt_tmp = staging / "build.json"
        compile_rows = [
            {"source_name": item.name, "object_name": obj.name,
             "source_sha256": sha256(item), "object_sha256": sha256(obj)}
            for item, (obj, _) in zip(sources, objects)]
        receipt = {
            "schema": "baton2-clang-sharded-main-build-v1",
            "route": "linux-x86_64-clang-19-no-pch",
            "compiler": args.cc,
            "compiler_version": subprocess.run(
                [args.cc, "--version"], check=True, text=True,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.splitlines()[0],
            "source": str(source),
            "source_sha256": sha256(source),
            "entry": str(entry),
            "entry_sha256": sha256(entry),
            "splitter": str(Path(__file__).with_name("shard_emitted_c.py").resolve()),
            "splitter_sha256": sha256(Path(__file__).with_name("shard_emitted_c.py")),
            "driver": str(Path(__file__).resolve()),
            "driver_sha256": sha256(Path(__file__).resolve()),
            "ccache": str(Path(shutil.which(args.ccache)).resolve()) if args.ccache else "",
            "ccache_sha256": sha256(Path(shutil.which(args.ccache))) if args.ccache else "",
            "split_manifest_file_sha256": sha256(split_dir / "manifest.json"),
            "split_manifest_sha256": hashlib.sha256(json.dumps(
                manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "split_manifest": manifest,
            "shards": len(shard_sources),
            "segments": manifest["counts"]["segments"],
            "compile_flags": flags,
            "compile_objects": compile_rows,
            "aggregate_command": [args.cc, "-r",
                                  *[row["object_name"] for row in compile_rows],
                                  "-o", output.name + ".o"],
            "aggregate_wall_seconds": round(aggregate_wall, 3),
            "object": str(artifact_object),
            "object_sha256": sha256(staged_object),
            "link_command": [args.cc, "-O1", "-pthread", str(entry),
                             output.name + ".o", "-lsqlite3", "-lm", "-o", output.name],
            "compile_wall_seconds": round(compile_wall, 3),
            "link_wall_seconds": round(link_wall, 3),
            "output": str(output),
            "output_sha256": sha256(staged_binary),
        }
        receipt_tmp.write_text(json.dumps(receipt, sort_keys=True) + "\n")
        os.replace(staged_object, artifact_object)
        os.replace(staged_binary, output)
        os.replace(receipt_tmp, artifact_receipt)
        print(json.dumps({"route": receipt["route"], "source_sha256": receipt["source_sha256"],
                          "object_sha256": receipt["object_sha256"],
                          "output_sha256": receipt["output_sha256"],
                          "receipt": str(artifact_receipt),
                          "receipt_sha256": sha256(artifact_receipt)}, sort_keys=True), file=sys.stderr)
        succeeded = True
        return 0
    finally:
        if succeeded:
            shutil.rmtree(staging)
        else:
            print(f"sharded build artifacts retained at {staging}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
