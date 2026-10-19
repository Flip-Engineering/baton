"""Replay the copied retained-output fixture through the observer checkpoint rules.

The fixture directory is data only: a BATONC03 checkpoint record and the stdout
spool it was bound to.  The copied checkpoint binds the source spool device and
inode, so it is never loaded as live custody here.  This harness parses the
record, replays the spool from the durable byte offset, and applies the
retained-output write rules with a positioned writer that keeps equal bytes
already present.  It is an offline regression for the checkpoint decision and
the replay/truncation contract, not a coordinator run.

The frame step and the compact terminal projection are modelled from
coordinator/logs.bend.  Frame boundaries, the durable byte offset, the output
position and the terminal payload bytes come from the fixture.  The default
log level is the main model; the diagnostic level is used only for the bounded
per-frame rate check.
"""
import os
import argparse
import hashlib
import json
import re
import pathlib
import resource
import struct
import sys
import tempfile
import time
import tracemalloc
import unittest

DEFAULT_FIXTURE = pathlib.Path(
    '/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/recovery-output-fixture-20261018')
CHECKPOINT_MAGIC = b'BATONC03'
CHECKPOINT_HEADER = struct.Struct('<8sII8Q i4xQQ')
STATE_FIELDS = (
    'guidance_cursor', 'last_message', 'muse_primary', 'muse_current',
    'terminal', 'filter_mode', 'codex_log', 'held', 'omp_activity',
    'output', 'output_done', 'episode',
)
DIGEST = hashlib.blake2b


def digest(value):
    return DIGEST(value, digest_size=8).hexdigest()


def fnv1a64(chunks):
    value = 0xcbf29ce484222325
    for chunk in chunks:
        for byte in chunk:
            value ^= byte
            value = (value * 0x100000001b3) & 0xFFFFFFFFFFFFFFFF
    return value


def hash_file(path):
    found = hashlib.sha256()
    with open(path, 'rb') as stream:
        while True:
            chunk = stream.read(1 << 20)
            if not chunk:
                return found.hexdigest()
            found.update(chunk)


def file_size(path):
    return os.stat(path).st_size

def parse_checkpoint(path):
    data = pathlib.Path(path).read_bytes()
    if len(data) < CHECKPOINT_HEADER.size:
        raise ValueError('checkpoint record is shorter than its header')


    (magic, schema, expected_set, incarnation, attempt, manifest,
     spool_device, spool_inode, offset, length, check,
     birth_pid, birth_first, birth_second) = CHECKPOINT_HEADER.unpack_from(data)
    if magic != CHECKPOINT_MAGIC:
        raise ValueError('checkpoint magic is not BATONC03')
    if len(data) != CHECKPOINT_HEADER.size + length:
        raise ValueError('checkpoint payload length does not match the record size')
    state_bytes = data[CHECKPOINT_HEADER.size:]
    recomputed = fnv1a64((data[:72], data[80:CHECKPOINT_HEADER.size], state_bytes))
    state = json.loads(state_bytes)
    if not isinstance(state, dict):
        raise ValueError('checkpoint payload is not a JSON object')
    missing = [field for field in STATE_FIELDS if field not in state]
    if missing:
        raise ValueError('checkpoint payload is missing fields: ' + ','.join(missing))
    return {
        'path': pathlib.Path(path),
        'schema': schema,
        'expected_set': expected_set,
        'birth_pid': birth_pid,
        'birth_first': birth_first,
        'birth_second': birth_second,
        'incarnation': incarnation,
        'attempt': attempt,
        'manifest': manifest,
        'spool_device': spool_device,
        'spool_inode': spool_inode,
        'offset': offset,
        'length': length,
        'check': check,
        'recomputed_check': recomputed,
        'state': state,
    }


def checkpoint_due_fields(previous, next_state, message_enabled=True,
                          terminal_enabled=True, codex_enabled=False,
                          include_output=False):
    """The observer predicate from coordinator/observer-checkpoint.bend."""
    def changed(field):
        return previous.get(field, '') != next_state.get(field, '')

    terms = [
        changed('episode'),
        changed('guidance_cursor'),
        message_enabled and changed('last_message'),
        changed('omp_activity'),
        changed('muse_primary'),
        changed('muse_current'),
        terminal_enabled and changed('terminal'),
        changed('filter_mode'),
        codex_enabled and changed('codex_log'),
    ]
    if include_output:
        terms.append(changed('output'))
    return any(terms)


def held_text(entries):
    return '\n'.join('%s\t%s\t%s' % (kind, identity, line) for kind, identity, line in entries)


def parse_held(text):
    entries = []
    if not text:
        return entries
    for row in text.split('\n'):
        fields = row.split('\t', 2)
        if len(fields) == 3:
            entries.append((fields[0], fields[1], fields[2]))
    return entries


def held_put(entries, kind, identity, line):
    kept = [entry for entry in entries
            if not (entry[0] == kind and entry[1] == identity)]
    return [(kind, identity, line)] + kept


def held_drop(entries, kind, identity):
    return [entry for entry in entries
            if not (entry[0] == kind and entry[1] == identity)]


def held_lines(entries, kind, identity):
    return [line for entry_kind, entry_id, line in entries
            if entry_kind == kind and entry_id == identity]


TYPE_PATTERN = re.compile(rb'"type"\s*:\s*"([^"]{0,64})"')
ID_MARKERS = (b'"toolCallId"', b'"messageId"', b'"message"')


def frame_kind(raw):
    match = TYPE_PATTERN.search(raw[:512])
    if match is None:
        return '', None
    kind = match.group(1).decode('utf-8', 'replace')
    if kind in ('message_start', 'message_end'):
        value = json.loads(raw)
    elif kind in ('message_update', 'tool_execution_update'):
        value = json.loads(raw) if any(marker in raw for marker in ID_MARKERS) else None
    elif kind == 'tool_execution_end':
        value = json.loads(raw)
    else:
        value = None
    return kind, value


def frame_id(value, kind):
    if value is None:
        return ''
    for name in ('toolCallId', 'messageId'):
        found = value.get(name)
        if found:
            return str(found)
    message = value.get('message')
    if isinstance(message, dict):
        found = message.get('id')
        if found:
            return str(found)
    if kind in ('message_start', 'message_update', 'message_end'):
        return 'omp-open-message'
    if isinstance(message, dict):
        found = message.get('responseId')
        if found:
            return str(found)
    event = value.get('assistantMessageEvent')
    if isinstance(event, dict):
        partial = event.get('partial')
        if isinstance(partial, dict):
            found = partial.get('responseId')
            if found:
                return str(found)
    return ''


def terminal_kind(kind):
    return kind in ('agent_end', 'turn_end')


def frame_step(level, kind, identity, line, held):
    """Return (lines written now, held entries) for the default log policy."""
    def step_prefix(identified):
        if identified:
            return [], held_put(held, kind, identity, line)
        return [line], held

    def step_message_end(end):
        if end:
            return [line], held_drop(held_drop(held, 'message_start', identity), 'message_update', identity)
        return [line], held

    def step_tool_end(end):
        if end:
            return held_lines(held, 'tool_execution_update', identity) + [line], held_drop(held, 'tool_execution_update', identity)
        return step_message_end(kind == 'message_end')

    def step_snapshot(snapshot):
        if snapshot:
            return step_prefix(identity != '')
        return step_tool_end(kind == 'tool_execution_end')

    def step_start(start):
        if start:
            return step_prefix(identity != '')
        return step_snapshot(kind == 'message_update')

    def step_update(update):
        if update:
            return step_prefix(identity != '')
        return step_start(kind == 'message_start')

    if level == 'diagnostic':
        return [line], held
    if level == 'quiet':
        if terminal_kind(kind) or not kind:
            return [line], held
        return [], held
    if kind == 'codex_command_end':
        return [line], held_drop(held, 'codex_command_start', identity)
    if kind == 'codex_command_start':
        return step_prefix(identity != '')
    return step_update(kind == 'tool_execution_update')


def projected_line(kind, line, level):
    """The compact terminal projection is modelled; other lines stay verbatim."""
    if terminal_kind(kind) and level != 'diagnostic':
        return '{"type":"%s","compact_bytes":%d}' % (kind, len(line))
    return line




class PositionedWriter:
    """write_batch_at semantics: compare existing bytes, write the suffix."""

    def __init__(self, path, position):
        self.path = str(path)
        self.fd = os.open(self.path, os.O_RDWR | os.O_CREAT, 0o600)
        self.position = int(position)
        self.compared = 0
        self.equal = 0
        self.written = 0

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.close()

    def write(self, line):
        data = line.encode('utf-8', 'replace') if isinstance(line, str) else line
        data += b'\n'
        size = os.fstat(self.fd).st_size
        available = size - self.position if self.position < size else 0
        overlap = min(available, len(data))
        same = 0
        while same < overlap:
            wanted = min(overlap - same, 8192)
            existing = os.pread(self.fd, wanted, self.position + same)
            if not existing:
                break
            equal = 0
            while equal < len(existing) and existing[equal] == data[same + equal]:
                equal += 1
            same += equal
            self.compared += len(existing)
            self.equal += equal
            if equal != len(existing):
                break
        if same < len(data):
            offset = same
            while offset < len(data):
                count = os.pwrite(self.fd, data[offset:], self.position + offset)
                if count <= 0:
                    raise OSError('positioned write made no progress')
                offset += count
                self.written += count
        self.position += len(data)

    def finish(self):
        os.ftruncate(self.fd, self.position)


def prefill(path, length, pattern=b'retained-output-prefix\n'):
    with open(path, 'wb') as stream:
        remaining = length
        block = pattern * ((1 << 20) // len(pattern) + 1)
        while remaining:
            chunk = block[:remaining]
            stream.write(chunk)
            remaining -= len(chunk)


def serialized_state(state, held):
    payload = {field: state.get(field, '') for field in STATE_FIELDS}
    payload['held'] = held_text(held)
    payload['output_done'] = bool(state.get('output_done', False))
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')


def replay(spool_path, output_path, checkpoint, level='default', include_output=False,
           finish=True, crash_after_frames=None, limit_frames=None,
           measure_memory=False, state=None, held=None, start_offset=None,
           start_output=None, prefill_output=False):
    """Replay the spool and return the observed checkpoint/write counters."""
    if state is None:
        state = dict(checkpoint['state'])
        state['_offset'] = checkpoint['offset']
        state['_sealed'] = False
    else:
        state = dict(state)
    if held is None:
        held = list(state.get('_held', parse_held(state.get('held', ''))))
    if start_offset is None:
        start_offset = state.get('_offset', checkpoint['offset'])
    if start_output is None:
        start_output = int(state.get('output', '0') or '0')
    if prefill_output:
        prefill(output_path, start_output)

    started = time.perf_counter()
    if measure_memory:
        tracemalloc.start()
        baseline_traced = tracemalloc.get_traced_memory()[0]

    frames = 0
    semantic_changes = 0
    output_writes = 0
    output_only = 0
    candidate_due = 0
    parent_due = 0
    checkpoint_bytes = 0
    max_snapshot = 0
    final_commits = 0
    crashed = False
    durable = dict(state)
    durable['_held'] = list(held)

    with PositionedWriter(output_path, start_output) as writer, open(spool_path, 'rb') as stream:
        stream.seek(start_offset)
        for raw in stream:
            frames += 1
            offset_after = stream.tell()
            kind, value = frame_kind(raw.rstrip(b'\n'))
            identity = frame_id(value, kind)
            line = raw.rstrip(b'\n').decode('utf-8', 'replace')

            lines, held = frame_step(level, kind, identity, line, held)
            for item in lines:
                writer.write(item)
            output_writes += 1 if lines else 0

            next_state = dict(state)
            next_state['output'] = str(writer.position)
            terminal_selected = kind == 'agent_end' and not next_state.get('_sealed', False)
            if kind == 'message_end':
                next_state['last_message'] = digest(raw)
            if kind in ('message_start', 'message_end'):
                next_state['omp_activity'] = digest(raw)
            if kind == 'response':
                next_state['filter_mode'] = digest(raw)
            if terminal_selected:
                next_state['terminal'] = projected_line(kind, line, level)
                next_state['_sealed'] = True
            next_state['_offset'] = offset_after

            semantic = checkpoint_due_fields(state, next_state,
                                             message_enabled=kind == 'message_end',
                                             terminal_enabled=terminal_selected,
                                             codex_enabled=False,
                                             include_output=False)
            parent = checkpoint_due_fields(state, next_state,
                                           message_enabled=kind == 'message_end',
                                           terminal_enabled=terminal_selected,
                                           codex_enabled=False,
                                           include_output=True)
            if semantic:
                semantic_changes += 1
            elif lines:
                output_only += 1
            committed = parent if include_output else semantic
            if semantic:
                candidate_due += 1
            if parent:
                parent_due += 1

            if committed:
                payload = serialized_state(next_state, held)
                checkpoint_bytes += len(payload)
                max_snapshot = max(max_snapshot, len(payload))
                durable = dict(next_state)
                durable['_held'] = list(held)
            state = next_state

            if crash_after_frames is not None and frames >= crash_after_frames:
                crashed = True
                break
            if limit_frames is not None and frames >= limit_frames:
                break

        if not crashed and finish and (limit_frames is None or frames < limit_frames):
            for entry in held:
                writer.write(entry[2])
            held = []
            writer.finish()
            final_commits = 1
            final_state = dict(state)
            final_state['output_done'] = True
            final_state['output'] = str(writer.position)
            payload = serialized_state(final_state, held)
            checkpoint_bytes += len(payload)
            max_snapshot = max(max_snapshot, len(payload))
            durable = dict(final_state)
            durable['_held'] = []
            state = final_state

    elapsed = time.perf_counter() - started
    traced_peak = 0
    if measure_memory:
        traced_peak = tracemalloc.get_traced_memory()[1] - baseline_traced
        tracemalloc.stop()

    return {
        'frames': frames,
        'semantic_changes': semantic_changes,
        'output_writes': output_writes,
        'output_only': output_only,
        'candidate_due': candidate_due,
        'parent_due': parent_due,
        'checkpoint_bytes': checkpoint_bytes,
        'max_snapshot': max_snapshot,
        'final_commits': final_commits,
        'durable': durable,
        'output_position': writer.position,
        'compared': writer.compared,
        'equal': writer.equal,
        'written': writer.written,
        'crashed': crashed,
        'elapsed': elapsed,
        'traced_peak': traced_peak,
        'rss_kb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
    }


def custody_matches(checkpoint, spool_path):
    info = os.stat(spool_path)
    return (info.st_dev == checkpoint['spool_device'] and
            info.st_ino == checkpoint['spool_inode'])


def recover(checkpoint, spool_path, attempt_directory):
    """Model the host restore decision without loading the copied checkpoint."""
    if not custody_matches(checkpoint, spool_path):
        return {
            'custody': 'mismatch',
            'status': 'unknown',
            'output_done': False,
            'ack': None,
            'replay_from': 0,
        }
    if not (pathlib.Path(attempt_directory) / 'native.birth').exists():
        return {
            'custody': 'unknown',
            'status': 'unknown',
            'output_done': False,
            'ack': None,
            'replay_from': 0,
        }
    return {
        'custody': 'matched',
        'status': 'unknown',
        'output_done': bool(checkpoint['state'].get('output_done', False)),
        'ack': None,
        'replay_from': checkpoint['offset'],
    }


class RetainedOutputCheckpoint(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        fixture = pathlib.Path(os.environ.get('BATON_RECOVERY_OUTPUT_FIXTURE', DEFAULT_FIXTURE))
        if not fixture.is_dir():
            raise unittest.SkipTest('retained-output fixture is absent: %s' % fixture)
        cls.fixture = fixture
        cls.spool = fixture / 'stdout.bin'
        cls.checkpoint_path = fixture / 'checkpoint.bin'
        cls.checkpoint = parse_checkpoint(cls.checkpoint_path)
        cls.temp = tempfile.TemporaryDirectory(prefix='retained-output-checkpoint-')
        cls.baseline = pathlib.Path(cls.temp.name) / 'baseline.bin'
        cls.baseline_metrics = replay(
            cls.spool, cls.baseline, cls.checkpoint, finish=True, prefill_output=True)
        cls.baseline_size = file_size(cls.baseline)
        cls.baseline_hash = hash_file(cls.baseline)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def setUp(self):
        self.work = pathlib.Path(tempfile.mkdtemp(prefix='retained-output-case-', dir=self.temp.name))

    def copy_baseline(self, name):
        target = self.work / name
        with open(self.baseline, 'rb') as source, open(target, 'wb') as sink:
            while True:
                chunk = source.read(1 << 20)
                if not chunk:
                    break
                sink.write(chunk)
        return target

    def test_fixture_hashes_and_record_bindings(self):
        sums = {}
        for row in (self.fixture / 'SHA256SUMS').read_text().splitlines():
            found, name = row.split()
            sums[name] = found
        self.assertEqual(hash_file(self.spool), sums['stdout.bin'])
        self.assertEqual(hash_file(self.checkpoint_path), sums['checkpoint.bin'])
        self.assertEqual(self.checkpoint['schema'], 1)
        self.assertEqual(self.checkpoint['spool_device'], 2050)
        self.assertEqual(self.checkpoint['spool_inode'], 38067277)
        self.assertEqual(self.checkpoint['offset'], 17430778)
        self.assertEqual(self.checkpoint['length'], 1051759)
        self.assertEqual(self.checkpoint['check'], self.checkpoint['recomputed_check'])
        self.assertEqual(self.checkpoint['state']['output'], '15418859')
        self.assertEqual(len(self.checkpoint['state']['terminal']), 997411)
        self.assertFalse(self.checkpoint['state']['output_done'])
        self.assertEqual(self.checkpoint['state']['held'], '')
        self.assertFalse(custody_matches(self.checkpoint, self.spool),
                         'the copied checkpoint must bind the source spool identity')

    def test_unknown_custody_does_not_report_completion_or_ack(self):
        attempt = self.work / 'attempt'
        attempt.mkdir()
        decision = recover(self.checkpoint, self.spool, attempt)
        self.assertEqual(decision['custody'], 'mismatch')
        self.assertEqual(decision['status'], 'unknown')
        self.assertFalse(decision['output_done'])
        self.assertIsNone(decision['ack'])
        self.assertEqual(decision['replay_from'], 0)
        self.assertEqual(sorted(path.name for path in attempt.iterdir()), [])

    def test_output_progress_is_not_a_checkpoint_but_semantic_progress_is(self):
        metrics = self.baseline_metrics
        self.assertEqual(metrics['candidate_due'], metrics['semantic_changes'])
        self.assertEqual(metrics['parent_due'], metrics['semantic_changes'] + metrics['output_only'])
        self.assertGreater(metrics['semantic_changes'], 0)
        self.assertGreater(metrics['output_only'], 0)
        self.assertLess(metrics['candidate_due'], metrics['parent_due'])
        self.assertLess(metrics['frames'], 260200)

        bounded = replay(self.spool, self.work / 'diagnostic.bin', self.checkpoint,
                         level='diagnostic', finish=False, limit_frames=4000,
                         prefill_output=True)
        self.assertEqual(bounded['parent_due'], bounded['frames'])
        self.assertLess(bounded['candidate_due'], bounded['parent_due'])

    def test_crash_resume_from_the_earlier_durable_offset(self):
        crashed = self.work / 'crashed.bin'
        first = replay(self.spool, crashed, self.checkpoint, finish=False,
                       crash_after_frames=20000, prefill_output=True)
        self.assertTrue(first['crashed'])
        self.assertGreater(first['durable']['_offset'], self.checkpoint['offset'])
        self.assertLess(first['durable']['_offset'], file_size(self.spool))
        resumed = replay(self.spool, crashed, self.checkpoint, finish=True,
                         state=first['durable'], held=first['durable']['_held'],
                         start_offset=first['durable']['_offset'],
                         start_output=int(first['durable']['output']))
        self.assertEqual(file_size(crashed), self.baseline_size)
        self.assertEqual(hash_file(crashed), self.baseline_hash)
        self.assertLess(resumed['frames'], self.baseline_metrics['frames'])

    def test_partial_replay_preserves_the_existing_output_prefix(self):
        whole = self.copy_baseline('whole.bin')
        prefixes = replay(self.spool, whole, self.checkpoint, finish=True)
        self.assertEqual(prefixes['written'], 0)
        self.assertGreater(prefixes['equal'], 0)

        partial = self.copy_baseline('partial.bin')
        keep = int(self.checkpoint['state']['output']) + max(1, (self.baseline_size - int(self.checkpoint['state']['output'])) // 2)
        os.truncate(partial, keep)
        before = hash_file(partial)
        resumed = replay(self.spool, partial, self.checkpoint, finish=True)
        with open(partial, 'rb') as stream:
            self.assertEqual(hashlib.sha256(stream.read(keep)).hexdigest(), before)
        self.assertGreater(resumed['written'], 0)
        self.assertEqual(file_size(partial), self.baseline_size)
        self.assertEqual(hash_file(partial), self.baseline_hash)

    def test_final_output_truncation_removes_a_stale_tail(self):
        target = self.copy_baseline('truncate.bin')
        with open(target, 'ab') as stream:
            stream.write(b'stale-tail\n' * 100000)
        replay(self.spool, target, self.checkpoint, finish=True)
        self.assertEqual(file_size(target), self.baseline_size)
        self.assertEqual(hash_file(target), self.baseline_hash)

    def test_replay_memory_does_not_accumulate_terminal_copies(self):
        measured = subprocess_measure(self.fixture)
        payload = measured['payload_size']
        self.assertGreater(payload, 1_000_000)
        self.assertGreater(measured['max_snapshot'], 1_000_000)
        self.assertLessEqual(measured['max_snapshot'], payload)
        self.assertLess(measured['traced_peak'], 16 * payload)
        self.assertLess(measured['rss_kb'], 524288)
        self.assertLess(measured['elapsed'], 60.0)
        self.assertEqual(measured['candidate_due'], measured['semantic_changes'])
        print(json.dumps(measured, sort_keys=True))


def subprocess_measure(fixture):
    import subprocess
    completed = subprocess.run(
        [sys.executable, str(pathlib.Path(__file__).resolve()), '--measure',
         '--fixture', str(fixture)],
        capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        raise AssertionError(completed.stdout + completed.stderr)
    return json.loads(completed.stdout)


def measure(fixture):
    checkpoint = parse_checkpoint(pathlib.Path(fixture) / 'checkpoint.bin')
    spool = pathlib.Path(fixture) / 'stdout.bin'
    with tempfile.TemporaryDirectory(prefix='retained-output-measure-') as name:
        output = pathlib.Path(name) / 'output.bin'
        metrics = replay(spool, output, checkpoint, finish=True,
                         prefill_output=True, measure_memory=True)
        payload = serialized_state(checkpoint['state'], parse_held(checkpoint['state']['held']))
        metrics['payload_size'] = len(payload)
        metrics['output_size'] = file_size(output)
        metrics['output_sha256'] = hash_file(output)
        metrics.pop('durable', None)
        return metrics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--measure', action='store_true')
    parser.add_argument('--fixture', type=pathlib.Path, default=DEFAULT_FIXTURE)
    args, remaining = parser.parse_known_args()
    if args.measure:
        print(json.dumps(measure(args.fixture), sort_keys=True))
        return 0
    os.environ['BATON_RECOVERY_OUTPUT_FIXTURE'] = str(args.fixture)
    unittest.main(argv=[sys.argv[0]] + remaining)
    return 0


if __name__ == '__main__':
    sys.exit(main())
