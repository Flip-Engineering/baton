#!/usr/bin/env python3
"""Run a command with a sampled process-tree resident limit and wall timeout.

The resident limit is an observation, not a kernel cgroup ceiling. Use a
delegated cgroup for a hard limit. Process identity comes from the portable
`ps -A -o pid=,ppid=,rss=,pgid=` table, so the same path runs on Linux and
Darwin and does not parse /proc or process command names.

The child starts in a new session. Only that session's process group is
signaled, and only after a cap, timeout or observation failure. The child is
always reaped in a finally block.

Usage:
  python3 bend2/scripts/capped-run.py --limit-bytes N --timeout SECONDS -- COMMAND...
"""
import argparse
import os
import resource
import signal
import subprocess
import sys
import time


class ObservationError(RuntimeError):
    pass


def process_table():
    try:
        result = subprocess.run(
            ['ps', '-A', '-o', 'pid=,ppid=,rss=,pgid='],
            capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ObservationError(f'ps failed: {error}') from error
    if result.returncode != 0:
        raise ObservationError(result.stderr.strip() or f'ps exit {result.returncode}')
    rows = []
    for line in result.stdout.splitlines():
        fields = line.split()
        if not fields:
            continue
        if len(fields) != 4:
            raise ObservationError(f'malformed ps row: {line!r}')
        try:
            pid, ppid, rss, pgid = (int(field) for field in fields)
        except ValueError as error:
            raise ObservationError(f'malformed ps row: {line!r}') from error
        rows.append((pid, ppid, rss, pgid))
    return rows


def descendants(root, rows):
    children = {}
    for pid, ppid, _rss, _pgid in rows:
        children.setdefault(ppid, []).append(pid)
    seen = set()
    pending = [root]
    while pending:
        pid = pending.pop()
        if pid in seen:
            continue
        seen.add(pid)
        pending.extend(children.get(pid, ()))
    return seen


def tree_rss(root, rows):
    members = descendants(root, rows)
    return sum(rss for pid, _ppid, rss, _pgid in rows if pid in members) * 1024


def group_members(pgid, rows):
    return any(row_pgid == pgid for _pid, _ppid, _rss, row_pgid in rows)


def child_setup():
    resource.setrlimit(resource.RLIMIT_STACK,
                       (resource.RLIM_INFINITY, resource.RLIM_INFINITY))


def kill_group(pgid, rows):
    # Signal only the child's own session/process group. When a fresh process
    # table is available, require a member with that pgid first.
    if rows is not None and not group_members(pgid, rows):
        return
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit-bytes', type=int, required=True)
    parser.add_argument('--timeout', type=float, required=True)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    options = parser.parse_args()
    command = options.command
    if command and command[0] == '--':
        command = command[1:]
    if not command:
        parser.error('a command is required after --')

    started = time.monotonic()
    child = subprocess.Popen(command, preexec_fn=child_setup,
                             start_new_session=True)
    pgid = child.pid
    peak = 0
    cause = 'completed'
    detail = ''
    last_rows = None
    try:
        while True:
            status = child.poll()
            rows = process_table()
            last_rows = rows
            current = tree_rss(child.pid, rows)
            peak = max(peak, current)
            if current > options.limit_bytes:
                cause = 'resident-cap-exceeded'
                break
            if time.monotonic() - started > options.timeout:
                cause = 'wall-timeout'
                break
            if status is not None:
                break
            time.sleep(0.05)
    except ObservationError as error:
        cause = 'observation-error'
        detail = str(error)
    finally:
        if cause != 'completed' or child.poll() is None:
            kill_group(pgid, last_rows)
        try:
            child.wait()
        except ChildProcessError:
            pass

    elapsed = time.monotonic() - started
    line = (f'capped-run cause={cause} exit={child.returncode} '
            f'peak_rss_bytes={peak} elapsed_seconds={elapsed:.3f}')
    if detail:
        line += f' detail={detail}'
    print(line, flush=True)
    return 0 if cause == 'completed' and child.returncode == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
