"""Exercise the UI change projection through the admitted native coordinator."""
import json
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class OrchestraProjection(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'orchestra.db'
        self.repo = self.directory / 'repo'
        self.repo.mkdir()
        for args in [('init', '-q'), ('config', 'user.name', 'Orchestra UI fixture'),
                     ('config', 'user.email', 'ui-fixture@example.invalid'),
                     ('commit', '-qm', 'Initial tree', '--allow-empty')]:
            subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                           capture_output=True, text=True)
        self.call('attach', 'root', 'fixture', 'root-native', '')
        with sqlite3.connect(self.db) as db:
            projected = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND name IN "
                "('native_changes_sessions_insert','native_changes_messages_update')")}
            self.assertEqual(projected, {
                'native_changes_sessions_insert', 'native_changes_messages_update'})
        self.call('role', 'root', 'principal-conductor')
        self.player('lead', 'root')
        self.call('role', 'lead', 'associate-conductor')
        self.player('worker', 'lead')
        self.player('failed-worker', 'worker')

    def call(self, *args, success=True):
        result = subprocess.run([str(EXE), str(self.db), *args], text=True,
                                capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def player(self, name, parent):
        workspace = self.directory / name
        return self.call('recruit', name, parent, 'muse', 'configured-model', 'low',
                         str(self.repo), name + '-branch', str(workspace), 'HEAD')

    def run_turn(self, player, ident, terminal, text):
        workspace = self.directory / player
        command = self.directory / (player + '-native')
        task = self.directory / (player + '-task.txt')
        log = self.directory / (player + '-native.jsonl')
        task.write_text('Task for ' + player)
        failed = 'sys.exit(1)' if terminal == 'failed' else ''
        command.write_text('#!' + sys.executable + '\n' + '''import json,sys
native = 'native-''' + player + ''''
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.model.configured',
  'payload':{'kind':'run_model_configured','model_id':'observed-fixture-model'}}), flush=True)
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.terminal.''' + terminal + '''',
  'payload':{'kind':'run_terminal','terminal':''' + repr(terminal) + ''','text':''' + repr(text) + '''}}), flush=True)
''' + failed + '\n')
        command.chmod(0o755)
        result = subprocess.run([str(EXE), str(self.db), 'turn', player, ident,
                                 str(command), 'configured-model', 'low', str(workspace),
                                 str(task), str(log), ''], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def changes(self):
        with sqlite3.connect(self.db) as db:
            return db.execute('''SELECT change_id,session_id,entity,entity_id,operation,
                                        kind,summary
                                   FROM native_changes ORDER BY change_id''').fetchall()

    def ui_snapshot(self, reader, subject):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node 22 is required for the Orchestra UI fixture')
        server = ROOT / 'ui' / 'orchestra' / 'server.mjs'
        process = subprocess.Popen(
            [node, str(server), '--database', str(self.db), '--reader', reader,
             '--subject', subject, '--port', '0'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True)
        try:
            binding = json.loads(process.stdout.readline())
            self.assertEqual(binding['readOnly'], True)
            self.assertEqual(binding['host'], '127.0.0.1')
            url = process.stdout.readline().strip()
            self.assertTrue(url.startswith('http://127.0.0.1:'), url)
            with urllib.request.urlopen(url + 'orchestra/snapshot?subject=' + subject + '&since=0') as response:
                self.assertEqual(response.status, 200)
                snapshot = json.load(response)
            with self.assertRaises(urllib.error.HTTPError) as denied:
                urllib.request.urlopen(url + 'orchestra/snapshot?subject=root&since=0')
            self.assertEqual(denied.exception.code, 403)
            denied.exception.close()
            return snapshot
        finally:
            process.stdin.close()
            process.wait(timeout=10)
            stderr = process.stderr.read()
            self.assertEqual(process.returncode, 0, stderr)

    def test_multilevel_native_turns_report_finish_fail_and_pending_input_are_projected(self):
        pending = self.call('message', 'task-worker', 'root', 'worker', 'task',
                            'Retained task input.')
        self.assertEqual(pending['receipt'], None)
        with sqlite3.connect(self.db) as db:
            before_rollback = db.execute('SELECT max(change_id) FROM native_changes').fetchone()[0]
        self.call('message', 'lead-report', 'worker', 'root', 'guidance',
                  'Conflicting reuse must roll back.', success=False)
        with sqlite3.connect(self.db) as db:
            after_rollback = db.execute('SELECT max(change_id) FROM native_changes').fetchone()[0]
        self.assertEqual(after_rollback, before_rollback)
        self.call('report', 'lead-report', 'lead', 'Lead report is retained.')

        self.run_turn('worker', 'worker-finished', 'completed',
                      'Worker completed the assigned task.')
        self.assertEqual(self.call('delivery', 'worker-finished')['recipient'], 'lead')
        self.run_turn('failed-worker', 'worker-failed', 'failed',
                      'Worker failed with a provider error.')
        self.assertEqual(self.call('delivery', 'worker-failed')['recipient'], 'worker')

        rows = self.changes()
        cursors = [row[0] for row in rows]
        self.assertEqual(cursors, sorted(set(cursors)))
        self.assertTrue(any(row[1:3] == ('lead', 'player') and row[5] == 'session'
                            for row in rows))
        self.assertTrue(any(row[1:3] == ('worker', 'message') and row[5] == 'message:task'
                            for row in rows))
        self.assertTrue(any(row[1:3] == ('worker', 'turn') and row[5] == 'report'
                            for row in rows))
        self.assertTrue(any(row[1:3] == ('failed-worker', 'turn') and row[5] == 'report'
                            for row in rows))
        self.assertTrue(any(row[1:3] == ('worker', 'execution') and row[5] == 'execution'
                            and row[6].startswith('starting') for row in rows))
        self.assertTrue(any(row[1:3] == ('worker', 'execution') and row[5] == 'execution'
                            and row[6] == 'exited exit 0' for row in rows))
        self.assertTrue(any(row[1:3] == ('failed-worker', 'execution') and row[5] == 'execution'
                            and row[6] != 'exited exit 0' for row in rows))
        self.assertTrue(any(row[1] == 'root' and row[5] == 'message:report'
                            and row[6] == 'report from lead' for row in rows))
        self.assertTrue(any(row[1] == 'worker' and row[5] == 'session'
                            for row in rows))
        with sqlite3.connect(self.db) as db:
            pending_inputs = db.execute('''SELECT id, kind, sender, receipt FROM messages
                                             WHERE recipient='worker' AND receipt IS NULL
                                               AND kind IN ('task', 'guidance', 'recovery')
                                               AND NOT EXISTS (SELECT 1 FROM session_stops
                                                                WHERE session='worker')
                                             ORDER BY seq''').fetchall()
            print('pending inputs admitted for worker: ' + json.dumps(pending_inputs), flush=True)
            self.assertEqual(len(pending_inputs), 3, pending_inputs)
            self.assertIn(('task-worker', 'task', 'root', None), pending_inputs)
            self.assertTrue(all(row[1] in ('task', 'guidance', 'recovery')
                                and row[3] is None for row in pending_inputs), pending_inputs)
            events = {row[0]: json.loads(row[1]) for row in db.execute(
                'SELECT id,event FROM turns WHERE worker IN (?,?)',
                ('worker', 'failed-worker'))}
        self.assertEqual(events['worker-finished']['payload']['terminal'], 'completed')
        self.assertEqual(events['worker-failed']['payload']['terminal'], 'failed')
        with sqlite3.connect(self.db) as db:
            executions = dict(db.execute('SELECT session,status FROM executions'))
        self.assertEqual(executions['worker'], 'exit 0')
        self.assertNotEqual(executions['failed-worker'], 'exit 0')
        snapshot = self.ui_snapshot('lead', 'worker')
        self.assertEqual(snapshot['selection']['reader'], 'lead')
        self.assertEqual(snapshot['selection']['scope'], ['failed-worker', 'worker'])
        worker = next(player for player in snapshot['players'] if player['id'] == 'worker')
        self.assertEqual(worker['model'], 'configured-model')
        self.assertEqual(worker['observedModel'], 'observed-fixture-model')
        self.assertEqual(worker['actualProcess'], 'unknown')
        self.assertEqual(worker['pendingCount'], len(pending_inputs))


if __name__ == '__main__':
    unittest.main()
