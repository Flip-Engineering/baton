"""A retained receive across commit notices and after a native exits without a terminal.

Every commit on the coordination database wakes each retained OMP receive. The
wake must forward nothing that was already forwarded, and the receive's memory
must not grow with the number of wakes or the size of the attempt's forwarding
journal. A native that exits without a terminal must settle its attempt, so the
keeper does not start recovery for it again (#1443).
"""
import json
import os
import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import receive

candidate = os.environ.get('BATON_CANDIDATE')
if candidate:
    receive.EXE = pathlib.Path(os.environ.get('BATON_TEST_WRAPPER', candidate))

# The attempt that reached 21 GB held this journal when it was measured: one line
# for each of 18,152 forwards of an eight-digit message sequence.
JOURNAL_LINES = 18152
NOTICES = 40
# The release this test replaces retained 3.5 MB per notice at this journal size.
# A notice builds query text and rows on the receive's heap, so the limit allows
# one page per notice and refuses growth with the journal.
GROWTH_PER_NOTICE = 4096


def rss_bytes(pid):
    status = pathlib.Path(f'/proc/{pid}/status').read_text()
    return int(next(line.split()[1] for line in status.splitlines()
                    if line.startswith('VmRSS:'))) * 1024


def bytes_read(pid):
    fields = dict(line.split(': ') for line in
                  pathlib.Path(f'/proc/{pid}/io').read_text().splitlines())
    return int(fields['rchar'])


class NoticeMemory(receive.Receive):
    def start_observer(self):
        self.player(harness='omp')
        self.player(name='other', harness='omp')
        self.prepare_input('assignment', 'parent', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.eventually(lambda: self.coord('player', 'parent')['native'] == started['native'],
                        'The retained startup frame was not observed.')
        return observer, control, pathlib.Path(self.execution('parent')[2])

    def unrelated_commit(self, observer, ident):
        """Commit a message to another session and wait for the receive to read after it."""
        before = bytes_read(observer.pid)
        self.coord('message', ident, 'root', 'other', 'guidance', 'Unrelated commit.', ok=False)
        self.eventually(lambda: bytes_read(observer.pid) != before,
                        f'The commit notice for {ident} did not wake the receive.')

    def test_commit_notices_forward_nothing_and_hold_memory_flat(self):
        observer, control, attempt = self.start_observer()
        self.message('guidance', 'parent', 'Guidance forwarded once.')
        steered = []
        while 'guidance' not in steered:
            self.action(control, read_steer=True)
            steered.append(json.loads(control.readline())['steer_received']['id'])
        self.assertEqual(steered.count('guidance'), 1)
        journal = attempt / 'guidance-forwarded'
        self.eventually(lambda: journal.is_file() and len(journal.read_text().splitlines()) == len(steered),
                        'The forwarded guidance was not journaled.')
        sequence = journal.read_text().splitlines()[-1]
        with journal.open('a') as output:
            output.write((sequence.zfill(8) + '\n') * JOURNAL_LINES)
        journal_bytes = journal.stat().st_size

        # The first wakes populate the heap's free lists. Growth counts from then on.
        for index in range(NOTICES):
            self.unrelated_commit(observer, f'warm-{index}')
        start = rss_bytes(observer.pid)
        for index in range(NOTICES):
            self.unrelated_commit(observer, f'unrelated-{index}')
        growth = rss_bytes(observer.pid) - start
        print(json.dumps({'test': self.id(), 'notices': NOTICES, 'journalBytes': journal_bytes,
                          'rssGrowthBytes': growth, 'rssBytes': start + growth}), flush=True)

        self.assertEqual(journal.stat().st_size, journal_bytes,
                         'A commit notice forwarded a message this attempt already forwarded.')
        self.assertLess(growth, NOTICES * GROWTH_PER_NOTICE,
                        'The receive retained memory across commit notices.')
        self.action(control, body='Finished.')
        self.finish(observer)

    def test_native_exit_without_a_terminal_settles_without_recovery(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        cause = 'Error: Provider unavailable for this fixture'
        config.update({'early_failure': cause})
        config_path.write_text(json.dumps(config))
        self.coord('message', 'task', 'root', 'parent', 'task', 'Input stays owed.')
        observer = self.spawn(*self.receive_args('parent'))
        stdout, stderr = observer.communicate(timeout=60)
        self.assertNotIn('malformed JSON', stdout + stderr)
        attempt = pathlib.Path(self.execution('parent')[2])
        self.assertEqual(self.execution('parent')[0], 'exited')
        self.assertIn(cause, (attempt / 'native.stderr').read_text())
        self.assertEqual([message['id'] for message in self.coord('inbox', 'parent')], ['task'])
        # The keeper's normal poll waits indefinitely for native-exit,
        # observer/control or spool readiness. Recovery runs from those events.
        # This helper waits for the owner process to exit after its attempt retires.
        self.shutdown_idle_database_owner('failed attempt processes did not exit naturally')
        errors = attempt / 'observer-error'
        self.assertFalse(errors.exists() and errors.read_text(),
                         'The keeper started recovery for a settled attempt.')


def load_tests(loader, tests, pattern):
    return unittest.TestSuite([
        NoticeMemory('test_commit_notices_forward_nothing_and_hold_memory_flat'),
        NoticeMemory('test_native_exit_without_a_terminal_settles_without_recovery'),
    ])


if __name__ == '__main__':
    unittest.main()
