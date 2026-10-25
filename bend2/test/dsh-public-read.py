"""DSH public read records a complete read in an active attempt.

Observed deployed path: the DSH tool runs the focused binary
riff-dsh-custody-844-20261020-main-84f362325/bin/baton (sha256
0c5994d4980af8a1ab37c61edfed5dbb5ff0d09d37512db1ebe45884c4410d67,
source head 84f362325807b5eff160374278d55e43af2e3aad, tree
cf6df2a23482b8591db052202f5b00e03038ac8c); non-receive verbs fall back to
the full CLI postboot-recovery-985-overlay-20261020-main-a14387bc (source
e6a56295). Its read path returns the complete body, then Store.transact_sql
runs BEGIN IMMEDIATE followed by INSERT INTO message_reads ... through
DB.Sql.query. Sql.read opens SQLITE_OPEN_READONLY for decoration and witness
lookups only; the recording write opens read-write and SQLite falls back to a
read-only connection when the file is not writable. The INSERT then fails
with SQLITE_READONLY (8) "attempt to write a readonly database".

The controlled DSH stub runs as the session's native command through receive.
It reads the delivered prompt and executes the public `baton read` with the
launch's BATON_DATABASE/BATON_SESSION/BATON_ATTEMPT_DIRECTORY context. The
first case asserts the stored message_reads row from that public read. The
second case runs the same read against a read-only snapshot of the active
attempt state and preserves the observed failure: complete body returned,
then exit 8 and the exact SQLite message, with no read row stored. The
fixture never inserts a read row itself.
"""
import json
import os
import sqlite3
import tempfile
import unittest

import receive


class DshPublicRead(unittest.TestCase):
    def setUp(self):
        self.fx = receive.Receive()
        self.addCleanup(self.fx.doCleanups)
        self.fx.setUp()
        config_path = self.fx.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['dsh_public_read'] = True
        config_path.write_text(json.dumps(config))
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

    def test_public_read_records_input_delivered_after_admission(self):
        config_path = self.fx.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(dsh_late_read='dsh-late', dsh_read_prompt=False)
        config_path.write_text(json.dumps(config))
        child = self.fx.spawn(*self.fx.receive_args('dsh-parent'))
        ready = self.fx.directory / 'dsh-ready'
        self.fx.eventually(lambda: ready.exists(),
                           'the DSH native did not reach its public read point')
        self.fx.prepare_input('dsh-late', 'dsh-parent',
                              'Read the late DSH input.\n', kind='guidance')
        (self.fx.directory / 'dsh-release').write_text('go\n')
        stdout, stderr = self.fx.finish(child)
        log = self.fx.directory / 'dsh-reads.jsonl'
        self.assertTrue(log.exists(), stdout + stderr)
        reads = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual([row['id'] for row in reads], ['dsh-late'], stdout + stderr)
        self.assertEqual(reads[0]['code'], 0, reads[0])
        rows = receive.message_reads(self.fx.db, 'dsh-late', 'dsh-parent')
        self.assertTrue(rows, 'the public read of post-admission input recorded no complete read')
        self.assertTrue(all(row['native'] and row['identity'] and row['handled'] is None
                            for row in rows), rows)

    def test_public_read_preserves_readonly_recording_failure(self):
        snapshot = self.fx.directory / 'readonly-snapshot.db'
        config_path = self.fx.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['dsh_readonly_snapshot'] = str(snapshot)
        config_path.write_text(json.dumps(config))
        child = self.fx.spawn(*self.fx.receive_args('dsh-parent'))
        stdout, stderr = self.fx.child_communication(child)
        log = self.fx.directory / 'dsh-reads.jsonl'
        self.assertTrue(log.exists(), stdout + stderr)
        reads = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual([row['id'] for row in reads], ['dsh-input'], stdout + stderr)
        read = reads[0]
        self.assertEqual(read['code'], 8, read)
        self.assertIn('attempt to write a readonly database', read['stderr'])
        self.assertIn('Read the complete DSH input.', read['stdout'])
        with sqlite3.connect(f'{snapshot.as_uri()}?mode=ro', uri=True) as database:
            self.assertEqual(database.execute(
                'SELECT count(*) FROM message_reads WHERE message=?', ('dsh-input',)).fetchone()[0], 0)
            self.assertIsNone(database.execute(
                'SELECT receipt FROM messages WHERE id=?', ('dsh-input',)).fetchone()[0])


class ReadonlyRecordingWrite(unittest.TestCase):
    """The recording INSERT fails SQLITE_READONLY (8) on a read-only database."""

    def test_recording_insert_preserves_the_exact_readonly_error(self):
        with tempfile.TemporaryDirectory(prefix='readonly-read-') as directory:
            path = os.path.join(directory, 'state.db')
            database = sqlite3.connect(path)
            database.executescript(
                'CREATE TABLE messages(id TEXT PRIMARY KEY,recipient TEXT,receipt TEXT);'
                'CREATE TABLE message_reads(attempt TEXT,message TEXT,recipient TEXT,'
                'native TEXT,identity TEXT,handled TEXT,PRIMARY KEY(attempt,identity,message));'
                "INSERT INTO messages VALUES('dsh-input','dsh-parent',NULL);")
            database.commit()
            database.close()
            os.chmod(path, 0o444)
            database = sqlite3.connect(path)
            database.execute('BEGIN IMMEDIATE')
            with self.assertRaises(sqlite3.OperationalError) as raised:
                database.execute(
                    'INSERT INTO message_reads(attempt,message,recipient,native,identity) '
                    "VALUES('attempt','dsh-input','dsh-parent','native','identity')")
            self.assertEqual(raised.exception.sqlite_errorcode, 8)
            self.assertIn('attempt to write a readonly database', str(raised.exception))
            database.close()


if __name__ == '__main__':
    unittest.main()
