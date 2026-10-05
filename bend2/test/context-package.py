"""Context package manifest, lockfile and staged-bytes gate controls.

The static tests verify the single dependency pin pair and the lockfile
closure shape. The functional tests stage the lockfile-resolved bytes into a
private payload, run the packaged gate from inside it, and prove that a
missing staged dependency refuses even with a working ancestor bait package
and that a NODE_PATH bait cannot replace the staged bytes.
"""
import base64
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import urllib.request
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTEXT = ROOT / 'bend2/context'
SPEC = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
PINS = {'ajv': '8.17.1', 'typescript': '5.9.3', 'zod': '4.3.6'}
# Independently provisioned exact-floor executable; override with CONTEXT_NODE22.
NODE22_CANDIDATES = (
    pathlib.Path('/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/'
                 '.scratch/semantic-context-20261005/probes/native-package-critic/toolchain/'
                 'node-v22.15.0-darwin-arm64/bin/node'),
)
TARBALL_CACHE = ROOT / '.scratch/bend2/context-deps/tarballs'


def write_manifest(directory, manifest):
    (directory / 'package.json').write_text(json.dumps(manifest, indent=2) + '\n')
    shutil.copyfile(CONTEXT / 'package-lock.json', directory / 'package-lock.json')


def write_lock(directory, lock):
    (directory / 'package-lock.json').write_text(json.dumps(lock, indent=2) + '\n')
    shutil.copyfile(CONTEXT / 'package.json', directory / 'package.json')


def cached_tarballs():
    """Return {name: path} of lockfile-resolved tarballs, cached by integrity."""
    entries = PACKAGE.context_lockfile()
    TARBALL_CACHE.mkdir(parents=True, exist_ok=True)
    paths = {}
    for name, row in sorted(entries.items()):
        path = TARBALL_CACHE / (name + '.tgz')
        expected = row['integrity'][len('sha512-'):]
        if path.is_file():
            digest = base64.b64encode(hashlib.sha512(path.read_bytes()).digest()).decode('ascii')
            if digest == expected:
                paths[name] = path
                continue
        with urllib.request.urlopen(row['resolved'], timeout=300) as response:
            data = response.read()
        digest = base64.b64encode(hashlib.sha512(data).digest()).decode('ascii')
        if digest != expected:
            raise AssertionError('registry bytes do not match the lockfile integrity: ' + name)
        path.write_bytes(data)
        paths[name] = path
    return paths


def build_payload(directory):
    entries = PACKAGE.context_lockfile()
    PACKAGE.stage_context_sources(directory)
    for name, tarball in cached_tarballs().items():
        PACKAGE.extract_context_dependency(directory, name, tarball)
    digests = {name: PACKAGE.context_tree_digest(
        directory / PACKAGE.CONTEXT_STAGE_ROOT / 'node_modules' / name) for name in entries}
    closure = PACKAGE.context_closure_manifest(entries, digests)
    (directory / PACKAGE.CONTEXT_STAGE_ROOT / 'dependency-closure.json').write_text(
        json.dumps(closure, indent=2, sort_keys=True) + '\n')
    PACKAGE.stage_context_notices(directory, entries)
    return entries


class ContextPackageInput(unittest.TestCase):
    def test_manifest_pins_exact_approved_set(self):
        manifest = PACKAGE.context_package_manifest()
        self.assertEqual(manifest['dependencies'], PINS)
        self.assertEqual(manifest['engines'], {'node': '>=22.15.0'})
        self.assertTrue(manifest['private'])
        self.assertEqual(manifest['type'], 'module')

    def test_lock_pins_exact_versions_from_registry(self):
        entries = PACKAGE.context_lockfile()
        for name, version in PINS.items():
            self.assertEqual(entries[name]['version'], version)
            self.assertTrue(entries[name]['resolved'].startswith('https://registry.npmjs.org/'))
        # Ajv's resolved transitive closure is carried by the lock itself.
        self.assertIn('fast-uri', entries)

    def test_lock_rejects_range_specifier(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = pathlib.Path(scratch)
            manifest = json.loads((CONTEXT / 'package.json').read_text())
            manifest['dependencies']['typescript'] = '^5.9.3'
            write_manifest(directory, manifest)
            with self.assertRaises(RuntimeError):
                PACKAGE.context_package_manifest(directory)

    def test_lock_rejects_unapproved_dependency(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = pathlib.Path(scratch)
            manifest = json.loads((CONTEXT / 'package.json').read_text())
            manifest['dependencies']['lodash'] = '4.17.21'
            write_manifest(directory, manifest)
            with self.assertRaises(RuntimeError):
                PACKAGE.context_package_manifest(directory)

    def test_lock_rejects_missing_integrity(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = pathlib.Path(scratch)
            lock = json.loads((CONTEXT / 'package-lock.json').read_text())
            del lock['packages']['node_modules/zod']['integrity']
            write_lock(directory, lock)
            with self.assertRaises(RuntimeError):
                PACKAGE.context_lockfile(directory)

    def test_lock_rejects_wrong_lockfile_version(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = pathlib.Path(scratch)
            lock = json.loads((CONTEXT / 'package-lock.json').read_text())
            lock['lockfileVersion'] = 2
            write_lock(directory, lock)
            with self.assertRaises(RuntimeError):
                PACKAGE.context_lockfile(directory)

    def test_lock_rejects_incomplete_closure(self):
        with tempfile.TemporaryDirectory() as scratch:
            directory = pathlib.Path(scratch)
            lock = json.loads((CONTEXT / 'package-lock.json').read_text())
            del lock['packages']['node_modules/fast-uri']
            write_lock(directory, lock)
            with self.assertRaises(RuntimeError):
                PACKAGE.context_lockfile(directory)

    def test_receipt_log_selection_covers_files_only(self):
        with tempfile.TemporaryDirectory() as scratch:
            logs = pathlib.Path(scratch)
            expected = ['context-gate-host.json', 'context-gate-host.payload-after.json',
                        'context-gate-host.stdout', 'context-node-version-host.json']
            for name in expected:
                (logs / name).write_text('x')
            (logs / 'context-gate-home-host').mkdir()
            (logs / 'context-dependencies').mkdir()
            (logs / 'context-dependencies' / 'ajv.tgz').write_text('x')
            self.assertEqual([path.name for path in PACKAGE.context_receipt_logs(logs)],
                             expected)


class ContextPackagedBytes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.scratch = tempfile.TemporaryDirectory(prefix='baton2-context-package-')
        cls.host_root = pathlib.Path(cls.scratch.name) / 'host'
        cls.host_root.mkdir()
        cls.entries = build_payload(cls.host_root)
        cls.logs = pathlib.Path(cls.scratch.name) / 'logs'
        cls.logs.mkdir()
        cls.host_node = shutil.which('node')
        if cls.host_node is None:
            raise unittest.SkipTest('no node executable on PATH')
        node22 = os.environ.get('CONTEXT_NODE22')
        if node22:
            cls.node22 = pathlib.Path(node22)
        else:
            cls.node22 = next((path for path in NODE22_CANDIDATES if path.is_file()), None)
        gate, text = PACKAGE.run_context_gate(cls.host_root, cls.logs,
                                              pathlib.Path(cls.host_node), 'host')
        if gate['exit_code'] != 0:
            detail = (cls.logs / 'context-gate-host.stderr').read_text(errors='replace')
            raise AssertionError('packaged gate failed on host node: ' + detail)
        cls.report = PACKAGE.require_gate_report(text, len(cls.entries))

    @classmethod
    def tearDownClass(cls):
        cls.scratch.cleanup()

    def test_gate_proves_useful_staged_projections(self):
        versions = [stage['version'] for stage in self.report['stages']]
        self.assertEqual(versions, ['8.17.1', '4.3.6', '5.9.3'])
        self.assertTrue(self.report['closure']['digestsVerified'])
        typescript = self.report['stages'][2]
        self.assertEqual(typescript['resolvedDeclarationType'], '(name: string) => string')
        self.assertEqual(typescript['messageType'], 'string')
        gate_receipt = json.loads(
            (self.logs / 'context-gate-host.json').read_text())
        self.assertEqual(gate_receipt['node']['version'], subprocess_version(self.host_node))
        self.assertTrue(gate_receipt['payloadSnapshot']['equal'])
        for side in ('before', 'after'):
            snapshot = self.logs / gate_receipt['payloadSnapshot'][side]['path']
            self.assertEqual(hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                             gate_receipt['payloadSnapshot'][side]['sha256'])

    def test_gate_runs_on_exact_node22_floor(self):
        if self.node22 is None:
            self.skipTest('no exact Node 22.15.0 executable available; set CONTEXT_NODE22')
        version = subprocess_version(self.node22)
        if version != 'v22.15.0':
            self.skipTest('CONTEXT_NODE22 is not v22.15.0: ' + version)
        gate, text = PACKAGE.run_context_gate(self.host_root, self.logs, self.node22, 'node22.15.0')
        self.assertEqual(gate['exit_code'], 0,
                         (self.logs / 'context-gate-node22.15.0.stderr').read_text(errors='replace'))
        report = PACKAGE.require_gate_report(text, len(self.entries))
        self.assertTrue(report['closure']['digestsVerified'])

    def test_missing_staged_transitive_refuses_with_ancestor_bait(self):
        bait_root = pathlib.Path(self.scratch.name) / 'bait'
        shutil.copytree(self.host_root, bait_root)
        modules = bait_root / PACKAGE.CONTEXT_STAGE_ROOT / 'node_modules'
        shutil.rmtree(modules / 'fast-deep-equal')
        ancestor = bait_root / 'node_modules' / 'fast-deep-equal'
        ancestor.mkdir(parents=True)
        (ancestor / 'package.json').write_text(json.dumps(
            {'name': 'fast-deep-equal', 'version': '3.1.3', 'main': 'index.js'}))
        (ancestor / 'index.js').write_text('module.exports = {eq: () => true};')
        gate, _ = PACKAGE.run_context_gate(bait_root, self.logs,
                                           pathlib.Path(self.host_node), 'bait-missing-transitive')
        self.assertEqual(gate['exit_code'], 2)
        refusal = json.loads((self.logs / 'context-gate-bait-missing-transitive.stderr').read_text())
        self.assertIn('fast-deep-equal', refusal['error']['detail'])

    def test_nodepath_bait_cannot_replace_staged_bytes(self):
        bait = pathlib.Path(self.scratch.name) / 'nodepath-bait' / 'node_modules' / 'zod'
        bait.mkdir(parents=True, exist_ok=True)
        (bait / 'package.json').write_text(json.dumps({'name': 'zod', 'version': '9.9.9'}))
        (bait / 'index.mjs').write_text('export const z = {};')
        gate, text = PACKAGE.run_context_gate(
            self.host_root, self.logs, pathlib.Path(self.host_node), 'nodepath-bait',
            {'NODE_PATH': str(bait.parents[1])})
        self.assertEqual(gate['exit_code'], 0,
                         (self.logs / 'context-gate-nodepath-bait.stderr').read_text(errors='replace'))
        report = PACKAGE.require_gate_report(text, len(self.entries))
        self.assertEqual(report['stages'][1]['version'], '4.3.6')

    def test_gate_refuses_changed_node_identity(self):
        real = pathlib.Path(self.host_node).resolve()
        wrapper = pathlib.Path(self.scratch.name) / 'changing-node.sh'
        state = pathlib.Path(self.scratch.name) / 'changing-node.state'
        # Only --version calls observe the state file; the gate child always
        # runs the real staged gate through the real node.
        wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" = "--version" ]; then\n'
                           '  if [ -f "' + str(state) + '" ]; then echo v9.8.7; exit 0; fi\n'
                           '  : > "' + str(state) + '"\n'
                           'fi\n'
                           'exec "' + str(real) + '" "$@"\n')
        wrapper.chmod(0o755)
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(self.host_root, self.logs, wrapper, 'changed-node')
        self.assertIn('different version', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-changed-node.json').read_text())
        self.assertEqual(receipt['node']['version'], subprocess_version(real))
        self.assertTrue(receipt['node']['postIdentity']['available'])
        self.assertEqual(receipt['node']['versionAfter'], 'v9.8.7')
        self.assertTrue(receipt['nodeVersionChanged'])
        self.assertFalse(receipt['nodeIdentityChanged'])
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['payloadSnapshot']['equal'])
        PACKAGE.require_gate_report(
            (self.logs / 'context-gate-changed-node.stdout').read_text(), len(self.entries))
        self.assertGreater((self.logs / 'context-node-version-changed-node.json').stat().st_size, 0)
        self.assertGreater(
            (self.logs / 'context-node-version-changed-node-after.json').stat().st_size, 0)

    def test_gate_refuses_failed_post_probe(self):
        real = pathlib.Path(self.host_node).resolve()
        wrapper = pathlib.Path(self.scratch.name) / 'failing-post-node.sh'
        state = pathlib.Path(self.scratch.name) / 'failing-post-node.state'
        # The second --version probe fails; the gate child still runs the real
        # staged gate and its evidence must be retained with the refusal.
        wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" = "--version" ]; then\n'
                           '  if [ -f "' + str(state) + '" ]; then echo boom >&2; exit 7; fi\n'
                           '  : > "' + str(state) + '"\n'
                           'fi\n'
                           'exec "' + str(real) + '" "$@"\n')
        wrapper.chmod(0o755)
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(self.host_root, self.logs, wrapper, 'failing-post-node')
        self.assertIn('is unavailable', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-failing-post-node.json').read_text())
        self.assertFalse(receipt['node']['postIdentity']['available'])
        self.assertIn('context-node-version-failing-post-node-after.json',
                      receipt['node']['postIdentity']['error'])
        probe_receipt = json.loads(
            (self.logs / 'context-node-version-failing-post-node-after.json').read_text())
        self.assertEqual(probe_receipt['exit_code'], 7)
        self.assertIsNone(receipt['nodeVersionChanged'])
        self.assertIsNone(receipt['nodeIdentityChanged'])
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['payloadSnapshot']['equal'])
        PACKAGE.require_gate_report(
            (self.logs / 'context-gate-failing-post-node.stdout').read_text(), len(self.entries))

    def test_gate_refuses_removed_post_executable(self):
        real = pathlib.Path(self.host_node).resolve()
        wrapper = pathlib.Path(self.scratch.name) / 'vanishing-node.sh'
        # The gate child removes the wrapper before executing the real node,
        # so the post-identity probe finds no executable at all.
        wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" != "--version" ]; then\n'
                           '  rm -f "' + str(wrapper) + '"\n'
                           'fi\n'
                           'exec "' + str(real) + '" "$@"\n')
        wrapper.chmod(0o755)
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(self.host_root, self.logs, wrapper, 'vanishing-node')
        self.assertIn('is unavailable', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-vanishing-node.json').read_text())
        self.assertFalse(receipt['node']['postIdentity']['available'])
        self.assertIsNone(receipt['node']['versionAfter'])
        self.assertIsNone(receipt['nodeVersionChanged'])
        self.assertIsNone(receipt['nodeIdentityChanged'])
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['payloadSnapshot']['equal'])
        PACKAGE.require_gate_report(
            (self.logs / 'context-gate-vanishing-node.stdout').read_text(), len(self.entries))

    def test_gate_refuses_unspawnable_child(self):
        real = pathlib.Path(self.host_node).resolve()
        wrapper = pathlib.Path(self.scratch.name) / 'unspawnable-node.sh'
        # The pre-probe removes every execute bit while retaining read
        # permission, so the identity byte read still completes, the gate
        # child cannot be spawned, and the post probe fails independently.
        wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" = "--version" ]; then\n'
                           '  chmod 444 "' + str(wrapper) + '"\n'
                           'fi\n'
                           'exec "' + str(real) + '" "$@"\n')
        wrapper.chmod(0o755)
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(self.host_root, self.logs, wrapper, 'unspawnable-node')
        self.assertIn('could not be spawned', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-unspawnable-node.json').read_text())
        self.assertIs(receipt['child']['spawned'], False)
        self.assertEqual(receipt['child']['stage'], 'unspawned')
        self.assertIn('PermissionError', receipt['child']['error'])
        self.assertIsNone(receipt['exit_code'])
        self.assertIsNone(receipt['signal'])
        self.assertTrue(receipt['stdout']['available'])
        self.assertTrue(receipt['stderr']['available'])
        self.assertFalse(receipt['node']['postIdentity']['available'])
        self.assertIsNone(receipt['nodeVersionChanged'])
        self.assertIsNone(receipt['nodeIdentityChanged'])
        self.assertTrue(receipt['payloadSnapshot']['equal'])
        self.assertTrue(
            (self.logs / 'context-gate-unspawnable-node.payload-before.json').is_file())
        self.assertTrue(
            (self.logs / 'context-gate-unspawnable-node.payload-after.json').is_file())

    def test_gate_records_signal_termination(self):
        real = pathlib.Path(self.host_node).resolve()
        wrapper = pathlib.Path(self.scratch.name) / 'terminating-node.sh'
        # The gate child terminates itself with SIGTERM before executing the
        # real node; the version probes are unaffected.
        wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" != "--version" ]; then\n'
                           '  kill -TERM $$\n'
                           'fi\n'
                           'exec "' + str(real) + '" "$@"\n')
        wrapper.chmod(0o755)
        gate, text = PACKAGE.run_context_gate(self.host_root, self.logs,
                                              wrapper, 'signalled-node')
        self.assertEqual(gate['exit_code'], -15)
        self.assertEqual(gate['signal'], 'SIGTERM')
        self.assertTrue(gate['child']['spawned'])
        self.assertTrue(gate['node']['postIdentity']['available'])
        self.assertTrue(gate['payloadSnapshot']['equal'])
        self.assertEqual((self.logs / 'context-gate-signalled-node.stdout').stat().st_size, 0)
        self.assertFalse(text.strip())

    def test_run_context_gates_refuses_signalled_child(self):
        real = pathlib.Path(self.host_node).resolve()
        bindir = pathlib.Path(self.scratch.name) / 'signalled-bin'
        bindir.mkdir()
        node_entry = bindir / 'node'
        node_entry.write_text('#!/bin/sh\n'
                              'if [ "$1" != "--version" ]; then\n'
                              '  kill -TERM $$\n'
                              'fi\n'
                              'exec "' + str(real) + '" "$@"\n')
        node_entry.chmod(0o755)
        logs = pathlib.Path(self.scratch.name) / 'logs-gates-refusal'
        logs.mkdir()

        class Args:
            context_node22 = None
        patched = {'PATH': str(bindir) + os.pathsep + os.environ.get('PATH', '')}
        with mock.patch.dict(os.environ, patched):
            with self.assertRaises(RuntimeError) as caught:
                PACKAGE.run_context_gates(self.host_root, logs, Args(), self.entries)
        self.assertIn('failed on the host Node', str(caught.exception))
        receipt = json.loads((logs / 'context-gate-host.json').read_text())
        self.assertEqual(receipt['exit_code'], -15)
        self.assertEqual(receipt['signal'], 'SIGTERM')
        self.assertTrue(receipt['child']['spawned'])
        # The wrapper answers --version with the real node both times, so the
        # post probe succeeds and both identity flags are False, not None.
        self.assertIs(receipt['nodeVersionChanged'], False)
        self.assertIs(receipt['nodeIdentityChanged'], False)

    def test_gate_records_started_child_with_unknown_outcome(self):
        real = pathlib.Path(self.host_node).resolve()
        real_popen = subprocess.Popen
        created = []

        class FakeOutcomeProcess:
            def __init__(self):
                self.args = [str(real), 'context-package-gate.mjs']
                self.killed = False
                self.reaped = False

            def wait(self):
                if not self.killed:
                    raise KeyboardInterrupt
                self.reaped = True
                return -9

            def kill(self):
                self.killed = True

        def fake_popen(argv, **kwargs):
            if argv[-1] == 'context-package-gate.mjs':
                process = FakeOutcomeProcess()
                created.append(process)
                return process
            return real_popen(argv, **kwargs)

        # The fake process evidences cleanup method calls only; no OS child is
        # actually killed or reaped by this fixture.
        with mock.patch.object(PACKAGE.subprocess, 'Popen', fake_popen):
            with self.assertRaises(KeyboardInterrupt):
                PACKAGE.run_context_gate(self.host_root, self.logs, real, 'outcome-unknown')
        self.assertEqual(len(created), 1)
        self.assertTrue(created[0].killed)
        self.assertTrue(created[0].reaped)
        receipt = json.loads((self.logs / 'context-gate-outcome-unknown.json').read_text())
        self.assertIs(receipt['child']['spawned'], True)
        self.assertEqual(receipt['child']['stage'], 'started-outcome-unknown')
        self.assertIn('KeyboardInterrupt', receipt['child']['error'])
        self.assertEqual(receipt['child']['cleanup'],
                         {'killCompleted': True, 'reapReturncode': -9})
        self.assertIsNone(receipt['exit_code'])
        self.assertIsNone(receipt['signal'])
        self.assertTrue(receipt['payloadSnapshot']['equal'])
        self.assertEqual(receipt['evidenceErrors'], [])

    def test_gate_preserves_interrupt_with_chained_write_failure(self):
        real = pathlib.Path(self.host_node).resolve()
        real_popen = subprocess.Popen

        class InterruptingWait:
            args = [str(real), 'context-package-gate.mjs']

            def wait(self):
                raise KeyboardInterrupt

            def kill(self):
                pass

        def fake_popen(argv, **kwargs):
            if argv[-1] == 'context-package-gate.mjs':
                return InterruptingWait()
            return real_popen(argv, **kwargs)

        real_write = PACKAGE.write_json

        def failing_write(path, value):
            if path.name == 'context-gate-write-interrupt.json':
                raise OSError('receipt write refused')
            real_write(path, value)

        with mock.patch.object(PACKAGE.subprocess, 'Popen', fake_popen):
            with mock.patch.object(PACKAGE, 'write_json', failing_write):
                with self.assertRaises(KeyboardInterrupt) as caught:
                    PACKAGE.run_context_gate(self.host_root, self.logs, real, 'write-interrupt')
        self.assertIs(type(caught.exception), KeyboardInterrupt)
        self.assertIsInstance(caught.exception.__cause__, OSError)
        # Raw evidence files survive even though the receipt write failed.
        self.assertTrue((self.logs / 'context-gate-write-interrupt.stdout').is_file())
        self.assertTrue(
            (self.logs / 'context-gate-write-interrupt.payload-before.json').is_file())

    def test_gate_records_cleanup_failure_during_interrupt(self):
        real = pathlib.Path(self.host_node).resolve()
        real_popen = subprocess.Popen
        created = []
        original_interrupt = KeyboardInterrupt()
        reap_interrupt = KeyboardInterrupt()

        class KillFailsProcess:
            def __init__(self):
                self.args = [str(real), 'context-package-gate.mjs']
                self.wait_calls = 0

            def wait(self):
                self.wait_calls += 1
                if self.wait_calls == 1:
                    raise original_interrupt
                # The reap wait raises a DIFFERENT interrupt instance; the
                # re-raised exception must be the original object.
                raise reap_interrupt

            def kill(self):
                raise OSError('kill refused')

        def fake_popen(argv, **kwargs):
            if argv[-1] == 'context-package-gate.mjs':
                process = KillFailsProcess()
                created.append(process)
                return process
            return real_popen(argv, **kwargs)

        # The fake process evidences cleanup method calls only; the kill
        # failure must not mask the original wait interruption and the
        # unknown settlement is retained in the receipt evidence.
        with mock.patch.object(PACKAGE.subprocess, 'Popen', fake_popen):
            with self.assertRaises(KeyboardInterrupt) as caught:
                PACKAGE.run_context_gate(self.host_root, self.logs, real, 'cleanup-failure')
        # The raised object IS the original wait interruption; the separate
        # reap interrupt instance did not replace it.
        self.assertIs(caught.exception, original_interrupt)
        self.assertIsNot(caught.exception, reap_interrupt)
        self.assertEqual(len(created), 1)
        receipt = json.loads((self.logs / 'context-gate-cleanup-failure.json').read_text())
        self.assertIs(receipt['child']['spawned'], True)
        self.assertEqual(receipt['child']['stage'], 'started-outcome-unknown')
        self.assertIn('KeyboardInterrupt', receipt['child']['error'])
        self.assertIsNone(receipt['exit_code'])
        self.assertIsNone(receipt['signal'])
        self.assertIn('kill refused', receipt['child']['cleanup']['kill'])
        self.assertIn(repr(reap_interrupt), receipt['child']['cleanup']['reap'])
        self.assertNotIn('killCompleted', receipt['child']['cleanup'])
        self.assertTrue(any('kill refused' in row for row in receipt['evidenceErrors']))
        self.assertTrue(any('child cleanup after interruption' in row
                            for row in receipt['evidenceErrors']))

    def test_gate_refuses_failed_before_snapshot_retention(self):
        real = pathlib.Path(self.host_node).resolve()
        real_write = PACKAGE.write_json

        def failing_write(path, value):
            if path.name.endswith('payload-before.json'):
                raise OSError('before snapshot refused')
            real_write(path, value)

        with mock.patch.object(PACKAGE, 'write_json', failing_write):
            with self.assertRaises(RuntimeError) as caught:
                PACKAGE.run_context_gate(self.host_root, self.logs, real, 'before-fail')
        self.assertIn('snapshot evidence is incomplete', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-before-fail.json').read_text())
        self.assertFalse(receipt['payloadSnapshot']['before']['available'])
        self.assertIn('before snapshot refused', receipt['payloadSnapshot']['before']['error'])
        self.assertTrue(receipt['payloadSnapshot']['after']['available'])
        self.assertIn('before-payload snapshot write failed', receipt['evidenceErrors'][0])
        self.assertTrue(receipt['child']['spawned'])
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['node']['postIdentity']['available'])

    def test_gate_refuses_unavailable_raw_stream(self):
        real = pathlib.Path(self.host_node).resolve()
        # A directory at the stderr stream path makes its open fail with a
        # real OSError while the stdout stream opens normally.
        (self.logs / 'context-gate-stderr-dir.stderr').mkdir()
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(self.host_root, self.logs, real, 'stderr-dir')
        self.assertIn('did not complete', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-stderr-dir.json').read_text())
        self.assertEqual(receipt['child']['stage'], 'streams-unavailable')
        self.assertIs(receipt['child']['spawned'], False)
        self.assertIsNone(receipt['exit_code'])
        self.assertIsNone(receipt['signal'])
        self.assertFalse(receipt['stderr']['available'])
        self.assertIn('IsADirectoryError', receipt['stderr']['error'])
        self.assertTrue(receipt['stdout']['available'])
        self.assertTrue(receipt['payloadSnapshot']['equal'])

    def test_gate_refuses_failed_after_snapshot_retention(self):
        real = pathlib.Path(self.host_node).resolve()
        real_write = PACKAGE.write_json

        def failing_write(path, value):
            if path.name.endswith('payload-after.json'):
                raise OSError('after snapshot refused')
            real_write(path, value)

        with mock.patch.object(PACKAGE, 'write_json', failing_write):
            with self.assertRaises(RuntimeError) as caught:
                PACKAGE.run_context_gate(self.host_root, self.logs, real, 'after-fail')
        self.assertIn('snapshot evidence is incomplete', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-after-fail.json').read_text())
        self.assertTrue(receipt['payloadSnapshot']['before']['available'])
        self.assertFalse(receipt['payloadSnapshot']['after']['available'])
        self.assertIn('after snapshot refused', receipt['payloadSnapshot']['after']['error'])
        self.assertIn('after-payload snapshot write failed', receipt['evidenceErrors'][0])
        self.assertIsNone(receipt['payloadSnapshot']['equal'])
        self.assertTrue(receipt['child']['spawned'])
        self.assertEqual(receipt['exit_code'], 0)

    def test_gate_refuses_close_failure_after_successful_gate(self):
        real = pathlib.Path(self.host_node).resolve()
        real_open = pathlib.Path.open

        class CloseFailsHandle:
            def __init__(self, handle):
                self._handle = handle

            def fileno(self):
                return self._handle.fileno()

            def flush(self):
                return self._handle.flush()

            def close(self):
                # Flush and close the real stream, then fail the wrapper close
                # so the gate itself keeps its output while the close is a
                # recorded evidence failure.
                self._handle.flush()
                self._handle.close()
                raise OSError('stderr close refused')

        def selective_open(path, mode='r', *args, **kwargs):
            handle = real_open(path, mode, *args, **kwargs)
            if path.name == 'context-gate-close-fail.stderr' and mode == 'wb':
                return CloseFailsHandle(handle)
            return handle

        with mock.patch.object(pathlib.Path, 'open', selective_open):
            with self.assertRaises(RuntimeError) as caught:
                PACKAGE.run_context_gate(self.host_root, self.logs, real, 'close-fail')
        self.assertIn('evidence retention reported errors', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-close-fail.json').read_text())
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['child']['spawned'])
        self.assertEqual(receipt['child']['stage'], 'completed')
        # Both stream and snapshot evidence are available; the refusal is
        # precisely the recorded close failure.
        self.assertTrue(receipt['stdout']['available'])
        self.assertTrue(receipt['stderr']['available'])
        self.assertTrue(receipt['payloadSnapshot']['before']['available'])
        self.assertTrue(receipt['payloadSnapshot']['after']['available'])
        self.assertTrue(receipt['payloadSnapshot']['equal'])
        self.assertTrue(receipt['node']['postIdentity']['available'])
        self.assertEqual(receipt['evidenceErrors'],
                         ['stream close failed: OSError("stderr close refused")'])
        self.assertIn('"baton2-context-package-gate"',
                      (self.logs / 'context-gate-close-fail.stdout').read_text())

    def test_gate_refuses_same_version_byte_drift(self):
        real = pathlib.Path(self.host_node).resolve()
        wrapper = pathlib.Path(self.scratch.name) / 'byte-drift-node.sh'
        # The gate child appends a byte to the wrapper itself, so the post
        # probe rehashes different bytes while the reported version matches.
        wrapper.write_text('#!/bin/sh\n'
                           'if [ "$1" != "--version" ]; then\n'
                           '  printf x >> "' + str(wrapper) + '"\n'
                           'fi\n'
                           'exec "' + str(real) + '" "$@"\n')
        wrapper.chmod(0o755)
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(self.host_root, self.logs, wrapper, 'byte-drift-node')
        self.assertIn('executable bytes changed', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-byte-drift-node.json').read_text())
        self.assertTrue(receipt['nodeIdentityChanged'])
        self.assertFalse(receipt['nodeVersionChanged'])
        self.assertEqual(receipt['node']['versionAfter'], receipt['node']['version'])
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['node']['postIdentity']['available'])
        self.assertTrue(receipt['payloadSnapshot']['equal'])

    def test_gate_refuses_payload_mutation(self):
        mutation_root = pathlib.Path(self.scratch.name) / 'mutation'
        shutil.copytree(self.host_root, mutation_root)
        staged_gate = mutation_root / PACKAGE.CONTEXT_STAGE_ROOT / 'context-package-gate.mjs'
        staged_gate.write_text('import fs from "node:fs";\n'
                               'fs.appendFileSync("dependency-closure.json", "// mutated\\n");\n')
        with self.assertRaises(RuntimeError) as caught:
            PACKAGE.run_context_gate(mutation_root, self.logs, pathlib.Path(self.host_node),
                                     'payload-mutation')
        self.assertIn('changed during the package gate', str(caught.exception))
        receipt = json.loads((self.logs / 'context-gate-payload-mutation.json').read_text())
        self.assertFalse(receipt['payloadSnapshot']['equal'])
        self.assertEqual(receipt['exit_code'], 0)
        self.assertTrue(receipt['node']['postIdentity']['available'])

    def test_staged_notices_include_explicit_third_party_terms(self):
        terms = PACKAGE.stage_context_notices(self.host_root, self.entries)
        sources = {row['source'] for row in terms['typescript']['files']}
        self.assertIn(PACKAGE.CONTEXT_STAGE_ROOT + '/node_modules/typescript/ThirdPartyNoticeText.txt',
                      sources)
        fast_uri = terms['fast-uri']
        self.assertEqual(fast_uri['license'], 'BSD-3-Clause')
        self.assertTrue(fast_uri['files'])
        for name in self.entries:
            self.assertTrue(terms[name]['files'], 'no staged notice for ' + name)


class ContextPackageComposition(unittest.TestCase):
    """Replays the exact package() composition order on a fresh payload and
    validates the manifest.build.context schema that packaging will embed."""

    def test_compose_context_matches_manifest_schema(self):
        scratch = tempfile.TemporaryDirectory(prefix='baton2-context-compose-')
        self.addCleanup(scratch.cleanup)
        root = pathlib.Path(scratch.name)
        payload = root / 'payload'
        # package() creates the payload root (bin/) before any staging.
        (payload / 'bin').mkdir(parents=True)
        logs = root / 'logs'
        logs.mkdir()
        entries = PACKAGE.context_lockfile()
        try:
            # Exact package() order: base notices stage first, then the
            # context composition adds its notices and runs the gates.
            PACKAGE.stage_notices(payload, [], 'development')

            class Args:
                context_node22 = None
            context = PACKAGE.compose_context(payload, logs, Args())
        except urllib.error.URLError as error:
            self.skipTest('npm registry unreachable: ' + repr(error))
        terms = context.pop('terms')
        self.assertEqual(set(context), {'pins', 'manifest', 'lockfile', 'dependencies',
                                        'stagedFirstParty', 'dependencyClosure', 'gate'})
        self.assertEqual(context['pins'], PINS)
        self.assertEqual(context['manifest']['path'], 'bend2/context/package.json')
        self.assertEqual(context['lockfile']['path'], 'bend2/context/package-lock.json')
        self.assertEqual([row['name'] for row in context['dependencies']], sorted(entries))
        for row in context['dependencies']:
            self.assertTrue(row['tarball']['sha256'])
            self.assertTrue(row['resolved'].startswith('https://registry.npmjs.org/'))
        self.assertEqual(context['dependencyClosure']['schema'],
                         'baton2-context-dependency-closure-v1')
        self.assertEqual(set(context['dependencyClosure']['packages']), set(entries))
        runs = context['gate']['runs']
        self.assertEqual(context['gate']['floor']['available'], False)
        self.assertEqual([run['runtime'] for run in runs], ['host'])
        self.assertEqual(runs[0]['exit_code'], 0)
        self.assertTrue(runs[0]['payloadSnapshot']['equal'])
        self.assertTrue(runs[0]['node']['version'].startswith('v'))
        for name in entries:
            self.assertTrue(terms[name]['files'], 'no staged notice for ' + name)
        staged = payload / PACKAGE.CONTEXT_STAGE_ROOT
        self.assertTrue((staged / 'dependency-closure.json').is_file())
        self.assertTrue((staged / 'context-package-gate.mjs').is_file())
        self.assertFalse((staged / 'package.json').exists())
        self.assertFalse((staged / 'package-lock.json').exists())
        self.assertGreater((logs / 'context-gate-host.json').stat().st_size, 0)
        self.assertGreater((logs / 'context-gate-host.stdout').stat().st_size, 0)
        self.assertTrue((logs / 'context-gate-host.stderr').is_file())
        for side in ('before', 'after'):
            self.assertTrue((logs / ('context-gate-host.payload-' + side + '.json')).is_file())


def subprocess_version(node):
    import subprocess
    return subprocess.run([str(node), '--version'], capture_output=True,
                          text=True, check=True).stdout.strip()


if __name__ == '__main__':
    unittest.main()
