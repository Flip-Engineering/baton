import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/package-native.py'
SPEC = importlib.util.spec_from_file_location('package_native', SCRIPT)
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)


class SelectedContextPackageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        source = self.root / 'bend2/context/bend2'
        source.mkdir(parents=True)
        (source / 'native-provider.mjs').write_text('export const provider = true;\n')
        provider_hash = PACKAGE.file_info(source / 'native-provider.mjs')['sha256']
        (source / 'native-provider.declaration.json').write_text(json.dumps({
            'schema': 'baton2-native-module-declaration-v1',
            'moduleId': 'bend2',
            'protocolVersion': '2',
            'entry': {'artifact': 'native-provider.mjs', 'argv': []},
            'artifactIdentities': [{
                'packagePath': 'native-provider.mjs', 'sha256': provider_hash, 'role': 'provider',
            }],
            'schemaIdentities': ['result-v1', 'event-v1'],
            'operations': [{
                'operation': 'sourceAnalysis', 'implements': 'sourceAnalysis',
                'resultSchema': 'result-v1', 'eventSchema': 'event-v1',
            }],
        }) + '\n')
        files = []
        for name in ('native-provider.declaration.json', 'native-provider.mjs'):
            path = source / name
            files.append({'path': name, **PACKAGE.file_info(path)})
        (source / 'selected-module.json').write_text(json.dumps({
            'schema': 'baton2-selected-context-payload-v1',
            'moduleId': 'bend2',
            'protocolVersion': '2',
            'files': files,
        }))
        self.previous_root = PACKAGE.ROOT
        PACKAGE.ROOT = self.root
        self.payload = self.root / 'payload'
        self.payload.mkdir()

    def tearDown(self):
        PACKAGE.ROOT = self.previous_root
        self.temp.cleanup()

    def test_stages_only_manifested_artifacts_with_verified_hashes(self):
        manifest = PACKAGE.stage_selected_context_payload(self.payload)
        staged = self.payload / 'lib/context/modules/bend2/native-provider.mjs'
        self.assertTrue(staged.is_file())
        self.assertEqual(manifest['moduleId'], 'bend2')
        self.assertEqual({row['path'] for row in manifest['files']}, {
            'lib/context/modules/bend2/native-provider.declaration.json',
            'lib/context/modules/bend2/native-provider.mjs',
        })
        self.assertEqual(PACKAGE.sha256(staged), PACKAGE.sha256(
            self.root / 'bend2/context/bend2/native-provider.mjs'))

    def test_refuses_manifest_hash_mismatch(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][1]['sha256'] = '0' * 64
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'differs from its manifest'):
            PACKAGE.stage_selected_context_payload(self.payload)

    def test_refuses_path_escape(self):
        manifest_path = self.root / 'bend2/context/bend2/selected-module.json'
        manifest = json.loads(manifest_path.read_text())
        manifest['files'][1]['path'] = '../outside.mjs'
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, 'Unsafe selected Bend2 artifact path'):
            PACKAGE.stage_selected_context_payload(self.payload)


if __name__ == '__main__':
    unittest.main()
