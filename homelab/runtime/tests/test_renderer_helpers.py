import json
import tempfile
import unittest
from pathlib import Path

import farm


class RendererHelpers(unittest.TestCase):
    def test_renderer_adapter_is_in_runtime_package(self):
        adapter_path = Path(farm.__file__).resolve().parent / 'renderer-adapter.json'
        changes = json.loads(adapter_path.read_text())

        self.assertIsInstance(changes, list)
        self.assertTrue(changes)
        anchors = []
        for change in changes:
            self.assertEqual(set(change), {'old', 'new'})
            self.assertIsInstance(change['old'], str)
            self.assertIsInstance(change['new'], str)
            self.assertTrue(change['old'])
            self.assertTrue(change['new'])
            anchors.append(change['old'])
        self.assertEqual(len(anchors), len(set(anchors)))

    def test_staging_copies_all_helpers_to_harness_and_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'
            source.mkdir()
            job = root / 'job'
            for name in farm.RENDERER_HELPERS:
                (source / name).write_text(name + '\n')

            farm.stage_renderer_helpers(job, source)

            for name in farm.RENDERER_HELPERS:
                expected = name + '\n'
                self.assertEqual((job / 'harness' / name).read_text(), expected)
                self.assertEqual((job / 'out' / name).read_text(), expected)

    def test_missing_helper_fails_before_copying_partial_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'source'
            source.mkdir()
            job = root / 'job'
            (source / farm.RENDERER_HELPERS[0]).write_text('first')

            with self.assertRaisesRegex(farm.JobInputError, 'Missing renderer helper assets'):
                farm.stage_renderer_helpers(job, source)

            self.assertFalse((job / 'harness').exists())
            self.assertFalse((job / 'out').exists())


if __name__ == '__main__':
    unittest.main()
