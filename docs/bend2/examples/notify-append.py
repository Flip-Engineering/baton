#!/usr/bin/env python3
"""Append one Baton seat event to an events file as one JSON line.

usage: notify-append.py EVENTS_FILE

The seat-events follower (`seat-events.mjs --notify`, or the `notify` command of
project settings) runs this command once per event with the event as JSON on
stdin. The command parses that JSON, writes it to EVENTS_FILE as one compact
line, flushes the line to disk and exits 0. It takes an exclusive flock on
EVENTS_FILE for the write, so lines from several followers never mix. A new
EVENTS_FILE is created with mode 0644. Any other outcome exits nonzero with the
cause on stderr; the follower then keeps the event and runs the command again
for it at its next evaluation.

Project settings line (baton2/settings.json in the project's git common
directory):

  "notify": {"argv": ["/usr/bin/python3", "-I", "/path/to/notify-append.py",
                      "/path/to/events.jsonl"]}
"""
import fcntl
import json
import os
import sys


def main(argv):
    if len(argv) != 2:
        sys.stderr.write('usage: notify-append.py EVENTS_FILE\n')
        return 2
    path = argv[1]
    try:
        event = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    except (UnicodeDecodeError, ValueError) as error:
        sys.stderr.write('notify-append: stdin is not one JSON value: %s\n' % error)
        return 1
    if not isinstance(event, dict):
        sys.stderr.write('notify-append: stdin is not a JSON object\n')
        return 1
    line = (json.dumps(event, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    descriptor = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_CLOEXEC, 0o644)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        start = os.fstat(descriptor).st_size
        if start == 0:
            os.fchmod(descriptor, 0o644)
        written = 0
        try:
            while written < len(line):
                written += os.write(descriptor, line[written:])
        except OSError:
            # A partial line would join the next line; remove it under the lock.
            os.ftruncate(descriptor, start)
            raise
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv))
    except OSError as error:
        sys.stderr.write('notify-append: %s\n' % error)
        sys.exit(1)
