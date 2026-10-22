"""DSH public read records a complete read in an active attempt.

The controlled DSH stub runs as the session's native command through receive.
It reads the delivered prompt and executes the public `baton read` with the
launch's BATON_DATABASE/BATON_SESSION/BATON_ATTEMPT_DIRECTORY context. The
assertion is the stored message_reads row produced by that public read; the
fixture never inserts a read row itself.
"""
import json
import unittest

import receive


class DshPublicRead(unittest.TestCase):
    def setUp(self):
        self.fx = receive.Receive()
        self.addCleanup(self.fx.doCleanups)
        self.fx.setUp()
        self.fx.player('dsh-parent', harness='dsh')
        self.fx.prepare_input('dsh-input', 'dsh-parent',
                              'Read the complete DSH input.\n', kind='guidance')

    def test_public_read_in_active_dsh_attempt_records_complete_read(self):
        child = self.fx.spawn(*self.fx.receive_args('dsh-parent'))
        stdout, stderr = self.fx.finish(child)
        log = self.fx.directory / 'dsh-reads.jsonl'
        self.assertTrue(log.exists(), stdout + stderr)
        reads = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual([row['id'] for row in reads], ['dsh-input'], stdout + stderr)
        self.assertEqual(reads[0]['code'], 0, reads[0])
        rows = receive.message_reads(self.fx.db, 'dsh-input', 'dsh-parent')
        self.assertTrue(rows, 'the active DSH public read recorded no complete read')
        self.assertTrue(all(row['native'] and row['identity'] and row['handled'] is None
                            for row in rows), rows)
        self.assertIsNone(self.fx.coord('delivery', 'dsh-input')['receipt'])


if __name__ == '__main__':
    unittest.main()
