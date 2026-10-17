#!/usr/bin/env python3
"""Compile and exercise br_self from process-spawn.c on Linux."""

from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest


if "BATON_PROCESS_SPAWN_SOURCE" in os.environ:
    SOURCE = Path(os.environ["BATON_PROCESS_SPAWN_SOURCE"])
else:
    ROOT = Path(__file__).resolve().parents[1]
    SOURCE = ROOT / "src/host/process-spawn.c"


def function_body(text: str, name: str) -> str:
    marker = f"static char *{name}("
    start = text.index(marker)
    opening = text.index("{", start)
    depth = 0
    for offset in range(opening, len(text)):
        if text[offset] == "{":
            depth += 1
        elif text[offset] == "}":
            depth -= 1
            if depth == 0:
                return text[start : offset + 1]
    raise ValueError(f"unterminated function: {name}")


HARNESS = r"""
#define _GNU_SOURCE
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
__FUNCTION__
int main(int argc,char **argv) {
  if(argc>1 && !strcmp(argv[1],"wait")) {
    puts("READY"); fflush(stdout);
    if(getchar()==EOF)return 3;
  }
  char *path=br_self();
  if(path){printf("PATH=%s\n",path);free(path);return 0;}
  puts("PATH=NULL");
  return 0;
}
"""


@unittest.skipUnless(sys.platform.startswith("linux"), "br_self Linux path test")
class SelfExecutablePath(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="baton-self-exe-repin-")
        self.directory = Path(self.temp.name)
        harness = HARNESS.replace("__FUNCTION__", function_body(SOURCE.read_text(), "br_self"))
        self.source = self.directory / "probe.c"
        self.executable = self.directory / "probe"
        self.source.write_text(harness)
        subprocess.run(
            ["cc", "-O2", "-Wall", "-Wextra", "-Werror", str(self.source), "-o", str(self.executable)],
            check=True,
        )

    def tearDown(self):
        self.temp.cleanup()

    def result(self, executable):
        process = subprocess.run([str(executable)], text=True, capture_output=True, check=True)
        return process.stdout.strip()

    def paused(self, executable):
        process = subprocess.Popen([str(executable), "wait"], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.assertEqual(process.stdout.readline().strip(), "READY")
        return process

    def finish_paused(self, process):
        stdout, stderr = process.communicate("\n", timeout=5)
        self.assertEqual(process.returncode, 0, stderr)
        return stdout.strip()

    def test_normal_executable_path(self):
        self.assertEqual(self.result(self.executable), f"PATH={self.executable}")

    def test_literal_deleted_suffix_filename_is_preserved(self):
        target = self.directory / "probe (deleted)"
        shutil.copy2(self.executable, target)
        self.assertEqual(self.result(target), f"PATH={target}")

    def test_replaced_executable_resolves_current_endpoint(self):
        target = self.directory / "replaceable"
        replacement = self.directory / "replacement"
        shutil.copy2(self.executable, target)
        process = self.paused(target)
        shutil.copy2(self.executable, replacement)
        os.replace(replacement, target)
        self.assertEqual(self.finish_paused(process), f"PATH={target}")

    def test_missing_replacement_is_refused(self):
        target = self.directory / "unlinked"
        shutil.copy2(self.executable, target)
        process = self.paused(target)
        target.unlink()
        self.assertEqual(self.finish_paused(process), "PATH=NULL")


if __name__ == "__main__":
    unittest.main()
