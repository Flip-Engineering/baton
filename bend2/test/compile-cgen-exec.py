"""Unit cache directory selection of the queued C-generation wrapper.

The wrapper chooses BEND_CGEN_CACHE_DIR from GitHub's record of the run and the
queue state root, not from the job environment. These tests run the wrapper
against a stand-in for the Actions run API and a fake queue state root. No
compiler is started.
"""
import http.server
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXEC = ROOT / '.github/scripts/compile-cgen-exec.py'
ADAPTER = ROOT / '.github/scripts/queue-native-checks.py'
REPOSITORY = 'owner/repo'
SHA = 'a' * 40


class RunApi(http.server.BaseHTTPRequestHandler):
    answer = {}
    status = 200
    seen = []

    def do_GET(self):
        type(self).seen.append((self.path, self.headers.get('Authorization')))
        body = json.dumps(type(self).answer).encode()
        self.send_response(type(self).status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def record(**changes):
    value = {'id': 77, 'status': 'in_progress', 'run_attempt': 1, 'event': 'workflow_dispatch', 'head_sha': SHA,
             'repository': {'full_name': REPOSITORY}, 'head_repository': {'full_name': REPOSITORY}}
    value.update(changes)
    return value


class CacheSelection(unittest.TestCase):
    def setUp(self):
        RunApi.answer, RunApi.status, RunApi.seen = record(), 200, []
        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), RunApi)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / 'state'
        self.state.mkdir()
        try:
            os.chmod(self.state, 0o2770)
        except PermissionError:
            self.skipTest('this host refuses to set the setgid bit (RestrictSUIDSGID)')
        (self.state / 'heavy.lock').write_text('')
        self.attempt = self.state / 'keys/key/runs/attempt'
        self.attempt.mkdir(parents=True)
        (self.attempt / 'work').mkdir()
        self.report = Path(self.directory.name) / 'seen.json'

    def run_wrapper(self, environment=None, output=None, command=None):
        environment = {'PATH': os.environ['PATH'], 'GITHUB_REPOSITORY': REPOSITORY, 'GITHUB_RUN_ID': '77',
                       'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': SHA, 'GITHUB_TOKEN': 'secret',
                       'GITHUB_EVENT_NAME': 'workflow_dispatch', 'HOME': self.directory.name,
                       'GITHUB_API_URL': 'http://127.0.0.1:%d' % self.server.server_address[1],
                       **(environment or {})}
        environment = {key: value for key, value in environment.items() if value is not None}
        output = output or str(self.attempt / 'work/output.c')
        command = command or [sys.executable, '-c',
                               'import json,os,sys;open(sys.argv[1],"w").write(json.dumps(os.environ.get("BEND_CGEN_CACHE_DIR")))',
                               str(self.report), '-o', 'x']
        result = subprocess.run([sys.executable, str(EXEC), output, *command], env=environment, capture_output=True, text=True)
        return result

    def compiler_saw(self):
        return json.loads(self.report.read_text())

    def selection(self):
        return json.loads((self.attempt / 'cache-selection.json').read_text())

    def test_dispatch_run_shares_the_trusted_directory(self):
        result = self.run_wrapper()
        self.assertEqual(result.returncode, 0, result.stderr)
        shared = self.state / 'cgen-cache/trusted'
        self.assertEqual(self.compiler_saw(), str(shared))
        selection = self.selection()
        self.assertTrue(selection['trusted'])
        self.assertEqual((selection['kind'], selection['event'], selection['directory']), ('shared', 'workflow_dispatch', str(shared)))
        info = shared.stat()
        self.assertTrue(info.st_mode & stat.S_ISGID)
        self.assertEqual(info.st_gid, self.state.stat().st_gid)
        self.assertEqual(RunApi.seen[0], ('/repos/owner/repo/actions/runs/77', 'Bearer secret'))

    def test_pull_request_run_gets_a_private_directory(self):
        RunApi.answer = record(event='pull_request')
        result = self.run_wrapper({'GITHUB_EVENT_NAME': 'pull_request'})
        self.assertEqual(result.returncode, 0, result.stderr)
        private = self.state / 'cgen-cache/untrusted' / str(os.getuid())
        self.assertEqual(self.compiler_saw(), str(private))
        self.assertEqual(stat.S_IMODE(private.stat().st_mode) & 0o077, 0)
        self.assertFalse(self.selection()['trusted'])
        self.assertFalse((self.state / 'cgen-cache/trusted').exists(), 'an untrusted run does not create the shared directory')

    def test_inherited_cache_variables_are_ignored(self):
        shared = self.state / 'cgen-cache/trusted'
        RunApi.answer = record(event='pull_request')
        self.run_wrapper({'GITHUB_EVENT_NAME': 'pull_request', 'BEND_CGEN_CACHE_DIR': str(shared), 'XDG_CACHE_HOME': str(shared)})
        self.assertNotEqual(self.compiler_saw(), str(shared))
        selection = self.selection()
        self.assertEqual((selection['inherited_cache_dir'], selection['inherited_xdg_cache_home']), (str(shared), str(shared)))

    def test_environment_cannot_claim_another_event(self):
        RunApi.answer = record(event='pull_request')
        self.run_wrapper({'GITHUB_EVENT_NAME': 'workflow_dispatch'})
        self.assertFalse(self.selection()['trusted'])
        self.assertIn('another event', self.selection()['reason'])
        RunApi.answer = record(event='workflow_dispatch')
        self.run_wrapper({'GITHUB_EVENT_NAME': 'pull_request'})
        self.assertFalse(self.selection()['trusted'])

    def test_a_record_that_does_not_match_the_job_is_not_trusted(self):
        for change, environment in [({'run_attempt': 2}, {}), ({'head_sha': 'b' * 40}, {}), ({'status': 'completed'}, {}),
                                    ({'id': 78}, {}), ({'head_repository': {'full_name': 'fork/repo'}}, {}),
                                    ({'repository': {'full_name': 'other/repo'}}, {})]:
            with self.subTest(change=change):
                RunApi.answer = record(**change)
                self.run_wrapper(environment)
                self.assertFalse(self.selection()['trusted'], self.selection())

    def test_missing_or_failing_record_is_not_trusted(self):
        self.run_wrapper({'GITHUB_TOKEN': None})
        self.assertFalse(self.selection()['trusted'])
        self.assertIn('no run identity or token', self.selection()['reason'])
        RunApi.status = 500
        self.run_wrapper()
        self.assertFalse(self.selection()['trusted'])
        self.assertIn('run lookup failed', self.selection()['reason'])
        self.assertEqual(self.compiler_saw(), str(self.state / 'cgen-cache/untrusted' / str(os.getuid())))

    def test_a_shared_directory_without_the_group_bit_is_not_used(self):
        shared = self.state / 'cgen-cache/trusted'
        shared.mkdir(parents=True)
        os.chmod(shared, 0o770)
        self.run_wrapper()
        self.assertFalse(self.selection()['trusted'])
        self.assertIn('setgid', self.selection()['reason'])
        self.assertNotEqual(self.compiler_saw(), str(shared))

    def test_an_attempt_outside_a_state_root_keeps_its_cache_local(self):
        outside = Path(self.directory.name) / 'loose/work'
        outside.mkdir(parents=True)
        self.run_wrapper(output=str(outside / 'output.c'))
        self.assertEqual(self.compiler_saw(), str(outside / 'cgen-cache'))
        self.assertFalse(json.loads((outside.parent / 'cache-selection.json').read_text())['trusted'])

    def test_exit_status_and_the_check_placeholder_are_kept(self):
        result = self.run_wrapper(command=[sys.executable, '-c', 'raise SystemExit(3)', '-o', 'x'])
        self.assertEqual(result.returncode, 3)
        output = self.attempt / 'work/output.c'
        self.run_wrapper(command=[sys.executable, '-c', 'pass'])
        self.assertIn('Compiler check completed successfully', output.read_text())

    def test_the_adapter_retains_the_selection_with_the_attempt_diagnostics(self):
        self.run_wrapper()
        (self.attempt / 'meta').write_text('kind=cgen\nkey=key\n')
        (self.attempt / 'source-digest').write_text('digest\n')
        for name in ('argv', 'command'):
            (self.attempt / name).write_text('x\n')
        adapter = runpy.run_path(str(ADAPTER))
        adapter['compiler_diagnostics'](self.attempt, [sys.executable])
        diagnostics = json.loads((self.attempt / 'compiler-diagnostics.json').read_text())
        self.assertEqual(diagnostics['cgen_cache'], self.selection())
        self.assertIn('BEND_CGEN_CACHE_DIR', diagnostics['environment'])


if __name__ == '__main__':
    unittest.main()
