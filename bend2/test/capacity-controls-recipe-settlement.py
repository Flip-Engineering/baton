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
        # A stage that says how far it got keeps those identities, and a stage that
        # says nothing partial records no partial identity rather than a null one.
        self.assertNotIn('partial_staged', row)

        class StoppedAfterOne(SystemExit):
            def __init__(self, message, partial=()):
                super().__init__(message)
                self.partial = list(partial)

        def partially_failing():
            raise StoppedAfterOne('staging stopped', partial=['bend2.json'])

        with self.assertRaises(StoppedAfterOne):
            RECIPE.attempt(self.run, self.record, 'archive-metadata-staged',
                           partially_failing, archive='original-archive.tar.gz')
        rows = {row['name']: row for row in self.rows()}
        partial_row = rows['archive-metadata-staged']
        self.assertEqual(partial_row['outcome'], 'failed')
        self.assertEqual(partial_row['partial_staged'], ['bend2.json'])

    def test_stage_reported_fields_reach_its_failed_row(self):
        # A stage that names what it reached and where it stopped keeps both on the
        # failure row, next to the partial identities it reports.
        def failing():
            raise RECIPE.StageFailure('the acquisition read stopped',
                                      fields={'case': 'case-1', 'boundary': 'request-bytes'},
                                      partial=['case-1'])

        with self.assertRaises(RECIPE.StageFailure):
            RECIPE.attempt(self.run, self.record, 'archive-case-acquisition', failing,
                           expected_cases=1)
        row = next(row for row in self.rows()
                   if row['name'] == 'archive-case-acquisition')
        self.assertEqual(row['outcome'], 'failed')
        self.assertEqual(row['case'], 'case-1')
        self.assertEqual(row['boundary'], 'request-bytes')
        self.assertEqual(row['partial_staged'], ['case-1'])

    def test_ordered_secondary_observations_are_preserved(self):
        # The first recording failure keeps the key and the later one is appended, so
        # the primary work exception keeps an ordered record of both.
        writes = []
        original_write = RECIPE.write_record

        def flaky(run, record):
            writes.append(len(record))
            if len(writes) > 2:
                raise RuntimeError('the run record could not be written: blocked')
            return original_write(run, record)

        RECIPE.write_record = flaky
        self.addCleanup(setattr, RECIPE, 'write_record', original_write)

        def inner_work():
            raise ValueError('the stage work failed')

        with self.assertRaises(ValueError) as raised:
            RECIPE.attempt(self.run, self.record, 'outer-stage',
                           lambda: RECIPE.attempt(self.run, self.record, 'inner-stage',
                                                  inner_work))
        primary = raised.exception
        self.assertIn('the stage work failed', str(primary))
        self.assertIsInstance(primary.record_error, RuntimeError)
        self.assertEqual(len(primary.record_error_chain), 1)
        self.assertIsInstance(primary.record_error_chain[0], RuntimeError)
        self.assertIsNot(primary.record_error, primary.record_error_chain[0])

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
        self.assertIn('could not be written',
                      raised.exception.record_error_text)
        self.assertIn('could not be written', str(raised.exception.record_error))
        self.assertEqual(len(writes), 2)

    def test_a_prepopulated_record_survives_a_failed_replacement(self):
        # An earlier completed run left rows behind. A failed staged replacement
        # must leave those rows exactly as they were.
        RECIPE.settle(self.run, self.record, 'preconditions', 'observed', run=1)
        RECIPE.settle(self.run, self.record, 'consume', 'qualified', cases=3)
        before = (self.run / 'run.json').read_bytes()
        staged = self.run / 'run.json.next'
        staged.mkdir()
        (staged / 'occupied').write_text('still here\n')
        with self.assertRaises(RuntimeError) as raised:
            RECIPE.write_record(self.run, self.record + [{'name': 'archive-readback'}])
        self.assertIn('could not be written', str(raised.exception))
        self.assertIsNotNone(raised.exception.cleanup_error)
        self.assertEqual((self.run / 'run.json').read_bytes(), before)
        self.assertEqual([row['name'] for row in self.rows()],
                         ['preconditions', 'consume'])

    def test_work_record_and_cleanup_failure_together(self):
        # The declared row persists, then the stage work fails and occupies the
        # replacement name, so the terminal record cannot be written and its own
        # cleanup fails: the original work error must still be raised.
        RECIPE.settle(self.run, self.record, 'preconditions', 'observed', run=1)
        staged = self.run / 'run.json.next'
        original = SystemExit('the stage itself failed')
        observed = {}

        def failing_work():
            # The declared row is already persisted by attempt, so the latest
            # complete record is captured here, before the terminal write fails:
            # both its parsed rows and its exact bytes.
            observed['attempted'] = [dict(row) for row in self.rows()]
            observed['bytes'] = (self.run / 'run.json').read_bytes()
            staged.mkdir()
            (staged / 'occupied').write_text('still here\n')
            raise original

        with self.assertRaises(SystemExit) as raised:
            RECIPE.attempt(self.run, self.record, 'archive-readback', failing_work)
        self.assertIs(raised.exception, original)
        self.assertEqual([row['name'] for row in observed['attempted']],
                         ['preconditions', 'archive-readback'])
        self.assertEqual(observed['attempted'][1]['outcome'], 'attempted')
        # The attempted row and the earlier row both survive the failed terminal write.
        self.assertEqual([row['name'] for row in self.rows()],
                         ['preconditions', 'archive-readback'])
        self.assertEqual(self.rows()[1]['outcome'], 'attempted')
        # The failed terminal write left the latest complete record byte for byte.
        self.assertEqual((self.run / 'run.json').read_bytes(), observed['bytes'])
        # The recording cause keeps its own cleanup detail.
        self.assertIn('could not be written', str(raised.exception.record_error))
        self.assertIsNotNone(raised.exception.record_error.cleanup_error)

    def test_a_replace_failure_keeps_the_prior_record(self):
        # Staging succeeds and the swap fails, so the prior record must survive and
        # the staged file must not be left behind.
        RECIPE.settle(self.run, self.record, 'preconditions', 'observed', run=1)
        before = (self.run / 'run.json').read_bytes()
        record_path = self.run / 'run.json'
        original_replace = RECIPE.os.replace
        RECIPE.os.replace = lambda source, target: (_ for _ in ()).throw(
            OSError('the swap failed'))
        self.addCleanup(setattr, RECIPE.os, 'replace', original_replace)
        with self.assertRaises(RuntimeError) as raised:
            RECIPE.write_record(self.run, self.record + [{'name': 'archive-readback'}])
        self.assertIn('could not be written', str(raised.exception))
        self.assertIsNone(raised.exception.cleanup_error)
        self.assertEqual(record_path.read_bytes(), before)
        self.assertFalse((self.run / 'run.json.next').exists())

    def test_a_stale_staged_file_is_replaced(self):
        # A leftover staged file from an earlier attempt is overwritten, and the
        # record ends correct with nothing staged left behind.
        RECIPE.settle(self.run, self.record, 'preconditions', 'observed', run=1)
        (self.run / 'run.json.next').write_text('{"children": [{"name": "stale"}]}\n')
        RECIPE.settle(self.run, self.record, 'consume', 'qualified', cases=2)
        self.assertEqual([row['name'] for row in self.rows()],
                         ['preconditions', 'consume'])
        self.assertFalse((self.run / 'run.json.next').exists())

    def test_successful_work_with_a_failing_terminal_record(self):
        # The work succeeds and its terminal record cannot be written: the stage
        # outcome and observed value stay attached to the recording error.
        writes = []
        original_write = RECIPE.write_record

        def failing_write(run, record):
            writes.append(len(record))
            if len(writes) > 1:
                raise RuntimeError('the run record could not be written: blocked')
            return original_write(run, record)

        RECIPE.write_record = failing_write
        self.addCleanup(setattr, RECIPE, 'write_record', original_write)
        with self.assertRaises(RuntimeError) as raised:
            RECIPE.attempt(self.run, self.record, 'archive-readback',
                           lambda: {'root': 'r', 'members': 2})
        self.assertIn('could not be written', str(raised.exception))
        self.assertEqual(raised.exception.stage, 'archive-readback')
        self.assertEqual(raised.exception.stage_outcome, 'completed')
        self.assertEqual(raised.exception.stage_value, {'root': 'r', 'members': 2})
        # The declared row is the only one persisted, and it says only that the
        # stage was attempted.
        self.assertEqual([row['outcome'] for row in self.rows()], ['attempted'])

    def test_settling_twice_updates_one_row(self):
        RECIPE.settle(self.run, self.record, 'archive-readback', 'attempted', archive='a')
        RECIPE.settle(self.run, self.record, 'archive-readback', 'verified', members=1)
        self.assertEqual(len(self.rows()), 1)
        self.assertEqual(self.rows()[0], {'name': 'archive-readback', 'outcome': 'verified',
                                          'archive': 'a', 'members': 1})


if __name__ == '__main__':
    unittest.main()
