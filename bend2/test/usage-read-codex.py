#!/usr/bin/env python3
"""Checks Codex usage results after app-server shutdown output."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

helper = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix="usage-read-codex-") as temporary:
    fake = Path(temporary) / "codex"
    fake.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['FIXTURE_CODEX_PID'], 'w') as pid_file:
    pid_file.write(str(os.getpid()))
request = json.loads(sys.stdin.readline())
print(json.dumps({'id': 1, 'result': {}}), flush=True)
sys.stdin.readline()
sys.stdin.readline()
if os.environ['FIXTURE_CODEX_REPLY'] == 'error':
    reply = {'id': 2, 'error': {'message': 'fixture read error'}}
else:
    reply = {'id': 2, 'result': {'ordinaryUsageAllowed': True, 'rateLimits': {'primary': {'usedPercent': 15, 'windowDurationMins': 300, 'resetsAt': 1793382116}}}}
print(json.dumps(reply), flush=True)
sys.stdin.read()
for _ in range(4096):
    print(json.dumps({'method': 'fixture/shutdown', 'params': 'x' * 1024}))
sys.stdout.flush()
""")
    fake.chmod(0o755)
    for reply in ("result", "error"):
        pid_file = Path(temporary) / "codex.pid"
        environment = dict(os.environ, BATON_CODEX_BIN=str(fake), FIXTURE_CODEX_REPLY=reply,
                           FIXTURE_CODEX_PID=str(pid_file))
        child = subprocess.Popen([str(helper), "codex", "codex-home:"],
                                 env=environment, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, start_new_session=True)
        try:
            out, err = child.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            if pid_file.exists():
                try:
                    os.killpg(int(pid_file.read_text()), signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            out, err = child.communicate()
            raise AssertionError(f"{reply}: helper blocked during app-server shutdown; stdout={out!r}; stderr={err!r}")
        assert child.returncode == 0, (child.returncode, err)
        document = json.loads(out)
        assert document["state"] == ("read" if reply == "result" else "unreadable"), document
        if reply == "result":
            assert document["windows"][0]["usedPercent"] == 15, document
        else:
            assert "fixture read error" in document["reason"], document
        print(f"codex-shutdown-{reply}: ok", flush=True)
