import json
import hashlib
import os
import select
import shutil
import subprocess
import pathlib
import sys
import time
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import receive

candidate = os.environ.get('BATON_CANDIDATE')
if candidate:
    receive.EXE = pathlib.Path(os.environ.get('BATON_TEST_WRAPPER', candidate))


def _rss_bytes(child):
    status = pathlib.Path(f'/proc/{child.pid}/status').read_text()
    value = next(line.split()[1] for line in status.splitlines() if line.startswith('VmRSS:'))
    return int(value) * 1024


def _checkpoint_covers_spool(checkpoint, minimum_spool_offset):
    if not checkpoint.is_file():
        return False
    record = checkpoint.read_bytes()
    if len(record) < 104 or record[:8] != b"BATONC03":
        return False
    state_at = record.find(b"{\"schema\":1,", 104)
    if state_at < 104:
        return False
    try:
        state = json.loads(record[state_at:])
        checkpoint_offset = int.from_bytes(record[56:64], "little")
        return checkpoint_offset >= minimum_spool_offset and isinstance(state.get("output"), str)
    except (KeyError, TypeError, ValueError, OSError):
        return False

def _checkpoint_offset(checkpoint):
    record = checkpoint if isinstance(checkpoint, (bytes, bytearray)) else checkpoint.read_bytes()
    if len(record) < 64 or record[:8] != b"BATONC03":
        return None
    return int.from_bytes(record[56:64], "little")


class MemoryGateTests(receive.Receive):
    def eventually(self, observation, description, timeout=30):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            last = observation()
            if last:
                return last
            time.sleep(.01)
        self.fail(f'{description} (timed out after {timeout}s; last observation={last!r})')

    def finish_bounded(self, child, ok=True, timeout=60):
        try:
            stdout, stderr = child.communicate(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            self.fail(f"receiver did not finish within {timeout}s; stdout={error.output!r}; stderr={error.stderr!r}")
        if ok:
            self.assertEqual(child.returncode, 0, stderr)
        else:
            self.assertNotEqual(child.returncode, 0, stdout)
        return stdout, stderr

    def accept_bounded(self, child, session, timeout=30):
        deadline = time.monotonic() + timeout
        while True:
            if select.select([self.server], [], [], 0)[0]:
                return self.accept(session)
            code = child.poll()
            if code is not None:
                stdout, stderr = child.communicate()
                self.fail(f"receiver exited {code} before native connect\nstdout={stdout}\nstderr={stderr}")
            if time.monotonic() >= deadline:
                self.fail(f"receiver did not connect within {timeout}s; child remains alive")
            time.sleep(.01)

    def test_repeated_semantic_checkpoints_keep_one_latest_open_frame(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('repeat-checkpoint-task', 'parent',
                           'Keep the original input while checking repeated semantic checkpoints.',
                           kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_bounded(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original OMP identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        attempt = pathlib.Path(self.execution('parent')[2])
        checkpoint = attempt / 'checkpoint'
        raw_output = attempt / 'stdout'
        payload_bytes = 2 * 1024 * 1024
        payload = 's' * payload_bytes
        self.action(control, stdout_fragment=json.dumps({
            'type': 'message_start',
            'message': {'id': 'held-stream', 'role': 'assistant', 'content': []},
        }) + '\n')
        self.assertIn('fragment_written', json.loads(control.readline()))
        checkpoint_sizes = []
        held_sizes = []
        rss_samples = [_rss_bytes(observer)]
        previous_checkpoint = b''
        for index in range(8):
            frame = json.dumps({
                'type': 'message_update',
                'message': {'id': 'held-stream', 'role': 'assistant',
                            'content': [{'type': 'text', 'text': payload}]},
                'assistantMessageEvent': {'partial': {'type': 'text', 'text': payload}},
            })
            self.action(control, stdout_fragment=frame + '\n')
            self.assertIn('fragment_written', json.loads(control.readline()))
            update_end = raw_output.stat().st_size
            marker = f'repeat-checkpoint-{index}'
            self.action(control, emit_checkpoint_message=marker)
            self.assertEqual(json.loads(control.readline()),
                             {'checkpoint_message_written': marker})
            self.eventually(lambda: checkpoint.is_file() and
                            checkpoint.read_bytes() != previous_checkpoint,
                            f'Checkpoint {index} was not durably advanced.')
            self.eventually(lambda: _checkpoint_covers_spool(checkpoint, update_end),
                            f'Checkpoint {index} did not consume the emitted update ending at {update_end}.')
            record = checkpoint.read_bytes()
            checkpoint_offset = int.from_bytes(record[56:64], "little")
            state_at = record.find(bytes([123,34])+b"schema"+bytes([34,58,49,44]), 104)
            self.assertGreaterEqual(state_at, 0, 'Checkpoint has no schema-1 observer state.')
            state = json.loads(record[state_at:])
            held = state['held']
            evidence = os.environ.get('BATON_EVIDENCE_DIR')
            if evidence:
                evidence_path = pathlib.Path(evidence)
                evidence_path.mkdir(parents=True, exist_ok=True)
                shutil.copy2(checkpoint, evidence_path / f'checkpoint-{index}.bin')
                (evidence_path / f'held-{index}.txt').write_text(held)
                shutil.copy2(raw_output, evidence_path / f'stdout-{index}.bin')
            self.assertIn('held-stream', held,
                          'Checkpoint omitted the latest open message frame.')
            rows = held.split('\n') if held else []
            parsed = []
            for row in rows:
                fields = row.split('\t', 2)
                self.assertEqual(len(fields), 3,
                                 f'Held checkpoint row is malformed: {row[:256]!r}')
                parsed.append((fields[0], fields[1]))
            self.assertEqual(len(parsed), len(set(parsed)),
                             f'Held projection contains duplicate (kind,id) rows: {parsed!r}')
            self.assertEqual(parsed.count(('message_update', 'held-stream')), 1,
                             f'Expected exactly one latest message_update for held-stream; parsed={parsed!r}.')
            self.assertEqual(parsed.count(('message_start', 'held-stream')), 1,
                             f'Expected exactly one open message_start for held-stream; parsed={parsed!r}.')
            held_sizes.append(len(held.encode()))
            checkpoint_sizes.append(len(record))
            rss_samples.append(_rss_bytes(observer))
            previous_checkpoint = record
            print(json.dumps({'checkpointIndex': index,
                              'checkpointBytes': checkpoint_sizes[-1],
                              'heldProjectionBytes': held_sizes[-1],
                              'observerRssBytes': rss_samples[-1],
                              'consumedSpoolOffset': checkpoint_offset,
                              'emittedUpdateEnd': update_end,
                              'publicOutputPosition': state['output'].strip(),
                              'rssGrowthBytes': max(rss_samples) - rss_samples[0]}), flush=True)
        self.assertLess(max(checkpoint_sizes) - min(checkpoint_sizes), 256 * 1024,
                        'Checkpoint storage grew with prior superseded frames.')
        self.assertLess(max(held_sizes) - min(held_sizes), 256 * 1024,
                        'Held projection retained prior versions of the same open message.')
        self.assertLess(max(rss_samples) - rss_samples[0], 768 * 1024 * 1024,
                        'Observer RSS grew beyond the receive-memory acceptance limit.')
        end_frame = {'type': 'message_end',
                     'message': {'id': 'held-stream', 'role': 'assistant',
                                 'content': [{'type': 'text', 'text': payload}]}}
        self.action(control, stdout_fragment=json.dumps(end_frame) + '\n')
        self.assertIn('fragment_written', json.loads(control.readline()))
        self.action(control, body='Repeated checkpoint stream completed.', hold_exit=True)
        self.assertEqual(json.loads(control.readline()), {'terminal_written': True})
        self.action(control, exit_fixture=True, complete_task=True)
        self.assertEqual(control.readline(), b'')
        self.finish_bounded(observer)
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)

    def test_valid_unterminated_agent_end_is_consumed_at_eof(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('partial-eof-task', 'parent',
                           'Preserve the task while consuming the final unterminated frame.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_bounded(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original OMP identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        log = self.output_log('parent')
        frame = json.dumps({'type': 'agent_end', 'isTerminal': True,
                            'messages': [{'role': 'assistant', 'content': [
                                {'type': 'text', 'text': 'final partial frame'}]}]})
        self.action(control, stdout_fragment=frame)
        self.assertEqual(json.loads(control.readline()), {'fragment_written': frame})
        self.action(control, exit_fixture=True)
        self.assertEqual(control.readline(), b'')
        self.finish_bounded(observer)
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        self.assertIn('final partial frame', log.read_text(errors='replace'))

    def test_checkpoint_write_failure_stops_read_and_preserves_input(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('checkpoint-failure-task', 'parent',
                           'Keep this input pending if a durable checkpoint write fails.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_bounded(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original OMP identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        attempt = pathlib.Path(self.execution('parent')[2])
        checkpoint = attempt / 'checkpoint'
        log = self.output_log('parent')
        raw_output = attempt / 'stdout'
        self.action(control, emit_checkpoint_message='initial-durable-marker')
        self.assertEqual(json.loads(control.readline()),
                         {'checkpoint_message_written': 'initial-durable-marker'})
        self.eventually(lambda: checkpoint.is_file() and raw_output.is_file(),
                        'The initial durable checkpoint was not created.')
        checkpoint_before = checkpoint.read_bytes()
        backup = attempt / 'checkpoint.saved-for-test'
        checkpoint.rename(backup)
        checkpoint.mkdir()
        try:
            failed_marker = 'checkpoint-write-failure-marker'
            self.action(control, emit_checkpoint_message=failed_marker)
            self.assertEqual(json.loads(control.readline()),
                             {'checkpoint_message_written': failed_marker})
            later_marker = 'frame-after-checkpoint-failure'
            self.action(control, progress=later_marker)
            self.assertEqual(json.loads(control.readline()), {'progress_written': later_marker})
            self.action(control, exit_fixture=True)
            self.assertEqual(control.readline(), b'')
            stdout, stderr = self.finish_bounded(observer, ok=False)
            self.assertTrue(stdout or stderr, 'The injected checkpoint write failure was not reported.')
            self.assertEqual(backup.read_bytes(), checkpoint_before,
                             'A failed checkpoint changed the last durable checkpoint.')
            self.assertFalse((attempt / 'acknowledged').exists(),
                             'Checkpoint failure acknowledged the retained attempt.')
            self.assertIsNone(self.coord('delivery', 'checkpoint-failure-task')['receipt'],
                              'Checkpoint failure acknowledged its input.')
            self.assertEqual([message['id'] for message in self.coord('inbox', 'parent')],
                             ['checkpoint-failure-task'])
            self.assertEqual(self.coord('player', 'parent')['native'], native_id)
            log_text = log.read_text(errors='replace') if log.exists() else ''
            self.assertNotIn(later_marker, log_text,
                             'Observer read and published a later frame after checkpoint failure.')
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and later_marker.encode() not in raw_output.read_bytes():
                time.sleep(.05)
            self.assertIn(later_marker.encode(), raw_output.read_bytes(),
                          'The native spool did not preserve the later unconsumed frame.')
        finally:
            if checkpoint.is_dir():
                checkpoint.rmdir()
            if backup.exists():
                backup.rename(checkpoint)


    def test_direct_omp_keeps_record_separator_provider_line_raw(self):
        self.player(harness='omp')
        provider = self.directory / 'us-provider.py'
        provider.write_text('#!' + sys.executable + '\n' + '''import json,sys
request=json.loads(sys.stdin.readline())
state=json.loads(sys.stdin.readline())
prompt=json.loads(sys.stdin.readline())['message']
print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':'us-direct-native'}}),flush=True)
print('\\x1eprovider-raw-line',flush=True)
print(json.dumps({'type':'agent_end','isTerminal':True,'messages':[{'role':'assistant','content':[{'type':'text','text':'done'}]}]}),flush=True)
assert sys.stdin.read()==''
''')
        provider.chmod(0o755)
        log = self.directory / 'us-direct.jsonl'
        task = self.directory / 'us-direct-task.txt'
        task.write_text('Keep this direct provider line raw.')
        self.coord('turn', 'parent', 'us-direct-turn', str(provider), 'model', 'low',
                   str(self.directory), task, str(log), '')
        registered_log = self.output_log("parent")
        self.assertIn(bytes([30])+b"provider-raw-line\n", registered_log.read_bytes(),
                      'Direct mode parsed a provider control-byte prefix as a span token.')



    def test_nul_span_refusal_preserves_checkpoint_spool_and_input(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('nul-span-task', 'parent',
                           'Retain the original attempt when native output contains NUL.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_bounded(observer, 'parent')
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'Original OMP identity missing.')
        self.assertEqual(native_id, started['native'])
        attempt = pathlib.Path(self.execution('parent')[2])
        checkpoint = attempt / 'checkpoint'
        raw_output = attempt / 'stdout'
        self.action(control, emit_checkpoint_message='nul-span-checkpoint')
        self.assertEqual(json.loads(control.readline()),
                         {'checkpoint_message_written': 'nul-span-checkpoint'})
        self.eventually(lambda: checkpoint.is_file() and raw_output.is_file(),
                        'Pre-tail checkpoint/spool missing.')
        marker_end = raw_output.stat().st_size
        self.eventually(lambda: _checkpoint_covers_spool(checkpoint, marker_end),
                        'Marker was not durably consumed before the NUL baseline.')
        checkpoint_before = checkpoint.read_bytes()
        checkpoint_stat = checkpoint.stat()
        raw_before = raw_output.read_bytes()
        raw_stat = raw_output.stat()
        # The trailing NUL block is kept as producer evidence; its writer is
        # not established from this spool. This asserts the reader boundary.
        tail = bytes([0]) * 1642
        self.action(control, emit_nul_tail=len(tail), exit_after_nul_tail=True)
        self.assertEqual(json.loads(control.readline()), {'nul_tail_written': len(tail)})
        stdout, stderr = self.finish_bounded(observer, ok=False)
        self.assertIn('stdout frame contains NUL', stdout + stderr)
        self.assertEqual(raw_output.read_bytes(), raw_before + tail)
        self.assertEqual((raw_output.stat().st_ino, raw_output.stat().st_size),
                         (raw_stat.st_ino, raw_stat.st_size + len(tail)))
        self.assertEqual(checkpoint.read_bytes(), checkpoint_before)
        self.assertEqual((checkpoint.stat().st_ino, checkpoint.stat().st_size),
                         (checkpoint_stat.st_ino, checkpoint_stat.st_size))
        # The durable replay cursor stays on the last complete line. The
        # trailing NUL block remains in the spool and is not consumed.
        first_nul = len(raw_before)
        self.assertEqual(raw_before.find(b'\x00'), -1)
        self.assertTrue(raw_before.endswith(b'\n'))
        self.assertEqual(_checkpoint_offset(checkpoint_before), first_nul)
        self.assertEqual(_checkpoint_offset(checkpoint), first_nul)
        self.assertEqual(self.coord('turns', 'parent'), [])
        self.assertFalse((attempt / 'acknowledged').exists())
        self.assertIsNone(self.coord('delivery', 'nul-span-task')['receipt'])
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['nul-span-task'])
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        self.assertEqual(self.execution('parent')[2], str(attempt))

    def test_fresh_receive_admits_a_new_attempt_after_nul_refusal(self):
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('nul-fresh-task', 'parent',
                           'Continue the pending task in a fresh attempt.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept_bounded(observer, 'parent')
        attempt = pathlib.Path(self.execution('parent')[2])
        checkpoint = attempt / 'checkpoint'
        raw_output = attempt / 'stdout'
        self.action(control, emit_checkpoint_message='nul-fresh-checkpoint')
        self.assertEqual(json.loads(control.readline()),
                         {'checkpoint_message_written': 'nul-fresh-checkpoint'})
        marker_end = raw_output.stat().st_size
        self.eventually(lambda: _checkpoint_covers_spool(checkpoint, marker_end),
                        'Marker was not durably consumed before the NUL baseline.')
        checkpoint_before = checkpoint.read_bytes()
        raw_before = raw_output.read_bytes()
        tail = bytes([0]) * 1642
        self.action(control, emit_nul_tail=len(tail), exit_after_nul_tail=True)
        self.assertEqual(json.loads(control.readline()), {'nul_tail_written': len(tail)})
        stdout, stderr = self.finish_bounded(observer, ok=False)
        self.assertIn('stdout frame contains NUL', stdout + stderr)
        self.assertEqual(checkpoint.read_bytes(), checkpoint_before)
        self.assertEqual(raw_output.read_bytes(), raw_before + tail)
        self.assertEqual(self.coord('turns', 'parent'), [])
        self.assertFalse((attempt / 'acknowledged').exists())
        # A fresh admission ignores the recorded attempt binding, leaves its
        # spool and checkpoint in place, and carries the pending input into a
        # new attempt with its own spool.
        fresh = self.spawn('receive-fresh', 'parent', str(self.fixture), 'parent', 'low',
                           str(self.directory), str(self.directory / 'parent-fresh.jsonl'), '')
        fresh_control, started = self.accept_bounded(fresh, 'parent')
        fresh_attempt = pathlib.Path(self.execution('parent')[2])
        self.assertNotEqual(fresh_attempt, attempt)
        self.assertIn('[id: nul-fresh-task]', started['prompt'])
        self.action(fresh_control, body='Completed after fresh admission.', exit_after_terminal=True)
        self.finish(fresh)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(len(self.coord('turns', 'parent')), 1)
        self.assertEqual(checkpoint.read_bytes(), checkpoint_before)
        self.assertEqual(raw_output.read_bytes(), raw_before + tail)
        self.assertFalse((attempt / 'acknowledged').exists())

    def test_fresh_receive_refuses_a_live_prior_native(self):
        self.player(harness='omp')
        self.prepare_input('fresh-guard-task', 'parent',
                           'Do not start a second native while the prior one is live.', kind='task')
        attempt = self.directory / 'prior-live-attempt'
        attempt.mkdir()
        (attempt / 'native.pid').write_text(f'{os.getpid()}\n')
        with sqlite3.connect(str(self.db)) as database:
            database.execute(
                "INSERT OR REPLACE INTO executions(session,id,mode,directory,phase,status)"
                " VALUES(?,?,?,?,?,?)",
                ('parent', 'receive:parent:live:fresh-guard', 'retained',
                 str(attempt), 'running', ''))
        result = subprocess.run(
            [str(receive.EXE), str(self.db), 'receive-fresh', 'parent', str(self.fixture),
             'parent', 'low', str(self.directory), str(self.directory / 'fresh-guard.jsonl'), ''],
            capture_output=True, text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('confirmed prior native exit', result.stdout + result.stderr)

        self.assertEqual(self.execution('parent'),
                         ('running', '', str(attempt)))
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['fresh-guard-task'])

RETAINED_ROOT = pathlib.Path(
    '/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained')
RETAINED_EVIDENCE = [
    ('compiler',
     RETAINED_ROOT / 'baton-compiler-forkflush-20261016T195048Z' /
     'orchestra.db.attempt-726563656976653a6367656e2d656d657267656e63792d776f6e6465723a343135333a3966643437303163666137356332363462366639343764623961366163323633',
     4362240, 'fc72ec1e8f5535d81660c7fe376a83358e5769883302153a8581d68c49444328',
     4362012, 2108, '71bde5df1d59b44de007bf7fb8da97608513c4f4b0e23bd22db4a6eecad6623f'),
    ('logging-deepseek',
     RETAINED_ROOT / 'baton-account-credits-793-702-20261017T0106Z' /
     'orchestra.db.attempt-726563656976653a6c6f6767696e672d646565707365656b3a31363a3134313466333431326261326362636163623262353965346662653836343539',
     16977920, '2cf39b662218c91b83b73a8cf88cfbaf33d2b4b80af03c14d2cdf24e81c82ce1',
     16977583, 4254, '917fe3f911f892d21b5c3eeec233312708c9e04bb00002975c40a7bb02058e59'),
    ('logging-glm',
     RETAINED_ROOT / 'baton-account-credits-793-702-20261017T0106Z' /
     'orchestra.db.attempt-726563656976653a6c6f6767696e672d676c6d3a31373a6131333563616162343732393630313637333565326134663539636235623237',
     9109504, '088d8970de852eb3b413fd6cf2b105805299aa5aec0375a1544021da3fc4e48d',
     9106482, 1828, '57f41889d52723d63e75abb759417566eb864178ed80be6b8860255241374d46'),
]


class RetainedEvidenceTests(unittest.TestCase):
    def test_retained_nul_evidence_is_preserved(self):
        for name, directory, size, digest, first_nul, checkpoint_size, checkpoint_digest in RETAINED_EVIDENCE:
            spool = directory / 'stdout'
            checkpoint = directory / 'checkpoint'
            if not spool.is_file() or not checkpoint.is_file():
                self.skipTest(f'Retained evidence for {name} is absent on this host.')
            data = spool.read_bytes()
            self.assertEqual(len(data), size, name)
            self.assertEqual(hashlib.sha256(data).hexdigest(), digest, name)
            self.assertEqual(data.find(b'\x00'), first_nul, name)
            self.assertTrue(all(byte == 0 for byte in data[first_nul:]), name)
            self.assertTrue(data[:first_nul].endswith(b'\n'), name)
            record = checkpoint.read_bytes()
            self.assertEqual(len(record), checkpoint_size, name)
            self.assertEqual(hashlib.sha256(record).hexdigest(), checkpoint_digest, name)
            self.assertEqual(_checkpoint_offset(record), first_nul, name)
            stat = spool.stat()
            self.assertEqual(stat.st_blocks * 512, size, name)
            descriptor = os.open(spool, os.O_RDONLY)
            try:
                self.assertEqual(os.lseek(descriptor, 0, os.SEEK_HOLE), size, name)
                self.assertEqual(os.lseek(descriptor, first_nul, os.SEEK_DATA), first_nul, name)
            finally:
                os.close(descriptor)
            self.assertEqual(hashlib.sha256(spool.read_bytes()).hexdigest(), digest, name)
            self.assertEqual(hashlib.sha256(checkpoint.read_bytes()).hexdigest(), checkpoint_digest, name)

def _suite():
    suite = unittest.TestSuite()
    suite.addTest(MemoryGateTests('test_repeated_semantic_checkpoints_keep_one_latest_open_frame'))
    suite.addTest(MemoryGateTests('test_valid_unterminated_agent_end_is_consumed_at_eof'))
    suite.addTest(MemoryGateTests('test_checkpoint_write_failure_stops_read_and_preserves_input'))
    suite.addTest(MemoryGateTests('test_direct_omp_keeps_record_separator_provider_line_raw'))
    suite.addTest(MemoryGateTests('test_nul_span_refusal_preserves_checkpoint_spool_and_input'))
    suite.addTest(MemoryGateTests('test_fresh_receive_refuses_a_live_prior_native'))
    suite.addTest(MemoryGateTests('test_fresh_receive_admits_a_new_attempt_after_nul_refusal'))
    suite.addTest(RetainedEvidenceTests('test_retained_nul_evidence_is_preserved'))
    return suite


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(_suite())
    raise SystemExit(not result.wasSuccessful())
