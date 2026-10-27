#!/usr/bin/env python3
"""Native build and check entry points select the shared queue by default.

Runs the entry points with no BATON2_NATIVE_QUEUE_DRIVER in the environment
and a compiler that fails the version check, so each stops before any
compilation. With a queue client and state root present, one immutable
invocation configuration must be created under the supplied queue run root
and name the shared client and state root. An existing configuration at that
root must stay unchanged. Concurrent invocations must create distinct
configuration paths. Without an installed queue, the entry point exits with
the one-time bootstrap command instead of compiling outside the queue. A
supplied queue configuration is used only when it is readable; an unreadable
one is refused. No compilation is launched and the fixture keeps its work
under one temporary root.
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
SENTINEL = b'{"sentinel":"operational configuration"}\n'


def invocation_configs(run_root):
    return sorted(run_root.glob("invocation.*/queue-config.json"))


def base_environment(fake_root, run_root):
    env = dict(os.environ)
    env.pop("BATON2_NATIVE_QUEUE_DRIVER", None)
    env.pop("BATON2_NATIVE_QUEUE", None)
    env["CC"] = os.environ.get("CC", "clang")
    env["TMPDIR"] = str(fake_root)
    env["BATON2_QUEUE_RUN_ROOT"] = str(run_root)
    return env


def fake_compiler(directory, index=1):
    root = Path(directory) / ("fake-%d" % index)
    root.mkdir()
    fake = root / "bend"
    fake.write_text("#!/bin/sh\necho 'bend 0.0.0'\n")
    fake.chmod(0o755)
    return fake


def attempt(extra_env, run_root, script="bend2/scripts/build-native.sh", arguments=None):
    with tempfile.TemporaryDirectory(prefix="queue-entry-fake-", dir=run_root.parent) as fake_root:
        env = base_environment(fake_root, run_root)
        env["BEND"] = str(fake_compiler(fake_root))
        env.update(extra_env)
        result = subprocess.run(
            ["sh", script, *(arguments or ["bend2/test/process.bend",
                                           ".scratch/bend2/queue-entry-default-probe"])],
            cwd=ROOT, env=env, capture_output=True, text=True)
        return result, invocation_configs(run_root)


def concurrent_attempt(run_root):
    with tempfile.TemporaryDirectory(prefix="queue-entry-fake-", dir=run_root.parent) as fake_root:
        processes = []
        for index in (1, 2):
            env = base_environment(fake_root, run_root)
            env["BEND"] = str(fake_compiler(fake_root, index))
            processes.append(subprocess.Popen(
                ["sh", "bend2/scripts/build-native.sh", "bend2/test/process.bend",
                 ".scratch/bend2/queue-entry-default-probe"],
                cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True))
        outputs = [process.communicate() for process in processes]
        return outputs, invocation_configs(run_root)


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

            concurrent_root = new_run_root(temporary, "concurrent")
            outputs, configs = concurrent_attempt(concurrent_root)
            assert unchanged(concurrent_root), "concurrent builds rewrote a configuration"
            assert len(configs) == 2, outputs
            assert len({config.parent.resolve() for config in configs}) == 2, configs
            for config in configs:
                data = json.loads(config.read_text())
                assert data["run"] == str(config.parent.resolve()), data
            print("PASS concurrent builds own distinct configurations")
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
        supplied = Path(temporary) / "supplied-queue.json"
        supplied.write_bytes(b'{"supplied":true}\n')
        result, configs = attempt({"BATON2_NATIVE_QUEUE": str(supplied)}, supplied_root)
        assert configs == [], "a supplied queue configuration must not be replaced"
        assert result.returncode != 0, result.stdout + result.stderr
        assert supplied.read_bytes() == b'{"supplied":true}\n', "a supplied configuration changed"
        assert unchanged(supplied_root), "a supplied configuration was rewritten"
        print("PASS a readable supplied queue configuration is preserved")

        unreadable_root = new_run_root(temporary, "unreadable")
        unreadable = Path(temporary) / "missing-queue.json"
        result, configs = attempt({"BATON2_NATIVE_QUEUE": str(unreadable)}, unreadable_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "not readable" in result.stderr, result.stderr
        assert configs == [], "an unreadable supplied configuration selected a queue"
        assert unchanged(unreadable_root), "an unreadable configuration was rewritten"
        assert not unreadable.exists(), "the refusal created the supplied path"
        print("PASS an unreadable supplied queue configuration is refused")

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
