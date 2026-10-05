#!/usr/bin/env python3
"""Remote failure-path controls for the actual capture helper; no provider runs."""
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import host_control_capture as capture


class Child:
    pid = 12345

    def __init__(self, primary, cleanup_fails=False):
        self.primary = primary
        self.cleanup_fails = cleanup_fails
        self.returncode = None
        self.calls = []

    def wait(self, timeout):
        self.calls.append(('wait', timeout))
        if len(self.calls) == 1:
            raise self.primary
        if self.cleanup_fails:
            raise subprocess.TimeoutExpired(['fixture'], timeout)
        self.returncode = -15
        return self.returncode

    def poll(self):
        self.calls.append(('poll',))
        if self.cleanup_fails:
            raise OSError('poll failed')
        return self.returncode

    def terminate(self):
        self.calls.append(('terminate',))
        if self.cleanup_fails:
            raise OSError('terminate failed')

    def kill(self):
        self.calls.append(('kill',))
        if self.cleanup_fails:
            raise OSError('kill failed')


class CaptureFailures(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='capture-failure-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)

    def run_child(self, child):
        with patch.object(capture.subprocess, 'Popen', return_value=child):
            try:
                capture.run(self.directory, 'case', ['fixture'], 7)
            except BaseException as error:
                self.assertIs(error, child.primary)
                return error.capture_record
        self.fail('original exception was not propagated')

    def test_timeout_cleanup_and_final_receipt_failures_preserve_primary(self):
        primary = subprocess.TimeoutExpired(['fixture'], 7)
        child = Child(primary, cleanup_fails=True)
        original_save = capture.save

        def save(path, value):
            if isinstance(value, dict) and 'finishedNs' in value:
                raise OSError('final receipt failed')
            return original_save(path, value)

        with patch.object(capture, 'save', side_effect=save):
            record = self.run_child(child)
        self.assertEqual(record['state'], 'timeout')
        self.assertEqual(record['childCustody'], 'unresolved')
        self.assertIsNone(record['returncode'])
        self.assertEqual(child.calls, [('wait', 7), ('poll',), ('terminate',),
                                       ('wait', 5), ('kill',), ('wait', 5)])
        failures = [item['operation'] for item in record['cleanup']
                    if item['state'] == 'failed']
        self.assertEqual(failures, ['poll', 'terminate', 'wait-after-terminate',
                                    'kill', 'wait-after-kill'])
        self.assertEqual(record['receiptWrites'][-1]['operation'], 'final')
        self.assertEqual(record['receiptWrites'][-1]['state'], 'failed')
        self.assertTrue((self.directory / 'case.stdout').exists())
        self.assertTrue((self.directory / 'case.stderr').exists())

    def test_interruption_preserves_identity_and_reaped_status(self):
        primary = InterruptedError('original interruption')
        child = Child(primary)
        record = self.run_child(child)
        self.assertEqual(record['state'], 'interrupted')
        self.assertEqual(record['childCustody'], 'reaped')
        self.assertEqual(record['signal'], 15)
        self.assertEqual(child.calls, [('wait', 7), ('poll',), ('terminate',), ('wait', 5)])
        retained = json.loads((self.directory / 'case.outcome.json').read_text())
        self.assertEqual(retained['primaryError']['message'], str(primary))
        self.assertEqual(retained['returncode'], -15)

    def test_setup_receipt_error_is_retained_without_launch(self):
        primary = OSError('argv receipt failed')
        original_save = capture.save

        def save(path, value):
            if path.name.endswith('.argv.json'):
                raise primary
            return original_save(path, value)

        with patch.object(capture, 'save', side_effect=save), \
                patch.object(capture.subprocess, 'Popen') as launch:
            with self.assertRaises(OSError) as raised:
                capture.run(self.directory, 'case', ['fixture'], 7)
        self.assertIs(raised.exception, primary)
        launch.assert_not_called()
        retained = json.loads((self.directory / 'case.outcome.json').read_text())
        self.assertEqual(retained['state'], 'setup-error')
        self.assertEqual(retained['childCustody'], 'not-launched')
        self.assertEqual(retained['launchStage'], 'not-entered')
        self.assertEqual(retained['primaryError']['message'], str(primary))
        self.assertEqual(retained['receiptWrites'][0]['state'], 'failed')

    def test_launch_interruption_without_handle_retains_unknown_custody(self):
        primary = InterruptedError('interrupted inside launch')
        with patch.object(capture.subprocess, 'Popen', side_effect=primary) as launch:
            with self.assertRaises(InterruptedError) as raised:
                capture.run(self.directory, 'case', ['fixture'], 7)
        self.assertIs(raised.exception, primary)
        launch.assert_called_once()
        record = primary.capture_record
        self.assertEqual(record['launchStage'], 'entered')
        self.assertEqual(record['childCustody'], 'unresolved')
        self.assertIsNone(record['pid'])
        self.assertIsNone(record['returncode'])
        self.assertEqual([entry['operation'] for entry in record['cleanup']],
                         ['close-stdout', 'close-stderr', 'restore-sigterm'])
        retained = json.loads((self.directory / 'case.outcome.json').read_text())
        self.assertEqual(retained['launchStage'], 'entered')
        self.assertEqual(retained['childCustody'], 'unresolved')

    def test_existing_capture_is_preserved_without_launch(self):
        (self.directory / 'case.capture').mkdir()
        prior = self.directory / 'case.outcome.json'
        prior.write_bytes(b'original receipt')
        with patch.object(capture.subprocess, 'Popen') as launch:
            with self.assertRaises(FileExistsError) as raised:
                capture.run(self.directory, 'case', ['fixture'], 7)
        launch.assert_not_called()
        self.assertEqual(prior.read_bytes(), b'original receipt')
        self.assertEqual(raised.exception.capture_record['state'], 'setup-error')

    def test_close_failure_does_not_skip_other_cleanup(self):
        primary = InterruptedError('original interruption')
        child = Child(primary)
        original_open = Path.open

        class CloseFailure:
            def __init__(self, stream):
                self.stream = stream

            def close(self):
                self.stream.close()
                raise OSError('stdout close failed')

        def opened(path, *args, **kwargs):
            stream = original_open(path, *args, **kwargs)
            return CloseFailure(stream) if path.name == 'case.stdout' else stream

        with patch.object(Path, 'open', opened):
            record = self.run_child(child)
        outcomes = {entry['operation']: entry['state'] for entry in record['cleanup']}
        self.assertEqual(outcomes['close-stdout'], 'failed')
        self.assertEqual(outcomes['close-stderr'], 'returned')
        self.assertEqual(outcomes['restore-sigterm'], 'returned')
        self.assertEqual(record['childCustody'], 'reaped')

    def test_final_receipt_failure_after_exit_is_propagated(self):
        child = Child(None)
        child.returncode = 0
        primary = OSError('final receipt failed')
        original_save = capture.save

        def save(path, value):
            if isinstance(value, dict) and 'finishedNs' in value:
                raise primary
            return original_save(path, value)

        with patch.object(child, 'wait', return_value=0), \
                patch.object(capture.subprocess, 'Popen', return_value=child), \
                patch.object(capture, 'save', side_effect=save):
            with self.assertRaises(OSError) as raised:
                capture.run(self.directory, 'case', ['fixture'], 7)
        self.assertIs(raised.exception, primary)
        self.assertEqual(primary.capture_record['state'], 'receipt-error')
        self.assertEqual(primary.capture_record['returncode'], 0)
        self.assertEqual(primary.capture_record['childCustody'], 'reaped')


if __name__ == '__main__':
    unittest.main()
