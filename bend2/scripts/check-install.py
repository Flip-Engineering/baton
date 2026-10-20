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


def queue_executable(prefix):
    prefix = Path(prefix)
    for name in ('BATON2_COMPILE_QUEUE_BIN', 'BATON2_COMPILE_QUEUE'):
        value = os.environ.get(name)
        if value:
            path = Path(value)
            if path.is_file() and os.access(path, os.X_OK):
                return str(path)
            raise RuntimeError('The configured compile queue entry is unavailable: ' + value)
    for candidate in (str(prefix / 'bin' / 'baton-compile-queue'), shutil.which('baton-compile-queue')):
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise RuntimeError('The shared host compilation queue executable is not installed; '
                       'set BATON2_COMPILE_QUEUE_BIN or install bin/baton-compile-queue')

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
    {'role': 'focused-facade', 'path': 'bin/baton', 'alias': None,
     'entry': 'bend2/src/coordinator/receive-focused.bend', 'build_mode': 'focused-native-entry'},
    {'role': 'full-cli', 'path': 'bin/baton2', 'alias': 'bin/baton-full',
     'entry': 'bend2/src/coordinator/main.bend',
     'build_mode': 'full-native-receiver-router', 'wrapper': True},
    {'role': 'recovery-helper', 'path': 'bin/baton-recovery', 'alias': None,
     'entry': 'bend2/src/coordinator/receive-recovery-focused.bend',
     'build_mode': 'recovery-native-entry'},
)

def verify_dispatch_runtime(prefix):
    helper = prefix / 'libexec/baton2/task-start.mjs'
    require(helper.is_file() and not helper.is_symlink() and os.access(helper, os.R_OK),
            'The installation lacks the dispatch operation libexec/baton2/task-start.mjs')
    runtimes = [prefix / 'bin/node', prefix / 'libexec/baton2/repl/bun']
    require(any(path.is_file() and not path.is_symlink() and os.access(path, os.X_OK)
                for path in runtimes),
            'The installation has no Node or bundled Bun runtime for the dispatch operation')


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



def verify_payload_checksums(prefix, checksums):
    actual = {path.relative_to(prefix).as_posix() for path in prefix.rglob('*')
              if path.is_file() and path.relative_to(prefix).as_posix() != 'SHA256SUMS'}
    require(set(checksums) == actual, 'SHA256SUMS does not cover exactly the payload files')
    for name, digest in checksums.items():
        require(archive_digest(prefix / name) == digest, 'Payload checksum differs: ' + name)

def verify_binaries(prefix, manifest, checksums):
    require(manifest.get('schema') in ('baton2-native-install-v2', 'baton2-native-artifact-v2'),
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
        require(record.get('entry') == layout['entry'],
                'The installed ' + record['role'] + ' binary records another entry')
        require(record.get('build_mode') == layout['build_mode'],
                'The installed ' + record['role'] + ' binary records an unsupported build mode')
        source = record.get('source')
        require(isinstance(source, dict) and isinstance(source.get('status'), str),
                'The installed ' + record['role'] + ' binary lacks a source pin')
        commit_tree = (isinstance(source.get('commit'), str)
                       and re.fullmatch(r'[0-9a-f]{40}', source['commit']) is not None
                       and isinstance(source.get('tree'), str)
                       and re.fullmatch(r'[0-9a-f]{40}', source['tree']) is not None)
        manifest_pin = (isinstance(source.get('manifest_sha256'), str)
                        and re.fullmatch(r'[0-9a-f]{64}', source['manifest_sha256']) is not None)
        require(commit_tree or manifest_pin,
                'The installed ' + record['role'] + ' binary lacks an exact source commit/tree or manifest pin')
        if layout.get('wrapper'):
            c_sha = record.get('retained_c_sha256')
            require(c_sha is None or isinstance(c_sha, str)
                    and re.fullmatch(r'[0-9a-f]{64}', c_sha) is not None,
                    'The retained full C hash is malformed')
        if layout.get('wrapper'):
            wrapper = record.get('wrapper_source')
            require(isinstance(wrapper, dict) and isinstance(wrapper.get('commit'), str)
                    and re.fullmatch(r'[0-9a-f]{40}', wrapper['commit']) is not None
                    and isinstance(wrapper.get('status'), str)
                    and (isinstance(wrapper.get('tree'), str)
                         and re.fullmatch(r'[0-9a-f]{40}', wrapper['tree']) is not None
                         or isinstance(wrapper.get('manifest_sha256'), str)
                         and re.fullmatch(r'[0-9a-f]{64}', wrapper['manifest_sha256']) is not None),
                    'The installed full CLI lacks an exact wrapper source pin')
        if layout['alias']:
            require(record.get('alias') == layout['alias'],
                    'The ' + record['role'] + ' must expose its ' + layout['alias'] + ' alias')
            alias = prefix / layout['alias']
            require(alias.is_file() and not alias.is_symlink() and os.access(alias, os.X_OK),
                    'The installed ' + record['role'] + ' alias is missing or not executable')
            require(archive_digest(alias) == digest,
                    'The installed ' + record['role'] + ' alias differs from its binary')
            require(checksums.get(layout['alias']) == digest,
                    'The installed ' + record['role'] + ' alias ' + layout['alias'] + ' is absent from SHA256SUMS')
        else:
            require(record.get('alias') is None,
                    'The ' + record['role'] + ' binary has an unexpected alias')
        checked = {'role': record['role'], 'path': layout['path'],
                   'sha256': digest, 'source': source,
                   'entry': layout['entry'], 'build_mode': record['build_mode']}
        if layout.get('wrapper'):
            if record.get('retained_c_sha256'):
                checked['retained_c_sha256'] = record['retained_c_sha256']
        if layout.get('wrapper'):
            checked['wrapper_source'] = record['wrapper_source']
        records.append(checked)
    require(seen == set(expected), 'The installation is missing a focused, full, or recovery binary')
    source_manifest = manifest.get('source_manifest')
    require(isinstance(source_manifest, dict)
            and source_manifest.get('schema') == 'baton2-source-manifest-v1',
            'The installation is missing its composite source manifest')
    source_manifest_path = prefix / 'source-manifest.json'
    require(source_manifest_path.is_file() and not source_manifest_path.is_symlink()
            and json.loads(source_manifest_path.read_text()) == source_manifest,
            'The installed source-manifest.json differs from the manifest')
    focused = next(record for record in records if record['role'] == 'focused-facade')
    full = next(record for record in records if record['role'] == 'full-cli')
    recovery = next(record for record in records if record['role'] == 'recovery-helper')
    for role, record in (('focused', focused), ('full', full), ('recovery', recovery)):
        entry = source_manifest.get(role)
        require(isinstance(entry, dict) and entry.get('path') == record['path']
                and entry.get('sha256') == record['sha256']
                and entry.get('entry') == record['entry']
                and entry.get('source') == record['source'],
                'The composite source manifest differs for ' + role)
    require(source_manifest['full'].get('build_mode') == full['build_mode'],
            'The composite source manifest full build mode differs')
    require(source_manifest['full'].get('wrapper_source') == full.get('wrapper_source'),
            'The composite source manifest lacks the full wrapper source')
    if full.get('retained_c_sha256') is not None:
        require(source_manifest['full'].get('retained_c_sha256') == full['retained_c_sha256'],
                'The composite source manifest lacks the retained full C hash')
    require(source_manifest['recovery'].get('build_mode') == recovery['build_mode'],
            'The composite source manifest recovery build mode differs')
    closures = source_manifest.get('closures', {})
    require(isinstance(closures, dict), 'The composite source manifest closures are malformed')
    for role, closure in closures.items():
        require(isinstance(closure, dict) and isinstance(closure.get('path'), str)
                and isinstance(closure.get('sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', closure['sha256']) is not None,
                'The composite source closure record is malformed: ' + str(role))
        path = prefix / closure['path']
        require(path.is_file() and not path.is_symlink()
                and archive_digest(path) == closure['sha256'],
                'The installed source closure differs: ' + closure['path'])
        data = json.loads(path.read_text())
        require(isinstance(data, dict) and data.get('schema') == 'baton2-source-closure-v1'
                and isinstance(data.get('files'), list) and data['files'],
                'The installed source closure manifest is incomplete: ' + closure['path'])
    for role, record in (('focused', focused), ('full', full), ('recovery', recovery)):
        if 'commit' not in record['source'] or 'tree' not in record['source']:
            closure = closures.get(role)
            require(isinstance(closure, dict)
                    and closure.get('sha256') == record['source'].get('manifest_sha256'),
                    'The ' + role + ' manifest-only source pin lacks its bound source closure')
    if 'commit' not in full.get('wrapper_source', {}) or 'tree' not in full.get('wrapper_source', {}):
        closure = closures.get('full-wrapper')
        require(isinstance(closure, dict)
                and closure.get('sha256') == full['wrapper_source'].get('manifest_sha256'),
                'The full wrapper manifest-only source pin lacks its bound source closure')
    repl_source = source_manifest.get('repl')
    require(isinstance(repl_source, dict)
            and isinstance(repl_source.get('compiler_source'), str) and repl_source['compiler_source']
            and isinstance(repl_source.get('runtime'), str) and repl_source['runtime']
            and isinstance(repl_source.get('notices'), str) and repl_source['notices']
            and isinstance(repl_source.get('runtime_sha256'), str)
            and re.fullmatch(r'[0-9a-f]{64}', repl_source['runtime_sha256']) is not None,
            'The composite source manifest lacks required REPL pins')
    require([(row['role'], row['path'], row['sha256'], row['build_mode'])
             for row in source_manifest.get('binaries', [])]
            == [(record['role'], record['path'], record['sha256'], record['build_mode'])
                for record in records],
            'The composite source manifest binary list differs')
    binary = manifest.get('binary')
    require(isinstance(binary, dict) and binary.get('path') == focused['path']
            and binary.get('alias') is None and binary.get('sha256') == focused['sha256'],
            'The compatibility binary record does not match the focused receiver')
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
    require(receipt.get('source') == manifest.get('source')
            and receipt.get('source_manifest') == manifest.get('source_manifest'),
            'The installation receipt source or source manifest differs from the manifest')
    require(checksums.get('manifest.json') == archive_digest(prefix / 'manifest.json')
            and checksums.get('install-receipt.json') == archive_digest(receipt_path),
            'The manifest or install receipt is absent from SHA256SUMS')
    return records

def check(prefix, output):
    manifest_path = prefix / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    checksums = verify_checksums(prefix)
    verify_payload_checksums(prefix, checksums)
    binaries = verify_binaries(prefix, manifest, checksums)
    dependency = verify_repl(prefix, manifest)
    verify_dispatch_runtime(prefix)
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

    def compile_with_queue(args, input_file, options, cwd, compiler_name, linker, version_text):
        state = os.environ.get('BATON_COMPILE_QUEUE_ROOT')
        require(state is not None and Path(state).is_absolute(),
                'Set BATON_COMPILE_QUEUE_ROOT to the shared absolute compile-queue state directory')
        output_path = args[args.index('-o') + 1]
        command = [queue_executable(prefix), 'run', '--kind', 'cc',
                   '--state-root', state, '--cwd', cwd, '--compiler', compiler_name,
                   '--linker', linker, '--version', ' '.join(version_text.split()),
                   '--input', input_file, '--artifact', 'binary=' + str(output_path)]
        for option in options:
            command += ['--option', option]
        command += ['--', *args]
        run(command)

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
    linker = run([compiler, '-print-prog-name=ld'])
    require(bool(linker), 'The selected Clang did not report its linker')
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
    compile_with_queue([compiler, '-std=c11', *flags, str(source), '-lsqlite3', '-o', str(program)],
                       str(source), ['-std=c11', *flags], str(output), compiler, linker, version)
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
