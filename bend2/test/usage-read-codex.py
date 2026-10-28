#!/usr/bin/env python3
"""Checks Codex usage results after app-server shutdown output, and a Codex read
whose wall-clock read fails."""
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
helper = Path(sys.argv[1]).resolve()


def kill_group(leader):
    try:
        os.killpg(leader, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_helper(environment, pid_file):
    # The helper's exit is the completion signal. A helper that stops draining the
    # app-server's shutdown output leaves both processes blocked in communicate().
    child = subprocess.Popen([str(helper), "codex", "codex-home:"],
                             env=dict(environment, FIXTURE_CODEX_PID=str(pid_file)),
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             start_new_session=True)
    try:
        out, err = child.communicate()
    finally:
        # An interrupted wait leaves the helper and its app-server in their own groups.
        if child.poll() is None:
            if pid_file.exists():
                kill_group(int(pid_file.read_text()))
            kill_group(child.pid)
            child.wait()
    assert child.returncode == 0, (child.returncode, err)
    return json.loads(out)


with tempfile.TemporaryDirectory(prefix="usage-read-codex-") as temporary:
    fake = Path(temporary) / "codex"
    fake.write_text("""#!/usr/bin/env python3
import json, os, sys
with open(os.environ['FIXTURE_CODEX_PID'], 'w') as pid_file:
    pid_file.write(str(os.getpid()))
with open(os.environ['FIXTURE_CODEX_CALLED'], 'w') as called:
    called.write('called')
request = json.loads(sys.stdin.readline())
print(json.dumps({'id': 1, 'result': {}}), flush=True)
sys.stdin.readline()
sys.stdin.readline()
if os.environ['FIXTURE_CODEX_REPLY'] == 'error':
    reply = {'id': 2, 'error': {'message': 'fixture read error'}}
elif os.environ['FIXTURE_CODEX_REPLY'] == 'exhausted':
    reply = {'id': 2, 'result': {'ordinaryUsageAllowed': False, 'rateLimits': {'primary': {'usedPercent': 100, 'windowDurationMins': 300, 'resetsAt': 1793382116}}}}
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
        called = Path(temporary) / f"{reply}.called"
        document = run_helper(dict(os.environ, BATON_CODEX_BIN=str(fake), FIXTURE_CODEX_REPLY=reply,
                                   FIXTURE_CODEX_CALLED=str(called)),
                              Path(temporary) / "codex.pid")
        assert called.exists(), f"provider command did not run for {reply}"
        assert document["state"] == ("read" if reply == "result" else "unreadable"), document
        if reply == "result":
            assert document["windows"][0]["usedPercent"] == 15, document
        else:
            assert "fixture read error" in document["reason"], document
        print(f"codex-shutdown-{reply}: ok", flush=True)

    # The reader's observedAt orders this read against the account's other reads. With
    # the wall clock unavailable the read is unreadable, carries no observation time,
    # and the coordinator records it at its own clock.
    shim = Path(temporary) / "usage-read-clock-failure.so"
    subprocess.run([*shlex.split(os.environ.get("CC", "clang")), "-O1", "-shared", "-fPIC",
                    str(ROOT / "bend2/test/usage-read-clock-failure.c"), "-ldl", "-o", str(shim)],
                   check=True)
    # The fake app-server runs without the preload, so only the helper's clock read fails.
    unpreloaded = Path(temporary) / "codex-unpreloaded"
    unpreloaded.write_text("#!/bin/sh\nunset LD_PRELOAD\nexec " + shlex.quote(str(fake)) + ' "$@"\n')
    unpreloaded.chmod(0o755)
    preload = str(shim) + (":" + os.environ["LD_PRELOAD"] if os.environ.get("LD_PRELOAD") else "")
    called = Path(temporary) / "clock-failure.called"
    document = run_helper(dict(os.environ, BATON_CODEX_BIN=str(unpreloaded),
                               FIXTURE_CODEX_REPLY="exhausted", FIXTURE_CODEX_CALLED=str(called), LD_PRELOAD=preload),
                          Path(temporary) / "codex.pid")
    assert document["state"] == "unreadable", document
    assert document["observedAt"] is None, document
    assert "wall clock" in document["reason"], document
    assert not called.exists(), "provider command ran after the helper clock failed"
    print("codex-clock-failure: ok", flush=True)
