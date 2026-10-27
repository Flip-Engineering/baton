#!/usr/bin/env python3
"""Homelab build entry points select the shared queue by default.

Runs build-native.sh with no BATON2_NATIVE_QUEUE_DRIVER in the
environment and a compiler that fails the version check, so the
build stops before any compilation. Queue selection happens
before that check: with a queue client and state root present,
the synthesized queue configuration must exist and name the
shared client and state root. With the state root absent, no
configuration may be synthesized, preserving the direct path on
hosts without an installed queue. No compilation is launched.
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


def attempt(extra_env):
    config = ROOT / ".scratch/bend2/queue-run/queue-config.json"
    if config.exists():
        config.unlink()
    fake = Path(tempfile.mkdtemp(prefix="queue-entry-fake-")) / "bend"
    fake.write_text("#!/bin/sh\necho 'bend 0.0.0'\n")
    fake.chmod(0o755)
    env = dict(os.environ)
    env.pop("BATON2_NATIVE_QUEUE_DRIVER", None)
    env.pop("BATON2_NATIVE_QUEUE", None)
    env["BEND"] = str(fake)
    env.update(extra_env)
    result = subprocess.run(
        ["sh", "bend2/scripts/build-native.sh", "bend2/test/process.bend",
         ".scratch/bend2/queue-entry-default-probe"],
        cwd=ROOT, env=env, capture_output=True, text=True)
    assert result.returncode != 0, result.stdout + result.stderr
    return config


def main():
    if not CLIENT.is_file() or not STATE.is_dir():
        print("SKIP shared queue client/state not installed on this host")
        return 0
    config = attempt({})
    assert config.is_file(), "queue configuration was not synthesized"
    data = json.loads(config.read_text())
    assert data["client"] == str(CLIENT), data
    assert data["state"] == str(STATE), data
    assert "queue-entry-fake-" in data["bend"], data
    print("PASS build selects the shared queue without an env hook")

    config = attempt({"BATON_COMPILE_QUEUE_ROOT": "/nonexistent-queue-state"})
    assert not config.exists(), "queue configuration synthesized without a queue"
    print("PASS hosts without an installed queue keep the direct path")
    return 0


if __name__ == "__main__":
    sys.exit(main())
