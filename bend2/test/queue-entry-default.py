#!/usr/bin/env python3
"""Native build and check entry points select the shared queue by default.

Runs the entry points with no BATON2_NATIVE_QUEUE_DRIVER in the environment
and a compiler that fails the version check, so each stops before any
compilation. With a queue client and state root present, one immutable
invocation configuration must be created under the supplied queue run root
and name the shared client and state root. An existing configuration at that
root must stay unchanged. Without an installed queue, the entry point exits
with the one-time bootstrap command instead of compiling outside the queue.
An explicit driver or supplied queue configuration synthesizes nothing. No
compilation is launched and the fixture keeps its work under one temporary
root.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
STATE = Path(os.environ.get("BATON_COMPILE_QUEUE_ROOT", "/var/tmp/baton2-compile-queue"))
CLIENT = STATE / "compile-queue-runner"
SENTINEL = b'{"sentinel":"operational configuration"}\n'


def invocation_configs(run_root):
    return sorted(run_root.glob("invocation.*/queue-config.json"))


def attempt(extra_env, run_root, script="bend2/scripts/build-native.sh", arguments=None):
    with tempfile.TemporaryDirectory(prefix="queue-entry-fake-", dir=run_root.parent) as fake_root:
        fake = Path(fake_root) / "bend"
        fake.write_text("#!/bin/sh\necho 'bend 0.0.0'\n")
        fake.chmod(0o755)
        env = dict(os.environ)
        env.pop("BATON2_NATIVE_QUEUE_DRIVER", None)
        env.pop("BATON2_NATIVE_QUEUE", None)
        env["BEND"] = str(fake)
        env["CC"] = os.environ.get("CC", "clang")
        env["TMPDIR"] = fake_root
        env["BATON2_QUEUE_RUN_ROOT"] = str(run_root)
        env.update(extra_env)
        result = subprocess.run(
            ["sh", script, *(arguments or ["bend2/test/process.bend",
                                           ".scratch/bend2/queue-entry-default-probe"])],
            cwd=ROOT, env=env, capture_output=True, text=True)
        return result, invocation_configs(run_root)


def sentinel(root):
    return (root / "queue-config.json").read_bytes()


def unchanged(root):
    return sentinel(root) == SENTINEL

def new_run_root(parent, name):
    root = Path(parent) / name
    root.mkdir()
    (root / "queue-config.json").write_bytes(SENTINEL)
    return root


def main():
    with tempfile.TemporaryDirectory(prefix="queue-entry-fixture-") as temporary:
        installed_root = new_run_root(temporary, "installed")
        if CLIENT.is_file() and STATE.is_dir():
            result, configs = attempt({}, installed_root)
            assert unchanged(installed_root), "an existing configuration was rewritten"
            assert len(configs) == 1, result.stdout + result.stderr
            data = json.loads(configs[0].read_text())
            assert data["client"] == str(CLIENT), data
            assert data["state"] == str(STATE), data
            assert "queue-entry-fake-" in data["bend"], data
            assert data["run"] == str(configs[0].parent.resolve()), data
            print("PASS build selects the shared queue with one owned configuration")
        else:
            print("SKIP shared queue client/state not installed on this host")

        missing = "/nonexistent-queue-state"
        missing_root = new_run_root(temporary, "missing")
        result, configs = attempt({"BATON_COMPILE_QUEUE_ROOT": missing}, missing_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "bootstrap-compile-queue.sh" in result.stderr, result.stderr
        assert str(Path(missing) / "compile-queue-runner") in result.stderr, result.stderr
        assert configs == [], "queue configuration synthesized without a queue"
        assert unchanged(missing_root), "a refused build rewrote an existing configuration"
        print("PASS a missing queue refuses with the bootstrap command")

        driver_root = new_run_root(temporary, "driver")
        result, configs = attempt({"BATON2_NATIVE_QUEUE_DRIVER": "/bin/false"}, driver_root)
        assert configs == [], "an explicit driver must not synthesize configuration"
        assert result.returncode != 0, result.stdout + result.stderr
        assert unchanged(driver_root), "an explicit driver rewrote an existing configuration"
        print("PASS an explicit queue driver wins")

        supplied_root = new_run_root(temporary, "supplied")
        result, configs = attempt({"BATON2_NATIVE_QUEUE": "/tmp/explicit-queue.json"},
                                  supplied_root)
        assert configs == [], "a supplied queue configuration must not be replaced"
        assert result.returncode != 0, result.stdout + result.stderr
        assert unchanged(supplied_root), "a supplied configuration was rewritten"
        print("PASS a supplied queue configuration is preserved")

        check_root = new_run_root(temporary, "check")
        result, configs = attempt(
            {"BATON_COMPILE_QUEUE_ROOT": missing}, check_root,
            "bend2/scripts/check-native.sh", [])
        assert result.returncode == 2, result.stdout + result.stderr
        assert "bootstrap-compile-queue.sh" in result.stderr, result.stderr
        assert configs == [], "check-native synthesized configuration without a queue"
        assert unchanged(check_root), "check-native rewrote an existing configuration"
        print("PASS check-native uses the same missing-queue refusal")
    return 0


if __name__ == "__main__":
    sys.exit(main())
