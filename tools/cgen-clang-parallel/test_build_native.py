#!/usr/bin/env python3
"""Platform selection tests for the normal native build route."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).with_name("build_native.py")
SPEC = importlib.util.spec_from_file_location("build_native", MODULE)
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


class NativeBuildSelection(unittest.TestCase):
    def compiler(self, directory: Path, version: str) -> str:
        path = directory / "compiler"
        path.write_text("#!/bin/sh\nprintf '%s\\n' " + repr(version) + "\n")
        path.chmod(0o700)
        return str(path)

    def test_linux_x86_64_clang_19_uses_sharder(self):
        with tempfile.TemporaryDirectory() as temp:
            cc = self.compiler(Path(temp), "Debian clang version 19.1.7")
            self.assertTrue(BUILD.qualified_linux_clang(cc, "Linux", "x86_64"))

    def test_other_platforms_keep_serial_route(self):
        with tempfile.TemporaryDirectory() as temp:
            cc = self.compiler(Path(temp), "Debian clang version 19.1.7")
            self.assertFalse(BUILD.qualified_linux_clang(cc, "Darwin", "arm64"))
            self.assertFalse(BUILD.qualified_linux_clang(cc, "Linux", "aarch64"))

    def test_other_compiler_versions_keep_serial_route(self):
        with tempfile.TemporaryDirectory() as temp:
            for version in ("gcc (Debian 13.2.0)", "Debian clang version 18.1.8",
                            "Debian clang version 20.1.0"):
                with self.subTest(version=version):
                    cc = self.compiler(Path(temp), version)
                    self.assertFalse(BUILD.qualified_linux_clang(cc, "Linux", "x86_64"))

    def test_successful_serial_fallback_removes_stale_sharded_receipt(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            cc = directory / "gcc-like-compiler"
            cc.write_text("#!/bin/sh\nif [ \"${1:-}\" = --version ]; then\n"
                          "  echo 'gcc fixture 13'\n  exit 0\nfi\n"
                          "for last do :; done\nprintf 'fixture output\\n' > \"$last\"\n")
            cc.chmod(0o700)
            source = directory / "baton2.c"
            entry = directory / "native-entry.c"
            output = directory / "baton2"
            source.write_text("int coordinator(void) { return 0; }\n")
            entry.write_text("int main(void) { return 0; }\n")
            stale = output.with_name(output.name + ".build.json")
            stale.write_text('{"schema":"stale sharded receipt"}\n')
            subprocess.run([sys.executable, str(MODULE), "--source", str(source),
                            "--entry", str(entry), "--output", str(output), "--cc", str(cc)],
                           check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.assertTrue(output.is_file())
            self.assertTrue(output.with_name(output.name + ".o").is_file())
            self.assertFalse(stale.exists())


if __name__ == "__main__":
    unittest.main()
