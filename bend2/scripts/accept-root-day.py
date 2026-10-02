#!/usr/bin/env python3
"""Run the Bend2 Principal Conductor's working day against configured, logged-in native routes."""
import argparse
import errno
import json
import os
from pathlib import Path
import pty
import re
import signal
import sqlite3
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def run(argv, **kwargs):
    result = subprocess.run(list(map(str, argv)), text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: {result.stderr or result.stdout}')
    return result.stdout


def events(path):
    if path.exists():
        for line in path.read_text(errors='replace').splitlines():
            try:
                yield json.loads(line)
            except ValueError:
                pass  # The writer may still be appending the final line.


def tool_started(event):
    return (event.get('type') == 'tool_execution_start'
            or (event.get('type') == 'item.started'
                and event.get('item', {}).get('type') == 'command_execution')
            or event.get('payload_type') == 'tool.result'
            or any(c.get('type') == 'tool_use'
                   for c in event.get('message', {}).get('content', []) if isinstance(c, dict)))


def observe(process, predicate, description):
    """Wait for run evidence, failing if its producer exits before producing it."""
    while True:
        value = predicate()
        if value:
            return value
        if process.poll() is not None:
            raise RuntimeError(f'{description}: producer exited {process.returncode}')
        time.sleep(0.05)  # Sample test evidence; this does not drive root delivery.


def kill_tree(process, path):
    rows = []
    for line in run(['ps', '-axo', 'pid=,ppid=']).splitlines():
        pid, parent = map(int, line.split())
        rows.append((pid, parent))
    owned = {process.pid}
    while True:
        children = {pid for pid, parent in rows if parent in owned}
        if children <= owned:
            break
        owned |= children
    save(path, {'owner': process.pid, 'killed': sorted(owned)})
    # These are descendants of the process this run started, never host services.
    for pid in sorted(owned - {process.pid}, reverse=True):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        os.kill(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait()


class Case:
    def __init__(self, acceptance, name):
        self.a = acceptance
        self.path = acceptance.output / name
        self.path.mkdir()
        self.db = self.path / 'state.db'
        self.env = acceptance.env
        self.processes = []

    def command(self, *args):
        return [str(self.a.coordinator), str(self.db), *map(str, args)]

    def coord(self, *args):
        return json.loads(run(self.command(*args), env=self.env))

    def start(self, argv, name):
        with (self.path / (name + '.out')).open('w') as out:
            process = subprocess.Popen(list(map(str, argv)), env=self.env,
                                       stdout=out, stderr=subprocess.STDOUT,
                                       start_new_session=True, cwd=ROOT)
        self.processes.append(process)
        return process

    def row(self, table, ident):
        with sqlite3.connect(self.db) as db:
            db.row_factory = sqlite3.Row
            row = db.execute(f'SELECT * FROM {table} WHERE id=?', (ident,)).fetchone()
            return dict(row) if row else None

    def recruit(self, kind, player='w1'):
        route = self.a.routes[kind]
        worktree = self.path / player
        branch = 'accept-' + self.a.ident + '-' + self.path.name + '-' + player
        self.coord('recruit', player, 'root', kind, route['model'], route['effort'],
                   ROOT, branch, worktree, 'HEAD')
        return worktree

    def turn(self, kind, task, ident, player='w1', resume=''):
        route = self.a.routes[kind]
        taskfile = self.path / (ident + '.txt')
        taskfile.write_text(task)
        return self.start(self.command('turn', player, ident, route['executable'],
                          route['model'], route['effort'], self.path / player,
                          taskfile, self.path / (ident + '.jsonl'), resume), ident)

    def completed(self, process, ident):
        code = process.wait()
        if code:
            raise RuntimeError(f'{self.path.name}/{ident} exited {code}; read its .out file')
        return self.coord('delivery', ident)

    def evidence(self, value):
        save(self.path / 'evidence.json', value)
        print(f'PASS {self.path.name}: {self.path / "evidence.json"}', flush=True)

    def close(self):
        for process in self.processes:
            if process.poll() is None:
                kill_tree(process, self.path / f'cleanup-{process.pid}.json')


class Acceptance:
    def __init__(self, args):
        self.output = args.output.resolve()
        self.output.mkdir(parents=True, exist_ok=False)
        self.ident = uuid.uuid4().hex
        self.config = args.config.resolve()
        self.routes = json.loads(self.config.read_text())
        self.env = dict(os.environ)
        self.env.update(CODEX_CONDUCTOR_MODEL=self.routes['codex']['model'],
                        OMP_CONDUCTOR_MODEL=self.routes['omp']['model'],
                        OMP_CONDUCTOR_THINKING=self.routes['omp']['effort'])
        self.coordinator = args.coordinator.resolve() if args.coordinator else self.output / 'baton2'
        if not args.coordinator:
            print('Building native coordinator', flush=True)
            run(['sh', ROOT / 'bend2/scripts/build-native.sh',
                 'bend2/src/coordinator/main.bend', self.coordinator], cwd=ROOT)
        self.cases = []

    def case(self, name):
        case = Case(self, name)
        self.cases.append(case)
        return case

    def players(self):
        for kind in ['omp', 'codex', 'claude-code', 'muse']:
            c = self.case('worker-' + kind)
            c.coord('attach', 'root', 'external', '', '')
            c.recruit(kind)
            label = self.ident + '-' + kind
            p = c.turn(kind, f'Remember review label {label}. Read bend2/README.md, '
                       'bend2/src/coordinator/turn.bend and bend2/src/coordinator/commands.bend. '
                       'Explain native-session recovery with source references. Read the files '
                       'before reporting. Do not edit files, launch agents, or access the network.', 'interrupted')
            observe(p, lambda: any(tool_started(e) for e in events(c.path / 'interrupted.jsonl'))
                    and c.row('sessions', 'w1')['native'], 'Player tool start and session binding')
            before = c.coord('player', 'w1')
            kill_tree(p, c.path / 'crash.json')
            p = c.turn(kind, 'Continue the interrupted review. Begin your final report with the '
                       'exact review label from the earlier task, using your native conversation. '
                       'Explain one concrete recovery step. Do not search for the label, edit files, '
                       'or launch agents.', 'resumed', resume=before['native'])
            report = c.completed(p, 'resumed')
            after = c.coord('player', 'w1')
            assert after['native'] == before['native'], (before, after)
            assert label in report['body'], report
            c.evidence({'before': before, 'after': after, 'report': report})

    def guidance(self):
        c = self.case('guidance')
        c.coord('attach', 'root', 'external', '', '')
        c.coord('role', 'root', 'principal-conductor')
        c.recruit('omp')
        p = c.turn('omp', 'Read bend2/README.md, bend2/src/coordinator/turn.bend and '
                   'bend2/src/harness/omp-player.bend. Review how guidance reaches an OMP '
                   'turn and identify a documentation improvement. Read all three files. '
                   'Do not edit files, launch agents, or access the network.', 'guided')
        observe(p, lambda: any(e.get('type') == 'tool_execution_start'
                              for e in events(c.path / 'guided.jsonl')), 'OMP tool start')
        marker = self.ident + '-guided'
        c.coord('message', 'guide', 'root', 'w1', 'guidance',
                'Focus on just one documentation improvement. Start the final report with ' + marker)
        report = c.completed(p, 'guided')
        delivery = c.coord('delivery', 'guide')
        assert delivery['receipt'] and marker in report['body'], (delivery, report)
        c.evidence({'guidance': delivery, 'guidance_origin': 'acceptance-driver', 'report': report})

    def root_tap(self, c, kind):
        wrapper = c.path / 'native-root'
        wrapper.write_text('#!' + sys.executable + '\n' + '''import os,sys,json,pathlib,subprocess,threading
b=pathlib.Path(__file__).parent
parent=os.getppid()
ancestor=int(subprocess.check_output(['ps','-o','ppid=','-p',str(parent)],text=True).strip())
with (b/'starts.jsonl').open('a') as f:f.write(json.dumps({'adapterPid':parent,'writerPid':ancestor})+'\\n')
p=subprocess.Popen([NATIVE,*sys.argv[1:]],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
def send():
 while True:
  data=os.read(0,65536)
  if not data:break
  os.write(p.stdin.fileno(),data)
 p.stdin.close()
threading.Thread(target=send,daemon=True).start()
with (b/'native.jsonl').open('ab') as f:
 while True:
  data=os.read(p.stdout.fileno(),65536)
  if not data:break
  f.write(data);f.flush();os.write(1,data)
sys.exit(p.wait())
'''.replace('NATIVE', repr(self.routes[kind]['executable'])))
        wrapper.chmod(0o700)
        return wrapper

    def native_conductors(self):
        for kind in ['codex', 'omp']:
            c = self.case('root-' + kind)
            tap = self.root_tap(c, kind)
            attach = ['node', ROOT / f'bend2/scripts/{kind}-conductor.mjs', c.db,
                      self.coordinator, tap, '--attach']
            run(attach, env=self.env)
            c.coord('attach', 'operator', 'terminal', '', '')
            c.coord('role', 'operator', 'operator')
            assert not (c.path / 'starts.jsonl').exists(), 'empty attach started a native turn'
            c.recruit('omp')
            marker = self.ident + '-root-' + kind
            p = c.turn('omp', 'Do not use tools or edit files. Reply exactly with this report: '
                       f'Root: remember review label {marker} for later turns, acknowledge report '
                       f'root-report with this label, and do not edit, land, push or start Players.',
                       'root-report')
            report = c.completed(p, 'root-report')
            starts = list(events(c.path / 'starts.jsonl'))
            assert starts[0]['writerPid'] == p.pid, starts
            assert marker in (report['receipt'] or ''), report
            original = c.coord('player', 'root')['native']
            assert original
            (c.path / 'native.jsonl').rename(c.path / 'first-native.jsonl')
            p = c.start(c.command('message', 'root-interrupted', 'operator', 'root', 'guidance',
                        'Read bend2/scripts/mcp-conductor.mjs and bend2/src/coordinator/delivery.bend '
                        'completely and review recovery. Then acknowledge root-interrupted with '
                        'a source finding and the review label remembered from our earlier turn. '
                        'Do not search for the label, edit files or launch agents.'), 'root-interrupted')
            observe(p, lambda: any(tool_started(e) for e in events(c.path / 'native.jsonl')),
                    'root tool start')
            kill_tree(p, c.path / 'crash.json')
            pending = c.coord('delivery', 'root-interrupted')
            assert pending['receipt'] is None, pending
            resumed = run(attach, env=self.env)
            (c.path / 'resumed.out').write_text(resumed)
            report = c.coord('delivery', 'root-interrupted')
            assert marker in (report['receipt'] or ''), report
            assert original == c.coord('player', 'root')['native']
            assert c.coord('inbox', 'root') == []
            c.evidence({'native': original, 'starts': starts, 'pending': pending, 'resumed': report})

    def claude_channel(self):
        c = self.case('root-claude-code')
        session = str(uuid.uuid4())
        c.coord('attach', 'root', 'claude-code', session, '')
        c.coord('role', 'root', 'principal-conductor')
        c.coord('attach', 'operator', 'terminal', '', '')
        c.coord('role', 'operator', 'operator')
        marker = self.ident + '-root-claude'
        c.coord('message', 'root-setup', 'operator', 'root', 'guidance',
                f'Remember root review label {marker}. Acknowledge root-setup with this label. '
                'When Player reports arrive, acknowledge each with the root review label and '
                'the complete text of that Player report as your receipt. Do not poll, edit files, '
                'land, push or launch Players.')
        config = c.path / 'mcp.json'
        save(config, {'mcpServers': {'baton-conductor': {'command': 'node', 'args': [
            str(ROOT / 'bend2/scripts/mcp-conductor.mjs'), str(c.db), str(self.coordinator)]}}})
        route = self.routes['claude-code']
        def start(resume):
            phase = 'resumed' if resume else 'initial'
            args = [route['executable'], '--resume' if resume else '--session-id', session,
                    '--model', route['model'], '--effort', route['effort'],
                    '--dangerously-skip-permissions', '--strict-mcp-config', '--mcp-config', str(config),
                    '--dangerously-load-development-channels', 'server:baton-conductor',
                    '--debug-file', str(c.path / (phase + '.debug')), '--ax-screen-reader']
            if not resume:
                args.append('Act as the Bend2 Principal Conductor. Handle the baton-conductor channel messages using its tools.')
            terminal = Terminal(args, c.path / (phase + '.terminal'), self.env)
            c.processes.append(terminal)
            return terminal
        terminal = start(False)
        observe(terminal, lambda: c.row('messages', 'root-setup')['receipt'], 'Claude root setup receipt')
        c.recruit('omp')
        p = c.turn('omp', 'Do not use tools or change files. Reply exactly: Player report live-channel.', 'live')
        c.completed(p, 'live')
        observe(terminal, lambda: c.row('messages', 'live')['receipt'], 'live channel acceptance')
        live = c.coord('delivery', 'live')
        assert marker in live['receipt'] and 'live-channel' in live['receipt'], live
        kill_tree(terminal, c.path / 'crash.json')
        native = c.coord('player', 'w1')['native']
        p = c.turn('omp', 'Do not use tools or change files. Reply exactly: Player report recovered-channel.',
                   'pending', resume=native)
        p.wait()  # Dead endpoint returns an error; the committed report is the recovery input.
        pending = c.coord('delivery', 'pending')
        assert pending['receipt'] is None and 'recovered-channel' in pending['body'], pending
        terminal = start(True)
        observe(terminal, lambda: c.row('messages', 'pending')['receipt'], 'resumed channel acceptance')
        observe(terminal, lambda: not c.coord('inbox', 'root'), 'all pending root receipts')
        resumed = c.coord('delivery', 'pending')
        assert marker in resumed['receipt'] and 'recovered-channel' in resumed['receipt'], resumed
        terminal.send('/exit\r')
        terminal.wait()
        c.evidence({'native': session, 'live': live, 'pending': pending, 'resumed': resumed,
                    'inbox': c.coord('inbox', 'root')})

    def git(self):
        script = ROOT / 'bend2/scripts/accept-git.py'
        subprocess.run([sys.executable, str(script), '--config', str(self.config),
                        '--output', str(self.output / 'git'), '--coordinator', str(self.coordinator)],
                       env=self.env, check=True)

    def close(self):
        for c in self.cases:
            c.close()


class Terminal:
    """A real interactive Claude session with its transcript retained for inspection."""
    def __init__(self, args, transcript, env):
        self.returncode = None
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(ROOT)
            os.execve(args[0], args, env)
        self.thread = threading.Thread(target=self.read, args=(transcript,), daemon=True)
        self.thread.start()

    def read(self, path):
        text = ''
        answered = set()
        with path.open('wb') as out:
            while True:
                try:
                    data = os.read(self.fd, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                out.write(data)
                out.flush()
                text += re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', data.decode(errors='replace'))
                # These are the native local prompts accepted in the recorded channel run.
                # An unknown prompt remains in the transcript for diagnosis.
                prompts = [('development', 'Enter y/n:', 'y\r'),
                           ('trust', 'Yes, I trust this folder', '\r'),
                           ('bypass', 'Yes, I accept', '\x1b[B\r')]
                for key, phrase, answer in prompts:
                    if key not in answered and phrase in text:
                        self.send(answer)
                        answered.add(key)

    def send(self, value):
        os.write(self.fd, value.encode())

    def poll(self):
        if self.returncode is None:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                self.returncode = os.waitstatus_to_exitcode(status)
        return self.returncode

    def wait(self):
        if self.returncode is None:
            _, status = os.waitpid(self.pid, 0)
            self.returncode = os.waitstatus_to_exitcode(status)
        self.thread.join()
        os.close(self.fd)
        return self.returncode


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True,
                        help='JSON route entries: executable, model, effort for omp/codex/claude-code/muse')
    parser.add_argument('--output', type=Path, required=True, help='new directory for retained evidence')
    parser.add_argument('--coordinator', type=Path, help='existing native executable; default builds current source')
    parser.add_argument('--stage', choices=['players', 'workers', 'guidance', 'native-conductors', 'native-roots', 'claude-channel', 'git'],
                        help='run one stage while investigating a failed acceptance run')
    args = parser.parse_args()
    acceptance = Acceptance(args)
    try:
        stage = {'workers': 'players', 'native-roots': 'native-conductors'}.get(args.stage, args.stage)
        stages = [stage] if stage else ['players', 'guidance', 'native-conductors', 'claude-channel', 'git']
        for stage in stages:
            print('START ' + stage, flush=True)
            getattr(acceptance, stage.replace('-', '_'))()
        save(acceptance.output / 'result.json', {'source': run(['git', 'rev-parse', 'HEAD'], cwd=ROOT).strip(),
             'stages': stages, 'status': 'passed', 'hostRebooted': False})
        print('Root-day acceptance passed: ' + str(acceptance.output), flush=True)
    finally:
        acceptance.close()


if __name__ == '__main__':
    main()
