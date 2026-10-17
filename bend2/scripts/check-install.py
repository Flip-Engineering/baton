#!/usr/bin/env python3
"""Verify an installed native prefix and its C/SQLite prerequisites before activation."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import tempfile


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def archive_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def system_dependencies(system):
    if system == 'Darwin':
        return [
            {'id': 'native-c-toolchain', 'provider': 'Apple Command Line Tools', 'minimum_major_version': 14,
             'compiler': ['xcrun', '--find', 'clang'],
             'sdk': ['xcrun', '--sdk', 'macosx', '--show-sdk-path']},
            {'id': 'sqlite3-development', 'provider': 'macOS SDK',
             'headers': ['sqlite3.h'], 'link_libraries': ['sqlite3']},
        ]
    require(system == 'Linux', 'Native installation requires qualification for this operating system')
    return [
        {'id': 'native-c-toolchain', 'provider': 'Clang', 'minimum_major_version': 14},
        {'id': 'sqlite3-development', 'provider': 'system development package',
         'headers': ['sqlite3.h'], 'link_libraries': ['sqlite3']},
    ]


def verify_repl(prefix, manifest):
    dependencies = manifest.get('selected_dependencies', [])
    entries = [entry for entry in dependencies if entry.get('id') == 'bend2-repl-compiler']
    require(len(entries) == 1 and entries[0].get('required') is True,
            'The native archive requires one bundled Bend2 REPL compiler dependency')
    entry = entries[0]
    require(entry.get('path') == 'libexec/baton2/repl'
            and entry.get('manifest') == 'upstream/compiler.json',
            'The required REPL dependency must use its installed compiler paths')
    directory = prefix / entry['path']
    compiler_manifest = directory / entry['manifest']
    require(compiler_manifest.is_file() and archive_digest(compiler_manifest) == entry.get('sha256'),
            'The bundled REPL compiler manifest differs from its package hash')
    compiler = json.loads(compiler_manifest.read_text())
    require(compiler.get('protocol') == 1 and compiler.get('language') == 'Bend2' and compiler.get('frontend') == 'upstream/repl.ts'
            and compiler.get('nativeLibraries') == ['sqlite3'],
            'The bundled REPL compiler manifest has an unsupported frontend')
    require(compiler.get('files') == entry.get('files'),
            'The required REPL file inventories differ')
    files = {}
    for row in compiler['files']:
        path = PurePosixPath(row['path'])
        require(not path.is_absolute() and path.parts and '..' not in path.parts
                and '\\' not in row['path'] and row['path'] not in files,
                'The bundled REPL file inventory contains an unsafe or repeated path')
        staged = directory.joinpath(*path.parts)
        require(staged.is_file() and not staged.is_symlink()
                and staged.stat().st_size == row['bytes']
                and archive_digest(staged) == row['sha256']
                and oct(staged.stat().st_mode & 0o777) == row['mode'],
                'The bundled REPL file differs from its manifest: ' + row['path'])
        files[row['path']] = row
    required = {'compiler', 'bun', 'upstream/repl.ts', 'upstream.lock.json', 'upstream.provenance.json',
                'notices/Bend-LICENSE', 'notices/Bun-NOTICES'}
    require(required <= files.keys(), 'The bundled REPL compiler is missing required files')
    require(all(os.access(directory / name, os.X_OK) for name in ('compiler', 'bun')),
            'The bundled REPL compiler and Bun runtime must be executable')
    require(files['notices/Bun-NOTICES']['bytes'] > 0,
            'The bundled REPL runtime notices are empty')
    lock = json.loads((directory / 'upstream.lock.json').read_text())
    provenance = json.loads((directory / 'upstream.provenance.json').read_text())
    require(provenance.get('schema') == 'baton2-repl-vendored-source-v1'
            and provenance.get('lock_sha256') == files['upstream.lock.json']['sha256']
            and all(provenance.get(key) == lock[key] for key in ('compiler_archive_sha256', 'files', 'license')),
            'The bundled REPL compiler source provenance differs from its lock')
    require(compiler.get('upstream') == lock.get('upstream')
            and compiler.get('compilerArchiveSha256') == lock.get('compiler_archive_sha256')
            and compiler.get('runtimeSha256') == files['bun']['sha256']
            and lock['license']['sha256'] == files['notices/Bend-LICENSE']['sha256']
            and all('upstream/' + row['path'] in files for row in lock['files']),
            'The bundled REPL source, runtime or license differs from its selected pins')
    actual = {str(path.relative_to(directory)) for path in directory.rglob('*') if path.is_file()}
    require(actual == files.keys() | {entry['manifest']},
            'The bundled REPL dependency contains files outside its manifest')
    return entry



def check(prefix, output):
    manifest_path = prefix / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    dependency = verify_repl(prefix, manifest)
    binary = manifest['binary']
    require(binary['path'] == 'bin/baton2' and binary['alias'] == 'bin/baton',
            'The native installation must provide bin/baton2 and bin/baton')
    require(all((prefix / binary[key]).is_file() and os.access(prefix / binary[key], os.X_OK)
                and archive_digest(prefix / binary[key]) == binary.get('sha256') for key in ('path', 'alias')),
            'The installed coordinator or alias differs from the package manifest')
    system = platform.system()
    require(manifest.get('required_system_dependencies') == system_dependencies(system),
            'The installation manifest must record its required C toolchain and SQLite development files')
    records = []
    environment = dict(os.environ)
    environment.pop('BUN_OPTIONS', None)

    def run(argv):
        try:
            result = subprocess.run(list(map(str, argv)), env=environment,
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True)
        except OSError as error:
            records.append({'argv': list(map(str, argv)), 'returncode': None,
                            'stdout': '', 'stderr': '', 'error': str(error)})
            (output / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
            raise RuntimeError('Installation prerequisite command could not start: '
                               + str(argv) + ': ' + str(error)) from error
        records.append({'argv': list(map(str, argv)), 'returncode': result.returncode,
                        'stdout': result.stdout, 'stderr': result.stderr})
        (output / 'commands.json').write_text(json.dumps(records, indent=2) + '\n')
        require(result.returncode == 0, 'Installation prerequisite command failed: ' + str(argv))
        return result.stdout.strip()

    runtime_version = run([prefix / dependency['path'] / 'bun', '--version'])
    require(re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?', runtime_version) is not None,
            'The bundled Bun runtime did not report its version')
    if system == 'Darwin':
        compiler = run(['xcrun', '--find', 'clang'])
        sdk = run(['xcrun', '--sdk', 'macosx', '--show-sdk-path'])
        require(Path(sdk).is_dir(), 'The selected macOS SDK directory is unavailable')
        flags = ['-isysroot', sdk]
    else:
        compiler = shutil.which(os.environ.get('CC', 'clang'))
        require(compiler is not None, 'Install Clang 14 or later and the SQLite development package')
        sdk, flags = None, []
    version = run([compiler, '--version'])
    match = re.search(r'clang version (\d+)', version)
    require(match is not None and int(match[1]) >= 14,
            'REPL native evaluation requires Clang 14 or later')
    source = output / 'sqlite-probe.c'
    program = output / 'sqlite-probe'
    source.write_text('#include <stdio.h>\n#include <sqlite3.h>\n'
                      'int main(void) { sqlite3 *db = 0; '
                      'if (sqlite3_open(":memory:", &db) != SQLITE_OK) return 1; '
                      'if (sqlite3_exec(db, "SELECT 1", 0, 0, 0) != SQLITE_OK) return 2; '
                      'if (sqlite3_close(db) != SQLITE_OK) return 3; '
                      'puts(sqlite3_libversion()); return 0; }\n')
    run([compiler, '-std=c11', *flags, source, '-lsqlite3', '-o', program])
    sqlite_version = run([program])
    return {'status': 'ready', 'prefix': str(prefix), 'manifest_sha256': archive_digest(manifest_path),
            'repl_manifest_sha256': dependency['sha256'], 'compiler': compiler,
            'runtime_version': runtime_version,
            'compiler_version': version, 'sdk': sdk, 'sqlite_version': sqlite_version,
            'commands': records}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=Path, help='new directory for prerequisite source, program and results')
    args = parser.parse_args()
    temporary = tempfile.TemporaryDirectory(prefix='baton2-install-check-') if args.output is None else None
    output = Path(temporary.name) if temporary is not None else args.output.resolve()
    if temporary is None:
        output.mkdir(parents=True, exist_ok=False)
    try:
        try:
            result = check(args.prefix.resolve(), output)
        except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
            remedy = ('Install Apple Command Line Tools with xcode-select --install and select a macOS SDK.'
                      if platform.system() == 'Darwin' else
                      'Install Clang 14 or later and SQLite development headers and library; set CC to that Clang executable.')
            result = {'status': 'refused', 'error': str(error),
                      'remedy': 'Install the complete package for this operating system and CPU. ' + remedy}
        (output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
        raise SystemExit(0 if result['status'] == 'ready' else 2)
    finally:
        if temporary is not None:
            temporary.cleanup()


if __name__ == '__main__':
    main()
