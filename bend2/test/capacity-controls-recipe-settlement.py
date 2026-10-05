#!/usr/bin/env python3
"""Stage settlement tests for the capacity controls production recipe.

These exercise the recipe's settlement helpers only. The recipe itself is a full
production run with real producer, compiler and endpoint effects and is never
executed here; importing it reads module-level constants and defines helpers.
"""
import importlib.util
import io
import json
import pathlib
import tarfile
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

    def add_member(self, archive, name, data):
        info = tarfile.TarInfo(name)
        info.size = len(data)
        archive.addfile(info, io.BytesIO(data))

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

    def test_extraction_reaches_members_only_after_a_complete_preflight(self):
        # A complete preflight passes, so every member is extracted and the verified
        # row reports the members actually completed.
        archive_path = self.run / 'original-archive.tar.gz'
        with tarfile.open(archive_path, 'w:gz') as archive:
            self.add_member(archive, 'bend2/manifest.json',
                            json.dumps({'archive_root': 'bend2'}).encode())
            self.add_member(archive, 'bend2/controls-evidence/bend2.json', b'{}')
        target = self.run / 'readback'
        target.mkdir()
        facts = RECIPE.extract_archive(self.run, self.record, archive_path, target)
        self.assertEqual(facts['root'], 'bend2')
        self.assertEqual(facts['manifest_member'], 'bend2/manifest.json')
        row = next(row for row in self.rows() if row['name'] == 'archive-extracted')
        self.assertEqual(row['outcome'], 'verified')
        self.assertEqual(row['members'], 2)
        # Every authored member is extracted with its own bytes.
        self.assertEqual((target / 'bend2/manifest.json').read_bytes(),
                         json.dumps({'archive_root': 'bend2'}).encode())
        self.assertEqual((target / 'bend2/controls-evidence/bend2.json').read_bytes(), b'{}')

    def test_a_failure_partway_keeps_the_members_it_reached(self):
        # A later member cannot be written where the target already holds a file of
        # that name, so the failure records the members extracted before it and the
        # member it was handling when it failed, with the original exception object.
        archive_path = self.run / 'partial-archive.tar.gz'
        with tarfile.open(archive_path, 'w:gz') as archive:
            self.add_member(archive, 'bend2/manifest.json', b'{}')
            self.add_member(archive, 'bend2/controls-evidence/bend2.json', b'{}')
        target = self.run / 'partial-readback'
        (target / 'bend2').mkdir(parents=True)
        (target / 'bend2/controls-evidence').write_bytes(b'occupied')
        with self.assertRaises(Exception) as raised:
            RECIPE.extract_archive(self.run, self.record, archive_path, target)
        row = next(row for row in self.rows() if row['name'] == 'archive-extracted')
        self.assertEqual(row['outcome'], 'failed')
        self.assertIn('manifest.json', row['members_extracted_names'])
        self.assertEqual(row['failing_member'], 'bend2/controls-evidence/bend2.json')
        self.assertEqual(row['members_extracted'], 1)
        self.assertIn(str(raised.exception), row['failure'])

    def test_a_failed_verified_write_keeps_the_extraction_outcome(self):
        # The extraction succeeds and its verified row cannot be written, so the
        # recording error carries the stage outcome and the value it observed.
        archive_path = self.run / 'record-archive.tar.gz'
        with tarfile.open(archive_path, 'w:gz') as archive:
            self.add_member(archive, 'bend2/manifest.json', b'{}')
        target = self.run / 'record-readback'
        target.mkdir()
        writes = []
        original_write = RECIPE.write_record

        def flaky(run, record):
            writes.append(len(record))
            if len(writes) > 1:
                raise RuntimeError('the run record could not be written: blocked')
            return original_write(run, record)

        RECIPE.write_record = flaky
        self.addCleanup(setattr, RECIPE, 'write_record', original_write)
        with self.assertRaises(RuntimeError) as raised:
            RECIPE.extract_archive(self.run, self.record, archive_path, target)
        self.assertEqual(raised.exception.stage, 'archive-extracted')
        self.assertEqual(raised.exception.stage_outcome, 'verified')
        self.assertEqual(raised.exception.stage_value['members'], 1)

    def test_metadata_staging_reports_copied_and_verified_separately(self):
        # The actual metadata caller copies both documents, verifies both, and a
        # document whose digest disagrees fails with the document being verified.
        package = RECIPE.package_handle()
        archived = self.run / 'archived'
        archived.mkdir()
        documents = {}
        for name in package.ARCHIVE_METADATA:
            (archived / name).write_bytes(json.dumps({'name': name}).encode())
            documents[name] = RECIPE.digest(archived / name)
        retained = self.run / 'original-archive.tar.gz'
        retained.write_bytes(b'archive bytes')
        digest = RECIPE.digest(retained)
        facts = RECIPE.stage_metadata(self.run, self.record, archived, retained,
                                      self.run / 'metadata', digest, documents)
        self.assertEqual(facts['documents_copied'], sorted(documents))
        self.assertEqual(facts['documents_verified'], sorted(documents))
        self.assertEqual(facts['retained_archive_sha256'], digest)

        wrong = dict(documents)
        wrong['reduction.json'] = 'c' * 64
        with self.assertRaises(RECIPE.StageFailure) as raised:
            RECIPE.stage_metadata(self.run, self.record, archived, retained,
                                  self.run / 'metadata', digest, wrong)
        fields = raised.exception.fields
        self.assertEqual(fields['boundary'], 'retained-metadata')
        # Documents are verified in the archive metadata order, so the first one is
        # the document being verified when the refusal happens.
        self.assertEqual(fields['metadata_member'], 'inventory.json')
        self.assertEqual(fields['metadata_verified'], [])
        self.assertEqual(raised.exception.partial, sorted(documents))

    def test_the_envelope_caller_names_the_operation_it_reached(self):
        # A written envelope reports its digest, and a write that cannot happen
        # reports the write operation rather than the hash step.
        path = self.run / 'archive-envelope.json'
        written = RECIPE.write_envelope(self.run, self.record,
                                        {'reduction_sha256': 'a' * 64}, path)
        self.assertEqual(written['envelope'], 'archive-envelope.json')
        self.assertEqual(written['envelope_sha256'], RECIPE.digest(path))

        blocked = self.run / 'envelope-directory'
        blocked.mkdir()
        with self.assertRaises(Exception) as raised:
            RECIPE.write_envelope(self.run, self.record, {'reduction_sha256': 'a' * 64},
                                  blocked)
        fields = raised.exception.fields
        self.assertEqual(fields['operation'], 'envelope-write')
        self.assertEqual(fields['boundary'], 'archive-envelope')
        self.assertTrue(fields['envelope_present'])

    def test_a_preflight_refusal_names_the_member_and_extracts_nothing(self):
        # The unsafe member is refused during the preflight, before any member is
        # extracted, and the failure row keeps the member and the boundary.
        archive_path = self.run / 'unsafe-archive.tar.gz'
        with tarfile.open(archive_path, 'w:gz') as archive:
            self.add_member(archive, 'bend2/manifest.json', b'{}')
            self.add_member(archive, '../escaped.json', b'{}')
        target = self.run / 'unsafe-readback'
        target.mkdir()
        with self.assertRaises(RECIPE.StageFailure):
            RECIPE.extract_archive(self.run, self.record, archive_path, target)
        row = next(row for row in self.rows() if row['name'] == 'archive-extracted')
        self.assertEqual(row['outcome'], 'failed')
        self.assertEqual(row['member'], '../escaped.json')
        self.assertEqual(row['boundary'], 'archive-member-kind')
        self.assertEqual(row['members_extracted'], 0)
        self.assertFalse((target / 'bend2').exists())

    def test_the_composed_boundary_accepts_a_raw_alias_verifier(self):
        # The endpoint emits its raw verifier map with the classifier member under a
        # historical spelling, while the reader composition stores the canonical
        # closure: the contract compares the two through the member contract, so the
        # alias spelling is accepted, an equal dual spelling is accepted, and a
        # conflicting one is refused by the composition.
        package = RECIPE.package_handle()
        admitted, missing = package.expected_verifier_digests()
        if missing:
            self.skipTest('this checkout lacks admitted verifier source: '
                          + repr(sorted(missing)))
        fields = {'id': 'case-1', 'schema': 'capacity-controls/classify-verdict@1',
                  'class': 'bend2-native', 'attributed_law': 'laws-check', 'match': True,
                  'qualified': True, 'law': 'laws-check', 'evidence_verified': True,
                  'diagnostic_sha256': 'a' * 64, 'acquisition': {'state': 'exited'}}
        historical = {}
        for member in package.VERIFIER_MEMBERS:
            alias = package.VERIFIER_MEMBER_ALIASES.get(member)
            historical[alias or member] = admitted[member]
        canonical = package.require_verifier_closure({'verifier': historical}, 'fixture')
        response = dict(fields, verifier=historical)
        verdict = dict(fields, verifier=canonical)
        RECIPE.bind_response_to_verdict(response, verdict, 'case-1')

        dual = dict(historical)
        for member in package.VERIFIER_MEMBERS:
            dual[member] = admitted[member]
        RECIPE.bind_response_to_verdict(dict(fields, verifier=dual),
                                        dict(fields,
                                             verifier=package.require_verifier_closure(
                                                 {'verifier': dual}, 'fixture')),
                                        'case-1')

        conflict = dict(dual)
        conflict['classifier_module_sha256'] = 'b' * 64
        with self.assertRaises(RuntimeError):
            package.require_verifier_closure({'verifier': conflict}, 'fixture')

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
