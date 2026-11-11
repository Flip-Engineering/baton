"""Integration test for the Bend2 OMP Conductor adapter."""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
OMP_CONDUCTOR_SCRIPT = ROOT / 'bend2/scripts/omp-conductor.mjs'
OMP_EXE = pathlib.Path('/opt/homebrew/bin/omp')

RPC_INPUT = (
    'filter_request=json.loads(sys.stdin.readline())\n'
    'state_request=json.loads(sys.stdin.readline())\n'
    'prompt=json.loads(sys.stdin.readline())["message"]\n'
    'print(json.dumps({"type":"response","command":"get_state","success":True,"id":state_request["id"],'
    '"data":{"sessionId":native_id,"model":{"provider":"fixture","id":sys.argv[sys.argv.index("--model")+1]}}}),flush=True)\n'
)


class OmpRootAdapter(unittest.TestCase):
    """Test the OMP Conductor adapter's report-triggered delivery and message formatting."""

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.addCleanup(self.cleanup_fixture)
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.repo.mkdir()
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'OMP adapter fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()

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
        try:
            observation = getattr(self, '_cleanup_observation', None)
            if observation is not None:
                recorded = {'argv': ['ps', '-axo', 'pid=,ppid=,stat=,command='],
                            'returncode': processes.returncode, 'stdout': processes.stdout,
                            'stderr': processes.stderr, 'expectedOwnerArgv': expected,
                            'matchedOwnerIds': sorted(owners)}
                observation.setdefault('ordinaryPsInitial', recorded)
                observation['ordinaryPsLast'] = recorded
                observation['ordinaryPsCalls'] = observation.get('ordinaryPsCalls', 0) + 1
        except BaseException:
            pass
        return owners

    def delivery_pids(self):
        prefixes = (f'{EXE.resolve()} --dispatch-message {self.db.resolve()} ',
                    f'{EXE.resolve()} {self.db.resolve()} receive ')
        processes = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                   check=True, capture_output=True, text=True)
        deliveries = set()
        for line in processes.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if (len(fields) == 4 and not fields[2].startswith('Z')
                    and any(fields[3].startswith(prefix) for prefix in prefixes)):
                deliveries.add(int(fields[0]))
        try:
            observation = getattr(self, '_cleanup_observation', None)
            if observation is not None:
                recorded = {'argv': ['ps', '-axo', 'pid=,ppid=,stat=,command='],
                            'returncode': processes.returncode, 'stdout': processes.stdout,
                            'stderr': processes.stderr, 'expectedDeliveryPrefixes': list(prefixes),
                            'matchedDeliveryIds': sorted(deliveries)}
                observation.setdefault('deliveryPsInitial', recorded)
                observation['deliveryPsLast'] = recorded
                observation['deliveryPsCalls'] = observation.get('deliveryPsCalls', 0) + 1
        except BaseException:
            pass
        return deliveries

    def cleanup_ps(self, wide):
        argv = ['ps', *(['-ww'] if wide else []), '-axo', 'pid=,ppid=,stat=,command=']
        result = subprocess.run(argv, capture_output=True, text=True)
        expected = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        matches = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if len(fields) == 4 and fields[3] == expected and not fields[2].startswith('Z'):
                matches.append(int(fields[0]))
        return {'argv': argv, 'returncode': result.returncode, 'stdout': result.stdout,
                'stderr': result.stderr, 'expectedOwnerArgv': expected,
                'matchedOwnerIds': sorted(matches)}

    def cleanup_entries(self):
        root = pathlib.Path(self.temp.name)
        rows = []
        def add(path):
            row = {'path': str(path.relative_to(root)) if path != root else '.'}
            try:
                info = path.lstat()
                row.update(mode=info.st_mode, uid=info.st_uid, device=info.st_dev,
                           inode=info.st_ino, size=info.st_size, mtimeNs=info.st_mtime_ns)
            except OSError as error:
                row['error'] = repr(error)
            rows.append(row)
        add(root)
        for directory, subdirs, files in os.walk(root, followlinks=False,
                onerror=lambda error: rows.append({'walkError': repr(error)})):
            for name in sorted(subdirs + files):
                add(pathlib.Path(directory) / name)
        return rows

    def cleanup_related_fds(self):
        root = self.temp.name
        related = []
        if not os.path.isdir('/proc'):
            return related
        for entry in os.scandir('/proc'):
            if not entry.name.isdigit():
                continue
            proc = pathlib.Path(entry.path)
            found = []
            try:
                cwd = os.readlink(proc / 'cwd')
                if cwd == root or cwd.startswith(root + '/'):
                    found.append({'fd': 'cwd', 'target': cwd})
            except OSError:
                pass
            try:
                for fd in os.scandir(proc / 'fd'):
                    try:
                        target = os.readlink(fd.path)
                        if target == root or target.startswith(root + '/'):
                            found.append({'fd': fd.name, 'target': target})
                    except OSError:
                        pass
            except OSError:
                pass
            if found:
                try:
                    argv = (proc / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
                    command = [arg.decode('utf-8', 'replace') for arg in argv]
                except OSError as error:
                    command = [repr(error)]
                related.append({'pid': int(entry.name), 'argv': command, 'links': found})
        return related

    def cleanup_failure_observe(self, error):
        try:
            observation = self._cleanup_observation
            observation['cleanupError'] = repr(error)
            observation['beforeDirectoryEntries'] = 'unavailable'
            observation['timeNs'] = time.time_ns()
            for key, collect in (('ordinaryPsAfterFailure', lambda: self.cleanup_ps(False)),
                                 ('widePsAfterFailure', lambda: self.cleanup_ps(True)),
                                 ('remainingEntries', self.cleanup_entries),
                                 ('relatedFdsAfterFailure', self.cleanup_related_fds)):
                try:
                    observation[key] = collect()
                except BaseException as diagnostic_error:
                    observation[key + 'Error'] = repr(diagnostic_error)
            try:
                sys.stderr.write('OMP_CLEANUP_OBSERVATION '
                                 + json.dumps(observation, ensure_ascii=False) + '\n')
                sys.stderr.flush()
            except BaseException:
                pass
        except BaseException:
            pass

    def shutdown_instance_owner(self):
        while self.delivery_pids():
            time.sleep(.01)
        owners = self.instance_owner_pids()
        stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                 capture_output=True, text=True)
        try:
            self._cleanup_observation['shutdown'] = {
                'argv': [str(EXE), '--instance-shutdown', str(self.db)],
                'returncode': stopped.returncode, 'stdout': stopped.stdout,
                'stderr': stopped.stderr}
        except BaseException:
            pass
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        while owners & self.instance_owner_pids():
            time.sleep(.01)

    def cleanup_fixture(self):
        self.temp._finalizer.detach()
        try:
            self._cleanup_observation = {'test': self.id(), 'directory': self.temp.name,
                                         'database': str(self.db)}
        except BaseException:
            self._cleanup_observation = None
        try:
            if self.db.exists():
                self.shutdown_instance_owner()
            self.temp.cleanup()
        except BaseException as error:
            self.cleanup_failure_observe(error)
            raise

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *args],
            text=True, capture_output=True,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

    def eventually(self, observation):
        while True:
            result = observation()
            if result:
                return result
            time.sleep(0.05)

    def accepted(self, ident, receipt):
        def observation():
            stored = subprocess.run([str(EXE), str(self.db), 'delivery', ident],
                                    text=True, capture_output=True)
            if (stored.returncode == 1 and stored.stdout == ''
                    and stored.stderr == 'No matching session or message; inspect status and the requested ID.\n'):
                return None
            self.assertEqual(stored.returncode, 0, stored.stderr)
            return json.loads(stored.stdout)['receipt']
        observed = self.eventually(observation)
        self.assertEqual(observed, receipt)

    def exited(self, session, status='exit 0'):
        def observation():
            player = next(row for row in json.loads(self.coord('players')) if row['id'] == session)
            execution = player['execution']
            return execution if execution and execution['phase'] == 'exited' else None
        execution = self.eventually(observation)
        self.assertEqual(execution['status'], status)
        return execution

    def completed(self, session, bodies):
        def observation():
            turns = json.loads(self.coord('turns', session))
            return turns if len(turns) >= len(bodies) else None
        turns = self.eventually(observation)
        self.assertEqual([turn['reportBody'] for turn in turns], bodies)
        self.exited(session)
        return turns

    def test_player_report_wakes_lead_and_lead_report_wakes_root(self):
        temp = pathlib.Path(self.temp.name)
        root_calls = temp / 'root.jsonl'
        root_endpoint = temp / 'root.py'
        root_endpoint.write_text(
            'import sys,json,subprocess,pathlib\n'
            f'cmd={ [str(EXE), str(self.db)]!r}\n'
            'row=json.loads(subprocess.check_output(cmd+["delivery",sys.argv[-1]],text=True))\n'
            f'with pathlib.Path({str(root_calls)!r}).open("a") as f: f.write(json.dumps(row)+"\\n")\n'
            'subprocess.run(cmd+["ack",row["id"],"root","root reviewed lead"],check=True)\n')
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([sys.executable, str(root_endpoint)]))
        self.register('lead', 'root', 'omp', 'lead-model', 'low', str(temp), 'lead-branch', 'base')
        self.register('child', 'lead', 'omp', 'worker-model', 'low', str(temp), 'child-branch', 'base')
        native = temp / 'lead.py'
        calls = temp / 'lead.jsonl'
        native.write_text(
            '#!' + sys.executable + '\nimport json,sys,pathlib,subprocess,os\n'
            f'cmd={ [str(EXE), str(self.db)]!r}\n'
            'native_id="native-lead"\n' + RPC_INPUT +
            'ident="first" if "[id: first]" in prompt else "second"\n' +
            f'with pathlib.Path({str(calls)!r}).open("a") as f: f.write(json.dumps({{"args":sys.argv[1:],"cwd":os.getcwd(),"prompt":prompt}})+"\\n")\n' +
            'print(json.dumps({"type":"session","id":"native-lead"}),flush=True)\n'
            'subprocess.run(cmd+["ack",ident,"lead","lead reviewed child"],check=True,stdout=subprocess.DEVNULL)\n'
            'print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Reviewed and landed "+ident}]}}),flush=True)\n'
            'print(json.dumps({"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"Reviewed and landed "+ident}]}],"isTerminal":True}),flush=True)\n'
            'sys.stdin.read()\n')
        native.chmod(0o700)
        args = ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--session', 'lead', '--attach']
        for number, ident in enumerate(['first', 'second'], 1):
            attached = subprocess.run(args, text=True, capture_output=True)
            self.assertEqual(attached.returncode, 0, attached.stderr)
            self.coord('report', ident, 'child', 'Child completed ' + ident)
            self.accepted(ident, 'lead reviewed child')
            turns = self.completed('lead', ['Reviewed and landed ' + item
                                           for item in ['first', 'second'][:number]])
            self.accepted(turns[-1]['id'], 'root reviewed lead')
        lead = json.loads(self.coord('player', 'lead'))
        root = json.loads(self.coord('player', 'root'))
        self.assertEqual((lead['parent'], lead['branch'], lead['base'], lead['workspace']),
                         ('root', 'lead-branch', self.base, str(self.checkouts / 'lead')))
        self.assertEqual(lead['native'], 'native-lead')
        self.assertEqual(lead['role'], 'associate-conductor')
        self.assertEqual(root['native'], 'native-root')
        native_calls = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual(len(native_calls), 2)
        self.assertEqual(native_calls[0]['cwd'], str(self.checkouts / 'lead'))
        prompt = native_calls[0]['prompt']
        self.assertIn('You are session lead in a Baton Orchestra.', prompt)
        self.assertIn('Read complete owed input with inbox.', prompt)
        self.assertIn('Use acknowledge after handling', prompt)
        self.assertEqual(native_calls[1]['args'][native_calls[1]['args'].index('--resume') + 1], 'native-lead')
        reports = [json.loads(line) for line in root_calls.read_text().splitlines()]
        self.assertEqual([r['body'] for r in reports], ['Reviewed and landed first', 'Reviewed and landed second'])
        self.assertTrue(all(r['sender'] == 'lead' and r['recipient'] == 'root' for r in reports))
        self.coord('report', 'second', 'child', 'Child completed second')
        self.assertEqual(len(root_calls.read_text().splitlines()), 2)

    def test_selected_associate_with_empty_parent_quotes_commands(self):
        temp = pathlib.Path(self.temp.name)
        self.db = temp / "state's λ.db"
        associate = "delegated's λ"
        self.coord('attach', '', 'codex', 'parent-native',
                   json.dumps([sys.executable, '-c', 'pass']))
        self.coord('role', '', 'principal-conductor')
        self.register(associate, '', 'omp', 'stored-model', 'low', branch='associate-branch')
        self.coord('connect', associate, 'saved-omp', '')
        self.register('child', associate, 'fixture', 'child-model', 'low')
        calls = temp / 'selected.json'
        native = temp / 'selected.py'
        native.write_text('#!' + sys.executable + '\nimport json,os,pathlib,subprocess,sys\n'
            + 'native_id="saved-omp"\n' + RPC_INPUT
            + f'pathlib.Path({str(calls)!r}).write_text(json.dumps({{"argv":sys.argv[1:],"cwd":os.getcwd(),"prompt":prompt}}))\n'
            + f'subprocess.run({[str(EXE), str(self.db), "ack", "selected-report", associate, "selected-reviewed"]!r},check=True,stdout=subprocess.DEVNULL)\n'
            + 'print(json.dumps({"type":"session","id":"saved-omp"}),flush=True)\n'
            + 'print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Selected Associate reviewed."}]}}),flush=True)\n'
            + 'print(json.dumps({"type":"agent_end","isTerminal":True,"messages":[{"role":"assistant","content":[{"type":"text","text":"Selected Associate reviewed."}]}]}),flush=True)\n'
            + 'sys.stdin.read()\n')
        native.chmod(0o700)
        legacy = ROOT / 'bend2/scripts/omp-root.mjs'
        attached = subprocess.run(['node', str(legacy), str(self.db), str(EXE), str(native),
                                   '--session', associate, '--attach'], text=True, capture_output=True,
                                  env={**os.environ, 'OMP_ROOT_MODEL': 'legacy-model',
                                       'OMP_ROOT_THINKING': 'low'})
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(calls.exists())
        self.coord('report', 'selected-report', 'child', 'Selected child report')
        self.accepted('selected-report', 'selected-reviewed')
        self.completed(associate, ['Selected Associate reviewed.'])
        observed = json.loads(calls.read_text())
        self.assertEqual(observed['cwd'], str(self.checkouts / associate))
        argv = observed['argv']
        self.assertEqual(argv[argv.index('--resume') + 1], 'saved-omp')
        self.assertEqual(argv[argv.index('--model') + 1], 'legacy-model')
        prompt = observed['prompt']
        self.assertIn('You are session ' + associate + ' in a Baton Orchestra.', prompt)
        prefix = 'Coordinator executable/database argv: '
        coordinator = next(line[len(prefix):] for line in prompt.splitlines()
                           if line.startswith(prefix))
        self.assertEqual(json.loads(coordinator), [str(EXE), str(self.db)])
        self.assertIn('Read complete owed input with inbox.', prompt)
        self.assertIn('Use acknowledge after handling', prompt)
        selected = json.loads(self.coord('player', associate))
        self.assertEqual(selected['role'], 'associate-conductor')
        self.assertEqual(json.loads(selected['endpoint'])[2:4], ['receive', associate])
        reports = json.loads(self.coord('inbox', ''))
        self.assertEqual([(r['sender'], r['recipient'], r['body']) for r in reports],
                         [(associate, '', 'Selected Associate reviewed.')])

    def test_failed_lead_turn_reports_to_parent_and_keeps_child_report(self):
        temp = pathlib.Path(self.temp.name)
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([sys.executable, '-c', 'pass']))
        self.register('lead', 'root', 'omp', 'lead-model', 'low', str(temp), 'lead-branch', 'base')
        self.register('child', 'lead', 'omp', 'worker-model', 'low', str(temp), 'child-branch', 'base')
        native = temp / 'failure.sh'
        native.write_text('#!/bin/sh\nexit 23\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native),
                                  '--session', 'lead', '--attach'], text=True, capture_output=True)
        self.assertEqual(attached.returncode, 0, attached.stderr)
        failed = subprocess.run([str(EXE), str(self.db), 'report', 'child-done', 'child', 'Work retained'],
                                text=True, capture_output=True)
        self.assertEqual(failed.returncode, 0, failed.stderr)
        execution = self.exited('lead', 'exit 23')
        reports = self.eventually(
            lambda: rows if len(rows := json.loads(self.coord('inbox', 'root'))) >= 2 else None)
        self.assertIsNone(json.loads(self.coord('delivery', 'child-done'))['receipt'])
        self.assertEqual([row['id'] for row in reports],
                         [execution['attempt'], execution['attempt'] + ':exit'])
        reports = [json.loads(self.coord('delivery', row['id'])) for row in reports]
        self.assertTrue(all((row['sender'], row['recipient'], row['kind']) == ('lead', 'root', 'report')
                            and row['receipt'] is None for row in reports))
        self.assertTrue(reports[0]['body'].startswith('Player process ended without a native result (exit 23).'))
        self.assertIn('23', reports[0]['body'])
        self.assertEqual(reports[1]['body'], 'Player process ended with exit 23')

    def test_report_file_migrates_stored_callback_to_native_receive(self):
        temp = pathlib.Path(self.temp.name)
        conductor = 'main-conductor'
        received = temp / 'received.txt'
        argv_file = temp / 'received-argv.json'
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\n' +
            'import sys,pathlib,subprocess,json\n' +
            'native_id="native-root"\n' + RPC_INPUT +
            f'pathlib.Path({str(received)!r}).write_text(prompt)\n' +
            f'pathlib.Path({str(argv_file)!r}).write_text(json.dumps(sys.argv[1:]))\n' +
            f'subprocess.run({[str(EXE), str(self.db), "ack", "finished", conductor, "native-reviewed"]!r},check=True,stdout=subprocess.DEVNULL)\n' +
            'print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Reviewed."}]}}))\n' +
            'print(json.dumps({"type":"agent_end","isTerminal":True,"messages":[{"role":"assistant","content":[{"type":"text","text":"Reviewed."}]}]}),flush=True)\n' +
            'sys.stdin.read()\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE),
                                   str(native), '--session', conductor, '--attach'], capture_output=True, text=True)
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(received.exists())
        legacy = ROOT / 'bend2/scripts/omp-root.mjs'
        legacy_store = pathlib.Path(str(self.db) + '.session-' + conductor.encode().hex())
        legacy_store.mkdir()
        conversation = legacy_store / '2026_native-root.jsonl'
        conversation.write_text(json.dumps({'type': 'session', 'id': 'native-root'}) + '\n')
        callback = ['/usr/bin/env', 'OMP_ROOT_MODEL=legacy-model', 'OMP_ROOT_THINKING=low',
                    'node', str(legacy), str(self.db), str(EXE), str(native),
                    '--session', conductor, '--message']
        self.coord('connect', conductor, 'native-root', json.dumps(callback))
        self.register('w1', conductor, 'omp', 'model', 'low', str(temp), 'branch', 'base')
        report = temp / 'report.txt'
        report.write_text('Completed task with full report.')
        self.coord('report', 'finished', 'w1', report.read_text())
        self.accepted('finished', 'native-reviewed')
        self.exited(conductor)
        self.assertIn(report.read_text(), received.read_text())
        self.assertEqual(json.loads(self.coord('delivery', 'finished'))['receipt'], 'native-reviewed')
        selected = json.loads(self.coord('player', conductor))
        endpoint = json.loads(selected['endpoint'])
        self.assertEqual(endpoint[2:4], ['receive', conductor])
        self.assertEqual(endpoint[5:7], ['legacy-model', 'low'])
        self.assertEqual(selected['native'], 'native-root')
        self.assertIsNone(selected['parent'])
        observed_argv = json.loads(argv_file.read_text())
        self.assertEqual(observed_argv[observed_argv.index('--resume') + 1], str(conversation))

    def test_attached_session_continues_later_input_and_reattaches_same_native(self):
        temp = pathlib.Path(self.temp.name)
        calls = temp / 'calls.jsonl'
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\nimport sys,pathlib,json,subprocess\n' +
            'native_id="native-root"\n' + RPC_INPUT +
            'body=prompt\n' +
            f'with pathlib.Path({str(calls)!r}).open("a") as f:f.write(json.dumps({{"argv":sys.argv[1:],"prompt":body}})+"\\n")\n' +
            'ident="first" if "[id: first]" in body else ("during-turn" if "[id: during-turn]" in body else "second")\n' +
            'print(\'{"type": "session", "id": "native-root"}\',flush=True)\n' +
            f'subprocess.run({[str(EXE), str(self.db), "ack"]!r}+[ident,"root","reviewed"],check=True,stdout=subprocess.DEVNULL)\n' +
            'if ident=="first":\n' +
            f' subprocess.run({[str(EXE), str(self.db), "report", "during-turn", "sender", "Later report during the live turn."]!r},check=True,stdout=subprocess.DEVNULL)\n' +
            'print(\'{"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "Reviewed"}]}}\')\n' +
            'print(\'{"type":"agent_end","isTerminal":true,"messages":[{"role":"assistant","content":[{"type":"text","text":"Reviewed"}]}]}\',flush=True)\n' +
            'sys.stdin.read()\n')
        native.chmod(0o700)
        args = ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--attach']
        for message in ['first', 'second']:
            attached = subprocess.run(args, text=True, capture_output=True)
            self.assertEqual(attached.returncode, 0, attached.stderr)
            if message == 'first':
                self.register('sender', 'root', 'fixture', 'model', 'low')
            self.coord('report', message, 'sender', 'Review this message.')
            self.accepted(message, 'reviewed')
            if message == 'first':
                self.accepted('during-turn', 'reviewed')
            self.exited('root')
            self.assertEqual(len(calls.read_text().splitlines()), 2 if message == 'first' else 3)
            self.assertEqual(json.loads(self.coord('player', 'root'))['native'], 'native-root')
        observed = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual(len(observed), 3)
        self.assertIn('Later report during the live turn.', observed[1]['prompt'])
        self.assertEqual(json.loads(self.coord('delivery', 'during-turn'))['receipt'], 'reviewed')
        self.assertEqual(json.loads(self.coord('inbox', 'root')), [])
        for call in observed[1:]:
            self.assertEqual(call['argv'][call['argv'].index('--resume') + 1], 'native-root')
        self.assertNotIn('--no-session', observed[0]['argv'])

    def test_adapter_exits_cleanly_with_no_pending_messages(self):
        """With no root and no messages, the adapter exits 0."""
        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(OMP_EXE), '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn('no pending messages', p.stderr)

    def once_client(self, text='Acknowledged', failed=False):
        native = pathlib.Path(self.temp.name) / 'once-omp.py'
        observed = pathlib.Path(self.temp.name) / 'once-observed.json'
        native.write_text('#!' + sys.executable + '\nimport json,os,pathlib,sys\n'
            + 'native_id="mock-session"\n' + RPC_INPUT
            + f'pathlib.Path({str(observed)!r}).write_text(json.dumps({{"argv":sys.argv[1:],"cwd":os.getcwd(),"prompt":prompt}}))\n'
            + f'message={{"role":"assistant","content":[{{"type":"text","text":{text!r}}}]}}\n'
            + ('message.update(stopReason="error",errorMessage="Fixture provider failure.")\n' if failed else '')
            + 'print(json.dumps({"type":"message_end","message":message}),flush=True)\n'
            + 'print(json.dumps({"type":"turn_end","message":message}),flush=True)\n'
            + 'print(json.dumps({"type":"agent_end"}),flush=True)\n'
            + ('sys.exit(9)\n' if failed else ''))
        native.chmod(0o700)
        return native, observed

    def once(self, native):
        return subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--once'],
            text=True, capture_output=True)

    def assert_seeded_input(self, observed):
        with sqlite3.connect(self.db) as connection:
            row = connection.execute(
                'SELECT n.seed,n.instruction,n.guidance,e.directory,e.id,e.phase '
                'FROM native_initial_inputs n JOIN executions e '
                'ON e.session=n.session AND e.id=n.turn AND e.directory=n.attempt '
                'WHERE n.session=?', ('root',)).fetchone()
        self.assertIsNotNone(row)
        seed, instruction, guidance, directory, turn, phase = row
        self.assertRegex(seed, r'^[0-9a-f]{128}$')
        self.assertEqual(observed['prompt'], seed + '\n\n' + instruction + '\n\n' + guidance)
        self.assertIn('Ideate briefly', instruction)
        self.assertEqual(phase, 'exited')
        self.assertEqual((pathlib.Path(directory) / 'prompt.txt').read_text(), observed['prompt'])
        self.assertEqual(json.loads(self.coord('player', 'root'))['endpoint'], 'root-endpoint')
        return guidance

    def test_adapter_formats_pending_report(self):
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        body = 'Task completed successfully. café λ🙂\nComplete report.\n'
        self.coord('report', 'turn-1', 'w1', body)
        native, observed_path = self.once_client()
        p = self.once(native)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('1 pending message(s)', p.stderr)
        observed = json.loads(observed_path.read_text())
        self.assertIn(body, self.assert_seeded_input(observed))
        self.assertIn('turn-1', observed['prompt'])
        self.assertIn('w1', observed['prompt'])
        self.assertEqual(p.stdout, 'Acknowledged\n')

    def test_once_selected_associate_reports_through_retained_turn(self):
        self.coord('attach', 'root', 'omp', 'parent-native', '')
        self.coord('role', 'root', 'principal-conductor')
        self.register('lead', 'root', 'omp', 'stored-model', 'low')
        self.coord('connect', 'lead', 'mock-session', '')
        self.register('child', 'lead', 'fixture', 'model', 'low')
        self.coord('report', 'child-report', 'child', 'Complete child evidence. café λ🙂')
        native, observed_path = self.once_client('Full Associate result. λ🙂')
        p = subprocess.run(['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE),
                            str(native), '--session', 'lead', '--once'],
                           capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, 'Full Associate result. λ🙂\n')
        observed = json.loads(observed_path.read_text())
        self.assertEqual(observed['cwd'], str(self.checkouts / 'lead'))
        argv = observed['argv']
        self.assertEqual(argv[argv.index('--model') + 1], 'stored-model')
        self.assertEqual(argv[argv.index('--thinking') + 1], 'low')
        self.assertEqual(argv[argv.index('--resume') + 1], 'mock-session')
        reports = json.loads(self.coord('inbox', 'root'))
        self.assertEqual([(row['sender'], row['body']) for row in reports],
                         [('lead', 'Full Associate result. λ🙂')])
        with sqlite3.connect(self.db) as connection:
            report_id, worker = connection.execute(
                'SELECT t.id,t.worker FROM turns t WHERE t.id=?', (reports[0]['id'],)).fetchone()
            attempt, phase = connection.execute(
                'SELECT id,phase FROM executions WHERE session=?', ('lead',)).fetchone()
        self.assertEqual((report_id, worker, phase), (attempt, 'lead', 'exited'))
        lead = json.loads(self.coord('player', 'lead'))
        self.assertEqual((lead['native'], lead['endpoint']), ('mock-session', ''))

    def test_once_retains_provider_failure_and_pending_input(self):
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high')
        self.coord('report', 'r1', 'w1', 'Keep this complete input pending on failure.')
        native, _ = self.once_client('Fixture provider failure. λ🙂', failed=True)
        p = self.once(native)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('Fixture provider failure. λ🙂', p.stdout)
        self.assertIsNone(json.loads(self.coord('delivery', 'r1'))['receipt'])
        with sqlite3.connect(self.db) as connection:
            status, directory = connection.execute(
                'SELECT status,directory FROM executions WHERE session=?', ('root',)).fetchone()
        self.assertIn('9', status)
        self.assertIn('Fixture provider failure.', (pathlib.Path(directory) / 'stdout').read_text())

    def test_adapter_detects_multiple_messages(self):
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        for player, ident, body in [('w1', 'r1', 'First report.'), ('w2', 'r2', 'Second report.')]:
            self.register(player, 'root', 'omp', 'model', 'high')
            self.coord('report', ident, player, body)
        native, observed_path = self.once_client()
        p = self.once(native)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('2 pending message(s)', p.stderr)
        prompt = json.loads(observed_path.read_text())['prompt']
        self.assertIn('First report.', prompt)
        self.assertIn('Second report.', prompt)

    def test_system_prompt_contains_coordinator_commands(self):
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high')
        self.coord('report', 'r1', 'w1', 'done')
        native, observed_path = self.once_client()
        p = self.once(native)
        self.assertEqual(p.returncode, 0, p.stderr)
        observed = json.loads(observed_path.read_text())
        for action in ['acknowledge', 'completion-request --text', 'dispatch --to',
                       'knowledge record --kind', 'players', 'land --session']:
            self.assertIn(action, observed['prompt'])
        self.assertNotIn('ack ID', observed['prompt'])
        self.assertNotIn('--system-prompt', observed['argv'])

    def test_adapter_passes_rpc_mode(self):
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high')
        self.coord('report', 'r1', 'w1', 'done')
        native, observed_path = self.once_client()
        p = self.once(native)
        self.assertEqual(p.returncode, 0, p.stderr)
        argv = json.loads(observed_path.read_text())['argv']
        self.assertEqual(argv[argv.index('--mode') + 1], 'rpc')
        self.assertEqual(argv[argv.index('--approval-mode') + 1], 'yolo')
        self.assertEqual(argv[argv.index('--resume') + 1], 'root-session')
        self.assertEqual(argv[argv.index('--session-dir') + 1], str(self.db) + '.root-sessions')

    def test_adapter_extracts_result_text(self):
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high')
        self.coord('report', 'r1', 'w1', 'done')
        text = 'I have acknowledged the report. café λ🙂\nFull result.\n'
        native, _ = self.once_client(text)
        p = self.once(native)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, text + '\n')


class OmpRootEndToEnd(unittest.TestCase):
    """End-to-end: recruit a worker, report, process with OMP root."""

    instance_owner_pids = OmpRootAdapter.instance_owner_pids
    delivery_pids = OmpRootAdapter.delivery_pids
    cleanup_ps = OmpRootAdapter.cleanup_ps
    cleanup_entries = OmpRootAdapter.cleanup_entries
    cleanup_related_fds = OmpRootAdapter.cleanup_related_fds
    cleanup_failure_observe = OmpRootAdapter.cleanup_failure_observe
    shutdown_instance_owner = OmpRootAdapter.shutdown_instance_owner
    cleanup_fixture = OmpRootAdapter.cleanup_fixture

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.addCleanup(self.cleanup_fixture)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.name', 'Baton test')
        self.git('config', 'user.email', 'baton@example.invalid')
        self.git('commit', '-q', '--allow-empty', '-m', 'initial')
        self.base = self.git('rev-parse', 'HEAD').strip()

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

    def test_recruit_report_omp_root_processes(self):
        """Full cycle: recruit worker, worker reports, OMP root processes."""
        # 1. Attach root (OMP harness) and recruit a worker.
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.coord('recruit', 'w1', 'root', 'omp', 'model', 'high',
                   self.repo, 'w1-branch', 'wt', self.base)

        # 2. Worker makes a commit.
        wt = self.repo / 'wt'
        (wt / 'feature.txt').write_text('omp root delivered')
        subprocess.run(['git', '-C', str(wt), 'add', 'feature.txt'],
                       check=True, capture_output=True)
        subprocess.run(['git', '-C', str(wt), 'commit', '-q', '-m', 'worker feature'],
                       check=True, capture_output=True)
        player_commit = self.git('rev-parse', 'w1-branch').strip()

        # 3. Player reports.
        self.coord('report', 'turn-1', 'w1',
                   'Feature implemented. Committed feature.txt on w1-branch.')

        # 4. Mock OMP root: acknowledges the report and lands the change.
        mock_omp = self.directory / 'mock-omp-land.sh'
        mock_omp.write_text(
            '#!/bin/sh\n'
            'IFS= read -r filter_request\n'
            'IFS= read -r state_request\n'
            'IFS= read -r prompt_request\n'
            '# Simulate OMP root: ack the report and land the worker\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_start"}\'\n'
            # Simulate bash tool calls that ack and land
            f'{EXE} {self.db} ack turn-1 root omp-root-ack\n'
            f'{EXE} {self.db} land w1 {self.repo} main\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"Acknowledged and landed."}]}}\'\n'
            'echo \'{"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"Acknowledged and landed."}]}]}\'\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE),
             str(mock_omp), '--once'],
            text=True, capture_output=True,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        # 5. Verify the message was acknowledged.
        inbox = json.loads(self.coord('inbox', 'root'))
        self.assertEqual(len(inbox), 0, 'Root inbox should be empty after ack')

        # 6. Verify the target branch advanced.
        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, player_commit)


if __name__ == '__main__':
    unittest.main()
