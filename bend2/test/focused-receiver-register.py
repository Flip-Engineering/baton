"""Focused receiver executable re-registration without waking a session."""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import unittest

SPEC = importlib.util.spec_from_file_location(
    'focused_register_control', pathlib.Path(__file__).with_name('control.py'))
controls = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(controls)

CANDIDATE = pathlib.Path(os.environ['BATON2_FOCUSED_BINARY']).resolve()
controls.EXE = CANDIDATE


class FocusedReceiverRegister(unittest.TestCase):
    def setUp(self):
        controls.Control.setUp(self)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['exe'] = str(CANDIDATE.parent / 'baton-full')
        config_path.write_text(json.dumps(config))

    def close_fixtures(self):
        self.server.close()
        controls.shutdown_fixture_owner(self)

    call = controls.Control.call
    git = controls.Control.git
    root = controls.Control.root
    recruit = controls.Control.recruit
    process_rows = controls.Control.process_rows
    eventually = controls.Control.eventually
    rows = controls.Control.rows

    def test_rebind_records_candidate_and_preserves_session_without_waking(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        pending_id = 'register-pending-guidance'
        self.call('message', pending_id, 'root', 'registrant', 'guidance', 'Keep this input pending.')
        before = self.call('session', 'registrant')

        log = self.directory / 'registered.jsonl'
        refused = subprocess.run(
            [str(CANDIDATE), str(self.db), 'register-receiver', 'registrant', '',
             str(log)], env=self.environment, capture_output=True, text=True)
        self.assertEqual(refused.returncode, 2, refused.stdout + refused.stderr)
        self.assertEqual(self.call('session', 'registrant'), before)
        self.assertEqual([row['id'] for row in self.call('inbox', 'registrant')], [pending_id])

        registered = subprocess.run(
            [str(CANDIDATE), str(self.db), 'register-receiver', 'registrant',
             str(self.fixture.resolve()), str(log.resolve())],
            env=self.environment, capture_output=True, text=True)
        self.assertEqual(registered.returncode, 0, registered.stdout + registered.stderr)
        after = self.call('session', 'registrant')

        self.assertEqual(after['endpointArgv'], [
            str(CANDIDATE), str(self.db.resolve()), 'receive', 'registrant',
            str(self.fixture.resolve()), '', '', '', str(log.resolve())])
        for field in ('native', 'harness', 'model', 'effort', 'workspace', 'branch', 'base'):
            self.assertEqual(after[field], before[field], field)
        self.assertEqual(after['wake']['pending'], before['wake']['pending'])
        self.assertEqual([row['id'] for row in self.call('inbox', 'registrant')], [pending_id])
        self.assertEqual(self.controls, [])
        self.assertEqual(self.rows('SELECT * FROM executions'), [])
        self.assertFalse(log.exists())


if __name__ == '__main__':
    unittest.main()
