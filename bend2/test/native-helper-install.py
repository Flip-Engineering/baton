#!/usr/bin/env python3
"""Install the two native helpers into a temporary prefix and exercise them.

This checks the installed path, owner-executable mode, api-key child environment,
and the credit observer request without compiling Main. The source helpers are
built by the caller; this fixture only copies and runs the installed binaries.
"""
import http.server
import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading


class Fixture(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({'id': 'org-install-fixture', 'name': 'Fixture'}).encode()
        self.send_response(200)
        self.send_header('content-type', 'application/json')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    key_exec = os.environ.get('BATON2_API_KEY_EXEC')
    observe = os.environ.get('BATON2_CREDIT_OBSERVE')
    usage_read = os.environ.get('BATON2_USAGE_READ')
    if not key_exec or not observe or not usage_read:
        raise SystemExit('BATON2_API_KEY_EXEC, BATON2_CREDIT_OBSERVE and BATON2_USAGE_READ must name the built helpers')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            prefix = root / 'prefix' / 'libexec' / 'baton2'
            prefix.mkdir(parents=True)
            installed_key = prefix / 'api-key-exec'
            installed_observe = prefix / 'claude-credit-observe'
            shutil.copyfile(key_exec, installed_key)
            installed_key.chmod(0o755)
            shutil.copyfile(observe, installed_observe)
            installed_observe.chmod(0o755)
            assert installed_key.stat().st_mode & 0o777 == 0o755
            assert installed_observe.stat().st_mode & 0o777 == 0o755

            secret = root / 'secret'
            secret.write_text('sk-install-fixture\n')
            secret.chmod(0o600)
            key = subprocess.run(
                [str(installed_key), 'file:' + str(secret), '/bin/sh', '-c',
                 'printf %s "$ANTHROPIC_API_KEY"'],
                capture_output=True, text=True, check=False)
            assert key.returncode == 0, (key.returncode, key.stderr)
            assert key.stdout == 'sk-install-fixture'
            assert 'sk-install-fixture' not in key.stderr

            base = 'http://127.0.0.1:' + str(server.server_port)
            observed = subprocess.run(
                [str(installed_observe), 'file:' + str(secret), 'organization', '', base],
                capture_output=True, text=True, check=False)
            assert observed.returncode == 0, (observed.returncode, observed.stderr)
            record = json.loads(observed.stdout)
            assert record['state'] == 'reported'
            assert record['document']['id'] == 'org-install-fixture'
            assert 'sk-install-fixture' not in observed.stdout + observed.stderr

            # The usage-read helper answers an explicit unreadable read for a provider
            # it has no reader for, and refuses a bad invocation.
            installed_usage = prefix / 'usage-read'
            shutil.copyfile(usage_read, installed_usage)
            installed_usage.chmod(0o755)
            unread = subprocess.run([str(installed_usage), 'fixture-provider', 'file:' + str(secret)],
                                    capture_output=True, text=True, check=False)
            assert unread.returncode == 0, (unread.returncode, unread.stderr)
            document = json.loads(unread.stdout)
            assert document['schema'] == 'baton2-usage-read-v1'
            assert (document['provider'], document['state']) == ('fixture-provider', 'unreadable')
            assert document['reason'] == 'no usage reader for provider fixture-provider is in this build'
            assert 'sk-install-fixture' not in unread.stdout + unread.stderr
            refused = subprocess.run([str(installed_usage)], capture_output=True, text=True, check=False)
            assert refused.returncode == 2, (refused.returncode, refused.stdout)

            spec = importlib.util.spec_from_file_location(
                'package_native', pathlib.Path('bend2/scripts/package-native.py'))
            package = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(package)
            payload = root / 'payload'
            package.stage_adapters(payload)
            installed = payload / 'libexec' / 'baton2'
            assert (installed / 'api-key-exec').is_file()
            assert (installed / 'claude-credit-observe').is_file()
            assert (installed / 'usage-read').is_file()
            assert not (installed / 'claude-credit-observe.mjs').exists()
            print('native-helper-install-ok')
    finally:
        server.shutdown()


if __name__ == '__main__':
    main()
