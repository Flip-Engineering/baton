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

if __name__ == '__main__':
    unittest.main()
