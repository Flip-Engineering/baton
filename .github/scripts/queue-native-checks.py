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
from datetime import datetime, timezone
import time
import uuid

# The queue installs the same client here and in its retained directory; only this path is
# reachable from every homelab runner (each runner service binds /var/tmp/baton2-compile-queue).
CLIENT = '/var/tmp/baton2-compile-queue/compile-queue-runner'
STATE = '/var/tmp/baton2-compile-queue'
SCRIPT = str(Path(__file__).resolve())
DIAGNOSTIC_FILE = 'compiler-diagnostics.json'

# These exact names are read by the pinned Bend compiler source or its Bun/JSC
# runtime. BEND_BASE is not read by the pinned source. BUN_OPTIONS is retained
# as presence state only because its arbitrary contents can contain secrets.
# Malloc is a Darwin allocator setting and is not consumed by the Linux runner.
COMPILER_ENVIRONMENT = (
    'BEND_COMPILER_DIAGNOSTICS',
    'BEND_FACTS_ONLY_FIRST',
    'BEND_LIB',
    'BEND_NO_TELEMETRY',
    'BUN_OPTIONS',
    'BUN_JSC_maxPerThreadStackUsage',
)


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


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
    if name == 'BEND_LIB':
        return {'state': 'set', 'effective_path': str(Path(value).resolve())}
    if name == 'BEND_COMPILER_DIAGNOSTICS' or name == 'BEND_FACTS_ONLY_FIRST':
        return {'state': 'set', 'enabled': value == '1'}
    if name == 'BEND_NO_TELEMETRY':
        return {'state': 'set', 'enabled': bool(value)}
    if value.isdecimal():
        return {'state': 'set', 'value': int(value)}
    return {'state': 'set', 'value': 'non-decimal value omitted'}


def compiler_attempt_directory(output):
    artifact = Path(output).resolve()
    if artifact.parent.name != 'work':
        return None
    attempt = artifact.parent.parent
    if not all((attempt / name).is_file()
               for name in ('meta', 'argv', 'command', 'source-digest')):
        return None
    return attempt


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


def compiler_diagnostics(output, command):
    """Best-effort metadata at the compiler launch boundary; never gates execution."""
    try:
        attempt = compiler_attempt_directory(output)
        if attempt is None or not command:
            return
        source_digest = (attempt / 'source-digest').read_text(errors='replace').strip()
        metadata = {
            'schema': 'baton2-compiler-execution-observation-v1',
            'observed_at': datetime.now(timezone.utc).isoformat(),
            'boundary': 'queue adapter immediately before compiler launcher subprocess',
            'process': {'pid': os.getpid(), 'cwd': str(Path.cwd())},
            'cpu_affinity': {'status': 'unavailable'},
            'environment': {name: environment_observation(name, os.environ)
                            for name in COMPILER_ENVIRONMENT},
            'compiler_argv': command,
            'toolchain': toolchain_identity(command[0]),
            'queue_attempt': {
                'meta': read_queue_meta(attempt),
                'meta_sha256': hashlib.sha256((attempt / 'meta').read_bytes()).hexdigest(),
                'argv_sha256': hashlib.sha256((attempt / 'argv').read_bytes()).hexdigest(),
                'command_sha256': hashlib.sha256((attempt / 'command').read_bytes()).hexdigest(),
                'source_digest': source_digest,
            },
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
    with (directory / 'cancel.stdout').open('ab') as stdout, (directory / 'cancel.stderr').open('ab') as stderr:
        return subprocess.run([config['client'], '--', 'cancel', '--state-root', config['state'],
                               '--key', request['key'], '--token', request['token']],
                              stdout=stdout, stderr=stderr).returncode


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


def submit(config, directory, options, command, key_only=False):
    common = ['--state-root', config['state'], '--cwd', str(Path.cwd()),
              '--root', str(Path.cwd()), *options, '--', *command]
    key_argv = [config['client'], '--', 'key', *common]
    key = subprocess.check_output(key_argv, text=True).strip()
    token = uuid.uuid4().hex
    request = {'key': key, 'token': token, 'cwd': str(Path.cwd()), 'command': command,
               'key_argv': key_argv, 'started_ns': time.time_ns()}
    argv = [config['client'], '--', 'run', '--token', token, '--receipt', str(directory / 'receipt'), *common]
    request['argv'] = argv
    write(directory / 'request.json', request)
    if key_only:
        print(key)
        return 0
    child = None

    def interrupted(signum, frame):
        raise InterruptedError(signum)

    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        with (directory / 'client.stdout').open('wb') as stdout, (directory / 'client.stderr').open('wb') as stderr:
            child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
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
    request.update(exit_code=code, finished_ns=time.time_ns())
    write(directory / 'request.json', request)
    retain(config, key, directory, code == 0)
    if code:
        sys.stderr.write((directory / 'client.stderr').read_text())
    return code


def compiler(mode, argv, key_only=False):
    config = json.loads(Path(os.environ['BATON2_NATIVE_QUEUE']).read_text())
    run = Path(config['run'])
    evidence = run / 'evidence/compile-queue'
    evidence.mkdir(parents=True, exist_ok=True)
    # The native fixture runner has four workers. Each CI job owns one request at a time.
    with (run / 'compile-queue.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        directory = evidence / uuid.uuid4().hex
        directory.mkdir()
        output_flag = '--binary' if '--binary' in argv else '-o'
        output = Path(argv[argv.index(output_flag) + 1]).absolute() if output_flag in argv else directory / 'checked.c'
        if output_flag in argv:
            argv[argv.index(output_flag) + 1] = str(output)
        if mode == 'cc':
            actual = argv[argv.index('--cc') + 1] if '--cc' in argv else argv[0]
            actual = str(Path(shutil.which(actual) or actual).resolve())
            version = subprocess.check_output([actual, '--version'], text=True)
            options = ['--kind', 'cc', '--source-root', '/', '--compiler', actual,
                       '--linker', '/usr/bin/ld', '--version', version,
                       '--artifact', 'output=' + str(output)]
            for value in argv:
                if value != str(output) and not value.startswith('-') and Path(value).is_file():
                    options.extend(['--aux', str(Path(value).resolve())])
            command = [sys.executable if argv[0] == 'python3' else argv[0], *argv[1:]]
        else:
            entry = next(str(Path(a).resolve()) for a in argv if a.endswith('.bend') and Path(a).is_file())
            options = ['--kind', 'cgen', '--source-root', str(Path.cwd()), '--entry', os.path.relpath(entry),
                       '--compiler', argv[0], '--artifact', 'output.c=' + str(output)]
            command = [sys.executable, SCRIPT, 'execute-cgen', str(output), *argv]
        options.extend(['--option', 'adapter-sha256=' + hashlib.sha256(Path(SCRIPT).read_bytes()).hexdigest()])
        return submit(config, directory, options, command, key_only)


def config_tool(mode):
    config = json.loads(Path(os.environ['BATON2_NATIVE_QUEUE']).read_text())
    return config['bend' if mode == 'bend' else 'cc']


def main():
    mode, *argv = sys.argv[1:]
    if mode == 'compiler':
        return compiler(argv[0], [config_tool(argv[0]), *argv[1:]])
    if mode == 'key':
        return compiler(argv[0], [config_tool(argv[0]), *argv[1:]], key_only=True)
    if mode == 'execute-cgen':
        output, *command = argv
        compiler_diagnostics(output, command)
        code = subprocess.run(command).returncode
        if code < 0:
            # OOM #1068 killed the compiler with SIGKILL. Preserve its signal
            # disposition when the queue observes this adapter process.
            signum = -code
            if signum not in (signal.SIGKILL, signal.SIGSTOP):
                signal.signal(signum, signal.SIG_DFL)
            os.kill(os.getpid(), signum)
            return 128 + signum
        if not code and '-o' not in command:
            Path(output).write_text('/* Compiler check completed successfully. */\n')
        return code
    if mode == 'stage':
        return compiler(argv[0], argv[1:])
    if mode == 'key-stage':
        return compiler(argv[0], argv[1:], key_only=True)
    if mode == 'cancel':
        config = json.loads((Path(argv[0]) / 'queue-config.json').read_text())
        codes = []
        for path in (Path(config['run']) / 'evidence/compile-queue').glob('*/request.json'):
            request = json.loads(path.read_text())
            codes.append(cancel(config, request, path.parent))
        return int(any(codes))
    raise SystemExit('usage: queue-native-checks.py compiler|key bend|cc ARGS | stage|key-stage bend|cc COMMAND | cancel RUN')


if __name__ == '__main__':
    raise SystemExit(main())
