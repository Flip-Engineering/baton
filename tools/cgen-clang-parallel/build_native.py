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
import secrets
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


def command_output(command: list[str], stdout_log: Path, stderr_log: Path, cwd: Path) -> dict:
    started = time.monotonic()
    with stdout_log.open("wb") as stdout, stderr_log.open("wb") as stderr:
        result = subprocess.run(command, cwd=cwd, stdout=stdout, stderr=stderr, check=False)
    elapsed = time.monotonic() - started
    record = {
        "argv": command,
        "returncode": result.returncode,
        "wait_completed": True,
        "natural_exit": result.returncode >= 0,
        "elapsed_seconds": round(elapsed, 3),
        "stdout_sha256": sha256(stdout_log),
        "stderr_sha256": sha256(stderr_log),
    }
    if result.returncode:
        detail = (stdout_log.read_text(errors="replace") +
                  stderr_log.read_text(errors="replace"))[-32_768:]
        raise RuntimeError(
            f"command failed with exit {result.returncode}: {' '.join(command)}\n"
            f"{detail}\nfull build artifacts retained in {cwd}"
        )
    return record


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

    compiler_path = Path(shutil.which(args.cc) or args.cc).resolve()
    compiler = str(compiler_path)
    ccache_path = (Path(shutil.which(args.ccache) or args.ccache).resolve()
                   if args.ccache else None)
    compile_prefix = [str(ccache_path), compiler] if ccache_path else [compiler]
    flags = ["-O1", "-pthread", "-Dmain=baton2_runtime_main"]

    if not qualified_linux_clang(compiler):
        object_file = output.with_name(output.name + ".o")
        subprocess.run([*compile_prefix, *flags, "-c", str(source), "-o", str(object_file)],
                       check=True)
        subprocess.run([compiler, "-O1", "-pthread", str(entry), str(object_file),
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
        split_record = command_output(split_cmd, split_log, staging / "split.stderr", staging)
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
            jobs.append((item, obj))

        started = time.monotonic()
        def compile_one(job: tuple[Path, Path]) -> tuple[Path, Path, dict]:
            item, obj = job
            command = [*compile_prefix, *flags, "-c", str(item), "-o", str(obj)]
            record = command_output(command, staging / (item.stem + ".stdout"),
                                    staging / (item.stem + ".stderr"), staging)
            return item, obj, record

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            objects = list(pool.map(compile_one, jobs))
        compile_wall = time.monotonic() - started
        ordered_objects = [obj for _, obj, _ in objects]
        staged_object = staging / (output.name + ".o")
        aggregate_command = [compiler, "-r", *map(str, ordered_objects),
                             "-o", str(staged_object)]
        aggregate_record = command_output(aggregate_command, staging / "aggregate.stdout",
                                          staging / "aggregate.stderr", staging)
        staged_binary = staging / output.name
        link_command = [compiler, "-O1", "-pthread", str(entry),
                        str(staged_object), "-lsqlite3", "-lm",
                        "-o", str(staged_binary)]
        link_record = command_output(link_command, staging / "link.stdout",
                                     staging / "link.stderr", staging)
        artifact_object = output.with_name(output.name + ".o")
        artifact_receipt = output.with_name(output.name + ".build.json")
        receipt_tmp = staging / "build.json"
        object_directory = output.with_name(
            output.name + ".objects-" + secrets.token_hex(8))
        compile_rows = []
        for item, obj, record in objects:
            compile_rows.append({
                "source_name": item.name,
                "source_sha256": sha256(item),
                "object_name": obj.name,
                "object_path": str(object_directory / obj.name),
                "object_sha256": sha256(obj),
                "compile": record,
            })
        version_record = command_output([compiler, "--version"],
                                        staging / "compiler-version.stdout",
                                        staging / "compiler-version.stderr", staging)
        compiler_version_output = (staging / "compiler-version.stdout").read_text(errors="replace")
        if version_record["returncode"] != 0 or not compiler_version_output.splitlines():
            raise RuntimeError("Clang version probe returned no version line.")
        receipt = {
            "schema": "baton2-clang-sharded-main-build-v2",
            "route": "linux-x86_64-clang-19-no-pch",
            "compiler": compiler,
            "compiler_sha256": sha256(compiler_path),
            "compiler_version": compiler_version_output.splitlines()[0],
            "compiler_version_sha256": sha256(staging / "compiler-version.stdout"),
            "compiler_version_probe": version_record,
            "source": str(source),
            "source_sha256": sha256(source),
            "entry": str(entry),
            "entry_sha256": sha256(entry),
            "splitter": str(Path(__file__).with_name("shard_emitted_c.py").resolve()),
            "splitter_sha256": sha256(Path(__file__).with_name("shard_emitted_c.py")),
            "driver": str(Path(__file__).resolve()),
            "driver_sha256": sha256(Path(__file__).resolve()),
            "ccache": str(ccache_path) if ccache_path else "",
            "ccache_sha256": sha256(ccache_path) if ccache_path else "",
            "split_manifest_sha256": hashlib.sha256(json.dumps(
                manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "split_manifest": manifest,
            "shards": len(shard_sources),
            "segments": manifest["counts"]["segments"],
            "compile_flags": flags,
            "object_directory": str(object_directory),
            "split": split_record,
            "compile_objects": compile_rows,
            "aggregate": aggregate_record,
            "aggregate_command": [compiler, "-r",
                                  *[row["object_name"] for row in compile_rows],
                                  "-o", output.name + ".o"],
            "object": str(artifact_object),
            "object_sha256": sha256(staged_object),
            "link": link_record,
            "link_command": [compiler, "-O1", "-pthread", str(entry),
                             output.name + ".o", "-lsqlite3", "-lm", "-o", output.name],
            "compile_wall_seconds": round(compile_wall, 3),
            "output": str(output),
            "output_sha256": sha256(staged_binary),
        }
        receipt_tmp.write_text(json.dumps(receipt, sort_keys=True) + "\n")
        staged_objects = staging / "retained-objects"
        staged_objects.mkdir()
        for _, obj, _ in objects:
            shutil.copyfile(obj, staged_objects / obj.name)
        os.replace(staged_objects, object_directory)
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
