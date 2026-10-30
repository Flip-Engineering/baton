#!/usr/bin/env python3
"""Check that compiler selection and the candidate tree's verifier stay coherent (#1398).

The workflow passes a default compiler archive from its own revision, and the
preparation script verifies it against the checked-out candidate tree. A candidate that
predates the archive's verifier entry must be refused with evidence that names the
candidate commit and the selected archive, and an unknown or changed archive must still
be refused.
"""
import hashlib
import json
import os
import pathlib
import re
import runpy
import shutil
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
WORKFLOW = ROOT / '.github/workflows/bend2-native.yml'
VERIFIER = runpy.run_path(str(SCRIPTS / 'reuse-native-main.py'))

# A verifier from a tree that predates the archive the workflow selects: it lists one
# archive, with the helpers the preparation script takes from the real verifier.
PREDATING_VERIFIER = '''
import hashlib

OLD = %r
COMPILER_ARCHIVES = {OLD: {'name': 'old archive', 'source_commit': 'a' * 40}}
ARCHIVE_SHA = OLD


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()
'''


def workflow_selection():
    """The archive digests and paths the workflow selects when its inputs are blank."""
    text = WORKFLOW.read_text()
    digests = re.findall(r"inputs\.retained_compiler_archive_sha256 \|\| '([0-9a-f]{64})'", text)
    paths = re.findall(r"inputs\.retained_compiler_archive \|\| '([^']+)'", text)
    default_digest = re.search(r"retained_compiler_archive_sha256:\n(?:        .*\n)*?"
                               r"        default: '([0-9a-f]{64})'", text)
    default_path = re.search(r"retained_compiler_archive:\n(?:        .*\n)*?"
                             r"        default: '([^']+)'", text)
    return digests, paths, default_digest.group(1), default_path.group(1)


class WorkflowDefaults(unittest.TestCase):
    def test_every_blank_input_fallback_is_the_input_default(self):
        digests, paths, default_digest, default_path = workflow_selection()
        self.assertGreaterEqual(len(digests), 1)
        self.assertEqual(set(digests), {default_digest})
        self.assertEqual(set(paths), {default_path})

    def test_the_default_archive_is_one_this_tree_verifies(self):
        # The same revision supplies the default and the verifier, so a change of the
        # default needs its verifier entry in the same commit.
        default_digest = workflow_selection()[2]
        self.assertIn(default_digest, VERIFIER['COMPILER_ARCHIVES'])

    def test_every_archive_the_verifier_lists_has_an_identity(self):
        for sha, identity in VERIFIER['COMPILER_ARCHIVES'].items():
            with self.subTest(sha=sha):
                self.assertRegex(sha, r'^[0-9a-f]{64}$')
                self.assertTrue(identity.get('name'))


class Preparation(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='prepare-compiler-'))
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.run_dir = self.directory / 'run'
        for name in ('toolchain-home', 'evidence', 'generated'):
            (self.run_dir / name).mkdir(parents=True)
        self.archive = self.directory / 'compiler.tar.gz'
        self.archive.write_bytes(b'not a compiler archive')
        self.archive_sha = hashlib.sha256(self.archive.read_bytes()).hexdigest()

    def prepare(self, archive=None, sha256=None, runner='homelab', scripts=None):
        scripts = scripts or SCRIPTS
        command = [sys.executable, str(scripts / 'prepare-native-compiler.py'),
                   '--run', str(self.run_dir), '--runner', runner,
                   '--archive', str(archive if archive is not None else self.archive),
                   '--archive-sha256', sha256 if sha256 is not None else self.archive_sha]
        env = {**os.environ, 'GITHUB_SHA': 'f' * 40}
        return subprocess.run(command, capture_output=True, text=True, env=env)

    def refusal(self):
        return json.loads((self.run_dir / 'evidence/compiler-selection-refusal.json').read_text())

    def candidate_head(self):
        result = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'],
                                capture_output=True, text=True)
        return result.stdout.strip() if result.returncode == 0 else 'unknown'

    def assert_nothing_prepared(self):
        self.assertEqual(list((self.run_dir / 'toolchain-home').iterdir()), [])
        self.assertFalse((self.run_dir / 'generated/compiler-selection.json').exists())
        self.assertFalse((self.run_dir / 'bend-2.0.25-linux-x64.tar.gz').exists())

    def test_an_unknown_archive_is_refused_with_the_candidate_and_archive_named(self):
        result = self.prepare()
        self.assertEqual(result.returncode, 78, result.stderr)
        record = self.refusal()
        self.assertEqual(record['reason'], 'unknown-compiler-archive')
        self.assertEqual(record['selected_archive_sha256'], self.archive_sha)
        self.assertEqual(record['selected_archive'], str(self.archive))
        self.assertEqual(record['candidate_commit'], self.candidate_head())
        self.assertEqual(record['workflow_sha'], 'f' * 40)
        listed = {entry['archive_sha256'] for entry in record['known_archives']}
        self.assertEqual(listed, set(VERIFIER['COMPILER_ARCHIVES']))
        self.assertEqual(record['verifier'], '.github/scripts/reuse-native-main.py')
        self.assertIn(self.archive_sha, result.stderr)
        self.assertIn(record['candidate_commit'], result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assert_nothing_prepared()

    def test_an_unreadable_unknown_archive_is_refused_the_same_way(self):
        result = self.prepare(archive=self.directory / 'absent.tar.gz', sha256='1' * 64)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertEqual(self.refusal()['selected_archive_sha256'], '1' * 64)
        self.assert_nothing_prepared()

    def test_a_candidate_that_predates_the_selected_archive_is_refused_with_evidence(self):
        scripts = self.directory / 'scripts'
        scripts.mkdir()
        shutil.copy(SCRIPTS / 'prepare-native-compiler.py', scripts)
        newest = workflow_selection()[2]
        (scripts / 'reuse-native-main.py').write_text(PREDATING_VERIFIER % ('b' * 64))
        result = self.prepare(sha256=newest, scripts=scripts)
        self.assertEqual(result.returncode, 78, result.stderr)
        record = json.loads((self.run_dir / 'evidence/compiler-selection-refusal.json').read_text())
        self.assertEqual(record['selected_archive_sha256'], newest)
        self.assertEqual([entry['archive_sha256'] for entry in record['known_archives']], ['b' * 64])
        self.assertIn('predates', record['detail'])
        self.assertNotIn('Traceback', result.stderr)
        self.assert_nothing_prepared()

    def test_a_listed_archive_whose_file_changed_is_still_refused(self):
        listed = next(iter(VERIFIER['COMPILER_ARCHIVES']))
        result = self.prepare(sha256=listed)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotEqual(result.returncode, 78)
        self.assertIn('The retained compiler archive changed.', result.stderr)
        self.assertFalse((self.run_dir / 'evidence/compiler-selection-refusal.json').exists())
        self.assert_nothing_prepared()

    def test_a_retained_compiler_still_requires_the_homelab_runner_and_both_fields(self):
        result = self.prepare(runner='github-hosted')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('A retained compiler requires the homelab runner.', result.stderr)
        result = self.prepare(archive='')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Select both the compiler archive and its SHA256.', result.stderr)
        self.assertFalse((self.run_dir / 'evidence/compiler-selection-refusal.json').exists())


if __name__ == '__main__':
    unittest.main()
