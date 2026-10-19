#!/usr/bin/env python3
"""Unit tests for host compile queue identity records.

Run with:
    python3 -m unittest -v tools/host-compile-queue/test_identity.py
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("identity.py")
_spec = importlib.util.spec_from_file_location(
    "host_compile_queue_identity", MODULE_PATH
)
identity = importlib.util.module_from_spec(_spec)
sys.modules["host_compile_queue_identity"] = identity
_spec.loader.exec_module(identity)


class TemporaryRoot(unittest.TestCase):
    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        self.base = Path(self._temporary.name)
        self.root = self.base / "root"
        self.root.mkdir()

    def tearDown(self) -> None:
        self._temporary.cleanup()

    def write(self, relative: str, text: str, root: Path | None = None) -> Path:
        path = (root or self.root) / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def write_executable(
        self, relative: str, text: str, root: Path | None = None
    ) -> Path:
        path = self.write(relative, text, root=root)
        path.chmod(0o755)
        return path


class SourceClosureTests(TemporaryRoot):
    def test_nested_duplicate_and_cyclic_imports(self) -> None:
        self.write(
            "main.bend",
            "import Base\n"
            "import a/first.bend as first\n"
            "import a/first.bend\n"
            "import common.bend\n",
        )
        self.write(
            "a/first.bend",
            "import ../common.bend as common\n"
            "import ./second.bend as second\n",
        )
        self.write(
            "a/second.bend",
            "import ../main.bend as main\n"
            "import ../common.bend\n",
        )
        self.write("common.bend", "import Base\n")
        result = identity.source_closure(self.root, self.root / "main.bend")
        self.assertEqual(
            list(result), ["schema", "entry", "files", "closure_sha256"]
        )
        self.assertEqual(result["schema"], identity.SCHEMA)
        self.assertEqual(result["entry"], "main.bend")
        paths = [item["path"] for item in result["files"]]
        self.assertEqual(
            paths, ["a/first.bend", "a/second.bend", "common.bend", "main.bend"]
        )
        self.assertEqual(len(paths), len(set(paths)))
        for item in result["files"]:
            self.assertEqual(list(item), ["path", "sha256", "bytes"])
            path = self.root / item["path"]
            self.assertEqual(item["sha256"], identity.sha256_file(path))
            self.assertEqual(item["bytes"], path.stat().st_size)
            self.assertIsInstance(item["path"], str)
            self.assertIsInstance(item["sha256"], str)
            self.assertIsInstance(item["bytes"], int)
        self.assertEqual(
            result["closure_sha256"],
            identity.sha256_bytes(
                identity.canonical_json(result["files"]).encode("utf-8")
            ),
        )

    def test_only_top_level_import_lines_are_parsed(self) -> None:
        self.write(
            "main.bend",
            "# import commented.bend\n"
            '"import quoted.bend"\n'
            "def use():\n"
            "  import indented.bend\n"
            "import dep.bend as d\n"
            "import trailing.bend   \n"
            "import Base as B\n",
        )
        self.write("dep.bend", "import Base\n")
        self.write("trailing.bend", "import Base\n")
        result = identity.source_closure(self.root, self.root / "main.bend")
        self.assertEqual(
            [item["path"] for item in result["files"]],
            ["dep.bend", "main.bend", "trailing.bend"],
        )

    def test_entry_may_be_relative_to_cwd(self) -> None:
        self.write("main.bend", "import dep.bend as d\n")
        self.write("dep.bend", "import Base\n")
        previous = Path.cwd()
        os.chdir(self.root)
        try:
            result = identity.source_closure(self.root, Path("main.bend"))
        finally:
            os.chdir(previous)
        self.assertEqual(result["entry"], "main.bend")
        self.assertEqual(
            [item["path"] for item in result["files"]],
            ["dep.bend", "main.bend"],
        )

    def test_missing_import_rejected(self) -> None:
        self.write("main.bend", "import missing.bend as missing\n")
        with self.assertRaises(ValueError):
            identity.source_closure(self.root, self.root / "main.bend")

    def test_missing_entry_rejected(self) -> None:
        with self.assertRaises(ValueError):
            identity.source_closure(self.root, self.root / "missing.bend")

    def test_absolute_import_rejected(self) -> None:
        absolute = (self.base / "outside.bend").resolve()
        self.write("main.bend", f"import {absolute.as_posix()} as out\n")
        with self.assertRaises(ValueError):
            identity.source_closure(self.root, self.root / "main.bend")

    def test_import_outside_root_rejected(self) -> None:
        self.write("outside.bend", "import Base\n", root=self.base)
        self.write("main.bend", "import ../outside.bend as out\n")
        with self.assertRaises(ValueError):
            identity.source_closure(self.root, self.root / "main.bend")

    def test_entry_outside_root_rejected(self) -> None:
        outside = self.write("outside.bend", "import Base\n", root=self.base)
        with self.assertRaises(ValueError):
            identity.source_closure(self.root, outside)


class KeyStabilityTests(TemporaryRoot):
    def make_tree(self, root: Path) -> None:
        self.write(
            "main.bend",
            "import lib/a.bend as a\nimport lib/b.bend as b\n",
            root=root,
        )
        self.write("lib/a.bend", "import ../shared.bend as common\n", root=root)
        self.write("lib/b.bend", "import ../shared.bend as common\n", root=root)
        self.write("shared.bend", "import Base\n", root=root)

    def test_identical_content_in_different_roots_has_equal_key(self) -> None:
        first = self.base / "first"
        second = self.base / "second"
        self.make_tree(first)
        self.make_tree(second)
        one = identity.source_closure(first, first / "main.bend")
        two = identity.source_closure(second, second / "main.bend")
        self.assertEqual(one, two)
        self.assertEqual(one["closure_sha256"], two["closure_sha256"])
        toolchain = {
            "kind": "executable",
            "path": "bend",
            "sha256": "a" * 64,
        }
        key_one, material_one = identity.build_key(
            "native",
            one,
            toolchain,
            "main.bend",
            "build",
            ["bend", "main.bend"],
            {"opt": "O1"},
        )
        key_two, _ = identity.build_key(
            "native",
            two,
            toolchain,
            "main.bend",
            "build",
            ["bend", "main.bend"],
            {"opt": "O1"},
        )
        self.assertEqual(key_one, key_two)
        self.assertEqual(key_one, identity.key_for(material_one))
        self.assertEqual(material_one["source"], one)

    def test_output_normalization_ignores_output_locations(self) -> None:
        first = self.base / "first"
        second = self.base / "second"
        first.mkdir()
        second.mkdir()
        first_outputs = {
            "object": str(first / "build" / "main.o"),
            "executable": str(first / "build" / "main"),
        }
        second_outputs = {
            "object": str(second / "build" / "main.o"),
            "executable": str(second / "build" / "main"),
        }
        first_argv = identity.normalize_argv(
            [
                "clang",
                "-O1",
                "-c",
                "src/main.c",
                "-o",
                first_outputs["object"],
                "-o",
                first_outputs["executable"],
            ],
            first_outputs,
        )
        second_argv = identity.normalize_argv(
            [
                "clang",
                "-O1",
                "-c",
                "src/main.c",
                "-o",
                second_outputs["object"],
                "-o",
                second_outputs["executable"],
            ],
            second_outputs,
        )
        self.assertEqual(
            first_argv,
            [
                "clang",
                "-O1",
                "-c",
                "src/main.c",
                "-o",
                "{out:object}",
                "-o",
                "{out:executable}",
            ],
        )
        self.assertEqual(first_argv, second_argv)
        source = {
            "schema": identity.SCHEMA,
            "entry": "main.bend",
            "files": [],
            "closure_sha256": "0" * 64,
        }
        toolchain = {
            "schema": identity.SCHEMA,
            "kind": "cc",
            "executable": "clang",
            "sha256": "1" * 64,
            "version_sha256": "2" * 64,
            "version": "clang 1",
        }
        first_key, first_material = identity.build_key(
            "native",
            source,
            toolchain,
            "main.bend",
            "link",
            first_argv,
            {"opt": "O1"},
        )
        second_key, second_material = identity.build_key(
            "native",
            source,
            toolchain,
            "main.bend",
            "link",
            second_argv,
            {"opt": "O1"},
        )
        self.assertEqual(first_key, second_key)
        self.assertEqual(first_material, second_material)


class ArgumentNormalizationTests(TemporaryRoot):
    def test_output_paths_become_placeholders(self) -> None:
        source = self.write("src/main.c", "int main(void) { return 0; }\n")
        outputs = {
            "object": str(self.base / "build" / "main.o"),
            "executable": str(self.base / "build" / "main"),
        }
        argv = [
            "clang",
            "-c",
            str(source),
            "-o",
            outputs["object"],
            "-o",
            outputs["executable"],
        ]
        normalized = identity.normalize_argv(argv, outputs)
        self.assertEqual(
            normalized,
            [
                "clang",
                "-c",
                str(source),
                "-o",
                "{out:object}",
                "-o",
                "{out:executable}",
            ],
        )

    def test_resolved_form_matches_equivalent_token(self) -> None:
        output = self.base / "build" / "main.o"
        output.parent.mkdir()
        output.write_bytes(b"")
        alias = self.base / "build" / ".." / "build" / "main.o"
        normalized = identity.normalize_argv(
            [str(alias), str(output)], {"object": str(output)}
        )
        self.assertEqual(normalized, ["{out:object}", "{out:object}"])

    def test_only_full_tokens_are_replaced(self) -> None:
        output = str(self.base / "build" / "main.o")
        tokens = [
            output + ".tmp",
            "--out=" + output,
            output,
            "main.o",
        ]
        normalized = identity.normalize_argv(tokens, {"object": output})
        self.assertEqual(
            normalized,
            [tokens[0], tokens[1], "{out:object}", "main.o"],
        )


class ExecutableIdentityTests(TemporaryRoot):
    def test_plain_executable_identity(self) -> None:
        tool = self.base / "plain-tool"
        tool.write_bytes(b"\x7fELFnot-really\n")
        first = identity.executable_identity(tool)
        self.assertEqual(list(first), ["kind", "path", "sha256"])
        self.assertEqual(first["kind"], "executable")
        self.assertEqual(first["path"], "plain-tool")
        self.assertEqual(first["sha256"], identity.sha256_file(tool))
        self.assertEqual(first, identity.executable_identity(tool))

    def test_wrapper_chain_reaches_release_tree(self) -> None:
        release = self.base / "releases" / "2.0.25"
        self.write("bend2/main.ts", "// entry\n", root=release)
        self.write("bend2/lib/util.ts", "export const value = 1;\n", root=release)
        self.write("bin/bun", "#!/bin/sh\n", root=release)
        self.write("provenance/pins.json", "{}\n", root=release)
        bun = release / "bin" / "bun"
        bend = self.write_executable(
            "bin/bend", f'#!/bin/sh\nexec "{bun}" "$@"\n', root=release
        )
        installed = self.write_executable(
            "installed/bend", f'#!/bin/sh\nexec "{bend}" "$@"\n'
        )
        result = identity.executable_identity(installed)
        self.assertEqual(
            list(result), ["kind", "entry_sha256", "files", "tree_sha256"]
        )
        self.assertEqual(result["kind"], "bend-release")
        self.assertEqual(
            [item["path"] for item in result["files"]],
            ["bend2/lib/util.ts", "bend2/main.ts", "bin/bun"],
        )
        self.assertEqual(
            result["tree_sha256"],
            identity.sha256_bytes(
                identity.canonical_json(result["files"]).encode("utf-8")
            ),
        )
        expected_entry = hashlib.sha256(
            installed.read_bytes() + bend.read_bytes() + bun.read_bytes()
        ).hexdigest()
        self.assertEqual(result["entry_sha256"], expected_entry)
        self.assertNotIn(str(self.base), identity.canonical_json(result))
        self.assertEqual(result, identity.executable_identity(installed))

    def test_release_tree_identity_ignores_location(self) -> None:
        identities = []
        for name in ("one", "two"):
            release = self.base / name / "2.0.25"
            self.write("bend2/main.ts", "// entry\n", root=release)
            self.write("bend2/lib/util.ts", "// util\n", root=release)
            self.write("bin/bun", "bun-bytes\n", root=release)
            entry = self.write_executable(
                "bin/bend", "compiled-bend-bytes\n", root=release
            )
            identities.append(identity.executable_identity(entry))
        self.assertEqual(identities[0], identities[1])
        self.assertEqual(identities[0]["kind"], "bend-release")

    def test_wrapper_to_plain_binary_hashes_chain(self) -> None:
        target = self.base / "real-compiler"
        target.write_bytes(b"binary-bytes")
        wrapper = self.write_executable(
            "bend", f'#!/bin/sh\nexec "{target}" "$@"\n'
        )
        result = identity.executable_identity(wrapper)
        self.assertEqual(list(result), ["kind", "path", "sha256"])
        self.assertEqual(result["kind"], "executable")
        self.assertEqual(result["path"], "real-compiler")
        self.assertEqual(
            result["sha256"],
            hashlib.sha256(wrapper.read_bytes() + target.read_bytes()).hexdigest(),
        )

    def test_text_without_shebang_is_not_a_wrapper(self) -> None:
        target = self.base / "target"
        target.write_bytes(b"target-bytes")
        entry = self.base / "entry"
        entry.write_text(f'# comment\nexec "{target}" "$@"\n', encoding="utf-8")
        result = identity.executable_identity(entry)
        self.assertEqual(result["kind"], "executable")
        self.assertEqual(result["path"], "entry")
        self.assertEqual(result["sha256"], identity.sha256_file(entry))

    def test_missing_compiler_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            identity.cc_identity(self.base / "missing-compiler")


class HashPrimitiveTests(unittest.TestCase):
    def test_canonical_json_is_sorted_and_compact(self) -> None:
        self.assertEqual(
            identity.canonical_json({"b": 1, "a": "\u00e9"}),
            '{"a":"\u00e9","b":1}',
        )

    def test_key_for_hashes_canonical_json(self) -> None:
        material = {"schema": identity.SCHEMA, "z": [1, 2], "a": {"b": True}}
        expected = hashlib.sha256(
            identity.canonical_json(material).encode("utf-8")
        ).hexdigest()
        self.assertEqual(identity.key_for(material), expected)
        reordered = dict(reversed(list(material.items())))
        self.assertEqual(identity.key_for(material), identity.key_for(reordered))

    def test_sha256_helpers_agree(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data"
            path.write_bytes(b"contents")
            self.assertEqual(
                identity.sha256_file(path), identity.sha256_bytes(b"contents")
            )


if __name__ == "__main__":
    unittest.main()
