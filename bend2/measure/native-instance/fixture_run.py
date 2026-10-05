#!/usr/bin/env python3
"""Run one real Baton2 session chain on an owned fixture database and time it.

The fixture uses the installed release binary, a fresh database in the fixture
directory, and the recorded OMP harness command. It records:

  * the appearance time of each process role in the chain,
  * the exit status and output of the start command,
  * the delivery logs and the attempt's native stderr,
  * the resulting session, inbox and turn rows.

Every value comes from the installed binary's own output or from ps(1).

Usage: fixture_run.py FIXTURE_DIR OMP_BIN MODEL EFFORT
"""
import glob
import json
import os
import subprocess
import sys
import time

import measure_identity

IDENTITY_MODE = measure_identity.mode()
RELEASE = measure_identity.executable("BATON2_RELEASE", "release", IDENTITY_MODE)
TASK = "Reply with exactly the text fixture-ok and nothing else. Do not use any tools."


def fresh_directory(path):
    """Create a new run directory; never reuse or clear an existing one."""
    if os.path.exists(path):
        raise SystemExit(
            "Refusing to reuse an existing directory: %s. Pass a new run directory so earlier "
            "fixture databases, attempt directories and interrupted evidence stay in place." % path)
    os.makedirs(path)
    return path


def ps_rows():
    out = subprocess.run(["ps", "-axo", "pid=,ppid=,command="], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3:
            rows.append((int(parts[0]), int(parts[1]), parts[2]))
    return rows


def roles(database, omp_bin):
    """Return {role: [pids]} for processes bound to this fixture database."""
    found = {}
    for pid, ppid, command in ps_rows():
        argv = command.split()
        if not argv:
            continue
        role = None
        if argv[0] == RELEASE:
            if len(argv) > 2 and argv[1] == "--dispatch-message" and argv[2] == database:
                role = "dispatch"
            elif len(argv) > 3 and argv[1] == database and argv[2] == "receive":
                role = "receive"
            elif len(argv) > 2 and argv[1] == "--host-process-keeper" and argv[2].startswith(database):
                role = "keeper"
            elif len(argv) > 1 and argv[1] == database:
                role = "cli"
        elif argv[0] == omp_bin and "--session-dir" in argv:
            index = argv.index("--session-dir")
            if index + 1 < len(argv) and argv[index + 1].startswith(database):
                role = "harness"
        elif "git-series.mjs" in argv[0] and database in command:
            role = "git-series"
        if role:
            found.setdefault(role, []).append({"pid": pid, "ppid": ppid})
    return found


def ps_detail(pids):
    if not pids:
        return {}
    args = ["ps", "-o", "pid=,rss=,%cpu=,time="]
    for pid in pids:
        args += ["-p", str(pid)]
    out = subprocess.run(args, capture_output=True, text=True).stdout
    detail = {}
    for line in out.splitlines():
        parts = line.split()
        if len(parts) == 4:
            detail[int(parts[0])] = {"rss_kb": int(parts[1]), "pctcpu": float(parts[2]),
                                     "cpu_s": parse_cpu_time(parts[3])}
    return detail


def parse_cpu_time(value):
    parts = value.strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except ValueError:
        return None
    return None


def main():
    fixture, omp_bin, model, effort = sys.argv[1:5]
    task_text = sys.argv[5] if len(sys.argv) > 5 else TASK
    label = sys.argv[6] if len(sys.argv) > 6 else "fixture-small"
    fresh_directory(fixture)
    workspace = os.path.join(fixture, "workspace")
    os.makedirs(workspace)
    database = os.path.join(fixture, "fixture.db")
    task_path = os.path.join(fixture, "task.txt")
    log = os.path.join(fixture, "fixture.log")
    with open(task_path, "w") as handle:
        handle.write(task_text)

    identity = {
        "label": label,
        "task": task_text,
        "identity_mode": IDENTITY_MODE or "caller-supplied",
        "release_bin": RELEASE,
        "release_sha256": subprocess.run(["shasum", "-a", "256", RELEASE], capture_output=True, text=True).stdout.split()[0],
        "boot": subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True).stdout.strip(),
        "omp_bin": omp_bin,
        "model": model,
        "effort": effort,
        "database": database,
    }

    started = time.time()
    process = subprocess.Popen(
        [RELEASE, database, "start", "fixture-agent", "omp", omp_bin, model, effort,
         workspace, log, "fixture-task-1", task_path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    start_stdout, start_stderr = process.communicate()
    start_exit = process.returncode
    start_done = time.time()

    first_seen = {}
    samples = []
    observed = False
    deadline = time.time() + 300
    never_started_deadline = time.time() + 30
    poll = 0
    while time.time() < deadline:
        current = roles(database, omp_bin)
        if current:
            observed = True
        if not observed and time.time() > never_started_deadline:
            break
        for role, entries in current.items():
            first_seen.setdefault(role, round(time.time() - started, 3))
        pids = [entry["pid"] for entries in current.values() for entry in entries]
        detail = ps_detail(pids)
        sample = {"t": round(time.time() - started, 3), "roles": {k: len(v) for k, v in current.items()},
                  "procs": [dict(pid=pid, role=role, **detail.get(pid, {}))
                            for role, entries in current.items() for entry in entries for pid in [entry["pid"]]]}
        if poll % 10 == 0 and pids:
            path = "/tmp/fixture-footprint.json"
            args = ["footprint", "-j", path]
            for pid in pids:
                args += ["-p", str(pid)]
            subprocess.run(args, capture_output=True, text=True)
            try:
                doc = json.load(open(path))
            except (OSError, json.JSONDecodeError):
                doc = {"processes": []}
            for proc in doc.get("processes", []):
                for entry in sample["procs"]:
                    if entry["pid"] == proc["pid"]:
                        entry["footprint"] = proc.get("footprint")
                        entry["footprint_peak"] = (proc.get("auxiliary") or {}).get("phys_footprint_peak")
        samples.append(sample)
        poll += 1
        if observed and "dispatch" not in current and "receive" not in current:
            break
        time.sleep(0.05)
    finished = time.time()

    def cli(*args):
        done = subprocess.run([RELEASE, database] + list(args), capture_output=True, text=True)
        return {"argv": list(args), "exit": done.returncode, "stdout": done.stdout, "stderr": done.stderr}

    logs = {}
    for suffix in (".stdout", ".stderr"):
        for name in sorted(os.listdir(fixture)):
            if name.endswith(suffix):
                try:
                    with open(os.path.join(fixture, name), "r", errors="replace") as handle:
                        logs[name] = handle.read()[-20000:]
                except OSError as error:
                    logs[name] = "<unreadable: %s>" % error
    try:
        with open(log, "r", errors="replace") as handle:
            logs["fixture.log"] = handle.read()[-20000:]
    except OSError as error:
        logs["fixture.log"] = "<unreadable: %s>" % error

    result = {
        "identity": identity,
        "start": {"argv": [RELEASE, database, "start", "fixture-agent", "omp", omp_bin, model, effort,
                           workspace, log, "fixture-task-1", task_path],
                  "exit": start_exit, "stdout": start_stdout, "stderr": start_stderr,
                  "elapsed_s": round(start_done - started, 3)},
        "first_seen_s": first_seen,
        "chain_elapsed_s": round(finished - started, 3),
        "samples": samples[:400],
        # The session read below is the session row as it stands now, not
        # per-attempt evidence. `attempts_in_database` lets a reader decide
        # whether that value is attributable to one attempt.
        "session_observation": {"kind": "current", "attempts_in_database":
                                len(glob.glob(database + ".attempt-*"))},
        "session": cli("session", "fixture-agent"),
        "inbox": cli("inbox", "operator"),
        "turns": cli("turns", "fixture-agent"),
        "players": cli("players"),
        "logs": logs,
    }
    out = os.path.join(fixture, "run.json")
    with open(out, "w") as handle:
        json.dump(result, handle, indent=1, sort_keys=True)
    print(json.dumps({"identity": identity, "start_exit": start_exit, "start_elapsed_s": result["start"]["elapsed_s"],
                      "first_seen_s": first_seen, "chain_elapsed_s": result["chain_elapsed_s"],
                      "start_stdout": start_stdout.strip()[:400]}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
