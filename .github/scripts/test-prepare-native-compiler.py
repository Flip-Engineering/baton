#!/usr/bin/env python3
"""Check that compiler selection and the candidate tree's verifier stay coherent (#1398).

A checked-out tree owns its default compiler archive in .github/native-compiler-selection.json,
next to the verifier that lists the archives it accepts. The preparation script reads that file
when no archive is given, so a candidate and its default come from one revision. An archive
given by input is verified against the same tree and refused when the tree does not list it.
The tests build stand-in trees with stand-in archives; no real compiler is read.
"""
import hashlib
import io
import json
import os
import pathlib
import re
import runpy
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPTS = pathlib.Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
WORKFLOW = ROOT / '.github/workflows/bend2-native.yml'
SELECTION = ROOT / '.github/native-compiler-selection.json'
VERIFIER = runpy.run_path(str(SCRIPTS / 'reuse-native-main.py'))

# A verifier for a stand-in tree. It lists the archives it is given, with the helpers the
# preparation script takes from the real verifier.
STAND_IN_VERIFIER = '''
import hashlib

COMPILER_ARCHIVES = %r
ARCHIVE_SHA = %r


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def distribution(archive, home):
    return {}
'''
BEND = b'stand-in bend executable\n'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stand_in_archive(path, marker=b''):
    """A gzip tarball with one top directory and bin/bend; the marker makes distinct archives."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
        for name, data in (('stand-in/bin/bend', BEND), ('stand-in/MARKER', marker)):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o755
            archive.addfile(info, io.BytesIO(data))
    path.write_bytes(buffer.getvalue())
    return sha(buffer.getvalue())


def selection_fields():
    record = json.loads(SELECTION.read_text())
    return record['archive'], record['archive_sha256']


class RealTree(unittest.TestCase):
    """The tree this test runs in: its default and its verifier come from one revision."""

    def test_the_tree_default_is_a_listed_archive(self):
        record = json.loads(SELECTION.read_text())
        self.assertEqual(sorted(record), ['archive', 'archive_sha256', 'schema'])
        self.assertEqual(record['schema'], 'baton2-native-compiler-selection-v1')
        self.assertIn(record['archive_sha256'], VERIFIER['COMPILER_ARCHIVES'])
        self.assertTrue(record['archive'].endswith('.tar.gz'))

    def test_the_workflow_fallbacks_agree_with_the_tree_default(self):
        # A default or fallback still in the workflow must be the tree default.
        text = WORKFLOW.read_text()
        archive, digest = selection_fields()
        digests = re.findall(r"inputs\.retained_compiler_archive_sha256 \|\| '([0-9a-f]{64})'", text)
        paths = re.findall(r"inputs\.retained_compiler_archive \|\| '([^']+)'", text)
        digests += re.findall(r"retained_compiler_archive_sha256:\n(?:        .*\n)*?        default: '([0-9a-f]{64})'", text)
        paths += re.findall(r"retained_compiler_archive:\n(?:        .*\n)*?        default: '(/[^']+)'", text)
        self.assertEqual(set(digests) - {digest}, set())
        self.assertEqual(set(paths) - {archive}, set())

    def test_a_workflow_that_reads_the_tree_default_does_so_at_every_call(self):
        text = WORKFLOW.read_text()
        if '--default-selection' not in text:
            self.skipTest('the workflow still carries its own defaults')
        calls = len(re.findall(r'python3 "?\S*(?<!test-)prepare-native-compiler\.py', text))
        self.assertGreaterEqual(calls, 4)
        self.assertEqual(len(re.findall(r'selection=\(--default-selection \S*\.github/native-compiler-selection\.json\)', text)), calls)
        self.assertEqual(text.count('"${selection[@]}"'), calls)
        self.assertNotIn('inputs.retained_compiler_archive ||', text)
        self.assertNotIn('inputs.retained_compiler_archive_sha256 ||', text)
        blank = re.findall(r"retained_compiler_archive(?:_sha256)?:\n(?:        .*\n)*?        default: '([^']*)'", text)
        self.assertEqual(blank, ['', ''])


class WorkflowGuard(unittest.TestCase):
    """The shell the workflow runs before each call, against a script with and without the flag."""

    def guard(self):
        text = WORKFLOW.read_text()
        if '--default-selection' not in text:
            self.skipTest('the workflow still carries its own defaults')
        return re.search(r'^ {10}(selection=\(\)\n.*?^ {10}fi\n)', text, re.M | re.S).group(1)

    def run_guard(self, flag_supported, archive, sha256):
        guard = self.guard()
        with tempfile.TemporaryDirectory() as directory:
            tree = pathlib.Path(directory)
            (tree / '.github/scripts').mkdir(parents=True)
            (tree / '.github/scripts/prepare-native-compiler.py').write_text(
                '# --default-selection\n' if flag_supported else '# no flag\n')
            (tree / 'evidence').mkdir()
            subprocess.run(['git', '-C', directory, 'init', '-q'], check=True, capture_output=True)
            subprocess.run(['git', '-C', directory, '-c', 'user.email=n@example.invalid', '-c', 'user.name=n',
                            'commit', '-q', '--allow-empty', '-m', 'c'], check=True, capture_output=True)
            script = 'set -euo pipefail\nrun=' + directory + '\n' + guard \
                + 'printf "%s\\n" "${selection[@]}"\n'
            result = subprocess.run(['bash', '-c', script], cwd=directory, capture_output=True, text=True,
                                    env={**os.environ, 'BATON2_RETAINED_COMPILER_ARCHIVE': archive,
                                         'BATON2_RETAINED_COMPILER_SHA256': sha256})
            stderr = (tree / 'evidence/compiler-selection.stderr')
            return result, stderr.read_text() if stderr.exists() else ''

    def test_a_candidate_with_the_flag_reads_its_tree_default(self):
        result, _ = self.run_guard(True, '', '')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), ['--default-selection', '.github/native-compiler-selection.json'])

    def test_a_candidate_without_the_flag_and_without_a_pin_is_refused_with_its_commit(self):
        result, message = self.run_guard(False, '', '')
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertRegex(message, r'Candidate [0-9a-f]{40} predates tree-owned compiler selection')

    def test_a_candidate_without_the_flag_keeps_an_explicit_pin(self):
        result, message = self.run_guard(False, '/x.tar.gz', '0' * 64)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((result.stdout.strip(), message), ('', ''))


class StandInTree(unittest.TestCase):
    """The script run inside a stand-in checkout: scripts, verifier, optional default file."""

    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='compiler-tree-'))
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.tree = self.directory / 'candidate'
        (self.tree / '.github/scripts').mkdir(parents=True)
        shutil.copy(SCRIPTS / 'prepare-native-compiler.py', self.tree / '.github/scripts')
        self.archives = {}
        self.run_dir = self.directory / 'run'
        for name in ('toolchain-home', 'evidence', 'generated'):
            (self.run_dir / name).mkdir(parents=True)
        self.git_env = {**os.environ, 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull,
                        'GIT_AUTHOR_NAME': 'n', 'GIT_AUTHOR_EMAIL': 'n@example.invalid',
                        'GIT_COMMITTER_NAME': 'n', 'GIT_COMMITTER_EMAIL': 'n@example.invalid'}
        for name in ('GIT_CONFIG_COUNT',):
            self.git_env.pop(name, None)

    def archive(self, name, listed=True, marker=None):
        path = self.directory / name
        digest = stand_in_archive(path, (marker or name).encode())
        self.archives[name] = (path, digest, listed)
        return path, digest

    def build(self, default=None):
        """Write the tree's verifier (listing the archives made so far) and optional default."""
        listed = {digest: {'name': name, 'source_commit': 'c' * 40, 'binary_sha256': sha(BEND)}
                  for name, (path, digest, is_listed) in self.archives.items() if is_listed}
        first = next(iter(listed), '0' * 64)
        (self.tree / '.github/scripts/reuse-native-main.py').write_text(STAND_IN_VERIFIER % (listed, first))
        if default is not None:
            (self.tree / '.github/native-compiler-selection.json').write_text(json.dumps(default))
        for argv in (['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'candidate']):
            subprocess.run(['git', '-C', str(self.tree), *argv], check=True, capture_output=True, env=self.git_env)
        self.commit = subprocess.run(['git', '-C', str(self.tree), 'rev-parse', 'HEAD'], check=True,
                                     capture_output=True, text=True, env=self.git_env).stdout.strip()

    def default_file(self, name):
        path, digest, _ = self.archives[name]
        return {'schema': 'baton2-native-compiler-selection-v1', 'archive': str(path), 'archive_sha256': digest}

    def prepare(self, *extra, runner='homelab', default_flag=True):
        command = [sys.executable, str(self.tree / '.github/scripts/prepare-native-compiler.py'),
                   '--run', str(self.run_dir), '--runner', runner]
        if default_flag:
            command += ['--default-selection', str(self.tree / '.github/native-compiler-selection.json')]
        return subprocess.run([*command, *extra], capture_output=True, text=True,
                              env={**self.git_env, 'GITHUB_SHA': 'f' * 40})

    def pin(self, name):
        path, digest, _ = self.archives[name]
        return ['--archive', str(path), '--archive-sha256', digest]

    def refusal(self):
        return json.loads((self.run_dir / 'evidence/compiler-selection-refusal.json').read_text())

    def source(self):
        return json.loads((self.run_dir / 'evidence/compiler-selection-source.json').read_text())

    def selected_archive_sha(self):
        return json.loads((self.run_dir / 'generated/compiler-selection.json').read_text())['compiler_archive_sha256']

    def assert_nothing_prepared(self):
        self.assertEqual(list((self.run_dir / 'toolchain-home').iterdir()), [])
        self.assertFalse((self.run_dir / 'generated/compiler-selection.json').exists())

    # The tree default is used when no input selects an archive.
    def test_a_blank_selection_uses_the_tree_default(self):
        self.archive('default.tar.gz')
        self.build(default=self.default_file('default.tar.gz'))
        result = self.prepare()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.selected_archive_sha(), self.archives['default.tar.gz'][1])
        source = self.source()
        self.assertEqual((source['selection_source'], source['candidate_commit']), ('tree-default', self.commit))
        self.assertTrue((self.run_dir / 'toolchain-home/bin/bend').is_file())

    def test_an_explicit_pin_replaces_the_tree_default_and_is_verified_against_the_tree(self):
        self.archive('default.tar.gz')
        self.archive('pinned.tar.gz')
        self.build(default=self.default_file('default.tar.gz'))
        result = self.prepare(*self.pin('pinned.tar.gz'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.selected_archive_sha(), self.archives['pinned.tar.gz'][1])
        self.assertEqual(self.source()['selection_source'], 'input')

    # Explicit pins stay verified.
    def test_an_explicit_pin_the_tree_does_not_list_is_refused(self):
        self.archive('default.tar.gz')
        self.archive('unlisted.tar.gz', listed=False)
        self.build(default=self.default_file('default.tar.gz'))
        result = self.prepare(*self.pin('unlisted.tar.gz'))
        self.assertEqual(result.returncode, 78, result.stderr)
        record = self.refusal()
        self.assertEqual((record['reason'], record['selection_source']), ('unknown-compiler-archive', 'input'))
        self.assertEqual(record['selected_archive_sha256'], self.archives['unlisted.tar.gz'][1])
        self.assertEqual(record['candidate_commit'], self.commit)
        self.assertEqual([entry['archive_sha256'] for entry in record['known_archives']],
                         [self.archives['default.tar.gz'][1]])
        self.assertNotIn('Traceback', result.stderr)
        self.assert_nothing_prepared()

    def test_an_unreadable_unlisted_pin_is_refused_the_same_way(self):
        self.archive('default.tar.gz')
        self.build(default=self.default_file('default.tar.gz'))
        result = self.prepare('--archive', str(self.directory / 'absent.tar.gz'), '--archive-sha256', '1' * 64)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertEqual(self.refusal()['selected_archive_sha256'], '1' * 64)
        self.assert_nothing_prepared()

    def test_a_changed_archive_is_refused_for_a_pin_and_for_the_tree_default(self):
        path, digest = self.archive('default.tar.gz')
        self.build(default=self.default_file('default.tar.gz'))
        path.write_bytes(path.read_bytes() + b'changed')
        for extra in ((), tuple(self.pin('default.tar.gz'))):
            with self.subTest(extra=extra):
                result = self.prepare(*extra)
                self.assertNotIn(result.returncode, (0, 78), result.stderr)
                self.assertIn('The retained compiler archive changed.', result.stderr)
                self.assertFalse((self.run_dir / 'evidence/compiler-selection-refusal.json').exists())
                self.assert_nothing_prepared()

    def test_a_listed_archive_with_a_different_binary_is_refused(self):
        path = self.directory / 'other.tar.gz'
        digest = stand_in_archive(path, b'other')
        self.archives['other.tar.gz'] = (path, digest, True)
        self.build()
        verifier = self.tree / '.github/scripts/reuse-native-main.py'
        verifier.write_text(verifier.read_text().replace(sha(BEND), '0' * 64))
        result = self.prepare('--archive', str(path), '--archive-sha256', digest)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('The selected compiler binary changed.', result.stderr)
        self.assertFalse((self.run_dir / 'generated/compiler-selection.json').exists())

    # A candidate that predates the file, or whose file disagrees with its verifier.
    def test_a_candidate_that_predates_the_default_file_is_refused_with_evidence(self):
        self.archive('known.tar.gz')
        self.build()
        result = self.prepare()
        self.assertEqual(result.returncode, 78, result.stderr)
        record = self.refusal()
        self.assertEqual((record['reason'], record['selection_source']),
                         ('no-tree-compiler-selection', 'tree-default'))
        self.assertEqual(record['candidate_commit'], self.commit)
        self.assertEqual(record['workflow_sha'], 'f' * 40)
        self.assertIn('predates', record['detail'])
        self.assertIn(self.commit, result.stderr)
        self.assertNotIn('Traceback', result.stderr)
        self.assert_nothing_prepared()

    def test_a_candidate_that_predates_the_default_file_still_accepts_a_listed_pin(self):
        self.archive('known.tar.gz')
        self.build()
        result = self.prepare(*self.pin('known.tar.gz'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.source()['selection_source'], 'input')

    def test_a_default_file_that_names_an_unlisted_archive_is_refused_as_a_tree_defect(self):
        self.archive('known.tar.gz')
        self.archive('unlisted.tar.gz', listed=False)
        self.build(default=self.default_file('unlisted.tar.gz'))
        result = self.prepare()
        self.assertEqual(result.returncode, 78, result.stderr)
        record = self.refusal()
        self.assertEqual((record['reason'], record['selection_source']), ('unknown-compiler-archive', 'tree-default'))
        self.assertEqual(record['selected_archive_sha256'], self.archives['unlisted.tar.gz'][1])
        self.assert_nothing_prepared()

    def test_a_malformed_default_file_is_refused(self):
        self.archive('known.tar.gz')
        self.build(default={})
        broken = {'schema': 'baton2-native-compiler-selection-v1', 'archive': '', 'archive_sha256': 'XYZ'}
        for value in (broken, {'archive': 'a', 'archive_sha256': '0' * 64}, []):
            with self.subTest(value=value):
                (self.tree / '.github/native-compiler-selection.json').write_text(json.dumps(value))
                result = self.prepare()
                self.assertEqual(result.returncode, 78, result.stderr)
                self.assertEqual(self.refusal()['reason'], 'malformed-tree-compiler-selection')
                self.assert_nothing_prepared()

    # Existing refusals are unchanged.
    def test_one_field_alone_and_the_wrong_runner_are_refused(self):
        self.archive('default.tar.gz')
        self.build(default=self.default_file('default.tar.gz'))
        result = self.prepare('--archive', str(self.archives['default.tar.gz'][0]))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Select both the compiler archive and its SHA256.', result.stderr)
        result = self.prepare(runner='github-hosted')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('A retained compiler requires the homelab runner.', result.stderr)
        self.assertFalse((self.run_dir / 'evidence/compiler-selection-refusal.json').exists())

    def test_without_the_default_flag_a_blank_selection_keeps_its_download_path(self):
        # The focused workflow passes no default file; its blank selection is unchanged. The
        # download is not attempted here: the stand-in curl is absent, so the run stops there.
        self.archive('default.tar.gz')
        self.build(default=self.default_file('default.tar.gz'))
        fake = self.directory / 'bin'
        fake.mkdir()
        curl = fake / 'curl'
        curl.write_text('#!/bin/sh\necho curl-called >> "%s/curl.log"\nexit 22\n' % self.directory)
        curl.chmod(0o755)
        command = [sys.executable, str(self.tree / '.github/scripts/prepare-native-compiler.py'),
                   '--run', str(self.run_dir), '--runner', 'homelab']
        result = subprocess.run(command, capture_output=True, text=True,
                                env={**self.git_env, 'PATH': str(fake) + os.pathsep + os.environ['PATH']})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.directory / 'curl.log').read_text(), 'curl-called\n')
        self.assertFalse((self.run_dir / 'evidence/compiler-selection-refusal.json').exists())


if __name__ == '__main__':
    unittest.main()
