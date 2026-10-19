#!/usr/bin/env python3
"""Content-addressed identity records for host compile queue keys.

The queue daemon and client use these functions to derive one key from the
source closure, toolchain bytes, entry path, mode, normalized argv and
options. Returned records contain relative paths only, so identical source and
compiler bytes in different worktrees or hosts produce the same key.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

SCHEMA = "baton-compile-queue-identity-v1"

_CHUNK_BYTES = 1 << 20
_WRAPPER_READ_LIMIT = 1 << 20
_IMPORT_LINE = re.compile(r"^import[ \t]+(\S+)(?:[ \t]+as[ \t]+\S+)?$")
_EXEC_LINE = re.compile(
    r'^[ \t]*exec[ \t]+"([^"]+)"[ \t]+"\$@"[ \t]*$', re.MULTILINE
)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    with Path(path).open("rb") as stream:
        digest = hashlib.sha256()
        for chunk in iter(lambda: stream.read(_CHUNK_BYTES), b""):
            digest.update(chunk)
        return digest.hexdigest()


def canonical_json(value) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def key_for(material: dict) -> str:
    return sha256_bytes(canonical_json(material).encode("utf-8"))


def source_closure(root: Path, entry: Path) -> dict:
    """Return the entry file, every reachable import and a closure digest.

    Import lines are matched at column zero after trailing whitespace is
    removed. Relative targets resolve against the importing file's directory.
    Cycles and repeated imports are visited once.
    """
    root_path = Path(root).resolve()
    entry_path = Path(entry).resolve()
    if not entry_path.is_relative_to(root_path):
        raise ValueError(f"entry is outside root: {entry_path}")
    records: dict[Path, dict] = {}
    pending = [entry_path]
    while pending:
        current = pending.pop()
        if current in records:
            continue
        try:
            data = current.read_bytes()
        except OSError as error:
            raise ValueError(f"unreadable source file: {current}") from error
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise ValueError(f"source file is not UTF-8: {current}") from error
        records[current] = {"sha256": sha256_bytes(data), "bytes": len(data)}
        imports = []
        for line in text.splitlines():
            match = _IMPORT_LINE.match(line.rstrip())
            if match is None:
                continue
            target = match.group(1)
            if target == "Base":
                continue
            if target.startswith("/"):
                raise ValueError(f"absolute import target: {target}")
            resolved = (current.parent / target).resolve()
            if not resolved.is_relative_to(root_path):
                raise ValueError(f"import outside root: {target}")
            imports.append(resolved)
        pending.extend(reversed(imports))
    files = [
        {
            "path": path.relative_to(root_path).as_posix(),
            "sha256": records[path]["sha256"],
            "bytes": records[path]["bytes"],
        }
        for path in sorted(
            records, key=lambda item: item.relative_to(root_path).as_posix()
        )
    ]
    return {
        "schema": SCHEMA,
        "entry": entry_path.relative_to(root_path).as_posix(),
        "files": files,
        "closure_sha256": sha256_bytes(canonical_json(files).encode("utf-8")),
    }


def _wrapper_target(path: Path) -> Path | None:
    """Return the absolute exec target of a shell wrapper, or None."""
    try:
        if not path.is_file() or path.stat().st_size > _WRAPPER_READ_LIMIT:
            return None
        text = path.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if not text.startswith("#!"):
        return None
    match = _EXEC_LINE.search(text)
    if match is None:
        return None
    target = Path(match.group(1))
    return target if target.is_absolute() else None


def _chain_sha256(chain: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in chain:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(_CHUNK_BYTES), b""):
                digest.update(chunk)
    return digest.hexdigest()


def _release_root(target: Path) -> Path | None:
    for candidate in target.parents:
        if (candidate / "bend2" / "main.ts").is_file() and (
            candidate / "bin" / "bun"
        ).is_file():
            return candidate
    return None


def _release_files(root: Path) -> list[dict]:
    paths: list[Path] = []
    for directory, _directories, names in os.walk(root / "bend2"):
        for name in names:
            path = Path(directory) / name
            if path.is_file():
                paths.append(path)
    bun = root / "bin" / "bun"
    if bun.is_file():
        paths.append(bun)
    files = [
        {
            "path": path.relative_to(root).as_posix(),
            "sha256": sha256_file(path),
            "bytes": path.stat().st_size,
        }
        for path in paths
    ]
    files.sort(key=lambda item: item["path"])
    return files


def executable_identity(path: str | Path) -> dict:
    """Hash an executable, following installed shell wrapper exec targets.

    Shell wrappers contribute their bytes to ``entry_sha256``. A chain that
    ends inside a Bend release directory containing ``bend2/main.ts`` and
    ``bin/bun`` returns the full release tree identity.
    """
    current = Path(path).resolve()
    chain: list[Path] = []
    seen: set[Path] = set()
    while current not in seen:
        seen.add(current)
        chain.append(current)
        target = _wrapper_target(current)
        if target is None:
            break
        current = target.resolve()
    entry_sha256 = _chain_sha256(chain)
    release = _release_root(chain[-1])
    if release is not None:
        files = _release_files(release)
        return {
            "kind": "bend-release",
            "entry_sha256": entry_sha256,
            "files": files,
            "tree_sha256": sha256_bytes(
                canonical_json(files).encode("utf-8")
            ),
        }
    return {
        "kind": "executable",
        "path": chain[-1].name,
        "sha256": entry_sha256,
    }


def cc_identity(cc: str | Path) -> dict:
    """Resolve a C compiler, hash the driver and record its version text."""
    text = os.fspath(cc)
    found = shutil.which(text)
    if found is None:
        raise FileNotFoundError(f"C compiler not found or not executable: {text}")
    driver = Path(found).resolve()
    driver_sha256 = sha256_file(driver)
    completed = subprocess.run(
        [str(driver), "--version"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    output = completed.stdout
    version = ""
    for line in output.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            version = line[:200]
            break
    return {
        "schema": SCHEMA,
        "kind": "cc",
        "executable": driver.name,
        "sha256": driver_sha256,
        "version_sha256": sha256_bytes(output),
        "version": version,
    }


def normalize_argv(argv: list[str], outputs: dict[str, str]) -> list[str]:
    """Replace argv tokens that equal an output path with ``{out:<name>}``.

    The comparison is exact for the full token, using the output path as
    supplied and its resolved form.
    """
    replacements: dict[str, str] = {}
    for name, output in outputs.items():
        placeholder = f"{{out:{name}}}"
        text = os.fspath(output)
        replacements.setdefault(text, placeholder)
        replacements.setdefault(str(Path(text).resolve()), placeholder)
    normalized: list[str] = []
    for token in argv:
        replacement = replacements.get(token)
        if replacement is None:
            try:
                resolved = str(Path(token).resolve())
            except (OSError, ValueError):
                resolved = None
            if resolved is not None:
                replacement = replacements.get(resolved)
        normalized.append(token if replacement is None else replacement)
    return normalized


def key_material(
    kind: str,
    source: dict,
    toolchain: dict,
    entry: str,
    mode: str,
    argv: list[str],
    options: dict,
) -> dict:
    return {
        "schema": SCHEMA,
        "kind": kind,
        "source": source,
        "toolchain": toolchain,
        "entry": entry,
        "mode": mode,
        "argv": argv,
        "options": options,
    }


def build_key(kind, source, toolchain, entry, mode, argv, options) -> tuple[str, dict]:
    material = key_material(kind, source, toolchain, entry, mode, argv, options)
    return key_for(material), material
