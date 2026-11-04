#!/usr/bin/env python3
"""Runs the production usage-read helper on its DeepSeek route.

The helper resolves the file: key, sends its GET /user/balance request through
the host libcurl transport and parses the answer with the DeepSeek reader. A
preloaded shim (usage-read-http-redirect.c) rewrites only the request URL from
https://api.deepseek.com/ to a local HTTP server, which records each request
and answers with a fixture document. bend2/test/deepseek-usage.bend keeps the
parser cases; this test covers the reader route that check-native.sh otherwise
never runs.
"""
import http.server
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[2]
helper = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / ".scratch/bend2/usage-read").resolve()
SOURCE = "GET https://api.deepseek.com/user/balance"
KEY = "fixture-deepseek-key"


class Fixture(http.server.BaseHTTPRequestHandler):
    answer = (200, "{}")
    requests = []

    def do_GET(self):
        Fixture.requests.append({"method": self.command, "path": self.path,
                                 "authorization": self.headers.get("Authorization")})
        status, body = Fixture.answer
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *arguments):
        pass


def read(environment, reference):
    # The helper's exit is the completion signal.
    completed = subprocess.run([str(helper), "deepseek", reference], env=environment,
                               capture_output=True, text=True)
    assert completed.returncode == 0, (completed.returncode, completed.stderr)
    return json.loads(completed.stdout)


def main():
    if not helper.is_file():
        raise SystemExit(f"usage-read helper not built at {helper}")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            shim = directory / "usage-read-http-redirect.so"
            subprocess.run([*shlex.split(os.environ.get("CC", "clang")), "-O1", "-shared", "-fPIC",
                            str(ROOT / "bend2/test/usage-read-http-redirect.c"), "-ldl", "-o", str(shim)],
                           check=True)
            secret = directory / "deepseek-key"
            secret.write_text(KEY + "\n")
            secret.chmod(0o600)
            record = directory / "requested-urls"
            options = directory / "setopt-calls"
            preload = str(shim) + (":" + os.environ["LD_PRELOAD"] if os.environ.get("LD_PRELOAD") else "")
            environment = dict(os.environ, LD_PRELOAD=preload,
                               BATON2_TEST_HTTP_FROM="https://api.deepseek.com/",
                               BATON2_TEST_HTTP_TO=f"http://127.0.0.1:{server.server_address[1]}/",
                               BATON2_TEST_HTTP_RECORD=str(record),
                               BATON2_TEST_HTTP_OPTIONS=str(options))
            reference = "file:" + str(secret)

            Fixture.answer = (200, json.dumps({"is_available": True, "balance_infos": [
                {"currency": "USD", "total_balance": "9.75", "granted_balance": "0.00", "topped_up_balance": "9.75"}]}))
            document = read(environment, reference)
            assert Fixture.requests == [{"method": "GET", "path": "/user/balance",
                                         "authorization": "Bearer " + KEY}], Fixture.requests
            assert record.read_text().splitlines() == ["https://api.deepseek.com/user/balance"], record.read_text()
            assert (document["provider"], document["source"], document["state"]) == ("deepseek", SOURCE, "read"), document
            assert isinstance(document["observedAt"], int) and document["observedAt"] > 0, document
            assert document["windows"] == [{"window": "balance", "usedPercent": None, "resetsAt": None,
                                            "exhausted": False}], document
            assert KEY not in json.dumps(document), document
            # The shim reads each option with the exact type credit-transport.c passes
            # and refuses any other option. A bodiless GET sets exactly these options:
            # URL, CUSTOMREQUEST, HTTPHEADER, FOLLOWLOCATION 0, NOSIGNAL 1,
            # ACCEPT_ENCODING, the br_http_write callback, WRITEDATA and ERRORBUFFER.
            calls = options.read_text().splitlines()
            assert calls == ["10002 char*", "10036 char*", "10023 curl_slist*", "52 long 0", "99 long 1",
                             "10102 char*", "20011 curl_write_callback", "10001 void*", "10010 char*"], calls
            print("deepseek-reader-funded: ok", flush=True)

            Fixture.answer = (200, json.dumps({"is_available": False, "balance_infos": [
                {"currency": "CNY", "total_balance": "0.00", "granted_balance": "0.00", "topped_up_balance": "0.00"}]}))
            document = read(environment, reference)
            assert document["state"] == "read", document
            assert document["windows"][0]["exhausted"] is True, document
            print("deepseek-reader-unavailable: ok", flush=True)

            Fixture.answer = (200, "not json")
            document = read(environment, reference)
            assert document["state"] == "unreadable", document
            assert "not JSON" in document["reason"], document
            print("deepseek-reader-malformed: ok", flush=True)

            Fixture.answer = (401, json.dumps({"error": {"message": "Authentication Fails"}}))
            document = read(environment, reference)
            assert document["state"] == "unreadable", document
            assert "deepseek answered HTTP 401" in document["reason"], document
            assert "Authentication Fails" in document["reason"], document
            print("deepseek-reader-http-error: ok", flush=True)

            # Every request in the cases above set only options the shim reads with
            # their exact type.
            assert not [call for call in options.read_text().splitlines() if "unsupported" in call], options.read_text()
            asked = len(Fixture.requests)
            document = read(environment, "file:" + str(directory / "absent-key"))
            assert document["state"] == "unreadable", document
            assert len(Fixture.requests) == asked, Fixture.requests
            print("deepseek-reader-missing-key: ok", flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
