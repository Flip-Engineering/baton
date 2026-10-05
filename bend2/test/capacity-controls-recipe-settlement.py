#!/usr/bin/env python3
"""Stage settlement tests for the capacity controls production recipe.

These exercise the recipe's settlement helpers only. The recipe itself is a full
production run with real producer, compiler and endpoint effects and is never
executed here; importing it reads module-level constants and defines helpers.
"""
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def load_recipe():
    spec = importlib.util.spec_from_file_location(
        'capacity_controls_recipe', ROOT / 'bend2/test/capacity-controls-positive-recipe.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


RECIPE = load_recipe()


class RecipeSettlement(unittest.TestCase):
    def setUp(self):
        retained = ROOT / '.scratch/bend2/package-gate-fixtures'
        retained.mkdir(parents=True, exist_ok=True)
        self.run = pathlib.Path(tempfile.mkdtemp(dir=retained, prefix='recipe-settlement-'))
        self.record = []

    def rows(self):
        return json.loads((self.run / 'run.json').read_text())['children']

    def test_a_successful_stage_is_durable_before_later_failure(self):
        RECIPE.attempt(self.run, self.record, 'archive-readback',
                       lambda: {'root': 'r', 'members': 3})
        self.assertEqual([row['outcome'] for row in self.rows()], ['verified'])
        self.assertEqual(self.rows()[0]['members'], 3)

        def failing():
            raise SystemExit('the receipt step failed')

        with self.assertRaises(SystemExit):
            RECIPE.attempt(self.run, self.record, 'receipt-validation', failing)
        rows = {row['name']: row for row in self.rows()}
        self.assertEqual(rows['archive-readback']['outcome'], 'verified')
        self.assertEqual(rows['archive-readback']['members'], 3)
        self.assertEqual(rows['receipt-validation']['outcome'], 'failed')
        self.assertIn('receipt step failed', rows['receipt-validation']['failure'])

    def test_a_declared_stage_keeps_its_partial_observation(self):
        def failing():
            raise RuntimeError('extraction failed')

        with self.assertRaises(RuntimeError):
            RECIPE.attempt(self.run, self.record, 'archive-readback', failing,
                           archive='/tmp/artifact.tar.gz')
        row = self.rows()[0]
        self.assertEqual(row['name'], 'archive-readback')
        self.assertEqual(row['outcome'], 'failed')
        self.assertEqual(row['archive'], '/tmp/artifact.tar.gz')
        self.assertEqual(row['failure_type'], 'RuntimeError')

    def test_a_record_failure_preserves_the_original_cause(self):
        # The declared row is written, then persisting the terminal row fails while
        # the stage failure is being settled, so the original cause must survive.
        writes = []
        original_write = RECIPE.write_record

        def flaky(run, record):
            writes.append(len(record))
            if len(writes) > 1:
                raise RuntimeError('the run record could not be written: blocked')
            return original_write(run, record)

        RECIPE.write_record = flaky
        self.addCleanup(setattr, RECIPE, 'write_record', original_write)
        original = SystemExit('the stage itself failed')
        with self.assertRaises(SystemExit) as raised:
            RECIPE.attempt(self.run, self.record, 'archive-readback',
                           lambda: (_ for _ in ()).throw(original))
        self.assertIs(raised.exception, original)
        self.assertIn('could not be written', raised.exception.record_error)
        self.assertEqual(len(writes), 2)

    def test_settling_twice_updates_one_row(self):
        RECIPE.settle(self.run, self.record, 'archive-readback', 'attempted', archive='a')
        RECIPE.settle(self.run, self.record, 'archive-readback', 'verified', members=1)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0], {'name': 'archive-readback', 'outcome': 'verified',
                                          'archive': 'a', 'members': 1})


if __name__ == '__main__':
    unittest.main()
