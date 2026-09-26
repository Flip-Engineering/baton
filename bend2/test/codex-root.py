"""Integration test for the Bend2 Codex root adapter."""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
CODEX_ROOT_SCRIPT = ROOT / 'bend2/scripts/codex-root.mjs'


class CodexRootAdapter(unittest.TestCase):
    """Test the Codex root adapter's database polling and message formatting."""

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
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE), 'false-codex', '--once'],
            text=True, capture_output=True, timeout=10,
        )
        self.assertEqual(p.returncode, 0)
        self.assertIn('no pending messages', p.stderr)

    def test_adapter_formats_pending_report(self):
        """The adapter detects pending messages and formats them for Codex."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'turn-1', 'w1', 'Task completed successfully.')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        stdin_file = self.temp.name + '/stdin.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            '# Mock Codex: read stdin and emit JSON events\n'
            f'cat > {stdin_file}\n'
            'echo \'{"type":"thread.started","thread_id":"mock-thread"}\'\n'
            'echo \'{"type":"turn.started"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"message","content":[{"type":"output_text","text":"Acknowledged"}]}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True, timeout=15,
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
        self.coord('worker', 'w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('worker', 'w2', 'root', 'codex', 'model', 'high', '/wt2', 'br2', 'base')
        self.coord('report', 'r1', 'w1', 'First report.')
        self.coord('report', 'r2', 'w2', 'Second report.')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        stdin_file = self.temp.name + '/stdin.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            f'cat > {stdin_file}\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"message","content":[{"type":"output_text","text":"ok"}]}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('2 pending message(s)', p.stderr)

        stdin_content = (pathlib.Path(self.temp.name) / 'stdin.txt').read_text()
        self.assertIn('First report', stdin_content)
        self.assertIn('Second report', stdin_content)

    def test_system_instructions_contain_coordinator_commands(self):
        """The instructions piped to Codex include the coordinator CLI."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        stdin_file = self.temp.name + '/stdin.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            f'cat > {stdin_file}\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"message","content":[{"type":"output_text","text":"ok"}]}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        stdin_content = (pathlib.Path(self.temp.name) / 'stdin.txt').read_text()
        self.assertIn('baton2', stdin_content)
        self.assertIn('status', stdin_content)
        self.assertIn('workers', stdin_content)
        self.assertIn('land', stdin_content)

    def test_adapter_passes_json_and_exec_flags(self):
        """Codex is started with exec --json flags."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        args_file = self.temp.name + '/args.txt'
        mock_codex.write_text(
            '#!/bin/sh\n'
            f'echo "$@" > {args_file}\n'
            'cat > /dev/null\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"message","content":[{"type":"output_text","text":"ok"}]}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        subprocess.run(
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True, timeout=15,
        )

        args_text = (pathlib.Path(self.temp.name) / 'args.txt').read_text()
        self.assertIn('exec', args_text)
        self.assertIn('--json', args_text)
        self.assertIn('--dangerously-bypass-approvals-and-sandbox', args_text)

    def test_adapter_extracts_result_text(self):
        """The adapter extracts text from the Codex item.completed event."""
        self.coord('attach', 'root', 'codex', 'root-session', 'root-endpoint')
        self.coord('worker', 'w1', 'root', 'codex', 'model', 'high', '/wt', 'br', 'base')
        self.coord('report', 'r1', 'w1', 'done')

        mock_codex = pathlib.Path(self.temp.name) / 'mock-codex.sh'
        mock_codex.write_text(
            '#!/bin/sh\n'
            'cat > /dev/null\n'
            'echo \'{"type":"thread.started","thread_id":"mock"}\'\n'
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"message","content":[{"type":"output_text","text":"I have acknowledged the report."}]}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE), str(mock_codex), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')
        self.assertIn('I have acknowledged the report', p.stdout)


class CodexRootEndToEnd(unittest.TestCase):
    """End-to-end: recruit a worker, report, process with Codex root."""

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
        worker_commit = self.git('rev-parse', 'w1-branch').strip()

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
            'echo \'{"type":"item.completed","item":{"id":"item_0","type":"message","content":[{"type":"output_text","text":"Acknowledged and landed."}]}}\'\n'
            'echo \'{"type":"turn.completed"}\'\n'
        )
        mock_codex.chmod(0o755)

        p = subprocess.run(
            ['node', str(CODEX_ROOT_SCRIPT), str(self.db), str(EXE),
             str(mock_codex), '--once'],
            text=True, capture_output=True, timeout=15,
        )
        self.assertEqual(p.returncode, 0, f'stderr: {p.stderr}')

        inbox = json.loads(self.coord('inbox', 'root'))
        self.assertEqual(len(inbox), 0, 'Root inbox should be empty after ack')

        main_tip = self.git('rev-parse', 'main').strip()
        self.assertEqual(main_tip, worker_commit)


if __name__ == '__main__':
    unittest.main()
