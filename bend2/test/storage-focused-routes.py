"""Focused command routing smoke tests for the storage-enabled receiver."""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

BINARY = pathlib.Path(os.environ["BATON2_STORAGE_FOCUSED_BINARY"]).resolve()


class StorageFocusedRoutes(unittest.TestCase):
    def test_agent_native_input_keeps_its_three_argument_route(self):
        with tempfile.TemporaryDirectory(prefix="baton-storage-route-") as name:
            db = pathlib.Path(name) / "fixture.sqlite"
            sqlite3.connect(db).close()
            run = subprocess.run(
                [str(BINARY), str(db), "agent-native-input", "/bin/echo"],
                input='["route-ok"]', text=True, capture_output=True, check=False)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            self.assertEqual(run.stdout, f"{db} route-ok\n")

    def test_storage_preview_routes_to_storage_handler(self):
        with tempfile.TemporaryDirectory(prefix="baton-storage-route-") as name:
            db = pathlib.Path(name) / "fixture.sqlite"
            sqlite3.connect(db).close()
            run = subprocess.run(
                [str(BINARY), str(db), "storage-preview", "fixture-session"],
                text=True, capture_output=True, check=False)
            self.assertNotEqual(run.returncode, 0)
            self.assertNotIn("unsupported focused receive command", run.stderr)

    def test_storage_apply_routes_to_writer_lease_refusal(self):
        with tempfile.TemporaryDirectory(prefix="baton-storage-route-") as name:
            db = pathlib.Path(name) / "fixture.sqlite"
            sqlite3.connect(db).close()
            env = dict(os.environ)
            env["BATON_STORAGE_ROOTS"] = f"scratch={name}/candidate"
            env["BATON_STORAGE_EXCLUSIVE_ROOTS"] = f"{name}/candidate"
            run = subprocess.run(
                [str(BINARY), str(db), "storage-apply", "fixture-session"],
                env=env, text=True, capture_output=True, check=False)
            self.assertNotEqual(run.returncode, 0)
            self.assertNotIn("unsupported focused receive command", run.stderr)

    def test_storage_collect_routes_to_unknown_session_refusal(self):
        with tempfile.TemporaryDirectory(prefix="baton-storage-route-") as name:
            db = pathlib.Path(name) / "fixture.sqlite"
            sqlite3.connect(db).close()
            schema = subprocess.run([str(BINARY), "--ensure-schema", str(db)],
                                    text=True, capture_output=True, check=False)
            self.assertEqual(schema.returncode, 0, schema.stdout + schema.stderr)
            run = subprocess.run(
                [str(BINARY), str(db), "storage-collect", "fixture-session"],
                text=True, capture_output=True, check=False)
            self.assertEqual(run.returncode, 2, run.stdout + run.stderr)
            self.assertIn("unknown session: fixture-session", run.stderr)
            self.assertNotIn("unsupported focused receive command", run.stderr)


if __name__ == "__main__":
    unittest.main()
