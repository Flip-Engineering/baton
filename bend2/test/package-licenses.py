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
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
SMOKE_SPEC = importlib.util.spec_from_file_location('smoke_native_artifact', ROOT / 'bend2/scripts/smoke-native-artifact.py')
SMOKE = importlib.util.module_from_spec(SMOKE_SPEC)
SMOKE_SPEC.loader.exec_module(SMOKE)
CHECK_SPEC = importlib.util.spec_from_file_location('check_install', ROOT / 'bend2/scripts/check-install.py')
CHECK = importlib.util.module_from_spec(CHECK_SPEC)
CHECK_SPEC.loader.exec_module(CHECK)
LAYOUT_SPEC = importlib.util.spec_from_file_location('package_receiver_fixture', ROOT / 'bend2/test/package-receiver-layout.py')
LAYOUT = importlib.util.module_from_spec(LAYOUT_SPEC)
LAYOUT_SPEC.loader.exec_module(LAYOUT)


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
        expected = {'source_path': source_name, 'path': 'notices/baton2-' + source_name}
        self.assertEqual(terms[field], expected)
        self.assertEqual((self.payload / expected['path']).read_bytes(), data)

    def repl_fixture(self):
        directory = self.payload / 'libexec/baton2/repl'
        contents = {'compiler': b'#!/bin/sh\nexit 1\n', 'bun': b'File-only Bun fixture\n',
                    'upstream/repl.ts': b'File-only frontend fixture\n',
                    'upstream/base.bend': b'File-only Base fixture\n',
                    'notices/Bend-LICENSE': b'Bend license fixture\n',
                    'notices/Bun-NOTICES': b'Bun distribution notices fixture\n'}
        lock = {'upstream': 'file-only compiler fixture', 'compiler_archive_sha256': '1' * 64,
                'license': {'sha256': hashlib.sha256(contents['notices/Bend-LICENSE']).hexdigest()},
                'files': [{'path': 'base.bend'}]}
        contents['upstream.lock.json'] = (json.dumps(lock) + '\n').encode()
        provenance = {'schema': 'baton2-repl-vendored-source-v1',
                      'lock_sha256': hashlib.sha256(contents['upstream.lock.json']).hexdigest(),
                      **{key: lock[key] for key in ('compiler_archive_sha256', 'files', 'license')}}
        contents['upstream.provenance.json'] = (json.dumps(provenance) + '\n').encode()
        files = []
        for name, data in sorted(contents.items()):
            path = directory / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(0o755 if name in ('compiler', 'bun') else 0o644)
            files.append({'path': name, 'sha256': hashlib.sha256(data).hexdigest(),
                          'bytes': len(data), 'mode': oct(path.stat().st_mode & 0o777)})
        compiler = {'protocol': 1, 'language': 'Bend2', 'upstream': lock['upstream'],
                    'compilerArchiveSha256': lock['compiler_archive_sha256'],
                    'runtimeSha256': hashlib.sha256(contents['bun']).hexdigest(),
                    'frontend': 'upstream/repl.ts', 'nativeLibraries': ['sqlite3'], 'files': files}
        manifest = directory / 'upstream/compiler.json'
        manifest.write_text(json.dumps(compiler) + '\n')
        return {'id': 'bend2-repl-compiler', 'required': True, 'path': 'libexec/baton2/repl',
                'manifest': 'upstream/compiler.json', 'sha256': PACKAGE.sha256(manifest), 'files': files}

    def archive_fixture(self, release_version=None, include_repl=True, changed_runtime=False):
        self.document('LICENSE', b'Project license fixture\r\n')
        self.document('NOTICE', b'Project notice fixture\n')
        identity = PACKAGE.artifact_identity(release_version)
        terms = PACKAGE.stage_notices(self.payload, [], identity['kind'])
        (self.payload / 'bin').mkdir()
        binaries = []
        for role, name, alias, entry, mode in (
                ('focused-facade', 'baton', None,
                 'bend2/src/coordinator/receive-focused.bend', 'focused-native-entry'),
                ('full-cli', 'baton2', 'baton-full',
                 'bend2/src/coordinator/main.bend', 'full-native-receiver-router'),
                ('recovery-helper', 'baton-recovery', None,
                 'bend2/src/coordinator/receive-recovery-focused.bend', 'recovery-native-entry')):
            path = self.payload / 'bin' / name
            path.write_bytes(('File-only ' + role + ' fixture; never run.\n').encode())
            path.chmod(0o755)
            record = {'role': role, 'path': 'bin/' + name,
                      'alias': None,
                      'sha256': PACKAGE.sha256(path),
                      'source': {'directory': str(self.source), 'commit': 'a' * 40,
                                 'tree': 'b' * 40, 'status': ''},
                      'entry': entry, 'build_mode': mode}
            if role == 'full-cli':
                record['wrapper_source'] = {'directory': str(self.source), 'commit': 'c' * 40,
                                            'tree': 'd' * 40, 'status': ''}
            if alias:
                alias_path = self.payload / 'bin' / alias
                shutil.copyfile(path, alias_path)
                alias_path.chmod(0o755)
                record['alias'] = 'bin/' + alias
            binaries.append(record)
        focused = binaries[0]
        manifest = {'schema': 'baton2-native-artifact-v2', **identity,
                    'source': {'directory': str(self.source), 'commit': 'a' * 40,
                               'tree': 'b' * 40, 'status': ''},
                    'binaries': binaries,
                    'binary': {'path': focused['path'], 'alias': focused.get('alias'),
                               'sha256': focused['sha256'], 'source': focused['source']},
                    'terms': terms}
        if include_repl:
            manifest['selected_dependencies'] = [self.repl_fixture()]
        if changed_runtime:
            (self.payload / 'libexec/baton2/repl/bun').write_bytes(b'Changed runtime fixture\n')
        provenance = self.home / 'manifest.json'
        provenance.write_text(json.dumps(manifest) + '\n')
        shutil.copyfile(provenance, self.payload / 'manifest.json')
        archive = self.home / 'fixture.tar.gz'
        with tarfile.open(archive, 'x:gz') as packed:
            packed.add(self.payload, arcname=identity['archive_root'])
        return archive, provenance

    def test_native_package_refuses_missing_repl_inputs(self):
        args = SimpleNamespace(repl_compiler_source=None, repl_runtime=None,
                               repl_runtime_sha256=None, repl_runtime_notices=None)
        with self.assertRaisesRegex(RuntimeError, 'Native packages require the REPL compiler'):
            PACKAGE.stage_repl(self.payload, args)

    def test_archive_without_required_repl_dependency_refuses(self):
        archive, provenance = self.archive_fixture(include_repl=False)
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'incomplete-extraction')
        with self.assertRaisesRegex(RuntimeError, 'requires one bundled Bend2 REPL compiler'):
            CHECK.verify_repl(prefix, manifest)

    def test_archive_with_changed_bundled_runtime_refuses(self):
        archive, provenance = self.archive_fixture(changed_runtime=True)
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'changed-runtime-extraction')
        with self.assertRaisesRegex(RuntimeError, 'file differs from its manifest: bun'):
            CHECK.verify_repl(prefix, manifest)

    def test_installation_refuses_unusable_bundled_runtime(self):
        layout = LAYOUT.ReceiverLayout(methodName='runTest')
        layout.setUp()
        self.addCleanup(layout.doCleanups)
        with mock.patch.object(LAYOUT.PACKAGE, 'source_identity',
                               return_value={'commit': LAYOUT.COMMIT, 'status': ''}):
            prefix, manifest, _ = layout.staged()
        self.payload = prefix
        manifest['selected_dependencies'] = [self.repl_fixture()]
        manifest['required_system_dependencies'] = CHECK.system_dependencies(CHECK.platform.system())
        PACKAGE.write_json(prefix / 'manifest.json', manifest)
        helper = prefix / 'libexec/baton2/task-start.mjs'
        shutil.copyfile(ROOT / 'bend2/harness/task-start.mjs', helper)
        LAYOUT.FINALIZE.finalize(prefix)
        output = self.home / 'unusable-runtime-check'
        output.mkdir()
        help_commands = [[str(prefix / 'bin' / name), '--help']
                         for name in ('baton', 'baton-full')]
        runtime_command = [str(prefix / 'libexec/baton2/repl/bun'), '--version']
        actual_run = subprocess.run

        def run(argv, **kwargs):
            if argv in help_commands:
                return subprocess.CompletedProcess(argv, 0, stdout='', stderr='')
            self.assertEqual(argv, runtime_command)
            return actual_run(argv, **kwargs)

        with mock.patch.object(CHECK.subprocess, 'run', side_effect=run):
            with self.assertRaisesRegex(RuntimeError, 'command could not start'):
                CHECK.check(prefix, output)
        records = json.loads((output / 'commands.json').read_text())
        self.assertEqual([record['argv'] for record in records], help_commands + [runtime_command])
        self.assertIsNone(records[-1]['returncode'])
        self.assertTrue(records[-1]['error'])

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

    def test_project_license_without_notice_is_retained(self):
        data = b'Project license fixture\n'
        self.document('LICENSE', data)
        terms = PACKAGE.stage_notices(self.payload, [])
        self.assert_project_document(terms, 'baton_root_license', 'LICENSE', data)
        self.assertIsNone(terms['baton_root_notice'])
        self.assertNotIn('no root LICENSE', (self.payload / 'notices/distribution.md').read_text())

    def test_project_notice_does_not_supply_a_license(self):
        data = b'Project notice fixture\n'
        self.document('NOTICE', data)
        terms = PACKAGE.stage_notices(self.payload, [])
        self.assertIsNone(terms['baton_root_license'])
        self.assert_project_document(terms, 'baton_root_notice', 'NOTICE', data)
        self.assertIn('no root LICENSE', (self.payload / 'notices/distribution.md').read_text())

    def test_changed_upstream_license_refuses_staging(self):
        self.document('docs/bend2/reference/upstream/LICENSE', b'Changed upstream license\n')
        with self.assertRaisesRegex(RuntimeError, 'upstream Bend license differs from its versioned pin'):
            PACKAGE.stage_notices(self.payload, [])

    def test_archive_keeps_project_documents_at_the_manifested_paths(self):
        archive, provenance = self.archive_fixture()
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'extracted')
        for field in ('baton_root_license', 'baton_root_notice'):
            entry = manifest['terms'][field]
            source = (self.source / entry['source_path']).read_bytes()
            self.assertEqual((prefix / entry['path']).read_bytes(), source)

    def stage_runtime_files(self):
        scripts = self.source / 'bend2/scripts'
        scripts.mkdir(parents=True)
        names = [harness + '-' + suffix + '.mjs'
                 for harness in ('codex', 'omp', 'mcp') for suffix in ('conductor', 'root')]
        names.extend(('check-install.py', 'context-provider.mjs', 'context-project-policy.mjs',
                      'context-query-artifact.mjs', 'context-worktree-capture.mjs',
                      'dsh-worker.mjs'))
        for name in names:
            shutil.copyfile(ROOT / 'bend2/scripts' / name, scripts / name)
        harness = self.source / 'bend2/harness'
        harness.mkdir(parents=True)
        for name in ('git-series.mjs', 'native-history.mjs', 'project-settings.mjs', 'task-start.mjs'):
            shutil.copyfile(ROOT / 'bend2/harness' / name, harness / name)
        shutil.copytree(ROOT / 'bend2/harness/git-series-bin', harness / 'git-series-bin')
        native = self.source / '.scratch/bend2'
        native.mkdir(parents=True)
        # Archive tests retain file bytes and executable modes; these helpers are never run.
        for name in ('claude-credit-observe', 'api-key-exec', 'usage-read'):
            path = native / name
            path.write_bytes(('File-only ' + name + ' fixture; never run.\n').encode())
            path.chmod(0o755)
        shutil.copytree(ROOT / 'bend2/ui/orchestra', self.source / 'bend2/ui/orchestra')
        PACKAGE.stage_adapters(self.payload)
        return names

    def test_archive_keeps_canonical_and_compatibility_adapter_bytes(self):
        names = self.stage_runtime_files()
        archive, provenance = self.archive_fixture()
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'adapter-extraction')
        for name in names:
            path = 'libexec/baton2/' + name
            data = (ROOT / 'bend2/scripts' / name).read_bytes()
            self.assertEqual((prefix / path).read_bytes(), data)
        for name in ('claude-credit-observe', 'api-key-exec'):
            self.assertEqual((prefix / 'libexec/baton2' / name).read_bytes(),
                             (self.source / '.scratch/bend2' / name).read_bytes())

    def test_extracted_git_helper_selects_author_with_its_source_absent(self):
        self.stage_runtime_files()
        data = (ROOT / 'bend2/harness/git-series.mjs').read_bytes()
        archive, provenance = self.archive_fixture()
        self.source.rename(self.home / 'retained source λ')
        self.assertFalse(self.source.exists())
        prefix, manifest = SMOKE.extract(archive, provenance, self.home / 'helper-extraction')
        installed = prefix / 'libexec/baton2/git-series.mjs'
        self.assertFalse((prefix / 'libexec/baton2/git-series.py').exists())
        self.assertEqual(installed.read_bytes(), data)
        wrapper = prefix / 'libexec/baton2/git-series-bin/gh'
        self.assertEqual(wrapper.read_bytes(), (ROOT / 'bend2/harness/git-series-bin/gh').read_bytes())
        self.assertTrue(os.access(wrapper, os.X_OK))
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
