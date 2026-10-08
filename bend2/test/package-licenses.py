"""Package project and upstream terms with their original bytes and scopes."""
import hashlib
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
SMOKE_SPEC = importlib.util.spec_from_file_location('smoke_native_artifact', ROOT / 'bend2/scripts/smoke-native-artifact.py')
SMOKE = importlib.util.module_from_spec(SMOKE_SPEC)
SMOKE_SPEC.loader.exec_module(SMOKE)


class PackageLicenses(unittest.TestCase):
    def setUp(self):
        retained = ROOT / '.scratch/bend2/package-license-fixtures'
        retained.mkdir(parents=True, exist_ok=True)
        self.home = pathlib.Path(tempfile.mkdtemp(dir=retained))
        self.source = self.home / 'source'
        reference = self.source / 'docs/bend2/reference/upstream/LICENSE'
        reference.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'docs/bend2/reference/upstream/LICENSE', reference)
        self.payload = self.home / 'artifact'
        self.payload.mkdir()
        previous = PACKAGE.ROOT
        PACKAGE.ROOT = self.source
        self.addCleanup(setattr, PACKAGE, 'ROOT', previous)

    def document(self, name, data):
        (self.source / name).write_bytes(data)

    def assert_project_document(self, terms, field, source_name, data):
        expected = {'source_path': source_name, 'path': 'notices/baton2-' + source_name,
                    'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.assertEqual(terms[field], expected)
        self.assertEqual((self.payload / expected['path']).read_bytes(), data)

    def inventories(self):
        def entry(path, directory):
            return {'path': path.relative_to(directory).as_posix(),
                    'bytes': path.stat().st_size,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        source_files = [entry(path, self.source) for path in sorted(self.source.rglob('*')) if path.is_file()]
        files = [entry(path, self.payload) for path in sorted(self.payload.rglob('*')) if path.is_file()]
        return source_files, files

    def archive_fixture(self, change_license_hash=False, release_version=None):
        self.document('LICENSE', b'Project license fixture\r\n')
        self.document('NOTICE', b'Project notice fixture\n')
        identity = PACKAGE.artifact_identity(release_version)
        terms = PACKAGE.stage_notices(self.payload, [], identity['kind'])
        binary = self.payload / 'bin/baton2'
        binary.parent.mkdir()
        binary.write_bytes(b'File-only fixture; this executable is never run.\n')
        binary.chmod(0o755)
        source_files, files = self.inventories()
        PACKAGE.check_project_terms(terms, source_files, files)
        if change_license_hash:
            next(row for row in files if row['path'] == 'notices/baton2-LICENSE')['sha256'] = '0' * 64
        manifest = {'schema': 'baton2-native-artifact-v1', **identity,
                    'source': {'directory': str(self.source)},
                    'files': files, 'binary': next(row for row in files if row['path'] == 'bin/baton2'),
                    'terms': terms}
        provenance = self.home / 'manifest.json'
        provenance.write_text(json.dumps(manifest) + '\n')
        shutil.copyfile(provenance, self.payload / 'manifest.json')
        archive = self.home / 'fixture.tar.gz'
        with tarfile.open(archive, 'x:gz') as packed:
            packed.add(self.payload, arcname=identity['archive_root'])
        return archive, provenance

    def test_project_and_upstream_documents_keep_separate_bytes_and_metadata(self):
        license_data = b'Project license fixture\r\n'
        notice_data = b'Project notice fixture\n'
        self.document('LICENSE', license_data)
        self.document('NOTICE', notice_data)
        archive_notice = b'Compiler archive notice fixture\n'
        terms = PACKAGE.stage_notices(self.payload, [(pathlib.PurePosixPath('bend/NOTICE'), archive_notice)])
        self.assert_project_document(terms, 'baton_root_license', 'LICENSE', license_data)
        self.assert_project_document(terms, 'baton_root_notice', 'NOTICE', notice_data)
        reference = (ROOT / 'docs/bend2/reference/upstream/LICENSE').read_bytes()
        self.assertEqual((self.payload / terms['bend_reference_license']).read_bytes(), reference)
        self.assertEqual((self.payload / terms['bend_compiler_runtime_license']['path']).read_bytes(), reference)
        self.assertEqual((self.payload / 'notices/compiler-archive/bend/NOTICE').read_bytes(), archive_notice)
        distribution = (self.payload / 'notices/distribution.md').read_text()
        self.assertIn('baton2-LICENSE contains the Baton2 project license', distribution)
        self.assertNotIn('no root LICENSE', distribution)

    def test_snapshot_without_project_documents_preserves_unresolved_terms(self):
        terms = PACKAGE.stage_notices(self.payload, [])
        self.assertIsNone(terms['baton_root_license'])
        self.assertIsNone(terms['baton_root_notice'])
        self.assertFalse((self.payload / 'notices/baton2-LICENSE').exists())
        self.assertFalse((self.payload / 'notices/baton2-NOTICE').exists())
        self.assertIn('This source snapshot has no root LICENSE.',
                      (self.payload / 'notices/distribution.md').read_text())
        PACKAGE.check_project_terms(terms, *self.inventories())

    def test_project_license_without_notice_is_retained(self):
        data = b'Project license fixture\n'
        self.document('LICENSE', data)
        terms = PACKAGE.stage_notices(self.payload, [])
        self.assert_project_document(terms, 'baton_root_license', 'LICENSE', data)
        self.assertIsNone(terms['baton_root_notice'])
        self.assertNotIn('no root LICENSE', (self.payload / 'notices/distribution.md').read_text())
        PACKAGE.check_project_terms(terms, *self.inventories())

    def test_project_notice_does_not_supply_a_license(self):
        data = b'Project notice fixture\n'
        self.document('NOTICE', data)
        terms = PACKAGE.stage_notices(self.payload, [])
        self.assertIsNone(terms['baton_root_license'])
        self.assert_project_document(terms, 'baton_root_notice', 'NOTICE', data)
        self.assertIn('no root LICENSE', (self.payload / 'notices/distribution.md').read_text())
        PACKAGE.check_project_terms(terms, *self.inventories())

    def test_changed_upstream_license_refuses_staging(self):
        self.document('docs/bend2/reference/upstream/LICENSE', b'Changed upstream license\n')
        with self.assertRaisesRegex(RuntimeError, 'upstream Bend license differs from its versioned pin'):
            PACKAGE.stage_notices(self.payload, [])

    def test_archive_manifest_verifies_the_project_license_bytes(self):
        archive, provenance = self.archive_fixture()
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'extracted')
        for field in ('baton_root_license', 'baton_root_notice'):
            entry = manifest['terms'][field]
            source = (self.source / entry['source_path']).read_bytes()
            self.assertEqual((prefix / entry['path']).read_bytes(), source)
            manifested = next(row for row in manifest['files'] if row['path'] == entry['path'])
            self.assertEqual({key: entry[key] for key in ('path', 'bytes', 'sha256')}, manifested)

    def stage_runtime_files(self):
        scripts = self.source / 'bend2/scripts'
        scripts.mkdir(parents=True)
        names = [harness + '-' + suffix + '.mjs'
                 for harness in ('codex', 'omp', 'mcp') for suffix in ('conductor', 'root')]
        names.extend(('context-provider.mjs', 'context-project-policy.mjs',
                      'context-query-artifact.mjs', 'context-worktree-capture.mjs'))
        for name in names:
            shutil.copyfile(ROOT / 'bend2/scripts' / name, scripts / name)
        helper = self.source / 'bend2/harness/git-series.mjs'
        helper.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', helper)
        shutil.copytree(ROOT / 'bend2/ui/orchestra', self.source / 'bend2/ui/orchestra')
        PACKAGE.stage_adapters(self.payload)
        return names

    def test_archive_keeps_canonical_and_compatibility_adapter_bytes(self):
        names = self.stage_runtime_files()
        archive, provenance = self.archive_fixture()
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'adapter-extraction')
        entries = {row['path']: row for row in manifest['files']}
        for name in names:
            path = 'libexec/baton2/' + name
            data = (ROOT / 'bend2/scripts' / name).read_bytes()
            self.assertEqual((prefix / path).read_bytes(), data)
            self.assertEqual(entries[path], {'path': path, 'bytes': len(data),
                                            'sha256': hashlib.sha256(data).hexdigest()})

    def test_extracted_git_helper_selects_author_with_its_source_absent(self):
        self.stage_runtime_files()
        data = (ROOT / 'bend2/harness/git-series.mjs').read_bytes()
        archive, provenance = self.archive_fixture()
        self.source.rename(self.home / 'retained source λ')
        self.assertFalse(self.source.exists())
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'helper-extraction')
        installed = prefix / 'libexec/baton2/git-series.mjs'
        self.assertFalse((prefix / 'libexec/baton2/git-series.py').exists())
        expected = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
        self.assertEqual(installed.read_bytes(), data)
        staged = next(row for row in manifest['files'] if row['path'] == 'libexec/baton2/git-series.mjs')
        self.assertEqual({key: staged[key] for key in expected}, expected)
        self.assertEqual(manifest['source']['directory'], str(self.source))

        public = self.home / 'public series λ'
        public.mkdir()
        github = {'appId': 1001, 'clientId': 'fixture-client', 'slug': 'fixture-gpt',
                  'botLogin': 'fixture-gpt[bot]', 'botId': 9001,
                  'commitEmail': '9001+fixture-gpt[bot]@users.noreply.github.com',
                  'installationId': 2001, 'repositoryFullName': 'Flip-Engineering/baton',
                  'repositoryId': 3001,
                  'permissions': {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'}}
        identity = public / 'identity-series.json'
        identity.write_text(json.dumps({'seriesKey': 'gpt', 'displaySeries': 'GPT', 'github': github}))
        identity.chmod(0o600)
        registry = self.home / 'series.json'
        registry.write_text(json.dumps({'models': {}, 'series': {'gpt': str(public)}}))
        registry.chmod(0o600)
        self.assertFalse((public / 'private-key.pem').exists())
        working = self.home / 'separate working directory λ'
        working.mkdir()
        git = shutil.which('git')
        self.assertIsNotNone(git)
        node = shutil.which('node')
        self.assertIsNotNone(node)
        argv = [node, str(installed), 'launch', '--registry', str(registry),
                '--series-key', 'gpt', '--', git, 'var', 'GIT_AUTHOR_IDENT']
        environment = {'PATH': os.environ.get('PATH', os.defpath), 'GIT_CONFIG_GLOBAL': os.devnull,
                       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CEILING_DIRECTORIES': str(self.home),
                       'GIT_AUTHOR_NAME': 'Inherited sender',
                       'GIT_AUTHOR_EMAIL': 'sender@example.invalid'}
        started = time.time()
        stdout, stderr = self.home / 'installed-author.stdout', self.home / 'installed-author.stderr'
        with stdout.open('xb') as out, stderr.open('xb') as err:
            child = subprocess.Popen(argv, cwd=working, env=environment, stdout=out, stderr=err)
            code = child.wait()
        receipt = {'argv': argv, 'cwd': str(working), 'pid': child.pid, 'exit_code': code,
                   'started_unix': started, 'ended_unix': time.time(), 'source_absent': not self.source.exists(),
                   'private_key_created': False, 'authentication': 'not invoked',
                   'streams': [{'path': path.name, 'bytes': path.stat().st_size,
                                'sha256': hashlib.sha256(path.read_bytes()).hexdigest()} for path in (stdout, stderr)]}
        (self.home / 'installed-author.json').write_text(json.dumps(receipt, indent=2) + '\n')
        self.assertEqual(code, 0, stderr.read_text())
        self.assertTrue(stdout.read_text().startswith('Flip Baton - GPT <' + github['commitEmail'] + '> '))
        self.assertFalse((public / 'private-key.pem').exists())

    def test_archive_license_hash_mismatch_refuses_extraction(self):
        archive, provenance = self.archive_fixture(change_license_hash=True)
        with self.assertRaisesRegex(RuntimeError, 'Artifact file differs from manifest: notices/baton2-LICENSE'):
            SMOKE.extract(archive, provenance, self.home / 'refused-extraction')

    def test_contradictory_terms_refuse_correct_file_inventories(self):
        self.document('LICENSE', b'Project license fixture\n')
        self.document('NOTICE', b'Project notice fixture\n')
        terms = PACKAGE.stage_notices(self.payload, [])
        source_files, files = self.inventories()
        PACKAGE.check_project_terms(terms, source_files, files)
        for field in ('baton_root_license', 'baton_root_notice'):
            changes = [None]
            for key, value in (('source_path', 'another-source'), ('path', 'notices/another-document'),
                               ('bytes', terms[field]['bytes'] + 1), ('sha256', '0' * 64)):
                changes.append(dict(terms[field], **{key: value}))
            for changed in changes:
                with self.subTest(field=field, changed=changed):
                    contradictory = dict(terms, **{field: changed})
                    with self.assertRaisesRegex(RuntimeError, 'terms differ from the source inventory'):
                        PACKAGE.check_project_terms(contradictory, source_files, files)

    def test_unrecorded_project_file_refuses_null_terms(self):
        terms = PACKAGE.stage_notices(self.payload, [])
        (self.payload / 'notices/baton2-LICENSE').write_bytes(b'Unrecorded project license\n')
        with self.assertRaisesRegex(RuntimeError, 'Baton2 LICENSE file differs from its terms'):
            PACKAGE.check_project_terms(terms, *self.inventories())

    def test_changed_project_copy_refuses_correct_source_and_terms(self):
        self.document('LICENSE', b'Project license fixture\n')
        terms = PACKAGE.stage_notices(self.payload, [])
        (self.payload / terms['baton_root_license']['path']).write_bytes(b'Changed project license\n')
        with self.assertRaisesRegex(RuntimeError, 'Baton2 LICENSE file differs from its terms'):
            PACKAGE.check_project_terms(terms, *self.inventories())

    def test_default_artifact_identity_keeps_the_development_name_and_kind(self):
        self.assertEqual(PACKAGE.artifact_identity(None),
                         {'archive_root': 'baton2-development-darwin-arm64', 'kind': 'development'})

    def test_release_identity_records_the_versioned_name_and_kind(self):
        self.document('LICENSE', b'Project license fixture\n')
        self.assertEqual(PACKAGE.artifact_identity('1.0.0'),
                         {'archive_root': 'baton2-1.0.0-darwin-arm64', 'kind': 'release', 'version': '1.0.0'})

    def test_release_without_project_license_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'Release packaging requires the project root LICENSE'):
            PACKAGE.artifact_identity('1.0.0')

    def test_versioned_archive_extracts_with_release_metadata_and_terms(self):
        archive, provenance = self.archive_fixture(release_version='1.0.0')
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'extracted-release')
        self.assertEqual(prefix.name, 'baton2-1.0.0-darwin-arm64')
        self.assertEqual(manifest['kind'], 'release')
        self.assertEqual(manifest['version'], '1.0.0')
        distribution = (prefix / 'notices/distribution.md').read_text()
        self.assertIn('This is a Baton2 native release artifact.', distribution)
        self.assertNotIn('no root LICENSE', distribution)

    def test_unsafe_release_identifier_refuses(self):
        self.document('LICENSE', b'Project license fixture\n')
        for version in ('', '.', '..', '../1.0.0', '/1.0.0', '1.0.0/latest',
                        '1.0.0\\latest', '1.0.0\n', '1.0.0 stable'):
            with self.subTest(version=version):
                with self.assertRaisesRegex(RuntimeError, 'Release version must be a single identifier'):
                    PACKAGE.artifact_identity(version)


if __name__ == '__main__':
    unittest.main()
