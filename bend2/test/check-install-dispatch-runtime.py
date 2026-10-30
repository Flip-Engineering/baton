"""Regression for the check-install dispatch runtime guard (#947).

The guard validates the packaged runtime layout listed in
docs/bend2/installation.md: task-start.mjs plus either bin/node or
libexec/baton2/repl/bun. A package with no runtime must be refused.
"""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'baton_check_install', ROOT / 'bend2/scripts/check-install.py')
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class DispatchRuntimeGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.prefix = pathlib.Path(self.temp.name)
        self.helper = self.prefix / 'libexec/baton2/task-start.mjs'
        self.helper.parent.mkdir(parents=True)
        self.helper.write_text('fixture dispatch operation\n')

    def runtime(self, relative):
        path = self.prefix / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#!/bin/sh\nexit 0\n')
        path.chmod(0o755)
        return path

    def test_missing_dispatch_operation_is_refused(self):
        self.helper.unlink()
        with self.assertRaisesRegex(RuntimeError, 'lacks the dispatch operation'):
            CHECK.verify_dispatch_runtime(self.prefix)

    def test_missing_runtime_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'no Node or bundled Bun runtime'):
            CHECK.verify_dispatch_runtime(self.prefix)

    def test_packaged_bin_node_is_accepted(self):
        self.runtime('bin/node')
        CHECK.verify_dispatch_runtime(self.prefix)

    def test_packaged_repl_bun_is_accepted(self):
        self.runtime('libexec/baton2/repl/bun')
        CHECK.verify_dispatch_runtime(self.prefix)

    def test_non_executable_runtime_is_refused(self):
        path = self.prefix / 'bin/node'
        path.parent.mkdir(parents=True)
        path.write_text('not executable\n')
        with self.assertRaisesRegex(RuntimeError, 'no Node or bundled Bun runtime'):
            CHECK.verify_dispatch_runtime(self.prefix)

    def test_package_check_can_skip_compiler_probe_and_keeps_required_runtime(self):
        manifest = self.prefix / 'manifest.json'
        manifest.write_text(json.dumps({'required_system_dependencies': []}) + '\n')
        (self.prefix / 'install-receipt.json').write_text('{}\n')
        (self.prefix / 'SHA256SUMS').write_text('')
        output = self.prefix / 'result'
        output.mkdir()
        dependency = {'path': 'libexec/baton2/repl', 'sha256': 'a' * 64}
        calls = []

        def run(argv, **kwargs):
            calls.append(list(map(str, argv)))
            stdout = ('1.3.14\n' if argv[-1] == '--version' else
                      'guide --to PLAYER\n' if argv[-2:] == ['help', 'guide'] else '')
            return CHECK.subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr='')

        with mock.patch.object(CHECK, 'verify_checksums', return_value={}), \
                mock.patch.object(CHECK, 'verify_payload_checksums'), \
                mock.patch.object(CHECK, 'verify_binaries', return_value=[]), \
                mock.patch.object(CHECK, 'verify_receiver_router', return_value={'returncode': 78}) as router, \
                mock.patch.object(CHECK, 'verify_repl', return_value=dependency), \
                mock.patch.object(CHECK, 'verify_dispatch_runtime'), \
                mock.patch.object(CHECK, 'verify_agent_summary_preload'), \
                mock.patch.object(CHECK, 'system_dependencies', return_value=[]), \
                mock.patch.object(CHECK.platform, 'system', return_value='Darwin'), \
                mock.patch.object(CHECK.subprocess, 'run', side_effect=run):
            result = CHECK.check(self.prefix, output, probe_native_compiler=False)

        self.assertEqual(result['native_compiler_probe'], 'not-run')
        self.assertEqual(result['runtime_version'], '1.3.14')
        router.assert_called_once_with(self.prefix, output)
        self.assertEqual(result['receiver_router_probe'], {'returncode': 78})
        self.assertEqual([pathlib.Path(argv[0]).name for argv in calls],
                         ['baton', 'baton-focused', 'baton', 'bun'])
        self.assertFalse((output / 'guide-check.sqlite').exists())
        self.assertFalse((output / 'sqlite-probe.c').exists())


class AgentSummaryPreloadGuard(unittest.TestCase):
    """The installed preload must be the pinned script and the doctor helper must be present (#1338)."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.prefix = pathlib.Path(self.temp.name)
        self.directory = self.prefix / 'libexec/baton2'
        self.directory.mkdir(parents=True)
        for name in ('agent-summary-check.mjs', 'no-agent-summary.js'):
            (self.directory / name).write_bytes((ROOT / 'bend2/scripts' / name).read_bytes())

    def test_the_pinned_preload_and_helper_are_accepted(self):
        CHECK.verify_agent_summary_preload(self.prefix)

    def test_a_missing_helper_is_refused(self):
        (self.directory / 'agent-summary-check.mjs').unlink()
        with self.assertRaisesRegex(RuntimeError, 'lacks the doctor operation'):
            CHECK.verify_agent_summary_preload(self.prefix)

    def test_a_missing_preload_is_refused(self):
        (self.directory / 'no-agent-summary.js').unlink()
        with self.assertRaisesRegex(RuntimeError, 'lacks the agent_summary preload'):
            CHECK.verify_agent_summary_preload(self.prefix)

    def test_a_changed_preload_is_refused(self):
        with (self.directory / 'no-agent-summary.js').open('a') as stream:
            stream.write('// edited\n')
        with self.assertRaisesRegex(RuntimeError, 'differs from its pinned SHA-256'):
            CHECK.verify_agent_summary_preload(self.prefix)


class ReceiverRouterGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.prefix = pathlib.Path(self.temp.name) / 'prefix'
        (self.prefix / 'bin').mkdir(parents=True)
        self.output = pathlib.Path(self.temp.name) / 'evidence'
        self.output.mkdir()
        self.binary = self.prefix / 'bin/baton'

    def executable(self, body):
        self.binary.write_text('#!/bin/sh\n' + body + '\n')
        self.binary.chmod(0o755)

    def test_router_reaches_missing_sibling_before_opening_database(self):
        self.executable('''test "$2" = register-receiver || exit 11
test ! -e "$(dirname "$0")/baton-focused" || exit 12
test -z "${BATON2_NODE+x}${BATON_PROJECT+x}" || exit 13
printf '%s\\n' 'baton: focused receiver is missing or not executable. Install the complete Baton package.' >&2
exit 78''')
        sibling = self.prefix / 'bin/baton-focused'
        sibling.write_text('existing helper remains in its installed prefix\n')
        original = self.binary.read_bytes()
        with mock.patch.dict(os.environ, {'BATON2_NODE': '/invalid/runtime',
                                         'BATON_PROJECT': '/live/project'}):
            record = CHECK.verify_receiver_router(self.prefix, self.output)
        self.assertEqual(record['returncode'], 78)
        self.assertFalse(record['database_created'])
        self.assertEqual(record['binary_sha256'], CHECK.archive_digest(self.binary))
        self.assertEqual(self.binary.read_bytes(), original)
        self.assertTrue(sibling.is_file())
        self.assertFalse(pathlib.Path(record['argv'][0]).exists())
        self.assertEqual(json.loads((self.output / 'receiver-router-probe.json').read_text()), record)

    def test_plain_full_cli_admin_usage_is_refused(self):
        self.executable("printf '%s\\n' 'usage: baton DATABASE ACTION'; exit 0")
        with self.assertRaisesRegex(RuntimeError, 'does not provide the native receiver router'):
            CHECK.verify_receiver_router(self.prefix, self.output)
        record = json.loads((self.output / 'receiver-router-probe.json').read_text())
        self.assertEqual(record['returncode'], 0)
        self.assertIn('usage:', record['stdout'])

    def test_unrelated_exit_78_is_refused(self):
        self.executable("printf '%s\\n' 'another startup failure' >&2; exit 78")
        with self.assertRaisesRegex(RuntimeError, 'does not provide the native receiver router'):
            CHECK.verify_receiver_router(self.prefix, self.output)

    def test_database_creation_is_refused(self):
        self.executable('''touch "$1"
printf '%s\\n' 'baton: focused receiver is missing or not executable. Install the complete Baton package.' >&2
exit 78''')
        with self.assertRaisesRegex(RuntimeError, 'does not provide the native receiver router'):
            CHECK.verify_receiver_router(self.prefix, self.output)
        record = json.loads((self.output / 'receiver-router-probe.json').read_text())
        self.assertTrue(record['database_created'])
        self.assertFalse(pathlib.Path(record['argv'][1]).exists())

    def test_self_exec_loop_is_refused_with_captured_timeout_evidence(self):
        self.executable('exit 0')
        expired = CHECK.subprocess.TimeoutExpired(['private-router-probe'], 30,
                                                 output=b'partial stdout', stderr=b'partial stderr')
        with mock.patch.object(CHECK.subprocess, 'run', side_effect=expired) as run:
            with self.assertRaisesRegex(RuntimeError, 'does not provide the native receiver router'):
                CHECK.verify_receiver_router(self.prefix, self.output)
        self.assertEqual(run.call_args.kwargs['timeout'], 30)
        record = json.loads((self.output / 'receiver-router-probe.json').read_text())
        self.assertEqual(record['timeout_seconds'], 30)
        self.assertEqual(record['stdout'], 'partial stdout')
        self.assertEqual(record['stderr'], 'partial stderr')
        self.assertIsNone(record['returncode'])
        self.assertFalse(record['database_created'])
        self.assertFalse(pathlib.Path(record['argv'][0]).exists())


if __name__ == '__main__':
    unittest.main()
