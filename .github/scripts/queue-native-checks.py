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
import time
import uuid

CLIENT = '/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/compile-queue-398d73b9-20261021/bin/baton-compile-queue'
STATE = '/var/tmp/baton2-compile-queue'
SCRIPT = str(Path(__file__).resolve())


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def environment(run):
    """Keep workflow identity probes on the selected, unwrapped toolchain."""
    run = Path(run).resolve()
    directory = run / 'queue-bin'
    directory.mkdir()
    config = {'run': str(run), 'bend': str(Path(os.environ['BEND']).resolve()),
              'cc': str(Path(shutil.which(os.environ['CC'])).resolve()), 'client': CLIENT, 'state': STATE,
              'verifier': os.environ.get('BATON2_MAIN_C_VERIFIER', '')}
    write(run / 'queue-config.json', config)
    env = dict(os.environ, BATON2_NATIVE_QUEUE=str(run / 'queue-config.json'))
    for name, mode in [('bend', 'bend'), ('cc', 'cc'), ('clang', 'cc'), ('clang-19', 'cc')]:
        actual = config['bend' if mode == 'bend' else 'cc']
        # The lineage reader follows this literal exec target to the real release.
        literal = actual.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('`', '\\`')
        path = directory / name
        path.write_text('#!/bin/sh\ncase "${1:-}" in\nversion|--version)\n'
                        'exec "' + literal + '" "$@"\n;;\nesac\n'
                        'exec ' + shlex.join([sys.executable, SCRIPT, 'compiler', mode]) + ' "$@"\n')
        path.chmod(0o755)
    verifier = directory / 'verify-main.py'
    verifier.write_text('import os, sys\nos.execv(' + repr(sys.executable) + ', '
                        + repr([sys.executable, SCRIPT, 'verify-main']) + ' + sys.argv[1:])\n')
    env.update(BEND=str(directory / 'bend'), CC=str(directory / 'cc'),
               PATH=str(directory) + os.pathsep + env['PATH'],
               BATON2_MAIN_C_VERIFIER=str(verifier))
    return env


def install():
    """Include compiler subprocesses in Python fixtures recorded by the CI shim."""
    if not os.environ.get('BATON2_NATIVE_QUEUE') or getattr(subprocess, '_native_queue', False):
        return
    config = json.loads(Path(os.environ['BATON2_NATIVE_QUEUE']).read_text())
    original = subprocess.Popen

    class QueuedCompiler(original):
        def __init__(self, args, *positional, **kwargs):
            self.queue_wait = False
            if isinstance(args, (list, tuple)) and args and not kwargs.get('shell'):
                argv = list(map(os.fspath, args))
                executable = shutil.which(argv[0]) or argv[0]
                executable = str(Path(executable).resolve())
                mode = None
                if executable == config['cc'] and not any(a in argv for a in ('--version', '-dumpmachine', '-print-resource-dir')):
                    mode = 'cc'
                elif executable == config['bend'] and argv[1:] not in (['version'], ['--version']):
                    mode = 'bend'
                elif Path(executable).name == 'bun' and any(
                        a.endswith('.ts') and ('/compiler/upstream/' in a or '/test/compiler/' in a)
                        for a in argv[1:]):
                    mode = 'bun'
                if mode:
                    args = [sys.executable, SCRIPT, 'compiler', mode, *argv[1:]]
                    if mode == 'bun':
                        kwargs['env'] = dict(kwargs.get('env') or os.environ, BATON2_QUEUE_BUN=executable)
                self.queue_wait = bool(mode) or any(
                    a.endswith('/build-native.sh') or a.startswith(config['run'] + '/queue-bin/') for a in argv)
            super().__init__(args, *positional, **kwargs)

        def communicate(self, input=None, timeout=None):
            return super().communicate(input=input, timeout=None if self.queue_wait else timeout)

        def wait(self, timeout=None):
            return super().wait(timeout=None if self.queue_wait else timeout)

    subprocess.Popen = QueuedCompiler
    subprocess._native_queue = True


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
        output = Path(argv[argv.index('-o') + 1]).absolute() if '-o' in argv else directory / 'checked.c'
        if '-o' in argv:
            argv[argv.index('-o') + 1] = str(output)
        if mode == 'cc':
            actual = config['cc']
            version = subprocess.check_output([actual, '--version'], text=True)
            options = ['--kind', 'cc', '--source-root', '/', '--compiler', actual,
                       '--linker', '/usr/bin/ld', '--version', version,
                       '--artifact', 'output=' + str(output)]
            for value in argv:
                if value != str(output) and not value.startswith('-') and Path(value).is_file():
                    options.extend(['--aux', str(Path(value).resolve())])
            command = [sys.executable, SCRIPT, 'execute-cc', str(output), actual, *argv]
        else:
            actual = config['bend'] if mode == 'bend' else os.environ['BATON2_QUEUE_BUN']
            entry = next((str(Path(a).resolve()) for a in argv if a.endswith('.bend') and Path(a).is_file()), None)
            entry = entry or next(str(Path(a).resolve()) for a in argv if a.endswith('.ts') and Path(a).is_file())
            options = ['--kind', 'cgen', '--source-root', '/', '--entry', entry,
                       '--compiler', actual, '--artifact', 'output.c=' + str(output)]
            if mode == 'bun':
                # These fixtures select copied TypeScript compiler modules at runtime.
                digest = hashlib.sha256()
                roots = [Path(a).resolve() for a in argv if Path(a).is_dir()]
                roots.append(Path(entry).parents[1] if entry.endswith('.bend') else Path(entry).parent)
                roots.append(Path.cwd() / 'bend2/compiler/upstream')
                for path in sorted({p for root in roots for p in root.rglob('*')
                                    if p.is_file() and p.suffix in ('.ts', '.bend')}):
                    digest.update(str(path).encode() + b'\0' + path.read_bytes())
                options.extend(['--option', 'frontend-sha256=' + digest.hexdigest()])
                if os.environ.get('ARM_EQ_C'):
                    output = Path(os.environ['ARM_EQ_C']).absolute()
                    options[options.index('--artifact') + 1] = 'output.c=' + str(output)
            command = [sys.executable, SCRIPT, 'execute-cgen', str(output), actual, *argv]
        options.extend(['--option', 'adapter-sha256=' + hashlib.sha256(Path(SCRIPT).read_bytes()).hexdigest()])
        return submit(config, directory, options, command, key_only)


def main():
    mode, *argv = sys.argv[1:]
    if mode == 'compiler':
        return compiler(argv[0], argv[1:])
    if mode == 'key':
        return compiler(argv[0], argv[1:], key_only=True)
    if mode == 'execute-cgen':
        output, actual, *arguments = argv
        code = subprocess.run([actual, *arguments]).returncode
        if not code and '-o' not in arguments:
            if os.environ.get('ARM_EQ_C'):
                shutil.copyfile(os.environ['ARM_EQ_C'], output)
            else:
                Path(output).write_text('/* Compiler check completed successfully. */\n')
        return code
    if mode == 'execute-cc':
        output, actual, *arguments = argv
        code = subprocess.run([actual, *arguments]).returncode
        if not code and '-o' not in arguments:
            Path(output).write_text('C compiler invocation completed successfully.\n')
        return code
    if mode == 'verify-main':
        config = json.loads(Path(os.environ['BATON2_NATIVE_QUEUE']).read_text())
        if '--compiler' in argv:
            argv[argv.index('--compiler') + 1] = config['bend']
        os.execv(sys.executable, [sys.executable, config['verifier'], *argv])
    if mode == 'cancel':
        config = json.loads((Path(argv[0]) / 'queue-config.json').read_text())
        codes = []
        for path in (Path(config['run']) / 'evidence/compile-queue').glob('*/request.json'):
            request = json.loads(path.read_text())
            codes.append(cancel(config, request, path.parent))
        return int(any(codes))
    raise SystemExit('usage: queue-native-checks.py compiler|key bend|cc|bun ARGS | cancel RUN')


if __name__ == '__main__':
    raise SystemExit(main())
