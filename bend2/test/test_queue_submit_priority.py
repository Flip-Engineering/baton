"""The production queue callers carry configured scheduling priority.

The adapter submit path (used by CI) and the queue-entry path (used by
ordinary builds) both read BATON2_COMPILE_QUEUE_PRIORITY / the immutable
queue configuration. Priority stays scheduling metadata: it appears on
the run argv only, never on the key argv, so cache keys are unchanged.
"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ADAPTER = ROOT / ".github/scripts/queue-native-checks.py"
ENTRY = ROOT / "bend2/scripts/queue-entry.sh"


def load_adapter():
    spec = importlib.util.spec_from_file_location("queue_native_checks", ADAPTER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class QueueSubmitPriorityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-priority-callers-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.client = self.root / "fake-client"
        self.client.write_text(
            "#!/bin/sh\n"
            "case \"$1 $2\" in\n"
            "  '-- key') printf 'deadbeef\\n' ;;\n"
            "  *) exit 0 ;;\n"
            "esac\n")
        self.client.chmod(0o755)

    def submit(self, config, extra_env=None):
        module = load_adapter()
        directory = self.root / ("request-" + str(len(list(self.root.iterdir()))))
        directory.mkdir()
        env = dict(os.environ)
        env.pop("BATON2_COMPILE_QUEUE_PRIORITY", None)
        env.update(extra_env or {})
        previous = os.environ.copy()
        os.environ.clear()
        os.environ.update(env)
        try:
            module.submit(dict({"client": str(self.client), "state": str(self.root / "state")}, **config),
                          directory, [], ["/bin/true"], key_only=True)
        finally:
            os.environ.clear()
            os.environ.update(previous)
        return directory

    def test_configured_priority_rides_the_run_argv_only(self):
        directory = self.submit({"priority": "9"})
        request = json.loads((directory / "request.json").read_text())
        separator = len(request["argv"]) - 1 - request["argv"][::-1].index("--")
        self.assertIn("--priority", request["argv"][:separator])
        self.assertEqual(request["argv"][request["argv"].index("--priority") + 1], "9")
        self.assertEqual(request["priority"], "9")
        self.assertNotIn("--priority", request["key_argv"])

    def test_default_keeps_equal_priority_argv(self):
        directory = self.submit({})
        request = json.loads((directory / "request.json").read_text())
        self.assertNotIn("--priority", request["argv"])
        self.assertEqual(request["priority"], "0")

    def test_environment_priority_reaches_the_adapter(self):
        directory = self.submit({}, extra_env={"BATON2_COMPILE_QUEUE_PRIORITY": "7"})
        request = json.loads((directory / "request.json").read_text())
        self.assertIn("--priority", request["argv"])
        self.assertEqual(request["argv"][request["argv"].index("--priority") + 1], "7")

    def run_entry(self, priority):
        state = self.root / "state"
        state.mkdir(exist_ok=True)
        run_root = self.root / "runs"
        env = dict(os.environ, BATON2_COMPILE_QUEUE_BIN=str(self.client),
                   BATON_COMPILE_QUEUE_ROOT=str(state),
                   BATON2_QUEUE_RUN_ROOT=str(run_root),
                   BATON2_NATIVE_QUEUE_DRIVER="", BATON2_NATIVE_QUEUE="",
                   PYTHON3=sys.executable)
        env.pop("BATON2_NATIVE_QUEUE_DRIVER")
        env.pop("BATON2_NATIVE_QUEUE")
        if priority is None:
            env.pop("BATON2_COMPILE_QUEUE_PRIORITY", None)
        else:
            env["BATON2_COMPILE_QUEUE_PRIORITY"] = priority
        script = ('root="' + str(ROOT) + '"; compiler=/bin/true; '
                  '. "' + str(ENTRY) + '"; cat "$BATON2_NATIVE_QUEUE"')
        return subprocess.run(["sh", "-c", script], env=env, capture_output=True, text=True)

    def test_queue_entry_records_configured_priority(self):
        result = self.run_entry("9")
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        self.assertEqual(config["priority"], "9")
        self.assertEqual(config["client"], str(self.client))

    def test_queue_entry_defaults_to_zero(self):
        result = self.run_entry(None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["priority"], "0")

    def test_queue_entry_refuses_a_non_numeric_priority(self):
        result = self.run_entry("high")
        self.assertEqual(result.returncode, 2)
        self.assertIn("non-negative integer", result.stderr)


if __name__ == "__main__":
    unittest.main()
