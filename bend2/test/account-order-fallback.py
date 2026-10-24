"""Focused account-order fallback tests (#1059).

These drive the focused native account-credits-entry, which imports the same
accounts.bend and subscription-fallback.bend functions the coordinator uses.

The repro case reproduces the observed 2026-10-24 Riff state: the operator profile
list names claude-max-primary then claude-max-incognito, the seat's profile record
names claude-credit-primary, which that list does not contain, and the provider
refuses with "Credit balance is too low". The accounts table holds the operator's
order in recording order and, when the column exists, in accounts.priority. It runs
against account-credits-entry on main and account-order-entry on the branch.

The live-read cases need account-order-entry and the #1025 read interface. The fake
helper bend2/test/fake-account-usage-read answers each Claude subscription account's
read with the windows the case writes into that account's store.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENTRY = pathlib.Path(os.environ.get('BATON2_ACCOUNT_ENTRY', ROOT / '.scratch/bend2/account-credits-entry'))
# The terminal frame the Riff conductor recorded for attempt
# receive:riff-backlog-conductor-20261019:2181.
CREDIT_EVENT = json.dumps({'type': 'result', 'is_error': True, 'result': 'Credit balance is too low', 'errors': []})
LIMIT_EVENT = json.dumps({'type': 'result', 'is_error': True, 'result': "You've hit your session limit", 'api_error_status': 429})
HELPER = str(ROOT / 'bend2/test/fake-account-usage-read')
RESET_MS = (int(time.time()) + 3 * 86400) * 1000
EXHAUSTED = json.dumps([{'window': '7-day', 'usedPercent': 100, 'resetsAt': RESET_MS, 'exhausted': True}])
OPEN = json.dumps([{'window': '5-hour', 'usedPercent': 12, 'resetsAt': RESET_MS, 'exhausted': False},
                   {'window': '7-day', 'usedPercent': 40, 'resetsAt': RESET_MS, 'exhausted': False}])
ORDER = (
    ('claude-credit-primary', 'api_key', 'file:/fixture/keys/credit-primary'),
    ('claude-credit-incognito', 'api_key', 'file:/fixture/keys/credit-incognito'),
    ('claude-max-incognito', 'subscription', 'max-incognito'),
    ('claude-max-primary', 'subscription', 'max-primary'),
)


class AccountOrderFallback(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='account-order-'))
        self.addCleanup(lambda: __import__('shutil').rmtree(self.directory, ignore_errors=True))
        self.db = self.directory / 'test.db'
        sqlite3.connect(self.db).close()
        self.assertEqual(self.entry('account', 'read', '', '', '', '', '', '', '', '').returncode, 0)
        self.execute("INSERT INTO sessions(id,parent,harness,model) VALUES('root',NULL,'claude-code','claude-opus-5-5')")
        self.execute("INSERT INTO sessions(id,parent,harness,model) VALUES('leaf','root','claude-code','claude-opus-5-5')")
        self.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('task-1','root','leaf','task','original task')")

    def store(self, name):
        path = self.directory / 'stores' / name
        path.mkdir(parents=True, exist_ok=True)
        return str(path)

    def execute(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            database.execute(sql, parameters)
            database.commit()

    def query(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(sql, parameters).fetchall()

    def entry(self, *arguments):
        return subprocess.run([str(ENTRY), str(self.db), *arguments], capture_output=True, text=True)

    def record_order(self):
        for priority, (label, funding, secret) in enumerate(ORDER, start=1):
            reference = secret if funding == 'api_key' else self.store(secret)
            completed = self.entry('account', 'record', label, 'anthropic', 'claude-code', funding, reference, '', '', '')
            self.assertEqual(completed.returncode, 0, completed.stderr)
            columns = [row[1] for row in self.query('PRAGMA table_info(accounts)')]
            if 'priority' in columns:
                self.execute('UPDATE accounts SET priority=? WHERE id=?', (str(priority), label))

    def riff_profiles(self):
        listed = 'claude-code claude-max-primary {}\nclaude-code claude-max-incognito {}\n'.format(
            self.store('max-primary'), self.store('max-incognito'))
        pathlib.Path(str(self.db) + '.profiles').write_text(listed)
        record = pathlib.Path(str(self.db) + '.profile-' + 'leaf'.encode().hex())
        record.write_text(' claude-code claude-credit-primary {}\n'.format(self.store('credit-primary')))

    def current(self, session):
        completed = self.entry('current', session, 'claude-code')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def reports(self, suffix):
        return self.query("SELECT recipient,body FROM messages WHERE id LIKE ? ORDER BY seq", ('%' + suffix,))

    def test_exhausted_credit_account_moves_to_max_incognito(self):
        self.record_order()
        self.riff_profiles()
        completed = self.entry('handoff', 'leaf', 'turn-leaf', CREDIT_EVENT)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        exhausted = self.reports(':profile-exhausted') + self.reports(':account-exhausted')
        self.assertEqual((completed.stdout.strip(), exhausted), ('advanced', []),
                         'observed sequence: handoff={!r} reports={!r}'.format(completed.stdout.strip(), exhausted))
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        moves = self.query("SELECT recipient,body FROM messages WHERE kind='report' AND body LIKE 'account move:%'")
        self.assertIn('root', [recipient for recipient, body in moves])
        body = moves[0][1]
        for text in ('from claude-credit-primary to claude-max-incognito', 'Credit balance is too low',
                     'claude-credit-incognito not launchable: promotional-credit guard is false'):
            self.assertIn(text, body)

    def windows(self, store, document):
        (pathlib.Path(self.store(store)) / 'usage-windows.json').write_text(document)

    def bind(self, label, session='leaf'):
        completed = self.entry('account', 'bind', label, '', '', '', '', '', '', session)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def handoff_with(self, event):
        completed = self.entry('handoff-with', 'leaf', 'turn-leaf', event, HELPER)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def wake(self):
        completed = self.entry('wake', 'leaf', HELPER)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def test_max_incognito_exhausted_by_a_live_read_moves_to_max_primary(self):
        self.record_order()
        self.bind('claude-max-incognito')
        self.windows('max-incognito', EXHAUSTED)
        self.windows('max-primary', OPEN)
        self.assertEqual(self.handoff_with(LIMIT_EVENT), 'advanced')
        self.assertEqual(self.current('leaf'), 'claude-max-primary')
        reads = self.query("SELECT state FROM usage_reads WHERE account='claude-max-incognito' AND trigger='provider-refusal:turn-leaf'")
        self.assertEqual(reads, [('read',)])
        moves = self.query("SELECT recipient,body FROM messages WHERE kind='report' AND body LIKE 'account move:%'")
        self.assertIn('root', [recipient for recipient, body in moves])
        for text in ('from claude-max-incognito to claude-max-primary', 'entry 4 of 4',
                     '3 claude-max-incognito refused', '4 claude-max-primary open'):
            self.assertIn(text, moves[0][1])

    def all_held(self):
        self.record_order()
        self.bind('claude-max-incognito')
        self.windows('max-incognito', EXHAUSTED)
        self.windows('max-primary', EXHAUSTED)
        self.assertEqual(self.handoff_with(LIMIT_EVENT), 'exhausted')

    def test_all_accounts_exhausted_holds_with_an_announcement_and_no_stop(self):
        self.all_held()
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        holds = self.query("SELECT recipient,body FROM messages WHERE kind='report' AND body LIKE 'account order held:%'")
        self.assertIn('root', [recipient for recipient, body in holds])
        for text in ('2 claude-credit-incognito not launchable: promotional-credit guard is false',
                     '3 claude-max-incognito refused', '4 claude-max-primary held by live read'):
            self.assertIn(text, holds[0][1])
        self.assertEqual(self.reports(':route-unavailable') + self.reports(':profile-exhausted') + self.reports(':account-exhausted'), [])
        for account in ('claude-max-incognito', 'claude-max-primary'):
            announced = self.query("SELECT count(*) FROM messages h, usage_reads r WHERE h.id GLOB 'usage-read:'||r.id||':hold:leaf' AND r.account=?", (account,))
            self.assertGreater(announced[0][0], 0, account)
        self.assertEqual(self.wake(), 'gate=held moved=false current=claude-max-incognito')
        self.assertEqual(self.wake(), 'gate=held moved=false current=claude-max-incognito')
        repeated = self.query("SELECT count(*) FROM messages WHERE body LIKE 'account order held:%'")
        self.assertEqual(repeated[0][0], len(holds))
        owed = self.query("SELECT count(*) FROM messages WHERE id='task-1' AND recipient='leaf'")
        self.assertEqual(owed[0][0], 1)

    def test_a_release_by_live_read_resumes_the_held_seat(self):
        self.all_held()
        pathlib.Path(str(self.db) + '.helper').write_text(HELPER + '\n')
        self.windows('max-primary', OPEN)
        completed = self.entry('read', 'root', 'claude-max-primary', HELPER)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        mark = pathlib.Path(str(self.db) + '.wake-mark')
        for _ in range(200):
            if mark.exists() and mark.read_text().strip():
                break
            time.sleep(0.1)
        self.assertEqual(mark.read_text().strip(), 'task-1 gate=none moved=true current=claude-max-primary')
        released = self.query("SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:release:leaf'")
        self.assertGreater(released[0][0], 0)
        moves = self.query("SELECT body FROM messages WHERE kind='report' AND body LIKE 'account move:%'")
        self.assertIn('from claude-max-incognito to claude-max-primary', moves[0][0])


if __name__ == '__main__':
    unittest.main()
