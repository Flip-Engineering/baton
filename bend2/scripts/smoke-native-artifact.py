#!/usr/bin/env python3
"""Verify and exercise a native archive using an external controlled OMP fixture.

The caller retains and relocates its owned build clone before this command. This
command verifies the advertised archive digest and provenance, extracts a fresh
prefix, and uses the installed public CLI from a separate working directory.
All output, repository work, command results and process records remain in OUTPUT.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import select
import shlex
import shutil
import subprocess
import sys
import tarfile
import time


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def record(path, root):
    return {'path': str(path.relative_to(root)), 'bytes': path.stat().st_size,
            'sha256': digest(path)}


class Commands:
    def __init__(self, output, cwd, environment, actor):
        self.output, self.cwd, self.environment, self.actor = output, cwd, environment, actor
        self.number = 0

    def call(self, name, argv, expected=0, input_data=None):
        self.number += 1
        prefix = self.output / 'commands' / f'{self.actor}-{os.getpid()}-{self.number}-{name}'
        row = {'argv': list(map(str, argv)), 'cwd': str(self.cwd), 'started_unix': time.time()}
        if input_data is not None:
            prefix.with_suffix('.stdin').write_text(input_data)
            row['stdin'] = record(prefix.with_suffix('.stdin'), self.output)
        with prefix.with_suffix('.stdout').open('wb') as stdout, prefix.with_suffix('.stderr').open('wb') as stderr:
            child = subprocess.Popen(row['argv'], cwd=self.cwd, env=self.environment,
                                     stdin=subprocess.PIPE if input_data is not None else subprocess.DEVNULL,
                                     stdout=stdout, stderr=stderr)
            if input_data is not None:
                child.communicate(input_data.encode())
            row['pid'], row['exit_code'] = child.pid, child.wait()
        row['ended_unix'] = time.time()
        row.update({stream: record(prefix.with_suffix('.' + stream), self.output)
                    for stream in ('stdout', 'stderr')})
        save(prefix.with_suffix('.json'), row)
        require(row['exit_code'] in expected if isinstance(expected, tuple) else row['exit_code'] == expected,
                f'{name} exited {row["exit_code"]}; complete streams: {prefix}.stdout and {prefix}.stderr')
        return prefix.with_suffix('.stdout').read_text()


def fixture(kind, config_path, arguments):
    config = json.loads(config_path.read_text())
    output = Path(config['output'])
    commands = Commands(output, Path.cwd(), os.environ.copy(), kind)
    cli = lambda name, *args: json.loads(commands.call(name, [config['exe'], config['db'], *args]))
    if kind == 'parent':
        message = next(m for m in cli('inbox', 'inbox', 'root') if m['id'] == arguments[0])
        require(message['body'] == config['report'], 'Parent received a different report body')
        cli('ack', 'ack', message['id'], 'root', 'artifact-parent-reviewed')
        save(output / 'parent-delivery.json', {'pid': os.getpid(), 'message': message,
                                              'receipt': 'artifact-parent-reviewed'})
        print(json.dumps({'received': message['id']}))
        return

    state = json.loads(sys.stdin.readline())
    task = json.loads(sys.stdin.readline())
    require(state.get('type') == 'get_state' and task.get('type') == 'prompt', 'Unexpected native startup requests')
    require(config['task'] in task['message'], 'The native prompt lost the task body')
    parent = commands.call('parent-identity', [config['ps'], '-ww', '-p', str(os.getppid()),
                                              '-o', 'pid=,ppid=,lstart=,command='])
    require(config['exe'] in parent and '--host-process-keeper' in parent,
            'Native parent did not reexecute the staged coordinator keeper')
    save(output / 'native-start.json', {'pid': os.getpid(), 'ppid': os.getppid(),
                                       'cwd': os.getcwd(), 'parent_identity': parent,
                                       'task_sha256': hashlib.sha256(task['message'].encode()).hexdigest()})
    print(json.dumps({'id': state['id'], 'type': 'response', 'command': 'get_state', 'success': True,
                      'data': {'sessionId': config['native'], 'model': {'provider': 'fixture', 'id': 'artifact'},
                               'thinkingLevel': 'low'}}), flush=True)
    cli('ack', 'ack', 'artifact-task', 'worker', 'artifact-worker-accepted')
    Path('native-work.txt').write_text(config['work'])
    commands.call('git-add', [config['git'], 'add', 'native-work.txt'])
    commands.call('git-commit', [config['git'], 'commit', '-q', '-m', 'Add controlled artifact work'])
    print(json.dumps({'type': 'agent_end', 'isTerminal': True,
                      'messages': [{'role': 'assistant', 'content': [{'type': 'text', 'text': config['report']}]}]}), flush=True)
    require(sys.stdin.read() == '', 'Native stdin did not close after its terminal event')
    save(output / 'native-complete.json', {'pid': os.getpid(), 'stdin_eof': True})


def extract(archive, provenance, destination):
    manifest_bytes = provenance.read_bytes()
    manifest = json.loads(manifest_bytes)
    require(manifest.get('schema') == 'baton2-native-artifact-v1', 'Unsupported artifact manifest schema')
    name = manifest['archive_root']
    require(PurePosixPath(name).parts == (name,) and name not in ('', '.', '..') and '\\' not in name,
            'Archive root must be one directory name')
    expected = {entry['path']: entry for entry in manifest['files']}
    require(len(expected) == len(manifest['files']) and 'manifest.json' not in expected,
            'Manifest file entries must be distinct and exclude manifest.json')
    seen, regular = set(), set()
    with tarfile.open(archive, 'r:*') as packed:
        for member in packed:
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in member.name
                    and path.parts and path.parts[0] == name, f'Unsafe archive path: {member.name}')
            require(path not in seen and (member.isdir() or member.isfile()),
                    f'Duplicate or unsupported archive member: {member.name}')
            seen.add(path)
            target = destination.joinpath(*path.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            relative = str(PurePosixPath(*path.parts[1:]))
            require(relative in expected or relative == 'manifest.json', f'Unmanifested archive file: {relative}')
            target.parent.mkdir(parents=True, exist_ok=True)
            with packed.extractfile(member) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(member.mode & 0o777)
            regular.add(relative)
    require(regular == set(expected) | {'manifest.json'}, 'Archive and manifest list different files')
    prefix = destination / name
    require((prefix / 'manifest.json').read_bytes() == manifest_bytes,
            'Archive manifest differs from supplied provenance')
    for relative, entry in expected.items():
        path = prefix / relative
        require(path.stat().st_size == entry['bytes'] and digest(path) == entry['sha256'],
                f'Artifact file differs from manifest: {relative}')
    binary = manifest['binary']
    require(binary['path'] == 'bin/baton2' and expected[binary['path']] == binary,
            'Binary must bind the manifested bin/baton2 entry')
    require(os.access(prefix / binary['path'], os.X_OK), 'Staged coordinator is not executable')
    return prefix, manifest


def wait_exit(pid, expected_path, commands, ps):
    current = commands.call('process-before-exit', [ps, '-ww', '-p', str(pid), '-o', 'pid=,command='], (0, 1))
    if not current:
        return
    require(str(expected_path) in current, f'PID {pid} no longer names the captured process; inspect its identity')
    if hasattr(os, 'pidfd_open'):
        try:
            descriptor = os.pidfd_open(pid)
        except ProcessLookupError:
            return
        try:
            select.select([descriptor], [], [])
        finally:
            os.close(descriptor)
    else:
        queue = select.kqueue()
        try:
            event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                  flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT, fflags=select.KQ_NOTE_EXIT)
            try:
                queue.control([event], 0, 0)
            except ProcessLookupError:
                return
            queue.control(None, 1, None)
        finally:
            queue.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--provenance', type=Path, required=True)
    parser.add_argument('--unavailable-source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    unavailable = args.unavailable_source.resolve()
    require(not unavailable.exists(), 'Relocate only the owned build clone before running the smoke check')
    require(hasattr(os, 'pidfd_open') or hasattr(select, 'kqueue'), 'Process-exit observation requires Linux or macOS/BSD')
    require(digest(args.archive) == args.sha256.lower(), 'Archive does not match the advertised SHA256')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    (output / 'commands').mkdir()
    result = {'archive': str(args.archive.resolve()), 'archive_sha256': args.sha256.lower(),
              'provenance_sha256': digest(args.provenance), 'started_unix': time.time(),
              'unavailable_source': str(unavailable), 'status': 'failed'}
    try:
        prefix, manifest = extract(args.archive, args.provenance, output / 'extracted')
        require(Path(manifest['source']['directory']).resolve() == unavailable,
                'Unavailable source path differs from recorded build source')
        binary = prefix / 'bin/baton2'
        working = output / 'separate working directory λ'
        working.mkdir()
        repo, db = working / 'repository', working / 'state.db'
        git, ps = shutil.which('git'), shutil.which('ps')
        require(git and ps, 'Git and ps must be installed')
        environment = os.environ.copy()
        for key in list(environment):
            if key == 'BEND' or key.startswith('BEND_') or key in ('CC', 'OPENAI_API_KEY', 'CODEX_API_KEY'):
                environment.pop(key)
        environment.update(PATH=os.pathsep.join([str(binary.parent), str(Path(git).parent), '/usr/bin', '/bin', '/usr/sbin', '/sbin']),
                           GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
        commands = Commands(output, working, environment, 'smoke')
        cli = lambda name, *args: json.loads(commands.call(name, ['baton2', str(db), *args]))
        commands.call('usage', ['baton2'], 2)
        commands.call('git-init', [git, 'init', '-q', '-b', 'main', str(repo)])
        for key, value in [('user.name', 'Native artifact fixture'), ('user.email', 'fixture@example.invalid')]:
            commands.call('git-config', [git, '-C', repo, 'config', key, value])
        (repo / 'initial.txt').write_text('base\n')
        commands.call('git-add', [git, '-C', repo, 'add', 'initial.txt'])
        commands.call('git-commit', [git, '-C', repo, 'commit', '-q', '-m', 'Create artifact fixture'])
        base = commands.call('git-base', [git, '-C', repo, 'rev-parse', 'HEAD']).strip()
        helper = output / 'controlled-fixture.py'
        shutil.copyfile(Path(__file__).resolve(), helper)
        config_path = output / 'fixture.json'
        config = {'output': str(output), 'exe': str(binary), 'db': str(db), 'git': git, 'ps': ps,
                  'task': 'Exercise installed retained receive λ\nKeep the complete task body.\n',
                  'report': 'Complete installed native report λ\nFull second line.\n',
                  'work': 'Retained installed Player work λ\n', 'native': 'artifact-native'}
        save(config_path, config)
        native = output / 'controlled-native'
        native.write_text('#!/bin/sh\nexec ' + shlex.join([sys.executable, str(helper), '--fixture-native', str(config_path)]) + ' "$@"\n')
        native.chmod(0o755)
        endpoint = json.dumps([sys.executable, str(helper), '--fixture-parent', str(config_path)])
        cli('attach', 'attach', 'root', 'fixture', 'artifact-root', endpoint)
        cli('role', 'role', 'root', 'principal-conductor')
        player = cli('recruit', 'recruit', 'worker', 'root', 'omp', 'fixture/artifact', 'low', repo,
                     'artifact-worker', 'worker tree', base)
        workspace = Path(player['workspace'])
        require(workspace.parent == repo and player['base'] == base, 'Recruit returned another workspace or base')
        adapters = prefix / 'libexec/baton2'
        node = shutil.which('node')
        require(node is not None, 'The extracted Conductor control smoke requires Node 22 or later')
        require(all((adapters / (harness + '-' + suffix + '.mjs')).is_file()
                    for harness in ('codex', 'omp', 'mcp') for suffix in ('conductor', 'root')),
                'The archive must contain canonical Conductor adapters and stored-endpoint compatibility entries')
        tools = [
            ('player', 'baton2_player', {'player': 'worker'}),
            ('players', 'baton2_players', {}),
            ('role', 'baton2_role', {'session': 'root'}),
            ('ensemble', 'baton2_ensemble', {'ensemble': 'artifact-ensemble', 'coupling': 'loose'}),
            ('ensemble-member', 'baton2_ensemble_member', {'ensemble': 'artifact-ensemble', 'player': 'worker', 'action': 'add'}),
            ('section', 'baton2_section', {'ensemble': 'artifact-ensemble', 'section': 'git', 'capability': 'repository changes'}),
            ('section-member', 'baton2_section_member', {'ensemble': 'artifact-ensemble', 'section': 'git', 'player': 'worker', 'action': 'add'}),
            ('orchestra', 'baton2_orchestra', {}),
        ]
        requests = [{'jsonrpc': '2.0', 'id': 'initialize', 'method': 'initialize', 'params': {}},
                    {'jsonrpc': '2.0', 'id': 'tools', 'method': 'tools/list'}]
        requests.extend({'jsonrpc': '2.0', 'id': label, 'method': 'tools/call',
                         'params': {'name': tool, 'arguments': args}} for label, tool, args in tools)
        replies = [json.loads(line) for line in commands.call('mcp-conductor-controls',
            [node, adapters / 'mcp-conductor.mjs', db, '--session', 'root'],
            input_data=''.join(json.dumps(request) + '\n' for request in requests)).splitlines()]
        responses = {reply['id']: reply for reply in replies}
        require(set(responses) == {request['id'] for request in requests}, 'MCP control replies lost a request')
        require(all('error' not in reply and not reply['result'].get('isError') for reply in replies),
                'A staged Conductor control refused the declared configuration')
        require(responses['initialize']['result']['serverInfo']['name'] == 'baton-conductor',
                'The staged adapter did not advertise its canonical Conductor identity')
        controls = {label: json.loads(responses[label]['result']['content'][0]['text']) for label, _, _ in tools}
        require(controls['player']['role'] == 'player' and controls['player']['kind'] == 'player',
                'The staged Player inspection lost its runtime responsibility')
        require({entry['id'] for entry in controls['players']} == {'root', 'worker'}, 'The Player roster lost a Conductor or Player')
        require(controls['role']['role'] == 'principal-conductor', 'The Principal Conductor tier was not recorded')
        section = cli('section-read', 'section', 'artifact-ensemble', 'git')
        require(section == {'ensemble': 'artifact-ensemble', 'id': 'git', 'capability': 'repository changes', 'members': ['worker']},
                'The declared Section lost its capability or membership')
        require(controls['orchestra']['ensembles'][0]['sections'] == [section], 'The Orchestra lost its nested Section')
        save(output / 'conductor-controls.json', {'adapter': record(adapters / 'mcp-conductor.mjs', output),
                                                'responses': responses, 'section': section})
        cli('message', 'message', 'artifact-task', 'root', 'worker', 'task', config['task'])
        require(cli('inbox-before', 'inbox', 'worker')[0]['body'] == config['task'], 'Stored task changed')
        report = cli('receive', 'receive', 'worker', native, '', '', '', working / 'native.jsonl', 'artifact-task')
        require(report['kind'] == 'report' and report['body'] == config['report'], 'Receive returned another full report')
        session = cli('player', 'player', 'worker')
        require(session['native'] == config['native'] and session['observedModel'] == 'fixture/artifact',
                'Recorded native identity or observed route differs')
        require(cli('player-inbox', 'inbox', 'worker') == [] and cli('parent-inbox', 'inbox', 'root') == [],
                'Task or parent report remains unacknowledged')
        require(cli('task-delivery', 'delivery', 'artifact-task')['receipt'] == 'artifact-worker-accepted',
                'Task acknowledgment was not retained')
        require(cli('report-delivery', 'delivery', report['id'])['receipt'] == 'artifact-parent-reviewed',
                'Parent acknowledgment was not retained')
        require((workspace / 'native-work.txt').read_text() == config['work'], 'Native work was not preserved')
        land = cli('land', 'land', 'worker', repo, 'main')
        require(land['status'] == 'landed', 'Public land did not advance the target')
        require(commands.call('landed-head', [git, '-C', repo, 'rev-parse', 'main']).strip() == land['commit'],
                'Target ref differs from the landing result')
        require(commands.call('landed-file', [git, '-C', repo, 'show', 'main:native-work.txt']) == config['work'],
                'Landed tree lost native work')
        cli('status', 'status')
        start = json.loads((output / 'native-start.json').read_text())
        complete = json.loads((output / 'native-complete.json').read_text())
        parent = json.loads((output / 'parent-delivery.json').read_text())
        require(complete['pid'] == start['pid'] and complete['stdin_eof'], 'Native completion record differs')
        require(parent['message']['body'] == config['report'], 'Parent report body differs')
        for pid, path in [(start['pid'], helper), (start['ppid'], binary), (parent['pid'], helper)]:
            wait_exit(pid, path, commands, ps)
        records = [json.loads(p.read_text()) for p in (output / 'commands').glob('*.json')]
        pids = sorted({r['pid'] for r in records} | {start['pid'], start['ppid'], parent['pid']})
        remaining = commands.call('process-closure', [ps, '-ww', '-p', ','.join(map(str, pids)),
                                                     '-o', 'pid=,ppid=,stat=,lstart=,command='], (0, 1))
        require(not remaining, 'Captured process PIDs remain; inspect the closure command output')
        require(not unavailable.exists(), 'Original build source path became available during the smoke check')
        result.update(status='passed', source=manifest['source'], binary_sha256=digest(binary),
                      extracted_prefix=str(prefix), runtime_cwd=str(working), runtime_PATH=environment['PATH'],
                      BEND_present='BEND' in environment, native_self_reexec_verified=True,
                      native_id=session['native'], observed_model=session['observedModel'],
                      full_task_and_report_equal=True, both_inboxes_empty=True, git_landing=land,
                      recorded_pids=pids, matching_pids=[], direct_subprocesses_waited=True,
                      native_wait_statuses=None,
                      fixture_python={'path':sys.executable,'sha256':digest(Path(sys.executable))},
                      scope='Extracted native artifact on this host with system libraries, Git and an external controlled Python fixture. Public land is exercised; no selected landing checks or real provider is run.')
    except Exception as error:
        result['error'] = repr(error)
        raise
    finally:
        result['ended_unix'] = time.time()
        save(output / 'summary.json', result)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] in ('--fixture-native', '--fixture-parent'):
        fixture(sys.argv[1].removeprefix('--fixture-'), Path(sys.argv[2]), sys.argv[3:])
    else:
        main()
