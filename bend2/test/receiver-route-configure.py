"""Future native #678 configuration cases over an admitted composed package.

BATON2_ROUTE_EXE and BATON2_ROUTE_HELPER name the exact admitted artifacts.
The fixture stages them in a temporary installation. The harness only records
unexpected invocation. Provider resume/custody cases remain Receive-owned.
"""
import ctypes
import fcntl
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import unittest


class ConfigureRoute(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='baton-route-configuration-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.exe = self.root / 'bin' / 'baton2'
        self.helper = self.root / 'libexec' / 'baton2' / 'git-series.mjs'
        self.exe.parent.mkdir()
        self.helper.parent.mkdir(parents=True)
        shutil.copy2(os.environ['BATON2_ROUTE_EXE'], self.exe)
        shutil.copy2(os.environ['BATON2_ROUTE_HELPER'], self.helper)
        self.db = self.root / 'coord.db'
        self.marker = self.root / 'provider-started'
        self.command = self.root / 'harness with spaces'
        self.command.write_text('#!/bin/sh\nprintf started > "' + str(self.marker) + '"\nexit 99\n')
        self.command.chmod(0o700)
        self.log = self.root / 'native output.jsonl'
        series = {}
        for key, label in [('glm', 'GLM'), ('deepseek', 'DeepSeek')]:
            directory = self.root / key
            directory.mkdir()
            identity = {'seriesKey': key, 'displaySeries': label, 'github': {
                'appId': 1, 'botId': 2, 'installationId': 3, 'repositoryId': 4,
                'clientId': 'fixture', 'slug': 'fixture-' + key,
                'botLogin': 'fixture-' + key + '[bot]',
                'commitEmail': '2+fixture-' + key + '[bot]@users.noreply.github.com',
                'repositoryFullName': 'Flip-Engineering/baton',
                'permissions': {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}}}
            metadata = directory / 'identity-series.json'
            metadata.write_text(json.dumps(identity))
            metadata.chmod(0o600)
            series[key] = str(directory)
        self.registry = self.root / 'registry.json'
        self.registry.write_text(json.dumps({'models': {'old': 'glm', 'new': 'deepseek'}, 'series': series}))
        self.registry.chmod(0o600)
        self.env = dict(os.environ, BATON2_GIT_REGISTRY=str(self.registry))
        self.call('attach', 'parent', 'omp', '', '', expected=0)
        self.call('role', 'parent', 'principal-conductor', expected=0)
        self.call('player', 'child', 'parent', 'omp', 'old', 'high', str(self.root), 'branch', 'base', expected=0)
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE sessions SET native='original-native', observed_harness='omp', observed_model='observed-old', observed_effort='high' WHERE id='child'")
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('pending','parent','child','guidance','original pending input')")
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body,receipt) VALUES('failure','child','parent','report','original 429 evidence','retained')")
            db.execute("INSERT INTO turns VALUES('failure','child','original event')")
        self.original = self.snapshot()

    def call(self, *args, expected=None):
        run = subprocess.run([str(self.exe), str(self.db), *args], env=self.env,
                             text=True, capture_output=True)
        if expected is not None:
            self.assertEqual(run.returncode, expected, (run.stdout, run.stderr))
        self.assertFalse(self.marker.exists(), 'Configuration invoked the provider')
        return run

    def snapshot(self):
        return json.loads(self.call('receiver-route', 'child', '--inspect', expected=0).stdout)['expectedAssignment']

    def configure(self, snapshot=None, model='new', harness='omp', requester='parent', effort='high', expected=0):
        run = self.call('receiver-route', 'child', requester,
                        json.dumps(self.original if snapshot is None else snapshot),
                        harness, model, effort, str(self.command), str(self.log), '--apply', expected=expected)
        return json.loads(run.stdout) if run.returncode == 0 else run

    def legacy_endpoint(self, wrapped=False, overrides=False):
        # Control.receiver_args supplies blank overrides. Explicit matching
        # values are also accepted by the historical Receive field selection.
        args = [str(self.exe), str(self.db), 'receive', 'child', str(self.command),
                'old' if overrides else '', 'high' if overrides else '',
                str(self.root) if overrides else '', str(self.log)]
        if wrapped:
            args = ['node', str(self.helper), 'launch', '--registry', str(self.registry),
                    '--model-key', 'old', '--', *args]
        return args

    def set_endpoint(self, endpoint):
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE sessions SET endpoint=? WHERE id='child'", (json.dumps(endpoint),))
        return self.snapshot()

    def test_recognized_legacy_constructors_and_matching_overrides(self):
        for wrapped in (False, True):
            for overrides in (False, True):
                with self.subTest(wrapped=wrapped, overrides=overrides):
                    with sqlite3.connect(self.db) as db:
                        db.execute("UPDATE sessions SET model='old', effort='high' WHERE id='child'")
                    before = self.set_endpoint(self.legacy_endpoint(wrapped, overrides))
                    self.configure(before)
                    self.assertEqual(json.loads(self.snapshot()['endpoint'])[12], '1')

    def test_malformed_legacy_and_route_mismatches_refuse(self):
        cases = [["", "", "receive", "child", "", "", "", "", ""],
                 ['arbitrary'] * 10 + ['receive', 'child'] + ['arbitrary'] * 5]
        for wrapped in (False, True):
            offset = 8 if wrapped else 0
            changes = [(0, ''), (0, 'relative-baton'), (1, '/other-db'), (3, 'other-child'),
                       (4, ''), (4, 'relative-harness'), (5, 'new'), (6, 'low'),
                       (7, '/other-workspace'), (8, ''), (8, 'relative-log'), (4, '/bad\x00command')]
            for index, value in changes:
                endpoint = self.legacy_endpoint(wrapped)
                endpoint[offset + index] = value
                cases.append(endpoint)
        for index, value in [(0, ''), (1, ''), (1, 'relative-helper'), (2, 'check'),
                             (3, '--other'), (4, 'relative-registry'), (5, '--other-key'),
                             (6, 'new'), (7, '-')]:
            endpoint = self.legacy_endpoint(True)
            endpoint[index] = value
            cases.append(endpoint)
        for endpoint in cases:
            with self.subTest(endpoint=endpoint):
                before = self.set_endpoint(endpoint)
                self.configure(before, expected=2)
                self.assertEqual(self.snapshot(), before)

    def test_effort_only_change_preserves_model_and_history(self):
        self.configure(model='old', effort='low')
        current = self.snapshot()
        self.assertEqual(current['model'], 'old')
        self.assertEqual(current['effort'], 'low')
        self.assertEqual(json.loads(current['endpoint'])[15], 'low')
        for key in ('parent', 'native', 'workspace', 'branch', 'base',
                    'observedHarness', 'observedModel', 'observedEffort'):
            self.assertEqual(current[key], self.original[key])

    def test_unrelated_conductor_cannot_configure_child(self):
        self.call('attach', 'unrelated', 'omp', '', '', expected=0)
        self.call('role', 'unrelated', 'principal-conductor', expected=0)
        self.configure(requester='unrelated', expected=2)
        self.assertEqual(self.snapshot(), self.original)

    def test_retained_recovery_refuses_even_when_observer_is_absent_or_failed(self):
        # Synthetic retained files exercise only br_recovery's read contract.
        # Native C layouts match the fixture host ABI; no keeper or provider starts.
        class ManifestHeader(ctypes.Structure):
            _fields_ = [('magic', ctypes.c_char * 8), ('lengths', ctypes.c_uint64 * 6),
                        ('keep_stdin', ctypes.c_uint32), ('reserved', ctypes.c_uint32)]

        class Birth(ctypes.Structure):
            _fields_ = [('pid', ctypes.c_int32), ('first', ctypes.c_uint64),
                        ('second', ctypes.c_uint64)]

        directory = self.root / 'retained\nattempt\n'
        directory.mkdir()
        recovery = [str(self.exe), '--recover-receive', str(self.db), 'child', 'pending', '0',
                    str(self.command), 'old', 'high', str(self.root), str(self.log),
                    'omp', str(directory), 'original-native']
        fields = [os.fsencode(self.command) + b'\0', os.fsencode(self.root),
                  b'', b'', b'\0'.join(os.fsencode(arg) for arg in recovery) + b'\0', b'']
        header = ManifestHeader()
        header.magic = b'BATONRP1'
        header.lengths[:] = [len(field) for field in fields]
        (directory / 'manifest').write_bytes(bytes(header) + b''.join(fields))
        (directory / 'native.birth').write_bytes(bytes(Birth()))
        (directory / 'launch').write_text('retained')
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('child','retained','retained',?,'exited')", (str(directory),))
        for failed, acknowledged in ((False, False), (True, False), (True, True)):
            with self.subTest(observer_failed=failed, input_acknowledged=acknowledged):
                receipt = 'external-ack' if acknowledged else None
                with sqlite3.connect(self.db) as db:
                    db.execute("UPDATE messages SET receipt=? WHERE id='pending'", (receipt,))
                if failed:
                    (directory / 'observer-error').write_text('2: observer executable missing\n')
                run = self.configure(expected=2)
                answer = json.loads(run.stderr)
                self.assertEqual(answer['status'], 'configuration-recovery-required')
                self.assertFalse(answer['configurationApplied'])
                self.assertEqual(answer['blocked'], {'database': str(self.db), 'session': 'child',
                                                     'requester': 'parent', 'directory': str(directory)})
                # This fixture has an empty parent endpoint and no live observer.
                # Receive must surface unavailable delivery; Done alone is insufficient.
                self.assertEqual(answer['handoff']['kind'], 'failed')
                self.assertIsInstance(answer['handoff']['code'], int)
                self.assertTrue(answer['handoff']['error'])
                self.assertEqual(self.snapshot(), self.original)
                self.assertTrue((directory / 'manifest').exists())
                self.assertFalse((directory / 'acknowledged').exists())
                with sqlite3.connect(self.db) as db:
                    self.assertEqual(db.execute("SELECT body,receipt FROM messages WHERE id='pending'").fetchone(), ('original pending input', receipt))
                    self.assertEqual(db.execute('SELECT event FROM turns').fetchall(), [('original event',)])

    def test_nul_retained_directory_refuses_before_recovery(self):
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('child','retained','retained',?,'exited')", ('/attempt\x00suffix',))
        run = self.configure(expected=2)
        self.assertIn('Retained directory row is unsupported or malformed', run.stderr)
        self.assertEqual(self.snapshot(), self.original)

    def test_revision_route_and_history(self):
        answer = self.configure()
        self.assertEqual(answer['status'], 'configured')
        self.assertFalse(answer['providerStarted'])
        current = self.snapshot()
        endpoint = json.loads(current['endpoint'])
        self.assertEqual(endpoint, ['node', str(self.helper), 'launch', '--registry', str(self.registry),
                         '--model-key', 'new', '--', str(self.exe), str(self.db), 'receive-configured',
                         'child', '1', 'omp', 'new', 'high', str(self.command), str(self.log)])
        for key in ('parent', 'workspace', 'branch', 'base', 'native', 'observedHarness', 'observedModel', 'observedEffort'):
            self.assertEqual(current[key], self.original[key])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute("SELECT body,receipt FROM messages WHERE id='pending'").fetchone(), ('original pending input', None))
            self.assertEqual(db.execute('SELECT event FROM turns').fetchall(), [('original event',)])
        self.configure(expected=2)
        self.assertEqual(self.snapshot(), current)
        self.configure(current, model='old')
        self.assertEqual(json.loads(self.snapshot()['endpoint'])[12], '2')

    def test_authority_native_harness_and_snapshot_refusals(self):
        self.configure(requester='child', expected=2)
        self.configure(harness='codex', expected=2)
        changed = dict(self.original, workspace='/different')
        self.configure(changed, expected=2)
        self.assertEqual(self.snapshot(), self.original)

    def test_busy_guard_refuses_and_release_allows_the_same_request(self):
        path = Path(str(self.db) + '.lock-' + 'child'.encode().hex())
        with path.open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.configure(expected=2)
        self.configure()

    def test_live_execution_refuses(self):
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO executions(session,id,mode,directory,phase) VALUES('child','active','direct','','starting')")
        self.configure(expected=2)
        self.assertEqual(self.snapshot(), self.original)

    def test_terminal_stop_refuses(self):
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO session_stops(session,id,reason,outcome) VALUES('child','stop','retain work','stopped')")
        self.configure(expected=2)
        self.assertEqual(self.snapshot(), self.original)

    def test_empty_native_allows_explicit_harness_change(self):
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE sessions SET native='' WHERE id='child'")
        current = self.snapshot()
        self.configure(current, harness='codex')
        changed = self.snapshot()
        self.assertEqual(changed['harness'], 'codex')
        self.assertEqual(changed['native'], '')
        self.assertEqual(changed['observedHarness'], current['observedHarness'])

    def test_legacy_writers_preserve_configured_revision(self):
        self.configure()
        current = self.snapshot()
        self.call('receiver', 'child', str(self.command), str(self.log), expected=2)
        self.call('connect', 'child', 'replacement-native', '', expected=2)
        self.assertNotEqual(self.call('attach', 'child', 'omp', '', '').returncode, 0)
        task = self.root / 'task.txt'
        task.write_text('Retain the child assignment.')
        self.assertNotEqual(self.call('start', 'child', 'omp', str(self.command), 'old', 'high',
                                     str(self.root), str(self.log), 'new-task', str(task)).returncode, 0)
        self.assertEqual(self.snapshot(), current)

    def test_reserved_endpoint_injection_and_corrupt_revision_refuse(self):
        reserved = ['node', '/helper', 'launch', '--registry', '/registry', '--model-key', 'new', '--',
                    '/baton', '/db', 'receive-configured']
        self.call('connect', 'child', 'replacement-native', json.dumps(reserved), expected=2)
        self.assertEqual(self.snapshot(), self.original)
        self.configure()
        complete = json.loads(self.snapshot()['endpoint'])
        for revision in ('0', '01', '9223372036854775807', '9223372036854775808', 'broken'):
            corrupted = list(complete)
            corrupted[12] = revision
            with sqlite3.connect(self.db) as db:
                db.execute("UPDATE sessions SET endpoint=? WHERE id='child'", (json.dumps(corrupted),))
            expected = self.snapshot()
            self.configure(expected, expected=2)
            self.assertEqual(self.snapshot(), expected)
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE sessions SET endpoint=? WHERE id='child'", ('["receive-configured",',))
        expected = self.snapshot()
        self.configure(expected, expected=2)
        self.call('connect', 'child', '', '', expected=2)
        self.assertEqual(self.snapshot(), expected)

    def test_transaction_failure_retains_submission_and_guarded_readback(self):
        with sqlite3.connect(self.db) as db:
            db.execute("CREATE TRIGGER refuse_change BEFORE UPDATE OF model ON sessions BEGIN SELECT RAISE(ABORT,'fixture-write-refused'); END")
        run = self.configure(expected=2)
        answer = json.loads(run.stderr)
        self.assertEqual(answer['status'], 'configuration-outcome-unknown')
        self.assertIsNone(answer['configurationApplied'])
        self.assertEqual(answer['reconciliation']['observed'], 'prior-assignment')
        self.assertEqual(answer['submittedEndpoint'][12], '1')
        self.assertIn('fixture-write-refused', answer['cause'])
        self.assertEqual(self.snapshot(), self.original)
        with sqlite3.connect(self.db) as db:
            db.execute('DROP TRIGGER refuse_change')
        self.configure()

    def test_duplicate_snapshot_member_and_unmapped_model_refuse(self):
        duplicate = json.dumps(self.original)[:-1] + ',"model":"old"}'
        self.call('receiver-route', 'child', 'parent', duplicate, 'omp', 'new', 'high',
                  str(self.command), str(self.log), '--apply', expected=2)
        escaped_duplicate = json.dumps(self.original)[:-1] + ',"m\\u006fdel":"old"}'
        self.call('receiver-route', 'child', 'parent', escaped_duplicate, 'omp', 'new', 'high',
                  str(self.command), str(self.log), '--apply', expected=2)
        self.configure(model='unmapped', expected=2)
        self.assertEqual(self.snapshot(), self.original)


if __name__ == '__main__':
    unittest.main()
