#!/usr/bin/env python3
"""Issue #686 workload measurement driver (logging-measure-ds-20261007).

Provider-free measurements of the Baton2 coordinator log policy:

  batches    one native receive over a fixed frame workload; per-batch retained
             bytes, peak size per transient file, final inventory, logs-storage
  replay     one direct turn over a frame file for a chosen harness; per-frame
             retained/dropped evidence for that harness's frame shapes
  incomplete one direct turn cut before its closing frames; .pending retention
             and the restore the next turn performs
  inventory  aggregate retained bytes with a breakdown for a finished run

Every mode writes result.json into its output directory and prints a summary.
No network, no provider: the fixture writes frames and reports byte counts.
"""
import argparse
import hashlib
import json
import os
import pathlib
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time

FIXTURE = r'''import json,pathlib,socket,sys
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'config.json').read_text())
state=json.loads(sys.stdin.readline())
prompt=json.loads(sys.stdin.readline())
def output(value):
    value=(json.dumps(value,separators=(',',':'))+'\n').encode()
    sys.stdout.buffer.write(value)
    sys.stdout.buffer.flush()
    return len(value)
def marker(value):
    output({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':value}})
marker('native-ready')
client=socket.create_connection(('127.0.0.1',config['port']))
stream=client.makefile('rwb',buffering=0)
stream.write(b'{"ready":true}\n')
fragment="model text with apostrophe ' and escaped newline\n "
while True:
    action=json.loads(stream.readline())
    if action['kind']=='finish':
        output({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'complete'}]}]})
        sys.stdin.read()
        break
    if action['kind'] in ('raw','frames'):
        total=0
        for line in action['lines']:
            data=(line+'\n').encode()
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            total+=len(data)
        marker(action['marker'])
        stream.write((json.dumps({'bytes':total,'frames':len(action['lines'])})+'\n').encode())
        continue
    if action['kind']=='stderr':
        data=b'x'*action['bytes']
        sys.stderr.buffer.write(data)
        sys.stderr.buffer.flush()
        marker(action['marker'])
        stream.write((json.dumps({'bytes':len(data),'frames':0})+'\n').encode())
        continue
    if action['kind']=='tool':
        count=action['count']
        total=0
        for i in range(count):
            size=action['step']*(i+1)
            text=(fragment*(size//len(fragment)+1))[:size]
            total+=output({'type':'tool_execution_update','toolCallId':'tool-1','toolName':'bash','partialResult':{'content':[{'type':'text','text':text}]}})
        marker(action['marker'])
        stream.write((json.dumps({'bytes':total,'frames':count})+'\n').encode())
        continue
    count=action['count']
    total=0
    for i in range(count):
        size=action['step']*(i+1) if action['kind']=='cumulative' else action['step']
        text=(fragment*(size//len(fragment)+1))[:size]
        total+=output({'type':'message_update','message':{'role':'assistant','content':[{'type':'text','text':text}]},'assistantMessageEvent':{'type':'text_delta','contentIndex':0,'delta':'more text'}})
    marker(action['marker'])
    stream.write((json.dumps({'bytes':total,'frames':count})+'\n').encode())
stream.close()
client.close()
'''

PLAYER = '''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
'''

PLAYER_STDIN = '''import os,pathlib,sys,time
fd=sys.stdin.fileno()
os.set_blocking(fd,False)
deadline=time.time()+3.0
while time.time()<deadline:
    try:
        chunk=os.read(fd,65536)
    except BlockingIOError:
        time.sleep(0.01)
        continue
    if not chunk:
        break
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
'''

SEMANTIC = [
    '{"type":null,"probe":"null"}',
    '{"type":123,"probe":"number"}',
    '{"type":["message_update"],"probe":"array"}',
    '{"probe":"message_update"}',
    '{"type":"message_update\\u0000suffix","probe":"nul suffix"}',
    '{invalid JSON containing message_update}',
]
SEMANTIC_OMITTED = [
    '  {"message":{"content":"large prefix"},"type":"message_update"}  ',
    '{"typ\\u0065":"message_\\u0075pdate","probe":"escaped"}',
]


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def gen_code(value):
    return ''.join(c if c.isascii() and (c.isalnum() or c in '-_') else '%%%02x' % ord(c) for c in value)


def shebang_ok(path):
    """A harness the kernel cannot exec is silently retried as a shell script."""
    data = pathlib.Path(path).read_bytes()
    assert data[:2] == b'#!', 'harness shebang missing in %s: %r' % (path, data[:24])
    return path


def call(exe, db, *args, timeout=300):
    return subprocess.run([str(exe), str(db), *map(str, args)], capture_output=True, text=True, timeout=timeout)


class Peak:
    """Largest size each file under a directory reaches while the run is live."""

    def __init__(self, root, series_seconds=0.25):
        self.root = pathlib.Path(root)
        self.files = {}
        self.series = []
        self.series_seconds = series_seconds
        self.started = None
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.lock = threading.Lock()

    def sample(self):
        import time as clock
        self.started = clock.monotonic()
        total = 0
        last = -1.0
        while not self.stop.is_set():
            total = 0
            for base, _, names in os.walk(self.root):
                for name in names:
                    path = pathlib.Path(base) / name
                    try:
                        size = path.stat().st_size
                    except OSError:
                        continue
                    total += size
                    key = str(path.relative_to(self.root))
                    if size > self.files.get(key, -1):
                        self.files[key] = size
            elapsed = clock.monotonic() - self.started
            if elapsed - last >= self.series_seconds:
                with self.lock:
                    self.series.append([round(elapsed, 3), total])
                last = elapsed
            self.stop.wait(0.005)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.stop.set()
        self.thread.join()


def walk(root):
    root = pathlib.Path(root)
    rows = []
    for base, _, names in os.walk(root):
        for name in names:
            path = pathlib.Path(base) / name
            try:
                size = path.stat().st_size
            except OSError:
                continue
            rows.append({'path': str(path.relative_to(root)), 'bytes': size})
    return sorted(rows, key=lambda row: (-row['bytes'], row['path']))


def table_sizes(db):
    try:
        with sqlite3.connect(db) as conn:
            names = [row[0] for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type IN ('table','index')")]
            sizes = dict(conn.execute('SELECT name, SUM(pgsize) FROM dbstat GROUP BY name').fetchall())
            counts = {}
            for name in names:
                if name.startswith('sqlite_'):
                    continue
                try:
                    counts[name] = conn.execute('SELECT COUNT(*) FROM "%s"' % name).fetchone()[0]
                except sqlite3.Error:
                    counts[name] = None
        return {'dbstat': True, 'bytes': sizes, 'rows': counts}
    except sqlite3.Error as error:
        counts = {}
        try:
            with sqlite3.connect(db) as conn:
                for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"):
                    if name.startswith('sqlite_'):
                        continue
                    try:
                        counts[name] = conn.execute('SELECT COUNT(*) FROM "%s"' % name).fetchone()[0]
                    except sqlite3.Error:
                        counts[name] = None
        except sqlite3.Error:
            pass
        return {'dbstat': False, 'error': str(error), 'rows': counts}


def classify(root, rows):
    """Group retained bytes by producer, using the path rather than the name alone."""
    groups = {'database': [], 'public_log': [], 'generation': [], 'segment': [], 'checkpoint': [],
              'stderr': [], 'attempt_evidence': [], 'payload_artifact': [], 'workload_input': [],
              'other': []}
    inputs = ('events.jsonl', 'frames-task.jsonl', 'frames-omp-window.jsonl', 'task.txt',
              'fixture', 'fixture-harness', 'config.json')
    for row in rows:
        path = row['path']
        name = os.path.basename(path)
        if 'state.db.attempt-' in path:
            groups['attempt_evidence'].append(row)
        elif name.endswith('.pending') or '.pending.tmp.' in name:
            groups['checkpoint'].append(row)
        elif '.stderr' in name or name == 'stderr.log' or name.endswith('.full') or name.endswith('.meta'):
            groups['stderr'].append(row)
        elif name.startswith('state.db'):
            groups['database'].append(row)
        elif '.attempt-' in name and name.rsplit('.', 1)[-1].isdigit():
            groups['segment'].append(row)
        elif '.attempt-' in name:
            groups['generation'].append(row)
        elif name.rsplit('.', 1)[-1].isdigit():
            groups['segment'].append(row)
        elif name == 'manifest':
            groups['payload_artifact'].append(row)
        elif name in inputs:
            groups['workload_input'].append(row)
        elif name.endswith('.jsonl'):
            groups['public_log'].append(row)
        else:
            groups['other'].append(row)
    totals = {key: sum(row['bytes'] for row in value) for key, value in groups.items()}
    totals['all'] = sum(row['bytes'] for row in rows)
    return {'groups': groups, 'totals': totals}


def line_index(path):
    try:
        return pathlib.Path(path).read_text(errors='replace').splitlines()
    except FileNotFoundError:
        return []


def live_logs(log):
    """The base log and every generation file beside it that currently exists.

    A direct turn and a retained receive both rebind OUTPUT_LOG to
    `<base>.attempt-<attempt>` before opening it, so the base path can stay
    absent for the whole run.
    """
    base = pathlib.Path(log)
    found = sorted((path for path in base.parent.glob(base.name + '.attempt-*') if path.is_file()),
                   key=lambda path: path.stat().st_mtime)
    return [base, *found] if base.is_file() else found


def logs_bytes(log):
    return sum(path.stat().st_size for path in live_logs(log))


def logs_lines(log):
    lines = []
    for path in live_logs(log):
        lines += line_index(path)
    return lines


def disposition(emitted, saved):
    """Which emitted lines the public log holds, with an exact per-line match."""
    held = set(saved)
    retained = [line for line in emitted if line in held]
    dropped = [line for line in emitted if line not in held]
    return retained, dropped


def batch_summary(emitted, saved, expected_note=None):
    plain = list(saved)
    notes = [line for line in plain if '"baton_log_rotation"' in line or '"baton_event_filter"' in line]
    body = [line for line in plain if line not in notes]
    retained, dropped = disposition(emitted, body)
    return {
        'emitted_lines': len(emitted),
        'retained_lines': len(retained),
        'dropped_lines': len(dropped),
        'retained_bytes_matched': sum(len(line.encode()) + 1 for line in retained),
        'dropped_bytes_matched': sum(len(line.encode()) + 1 for line in dropped),
        'note_lines': len(notes),
        'retained_samples': [line[:120] for line in retained[:3]],
        'dropped_samples': [line[:120] for line in dropped[:3]],
    }


def per_type(emitted, body):
    import collections
    seen = collections.Counter()
    held = collections.Counter()
    saved = set(body)
    for line in emitted:
        try:
            value = json.loads(line)
            kind = value.get('type') if isinstance(value, dict) else '<nondict>'
        except Exception:
            kind = '<unparsed>'
        kind = kind if isinstance(kind, str) else '<%s>' % type(kind).__name__
        seen[kind] += 1
        if line in saved:
            held[kind] += 1
    return [{'type': kind, 'emitted': seen[kind], 'retained': held[kind],
             'dropped': seen[kind] - held[kind]} for kind in sorted(seen)]


def read_frames(path):
    return [line for line in pathlib.Path(path).read_text(errors='replace').splitlines() if line.strip()]


def batches(args):
    directory = pathlib.Path(args.out)
    directory.mkdir(parents=True, exist_ok=True)
    exe = pathlib.Path(args.exe).resolve()
    db = directory / 'state.db'
    log = directory / 'native.jsonl'
    fixture = directory / 'fixture'
    fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
    fixture.chmod(0o755)
    shebang_ok(fixture)
    server = socket.socket()
    server.bind(('127.0.0.1', 0))
    server.listen()
    (directory / 'config.json').write_text(json.dumps({'port': server.getsockname()[1]}))
    coord_log = []

    def coord(*values):
        done = call(exe, db, *values)
        coord_log.append({'argv': [str(value) for value in values], 'returncode': done.returncode,
                          'stdout': done.stdout[:400], 'stderr': done.stderr[:400]})
        if done.returncode != 0:
            raise SystemExit('coordinator command failed: %s %s' % (' '.join(map(str, values)), done.stderr))
        return done.stdout

    coord('attach', 'root', 'omp', '', '')
    coord('role', 'root', 'principal-conductor')
    coord('attach', 'operator', 'terminal', '', '')
    coord('role', 'operator', 'operator')
    coord('message', 'initial', 'operator', 'root', 'task', 'Run the controlled probe.')
    if args.level:
        coord('logs', 'root', args.level,
              *([args.budget] if args.budget else []),
              *([args.segments] if args.segments else []))
        before = json.loads(coord('logs', 'root'))
    else:
        before = None
    stdout = (directory / 'stdout.log').open('w')
    stderr = (directory / 'stderr.log').open('w')
    peaks = Peak(directory)
    with peaks:
        child = subprocess.Popen([str(exe), str(db), 'receive', 'root', str(fixture), 'fixture', 'low',
                                  str(directory), str(log), ''], stdout=stdout, stderr=stderr)
        connection, _ = server.accept()
        stream = connection.makefile('rwb', buffering=0)
        assert json.loads(stream.readline())['ready']

        def wait_marker(marker):
            while True:
                row = None
                try:
                    with sqlite3.connect(db) as conn:
                        row = conn.execute("select native from sessions where id='root'").fetchone()
                except sqlite3.Error:
                    row = None
                if row and row[0] == marker:
                    return
                if child.poll() is not None:
                    raise SystemExit('native receiver exited early')
                time.sleep(0.01)

        wait_marker('native-ready')
        coord('ack', 'initial', 'root', 'probe input accepted')
        plan = []
        for cycle in range(args.repeat):
            suffix = '' if args.repeat == 1 else '-%d' % (cycle + 1)
            if args.accumulate:
                plan.append({'kind': 'frames', 'marker': 'native-accumulate' + suffix,
                             'lines': [json.dumps({'type': 'response', 'id': 'acc%d' % index,
                                                   'command': 'probe', 'pad': 'y' * args.accumulate})
                                       for index in range(args.accumulate_frames)]})
            else:
                plan.append({'kind': 'small', 'count': args.count, 'step': 128,
                             'marker': 'native-small' + suffix})
                plan.append({'kind': 'cumulative', 'count': args.count, 'step': args.step,
                             'marker': 'native-cumulative' + suffix})
                plan.append({'kind': 'tool', 'count': args.count, 'step': args.step,
                             'marker': 'native-tool-bash' + suffix})
                if args.task_frames:
                    plan.append({'kind': 'frames', 'marker': 'native-tool-task' + suffix,
                                 'lines': read_frames(args.task_frames)})
                if args.omp_window:
                    plan.append({'kind': 'frames', 'marker': 'native-omp-window' + suffix,
                                 'lines': read_frames(args.omp_window)})
                plan.append({'kind': 'raw', 'marker': 'native-semantic' + suffix,
                             'lines': SEMANTIC + SEMANTIC_OMITTED})
            if args.stderr_bytes:
                plan.append({'kind': 'stderr', 'bytes': args.stderr_bytes,
                             'marker': 'native-stderr' + suffix})
        measures = []
        for action in plan:
            before_size = logs_bytes(log)
            start = time.monotonic()
            stream.write((json.dumps(action) + '\n').encode())
            emitted = json.loads(stream.readline())
            wait_marker(action['marker'])
            elapsed = time.monotonic() - start
            saved = logs_lines(log)
            summary = batch_summary(action.get('lines', []), saved)
            row = {'batch': action['marker'], 'wall_seconds': elapsed,
                   'retained_bytes': logs_bytes(log) - before_size,
                   **emitted}
            if action.get('lines'):
                row.update(summary)
                body = [line for line in saved if '"baton_log_rotation"' not in line
                        and '"baton_event_filter"' not in line]
                row['by_type'] = per_type(action['lines'], body)
            measures.append(row)
            print(json.dumps({k: v for k, v in row.items() if k != 'by_type'}), flush=True)
        stream.write(b'{"kind":"finish"}\n')
        child.wait()
        returncode = child.returncode
        stream.close()
        connection.close()
    server.close()
    stdout.close()
    stderr.close()
    if args.level:
        after = json.loads(coord('logs', 'root'))
    else:
        after = None
    storage = None
    if args.level:
        storage = json.loads(coord('logs-storage'))
    rows = walk(directory)
    result = {
        'mode': 'batches',
        'exe': str(exe), 'exe_sha256': sha256(exe),
        'source_revision_supplied': args.source_revision,
        'level': args.level, 'budget': args.budget, 'segments': args.segments,
        'policy_before': before, 'policy_after': after,
        'parameters': {'count': args.count, 'step': args.step,
                       'task_frames': str(args.task_frames), 'omp_window': str(args.omp_window)},
        'coordinates': coord_log,
        'measurements': measures,
        'retained_log_bytes': logs_bytes(log),
        'live_log_paths': [str(path) for path in live_logs(log)],
        'peaks': peaks.files,
        'growth_series': peaks.series,
        'files': rows,
        'storage': storage,
        'returncode': returncode,
    }
    (directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'mode': 'batches', 'retained_log_bytes': result['retained_log_bytes'],
                      'returncode': returncode, 'peaks': peaks.files}, indent=2), flush=True)


def setup_repo(directory, harness, args):
    """Create the fixture repository and recruit one worker of the given harness."""
    exe = pathlib.Path(args.exe).resolve()
    db = directory / 'state.db'
    repo = directory / 'repository'
    repo.mkdir()
    checkouts = directory / 'checkouts'
    checkouts.mkdir()
    for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                 ['config', 'user.name', 'Measurement fixture']):
        subprocess.run(['git', '-C', str(repo), *argv], check=True, capture_output=True)
    (repo / 'seed.txt').write_text('seed\n')
    subprocess.run(['git', '-C', str(repo), 'add', 'seed.txt'], check=True, capture_output=True)
    subprocess.run(['git', '-C', str(repo), 'commit', '-q', '-m', 'seed'], check=True, capture_output=True)
    base = subprocess.run(['git', '-C', str(repo), 'rev-parse', 'HEAD'],
                          check=True, capture_output=True, text=True).stdout.strip()
    (directory / 'task.txt').write_text('Measure the retained log.\n')
    return exe, db, repo, checkouts, base


def replay(args):
    directory = pathlib.Path(args.out)
    directory.mkdir(parents=True, exist_ok=True)
    harness = args.harness
    exe, db, repo, checkouts, base = setup_repo(directory, harness, args)
    player = directory / 'fixture-harness'
    player.write_text('#!' + sys.executable + '\n' + (PLAYER if harness == 'omp' else PLAYER_STDIN))
    player.chmod(0o700)
    shebang_ok(player)
    frames = read_frames(args.frames)
    appended = []
    if harness == 'omp':
        # A direct OMP turn ends on its terminal frame; the retained window is a
        # mid-turn slice, so the turn needs the frame that closes it.
        appended = [json.dumps({'type': 'agent_end', 'isTerminal': True,
                                'messages': [{'role': 'assistant',
                                              'content': [{'type': 'text', 'text': 'complete'}]}]})]
        frames = frames + appended
    events = directory / 'events.jsonl'
    events.write_text('\n'.join(frames) + '\n')
    log = directory / 'turn.jsonl'
    task = directory / 'task.txt'
    coordinates = []

    def coord(*values):
        done = call(exe, db, *values)
        coordinates.append({'argv': [str(value) for value in values], 'returncode': done.returncode,
                            'stdout': done.stdout[:400], 'stderr': done.stderr[:400]})
        if done.returncode != 0:
            raise SystemExit('coordinator command failed: %s %s' % (' '.join(map(str, values)), done.stderr))
        return done.stdout

    coord('attach', 'root', 'native-fixture', 'root-session', 'root-endpoint')
    coord('role', 'root', 'principal-conductor')
    coord('recruit', 'worker', 'root', harness, 'model', 'low', str(repo),
          'worker-branch', str(checkouts / 'worker'), base)
    policy = None
    if args.level:
        coord('logs', 'worker', args.level,
              *([args.budget] if args.budget else []),
              *([args.segments] if args.segments else []))
        policy = json.loads(coord('logs', 'worker'))
    peaks = Peak(directory)
    start = time.monotonic()
    with peaks:
        done = coord('turn', 'worker', 'replay-turn', str(player), 'model', 'low', str(directory),
                     str(task), str(log), '')
    elapsed = time.monotonic() - start
    live = live_logs(log)
    saved = []
    for path in live:
        saved += line_index(path)
    log_bytes = sum(path.stat().st_size for path in live)
    notes = [line for line in saved if '"baton_log_rotation"' in line or '"baton_event_filter"' in line]
    body = [line for line in saved if line not in notes]
    retained, dropped = disposition(frames, body)
    result = {
        'mode': 'replay', 'harness': harness, 'level': args.level,
        'exe': str(exe), 'exe_sha256': sha256(exe),
        'source_revision_supplied': args.source_revision,
        'frames_file': str(args.frames), 'frames_file_sha256': sha256(args.frames),
        'appended_terminal_frames': appended,
        'emitted_bytes': sum(len(line.encode()) + 1 for line in frames),
        'emitted_lines': len(frames),
        'retained_bytes_matched': sum(len(line.encode()) + 1 for line in retained),
        'retained_lines': len(retained), 'dropped_lines': len(dropped),
        'log_bytes': log_bytes,
        'live_log_paths': [str(path) for path in live],
        'note_lines': notes,
        'terminal_report': json.loads(coord('delivery', 'replay-turn'))['body'][:120],
        'by_type': per_type(frames, body),
        'retained_samples': [line[:120] for line in retained[:3]],
        'dropped_samples': [line[:120] for line in dropped[:3]],
        'policy': policy, 'coordinates': coordinates, 'wall_seconds': elapsed,
        'peaks': peaks.files, 'files': walk(directory),
    }
    (directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in
                      ('mode', 'harness', 'level', 'emitted_bytes', 'emitted_lines',
                       'retained_bytes_matched', 'retained_lines', 'dropped_lines', 'log_bytes')}, indent=2),
          flush=True)


def incomplete(args):
    directory = pathlib.Path(args.out)
    directory.mkdir(parents=True, exist_ok=True)
    exe, db, repo, checkouts, base = setup_repo(directory, 'omp', args)
    player = directory / 'fixture-harness'
    events = directory / 'events.jsonl'
    log = directory / 'turn.jsonl'
    task = directory / 'task.txt'
    updates = [json.dumps({'type': 'tool_execution_update', 'toolCallId': 'unfinished', 'toolName': 'bash',
                           'partialResult': {'content': [{'type': 'text', 'text': 'partial %d' % i}]}})
               for i in range(3)]
    messages = [json.dumps({'type': 'message_update', 'messageId': 'unfinished-message',
                            'message': {'id': 'unfinished-message', 'role': 'assistant',
                                        'content': [{'type': 'text', 'text': 'partial answer %d' % i}]}})
                for i in range(3)]
    events.write_text('\n'.join(updates + messages) + '\n')
    player.write_text('#!' + sys.executable + '\n' + '''import os,pathlib,sys,time
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
pathlib.Path('harness.pid').write_text(str(os.getpid()))
sys.stderr.write('stderr diagnostics ' * 1600)
sys.stderr.flush()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
while True: time.sleep(1)
''')
    player.chmod(0o700)
    shebang_ok(player)
    coordinates = []

    def coord(*values):
        done = call(exe, db, *values)
        coordinates.append({'argv': [str(value) for value in values], 'returncode': done.returncode,
                            'stdout': done.stdout[:400], 'stderr': done.stderr[:400]})
        if done.returncode != 0:
            raise SystemExit('coordinator command failed: %s %s' % (' '.join(map(str, values)), done.stderr))
        return done.stdout

    coord('attach', 'root', 'native-fixture', 'root-session', 'root-endpoint')
    coord('role', 'root', 'principal-conductor')
    coord('recruit', 'worker', 'root', 'omp', 'model', 'low', str(repo),
          'worker-branch', str(checkouts / 'worker'), base)
    if args.level:
        coord('logs', 'worker', args.level,
              *([args.budget] if args.budget else []),
              *([args.segments] if args.segments else []))
    candidates = [pathlib.Path(str(log) + '.attempt-' + gen_code('abrupt-turn') + '.pending'),
                  pathlib.Path(str(log) + '.pending')]
    pending = None
    peaks = Peak(directory)

    def checkpoint_ready():
        for path in candidates:
            try:
                text = path.read_text()
            except OSError:
                continue
            if 'partial 2' in text and 'partial answer 2' in text:
                return path
        return None

    with peaks:
        turn = subprocess.Popen([str(exe), str(db), 'turn', 'worker', 'abrupt-turn', str(player),
                                 'model', 'low', str(directory), str(task), str(log), ''],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 90
        while True:
            pending = checkpoint_ready()
            if pending is not None:
                break
            if turn.poll() is not None:
                raise SystemExit('turn stopped before the checkpoint held the newest frame')
            if time.monotonic() > deadline:
                raise SystemExit('checkpoint deadline for %s' % [str(path) for path in candidates])
            time.sleep(0.01)
        pending_bytes = pending.stat().st_size
        pending_lines = pending.read_text().splitlines()
        live_bytes = logs_bytes(log)
        turn.kill()
        turn.wait(timeout=20)
    pid_file = directory / 'harness.pid'
    if pid_file.exists():
        try:
            os.kill(int(pid_file.read_text()), signal.SIGKILL)
        except (ProcessLookupError, ValueError):
            pass
    after_kill = {'pending_bytes': pending.stat().st_size if pending.exists() else 0,
                  'pending_lines': pending.read_text().splitlines() if pending.exists() else [],
                  'log_bytes': logs_bytes(log),
                  'log_lines': logs_lines(log)}
    terminal = json.dumps({'type': 'message_end', 'messageId': 'unfinished-message',
                           'message': {'id': 'unfinished-message', 'role': 'assistant',
                                       'content': [{'type': 'text', 'text': 'restored answer'}]}})
    end = json.dumps({'type': 'agent_end', 'isTerminal': True,
                      'messages': [{'role': 'assistant', 'content': [{'type': 'text', 'text': 'restored answer'}]}]})
    events.write_text(terminal + '\n' + end + '\n')
    player.write_text('#!' + sys.executable + '\n' + PLAYER)
    player.chmod(0o700)
    shebang_ok(player)
    coord('turn', 'worker', 'abrupt-turn', str(player), 'model', 'low', str(directory), str(task),
          str(log), '')
    restored = logs_lines(log)
    restored_frames = []
    for line in restored:
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            restored_frames.append(value)
    result = {
        'mode': 'incomplete', 'exe': str(exe), 'exe_sha256': sha256(exe),
        'source_revision_supplied': args.source_revision, 'level': args.level,
        'checkpoint_peak_bytes': pending_bytes,
        'checkpoint_held': [line[:120] for line in pending_lines],
        'live_log_bytes_before_kill': live_bytes,
        'after_kill': after_kill,
        'restored_lines': [line[:120] for line in restored],
        'restored_holds_held_update': any(value.get('type') == 'tool_execution_update'
                                          and value.get('toolCallId') == 'unfinished'
                                          for value in restored_frames),
        'restored_holds_held_message': any(value.get('type') == 'message_update'
                                           and value.get('messageId') == 'unfinished-message'
                                           for value in restored_frames),
        'checkpoint_path': str(pending),
        'checkpoint_removed_after_restore': not pending.exists(),
        'peaks': peaks.files, 'coordinates': coordinates, 'files': walk(directory),
    }
    (directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({key: result[key] for key in
                      ('mode', 'checkpoint_peak_bytes', 'checkpoint_held', 'live_log_bytes_before_kill',
                       'restored_holds_held_update', 'restored_holds_held_message',
                       'checkpoint_removed_after_restore')}, indent=2), flush=True)


def inventory(args):
    directory = pathlib.Path(args.out)
    rows = walk(directory)
    grouped = classify(directory, rows)
    result = {'mode': 'inventory', 'directory': str(directory), 'files': rows,
              'classification': grouped, 'tables': table_sizes(args.db)}
    storage = call(pathlib.Path(args.exe), args.db, 'logs-storage')
    result['storage'] = json.loads(storage.stdout) if storage.returncode == 0 else {'error': storage.stderr}
    (directory / 'inventory.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'mode': 'inventory', 'totals': grouped['totals']}, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['batches', 'replay', 'incomplete', 'inventory'])
    parser.add_argument('--exe', type=pathlib.Path, required=True)
    parser.add_argument('--out', type=pathlib.Path, required=True)
    parser.add_argument('--source-revision')
    parser.add_argument('--level', choices=['default', 'quiet', 'diagnostic'])
    parser.add_argument('--budget')
    parser.add_argument('--segments')
    parser.add_argument('--count', type=int, default=1000)
    parser.add_argument('--step', type=int, default=51)
    parser.add_argument('--task-frames', type=pathlib.Path)
    parser.add_argument('--omp-window', type=pathlib.Path)
    parser.add_argument('--frames', type=pathlib.Path)
    parser.add_argument('--harness', choices=['omp', 'codex', 'muse', 'claude'], default='omp')
    parser.add_argument('--repeat', type=int, default=1)
    parser.add_argument('--accumulate', type=int, help='pad bytes per unclassified response frame')
    parser.add_argument('--accumulate-frames', type=int, default=200)
    parser.add_argument('--stderr-bytes', type=int, default=0)
    parser.add_argument('--db')
    args = parser.parse_args()
    {'batches': batches, 'replay': replay, 'incomplete': incomplete, 'inventory': inventory}[args.mode](args)


if __name__ == '__main__':
    main()
