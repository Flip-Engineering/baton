"""Integration test for the Bend2 OMP Conductor adapter."""
import json
import os
import pathlib
import shlex
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
OMP_CONDUCTOR_SCRIPT = ROOT / 'bend2/scripts/omp-conductor.mjs'
OMP_EXE = pathlib.Path('/opt/homebrew/bin/omp')


class OmpRootAdapter(unittest.TestCase):
    """Test the OMP Conductor adapter's report-triggered delivery and message formatting."""

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
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
        self.db = pathlib.Path(self.temp.name) / 'state.db'

    def register(self, name, parent, harness, model, effort, workspace=None, branch=None, base=None):
        """Recruit the session into this suite's fixture repository."""
        return self.coord('recruit', name, parent, harness, model, effort, str(self.repo),
                          branch or (name + '-branch'), str(self.checkouts / name), self.base)

    def tearDown(self):
        self.temp.cleanup()

    def coord(self, *args, ok=True):
        p = subprocess.run(
            [str(EXE), str(self.db), *args],
            text=True, capture_output=True, timeout=10,
        )
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout.strip()

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
            'ident="first" if "[id: first]" in sys.argv[-1] else "second"\n'
            f'with pathlib.Path({str(calls)!r}).open("a") as f: f.write(json.dumps({{"args":sys.argv[1:],"cwd":os.getcwd()}})+"\\n")\n'
            'print(json.dumps({"type":"session","id":"native-lead"}),flush=True)\n'
            'subprocess.run(cmd+["ack",ident,"lead","lead reviewed child"],check=True,stdout=subprocess.DEVNULL)\n'
            'print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Reviewed and landed "+ident}]}}),flush=True)\n'
            'print(json.dumps({"type":"agent_end","messages":[],"isTerminal":True}),flush=True)\n')
        native.chmod(0o700)
        args = ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--session', 'lead', '--attach']
        for ident in ['first', 'second']:
            attached = subprocess.run(args, text=True, capture_output=True)
            self.assertEqual(attached.returncode, 0, attached.stderr)
            self.coord('report', ident, 'child', 'Child completed ' + ident)
            self.assertEqual(json.loads(self.coord('delivery', ident))['receipt'], 'lead reviewed child')
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
        prompt = native_calls[0]['args'][native_calls[0]['args'].index('--system-prompt') + 1]
        self.assertIn("inbox 'lead'", prompt)
        self.assertIn("ack ID 'lead'", prompt)
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
        self.coord('attach', '', 'codex', 'parent-native', '')
        self.coord('role', '', 'principal-conductor')
        self.register(associate, '', 'omp', 'stored-model', 'low', branch='associate-branch')
        self.coord('connect', associate, 'saved-omp', '')
        self.register('child', associate, 'fixture', 'child-model', 'low')
        calls = temp / 'selected.json'
        native = temp / 'selected.py'
        native.write_text('#!' + sys.executable + '\nimport json,os,pathlib,subprocess,sys\n'
            + f'pathlib.Path({str(calls)!r}).write_text(json.dumps({{"argv":sys.argv[1:],"cwd":os.getcwd()}}))\n'
            + f'subprocess.run({[str(EXE), str(self.db), "ack", "selected-report", associate, "selected-reviewed"]!r},check=True,stdout=subprocess.DEVNULL)\n'
            + 'print(json.dumps({"type":"session","id":"saved-omp"}),flush=True)\n'
            + 'print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Selected Associate reviewed."}]}}),flush=True)\n')
        native.chmod(0o700)
        legacy = ROOT / 'bend2/scripts/omp-root.mjs'
        attached = subprocess.run(['node', str(legacy), str(self.db), str(EXE), str(native),
                                   '--session', associate, '--attach'], text=True, capture_output=True,
                                  env={**os.environ, 'OMP_ROOT_MODEL': 'legacy-model',
                                       'OMP_ROOT_THINKING': 'low'})
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(calls.exists())
        self.coord('report', 'selected-report', 'child', 'Selected child report')
        observed = json.loads(calls.read_text())
        self.assertEqual(observed['cwd'], str(self.checkouts / associate))
        argv = observed['argv']
        self.assertEqual(argv[argv.index('--resume') + 1], 'saved-omp')
        self.assertEqual(argv[argv.index('--model') + 1], 'legacy-model')
        prompt = argv[argv.index('--system-prompt') + 1]
        self.assertIn('Associate Conductor', prompt)
        inbox = next(line.split(' — ', 1)[0].strip() for line in prompt.splitlines()
                     if ' — inspect your pending message metadata' in line)
        self.assertEqual(shlex.split(inbox), [str(EXE), str(self.db), 'inbox', associate, '--index'])
        selected = json.loads(self.coord('player', associate))
        self.assertEqual(selected['role'], 'associate-conductor')
        self.assertIn(str(OMP_CONDUCTOR_SCRIPT), json.loads(selected['endpoint']))
        reports = json.loads(self.coord('inbox', ''))
        self.assertEqual([(r['sender'], r['recipient'], r['body']) for r in reports],
                         [(associate, '', 'Selected Associate reviewed.')])

    def test_failed_lead_turn_reports_to_parent_and_keeps_child_report(self):
        temp = pathlib.Path(self.temp.name)
        self.coord('attach', 'root', 'codex', 'native-root', '')
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
        self.assertNotEqual(failed.returncode, 0)
        self.assertIsNone(json.loads(self.coord('delivery', 'child-done'))['receipt'])
        reports = json.loads(self.coord('inbox', 'root'))
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]['sender'], 'lead')
        self.assertIn('23', reports[0]['body'])
        self.assertEqual(json.loads(reports[0]['body'])['exitCode'], 23)

    def test_report_file_starts_attached_omp_root(self):
        temp = pathlib.Path(self.temp.name)
        received = temp / 'received.txt'
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\n' +
            'import sys,pathlib,subprocess,json\n' +
            f'pathlib.Path({str(received)!r}).write_text(sys.argv[-1])\n' +
            f'subprocess.run({[str(EXE), str(self.db), "ack", "finished", "root", "native-reviewed"]!r},check=True,stdout=subprocess.DEVNULL)\n' +
            'print(json.dumps({"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Reviewed."}]}}))\n')
        native.chmod(0o700)
        attached = subprocess.run(['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--attach'], capture_output=True, text=True)
        self.assertEqual(attached.returncode, 0, attached.stderr)
        self.assertFalse(received.exists())
        self.register('w1', 'root', 'omp', 'model', 'low', str(temp), 'branch', 'base')
        report = temp / 'report.txt'
        report.write_text('Completed task with full report.')
        self.coord('report', 'finished', 'w1', report.read_text())
        self.assertIn(report.read_text(), received.read_text())
        self.assertEqual(json.loads(self.coord('delivery', 'finished'))['receipt'], 'native-reviewed')

    def test_reattachment_preserves_native_session_for_the_next_report(self):
        temp = pathlib.Path(self.temp.name)
        calls = temp / 'calls.jsonl'
        native = temp / 'root.py'
        native.write_text('#!' + sys.executable + '\nimport sys,pathlib,json,subprocess\n' +
            f'with pathlib.Path({str(calls)!r}).open("a") as f:f.write(json.dumps(sys.argv[1:])+"\\n")\n' +
            'body=sys.argv[-1]\n' +
            'ident="first" if "[id: first]" in body else "second"\n' +
            'print(\'{"type": "session", "id": "native-root"}\',flush=True)\n' +
            f'subprocess.run({[str(EXE), str(self.db), "ack"]!r}+[ident,"root","reviewed"],check=True,stdout=subprocess.DEVNULL)\n' +
            'print(\'{"type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "Reviewed"}]}}\')\n')
        native.chmod(0o700)
        args = ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(native), '--attach']
        for message in ['first', 'second']:
            attached = subprocess.run(args, text=True, capture_output=True)
            self.assertEqual(attached.returncode, 0, attached.stderr)
            if message == 'first':
                self.register('sender', 'root', 'fixture', 'model', 'low')
            self.coord('report', message, 'sender', 'Review this message.')
            self.assertEqual(json.loads(self.coord('player', 'root'))['native'], 'native-root')
        argv = [json.loads(line) for line in calls.read_text().splitlines()]
        self.assertEqual(len(argv), 2)
        self.assertEqual(argv[1][argv[1].index('--resume') + 1], 'native-root')
        self.assertNotIn('--no-session', argv[0])

    def test_adapter_exits_cleanly_with_no_pending_messages(self):
        """With no root and no messages, the adapter exits 0."""
        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(OMP_EXE), '--once'],
            text=True, capture_output=True, timeout=10,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn('no pending messages', p.stderr)

    def test_adapter_formats_pending_report(self):
        """The adapter detects pending messages and formats them for OMP."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Task completed successfully.')

        # Run the adapter in --once mode with a fake OMP that just prints the prompt.
        # We use a shell script that echoes its arguments as JSON events.
        mock_omp = pathlib.Path(self.temp.name) / 'mock-omp.sh'
        mock_omp.write_text(
            '#!/bin/sh\n'
            '# Mock OMP: emit a session event and echo the last argument (the prompt)\n'
            'echo \'{"type":"session","id":"mock-session"}\'\n'
            'echo \'{"type":"agent_start"}\'\n'
            'echo \'{"type":"turn_start"}\'\n'
            'prompt="$(/usr/bin/python3 -c "import sys; print(sys.argv[-1])" "$@")"\n'
            'echo "{\\\"type\\\":\\\"message_end\\\",\\\"message\\\":{\\\"role\\\":\\\"assistant\\\","'
            '"\\\"content\\\":[{\\\"type\\\":\\\"text\\\",\\\"text\\\":\\\"Acknowledged\\\"}]}}"\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"Acknowledged"}]}}\'\n'
            'echo \'{"type":"agent_end"}\'\n'
            '# Write the prompt to a file so the test can read it\n'
            f'echo "$prompt" > {self.temp.name}/received-prompt.txt\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )

        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('1 pending message(s)', p.stderr)

        # Verify the prompt was passed to OMP containing the worker report.
        received = (pathlib.Path(self.temp.name) / 'received-prompt.txt').read_text()
        self.assertIn('Task completed successfully', received)
        self.assertIn('turn-1', received)
        self.assertIn('w1', received)

    def test_adapter_detects_multiple_messages(self):
        """The adapter formats multiple pending messages in one prompt."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.register('w2', 'root', 'omp', 'model', 'high', '/wt2', 'br2', 'base')
        self.coord('report', 'r1', 'w1', 'First report.')
        self.coord('report', 'r2', 'w2', 'Second report.')

        mock_omp = pathlib.Path(self.temp.name) / 'mock-omp.sh'
        prompt_file = self.temp.name + '/prompt.txt'
        mock_omp.write_text(
            '#!/bin/sh\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\'\n'
            '# Write the last argument (the prompt) to a file\n'
            'for arg in "$@"; do last="$arg"; done\n'
            f'printf "%s" "$last" > {prompt_file}\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('2 pending message(s)', p.stderr)

        prompt = (pathlib.Path(self.temp.name) / 'prompt.txt').read_text()
        self.assertIn('First report', prompt)
        self.assertIn('Second report', prompt)

    def test_system_prompt_contains_coordinator_commands(self):
        """The system prompt passed to OMP includes the coordinator CLI."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_omp = pathlib.Path(self.temp.name) / 'mock-omp.sh'
        mock_omp.write_text(
            '#!/bin/sh\n'
            f'echo "$@" > {self.temp.name}/args.txt\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\'\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        args_text = (pathlib.Path(self.temp.name) / 'args.txt').read_text()
        self.assertIn('--system-prompt', args_text)
        self.assertIn('baton2', args_text)
        self.assertIn("inbox 'root' --index", args_text)
        self.assertIn("[--commit COMMIT]", args_text)
        self.assertIn("recorded branch tip", args_text)
        self.assertIn("--role player|associate-conductor", args_text)
        self.assertIn("[--section ENSEMBLE OWNER SECTION]...", args_text)
        self.assertIn("startupRequested:false", args_text)
        self.assertIn('delivery ID', args_text)
        self.assertIn("orchestra --index --for 'root' --pretty", args_text)
        self.assertIn('--sender PLAYER --kind report --state all', args_text)
        self.assertIn('inputRead argv', args_text)
        self.assertIn('pendingCount excludes stopped execution inputs', args_text)
        self.assertIn('unacknowledgedCount includes every NULL receipt', args_text)
        self.assertIn('players', args_text)
        self.assertIn('land', args_text)

    def test_adapter_passes_print_and_json_mode(self):
        """OMP is started with --print --mode json flags."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_omp = pathlib.Path(self.temp.name) / 'mock-omp.sh'
        mock_omp.write_text(
            '#!/bin/sh\n'
            f'echo "$@" > {self.temp.name}/args.txt\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}\'\n'
        )
        mock_omp.chmod(0o755)

        subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )

        args_text = (pathlib.Path(self.temp.name) / 'args.txt').read_text()
        self.assertIn('--print', args_text)
        self.assertIn('--mode json', args_text)
        self.assertIn('--approval-mode yolo', args_text)

    def test_adapter_extracts_result_text(self):
        """The adapter extracts text from the OMP turn_end event."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.register('w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_omp = pathlib.Path(self.temp.name) / 'mock-omp.sh'
        mock_omp.write_text(
            '#!/bin/sh\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"I have acknowledged the report."}]}}\'\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('I have acknowledged the report', p.stdout)


class OmpRootEndToEnd(unittest.TestCase):
    """End-to-end: recruit a worker, report, process with OMP root."""

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
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
            text=True, capture_output=True, timeout=10,
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
            '# Simulate OMP root: ack the report and land the worker\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_start"}\'\n'
            # Simulate bash tool calls that ack and land
            f'{EXE} {self.db} ack turn-1 root omp-root-ack\n'
            f'{EXE} {self.db} land w1 {self.repo} main\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"Acknowledged and landed."}]}}\'\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_CONDUCTOR_SCRIPT), str(self.db), str(EXE),
             str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
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
