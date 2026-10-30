"""A compile queue key refused for a missing input names the operation and the path (#1403).

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. The key command runs against a
private state root and a fake compiler; nothing is compiled.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


class QueueMissingInputDiagnostics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.queue = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.queue:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-missing-include-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name).resolve()
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text("#!/bin/sh\nexit 0\n")
        self.compiler.chmod(0o755)
        self.generated = self.root / "generated"
        self.generated.mkdir()
        (self.generated / "baton2.c").write_text('#include "jsonl.c"\nint main(void){return 0;}\n')

    def key(self, source, kind="cc", entry=None):
        output = self.root / "output"
        command = [self.queue, "--", "key", "--kind", kind,
                   "--state-root", str(self.state), "--cwd", str(self.root),
                   "--root", str(self.root), "--source-root", str(self.root),
                   "--compiler", str(self.compiler), "--linker", str(self.compiler),
                   "--version", "fake-missing-include-v1", "--artifact", "binary=" + str(output)]
        command += ["--entry", entry] if entry else ["--input", str(source)]
        command += ["--", str(self.compiler), "-o", str(output)]
        return subprocess.run(command, env=self.environment, capture_output=True, text=True)

    def test_a_missing_quoted_include_is_named_with_its_operation_and_path(self):
        result = self.key(self.generated / "baton2.c")
        missing = self.generated / "jsonl.c"
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("realpath " + str(missing) + ": No such file or directory", result.stderr)

    def test_the_same_include_present_gives_a_key(self):
        (self.generated / "jsonl.c").write_text("int jsonl;\n")
        result = self.key(self.generated / "baton2.c")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertRegex(result.stdout.strip(), r"^[0-9a-f]{64}$")

    def test_a_missing_input_file_is_still_refused_and_named(self):
        absent = self.root / "absent.c"
        result = self.key(absent)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(str(absent), result.stderr)
        self.assertIn("No such file or directory", result.stderr)

    def test_a_missing_bend_import_is_named(self):
        (self.root / "main.bend").write_text('import "./absent.bend"\ndef main() -> U32: 0\n')
        result = self.key(None, kind="cgen", entry="main.bend")
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn("realpath " + str(self.root / "absent.bend") + ": No such file or directory", result.stderr)

    def test_an_include_outside_the_root_is_still_refused(self):
        # A private directory outside the source root holds the header; nothing shared is written.
        outside = tempfile.TemporaryDirectory(prefix="queue-outside-include-")
        self.addCleanup(outside.cleanup)
        descriptor, name = tempfile.mkstemp(suffix=".h", dir=outside.name)
        os.close(descriptor)
        header = pathlib.Path(name)
        header.write_text("int outside;\n")
        target = os.path.relpath(header, self.generated)
        (self.generated / "baton2.c").write_text('#include "%s"\nint main(void){return 0;}\n' % target)
        result = self.key(self.generated / "baton2.c")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source path outside root", result.stderr)


if __name__ == "__main__":
    unittest.main()
