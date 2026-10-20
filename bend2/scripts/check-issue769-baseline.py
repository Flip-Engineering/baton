#!/usr/bin/env python3
"""Failing-baseline reproduction for issue #769 from fixture frame shapes.

The script reads the fixture stream, the actual `frame_id_sql` expression from
`bend2/src/coordinator/logs.bend`, and the actual `filter_mode_sql` expression
from `bend2/src/coordinator/turn.bend`. It evaluates both expressions with
Python's sqlite3 module, mirrors the default-level step functions in
`logs.bend`, and reports what the public log retains.

It needs Python 3 and sqlite3 only. No Bend compiler and no coordinator binary
are involved, so the reproduction runs while the shared compiler queue is
unavailable.

Exit 0 when the source keeps one snapshot per open message, flushes the newest
snapshot of an interrupted stream, and classifies the missing-id filter refusal
as refused. Exit 1 while the source reproduces the #769 growth path.
"""
import argparse
import json
import pathlib
import re
import sqlite3
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'bend2/test/fixtures/issue769-omp-cumulative-snapshots.jsonl'
LOGS = ROOT / 'bend2/src/coordinator/logs.bend'
TURN = ROOT / 'bend2/src/coordinator/turn.bend'

KINDS = {'message_update', 'tool_execution_update', 'message_start', 'response',
         'message_end', 'tool_execution_start', 'tool_execution_end', 'turn_end',
         'agent_end', 'extension_ui_request'}
PREFIX = {'tool_execution_update', 'message_start', 'message_update'}
CLOSE = {'tool_execution_end', 'message_end'}
IDENTIFIED = PREFIX | CLOSE
# The expression is either a single literal or a one-line call that forwards
# the already-quoted argument to a *_sql_value helper (the current main shape).
SEGMENT = re.compile(r'"\s*\+\+\s*(?:C\.q\()?(\w+)\)?\s*\+\+\s*"')
ARGUMENT = {'line': 'line', 'value': 'line', 'requested': 'requested',
            'requested_sql': 'requested'}


def function_body(lines, name):
    start = next((index for index, line in enumerate(lines)
                  if line.startswith('def ' + name + '(')), None)
    if start is None:
        raise SystemExit(f'no def {name}')
    end = next((index for index in range(start + 1, len(lines))
                if lines[index].startswith('def ')), len(lines))
    return lines[start + 1:end]


def source_sql(path, name):
    lines = path.read_text().splitlines()
    body = function_body(lines, name)
    literal = next((line.strip() for line in body if line.strip().startswith('"')), None)
    if literal is None:
        called = next((re.search(r'([A-Za-z_]\w*)\s*\(', line).group(1)
                       for line in body if re.search(r'([A-Za-z_]\w*)\s*\(', line)), None)
        if called is None:
            raise SystemExit(f'{path}: no literal or helper call in {name}')
        body = function_body(lines, called)
        literal = next((line.strip() for line in body if line.strip().startswith('"')), None)
    if literal is None or not literal.endswith('"'):
        raise SystemExit(f'{path}: no single-line literal for {name}')
    text = literal[1:-1]
    sql, binds, position = '', [], 0
    for match in SEGMENT.finditer(text):
        sql += text[position:match.start()] + '?'
        binds.append(match.group(1))
        position = match.end()
    sql += text[position:]
    return sql, binds


def query(connection, path, name, values):
    sql, binds = source_sql(path, name)
    arguments = [values[ARGUMENT.get(item, item)] for item in binds]
    return connection.execute(sql, arguments).fetchone()[0]


def frame_kind(line):
    try:
        value = json.loads(line)
    except ValueError:
        return ''
    kind = value.get('type')
    return kind if kind in KINDS else ''


def frames():
    return [line for line in FIXTURE.read_text().splitlines() if line.strip()]


def run_stream(connection, stream):
    """Mirror logs.bend default-level step selection and collect written lines."""
    written, held, identities = [], [], {}

    def held_put(kind, identity, line):
        held[:] = [(kind, identity, line)] + [entry for entry in held
                                              if not (entry[0] == kind and entry[1] == identity)]

    def held_drop(kind, identity):
        held[:] = [entry for entry in held if not (entry[0] == kind and entry[1] == identity)]

    def held_lines(kind, identity):
        return [entry[2] for entry in held if entry[0] == kind and entry[1] == identity]

    def prefix(identified, kind, identity, line):
        if identified:
            held_put(kind, identity, line)
        else:
            written.append(line)

    for line in stream:
        kind = frame_kind(line)
        identity = query(connection, LOGS, 'frame_id_sql', {'line': line}) if kind in IDENTIFIED else ''
        identities[line] = identity
        identified = bool(identity)
        if kind == 'tool_execution_update':
            prefix(identified, 'tool_execution_update', identity, line)
        elif kind == 'tool_execution_end':
            written.extend(held_lines('tool_execution_update', identity))
            written.append(line)
            held_drop('tool_execution_update', identity)
        elif kind == 'message_start':
            prefix(identified, 'message_start', identity, line)
        elif kind == 'message_update':
            prefix(identified, 'message_update', identity, line)
        elif kind == 'message_end':
            written.append(line)
            held_drop('message_start', identity)
            held_drop('message_update', identity)
        else:
            written.append(line)
    # A turn that ends with prefixes still held flushes them.
    written.extend(entry[2] for entry in held)
    return written, identities, list(held)


def line_bytes(lines):
    return sum(len(line.encode('utf-8')) + 1 for line in lines)


def snapshot_lines(lines):
    return [line for line in lines if frame_kind(line) == 'message_update']


def report(connection, label, stream):
    written, identities, held = run_stream(connection, stream)
    snapshots = snapshot_lines(written)
    starts = [line for line in written if frame_kind(line) == 'message_start']
    ends = [line for line in written if frame_kind(line) in ('message_end', 'agent_end')]
    raw = line_bytes(stream)
    public = line_bytes(written)
    newest = snapshots[-1] if snapshots else ''
    thinking = ''
    if newest:
        thinking = json.loads(newest)['message']['content'][0]['thinking']
    print(f'{label}: frames={len(stream)} rawBytes={raw} publicBytes={public}')
    print(f'  message_update written={len(snapshots)} bytes={line_bytes(snapshots)}')
    print(f'  message_start written={len(starts)} message_end/agent_end written={len(ends)}')
    print(f'  newest snapshot preserved={"yes" if thinking else "no"} unicode={"λ🙂" in thinking}')
    return {'snapshots': snapshots, 'starts': starts, 'ends': ends,
            'written': written, 'held': held, 'identities': identities,
            'raw': raw, 'public': public}


def main():
    global FIXTURE, LOGS, TURN
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=pathlib.Path, default=FIXTURE)
    parser.add_argument('--logs', type=pathlib.Path, default=LOGS)
    parser.add_argument('--turn', type=pathlib.Path, default=TURN)
    options = parser.parse_args()
    FIXTURE, LOGS, TURN = options.fixture, options.logs, options.turn

    stream = frames()
    closed_end = next(index for index, line in enumerate(stream) if frame_kind(line) == 'message_end')
    connection = sqlite3.connect(':memory:')
    refusal = next(line for line in stream if frame_kind(line) == 'response')
    requested = json.dumps(['message_start', 'message_update', 'message_end'])
    mode = query(connection, TURN, 'filter_mode_sql', {'line': refusal, 'requested': requested})
    mode = (mode or '').strip()

    interrupted = report(connection, 'interrupted stream', stream[:closed_end])
    closed = report(connection, 'closed stream', stream)
    identities = closed['identities']
    unidentified = sum(1 for line, identity in identities.items()
                       if frame_kind(line) in ('message_start', 'message_update', 'message_end')
                       and identity)

    print(f'filter refusal classified={mode or "empty"}')
    print(f'lifecycle frames with an identity={unidentified}/{sum(1 for line in stream if frame_kind(line) in ("message_start","message_update","message_end"))}')

    defects = []
    if len(interrupted['snapshots']) > 1:
        defects.append('an interrupted stream writes every cumulative snapshot')
    if len(closed['snapshots']) > 0:
        defects.append('a closed message writes cumulative snapshots instead of its message_end')
    if unidentified == 0:
        defects.append('unidentified lifecycle frames have no shared identity')
    if mode != 'refused':
        defects.append(f'the missing-id filter refusal classifies as {mode or "empty"}')
    if not interrupted['snapshots']:
        defects.append('an interrupted stream flushes no snapshot')
    if interrupted['snapshots'] and 'λ🙂' not in json.loads(interrupted['snapshots'][-1])['message']['content'][0]['thinking']:
        defects.append('the flushed snapshot loses Unicode content')
    if not any(frame_kind(line) == 'message_end' for line in closed['written']):
        defects.append('the closed stream loses its full message_end')
    if defects:
        print('BASELINE DEFECT REPRODUCED:')
        for defect in defects:
            print(f'  - {defect}')
        return 1
    print('SNAPSHOT AND REFUSAL BEHAVIOR MATCHES ISSUE #769 REQUIREMENTS')
    return 0


if __name__ == '__main__':
    sys.exit(main())
