"""Integration test for the Bend2 OMP root adapter."""
import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
OMP_ROOT_SCRIPT = ROOT / 'bend2/scripts/omp-root.mjs'
OMP_EXE = pathlib.Path('/opt/homebrew/bin/omp')


class OmpRootAdapter(unittest.TestCase):
    """Test the OMP root adapter's database polling and message formatting."""

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'

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

    def test_adapter_exits_cleanly_with_no_pending_messages(self):
        """With no root and no messages, the adapter exits 0."""
        p = subprocess.run(
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE), str(OMP_EXE), '--once'],
            text=True, capture_output=True, timeout=10,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn('no pending messages', p.stderr)

    def test_adapter_formats_pending_report(self):
        """The adapter detects pending messages and formats them for OMP."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
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
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
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
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('worker', 'w2', 'root', 'omp', 'model', 'high', '/wt2', 'br2', 'base')
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
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
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
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
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
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        args_text = (pathlib.Path(self.temp.name) / 'args.txt').read_text()
        self.assertIn('--system-prompt', args_text)
        self.assertIn('baton2', args_text)
        self.assertIn('status', args_text)
        self.assertIn('workers', args_text)
        self.assertIn('land', args_text)

    def test_adapter_passes_print_and_json_mode(self):
        """OMP is started with --print --mode json flags."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
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
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )

        args_text = (pathlib.Path(self.temp.name) / 'args.txt').read_text()
        self.assertIn('--print', args_text)
        self.assertIn('--mode json', args_text)
        self.assertIn('--approval-mode yolo', args_text)

    def test_adapter_extracts_result_text(self):
        """The adapter extracts text from the OMP turn_end event."""
        self.coord('attach', 'root', 'omp', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'omp', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_omp = pathlib.Path(self.temp.name) / 'mock-omp.sh'
        mock_omp.write_text(
            '#!/bin/sh\n'
            'echo \'{"type":"session","id":"mock"}\'\n'
            'echo \'{"type":"turn_end","message":{"role":"assistant","content":[{"type":"text","text":"I have acknowledged the report."}]}}\'\n'
        )
        mock_omp.chmod(0o755)

        p = subprocess.run(
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_omp), '--once'],
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
        worker_commit = self.git('rev-parse', 'w1-branch').strip()

        # 3. Worker reports.
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
            ['node', str(OMP_ROOT_SCRIPT), str(self.db), str(EXE),
             str(mock_omp), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        # 5. Verify the message was acknowledged.
        inbox = json.loads(self.coord('inbox', 'root'))
        self.assertEqual(len(inbox), 0, 'Root inbox should be empty after ack')

        # 6. Verify the target branch advanced.
        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, worker_commit)


if __name__ == '__main__':
    unittest.main()
