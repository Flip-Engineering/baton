#!/usr/bin/env python3
"""Build and package the Darwin arm64 receiver-layout native artifact."""
import argparse
import datetime
import hashlib
import importlib.util
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
RETAINED_LINUX_COMPILER_ARCHIVE_SHA256S = (
    '2b2b41e938355141b55d617ee38157d50f62597c197e1b772486a7e517451065',
    '113a272649904e80144b1954dba8b4999249efa408a6ce1ca346906114986c4d',
)
DARWIN_SDK_MANIFEST_SHA256 = 'f6d597415b05891fb8666415757f4a9c851df942421cd42c8d1a4234a88c132f'
DARWIN_SDK_TREE_SHA256 = 'b6924d0319fefa3d5c7f218dcaf25898d46ea33c50f6c7ea4e0f436b6d0d5930'
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


def build_binary(env, directory, label, entry=None, focused=False, router=False, recovery=False):
    build_dir = directory / label
    build_dir.mkdir()
    output = ROOT / '.scratch/bend2' / label
    argv = ['sh', 'bend2/scripts/build-native.sh']
    if entry is not None:
        argv.extend([entry, str(output.relative_to(ROOT))])
    stdout = build_dir / 'build.stdout'
    stderr = build_dir / 'build.stderr'
    role_env = dict(env)
    if focused or label != 'baton-full':
        role_env.pop('BEND_GENERATED_C', None)
    if focused:
        role_env['BATON2_RECEIVE_FOCUSED'] = '1'
    if router:
        role_env['BATON2_NATIVE_RECEIVER_ROUTER'] = '1'
    if recovery:
        role_env['BATON2_RECOVERY_HELPER'] = '1'
    started = time.monotonic()
    with stdout.open('wb') as out, stderr.open('wb') as err:
        result = subprocess.run(argv, cwd=ROOT, env=role_env, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=err)
    record = {'argv': argv, 'cwd': str(ROOT), 'exit_code': result.returncode,
              'elapsed_seconds': time.monotonic() - started,
              'stdout': {'path': output_path(stdout, build_dir)},
              'stderr': {'path': output_path(stderr, build_dir)}}
    if role_env.get('BEND_GENERATED_C'):
        record['generated_c_input'] = role_env['BEND_GENERATED_C']
    write_json(build_dir / 'build.json', record)
    require(result.returncode == 0, 'Native ' + label + ' build failed; full output is retained in ' + str(build_dir))
    return output, record




BINARY_LAYOUT = (
    {'role': 'focused-facade', 'option': 'focused', 'label': 'baton-focused',
     'installed': 'bin/baton', 'alias': None,
     'entry': 'bend2/src/coordinator/receive-focused.bend',
     'build_mode': 'focused-native-entry', 'focused': True, 'router': False},
    {'role': 'full-cli', 'option': 'full', 'label': 'baton-full',
     'installed': 'bin/baton2', 'alias': 'bin/baton-full',
     'entry': 'bend2/src/coordinator/main.bend',
     'build_mode': 'full-native-receiver-router',
     'focused': False, 'router': True, 'wrapper': True},
    {'role': 'recovery-helper', 'option': 'recovery', 'label': 'baton-recovery',
     'installed': 'bin/baton-recovery', 'alias': None,
     'entry': 'bend2/src/coordinator/receive-recovery-focused.bend',
     'build_mode': 'recovery-native-entry', 'focused': False,
     'recovery': True},
)


def source_pin(commit, tree, status, manifest_sha256, default, directory=None):
    source_directory = str(Path(directory).resolve()) if directory is not None else str(ROOT)
    commit = default['commit'] if commit is None else commit
    require(re.fullmatch(r'[0-9a-f]{40}', commit) is not None,
            'A receiver binary source commit must be a 40-character lowercase Git object name')
    if status is None:
        status = default['status'] if commit == default['commit'] else ''
    require(isinstance(status, str), 'A receiver binary source status must be a string')
    if tree is None:
        try:
            tree = git('rev-parse', commit + '^{tree}')
        except Exception as error:
            raise RuntimeError('A receiver binary source tree is missing; supply its tree or source manifest hash') from error
    require(re.fullmatch(r'[0-9a-f]{40}', tree) is not None,
            'A receiver binary source tree must be a 40-character lowercase Git object name')
    if manifest_sha256 is not None:
        require(re.fullmatch(r'[0-9a-f]{64}', manifest_sha256) is not None,
                'A receiver binary source manifest must be a SHA256')
    pin = {'directory': source_directory, 'commit': commit, 'tree': tree, 'status': status}
    if manifest_sha256 is not None:
        pin['manifest_sha256'] = manifest_sha256
    return pin


def receiver_binaries(args):
    default = {'directory': str(ROOT), **source_identity()}
    specs = []
    for layout in BINARY_LAYOUT:
        option = layout['option']
        supplied = getattr(args, option + '_binary')
        commit = getattr(args, option + '_source_commit')
        require(supplied is None or commit is not None,
                'A supplied ' + layout['role'] + ' binary requires its explicit source commit')
        pin = source_pin(commit,
                         getattr(args, option + '_source_tree'),
                         getattr(args, option + '_source_status'),
                         getattr(args, option + '_source_manifest_sha256'), default,
                         getattr(args, option + '_source_directory', None))
        spec = {**layout, 'supplied': supplied, 'source': pin}
        if layout.get('wrapper'):
            c_sha = getattr(args, 'full_c_sha256', None)
            if c_sha is not None:
                require(re.fullmatch(r'[0-9a-f]{64}', c_sha) is not None,
                        'The retained full C hash must be a SHA256')
                spec['retained_c_sha256'] = c_sha
            wrapper_commit = getattr(args, 'full_wrapper_source_commit')
            require(supplied is None or wrapper_commit is not None,
                    'A supplied full CLI requires its explicit current wrapper source commit')
            require(commit is None or commit == default['commit'] or wrapper_commit is not None,
                    'A retained earlier full CLI requires its current wrapper source commit')
            spec['wrapper_source'] = source_pin(
                wrapper_commit, getattr(args, 'full_wrapper_source_tree'),
                getattr(args, 'full_wrapper_source_status'),
                getattr(args, 'full_wrapper_source_manifest_sha256'), default,
                getattr(args, 'full_wrapper_source_directory', None))
        specs.append(spec)
    return specs


def archive_notices(archive):
    require(sha256(archive) in (COMPILER_ARCHIVE_SHA256, *RETAINED_LINUX_COMPILER_ARCHIVE_SHA256S),
            'Compiler archive differs from the selected Bend 2.0.25 pins')
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


def stage_adapters(payload, helper_binaries=None):
    directory = payload / 'libexec/baton2'
    directory.mkdir(parents=True)
    for harness in ('codex', 'omp', 'mcp'):
        for suffix in ('conductor', 'root'):
            name = harness + '-' + suffix + '.mjs'
            shutil.copyfile(ROOT / 'bend2/scripts' / name, directory / name)
    shutil.copyfile(ROOT / 'bend2/scripts/omp-completion.mjs', directory / 'omp-completion.mjs')
    shutil.copytree(ROOT / 'bend2/harness/agy-plugin', directory / 'agy-plugin')
    shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', directory / 'git-series.mjs')
    shutil.copytree(ROOT / 'bend2/harness/git-series-bin', directory / 'git-series-bin')
    shutil.copyfile(ROOT / 'bend2/harness/native-history.mjs', directory / 'native-history.mjs')
    shutil.copyfile(ROOT / 'bend2/harness/project-settings.mjs', directory / 'project-settings.mjs')
    helper_binaries = helper_binaries or {}
    native_observe = helper_binaries.get('claude-credit-observe', ROOT / '.scratch/bend2/claude-credit-observe')
    require(native_observe.is_file() and not native_observe.is_symlink() and os.access(native_observe, os.X_OK),
            'native claude-credit-observe helper is missing or not executable')
    shutil.copyfile(native_observe, directory / 'claude-credit-observe')
    (directory / 'claude-credit-observe').chmod(0o755)
    native_key_exec = helper_binaries.get('api-key-exec', ROOT / '.scratch/bend2/api-key-exec')
    require(native_key_exec.is_file() and not native_key_exec.is_symlink() and os.access(native_key_exec, os.X_OK),
            'native api-key-exec helper is missing or not executable')
    shutil.copyfile(native_key_exec, directory / 'api-key-exec')
    (directory / 'api-key-exec').chmod(0o755)
    native_usage_read = helper_binaries.get('usage-read', ROOT / '.scratch/bend2/usage-read')
    require(native_usage_read.is_file() and not native_usage_read.is_symlink() and os.access(native_usage_read, os.X_OK),
            'native usage-read helper is missing or not executable')
    shutil.copyfile(native_usage_read, directory / 'usage-read')
    (directory / 'usage-read').chmod(0o755)
    shutil.copyfile(ROOT / 'bend2/harness/task-start.mjs', directory / 'task-start.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/dsh-worker.mjs', directory / 'dsh-worker.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/dsh-baton-hooks.mjs', directory / 'dsh-baton-hooks.mjs')
    shutil.copytree(ROOT / 'bend2/ui/orchestra', directory / 'ui')
    shutil.copyfile(ROOT / 'bend2/scripts/context-provider.mjs', directory / 'context-provider.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-project-policy.mjs', directory / 'context-project-policy.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-query-artifact.mjs', directory / 'context-query-artifact.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/context-worktree-capture.mjs', directory / 'context-worktree-capture.mjs')
    shutil.copyfile(ROOT / 'bend2/scripts/check-install.py', directory / 'check-install.py')


def system_dependencies(system):
    spec = importlib.util.spec_from_file_location('baton_install_check', ROOT / 'bend2/scripts/check-install.py')
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    return checker.system_dependencies(system)


def repl_inputs(args):
    selected = (args.repl_compiler_source, args.repl_runtime,
                args.repl_runtime_sha256, args.repl_runtime_notices)
    require(all(value is not None for value in selected),
            'Native packages require the REPL compiler source, platform Bun runtime, SHA256 and complete runtime notices')


def stage_repl(payload, args):
    repl_inputs(args)
    module_path = ROOT / 'bend2/scripts/stage-repl-compiler.py'
    spec = importlib.util.spec_from_file_location('baton_repl_compiler', module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    fact = module.stage(args.repl_compiler_source, args.repl_runtime,
                        args.repl_runtime_sha256, args.repl_runtime_notices,
                        payload / 'libexec/baton2/repl')
    return [{'id': 'bend2-repl-compiler', 'required': True,
             'path': 'libexec/baton2/repl', **fact}]


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
        'optionsJsonSchema': {
            'type': 'object',
            'properties': {
                'project': {
                    'type': 'string',
                    'description': 'TypeScript configuration path relative to cwd. Omission uses baseline compiler options.',
                },
                'readRoots': {
                    'type': 'array', 'items': {'type': 'string'},
                    'description': 'Explicit filesystem roots relative to cwd. Omission permits ordinary source and dependency reads.',
                },
                'database': {
                    'anyOf': [
                        {'type': 'string'},
                        {'type': 'object',
                         'properties': {'engine': {'const': 'sqlite-schema'},
                                        'path': {'type': 'string'}},
                         'required': ['engine', 'path']},
                        {'type': 'null'},
                    ],
                    'description': 'SQLite database path or selector used to join databaseAccesses to catalog objects.',
                },
                'client': {
                    'anyOf': [
                        {'type': 'object',
                         'properties': {'path': {'type': 'string'},
                                        'line': {'type': 'integer', 'minimum': 0},
                                        'column': {'type': 'integer', 'minimum': 0}},
                         'required': ['path', 'line', 'column']},
                        {'type': 'null'},
                    ],
                    'description': 'Database-client declaration path and zero-based line and column.',
                },
            },
        },
        'requestExample': {
            'version': 1, 'engine': 'typescript',
            'subject': {'kind': 'symbol', 'path': 'src/analysis.ts', 'name': 'answer'},
            'select': ['definition', 'type'], 'cwd': '.', 'options': {}, 'effects': [],
        },
    }
    join_operation = {
        **operation, 'operation': 'codeAccessJoin', 'implements': 'codeAccessJoin',
        'effects': ['planTargetSql'],
        'requestExample': {
            'version': 1, 'engine': 'typescript',
            'subject': {'kind': 'symbol', 'path': 'src/analysis.ts', 'name': 'answer'},
            'select': ['definition', 'type', 'databaseAccesses'], 'cwd': '.',
            'options': {'database': {'engine': 'sqlite-schema', 'path': 'catalog.db'},
                        'client': {'path': 'src/analysis.ts', 'line': 0, 'column': 17}},
            'effects': ['planTargetSql'],
        },
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
        'operations': [operation, join_operation],
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


def stage_source_closures(payload, args):
    closures = {}
    for role in ('focused', 'full', 'recovery', 'full-wrapper'):
        source = getattr(args, role.replace('-', '_') + '_source_closure', None)
        if source is None:
            continue
        source = Path(source).resolve()
        require(source.is_file() and not source.is_symlink(),
                'The source closure for ' + role + ' is unavailable')
        data = json.loads(source.read_text())
        require(isinstance(data, dict) and data.get('schema') == 'baton2-source-closure-v1'
                and isinstance(data.get('files'), list) and data['files'],
                'The source closure for ' + role + ' is not a complete closure manifest')
        seen = set()
        for entry in data['files']:
            require(isinstance(entry, dict) and isinstance(entry.get('path'), str) and entry['path']
                    and entry['path'] not in seen and isinstance(entry.get('bytes'), int)
                    and entry['bytes'] >= 0 and isinstance(entry.get('sha256'), str)
                    and re.fullmatch(r'[0-9a-f]{64}', entry['sha256']) is not None,
                    'The source closure for ' + role + ' has an invalid file record')
            seen.add(entry['path'])
        require(isinstance(data.get('diff_sha256'), str)
                and re.fullmatch(r'[0-9a-f]{64}', data['diff_sha256']) is not None,
                'The source closure for ' + role + ' has no source diff pin')
        name = 'source-closure-' + role + '.json'
        destination = payload / name
        shutil.copyfile(source, destination)
        closures[role] = {'path': name, 'sha256': sha256(destination)}
    return closures


def require_manifest_closures(specs, closures):
    for spec in specs:
        role = {'focused-facade': 'focused', 'full-cli': 'full',
                'recovery-helper': 'recovery'}[spec['role']]
        source = spec['source']
        if 'commit' not in source or 'tree' not in source:
            require(role in closures and closures[role]['sha256'] == source.get('manifest_sha256'),
                    'The ' + role + ' manifest-only source pin requires its bound complete source closure')
        if spec.get('wrapper_source'):
            wrapper = spec['wrapper_source']
            if 'commit' not in wrapper or 'tree' not in wrapper:
                require('full-wrapper' in closures
                        and closures['full-wrapper']['sha256'] == wrapper.get('manifest_sha256'),
                        'The full wrapper manifest-only source pin requires its bound complete source closure')



def stage_receiver_binaries(payload, specs, built, c_hashes=None):
    (payload / 'bin').mkdir(parents=True)
    records = []
    for spec in specs:
        destination = payload / spec['installed']
        shutil.copyfile(built[spec['role']], destination)
        destination.chmod(0o755)
        record = {'role': spec['role'], 'path': spec['installed'],
                  'sha256': sha256(destination), 'source': spec['source'],
                  'entry': spec['entry'], 'build_mode': spec['build_mode']}
        if spec.get('wrapper_source'):
            record['wrapper_source'] = spec['wrapper_source']
        if c_hashes and spec['role'] in c_hashes:
            record['retained_c_sha256'] = c_hashes[spec['role']]
        if spec['alias']:
            alias = payload / spec['alias']
            shutil.copyfile(built[spec['role']], alias)
            alias.chmod(0o755)
            record['alias'] = spec['alias']
        records.append(record)
    return records


def artifact_identity(release_version):
    if release_version is None:
        return {'archive_root': ARCHIVE_ROOT, 'kind': 'development'}
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._+-]*', release_version) is not None,
            'Release version must be a single identifier starting with a letter or digit and containing letters, digits, dots, underscores, plus signs or hyphens')
    require((ROOT / 'LICENSE').is_file(), 'Release packaging requires the project root LICENSE')
    return {'archive_root': 'baton2-' + release_version + '-darwin-arm64',
            'kind': 'release', 'version': release_version}


def artifact_target(args):
    target_system = getattr(args, 'target_system', None) or platform.system()
    target_machine = getattr(args, 'target_machine', None) or platform.machine()
    require(target_system == 'Darwin' and target_machine in ('arm64', 'aarch64'),
            'This native artifact requires a Darwin arm64 target')
    return target_system, 'arm64'


def configure_cross_host_build(args, environment, target_system, target_machine):
    cross_host = (platform.system(), platform.machine()) != (target_system, target_machine)
    supplied = [getattr(args, role + '_binary', None) for role in ('focused', 'full', 'recovery')]
    supplied.extend(getattr(args, role.replace('-', '_') + '_binary', None)
                     for role in ('claude-credit-observe', 'api-key-exec', 'usage-read'))
    if not cross_host or all(path is not None for path in supplied):
        return environment, cross_host
    require(not environment.get('BATON2_NATIVE_QUEUE_DRIVER') and not environment.get('BATON2_NATIVE_QUEUE'),
            'Cross-host compilation must select the shared homelab compile queue')
    llvm_input = getattr(args, 'darwin_llvm_root', None)
    sdk_input = getattr(args, 'darwin_sdkroot', None)
    require(llvm_input is not None and sdk_input is not None,
            'Cross-host compilation requires the staged LLVM toolchain and macOS SDK paths')
    llvm_root = llvm_input.resolve()
    sdkroot = sdk_input.resolve()
    require((llvm_root / 'bin/clang').is_file() and (llvm_root / 'bin/ld64.lld').is_file()
            and (sdkroot / 'usr/include').is_dir(),
            'The staged Darwin compiler, linker and SDK inputs are required for cross-host builds')
    sdk_manifest = sdkroot.with_name(sdkroot.name + '.transfer-manifest.json')
    require(sdk_manifest.is_file(), 'The staged macOS SDK transfer manifest is required')
    sdk_identity = json.loads(sdk_manifest.read_text())
    verification = sdk_identity.get('verification', {})
    require(sha256(sdk_manifest) == DARWIN_SDK_MANIFEST_SHA256
            and sdk_identity.get('schema') == 'baton2-private-sdk-transfer-v1'
            and Path(sdk_identity.get('destination', '')).resolve() == sdkroot
            and verification.get('destination_tree_sha256') == DARWIN_SDK_TREE_SHA256,
            'The staged macOS SDK transfer manifest does not identify this SDK tree')
    environment.update(CC=str(ROOT / 'bend2/scripts/darwin-arm64-clang.sh'),
                       BATON2_DARWIN_LLVM_ROOT=str(llvm_root),
                       BATON2_DARWIN_SDKROOT=str(sdkroot),
                       BATON2_DARWIN_SDK_MANIFEST_SHA256=DARWIN_SDK_MANIFEST_SHA256,
                       BATON2_DARWIN_SDK_TREE_SHA256=verification['destination_tree_sha256'])
    return environment, cross_host


def package(args):
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    build_output = output / 'build'
    build_output.mkdir()
    result = {'status': 'running', 'source_directory': str(ROOT), 'output': str(output)}
    write_json(output / 'result.json', result)
    try:
        repl_inputs(args)
        target_system, target_machine = artifact_target(args)
        identity = artifact_identity(args.release_version)
        compiler = args.bend.resolve()
        env = dict(os.environ, BEND=str(compiler))
        env, cross_host = configure_cross_host_build(args, env, target_system, target_machine)
        if args.generated_c is not None:
            env['BEND_GENERATED_C'] = str(args.generated_c.resolve())
        specs = receiver_binaries(args)
        built = {}
        builds = {}
        c_hashes = {}
        for spec in specs:
            role = spec['role']
            if spec['supplied'] is not None:
                path = spec['supplied'].resolve()
                require(path.is_file() and not path.is_symlink() and os.access(path, os.X_OK),
                        'The supplied ' + role + ' binary is unavailable or not executable: ' + str(path))
                built[role] = path
                builds[role] = {'mode': 'supplied', 'path': str(path), 'sha256': sha256(path)}
                if spec.get('retained_c_sha256'):
                    c_hashes[role] = spec['retained_c_sha256']
            else:
                path, record = build_binary(env, build_output, spec['label'],
                                            entry=spec['entry'], focused=spec['focused'],
                                            router=spec.get('router', False),
                                            recovery=spec.get('recovery', False))
                require(path.is_file(), 'The production build did not create ' + str(path))
                generated = path.with_name(path.name + '.c')
                if generated.is_file():
                    target = build_output / spec['label'] / (path.name + '.c')
                    shutil.copyfile(generated, target)
                    record['generated_c'] = {'path': target.relative_to(build_output).as_posix(),
                                             'sha256': sha256(target)}
                    if role == 'full-cli':
                        c_hashes[role] = record['generated_c']['sha256']
                    write_json(build_output / spec['label'] / 'build.json', record)
                built[role] = path
                builds[role] = {'mode': 'built', 'path': str(path), 'sha256': sha256(path)}
        helper_specs = (
            ('claude-credit-observe', 'claude_credit_observe_binary', 'claude-credit-observe',
             'bend2/harness/claude-credit-observe.bend'),
            ('api-key-exec', 'api_key_exec_binary', 'api-key-exec', 'bend2/harness/api-key-exec.bend'),
            ('usage-read', 'usage_read_binary', 'usage-read', 'bend2/harness/usage-read.bend'),
        )
        helper_binaries = {}
        helper_builds = {}
        for role, option, label, entry in helper_specs:
            supplied = getattr(args, option)
            if supplied is not None:
                path = supplied.resolve()
                require(path.is_file() and not path.is_symlink() and os.access(path, os.X_OK),
                        'The supplied ' + role + ' helper is unavailable or not executable: ' + str(path))
                helper_binaries[role] = path
                helper_builds[role] = {'mode': 'supplied', 'path': str(path), 'sha256': sha256(path)}
            elif cross_host:
                path, record = build_binary(env, build_output, label, entry=entry)
                require(path.is_file(), 'The production build did not create ' + str(path))
                helper_binaries[role] = path
                helper_builds[role] = {'mode': 'built', 'path': str(path), 'sha256': sha256(path),
                                        'build': record}
            else:
                helper_binaries[role] = ROOT / '.scratch/bend2' / label
                require(helper_binaries[role].is_file() and not helper_binaries[role].is_symlink()
                        and os.access(helper_binaries[role], os.X_OK),
                        'The existing ' + role + ' helper is missing or not executable')
                helper_builds[role] = {'mode': 'existing', 'path': str(helper_binaries[role]),
                                        'sha256': sha256(helper_binaries[role])}
        archive = args.compiler_archive.resolve()
        compiler_notices = archive_notices(archive)
        source = {'directory': str(ROOT), **source_identity(),
                  'tree': git('rev-parse', 'HEAD^{tree}')}
        payload = output / identity['archive_root']
        records = stage_receiver_binaries(payload, specs, built, c_hashes)
        closures = stage_source_closures(payload, args)
        require_manifest_closures(specs, closures)
        stage_adapters(payload, helper_binaries)
        repl_compiler = stage_repl(payload, args)
        selected_context = [stage_selected_context_payload(payload), stage_runtime_context_module(payload)]
        selected_context.extend(stage_clang_context_modules(payload, args.context_clang_package))
        if args.context_typescript_package is not None:
            selected_context.append(stage_typescript_context_module(payload, args.context_typescript_package))
        terms = stage_notices(payload, compiler_notices, identity['kind'])
        focused = next(record for record in records if record['role'] == 'focused-facade')
        full_record = next(record for record in records if record['role'] == 'full-cli')
        recovery_record = next(record for record in records if record['role'] == 'recovery-helper')
        source_manifest = {
            'schema': 'baton2-source-manifest-v1',
            'focused': {'path': focused['path'], 'sha256': focused['sha256'],
                        'entry': focused['entry'], 'source': focused['source']},
            'full': {'path': full_record['path'], 'sha256': full_record['sha256'],
                     'entry': full_record['entry'], 'source': full_record['source'],
                     'build_mode': full_record['build_mode']},
            'recovery': {'path': recovery_record['path'], 'sha256': recovery_record['sha256'],
                         'entry': recovery_record['entry'], 'source': recovery_record['source'],
                         'build_mode': recovery_record['build_mode']},
            'repl': {'compiler_source': str(args.repl_compiler_source),
                     'runtime': str(args.repl_runtime),
                     'runtime_sha256': args.repl_runtime_sha256,
                     'notices': str(args.repl_runtime_notices)},
            'binaries': [{'role': record['role'], 'path': record['path'],
                          'sha256': record['sha256'], 'build_mode': record['build_mode']}
                         for record in records],
            'closures': closures,
        }
        if full_record.get('wrapper_source') is not None:
            source_manifest['full']['wrapper_source'] = full_record['wrapper_source']
        if full_record.get('retained_c_sha256') is not None:
            source_manifest['full']['retained_c_sha256'] = full_record['retained_c_sha256']
        write_json(payload / 'source-manifest.json', source_manifest)
        manifest = {
            'schema': 'baton2-native-artifact-v2', **identity,
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': {'system': target_system, 'machine': 'arm64', 'artifact': 'darwin-arm64'},
            'source': source,
            'binaries': records, 'source_manifest': source_manifest,
            'binary': {'path': focused['path'], 'alias': focused.get('alias'),
                       'sha256': focused['sha256'], 'source': focused['source']},
            'selected_modules': selected_context,
            'selected_dependencies': repl_compiler,
            'required_system_dependencies': system_dependencies(target_system),
            'build': {'command': builds['full-cli'], 'compiler_archive': {
                'url': COMPILER_ARCHIVE_URL if sha256(archive) == COMPILER_ARCHIVE_SHA256 else None,
                'sha256': sha256(archive)},
                'compiler': {'path': str(compiler), 'sha256': sha256(compiler)},
                'host': {'system': platform.system(), 'machine': platform.machine()},
                'binaries': builds, 'supporting_binaries': helper_builds,
                'cross_compilation': ({'target': 'arm64-apple-macosx11.0',
                                       'compiler': str(Path(env['BATON2_DARWIN_LLVM_ROOT']) / 'bin/clang'),
                                       'linker': str(Path(env['BATON2_DARWIN_LLVM_ROOT']) / 'bin/ld64.lld'),
                                       'sysroot': env['BATON2_DARWIN_SDKROOT'],
                                       'sdk_manifest_sha256': env['BATON2_DARWIN_SDK_MANIFEST_SHA256'],
                                       'sdk_tree_sha256': env['BATON2_DARWIN_SDK_TREE_SHA256']}
                                      if 'BATON2_DARWIN_SDK_TREE_SHA256' in env else None)},
            'terms': terms,
        }
        write_json(payload / 'manifest.json', manifest)
        spec = importlib.util.spec_from_file_location(
            'finalize_native_payload', ROOT / 'bend2/scripts/finalize-native-payload.py')
        finalizer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(finalizer)
        finalizer.finalize(payload)
        shutil.copyfile(payload / 'manifest.json', output / 'manifest.json')
        destination = output / (identity['archive_root'] + '-' + source['commit'] + '.tar.gz')
        with tarfile.open(destination, 'x:gz') as artifact:
            artifact.add(payload, arcname=identity['archive_root'])
        archive_sha = sha256(destination)
        (output / 'SHA256SUMS').write_text(archive_sha + '  ' + destination.name + '\n')
        result.update(status='packaged', archive={'path': destination.name, 'sha256': archive_sha},
                      manifest={'path': 'manifest.json'}, binaries=records,
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
    parser.add_argument('--target-system', help='artifact operating system; defaults to the package host')
    parser.add_argument('--target-machine', help='artifact CPU architecture; defaults to the package host')
    parser.add_argument('--darwin-llvm-root', type=Path,
                        help='staged homelab LLVM directory for a queued Darwin arm64 cross-build')
    parser.add_argument('--darwin-sdkroot', type=Path,
                        help='staged macOS SDK used by the Darwin arm64 cross-build')
    for role in ('focused', 'full', 'recovery'):
        parser.add_argument('--' + role + '-binary', type=Path,
                            help='prebuilt ' + role + ' binary; otherwise build from source')
        parser.add_argument('--' + role + '-source-commit')
        parser.add_argument('--' + role + '-source-tree')
        parser.add_argument('--' + role + '-source-status')
        parser.add_argument('--' + role + '-source-directory')
        parser.add_argument('--' + role + '-source-manifest-sha256')
    for role in ('claude-credit-observe', 'api-key-exec', 'usage-read'):
        parser.add_argument('--' + role + '-binary', type=Path,
                            help='prebuilt Darwin helper binary; otherwise build through the shared queue')
    for role in ('focused', 'full', 'recovery', 'full-wrapper'):
        parser.add_argument('--' + role + '-source-closure', type=Path)
    parser.add_argument('--full-c-sha256', help='retained full generated-C SHA256')
    parser.add_argument('--full-wrapper-source-directory')
    for name in ('commit', 'tree', 'status', 'manifest_sha256'):
        parser.add_argument('--full-wrapper-source-' + name.replace('_', '-'))
    parser.add_argument('--context-clang-package', type=Path,
                        help='already-built context-clang-20 runtime package, including the executable and linked libraries')
    parser.add_argument('--context-typescript-package', type=Path,
                        help='installed TypeScript package to copy into the selected TypeScript module')
    parser.add_argument('--release-version', help='version identifier for a release archive; requires the project root LICENSE')
    parser.add_argument('--repl-compiler-source', type=Path, default=ROOT / 'bend2/compiler/upstream',
                        help='exact pinned compiler source; defaults to the required checked-in closure')
    parser.add_argument('--repl-runtime', type=Path, required=True,
                        help='required platform Bun executable for the bundled REPL compiler')
    parser.add_argument('--repl-runtime-sha256', required=True,
                        help='verified SHA256 of the required platform Bun executable')
    parser.add_argument('--repl-runtime-notices', type=Path, required=True,
                        help='complete distribution notices for the required Bun runtime')
    args = parser.parse_args()
    package(args)


if __name__ == '__main__':
    main()
