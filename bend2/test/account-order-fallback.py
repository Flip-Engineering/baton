"""Focused account-order fallback tests (#1059, #1080).

The focused entry imports the coordinator's account and usage-window modules.
The deployment cases record the live API-key rows and the incognito subscription,
bind the seat by its old profile, and use the real Claude credential resolver and
response parser with a fixture HTTP response. Other cases use fake-account-usage-read
to select account states and exercise binding failures, announcements and releases.
"""
import concurrent.futures
import json
import os
import pathlib
import shlex
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(os.environ.get('BATON2_TEST_ROOT', pathlib.Path.cwd()))
ENTRY = pathlib.Path(os.environ.get('BATON2_ACCOUNT_ENTRY', ROOT / '.scratch/bend2/account-order-entry'))
# The terminal frame the Riff conductor recorded for attempt
# receive:riff-backlog-conductor-20261019:2181.
CREDIT_EVENT = json.dumps({'type': 'result', 'is_error': True, 'result': 'Credit balance is too low', 'errors': []})
# The cause the coordinator derives from CREDIT_EVENT.
CREDIT_CAUSE = 'provider-reported usage exhaustion: Credit balance is too low'
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
        self.executable = ENTRY
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='account-order-'))
        self.addCleanup(lambda: shutil.rmtree(self.directory, ignore_errors=True))
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
        return subprocess.run([str(self.executable), str(self.db), *arguments], capture_output=True, text=True)

    # A credit account is launchable until its provider refuses it. Cases about the
    # subscription accounts start with both credit accounts held by a recorded refusal.
    def record_order(self, credit_spent=True):
        for priority, (label, funding, secret) in enumerate(ORDER, start=1):
            reference = secret if funding == 'api_key' else self.store(secret)
            completed = self.entry('account', 'record', label, 'anthropic', 'claude-code', funding, reference, '', '', '')
            self.assertEqual(completed.returncode, 0, completed.stderr)
            columns = [row[1] for row in self.query('PRAGMA table_info(accounts)')]
            if 'priority' in columns:
                self.execute('UPDATE accounts SET priority=? WHERE id=?', (str(priority), label))
        if credit_spent:
            for label, funding, secret in ORDER:
                if funding == 'api_key':
                    self.credit_refused(label)

    def credit_refused(self, label):
        completed = self.entry('refusal-hold', 'leaf', label, 'spent-' + label, CREDIT_CAUSE)
        self.assertEqual((completed.returncode, completed.stdout.strip()), (0, 'recorded'), completed.stderr)

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

    # Credit API-key launches are admitted; the provider's credit refusal is recorded
    # as the refused account's usage hold with the provider text (#881, #1177).
    def test_a_credit_refusal_holds_the_credit_account_and_moves_to_the_next_entry(self):
        self.record_order(credit_spent=False)
        self.riff_profiles()
        completed = self.entry('handoff', 'leaf', 'turn-leaf', CREDIT_EVENT)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        exhausted = self.reports(':profile-exhausted') + self.reports(':account-exhausted')
        self.assertEqual((completed.stdout.strip(), exhausted), ('advanced', []),
                         'observed sequence: handoff={!r} reports={!r}'.format(completed.stdout.strip(), exhausted))
        self.assertEqual(self.current('leaf'), 'claude-credit-incognito')
        held = self.query("SELECT state,trigger,source FROM usage_reads WHERE account='claude-credit-primary' "
                          "AND source LIKE 'provider refusal%'")
        self.assertEqual([row[:2] for row in held], [('read', 'provider-refusal:turn-leaf')])
        self.assertIn('Credit balance is too low', held[0][2])
        moves = self.query("SELECT recipient,body FROM messages WHERE kind='report' AND body LIKE 'account move:%' ORDER BY seq")
        self.assertIn('root', [recipient for recipient, body in moves])
        for text in ('from claude-credit-primary to claude-credit-incognito', 'Credit balance is too low'):
            self.assertIn(text, moves[0][1])
        completed = self.entry('handoff', 'leaf', 'turn-leaf-2', CREDIT_EVENT)
        self.assertEqual((completed.returncode, completed.stdout.strip()), (0, 'advanced'), completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        later = [body for recipient, body in self.query(
            "SELECT recipient,body FROM messages WHERE kind='report' AND body LIKE 'account move:%' ORDER BY seq")
            if 'to claude-max-incognito' in body]
        self.assertIn('1 claude-credit-primary held by live read', later[0])
        self.assertIn('provider refusal of attempt turn-leaf: ' + CREDIT_CAUSE, later[0])

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

    def test_the_last_entry_is_not_taken_on_an_unreadable_read(self):
        self.record_order()
        self.bind('claude-max-incognito')
        self.windows('max-incognito', EXHAUSTED)
        self.assertEqual(self.handoff_with(LIMIT_EVENT), 'exhausted')
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        holds = self.query("SELECT body FROM messages WHERE kind='report' AND body LIKE 'account order held:%'")
        self.assertIn('4 claude-max-primary usage unreadable', holds[0][0])
        self.assertIn('claude-max-primary is taken only on an open live read', holds[0][0])

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
        for text in ('1 claude-credit-primary held by live read', '2 claude-credit-incognito held by live read',
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
        mark = pathlib.Path(str(self.db) + '.wake-mark')
        # The release receiver writes one completion frame to this FIFO.
        # Opening and reading it waits for that receiver's completed decision.
        os.mkfifo(mark)
        with concurrent.futures.ThreadPoolExecutor() as executor:
            completed_frame = executor.submit(mark.read_text)
            completed = self.entry('read', 'root', 'claude-max-primary', HELPER)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(completed_frame.result().strip(),
                             'task-1 gate=none moved=true current=claude-max-primary')
        released = self.query("SELECT count(*) FROM messages WHERE id GLOB 'usage-read:*:release:leaf'")
        self.assertGreater(released[0][0], 0)
        moves = self.query("SELECT body FROM messages WHERE kind='report' AND body LIKE 'account move:%'")
        self.assertIn('from claude-max-incognito to claude-max-primary', moves[0][0])

    def deployed_order(self, incognito_last=False):
        # These rows are shared by Riff, render-fframes and flip-brusharena.
        rows = (
            ('claude-credit-incognito', 'api_key', 'file:/fixture/keys/credit-incognito', '2'),
            ('claude-max-incognito', 'subscription', self.store('max-incognito'), '3'),
            ('claude-credit-normal', 'api_key', 'file:/fixture/keys/credit-normal', ''),
        )
        for label, funding, reference, priority in rows:
            completed = self.entry('account', 'record', label, 'anthropic', 'claude-code',
                                   funding, reference, '', '', '')
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.execute('UPDATE accounts SET priority=? WHERE id=?', (priority, label))
        if incognito_last:
            self.execute("UPDATE accounts SET priority='1' WHERE id='claude-credit-normal'")
        self.riff_profiles()
        self.credit_refused('claude-credit-incognito')
        helper = self.directory / 'claude-reader'
        helper.write_text('#!/bin/sh\nexec {} --fixture-usage-read "$@"\n'.format(shlex.quote(str(ENTRY))))
        helper.chmod(0o755)
        return str(helper)

    def claude_response(self, utilization, expired=False):
        store = pathlib.Path(self.store('max-incognito'))
        (store / '.credentials.json').write_text(json.dumps({'claudeAiOauth': {
            'accessToken': 'fixture-oauth', 'expiresAt': 1 if expired else RESET_MS}}))
        (store / '.credentials.json.response').write_text(json.dumps({
            'five_hour': {'utilization': utilization, 'resets_at': '2099-01-01T00:00:00Z'},
            'seven_day': {'utilization': utilization, 'resets_at': '2099-01-01T00:00:00Z'}}))

    def test_deployed_accounts_use_the_live_claude_reader(self):
        helper = self.deployed_order()
        self.claude_response(12)
        completed = self.entry('handoff-with', 'leaf', 'deployed-open', CREDIT_EVENT, helper)
        self.assertEqual((completed.returncode, completed.stdout.strip()), (0, 'advanced'), completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        self.assertEqual(self.query("SELECT state,source FROM usage_reads WHERE account='claude-max-incognito'"),
                         [('read', 'GET https://api.anthropic.com/api/oauth/usage')])
        self.assertFalse(self.query("SELECT id FROM accounts WHERE id='claude-max-primary'"))

    def test_deployed_held_incognito_retains_input(self):
        helper = self.deployed_order()
        self.claude_response(100)
        expected_account = [('claude-credit-primary', 'file:/fixture/keys/credit-normal')]
        self.assertEqual(self.query("SELECT secret_ref FROM accounts WHERE id='claude-credit-normal'"),
                         [('file:/fixture/keys/credit-normal',)])
        self.assertEqual(self.current('leaf'), 'claude-credit-primary')
        self.assertEqual(self.query("SELECT id,secret_ref FROM accounts WHERE id='claude-credit-primary'"),
                         expected_account)
        profiles = pathlib.Path(str(self.db) + '.profiles')
        profile = pathlib.Path(str(self.db) + '.profile-' + 'leaf'.encode().hex())
        before_profiles = (profiles.read_bytes(), profile.read_bytes())
        sidecar = pathlib.Path(str(self.db) + '.account-' + 'leaf'.encode().hex())
        self.assertFalse(sidecar.exists())
        completed = self.entry('handoff-with', 'leaf', 'deployed-held', CREDIT_EVENT, helper)
        self.assertEqual((completed.returncode, completed.stdout.strip()), (0, 'exhausted'), completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-credit-primary')
        self.assertEqual(self.query("SELECT id,secret_ref FROM accounts WHERE id='claude-credit-primary'"),
                         expected_account)
        self.assertEqual((profiles.read_bytes(), profile.read_bytes()), before_profiles)
        self.assertFalse(sidecar.exists())
        self.assertFalse(self.query("SELECT id FROM messages WHERE body LIKE 'account move:%'"))
        self.assertTrue(self.query("SELECT id FROM messages WHERE id='task-1'"))
        holds = self.query("SELECT body FROM messages WHERE body LIKE 'account order held:%'")
        self.assertTrue(holds)
        self.assertIn('claude-max-incognito held by live read', holds[0][0])

    def expired_deployment(self, incognito_last):
        helper = self.deployed_order(incognito_last=incognito_last)
        self.claude_response(12, expired=True)
        completed = self.entry('handoff-with', 'leaf', 'deployed-expired', CREDIT_EVENT, helper)
        self.assertEqual((completed.returncode, completed.stdout.strip()), (0, 'advanced'), completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        read = self.query("SELECT state,reason FROM usage_reads WHERE account='claude-max-incognito'")
        self.assertEqual(read[0][0], 'unreadable')
        self.assertIn('expired at', read[0][1])

    def test_expired_incognito_can_resume_at_the_end_of_the_order(self):
        self.expired_deployment(incognito_last=True)

    def test_expired_incognito_can_resume_before_unprioritized_credit(self):
        self.expired_deployment(incognito_last=False)

    def test_unknown_primary_is_reserved_before_incognito(self):
        self.record_order()
        self.riff_profiles()
        self.execute("UPDATE accounts SET priority='2' WHERE id='claude-max-primary'")
        self.assertEqual(self.handoff_with(CREDIT_EVENT), 'advanced')
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        moves = self.query("SELECT body FROM messages WHERE body LIKE 'account move:%'")
        self.assertIn('claude-max-primary is taken only on an open live read', moves[0][0])

    def launch_failure_setup(self):
        self.record_order()
        self.bind('claude-max-incognito')
        self.windows('max-incognito', EXHAUSTED)
        self.windows('max-primary', OPEN)
        completed = self.entry('read', 'leaf', 'claude-max-incognito', HELPER)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_failed_account_append_aborts_launch(self):
        self.launch_failure_setup()
        sidecar = pathlib.Path(str(self.db) + '.account-' + 'leaf'.encode().hex())
        sidecar.chmod(0o400)
        completed = self.entry('wake', 'leaf', HELPER)
        self.assertNotEqual(completed.returncode, 0, completed.stdout)
        self.assertIn('Account move failed', completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        self.assertTrue(self.reports(':account-append-failed'))
        self.assertTrue(self.query("SELECT id FROM messages WHERE id='task-1'"))

    def test_failed_history_preparation_aborts_launch(self):
        self.launch_failure_setup()
        runtime = self.directory / 'runtime'
        self.executable = runtime / 'bin' / 'account-order-entry'
        self.executable.parent.mkdir(parents=True)
        shutil.copy2(ENTRY, self.executable)
        helpers = runtime / 'libexec' / 'baton2'
        helpers.mkdir(parents=True)
        (helpers / 'git-series.mjs').symlink_to(ROOT / 'bend2/harness/git-series.mjs')
        completed = self.entry('wake-native', 'leaf', HELPER, 'missing-native-conversation')
        self.assertNotEqual(completed.returncode, 0, completed.stdout)
        self.assertIn('Account move failed', completed.stderr)
        self.assertTrue(self.reports(':account-history-failed'))
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        self.assertTrue(self.query("SELECT id FROM messages WHERE id='task-1'"))

    def test_unpersisted_binding_aborts_launch(self):
        self.launch_failure_setup()
        sidecar = pathlib.Path(str(self.db) + '.account-' + 'leaf'.encode().hex())
        sidecar.unlink()
        sidecar.symlink_to('/dev/null')
        record = pathlib.Path(str(self.db) + '.profile-' + 'leaf'.encode().hex())
        record.write_text(' claude-code claude-max-incognito {}\n'.format(self.store('max-incognito')))
        completed = self.entry('wake', 'leaf', HELPER)
        self.assertNotEqual(completed.returncode, 0, completed.stdout)
        self.assertIn('does not match selected account', completed.stderr)
        failures = self.reports(':account-binding-failed')
        self.assertIn('root', [recipient for recipient, body in failures])
        self.assertIn('does not match selected account claude-max-primary', failures[0][1])
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')

    def test_failed_root_announcement_keeps_binding_and_rolls_back_both_notices(self):
        self.record_order()
        self.riff_profiles()
        self.execute("INSERT INTO sessions(id,parent,harness,model) VALUES('middle','root','claude-code','claude-opus-5-5')")
        self.execute("UPDATE sessions SET parent='middle' WHERE id='leaf'")
        self.windows('max-incognito', OPEN)
        before = self.current('leaf')
        self.execute("""CREATE TRIGGER reject_root_move BEFORE INSERT ON messages
                        WHEN NEW.id LIKE '%:account-move:root'
                        BEGIN SELECT RAISE(ABORT,'fixture root announcement failed'); END""")
        completed = self.entry('handoff-with', 'leaf', 'sql-failure', CREDIT_EVENT, HELPER)
        self.assertNotEqual(completed.returncode, 0, completed.stdout)
        self.assertIn('fixture root announcement failed', completed.stderr)
        self.assertEqual(self.current('leaf'), before)
        self.assertFalse(self.query("SELECT id FROM messages WHERE body LIKE 'account move:%'"))
        self.execute('DROP TRIGGER reject_root_move')
        completed = self.entry('handoff-with', 'leaf', 'sql-failure', CREDIT_EVENT, HELPER)
        self.assertEqual((completed.returncode, completed.stdout.strip()), (0, 'advanced'), completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        self.assertEqual({row[0] for row in self.query("SELECT recipient FROM messages WHERE body LIKE 'account move:%'")},
                         {'middle', 'root'})

    def test_failed_hold_announcement_preserves_database_error(self):
        self.launch_failure_setup()
        self.windows('max-primary', EXHAUSTED)
        self.execute("""CREATE TRIGGER reject_hold BEFORE INSERT ON messages
                        WHEN NEW.body LIKE 'account order held:%'
                        BEGIN SELECT RAISE(ABORT,'fixture hold announcement failed'); END""")
        completed = self.entry('handoff-with', 'leaf', 'hold-sql-failure', LIMIT_EVENT, HELPER)
        self.assertNotEqual(completed.returncode, 0, completed.stdout)
        self.assertIn('fixture hold announcement failed', completed.stderr)
        self.assertEqual(self.current('leaf'), 'claude-max-incognito')
        self.assertTrue(self.query("SELECT id FROM messages WHERE id='task-1'"))


if __name__ == '__main__':
    unittest.main()
