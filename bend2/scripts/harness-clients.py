"""Update the native harness installations used by the Linux service account."""

import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
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


def installation(home, harness, command):
    """Resolve the standard install, including paths canonicalized by old receivers."""
    alias = home / '.local/bin' / NAMES[harness]
    if not executable(alias):
        return None
    if not command:
        return alias
    given = Path(shutil.which(command) or command)
    if not given.is_absolute():
        return None
    given = given.parent.resolve() / given.name
    if given == alias or (given.exists() and given.samefile(alias)):
        return alias
    if harness == 'codex':
        releases = (home / '.codex/packages/standalone/releases').resolve()
        release = given.parent.parent if given.parent.name == 'bin' else given.parent
        if given.name == 'codex' and release.parent == releases:
            return alias
    if harness == 'claude-code' and given.parent == (home / '.local/share/claude/versions').resolve():
        return alias
    return None


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
    records = home / '.local/state/baton2/harness-updates' / harness
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
                  'oldVersion': None, 'newVersion': None, 'result': 'failed'}
        try:
            with tempfile.TemporaryDirectory(prefix='.baton-update-', dir=alias.parent) as staging:
                update(harness, alias, home, Path(staging), record)
        except (OSError, RuntimeError) as error:
            record['error'] = str(error)
        pending = path.with_suffix('.pending')
        pending.write_text(json.dumps(record) + '\n')
        pending.replace(path)
        return (path, record)


def check(harness, command):
    home = Path.home().resolve()
    alias = installation(home, harness, command) if sys.platform == 'linux' else None
    if alias is None:
        print(command)
        return
    path, record = refresh(home, harness, alias)
    print(alias)
    print(json.dumps({'id': record['id'], 'harness': harness, 'oldVersion': record['oldVersion'],
                      'newVersion': record['newVersion'], 'result': record['result'],
                      'log': str(path), 'error': record.get('error')}))


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
