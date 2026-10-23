"""Real context evaluation and MCP capability regressions for #959.

The focused entry built from bend2/test/context-eval-entry.bend reaches the real
context decoder, provider selection, runtime launch and retained-result path.
The test uses the real MCP adapter against that compiled entry and against the
historical full CLI, and verifies the documented omitted-identity calls.
"""
import importlib.util
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
MCP = ROOT / 'bend2/scripts/mcp-conductor.mjs'
ENTRY = pathlib.Path(os.environ.get('BATON2_CONTEXT_EXE', ROOT / '.scratch/bend2/context-eval-test'))
PREFIX = pathlib.Path(os.environ.get('BATON2_CONTEXT_PREFIX', ''))
UNSUPPORTED = pathlib.Path(os.environ.get('BATON2_CONTEXT_UNSUPPORTED', ''))
OWNER = 'validation-owner'
RUNTIME = 'rt:context-eval-regression'
LAUNCH = 'context-eval-launch'


def load_package():
    spec = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ContextEvaluation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not ENTRY.is_file():
            raise unittest.SkipTest(f'compiled context entry absent at {ENTRY}')
        if not PREFIX.is_dir() or not UNSUPPORTED.is_file():
            raise unittest.SkipTest('set BATON2_CONTEXT_PREFIX and BATON2_CONTEXT_UNSUPPORTED for real MCP checks')
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = pathlib.Path(cls.temp.name)
        cls.payload = cls.root / 'payload'
        cls.worktree = cls.root / 'worktree'
        cls.db = cls.root / 'state.db'
        (cls.payload / 'bin').mkdir(parents=True)
        cls.installed = cls.payload / 'bin/baton2'
        cls.unsupported = UNSUPPORTED
        shutil.copyfile(ENTRY, cls.installed)
        cls.installed.chmod(0o755)
        shutil.copytree(PREFIX / 'libexec/baton2', cls.payload / 'libexec/baton2',
                        ignore=shutil.ignore_patterns('repl'))
        package = load_package()
        package.stage_runtime_context_module(cls.payload)
        cls.worktree.mkdir()
        (cls.worktree / '.baton').mkdir()
        (cls.worktree / '.baton/context.json').write_text(json.dumps({
            'schema': 'baton2-context-project-v1', 'disabled': [], 'preferred': ['runtime'],
        }) + '\n')
        shutil.copyfile(ROOT / 'bend2/context/runtime/cdp-fixture-longrun.mjs',
                        cls.worktree / 'runtime-target.mjs')
        subprocess.run(['git', 'init', '-q', '-b', 'main', str(cls.worktree)], check=True)
        attached = cls.invoke('attach', OWNER, 'fixture', '', '')
        if attached.returncode != 0:
            raise RuntimeError(attached.stdout + attached.stderr)
        with sqlite3.connect(cls.db) as connection:
            connection.execute("UPDATE sessions SET workspace=? WHERE id=?", (str(cls.worktree), OWNER))
        cls.launch()

    @classmethod
    def tearDownClass(cls):
        if getattr(cls, 'temp', None) is None:
            return
        try:
            cls.release()
        finally:
            cls.temp.cleanup()

    @classmethod
    def invoke(cls, *args, cwd=None):
        return subprocess.run([str(cls.installed), str(cls.db), *map(str, args)],
                              cwd=cwd or str(cls.worktree), text=True,
                              capture_output=True, timeout=180)

    @classmethod
    def submit(cls, query, subject, select, effects):
        document = {'version': 1, 'engine': 'runtime', 'cwd': str(cls.worktree),
                    'subject': {'kind': 'runtime', **subject},
                    'select': select, 'effects': effects}
        path = cls.root / f'{query}.json'
        path.write_text(json.dumps(document) + '\n')
        return cls.invoke('context-query-file', OWNER, query, str(path))

    @classmethod
    def result(cls, query):
        for _ in range(1200):
            reply = cls.invoke('context-result', OWNER, query)
            if reply.returncode != 0:
                raise AssertionError(reply.stdout + reply.stderr)
            envelope = json.loads(reply.stdout)
            if envelope['state'] in ('accepted', 'running'):
                time.sleep(0.1)
                continue
            if envelope['state'] != 'complete':
                raise AssertionError(reply.stdout)
            return envelope['result']['payload']
        raise AssertionError(f'context result did not settle: {query}')

    @classmethod
    def launch(cls):
        reply = cls.submit(LAUNCH, {
            'intent': 'launch', 'program': str(cls.worktree / 'runtime-target.mjs'), 'args': [],
            'env': {'BATON_CDP_FIXTURE_MARKER': 'context-eval-regression'},
            'onOwnerStop': 'terminate'}, ['state'], ['controlRuntime'])
        if reply.returncode != 0:
            raise RuntimeError(reply.stdout + reply.stderr)
        answer = cls.result(LAUNCH)
        if answer['runtime'] != RUNTIME:
            raise RuntimeError(json.dumps(answer))
        return answer

    @classmethod
    def release(cls):
        if getattr(cls, 'db', None) is None or not cls.db.is_file():
            return
        try:
            cls.submit('context-eval-release', {
                'intent': 'release', 'session': RUNTIME, 'onRelease': 'terminate',
                'signal': 'SIGTERM'}, ['state'], ['controlRuntime'])
        except Exception:
            pass

    @classmethod
    def latest_query(cls):
        with sqlite3.connect(cls.db) as connection:
            row = connection.execute(
                "SELECT id FROM semantic_queries WHERE owner=? ORDER BY rowid DESC LIMIT 1",
                (OWNER,)).fetchone()
        return '' if row is None else row[0]

    @classmethod
    def evaluate_without_id(cls, expression):
        before = cls.latest_query()
        reply = cls.invoke('context-eval', OWNER, '', RUNTIME, expression, '', str(cls.worktree))
        if reply.returncode != 0:
            raise AssertionError(reply.stdout + reply.stderr)
        query = cls.latest_query()
        if not query or query == before:
            raise AssertionError(f'no distinct generated query identity: {before!r} -> {query!r}')
        answer = cls.result(query)
        return query, answer

    def test_plain_help_does_not_advertise_context_eval(self):
        plain = subprocess.run([str(self.installed), '--help'], text=True, capture_output=True, timeout=30)
        self.assertEqual(plain.returncode, 0, plain.stdout + plain.stderr)
        self.assertIn('baton2 as SESSION ACTION ARGS', plain.stdout + plain.stderr)
        self.assertNotIn('context engines|install|query|eval|result', plain.stdout + plain.stderr)
        explicit = subprocess.run([str(self.installed), 'help', 'context'], text=True, capture_output=True, timeout=30)
        self.assertEqual(explicit.returncode, 0, explicit.stdout + explicit.stderr)
        self.assertIn('context engines|install|query|eval|result', explicit.stdout + explicit.stderr)

    def test_two_real_evaluations_without_id_and_latest_result(self):
        first, first_answer = self.evaluate_without_id('1 + 1')
        self.assertEqual(first_answer['result']['value'], 2, json.dumps(first_answer))
        second, second_answer = self.evaluate_without_id('2 + 2')
        self.assertEqual(second_answer['result']['value'], 4, json.dumps(second_answer))
        self.assertNotEqual(first, second)
        latest = self.invoke('context-result', OWNER, '')
        self.assertEqual(latest.returncode, 0, latest.stdout + latest.stderr)
        envelope = json.loads(latest.stdout)
        self.assertEqual(envelope['query'], second, latest.stdout)
        self.assertEqual(envelope['result']['payload']['result']['value'], 4, latest.stdout)

    def mcp_replies(self, executable, session=None):
        requests = [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
             'params': {'name': 'baton2_context_eval',
                        'arguments': {'session': RUNTIME, 'expression': '3 + 3'}}},
        ]
        result = subprocess.run(
            ['node', str(MCP), str(self.db), str(executable)]
            + ([] if session is None else ['--session', session]),
            input=''.join(json.dumps(row) + '\n' for row in requests),
            text=True, capture_output=True, timeout=180)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_mcp_surface_includes_supported_and_excludes_unsupported(self):
        replies = self.mcp_replies(self.installed, OWNER)
        tools = {row['name'] for row in replies[1]['result']['tools']}
        self.assertIn('baton2_context_eval', tools)
        call = replies[2]['result']
        self.assertFalse(call.get('isError', False), json.dumps(call))
        query = self.latest_query()
        self.assertTrue(query)
        answer = self.result(query)
        self.assertEqual(answer['result']['value'], 6, json.dumps(answer))

        unsupported = self.mcp_replies(self.unsupported, OWNER)
        names = {row['name'] for row in unsupported[1]['result']['tools']}
        self.assertNotIn('baton2_context_eval', names)


if __name__ == '__main__':
    unittest.main()
