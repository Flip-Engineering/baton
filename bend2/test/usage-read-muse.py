#!/usr/bin/env python3
"""Runs the production usage-read helper on its Muse route.

The helper resolves the muse-auth: reference to the device-login access token
in an auth.json file, sends its POST /muse-code/key request through the host
libcurl transport and parses the answer with the Muse reader. A preloaded shim
(usage-read-http-redirect.c) rewrites only the request URL from
https://api.meta.ai/ to a local HTTP server, which records each request and
answers with a fixture document. bend2/test/muse-usage.bend keeps the parser
cases; this test covers the reader route that check-native.sh otherwise never
runs.
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
SOURCE = "POST https://api.meta.ai/muse-code/key"
KEY = "fixture-muse-device-token"


class Fixture(http.server.BaseHTTPRequestHandler):
    answer = (200, "{}")
    requests = []

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        Fixture.requests.append({"method": self.command, "path": self.path,
                                 "authorization": self.headers.get("Authorization"),
                                 "api_version": self.headers.get("x-api-version"),
                                 "body": self.rfile.read(length).decode()})
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
    completed = subprocess.run([str(helper), "muse", reference], env=environment,
                               capture_output=True, text=True)
    assert completed.returncode == 0, (completed.returncode, completed.stderr)
    return json.loads(completed.stdout)


def check_request(request):
    assert request == {"method": "POST", "path": "/muse-code/key",
                       "authorization": "Bearer " + KEY, "api_version": "1.0.0",
                       "body": "{}"}, request


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
            store = directory / "profile-store"
            auth = store / "muse" / "auth.json"
            auth.parent.mkdir(parents=True)
            auth.write_text(json.dumps({"providers": {"meta": {"access_token": KEY}}}))
            auth.chmod(0o600)
            reference = "muse-auth:" + str(auth)
            record = directory / "requested-urls"
            options = directory / "setopt-calls"
            preload = str(shim) + (":" + os.environ["LD_PRELOAD"] if os.environ.get("LD_PRELOAD") else "")
            environment = dict(os.environ, LD_PRELOAD=preload,
                               BATON2_TEST_HTTP_FROM="https://api.meta.ai/",
                               BATON2_TEST_HTTP_TO=f"http://127.0.0.1:{server.server_address[1]}/",
                               BATON2_TEST_HTTP_RECORD=str(record),
                               BATON2_TEST_HTTP_OPTIONS=str(options))

            Fixture.answer = (200, json.dumps({
                "is_subs_active": True, "subs_tier_name": "Everyday Usage",
                "subs_usage": {
                    "window": {"used_percent": 35.5, "window_duration_mins": 300,
                               "resets_at": 1792820715},
                    "weekly": {"used_percent": 12, "window_duration_mins": 10080,
                               "resets_at": 1793382116}}}))
            document = read(environment, reference)
            assert len(Fixture.requests) == 1, Fixture.requests
            check_request(Fixture.requests[-1])
            assert record.read_text().splitlines() == ["https://api.meta.ai/muse-code/key"], record.read_text()
            assert (document["provider"], document["source"], document["state"]) == ("muse", SOURCE, "read"), document
            assert isinstance(document["observedAt"], int) and document["observedAt"] > 0, document
            assert document["windows"] == [
                {"window": "5-hour", "usedPercent": 35.5, "resetsAt": 1792820715000,
                 "exhausted": False},
                {"window": "7-day", "usedPercent": 12, "resetsAt": 1793382116000,
                 "exhausted": False}], document
            assert KEY not in json.dumps(document), document
            # The shim reads each option with the exact type credit-transport.c
            # passes and refuses any other option. A POST with a "{}" body sets
            # these options: URL, CUSTOMREQUEST, HTTPHEADER, FOLLOWLOCATION 0,
            # NOSIGNAL 1, ACCEPT_ENCODING, the br_http_write callback,
            # WRITEDATA, ERRORBUFFER, POSTFIELDS and POSTFIELDSIZE 2.
            calls = options.read_text().splitlines()
            assert calls == ["10002 char*", "10036 char*", "10023 curl_slist*", "52 long 0", "99 long 1",
                             "10102 char*", "20011 curl_write_callback", "10001 void*", "10010 char*",
                             "10015 char*", "60 long 2"], calls
            print("muse-reader-funded: ok", flush=True)

            Fixture.answer = (200, json.dumps({"is_subs_active": True,
                                               "subs_tier_name": "Everyday Usage"}))
            document = read(environment, reference)
            check_request(Fixture.requests[-1])
            assert document["state"] == "read", document
            assert document["windows"] == [], document
            print("muse-reader-idle: ok", flush=True)

            Fixture.answer = (200, json.dumps({"is_subs_active": False}))
            document = read(environment, reference)
            check_request(Fixture.requests[-1])
            assert document["state"] == "unreadable", document
            assert "not active" in document["reason"], document
            print("muse-reader-inactive: ok", flush=True)

            Fixture.answer = (401, json.dumps({"error": "unauthorized"}))
            document = read(environment, reference)
            assert document["state"] == "unreadable", document
            assert "muse answered HTTP 401" in document["reason"], document
            print("muse-reader-http-error: ok", flush=True)

            Fixture.answer = (200, "not json")
            document = read(environment, reference)
            assert document["state"] == "unreadable", document
            assert "not JSON" in document["reason"], document
            print("muse-reader-malformed: ok", flush=True)

            # Every request in the cases above set only options the shim reads
            # with their exact type.
            assert not [call for call in options.read_text().splitlines() if "unsupported" in call], options.read_text()
            asked = len(Fixture.requests)
            document = read(environment, "muse-auth:" + str(directory / "absent-auth.json"))
            assert document["state"] == "unreadable", document
            assert len(Fixture.requests) == asked, Fixture.requests
            print("muse-reader-missing-auth-file: ok", flush=True)

            tokenless = directory / "tokenless-auth.json"
            tokenless.write_text(json.dumps({"providers": {"meta": {}}}))
            document = read(environment, "muse-auth:" + str(tokenless))
            assert document["state"] == "unreadable", document
            assert "access_token" in document["reason"], document
            assert len(Fixture.requests) == asked, Fixture.requests
            print("muse-reader-missing-token: ok", flush=True)

            Fixture.answer = (200, json.dumps({
                "is_subs_active": True,
                "subs_usage": {
                    "window": {"used_percent": 3, "window_duration_mins": 300,
                               "resets_at": 1792820715}}}))
            configured = dict(environment, XDG_CONFIG_HOME=str(store))
            document = read(configured, "muse-auth:")
            check_request(Fixture.requests[-1])
            assert document["state"] == "read", document
            assert document["windows"] == [
                {"window": "5-hour", "usedPercent": 3, "resetsAt": 1792820715000,
                 "exhausted": False}], document
            print("muse-reader-config-store: ok", flush=True)
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
