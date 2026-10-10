#!/usr/bin/env python3
"""Build and package the Darwin arm64 native artifact."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import subprocess
import tarfile
import time


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_ROOT = 'baton2-development-darwin-arm64'
COMPILER_ARCHIVE_SHA256 = 'c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31'
COMPILER_ARCHIVE_URL = 'https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz'
COMPILER_LICENSE_URL = 'https://raw.githubusercontent.com/bendlang/bend/v2.0.25/LICENSE'
COMPILER_LICENSE_SHA256 = '0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def output_path(path, root):
    return str(path.relative_to(root))


def module_directory_name(module_id):
    require(isinstance(module_id, str) and module_id, 'A selected module needs a non-empty identity')
    try:
        encoded = module_id.encode('utf-8').hex()
    except UnicodeEncodeError as error:
        raise RuntimeError('A selected module identity is not valid Unicode') from error
    return 'm-' + encoded


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def source_identity():
    return {'commit': git('rev-parse', 'HEAD'), 'status': git('status', '--porcelain=v1')}


def build(env, directory):
    argv = ['sh', 'bend2/scripts/build-native.sh']
    stdout = directory / 'build.stdout'
    stderr = directory / 'build.stderr'
    started = time.monotonic()
    with stdout.open('wb') as out, stderr.open('wb') as err:
        result = subprocess.run(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=err)
    record = {'argv': argv, 'cwd': str(ROOT), 'exit_code': result.returncode,
              'elapsed_seconds': time.monotonic() - started,
              'stdout': {'path': output_path(stdout, directory)},
              'stderr': {'path': output_path(stderr, directory)}}
    if env.get('BEND_GENERATED_C'):
        record['generated_c_input'] = env['BEND_GENERATED_C']
    write_json(directory / 'build.json', record)
    require(result.returncode == 0, 'Native build failed; full output is retained in ' + str(directory))
    return record


def archive_notices(archive):
    require(sha256(archive) == COMPILER_ARCHIVE_SHA256,
            'Compiler archive does not match the upstream Bend 2.0.25 pin')
    notices = []
    with tarfile.open(archive, 'r:gz') as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts,
                    'Unsafe compiler archive member: ' + member.name)
            if member.isfile():
                base = path.name.upper()
                if base in ('LICENSE', 'NOTICE', 'COPYING') or base.startswith(('LICENSE.', 'NOTICE.', 'COPYING.')):
                    with source.extractfile(member) as stream:
                        notices.append((path, stream.read()))
    return notices


def stage_adapters(payload):
    directory = payload / 'libexec/baton2'
    directory.mkdir(parents=True)
    for harness in ('codex', 'omp', 'mcp'):
        for suffix in ('conductor', 'root'):
            name = harness + '-' + suffix + '.mjs'
            shutil.copyfile(ROOT / 'bend2/scripts' / name, directory / name)
    shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', directory / 'git-series.mjs')
    shutil.copyfile(ROOT / 'bend2/harness/native-history.mjs', directory / 'native-history.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/codex-inbox-wake.mjs', directory / 'codex-inbox-wake.mjs')
    shutil.copytree(ROOT / 'bend2/ui/orchestra', directory / 'ui')
    shutil.copyfile(ROOT / 'bend2/scripts/context-provider.mjs', directory / 'context-provider.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-project-policy.mjs', directory / 'context-project-policy.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-query-artifact.mjs', directory / 'context-query-artifact.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-worktree-capture.mjs', directory / 'context-worktree-capture.mjs')


def stage_selected_context_payload(payload, module_name='bend2'):
    source_root = ROOT / 'bend2/context' / module_name
    module_label = 'Bend2' if module_name == 'bend2' else module_name
    declaration_path = source_root / 'selected-module.json'
    require(declaration_path.is_file() and not declaration_path.is_symlink(),
            'The selected ' + module_label + ' module file list is unavailable')
    declaration = json.loads(declaration_path.read_text())
    require(isinstance(declaration, dict) and isinstance(declaration.get('moduleId'), str)
            and declaration['moduleId'] and isinstance(declaration.get('protocolVersion'), str)
            and isinstance(declaration.get('files'), list)
            and declaration['files'], 'The selected ' + module_label + ' module has no files')

    module_root = payload / 'lib/context/modules' / module_directory_name(declaration['moduleId'])
    module_root.mkdir(parents=True)
    seen = set()
    for entry in declaration['files']:
        require(isinstance(entry, dict) and isinstance(entry.get('path'), str),
                'A selected ' + module_label + ' artifact needs a path')
        relative = PurePosixPath(entry['path'])
        require(not relative.is_absolute() and relative.parts
                and '..' not in relative.parts and '.' not in relative.parts,
                'Unsafe selected ' + module_label + ' artifact path: ' + str(relative))
        name = relative.as_posix()
        require(name not in seen, 'Duplicate selected ' + module_label + ' artifact: ' + name)
        seen.add(name)
        source = source_root.joinpath(*relative.parts)
        # A declared entry may carry the one original source it is copied from, which keeps a helper
        # defined once while each installed module stays self-contained: the copied bytes are hashed
        # into the module's artifact identities like any other artifact.
        from_entry = entry.get('from')
        if from_entry is not None:
            require(isinstance(from_entry, str) and from_entry, 'Selected ' + module_label
                    + ' artifact needs a source path: ' + name)
            shared_relative = PurePosixPath(from_entry)
            require(not shared_relative.is_absolute() and shared_relative.parts
                    and '..' not in shared_relative.parts and '.' not in shared_relative.parts,
                    'Unsafe shared artifact path: ' + from_entry)
            context_root = (ROOT / 'bend2/context').resolve()
            source = ROOT.joinpath('bend2/context', *shared_relative.parts)
            resolved = source.resolve()
            require(resolved.is_relative_to(context_root) and source.is_file()
                    and not source.is_symlink(),
                    'Shared ' + module_label + ' artifact is missing or outside the context tree: '
                    + from_entry)
        else:
            resolved = source.resolve()
            require(resolved.is_relative_to(source_root.resolve()) and source.is_file()
                    and not source.is_symlink(),
                    'Selected ' + module_label + ' artifact is missing or outside its module root: ' + name)
        destination = module_root.joinpath(*relative.parts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    return {'moduleId': declaration['moduleId'],
            'protocolVersion': declaration['protocolVersion'],
            'path': module_root.relative_to(payload).as_posix()}


def stage_typescript_context_module(payload, runtime_package):
    selected = stage_selected_context_payload(payload, 'typescript')
    module_root = payload / selected['path']
    compiler_root = module_root / 'node_modules/typescript'
    shutil.copytree(runtime_package, compiler_root)
    compiler = json.loads((compiler_root / 'package.json').read_text())
    artifacts = [{'packagePath': path.relative_to(module_root).as_posix(),
                  'sha256': sha256(path), 'role': 'provider' if path.name == 'native-provider.mjs'
                  else 'provider-library'}
                 for path in sorted(module_root.rglob('*.mjs'))]
    dependencies = [{'packagePath': 'node_modules/typescript/' + name,
                     'sha256': sha256(compiler_root / name), 'role': 'typescript-compiler'}
                    for name in ('package.json', 'lib/typescript.js')]
    operation = {
        'schema': 'baton2-native-operation-v1', 'operation': 'sourceAnalysis',
        'implements': 'sourceAnalysis', 'subjectSchema': 'baton2.context.typescript.subject.v1',
        'optionsSchema': 'baton2.context.typescript.options.v1',
        'projections': ['definition', 'type', 'references', 'calls', 'callers',
                        'dependencies', 'diagnostics', 'flow', 'exceptions', 'databaseAccesses'],
        'effects': [], 'dependencies': [], 'execution': 'managed',
        'resultSchema': 'baton2.context.typescript.source-analysis.result.v1',
        'referenceSchema': 'baton2.context.typescript.reference.v1',
        'eventSchema': 'baton2.context.typescript.source-analysis.event.v1',
        'lifetimeProfile': '',
    }
    identity = hashlib.sha256(json.dumps(artifacts + dependencies, sort_keys=True).encode()).hexdigest()
    declaration = {
        'schema': 'baton2-native-module-declaration-v1', 'moduleId': 'typescript',
        'revision': compiler['version'], 'protocolVersion': '2',
        'packageIdentity': 'sha256:' + identity,
        'entry': {'artifact': 'native-provider.mjs', 'argv': []},
        'artifactIdentities': artifacts, 'dependencies': dependencies,
        'schemaIdentities': [operation['subjectSchema'], operation['optionsSchema'],
                             operation['resultSchema'], operation['referenceSchema'],
                             operation['eventSchema']],
        'applicability': [{'kind': 'pathSuffixAny',
                           'values': ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']}],
        'operations': [operation],
        'runtime': {'name': 'node', 'minimumVersion': '22.15'},
    }
    write_json(module_root / 'native-provider.declaration.json', declaration)
    return selected


def stage_runtime_context_module(payload):
    selected = stage_selected_context_payload(payload, 'runtime')
    module_root = payload / selected['path']
    declaration_path = module_root / 'native-provider.declaration.json'
    declaration = json.loads(declaration_path.read_text())
    files = json.loads((ROOT / 'bend2/context/runtime/selected-module.json').read_text())['files']
    artifacts = [{'packagePath': entry['path'],
                  'sha256': sha256(module_root / entry['path']),
                  'role': 'provider' if entry['path'] == 'native-provider.mjs' else 'runtime-support'}
                 for entry in files if entry['path'] != 'native-provider.declaration.json']
    declaration['artifactIdentities'] = artifacts
    declaration['packageIdentity'] = 'sha256:' + hashlib.sha256(
        json.dumps(artifacts, sort_keys=True).encode()).hexdigest()
    write_json(declaration_path, declaration)
    return selected


def stage_clang_module(payload, module_id, projections, runtime_package=None):
    source = ROOT / 'bend2/context/clang'
    module_source = source / 'modules' / module_id
    module_root = payload / 'lib/context/modules' / module_directory_name(module_id)
    module_root.mkdir(parents=True)
    for name in ('native-provider.mjs', 'shared.mjs'):
        source_file = module_source / name if name == 'native-provider.mjs' else source / 'modules/shared.mjs'
        destination = module_root / name
        shutil.copyfile(source_file, destination)
    adapter_dir = module_root / 'adapter'
    adapter_dir.mkdir()
    adapter_names = ['common.mjs', 'lsp.mjs', 'clangd.mjs'] if module_id == 'clangd' else [
        'common.mjs', 'clang-analyzer.mjs']
    for name in adapter_names:
        source_file = source / 'adapter' / name
        destination = adapter_dir / name
        shutil.copyfile(source_file, destination)
    if module_id == 'clang-analyzer':
        for name in ('clang-join.mjs', 'sqlite-statement.mjs', 'sql-scan.mjs'):
            shutil.copyfile(ROOT / 'bend2/context/catalogs' / name, module_root / name)
    if runtime_package is not None:
        runtime_root = module_root / 'runtime'
        shutil.copytree(runtime_package, runtime_root)
        extractor_binary = runtime_root / 'context-clang-20'
        require(extractor_binary.is_file(),
                'The supplied context-clang package must contain runtime/context-clang-20')
        extractor_binary.chmod(extractor_binary.stat().st_mode | 0o111)

    # NativeDecl records the provider entry and its runtime artifact identity.
    artifact_identities = [{'packagePath': 'native-provider.mjs',
                            'sha256': sha256(module_root / 'native-provider.mjs'),
                            'role': 'provider'}]
    operation = {
        'schema': 'baton2-native-operation-v1', 'operation': 'sourceAnalysis',
        'implements': 'sourceAnalysis', 'subjectSchema': 'baton2.context.clang.subject.v1',
        'optionsSchema': 'baton2.context.clang.options.v1', 'projections': projections,
        'effects': [], 'dependencies': [], 'execution': 'managed',
        'resultSchema': 'baton2.context.clang.source-analysis.result.v1',
        'referenceSchema': 'baton2.context.clang.reference.v1',
        'eventSchema': 'baton2.context.clang.source-analysis.event.v1',
        'lifetimeProfile': '',
    }
    # Explicit authored provider metadata the shared inventory exposes
    # verbatim: the options the provider actually accepts and one usable
    # version-1 native request. The schema identity strings stay
    # authoritative; these fields carry the shapes themselves.
    compile_database_option = {
        'type': 'string',
        'description': ('compile-command database path relative to the request '
                        'cwd; the default is compile_commands.json'),
    }
    if module_id == 'clangd':
        operation['optionsJsonSchema'] = {
            'type': 'object', 'additionalProperties': False,
            'properties': {'project': compile_database_option},
        }
        operation['requestExample'] = {
            'version': 1, 'engine': 'clangd',
            'subject': {'kind': 'position', 'path': 'src/handler.c',
                        'line': 40, 'column': 17},
            'select': ['definition'],
            'cwd': '/work/application', 'options': {}, 'effects': [],
        }
    else:
        operation['optionsJsonSchema'] = {
            'type': 'object', 'additionalProperties': False,
            'properties': {
                'project': compile_database_option,
                'database': {
                    'description': ('SQLite database file opened read-only for '
                                    'the constant-SQL join'),
                    'oneOf': [
                        {'type': 'string'},
                        {'type': 'object', 'additionalProperties': False,
                         'required': ['engine', 'path'],
                         'properties': {'engine': {'const': 'sqlite-schema'},
                                        'path': {'type': 'string'}}},
                    ],
                },
                'client': {
                    'type': 'string',
                    'description': 'restrict helper-call discovery to the named callee',
                },
            },
        }
        operation['requestExample'] = {
            'version': 1, 'engine': 'clang-analyzer',
            'subject': {'kind': 'symbol', 'path': 'src/handler.c',
                        'name': 'handler'},
            'select': ['type', 'calls', 'authorization', 'databaseAccesses'],
            'cwd': '/work/application',
            'options': {'project': 'compile_commands.json',
                        'database': {'engine': 'sqlite-schema',
                                     'path': 'owned.fossil'}},
            'effects': ['planTargetSql'],
        }
    declaration = {
        'schema': 'baton2-native-module-declaration-v1', 'moduleId': module_id,
        'revision': 'development', 'protocolVersion': '2',
        'packageIdentity': 'baton2-context-' + module_id,
        'entry': {'artifact': 'native-provider.mjs', 'argv': ['--invoke']},
        'artifactIdentities': artifact_identities,
        'dependencies': [],
        'schemaIdentities': [operation['subjectSchema'], operation['optionsSchema'],
                             operation['resultSchema'], operation['referenceSchema'],
                             operation['eventSchema']],
        'applicability': [{'kind': 'pathSuffixAny',
                           'values': ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp']}],
        'operations': [operation],
        'runtime': {'name': 'node', 'minimumVersion': '22.15'},
        'readiness': {'status': 'ready', 'operations': ['sourceAnalysis']},
    }
    write_json(module_root / 'native-provider.declaration.json', declaration)
    return {'moduleId': module_id, 'protocolVersion': '2',
            'path': module_root.relative_to(payload).as_posix()}


def stage_clang_context_modules(payload, runtime_package=None):
    selected = []
    selected.append(stage_clang_module(payload, 'clangd',
        ['definition', 'type', 'references', 'calls', 'callers', 'diagnostics']))
    if runtime_package is not None:
        require(runtime_package.is_dir(), 'The supplied context-clang package is unavailable')
        selected.append(stage_clang_module(payload, 'clang-analyzer',
            ['type', 'calls', 'diagnostics', 'authorization', 'databaseAccesses', 'flow'], runtime_package))
    return selected


def stage_notices(payload, compiler_notices, kind='development'):
    directory = payload / 'notices'
    directory.mkdir()
    terms = {'baton_root_license': None, 'baton_root_notice': None,
             'bend_reference_license': 'notices/bend-reference-LICENSE',
             'bend_compiler_runtime_license': {'path': 'notices/bend-2.0.25-LICENSE',
                                              'url': COMPILER_LICENSE_URL,
                                              'sha256': COMPILER_LICENSE_SHA256}}
    distribution = ['This is a Baton2 native ' + kind + ' artifact.']
    for name, field in (('LICENSE', 'baton_root_license'), ('NOTICE', 'baton_root_notice')):
        source = ROOT / name
        if source.is_file():
            destination = directory / ('baton2-' + name)
            shutil.copyfile(source, destination)
            terms[field] = {'source_path': name,
                            'path': destination.relative_to(payload).as_posix()}
            distribution.append('baton2-' + name + ' contains the Baton2 project '
                                + name.lower() + ' copied from root ' + name + '.')
    if terms['baton_root_license'] is None:
        distribution.extend(['This source snapshot has no root LICENSE.',
                             'The maintainer must resolve Baton2 distribution terms before a public release.'])
    reference = ROOT / 'docs/bend2/reference/upstream/LICENSE'
    require(sha256(reference) == COMPILER_LICENSE_SHA256,
            'The upstream Bend license differs from its versioned pin')
    shutil.copyfile(reference, directory / 'bend-reference-LICENSE')
    shutil.copyfile(reference, directory / 'bend-2.0.25-LICENSE')
    for path, data in compiler_notices:
        destination = directory / 'compiler-archive' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    distribution.extend([
        'bend-2.0.25-LICENSE is the pinned upstream compiler/runtime license at ' + COMPILER_LICENSE_URL + '.',
        'bend-reference-LICENSE applies to the separately pinned Bend reference.',
        'compiler-archive/ retains license and notice files found in the verified Bend archive.'])
    (directory / 'distribution.md').write_text('\n'.join(distribution) + '\n')
    return terms


def artifact_identity(release_version):
    if release_version is None:
        return {'archive_root': ARCHIVE_ROOT, 'kind': 'development'}
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', release_version) is not None,
            'Release version must be a single identifier starting with a letter or digit and containing letters, digits, dots, underscores, plus signs or hyphens')
    require((ROOT / 'LICENSE').is_file(), 'Release packaging requires the project root LICENSE')
    return {'archive_root': 'baton2-' + release_version + '-darwin-arm64',
            'kind': 'release', 'version': release_version}


def package(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    build_output = output / 'build'
    build_output.mkdir()
    result = {'status': 'running', 'source_directory': str(ROOT), 'output': str(output)}
    write_json(output / 'result.json', result)
    try:
        require(platform.system() == 'Darwin' and platform.machine() == 'arm64',
                'This native artifact requires a Darwin arm64 build host')
        identity = artifact_identity(args.release_version)
        compiler = args.bend.resolve()
        env = dict(os.environ, BEND=str(compiler))
        if args.generated_c is not None:
            env['BEND_GENERATED_C'] = str(args.generated_c.resolve())
        build_record = build(env, build_output)
        archive = args.compiler_archive.resolve()
        compiler_notices = archive_notices(archive)
        binary = ROOT / '.scratch/bend2/baton2'
        require(binary.is_file(), 'The production build did not create .scratch/bend2/baton2')
        generated = ROOT / '.scratch/bend2/baton2.c'
        if generated.is_file():
            shutil.copyfile(generated, build_output / 'baton2.c')
            build_record['generated_c'] = {'path': 'baton2.c'}
            write_json(build_output / 'build.json', build_record)
        source = {'directory': str(ROOT), **source_identity()}
        payload = output / identity['archive_root']
        (payload / 'bin').mkdir(parents=True)
        shutil.copyfile(binary, payload / 'bin/baton2')
        (payload / 'bin/baton2').chmod(0o755)
        stage_adapters(payload)
        selected_context = [stage_selected_context_payload(payload), stage_runtime_context_module(payload)]
        selected_context.extend(stage_clang_context_modules(payload, args.context_clang_package))
        if args.context_typescript_package is not None:
            selected_context.append(stage_typescript_context_module(payload, args.context_typescript_package))
        terms = stage_notices(payload, compiler_notices, identity['kind'])
        manifest = {
            'schema': 'baton2-native-artifact-v1', **identity,
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': {'system': platform.system(), 'machine': platform.machine(), 'artifact': 'darwin-arm64'},
            'source': source,
            'binary': {'path': 'bin/baton2'},
            'selected_modules': selected_context,
            'build': {'command': build_record, 'compiler_archive': {
                'url': COMPILER_ARCHIVE_URL, 'sha256': sha256(archive)}},
            'terms': terms,
        }
        write_json(payload / 'manifest.json', manifest)
        shutil.copyfile(payload / 'manifest.json', output / 'manifest.json')
        destination = output / (identity['archive_root'] + '-' + source['commit'] + '.tar.gz')
        with tarfile.open(destination, 'x:gz') as artifact:
            artifact.add(payload, arcname=identity['archive_root'])
        archive_sha = sha256(destination)
        (output / 'SHA256SUMS').write_text(archive_sha + '  ' + destination.name + '\n')
        result.update(status='packaged', archive={'path': destination.name, 'sha256': archive_sha},
                      manifest={'path': 'manifest.json'},
                      source=source, build=str(build_output))
        write_json(output / 'result.json', result)
        print(json.dumps(result), flush=True)
    except BaseException as error:
        result.update(status='failed', error=repr(error))
        write_json(output / 'result.json', result)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='new output directory, retained on failure')
    parser.add_argument('--bend', required=True, type=Path, help='installed Bend compiler')
    parser.add_argument('--compiler-archive', required=True, type=Path,
                        help='verified official Bend 2.0.25 archive used for license notices')
    parser.add_argument('--generated-c', type=Path,
                        help='compile a generated production C file on the package host')
    parser.add_argument('--context-clang-package', type=Path,
                        help='already-built context-clang-20 runtime package, including the executable and linked libraries')
    parser.add_argument('--context-typescript-package', type=Path,
                        help='installed TypeScript package to copy into the selected TypeScript module')
    parser.add_argument('--release-version', help='version identifier for a release archive; requires the project root LICENSE')
    args = parser.parse_args()
    package(args)


if __name__ == '__main__':
    main()
