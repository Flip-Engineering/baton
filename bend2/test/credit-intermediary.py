"""Per-request credit intermediary against a deterministic fixture upstream.

The proxy transports; the Bend2 entry decides. These cases cover admission and
forwarding order, concurrency, balance/cap refusal, an unbounded account, a
provider failure that retains the reservation, replay, and reconciliation.
"""
import json
import os
import pathlib
import select
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from contextlib import closing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROXY = ROOT / 'bend2' / 'harness' / 'credit-intermediary.mjs'
NODE = os.environ.get('BATON2_NODE', 'node')


class Upstream(BaseHTTPRequestHandler):
    hits = []
    mode = 'cost'
    lock = threading.Lock()

    def log_message(self, *args):
        return

    def do_POST(self):
        length = int(self.headers.get('content-length', '0'))
        self.rfile.read(length)
        with Upstream.lock:
            Upstream.hits.append(self.path)
            mode = Upstream.mode
        if mode == 'close':
            self.connection.close()
            return
        if mode == 'slow':
            time.sleep(1.0)
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        body = {'usage': {'input_tokens': 10, 'output_tokens': 5}}
        if mode == 'cost':
            body['total_cost_usd'] = 0.05
        payload = json.dumps(body).encode()
        self.send_header('content-length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class CreditIntermediary(unittest.TestCase):
    def setUp(self):
        self.entry = os.environ.get('BATON2_CREDIT_INTERMEDIARY_ENTRY')
        self.account_entry = os.environ.get('BATON2_ACCOUNT_ENTRY')
        if not self.entry or not self.account_entry:
            self.skipTest('BATON2_CREDIT_INTERMEDIARY_ENTRY and BATON2_ACCOUNT_ENTRY are required')
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='credit-intermediary-'))
        self.db = self.directory / 'state.db'
        with closing(sqlite3.connect(self.db)):
            pass
        installed = subprocess.run([self.account_entry, str(self.db), 'account', 'read', '',
                                    '', '', '', '', '', '', ''], capture_output=True, text=True)
        self.assertEqual(installed.returncode, 0, installed.stderr)
        self.seed()
        Upstream.hits = []
        Upstream.mode = 'cost'
        self.upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        self.upstream_thread = threading.Thread(target=self.upstream.serve_forever, daemon=True)
        self.upstream_thread.start()
        environment = {
            'BATON_DATABASE': str(self.db),
            'BATON_CREDIT_ATTEMPT': 'attempt-1',
            'BATON_CREDIT_ACCOUNT': 'claude-api',
            'BATON_CREDIT_SESSION': 'leaf',
            'BATON_CREDIT_ENTRY': self.entry,
            'BATON_CREDIT_UPSTREAM': 'http://127.0.0.1:%d' % self.upstream.server_address[1],
            'BATON_CREDIT_LISTEN': '0',
            'PATH': os.environ.get('PATH', ''),
        }
        self.proxy = subprocess.Popen([NODE, str(PROXY)], stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, env=environment)
        ready, _, _ = select.select([self.proxy.stdout], [], [], 15)
        self.assertTrue(ready, 'proxy did not report its listener')
        line = self.proxy.stdout.readline().strip()
        self.assertTrue(line.startswith('LISTEN http://127.0.0.1:'), line)
        self.url = line.split(' ', 1)[1]

    def tearDown(self):
        if hasattr(self, 'proxy') and self.proxy.poll() is None:
            self.proxy.terminate()
            try:
                self.proxy.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proxy.kill()
        if hasattr(self, 'upstream'):
            self.upstream.shutdown()
            self.upstream.server_close()
        __import__('shutil').rmtree(self.directory, ignore_errors=True)

    def seed(self, balance='200.00'):
        self.execute("INSERT INTO sessions(id,parent,harness) VALUES('leaf','root','claude-code')")
        self.execute("INSERT INTO sessions(id,parent,harness) VALUES('root',NULL,'claude-code')")
        self.execute("INSERT INTO accounts(id,provider,harness,funding,secret_ref,organization,verified_at) "
                     "VALUES('claude-api','anthropic','claude-code','api_key','file:/fixture/api','org-fixture','')")
        self.execute("INSERT INTO credit_observations(id,organization,fact,state,balance,unit,expires,cycle,source,detail,observed_at,authority) "
                     "VALUES('obs-1','org-fixture','promotional_credit','reported',?,'USD','','2026-10',"
                     "'console-billing-display','',1760000000000,'operator')", (balance,))

    def execute(self, sql, parameters=()):
        with closing(sqlite3.connect(self.db)) as database:
            database.execute(sql, parameters)
            database.commit()

    def query(self, sql, parameters=()):
        with closing(sqlite3.connect(self.db)) as database:
            return database.execute(sql, parameters).fetchall()

    def request(self, request_id=None):
        import http.client
        target = http.client.HTTPConnection(self.url.split('//', 1)[1])
        headers = {'content-type': 'application/json', 'x-api-key': 'fixture-key'}
        if request_id:
            headers['x-baton-request-id'] = request_id
        target.request('POST', '/v1/messages', body=b'{"model":"claude-sonnet-5-5"}', headers=headers)
        response = target.getresponse()
        body = response.read()
        target.close()
        return response.status, body

    def test_admitted_request_is_forwarded_and_settled(self):
        status, body = self.request()
        self.assertEqual(status, 200, body)
        self.assertEqual(len(Upstream.hits), 1)
        self.assertEqual(self.query("SELECT state,settled,cost_source FROM credit_request_reservations"),
                         [('settled', '0.05', 'provider-response')])

    def test_refused_request_is_not_forwarded(self):
        self.execute("UPDATE credit_observations SET balance='0.00'")
        status, body = self.request()
        self.assertEqual(status, 402, body)
        self.assertIn(b'chargeBoundUnavailable', body)
        self.assertEqual(Upstream.hits, [])
        self.assertEqual(self.query("SELECT count(*) FROM credit_request_reservations"), [(0,)])

    def test_unbounded_account_refuses(self):
        self.execute("DELETE FROM credit_observations")
        status, body = self.request()
        self.assertEqual(status, 402, body)
        self.assertIn(b'chargeBoundUnavailable', body)
        self.assertEqual(Upstream.hits, [])

    def test_concurrent_requests_admit_exactly_one(self):
        Upstream.mode = 'slow'
        results = []
        holder = {}

        def first():
            holder['first'] = self.request()

        thread = threading.Thread(target=first)
        thread.start()
        time.sleep(0.3)
        results.append(self.request())
        thread.join()
        results.append(holder['first'])
        codes = sorted(status for status, _ in results)
        self.assertEqual(codes, [200, 402], results)
        self.assertEqual(len(Upstream.hits), 1)
        refused = [body for status, body in results if status == 402][0]
        self.assertIn(b'creditRequestInFlight', refused)

    def test_provider_failure_retains_the_reservation(self):
        Upstream.mode = 'close'
        status, body = self.request()
        self.assertEqual(status, 502, body)
        rows = self.query("SELECT state,settled,reason FROM credit_request_reservations")
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0][0], rows[0][1]), ('unreconciled', ''))
        self.assertIn('upstream', rows[0][2])

    def test_replay_is_not_forwarded_twice(self):
        status, _ = self.request('request-fixed')
        self.assertEqual(status, 200)
        replay, body = self.request('request-fixed')
        self.assertEqual(replay, 402, body)
        self.assertIn(b'creditRequestReplay', body)
        self.assertEqual(len(Upstream.hits), 1)

    def test_reconciliation_settles_an_unreconciled_request(self):
        Upstream.mode = 'usage'
        status, _ = self.request('request-fixed')
        self.assertEqual(status, 200)
        self.assertEqual(self.query("SELECT state,reason FROM credit_request_reservations"),
                         [('unreconciled', 'usageWithoutCost')])
        settled = subprocess.run([self.entry, str(self.db), 'settle', 'request-fixed', '0.02',
                                  'admin-cost-report', ''], capture_output=True, text=True)
        self.assertEqual(settled.returncode, 0, settled.stderr)
        self.assertEqual(settled.stdout.strip(), 'settled')
        self.assertEqual(self.query("SELECT state,settled,cost_source FROM credit_request_reservations"),
                         [('settled', '0.02', 'admin-cost-report')])


if __name__ == '__main__':
    unittest.main()
