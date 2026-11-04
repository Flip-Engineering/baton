"""Focused receiver registration: the harness probe and executable re-registration.

Registration of an OMP receiver runs the recorded harness command through the
rpc handshake before the endpoint transaction. A command that never answers with
a JSON ready frame is refused with its own stdout and stderr, and the session,
endpoint, workspace, native identity, pending input, executions and output log
stay as they were.
"""
import importlib.util
import json
import os
import pathlib
import subprocess
import sys
import time
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

    def harness(self, name, body):
        path = self.directory / name
        path.write_text('#!/bin/sh\n' + body)
        path.chmod(0o755)
        return path

    def register(self, session, command, log):
        argv = [str(CANDIDATE), str(self.db), 'register-receiver', session,
                str(command), str(log)]
        result = subprocess.run(argv, env=self.environment, capture_output=True,
                                text=True)
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps({'argv': argv, 'code': result.returncode,
                                     'stdout': result.stdout, 'stderr': result.stderr,
                                     'direct_wait_completed': True}) + '\n')
        return result

    def refusal(self, result):
        for line in (result.stdout + '\n' + result.stderr).splitlines():
            if line.startswith('{"error":"receiver-refused"'):
                return json.loads(line)
        self.fail(f'no typed refusal: stdout={result.stdout!r} stderr={result.stderr!r}')

    def tracked_names(self):
        return sorted(path.name for path in self.directory.iterdir()
                      if path.name != 'commands.jsonl')

    def assert_no_probe_leftovers(self, before):
        after = self.tracked_names()
        self.assertEqual(after, before, 'the registration wrote or left files')
        self.assertFalse([name for name in after if '.receiver-probe-' in name],
                         'probe scratch files survived the registration')

    def test_rebind_records_candidate_and_preserves_session_without_waking(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        pending_id = 'register-pending-guidance'
        self.call('message', pending_id, 'root', 'registrant', 'guidance', 'Keep this input pending.')
        before = self.call('session', 'registrant')
        before_names = self.tracked_names()

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
        self.assertEqual(self.tracked_names(), before_names,
                         'the registration wrote or left files')

    def test_baton_command_rejected_with_help_text(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        before = self.call('session', 'registrant')
        log = self.directory / 'probed.jsonl'

        result = self.register('registrant', CANDIDATE, log)
        refusal = self.refusal(result)

        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(refusal['error'], 'receiver-refused')
        self.assertEqual(refusal['session'], 'registrant')
        self.assertEqual(refusal['stdout'], '',
                         'the baton binary answered no protocol frame on stdout')
        self.assertIn('ready frame', refusal['condition'])
        self.assertTrue(refusal['stderr'].strip(),
                        'the command help text is retained in the refusal')
        self.assertEqual(self.call('session', 'registrant'), before)

    def test_alternate_path_wrapper_accepted_after_ready(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        log = self.directory / 'wrapped.jsonl'
        wrapper = self.harness(
            'omp-batonci-env', f'exec "{self.fixture.resolve()}" "$@"\n')

        before_names = self.tracked_names()
        result = self.register('registrant', wrapper, log)

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        appointment = self.call('session', 'registrant')
        self.assertEqual(appointment['endpointArgv'], [
            str(CANDIDATE), str(self.db.resolve()), 'receive', 'registrant',
            str(wrapper.resolve()), '', '', '', str(log.resolve())])
        self.assertEqual(self.rows('SELECT * FROM executions'), [])
        self.assertFalse(log.exists())
        self.assertEqual(self.tracked_names(), before_names,
                         'the registration wrote or left files')

    def test_refusal_leaves_no_executions_and_no_log(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        pending_id = 'probe-pending-guidance'
        self.call('message', pending_id, 'root', 'registrant', 'guidance', 'Keep this input pending.')
        registered = self.register('registrant', self.fixture,
                                   self.directory / 'recorded.jsonl')
        self.assertEqual(registered.returncode, 0, registered.stdout + registered.stderr)
        before = self.call('session', 'registrant')
        before_names = self.tracked_names()
        log = self.directory / 'refused.jsonl'

        result = self.register('registrant', CANDIDATE, log)

        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(self.call('session', 'registrant'), before)
        self.assertEqual([row['id'] for row in self.call('inbox', 'registrant')], [pending_id])
        self.assertEqual(self.rows('SELECT * FROM executions'), [])
        self.assertFalse(log.exists())
        self.assertEqual(self.controls, [])
        self.assertEqual(self.process_rows(), [])

    def test_harness_that_prints_a_non_protocol_line_is_refused_with_stdout(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        before = self.call('session', 'registrant')
        log = self.directory / 'garbled.jsonl'
        harness = self.harness('garbled harness', 'echo "not a protocol frame"\nsleep 60\n')

        result = self.register('registrant', harness, log)
        refusal = self.refusal(result)

        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('not a protocol frame', refusal['stdout'])
        self.assertIn('not a JSON object', refusal['condition'])
        self.assertEqual(self.call('session', 'registrant'), before)
        self.assertEqual(self.rows('SELECT * FROM executions'), [])
        self.assertFalse(log.exists())
        self.assertEqual(self.process_rows(), [])

    def test_harness_that_exits_before_ready_is_refused(self):
        self.root()
        self.recruit('registrant', harness='omp', parent='root')
        before = self.call('session', 'registrant')
        log = self.directory / 'exited.jsonl'
        harness = self.harness('exiting harness', 'exit 0\n')

        result = self.register('registrant', harness, log)
        refusal = self.refusal(result)

        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn('exited without printing a ready frame', refusal['condition'])
        self.assertEqual(refusal['stdout'], '')
        self.assertEqual(self.call('session', 'registrant'), before)
        self.assertEqual(self.rows('SELECT * FROM executions'), [])


if __name__ == '__main__':
    unittest.main()
