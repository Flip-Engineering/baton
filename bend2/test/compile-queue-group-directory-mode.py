#!/usr/bin/env python3
"""Check queue directory modes under inherited and local group ownership."""

from pathlib import Path
import grp
import os
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src/host/files.c"
FUNCTION = "baton_group_directory_mode"
HARNESS = r"""
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <unistd.h>
static int fchmod_calls;
#ifdef DENY_FCHMOD
static int strip_sgid_fchmod(int fd, mode_t mode) {
  fchmod_calls++;
  return (int)syscall(SYS_fchmod, fd, mode & ~S_ISGID);
}
#define fchmod strip_sgid_fchmod
#endif
__FUNCTION__
int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int fd = open(argv[1], O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
  if (fd < 0) { perror("open"); return 3; }
  int error = baton_group_directory_mode(fd);
  struct stat info;
  if (fstat(fd, &info)) { perror("fstat"); close(fd); return 4; }
  printf("error=%d mode=%04o uid=%u gid=%u fchmod_calls=%d\n",
         error, (unsigned)(info.st_mode & 07777), (unsigned)info.st_uid,
         (unsigned)info.st_gid, fchmod_calls);
  close(fd);
  return error ? 1 : 0;
}
"""


def function_body(text: str, name: str) -> str:
    marker = f"static int {name}("
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


@unittest.skipUnless(sys.platform.startswith("linux"), "Linux setgid directory behavior")
class QueueGroupDirectoryMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="baton-queue-dir-mode-build-")
        cls.build_dir = Path(cls.temp.name)
        body = function_body(SOURCE.read_text(), FUNCTION)
        cls.binaries = {}
        compiler = os.environ.get("CC", "cc")
        for label, deny in (("strip-sgid", True), ("normal", False)):
            c_path = cls.build_dir / f"{label}.c"
            binary = cls.build_dir / label
            c_path.write_text(
                HARNESS.replace("__FUNCTION__", body)
            )
            command = [compiler, "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror"]
            if deny:
                command.append("-DDENY_FCHMOD")
            command.extend([str(c_path), "-o", str(binary)])
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)
            cls.binaries[label] = binary

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def create_child(self, parent: Path, name: str) -> Path:
        child = parent / name
        previous = os.umask(0o007)
        try:
            os.mkdir(child, 0o770)
        finally:
            os.umask(previous)
        return child

    def run_probe(self, label: str, path: Path) -> str:
        result = subprocess.run(
            [str(self.binaries[label]), str(path)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout.strip()

    def test_inherited_setgid_directory_keeps_shared_group_without_chmod(self):
        try:
            compile_gid = grp.getgrnam("baton-compile").gr_gid
        except KeyError:
            self.skipTest("baton-compile group is unavailable")
        if compile_gid not in os.getgroups() and os.getegid() != compile_gid:
            self.skipTest("test user cannot create a baton-compile directory")
        with tempfile.TemporaryDirectory(prefix="baton-queue-inherited-group-") as temp:
            parent = Path(temp) / "keys"
            parent.mkdir(mode=0o700)
            os.chown(parent, -1, compile_gid)
            os.chmod(parent, 0o2770)
            child = self.create_child(parent, "key")
            before = child.stat()
            self.assertEqual(before.st_gid, compile_gid)
            self.assertEqual(before.st_mode & 0o7777, 0o2770)

            output = self.run_probe("strip-sgid", child)
            self.assertIn(f"mode=2770", output)
            self.assertIn(f"gid={compile_gid}", output)
            self.assertIn("fchmod_calls=0", output)

    def test_local_group_directory_still_gets_required_mode(self):
        with tempfile.TemporaryDirectory(prefix="baton-queue-local-group-") as temp:
            parent = Path(temp) / "local"
            parent.mkdir(mode=0o700)
            child = self.create_child(parent, "key")
            before = child.stat()
            self.assertEqual(before.st_mode & 0o7777, 0o770)
            output = self.run_probe("normal", child)
            self.assertIn("mode=2770", output)
            self.assertIn(f"gid={os.getegid()}", output)


if __name__ == "__main__":
    unittest.main()
