"""Compile queue artifact tree digest regressions.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Both cases use
a private state root and a fake compiler. The tree case runs a compiler that
creates an output directory holding a newline-containing entry name and
checks the recorded tree digest against an independent walk. The traversal
case gives that output an unreadable subdirectory and requires the run to
fail, not to record a tree that silently omits the subtree.
"""
import hashlib
import os
import pathlib
import subprocess
import tempfile
import unittest


def tree_rows(root):
    rows = []
    for entry in sorted(root.rglob("*")):
        if entry.is_file():
            name = "./" + str(entry.relative_to(root))
            rows.append(name + " " + hashlib.sha256(entry.read_bytes()).hexdigest())
    return "".join(row + "\n" for row in sorted(rows))


class QueueArtifactTreeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-artifact-tree-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "previous=\n"
            "for arg in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then\n"
            "    mkdir -p \"$arg/inner\"\n"
            "    printf 'kept\\n' > \"$arg/inner/plain.txt\"\n"
            "    printf 'newline\\n' > \"$arg/inner/line\nbreak.txt\"\n"
            "    exit 0\n"
            "  fi\n"
            "  previous=$arg\n"
            "done\n"
            "exit 4\n")
        self.compiler.chmod(0o755)
        (self.root / "main.c").write_text('int main(void){return 0;}\n')
        self.output = self.root / "result"

    def run_queue(self):
        token = os.urandom(16).hex()
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / "receipt"),
                "--kind", "cc", "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-artifact-tree-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.root / "main.c"),
                "--", str(self.compiler), "-o", str(self.output)]
        result = subprocess.run(argv, env=self.environment, capture_output=True, text=True)
        self.retain_evidence()
        return result

    def retain_evidence(self):
        evidence = os.environ.get("BATON_COMPILE_QUEUE_TEST_EVIDENCE")
        if not evidence:
            return
        pathlib.Path(evidence).mkdir(parents=True, exist_ok=True)
        for name in ("receipt",):
            source = self.root / name
            if source.is_file():
                (pathlib.Path(evidence) / ("receipt." + name)).write_text(source.read_text())

    def result_fields(self):
        receipt = dict(line.split("=", 1) for line in
                       (self.root / "receipt").read_text().splitlines() if "=" in line)
        result = self.state / "keys" / receipt["key"] / "completed" / "result"
        return dict(line.split("=", 1) for line in
                    result.read_text().splitlines() if "=" in line)

    def test_tree_digest_binds_a_newline_entry_name(self):
        result = self.run_queue()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = dict(line.split("=", 1) for line in
                       (self.root / "receipt").read_text().splitlines() if "=" in line)
        self.assertEqual(receipt["status"], "completed")
        fields = self.result_fields()
        self.assertEqual(fields["status"], "completed")
        expected_rows = "".join(tree_rows(self.output))
        expected = hashlib.sha256(expected_rows.encode()).hexdigest()
        self.assertIn("artifact=output\tdirectory\t" + expected + "\n", fields["artifact"])

    @unittest.skipUnless(hasattr(os, "geteuid") and os.geteuid() != 0,
                         "an unreadable directory requires a non-root user")
    def test_failed_directory_traversal_fails_the_run(self):
        blocked = self.root / "blocked-output"
        self.output = blocked
        self.compiler.write_text(
            "#!/bin/sh\n"
            "previous=\n"
            "for arg in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then\n"
            "    mkdir -p \"$arg/sealed\"\n"
            "    printf 'hidden\\n' > \"$arg/sealed/inside.txt\"\n"
            "    chmod 000 \"$arg/sealed\"\n"
            "    exit 0\n"
            "  fi\n"
            "  previous=$arg\n"
            "done\n"
            "exit 4\n")
        self.compiler.chmod(0o755)
        sealed = blocked / "sealed"
        self.addCleanup(lambda: sealed.exists() and os.chmod(sealed, 0o755))
        result = self.run_queue()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = self.root / "receipt"
        if receipt.is_file():
            fields = dict(line.split("=", 1) for line in
                          receipt.read_text().splitlines() if "=" in line)
            self.assertNotEqual(fields.get("status"), "completed")


if __name__ == "__main__":
    unittest.main()
