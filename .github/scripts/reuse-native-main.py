#!/usr/bin/env python3
"""Verify a retained Main compilation against the current compilation inputs."""
import argparse
import difflib
import glob
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import traceback


ARCHIVE_SHA = '91c0e2640f8d2e3e73fd3dd62ed4d178ce9a6f7ce8f8980b4dc4abf7a6f9ccd4'
COMPILER_ARCHIVES = {
    ARCHIVE_SHA: {'name': 'Bend 2.0.25', 'official_release_artifact': True},
    '38bb1813d52ddc7b816a8a01f971fe8503959fef54795ca22eb346b5cfc069a7': {
        'name': 'Bend 2.0.25 with the Baton #741 pure memo patch',
        'official_release_artifact': False,
        'binary_sha256': 'b929035652cba78ba1b034b7214a14bbc2f64f0e6c27265c64c53895d24890c0',
    },
    '2df30208da307f7922fefc5517563ad1ee484bc60227f60d88994aad57e4779e': {
        'name': 'Bend 2.0.25 with Baton memoization and Bun small heap',
        'official_release_artifact': False,
        'binary_sha256': 'a36231553ac8e1ed447a5d413e5a6787e24ac86ffe7188bb9c96f3fb26e1b554',
    },
}
ENTRY = 'bend2/src/coordinator/main.bend'
HOST_SOURCE = 'bend2/src/host/process-spawn.c'
HOST_SUBSTITUTIONS = {
    ('92f8b1731faed7a08e94158a4dffd4cdeee53d380444ae963c8875378660619c',
     'c64fd0bc908fc5818653ac61883532b0c77cfd02e391ecd12fac8bc1287adf88'),
    ('467d693493be3e3700598700fa3789f3650b1f7e624331c5ad555c8be7323d99',
     'e6bb44937a9828c04e4b3c9683119e058c4b9d1984783bc742f5392d5199642b'),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def fact(path):
    require(path.is_file() and not path.is_symlink(), 'Expected a regular file: ' + str(path))
    return {'path': str(path), 'size_bytes': path.stat().st_size, 'sha256': digest(path)}


def verify_file(row):
    actual = fact(pathlib.Path(row['path']))
    require(all(actual[key] == row[key] for key in ('sha256', 'size_bytes')),
            'Retained file differs from its recorded bytes: ' + row['path'])
    return pathlib.Path(row['path'])


def verify_sharded_build(receipt_path, source, entry, output, path_map=None, tool_root=None):
    receipt_path = pathlib.Path(receipt_path).resolve()
    source, entry, output = (pathlib.Path(path).resolve() for path in (source, entry, output))
    resolve_recorded = path_map or (lambda value: pathlib.Path(value).resolve())

    def resolve_executable(value):
        try:
            resolved = pathlib.Path(resolve_recorded(value)).resolve()
        except ValueError:
            recorded = pathlib.Path(value)
            require(recorded.is_absolute() and '..' not in recorded.parts,
                    'Sharded Main executable path is not normalized.')
            resolved = recorded.resolve()
        require(resolved.is_file() and not resolved.is_symlink(),
                'Sharded Main executable is missing or indirect.')
        return resolved

    receipt = json.loads(receipt_path.read_text())
    require(receipt.get('schema') == 'baton2-clang-sharded-main-build-v2',
            'Unknown sharded Main build receipt.')
    require(receipt.get('route') == 'linux-x86_64-clang-19-no-pch',
            'Unexpected sharded Main build route.')
    require(resolve_recorded(receipt['source']) == source
            and receipt['source_sha256'] == digest(source), 'Sharded Main C source differs.')
    require(resolve_recorded(receipt['entry']) == entry
            and receipt['entry_sha256'] == digest(entry), 'Sharded Main native entry differs.')
    tool_root = pathlib.Path(tool_root).resolve() if tool_root else pathlib.Path(__file__).resolve().parents[2]
    splitter = tool_root / 'tools/cgen-clang-parallel/shard_emitted_c.py'
    require(resolve_recorded(receipt['splitter']) == splitter
            and receipt['splitter_sha256'] == digest(splitter), 'Sharder source differs.')
    driver = tool_root / 'tools/cgen-clang-parallel/build_native.py'
    require(resolve_recorded(receipt['driver']) == driver
            and receipt['driver_sha256'] == digest(driver), 'Sharded Main build driver differs.')
    manifest = receipt.get('split_manifest')
    manifest_bytes = json.dumps(manifest, sort_keys=True, separators=(',', ':')).encode()
    require(hashlib.sha256(manifest_bytes).hexdigest() == receipt.get('split_manifest_sha256'),
            'Sharded Main split manifest differs.')
    expected_names = ['baton_core.c', 'baton_spins.c'] + [f'shard_{index:02d}.c' for index in range(4)]
    compile_objects = receipt.get('compile_objects')
    require(receipt.get('shards') == 4 and len(compile_objects) == 6
            and [row['source_name'] for row in compile_objects] == expected_names
            and [row['object_name'] for row in compile_objects]
                == [pathlib.Path(name).with_suffix('.o').name for name in expected_names],
            'Sharded Main object list differs.')
    require(receipt.get('compile_flags') == ['-O1', '-pthread', '-Dmain=baton2_runtime_main'],
            'Sharded Main compile flags differ.')
    compiler_argv = receipt['compiler']
    compiler = resolve_executable(compiler_argv)
    require(receipt.get('compiler_sha256') == digest(compiler),
            'Sharded Main compiler executable differs.')
    compiler_version_probe = receipt.get('compiler_version_probe')
    require(isinstance(compiler_version_probe, dict)
            and compiler_version_probe.get('argv') == [compiler_argv, '--version']
            and compiler_version_probe.get('returncode') == 0
            and compiler_version_probe.get('wait_completed') is True
            and compiler_version_probe.get('natural_exit') is True,
            'Sharded Main compiler version probe is incomplete.')
    for key in ('stdout_sha256', 'stderr_sha256'):
        require(re.fullmatch(r'[0-9a-f]{64}', compiler_version_probe.get(key, '')) is not None,
                'Sharded Main compiler version stream digest is invalid.')
    require(receipt.get('compiler_version_sha256') == compiler_version_probe['stdout_sha256'],
            'Sharded Main compiler version digest differs.')
    version_run = subprocess.run([str(compiler), '--version'], check=False,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    require(version_run.returncode == 0
            and hashlib.sha256(version_run.stdout).hexdigest() == receipt['compiler_version_sha256']
            and hashlib.sha256(version_run.stderr).hexdigest() == compiler_version_probe['stderr_sha256'],
            'Sharded Main compiler version output differs.')
    version_text = version_run.stdout.decode(errors='replace')
    require(version_text.splitlines()
            and version_text.splitlines()[0] == receipt.get('compiler_version')
            and re.search(r'\bclang version 19(?:\.\d+)?\b', version_text) is not None,
            'Sharded Main compiler version is not the exact recorded Clang 19 build.')
    ccache = receipt.get('ccache', '')
    require(bool(ccache) == bool(receipt.get('ccache_sha256')),
            'Sharded Main ccache binding is incomplete.')
    if ccache:
        require(digest(resolve_executable(ccache)) == receipt['ccache_sha256'],
                'Sharded Main ccache executable differs.')
    require(receipt.get('segments') == manifest.get('counts', {}).get('segments'),
            'Sharded Main segment count differs from its manifest.')
    object_directory = pathlib.Path(resolve_recorded(receipt['object_directory'])).resolve()
    require(object_directory.parent == output.parent
            and object_directory.name.startswith(output.name + '.objects-')
            and object_directory.is_dir() and not object_directory.is_symlink(),
            'Sharded Main retained object directory is missing.')

    def validate_command_record(record, name):
        require(isinstance(record, dict)
                and isinstance(record.get('argv'), list)
                and record.get('returncode') == 0
                and record.get('wait_completed') is True
                and record.get('natural_exit') is True
                and isinstance(record.get('elapsed_seconds'), (int, float))
                and record['elapsed_seconds'] >= 0,
                'Sharded Main ' + name + ' process did not complete naturally.')
        for key in ('stdout_sha256', 'stderr_sha256'):
            require(re.fullmatch(r'[0-9a-f]{64}', record.get(key, '')) is not None,
                    'Sharded Main ' + name + ' stream digest is invalid.')
        return record['argv']

    split_argv = validate_command_record(receipt.get('split'), 'splitter')
    recorded_staging_directory = pathlib.Path(split_argv[5]).parent
    staging_directory = pathlib.Path(resolve_recorded(recorded_staging_directory)).resolve()
    require(len(split_argv) == 8
            and resolve_executable(split_argv[0])
            and resolve_recorded(split_argv[1]) == splitter
            and split_argv[2] == '--input' and resolve_recorded(split_argv[3]) == source
            and split_argv[4] == '--outdir'
            and pathlib.Path(split_argv[5]).is_absolute()
            and pathlib.Path(split_argv[5]).name == 'split'
            and staging_directory.parent == output.parent
            and staging_directory.name.startswith('.' + output.name + '.clang-shards-')
            and split_argv[6:8] == ['--shards', str(receipt['shards'])],
            'Sharded Main splitter invocation differs.')
    compile_prefix = ([ccache, compiler_argv] if ccache else [compiler_argv])
    compile_rows = []
    expected_names = ['baton_core.c', 'baton_spins.c'] + [f'shard_{index:02d}.c' for index in range(4)]
    with tempfile.TemporaryDirectory(prefix='baton-verify-sharded-main-') as temp:
        split_dir = pathlib.Path(temp)
        split_result = subprocess.run(
            [sys.executable, str(splitter), '--input', str(source),
             '--outdir', str(split_dir), '--shards', str(receipt['shards'])],
            check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        require(split_result.returncode == 0,
                'Sharded Main splitter could not rederive the retained C partition.')
        regenerated = json.loads((split_dir / 'manifest.json').read_text())
        expected_manifest = dict(manifest)
        require(resolve_recorded(expected_manifest.get('input', '')) == source,
                'Sharded Main split manifest input differs.')
        expected_manifest['input'] = regenerated['input']
        require(regenerated == expected_manifest,
                'Sharded Main split outputs differ from the retained manifest.')
        command_source_index = len(compile_prefix) + len(receipt['compile_flags']) + 1
        for row, name in zip(compile_objects, expected_names):
            require(set(row) == {'source_name', 'source_sha256', 'object_name',
                                 'object_path', 'object_sha256', 'compile'},
                    'Sharded Main compile row fields differ.')
            generated_source = split_dir / name
            require(row.get('source_sha256') == digest(generated_source),
                    'Sharded Main generated source hash differs: ' + name)
            object_path = pathlib.Path(resolve_recorded(row.get('object_path', ''))).resolve()
            require(object_path.parent == object_directory
                    and object_path.name == row['object_name']
                    and object_path.is_file() and not object_path.is_symlink()
                    and row.get('object_sha256') == digest(object_path),
                    'Sharded Main retained object differs: ' + name)
            argv = validate_command_record(row.get('compile'), 'compile ' + name)
            require(argv[:len(compile_prefix)] == compile_prefix
                    and argv[len(compile_prefix):command_source_index]
                        == receipt['compile_flags'] + ['-c']
                    and resolve_recorded(argv[command_source_index])
                        == staging_directory / 'split' / name
                    and argv[command_source_index + 1] == '-o'
                    and resolve_recorded(argv[command_source_index + 2])
                        == staging_directory / row['object_name'],
                    'Sharded Main compile invocation differs: ' + name)
            compile_rows.append(row)
    require({path.name for path in object_directory.iterdir()} ==
            {row['object_name'] for row in compile_rows},
            'Sharded Main retained object set differs.')
    aggregate_argv = validate_command_record(receipt.get('aggregate'), 'object aggregation')
    require(resolve_executable(aggregate_argv[0]) == compiler and aggregate_argv[1] == '-r'
            and [resolve_recorded(value) for value in aggregate_argv[2:8]]
                == [staging_directory / row['object_name'] for row in compile_rows]
            and aggregate_argv[8] == '-o'
            and resolve_recorded(aggregate_argv[9]) == staging_directory / (output.name + '.o'),
            'Sharded Main object aggregation invocation differs.')
    require(receipt.get('aggregate_command') == [compiler_argv, '-r',
            *[row['object_name'] for row in compile_objects], '-o', output.name + '.o'],
            'Sharded Main object aggregation command differs.')
    link_command = receipt.get('link_command', [])
    require(len(link_command) == 9 and link_command[:3] == [compiler_argv, '-O1', '-pthread']
            and resolve_recorded(link_command[3]) == entry
            and link_command[4:] == [output.name + '.o', '-lsqlite3', '-lm', '-o', output.name],
            'Sharded Main native link command differs.')
    link_argv = validate_command_record(receipt.get('link'), 'native link')
    require(link_argv[:3] == [compiler_argv, '-O1', '-pthread']
            and resolve_recorded(link_argv[3]) == entry
            and resolve_recorded(link_argv[4]) == staging_directory / (output.name + '.o')
            and link_argv[5:8] == ['-lsqlite3', '-lm', '-o']
            and resolve_recorded(link_argv[8]) == staging_directory / output.name,
            'Sharded Main native link execution differs.')
    object_file = output.with_name(output.name + '.o')
    require(resolve_recorded(receipt['object']) == object_file
            and receipt['object_sha256'] == digest(object_file), 'Sharded Main object differs.')
    require(resolve_recorded(receipt['output']) == output
            and receipt['output_sha256'] == digest(output), 'Sharded Main executable differs.')
    return {'status': 'verified', 'receipt': str(receipt_path),
            'receipt_sha256': digest(receipt_path), 'source_sha256': digest(source),
            'object_sha256': digest(object_file), 'output_sha256': digest(output),
            'route': receipt['route'],
            'retained_objects': [
                {'source_name': row['source_name'], 'object_name': row['object_name'],
                 'path': row['object_path'], 'size_bytes': pathlib.Path(
                     resolve_recorded(row['object_path'])).stat().st_size,
                 'sha256': row['object_sha256']}
                for row in compile_rows]}


def save(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def git(root, *args):
    return subprocess.check_output(['git', '-c', 'safe.directory=' + str(root), *args], cwd=root)


def source_files(root, commit, tree):
    require(git(root, 'rev-parse', 'HEAD').decode().rstrip('\n') == commit, 'Retained source HEAD differs.')
    require(git(root, 'rev-parse', 'HEAD^{tree}').decode().rstrip('\n') == tree, 'Retained source tree differs.')
    require(not git(root, 'status', '--porcelain', '--untracked-files=no'), 'Tracked source is dirty.')
    rows = []
    for record in git(root, 'ls-tree', '-rz', '--full-tree', 'HEAD').split(b'\0'):
        if not record:
            continue
        header, name = record.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        relative = name.decode()
        path = root / relative
        require(kind == 'blob' and mode in ('100644', '100755', '120000'),
                'Unsupported source entry: ' + relative)
        if mode == '120000':
            require(path.is_symlink(), 'Source link changed: ' + relative)
            body = os.fsencode(os.readlink(path))
        else:
            require(path.is_file() and not path.is_symlink(), 'Source file changed: ' + relative)
            require(bool(path.stat().st_mode & 0o111) == (mode == '100755'), 'Source mode changed: ' + relative)
            body = path.read_bytes()
        require(hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest() == oid,
                'Source bytes differ from Git: ' + relative)
        rows.append({'path': relative, 'mode': mode, 'git_blob': oid,
                     'size_bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    return rows


def production_inputs(root, rows):
    selected = sorted((row for row in rows if row['path'].startswith('bend2/src/')), key=lambda row: row['path'])
    expected = {row['path'] for row in selected}
    actual = {str(path.relative_to(root)) for path in (root / 'bend2/src').rglob('*')
              if path.is_file() or path.is_symlink()}
    if expected != actual:
        return selected, 'Production directory contains untracked or missing files.'
    for row in selected:
        path = root / row['path']
        if row['mode'] == '120000':
            return selected, 'A production symlink requires a normal compilation.'
        if path.suffix != '.bend':
            continue
        # Current Main imports are local modules and Base. External imports need a normal build.
        lines = path.read_text().splitlines()
        in_header = True
        for line in lines:
            if in_header and (not line.strip() or line.lstrip().startswith('#')):
                continue
            if in_header and line.startswith('import'):
                value = line[len('import'):].strip()
                if value == 'Base':
                    continue
                match = re.fullmatch(r'(\S+)\s+as\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+#.*)?', value)
                if not match:
                    return selected, 'A module import requires a normal compilation: ' + row['path']
                target = (path.parent / match[1]).resolve()
                if not target.is_relative_to(root / 'bend2/src') or target.suffix != '.bend':
                    return selected, 'A module import leaves the production directory: ' + row['path']
                continue
            in_header = False
            for match in re.finditer(r'\bimport\s+"([^"]+)"', line):
                target = (path.parent / match[1]).resolve()
                if not target.is_relative_to(root / 'bend2/src') or str(target.relative_to(root)) not in expected:
                    return selected, 'A foreign import leaves the production inputs: ' + row['path']
    return selected, None


def canonical_host_change(original, current):
    old = {row['path']: row for row in original}
    new = {row['path']: row for row in current}
    if old.keys() != new.keys():
        return False
    changed = [name for name in old if old[name] != new[name]]
    return (changed == [HOST_SOURCE]
            and old[HOST_SOURCE]['mode'] == new[HOST_SOURCE]['mode'] == '100644'
            and (old[HOST_SOURCE]['sha256'], new[HOST_SOURCE]['sha256']) in HOST_SUBSTITUTIONS)


def substitute_host(original_c, original_host, current_host):
    original_sha = hashlib.sha256(original_host).hexdigest()
    current_sha = hashlib.sha256(current_host).hexdigest()
    require((original_sha, current_sha) in HOST_SUBSTITUTIONS,
            'Foreign source hashes require an approved substitution pair.')
    require(original_c.count(original_host) == 1, 'Main C must contain the complete original foreign source once.')
    prefix, suffix = original_c.split(original_host)
    derived = prefix + current_host + suffix
    require(derived.count(current_host) == 1, 'Derived Main C must contain the complete current foreign source once.')
    return derived, {
        'schema': 'baton2-canonical-foreign-substitution-v1', 'path': HOST_SOURCE,
        'original_host_sha256': original_sha, 'current_host_sha256': current_sha,
        'offset': len(prefix),
        'prefix_size_bytes': len(prefix), 'prefix_sha256': hashlib.sha256(prefix).hexdigest(),
        'suffix_size_bytes': len(suffix), 'suffix_sha256': hashlib.sha256(suffix).hexdigest(),
        'original_c_size_bytes': len(original_c), 'original_c_sha256': hashlib.sha256(original_c).hexdigest(),
        'derived_c_size_bytes': len(derived), 'derived_c_sha256': hashlib.sha256(derived).hexdigest(),
    }


def verify_production_transition(origin, proof, current):
    original = json.loads((origin / 'production-inputs.json').read_text())
    recorded = json.loads((origin / 'current-production-inputs.json').read_text())
    require(current == recorded, 'Current production input membership, bytes or modes differ.')
    substitution = proof.get('foreign_source_substitution')
    if substitution is None:
        require(original == current, 'Main production inputs differ.')
        return
    require(canonical_host_change(original, current), 'Foreign substitution changes other production inputs.')
    old_host = (origin / 'foreign-source-original.c').read_bytes()
    new_host = (origin / 'foreign-source-current.c').read_bytes()
    original_c = (origin / 'baton2.original.c').read_bytes()
    derived, actual = substitute_host(original_c, old_host, new_host)
    require(actual == substitution, 'Canonical foreign substitution proof differs.')
    artifacts = json.loads((origin / 'build-artifacts.json').read_text())
    c_rows = [row['copy'] for row in artifacts if pathlib.Path(row['copy']['path']).name == 'baton2.c']
    require(len(c_rows) == 1 and c_rows[0]['sha256'] == actual['original_c_sha256']
            and c_rows[0]['size_bytes'] == actual['original_c_size_bytes'],
            'Original Main C differs from its completed build artifact.')
    require((origin / 'baton2.c').read_bytes() == derived, 'Derived Main C differs from the canonical substitution.')
    source = json.loads((origin / 'source-files.json').read_text())
    require(next(row for row in source if row['path'] == HOST_SOURCE)['sha256'] == actual['original_host_sha256'],
            'Original source does not bind the canonical foreign input.')
    require(next(row for row in recorded if row['path'] == HOST_SOURCE)['sha256'] == actual['current_host_sha256'],
            'Selected source does not bind the current foreign input.')


def distribution(archive, home):
    require(digest(archive) in COMPILER_ARCHIVES, 'Compiler archive differs from the pinned distributions.')
    expected = {}
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            parts = pathlib.PurePosixPath(member.name).parts
            require(parts and not member.name.startswith('/') and '..' not in parts, 'Unsafe compiler archive member.')
            relative = pathlib.PurePosixPath(*parts[1:])
            if member.isdir():
                continue
            require(str(relative) not in expected and str(relative) != '.', 'Duplicate compiler archive member.')
            path = home / relative
            if member.isfile():
                with source.extractfile(member) as stream:
                    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
                actual = fact(path)
                require(actual['sha256'] == sha and actual['size_bytes'] == member.size,
                        'Extracted compiler file differs from the archive: ' + str(relative))
                require(bool(path.stat().st_mode & 0o111) == bool(member.mode & 0o111),
                        'Extracted compiler executable mode differs: ' + str(relative))
                row = {'path': str(relative), 'size_bytes': member.size, 'sha256': sha,
                       'executable': bool(member.mode & 0o111)}
            elif member.issym():
                require(path.is_symlink() and os.readlink(path) == member.linkname,
                        'Extracted compiler link differs: ' + str(relative))
                require(path.resolve().is_relative_to(home), 'Compiler link leaves the distribution.')
                row = {'path': str(relative), 'link': member.linkname}
            else:
                raise ValueError('Unsupported compiler archive entry: ' + member.name)
            expected[str(relative)] = row
    actual = {str(path.relative_to(home)) for path in home.rglob('*') if path.is_file() or path.is_symlink()}
    require(actual == set(expected), 'Extracted compiler distribution has missing or additional files.')
    return [expected[key] for key in sorted(expected)]


def copy_record(row, destination):
    shutil.copyfile(verify_file(row), destination)


def directory_files(home, expected):
    rows = []
    for path in sorted(home.rglob('*')):
        if path.is_symlink():
            rows.append({'path': str(path.relative_to(home)), 'link': os.readlink(path)})
        elif path.is_file():
            rows.append({**fact(path), 'path': str(path.relative_to(home)),
                         'executable': bool(path.stat().st_mode & 0o111)})
    rows.sort(key=lambda row: row['path'])
    return rows, rows == expected


def select(args, result):
    root = args.source.resolve()
    result.update(schema='baton2-main-c-build-selection-v1', status='miss', root=str(root),
                  bound_root=args.bound_root, entry=ENTRY)
    require(digest(args.proof) == args.proof_sha256, 'Main C reuse proof differs from its verified digest.')
    proof = json.loads(args.proof.read_text())
    require(proof['schema'] == 'baton2-main-c-reuse-v1' and proof['status'] == 'reused'
            and proof['root'] == args.bound_root, 'Main C reuse proof does not bind the selected checkout.')
    origin = args.proof.parent.resolve() / 'main-c-origin'
    for row in proof['origin_assets']:
        path = args.proof.parent / row['path']
        require(path.resolve().is_relative_to(origin), 'Origin asset leaves Main compilation evidence.')
        verify_file({**row, 'path': str(path)})
    require(digest(args.generated_c) == proof['generated_c_sha256']
            and args.generated_c.stat().st_size == proof['generated_c_size'], 'Verified Main C bytes changed.')
    expected = json.loads((origin / 'current-production-inputs.json').read_text())
    rows = []
    for path in sorted((root / 'bend2/src').rglob('*')):
        if path.is_symlink():
            result['reason'] = 'A production symlink requires a normal compilation.'
            return
        if path.is_file():
            body = path.read_bytes()
            rows.append({'path': str(path.relative_to(root)),
                         'mode': '100755' if path.stat().st_mode & 0o111 else '100644',
                         'git_blob': hashlib.sha1(b'blob ' + str(len(body)).encode() + b'\0' + body).hexdigest(),
                         'size_bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
    rows.sort(key=lambda row: row['path'])
    result['production_inputs'] = rows
    if rows != expected:
        result['reason'] = 'Actual Main production input membership, bytes or modes differ.'
        return
    verify_production_transition(origin, proof, rows)
    compiler = args.compiler.resolve()
    require(compiler.name == 'bend' and compiler.parent.name == 'bin', 'Unexpected selected compiler layout.')
    actual, matches = directory_files(compiler.parent.parent, json.loads((origin / 'toolchain-files.json').read_text()))
    result.update(compiler=fact(compiler), compiler_distribution=actual)
    if not matches:
        result['reason'] = 'The selected compiler distribution differs from the verified Main compiler.'
        return
    result.update(status='reused', generated_c_sha256=proof['generated_c_sha256'],
                  proof_sha256=args.proof_sha256, origin_source_commit=proof['origin_source_commit'],
                  scope='original-checkout' if str(root) == args.bound_root else 'matching-production-inputs')
    if proof.get('foreign_source_substitution') is not None:
        result['foreign_source_substitution'] = proof['foreign_source_substitution']


def artifact_identity(handoff):
    return sorted((pathlib.Path(item['copy']['path']).name,
                   item['copy']['size_bytes'], item['copy']['sha256'])
                  for item in handoff['build_artifacts'])


def handoff_binding(path, expected_sha):
    handoff = json.loads(path.read_text())
    selected_sha = digest(path)
    if handoff.get('schema') == 'baton2-combined-main-ci-reference-v1':
        require(selected_sha == expected_sha, 'The combined Main CI reference digest differs.')
        original_path = verify_file(handoff['original_handoff'])
        original = json.loads(original_path.read_text())
        require(original.get('schema') == 'baton2-combined-main-handoff-v1',
                'The CI reference requires an original combined Main handoff.')
        return original, {'kind': 'combined-main-ci-reference', 'selected_sha256': selected_sha,
                          'requested_sha256': expected_sha, 'original_handoff': handoff['original_handoff'],
                          'path_maps': handoff['path_maps']}
    if selected_sha == expected_sha:
        return handoff, {'kind': 'selected-handoff', 'selected_sha256': selected_sha,
                         'requested_sha256': expected_sha}
    original_path = verify_file(handoff['origin_handoff'])
    require(digest(original_path) == expected_sha, 'Retained handoff and its original differ from the requested SHA256.')
    original = json.loads(original_path.read_text())
    for key in ('schema', 'source_commit', 'source_tree', 'source_clean_at_seed',
                'main_build_completed', 'actual_main_success_marker'):
        require(handoff[key] == original[key], 'Mapped handoff differs from its original: ' + key)
    for key in ('compiler', 'compiler_archive', 'base', 'build_stdout_as_of_boundary', 'build_stderr_as_of_boundary'):
        require(all(handoff[key][field] == original[key][field] for field in ('size_bytes', 'sha256')),
                'Mapped handoff changes original build bytes: ' + key)
    require(artifact_identity(handoff) == artifact_identity(original), 'Mapped handoff changes Main artifacts.')
    return handoff, {'kind': 'mapped-handoff', 'selected_sha256': selected_sha,
                     'requested_sha256': expected_sha, 'original_handoff': handoff['origin_handoff'],
                     'original_seed': original['source_seed_manifest']}


def legacy_evidence(handoff, binding, origin):
    for key, name in (('source_seed_manifest', 'seed.json'),
                      ('build_stdout_as_of_boundary', 'build.stdout'),
                      ('build_stderr_as_of_boundary', 'build.stderr')):
        copy_record(handoff[key], origin / name)
    require(b'.scratch/bend2/baton2\n' in (origin / 'build.stdout').read_bytes().splitlines(keepends=True),
            'Retained build output lacks the completed Main marker.')
    seed = json.loads((origin / 'seed.json').read_text())
    require(seed['schema'] == 'baton2-early-main-source-seed-v1' and seed['source_clean'] is True
            and seed['source_commit'] == handoff['source_commit'] and seed['source_tree'] == handoff['source_tree'],
            'Retained source seed differs from the Main handoff.')
    copy_record(seed['file_manifest'], origin / 'seed-files.json')
    if handoff.get('origin_handoff'):
        copy_record(handoff['origin_handoff'], origin / 'original-handoff.json')
    if seed.get('original_seed_manifest'):
        copy_record(seed['original_seed_manifest'], origin / 'original-seed.json')
    if binding['kind'] == 'mapped-handoff':
        require(seed['original_seed_manifest']['sha256'] == binding['original_seed']['sha256'],
                'Mapped seed does not bind the original Main seed.')
        original_seed = json.loads((origin / 'original-seed.json').read_text())
        for key in ('source_commit', 'source_tree', 'source_clean', 'original_native'):
            require(seed[key] == original_seed[key], 'Mapped seed changes original compiler/source identity: ' + key)
        require(seed['file_manifest']['sha256'] == original_seed['file_manifest']['sha256'],
                'Mapped seed changes the original source/toolchain file manifest.')
    return seed


def combined_evidence(handoff, binding, origin, compiler_archive):
    require(handoff['main_build_completed'] is True and handoff['qualification'] is False,
            'Combined handoff does not record a completed Main build.')
    mappings = []
    for item in binding.get('path_maps', []):
        require(set(item) == {'original', 'copy'}, 'Unexpected combined path mapping fields.')
        old, new = pathlib.Path(item['original']), pathlib.Path(item['copy'])
        require(old.is_absolute() and new.is_absolute() and '..' not in old.parts and '..' not in new.parts,
                'Combined path mappings require normalized absolute paths.')
        require(new.is_dir() and new.resolve() == new, 'Combined evidence mapping requires a real directory.')
        mappings.append((old, new))
    require(len({str(old) for old, _ in mappings}) == len(mappings), 'Duplicate combined path mappings.')

    def mapped(value):
        path = pathlib.Path(value)
        require(path.is_absolute() and '..' not in path.parts, 'Combined evidence path is not absolute.')
        matches = [(old, new) for old, new in mappings if path.is_relative_to(old)]
        if not matches:
            require(not mappings, 'Combined evidence path lacks a CI mapping: ' + str(path))
            return path
        old, new = max(matches, key=lambda pair: len(pair[0].parts))
        result = new / path.relative_to(old)
        require(result.resolve().is_relative_to(new), 'Combined mapped evidence leaves its copy root.')
        return result

    def retained(row):
        require(set(row) == {'path', 'bytes', 'sha256'}, 'Unexpected combined file fact fields.')
        actual = fact(mapped(row['path']))
        require(actual['size_bytes'] == row['bytes'] and actual['sha256'] == row['sha256'],
                'Combined retained bytes differ: ' + row['path'])
        return actual

    source = mapped(handoff['source']).resolve()
    commit = git(source, 'rev-parse', 'HEAD').decode().rstrip('\n')
    source_rows = source_files(source, commit, handoff['source_tree'])
    manifest = retained(handoff['source_manifest'])
    recorded_rows = json.loads(pathlib.Path(manifest['path']).read_text())
    expected_rows = [{'path': row['path'], 'kind': 'symlink' if row['mode'] == '120000' else 'file',
                      'bytes': row['size_bytes'], 'sha256': row['sha256'],
                      'mode': row['mode'], 'git_blob': row['git_blob']} for row in source_rows]
    require(sorted(recorded_rows, key=lambda row: row['path']) == sorted(expected_rows, key=lambda row: row['path']),
            'Combined source manifest differs from the clean Git snapshot.')
    copy_record(manifest, origin / 'combined-source-files.json')
    copy_record(retained(handoff['input_manifest']), origin / 'combined-input-manifest.json')
    check_fact = retained(handoff['source_check_proof'])
    copy_record(check_fact, origin / 'combined-source-check-proof.json')
    check = json.loads(pathlib.Path(check_fact['path']).read_text())
    check_result = retained(check['result'])
    copy_record(check_result, origin / 'combined-source-check-result.json')
    checked = json.loads(pathlib.Path(check_result['path']).read_text())
    require(check['source_tree'] == handoff['source_tree'] and check['natural_check_success_verified'] is True
            and checked['source_tree'] == handoff['source_tree'] and checked['success'] is True
            and len(checked['records']) == 1, 'Combined full source check differs.')
    checked_record = checked['records'][0]
    require(checked_record['returncode'] == 0 and checked_record['natural_exit'] is True
            and checked_record['original_wait_completed'] is True, 'Combined source check was incomplete.')
    compiler = retained(handoff['compiler'])
    logical_compiler = pathlib.Path(handoff['compiler']['path'])
    require(logical_compiler.name == 'bend' and logical_compiler.parent.name == 'bin',
            'Combined compiler layout differs.')
    native_build = handoff.get('native_build')
    if native_build is not None:
        require(set(native_build) == {'route', 'receipt', 'retained_objects'}
                and native_build['route'] == 'linux-x86_64-clang-19-no-pch',
                'Combined sharded Main build declaration differs.')
        receipt = retained(native_build['receipt'])
        receipt_copy = origin / 'sharded-main-build.json'
        copy_record(receipt, receipt_copy)
        receipt_data = json.loads(receipt_copy.read_text())
        retained_objects = native_build['retained_objects']
        require(len(retained_objects) == 6
                and [row.get('source_name') for row in retained_objects]
                    == [row['source_name'] for row in receipt_data['compile_objects']],
                'Combined sharded object custody is incomplete.')
        for object_row, compiled_row in zip(retained_objects, receipt_data['compile_objects']):
            require(set(object_row) == {'source_name', 'object_name', 'path',
                                        'copy_path', 'size_bytes', 'sha256'}
                    and object_row['object_name'] == compiled_row['object_name']
                    and object_row['path'] == compiled_row['object_path']
                    and object_row['sha256'] == compiled_row['object_sha256'],
                    'Combined sharded object custody differs from its build receipt.')
            copy_path = pathlib.Path(object_row['copy_path'])
            generated_root = origin.parent.resolve()
            retained_object_path = (generated_root / copy_path).resolve()
            require(copy_path == pathlib.Path('baton2-shard-objects') / object_row['object_name']
                    and retained_object_path.is_relative_to(generated_root)
                    and retained_object_path.is_file() and not retained_object_path.is_symlink()
                    and retained_object_path.stat().st_size == object_row['size_bytes']
                    and digest(retained_object_path) == object_row['sha256'],
                    'Combined retained shard object differs: ' + object_row['object_name'])
            original_object_path = mapped(object_row['path'])
            original_object_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(retained_object_path, original_object_path)
        c_artifact = next((item for item in handoff['build_artifacts']
                           if pathlib.Path(item['original']['path']).name == 'baton2.c'), None)
        object_artifact = next((item for item in handoff['build_artifacts']
                                if pathlib.Path(item['original']['path']).name == 'baton2.o'), None)
        binary_artifact = next((item for item in handoff['build_artifacts']
                                if pathlib.Path(item['original']['path']).name == 'baton2'), None)
        require(c_artifact and object_artifact and binary_artifact,
                'Combined sharded Main artifact set is incomplete.')
        entry = source / 'bend2/src/host/native-entry.c'
        sharded_validation = verify_sharded_build(
            receipt_copy, mapped(c_artifact['original']['path']), entry,
            mapped(binary_artifact['original']['path']), path_map=mapped, tool_root=source)
        require(mapped(receipt_data['object'])
                == mapped(object_artifact['original']['path']),
                'Sharded receipt object does not name the retained Main object.')
        save(origin / 'sharded-main-build-validation.json', sharded_validation)
        expected_phases = ('c-generation',)
    else:
        expected_phases = ('c-generation', 'main-object', 'native-link')
    native = None
    for phase in expected_phases:
        matches = [row for row in handoff['records'] if pathlib.Path(row['stdout']['path']).parent.name == phase]
        require(len(matches) == 1, 'Combined Main phase record is missing or repeated: ' + phase)
        row = matches[0]
        require(row['returncode'] == 0 and row['wait_status'] == 0 and row['natural_exit'] is True
                and row['original_wait'] is True and row['original_wait_completed'] is True,
                'Combined Main phase did not finish naturally: ' + phase)
        require(row['source_tree'] == handoff['source_tree'] and row['cwd'] == handoff['source'],
                'Combined Main phase source differs: ' + phase)
        stat_pid, stat_tail = row['stat_after_spawn'].split(' (', 1)
        require(int(stat_pid) == row['pid'] and stat_tail.rsplit(')', 1)[1].split()[19] == row['birth'],
                'Combined Main phase birth record differs: ' + phase)
        stdout, stderr = retained(row['stdout']), retained(row['stderr'])
        require(pathlib.Path(row['stderr']['path']).parent == pathlib.Path(row['stdout']['path']).parent,
                'Combined Main phase streams differ: ' + phase)
        result_path = pathlib.Path(stdout['path']).parent / 'result.json'
        require(json.loads(result_path.read_text()) == row, 'Combined phase differs from its retained result: ' + phase)
        copy_record(stdout, origin / (phase + '.stdout'))
        copy_record(stderr, origin / (phase + '.stderr'))
        shutil.copyfile(result_path, origin / (phase + '.json'))
        if phase == 'c-generation':
            require(row['argv'] == [str(logical_compiler), ENTRY, '-o', '.scratch/bend2/baton2.c'],
                    'Combined Main compiler invocation differs.')
            native = {'exe': compiler['path'],
                      'cmdline': ' '.join([compiler['path'], ENTRY, '-o', '.scratch/bend2/baton2.c']),
                      'environment': row['environment'], 'original_record': row}
        elif phase == 'main-object':
            argv = row['argv']
            if pathlib.Path(argv[0]).name == 'ccache-private':
                argv = argv[1:]
            require(argv == ['/usr/bin/clang-19', '-O1', '-pthread', '-Dmain=baton2_runtime_main',
                             '-c', '.scratch/bend2/baton2.c', '-o', '.scratch/bend2/baton2.o'],
                    'Combined Main object invocation differs.')
        elif phase == 'native-link':
            require(row['argv'] == ['/usr/bin/clang-19', '-O1', '-pthread', 'bend2/src/host/native-entry.c',
                                    '.scratch/bend2/baton2.o', '-lsqlite3', '-lm', '-o', '.scratch/bend2/baton2'],
                    'Combined Main native link invocation differs.')
    require(len([row for row in handoff['records']
                 if pathlib.Path(row['stdout']['path']).parent.name in
                 ('c-generation', 'main-object', 'native-link')]) == len(expected_phases),
            'Combined Main build phase set differs from its declared route.')
    artifacts = []
    for item in handoff['build_artifacts']:
        require(item['stable_during_copy'] is True, 'Combined Main artifact copy was unstable.')
        old, copy = retained(item['original']), retained(item['copy'])
        require(all(old[key] == copy[key] for key in ('size_bytes', 'sha256')),
                'Combined artifact copy differs from its original.')
        name = pathlib.Path(old['path']).name
        require(pathlib.Path(item['original']['path']) == pathlib.Path(handoff['source']) / '.scratch/bend2' / name
                and pathlib.Path(copy['path']).name == name, 'Combined artifact path differs.')
        artifacts.append({'original': old, 'copy': copy, 'stable_during_copy': True})
    base = fact(mapped(logical_compiler.parent.parent / 'bend2/base.bend'))
    archive = fact(compiler_archive.resolve())
    save(origin / 'combined-evidence-validation.json', {
        'schema': 'baton2-combined-main-reuse-validation-v1', 'source_snapshot_commit': commit,
        'source_tree': handoff['source_tree'], 'compiler_archive_verified_during_reuse': archive,
        'original_compiler_fact': handoff['compiler'], 'binding': binding,
        'original_compiler_invocation': native['original_record']})
    return {**handoff, 'source': str(source), 'source_commit': commit, 'compiler': compiler,
            'compiler_archive': archive, 'base': base, 'build_artifacts': artifacts}, {'original_native': native}


def prepare(args, result):
    root = args.source.resolve()
    generated = args.run.resolve() / 'generated'
    evidence = args.run.resolve() / 'evidence'
    generated.mkdir(parents=True, exist_ok=True)
    evidence.mkdir(parents=True, exist_ok=True)
    result.update(schema='baton2-main-c-reuse-v1', status='not-requested', entry=ENTRY,
                  current_source_commit=git(root, 'rev-parse', 'HEAD').decode().rstrip('\n'),
                  current_source_tree=git(root, 'rev-parse', 'HEAD^{tree}').decode().rstrip('\n'))
    if not args.handoff:
        require(not args.handoff_sha256, 'A handoff digest requires a retained handoff path.')
        return
    require(re.fullmatch('[0-9a-f]{64}', args.handoff_sha256), 'A retained handoff requires its exact SHA256.')
    pattern = os.path.expandvars(os.path.expanduser(args.handoff))
    paths = glob.glob(pattern)
    require(len(paths) <= 1, 'Retained handoff pattern matched multiple files.')
    result.update(status='miss', requested_handoff=args.handoff, requested_handoff_sha256=args.handoff_sha256)
    if not paths:
        result['reason'] = 'The retained handoff is unavailable on this runner.'
        return
    handoff_path = pathlib.Path(paths[0]).resolve()
    handoff, binding = handoff_binding(handoff_path, args.handoff_sha256)
    result['handoff_binding'] = binding
    combined = handoff['schema'] == 'baton2-combined-main-handoff-v1'
    require(combined or (handoff['schema'] == 'baton2-early-main-review-payload-v1'
            and handoff['main_build_completed'] is True and handoff['source_clean_at_seed'] is True),
            'Retained handoff does not record a completed clean Main build.')
    if not combined:
        require(handoff['actual_main_success_marker'] == '.scratch/bend2/baton2', 'Unexpected Main completion marker.')
    origin = generated / 'main-c-origin'
    origin.mkdir()
    shutil.copyfile(handoff_path, origin / 'handoff.json')
    if combined:
        if binding['kind'] == 'combined-main-ci-reference':
            copy_record(binding['original_handoff'], origin / 'original-combined-handoff.json')
        handoff, seed = combined_evidence(handoff, binding, origin, args.compiler_archive)
    else:
        seed = legacy_evidence(handoff, binding, origin)
    artifacts = []
    c_record = None
    for item in handoff['build_artifacts']:
        require(item['stable_during_copy'] is True, 'Retained Main artifact was unstable during copying.')
        verify_file(item['copy'])
        require(all(item['copy'][key] == item['original'][key] for key in ('sha256', 'size_bytes')),
                'Copied Main artifact differs from its original build.')
        artifacts.append(item)
        if pathlib.Path(item['copy']['path']).name == 'baton2.c':
            require(c_record is None, 'Multiple retained Main C artifacts.')
            c_record = item['copy']
    require(c_record is not None and len(artifacts) == 3 and {pathlib.Path(row['copy']['path']).name for row in artifacts}
            == {'baton2.c', 'baton2.o', 'baton2'}, 'Retained Main artifact set is incomplete.')
    save(origin / 'build-artifacts.json', artifacts)
    original = pathlib.Path(handoff['source']).resolve()
    old_rows = source_files(original, handoff['source_commit'], handoff['source_tree'])
    new_rows = source_files(root, result['current_source_commit'], result['current_source_tree'])
    old_inputs, old_issue = production_inputs(original, old_rows)
    new_inputs, new_issue = production_inputs(root, new_rows)
    save(origin / 'source-files.json', old_rows)
    save(origin / 'current-source-files.json', new_rows)
    save(origin / 'production-inputs.json', old_inputs)
    save(origin / 'current-production-inputs.json', new_inputs)
    old_compiler = verify_file(handoff['compiler'])
    old_archive = verify_file(handoff['compiler_archive'])
    old_base = verify_file(handoff['base'])
    require(old_base == old_compiler.parent.parent / 'bend2/base.bend', 'Retained Base path differs from compiler lookup.')
    old_distribution = distribution(old_archive, old_compiler.parent.parent)
    new_distribution = distribution(args.compiler_archive.resolve(), args.compiler.resolve().parent.parent)
    save(origin / 'toolchain-files.json', old_distribution)
    save(origin / 'current-toolchain-files.json', new_distribution)
    native = seed['original_native']
    command = native['cmdline'].split()
    require(command == [native['exe'], ENTRY, '-o', '.scratch/bend2/baton2.c'],
            'Retained compiler invocation differs from the Main build command.')
    require(native['environment'].get('BEND_NO_TELEMETRY') == '1', 'Retained compiler telemetry setting differs.')
    require(native['environment'].get('BUN_JSC_maxPerThreadStackUsage') == os.environ.get('BUN_JSC_maxPerThreadStackUsage'),
            'Current compiler stack setting differs from the retained invocation.')
    save(origin / 'compiler-invocation.json', {'original': native, 'current': {
        'entry': ENTRY, 'argv': [str(args.compiler.resolve()), ENTRY, '-o', '.scratch/bend2/baton2.c'],
        'cwd': str(root), 'BEND_NO_TELEMETRY': os.environ.get('BEND_NO_TELEMETRY'),
        'BUN_JSC_maxPerThreadStackUsage': os.environ.get('BUN_JSC_maxPerThreadStackUsage')}})
    host_change = canonical_host_change(old_inputs, new_inputs)
    if (old_issue or new_issue or (old_inputs != new_inputs and not host_change)
            or old_distribution != new_distribution):
        result['reason'] = old_issue or new_issue or 'Production inputs or compiler distribution differ.'
        result['origin_source_commit'] = handoff['source_commit']
        return
    if host_change:
        copy_record(c_record, origin / 'baton2.original.c')
        shutil.copyfile(original / HOST_SOURCE, origin / 'foreign-source-original.c')
        shutil.copyfile(root / HOST_SOURCE, origin / 'foreign-source-current.c')
        derived, substitution = substitute_host((origin / 'baton2.original.c').read_bytes(),
                                                (origin / 'foreign-source-original.c').read_bytes(),
                                                (origin / 'foreign-source-current.c').read_bytes())
        (origin / 'baton2.c').write_bytes(derived)
        (origin / 'foreign-source.patch').write_text(''.join(difflib.unified_diff(
            (origin / 'foreign-source-original.c').read_text().splitlines(keepends=True),
            (origin / 'foreign-source-current.c').read_text().splitlines(keepends=True),
            fromfile='original/' + HOST_SOURCE, tofile='current/' + HOST_SOURCE)))
        result['foreign_source_substitution'] = substitution
    else:
        copy_record(c_record, origin / 'baton2.c')
    archive = origin / 'source.tar.gz'
    with (origin / 'source-archive.stdout').open('wb') as stdout, (origin / 'source-archive.stderr').open('wb') as stderr:
        subprocess.run(['git', '-c', 'safe.directory=' + str(original), 'archive', '--format=tar.gz',
                        '--output=' + str(archive), handoff['source_commit']], cwd=original,
                       stdout=stdout, stderr=stderr, check=True)
    result.update(status='reused', origin_source_commit=handoff['source_commit'], origin_source_tree=handoff['source_tree'],
                  origin_handoff_sha256=binding['selected_sha256'], generated_c_sha256=digest(origin / 'baton2.c'),
                  generated_c_size=(origin / 'baton2.c').stat().st_size, root=str(root),
                  origin_assets=[{**fact(path), 'path': str(path.relative_to(generated))}
                                 for path in sorted(origin.rglob('*')) if path.is_file()])
    verify_production_transition(origin, result, new_inputs)
    proof = generated / 'main-c-reuse.json'
    save(proof, result)
    with args.github_env.open('a') as output:
        require('\n' not in str(root) and '\n' not in str(origin), 'Build paths contain a newline.')
        output.write('BATON2_MAIN_GENERATED_C=' + str(origin / 'baton2.c') + '\n')
        output.write('BATON2_MAIN_GENERATED_C_ROOT=' + str(root) + '\n')
        output.write('BATON2_MAIN_GENERATED_C_PROOF=' + str(proof) + '\n')
        output.write('BATON2_MAIN_GENERATED_C_PROOF_SHA256=' + digest(proof) + '\n')
        output.write('BATON2_MAIN_C_VERIFIER=' + str(root / '.github/scripts/reuse-native-main.py') + '\n')


def verify_transfer(args):
    generated = args.generated.resolve()
    result = json.loads((generated / 'main-c-reuse.json').read_text())
    require(result['schema'] == 'baton2-main-c-reuse-v1', 'Unknown Main C reuse proof.')
    if result['status'] != 'reused':
        require(result['status'] in ('miss', 'not-requested'), 'Main C reuse failed.')
        return result
    for row in result['origin_assets']:
        path = generated / row['path']
        require(path.resolve().is_relative_to(generated), 'Origin asset leaves generated C evidence.')
        verify_file({**row, 'path': str(path)})
    origin = generated / 'main-c-origin'
    require(digest(origin / 'handoff.json') == result['origin_handoff_sha256'], 'Origin handoff binding differs.')
    require(digest(generated / 'baton2.c') == result['generated_c_sha256']
            and (generated / 'baton2.c').stat().st_size == result['generated_c_size'], 'Reused Main C differs.')
    original_handoff = json.loads((origin / 'original-combined-handoff.json').read_text()) \
        if (origin / 'original-combined-handoff.json').is_file() else json.loads((origin / 'handoff.json').read_text())
    native_build = original_handoff.get('native_build')
    if native_build is not None:
        receipt_copy = origin / 'sharded-main-build.json'
        receipt_data = json.loads(receipt_copy.read_text())
        verify_sharded_transfer({
            'route': native_build['route'],
            'receipt_sha256': native_build['receipt']['sha256'],
            'output_sha256': receipt_data['output_sha256'],
            'object_sha256': receipt_data['object_sha256'],
            'retained_objects': native_build['retained_objects'],
        }, receipt_copy, generated, verify_outputs=False)
    rows = source_files(args.source.resolve(), result['current_source_commit'], result['current_source_tree'])
    require(rows == json.loads((origin / 'current-source-files.json').read_text()), 'Current full source differs from reuse proof.')
    current, issue = production_inputs(args.source.resolve(), rows)
    require(issue is None, 'Main production import scope differs.')
    verify_production_transition(origin, result, current)
    require(json.loads((origin / 'toolchain-files.json').read_text())
            == json.loads((origin / 'current-toolchain-files.json').read_text()), 'Main toolchain distributions differ.')
    expected = {row['path']: row for row in json.loads((origin / 'source-files.json').read_text())}
    seen = set()
    with tarfile.open(origin / 'source.tar.gz', 'r:gz') as archive:
        for member in archive:
            if member.isdir() or member.type == tarfile.XGLTYPE:
                continue
            require(member.name in expected and member.name not in seen, 'Unexpected origin source archive entry.')
            seen.add(member.name)
            row = expected[member.name]
            if row['mode'] == '120000':
                require(member.issym(), 'Origin source archive link changed.')
                body = member.linkname.encode()
                sha = hashlib.sha256(body).hexdigest()
                size = len(body)
            else:
                require(member.isfile() and bool(member.mode & 0o111) == (row['mode'] == '100755'),
                        'Origin source archive type or mode changed.')
                with archive.extractfile(member) as stream:
                    sha = hashlib.file_digest(stream, 'sha256').hexdigest()
                size = member.size
            require(sha == row['sha256'] and size == row['size_bytes'], 'Origin source archive bytes differ.')
    require(seen == set(expected), 'Origin source archive is incomplete.')
    return result


def verify_sharded_transfer(native_build, receipt_path, generated, verify_outputs=True):
    require(set(native_build) == {'route', 'receipt_sha256', 'output_sha256',
                                  'object_sha256', 'retained_objects'}
            and native_build['route'] == 'linux-x86_64-clang-19-no-pch',
            'Transferred sharded Main declaration differs.')
    receipt_path = pathlib.Path(receipt_path)
    require(receipt_path.is_file() and digest(receipt_path) == native_build['receipt_sha256'],
            'Transferred sharded Main build receipt differs.')
    receipt = json.loads(receipt_path.read_text())
    require(receipt['output_sha256'] == native_build['output_sha256']
            and receipt['object_sha256'] == native_build['object_sha256'],
            'Transferred sharded Main build result differs.')
    if verify_outputs:
        object_file = pathlib.Path(generated) / 'baton2.o'
        executable = pathlib.Path(generated) / 'baton2-linux-x64'
        require(object_file.is_file() and not object_file.is_symlink()
                and digest(object_file) == native_build['object_sha256'],
                'Transferred sharded aggregate object differs.')
        require(executable.is_file() and not executable.is_symlink()
                and digest(executable) == native_build['output_sha256'],
                'Transferred sharded executable differs.')
    rows = native_build['retained_objects']
    expected = receipt.get('compile_objects', [])
    require(isinstance(rows, list) and len(rows) == len(expected) == 6,
            'Transferred sharded object set is incomplete.')
    seen = set()
    for row, compiled in zip(rows, expected):
        require(set(row) == {'source_name', 'object_name', 'path', 'copy_path',
                             'size_bytes', 'sha256'}
                and row['source_name'] == compiled['source_name']
                and row['object_name'] == compiled['object_name']
                and row['path'] == compiled['object_path']
                and row['sha256'] == compiled['object_sha256'],
                'Transferred shard object receipt differs.')
        relative = pathlib.Path(row['copy_path'])
        require(relative == pathlib.Path('baton2-shard-objects') / row['object_name'],
                'Transferred shard object path differs.')
        object_path = pathlib.Path(generated) / relative
        require(object_path.is_file() and not object_path.is_symlink()
                and object_path.stat().st_size == row['size_bytes']
                and digest(object_path) == row['sha256'],
                'Transferred shard object bytes differ: ' + row['object_name'])
        seen.add(row['object_name'])
    object_directory = pathlib.Path(generated) / 'baton2-shard-objects'
    require(object_directory.is_dir() and not object_directory.is_symlink()
            and {path.name for path in object_directory.iterdir()} == seen,
            'Transferred shard object directory contents differ.')
    return {'status': 'verified', 'object_count': len(seen),
            'objects_sha256': hashlib.sha256(json.dumps(rows, sort_keys=True,
                separators=(',', ':')).encode()).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    prepare_parser = modes.add_parser('prepare')
    prepare_parser.add_argument('--source', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--run', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--handoff', default='')
    prepare_parser.add_argument('--handoff-sha256', default='')
    prepare_parser.add_argument('--compiler', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--compiler-archive', type=pathlib.Path, required=True)
    prepare_parser.add_argument('--github-env', type=pathlib.Path, required=True)
    verify_parser = modes.add_parser('verify-transfer')
    verify_parser.add_argument('--source', type=pathlib.Path, required=True)
    verify_parser.add_argument('--generated', type=pathlib.Path, required=True)
    sharded_transfer_parser = modes.add_parser('verify-sharded-transfer')
    sharded_transfer_parser.add_argument('--handoff', type=pathlib.Path, required=True)
    sharded_transfer_parser.add_argument('--generated', type=pathlib.Path, required=True)
    build_parser = modes.add_parser('verify-build')
    build_parser.add_argument('--receipt', type=pathlib.Path, required=True)
    build_parser.add_argument('--source', type=pathlib.Path, required=True)
    build_parser.add_argument('--entry', type=pathlib.Path, required=True)
    build_parser.add_argument('--output', type=pathlib.Path, required=True)
    select_parser = modes.add_parser('select')
    select_parser.add_argument('--source', type=pathlib.Path, required=True)
    select_parser.add_argument('--compiler', type=pathlib.Path, required=True)
    select_parser.add_argument('--proof', type=pathlib.Path, required=True)
    select_parser.add_argument('--proof-sha256', required=True)
    select_parser.add_argument('--bound-root', required=True)
    select_parser.add_argument('--generated-c', type=pathlib.Path, required=True)
    select_parser.add_argument('--output', type=pathlib.Path, required=True)
    args = parser.parse_args()
    if args.mode == 'verify-transfer':
        print(json.dumps(verify_transfer(args)))
        return
    if args.mode == 'verify-sharded-transfer':
        handoff = json.loads(args.handoff.read_text())
        native_build = handoff.get('main_native_build')
        require(native_build is not None, 'Sharded Main build record is missing.')
        receipt_path = args.generated / 'baton2.build.json'
        result = verify_sharded_transfer(native_build, receipt_path, args.generated.resolve())
        print(json.dumps(result))
        return
    if args.mode == 'verify-build':
        print(json.dumps(verify_sharded_build(args.receipt, args.source,
                                              args.entry, args.output)))
        return
    if args.mode == 'select':
        result = {'pid': os.getpid(), 'observed_at_ns': time.time_ns(), 'output': str(args.output.resolve())}
        try:
            select(args, result)
        except BaseException:
            result.update(status='error', error=traceback.format_exc())
            raise
        finally:
            save(args.output, result)
            retained = args.proof.parent / 'main-c-builds'
            retained.mkdir(exist_ok=True)
            record = retained / (str(result['observed_at_ns']) + '-' + str(os.getpid()) + '.json')
            save(record, result)
            summary = {key: value for key, value in result.items()
                       if key not in ('production_inputs', 'compiler_distribution')}
            summary['record'] = fact(args.output)
            summary['retained_record'] = fact(record)
            print(json.dumps(summary), file=sys.stderr)
        if result['status'] == 'reused':
            print(args.generated_c.resolve())
        return
    result = {}
    try:
        prepare(args, result)
    except BaseException:
        result.update(schema='baton2-main-c-reuse-v1', status='error', error=traceback.format_exc())
        raise
    finally:
        for directory in ('evidence', 'generated'):
            path = args.run.resolve() / directory
            path.mkdir(parents=True, exist_ok=True)
            save(path / 'main-c-reuse.json', result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
