#!/usr/bin/env python3
"""Native build and check entry points select the shared queue by default.

Runs the entry points with no BATON2_NATIVE_QUEUE_DRIVER in the environment
and a compiler that fails the version check, so each stops before any
compilation. With a queue client and state root present, the synthesized
configuration must exist and name the shared client and state root. Without
an installed queue, the entry point exits with the one-time bootstrap command
instead of compiling outside the queue. An explicit driver still wins and
synthesizes nothing. No compilation is launched.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
STATE = Path(os.environ.get("BATON_COMPILE_QUEUE_ROOT", "/var/tmp/baton2-compile-queue"))
CLIENT = STATE / "compile-queue-runner"
CONFIG = ROOT / ".scratch/bend2/queue-run/queue-config.json"


def attempt(extra_env, script="bend2/scripts/build-native.sh", arguments=None):
    if CONFIG.exists():
        CONFIG.unlink()
    fake = Path(tempfile.mkdtemp(prefix="queue-entry-fake-")) / "bend"
    fake.write_text("#!/bin/sh\necho 'bend 0.0.0'\n")
    fake.chmod(0o755)
    env = dict(os.environ)
    env.pop("BATON2_NATIVE_QUEUE_DRIVER", None)
    env.pop("BATON2_NATIVE_QUEUE", None)
    env["BEND"] = str(fake)
    env.update(extra_env)
    result = subprocess.run(
        ["sh", script, *(arguments or ["bend2/test/process.bend",
                                       ".scratch/bend2/queue-entry-default-probe"])],
        cwd=ROOT, env=env, capture_output=True, text=True)
    return result, CONFIG


def main():
    if CLIENT.is_file() and STATE.is_dir():
        result, config = attempt({})
        assert config.is_file(), result.stdout + result.stderr
        data = json.loads(config.read_text())
        assert data["client"] == str(CLIENT), data
        assert data["state"] == str(STATE), data
        assert "queue-entry-fake-" in data["bend"], data
        print("PASS build selects the shared queue without an env hook")
    else:
        print("SKIP shared queue client/state not installed on this host")

    missing = "/nonexistent-queue-state"
    result, config = attempt({"BATON_COMPILE_QUEUE_ROOT": missing})
    assert result.returncode == 2, result.stdout + result.stderr
    assert "bootstrap-compile-queue.sh" in result.stderr, result.stderr
    assert str(Path(missing) / "compile-queue-runner") in result.stderr, result.stderr
    assert not config.exists(), "queue configuration synthesized without a queue"
    print("PASS a missing queue refuses with the bootstrap command")

    result, config = attempt({"BATON2_NATIVE_QUEUE_DRIVER": "/bin/false"})
    assert not config.exists(), "an explicit driver must not synthesize configuration"
    assert result.returncode != 0, result.stdout + result.stderr
    print("PASS an explicit queue driver wins")

    result, config = attempt({"BATON2_NATIVE_QUEUE": "/tmp/explicit-queue.json"})
    assert not config.exists(), "a supplied queue configuration must not be replaced"
    assert result.returncode != 0, result.stdout + result.stderr
    print("PASS a supplied queue configuration is preserved")

    result, config = attempt(
        {"BATON_COMPILE_QUEUE_ROOT": missing}, "bend2/scripts/check-native.sh", [])
    assert result.returncode == 2, result.stdout + result.stderr
    assert "bootstrap-compile-queue.sh" in result.stderr, result.stderr
    assert not config.exists(), "check-native synthesized configuration without a queue"
    print("PASS check-native uses the same missing-queue refusal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
