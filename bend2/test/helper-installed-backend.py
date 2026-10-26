"""Qualify channel helpers against an existing native backend without a provider."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import queue
import sqlite3
import subprocess
import threading
import time


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=Path, required=True)
    parser.add_argument('--conductor', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    backend, conductor = args.backend.resolve(), args.conductor.resolve()
    database = args.output / 'fixture.db'
    env = {key: value for key, value in os.environ.items()
           if not key.startswith('BATON_') and key != 'CODEX_THREAD_ID'}
    records = []
    children = []

    def command(label, values, data=None):
        started = time.time_ns()
        result = subprocess.run(values, env=env, input=data, text=True, capture_output=True)
        stdout, stderr = args.output / (label + '.stdout'), args.output / (label + '.stderr')
        stdout.write_text(result.stdout)
        stderr.write_text(result.stderr)
        records.append({'label': label, 'argv': values, 'started_ns': started,
                        'finished_ns': time.time_ns(), 'exit': result.returncode,
                        'stdoutSha256': sha(stdout), 'stderrSha256': sha(stderr)})
        (args.output / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
        assert result.returncode == 0, (label, result.stdout, result.stderr)
        return result.stdout

    def coord(label, *values):
        return command(label, [str(backend), str(database), *values])

    class Channel:
        def __init__(self, label):
            self.events, self.frames = queue.Queue(), []
            self.stdout = (args.output / (label + '.mcp.jsonl')).open('w')
            self.stderr = (args.output / (label + '.stderr')).open('w')
            self.process = subprocess.Popen(['node', str(conductor), str(database), str(backend),
                '--session', 'operator'], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=self.stderr, text=True)
            children.append(self)
            def read():
                for line in self.process.stdout:
                    self.stdout.write(line)
                    self.stdout.flush()
                    frame = json.loads(line)
                    self.frames.append(frame)
                    self.events.put(frame)
                self.events.put(None)
            self.reader = threading.Thread(target=read)
            self.reader.start()
            self.send({'id': 'initialize', 'method': 'initialize', 'params': {}})
            initialized = self.wait(lambda frame: frame.get('id') == 'initialize')
            assert 'error' not in initialized, initialized
            self.send({'method': 'notifications/initialized'})
            self.send({'id': 'tools', 'method': 'tools/list'})
            self.wait(lambda frame: frame.get('id') == 'tools')
            self.wait(lambda frame: frame.get('id') == 'conductor-channel-ready')
            self.send({'id': 'conductor-channel-ready', 'result': {}})

        def send(self, frame):
            self.process.stdin.write(json.dumps({'jsonrpc': '2.0', **frame}) + '\n')
            self.process.stdin.flush()

        def wait(self, predicate):
            for frame in self.frames:
                if predicate(frame):
                    return frame
            while True:
                frame = self.events.get(timeout=30)
                assert frame is not None, 'The fixture MCP process ended.'
                if predicate(frame):
                    return frame

        def notice(self, ident):
            return self.wait(lambda frame: frame.get('method') == 'notifications/claude/channel'
                and json.loads(frame['params']['meta']['messageIds']) == [ident])

        def read(self, ident):
            self.send({'id': 'read-' + ident, 'method': 'tools/call',
                       'params': {'name': 'baton2_delivery', 'arguments': {'id': ident}}})
            response = self.wait(lambda frame: frame.get('id') == 'read-' + ident)
            assert not response['result'].get('isError'), response
            return json.loads(response['result']['content'][0]['text'])

        def native(self, event, prompt):
            command(event + '-' + prompt, ['node', str(conductor), str(database), str(backend),
                '--session', 'operator', '--native-event'], json.dumps({'hook_event_name': event,
                'session_id': 'fixture-existing-conversation', 'prompt_id': prompt}))

        def close(self):
            if self.process.poll() is None:
                self.process.terminate()
            result = self.process.wait()
            self.reader.join()
            self.stdout.close()
            self.stderr.close()
            return result

    try:
        coord('attach', 'attach', 'operator', 'claude-code', 'fixture-existing-conversation', '')
        coord('role', 'role', 'operator', 'operator')
        coord('attach-sender', 'attach', 'sender', 'terminal', '', '')
        coord('role-sender', 'role', 'sender', 'principal-conductor')
        body = 'Complete stored body. λ🙂\n' * 2000 + 'TAIL-COMPLETE-READ'
        with sqlite3.connect(database) as db:
            db.executemany("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'operator','operator','report',?)",
                           [('retained-first', body), ('retained-second', 'Second retained body.')])
        first = Channel('first')
        notice = first.notice('retained-first')
        assert body not in notice['params']['content']
        with sqlite3.connect(database) as db:
            assert db.execute('SELECT count(*) FROM message_reads').fetchone()[0] == 0
        first.native('PreToolUse', 'compatibility-prompt')
        read = first.read('retained-first')
        assert read['body'] == body
        first.notice('retained-second')
        assert first.read('retained-second')['body'] == 'Second retained body.'
        with sqlite3.connect(database) as db:
            rows = db.execute('SELECT message,native,identity,handled FROM message_reads ORDER BY message').fetchall()
            assert [row[0] for row in rows] == ['retained-first', 'retained-second']
            assert all(row[1] == 'fixture-existing-conversation' and row[2] and row[3] is None for row in rows)
            assert all(json.loads(row[2])[-1] == 'compatibility-prompt' for row in rows)
            assert db.execute('SELECT count(*) FROM messages WHERE receipt IS NOT NULL').fetchone()[0] == 0
        first.native('Stop', 'compatibility-prompt')
        with sqlite3.connect(database) as db:
            assert db.execute('SELECT message,native,identity,handled FROM message_reads ORDER BY message').fetchall() == rows
        coord('committed-input', 'report', 'committed-later', 'sender', 'Committed through the installed backend.')
        first.notice('committed-later')
        first.close()
        second = Channel('reconnected')
        second.notice('committed-later')
        assert second.read('committed-later')['body'] == 'Committed through the installed backend.'
        session = json.loads(coord('same-conversation', 'session', 'operator'))
        assert session['native'] == 'fixture-existing-conversation'
        fake = args.output / 'fake-claude'
        fake.write_text('#!/usr/bin/python3\nimport json,pathlib,sys\npathlib.Path(' + repr(str(args.output / 'launch-argv.json')) + ').write_text(json.dumps(sys.argv[1:]))\n')
        fake.chmod(0o755)
        command('maintained-launch', ['node', str(conductor), str(database), str(backend),
                                     '--session', 'operator', '--claude', str(fake)])
        launch = json.loads((args.output / 'launch-argv.json').read_text())
        assert launch[launch.index('--resume') + 1] == 'fixture-existing-conversation'
        assert '--dangerously-load-development-channels' in launch
        hooks = json.loads(launch[launch.index('--settings') + 1])['hooks']
        assert set(hooks) == {'PreToolUse', 'Stop', 'StopFailure'}
        pending = json.loads(coord('native-pending', 'inbox', 'operator'))
        with sqlite3.connect(database) as db:
            unread = db.execute("SELECT id FROM messages m WHERE recipient='operator' AND NOT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").fetchall()
            assert unread == []
        result = {'backend': str(backend), 'backendSha256': sha(backend),
                  'conductor': str(conductor), 'conductorSha256': sha(conductor),
                  'nodeSha256': sha(subprocess.check_output(['which', 'node'], text=True).strip()),
                  'completeReadSha256': hashlib.sha256(body.encode()).hexdigest(),
                  'readRows': rows, 'postReadContinuation': True, 'committedInputWake': True,
                  'nativePromptWitness': True, 'stopPreservesReadRows': True,
                  'maintainedLaunchArgv': launch,
                  'reconnectedSameNative': session['native'], 'unreadAfterReads': unread,
                  'nativePendingAfterReads': [row['id'] for row in pending],
                  'limits': ['Fixture MCP client; no actual Claude provider or live session.',
                             'Native pending/receipt semantics are measured separately from channel read continuation.']}
        (args.output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2), flush=True)
    finally:
        for child in children:
            child.close()
        command('shutdown', [str(backend), '--instance-shutdown', str(database)])


if __name__ == '__main__':
    main()
