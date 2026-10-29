#!/usr/bin/env python3
"""Submit Linux CI compiler invocations to the installed shared compile queue."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import signal
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
import time
import uuid

# The queue installs the same client here and in its retained directory; only this path is
# reachable from every homelab runner (each runner service binds /var/tmp/baton2-compile-queue).
CLIENT = '/var/tmp/baton2-compile-queue/compile-queue-runner'
STATE = '/var/tmp/baton2-compile-queue'
SCRIPT = str(Path(__file__).resolve())
EXEC_SCRIPT = str(Path(__file__).resolve().parent / 'compile-cgen-exec.py')
DIAGNOSTIC_FILE = 'compiler-diagnostics.json'

# These exact names are read by the pinned Bend compiler source or its Bun/JSC
# runtime. BEND_BASE is not read by the pinned source. BUN_OPTIONS is retained
# as presence state only because its arbitrary contents can contain secrets.
# Malloc is a Darwin allocator setting and is not consumed by the Linux runner.
COMPILER_ENVIRONMENT = (
    'BEND_CGEN_CACHE_DIR',
    'BEND_COMPILER_DIAGNOSTICS',
    'BEND_FACTS_ONLY_FIRST',
    'BEND_LIB',
    'BEND_NO_TELEMETRY',
    'BUN_OPTIONS',
    'BUN_JSC_maxPerThreadStackUsage',
    'BATON2_DARWIN_LLVM_ROOT',
    'BATON2_DARWIN_SDKROOT',
    'BATON2_DARWIN_SDK_MANIFEST_SHA256',
    'BATON2_DARWIN_SDK_TREE_SHA256',
)


# Builds of the protected branch share one compiled-unit cache directory under the
# queue state root. A unit variant is checked by content digest only, so a build that
# can write the directory can publish a forged variant. Pull request builds, and
# dispatches of any other ref, keep the per-runner cache of their own home.
TRUSTED_CGEN_REF = 'refs/heads/main'
TRUSTED_CGEN_EVENTS = ('push', 'workflow_dispatch', 'schedule')
TRUSTED_CGEN_DIRECTORY = 'cgen-cache'


def select_cgen_cache(state, environment):
    """Name the shared cache directory for a protected-branch build, or return None.

    An explicit BEND_CGEN_CACHE_DIR in the environment stays as set. The directory is
    created with the queue's group-writable mode when it is missing.
    """
    if environment.get('BEND_CGEN_CACHE_DIR'):
        return None
    if environment.get('GITHUB_REF') != TRUSTED_CGEN_REF \
            or environment.get('GITHUB_EVENT_NAME') not in TRUSTED_CGEN_EVENTS:
        return None
    directory = Path(state) / TRUSTED_CGEN_DIRECTORY
    try:
        if not directory.is_dir():
            directory.mkdir(mode=0o2770, exist_ok=True)
            directory.chmod(0o2770)
    except OSError as error:
        sys.stderr.write('shared compiled-unit cache unavailable: ' + str(error) + '\n')
        return None
    return str(directory)


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def write_json_atomic(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


@contextmanager
def exclusive_lock(path):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def registry_lock(run):
    return exclusive_lock(Path(run) / 'compile-queue.lock')


def output_lock_path(run, output):
    identity = os.path.normcase(os.path.realpath(os.fspath(output)))
    name = hashlib.sha256(os.fsencode(identity)).hexdigest()
    return Path(run) / 'evidence/compile-queue/.locks' / (name + '.lock')


def cancellation_marker(run):
    return Path(run) / 'evidence/compile-queue/cancel-all.json'


def process_identity(pid):
    try:
        fields = Path('/proc') / str(pid) / 'stat'
        raw = fields.read_text()
        tail = raw[raw.rfind(')') + 2:].split()
        return {'state': tail[0], 'starttime': tail[19]}
    except (OSError, IndexError):
        return None


def publisher_alive(request):
    pid = request.get('publisher_pid')
    starttime = request.get('publisher_starttime')
    if pid is None or starttime is None:
        return True
    current = process_identity(pid)
    return current is not None and current['state'] != 'Z' and current['starttime'] == starttime


def write_focused_queue_handoff(config, request, directory, state, **extra):
    """Record the exact queue token so focused cancellation preserves shared custody."""
    handoff_root = os.environ.get('BATON2_FOCUSED_QUEUE_HANDOFF_DIR')
    if not handoff_root:
        return
    client = shutil.which(config['client']) or config['client']
    record = {'schema': 'baton2-focused-queue-owner-v1', 'status': state,
              'key': request['key'], 'token': request['token'],
              'state_root': str(Path(config['state']).resolve()),
              'keydir': str((Path(config['state']) / 'keys' / request['key']).resolve()),
              'client': str(Path(client).resolve()),
              'request_path': str((Path(directory) / 'request.json').resolve()),
              **extra}
    path = Path(handoff_root) / (request['token'] + '.json')
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(record, indent=2, sort_keys=True) + '\n')
    os.replace(temporary, path)


def file_identity(path):
    path = Path(path)
    if not path.is_file():
        return {'status': 'unavailable'}
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return {'status': 'observed', 'path': str(path.resolve()),
            'size_bytes': path.stat().st_size, 'sha256': digest.hexdigest()}


def environment_observation(name, environment):
    if name not in environment:
        if name == 'BEND_LIB':
            return {'state': 'absent', 'effective_path': str(Path.home() / '.bend' / 'lib')}
        return {'state': 'absent'}
    value = environment[name]
    if value == '':
        if name == 'BEND_LIB':
            return {'state': 'empty', 'effective_path': str(Path.cwd())}
        return {'state': 'empty'}
    if name == 'BUN_OPTIONS':
        return {'state': 'set', 'value': 'omitted because option text may contain secrets'}
    if name in ('BEND_LIB', 'BEND_CGEN_CACHE_DIR'):
        return {'state': 'set', 'effective_path': str(Path(value).resolve())}
    if name in ('BATON2_DARWIN_LLVM_ROOT', 'BATON2_DARWIN_SDKROOT'):
        return {'state': 'set', 'effective_path': str(Path(value).resolve())}
    if name in ('BATON2_DARWIN_SDK_MANIFEST_SHA256', 'BATON2_DARWIN_SDK_TREE_SHA256'):
        return {'state': 'set', 'sha256': value}
    if name == 'BEND_COMPILER_DIAGNOSTICS' or name == 'BEND_FACTS_ONLY_FIRST':
        return {'state': 'set', 'enabled': value == '1'}
    if name == 'BEND_NO_TELEMETRY':
        return {'state': 'set', 'enabled': bool(value)}
    if value.isdecimal():
        return {'state': 'set', 'value': int(value)}
    return {'state': 'set', 'value': 'non-decimal value omitted'}


def read_queue_meta(attempt):
    values = {}
    for line in (attempt / 'meta').read_text(errors='replace').splitlines():
        key, separator, value = line.partition('=')
        if separator and key in ('kind', 'cwd', 'source_root', 'entry', 'key', 'artifact_name'):
            values[key] = value
    return values


def toolchain_identity(compiler_path):
    compiler = Path(compiler_path).resolve()
    compiler_record = file_identity(compiler)
    root = compiler.parent.parent
    result = {'compiler': compiler_record, 'runtime': {'status': 'unavailable'},
              'manifest': {'status': 'unavailable'}, 'deployment': {'status': 'unavailable'}}
    manifest_path = root / 'fork-manifest.json'
    runtime_path = root / 'bin' / 'bun'
    runtime_record = file_identity(runtime_path)
    result['runtime'] = runtime_record
    if manifest_path.is_file():
        try:
            manifest_bytes = manifest_path.read_bytes()
            manifest = json.loads(manifest_bytes)
            if isinstance(manifest, dict):
                manifest_compiler = manifest.get('compiler', {})
                manifest_runtime = manifest.get('bun', {})
                if not isinstance(manifest_compiler, dict):
                    manifest_compiler = {}
                if not isinstance(manifest_runtime, dict):
                    manifest_runtime = {}
                compiler_matches = (compiler_record.get('sha256') is not None
                                    and compiler_record['sha256'] == manifest_compiler.get('sha256'))
                runtime_matches = (runtime_record.get('sha256') is not None
                                   and runtime_record['sha256'] == manifest_runtime.get('sha256'))
                result.update({
                    'compiler': {**compiler_record,
                                 'version': manifest.get('upstream_version') if compiler_matches else None,
                                 'source_commit': manifest.get('source_commit') if compiler_matches else None,
                                 'source_tree': manifest.get('source_tree') if compiler_matches else None},
                    'runtime': {**runtime_record,
                                'version': manifest.get('bun_version') if runtime_matches else None,
                                'revision': manifest.get('bun_revision') if runtime_matches else None},
                    'manifest': {'status': 'observed', 'path': str(manifest_path.resolve()),
                                 'sha256': hashlib.sha256(manifest_bytes).hexdigest(),
                                 'compiler_matches': compiler_matches,
                                 'runtime_matches': runtime_matches,
                                 'archive_sha256': manifest.get('archive_sha256'),
                                 'runtime_arguments': manifest.get('runtime_arguments')},
                })
        except (OSError, ValueError):
            pass
    deployment_path = root / 'deployment.json'
    if deployment_path.is_file():
        try:
            deployment_bytes = deployment_path.read_bytes()
            deployment = json.loads(deployment_bytes)
            if not isinstance(deployment, dict):
                raise ValueError('Invalid deployment metadata')
            result['deployment'] = {
                'status': 'observed', 'sha256': hashlib.sha256(deployment_bytes).hexdigest(),
                'archive_sha256': deployment.get('archive_sha256'),
                'source_tree': deployment.get('source_tree'),
                'compiler_commit': deployment.get('compiler_commit'),
            }
        except (OSError, ValueError):
            pass
    return result


def compiler_diagnostics(attempt, compiler_argv):
    """Best-effort execution evidence, written when the attempt is retained."""
    try:
        if not (attempt / 'meta').is_file() or not compiler_argv:
            return
        source_digest = (attempt / 'source-digest').read_text(errors='replace').strip()
        metadata = {
            'schema': 'baton2-compiler-execution-observation-v1',
            'observed_at': datetime.now(timezone.utc).isoformat(),
            'boundary': 'queue adapter evidence retention after the executed wrapper returned',
            'process': {'pid': os.getpid(), 'cwd': str(Path.cwd())},
            'cpu_affinity': {'status': 'unavailable'},
            'environment': {name: environment_observation(name, os.environ)
                            for name in COMPILER_ENVIRONMENT},
            'compiler_argv': compiler_argv,
            'toolchain': toolchain_identity(compiler_argv[0]),
            'queue_attempt': {
                'meta': read_queue_meta(attempt),
                'meta_sha256': hashlib.sha256((attempt / 'meta').read_bytes()).hexdigest(),
                'argv_sha256': hashlib.sha256((attempt / 'argv').read_bytes()).hexdigest(),
                'command_sha256': hashlib.sha256((attempt / 'command').read_bytes()).hexdigest(),
                'source_digest': source_digest,
            },
            'queue_adapter': file_identity(SCRIPT),
            'queue_exec': file_identity(EXEC_SCRIPT),
        }
        if hasattr(os, 'sched_getaffinity'):
            try:
                metadata['cpu_affinity'] = {
                    'status': 'observed', 'cpus': sorted(os.sched_getaffinity(0))}
            except OSError:
                pass
        destination = attempt / DIAGNOSTIC_FILE
        temporary = attempt / (DIAGNOSTIC_FILE + '.' + str(os.getpid()) + '.tmp')
        temporary.write_text(json.dumps(metadata, indent=2) + '\n')
        os.replace(temporary, destination)
    except Exception:
        # A missing or unwritable evidence path must not change compiler execution.
        return


def environment(run):
    """Enable the build-native.sh compiler hooks for this Linux job."""
    run = Path(run).resolve()
    config = {'run': str(run), 'bend': str(Path(os.environ['BEND']).resolve()),
              'cc': str(Path(shutil.which(os.environ['CC'])).resolve()),
              'client': CLIENT, 'state': STATE}
    write(run / 'queue-config.json', config)
    return dict(os.environ, BATON2_NATIVE_QUEUE=str(run / 'queue-config.json'),
                BATON2_NATIVE_QUEUE_DRIVER=SCRIPT)


def legacy_environment(env):
    """Queue an old target build through its existing BEND and CC inputs."""
    config = json.loads(Path(env['BATON2_NATIVE_QUEUE']).read_text())
    directory = Path(config['run']) / 'queue-bin'
    directory.mkdir()
    for name, mode in [('bend', 'bend'), ('cc', 'cc')]:
        actual = config['bend' if mode == 'bend' else 'cc']
        # The lineage reader follows this literal exec target to the real release.
        literal = actual.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('`', '\\`')
        path = directory / name
        path.write_text('#!/bin/sh\ncase "${1:-}" in\nversion|--version)\n'
                        'exec "' + literal + '" "$@"\n;;\nesac\n'
                        'exec ' + shlex.join([sys.executable, SCRIPT, 'compiler', mode]) + ' "$@"\n')
        path.chmod(0o755)
    return dict(env, BATON2_NATIVE_QUEUE_DRIVER='',
                BEND=str(directory / 'bend'), CC=str(directory / 'cc'))


def cancel(config, request, directory):
    directory = Path(directory)
    request_path = directory / 'request.json'
    with exclusive_lock(directory / '.cancel.lock'):
        with registry_lock(config['run']):
            current = json.loads(request_path.read_text()) if request_path.is_file() else dict(request)
            if current.get('key_only') or current.get('exit_code') is not None:
                return 0
            if current.get('cancel_returncode') is not None:
                request.update(current)
                return current['cancel_returncode']
            current['cancel_requested_ns'] = time.time_ns()
            write_json_atomic(request_path, current)

        cancel_argv = [config['client'], '--', 'cancel', '--state-root', config['state'],
                       '--key', request['key'], '--token', request['token']]
        owner_path = Path(config['state']) / 'keys' / request['key'] / 'owners' / request['token']
        cancel_returncode = 0
        cancel_result = []
        attempted = False
        with (directory / 'cancel.stdout').open('wb') as stdout, \
                (directory / 'cancel.stderr').open('wb') as stderr:
            while True:
                if attempted and not owner_path.is_file():
                    with registry_lock(config['run']):
                        try:
                            current = json.loads(request_path.read_text())
                        except (OSError, ValueError):
                            current = {}
                    if current.get('exit_code') is not None or not publisher_alive(current):
                        cancel_result = ['canceled=publisher-finished-before-publication']
                        break
                    time.sleep(0.025)
                    continue
                result = subprocess.run(cancel_argv, capture_output=True)
                attempted = True
                stdout.write(result.stdout or b'')
                stdout.flush()
                stderr.write(result.stderr or b'')
                stderr.flush()
                output = (result.stdout or b'').decode(errors='replace').splitlines()
                cancel_result = [line for line in output
                                 if line.startswith('canceled=') or line.startswith('owners=')]
                cancel_returncode = result.returncode
                if result.returncode != 0:
                    break
                if 'canceled=unknown-token' in cancel_result or 'canceled=none' in cancel_result:
                    continue
                break
        with registry_lock(config['run']):
            current = json.loads(request_path.read_text()) if request_path.is_file() else dict(request)
            current['cancel_returncode'] = cancel_returncode
            current['cancel_result'] = cancel_result
            write_json_atomic(request_path, current)
            write_focused_queue_handoff(config, current, directory, 'cancelled',
                                        cancel_returncode=cancel_returncode,
                                        cancel_result=cancel_result)
        request.update(current)
        return cancel_returncode

def cancel_all(config):
    run = Path(config['run'])
    evidence = run / 'evidence/compile-queue'
    evidence.mkdir(parents=True, exist_ok=True)
    marker = cancellation_marker(run)
    requests = []
    with registry_lock(run):
        if not marker.exists():
            write_json_atomic(marker, {
                'schema': 'baton2-compile-queue-run-cancel-v1',
                'requested_ns': time.time_ns(),
            })
        for request_path in sorted(evidence.glob('*/request.json')):
            try:
                request = json.loads(request_path.read_text())
            except (OSError, ValueError):
                continue
            if request.get('key_only') or request.get('exit_code') is not None:
                continue
            requests.append((request, request_path.parent))
    codes = [cancel(config, request, directory) for request, directory in requests]
    return int(any(codes))

def queue_key_sources(key_argv, cwd):
    """Identify source inputs named by a key request without retaining their contents."""
    outer = key_argv.index('--')
    separator = key_argv.index('--', outer + 1)
    options = key_argv[outer + 2:separator]
    command = key_argv[separator + 1:]
    paths = []
    for flag in ('--entry', '--compiler', '--aux'):
        index = 0
        while index < len(options):
            if options[index] == flag and index + 1 < len(options):
                paths.append((flag[2:], options[index + 1]))
                index += 2
            else:
                index += 1
    for value in command:
        if not value.startswith('-'):
            path = Path(cwd, value)
            if path.is_file():
                paths.append(('command-input', value))
    identities = []
    seen = set()
    for role, value in paths:
        path = Path(value)
        if not path.is_absolute():
            path = Path(cwd) / path
        path = path.resolve()
        if str(path) in seen:
            continue
        seen.add(str(path))
        identities.append({'role': role, 'identity': file_identity(path)})
    return identities


def run_queue_key(key_argv, config, directory):
    """Run and retain a failed key request before returning its process status."""
    cwd = str(Path.cwd())
    started_ns = time.time_ns()
    child = subprocess.run(key_argv, cwd=cwd, capture_output=True)
    if child.stderr:
        sys.stderr.buffer.write(child.stderr)
        sys.stderr.buffer.flush()
    if child.returncode:
        (directory / 'key.stdout').write_bytes(child.stdout)
        (directory / 'key.stderr').write_bytes(child.stderr)
        metadata = {
            'schema': 'baton2-compile-queue-key-failure-v1',
            'argv': key_argv,
            'cwd': cwd,
            'exit_code': child.returncode,
            'started_ns': started_ns,
            'finished_ns': time.time_ns(),
            'queue_binary': file_identity(config['client']),
            'queue_adapter': file_identity(SCRIPT),
            'sources': queue_key_sources(key_argv, cwd),
            'stdout': 'key.stdout',
            'stderr': 'key.stderr',
        }
        write(directory / 'failed-key.json', metadata)
        if child.returncode < 0:
            signum = -child.returncode
            if signum not in (signal.SIGKILL, signal.SIGSTOP):
                signal.signal(signum, signal.SIG_DFL)
            os.kill(os.getpid(), signum)
            return 128 + signum, None
        return child.returncode, None
    return 0, child.stdout.decode(errors='replace').strip()


def retain(config, key, directory, success):
    keydir = Path(config['state']) / 'keys' / key
    result = keydir / 'completed/result'
    if not success:
        results = list((keydir / 'runs').glob('*/result'))
        result = max(results, key=lambda p: p.stat().st_mtime_ns) if results else result
    if not result.is_file():
        return
    shutil.copyfile(result, directory / 'queue-result')
    fields = dict(line.split('=', 1) for line in result.read_text().splitlines() if '=' in line)
    attempt = Path(fields['attempt'])
    for name in ('stdout', 'stderr', 'meta', 'command', 'source-digest'):
        source = attempt / name
        if source.is_file():
            shutil.copyfile(source, directory / name)
    request_path = directory / 'request.json'
    if request_path.is_file():
        request_command = json.loads(request_path.read_text()).get('command') or []
        executed = len(request_command) > 3 and Path(request_command[1]).name == Path(EXEC_SCRIPT).name
        compiler_argv = request_command[3:] if executed else request_command
        compiler_diagnostics(attempt, compiler_argv)
    diagnostics = attempt / DIAGNOSTIC_FILE
    try:
        if diagnostics.is_file():
            shutil.copyfile(diagnostics, directory / DIAGNOSTIC_FILE)
    except OSError:
        pass
    for name, stream in [('stdout', sys.stdout.buffer), ('stderr', sys.stderr.buffer)]:
        path = directory / name
        if path.is_file():
            with path.open('rb') as source:
                shutil.copyfileobj(source, stream)
            stream.flush()


def queue_priority(config):
    """Scheduling priority for this request; never part of the cache key."""
    value = str(config.get('priority') or os.environ.get('BATON2_COMPILE_QUEUE_PRIORITY') or '0')
    return value if value.isdigit() else '0'


def submit(config, directory, options, command, key_only=False):
    common = ['--state-root', config['state'], '--cwd', str(Path.cwd()),
              '--root', str(Path.cwd()), *options, '--', *command]
    key_argv = [config['client'], '--', 'key', *common]
    key_code, key = run_queue_key(key_argv, config, directory)
    if key_code:
        return key_code
    token = uuid.uuid4().hex
    request = {'key': key, 'token': token, 'cwd': str(Path.cwd()), 'command': command,
               'key_argv': key_argv, 'started_ns': time.time_ns()}
    run_common = list(common)
    priority = queue_priority(config)
    if priority != '0':
        separator = run_common.index('--')
        run_common[separator:separator] = ['--priority', priority]
    request['priority'] = priority
    argv = [config['client'], '--', 'run', '--token', token, '--receipt', str(directory / 'receipt'), *run_common]
    request['argv'] = argv
    if key_only:
        request['key_only'] = True
        request.update(exit_code=0, finished_ns=time.time_ns())
        with registry_lock(config['run']):
            write_json_atomic(directory / 'request.json', request)
        print(key)
        return 0

    child = None

    def interrupted(signum, frame):
        raise InterruptedError(signum)

    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        with registry_lock(config['run']):
            if cancellation_marker(config['run']).is_file():
                request.update(cancelled_before_submit=True, exit_code=130,
                               finished_ns=time.time_ns(), cancel_returncode=0,
                               cancel_result=['not-submitted=run-cancelled'])
                write_json_atomic(directory / 'request.json', request)
                write_focused_queue_handoff(config, request, directory, 'cancelled',
                                            cancel_returncode=0,
                                            cancel_result=request['cancel_result'])
                return 130
            write_json_atomic(directory / 'request.json', request)
            write_focused_queue_handoff(config, request, directory, 'submitted')
            with (directory / 'client.stdout').open('wb') as stdout, \
                    (directory / 'client.stderr').open('wb') as stderr:
                child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
            publisher_pid = getattr(child, 'pid', None)
            if publisher_pid is not None:
                request['publisher_pid'] = publisher_pid
                identity = process_identity(publisher_pid)
                if identity is not None:
                    request['publisher_starttime'] = identity['starttime']
                write_json_atomic(directory / 'request.json', request)
        code = child.wait()
    except InterruptedError as error:
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        # Stop publication before withdrawing the recorded owner token.
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait()
        cancel(config, request, directory)
        code = 128 + error.args[0]
    except OSError as error:
        with registry_lock(config['run']):
            request.update(exit_code=127, finished_ns=time.time_ns(),
                           launch_error=str(error))
            write_json_atomic(directory / 'request.json', request)
            write_focused_queue_handoff(config, request, directory, 'finished', exit_code=127)
        raise
    with registry_lock(config['run']):
        request_path = directory / 'request.json'
        try:
            registered = json.loads(request_path.read_text())
        except (OSError, ValueError):
            registered = {}
        for name in ('cancel_requested_ns', 'cancel_returncode', 'cancel_result'):
            if name in registered:
                request[name] = registered[name]
        request.update(exit_code=code, finished_ns=time.time_ns())
        write_json_atomic(request_path, request)
        if request.get('cancel_returncode') is None:
            write_focused_queue_handoff(config, request, directory, 'finished', exit_code=code)
    retain(config, key, directory, code == 0)
    if code:
        stderr_path = directory / 'client.stderr'
        if stderr_path.is_file():
            sys.stderr.write(stderr_path.read_text())
    return code

def compiler(mode, argv, key_only=False):
    config = json.loads(Path(os.environ['BATON2_NATIVE_QUEUE']).read_text())
    cache = select_cgen_cache(config['state'], os.environ)
    if cache is not None:
        os.environ['BEND_CGEN_CACHE_DIR'] = cache
    run = Path(config['run'])
    evidence = run / 'evidence/compile-queue'
    evidence.mkdir(parents=True, exist_ok=True)
    directory = evidence / uuid.uuid4().hex
    directory.mkdir()
    if mode == 'bend' and '--check-only' in argv:
        entries = [value for value in argv[1:]
                   if value.endswith('.bend') and Path(value).is_file()]
        if len(entries) != 1:
            raise SystemExit('queued Bend check requires exactly one existing .bend entry')
        actual = str(Path(shutil.which(argv[0]) or argv[0]).resolve())
        entry = str(Path(entries[0]).resolve())
        options = ['--kind', 'check', '--source-root', str(Path.cwd()),
                   '--entry', os.path.relpath(entry), '--compiler', actual]
        # The adapter's own bytes stay out of the cache key: key material
        # covers only execution-affecting closure (source, toolchain, argv,
        # inputs, artifacts, options). The adapter identity is execution
        # evidence, recorded per attempt by compiler_diagnostics().
        with exclusive_lock(run / 'compile-queue-bend.lock'):
            return submit(config, directory, options, argv, key_only)

    output_flag = '--binary' if '--binary' in argv else '-o'
    output = Path(argv[argv.index(output_flag) + 1]).absolute() if output_flag in argv else directory / 'checked.c'
    if output_flag in argv:
        argv[argv.index(output_flag) + 1] = str(output)
    if mode == 'cc':
        actual = argv[argv.index('--cc') + 1] if '--cc' in argv else argv[0]
        actual = str(Path(shutil.which(actual) or actual).resolve())
        version = subprocess.check_output([actual, '--version'], text=True)
        linker = '/usr/bin/ld'
        options = ['--kind', 'cc', '--source-root', '/', '--compiler', actual]
        darwin_llvm = os.environ.get('BATON2_DARWIN_LLVM_ROOT')
        darwin_sdk = os.environ.get('BATON2_DARWIN_SDKROOT')
        if darwin_llvm and darwin_sdk:
            actual = str((Path(darwin_llvm) / 'bin/clang').resolve())
            linker = str((Path(darwin_llvm) / 'bin/ld64.lld').resolve())
            version = subprocess.check_output([actual, '--version'], text=True)
            settings = Path(darwin_sdk) / 'SDKSettings.json'
            options[options.index('--compiler') + 1] = actual
            options.extend(['--option', 'target=arm64-apple-macosx11.0',
                            '--option', 'sysroot=' + str(Path(darwin_sdk).resolve()),
                            '--option', 'sdk_manifest_sha256=' + os.environ['BATON2_DARWIN_SDK_MANIFEST_SHA256'],
                            '--option', 'sdk_tree_sha256=' + os.environ['BATON2_DARWIN_SDK_TREE_SHA256'],
                            '--aux', linker])
            if settings.is_file():
                options.extend(['--aux', str(settings.resolve())])
        options.extend(['--linker', linker, '--version', version,
                        '--artifact', 'output=' + str(output)])
        for value in argv:
            if value != str(output) and not value.startswith('-') and Path(value).is_file():
                options.extend(['--aux', str(Path(value).resolve())])
        command = [sys.executable if argv[0] == 'python3' else argv[0], *argv[1:]]
        if key_only:
            return submit(config, directory, options, command, key_only)
        with exclusive_lock(output_lock_path(run, output)):
            return submit(config, directory, options, command)

    entry = next(str(Path(a).resolve()) for a in argv if a.endswith('.bend') and Path(a).is_file())
    options = ['--kind', 'cgen', '--source-root', str(Path.cwd()), '--entry', os.path.relpath(entry),
               '--compiler', argv[0], '--artifact', 'output.c=' + str(output)]
    # The executed module rides as a queue input: staging verifies its bytes
    # against the key's input digest and the command names the staged copy, so
    # executed bytes and keyed bytes are the same bytes.
    options.extend(['--input', EXEC_SCRIPT])
    command = [sys.executable, EXEC_SCRIPT, str(output), *argv]
    with exclusive_lock(run / 'compile-queue-bend.lock'):
        if key_only:
            return submit(config, directory, options, command, key_only)
        with exclusive_lock(output_lock_path(run, output)):
            return submit(config, directory, options, command)


def config_tool(mode):
    config = json.loads(Path(os.environ['BATON2_NATIVE_QUEUE']).read_text())
    return config['bend' if mode == 'bend' else 'cc']


def main():
    mode, *argv = sys.argv[1:]
    if mode == 'compiler':
        return compiler(argv[0], [config_tool(argv[0]), *argv[1:]])
    if mode == 'key':
        return compiler(argv[0], [config_tool(argv[0]), *argv[1:]], key_only=True)
    if mode == 'stage':
        return compiler(argv[0], argv[1:])
    if mode == 'key-stage':
        return compiler(argv[0], argv[1:], key_only=True)
    if mode == 'cancel':
        config = json.loads((Path(argv[0]) / 'queue-config.json').read_text())
        return cancel_all(config)
    raise SystemExit('usage: queue-native-checks.py compiler|key bend|cc ARGS | stage|key-stage bend|cc COMMAND | cancel RUN')


if __name__ == '__main__':
    raise SystemExit(main())
