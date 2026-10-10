"""Exercise the UI change projection through the admitted native coordinator."""
import json
import pathlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class OrchestraProjection(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'orchestra.db'
        self.addCleanup(self.cleanup_fixture)
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

    def instance_owner_pids(self):
        expected = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        processes = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                   check=True, capture_output=True, text=True)
        owners = set()
        for line in processes.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if len(fields) == 4 and fields[3] == expected and not fields[2].startswith('Z'):
                owners.add(int(fields[0]))
        return owners

    def cleanup_fixture(self):
        try:
            if self.db.exists():
                owners = self.instance_owner_pids()
                stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                         capture_output=True, text=True)
                self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
                while owners & self.instance_owner_pids():
                    time.sleep(.01)
        except Exception:
            self.temp._finalizer.detach()
            raise
        self.temp.cleanup()

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

    def run_turn(self, player, ident, terminal, text, input_id=''):
        workspace = self.directory / player
        command = self.directory / (player + '-native')
        task = self.directory / (player + '-task.txt')
        log = self.directory / (player + '-native.jsonl')
        task.write_text('Task for ' + player)
        parent_state = None
        if terminal == 'completed':
            parent = self.call('session', player)['parent']
            parent_state = self.call('session', parent)
            reviewer = self.directory / (player + '-completion-review.py')
            reviewer.write_text(
                'import json,subprocess,sys\n'
                + 'prefix=' + repr([str(EXE), str(self.db)]) + '\n'
                + 'parent=' + repr(parent) + '\n'
                + 'worker=' + repr(player) + '\n'
                + 'body=' + repr(text) + '\n'
                + '''def coordinator(*arguments):
    return json.loads(subprocess.check_output([*prefix,*arguments],text=True))
request=sys.argv[-1]
message=coordinator('delivery',request)
assert message['recipient']==parent,message
if message['kind']=='completion-request':
    assert (message['sender'],message['body'])==(worker,body),message
    completion=coordinator('session',worker)['taskCompletion']
    assert completion['coordinator']==parent and completion['requestId']==request,completion
    assignment=coordinator('delivery',completion['assignmentId'])
    assert assignment['recipient']==worker and assignment['receipt'] is not None,assignment
    coordinator('ack',request,parent,'Fixture coordinator reviewed the requested result.')
    coordinator('message',request+':confirmed',parent,worker,'completion-confirmed',request)
''')
            self.call('connect', parent, parent_state['native'],
                      json.dumps([sys.executable, str(reviewer)]))
        failed = 'sys.exit(1)' if terminal == 'failed' else ''
        review = '' if terminal == 'failed' else (
            "prompt=pathlib.Path(sys.argv[sys.argv.index('--prompt-file')+1]).read_text()\n"
            "inputs=re.findall(r'^Message \\([^\\n]*\\) from [^\\n]* \\[id: (.*?)\\]:$',prompt,re.M)\n"
            "if " + repr(input_id) + ": inputs.insert(0," + repr(input_id) + ")\n"
            "for message in dict.fromkeys(inputs):\n"
            "    delivery=json.loads(subprocess.check_output([" + repr(str(EXE)) + ","
            + repr(str(self.db)) + ",'delivery',message],text=True))\n"
            "    assert delivery['recipient']==" + repr(player) + ",delivery\n"
            "    subprocess.run([" + repr(str(EXE)) + "," + repr(str(self.db))
            + ",'ack',message," + repr(player)
            + ",'fixture-native-reviewed'],check=True,stdout=subprocess.DEVNULL)\n"
            "def coordinator(*arguments):\n"
            "    return json.loads(subprocess.check_output([" + repr(str(EXE)) + ","
            + repr(str(self.db)) + ",*arguments],text=True))\n"
            "worker=" + repr(player) + "\n"
            "state=coordinator('session',worker)\n"
            "completion=state['taskCompletion']\n"
            "assert completion['open'],completion\n"
            "assignment=coordinator('delivery',completion['assignmentId'])\n"
            "assert assignment['recipient']==worker and assignment['receipt'] is not None,assignment\n"
            "parent=completion['coordinator']\n"
            "assert parent==state['parent'],state\n"
            "request=" + repr(ident + ':completion-request') + "\n"
            "result_text=" + repr(text) + "\n"
            "coordinator('message',request,worker,parent,'completion-request',result_text)\n"
            "reviewed=coordinator('delivery',request)\n"
            "assert (reviewed['sender'],reviewed['recipient'],reviewed['kind'],reviewed['body'])=="
            "(worker,parent,'completion-request',result_text),reviewed\n"
            "assert reviewed['receipt']=='Fixture coordinator reviewed the requested result.',reviewed\n"
            "confirmation=request+':confirmed'\n"
            "reviewed=coordinator('delivery',confirmation)\n"
            "assert (reviewed['sender'],reviewed['recipient'],reviewed['kind'],reviewed['body'])=="
            "(parent,worker,'completion-confirmed',request),reviewed\n"
            "coordinator('ack',confirmation,worker,'Fixture worker handled coordinator confirmation.')\n"
            "settled=coordinator('session',worker)['taskCompletion']\n"
            "assert settled['assignmentId']==completion['assignmentId'] and settled['requestId']==request "
            "and settled['confirmed'] and not settled['open'],settled\n")
        command.write_text('#!' + sys.executable + '\n' + '''import json,pathlib,re,subprocess,sys
native = 'native-''' + player + ''''
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.model.configured',
  'payload':{'kind':'run_model_configured','model_id':'observed-fixture-model'}}), flush=True)
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user',
  'payload':{'kind':'turn_input_user','command_id':'fixture-primary'}}), flush=True)
''' + review + '''
print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.terminal.''' + terminal + '''',
  'payload':{'kind':'run_terminal','command_id':'fixture-primary','terminal':''' + repr(terminal) + ''','text':''' + repr(text) + '''}}), flush=True)
''' + failed + '\n')
        command.chmod(0o755)
        result = subprocess.run([str(EXE), str(self.db), 'turn', player, ident,
                                 str(command), 'configured-model', 'low', str(workspace),
                                 str(task), str(log), ''], text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        if terminal == 'completed':
            state = self.call('session', player)
            self.assertTrue(state['taskCompletion']['confirmed'], state)
            self.assertFalse(state['taskCompletion']['open'], state)
            self.call('connect', player, state['native'], '')
            self.call('connect', parent_state['id'], parent_state['native'], parent_state['endpoint'])
        return result.stdout

    def changes(self):
        with sqlite3.connect(self.db) as db:
            return db.execute('''SELECT change_id,session_id,entity,entity_id,operation,
                                        kind,summary
                                   FROM native_changes ORDER BY change_id''').fetchall()

    def ui_snapshot(self, reader, subject, knowledge_actor=None):
        node = shutil.which('node')
        self.assertIsNotNone(node, 'Node 22 is required for the Orchestra UI fixture')
        server = ROOT / 'bend2' / 'ui' / 'orchestra' / 'server.mjs'
        process = subprocess.Popen(
            [node, str(server), '--database', str(self.db), '--reader', reader,
             '--subject', subject, '--baton2', str(EXE), '--port', '0'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True)
        try:
            binding = json.loads(process.stdout.readline())
            self.assertEqual(binding['readOnly'], False)
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
            if knowledge_actor:
                with urllib.request.urlopen(url + 'orchestra/knowledge?actor=' + knowledge_actor) as response:
                    self.assertEqual(response.status, 200)
                    return snapshot, json.load(response)
            return snapshot
        finally:
            process.stdin.close()
            process.wait()
            try:
                stderr = process.stderr.read()
                self.assertEqual(process.returncode, 0, stderr)
            finally:
                process.stdout.close()
                process.stderr.close()

    def test_public_findings_and_promotions_publish_scoped_native_changes(self):
        subscribers = []

        def subscribe(cursor, generation):
            process = subprocess.Popen(
                [str(EXE), str(self.db), 'ui-subscribe', str(cursor), str(generation)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            subscribers.append(process)
            line = process.stdout.readline()
            if not line:
                self.fail(process.stderr.read())
            return process, json.loads(line)

        def high_water():
            return self.changes()[-1][0]

        try:
            first, ready = subscribe(high_water(), 0)
            self.assertEqual(int(ready['cursor']), high_water(), ready)

            def committed():
                cursor = high_water()
                _, current = subscribe(cursor, ready['generation'])
                self.assertFalse(current['gap'], current)
                self.assertEqual(int(current['cursor']), cursor, current)
                while True:
                    line = first.stdout.readline()
                    if not line:
                        self.fail(first.stderr.read())
                    notice = json.loads(line)
                    self.assertEqual(notice['kind'], 'commit', notice)
                    self.assertEqual(notice['generation'], ready['generation'], notice)
                    if int(notice['cursor']) >= cursor:
                        self.assertEqual(int(notice['cursor']), cursor, notice)
                        return cursor

            finding = self.call('record', 'worker-finding', 'worker', 'Retained finding.',
                                'Full evidence.', 'Declared limits.')
            self.assertEqual(finding['evidence'], 'Full evidence.')
            recorded = committed()
            knowledge = [row for row in self.changes() if row[2] == 'knowledge']
            self.assertEqual([(row[1], row[3], row[4]) for row in knowledge],
                             [('worker', 'worker-finding', 'insert')])

            self.call('record', 'worker-finding', 'worker', 'Conflicting claim.',
                      'Full evidence.', 'Declared limits.', success=False)
            self.assertEqual(high_water(), recorded)
            _, unchanged = subscribe(recorded, ready['generation'])
            self.assertEqual(int(unchanged['cursor']), recorded, unchanged)

            self.call('promote', 'lead-promotion', 'lead', 'worker', 'lead', 'worker-finding')
            promoted = committed()
            first_promotion = [row for row in self.changes()
                               if recorded < row[0] <= promoted and row[2] == 'promotion']
            self.assertEqual({row[1] for row in first_promotion}, {'worker', 'lead'})
            self.assertTrue(all(row[3:6] == ('worker-finding', 'insert', 'promotion')
                                for row in first_promotion))

            self.call('promote', 'descendant-promotion', 'failed-worker', 'lead',
                      'failed-worker', 'worker-finding')
            continued = committed()
            carried_promotion = [row for row in self.changes()
                                 if promoted < row[0] <= continued and row[2] == 'promotion']
            self.assertEqual({row[1] for row in carried_promotion},
                             {'worker', 'lead', 'failed-worker'})
            snapshot, actor = self.ui_snapshot('lead', 'worker', knowledge_actor='failed-worker')
            visible_promotions = [row for row in snapshot['transitions']
                                  if row['entity'] == 'promotion' and row['seq'] > promoted]
            self.assertEqual({row['session'] for row in visible_promotions},
                             {'worker', 'failed-worker'})
            self.assertEqual(actor['received'][0]['finding'], 'worker-finding')
            self.assertEqual(actor['received'][0]['evidence'], 'Full evidence.')
            self.assertEqual(actor['received'][0]['limits'], 'Declared limits.')
            print('public knowledge native cursor', recorded, promoted, continued, flush=True)
        finally:
            for process in subscribers:
                process.terminate()
                process.wait()
                process.stdout.close()
                process.stderr.close()

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
                      'Worker completed the assigned task.', input_id='task-worker')
        self.assertEqual(self.call('delivery', 'task-worker')['receipt'], 'fixture-native-reviewed')
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
            self.assertEqual(pending_inputs, [])
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
