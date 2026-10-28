#!/usr/bin/env python3
"""Verify self-reexecution retains the loaded executable after path replacement."""

from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
FUNCTIONS = (
    (ROOT / "src/host/posix.c", "posix_self_path", "static int posix_self_path(", "static char *self_path(void) { char *path=NULL; int error=posix_self_path(&path); if(error) { errno=error; return NULL; } return path; }", "fork"),
    (ROOT / "src/host/process-spawn.c", "br_self", "static char *br_self(", "static char *self_path(void) { return br_self(); }", "posix_spawn"),
)
HARNESS = r"""
#define _GNU_SOURCE
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <spawn.h>
__FUNCTION__
__WRAPPER__
#define PROBE_SPAWN __SPAWN_KIND__
extern char **environ;
int main(int argc, char **argv) {
  if (argc == 2 && !strcmp(argv[1], "wait")) {
    puts("READY");
    fflush(stdout);
    if (getchar() == EOF) return 3;
    char *path = self_path();
    if (!path) { perror("self_path"); return 4; }
    char *child_argv[] = {path, "child", NULL};
    pid_t child;
    if (!strcmp(PROBE_SPAWN, "posix_spawn")) {
      int error = posix_spawn(&child, path, NULL, NULL, child_argv, environ);
      if (error) { errno = error; perror("posix_spawn"); free(path); return 5; }
    } else {
      child = fork();
      if (child < 0) { perror("fork"); free(path); return 5; }
      if (child == 0) {
        execv(path, child_argv);
        perror("execv");
        _exit(6);
      }
    }
    int status = 0;
    while (waitpid(child, &status, 0) < 0) {
      if (errno != EINTR) { perror("waitpid"); free(path); return 7; }
    }
    free(path);
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    return 8;
  }
  if (argc == 2 && !strcmp(argv[1], "child")) {
    printf("IMAGE=%s\n", PROBE_LABEL);
    return 0;
  }
  return 6;
}
"""


def function_body(text: str, marker: str) -> str:
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
    raise ValueError(f"unterminated function marker: {marker}")


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux procfs executable path")
class SelfExecutableReexec(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="baton-self-exe-reexec-build-")
        cls.build_dir = Path(cls.temp.name)
        cls.binaries = {}
        compiler = os.environ.get("CC", "cc")
        for source, name, marker, wrapper, spawn_kind in FUNCTIONS:
            body = function_body(source.read_text(), marker)
            for label in ("old", "new"):
                c_path = cls.build_dir / f"{name}-{label}.c"
                binary = cls.build_dir / f"{name}-{label}"
                c_path.write_text(
                    HARNESS.replace("__FUNCTION__", body)
                    .replace("__WRAPPER__", wrapper)
                    .replace("__SPAWN_KIND__", f'"{spawn_kind}"')
                    .replace("PROBE_LABEL", f'"{label}"')
                )
                result = subprocess.run(
                    [compiler, "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
                     str(c_path), "-o", str(binary)],
                    capture_output=True,
                    text=True,
                )
                if result.returncode:
                    raise AssertionError(result.stdout + result.stderr)
                cls.binaries[(name, label)] = binary

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def assert_loaded_image_survives(self, function, replace):
        with tempfile.TemporaryDirectory(prefix="baton-self-exe-reexec-case-") as temp:
            directory = Path(temp)
            target = directory / "runner"
            shutil.copy2(self.binaries[(function, "old")], target)
            process = subprocess.Popen(
                [str(target), "wait"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True,
            )
            try:
                self.assertEqual(process.stdout.readline().strip(), "READY")
                if replace:
                    replacement = directory / "replacement"
                    shutil.copy2(self.binaries[(function, "new")], replacement)
                    os.replace(replacement, target)
                else:
                    target.unlink()
                stdout, stderr = process.communicate(chr(10), timeout=5)
            except BaseException:
                if process.poll() is None:
                    process.kill()
                    process.communicate(timeout=5)
                raise
            self.assertEqual(process.returncode, 0, stderr)
            self.assertIn("IMAGE=old", stdout)
            self.assertNotIn("IMAGE=new", stdout)

    def test_queue_posix_self_exe_survives_atomic_replace(self):
        self.assert_loaded_image_survives("posix_self_path", replace=True)

    def test_queue_posix_self_exe_survives_unlink(self):
        self.assert_loaded_image_survives("posix_self_path", replace=False)

    def test_native_process_self_survives_atomic_replace(self):
        self.assert_loaded_image_survives("br_self", replace=True)

    def test_native_process_self_survives_unlink(self):
        self.assert_loaded_image_survives("br_self", replace=False)


if __name__ == "__main__":
    unittest.main()
