#!/usr/bin/env python3
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "bend2/deploy/macos/logs-clean-all/cleanup-registered-logs.sh"
PLIST = ROOT / "bend2/deploy/macos/logs-clean-all/com.flip.baton2.logs-clean-all.plist.in"


class LogsCleanAllLaunchdTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="baton2-launchd-logs-")
        self.root = Path(self.temp.name)
        self.release = self.root / "release"
        (self.release / "bin").mkdir(parents=True)
        helper = self.release / "libexec/baton2/logs-clean-all"
        helper.parent.mkdir(parents=True)
        helper.write_text(
            '#!/bin/sh\n'
            'printf "{\\"database\\":\\"%s\\",\\"result\\":\\"ok\\"}\\n" "$1"\n'
        )
        helper.chmod(0o755)
        self.runner = self.release / "bin/cleanup-registered-logs"
        shutil.copyfile(RUNNER, self.runner)
        self.runner.chmod(0o755)
        self.home = self.root / "home"
        self.home.mkdir()
        self.database = self.root / "orchestra.db"
        self.database.write_bytes(b"fixture")

    def tearDown(self):
        self.temp.cleanup()

    def run_runner(self, database=None, job="fixture"):
        env = dict(os.environ, HOME=str(self.home))
        return subprocess.run(
            [str(self.runner), str(database or self.database), job],
            env=env, text=True, capture_output=True, check=False,
        )

    def test_success_writes_private_daily_result_and_prunes_expired_files(self):
        log_dir = self.home / "Library/Logs/Baton2/logs-clean-all/fixture"
        log_dir.mkdir(parents=True)
        expired = log_dir / "run-expired.json"
        expired.write_text("old")
        old = 1_700_000_000
        os.utime(expired, (old, old))

        result = self.run_runner()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((log_dir / ("run-" + subprocess.check_output(
            ["/bin/date", "-u", "+%Y-%m-%d"], text=True).strip() + ".json")).stat().st_mode & 0o777, 0o600)
        self.assertEqual((log_dir.stat().st_mode & 0o777), 0o700)
        self.assertFalse(expired.exists())
        self.assertEqual(list(log_dir.glob("run-*.json"))[0].read_text(),
                         '{"database":"' + str(self.database) + '","result":"ok"}\n')

    def test_missing_and_symlink_databases_are_refused(self):
        missing = self.run_runner(self.root / "missing.db")
        self.assertEqual(missing.returncode, 66)
        link = self.root / "link.db"
        link.symlink_to(self.database)
        linked = self.run_runner(link)
        self.assertEqual(linked.returncode, 66)
        self.assertFalse((self.home / "Library/Logs/Baton2/logs-clean-all/fixture").exists())

    def test_failed_helper_result_is_retained_with_its_exit_status(self):
        helper = self.release / "libexec/baton2/logs-clean-all"
        helper.write_text('#!/bin/sh\necho helper-failed >&2\nexit 7\n')
        helper.chmod(0o755)
        result = self.run_runner()
        self.assertEqual(result.returncode, 7)
        log_dir = self.home / "Library/Logs/Baton2/logs-clean-all/fixture"
        failed = list(log_dir.glob("run-*.failed"))
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0].read_text(), "helper-failed\n")

    def test_launchd_template_has_no_startup_run_and_daily_schedule(self):
        rendered = PLIST.read_text()
        for key, value in {
            "@JOB_ID@": "fixture", "@HOME@": "/Users/test",
            "@RELEASE_NAME@": "logs-clean-all-test", "@DATABASE_PATH@": "/tmp/orchestra.db",
            "@HOUR@": "4", "@MINUTE@": "10",
        }.items():
            rendered = rendered.replace(key, value)
        plist = plistlib.loads(rendered.encode())
        self.assertFalse(plist["RunAtLoad"])
        self.assertEqual(plist["StartCalendarInterval"], {"Hour": 4, "Minute": 10})
        self.assertEqual(plist["ProgramArguments"][1], "/tmp/orchestra.db")


if __name__ == "__main__":
    unittest.main()
