#!/usr/bin/env python3
"""Prepare and capture a staged OMP knowledge acceptance run.

Preparation copies a selected source revision, supplied coordinator, build log
and this driver into a new output directory. It starts no native sessions.
The parent endpoint records notifications; the operator reviews evidence,
acknowledges messages and promotes findings with the coordinator CLI.
Native capture retains every stdout byte, including cumulative message updates.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import sys
import threading
import time

SOURCE = Path(__file__).resolve().parents[2]
FINDING = 'native-reply-finding'
LOCAL_FINDING = 'producer-local-finding'
EVIDENCE = 'producer-check-evidence'
DOCUMENT = 'docs/bend2/examples/native-question-reply.md'


def save(path, value):
    temporary = path.with_name(path.name + f'.{os.getpid()}.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(argv, **kwargs):
    result = subprocess.run(list(map(str, argv)), capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: {result.stderr}')
    return result.stdout.strip()


def append(path, value):
    with path.open('ab', buffering=0) as stream:
        stream.write((json.dumps(value) + '\n').encode())


def state(db):
    if not db.exists():
        return None
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        tables = {row[0] for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        return {table: [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]
                for table in ['sessions', 'messages', 'turns', 'knowledge',
                              'knowledge_promotions', 'executions', 'session_stops']
                if table in tables}


def records(out):
    return sorted((json.loads(path.read_text()) for path in out.glob('native-*.process.json')),
                  key=lambda row: row['started_unix'])


def call(out, *arguments):
    argv = [str(out / 'baton2'), str(out / 'state.db'), *map(str, arguments)]
    started = time.time()
    result = subprocess.run(argv, capture_output=True, text=True, cwd=out / 'repo')
    append(out / 'coordinator-calls.jsonl', {'argv': argv, 'started_unix': started,
           'ended_unix': time.time(), 'exit': result.returncode,
           'stdout': result.stdout, 'stderr': result.stderr})
    if result.returncode:
        raise RuntimeError(f'Coordinator {arguments[0]} failed: {result.stderr}')
    return json.loads(result.stdout)


def owned_processes(out):
    rows = []
    for line in command(['ps', '-axo', 'pid=,ppid=,stat=,command=']).splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) == 4:
            rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                         'status': fields[2], 'command': fields[3]})
    parents = {row['pid']: row['ppid'] for row in rows}
    ancestors, pid = set(), os.getpid()
    while pid and pid not in ancestors:
        ancestors.add(pid)
        pid = parents.get(pid, 0)
    return [row for row in rows if row['pid'] not in ancestors
            and str(out) in row['command'] and not row['status'].startswith('Z')]


def quiet(out):
    remaining = owned_processes(out)
    if remaining:
        raise RuntimeError(f'Run still has owned processes: {remaining}')
    unfinished = [row for row in records(out) if 'native_exit_code' not in row]
    if unfinished:
        raise RuntimeError(f'Native capture has no exit observation: {unfinished}')


def read_run(out):
    run = json.loads((out / 'run.json').read_text())
    if digest(out / 'baton2') != run['coordinator_sha256']:
        raise RuntimeError('Prepared coordinator changed')
    if digest(Path(__file__)) != run['driver_sha256']:
        raise RuntimeError('Invoke the prepared driver.py with its retained version')
    if digest(Path(run['route']['executable'])) != run['native_executable_sha256']:
        raise RuntimeError('Prepared native executable changed')
    return run


def recruit(out, run, session):
    route = run['route']
    call(out, 'recruit', session, 'root', 'omp', route['model'], route['effort'],
         out / 'repo', f'knowledge-{session}', out / session, run['source'])
    fixture_binary = out / session / '.scratch/bend2/baton2'
    fixture_binary.parent.mkdir(parents=True)
    fixture_binary.symlink_to(out / 'baton2')
    endpoint = [str(out / 'baton2'), str(out / 'state.db'), 'receive', session,
                str(out / f'{session}-native'), '', '', '', str(out / f'{session}.jsonl')]
    call(out, 'connect', session, '', json.dumps(endpoint))


def task_text(out, phase):
    cli = shlex.join([str(out / 'baton2'), str(out / 'state.db')])
    session = 'producer' if phase == 'produce' else 'consumer'
    common = f'''Use only this run's assigned workspace and coordinator at {out}.
Read AGENTS.md. Do not recruit, push, promote findings, change credentials or
global configuration, stop processes, or run model sessions yourself. Preserve
the existing source. Use the scoped knowledge command for retrieval; do not read
the coordinator SQLite file or another worker's workspace. Acknowledge this
task after accepting it with `{cli} ack {phase}-task {session} RECEIPT`.
End your native turn after completing the task so the parent receives its report.
'''
    if phase == 'produce':
        return common + f'''
Investigate the real native-question reply behavior in
bend2/src/coordinator/native-requests.bend and docs/bend2/native-interactions.md.
Run this existing focused behavior check using the provided compiled coordinator:
  python3 -m unittest bend2.test.receive.Receive.test_native_question_parent_answers_and_waits_for_full_report
Retain its exact command, exit status and complete stdout/stderr in
.scratch/knowledge-check.txt. Record the source commit and relevant file paths.
Use those observations to identify one precise fact useful to an operator
answering a native OMP question. State its limits accurately.
First publish an evidence report with `{cli} report {EVIDENCE} producer BODY`.
Its body must include the actual command/output/status, source commit and files;
parent review will resolve those references. Then record finding {FINDING} with:
  {cli} record {FINDING} producer CLAIM message:{EVIDENCE} LIMITS
Record a second distinct evidence-backed fact from the same investigation as
{LOCAL_FINDING}, using the same evidence reference. It is a visibility control
that the parent will leave local. Do not promote either finding. Read
`{cli} knowledge producer` to verify both records, then give your final report.
Do not edit or commit tracked files in this producer task.
'''
    target = '.scratch/knowledge-fresh.json' if phase == 'fresh-consumer' else '.scratch/knowledge-read.json'
    retrieval = f'''
Retrieve current visible findings with `{cli} knowledge consumer` and retain
the complete JSON answer in {target}. The finding ID to use is {FINDING};
{LOCAL_FINDING} is a local control and must be absent from your scoped answer.
Read the finding and its evidenceMessage through that answer. Verify its author,
referenced message ID/body and promotion's exact finding, original author,
source, destination and promoting actor. Report the provenance you observed.
Do not infer a missing claim from these IDs or another workspace.
'''
    if phase == 'consume':
        return common + retrieval + f'''
Use the retrieved fact to write a concise operator example at {DOCUMENT}.
Show the actual supported commands and explain reply completion and parent
message acceptance using the finding, its evidence and the current source.
Read the relevant source to check the example. Change only this one document,
commit it on your assigned branch, and report the commit plus the finding used.
The parent will review and land the patch explicitly.
'''
    return common + retrieval + f'''
This is a fresh native conversation for the same logical consumer session and
workspace. Review your existing {DOCUMENT} against the retrieved finding and
source evidence. State whether it remains accurate, with concrete source
references. Keep tracked files unchanged. This step tests fresh-conversation
retrieval after earlier message receipts; it is not a crash-resume test.
'''


def visible_finding(out, reader):
    rows = call(out, 'knowledge', reader)
    chosen = next((row for row in rows if row['id'] == FINDING), None)
    if chosen is None:
        raise RuntimeError(f'{reader} cannot retrieve the finding')
    assert chosen['author'] == 'producer'
    assert chosen['evidence'] == 'message:' + EVIDENCE
    evidence = chosen['evidenceMessage']
    assert evidence['id'] == EVIDENCE and evidence['sender'] == 'producer'
    assert evidence['recipient'] == 'root' and evidence['body'].strip()
    if reader == 'consumer':
        assert not any(row['id'] == LOCAL_FINDING for row in rows)
        assert any(promotion == {'finding': FINDING, 'author': 'producer',
                   'source': 'producer', 'destination': 'root', 'promotedBy': 'root'}
                   for promotion in chosen['promotions'])
    return rows


def verify_phase(out, phase, run, before):
    quiet(out)
    session = 'producer' if phase == 'produce' else 'consumer'
    current = call(out, 'session', session)
    assert current['native'] and current['observedModel'] == run['route']['model'], current
    assert call(out, 'inbox', session) == []
    new = [row for row in records(out) if row['wrapper_pid'] not in before]
    assert len(new) == 1 and new[0]['native_exit_code'] == 0, new
    messages = state(out / 'state.db')['messages']
    reports = [row for row in messages if row['sender'] == session
               and row['kind'] == 'report' and row['id'] != EVIDENCE
               and row['receipt'] is None]
    assert reports and all(row['body'].strip() for row in reports)
    deliveries = [json.loads(line) for line in (out / 'parent-deliveries.jsonl').read_text().splitlines()]
    delivered = {row['message']['id']: row['message'] for row in deliveries}
    assert all(row['id'] in delivered and delivered[row['id']]['body'] == row['body'] for row in reports)
    if phase == 'produce':
        seen = visible_finding(out, 'root')
        assert {row['id'] for row in seen} == {FINDING, LOCAL_FINDING}
        assert not any(row['promotions'] for row in seen)
        assert command(['git', '-C', out / session, 'diff', '--name-only', run['source']]) == ''
    else:
        seen = visible_finding(out, 'consumer')
        capture = out / session / ('.scratch/knowledge-fresh.json' if phase == 'fresh-consumer'
                                   else '.scratch/knowledge-read.json')
        assert json.loads(capture.read_text()) == seen
        changes = command(['git', '-C', out / session, 'diff', '--name-only', run['source']]).splitlines()
        assert changes == [DOCUMENT], changes
        assert command(['git', '-C', out / session, 'diff', '--name-only', 'HEAD']) == ''
        assert (out / session / DOCUMENT).read_text().strip()
    result = {'phase': phase, 'completed_unix': time.time(), 'session': current,
              'native_capture': new[0], 'visible_findings': seen, 'reports': reports,
              'workspace_head': command(['git', '-C', out / session, 'rev-parse', 'HEAD']),
              'state': state(out / 'state.db')}
    if phase == 'fresh-consumer':
        prior = json.loads((out / 'consume-result.json').read_text())
        assert current['native'] != prior['session']['native']
        assert current['id'] == prior['session']['id']
        assert current['workspace'] == prior['session']['workspace']
        assert result['workspace_head'] == prior['workspace_head']
        assert result['visible_findings'] == prior['visible_findings']
        result['retrieval_scope'] = 'Fresh native conversation in the same logical consumer session.'
    save(out / f'{phase}-result.json', result)
    print(out / f'{phase}-result.json')


def run_phase(out, phase):
    run = read_run(out)
    if (out / f'{phase}-command.json').exists():
        raise RuntimeError('This phase already has an invocation; inspect its retained evidence')
    quiet(out)
    before = {row['wrapper_pid'] for row in records(out)}
    try:
        if phase == 'produce':
            if (out / 'state.db').exists():
                raise RuntimeError('Producer phase requires a new prepared database path')
            call(out, 'attach', 'root', 'terminal', '', json.dumps(run['parent_endpoint']))
            recruit(out, run, 'producer')
        else:
            predecessor = 'produce' if phase == 'consume' else 'consume'
            if not (out / f'{predecessor}-result.json').exists():
                raise RuntimeError(f'Complete {predecessor} before {phase}')
            if call(out, 'inbox', 'root'):
                raise RuntimeError('Root must review and acknowledge its pending messages before the next phase')
            if phase == 'consume':
                recruit(out, run, 'consumer')
            else:
                current = call(out, 'session', 'consumer')
                if call(out, 'inbox', 'consumer'):
                    raise RuntimeError('Consumer still owes input acceptance')
                save(out / 'before-fresh-context.json', inspect_run(out))
                call(out, 'connect', 'consumer', '', current['endpoint'])
            visible_finding(out, 'consumer')
        task = out / f'{phase}-task.md'
        task.write_text(task_text(out, phase))
        session = 'producer' if phase == 'produce' else 'consumer'
        argv = [str(out / 'baton2'), str(out / 'state.db'), 'message-file',
                f'{phase}-task', 'root', session, 'task', str(task)]
        entry = {'argv': argv, 'started_unix': time.time(), 'task_sha256': digest(task)}
        with (out / f'{phase}.stdout').open('wb') as stdout, \
                (out / f'{phase}.stderr').open('wb') as stderr:
            child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, cwd=out / 'repo',
                                     start_new_session=True)
            entry['pid'] = child.pid
            save(out / f'{phase}-command.json', entry)
            entry.update(exit=child.wait(), ended_unix=time.time())
        save(out / f'{phase}-command.json', entry)
        if entry['exit']:
            raise RuntimeError(f'Phase {phase} delivery exited {entry["exit"]}; read retained output')
        verify_phase(out, phase, run, before)
    except BaseException as error:
        save(out / f'{phase}-failure.json', {'error': repr(error), **inspect_run(out)})
        raise


def inspect_run(out):
    return {'captured_unix': time.time(), 'state': state(out / 'state.db'),
            'native_processes': records(out),
            'process_snapshot': command(['ps', '-axo', 'pid=,ppid=,pgid=,stat=,command='])}


def collect(out, ident):
    with sqlite3.connect(f'{(out / "state.db").as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute('SELECT * FROM messages WHERE id=?', (ident,)).fetchone()
        if row is None or row['recipient'] != 'root':
            raise RuntimeError('Parent endpoint received an unknown or differently addressed message')
        message = dict(row)
    append(out / 'parent-deliveries.jsonl',
           {'received_unix': time.time(), 'pid': os.getpid(), 'message': message})
    print(json.dumps({'received': ident, 'receipt_written': False}))


def observe_frame(frame, number, offset):
    """Preserve native identity, model and usage fields with their raw locations."""
    observed = {'line': number, 'offset': offset, 'type': frame.get('type')}
    if frame.get('type') == 'response' and frame.get('command') == 'get_state':
        observed['state_response'] = frame
    message = frame.get('message')
    if isinstance(message, dict):
        for key in ['provider', 'model', 'usage', 'stopReason']:
            if key in message:
                observed[key] = message[key]
    for key in ['usage', 'cost', 'model', 'sessionId']:
        if key in frame:
            observed[key] = frame[key]
    return observed if len(observed) > 3 else None


def native_capture(out, session, arguments):
    run = json.loads((out / 'run.json').read_text())
    stem = out / f'native-{session}-{os.getpid()}'
    argv = [run['route']['executable'], *arguments]
    row = {'session': session, 'wrapper_pid': os.getpid(), 'ppid': os.getppid(),
           'argv': argv, 'started_unix': time.time(),
           'stdout': str(stem.with_suffix('.stdout.jsonl')),
           'stderr': str(stem.with_suffix('.stderr.txt')),
           'events': str(stem.with_suffix('.events.jsonl'))}
    record = stem.with_suffix('.process.json')
    save(record, row)
    try:
        child = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        row.update(native_pid=child.pid, native_started_unix=time.time())
        save(record, row)

        def retain_stderr():
            with child.stderr, Path(row['stderr']).open('wb') as output:
                while data := child.stderr.read1(65536):
                    output.write(data)
                    output.flush()
                    sys.stderr.buffer.write(data)
                    sys.stderr.buffer.flush()

        errors = threading.Thread(target=retain_stderr)
        errors.start()
        observations = []
        with child.stdout, Path(row['stdout']).open('wb') as output, \
                Path(row['events']).open('w') as events:
            for number, line in enumerate(child.stdout, 1):
                offset = output.tell()
                output.write(line)
                output.flush()
                event = {'line': number, 'offset': offset, 'bytes': len(line),
                         'received_unix': time.time()}
                try:
                    frame = json.loads(line)
                except ValueError:
                    frame = None
                if isinstance(frame, dict):
                    event.update({key: frame[key] for key in
                                  ['type', 'command', 'id', 'success', 'isTerminal'] if key in frame})
                    observed = observe_frame(frame, number, offset)
                    if observed is not None:
                        observations.append(observed)
                events.write(json.dumps(event) + '\n')
                events.flush()
                sys.stdout.buffer.write(line)
                sys.stdout.buffer.flush()
        code = child.wait()
        errors.join()
        row.update(ended_unix=time.time(), native_exit_code=code,
                   stdout_sha256=digest(Path(row['stdout'])),
                   stderr_sha256=digest(Path(row['stderr'])), observations=observations)
        save(record, row)
        return code if code >= 0 else 128 - code
    except BaseException as error:
        row.update(capture_error=repr(error), failure_unix=time.time())
        save(record, row)
        raise


def prepare(args):
    source, supplied, build = (path.resolve() for path in
                              [args.source, args.coordinator, args.build_log])
    route = json.loads(args.config.read_text())['omp']
    route = {key: route[key] for key in ['executable', 'model', 'effort']}
    route['executable'] = str(Path(shutil.which(route['executable']) or route['executable']).resolve())
    if not all(path.is_file() for path in [supplied, build, Path(route['executable'])]):
        raise RuntimeError('Coordinator, build log and configured OMP executable must exist')
    revision = command(['git', '-C', source, 'rev-parse', f'{args.revision}^{{commit}}'])
    command(['git', '-C', source, 'diff', '--exit-code', revision, '--', 'bend2/src'])
    if command(['git', '-C', source, 'ls-files', '--others', '--exclude-standard', '--', 'bend2/src']):
        raise RuntimeError('Select committed runtime source before preparing acceptance')
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    try:
        repo = out / 'repo'
        command(['git', 'clone', '--shared', '--no-checkout', source, repo])
        command(['git', '-C', repo, 'checkout', '-b', 'knowledge-acceptance', revision])
        driver = out / 'driver.py'
        shutil.copy2(__file__, driver)
        shutil.copy2(supplied, out / 'baton2')
        shutil.copy2(build, out / 'build.log')
        runtime = {str(path.relative_to(repo)): digest(path)
                   for path in sorted((repo / 'bend2/src').rglob('*')) if path.is_file()}
        run = {'prepared_unix': time.time(), 'source_directory': str(source), 'source': revision,
               'source_tree': command(['git', '-C', source, 'rev-parse', f'{revision}^{{tree}}']),
               'runtime_files': runtime, 'coordinator_sha256': digest(out / 'baton2'),
               'coordinator_origin': str(supplied), 'build_log_origin': str(build),
               'build_log_sha256': digest(out / 'build.log'), 'driver_sha256': digest(driver),
               'binary_source_linkage': 'Caller supplied; compare the retained build evidence and runtime manifest.',
               'route': route, 'native_executable_sha256': digest(Path(route['executable'])),
               'native_version': command([route['executable'], '--version']),
               'parent_endpoint': [sys.executable, str(driver), '_collect', '--output', str(out)],
               'evidence_format': 'message:<existing-message-id>',
               'knowledge_commands': ['record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS',
                                      'knowledge READER',
                                      'promote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING']}
        save(out / 'run.json', run)
        for session in ['producer', 'consumer']:
            path = out / f'{session}-native'
            path.write_text('#!/bin/sh\nexec ' + shlex.join(
                [sys.executable, str(driver), '_native', '--output', str(out),
                 '--session', session, '--']) + ' "$@"\n')
            path.chmod(0o700)
        save(out / 'prepared.json', {'source': revision, 'database_created': False,
                                    'native_sessions_started': False})
        print(out / 'run.json')
    except BaseException as error:
        save(out / 'prepare-failure.json', {'error': repr(error), 'unix': time.time()})
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    prep = sub.add_parser('prepare', help='Pin an isolated run without starting model sessions')
    prep.add_argument('--source', type=Path, default=SOURCE)
    prep.add_argument('--revision', default='HEAD')
    prep.add_argument('--coordinator', type=Path, required=True)
    prep.add_argument('--build-log', type=Path, required=True)
    prep.add_argument('--config', type=Path, required=True)
    prep.add_argument('--output', type=Path, required=True)
    snapshot = sub.add_parser('snapshot', help='Retain database rows and process observations')
    snapshot.add_argument('--output', type=Path, required=True)
    for phase in ['produce', 'consume', 'fresh-consumer']:
        stage = sub.add_parser(phase, help='Start one authorized real OMP task and retain its result')
        stage.add_argument('--output', type=Path, required=True)
    capture = sub.add_parser('_native', help=argparse.SUPPRESS)
    capture.add_argument('--output', type=Path, required=True)
    capture.add_argument('--session', required=True)
    capture.add_argument('arguments', nargs=argparse.REMAINDER)
    endpoint = sub.add_parser('_collect', help=argparse.SUPPRESS)
    endpoint.add_argument('--output', type=Path, required=True)
    endpoint.add_argument('message')
    args = parser.parse_args()
    args.output = args.output.resolve()
    if args.action == 'prepare':
        prepare(args)
    elif args.action == 'snapshot':
        path = args.output / f'snapshot-{time.time_ns()}.json'
        save(path, inspect_run(args.output))
        print(path)
    elif args.action == '_collect':
        collect(args.output, args.message)
    elif args.action == '_native':
        arguments = args.arguments[1:] if args.arguments[:1] == ['--'] else args.arguments
        return native_capture(args.output, args.session, arguments)
    else:
        run_phase(args.output, args.action)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
