"""A native that is silent while its session holds a claimed wake with owed input is reported to its coordinator.

The fixtures write coordinator rows and attempt files directly: a session with
a claimed wake, an attempt that has not exited, a retained `stdout` file whose
modification time is set per case, and one owed input. `wake` on the focused
stall evidence entry runs the silence check; the report reaches the parent
seat's inbox through the report path. BATON2_STALL_EVIDENCE names a binary
built from bend2/test/stall-evidence-entry.bend.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest

BINARY = os.environ.get('BATON2_STALL_EVIDENCE', '')
SILENT_SECONDS = 2 * 3600
NATIVE_PID = '4242'


@unittest.skipUnless(BINARY and pathlib.Path(BINARY).exists(),
                     'BATON2_STALL_EVIDENCE names no built stall evidence entry')
class StallSilent(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.run_entry('init')
        self.rows('INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) '
                  "VALUES('root',NULL,'omp','fixture','low','native-root','')")

    def run_entry(self, mode):
        result = subprocess.run([BINARY, str(self.db), mode], capture_output=True, text=True,
                                env=dict(os.environ, HOME=str(self.directory)))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def rows(self, statement, parameters=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(statement, parameters).fetchall()

    def seat(self, name, output_age=None, phase='running', claimed=True, stopped=False,
             output=''):
        """A worker whose attempt directory holds stdout last written output_age seconds ago."""
        attempt = self.directory / ('attempt-' + name)
        attempt.mkdir()
        (attempt / 'native.pid').write_text(NATIVE_PID + '\n')
        stdout = attempt / 'stdout'
        stdout.write_text(output)
        if output_age is not None:
            when = time.time() - output_age
            os.utime(stdout, (when, when))
        self.rows('INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) '
                  "VALUES(?,'root','claude-code','fixture','low',?,'')", (name, 'native-' + name))
        self.rows('INSERT INTO executions(session,id,mode,directory,phase,status) '
                  "VALUES(?,?,'retained',?,?,'')", (name, 'attempt-' + name, str(attempt), phase))
        self.rows("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'root',?,'task','Owed work')",
                  ('owed-' + name, name))
        if claimed:
            self.rows("INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) "
                      "VALUES(?,'claimed',?,1)", (name, 'owed-' + name))
        if stopped:
            self.rows("INSERT INTO session_stops(session,id,reason,attempt,directory,outcome) "
                      "VALUES(?,?,'operator stop','','','stopped')", (name, 'stop-' + name))

    def silent_reports(self, name):
        return self.rows("SELECT id,sender,recipient,kind,body FROM messages WHERE id LIKE ?",
                         ('attempt-' + name + ':silent:%',))

    def test_a_silent_native_reports_to_its_coordinator(self):
        self.seat('quiet', output_age=SILENT_SECONDS)
        self.run_entry('wake')
        (report,) = self.silent_reports('quiet')
        ident, sender, recipient, kind, body = report
        self.assertEqual((sender, recipient, kind), ('quiet', 'root', 'report'))
        for fact in ('session quiet', 'Attempt attempt-quiet', 'native pid ' + NATIVE_PID,
                     'last output ', ' UTC', 'owed inputs 1'):
            self.assertIn(fact, body)
        self.assertTrue(ident.startswith('attempt-quiet:silent:'))
        self.assertEqual(self.rows("SELECT count(*) FROM session_stops WHERE session='quiet'"), [(0,)])
        self.assertEqual(self.rows("SELECT phase FROM executions WHERE session='quiet'"), [('running',)])

    def test_a_native_that_keeps_writing_is_not_reported(self):
        self.seat('busy', output_age=5, output='{"type":"assistant"}\n')
        self.run_entry('wake')
        self.assertEqual(self.silent_reports('busy'), [])

    def test_tool_progress_heartbeats_are_not_reported(self):
        self.seat('tool', output_age=30, output='{"type":"tool_progress","tool":"Bash"}\n')
        self.run_entry('wake')
        self.assertEqual(self.silent_reports('tool'), [])

    def test_a_repeated_check_commits_the_same_report(self):
        self.seat('quiet', output_age=SILENT_SECONDS)
        self.run_entry('wake')
        self.run_entry('wake')
        self.assertEqual(len(self.silent_reports('quiet')), 1)

    def test_a_session_without_a_claim_an_exited_attempt_or_a_stop_is_not_reported(self):
        self.seat('unclaimed', output_age=SILENT_SECONDS, claimed=False)
        self.seat('exited', output_age=SILENT_SECONDS, phase='exited')
        self.seat('stopped', output_age=SILENT_SECONDS, stopped=True)
        self.run_entry('wake')
        for name in ('unclaimed', 'exited', 'stopped'):
            self.assertEqual(self.silent_reports(name), [], name)

    def test_a_missing_output_file_derives_no_silence(self):
        self.seat('nofile', output_age=SILENT_SECONDS)
        (self.directory / 'attempt-nofile' / 'stdout').unlink()
        self.run_entry('wake')
        self.assertEqual(self.silent_reports('nofile'), [])


if __name__ == '__main__':
    unittest.main()
