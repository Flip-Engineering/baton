#!/usr/bin/env python3
"""Native build and check entry points select the shared queue by default.

Runs the entry points with no BATON2_NATIVE_QUEUE_DRIVER in the environment
and a compiler that fails the version check, so each stops before any
compilation. With a queue client and state root present, one immutable
invocation configuration must be created under the supplied queue run root
and name the shared client and state root. An existing configuration at that
root must stay unchanged. Concurrent invocations must create distinct
configuration paths. Without an installed queue, the entry point exits with
the one-time bootstrap command. A supplied queue configuration is used only
when it names a readable regular file with non-empty run, bend, cc, client
and state strings; a directory, device, invalid or incomplete file is
refused. An explicit driver wins before that validation. No compilation is
launched and the fixture keeps its work under one temporary root.
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


def fake_compiler(directory, index=1, version="0.0.0"):
    root = Path(directory) / ("fake-%d" % index)
    root.mkdir()
    fake = root / "bend"
    fake.write_text("#!/bin/sh\necho 'bend %s'\n" % version)
    fake.chmod(0o755)
    return fake


def attempt(extra_env, run_root, script="bend2/scripts/build-native.sh", arguments=None,
            compiler_version="0.0.0", driver=False):
    with tempfile.TemporaryDirectory(prefix="queue-entry-fake-", dir=run_root.parent) as fake_root:
        env = base_environment(fake_root, run_root)
        env["BEND"] = str(fake_compiler(fake_root, version=compiler_version))
        if driver:
            path = Path(fake_root) / "driver"
            path.write_text("import sys\nsys.exit(42)\n")
            path.chmod(0o755)
            env["BATON2_NATIVE_QUEUE_DRIVER"] = str(path)
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
        supplied_config = {
            "run": str(Path(temporary) / "supplied-run"),
            "bend": str(Path(temporary) / "bend"),
            "cc": "clang",
            "client": str(CLIENT),
            "state": str(STATE),
        }
        supplied_bytes = (json.dumps(supplied_config, indent=2) + "\n").encode()
        supplied.write_bytes(supplied_bytes)
        result, configs = attempt({"BATON2_NATIVE_QUEUE": str(supplied)}, supplied_root)
        assert configs == [], "a supplied queue configuration must not be replaced"
        assert result.returncode != 0, result.stdout + result.stderr
        assert supplied.read_bytes() == supplied_bytes, "a supplied configuration changed"
        assert unchanged(supplied_root), "a supplied configuration was rewritten"
        print("PASS a readable supplied queue configuration is preserved")

        unreadable_root = new_run_root(temporary, "unreadable")
        unreadable = Path(temporary) / "missing-queue.json"
        result, configs = attempt({"BATON2_NATIVE_QUEUE": str(unreadable)}, unreadable_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "BATON2_NATIVE_QUEUE must name a readable regular file" in result.stderr, result.stderr
        assert configs == [], "an unreadable supplied configuration selected a queue"
        assert unchanged(unreadable_root), "an unreadable configuration was rewritten"
        assert not unreadable.exists(), "the refusal created the supplied path"
        print("PASS an unreadable supplied queue configuration is refused")

        driver_supplied_root = new_run_root(temporary, "driver-supplied")
        missing_supplied = Path(temporary) / "missing-supplied.json"
        result, configs = attempt(
            {"BATON2_NATIVE_QUEUE": str(missing_supplied)},
            driver_supplied_root, compiler_version="2.0.25", driver=True)
        assert result.returncode == 42, result.stdout + result.stderr
        assert configs == [], "a driver plus supplied queue synthesized configuration"
        assert unchanged(driver_supplied_root), "the driver route rewrote a configuration"
        assert "BATON2_NATIVE_QUEUE must name a readable regular file" not in result.stderr, result.stderr
        assert not missing_supplied.exists(), "the driver route created the supplied path"
        print("PASS an explicit driver wins before an unreadable supplied path")

        relative_state_root = new_run_root(temporary, "relative-state")
        result, configs = attempt(
            {"BATON_COMPILE_QUEUE_ROOT": "relative-state"}, relative_state_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "BATON_COMPILE_QUEUE_ROOT must be an absolute path" in result.stderr, result.stderr
        assert configs == [], "a relative state root synthesized configuration"
        assert unchanged(relative_state_root), "a relative state root rewrote a configuration"
        print("PASS a relative state root is refused")

        directory_root = new_run_root(temporary, "supplied-directory-sentinel")
        supplied_directory = Path(temporary) / "supplied-directory"
        supplied_directory.mkdir()
        result, configs = attempt(
            {"BATON2_NATIVE_QUEUE": str(supplied_directory)}, directory_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "BATON2_NATIVE_QUEUE must name a readable regular file" in result.stderr, result.stderr
        assert configs == [], "a supplied directory selected a queue"
        assert unchanged(directory_root), "a supplied directory rewrote a configuration"
        print("PASS a supplied directory is refused")

        device_root = new_run_root(temporary, "supplied-device")
        result, configs = attempt({"BATON2_NATIVE_QUEUE": "/dev/null"}, device_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "BATON2_NATIVE_QUEUE must name a readable regular file" in result.stderr, result.stderr
        assert configs == [], "a supplied device selected a queue"
        assert unchanged(device_root), "a supplied device rewrote a configuration"
        print("PASS a supplied device is refused")

        invalid_root = new_run_root(temporary, "supplied-invalid")
        invalid = Path(temporary) / "invalid-queue.json"
        invalid.write_bytes(b"not json\n")
        result, configs = attempt({"BATON2_NATIVE_QUEUE": str(invalid)}, invalid_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "BATON2_NATIVE_QUEUE must name a readable regular file" in result.stderr, result.stderr
        assert configs == [], "an invalid supplied configuration selected a queue"
        assert unchanged(invalid_root), "an invalid supplied configuration rewrote a configuration"
        assert invalid.read_bytes() == b"not json\n", "the refusal changed the supplied file"
        print("PASS an invalid supplied queue configuration is refused")

        missing_key_root = new_run_root(temporary, "supplied-missing-key")
        missing_key = Path(temporary) / "missing-key-queue.json"
        partial = {"run": "run", "bend": "bend", "cc": "cc", "client": "client"}
        missing_key_bytes = (json.dumps(partial) + "\n").encode()
        missing_key.write_bytes(missing_key_bytes)
        result, configs = attempt(
            {"BATON2_NATIVE_QUEUE": str(missing_key)}, missing_key_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "BATON2_NATIVE_QUEUE must name a readable regular file" in result.stderr, result.stderr
        assert configs == [], "an incomplete supplied configuration selected a queue"
        assert unchanged(missing_key_root), "an incomplete supplied configuration rewrote a configuration"
        assert missing_key.read_bytes() == missing_key_bytes, "the refusal changed the supplied file"
        print("PASS a supplied queue configuration missing a key is refused")

        run_root_file_root = new_run_root(temporary, "run-root-file-sentinel")
        run_root_file = Path(temporary) / "run-root-file"
        run_root_file.write_bytes(b"not a directory\n")
        result, configs = attempt(
            {"BATON2_QUEUE_RUN_ROOT": str(run_root_file)}, run_root_file_root)
        assert result.returncode == 2, result.stdout + result.stderr
        assert "could not create the queue run root" in result.stderr, result.stderr
        assert configs == [], "a run-root file synthesized configuration"
        assert unchanged(run_root_file_root), "a run-root file rewrote a configuration"
        assert run_root_file.read_bytes() == b"not a directory\n", "the refusal changed the run-root file"
        print("PASS a run-root path that is a file is refused")

        with tempfile.TemporaryDirectory(prefix="queue-entry-run-") as outside:
            outside_root = Path(outside)
            (outside_root / "queue-config.json").write_bytes(SENTINEL)
            relative = os.path.relpath(outside_root, ROOT)
            result, configs = attempt(
                {"BATON2_QUEUE_RUN_ROOT": relative}, outside_root)
            assert unchanged(outside_root), "a relative run root rewrote a configuration"
            assert len(configs) == 1, result.stdout + result.stderr
            data = json.loads(configs[0].read_text())
            assert data["run"] == str(configs[0].parent.resolve()), data
            assert configs[0].parent.resolve().parent == outside_root.resolve(), configs
            print("PASS a relative run root resolves under the checkout root")

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
