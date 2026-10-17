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
        staged_binary = staging / output.name
        link_log = staging / "link.log"
        link_wall = command_output([args.cc, "-O1", "-pthread", str(entry),
                                    *map(str, ordered_objects), "-lsqlite3", "-lm",
                                    "-o", str(staged_binary)], link_log, staging)
        os.replace(staged_binary, output)
        summary = {
            "route": "linux-x86_64-clang-19-no-pch",
            "compiler": args.cc,
            "source": str(source),
            "source_sha256": sha256(source),
            "shards": len(shard_sources),
            "segments": manifest["counts"]["segments"],
            "compile_wall_seconds": round(compile_wall, 3),
            "link_wall_seconds": round(link_wall, 3),
            "output": str(output),
            "output_sha256": sha256(output),
        }
        print(json.dumps(summary, sort_keys=True), file=sys.stderr)
        succeeded = True
        return 0
    finally:
        if succeeded:
            shutil.rmtree(staging)
        else:
            print(f"sharded build artifacts retained at {staging}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
