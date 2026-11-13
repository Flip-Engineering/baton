"""Player and orchestra projections over hundreds of retained sessions (#1485)."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON_PLAYERS_TEST_BINARY', ROOT / '.scratch/bend2/baton2')).resolve()


class PlayersProjection(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / '.scratch/bend2'
        scratch.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='players-projection-', dir=scratch)
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.db = self.directory / 'state.db'
        self.environment = {key: value for key, value in os.environ.items()
                            if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON_ATTEMPT_DIRECTORY')}
        self.call('attach', 'operator', 'terminal', '', '')
        self.call('role', 'operator', 'operator')
        self.players = {f'seat-{n:04d}' for n in range(500)}
        events = ['Completed plain text.', '', json.dumps({'type': 'result', 'is_error': True}),
                  json.dumps({'type': 'agent_end', 'messages': [
                      {'role': 'assistant', 'stopReason': 'error'}]}),
                  json.dumps({'type': 'agent_end', 'messages': [
                      {'role': 'assistant', 'stopReason': 'stop'}]})]
        with sqlite3.connect(self.db) as database:
            for n, player in enumerate(sorted(self.players)):
                database.execute('INSERT INTO sessions(id,parent,harness,native,endpoint,workspace) VALUES(?,?,?,?,?,?)',
                                 (player, 'operator', 'omp' if n in (3, 4) else 'codex',
                                  'native-' + player, json.dumps(['/usr/bin/true']), str(self.directory / player)))
                event = events[n] if n < len(events) else json.dumps({'type': 'result', 'result': player})
                attempt = 'turn-' + player
                database.execute('INSERT INTO turns(id,worker,event) VALUES(?,?,?)', (attempt, player, event))
                database.execute('INSERT INTO executions(session,id,mode,directory,phase,status) VALUES(?,?,?,?,?,?)',
                                 (player, attempt, 'retained', str(self.directory / attempt), 'exited', 'exit 0'))
            database.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('pending','operator','seat-0000','guidance','Continue.')")

    def call(self, *arguments):
        result = subprocess.run([str(EXE), str(self.db), *arguments], env=self.environment,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def assert_players(self, rows):
        players = {row['id']: row for row in rows}
        self.assertEqual(set(players), self.players)
        for player, row in players.items():
            self.assertEqual(row['execution']['phase'], 'exited')
            self.assertEqual(row['workspace'], str(self.directory / player))
        self.assertIsNone(players['seat-0000']['lastTurnEvent'])
        self.assertIsNone(players['seat-0001']['lastTurnEvent'])
        self.assertEqual(players['seat-0002']['lastTurnEvent'], 'result')
        self.assertEqual(players['seat-0000']['pendingCount'], 1)
        self.assertEqual(players['seat-0000']['blockedCause'], '')
        self.assertEqual(players['seat-0001']['blockedCause'], '')
        self.assertEqual(players['seat-0002']['blockedCause'], 'provider-failure')
        self.assertEqual(players['seat-0003']['blockedCause'], 'provider-failure')
        self.assertEqual(players['seat-0004']['blockedCause'], '')

    def test_players_returns_retained_session_state(self):
        self.assert_players(self.call('as', 'operator', 'players'))

    def test_orchestra_returns_the_same_session_state(self):
        orchestra = self.call('orchestra')
        self.assert_players(orchestra['players'])
        self.assertEqual([row['id'] for row in orchestra['operators']], ['operator'])


if __name__ == '__main__':
    unittest.main()
