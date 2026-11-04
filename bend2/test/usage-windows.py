"""Usage holds from live reads (#1025): refusal evidence, the usage-windows answer and refresh."""
import importlib.util
import json
import pathlib
import sqlite3
import unittest
from contextlib import closing


ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'),
                                                  pathlib.Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


control = load('control')
receive = load('receive')


def read_document(percent, exhausted, resets=32472144000000, provider='kimi-code'):
    return json.dumps({'schema': 'baton2-usage-read-v1', 'provider': provider, 'source': 'fixture',
                       'observedAt': 1, 'state': 'read',
                       'windows': [{'window': '5-hour', 'usedPercent': percent,
                                    'resetsAt': resets, 'exhausted': exhausted}]})


class UsageWindowHandoff(receive.Receive):
    """Exhaustion through the real retained receive records refusal evidence at the
    shared handoff gate: the window the provider text names, and no reset time, even
    when the text states one. The evidence does not hold the seat."""

    def window_rows(self):
        with closing(sqlite3.connect(self.db)) as db:
            return db.execute("SELECT window, resets_at, reset_source, harness, account FROM usage_windows ORDER BY id").fetchall()

    def exhaust(self, cause):
        self.player('parent', harness='omp')
        self.message('input', 'parent')
        failed = self.spawn(*self.receive_args('parent'))
        control_, original = self.accept('parent')
        self.action(control_, fail_status=429, fail_message=cause)
        self.action(control_, exit_fixture=True)
        self.finish(failed, ok=False)

    def test_zai_reset_text_is_not_recorded_as_a_reset(self):
        self.exhaust('429 Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52')
        rows = self.window_rows()
        self.assertEqual(len(rows), 1)
        window, resets_at, source, harness, account = rows[0]
        self.assertEqual((window, source, harness, account), ('5-hour', 'provider-message', 'omp', ''))
        self.assertIsNone(resets_at)
        self.assertNotEqual(self.coord('usage-windows', 'parent')['hold'], 'held')

    def test_kimi_refusal_records_its_window(self):
        self.exhaust("403 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.")
        rows = self.window_rows()
        self.assertEqual(len(rows), 1)
        window, resets_at, source, harness, account = rows[0]
        self.assertEqual((window, source, harness, account), ('5-hour', 'provider-message', 'omp', ''))
        self.assertIsNone(resets_at)
        self.assertNotEqual(self.coord('usage-windows', 'parent')['hold'], 'held')


class UsageWindows(unittest.TestCase):
    setUp = control.Control.setUp
    call = control.Control.call
    root = control.Control.root

    def recruit(self, name='leaf', model='kimi-code/kimi-for-coding'):
        self.root()
        return self.call('recruit', name, 'root', 'omp', model, 'high',
                         self.repo, name + '-branch', self.checkouts / name, self.base)

    def windows(self, session='leaf'):
        return self.call('usage-windows', session)

    def read(self, document, state='read', reason=''):
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("INSERT INTO usage_reads(observed_at,provider,account,session,trigger,state,source,reason,document) "
                       "VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'kimi-code','','leaf','fixture',?,'fixture',?,?)",
                       (state, reason, document))

    def refusal(self):
        with closing(sqlite3.connect(self.db)) as db, db:
            db.execute("INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) "
                       "VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','','5-hour',NULL,'provider-message',NULL,'limit message','attempt-1')")

    def messages(self, pattern):
        with closing(sqlite3.connect(self.db)) as db:
            return db.execute("SELECT id, sender, recipient, kind FROM messages WHERE id GLOB ? ORDER BY id",
                              (pattern,)).fetchall()

    def test_refusal_evidence_alone_does_not_hold(self):
        self.recruit()
        self.refusal()
        answer = self.windows()
        self.assertEqual(answer['schema'], 'baton2-usage-windows-v2')
        self.assertEqual((answer['session'], answer['provider'], answer['account']), ('leaf', 'kimi-code', ''))
        self.assertEqual(answer['hold'], 'open')
        self.assertEqual(answer['reads'], [])
        self.assertEqual([(item['window'], item['source'], item['message']) for item in answer['refusals']],
                         [('5-hour', 'provider-message', 'attempt-1')])

    def test_exhausted_read_holds_and_open_read_releases(self):
        self.recruit()
        self.read(read_document(100, True))
        answer = self.windows()
        self.assertEqual(answer['hold'], 'held')
        self.assertEqual(answer['reads'][0]['windows'][0]['window'], '5-hour')
        self.assertEqual(answer['reads'][0]['state'], 'read')
        holds = self.messages('usage-read:*:hold:leaf')
        self.assertEqual([(sender, recipient, kind) for _, sender, recipient, kind in holds],
                         [('leaf', 'root', 'report')])
        self.assertEqual(self.windows()['hold'], 'held')
        self.assertEqual(len(self.messages('usage-read:*:hold:leaf')), 1)
        self.read(read_document(3, False))
        self.assertEqual(self.windows()['hold'], 'open')
        released = self.messages('usage-read:*:release:leaf')
        self.assertEqual([(sender, recipient) for _, sender, recipient, _ in released], [('leaf', 'root')])

    def test_full_used_percent_holds_without_the_provider_flag(self):
        self.recruit()
        self.read(read_document(100, False))
        self.assertEqual(self.windows()['hold'], 'held')

    def test_unreadable_read_keeps_the_hold(self):
        self.recruit()
        self.read(read_document(100, True))
        self.read(json.dumps({'schema': 'baton2-usage-read-v1', 'provider': 'kimi-code', 'source': 'fixture',
                              'observedAt': 1, 'state': 'unreadable', 'reason': 'HTTP 503'}),
                  state='unreadable', reason='HTTP 503')
        answer = self.windows()
        self.assertEqual(answer['hold'], 'held')
        self.assertEqual((answer['reads'][0]['state'], answer['reads'][0]['reason']), ('unreadable', 'HTTP 503'))

    def test_unreadable_read_alone_is_unknown(self):
        self.recruit()
        self.read(json.dumps({'state': 'unreadable', 'reason': 'HTTP 503'}), state='unreadable', reason='HTTP 503')
        self.assertEqual(self.windows()['hold'], 'unknown')

    def test_refresh_records_one_read(self):
        self.recruit()
        self.read(read_document(100, True))
        answer = self.call('usage-window-refresh', 'leaf')
        self.assertEqual(answer['schema'], 'baton2-usage-windows-v2')
        self.assertEqual(answer['reads'][0]['trigger'], 'usage-window-refresh')
        with closing(sqlite3.connect(self.db)) as db:
            rows = db.execute("SELECT provider, account, session, state FROM usage_reads "
                              "WHERE trigger='usage-window-refresh'").fetchall()
        self.assertEqual(len(rows), 1)
        # The fixture HOME holds no provider credential, so the read is unreadable
        # whether or not a usage-read helper is installed, and the hold stays.
        self.assertEqual(rows[0], ('kimi-code', '', 'leaf', 'unreadable'))
        self.assertEqual(answer['hold'], 'held')

    def test_unqualified_omp_model_names_no_provider(self):
        self.recruit('bare', 'gpt-6-astra')
        answer = self.windows('bare')
        self.assertEqual((answer['provider'], answer['hold']), ('', 'open'))
        refused = self.call('usage-window-refresh', 'bare', ok=False)
        self.assertIn('no provider with a usage API', refused['stderr'])


if __name__ == '__main__':
    unittest.main()
