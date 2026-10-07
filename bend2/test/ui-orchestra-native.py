"""Exercise the UI change projection through the admitted native coordinator."""
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
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

    def test_multilevel_native_turns_report_finish_fail_and_pending_input_are_projected(self):
        pending = self.call('message', 'task-worker', 'root', 'worker', 'task',
                            'Retained task input.')
        self.assertEqual(pending['receipt'], None)
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
            pending_count = db.execute('''SELECT count(*) FROM messages
                                           WHERE recipient='worker' AND receipt IS NULL''').fetchone()[0]
            self.assertEqual(pending_count, 1)
            events = {row[0]: json.loads(row[1]) for row in db.execute(
                'SELECT id,event FROM turns WHERE worker IN (?,?)',
                ('worker', 'failed-worker'))}
        self.assertEqual(events['worker-finished']['payload']['terminal'], 'completed')
        self.assertEqual(events['worker-failed']['payload']['terminal'], 'failed')
        with sqlite3.connect(self.db) as db:
            executions = dict(db.execute('SELECT session,status FROM executions'))
        self.assertEqual(executions['worker'], 'exit 0')
        self.assertNotEqual(executions['failed-worker'], 'exit 0')


if __name__ == '__main__':
    unittest.main()
