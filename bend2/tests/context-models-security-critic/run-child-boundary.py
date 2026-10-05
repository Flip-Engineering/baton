#!/usr/bin/env python3
"""Independent host child-boundary discriminator for the semantic context review.

Every provider in the semantic feature runs through ProcessChild.spawn and the
shared prepared/start keeper, so the review must measure the host boundary
rather than assume it:

  * the child environment is exactly the constructed assignment set and never
    inherits the harness environment (a positive control proves the probe can
    see an inherited variable);
  * stderr is a private retained file with mode 0600 and never reaches the
    fixture's own stdout/stderr stream;
  * stdout bytes survive read_line: an embedded NUL, and a final line without a
    trailing newline, and a one-megabyte single line;
  * close_stdin reaches the child as EOF, and write delivers the payload;
  * a signal is observed as an actual child status, not as an acknowledgment;
  * private directories and files keep modes 0700/0600;
  * the raw byte reader is exact, which the retained spool path depends on.

Usage:
  BEND=/path/to/bend python3 bend2/tests/context-models-security-critic/run-child-boundary.py
Set BEND when Bend is not at .bend/bin/bend or node_modules/.bend/bin/bend.
"""

import json
import os
import shutil
import stat
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENTRY = os.path.join("bend2", "tests", "context-models-security-critic", "child-boundary.bend")
PROBE = os.path.join(HERE, "probe-child.py")
SCRATCH = os.path.join(ROOT, ".scratch", "context-models-security-critic")
PRIVATE = os.path.join(SCRATCH, "priv")
BINARY = os.path.join(SCRATCH, "child-boundary")
CANARY = "CONTEXT_CRITIC_CANARY"
CANARY_VALUE = "harness-value-must-not-reach-the-child"


def bend_executable():
    candidates = [
        os.environ.get("BEND"),
        os.path.join(ROOT, ".bend", "bin", "bend"),
        os.path.join(ROOT, "node_modules", ".bend", "bin", "bend"),
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    sys.exit("Bend is unavailable: set BEND to an installed Bend 2.0.25 executable.")


def build():
    os.makedirs(SCRATCH, exist_ok=True)
    environment = {**os.environ, "BEND": bend_executable(), "BEND_NO_TELEMETRY": "1"}
    subprocess.run(["sh", "bend2/scripts/build-native.sh", ENTRY, BINARY], cwd=ROOT, env=environment, check=True)


def run(args, extra_env=None):
    environment = {**os.environ, **(extra_env or {})}
    completed = subprocess.run([BINARY, *args], capture_output=True, env=environment, cwd=ROOT)
    return completed.returncode, completed.stdout, completed.stderr


def parse_framed(data):
    """Records are (tag, payload); the tag is text, the payload stays bytes."""
    records = []
    index = 0
    while index < len(data):
        newline = data.index(b"\n", index)
        header = data[index:newline].decode("utf-8")
        tag, _, length = header.partition(" ")
        size = int(length)
        payload = data[newline + 1:newline + 1 + size]
        if data[newline + 1 + size:newline + 2 + size] != b"\n":
            raise AssertionError(f"framing broken at byte {index}: {data[index:index + 80]!r}")
        records.append((tag, payload))
        index = newline + 2 + size
    return records


def lines_of(records):
    return [payload for tag, payload in records if tag == "L"]


def status_of(records):
    statuses = [payload for tag, payload in records if tag == "S"]
    return statuses[0] if statuses else None


def failure_of(records):
    failures = [payload for tag, payload in records if tag == "F"]
    return failures[0] if failures else None


def read_log(path):
    with open(path, "rb") as handle:
        return handle.read()


def log_json(path):
    return json.loads(read_log(path).decode("utf-8"))


def run_probe(mode_args, log_name, spawn_mode="spawn", extra_env=None, program=None):
    log = os.path.join(PRIVATE, log_name)
    if os.path.exists(log):
        os.unlink(log)
    argv = [spawn_mode, log, PRIVATE]
    if spawn_mode == "spawn-write":
        # spawn-write LOG CWD PAYLOAD CMD ARG...
        payload, *rest = mode_args
        argv += [payload, *rest]
    elif spawn_mode == "spawn-signal":
        sig, *rest = mode_args
        argv += [sig, *rest]
    else:
        argv += list(mode_args)
    code, stdout, stderr = run(argv, extra_env)
    return code, stdout, stderr, log


def probe_child(*args):
    return [sys.executable, PROBE, *args]


CHECKS = []


def check(name):
    def register(function):
        CHECKS.append((name, function))
        return function
    return register


@check("env-closure")
def env_closure():
    code, stdout, stderr, log = run_probe(
        ["/usr/bin/env", "-i", f"HOME={PRIVATE}", f"TMPDIR={PRIVATE}", "PATH=/usr/bin:/bin", "LC_ALL=C", "/usr/bin/env"],
        "env-closure.stderr",
        extra_env={CANARY: CANARY_VALUE},
    )
    records = parse_framed(stdout)
    environment = {}
    for payload in lines_of(records):
        key, _, value = payload.partition(b"=")
        environment[key.decode()] = value.decode()
    allowed = {"HOME", "TMPDIR", "PATH", "LC_ALL", "__CF_USER_TEXT_ENCODING"}
    unexpected = {key: value for key, value in environment.items() if key not in allowed}
    detail = {
        "constructed": {key: environment.get(key) for key in sorted(allowed)},
        "unexpected": unexpected,
        "canary_present": CANARY in environment,
        "status": status_of(records).decode() if status_of(records) else None,
    }
    assert CANARY not in environment, f"the child inherited {CANARY}: {detail}"
    assert not unexpected, f"the child saw variables the boundary did not construct: {detail}"
    assert environment.get("HOME") == PRIVATE and environment.get("TMPDIR") == PRIVATE, detail
    return detail


@check("env-inherits-control")
def env_inherits_control():
    code, stdout, stderr, log = run_probe(["/usr/bin/env"], "env-inherit.stderr", extra_env={CANARY: CANARY_VALUE})
    environment = {}
    for payload in lines_of(parse_framed(stdout)):
        key, _, value = payload.partition(b"=")
        environment[key.decode()] = value.decode()
    assert environment.get(CANARY) == CANARY_VALUE, "the positive control cannot see an inherited variable, so the closure check proves nothing"
    return {"canary_present": True, "variables": len(environment)}


@check("stderr-private")
def stderr_private():
    code, stdout, stderr, log = run_probe(probe_child("env"), "stderr-private.stderr", extra_env={CANARY: CANARY_VALUE})
    mode = stat.S_IMODE(os.stat(log).st_mode)
    observed = log_json(log)
    assert mode == 0o600, f"the retained stderr file has mode {oct(mode)}"
    assert "env" in observed, "the child did not write its observation to the log"
    assert b"C=" not in stdout and CANARY_VALUE.encode() not in stdout, "child stderr reached the fixture stdout stream"
    assert CANARY_VALUE.encode() not in stderr, "child stderr reached the fixture stderr stream"
    return {"mode": oct(mode), "log_bytes": len(read_log(log))}


@check("stdout-bytes")
def stdout_bytes():
    code, stdout, stderr, log = run_probe(probe_child("env"), "stdout-bytes.stderr")
    records = parse_framed(stdout)
    observed = lines_of(records)
    assert observed == [b"first", b"A\x00B", b"C"], f"read_line changed the child bytes: {observed!r}"
    assert status_of(records) == b"exit 7", f"status {status_of(records)!r}"
    assert code == 0, f"fixture exit {code}: {stderr.decode()}"
    return {"lines": [payload.decode("utf-8", "backslashreplace") for payload in observed], "status": "exit 7"}


@check("stdin-eof")
def stdin_eof():
    code, stdout, stderr, log = run_probe(probe_child("eof"), "stdin-eof.stderr", spawn_mode="spawn-close")
    observed = log_json(log)
    assert observed["stdin_len"] == 0, f"close_stdin did not present EOF: {observed}"
    assert status_of(parse_framed(stdout)) == b"exit 0"
    return {"stdin_len": 0}


@check("stdin-delivery")
def stdin_delivery():
    payload = b"hello\nworld"
    code, stdout, stderr, log = run_probe([payload.decode(), *probe_child("eof")], "stdin-delivery.stderr", spawn_mode="spawn-write")
    observed = log_json(log)
    assert observed["stdin_hex"] == payload.hex(), f"stdin bytes changed: {observed}"
    assert status_of(parse_framed(stdout)) == b"exit 0"
    return {"stdin_hex": observed["stdin_hex"]}


@check("signal-exit")
def signal_exit():
    code, stdout, stderr, log = run_probe(["15", *probe_child("sleep", "30")], "signal-exit.stderr", spawn_mode="spawn-signal")
    records = parse_framed(stdout)
    status = status_of(records).decode()
    assert status == "signal 15", f"the signal was not observed as an actual child status: {status!r}"
    return {"status": status, "lines": len(lines_of(records))}


@check("uncapped-stdout")
def uncapped_stdout():
    count = 1024 * 1024
    code, stdout, stderr, log = run_probe(probe_child("big", str(count)), "uncapped-stdout.stderr")
    records = parse_framed(stdout)
    payload = lines_of(records)[0]
    assert len(payload) == count + 1, f"read a {len(payload)}-byte line, expected {count + 1}"
    assert payload[:1] == b"x" and payload[-1:] == b"!", "the large payload was changed"
    assert status_of(records) == b"exit 3"
    return {"line_bytes": len(payload)}


@check("private-modes")
def private_modes():
    directory_mode = stat.S_IMODE(os.stat(PRIVATE).st_mode)
    assert directory_mode == 0o700, f"the private directory has mode {oct(directory_mode)}"
    code, stdout, stderr, log = run_probe(
        ["/usr/bin/env", "-i", f"HOME={PRIVATE}", f"TMPDIR={PRIVATE}", "PATH=/usr/bin:/bin", "LC_ALL=C", *probe_child("spill")],
        "private-modes.stderr",
    )
    observed = log_json(log)
    assert observed["tmpdir"] == PRIVATE, observed
    assert observed["home"] == PRIVATE, observed
    assert observed["mode"] == 0o600, f"the child's own temp file has mode {oct(observed['mode'])}"
    assert observed["uid"] == os.getuid(), observed
    return {"directory": oct(directory_mode), "spill_file": oct(observed["mode"]), "tmpdir": observed["tmpdir"]}


@check("raw-byte-read")
def raw_byte_read():
    code, stdout, stderr, log = run_probe(probe_child("spill"), "raw-byte-read.stderr")
    log_bytes = read_log(log)
    code, stdout, stderr = run(["read", log])
    records = parse_framed(stdout)
    read_back = [payload for tag, payload in records if tag == "R"][0]
    assert read_back == log_bytes, "Text.read did not reproduce the retained bytes exactly"
    return {"bytes": len(read_back)}


def main():
    if "--no-build" not in sys.argv:
        build()
    os.makedirs(PRIVATE, exist_ok=True)
    os.chmod(PRIVATE, 0o700)
    failures = 0
    for name, function in CHECKS:
        try:
            detail = function()
            print(json.dumps({"check": name, "passed": True, "detail": detail}, sort_keys=True))
        except Exception as error:  # noqa: BLE001 - the driver reports every failure and continues
            failures += 1
            print(json.dumps({"check": name, "passed": False, "detail": f"{type(error).__name__}: {error}"}, sort_keys=True))
    print(json.dumps({"suite": "context-models-security-critic/host-child-boundary", "checks": len(CHECKS), "failures": failures, "binary": BINARY, "evidence": SCRATCH}))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
