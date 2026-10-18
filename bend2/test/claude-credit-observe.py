#!/usr/bin/env python3
"""Local fixture for the native credit observation helper.

The fixture serves the three documented paths on loopback, uses a 0600 fixture
secret, and checks the reported, HTTP-error, invalid-JSON, secret-permission,
and unsupported-operation results. No live provider or credential is used.
"""
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading


class Fixture(http.server.BaseHTTPRequestHandler):
    seen = []

    def do_GET(self):
        self.seen.append({
            'path': self.path,
            'key': self.headers.get('x-api-key'),
            'version': self.headers.get('anthropic-version'),
        })
        if self.path.startswith('/bad'):
            body = b'{"error":"fixture"}'
            self.send_response(500)
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith('/invalid'):
            body = b'not json'
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)
            return
        body = json.dumps({'id': 'org-fixture', 'name': 'Fixture'}).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    helper = os.environ.get('BATON2_CREDIT_OBSERVE')
    if not helper:
        raise SystemExit('BATON2_CREDIT_OBSERVE must name the built native helper')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = 'http://127.0.0.1:' + str(server.server_port)
    try:
        with tempfile.TemporaryDirectory() as directory:
            secret = pathlib.Path(directory) / 'secret'
            secret.write_text('sk-observe-fixture\n')
            secret.chmod(0o600)

            def run(operation='organization', query='', base_url=base):
                return subprocess.run(
                    [helper, 'file:' + str(secret), operation, query, base_url],
                    capture_output=True, text=True, check=False)

            good = run()
            assert good.returncode == 0 and not good.stderr, (good.returncode, good.stderr)
            record = json.loads(good.stdout)
            assert record['schema'] == 'baton2-credit-observe-v1'
            assert record['state'] == 'reported'
            assert record['httpStatus'] == 200
            assert record['document']['id'] == 'org-fixture'
            assert record['source'] == 'anthropic-admin-api:/v1/organizations/me'
            assert isinstance(record['observedAt'], int)
            assert Fixture.seen[-1]['key'] == 'sk-observe-fixture'
            assert Fixture.seen[-1]['version'] == '2023-06-01'

            bad = run('organization', '', base + '/bad')
            assert bad.returncode == 0 and not bad.stderr, (bad.returncode, bad.stderr)
            record = json.loads(bad.stdout)
            assert record['state'] == 'unavailable'
            assert record['condition'] == 'httpError'
            assert record['httpStatus'] == 500

            invalid = run('organization', '', base + '/invalid')
            assert invalid.returncode == 0 and not invalid.stderr
            record = json.loads(invalid.stdout)
            assert record['state'] == 'unavailable'
            assert record['condition'] == 'unparseableResponse'

            secret.chmod(0o644)
            wide = run()
            assert wide.returncode == 0 and not wide.stderr
            record = json.loads(wide.stdout)
            assert record['state'] == 'unavailable'
            assert record['condition'] == 'secretFilePermissions'
            assert 'sk-observe-fixture' not in wide.stdout + wide.stderr
            secret.write_text('line\nbreak\n')
            secret.chmod(0o600)
            seen_before = len(Fixture.seen)
            line_break = run()
            assert line_break.returncode == 0 and not line_break.stderr
            record = json.loads(line_break.stdout)
            assert record['state'] == 'unavailable'
            assert record['condition'] == 'secretUnavailable'
            assert len(Fixture.seen) == seen_before
            secret.write_text('sk-observe-fixture\n')
            secret.chmod(0o600)

            unknown = subprocess.run(
                [helper, 'file:' + str(secret), 'balance', '', base],
                capture_output=True, text=True, check=False)
            assert unknown.returncode == 2
            assert 'unsupportedOperation' in unknown.stderr
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
