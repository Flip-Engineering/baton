#!/usr/bin/env python3
"""Run the code-security acceptance checks that need no coordinator.

The checked-landing gate selects files by path, so this file makes the fixture
corpus and the checker mutation control selectable. The provider cases run
through `run.mjs` with an installed coordinator and are not selected here.
"""
import pathlib
import shutil
import subprocess
import unittest

HERE = pathlib.Path(__file__).resolve().parent
RUNNER = HERE / "run.mjs"


def node() -> str:
    path = shutil.which("node")
    if not path:
        raise unittest.SkipTest("node is unavailable")
    return path


def run_runner(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [node(), str(RUNNER), *args],
        cwd=HERE,
        capture_output=True,
        text=True,
        timeout=600,
    )


class FixtureCorpus(unittest.TestCase):
    def test_every_fixture_verifies(self):
        result = run_runner("--verify")
        self.assertEqual(result.returncode, 0, f"verify failed:\n{result.stdout}\n{result.stderr}")
        self.assertIn('"summary":"verify"', result.stdout)

    def test_checker_rejects_violating_payloads(self):
        result = run_runner("--selftest")
        self.assertEqual(result.returncode, 0, f"selftest failed:\n{result.stdout}\n{result.stderr}")
        self.assertIn('"summary":"selftest"', result.stdout)


if __name__ == "__main__":
    unittest.main()
