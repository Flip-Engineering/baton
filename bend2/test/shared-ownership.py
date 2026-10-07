"""Shared native ownership regression pins for #676.

These tests hold on the current per-session native topology and on the
planned shared-instance topology: one admitted owner per native session,
separate native conversations and attempt state per session, prompt
isolation across concurrent sessions, a stop that reaches only its own
session, and no live keeper after acknowledge. Raw runtime topology is
reported as evidence for the before/after comparison; exact process
counts are not pinned.
"""
import glob
import importlib.util
import json
import os
import pathlib
import sqlite3
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

SPEC = importlib.util.spec_from_file_location('receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
receive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(receive)


class SharedOwnership(unittest.TestCase):
    setUp = receive.Receive.setUp
    close_children = receive.Receive.close_children
    owned_processes = receive.Receive.owned_processes
    eventually = receive.Receive.eventually
    coord = receive.Receive.coord
    spawn = receive.Receive.spawn
    player = receive.Receive.player
    receive_args = receive.Receive.receive_args
    connect = receive.Receive.connect
    message = receive.Receive.message
    accept_any = receive.Receive.accept_any
    accept = receive.Receive.accept
    action = receive.Receive.action
    finish = receive.Receive.finish
    assert_no_start = receive.Receive.assert_no_start

    def rows(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute(sql, parameters)]

    def attempt_dirs(self):
        return sorted(glob.glob(str(self.db) + '.attempt-*'))

    def keeper_pids(self):
        alive = []
        for directory in self.attempt_dirs():
            ident = pathlib.Path(directory, 'native.pid')
            if not ident.is_file():
                continue
            try:
                pid = int(ident.read_text().strip())
            except ValueError:
                continue
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                continue
            alive.append(pid)
        return alive

    def live_keepers(self):
        return [process for process in self.owned_processes()
                if '--host-process-keeper' in process['command']]

    def topology(self, label):
        """Record the resident native topology as review evidence.

        Evidence travels on stderr and a retained JSONL file. Stdout stays
        clean because the landing gate treats any non-identity stdout line
        as an unjudged run.
        """
        baton = [process for process in self.owned_processes()
                 if 'baton2' in process['command']]
        evidence = {
            'label': label,
            'attemptDirs': len(self.attempt_dirs()),
            'liveKeepers': len(self.live_keepers()),
            'keeperPids': self.keeper_pids(),
            'batonProcesses': len(baton),
            'executions': self.rows('SELECT session, mode, phase, status FROM executions ORDER BY session'),
        }
        with (self.directory / 'topology.jsonl').open('a') as output:
            output.write(json.dumps(evidence) + '\n')
        print('shared-ownership-topology ' + json.dumps(evidence), file=sys.stderr, flush=True)
        return evidence

    def native_identity(self, session):
        return self.eventually(lambda: self.coord('player', session)['native'] or None,
                               'native identity was not recorded for ' + session)

    def test_concurrent_sessions_keep_separate_keepers_and_prompts(self):
        for name in ('left', 'right'):
            self.player(name, harness='omp')
            self.message(name + '-input', name, 'Work assigned to ' + name + '.')
        left = self.spawn(*self.receive_args('left'))
        left_stream, left_started = self.accept('left')
        right = self.spawn(*self.receive_args('right'))
        right_stream, right_started = self.accept('right')
        self.assertNotEqual(left_started['native'], right_started['native'])
        self.assertIn('[id: left-input]', left_started['prompt'])
        self.assertNotIn('[id: right-input]', left_started['prompt'])
        self.assertIn('[id: right-input]', right_started['prompt'])
        self.assertNotIn('[id: left-input]', right_started['prompt'])
        self.assertEqual(self.native_identity('left'), left_started['native'])
        self.assertEqual(self.native_identity('right'), right_started['native'])
        self.assertEqual(len(self.attempt_dirs()), 2)
        keepers = self.keeper_pids()
        self.assertEqual(len(keepers), 2)
        self.assertEqual(len(set(keepers)), 2)
        self.topology('two-concurrent-sessions')
        self.action(left_stream, body='left work complete')
        self.action(right_stream, body='right work complete')
        self.finish(left)
        self.finish(right)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'left')], ['left work complete'])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'right')], ['right work complete'])
        self.assertEqual(self.coord('inbox', 'left'), [])
        self.assertEqual(self.coord('inbox', 'right'), [])

    def test_second_receive_for_active_session_starts_no_new_keeper(self):
        self.player(harness='omp')
        self.message('first', 'parent', 'Run the owned task.')
        first = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        queued = self.coord(*self.receive_args('parent'))
        self.assertEqual(queued['status'], 'queued')
        self.assert_no_start()
        self.assertEqual(len(self.attempt_dirs()), 1)
        self.assertEqual(len(self.rows("SELECT * FROM executions WHERE session='parent'")), 1)
        self.assertEqual(self.native_identity('parent'), started['native'])
        self.topology('duplicate-receive-rejected')
        self.action(stream, body='owned work complete')
        self.finish(first)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['owned work complete'])

    def test_stop_targets_only_the_stopped_session(self):
        for name in ('left', 'right'):
            self.player(name, harness='omp')
            self.message(name + '-input', name, 'Work assigned to ' + name + '.')
        left = self.spawn(*self.receive_args('left'))
        self.accept('left')
        right = self.spawn(*self.receive_args('right'))
        right_stream, _ = self.accept('right')
        stopped = self.coord('stop', 'left', 'stop-left', 'Left work is no longer needed.')
        self.assertEqual(stopped['session'], 'left')
        state = self.eventually(
            lambda: self.coord('player', 'left').get('stop', {})
            if self.coord('player', 'left').get('stop', {}).get('status') == 'stopped'
            and self.coord('player', 'left')['stop'].get('nativeStatus') else None,
            'left session did not reach stopped with a native status')
        self.assertEqual(state['nativeStatus'], 'signal 15')
        self.finish(left, ok=False)
        self.action(right_stream, body='right work complete')
        self.finish(right)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'right')],
                         ['right work complete'])
        reports = self.rows("SELECT body FROM messages WHERE recipient='root' AND kind='report'")
        self.assertTrue(any('session-stopped' in row['body'] and '"session":"left"' in row['body']
                            for row in reports),
                        'stop report for the left session did not reach its parent')
        self.topology('stop-isolated-to-one-session')

    def test_completed_sessions_leave_no_live_keeper(self):
        self.player(harness='omp')
        self.message('task', 'parent', 'Run the owned task.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, _ = self.accept('parent')
        self.action(stream, body='owned work complete')
        self.finish(observer)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        attempt = self.attempt_dirs()
        self.assertEqual(len(attempt), 1)
        self.assertTrue(pathlib.Path(attempt[0], 'acknowledged').is_file())
        self.eventually(lambda: not self.live_keepers(), 'a keeper remained live after acknowledge')
        self.topology('no-keeper-after-acknowledge')

    def test_runtime_topology_reported_as_sessions_increase(self):
        children = []
        streams = {}
        for index in range(3):
            name = 'session-%d' % index
            self.player(name, harness='omp')
            self.message(name + '-input', name, 'Work assigned to ' + name + '.')
            child = self.spawn(*self.receive_args(name))
            stream, _ = self.accept(name)
            children.append((name, child))
            streams[name] = stream
        evidence = self.topology('three-concurrent-sessions')
        self.assertEqual(evidence['attemptDirs'], 3)
        self.assertEqual(len(evidence['keeperPids']), 3)
        self.assertEqual(len(set(evidence['keeperPids'])), 3)
        natives = [self.native_identity(name) for name, _ in children]
        self.assertEqual(len(set(natives)), 3)
        for name, child in children:
            self.action(streams[name], body=name + ' complete')
        for _, child in children:
            self.finish(child)
        for name, _ in children:
            self.assertEqual(self.coord('inbox', name), [])
        self.topology('three-sessions-completed')


if __name__ == '__main__':
    unittest.main()
