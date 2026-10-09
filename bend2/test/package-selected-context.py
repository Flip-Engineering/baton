import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-native.py'
SOURCE = Path(__file__).resolve().parents[1] / 'context/bend2'
TYPESCRIPT_SOURCE = Path(__file__).resolve().parents[1] / 'context/typescript'
SPEC = importlib.util.spec_from_file_location('package_native', SCRIPT)
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class SelectedContextPackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / 'bend2/context/bend2'
        shutil.copytree(SOURCE, source)
        self.previous_root = PACKAGE.ROOT
        PACKAGE.ROOT = self.root
        self.payload = self.root / 'payload'
        self.payload.mkdir()

    def tearDown(self):
        PACKAGE.ROOT = self.previous_root
        self.temp.cleanup()

    def test_stages_the_selected_provider_and_frontend_files(self):
        declaration = json.loads((self.root / 'bend2/context/bend2/selected-module.json').read_text())
        selected = PACKAGE.stage_selected_context_payload(self.payload)
        module_root = self.payload / 'lib/context/modules/m-62656e6432'
        self.assertEqual(selected, {'moduleId': 'bend2', 'protocolVersion': '2',
                                   'path': 'lib/context/modules/m-62656e6432'})
        for row in declaration['files']:
            staged = module_root / row['path']
            source = self.root / 'bend2/context/bend2' / row['path']
            self.assertEqual(staged.read_bytes(), source.read_bytes())

    def test_refuses_path_escape(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][0]['path'] = '../outside.mjs'
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'Unsafe selected Bend2 artifact path'):
            PACKAGE.stage_selected_context_payload(self.payload)

    def test_staged_provider_executes_and_returns_a_source_analysis_result(self):
        module_root = self.payload / 'lib/context/modules/m-62656e6432'
        PACKAGE.stage_selected_context_payload(self.payload)
        repository = Path(__file__).resolve().parents[2]
        integration = repository / 'bend2/context/bend2/native-provider.integration.mjs'
        result = subprocess.run([
            'node', str(integration), str(module_root), str(repository),
            'bend2/context/bend2/fixtures/valid.bend',
        ], cwd=repository, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)['status'], 'passed', result.stdout)

    def test_selected_typescript_invocation_preserves_native_identity_and_source_results(self):
        compiler = os.environ.get('BATON2_CONTEXT_TYPESCRIPT')
        if compiler is None:
            self.skipTest('Selected TypeScript runtime requires BATON2_CONTEXT_TYPESCRIPT')
        source = self.root / 'bend2/context/typescript'
        shutil.copytree(TYPESCRIPT_SOURCE, source)
        fixture_compiler = self.root / 'installed compiler'
        shutil.copytree(Path(compiler), fixture_compiler)
        compiler_metadata_path = fixture_compiler / 'package.json'
        compiler_metadata = json.loads(compiler_metadata_path.read_text())
        compiler_metadata['version'] += '+selected-fixture'
        compiler_metadata_path.write_text(json.dumps(compiler_metadata))
        selected = PACKAGE.stage_typescript_context_module(self.payload, fixture_compiler)
        module_root = self.payload / selected['path']
        declaration = json.loads((module_root / 'native-provider.declaration.json').read_text())
        self.assertEqual(declaration['protocolVersion'], '2')

        project = self.root / 'typescript project'
        (project / 'src').mkdir(parents=True)
        (project / 'tsconfig.json').write_text(json.dumps({
            'compilerOptions': {'strict': True, 'noEmit': True, 'types': [], 'typeRoots': []},
            'include': ['src/**/*.ts'],
        }))
        entry = project / 'src/app.ts'
        entry.write_text('export function double(value: number): number { return value * 2; }\n'
                         'export const result = double(21);\n'
                         'export const wrong: string = 3;\n')
        wrapper = self.payload / 'libexec/baton2/context-provider.mjs'
        wrapper.parent.mkdir(parents=True)
        shutil.copyfile(SCRIPT.parent / 'context-provider.mjs', wrapper)
        binding = {'id': 'typescript', 'revision': declaration['revision'],
                   'packageIdentity': declaration['packageIdentity']}
        invocation = {
            'version': 2, 'query': 'selected-typescript', 'owner': 'typescript-owner',
            'moduleBinding': binding,
            'request': {
                'version': 1, 'engine': 'typescript',
                'subject': {'kind': 'symbol', 'path': 'src/app.ts', 'name': 'double'},
                'select': ['definition', 'type', 'references', 'diagnostics'],
                'cwd': str(project), 'options': {'project': 'tsconfig.json'},
            },
            'inputIdentities': [],
            'operationPlan': [{'common': 'sourceAnalysis', 'operation': 'sourceAnalysis'}],
            'role': 'starter', 'incarnation': '7',
        }
        result = subprocess.run(['node', str(wrapper)], input=json.dumps(invocation),
                                cwd=project, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        frame = json.loads(result.stdout)
        self.assertEqual((frame['version'], frame['query'], frame['owner']),
                         (2, invocation['query'], invocation['owner']))
        self.assertEqual(frame['moduleBinding'], binding)
        self.assertEqual((frame['role'], frame['incarnation'], frame['sequence']), ('starter', '7', '1'))
        payload = frame['payload']
        self.assertEqual(payload['status'], 'completed', result.stdout)
        self.assertEqual(payload['schema'], 'baton2.context.typescript.source-analysis.result.v1')
        self.assertEqual(payload['query'], invocation['query'])
        self.assertEqual(payload['provider']['version'], compiler_metadata['version'])
        self.assertTrue({'definition', 'type', 'diagnostic'}.issubset(
            {fact['kind'] for fact in payload['facts']}), result.stdout)
        inputs = payload['snapshot']['inputs']
        self.assertTrue(any(row['path'] == str(entry) and row['sha256'] for row in inputs), result.stdout)
        self.assertTrue(payload['refs'], result.stdout)
        self.assertTrue(all(ref['snapshotId'] == payload['snapshot']['snapshotId']
                            for ref in payload['refs']), result.stdout)
        invocation['request']['subject']['path'] = 'src/missing.ts'
        failed = subprocess.run(['node', str(wrapper)], input=json.dumps(invocation),
                                cwd=project, capture_output=True, text=True)
        self.assertEqual(failed.returncode, 0, failed.stdout + failed.stderr)
        failure = json.loads(failed.stdout)
        self.assertEqual((failure['query'], failure['owner'], failure['moduleBinding']),
                         (invocation['query'], invocation['owner'], binding))
        self.assertEqual(failure['payload']['status'], 'unavailable', failed.stdout)
        self.assertEqual(failure['payload']['reason'], 'context-subject-not-in-program', failed.stdout)
        self.assertTrue(failure['payload']['detail'], failed.stdout)

    def test_installed_native_cli_completes_a_selected_source_analysis(self):
        repository = Path(__file__).resolve().parents[2]
        coordinator = repository / '.scratch/bend2/baton2'
        if not coordinator.is_file():
            self.skipTest(f'Production coordinator not built at {coordinator}')
        node = shutil.which('node')
        if node is None:
            self.skipTest('Installed context query requires Node.js 22.15 or newer')
        version = subprocess.run([node, '--version'], capture_output=True, text=True)
        self.assertEqual(version.returncode, 0, version.stdout + version.stderr)
        major, minor = (int(part) for part in version.stdout.strip().lstrip('v').split('.')[:2])
        if (major, minor) < (22, 15):
            self.skipTest('Installed context query requires Node.js 22.15 or newer')

        previous_root = PACKAGE.ROOT
        PACKAGE.ROOT = repository
        try:
            PACKAGE.stage_adapters(self.payload)
            PACKAGE.stage_selected_context_payload(self.payload)
        finally:
            PACKAGE.ROOT = previous_root

        installed = self.payload / 'bin/baton2'
        installed.parent.mkdir(parents=True)
        shutil.copyfile(coordinator, installed)
        installed.chmod(0o755)
        database = self.root / 'state.db'

        def invoke(*args, cwd=repository):
            return subprocess.run([str(installed), str(database), *args], cwd=cwd,
                                  capture_output=True, text=True)

        attached = invoke('attach', 'validation-root', 'codex', 'fixture-native',
                          '')
        self.assertEqual(attached.returncode, 0, attached.stdout + attached.stderr)
        role = invoke('role', 'validation-root', 'principal-conductor')
        self.assertEqual(role.returncode, 0, role.stdout + role.stderr)

        project = self.root / 'project'
        fixture = project / 'bend2/context/bend2/fixtures/valid.bend'
        fixture.parent.mkdir(parents=True)
        shutil.copyfile(SOURCE / 'fixtures/valid.bend', fixture)
        project.mkdir(exist_ok=True)
        subprocess.run(['git', 'init', '-b', 'main', str(project)], check=True,
                       capture_output=True, text=True)
        subprocess.run(['git', 'add', '.'], cwd=project, check=True,
                       capture_output=True, text=True)
        subprocess.run(['git', '-c', 'user.name=Context fixture',
                        '-c', 'user.email=context-fixture@example.invalid',
                        '-c', 'core.hooksPath=/dev/null',
                        'commit', '-m', 'Add valid Bend source fixture'],
                       cwd=project, check=True, capture_output=True, text=True)

        worktree = self.root / 'owner-worktree'
        recruited = invoke('recruit', 'validation-owner', 'validation-root', 'codex',
                           'fixture-model', 'low', str(project), 'context-query-fixture',
                           str(worktree), 'HEAD')
        self.assertEqual(recruited.returncode, 0, recruited.stdout + recruited.stderr)

        query = 'installed-source-analysis'
        request = self.root / 'request.json'
        request.write_text(json.dumps({
            'version': 1,
            'subject': {'kind': 'symbol',
                        'path': 'bend2/context/bend2/fixtures/valid.bend',
                        'name': 'id'},
            'select': ['definition'],
            'cwd': str(worktree),
        }) + '\n')
        submitted = invoke('context-query-file', 'validation-owner', query, str(request),
                           cwd=worktree)
        self.assertEqual(submitted.returncode, 0, submitted.stdout + submitted.stderr)

        retained = invoke('context-result', query, cwd=worktree)
        self.assertEqual(retained.returncode, 0, retained.stdout + retained.stderr)
        envelope = json.loads(retained.stdout)
        self.assertEqual(envelope['query'], query)
        self.assertEqual(envelope['owner'], 'validation-owner')
        self.assertEqual(envelope['state'], 'complete', retained.stdout)

        payload = envelope['result']['payload']
        self.assertEqual(payload['schema'],
                         'baton2.context.bend2.source-analysis.result.v1', retained.stdout)
        self.assertEqual(payload['status'], 'completed', retained.stdout)

        compiler = os.environ.get('BATON2_CONTEXT_TYPESCRIPT')
        if compiler is not None:
            previous_root = PACKAGE.ROOT
            PACKAGE.ROOT = repository
            try:
                PACKAGE.stage_typescript_context_module(self.payload, Path(compiler))
            finally:
                PACKAGE.ROOT = previous_root
            (worktree / 'analysis.ts').write_text('export const answer: number = 42;\n')
            request.write_text(json.dumps({
                'version': 1, 'engine': 'typescript',
                'subject': {'kind': 'symbol', 'path': 'analysis.ts', 'name': 'answer'},
                'select': ['definition', 'type'], 'cwd': str(worktree),
            }) + '\n')
            submitted = invoke('context-query-file', 'validation-owner', 'installed-typescript',
                               str(request), cwd=worktree)
            self.assertEqual(submitted.returncode, 0, submitted.stdout + submitted.stderr)
            retained = invoke('context-result', 'installed-typescript', cwd=worktree)
            self.assertEqual(retained.returncode, 0, retained.stdout + retained.stderr)
            envelope = json.loads(retained.stdout)
            self.assertEqual(envelope['state'], 'complete', retained.stdout)
            payload = envelope['result']['payload']
            self.assertEqual(payload['schema'], 'baton2.context.typescript.source-analysis.result.v1')
            self.assertEqual(payload['status'], 'completed', retained.stdout)
            self.assertTrue({'definition', 'type'}.issubset(
                {fact['kind'] for fact in payload['facts']}), retained.stdout)

if __name__ == '__main__':
    unittest.main()
