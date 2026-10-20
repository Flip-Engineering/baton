"""Exercise tool-name mapping at the compiled codec boundary."""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPECTED = [
    "context-query",
    "context-result",
    "context-engines",
    "context-query",
    "unknown-tool",
]


class CodecToolInputName(unittest.TestCase):
    def test_public_names_map_and_unknown_names_pass_through(self):
        scratch = ROOT / ".scratch/bend2"
        scratch.mkdir(parents=True, exist_ok=True)
        compiler = shutil.which("clang") or shutil.which("clang-19") or shutil.which("cc")
        self.assertIsNotNone(compiler, "a C compiler is required for the native fixture")
        env = os.environ.copy()
        env["CC"] = compiler
        with tempfile.TemporaryDirectory(prefix="codec-tool-input-name-", dir=scratch) as temp:
            binary = pathlib.Path(temp) / "codec-tool-input-name"
            build = subprocess.run(
                ["sh", "bend2/scripts/build-native.sh",
                 "bend2/test/codec-tool-input-name.bend", str(binary)],
                cwd=ROOT, env=env, capture_output=True, text=True,
            )
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            observed = subprocess.run([str(binary)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(observed.returncode, 0, observed.stderr)
            self.assertEqual(observed.stdout.splitlines(), EXPECTED)
            self.assertEqual(observed.stderr, "")


if __name__ == "__main__":
    unittest.main()
