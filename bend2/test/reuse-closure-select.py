#!/usr/bin/env python3
"""Synthetic end-to-end fixture for Main C reuse selection.

Builds a small Bend source tree whose Main entry imports a local
module and, through it, a foreign C input, plus a law module the
entry never imports. It prepares a closure proof with the real
production_inputs function, then drives the real select function:
an unrelated law change still selects the reused C, while a
changed imported module or foreign input selects a normal build.
No compiler is launched.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "reuse_native_main", ROOT / ".github/scripts/reuse-native-main.py")
reuse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reuse)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


def disk_rows(root):
    rows = []
    for path in sorted((root / "bend2/src").rglob("*")):
        if path.is_symlink():
            body = os.fsencode(os.readlink(path))
            mode = "120000"
        elif path.is_file():
            body = path.read_bytes()
            mode = "100755" if path.stat().st_mode & 0o111 else "100644"
        else:
            continue
        rows.append({
            "path": str(path.relative_to(root)), "mode": mode,
            "git_blob": hashlib.sha1(
                b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest(),
            "size_bytes": len(body),
            "sha256": hashlib.sha256(body).hexdigest()})
    return rows


def build_tree(root):
    write(root / "bend2/src/coordinator/main.bend",
          "import Base\nimport ./store.bend as Store\n\ndef main() -> U32:\n  Store.value\n")
    write(root / "bend2/src/coordinator/store.bend",
          "import Base\nimport ../host/process.bend as Process\n\ndef value() -> U32:\n  Process.value\n")
    write(root / "bend2/src/host/process.bend",
          "import Base\n\ndef value() -> U32:\n  foreign:\n    import \"./process-spawn.c\"\n")
    write(root / "bend2/src/host/process-spawn.c",
          "#include \"persistent-path.h\"\nint baton_process_spawn;\n")
    write(root / "bend2/src/host/persistent-path.h", "#define BATON_PERSISTENT_PATH 1\n")
    write(root / "bend2/src/coordinator/laws.bend",
          "import Base\nimport ./receive-laws.bend as ReceiveLaws\n")
    write(root / "bend2/src/coordinator/receive-laws.bend",
          "import Base\n\nlaw receive_law:\n  for x: U32 {x == x}\n")


def prepare_proof(source, generated):
    rows, issue = reuse.production_inputs(source, disk_rows(source))
    assert issue is None, issue
    origin = generated / "main-c-origin"
    origin.mkdir(parents=True)
    for name in ("production-inputs.json", "current-production-inputs.json"):
        (origin / name).write_text(json.dumps(rows, indent=2) + "\n")
    generated_c = generated / "baton2.c"
    generated_c.write_text("/* synthetic Main C */\n")
    proof = {
        "schema": "baton2-main-c-reuse-v1", "status": "reused",
        "root": str(source), "origin_source_commit": "synthetic",
        "generated_c_sha256": hashlib.sha256(generated_c.read_bytes()).hexdigest(),
        "generated_c_size": generated_c.stat().st_size,
        "origin_assets": []}
    proof_path = generated / "main-c-reuse.json"
    proof_path.write_text(json.dumps(proof, indent=2) + "\n")
    return proof_path, generated_c


def run_select(source, generated, proof_path, generated_c, compiler):
    tool_home = compiler.parent.parent
    expected, _ = reuse.directory_files(tool_home, [])
    origin = generated / "main-c-origin"
    (origin / "toolchain-files.json").write_text(json.dumps(expected, indent=2) + "\n")
    args = SimpleNamespace(
        source=source, bound_root=str(source), proof=proof_path,
        proof_sha256=reuse.digest(proof_path), generated_c=generated_c,
        compiler=compiler)
    result = {}
    reuse.select(args, result)
    return result


def main():
    with tempfile.TemporaryDirectory() as temporary:
        base = Path(temporary)
        source = base / "source"
        build_tree(source)
        compiler = base / "tool/bin/bend"
        write(compiler, "#!/bin/sh\n")
        compiler.chmod(0o755)
        write(base / "tool/bend2/base.bend", "# synthetic Base\n")
        generated = base / "generated"
        generated.mkdir()
        proof_path, generated_c = prepare_proof(source, generated)

        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "reused", result
        print("PASS prepared closure proof selects reused")

        write(source / "bend2/src/coordinator/receive-laws.bend",
              "import Base\n\nlaw receive_law:\n  for x: U32 {x == x}\n\nlaw another_law:\n  for y: U32 {y == y}\n")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "reused", result
        print("PASS unrelated law change still selects reused")

        write(source / "bend2/src/coordinator/store.bend",
              "import Base\nimport ../host/process.bend as Process\n\ndef value() -> U32:\n  Process.value\n\ndef extra() -> U32:\n  1\n")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "miss", result
        print("PASS changed imported module selects a normal build")

        build_tree(source)
        write(source / "bend2/src/host/process-spawn.c", "int baton_process_spawn_v2;\n")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "miss", result
        print("PASS changed foreign input selects a normal build")

        build_tree(source)
        write(source / "bend2/src/coordinator/store.bend",
              "import Base\nimport ../host/process.bend as Process\nimport ./laws.bend as Laws\n\ndef value() -> U32:\n  Process.value\n")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "miss", result
        print("PASS newly imported law module selects a normal build")

        build_tree(source)
        write(source / "bend2/src/host/persistent-path.h", "#define BATON_PERSISTENT_PATH 2\n")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "miss", result
        print("PASS changed included header selects a normal build")

        header = source / "bend2/src/host/persistent-path.h"
        if header.is_symlink():
            header.unlink()
        build_tree(source)
        header.unlink()
        header.symlink_to(source / "bend2/src/coordinator/store.bend")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "miss", result
        assert "symlink" in result.get("reason", ""), result
        print("PASS imported symlink selects a normal build with its reason")

        if header.is_symlink():
            header.unlink()
        build_tree(source)
        law = source / "bend2/src/coordinator/receive-laws.bend"
        law.unlink()
        law.symlink_to(source / "bend2/src/coordinator/store.bend")
        result = run_select(source, generated, proof_path, generated_c, compiler)
        assert result["status"] == "reused", result
        print("PASS symlink outside the closure still selects reused")
    return 0


if __name__ == "__main__":
    sys.exit(main())
