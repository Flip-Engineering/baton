#!/usr/bin/env python3
import importlib.util
import pathlib
import subprocess
import tempfile
import unittest
from unittest import mock


SCRIPT = pathlib.Path(__file__).with_name('reuse-native-recovery.py')
SPEC = importlib.util.spec_from_file_location('reuse_native_recovery', SCRIPT)
REUSE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REUSE)


def fixture_files(control_c=b'old control C\n', spawn_c=b'old spawn C\n',
                  runtime_js=b'old runtime helper\n', queue=b'old queue\n', include_spawn=False):
    control_includes = b'#include "persistent-path.h"\n'
    if include_spawn:
        control_includes += b'#include "process-spawn.c"\n'
    return {
        'bend2/src/coordinator/entry.bend': b'import ./control.bend as Control\n',
        'bend2/src/coordinator/control.bend': b'import ../host/control.bend as Host\nimport ../host/runtime.bend as Runtime\n',
        'bend2/src/host/control.bend': b'def Control.call():\n  import "./control.c"\n',
        'bend2/src/host/control.c': control_includes + control_c,
        'bend2/src/host/process-spawn.c': spawn_c,
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

    def test_qualified_37951_source_keeps_the_control_only_transition(self):
        root = SCRIPT.parents[2]
        transition = REUSE.verify_source_transition(root, '37951e3ad8b865783c8f898981841c52671dfc98')
        self.assertEqual(transition['closure_file_count'], 79)
        self.assertEqual(transition['changed_input'], REUSE.HOST_SOURCE)
        self.assertNotIn('old_spawn', transition)
        self.assertNotIn('current_spawn', transition)

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

    def test_control_and_spawn_fragments_are_allowed_as_one_exact_transition(self):
        old, current = self.git_snapshots(
            fixture_files(include_spawn=True),
            fixture_files(control_c=b'new control C\n', spawn_c=b'new spawn C\n',
                          queue=b'new queue\n', include_spawn=True))
        old_rows, old_digest = REUSE.source_closure(self.root, old, 'bend2/src/coordinator/entry.bend')
        new_rows, new_digest = REUSE.source_closure(self.root, current, 'bend2/src/coordinator/entry.bend')
        old_map, new_map = REUSE.compare_closures(
            old_rows, new_rows,
            'bend2/src/host/control.c',
            (REUSE.sha256(b'#include "persistent-path.h"\n#include "process-spawn.c"\nold control C\n'),
             REUSE.sha256(b'#include "persistent-path.h"\n#include "process-spawn.c"\nnew control C\n')),
            'bend2/src/host/process-spawn.c',
            (REUSE.sha256(b'old spawn C\n'), REUSE.sha256(b'new spawn C\n')))
        self.assertIn('bend2/src/host/process-spawn.c', old_map)
        self.assertNotEqual(old_digest, new_digest)
        self.assertEqual(old_map['bend2/src/host/process-spawn.c'][1], REUSE.sha256(b'old spawn C\n'))
        self.assertEqual(new_map['bend2/src/host/process-spawn.c'][1], REUSE.sha256(b'new spawn C\n'))

    def test_wrong_spawn_fragment_hash_pair_is_refused(self):
        old, current = self.git_snapshots(
            fixture_files(include_spawn=True),
            fixture_files(control_c=b'new control C\n', spawn_c=b'new spawn C\n', include_spawn=True))
        old_rows, _ = REUSE.source_closure(self.root, old, 'bend2/src/coordinator/entry.bend')
        new_rows, _ = REUSE.source_closure(self.root, current, 'bend2/src/coordinator/entry.bend')
        with self.assertRaisesRegex(ValueError, 'hashes do not match'):
            REUSE.compare_closures(
                old_rows, new_rows,
                'bend2/src/host/control.c',
                (REUSE.sha256(b'#include "persistent-path.h"\n#include "process-spawn.c"\nold control C\n'),
                 REUSE.sha256(b'#include "persistent-path.h"\n#include "process-spawn.c"\nnew control C\n')),
                'bend2/src/host/process-spawn.c',
                (REUSE.sha256(b'wrong old spawn C\n'), REUSE.sha256(b'new spawn C\n')))

    def test_dual_fragment_derivation_binds_both_replacements_and_rejects_wrong_hashes(self):
        old_control, current_control = b'old control fragment', b'current control fragment'
        old_spawn, current_spawn = b'old spawn fragment', b'current spawn fragment'
        original = b'prefix:' + old_control + b':middle:' + old_spawn + b':suffix'
        expected = b'prefix:' + current_control + b':middle:' + current_spawn + b':suffix'
        with mock.patch.multiple(
                REUSE,
                OLD_C_SHA256=REUSE.sha256(original),
                OLD_HOST_SHA256=REUSE.sha256(old_control),
                CURRENT_HOST_SHA256=REUSE.sha256(current_control),
                OLD_SPAWN_SHA256=REUSE.sha256(old_spawn),
                CURRENT_SPAWN_SHA256=REUSE.sha256(current_spawn)):
            derived, control_proof, spawn_proof = REUSE.derive(
                original, old_control, current_control, (old_spawn, current_spawn))
            self.assertEqual(derived, expected)
            self.assertEqual(control_proof['derived_c_sha256'], REUSE.sha256(b'prefix:' + current_control + b':middle:' + old_spawn + b':suffix'))
            self.assertEqual(spawn_proof['original_c_sha256'], control_proof['derived_c_sha256'])
            self.assertEqual(spawn_proof['derived_c_sha256'], REUSE.sha256(expected))
            for bad_pair in ((b'wrong old spawn', current_spawn), (old_spawn, b'wrong current spawn')):
                with self.subTest(bad_pair=bad_pair):
                    with self.assertRaisesRegex(ValueError, 'durable-status substitution'):
                        REUSE.derive(original, old_control, current_control, bad_pair)

    def test_dual_fragment_proof_tampering_is_refused(self):
        old_control, current_control = b'old control', b'current control'
        old_spawn, current_spawn = b'old spawn', b'current spawn'
        original = b'left:' + old_control + b':between:' + old_spawn + b':right'
        with mock.patch.multiple(
                REUSE,
                OLD_C_SHA256=REUSE.sha256(original),
                OLD_HOST_SHA256=REUSE.sha256(old_control),
                CURRENT_HOST_SHA256=REUSE.sha256(current_control),
                OLD_SPAWN_SHA256=REUSE.sha256(old_spawn),
                CURRENT_SPAWN_SHA256=REUSE.sha256(current_spawn)):
            _, control_proof, spawn_proof = REUSE.derive(
                original, old_control, current_control, (old_spawn, current_spawn))
            proof = {
                'foreign_source_substitution': control_proof,
                'foreign_source_substitution_spawn': spawn_proof,
                'changed_input_2': REUSE.SPAWN_SOURCE,
            }
            REUSE.verify_substitution_proof(proof, control_proof, spawn_proof)
            tampered_fragment = dict(spawn_proof, current_sha256=REUSE.sha256(b'tampered'))
            for tampered in (
                    dict(proof, foreign_source_substitution_spawn=tampered_fragment),
                    dict(proof, changed_input_2=REUSE.HOST_SOURCE)):
                with self.subTest(tampered=tampered):
                    with self.assertRaisesRegex(ValueError, 'proof differs|Second changed source input'):
                        REUSE.verify_substitution_proof(tampered, control_proof, spawn_proof)

    def test_legacy_control_only_proof_without_second_input_remains_valid(self):
        original = b'prefix:old control:suffix'
        with mock.patch.multiple(
                REUSE,
                OLD_C_SHA256=REUSE.sha256(original),
                OLD_HOST_SHA256=REUSE.sha256(b'old control'),
                CURRENT_HOST_SHA256=REUSE.sha256(b'current control')):
            _, control_proof, spawn_proof = REUSE.derive(original, b'old control', b'current control')
            self.assertIsNone(spawn_proof)
            legacy_proof = {'foreign_source_substitution': control_proof}
            REUSE.verify_substitution_proof(legacy_proof, control_proof, None)

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
