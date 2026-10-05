#!/usr/bin/env python3
"""Independent host child-boundary discriminator (host substrate component evidence).

Scope: this exercises the existing `ProcessChild.spawn` primitive directly and the
private-directory/file modes this host creates. It is component evidence for the
substrate the semantic providers build on; the managed prepared/start keeper
lifecycle and the provider composition are not exercised here and remain open.

Each invocation gets its own directory under `.scratch/context-models-security-critic/`:
the check's private directory, the retained stderr artifact, the fixture's complete
stdout/stderr, its argv and its exit status. A rebuild lands in a fresh build
directory, so a recorded invocation keeps the binary identity it actually ran.

Every check asserts: the fixture itself exited 0, the fixture emitted no failure
frame, exactly one child status frame, and that status equals the expected one.
Fabricated observations prove those assertions can fail (negative controls).

Checks:
  env-closure       constructed-only environment, no harness inheritance
  env-inherits-...  positive control that an inherited variable would be seen
  stderr-private    retained stderr file, mode 0600, not merged into a stream
  stdout-bytes      NUL inside a line and an unterminated final line
  stdin-eof         close_stdin presents EOF
  stdin-delivery    write delivers the exact bytes
  signal-exit       a signal is observed as the real child status
  uncapped-stdout   a single one-megabyte line is read whole
  private-modes     private directory 0700, child temp file 0600
  raw-byte-read     Text.read reproduces retained bytes exactly

Usage:
  BEND=/path/to/bend python3 bend2/tests/context-models-security-critic/run-child-boundary.py
  ... --binary /path/to/prebuilt/child-boundary   use an externally built fixture

The complete argument list is validated before any compiler effect. The
default route builds once into this run's own build directory; with --binary
the supplied executable is used and its digest recorded, but that flag does
not establish that those bytes were compiled from this ENTRY's source. Every
invocation keeps its own evidence directory, created exclusively so a repeat
cannot overwrite one; the spawn stage and, for checks that read an artifact
back, a read stage are both retained. Eleven invocations run subprocesses;
evidence-retention, duplicate-invocation and negative-controls are in-process
checks over the retained records.
"""

import hashlib
import json
import os
import stat
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENTRY = os.path.join("bend2", "tests", "context-models-security-critic", "child-boundary.bend")
PROBE = os.path.join(HERE, "probe-child.py")
SCRATCH = os.path.join(ROOT, ".scratch", "context-models-security-critic")
STAMP = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
RUN = os.path.join(SCRATCH, "invocations", f"{STAMP}-{os.getpid()}")
BUILD = os.path.join(SCRATCH, "build", f"{STAMP}-{os.getpid()}")
BINARY = os.path.join(BUILD, "child-boundary")
CANARY = "CONTEXT_CRITIC_CANARY"
CANARY_VALUE = "harness-value-must-not-reach-the-child"


def parse_arguments(argv):
    """Validate the complete argument list before any compiler effect."""
    binary = None
    index = 1
    while index < len(argv):
        argument = argv[index]
        if argument != "--binary":
            sys.exit(f"unknown argument {argument!r}; usage: run-child-boundary.py [--binary PATH]")
        if index + 1 >= len(argv):
            sys.exit("--binary requires the path of an existing prebuilt fixture")
        if binary is not None:
            sys.exit("--binary was given more than once")
        binary = argv[index + 1]
        if not os.path.exists(binary):
            sys.exit("--binary requires the path of an existing prebuilt fixture")
        index += 2
    return {"binary": os.path.abspath(binary) if binary is not None else None}


def digest_file(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


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
    """Build once into this run's own build directory; the default route."""
    os.makedirs(BUILD, exist_ok=True)
    environment = {**os.environ, "BEND": bend_executable(), "BEND_NO_TELEMETRY": "1"}
    with open(os.path.join(BUILD, "build.log"), "wb") as log:
        subprocess.run(["sh", "bend2/scripts/build-native.sh", ENTRY, BINARY], cwd=ROOT, env=environment, check=True, stdout=log, stderr=subprocess.STDOUT)


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


def statuses_of(records):
    return [payload for tag, payload in records if tag == "S"]


def failures_of(records):
    return [payload for tag, payload in records if tag == "F"]


def verify_observation(record, expected_status):
    """The single gate every check passes through. Raises on any deviation."""
    if record["status"] != 0:
        raise AssertionError(f"the fixture exited {record['status']}: {record['stderr'][:200]!r}")
    records = parse_framed(record["stdout"])
    failures = failures_of(records)
    if failures:
        raise AssertionError(f"the fixture reported a refusal frame: {failures!r}")
    statuses = statuses_of(records)
    if len(statuses) != 1:
        raise AssertionError(f"expected exactly one child status frame, got {statuses!r}")
    if statuses[0] != expected_status.encode("utf-8"):
        raise AssertionError(f"child status {statuses[0]!r} != expected {expected_status!r}")
    return records


def exclusive_directory(check, stage):
    """Create this invocation's own evidence directory, refusing to reuse one."""
    directory = os.path.join(RUN, "checks", check, stage)
    os.makedirs(os.path.dirname(directory), mode=0o700, exist_ok=True)
    try:
        os.makedirs(directory, mode=0o700)
    except FileExistsError:
        raise AssertionError(f"the invocation evidence directory already exists: {os.path.relpath(directory, RUN)}")
    marker = os.path.join(directory, ".invocation")
    handle = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.write(handle, f"{check}/{stage}\n".encode("utf-8"))
    os.close(handle)
    os.chmod(directory, 0o700)
    return directory


def invoke(args, check, stage="spawn", extra_env=None):
    """Run one fixture invocation, retaining complete evidence under its own directory."""
    directory = exclusive_directory(check, stage)
    environment = {**os.environ, **(extra_env or {})}
    started = time.time()
    completed = subprocess.run([BINARY, *args], capture_output=True, env=environment, cwd=ROOT)
    record = {
        "check": check,
        "stage": stage,
        "binaryProvenance": "supplied" if SUPPLIED_BINARY is not None else "built-this-run",
        "argv": [BINARY, *args],
        "cwd": ROOT,
        "binarySha256": digest_file(BINARY),
        "sourceSha256": digest_file(os.path.join(ROOT, ENTRY)),
        "environmentNames": sorted(environment),
        "status": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "seconds": round(time.time() - started, 3),
        "evidenceDirectory": directory,
    }
    INVOCATIONS.append(f"{check}/{stage}")
    with open(os.path.join(directory, "stdout.bin"), "wb") as handle:
        handle.write(completed.stdout)
    with open(os.path.join(directory, "stderr.bin"), "wb") as handle:
        handle.write(completed.stderr)
    with open(os.path.join(directory, "invocation.json"), "w", encoding="utf-8") as handle:
        json.dump({key: value for key, value in record.items() if key not in ("stdout", "stderr")}, handle, indent=2, sort_keys=True)
    return record


def probe_child(*args):
    return [sys.executable, PROBE, *args]


def stage_path(check, stage="spawn"):
    """The evidence directory this invocation will own. Creating it is invoke()'s job."""
    return os.path.join(RUN, "checks", check, stage)


def env_base(directory, program):
    """The constructed assignment set the providers must use, over env -i."""
    return ["/usr/bin/env", "-i", f"HOME={directory}", f"TMPDIR={directory}", "PATH=/usr/bin:/bin", "LC_ALL=C", *program]


def spawn_args(check, program, spawn_mode="spawn", payload=None, signal=None):
    """argv for one check: its own private directory and retained stderr file.

    This only computes the paths; invoke() creates the directory exclusively."""
    directory = stage_path(check, "spawn")
    log = os.path.join(directory, "native.stderr")
    if spawn_mode == "spawn-write":
        return [spawn_mode, log, directory, payload, *program], log, directory
    if spawn_mode == "spawn-signal":
        return [spawn_mode, log, directory, signal, *program], log, directory
    return [spawn_mode, log, directory, *program], log, directory


CHECKS = []
INVOCATIONS = []
SUPPLIED_BINARY = None


def check(name):
    def register(function):
        CHECKS.append((name, function))
        return function
    return register


@check("env-closure")
def env_closure():
    directory = stage_path("env-closure")
    args, log, _ = spawn_args("env-closure", env_base(directory, ["/usr/bin/env"]))
    record = invoke(args, "env-closure", extra_env={CANARY: CANARY_VALUE})
    require_clean(record)
    records = verify_observation(record, "exit 0")
    environment = {}
    for payload in lines_of(records):
        key, _, value = payload.partition(b"=")
        environment[key.decode()] = value.decode()
    allowed = {"HOME", "TMPDIR", "PATH", "LC_ALL", "__CF_USER_TEXT_ENCODING"}
    unexpected = {key: value for key, value in environment.items() if key not in allowed}
    if CANARY in environment:
        raise AssertionError(f"the child inherited {CANARY}")
    if unexpected:
        raise AssertionError(f"the child saw variables the boundary did not construct: {unexpected}")
    if environment.get("HOME") != directory or environment.get("TMPDIR") != directory:
        raise AssertionError(f"constructed HOME/TMPDIR were not presented: {environment}")
    return {"variables": sorted(environment), "unexpected": unexpected, "canary_present": False}


@check("env-inherits-control")
def env_inherits_control():
    args, log, directory = spawn_args("env-inherits-control", ["/usr/bin/env"])
    record = invoke(args, "env-inherits-control", extra_env={CANARY: CANARY_VALUE})
    records = verify_observation(record, "exit 0")
    environment = {}
    for payload in lines_of(records):
        key, _, value = payload.partition(b"=")
        environment[key.decode()] = value.decode()
    if environment.get(CANARY) != CANARY_VALUE:
        raise AssertionError("the positive control cannot see an inherited variable, so the closure check proves nothing")
    return {"variables": len(environment), "canary_present": True}


@check("stderr-private")
def stderr_private():
    args, log, directory = spawn_args("stderr-private", probe_child("env"))
    record = invoke(args, "stderr-private", extra_env={CANARY: CANARY_VALUE})
    verify_observation(record, "exit 7")
    mode = stat.S_IMODE(os.stat(log).st_mode)
    if mode != 0o600:
        raise AssertionError(f"the retained stderr file has mode {oct(mode)}")
    observed = json.loads(open(log, "rb").read().decode("utf-8"))
    if "env" not in observed:
        raise AssertionError("the child did not write its observation to the log")
    if b"C=" in record["stdout"] or CANARY_VALUE.encode() in record["stdout"]:
        raise AssertionError("child stderr reached the fixture stdout stream")
    if CANARY_VALUE.encode() in record["stderr"]:
        raise AssertionError("child stderr reached the fixture stderr stream")
    return {"mode": oct(mode), "log_bytes": os.path.getsize(log)}


@check("stdout-bytes")
def stdout_bytes():
    args, log, directory = spawn_args("stdout-bytes", probe_child("env"))
    record = invoke(args, "stdout-bytes")
    records = verify_observation(record, "exit 7")
    observed = lines_of(records)
    if observed != [b"first", b"A\x00B", b"C"]:
        raise AssertionError(f"read_line changed the child bytes: {observed!r}")
    return {"lines": [payload.decode("utf-8", "backslashreplace") for payload in observed]}


@check("stdin-eof")
def stdin_eof():
    args, log, directory = spawn_args("stdin-eof", probe_child("eof"), spawn_mode="spawn-close")
    record = invoke(args, "stdin-eof")
    verify_observation(record, "exit 0")
    observed = json.loads(open(log, "rb").read().decode("utf-8"))
    if observed["stdin_len"] != 0:
        raise AssertionError(f"close_stdin did not present EOF: {observed}")
    return {"stdin_len": 0}


@check("stdin-delivery")
def stdin_delivery():
    payload = "hello\nworld"
    args, log, directory = spawn_args("stdin-delivery", probe_child("eof"), spawn_mode="spawn-write", payload=payload)
    record = invoke(args, "stdin-delivery")
    verify_observation(record, "exit 0")
    observed = json.loads(open(log, "rb").read().decode("utf-8"))
    if observed["stdin_hex"] != payload.encode().hex():
        raise AssertionError(f"stdin bytes changed: {observed}")
    return {"stdin_hex": observed["stdin_hex"]}


@check("signal-exit")
def signal_exit():
    args, log, directory = spawn_args("signal-exit", probe_child("sleep", "30"), spawn_mode="spawn-signal", signal="15")
    record = invoke(args, "signal-exit")
    records = verify_observation(record, "signal 15")
    return {"status": "signal 15", "lines": len(lines_of(records))}


@check("uncapped-stdout")
def uncapped_stdout():
    count = 1024 * 1024
    args, log, directory = spawn_args("uncapped-stdout", probe_child("big", str(count)))
    record = invoke(args, "uncapped-stdout")
    records = verify_observation(record, "exit 3")
    payload = lines_of(records)[0]
    if len(payload) != count + 1:
        raise AssertionError(f"read a {len(payload)}-byte line, expected {count + 1}")
    if payload[:1] != b"x" or payload[-1:] != b"!":
        raise AssertionError("the large payload was changed")
    return {"line_bytes": len(payload)}


@check("private-modes")
def private_modes():
    directory = stage_path("private-modes")
    args, log, _ = spawn_args("private-modes", env_base(directory, probe_child("spill")))
    record = invoke(args, "private-modes")
    verify_observation(record, "exit 0")
    mode = stat.S_IMODE(os.stat(directory).st_mode)
    if mode != 0o700:
        raise AssertionError(f"the private directory has mode {oct(mode)}")
    observed = json.loads(open(log, "rb").read().decode("utf-8"))
    if observed["tmpdir"] != directory or observed["home"] != directory:
        raise AssertionError(f"the child did not receive the private HOME/TMPDIR: {observed}")
    if observed["mode"] != 0o600:
        raise AssertionError(f"the child's own temp file has mode {oct(observed['mode'])}")
    if observed["uid"] != os.getuid():
        raise AssertionError(f"the child's temp file has uid {observed['uid']}")
    return {"directory": oct(mode), "spill_file": oct(observed["mode"])}


@check("raw-byte-read")
def raw_byte_read():
    args, log, _ = spawn_args("raw-byte-read", probe_child("spill"))
    record = invoke(args, "raw-byte-read", "spawn")
    verify_observation(record, "exit 0")
    log_bytes = open(log, "rb").read()
    read_record = invoke(["read", log], "raw-byte-read", "read")
    records = verify_single_frame(read_record, "R")
    read_back = records[0][1]
    if read_back != log_bytes:
        raise AssertionError("Text.read did not reproduce the retained bytes exactly")
    return {"bytes": len(read_back)}


def require_clean(record):
    if record["status"] != 0:
        raise AssertionError(f"the fixture exited {record['status']}")


def verify_single_frame(record, tag):
    """For modes that report one payload frame and no child status frame."""
    if record["status"] != 0:
        raise AssertionError(f"the fixture exited {record['status']}: {record['stderr'][:200]!r}")
    records = parse_framed(record["stdout"])
    failures = failures_of(records)
    if failures:
        raise AssertionError(f"the fixture reported a refusal frame: {failures!r}")
    payloads = [payload for kind, payload in records if kind == tag]
    if len(payloads) != 1:
        raise AssertionError(f"expected exactly one {tag} frame, got {payloads!r}")
    return records


# Each case is well framed, so the rejection comes from the intended gate and
# not from a framing error. The expected fragment names that gate.
FABRICATED_CASES = [
    ("nonzero-fixture-exit", {"status": 9, "stdout": b"", "stderr": b""}, "exit 0", "the fixture exited"),
    ("refusal-frame", {"status": 0, "stdout": b"F 5\nusage\n", "stderr": b""}, "exit 0", "refusal frame"),
    ("missing-status-frame", {"status": 0, "stdout": b"L 1\nx\n", "stderr": b""}, "exit 0", "exactly one child status"),
    ("two-status-frames", {"status": 0, "stdout": b"S 6\nexit 7\nS 6\nexit 7\n", "stderr": b""}, "exit 7", "exactly one child status"),
    ("wrong-status", {"status": 0, "stdout": b"S 6\nexit 0\n", "stderr": b""}, "exit 7", "!= expected"),
]


def evidence_retention():
    """Every invocation keeps its own directory: no invocation overwrites another.

    The identity set is compared against the invocations this run recorded, so
    the check states a property rather than a count."""
    entries = []
    for root, _directories, files in os.walk(os.path.join(RUN, "checks")):
        if "invocation.json" in files:
            with open(os.path.join(root, "invocation.json"), encoding="utf-8") as handle:
                record = json.load(handle)
            stdout = os.path.join(root, "stdout.bin")
            entries.append({
                "check": record["check"],
                "stage": record["stage"],
                "status": record["status"],
                "stdoutBytes": os.path.getsize(stdout) if os.path.exists(stdout) else None,
                "directory": os.path.relpath(root, RUN),
            })
    for entry in entries:
        if entry["stdoutBytes"] is None:
            raise AssertionError(f"the invocation record has no stdout evidence: {entry}")
        if entry["stdoutBytes"] == 0:
            raise AssertionError(f"the invocation record kept an empty stdout artifact: {entry}")
    stages = {f"{entry['check']}/{entry['stage']}" for entry in entries}
    if len(stages) != len(entries):
        raise AssertionError(f"two invocations share one evidence directory: {entries}")
    expected = set(INVOCATIONS)
    if stages != expected:
        raise AssertionError(f"retained identities {sorted(stages)} differ from the recorded invocations {sorted(expected)}")
    for identity in ("raw-byte-read/spawn", "raw-byte-read/read"):
        if identity not in stages:
            raise AssertionError(f"{identity} was not retained")
    return {"invocations": sorted(stages)}


def duplicate_invocation_control():
    """A second invocation may not reuse an evidence directory, and the first stays intact."""
    args, log, _directory = spawn_args("duplicate-invocation", ["/usr/bin/env"])
    first = invoke(args, "duplicate-invocation", "spawn")
    record_path = os.path.join(first["evidenceDirectory"], "invocation.json")
    before = open(record_path, "rb").read()
    try:
        invoke(args, "duplicate-invocation", "spawn")
    except AssertionError as error:
        after = open(record_path, "rb").read()
        if after != before:
            raise AssertionError(f"the first invocation's record changed: {error}")
        return {"control": "duplicate-invocation", "rejected": True, "reason": str(error)}
    raise AssertionError("a second invocation reused the first invocation's evidence directory")


def negative_controls():
    """Fabricated observations must be rejected by the same gate the checks use."""
    rejected = []
    for name, record, expected, fragment in FABRICATED_CASES:
        try:
            verify_observation(record, expected)
        except AssertionError as error:
            if fragment not in str(error):
                raise AssertionError(f"negative control {name} was rejected for the wrong reason: {error}")
            rejected.append({"control": name, "rejected": True, "reason": str(error)})
        else:
            raise AssertionError(f"negative control {name} was accepted")
    return rejected


def main():
    global SUPPLIED_BINARY
    arguments = parse_arguments(sys.argv)
    SUPPLIED_BINARY = arguments["binary"]
    if SUPPLIED_BINARY is not None:
        globals()["BINARY"] = SUPPLIED_BINARY
    else:
        build()
    os.makedirs(RUN, exist_ok=True)
    failures = 0
    results = []
    for name, function in CHECKS:
        try:
            detail = function()
            results.append({"check": name, "passed": True, "detail": detail})
        except Exception as error:  # noqa: BLE001 - every check is reported and the run continues
            failures += 1
            results.append({"check": name, "passed": False, "detail": f"{type(error).__name__}: {error}"})
    for name, function in (
        ("duplicate-invocation", duplicate_invocation_control),
        ("negative-controls", negative_controls),
        ("evidence-retention", evidence_retention),
    ):
        try:
            results.append({"check": name, "passed": True, "detail": function()})
        except Exception as error:  # noqa: BLE001
            failures += 1
            results.append({"check": name, "passed": False, "detail": f"{type(error).__name__}: {error}"})
    for result in results:
        print(json.dumps(result, sort_keys=True))
    print(json.dumps({
        "suite": "context-models-security-critic/host-child-boundary",
        "checks": len(results),
        "failures": failures,
        "binary": BINARY,
        "binarySha256": digest_file(BINARY),
        "binaryProvenance": "supplied" if SUPPLIED_BINARY is not None else "built-this-run",
        "sourceSha256": digest_file(os.path.join(ROOT, ENTRY)),
        "correspondence": "a supplied binary's bytes are recorded but not shown to be built from sourceSha256; only a run that builds the fixture establishes that",
        "runDirectory": RUN,
    }, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
