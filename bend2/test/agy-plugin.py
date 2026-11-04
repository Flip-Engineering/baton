"""Check Antigravity plugin metadata and lifecycle hook wiring."""
import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
PLUGIN = ROOT / 'bend2/harness/agy-plugin'


class AgyPlugin(unittest.TestCase):
    def test_manifest_names_the_baton_plugin(self):
        manifest = json.loads((PLUGIN / 'plugin.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['name'], 'baton')

    def test_lifecycle_hooks_use_the_recorded_coordinator(self):
        config = json.loads((PLUGIN / 'hooks.json').read_text(encoding='utf-8'))
        hooks = config['baton-input']
        expected = '"$BATON_COORDINATOR" --stop-hook'
        self.assertEqual(hooks['PreInvocation'][0]['command'], expected)
        self.assertEqual(hooks['Stop'][0]['command'], expected)


if __name__ == '__main__':
    unittest.main()
