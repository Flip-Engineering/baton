#!/usr/bin/env python3
"""Retain required REPL inputs and verify the installed dependency."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import sqlite3
import subprocess
import tempfile
import urllib.request
import zipfile


ROOT = Path(__file__).resolve().parents[2]
BUN_ARCHIVE = {
    'url': 'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip',
    'sha256': 'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620',
}
BUN_NOTICES = {
    'url': 'https://raw.githubusercontent.com/oven-sh/bun/0d9b296af33f2b851fcbf4df3e9ec89751734ba4/LICENSE.md',
    'sha256': '2c6160ec8fb853f7e8f97d9b249e756c9b0ac44860a68b6bf4f1b0bcbc5c3741',
}


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def fact(path):
    assert path.is_file() and not path.is_symlink(), path
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return {'sha256': digest.hexdigest(), 'bytes': path.stat().st_size}


def source_inputs(args):
    lock_path = ROOT / 'bend2/compiler/repl-upstream.lock.json'
    lock = json.loads(lock_path.read_text())
    provenance_path = ROOT / 'bend2/compiler/repl-upstream.provenance.json'
    provenance = json.loads(provenance_path.read_text())
    assert provenance['lock_sha256'] == fact(lock_path)['sha256']
    assert provenance['compiler_archive_sha256'] == lock['compiler_archive_sha256']
    assert provenance['official_release_artifact'] is False
    assert provenance['files'] == lock['files']
    assert fact(args.source / 'LICENSE')['sha256'] == lock['license']['sha256']
    args.output.mkdir(parents=True, exist_ok=False)
    source = args.output / 'source'
    source.mkdir()
    for member in lock['files']:
        relative = PurePosixPath(member['path'])
        assert not relative.is_absolute() and '..' not in relative.parts, member
        original = args.source.joinpath(*relative.parts)
        assert fact(original) == {key: member[key] for key in ('sha256', 'bytes')}, member
        target = source.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
    shutil.copyfile(lock_path, args.output / 'upstream.lock.json')
    shutil.copyfile(provenance_path, args.output / 'upstream.provenance.json')
    save(args.output / 'inputs.json', {
        'schema': 'baton2-repl-source-inputs-v1', 'lock': fact(lock_path), 'provenance': fact(provenance_path),
        'compiler_archive_sha256': lock['compiler_archive_sha256'], 'files': lock['files'],
        'producer_source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    })


def download(pin, target):
    with urllib.request.urlopen(pin['url']) as response, target.open('xb') as output:
        shutil.copyfileobj(response, output)
    assert fact(target)['sha256'] == pin['sha256'], target


def runtime_inputs(args):
    assert platform.system() == 'Darwin' and platform.machine() == 'arm64'
    args.output.mkdir(parents=True, exist_ok=False)
    archive = args.output / 'bun-darwin-aarch64.zip'
    notices = args.output / 'Bun-NOTICES'
    download(BUN_ARCHIVE, archive)
    download(BUN_NOTICES, notices)
    binary = args.output / 'bun'
    with zipfile.ZipFile(archive) as packed:
        member = packed.getinfo('bun-darwin-aarch64/bun')
        assert not member.is_dir()
        with packed.open(member) as source, binary.open('xb') as output:
            shutil.copyfileobj(source, output)
    binary.chmod(0o755)
    save(args.output / 'runtime.json', {
        'schema': 'baton2-repl-runtime-v1', 'version': '1.3.14', 'platform': 'darwin-arm64',
        'archive': {**BUN_ARCHIVE, **fact(archive)},
        'notices': {**BUN_NOTICES, **fact(notices)}, 'binary': fact(binary),
    })


def verify_dependency(prefix):
    package = json.loads((prefix / 'manifest.json').read_text())
    selected = [row for row in package['selected_dependencies'] if row['id'] == 'bend2-repl-compiler']
    assert len(selected) == 1, selected
    dependency = selected[0]
    assert dependency['required'] is True
    assert dependency['path'] == 'libexec/baton2/repl'
    assert dependency['manifest'] == 'upstream/compiler.json'
    required = package['required_system_dependencies']
    assert required == [
        {'id': 'native-c-toolchain', 'provider': 'Apple Command Line Tools', 'minimum_major_version': 14,
         'compiler': ['xcrun', '--find', 'clang'], 'sdk': ['xcrun', '--sdk', 'macosx', '--show-sdk-path']},
        {'id': 'sqlite3-development', 'provider': 'macOS SDK', 'headers': ['sqlite3.h'], 'link_libraries': ['sqlite3']},
    ], required
    directory = prefix / dependency['path']
    manifest = directory / dependency['manifest']
    assert fact(manifest)['sha256'] == dependency['sha256']
    compiler = json.loads(manifest.read_text())
    assert compiler['language'] == 'Bend2'
    assert compiler['files'] == dependency['files']
    expected = {row['path'] for row in compiler['files']} | {dependency['manifest']}
    assert {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file()} == expected
    for member in compiler['files']:
        relative = PurePosixPath(member['path'])
        assert not relative.is_absolute() and '..' not in relative.parts
        current = directory.joinpath(*relative.parts)
        assert fact(current) == {key: member[key] for key in ('sha256', 'bytes')}, member
        assert oct(current.stat().st_mode & 0o777) == member['mode'], member
    assert fact(directory / 'bun')['sha256'] == compiler['runtimeSha256']
    return dependency


def smoke(args):
    prefix = args.prefix.resolve()
    dependency = verify_dependency(prefix)
    args.output.mkdir(parents=True, exist_ok=False)
    work = args.output / 'workspace'
    work.mkdir()
    commands = args.output / 'commands'
    commands.mkdir()
    binary = prefix / 'bin/baton2'
    db = args.output / 'state.db'
    env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
    for key in ('BEND', 'BEND_HOME', 'BATON_DATABASE', 'BATON_SESSION', 'CODEX_THREAD_ID',
                'CC', 'CXX', 'SDKROOT', 'CPATH', 'LIBRARY_PATH', 'CFLAGS', 'LDFLAGS', 'CUDA_HOME'):
        env.pop(key, None)
    runtime = tempfile.mkdtemp(prefix='b2rp-', dir='/tmp')
    env.update(TMPDIR=runtime, XDG_RUNTIME_DIR=runtime, PATH='/usr/bin:/bin:/usr/sbin:/sbin')
    records = []

    def run(label, argv, input_text=None, expected=0):
        directory = commands / ('%03d-' % len(records) + label)
        directory.mkdir()
        (directory / 'stdin').write_text(input_text or '')
        row = {'label': label, 'argv': list(map(str, argv)), 'cwd': str(work),
               'started': datetime.datetime.now(datetime.timezone.utc).isoformat()}
        with (directory / 'stdout').open('xb') as out, (directory / 'stderr').open('xb') as err:
            child = subprocess.Popen(row['argv'], cwd=work, env=env, stdout=out, stderr=err,
                                     stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL)
            row['pid'] = child.pid
            if input_text is not None:
                child.communicate(input_text.encode())
            row['returncode'] = child.wait()
        row.update(natural_wait_completed=True, ended=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                   streams={name: fact(directory / name) for name in ('stdin', 'stdout', 'stderr')})
        records.append(row)
        save(directory / 'result.json', row)
        save(args.output / 'commands.json', records)
        assert row['returncode'] == expected, row
        return (directory / 'stdout').read_text()

    def cli(label, *values, expected=0, input_text=None):
        return run(label, [binary, db, *values], input_text, expected)

    try:
        installed_check = prefix / 'libexec/baton2/check-install.py'
        run('required-install-check', ['/usr/bin/python3', installed_check, '--output', args.output / 'install-check'])
        compiler_path = Path(run('find-clang', ['xcrun', '--find', 'clang']).strip()).resolve()
        compiler_version = run('clang-version', [compiler_path, '--version'])
        sdk = Path(run('find-sdk', ['xcrun', '--sdk', 'macosx', '--show-sdk-path']).strip()).resolve()
        sdk_version = run('sdk-version', ['xcrun', '--sdk', 'macosx', '--show-sdk-version']).strip()
        system_dependencies = {
            'platform': 'darwin-arm64',
            'compiler': {'path': str(compiler_path), **fact(compiler_path), 'version': compiler_version},
            'sdk': {'path': str(sdk), 'version': sdk_version,
                    'sqlite_header': fact(sdk / 'usr/include/sqlite3.h'),
                    'sqlite_link_stub': fact(sdk / 'usr/lib/libsqlite3.tbd')},
        }
        save(args.output / 'system-dependencies.json', system_dependencies)
        run('git-init', ['git', 'init', '-q', '-b', 'main'])
        run('git-name', ['git', 'config', 'user.name', 'REPL package acceptance'])
        run('git-email', ['git', 'config', 'user.email', 'fixture@example.invalid'])
        (work / 'seed').write_text('Required REPL package acceptance.\n')
        run('git-add', ['git', 'add', 'seed'])
        run('git-commit', ['git', 'commit', '-qm', 'Prepare REPL package acceptance'])
        cli('attach', 'attach', 'parent', 'fixture', '', '')
        cli('join', 'join', 'worker', 'parent', 'codex', 'gpt-6-astra', 'low', work)
        cli('define', 'as', 'worker', 'repl', 'define', 'def double(+x: U32) -> U32:\n  U32.add(x,x)\n', '--label', 'arithmetic')
        cli('evaluate', 'as', 'worker', 'repl', 'eval', 'double(21)', '--label', 'answer')
        cli('bind', 'as', 'worker', 'repl', 'bind', 'saved_answer', '--cell', 'answer')
        cli('compose', 'as', 'worker', 'repl', 'eval', 'U32.add(saved_answer(),1)')
        cli('type-refusal', 'as', 'worker', 'repl', 'eval', '"wrong"', '--type', 'U32', expected=1)
        cli('foreign-syntax-refusal', 'as', 'worker', 'repl', 'eval', '((x: number) => x + 1)(41)', expected=1)
        cli('foreign-declaration-refusal', 'as', 'worker', 'repl', 'eval', 'const answer = 42;', expected=1)
        cli('foreign-call-refusal', 'as', 'worker', 'repl', 'eval', 'print(42)', expected=1)
        cli('language-option-refusal', 'as', 'worker', 'repl', 'eval', '42', '--language', 'typescript', expected=2)
        cli('interactive', 'as', 'worker', 'repl', 'interactive', input_text='U32.add(saved_answer(),2)\n:submit\n:quit\n')
        body = 'Complete installed REPL stdout λ🙂\nSecond line.\n'
        cli('io', 'as', 'worker', 'repl', 'eval', 'IO.write(' + json.dumps(body, ensure_ascii=False) + ')', '--type', 'IO(Unit)')
        cli('read', 'as', 'worker', 'repl', 'read')
        with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as connection:
            rows = connection.execute('SELECT a.stage,a.stdout,a.stderr,a.wait_status,a.cause FROM repl_attempts a JOIN repl_cells c ON c.id=a.cell ORDER BY c.seq,a.stage').fetchall()
            with sqlite3.connect(args.output / 'final.db') as copy:
                connection.backup(copy)
        pure = [json.loads(out)['value'] for stage, out, err, status, cause in rows
                if stage == 'compiler' and status == 'exit 0' and cause == '' and json.loads(out)['kind'] == 'pure']
        assert pure == ['42', '43', '44'], pure
        assert any(stage == 'compiler' and status != 'exit 0' for stage, out, err, status, cause in rows)
        assert [(out, status, cause) for stage, out, err, status, cause in rows if stage == 'native'] == [(body, 'exit 0', '')]
        native_results = [json.loads(out) for stage, out, err, status, cause in rows
                          if stage == 'compiler' and status == 'exit 0' and cause == ''
                          and json.loads(out)['kind'] == 'native']
        assert len(native_results) == 1
        native_result = native_results[0]
        assert native_result['compiler'] == json.loads((prefix / dependency['path'] / dependency['manifest']).read_text())
        for key in ('generatedC', 'executable'):
            assert fact(Path(native_result[key]['path']))['sha256'] == native_result[key]['sha256']
        compiler_steps = []
        for stage, out, err, status, cause in rows:
            if stage == 'compiler' and status == 'exit 0':
                for line in err.splitlines():
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(value, dict) and 'compilerStep' in value:
                        compiler_steps.append(value['compilerStep'])
        assert len(compiler_steps) == 1 and compiler_steps[0]['status'] == 0, compiler_steps
        assert compiler_steps[0]['command'] == 'clang'
        assert '-lsqlite3' in compiler_steps[0]['arguments']
        system_dependencies['native_compiler_steps'] = compiler_steps
        save(args.output / 'system-dependencies.json', system_dependencies)
        run('shutdown-idle-owner', [binary, '--instance-shutdown', db])
        save(args.output / 'summary.json', {'status': 'passed', 'prefix': str(prefix),
             'package_manifest': fact(prefix / 'manifest.json'), 'dependency': dependency,
             'source_language': 'Bend2', 'pure_results': pure, 'type_refusal_retained': True,
             'foreign_syntax_refused': True, 'language_option_refused': True, 'complete_native_stdout': body,
             'native_result': native_result, 'commands': len(records), 'runtime': runtime, 'system_dependencies': system_dependencies,
             'scope': 'Extracted required dependency through CLI, interactive input and native IO on this host.'})
    except BaseException as error:
        save(args.output / 'failure.json', {'error': repr(error), 'commands': records})
        raise


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest='action', required=True)
    source = actions.add_parser('source')
    source.add_argument('--source', type=Path, default=ROOT / 'bend2/compiler/upstream')
    source.add_argument('--output', type=Path, required=True)
    runtime = actions.add_parser('runtime')
    runtime.add_argument('--output', type=Path, required=True)
    installed = actions.add_parser('smoke')
    installed.add_argument('--prefix', type=Path, required=True)
    installed.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output = args.output.resolve()
    {'source': source_inputs, 'runtime': runtime_inputs, 'smoke': smoke}[args.action](args)
