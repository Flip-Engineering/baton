#!/usr/bin/env python3
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest


SCRIPT = pathlib.Path(__file__).with_name('reuse-native-recovery.py')
SPEC = importlib.util.spec_from_file_location('reuse_native_recovery', SCRIPT)
REUSE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REUSE)


def fixture_files(control_c=b'old control C\n', runtime_js=b'old runtime helper\n', queue=b'old queue\n'):
    return {
        'bend2/src/coordinator/entry.bend': b'import ./control.bend as Control\n',
        'bend2/src/coordinator/control.bend': b'import ../host/control.bend as Host\nimport ../host/runtime.bend as Runtime\n',
        'bend2/src/host/control.bend': b'def Control.call():\n  import "./control.c"\n',
        'bend2/src/host/control.c': b'#include "persistent-path.h"\n' + control_c,
        'bend2/src/host/persistent-path.h': b'#define PATH 1\n',
        'bend2/src/host/runtime.bend': b'def Runtime.call():\n  import "./text-read.js"\n',
        'bend2/src/host/text-read.js': runtime_js,
        'bend2/src/host/compile-queue.bend': queue,
        'bend2/src/host/native-entry.c': b'int main(void) { return 0; }\n',
    }


class FocusedRecoveryReuseTests(unittest.TestCase):
    def test_retained_cgen_digest_matches_pinned_source_and_only_control_c_changes(self):
        root = SCRIPT.parents[2]
        transition = REUSE.verify_source_transition(root, REUSE.TARGET_BASE_COMMIT)
        self.assertEqual(transition['origin_source_digest'], REUSE.OLD_SOURCE_DIGEST)
        self.assertEqual(transition['closure_file_count'], 79)
        self.assertEqual(transition['changed_input'], REUSE.HOST_SOURCE)
        self.assertEqual(transition['native_entry_sha256'], '3e8120dd6f0d42f526aa66c99730a8d54f7dd581c3611c822476e6a93f33b62f')

    def test_recovery_proof_paths_match_across_darwin_var_alias(self):
        target = self.root / 'real-generator'
        alias = self.root / 'generator-alias'
        target.mkdir()
        alias.symlink_to(target, target_is_directory=True)
        self.assertTrue(REUSE.same_resolved_path(alias / 'bin/bend', target / 'bin/bend'))
        captured = {'generator': {'generator_root': str(target.resolve())}}
        proof_capture = {'generator': {'generator_root': str(alias)}}
        self.assertTrue(REUSE.captured_cgen_matches(captured, proof_capture))

    def test_descendant_source_proof_requires_the_same_closure(self):
        old, current = self.git_snapshots(
            fixture_files(), fixture_files(queue=b'changed queue outside entry closure\n'))
        old_rows, old_digest = REUSE.source_closure(self.root, old, 'bend2/src/coordinator/entry.bend')
        current_rows, current_digest = REUSE.source_closure(self.root, current, 'bend2/src/coordinator/entry.bend')
        proof = {'current_source_commit': old, 'current_source_tree': REUSE.git_tree(self.root, old),
                 'origin_source_digest': 'origin-digest', 'current_source_digest': old_digest,
                 'source_closure_file_count': len(old_rows)}
        transition = {'origin_source_digest': 'origin-digest', 'current_source_digest': current_digest,
                      'closure_file_count': len(current_rows)}
        REUSE.validate_source_proof(self.root, current, proof, transition)
        transition['current_source_digest'] = 'changed-imported-source'
        with self.assertRaisesRegex(ValueError, 'source closure differs'):
            REUSE.validate_source_proof(self.root, current, proof, transition)

    def test_old_37951_proof_does_not_qualify_905_spawn_closure(self):
        root = SCRIPT.parents[2]
        old_transition = REUSE.verify_source_transition(root, '37951e3ad8b865783c8f898981841c52671dfc98')
        current_transition = REUSE.verify_source_transition(root, '905f0bfacbc1ef490af156a2f3f3e0bd8efeb49d')
        old_commit = '37951e3ad8b865783c8f898981841c52671dfc98'
        proof = {'current_source_commit': old_commit, 'current_source_tree': REUSE.git_tree(root, old_commit),
                 'origin_source_digest': old_transition['origin_source_digest'],
                 'current_source_digest': old_transition['current_source_digest'],
                 'source_closure_file_count': old_transition['closure_file_count']}
        with self.assertRaisesRegex(ValueError, 'source closure differs'):
            REUSE.validate_source_proof(root, '905f0bfacbc1ef490af156a2f3f3e0bd8efeb49d',
                                        proof, current_transition)

    def test_source_closure_includes_headers_and_javascript_and_ignores_queue_bend(self):
        old, current = self.git_snapshots(
            fixture_files(),
            fixture_files(control_c=b'new control C\n', queue=b'new queue\n'))
        old_rows, old_digest = REUSE.source_closure(self.root, old, 'bend2/src/coordinator/entry.bend')
        new_rows, _ = REUSE.source_closure(self.root, current, 'bend2/src/coordinator/entry.bend')
        old_paths = {row[0] for row in old_rows}
        self.assertIn('bend2/src/host/persistent-path.h', old_paths)
        self.assertIn('bend2/src/host/text-read.js', old_paths)
        self.assertNotIn('bend2/src/host/compile-queue.bend', old_paths)
        old_map, new_map = REUSE.compare_closures(
            old_rows, new_rows, 'bend2/src/host/control.c',
            (REUSE.sha256(b'#include "persistent-path.h"\nold control C\n'),
             REUSE.sha256(b'#include "persistent-path.h"\nnew control C\n')))
        self.assertNotEqual(old_digest, '')
        self.assertEqual(old_map.keys(), new_map.keys())

    def test_changed_imported_runtime_file_is_refused(self):
        old, current = self.git_snapshots(
            fixture_files(),
            fixture_files(control_c=b'new control C\n', runtime_js=b'changed runtime helper\n'))
        old_rows, _ = REUSE.source_closure(self.root, old, 'bend2/src/coordinator/entry.bend')
        new_rows, _ = REUSE.source_closure(self.root, current, 'bend2/src/coordinator/entry.bend')
        with self.assertRaisesRegex(ValueError, 'another changed input'):
            REUSE.compare_closures(old_rows, new_rows, 'bend2/src/host/control.c', ('old', 'new'))

    def test_host_change_pair_must_match_the_allowlist(self):
        old, current = self.git_snapshots(
            fixture_files(), fixture_files(control_c=b'unexpected host C\n'))
        old_rows, _ = REUSE.source_closure(self.root, old, 'bend2/src/coordinator/entry.bend')
        new_rows, _ = REUSE.source_closure(self.root, current, 'bend2/src/coordinator/entry.bend')
        with self.assertRaisesRegex(ValueError, 'hashes do not match'):
            REUSE.compare_closures(old_rows, new_rows, 'bend2/src/host/control.c',
                                   (REUSE.sha256(b'old'), REUSE.sha256(b'new')))

    def test_embedded_host_replacement_requires_one_exact_fragment(self):
        derived, prefix, suffix = REUSE.substitute_fragment(b'prefix-old-suffix', b'old', b'current')
        self.assertEqual(derived, b'prefix-current-suffix')
        self.assertEqual(prefix + suffix, b'prefix--suffix')
        for original in (b'old-old', b'missing'):
            with self.subTest(original=original):
                with self.assertRaisesRegex(ValueError, 'exactly once'):
                    REUSE.substitute_fragment(original, b'old', b'current')

    def test_cgen_request_binds_worktree_relative_entry_and_completed_key(self):
        request = {'key': 'captured-key', 'cwd': '/source',
                   'key_argv': ['--entry', REUSE.ENTRY, '--kind', 'cgen']}
        self.assertTrue(REUSE.cgen_request_valid(request, 'captured-key', '/source'))
        request['key_argv'][1] = 'receive-recovery-focused.bend'
        self.assertFalse(REUSE.cgen_request_valid(request, 'captured-key', '/source'))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='baton-focused-reuse-fixture-')
        self.root = pathlib.Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        subprocess.run(['git', 'config', 'user.name', 'Baton fixture'], cwd=self.root, check=True)
        subprocess.run(['git', 'config', 'user.email', 'baton-fixture@example.invalid'], cwd=self.root, check=True)

    def tearDown(self):
        self.temp.cleanup()

    def git_snapshots(self, old_files, current_files):
        self.write_files(old_files)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'old fixture'], cwd=self.root, check=True)
        old = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        self.write_files(current_files)
        subprocess.run(['git', 'add', '.'], cwd=self.root, check=True)
        subprocess.run(['git', 'commit', '-qm', 'current fixture'], cwd=self.root, check=True)
        current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=self.root, text=True).strip()
        return old, current

    def write_files(self, files):
        for relative, body in files.items():
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)


if __name__ == '__main__':
    unittest.main()
