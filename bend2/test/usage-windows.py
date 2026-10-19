"""Usage window observations: operator recording, explicit unknowns, and the query surface."""
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


class UsageWindowHandoff(receive.Receive):
    """Exhaustion through the real retained receive records a usage window observation
    at the shared handoff gate, on both the profile route and the account-wide route,
    with the reset time verbatim from the provider or explicit NULL when none is stated."""

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

    def test_zai_reset_time_is_recorded_verbatim(self):
        self.exhaust('429 Usage limit reached for 5 hour. Your limit will reset at 2026-10-06 07:12:52')
        rows = self.window_rows()
        self.assertEqual(len(rows), 1)
        window, resets_at, source, harness, account = rows[0]
        self.assertEqual((window, source, harness, account), ('5-hour', 'provider-message', 'omp', ''))
        self.assertEqual(resets_at, 1791270772000)

    def test_kimi_reset_stays_unknown(self):
        self.exhaust("403 You've reached your 5-hour usage limit. Your quota will reset when the current 5-hour window ends.")
        rows = self.window_rows()
        self.assertEqual(len(rows), 1)
        window, resets_at, source, harness, account = rows[0]
        self.assertEqual((window, source, harness, account), ('5-hour', 'provider-message', 'omp', ''))
        self.assertIsNone(resets_at)

    def test_future_reset_defers_the_same_attempt(self):
        self.exhaust('429 Usage limit reached for 5 hour. Your limit will reset at 2999-01-01 00:00:00')
        self.assert_no_start()
        rows = self.window_rows()
        self.assertEqual([(window, resets_at) for window, resets_at, _, _, _ in rows],
                         [('5-hour', 32472144000000)])
        with closing(sqlite3.connect(self.db)) as db:
            deferred = db.execute(
                "SELECT count(*) FROM messages WHERE id LIKE '%:quota-deferred:usage-window-held'"
            ).fetchone()[0]
            handoff = db.execute(
                "SELECT count(*) FROM messages WHERE id LIKE '%:profile-handoff-%'"
            ).fetchone()[0]
        self.assertEqual(deferred, 1)
        self.assertEqual(handoff, 0)


class UsageWindows(unittest.TestCase):
    setUp = control.Control.setUp
    call = control.Control.call
    root = control.Control.root

    def recruit(self):
        self.root()
        return self.call('recruit', 'leaf', 'root', 'omp', 'kimi-code/kimi-for-coding', 'high',
                         self.repo, 'leaf-branch', self.checkouts / 'leaf', self.base)

    def observe(self, window, resets, source, ok=True):
        return self.call('usage-window-observe', 'leaf', window, resets, source, ok=ok)

    def windows(self):
        return self.call('usage-windows', 'leaf')

    def limit(self, window='5-hour'):
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) "
                       "VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','',?,NULL,'provider-message',NULL,'limit message','')",
                       (window,))

    def reported(self, window='5-hour', used=0.42, ms=1893456000000):
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("INSERT INTO usage_windows(recorded_at,harness,model,provider,account,window,resets_at,reset_source,used_fraction,receipt,message) "
                       "VALUES(CAST(strftime('%s','now') AS INTEGER)*1000,'omp','kimi-code/kimi-for-coding','kimi-code','',?,?,'provider-report',?,'report','')",
                       (window, ms, used))

    def test_observed_reset_holds_and_latest_observation_wins(self):
        self.recruit()
        self.limit()
        held = self.observe('5-hour', '2999-01-01T00:00:00Z', 'kimi console web ui')
        self.assertEqual(held['resetsAt'], 32472144000000)
        answer = self.windows()
        rows = {row['window']: row for row in answer['windows']}
        self.assertEqual(rows['5-hour']['state'], 'held')
        self.assertEqual(rows['5-hour']['source'], 'operator-observation')
        self.assertEqual(rows['5-hour']['resetsAtText'], '2999-01-01T00:00:00Z')
        self.assertIn('kimi console web ui', rows['5-hour']['receipt'])
        elapsed = self.observe('5-hour', '2020-01-01T00:00:00Z', 'kimi console web ui')
        self.assertEqual(elapsed['resetsAt'], 1577836800000)
        rows = {row['window']: row for row in self.windows()['windows']}
        self.assertEqual(rows['5-hour']['state'], 'elapsed')

    def test_unknown_reset_stays_explicit(self):
        self.recruit()
        self.limit()
        observed = self.observe('5-hour', 'unknown', 'kimi console shows none')
        self.assertIsNone(observed['resetsAt'])
        rows = {row['window']: row for row in self.windows()['windows']}
        self.assertEqual(rows['5-hour']['state'], 'unknown')
        self.assertIsNone(rows['5-hour']['resetsAt'])

    def test_unknown_reset_prints_json_null_and_keeps_sql_null(self):
        self.recruit()
        self.limit()
        result = self.call('usage-window-observe', 'leaf', '5-hour', 'unknown',
                           'kimi console shows none', raw=True)
        self.assertEqual(result['code'], 0, result['stderr'])
        self.assertIn('"resetsAt":null', result['stdout'])
        answer = json.loads(result['stdout'])
        self.assertIsNone(answer['resetsAt'])
        with closing(sqlite3.connect(self.db)) as db:
            row = db.execute('SELECT resets_at FROM usage_windows ORDER BY id DESC LIMIT 1').fetchone()
        self.assertEqual(row, (None,))

    def test_partial_provider_report_is_open_and_not_held(self):
        self.recruit()
        self.reported()
        rows = {row['window']: row for row in self.windows()['windows']}
        self.assertEqual(rows['5-hour']['state'], 'open')
        self.assertEqual(rows['5-hour']['usedFraction'], 0.42)

    def test_multiwindow_gate_uses_the_exhausted_window(self):
        self.recruit()
        self.limit()
        self.reported('7-day', used=0.5, ms=1893456000000 + 3600000)
        self.reported('monthly', used=0.2, ms=1893456000000 + 7200000)
        rows = {row['window']: row for row in self.windows()['windows']}
        self.assertEqual(rows['5-hour']['state'], 'unknown')
        self.assertEqual(rows['7-day']['state'], 'open')
        self.assertEqual(rows['monthly']['state'], 'open')

    def test_unparseable_reset_refuses_without_recording(self):
        self.recruit()
        refused = self.observe('5-hour', 'next monday maybe', 'console', ok=False)
        self.assertIn('did not parse', refused['stderr'])
        answer = self.windows()
        self.assertEqual(answer['windows'], 'none recorded')

    def test_unqualified_model_reports_no_provider(self):
        self.root()
        self.call('recruit', 'bare', 'root', 'omp', 'gpt-6-astra', 'high',
                  self.repo, 'bare-branch', self.checkouts / 'bare', self.base)
        answer = self.call('usage-windows', 'bare')
        self.assertEqual(answer['windows'], 'none recorded')
        self.assertEqual(answer['condition'], 'noProviderQualifiedModel')

    def test_refused_observation_validates_window_and_source(self):
        self.recruit()
        refused = self.observe('', 'unknown', 'console', ok=False)
        self.assertIn('requires a nonempty window label', refused['stderr'])


if __name__ == '__main__':
    unittest.main()
