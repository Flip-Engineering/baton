#!/usr/bin/env python3
"""Run the code-security acceptance checks that need no coordinator.

The checked-landing gate selects files by path, so this file makes the fixture
corpus and the checker mutation control selectable. Both checks start child
processes and are remote-runner gates; they must not be executed on the
operator's laptop. The provider cases run through `run.mjs` with an installed
coordinator and are selected separately.

No deadline, output ceiling or skip is applied here. A missing prerequisite is
reported as a failure so the gate cannot read green without the check.
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
        raise AssertionError("node is unavailable: this check is unqualified without it")
    return path


def run_runner(*args: str) -> subprocess.CompletedProcess:
    result = subprocess.run(
        [node(), str(RUNNER), *args],
        cwd=HERE,
        capture_output=True,
        text=True,
    )
    print(result.stdout, end="")
    print(result.stderr, end="", file=__import__("sys").stderr)
    return result


class FixtureCorpus(unittest.TestCase):
    def test_static_fixture_checks(self):
        result = run_runner("--verify-static")
        self.assertEqual(result.returncode, 0, "the static fixture checks failed")
        self.assertIn('"summary":"verify"', result.stdout)

    def test_checker_rejects_violating_payloads(self):
        result = run_runner("--selftest")
        self.assertEqual(result.returncode, 0, "the checker mutation control failed")
        self.assertIn('"summary":"selftest"', result.stdout)


if __name__ == "__main__":
    unittest.main()
