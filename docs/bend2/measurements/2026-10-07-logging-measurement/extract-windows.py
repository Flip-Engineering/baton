#!/usr/bin/env python3
"""Extract the real-frame workload windows used by the issue #686 measurement.

Reads one retained OMP provider log and writes two frame files:

  frames-task.jsonl       the first 300 contiguous `tool_execution_update` frames
                          of the single `task` tool call in the source log
  frames-omp-window.jsonl the 140-line contiguous window with the smallest total
                          byte size that covers at least eight distinct frame
                          types, stepping the search start by 20 lines

The frame files are inputs to measure.py. Both selections are deterministic for
a given source log, so the SHA256 of each output identifies the selection.
"""
import hashlib
import json
import pathlib
import sys

TASK_CALL = 'call_00_BF9yx8K9cfoORRLfR4mO2883'
TASK_FRAMES = 300
WINDOW_LINES = 140
WINDOW_STRIDE = 20
WINDOW_TYPES = 8


def kind(line):
    try:
        value = json.loads(line)
    except ValueError:
        return '<unparsed>'
    if not isinstance(value, dict):
        return '<nondict>'
    frame = value.get('type')
    return frame if isinstance(frame, str) else '<%s>' % type(frame).__name__


def main():
    source = pathlib.Path(sys.argv[1])
    out = pathlib.Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    lines = source.read_bytes().splitlines(keepends=True)
    task = [index for index, line in enumerate(lines)
            if kind(line) == 'tool_execution_update' and TASK_CALL.encode() in line]
    (out / 'frames-task.jsonl').write_bytes(b''.join(lines[index] for index in task[:TASK_FRAMES]))
    best = None
    for start in range(0, len(lines) - WINDOW_LINES, WINDOW_STRIDE):
        window = lines[start:start + WINDOW_LINES]
        types = {kind(line) for line in window}
        if len(types) < WINDOW_TYPES:
            continue
        size = sum(len(line) for line in window)
        if best is None or size < best[0]:
            best = (size, start, sorted(types))
    size, start, types = best
    (out / 'frames-omp-window.jsonl').write_bytes(b''.join(lines[start:start + WINDOW_LINES]))
    report = {'source': str(source), 'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
              'task_call': TASK_CALL, 'task_frames': TASK_FRAMES,
              'window_start_line': start, 'window_lines': WINDOW_LINES,
              'window_bytes': size, 'window_types': types}
    for name in ('frames-task.jsonl', 'frames-omp-window.jsonl'):
        path = out / name
        report[name] = {'bytes': path.stat().st_size,
                        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    (out / 'extraction.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
