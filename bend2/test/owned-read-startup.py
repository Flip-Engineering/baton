"""Owned read startup readiness records the first complete read (#1412).

Observed failure: an installed native process runs as soon as the keeper
releases its start gate, while the coordinator commits the running execution
(`Stop.started` after the retained result) and the native conversation identity
(observation of the session event) only afterwards. A `baton read` in that
window exited 2 with `The owned input action has no matching active execution,
native conversation and stop state. Read status remains unrecorded.` and stored
no read row, so the native lost its owned input. Evidence:
/tmp/root-installed-wake-observer-loss-proof-final-20261030.

The controlled DSH stub starts the public read before it prints its session
event, so the read's custody cannot be committed when the read first checks;
the read stays live for a full second before the event follows, which makes
the pre-commit state deterministic in both directions. After the fix the read
waits for its exact committed custody and records the complete read. The
second case keeps the settled-attempt refusal: the same launch context read
after the attempt exited still refuses with the same message and records
nothing.
"""
import json
import os
import sqlite3
import subprocess
import unittest

import receive


class OwnedReadStartup(unittest.TestCase):
    def setUp(self):
        self.fx = receive.Receive()
        self.addCleanup(self.fx.doCleanups)
        self.fx.setUp()
        config_path = self.fx.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['owned_read_startup'] = True
        config_path.write_text(json.dumps(config))
        self.fx.player('dsh-parent', harness='dsh')
        self.fx.prepare_input('owned-input', 'dsh-parent',
                              'Owned startup input body.\n', kind='guidance')

    def test_first_read_before_committed_custody_records_complete_read(self):
        child = self.fx.spawn(*self.fx.receive_args('dsh-parent'))
        stdout, stderr = self.fx.finish(child)
        log = self.fx.directory / 'owned-read-startup.jsonl'
        self.assertTrue(log.exists(), stdout + stderr)
        reads = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual([row['id'] for row in reads], ['owned-input'], stdout + stderr)
        self.assertEqual(reads[0]['code'], 0, reads[0])
        self.assertIn('Owned startup input body.', reads[0]['stdout'])
        rows = receive.message_reads(self.fx.db, 'owned-input', 'dsh-parent')
        self.assertTrue(rows, 'the early owned read recorded no complete read')
        self.assertTrue(all(row['native'] and row['identity'] and row['handled'] is None
                            for row in rows), rows)
        self.assertIsNone(self.fx.coord('delivery', 'owned-input')['receipt'])

    def test_read_after_the_attempt_settled_still_refuses(self):
        child = self.fx.spawn(*self.fx.receive_args('dsh-parent'))
        stdout, stderr = self.fx.finish(child)
        with sqlite3.connect(self.fx.db) as database:
            directory, = database.execute(
                "SELECT directory FROM executions WHERE session='dsh-parent'").fetchone()
        environment = dict(os.environ, BATON_DATABASE=str(self.fx.db),
                           BATON_SESSION='dsh-parent', BATON_ATTEMPT_DIRECTORY=directory)
        refused = subprocess.run([str(receive.EXE), str(self.fx.db), 'read', 'owned-input'],
                                 capture_output=True, text=True, env=environment)
        self.assertEqual(refused.returncode, 2, refused.stdout + refused.stderr)
        self.assertIn('The owned input action has no matching active execution, '
                      'native conversation and stop state.', refused.stderr)


if __name__ == '__main__':
    unittest.main()
