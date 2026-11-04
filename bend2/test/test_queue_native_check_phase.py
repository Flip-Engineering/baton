#!/usr/bin/env python3
"""Fast contract tests for source-bound, artifact-free Bend check requests."""
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
DRIVER_PATH = ROOT / '.github/scripts/queue-native-checks.py'
SPEC = importlib.util.spec_from_file_location('queue_native_checks', DRIVER_PATH)
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)


class QueueNativeCheckPhaseTests(unittest.TestCase):
    def test_native_check_caller_routes_law_check_through_configured_driver(self):
        with tempfile.TemporaryDirectory(prefix='native-law-caller-') as temporary:
            root = Path(temporary)
            binaries = root / 'bin'
            binaries.mkdir()
            python = binaries / 'python3'
            python.write_text(
                '#!' + sys.executable + '\n'
                'import os, sys\n'
                'if sys.argv[1] == "--version":\n'
                '    print("Python fixture")\n'
                'elif sys.argv[1] not in ["bend2/test/queue-native-checks.py",\n'
                '                         "bend2/test/bootstrap-compile-queue-cancel.py"]:\n'
                '    os.execv(sys.executable, [sys.executable, *sys.argv[1:]])\n')
            python.chmod(0o755)
            compiler = root / 'selected-bend'
            compiler.write_text('#!/bin/sh\nexit 31\n')
            compiler.chmod(0o755)
            driver = root / 'driver.py'
            captured = root / 'driver-call.json'
            driver.write_text(
                'import json, os, sys\n'
                'from pathlib import Path\n'
                'Path(os.environ["FIXTURE_LAW_CALL"]).write_text(json.dumps({\n'
                '    "argv": sys.argv[1:], "bend": os.environ.get("BEND"),\n'
                '    "telemetry": os.environ.get("BEND_NO_TELEMETRY")}))\n'
                'raise SystemExit(29)\n')
            environment = dict(os.environ, BEND=str(compiler),
                               PATH=str(binaries) + os.pathsep + os.environ['PATH'],
                               BATON2_NATIVE_QUEUE_DRIVER=str(driver),
                               FIXTURE_LAW_CALL=str(captured))
            result = subprocess.run(
                ['sh', str(ROOT / 'bend2/scripts/check-native.sh')],
                env=environment, capture_output=True, text=True)
            self.assertEqual(result.returncode, 29, result.stdout + result.stderr)
            call = json.loads(captured.read_text())
            self.assertEqual(call['argv'], ['compiler', 'bend',
                                           'bend2/src/coordinator/laws.bend', '--check-only'])
            self.assertEqual(call['bend'], str(compiler))
            self.assertEqual(call['telemetry'], '1')

    def test_check_only_uses_check_phase_and_preserves_compiler_argv(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            run = root / 'run'
            run.mkdir()
            compiler = root / 'bend'
            compiler.write_text('#!/bin/sh\nexit 0\n')
            compiler.chmod(0o755)
            entry = root / 'bend2/src/coordinator/laws.bend'
            entry.parent.mkdir(parents=True)
            entry.write_text('def laws(): 0\n')
            config = {'run': str(run), 'bend': str(compiler), 'state': str(root / 'state')}
            (run / 'queue-config.json').write_text(json.dumps(config))
            command = [str(compiler), str(entry), '--check-only']
            captured = {}

            def submit(config_value, directory, options, argv, key_only=False):
                captured.update(config=config_value, directory=directory, options=options,
                                argv=argv, key_only=key_only)
                return 23

            previous_cwd = Path.cwd()
            os.chdir(root)
            try:
                with patch.dict(os.environ, {'BATON2_NATIVE_QUEUE': str(run / 'queue-config.json')}), \
                     patch.object(DRIVER, 'submit', side_effect=submit):
                    result = DRIVER.compiler('bend', command)
            finally:
                os.chdir(previous_cwd)

            self.assertEqual(result, 23)
            self.assertEqual(captured['argv'], command)
            self.assertFalse(captured['key_only'])
            self.assertIn('--kind', captured['options'])
            self.assertEqual(captured['options'][captured['options'].index('--kind') + 1], 'check')
            self.assertEqual(captured['options'][captured['options'].index('--source-root') + 1], str(root))
            self.assertEqual(captured['options'][captured['options'].index('--entry') + 1],
                             'bend2/src/coordinator/laws.bend')
            self.assertEqual(captured['options'][captured['options'].index('--compiler') + 1], str(compiler))
            self.assertNotIn('--artifact', captured['options'])

    def test_server_check_contract_has_no_artifact_and_rechecks_identity_under_heavy_lock(self):
        queue = (ROOT / 'bend2/src/host/compile-queue.bend').read_text()
        result = (ROOT / 'bend2/src/host/compile-queue-result.bend').read_text()
        lifecycle = (ROOT / 'bend2/src/host/compile-queue-lifecycle.bend').read_text()
        supervisor = (ROOT / 'bend2/src/host/compile-queue-supervisor.bend').read_text()
        self.assertIn('artifacts_absent(artifacts)', queue)
        self.assertIn('Tx.str_eq(kind, "check")', queue)
        self.assertIn('identity-config', queue)
        self.assertIn('identity-command', queue)
        supervise = queue[queue.index('def supervise_kind('):queue.index('@unsafe\ndef watch_heavy')]
        self.assertLess(supervise.index('current_key : String <- identity_key('),
                        supervise.index('supervise_identity_matches('))
        self.assertIn('supervise_kind(kind, source_root, entry, attempt', queue)
        owned = queue[queue.index('def supervise_owned('):queue.index('def supervise_owner_count(')]
        self.assertLess(owned.index('lock_fd_acquire(8)'), owned.index('set_env('))
        self.assertLess(owned.index('set_env('), owned.index('supervise_marker_result('))
        watcher = queue[queue.index('def watch_heavy('):queue.index('def watch_heavy_pid(')]
        self.assertLess(watcher.index('compiled'), watcher.index('lock_release(8)'))
        self.assertIn('lock_try(path)', lifecycle)
        self.assertNotIn('compile-queue-admission', lifecycle)
        self.assertNotIn('memory(', supervisor)
        self.assertNotIn('peak', supervisor)
        self.assertIn('String.eq(CompileQueueResult.field(result, "kind"), "check")', result)

    def test_submit_preserves_environment_and_compiler_failure_result(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            run = root / 'run'
            run.mkdir()
            client = root / 'fake-client'
            client.write_text(
                '#!/usr/bin/env python3\n'
                'import json, os, sys\n'
                'if "key" in sys.argv:\n'
                '    print("a" * 64)\n'
                'else:\n'
                '    values = [os.environ.get("BEND_NO_TELEMETRY", ""), os.environ.get("BUN_JSC_maxPerThreadStackUsage", "")]\n'
                '    open(os.environ["QUEUE_CLIENT_ENV"], "w").write(json.dumps(values))\n'
                '    print("check compiler failed", file=sys.stderr)\n'
                '    raise SystemExit(29)\n')
            client.chmod(0o755)
            environment_file = root / 'child-environment'
            config = {'run': str(run), 'client': str(client), 'state': str(root / 'state')}
            command = [str(root / 'bend'), '--check-only', str(root / 'laws.bend')]
            error_output = io.StringIO()
            with patch.dict(os.environ, {'BEND_NO_TELEMETRY': '1',
                                         'BUN_JSC_maxPerThreadStackUsage': '67108864',
                                         'QUEUE_CLIENT_ENV': str(environment_file)}), \
                 patch('sys.stderr', error_output):
                result = DRIVER.submit(config, run, ['--kind', 'check'], command)

            request = json.loads((run / 'request.json').read_text())
            self.assertEqual(result, 29)
            self.assertEqual(request['command'], command)
            self.assertEqual(request['exit_code'], 29)
            self.assertEqual(json.loads(environment_file.read_text()), ['1', '67108864'])
            self.assertIn('check compiler failed', error_output.getvalue())


if __name__ == '__main__':
    unittest.main()
