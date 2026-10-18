"""The source installation carries the focused facade, full router, and recovery helper."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PACKAGE = load('package_native', ROOT / 'bend2/scripts/package-native.py')
STAGE = load('stage_native_install', ROOT / 'bend2/scripts/stage-native-install.py')
CHECK = load('check_install', ROOT / 'bend2/scripts/check-install.py')
FINALIZE = load('finalize_native_payload', ROOT / 'bend2/scripts/finalize-native-payload.py')
COMMIT = 'a' * 40


class ReceiverLayout(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp(prefix='baton2-receiver-layout-'))
        self.addCleanup(shutil.rmtree, self.home)
        self.binaries = {}
        for role, name in (('focused', 'focused'), ('full', 'full'), ('recovery', 'recovery')):
            path = self.home / name
            path.write_bytes(role.encode() + b'\n')
            path.chmod(0o755)
            self.binaries[role] = path

    def args(self, **changes):
        value = argparse.Namespace(
            focused_binary=self.binaries['focused'], full_binary=self.binaries['full'],
            recovery_binary=self.binaries['recovery'],
            focused_source_commit=COMMIT, focused_source_status='',
            focused_source_tree='c' * 40, focused_source_manifest_sha256=None,
            full_source_commit=COMMIT, full_source_status='',
            full_source_tree='c' * 40, full_source_manifest_sha256=None,
            recovery_source_commit=COMMIT, recovery_source_status='',
            recovery_source_tree='d' * 40, recovery_source_manifest_sha256=None,
            full_wrapper_source_commit=COMMIT, full_wrapper_source_status='',
            full_wrapper_source_tree='e' * 40, full_wrapper_source_manifest_sha256=None)
        for name, item in changes.items():
            setattr(value, name, item)
        return value


    def source_manifest(self, records):
        focused = next(record for record in records if record['role'] == 'focused-facade')
        full = next(record for record in records if record['role'] == 'full-cli')
        recovery = next(record for record in records if record['role'] == 'recovery-helper')
        value = {'schema': 'baton2-source-manifest-v1',
                 'focused': {'path': focused['path'], 'sha256': focused['sha256'],
                             'entry': focused['entry'], 'source': focused['source']},
                 'full': {'path': full['path'], 'sha256': full['sha256'],
                          'entry': full['entry'], 'source': full['source'],
                          'build_mode': full['build_mode']},
                 'recovery': {'path': recovery['path'], 'sha256': recovery['sha256'],
                              'entry': recovery['entry'], 'source': recovery['source'],
                              'build_mode': recovery['build_mode']},
                 'repl': {'compiler_source': 'bend2/compiler/upstream',
                          'runtime': '/absolute/bun', 'runtime_sha256': 'a' * 64,
                          'notices': '/absolute/Bun-NOTICES'},
                 'binaries': [{'role': record['role'], 'path': record['path'],
                               'sha256': record['sha256'], 'build_mode': record['build_mode']}
                              for record in records]}
        if full.get('wrapper_source'):
            value['full']['wrapper_source'] = full['wrapper_source']
        if full.get('retained_c_sha256'):
            value['full']['retained_c_sha256'] = full['retained_c_sha256']
        return value
    def staged(self):
        prefix = Path(tempfile.mkdtemp(prefix='prefix-', dir=self.home))
        (prefix / 'bin').mkdir()
        specs = STAGE.binary_specs(self.args(), PACKAGE)
        records = STAGE.stage_binaries(prefix, specs, PACKAGE)
        focused = records[0]
        source_manifest = self.source_manifest(records)
        manifest = {
            'schema': 'baton2-native-install-v2', 'source': {'commit': COMMIT, 'status': ''},
            'binaries': records, 'source_manifest': source_manifest,
            'binary': {'path': focused['path'], 'alias': focused['alias'],
                       'sha256': focused['sha256'], 'source': focused['source']},
        }
        PACKAGE.write_json(prefix / 'source-manifest.json', source_manifest)
        PACKAGE.write_json(prefix / 'manifest.json', manifest)
        receipt = {'schema': 'baton2-native-install-receipt-v1',
                   'manifest': {'path': 'manifest.json',
                                'sha256': PACKAGE.sha256(prefix / 'manifest.json')},
                   'source': manifest['source'], 'source_manifest': manifest['source_manifest'],
                   'binaries': records}
        PACKAGE.write_json(prefix / 'install-receipt.json', receipt)
        STAGE.stage_checksums(prefix, PACKAGE, records)
        return prefix, manifest, records





    def test_post_stage_provenance_refreshes_receipt_and_all_checksums(self):
        prefix, manifest, records = self.staged()
        manifest['build'] = {'generated_c_provenance': {'path': 'share/provenance', 'assets': []}}
        PACKAGE.write_json(prefix / 'manifest.json', manifest)
        provenance = prefix / 'share/provenance'
        provenance.mkdir(parents=True)
        (provenance / 'verification.json').write_text('{"status":"verified"}\n')
        nested = prefix / 'libexec/dependency/SHA256SUMS'
        nested.parent.mkdir(parents=True)
        nested.write_text('nested dependency checksums\n')
        result = FINALIZE.finalize(prefix)
        self.assertEqual(result['manifest_sha256'], PACKAGE.sha256(prefix / 'manifest.json'))
        receipt = json.loads((prefix / 'install-receipt.json').read_text())
        self.assertEqual(receipt['manifest']['sha256'], result['manifest_sha256'])
        checksums = CHECK.verify_checksums(prefix)
        CHECK.verify_payload_checksums(prefix, checksums)
        self.assertIn('share/provenance/verification.json', checksums)
        self.assertIn('libexec/dependency/SHA256SUMS', checksums)
        self.assertNotIn('SHA256SUMS', checksums)
        CHECK.verify_binaries(prefix, manifest, checksums)

    def test_nested_checksum_file_is_covered(self):
        prefix, manifest, records = self.staged()
        nested = prefix / 'libexec/dependency/SHA256SUMS'
        nested.parent.mkdir(parents=True)
        nested.write_text('dependency checksums\n')
        STAGE.stage_checksums(prefix, PACKAGE, records)
        checksums = CHECK.verify_checksums(prefix)
        CHECK.verify_payload_checksums(prefix, checksums)
        self.assertIn('libexec/dependency/SHA256SUMS', checksums)
        self.assertNotIn('SHA256SUMS', checksums)

    def test_manifest_only_pin_requires_bound_complete_closure(self):
        closure_path = self.home / 'closure.json'
        closure = {'schema': 'baton2-source-closure-v1', 'source': str(self.home),
                   'commit': COMMIT, 'status': 'dirty',
                   'diff_sha256': 'f' * 64,
                   'files': [{'path': 'bend2/src/coordinator/receive-focused.bend',
                              'bytes': 1, 'sha256': 'e' * 64}]}
        PACKAGE.write_json(closure_path, closure)
        closure_sha = PACKAGE.sha256(closure_path)
        spec = {'role': 'focused-facade',
                'source': {'directory': str(self.home), 'status': '',
                           'manifest_sha256': closure_sha}}
        STAGE.require_manifest_closures([spec], {'focused': {'sha256': closure_sha}})
        with self.assertRaisesRegex(RuntimeError, 'manifest-only source pin requires'):
            STAGE.require_manifest_closures([spec], {})
        with self.assertRaisesRegex(RuntimeError, 'manifest-only source pin requires'):
            STAGE.require_manifest_closures([spec], {'focused': {'sha256': '0' * 64}})
    def test_archive_manifest_uses_the_same_binary_contract(self):
        prefix, manifest, records = self.staged()
        manifest['schema'] = 'baton2-native-artifact-v2'
        PACKAGE.write_json(prefix / 'manifest.json', manifest)
        receipt = {'schema': 'baton2-native-install-receipt-v1',
                   'manifest': {'path': 'manifest.json',
                                'sha256': PACKAGE.sha256(prefix / 'manifest.json')},
                   'source': manifest['source'], 'source_manifest': manifest['source_manifest'],
                   'binaries': records}
        PACKAGE.write_json(prefix / 'install-receipt.json', receipt)
        STAGE.stage_checksums(prefix, PACKAGE, records)
        checked = CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))
        self.assertEqual(checked[0]['role'], 'focused-facade')
    def test_archive_staging_uses_the_same_three_binary_layout(self):
        namespace = argparse.Namespace(
            focused_binary=self.binaries['focused'], full_binary=self.binaries['full'],
            recovery_binary=self.binaries['recovery'],
            focused_source_commit=COMMIT, focused_source_tree='c' * 40,
            focused_source_status='', focused_source_manifest_sha256=None,
            recovery_source_commit=COMMIT, recovery_source_tree='d' * 40,
            recovery_source_status='', recovery_source_manifest_sha256=None,
            full_source_commit=COMMIT, full_source_tree='c' * 40,
            full_source_status='', full_source_manifest_sha256=None,
            full_wrapper_source_commit=COMMIT, full_wrapper_source_tree='e' * 40,
            full_wrapper_source_status='', full_wrapper_source_manifest_sha256=None)
        specs = PACKAGE.receiver_binaries(namespace)
        built = {spec['role']: Path(spec['supplied']) for spec in specs}
        payload = self.home / 'archive-payload'
        records = PACKAGE.stage_receiver_binaries(payload, specs, built)
        self.assertEqual([record['role'] for record in records],
                         ['focused-facade', 'full-cli', 'recovery-helper'])
        self.assertEqual((payload / 'bin/baton').read_bytes(),
                         (payload / 'bin/baton2').read_bytes())
        self.assertEqual([record['build_mode'] for record in records],
                         ['focused-native-entry', 'full-native-receiver-router',
                          'recovery-native-entry'])
        self.assertEqual(records[1]['wrapper_source']['tree'], 'e' * 40)
        self.assertEqual(records[0]['source']['tree'], 'c' * 40)

    def test_retained_full_requires_a_current_wrapper_pin(self):
        with self.assertRaisesRegex(RuntimeError, 'requires its current wrapper source commit'):
            STAGE.binary_specs(self.args(full_source_commit='b' * 40,
                                         full_source_tree='d' * 40,
                                         full_wrapper_source_commit=None), PACKAGE)
    def test_focused_build_mode_refuses_the_general_entry(self):
        environment = dict(os.environ, BATON2_RECEIVE_FOCUSED='1')
        result = subprocess.run(
            ['sh', str(ROOT / 'bend2/scripts/build-native.sh'),
             str(ROOT / 'bend2/src/coordinator/main.bend'),
             str(self.home / 'focused-output')],
            env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('build-mode-conflict', result.stderr)


    def test_full_receiver_router_refuses_a_non_main_entry(self):
        environment = dict(os.environ, BATON2_NATIVE_RECEIVER_ROUTER='1')
        result = subprocess.run(
            ['sh', str(ROOT / 'bend2/scripts/build-native.sh'),
             str(ROOT / 'bend2/src/coordinator/receive-focused.bend'),
             str(self.home / 'router-output')],
            env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('receiver-router-without-main', result.stderr)

    def test_recovery_helper_build_mode_refuses_another_entry(self):
        environment = dict(os.environ, BATON2_RECOVERY_HELPER='1')
        result = subprocess.run(
            ['sh', str(ROOT / 'bend2/scripts/build-native.sh'),
             str(ROOT / 'bend2/src/coordinator/receive-focused.bend'),
             str(self.home / 'recovery-output')],
            env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('recovery-helper-without-recovery-entry', result.stderr)
    def test_source_pin_needs_a_tree_or_manifest_when_commit_is_absent(self):
        with self.assertRaisesRegex(RuntimeError, 'source tree .* is missing'):
            STAGE.binary_specs(self.args(focused_source_commit='b' * 40,
                                         focused_source_tree=None), PACKAGE)
    def test_stages_three_executables_alias_and_exact_pins(self):
        prefix, manifest, records = self.staged()
        self.assertEqual([record['role'] for record in records],
                         ['focused-facade', 'full-cli', 'recovery-helper'])
        for name in ('baton', 'baton2', 'baton-full', 'baton-recovery'):
            path = prefix / 'bin' / name
            self.assertTrue(path.is_file() and os.access(path, os.X_OK), name)
        self.assertEqual((prefix / 'bin/baton').read_bytes(),
                         (prefix / 'bin/baton2').read_bytes())
        self.assertEqual(manifest['binary']['path'], 'bin/baton')
        self.assertEqual(manifest['binary']['alias'], 'bin/baton2')
        self.assertEqual([record['source']['commit'] for record in records],
                         [COMMIT, COMMIT, COMMIT])
        self.assertEqual([record['source']['tree'] for record in records],
                         ['c' * 40, 'c' * 40, 'd' * 40])
        self.assertEqual([record['build_mode'] for record in records],
                         ['focused-native-entry', 'full-native-receiver-router',
                          'recovery-native-entry'])
        self.assertEqual(records[1]['wrapper_source']['tree'], 'e' * 40)
        self.assertGreaterEqual(prefix.joinpath('SHA256SUMS').read_text().count('\n'), 6)
        checked = CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))
        self.assertEqual([(row['role'], row['path'], row['sha256']) for row in checked],
                         [(row['role'], row['path'], row['sha256']) for row in records])

    def test_missing_focused_binary_fails_before_staging(self):
        with self.assertRaisesRegex(RuntimeError, 'focused-facade binary is unavailable'):
            specs = STAGE.binary_specs(self.args(focused_binary=self.home / 'missing'), PACKAGE)
            prefix = self.home / 'prefix-missing'
            (prefix / 'bin').mkdir(parents=True)
            STAGE.stage_binaries(prefix, specs, PACKAGE)

    def test_missing_required_role_fails(self):
        prefix = self.home / 'prefix-role'
        (prefix / 'bin').mkdir(parents=True)
        specs = STAGE.binary_specs(self.args(), PACKAGE)
        with self.assertRaisesRegex(RuntimeError, 'requires exactly three binaries'):
            STAGE.stage_binaries(prefix, specs[:1], PACKAGE)


    def test_full_retained_c_hash_is_recorded_and_checked(self):
        namespace = self.args(full_c_sha256='f' * 64)
        specs = STAGE.binary_specs(namespace, PACKAGE)
        prefix = Path(tempfile.mkdtemp(prefix='prefix-c-', dir=self.home))
        (prefix / 'bin').mkdir()
        records = STAGE.stage_binaries(prefix, specs, PACKAGE)
        self.assertEqual(records[1]['retained_c_sha256'], 'f' * 64)
    def test_emergency_full_cli_keeps_its_earlier_source_pin(self):
        prefix = self.home / 'prefix-pin'
        (prefix / 'bin').mkdir(parents=True)
        specs = STAGE.binary_specs(self.args(full_source_commit='b' * 40,
                                            full_source_tree='d' * 40), PACKAGE)
        records = STAGE.stage_binaries(prefix, specs, PACKAGE)
        full = next(record for record in records if record['role'] == 'full-cli')
        focused = next(record for record in records if record['role'] == 'focused-facade')
        self.assertEqual(full['source']['commit'], 'b' * 40)
        self.assertEqual(focused['source']['commit'], COMMIT)
        with self.assertRaisesRegex(RuntimeError, '40-character lowercase'):
            STAGE.binary_specs(self.args(full_source_commit='not-a-commit'), PACKAGE)

    def test_installed_check_refuses_missing_or_altered_sibling(self):
        prefix, manifest, records = self.staged()
        full = prefix / 'bin/baton-full'
        full.unlink()
        with self.assertRaisesRegex(RuntimeError, 'full-cli binary is missing'):
            CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))
        full.write_bytes(b'changed\n')
        full.chmod(0o755)
        with self.assertRaisesRegex(RuntimeError, 'differs from its manifest hash'):
            CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))

    def test_installed_check_refuses_missing_recovery_helper(self):
        prefix, manifest, records = self.staged()
        (prefix / 'bin/baton-recovery').unlink()
        with self.assertRaisesRegex(RuntimeError, 'recovery-helper binary is missing'):
            CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))

    def test_installed_check_refuses_missing_install_receipt_or_checksum_entry(self):
        prefix, manifest, records = self.staged()
        (prefix / 'install-receipt.json').unlink()
        with self.assertRaisesRegex(RuntimeError, 'missing its install receipt'):
            CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))
        prefix, manifest, records = self.staged()
        checksums = prefix / 'SHA256SUMS'
        checksums.write_text('\n'.join(
            line for line in checksums.read_text().splitlines()
            if not line.endswith('  bin/baton-full')) + '\n')
        with self.assertRaisesRegex(RuntimeError, 'absent from SHA256SUMS'):
            CHECK.verify_binaries(prefix, manifest, CHECK.verify_checksums(prefix))


if __name__ == '__main__':
    unittest.main()
