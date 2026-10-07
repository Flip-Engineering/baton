import importlib.util
import json
import shutil
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

    def test_stages_the_exact_manifested_provider_and_frontend_closure(self):
        declaration = json.loads((self.root / 'bend2/context/bend2/selected-module.json').read_text())
        manifest = PACKAGE.stage_selected_context_payload(self.payload)
        module_root = self.payload / 'lib/context/modules/bend2'
        self.assertEqual(manifest['moduleId'], 'bend2')
        self.assertEqual({row['path'] for row in manifest['files']}, {
            'lib/context/modules/bend2/' + row['path'] for row in declaration['files']
        })
        for row in declaration['files']:
            staged = module_root / row['path']
            self.assertEqual(PACKAGE.file_info(staged), {key: row[key] for key in ('bytes', 'sha256')})
        self.assertEqual((module_root / 'selected-module.source.json').is_file(), True)

    def test_refuses_source_manifest_hash_mismatch(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][0]['sha256'] = '0' * 64
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'differs from its manifest'):
            PACKAGE.stage_selected_context_payload(self.payload)

    def test_refuses_path_escape(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][0]['path'] = '../outside.mjs'
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'Unsafe selected Bend2 artifact path'):
            PACKAGE.stage_selected_context_payload(self.payload)

    def test_refuses_changed_upstream_pin_metadata(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['upstreamPin'] = '0' * 40
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'provenance'):
            PACKAGE.stage_selected_context_payload(self.payload)


if __name__ == '__main__':
    unittest.main()
