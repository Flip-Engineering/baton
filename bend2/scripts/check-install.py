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




BINARY_LAYOUT = (
    {'role': 'focused-facade', 'path': 'bin/baton', 'alias': 'bin/baton2',
     'entry': 'bend2/src/coordinator/receive-focused.bend', 'build_mode': 'focused-native-entry'},
    {'role': 'full-cli', 'path': 'bin/baton-full', 'alias': None,
     'entry': 'bend2/src/coordinator/main.bend', 'build_mode': 'full-native-entry'},
    {'role': 'receiver-register', 'path': 'bin/baton-register', 'alias': None,
     'entry': 'bend2/src/coordinator/receiver-register-focused-direct.bend',
     'build_mode': 'standalone-registrar'},
)


def verify_checksums(prefix):
    path = prefix / 'SHA256SUMS'
    require(path.is_file() and not path.is_symlink(), 'The installation is missing its SHA256SUMS file')
    rows = {}
    for line in path.read_text().splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  (.+)', line)
        require(match is not None, 'The installation checksum line is malformed: ' + line)
        digest, name = match.groups()
        relative = PurePosixPath(name)
        require(not relative.is_absolute() and relative.parts and '..' not in relative.parts
                and '\\' not in name and name not in rows,
                'The installation checksum contains an unsafe or repeated path: ' + name)
        rows[name] = digest
    return rows


def verify_binaries(prefix, manifest, checksums):
    require(manifest.get('schema') == 'baton2-native-install-v2',
            'The installation manifest does not declare the receiver layout')
    binaries = manifest.get('binaries')
    require(isinstance(binaries, list) and len(binaries) == len(BINARY_LAYOUT),
            'The receiver layout requires exactly three installed binaries')
    expected = {item['role']: item for item in BINARY_LAYOUT}
    seen = set()
    records = []
    for record in binaries:
        require(isinstance(record, dict) and record.get('role') in expected
                and record['role'] not in seen,
                'The installation manifest contains an unknown or repeated binary role')
        seen.add(record['role'])
        layout = expected[record['role']]
        require(record.get('path') == layout['path'],
                'The ' + record['role'] + ' binary is installed at an unexpected path')
        path = prefix / layout['path']
        require(path.is_file() and not path.is_symlink() and os.access(path, os.X_OK),
                'The installed ' + record['role'] + ' binary is missing or not executable')
        digest = archive_digest(path)
        require(digest == record.get('sha256'),
                'The installed ' + record['role'] + ' binary differs from its manifest hash')
        require(checksums.get(layout['path']) == digest,
                'The installed ' + record['role'] + ' binary is absent from SHA256SUMS')
        require(record.get('entry') == layout['entry'] and record.get('build_mode') == layout['build_mode'],
                'The installed ' + record['role'] + ' binary records another entry or build mode')
        source = record.get('source')
        require(isinstance(source, dict) and isinstance(source.get('commit'), str)
                and re.fullmatch(r'[0-9a-f]{40}', source['commit']) is not None
                and isinstance(source.get('status'), str)
                and (isinstance(source.get('tree'), str)
                     and re.fullmatch(r'[0-9a-f]{40}', source['tree']) is not None
                     or isinstance(source.get('manifest_sha256'), str)
                     and re.fullmatch(r'[0-9a-f]{64}', source['manifest_sha256']) is not None),
                'The installed ' + record['role'] + ' binary lacks an exact source commit/tree or manifest pin')
        if layout['alias']:
            require(record.get('alias') == layout['alias'],
                    'The focused facade must expose its baton2 alias')
            alias = prefix / layout['alias']
            require(alias.is_file() and not alias.is_symlink() and os.access(alias, os.X_OK),
                    'The installed baton2 alias is missing or not executable')
            require(archive_digest(alias) == digest,
                    'The installed baton2 alias differs from the focused facade')
            require(checksums.get(layout['alias']) == digest,
                    'The installed baton2 alias is absent from SHA256SUMS')
        else:
            require(record.get('alias') is None,
                    'The ' + record['role'] + ' binary has an unexpected alias')
        records.append({'role': record['role'], 'path': layout['path'],
                        'sha256': digest, 'source': source,
                        'entry': layout['entry'], 'build_mode': layout['build_mode']})
    require(seen == set(expected), 'The installation is missing the focused, full or registrar binary')
    focused = next(record for record in records if record['role'] == 'focused-facade')
    binary = manifest.get('binary')
    require(isinstance(binary, dict) and binary.get('path') == focused['path']
            and binary.get('alias') == 'bin/baton2' and binary.get('sha256') == focused['sha256'],
            'The compatibility binary record does not match the focused facade')
    receipt_path = prefix / 'install-receipt.json'
    require(receipt_path.is_file() and not receipt_path.is_symlink(),
            'The installation is missing its install receipt')
    receipt = json.loads(receipt_path.read_text())
    require(receipt.get('schema') == 'baton2-native-install-receipt-v1',
            'The installation receipt schema is unsupported')
    require(receipt.get('manifest', {}).get('sha256') == archive_digest(prefix / 'manifest.json'),
            'The installation receipt differs from the manifest')
    require(receipt.get('binaries') == manifest.get('binaries'),
            'The installation receipt binary pins differ from the manifest')
    require(receipt.get('source') == manifest.get('source'),
            'The installation receipt source differs from the manifest')
    require(checksums.get('manifest.json') == archive_digest(prefix / 'manifest.json')
            and checksums.get('install-receipt.json') == archive_digest(receipt_path),
            'The manifest or install receipt is absent from SHA256SUMS')
    return records

def check(prefix, output):
    manifest_path = prefix / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    checksums = verify_checksums(prefix)
    binaries = verify_binaries(prefix, manifest, checksums)
    dependency = verify_repl(prefix, manifest)
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

    run([prefix / 'bin/baton', '--help'])
    run([prefix / 'bin/baton-full', '--help'])
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
            'install_receipt_sha256': archive_digest(prefix / 'install-receipt.json'),
            'checksums_sha256': archive_digest(prefix / 'SHA256SUMS'),
            'binaries': binaries,
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
