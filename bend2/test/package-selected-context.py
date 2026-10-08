import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-native.py'
SOURCE = Path(__file__).resolve().parents[1] / 'context/bend2'
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

if __name__ == '__main__':
    unittest.main()
