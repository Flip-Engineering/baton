"""A native that is silent while its session holds a claimed wake with owed input is reported to its coordinator.

The fixtures write coordinator rows and attempt files directly: a session with
a claimed wake, an attempt that has not exited, a retained `stdout` file whose
modification time is set per case, and one owed input. `wake` on the focused
stall evidence entry runs the silence check; the report reaches the parent
seat's inbox through the report path. BATON2_STALL_EVIDENCE names a binary
built from bend2/test/stall-evidence-entry.bend.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

BINARY = os.environ.get('BATON2_STALL_EVIDENCE', '')
SILENT_SECONDS = 2 * 3600
# Elapsed silence at the start of a further silence period (900 s each).
PERIOD_START_SECONDS = 1800
NATIVE_PID = '4242'


@unittest.skipUnless(BINARY and pathlib.Path(BINARY).exists(),
                     'BATON2_STALL_EVIDENCE names no built stall evidence entry')
class StallSilent(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.addCleanup(self.shutdown_owner)
        self.run_entry('init')
        self.marker = self.directory / 'root.marker'
        endpoint = self.directory / 'root-endpoint.py'
        endpoint.write_text(
            '#!/usr/bin/env python3\n'
            'import pathlib, sys\n'
            f'pathlib.Path({str(self.marker)!r}).open("a").write(sys.argv[-1]+"\\n")\n')
        endpoint.chmod(0o700)
        self.rows('INSERT INTO sessions(id,parent,harness,model,effort,native,endpoint) '
                  "VALUES('root',NULL,'omp','fixture','low','native-root',?)",
                  (json.dumps([sys.executable, str(endpoint)]),))

    def shutdown_owner(self):
        if self.db.exists():
            result = subprocess.run([BINARY, '--instance-shutdown', str(self.db)],
                                    capture_output=True, text=True,
                                    env=dict(os.environ, HOME=str(self.directory)))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def run_entry(self, mode):
        result = subprocess.run([BINARY, str(self.db), mode], capture_output=True, text=True,
                                env=dict(os.environ, HOME=str(self.directory)))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def rows(self, statement, parameters=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(statement, parameters).fetchall()

    def seat(self, name, output_age=None, phase='running', claimed=True, stopped=False,
             output='', owed=1):
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
        for index in range(owed):
            self.rows("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'root',?,'task','Owed work')",
                      (f'owed-{name}-{index}', name))
        if claimed:
            self.rows("INSERT OR REPLACE INTO wake_claims(session,state,owner,generation) "
                      "VALUES(?,'claimed',?,1)", (name, 'owed-' + name))
        if stopped:
            self.rows("INSERT INTO session_stops(session,id,reason,attempt,directory,outcome) "
                      "VALUES(?,?,'operator stop','','','stopped')", (name, 'stop-' + name))

    def deliveries(self):
        return self.marker.read_text().split() if self.marker.exists() else []

    def earlier_report(self, name, read=False):
        """The report row of the silence as an earlier check committed it, delivery lost."""
        mtime = int(os.stat(self.directory / ('attempt-' + name) / 'stdout').st_mtime)
        ident = f'attempt-{name}:silent:{mtime}:1'
        self.rows("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,'root','report','Earlier body')",
                  (ident, name))
        if read:
            self.rows("INSERT INTO message_reads(attempt,message,recipient,native,identity) "
                      "VALUES('earlier',?,'root','native-root','identity')", (ident,))
        return ident

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

    def test_a_new_report_is_delivered_to_the_coordinator_once(self):
        self.seat('quiet', output_age=SILENT_SECONDS)
        self.run_entry('wake')
        (report,) = self.silent_reports('quiet')
        self.assertEqual(self.deliveries(), [report[0]])

    def test_an_unread_report_is_delivered_again_at_the_start_of_a_silence_period(self):
        # A delivery lost with its forked task leaves the row; the next check repairs it.
        self.seat('lost', output_age=PERIOD_START_SECONDS)
        ident = self.earlier_report('lost')
        self.run_entry('wake')
        self.assertEqual(len(self.silent_reports('lost')), 1)
        self.assertEqual(self.deliveries(), [ident])

    def test_an_unread_report_is_not_delivered_again_inside_a_silence_period(self):
        self.seat('lost', output_age=SILENT_SECONDS + 450)
        self.earlier_report('lost')
        self.run_entry('wake')
        self.assertEqual(self.deliveries(), [])
        self.assertEqual(len(self.silent_reports('lost')), 1)

    def test_a_read_report_is_not_delivered_again(self):
        self.seat('seen', output_age=PERIOD_START_SECONDS)
        self.earlier_report('seen', read=True)
        self.run_entry('wake')
        self.assertEqual(self.deliveries(), [])
        self.assertEqual(len(self.silent_reports('seen')), 1)

    def test_a_native_idle_after_its_result_with_owed_input_is_reported(self):
        # The turn ended with a result event, the receiver closed stdin, and the
        # native lingered for background commands while input stayed owed.
        result = ('{"type":"result","subtype":"success","is_error":false,'
                  '"result":"Turn finished.","stop_reason":"end_turn"}\n')
        self.seat('idle', output_age=SILENT_SECONDS, output=result, owed=14)
        self.run_entry('wake')
        (report,) = self.silent_reports('idle')
        self.assertEqual((report[1], report[2], report[3]), ('idle', 'root', 'report'))
        self.assertIn('owed inputs 14', report[4])
        self.assertIn('native pid ' + NATIVE_PID, report[4])

    def test_a_changed_owed_count_reports_the_silence_again(self):
        self.seat('quiet', output_age=SILENT_SECONDS)
        self.run_entry('wake')
        self.rows("INSERT INTO messages(id,sender,recipient,kind,body) "
                  "VALUES('owed-quiet-more','root','quiet','task','More work')")
        self.run_entry('wake')
        bodies = [row[4] for row in self.silent_reports('quiet')]
        self.assertEqual(len(bodies), 2)
        self.assertTrue(any('owed inputs 1' in body for body in bodies))
        self.assertTrue(any('owed inputs 2' in body for body in bodies))

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
