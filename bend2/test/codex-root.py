"""Integration test for the Bend2 Codex Conductor adapter."""
import json
import os
import pathlib
import shlex
import subprocess
import sys
import tempfile
import time
import unittest

from receive import install_public_queue_codex

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
CODEX_CONDUCTOR_SCRIPT = ROOT / 'bend2/scripts/codex-conductor.mjs'


class CodexRootAdapter(unittest.TestCase):
    """Test the Codex Conductor adapter's report-triggered delivery and message formatting."""

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        install_public_queue_codex(self, self.temp.name)
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.repo.mkdir()
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Codex adapter fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.addCleanup(self.cleanup_fixture)

    def register(self, name, parent, harness, model, effort, workspace=None, branch=None, base=None):
        """Recruit the session into this suite's fixture repository."""
        return self.coord('recruit', name, parent, harness, model, effort, str(self.repo),
                          branch or (name + '-branch'), str(self.checkouts / name), self.base)

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

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *args],
            text=True, capture_output=True,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def observe(self, observation):
        while True:
            value = observation()
            if value is not None:
                return value
            time.sleep(0.05)

    def accepted(self, ident, receipt, missing=False):
        def observation():
            stored = subprocess.run([str(EXE), str(self.db), 'delivery', ident],
                                    text=True, capture_output=True)
            if (missing and stored.returncode == 1 and stored.stdout == ''
                    and stored.stderr == 'No matching session or message; inspect status and the requested ID.\n'):
                return None
            self.assertEqual(stored.returncode, 0, stored.stdout + stored.stderr)
            value = json.loads(stored.stdout)
            if value['receipt'] is None:
                return None
            self.assertEqual(value['receipt'], receipt, value)
            return value
        return self.observe(observation)

    def exited(self, session, status='exit 0'):
        def observation():
            player = next(row for row in json.loads(self.coord('players')) if row['id'] == session)
            execution = player['execution']
            if execution is None:
                return None
            self.assertEqual(execution['mode'], 'retained')
            self.assertIn(execution['phase'], ('starting', 'running', 'exited'))
            if execution['phase'] != 'exited':
                self.assertEqual(execution['status'], '')
                return None
            self.assertEqual(execution['status'], status)
            return execution
        return self.observe(observation)

    def completed(self, session, bodies):
        def observation():
            turns = json.loads(self.coord('turns', session))
            return turns if len(turns) >= len(bodies) else None
        turns = self.observe(observation)
        self.assertEqual([turn['reportBody'] for turn in turns], bodies)
        self.exited(session)
        return turns

    def test_player_terminal_starts_attached_root_without_a_listener(self):
        import time

        def observe(observation):
            while True:
                value = observation()
                if value is not None:
                    return value
                time.sleep(0.05)

        temp = pathlib.Path(self.temp.name)
        received = temp / 'received.txt'
        reviewed = temp / 'completion-reviewed.json'
        report_execution = temp / 'report-root-execution.json'
        request, confirmation = 'finished-completion-request', 'finished-completion-confirmed'
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\n' +
            'import sys,pathlib,subprocess,json\n' +
            'body=sys.stdin.read()\n' +
            f'exe,db={str(EXE)!r},{str(self.db)!r}\n' +
            'def cli(*args):return json.loads(subprocess.check_output([exe,db,*args],text=True))\n' +
            f'if "[id: {request}]" in body:\n' +
            f' value=cli("delivery",{request!r})\n' +
            ' state=cli("session","w1")["taskCompletion"]\n' +
            f' assert value["sender"]=="w1" and value["recipient"]=="root" and value["kind"]=="completion-request" and value["body"]=="Completed live task.",value\n' +
            f' assert state=={{"assignmentId":"finished:task-input","coordinator":"root","requestId":{request!r},"confirmed":False,"open":True}},state\n' +
            ' assert cli("delivery","finished:task-input")["receipt"]=="native-work-accepted"\n' +
            f' pathlib.Path({str(reviewed)!r}).write_text(json.dumps({{"request":value,"completion":state}}))\n' +
            f' cli("ack",{request!r},"root","native-completion-reviewed")\n' +
            f' cli("message",{confirmation!r},"root","w1","completion-confirmed",{request!r})\n' +
            'else:\n' +
            f' pathlib.Path({str(received)!r}).write_text(body)\n' +
            ' execution=next(row for row in cli("players") if row["id"]=="root")["execution"]\n' +
            ' assert execution["mode"]=="retained" and execution["phase"] in ("starting","running"),execution\n' +
            f' pathlib.Path({str(report_execution)!r}).write_text(json.dumps(execution))\n' +
            ' cli("ack","finished","root","native-reviewed")\n' +
            'print(json.dumps({"type":"item.completed","item":{"type":"agent_message","text":"Reviewed."}}))\n' +
            'print(json.dumps({"type":"turn.completed"}))\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--attach'], capture_output=True, text=True)
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(received.exists())
        root_log = json.loads(self.coord('session', 'root'))['endpointArgv'][-1]
        self.register('w1', 'root', 'claude-code', 'model', 'low', str(temp), 'branch', 'base')
        player = temp / 'worker.py'
        player.write_text('#!' + sys.executable + '\n' +
            'import sys,json,subprocess,time\n' +
            'sys.stdin.read()\n' +
            f'exe,db={str(EXE)!r},{str(self.db)!r}\n' +
            'def cli(*args):return json.loads(subprocess.check_output([exe,db,*args],text=True))\n' +
            'def delivery(ident,missing=False):\n' +
            ' while True:\n' +
            '  value=subprocess.run([exe,db,"delivery",ident],text=True,capture_output=True)\n' +
            '  if missing and value.returncode==1 and value.stdout=="" and value.stderr=="No matching session or message; inspect status and the requested ID.\\n":\n' +
            '   time.sleep(0.05)\n' +
            '   continue\n' +
            '  assert value.returncode==0,(value.returncode,value.stdout,value.stderr)\n' +
            '  return json.loads(value.stdout)\n' +
            'cli("ack","finished:task-input","w1","native-work-accepted")\n' +
            f'cli("message",{request!r},"w1","root","completion-request","Completed live task.")\n' +
            'while True:\n' +
            f' value=delivery({request!r})\n' +
            ' assert value["sender"]=="w1" and value["recipient"]=="root" and value["kind"]=="completion-request" and value["body"]=="Completed live task.",value\n' +
            ' if value["receipt"] is not None:\n' +
            '  assert value["receipt"]=="native-completion-reviewed",value\n' +
            '  break\n' +
            ' time.sleep(0.05)\n' +
            f'value=delivery({confirmation!r},missing=True)\n' +
            f'assert value["sender"]=="root" and value["recipient"]=="w1" and value["kind"]=="completion-confirmed" and value["body"]=={request!r},value\n' +
            'assert value["receipt"] is None,value\n' +
            f'cli("ack",{confirmation!r},"w1","native-completion-confirmed")\n' +
            'print(json.dumps({"type":"result","result":"Completed live task."}))\n')
        player.chmod(0o700)
        task = temp / 'task.txt'
        task.write_text('Task')
        self.coord('turn', 'w1', 'finished', str(player), 'model', 'low', str(temp), str(task), str(temp / 'worker.jsonl'), '')
        def report_received():
            value = json.loads(self.coord('delivery', 'finished'))
            self.assertEqual((value['sender'], value['recipient'], value['kind'], value['body']),
                             ('w1', 'root', 'report', 'Completed live task.'))
            if value['receipt'] is None:
                return None
            self.assertEqual(value['receipt'], 'native-reviewed')
            return value
        observe(report_received)
        reported_execution = json.loads(report_execution.read_text())
        def root_exited():
            root = next(row for row in json.loads(self.coord('players')) if row['id'] == 'root')
            execution = root['execution']
            self.assertEqual(execution['attempt'], reported_execution['attempt'])
            self.assertEqual(execution['mode'], 'retained')
            self.assertIn(execution['phase'], ('starting', 'running', 'exited'))
            if execution['phase'] != 'exited':
                self.assertEqual(execution['status'], '')
                return None
            self.assertEqual(execution['status'], 'exit 0')
            return execution
        settled_execution = observe(root_exited)
        self.assertIn('Completed live task.', received.read_text())
        self.assertEqual(json.loads(self.coord('delivery', 'finished'))['receipt'], 'native-reviewed')
        self.assertEqual(json.loads(self.coord('delivery', request))['receipt'], 'native-completion-reviewed')
        self.assertEqual(json.loads(self.coord('delivery', confirmation))['receipt'], 'native-completion-confirmed')
        self.assertEqual(json.loads(self.coord('session', 'w1'))['taskCompletion'], {
            'assignmentId': 'finished:task-input', 'coordinator': 'root',
            'requestId': request, 'confirmed': True, 'open': False})
        self.assertEqual(json.loads(reviewed.read_text())['request']['id'], request)
        self.assertEqual(json.loads(self.coord('inbox', 'w1')), [])
        logs = json.loads(self.coord('logs-storage'))['logs']
        attempt_code = ''.join(
            c if c.isascii() and (c.isalnum() or c in '-_')
            else ('%%%02x' if ord(c) < 256 else '%%%06x') % ord(c)
            for c in settled_execution['attempt'])
        generation = [row for row in logs if row['session'] == 'root'
                      and row['attempt'] == attempt_code]
        self.assertEqual(len(generation), 1, logs)
        self.assertEqual(generation[0]['path'], root_log + '.attempt-' + attempt_code)
        self.assertIn('Reviewed.', pathlib.Path(generation[0]['path']).read_text())

    def test_failed_native_delivery_keeps_the_committed_report_pending(self):
        temp = pathlib.Path(self.temp.name)
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\nimport sys,json\nsys.stdin.read()\nprint(json.dumps({"type":"turn.failed","error":{"message":"provider failed"}}))\nsys.exit(23)\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--attach'], capture_output=True, text=True)
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.register('w1', 'root', 'codex', 'model', 'low', str(temp), 'branch', 'base')
        failed = subprocess.run([str(EXE), str(self.db), 'report', 'failed-delivery', 'w1', 'Retained report'], capture_output=True, text=True)
        self.assertEqual(failed.returncode, 0, failed.stdout + failed.stderr)
        self.exited('root', 'exit 23')
        pending = json.loads(self.coord('inbox', 'root'))
        self.assertEqual(pending[0]['body'], 'Retained report')
        retained = json.loads(self.coord('delivery', 'failed-delivery'))
        self.assertEqual((retained['sender'], retained['recipient'], retained['kind'], retained['body']),
                         ('w1', 'root', 'report', 'Retained report'))
        self.assertIsNone(retained['receipt'])

    def test_attached_session_continues_later_input_and_reattaches_same_native(self):
        temp = pathlib.Path(self.temp.name)
        calls = temp / 'calls.jsonl'
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\nimport sys,pathlib,json,subprocess\n' +
            'body=sys.stdin.read()\n' +
            f'with pathlib.Path({str(calls)!r}).open("a") as f:f.write(json.dumps({{"argv":sys.argv[1:],"prompt":body}})+"\\n")\n' +
            'ident="first" if "[id: first]" in body else ("during-turn" if "[id: during-turn]" in body else "second")\n' +
            'print(\'{"type": "thread.started", "thread_id": "native-root"}\',flush=True)\n' +
            f'subprocess.run({[str(EXE), str(self.db), "ack"]!r}+[ident,"root","reviewed"],check=True,stdout=subprocess.DEVNULL)\n' +
            'if ident=="first":\n' +
            f' subprocess.run({[str(EXE), str(self.db), "report", "during-turn", "sender", "Later report during the live turn."]!r},check=True,stdout=subprocess.DEVNULL)\n' +
            'print(\'{"type": "item.completed", "item": {"type": "agent_message", "text": "Reviewed"}}\')\n' +
            'print(\'{"type":"turn.completed"}\')\n')
        native.chmod(0o700)
        args = ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--attach']
        for message in ['first', 'second']:
            attached = subprocess.run(args, text=True, capture_output=True)
            self.assertEqual(attached.returncode, 0, attached.stderr)
            if message == 'first':
                self.register('sender', 'root', 'fixture', 'model', 'low')
            self.coord('report', message, 'sender', 'Review this message.')
            self.accepted(message, 'reviewed')
            if message == 'first':
                self.accepted('during-turn', 'reviewed', missing=True)
            self.exited('root')
            self.assertEqual(json.loads(self.coord('player', 'root'))['native'], 'native-root')
        observed = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual(len(observed), 3)
        self.assertIn('Later report during the live turn.', observed[1]['prompt'])
        self.assertEqual(json.loads(self.coord('delivery', 'during-turn'))['receipt'], 'reviewed')
        self.assertEqual(json.loads(self.coord('inbox', 'root')), [])
        for call in observed[1:]:
            start = call['argv'].index('exec')
            self.assertEqual(call['argv'][start:start + 3], ['exec', 'resume', 'native-root'])
        self.assertNotIn('--ephemeral', observed[0]['argv'])

    def test_adapter_exits_cleanly_with_no_pending_messages(self):
        """With no root and no messages, the adapter exits 0."""
        p = subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), 'false-codex', '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn('no pending messages', p.stderr)

    def test_associate_selected_identity_workspace_parent_and_subscription(self):
        """A selected Associate resumes, reports to its empty-ID parent and quotes its CLI."""
        self.assert_selected_associate_launch('saved-codex')

    def test_fresh_associate_selected_identity_workspace_parent_and_subscription(self):
        """A selected Associate starts a conversation with its recorded route."""
        self.assert_selected_associate_launch('')

    def assert_selected_associate_launch(self, native_id):
        temp = pathlib.Path(self.temp.name)
        self.db = temp / "state's λ.db"
        associate = "delegated's λ"
        self.coord('attach', '', 'codex', 'parent-native', '')
        self.coord('role', '', 'principal-conductor')
        self.register(associate, '', 'codex', 'stored-model', 'low', branch='associate-branch')
        self.coord('connect', associate, native_id, '')
        self.register('child', associate, 'fixture', 'child-model', 'low')
        calls = temp / 'selected.json'
        native = temp / 'selected.py'
        native.write_text('#!' + sys.executable + '\nimport json,os,pathlib,subprocess,sys\n'
            + f'pathlib.Path({str(calls)!r}).write_text(json.dumps({{"argv":sys.argv[1:],"cwd":os.getcwd(),"prompt":sys.stdin.read(),"api_keys":[k for k in ("OPENAI_API_KEY","CODEX_API_KEY") if k in os.environ]}}))\n'
            + f'subprocess.run({[str(EXE), str(self.db), "ack", "selected-report", associate, "selected-reviewed"]!r},check=True,stdout=subprocess.DEVNULL)\n'
            + 'print(json.dumps({"type":"thread.started","thread_id":"saved-codex"}),flush=True)\n'
            + 'print(json.dumps({"type":"item.completed","item":{"type":"agent_message","text":"Selected Associate reviewed."}}),flush=True)\n'
            + 'print(json.dumps({"type":"turn.completed"}),flush=True)\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE),
                                   str(native), '--session', associate, '--attach'],
                                  text=True, capture_output=True,
                                  env={**os.environ, 'OPENAI_API_KEY': 'fixture-only',
                                       'CODEX_API_KEY': 'fixture-only'})
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(calls.exists())
        reported = subprocess.run([str(EXE), str(self.db), 'report', 'selected-report',
                                   'child', 'Selected child report'], text=True, capture_output=True,
                                  env={**os.environ, 'OPENAI_API_KEY': 'fixture-only',
                                       'CODEX_API_KEY': 'fixture-only'})
        self.assertEqual(reported.returncode, 0, reported.stderr)
        self.accepted('selected-report', 'selected-reviewed')
        self.completed(associate, ['Selected Associate reviewed.'])
        observed = json.loads(calls.read_text())
        expected_prefix = ['exec', 'resume', native_id] if native_id else ['exec', '--json', '--model']
        start = observed['argv'].index('exec')
        self.assertEqual(observed['argv'][start:start + 3], expected_prefix)
        self.assertEqual(observed['argv'][observed['argv'].index('--model') + 1], 'stored-model')
        self.assertIn('forced_login_method="chatgpt"', observed['argv'])
        self.assertEqual([observed['argv'][index + 1]
                          for index, value in enumerate(observed['argv'][:-1])
                          if value == '-c' and observed['argv'][index + 1].startswith('model_reasoning_effort=')],
                         ['model_reasoning_effort="low"'])
        self.assertEqual(observed['api_keys'], [])
        self.assertEqual(observed['cwd'], str(self.checkouts / associate))
        self.assertIn('Associate Conductor', observed['prompt'])
        inbox = next(line.strip() for line in observed['prompt'].splitlines()
                     if ' inbox ' in line and shlex.split(line)[-2:] == ['inbox', associate])
        self.assertEqual(shlex.split(inbox), [str(EXE), str(self.db), 'inbox', associate])
        self.assertEqual(json.loads(self.coord('role', associate))['role'], 'associate-conductor')
        reports = json.loads(self.coord('inbox', ''))
        self.assertEqual([(r['sender'], r['recipient'], r['body']) for r in reports],
                         [(associate, '', 'Selected Associate reviewed.')])
        self.assertEqual(json.loads(self.coord('inbox', associate)), [])

    def test_stored_legacy_entry_and_model_environment_remain_valid(self):
        temp = pathlib.Path(self.temp.name)
        legacy = ROOT / 'bend2/scripts/codex-root.mjs'
        calls = temp / 'legacy.json'
        native = temp / 'legacy.py'
        native.write_text('#!' + sys.executable + '\nimport json,pathlib,subprocess,sys\n'
            + f'pathlib.Path({str(calls)!r}).write_text(json.dumps({{"argv":sys.argv[1:],"prompt":sys.stdin.read()}}))\n'
            + f'subprocess.run({[str(EXE), str(self.db), "ack", "legacy-report", "root", "legacy-reviewed"]!r},check=True,stdout=subprocess.DEVNULL)\n'
            + 'print(json.dumps({"type":"thread.started","thread_id":"saved-native"}),flush=True)\n'
            + 'print(json.dumps({"type":"item.completed","item":{"type":"agent_message","text":"Legacy report reviewed."}}),flush=True)\n'
            + 'print(json.dumps({"type":"turn.completed"}),flush=True)\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(legacy), str(self.db), str(EXE),
                                   str(native), '--attach'], text=True, capture_output=True,
                                  env={**os.environ, 'CODEX_ROOT_MODEL': 'legacy-model'})
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(calls.exists())
        callback = ['/usr/bin/env', 'CODEX_ROOT_MODEL=legacy-model', 'node', str(legacy),
                    str(self.db), str(EXE), str(native), '--session', 'root', '--message']
        self.coord('connect', 'root', 'saved-native', json.dumps(callback))
        self.register('sender', 'root', 'fixture', 'model', 'low')
        self.coord('report', 'legacy-report', 'sender', 'Stored callback input.')
        observed = json.loads(calls.read_text())
        start = observed['argv'].index('exec')
        self.assertEqual(observed['argv'][start:start + 3], ['exec', 'resume', 'saved-native'])
        self.assertIn('Stored callback input.', observed['prompt'])
        self.assertEqual(json.loads(self.coord('delivery', 'legacy-report'))['receipt'], 'legacy-reviewed')
        selected = json.loads(self.coord('player', 'root'))
        endpoint = json.loads(selected['endpoint'])
        self.assertEqual(endpoint[2:4], ['receive', 'root'])
        self.assertEqual(endpoint[5], 'legacy-model')
        self.assertEqual(selected['native'], 'saved-native')
        self.assertEqual(selected['role'], 'principal-conductor')

    def test_adapter_formats_pending_report(self):
        """The adapter detects pending messages and formats them for Codex."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Task completed successfully.')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        stdin_file = self.temp.name + '/stdin.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            '# Mock Codex: read stdin and emit JSON events\n'
            f'cat > {stdin_file}\n'
            'echo \'{"type":"thread.started","thread_id":"mock-thread"}\'\n'
            'echo \'{"type":"turn.started"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Acknowledged"}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True,
        )

        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('1 pending message(s)', p.stderr)

        received = (pathlib.Path(self.temp.name) / 'stdin.txt').read_text()
        self.assertIn('Task completed successfully', received)
        self.assertIn('turn-1', received)
        self.assertIn('w1', received)

    def test_adapter_detects_multiple_messages(self):
        """The adapter formats multiple pending messages in one prompt."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.register('w2', 'root', 'codex', 'model', 'high', '/wt2', 'br2', 'base')
        self.coord('report', 'r1', 'w1', 'First report.')
        self.coord('report', 'r2', 'w2', 'Second report.')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        stdin_file = self.temp.name + '/stdin.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            f'cat > {stdin_file}\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('2 pending message(s)', p.stderr)

        stdin_content = (pathlib.Path(self.temp.name) / 'stdin.txt').read_text()
        self.assertIn('First report', stdin_content)
        self.assertIn('Second report', stdin_content)

    def test_system_instructions_contain_coordinator_commands(self):
        """The instructions piped to Codex include the coordinator CLI."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        stdin_file = self.temp.name + '/stdin.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            f'cat > {stdin_file}\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        stdin_content = (pathlib.Path(self.temp.name) / 'stdin.txt').read_text()
        self.assertIn('baton2', stdin_content)
        self.assertIn('status', stdin_content)
        self.assertIn('players', stdin_content)
        self.assertIn('land', stdin_content)

    def test_adapter_passes_json_and_exec_flags(self):
        """Codex is started with exec --json flags."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        args_file = self.temp.name + '/args.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            f'echo "$@" > {args_file}\n'
            'cat > /dev/null\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True,
        )

        args_text = (pathlib.Path(self.temp.name) / 'args.txt').read_text()
        self.assertIn('exec', args_text)
        self.assertIn('--json', args_text)
        self.assertIn('--dangerously-bypass-approvals-and-sandbox', args_text)

    def test_adapter_extracts_result_text(self):
        """The adapter extracts text from the Codex item.completed event."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        mock_codex.write_text(
            '#!/bin/sh\n'
            'cat > /dev/null\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"Reviewing the report."}}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I have acknowledged the report."}}\'\n'
            'echo \'{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"Tool output"}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertEqual(p.stdout, 'I have acknowledged the report.\n')


class CodexRootEndToEnd(unittest.TestCase):
    """End-to-end: recruit a worker, report, process with Codex root."""

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        install_public_queue_codex(self, self.directory)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.db = self.directory / 'state.db'
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Baton test')
        self.git('config', 'user.email', 'baton@example.invalid')
        self.git('commit', '-q', '--allow-empty', '-m', 'initial')
        self.base = self.git('rev-parse', 'HEAD').strip()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ['git', '-C', str(self.repo), *args],
            check=True, text=True, capture_output=True,
        ).stdout

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *map(str, args)],
            text=True, capture_output=True,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def test_recruit_report_codex_root_processes(self):
        """Full cycle: recruit worker, worker reports, Codex root processes."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.coord('recruit', 'w1', 'root', 'codex', 'model', 'high',
                   self.repo, 'w1-branch', 'wt', self.base)

        wt = self.repo / 'wt'
        (wt / 'feature.txt').write_text('codex root delivered')
        subprocess.run(['git', '-C', str(wt), 'add', 'feature.txt'],
                       check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'commit', '-q', '-m', 'worker feature'],
                       check=True, capture_output=True)
        player_commit = self.git('rev-parse', 'w1-branch').strip()

        self.coord('report', 'turn-1', 'w1',
                   'Feature implemented. Committed feature.txt on w1-branch.')

        mock_codex = self.directory / 'mock-codex-land.sh'
        mock_codex.write_text(
            '#!/bin/sh\n'
            'cat > /dev/null\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"turn.started"}\'\n'
            f'{EXE} {self.db} ack turn-1 root codex-root-ack\n'
            f'{EXE} {self.db} land w1 {self.repo} main\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Acknowledged and landed."}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_CONDUCTOR_SCRIPT), str(self.db), str(EXE),
             str(mock_codex), '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        inbox = json.loads(self.coord('inbox', 'root'))
        self.assertEqual(len(inbox), 0, 'Root inbox should be empty after ack')

        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, player_commit)


if __name__ == '__main__':
    unittest.main()
