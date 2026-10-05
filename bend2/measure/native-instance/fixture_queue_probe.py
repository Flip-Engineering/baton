#!/usr/bin/env python3
"""Probe a second delivery against a session whose receive holds its guard.

Runs one real fixture turn with a slow task, then commits and dispatches a
second message to the same session while the first turn is still running. The
second delivery's receive must fail the guard and answer `queued`; the message
stays retained and the running owner continues it after the first turn.

Usage: fixture_queue_probe.py FIXTURE_DIR OMP_BIN MODEL EFFORT
"""
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fixture_run import RELEASE, roles  # noqa: E402

SLOW_TASK = "Use the bash tool to run exactly: seq 1 400000 . Then reply with the total number of lines you observed."
FOLLOWUP = "Reply with exactly the text queued-followup and nothing else."


def cli(database, *args):
    done = subprocess.run([RELEASE, database] + list(args), capture_output=True, text=True)
    return {"argv": list(args), "exit": done.returncode, "stdout": done.stdout, "stderr": done.stderr}


def main():
    fixture, omp_bin, model, effort = sys.argv[1:5]
    subprocess.run(["rm", "-rf", fixture], check=True)
    os.makedirs(fixture)
    workspace = os.path.join(fixture, "workspace")
    os.makedirs(workspace)
    database = os.path.join(fixture, "fixture.db")
    task_path = os.path.join(fixture, "task.txt")
    log = os.path.join(fixture, "fixture.log")
    with open(task_path, "w") as handle:
        handle.write(SLOW_TASK)

    started = time.time()
    first = subprocess.run([RELEASE, database, "start", "fixture-agent", "omp", omp_bin, model, effort,
                            workspace, log, "fixture-task-1", task_path], capture_output=True, text=True)
    timeline = []

    while time.time() - started < 120:
        current = roles(database, omp_bin)
        timeline.append({"t": round(time.time() - started, 3),
                         "roles": {k: [e["pid"] for e in v] for k, v in current.items()}})
        if "keeper" in current:
            break
        time.sleep(0.05)

    second = cli(database, "message", "fixture-task-2", "operator", "fixture-agent", "task", FOLLOWUP)
    second_at = round(time.time() - started, 3)

    follow = []
    while time.time() - started < 200:
        current = roles(database, omp_bin)
        follow.append({"t": round(time.time() - started, 3),
                       "roles": {k: [e["pid"] for e in v] for k, v in current.items()}})
        if not current:
            break
        time.sleep(0.05)
    finished = time.time()

    logs = {}
    for name in sorted(os.listdir(fixture)):
        if name.endswith(".stdout") or name.endswith(".stderr"):
            with open(os.path.join(fixture, name), "r", errors="replace") as handle:
                logs[name] = handle.read()[-4000:]

    result = {
        "start": {"exit": first.returncode, "stdout": first.stdout, "stderr": first.stderr},
        "second_message": second,
        "second_at_s": second_at,
        "first_chain_seen_s": timeline[:3],
        "timeline": follow,
        "chain_elapsed_s": round(finished - started, 3),
        "logs": logs,
        "inbox_operator": cli(database, "inbox", "operator"),
        "turns": cli(database, "turns", "fixture-agent"),
        "session": cli(database, "session", "fixture-agent"),
    }
    with open(os.path.join(fixture, "queue-probe.json"), "w") as handle:
        json.dump(result, handle, indent=1, sort_keys=True)
    print(json.dumps({"start_exit": first.returncode, "second_exit": second["exit"],
                      "second_stdout": second["stdout"].strip()[:300],
                      "second_at_s": second_at, "chain_elapsed_s": result["chain_elapsed_s"],
                      "log_names": sorted(logs),
                      "log_bodies": {k: v.strip()[:200] for k, v in logs.items()}}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
