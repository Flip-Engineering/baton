#!/usr/bin/env python3
"""Resource-critic fixture: controlled idle/active measurement of the Baton2
observer/keeper/harness process family on an owned fixture database.

This fixture never touches the live Orchestra database and never signals a
process it did not start. It measures the same workload shape at several
session counts so that a summed-RSS figure can be compared with private
(physical footprint / dirty) figures on identical processes.

Usage:
  measure.py cli    [--runs N] [--db PATH]
  measure.py workload --k K [--lines L] [--sleep S] [--label NAME]
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
BATON2 = "/Users/wahargis/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2"
HARNESS = os.path.join(HERE, "fx", "harness.sh")


def run(argv, **kw):
    return subprocess.run(argv, capture_output=True, text=True, **kw)


def parse_size(text):
    """Parse a vmmap/footprint size such as '83.4M', '4432K', '0 B', '1.6G'."""
    m = re.match(r"^\s*([0-9.]+)\s*([KMG]?)(i?B)?\s*$", text)
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2)
    factor = {"": 1, "K": 1024, "M": 1024 ** 2, "G": 1024 ** 3}[unit]
    return int(round(value * factor))


def ps_rss_kb(pid):
    out = run(["ps", "-o", "rss=", "-p", str(pid)]).stdout.strip()
    return int(out) if out else None


def ps_cpu(pid):
    out = run(["ps", "-o", "%cpu=", "-p", str(pid)]).stdout.strip()
    return float(out) if out else None


def footprint_bytes(pid):
    out = run(["/usr/bin/footprint", "-p", str(pid)]).stdout
    m = re.search(r"^\s*phys_footprint:\s*([0-9.]+\s*[KMG]?B?)\s*$", out, re.M)
    return parse_size(m.group(1)) if m else None


def vmmap_summary(pid):
    out = run(["/usr/bin/vmmap", "-summary", str(pid)]).stdout
    result = {"resident": None, "dirty": None, "shared_readonly": None, "regions": {}}
    for line in out.splitlines():
        m = re.match(r"^Physical footprint:\s+([0-9.]+\s*[KMG]?B?)\s*$", line.strip())
        if m:
            result["physical_footprint"] = parse_size(m.group(1))
        m = re.match(r"^(__TEXT|__LINKEDIT|__OBJC_RO|shared memory|Untagged|Stack|Malloc Small)\s+(.*)$", line)
        if m:
            cols = m.group(2).split()
            if len(cols) >= 2:
                result["regions"][m.group(1)] = {
                    "virtual": parse_size(cols[0]),
                    "resident": parse_size(cols[1]),
                    "dirty": parse_size(cols[2]) if len(cols) > 2 else None,
                }
        if line.startswith("TOTAL"):
            cols = line.split()
            if len(cols) >= 5 and cols[0] == "TOTAL":
                result.setdefault("resident", parse_size(cols[2]))
                result["dirty"] = parse_size(cols[3])
    shared = 0
    for name in ("__TEXT", "__LINKEDIT", "__OBJC_RO", "shared memory"):
        entry = result["regions"].get(name)
        if entry and entry.get("resident"):
            shared += entry["resident"]
    result["shared_readonly"] = shared or None
    return result


def process_table():
    out = run(["ps", "-Ao", "pid=,ppid=,rss=,command="]).stdout
    rows = []
    for line in out.splitlines():
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        pid, ppid, rss, command = int(parts[0]), int(parts[1]), int(parts[2]), parts[3]
        rows.append({"pid": pid, "ppid": ppid, "rss_kb": rss, "command": command})
    return rows


def role_tree(db):
    """Identify observer/keeper/harness pids for the fixture database."""
    rows = process_table()
    marker = os.path.basename(db)
    observers = [r for r in rows if marker + " receive " in r["command"]]
    found = []
    for obs in observers:
        session = obs["command"].split(marker + " receive ", 1)[1].split()[0]
        keepers = [r for r in rows if r["ppid"] == obs["pid"]]
        for keeper in keepers:
            harnesses = [r for r in rows if r["ppid"] == keeper["pid"]]
            found.append({"session": session, "observer": obs, "keeper": keeper,
                          "harness": harnesses[0] if harnesses else None})
            break
    return found


def cli(args):
    db = args.db
    os.makedirs(os.path.dirname(db), exist_ok=True)
    if os.path.exists(db):
        os.remove(db)
    runs = []
    for i in range(args.runs):
        started = time.monotonic()
        proc = run(["/usr/bin/time", "-l", BATON2, db, "status"])
        wall = time.monotonic() - started
        text = proc.stderr
        realtime = re.search(r"([0-9.]+) real", text)
        user = re.search(r"([0-9.]+) user", text)
        syscpu = re.search(r"([0-9.]+) sys", text)
        maxrss = re.search(r"(\d+)\s+maximum resident set size", text)
        runs.append({
            "run": i,
            "exit": proc.returncode,
            "wall_s": round(wall, 4),
            "user_s": float(user.group(1)) if user else None,
            "sys_s": float(syscpu.group(1)) if syscpu else None,
            "max_rss_bytes": int(maxrss.group(1)) if maxrss else None,
        })
    print(json.dumps({"binary": BATON2, "command": "status", "runs": runs}, indent=2))


def launch_session(db, session, log_dir, lines, sleep_s, big=0):
    log = os.path.join(log_dir, session + ".log")
    env = dict(os.environ, LINES=str(lines), SLEEP=str(sleep_s), BIG=str(big))
    out = open(os.path.join(log_dir, session + ".stdout"), "wb")
    err = open(os.path.join(log_dir, session + ".stderr"), "wb")
    proc = subprocess.Popen(
        [BATON2, db, "receive", session, HARNESS, "omp", "high",
         os.path.join(log_dir, "cwd"), log, session + "-msg"],
        stdout=out, stderr=err, env=env, start_new_session=True)
    return proc


def workload(args):
    db = os.path.join(HERE, "fx", "workload-%s.db" % args.label)
    log_dir = os.path.join(HERE, "fx", "evidence", args.label)
    shutil.rmtree(log_dir, ignore_errors=True)
    os.makedirs(os.path.join(log_dir, "cwd"), exist_ok=True)
    for path in (db,):
        if os.path.exists(path):
            os.remove(path)
    run([BATON2, db, "status"])
    run([BATON2, db, "attach", "probe-root", "omp", "rootnat", ""])
    statements = []
    for i in range(1, args.k + 1):
        run([BATON2, db, "attach", f"probe{i}", "omp", "", ""])
        statements.append(
            f"INSERT INTO messages(id,sender,recipient,kind,body) "
            f"VALUES('probe{i}-msg','probe-root','probe{i}','task','fixture task');")
    run(["sqlite3", db, "\n".join(statements)])
    procs = [launch_session(db, f"probe{i}", log_dir, args.lines, args.sleep, args.big)
             for i in range(1, args.k + 1)]
    # Wait until every launched session has an observer with a keeper and harness.
    deadline = time.monotonic() + 60
    tree = []
    while time.monotonic() < deadline:
        tree = role_tree(db)
        if len(tree) >= args.k and all(t["harness"] for t in tree):
            break
        time.sleep(0.2)
    time.sleep(args.settle)
    tree = role_tree(db)
    sample = {"label": args.label, "k": args.k, "lines": args.lines, "sleep": args.sleep,
              "db": db, "sessions": []}
    totals = {"rss": 0, "footprint": 0, "dirty": 0, "resident": 0, "shared_readonly": 0}
    for entry in sorted(tree, key=lambda e: e["session"]):
        row = {"session": entry["session"], "roles": {}}
        for role in ("observer", "keeper", "harness"):
            proc = entry[role]
            if not proc:
                continue
            pid = proc["pid"]
            rss = ps_rss_kb(pid)
            vm = vmmap_summary(pid)
            fp = footprint_bytes(pid)
            row["roles"][role] = {
                "pid": pid, "rss_bytes": rss * 1024 if rss else None,
                "cpu_percent": ps_cpu(pid),
                "phys_footprint": fp,
                "resident": vm.get("resident"), "dirty": vm.get("dirty"),
                "shared_readonly": vm.get("shared_readonly"),
                "command": proc["command"][:120],
            }
            if rss:
                totals["rss"] += rss * 1024
            if fp:
                totals["footprint"] += fp
            if vm.get("dirty"):
                totals["dirty"] += vm["dirty"]
            if vm.get("resident"):
                totals["resident"] += vm["resident"]
            if vm.get("shared_readonly"):
                totals["shared_readonly"] += vm["shared_readonly"]
        sample["sessions"].append(row)
    sample["totals"] = totals
    sample["rss_over_footprint"] = round(totals["rss"] / totals["footprint"], 2) if totals["footprint"] else None
    sample["rss_over_dirty"] = round(totals["rss"] / totals["dirty"], 2) if totals["dirty"] else None
    with open(os.path.join(log_dir, "sample.json"), "w") as handle:
        json.dump(sample, handle, indent=2)
    for row in sample["sessions"]:
        for role, entry in row["roles"].items():
            print("%s %-8s pid=%s rss=%s footprint=%s dirty=%s shared_ro=%s" % (
                row["session"], role, entry["pid"], entry["rss_bytes"], entry["phys_footprint"],
                entry["dirty"], entry["shared_readonly"]))
    print("totals", json.dumps({"rss": totals["rss"], "footprint": totals["footprint"],
                                "dirty": totals["dirty"], "resident": totals["resident"],
                                "shared_readonly": totals["shared_readonly"],
                                "rss_over_footprint": sample["rss_over_footprint"],
                                "rss_over_dirty": sample["rss_over_dirty"]}))

    statuses = []
    for i, proc in enumerate(procs, start=1):
        try:
            code = proc.wait(timeout=args.sleep + 120)
        except subprocess.TimeoutExpired:
            proc.send_signal(signal.SIGTERM)
            code = "timeout"
        statuses.append({"session": f"probe{i}", "exit": code})
    with open(os.path.join(log_dir, "exits.json"), "w") as handle:
        json.dump(statuses, handle, indent=2)
    print(json.dumps({"launcher_exits": statuses}, indent=2))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    cli_parser = sub.add_parser("cli")
    cli_parser.add_argument("--runs", type=int, default=5)
    cli_parser.add_argument("--db", default=os.path.join(HERE, "fx", "cli.db"))
    cli_parser.set_defaults(func=cli)
    work = sub.add_parser("workload")
    work.add_argument("--k", type=int, default=1)
    work.add_argument("--lines", type=int, default=0)
    work.add_argument("--sleep", type=int, default=30)
    work.add_argument("--big", type=int, default=0)
    work.add_argument("--settle", type=float, default=3.0)
    work.add_argument("--label", default="idle-k1")
    work.set_defaults(func=workload)
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
