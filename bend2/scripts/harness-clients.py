"""Update the native harness installations used by the Linux service account."""

import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


NAMES = {'codex': 'codex', 'claude-code': 'claude', 'omp': 'omp', 'muse': 'muse'}
CHECK_INTERVAL = 3600


def executable(path):
    return path.is_file() and os.access(path, os.X_OK)


def installations(home, harness):
    paths = [home / '.local/bin' / NAMES[harness]]
    if harness == 'omp':
        clients = home / '.local/share/baton-native-clients'
        paths.extend(path for path in sorted(clients.glob('omp-*-linux-*/omp'))
                     if re.fullmatch(r'omp-\d+\.\d+\.\d+-linux-\w+', path.parent.name))
    return [path for path in paths if executable(path)]


def omp_wrapper_target(home, command):
    # Read the installed service wrapper's explicit exec target.
    if command != home / '.local/libexec/omp-batonci-env' or not executable(command):
        return None
    for line in command.read_text().splitlines():
        words = shlex.split(line, comments=True)
        if len(words) == 3 and words[0] == 'exec' and words[2] == '$@':
            return Path(words[1])
    return None


def installation(home, harness, command, paths):
    """Resolve a managed install and the command the caller should run."""
    given = Path(shutil.which(command) or command)
    if not given.is_absolute():
        return None, command
    given = given.parent.resolve() / given.name
    wrapper_target = omp_wrapper_target(home, given) if harness == 'omp' else None
    for path in paths:
        if wrapper_target == path:
            return path, command
        if given == path or (given.exists() and given.samefile(path)):
            return path, str(path)
    if paths and harness == 'codex':
        releases = (home / '.codex/packages/standalone/releases').resolve()
        release = given.parent.parent if given.parent.name == 'bin' else given.parent
        if given.name == 'codex' and release.parent == releases:
            return paths[0], str(paths[0])
    if paths and harness == 'claude-code':
        if given.parent == (home / '.local/share/claude/versions').resolve():
            return paths[0], str(paths[0])
    return None, command


def run(argv, home, env):
    return subprocess.run(argv, cwd=home, env=env, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          encoding='utf-8', errors='replace')


def version(harness, command, home, env):
    result = run([command, '--version'], home, env)
    pattern = r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?'
    versions = re.findall(pattern, result.stdout)
    if result.returncode or not versions:
        raise RuntimeError(f'{command} --version exited {result.returncode}: '
                           f'{result.stdout}{result.stderr}')
    return versions[-1] if harness == 'muse' else versions[0]


@contextlib.contextmanager
def preserve(paths, directory):
    """Keep the vendor selection and its files available for rollback."""
    saved = []
    for path in paths:
        copy = directory / str(len(saved))
        if path.is_symlink():
            copy.symlink_to(path.readlink())
        elif path.is_dir():
            shutil.copytree(path, copy, symlinks=True, copy_function=os.link)
        elif path.exists():
            if path.name in ('auto-update-version', 'selection-history', '.muse-release-info.json', '.muse-version'):
                shutil.copy2(path, copy)
            else:
                os.link(path, copy)
        saved.append((path, copy))
    try:
        yield
    except Exception:
        for path, copy in saved:
            if copy.is_dir() and not copy.is_symlink():
                if not path.exists():
                    copy.rename(path)
            elif copy.exists() or copy.is_symlink():
                copy.replace(path)
            else:
                path.unlink(missing_ok=True)
        raise


def update(harness, alias, home, backup, record):
    env = dict(os.environ, PATH=str(alias.parent) + os.pathsep + os.defpath,
               MUSE_NO_AUTO_UPDATE='1', DISABLE_AUTOUPDATER='1')
    env['PATH'] += os.pathsep + os.environ.get('PATH', '')
    env.pop('CODEX_HOME', None)
    env.pop('CLAUDE_CONFIG_DIR', None)
    old = record['oldVersion'] = version(harness, alias, home, env)
    record['newVersion'] = old
    target = alias.resolve()
    command = alias
    published = alias
    paths = []
    if harness == 'codex':
        current = home / '.codex/packages/standalone/current'
        if current.is_symlink():
            paths = [current.resolve(), current, alias, current.parent / 'auto-update-version',
                     current.parent / 'selection-history']
        else:
            paths = [target]
    elif harness == 'claude-code':
        paths = [target, alias] if alias.is_symlink() else [target]
    elif harness == 'muse':
        state = target.parent / '.muse-version'
        paths = [target.parent / ('muse-bin-' + state.read_text().strip()),
                 target.parent / '.muse-release-info.json', state]
    else:
        command = backup / alias.name
        shutil.copy2(target, command)
        env['PATH'] = str(backup) + os.pathsep + env['PATH']

    argv = [command, 'update']
    if harness == 'muse':
        argv = [command]
        env['MUSE_LAUNCHER_INSTALL'] = '1'
    if harness == 'claude-code':
        env.pop('DISABLE_AUTOUPDATER')
    with preserve(paths, backup):
        result = run(argv, home, env)
        record.update(exitCode=result.returncode, stdout=result.stdout, stderr=result.stderr)
        if result.returncode:
            raise RuntimeError(f'vendor updater exited {result.returncode}')
        env.pop('MUSE_LAUNCHER_INSTALL', None)
        env['DISABLE_AUTOUPDATER'] = '1'
        if harness == 'omp':
            published = command
        new = version(harness, published, home, env)
        if harness == 'omp' and new != old:
            command.replace(alias)
        record.update(newVersion=new, result='updated' if new != old else 'current')


def refresh(home, harness, alias):
    install_id = hashlib.sha256(os.fsencode(alias)).hexdigest()
    records = home / '.local/state/baton2/harness-updates' / harness / install_id
    records.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (records / 'lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        latest = max(records.glob('*.json'), default=None)
        if latest and time.time() - latest.stat().st_mtime < CHECK_INTERVAL:
            record = json.loads(latest.read_text())
            return (latest, record)
        started = time.time_ns()
        identity = f'{started:020d}-{uuid.uuid4().hex}'
        path = records / (identity + '.json')
        record = {'id': identity, 'harness': harness, 'time': started // 1_000_000,
                  'installation': str(alias), 'oldVersion': None, 'newVersion': None, 'result': 'failed'}
        try:
            with tempfile.TemporaryDirectory(prefix='.baton-update-', dir=alias.parent) as staging:
                update(harness, alias, home, Path(staging), record)
        except (OSError, RuntimeError) as error:
            record['error'] = str(error)
        pending = path.with_suffix('.pending')
        pending.write_text(json.dumps(record) + '\n')
        pending.replace(path)
        return (path, record)


def print_receipt(home, harness, alias):
    path, record = refresh(home, harness, alias)
    fields = ('id', 'harness', 'installation', 'time', 'oldVersion', 'newVersion', 'result')
    print(json.dumps({**{name: record[name] for name in fields},
                      'log': str(path), 'error': record.get('error')}))


def check(harness, command):
    home = Path.home().resolve()
    paths = installations(home, harness) if sys.platform == 'linux' else []
    if command:
        alias, selected = installation(home, harness, command, paths)
        print(selected)
        if alias:
            print_receipt(home, harness, alias)
        return
    print()
    for alias in paths:
        print_receipt(home, harness, alias)


def send_frame(process, frame):
    process.stdin.write(json.dumps(frame) + '\n')
    process.stdin.flush()


def receive_frame(process, matches):
    for line in process.stdout:
        frame = json.loads(line)
        if matches(frame):
            return frame
    raise RuntimeError('client closed the stream before replying')


def claude_catalog(process):
    send_frame(process, {'type': 'control_request', 'request_id': 'models',
                         'request': {'subtype': 'initialize'}})
    frame = receive_frame(process, lambda frame: frame.get('type') == 'control_response'
                          and frame['response'].get('request_id') == 'models')
    response = frame['response']
    if response['subtype'] != 'success':
        raise RuntimeError(response)
    return {'models': response['response']['models']}


def muse_catalog(process):
    send_frame(process, {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                         'params': {'clientInfo': {'name': 'baton', 'version': '1'},
                                    'capabilities': {'experimentalApi': True}}})
    response = receive_frame(process, lambda frame: frame.get('id') == 1)
    if 'error' in response:
        raise RuntimeError(response)
    send_frame(process, {'jsonrpc': '2.0', 'method': 'initialized'})
    send_frame(process, {'jsonrpc': '2.0', 'id': 2, 'method': 'model/list', 'params': {}})
    response = receive_frame(process, lambda frame: frame.get('id') == 2)
    if 'error' in response:
        raise RuntimeError(response)
    return response['result']


def catalog(harness, command):
    env = dict(os.environ, MUSE_NO_AUTO_UPDATE='1', DISABLE_AUTOUPDATER='1')
    if harness == 'claude-code':
        args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json',
                '--verbose', '--no-session-persistence', '--setting-sources', '']
        read_catalog = claude_catalog
    else:
        args = ['serve', '--no-session-log']
        read_catalog = muse_catalog
    with subprocess.Popen([command, *args], env=env, text=True,
                          stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE) as process:
        try:
            result = read_catalog(process)
        finally:
            process.stdin.close()
            process.stdin = None
            _, stderr = process.communicate()
        if process.returncode:
            raise RuntimeError(f'{command} exited {process.returncode}: {stderr}')
        print(json.dumps(result))


if __name__ == '__main__':
    action, harness, command = sys.argv[1:]
    try:
        if action == 'catalog':
            catalog(harness, command)
        else:
            check(harness, command)
    except (OSError, RuntimeError, ValueError, KeyError) as error:
        print(f'{harness}: {error}', file=sys.stderr if action == 'check' else sys.stdout)
        sys.exit(1)
