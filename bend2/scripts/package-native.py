#!/usr/bin/env python3
"""Build a Darwin arm64 native artifact with exact-source gate evidence."""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import shutil
import signal
import subprocess
import tarfile
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[2]
ARCHIVE_ROOT = 'baton2-development-darwin-arm64'
COMPILER_ARCHIVE_SHA256 = 'c5bb22ba029d5909da9c6db82aa037278a66d1cf8a5572f433879f7dcd866c31'
COMPILER_ARCHIVE_URL = 'https://github.com/bendlang/bend/releases/download/v2.0.25/bend-2.0.25-darwin-arm64.tar.gz'
COMPILER_LICENSE_URL = 'https://raw.githubusercontent.com/bendlang/bend/v2.0.25/LICENSE'
COMPILER_LICENSE_SHA256 = '0beb288abd3d067e231f3fbe7df1f8ee37344061fc67f22018150a19e4b26c35'
CONTEXT_PACKAGE_DIR = ROOT / 'bend2/context'
CONTEXT_STAGE_ROOT = 'libexec/baton2/context'
CONTEXT_PACKAGE_NAME = 'baton2-context'
CONTEXT_NODE_FLOOR = '>=22.15.0'
CONTEXT_DEPENDENCY_PINS = {'ajv': '8.17.1', 'typescript': '5.9.3', 'zod': '4.3.6'}
# License/notice files the LICENSE/NOTICE/COPYING prefix rule does not capture.
CONTEXT_EXTRA_NOTICES = {'typescript': ('ThirdPartyNoticeText.txt',)}
GATES = (
    ('build-native', ['sh', 'bend2/scripts/build-native.sh']),
    ('laws-check', ['node', 'bend2/scripts/laws-check.mjs']),
    ('check-native', ['sh', 'bend2/scripts/check-native.sh']),
)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def file_info(path):
    return {'bytes': path.stat().st_size, 'sha256': sha256(path)}


def write_json(path, value):
    """Write value as indented JSON and return only after the completed write.

    The guarantee is a complete written and closed file before the caller
    proceeds; it is not crash or power-loss durability, and no fsync is added.
    """
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def snapshot():
    binary = ROOT / '.scratch/bend2/baton2'
    return {
        'head': git('rev-parse', 'HEAD'), 'tree': git('rev-parse', 'HEAD^{tree}'),
        'bend2_tree': git('rev-parse', 'HEAD:bend2'),
        'status': git('status', '--porcelain=v1'),
        'binary_sha256': sha256(binary) if binary.is_file() else None,
    }


def same_source(observed, expected):
    for key in ('head', 'tree', 'bend2_tree', 'status'):
        require(observed[key] == expected[key], 'Exact source changed: ' + key)
    require(not observed['status'], 'Packaging requires committed, clean source')


def command(argv, cwd, env, directory, name):
    stdout = directory / (name + '.stdout')
    stderr = directory / (name + '.stderr')
    started = time.monotonic()
    with stdout.open('wb') as out, stderr.open('wb') as err:
        result = subprocess.run(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=out, stderr=err)
    receipt = {'argv': argv, 'cwd': str(cwd), 'exit_code': result.returncode,
               'elapsed_seconds': time.monotonic() - started,
               'stdout': {'path': stdout.name, **file_info(stdout)},
               'stderr': {'path': stderr.name, **file_info(stderr)}}
    write_json(directory / (name + '.json'), receipt)
    require(result.returncode == 0, 'Command failed; see ' + str(directory / (name + '.json')))
    return stdout.read_text(errors='replace').strip()


def executable(name):
    found = shutil.which(name)
    require(found is not None, 'Required executable is unavailable: ' + name)
    return Path(found).resolve()


def inputs(compiler, env, logs, phase):
    runtime = compiler.parent.parent / 'bend2'
    require(runtime.is_dir(), 'The selected Bend compiler needs its sibling bend2 library directory')
    tools = {}
    for name, requested in (('cc', env.get('CC', 'clang')), ('node', 'node'),
                            ('python', 'python3'), ('git', 'git'), ('sh', 'sh')):
        path = executable(requested)
        tools[name] = {'path': str(path), **file_info(path)}
        if name != 'sh':
            tools[name]['version'] = command([str(path), '--version'], ROOT, env, logs, phase + '-' + name)
    version = command([str(compiler), 'version'], ROOT, env, logs, phase + '-bend')
    require(version == 'bend 2.0.25', 'The artifact requires Bend 2.0.25')
    runtime_files = [{'path': path.relative_to(runtime).as_posix(), **file_info(path)}
                     for path in sorted(runtime.rglob('*')) if path.is_file()]
    selected_clang = Path(command(['xcrun', '--find', 'clang'], ROOT, env, logs, phase + '-selected-clang')).resolve()
    return {'compiler': {'path': str(compiler), 'version': version, **file_info(compiler)},
            'runtime': {'directory': str(runtime), 'files': runtime_files}, 'tools': tools,
            'xcode': {'directory': command(['xcode-select', '-p'], ROOT, env, logs, phase + '-xcode-directory'),
                      'selected_clang': {'path': str(selected_clang), **file_info(selected_clang)},
                      'sdk_directory': command(['xcrun', '--show-sdk-path'], ROOT, env, logs, phase + '-sdk-directory'),
                      'sdk_version': command(['xcrun', '--show-sdk-version'], ROOT, env, logs, phase + '-sdk-version')},
            'os': {'system': platform.system(), 'machine': platform.machine(),
                   'uname': list(platform.uname()),
                   'sw_vers': command(['sw_vers'], ROOT, env, logs, phase + '-sw-vers')},
            'runner': {name: os.environ[name] for name in
                       ('ImageOS', 'ImageVersion', 'RUNNER_OS', 'RUNNER_ARCH',
                        'GITHUB_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT') if name in os.environ}}


def archive_inputs(archive, compiler):
    require(sha256(archive) == COMPILER_ARCHIVE_SHA256, 'Compiler archive does not match the tracked Darwin arm64 pin')
    inventory, notices = [], []
    with tarfile.open(archive, 'r:gz') as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            require(not path.is_absolute() and '..' not in path.parts, 'Unsafe compiler archive member: ' + member.name)
            row = {'path': member.name, 'kind': member.type.decode('ascii'), 'bytes': member.size,
                   'link': member.linkname or None}
            if member.isfile():
                data = source.extractfile(member).read()
                row['sha256'] = hashlib.sha256(data).hexdigest()
                if member.name == 'bend/bin/bend':
                    require(row['sha256'] == sha256(compiler), 'Installed Bend executable differs from the pinned archive')
                elif member.name.startswith('bend/bend2/'):
                    installed = compiler.parent.parent / member.name.removeprefix('bend/')
                    require(installed.is_file() and sha256(installed) == row['sha256'],
                            'Installed Bend library differs from the pinned archive: ' + member.name)
                base = path.name.upper()
                if base in ('LICENSE', 'NOTICE', 'COPYING') or base.startswith(('LICENSE.', 'NOTICE.', 'COPYING.')):
                    notices.append((path, data))
            inventory.append(row)
    require(any(row['path'] == 'bend/bin/bend' and 'sha256' in row for row in inventory),
            'Compiler archive has no regular bend/bin/bend')
    installed = {path.relative_to(compiler.parent.parent).as_posix()
                 for path in (compiler.parent.parent / 'bend2').rglob('*') if path.is_file()}
    archived = {row['path'].removeprefix('bend/') for row in inventory
                if row['path'].startswith('bend/bend2/') and 'sha256' in row}
    require(installed == archived, 'Installed Bend library file set differs from the pinned archive')
    return {'url': COMPILER_ARCHIVE_URL, 'path': str(archive), **file_info(archive),
            'inventory': inventory}, notices


def validation(logs):
    law_text = (logs / 'laws-check.log').read_text(errors='replace')
    match = re.search(r'^laws-check: green - (\d+) laws, (\d+) mutations, (\d+) compiles, 0 failures$',
                      law_text, re.MULTILINE)
    require(match is not None, 'The complete laws-check success summary is missing')
    native_text = (logs / 'check-native.log').read_text(errors='replace')
    suites = re.findall(r'Ran (\d+) tests? in [^\n]+', native_text)
    return {'laws': dict(zip(('laws', 'mutations', 'compiles'), map(int, match.groups()))),
            'native': {'python_tests': sum(map(int, suites)), 'python_suites': len(suites)}}


def run_gates(compiler, env, logs, initial, before_inputs):
    summary = {'status': 'running', 'worktree': str(ROOT), 'output': str(logs),
               'before': initial, 'environment': {'BEND': str(compiler), 'BEND_NO_TELEMETRY': '1',
                                                'CC': env.get('CC', 'clang')},
               'compiler_sha256': sha256(compiler), 'runner_sha256': sha256(Path(__file__)),
               'inputs_before': before_inputs, 'stages': []}
    path = logs / 'summary.json'
    write_json(path, summary)
    try:
        for name, argv in GATES:
            stage = {'name': name, 'argv': argv, 'status': 'running',
                     'before': snapshot(), 'log': name + '.log'}
            same_source(stage['before'], initial)
            summary['stages'].append(stage)
            write_json(path, summary)
            print(json.dumps({'stage': name, 'status': 'running', 'log': str(logs / stage['log'])}), flush=True)
            started = time.monotonic()
            with (logs / stage['log']).open('wb') as log:
                result = subprocess.run(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                        stdout=log, stderr=subprocess.STDOUT)
            stage.update(exit_code=result.returncode, elapsed_seconds=time.monotonic() - started,
                         status='passed' if result.returncode == 0 else 'failed', after=snapshot())
            stage['log_sha256'] = sha256(logs / stage['log'])
            write_json(path, summary)
            require(result.returncode == 0, name + ' failed; full output is retained at ' + str(logs / stage['log']))
            same_source(stage['after'], initial)
        summary['validation'] = validation(logs)
        summary['after'] = snapshot()
        require(summary['after']['binary_sha256'] == summary['stages'][0]['after']['binary_sha256'],
                'The native binary changed between gate stages')
        summary['inputs_after'] = inputs(compiler, env, logs, 'after')
        require(summary['inputs_after'] == before_inputs, 'Toolchain or host inputs changed during the gates')
        summary['status'] = 'passed'
    except BaseException as error:
        summary.update(status='failed', error=repr(error), after=snapshot())
        write_json(path, summary)
        raise
    write_json(path, summary)
    return path, summary


def reuse_gates(path, expected_sha, compiler, logs, initial):
    require(sha256(path) == expected_sha, 'The supplied gate receipt does not match its requested SHA256')
    summary = json.loads(path.read_text())
    require(summary['status'] == 'passed' and Path(summary['worktree']).resolve() == ROOT,
            'The supplied gate receipt must pass on this exact build directory')
    same_source(summary['before'], initial)
    same_source(summary['after'], initial)
    require(summary['after']['binary_sha256'] == initial['binary_sha256'], 'The receipt binary differs from the current binary')
    require(summary['compiler_sha256'] == sha256(compiler), 'The receipt compiler differs from the selected compiler')
    require(summary['environment']['BEND'] == str(compiler) and summary['environment']['BEND_NO_TELEMETRY'] == '1',
            'The receipt must select this compiler with telemetry disabled')
    require([(stage['name'], stage['argv']) for stage in summary['stages']] == list(GATES),
            'The receipt must contain the complete three gate commands in order')
    for stage in summary['stages']:
        require(stage['status'] == 'passed' and stage['exit_code'] == 0, 'A supplied gate did not pass')
        same_source(stage['before'], initial)
        same_source(stage['after'], initial)
        require(stage['log'] == stage['name'] + '.log', 'Unexpected gate log path')
        source = path.parent / stage['log']
        require(sha256(source) == stage['log_sha256'], 'Supplied gate log bytes changed: ' + str(source))
        shutil.copyfile(source, logs / stage['log'])
    require(summary['stages'][0]['after']['binary_sha256'] == initial['binary_sha256'],
            'The original build-stage binary differs from the receipt binary')
    require(validation(logs) == summary['validation'], 'The supplied receipt validation disagrees with its full logs')
    destination = logs / 'summary.json'
    shutil.copyfile(path, destination)
    return destination, summary


def stage_adapters(payload):
    directory = payload / 'libexec/baton2'
    directory.mkdir(parents=True)
    for harness in ('codex', 'omp', 'mcp'):
        for suffix in ('conductor', 'root'):
            name = harness + '-' + suffix + '.mjs'
            shutil.copyfile(ROOT / 'bend2/scripts' / name, directory / name)
    shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', directory / 'git-series.mjs')


def context_package_manifest(directory=None):
    source = (directory or CONTEXT_PACKAGE_DIR) / 'package.json'
    require(source.is_file(), 'The context package manifest is missing: ' + str(source))
    manifest = json.loads(source.read_text())
    require(manifest.get('name') == CONTEXT_PACKAGE_NAME,
            'The context package name is fixed: ' + CONTEXT_PACKAGE_NAME)
    require(manifest.get('private') is True, 'The context package must be private')
    require(manifest.get('type') == 'module', 'The context package must be an ECMAScript module package')
    require(manifest.get('engines') == {'node': CONTEXT_NODE_FLOOR},
            'The context package must pin the Node floor ' + CONTEXT_NODE_FLOOR)
    require(manifest.get('dependencies') == CONTEXT_DEPENDENCY_PINS,
            'Context dependencies must equal the approved exact pins '
            + repr(dict(sorted(CONTEXT_DEPENDENCY_PINS.items()))))
    return manifest


def context_lockfile(directory=None):
    source = (directory or CONTEXT_PACKAGE_DIR) / 'package-lock.json'
    require(source.is_file(), 'The context lockfile is missing: ' + str(source))
    lock = json.loads(source.read_text())
    require(lock.get('name') == CONTEXT_PACKAGE_NAME and lock.get('version') == '0.0.0',
            'The context lockfile must name ' + CONTEXT_PACKAGE_NAME + ' 0.0.0')
    require(lock.get('lockfileVersion') == 3, 'The context lockfile must use lockfileVersion 3')
    packages = lock.get('packages')
    require(isinstance(packages, dict), 'The context lockfile has no packages map')
    root = packages.get('')
    require(isinstance(root, dict), 'The context lockfile has no root entry')
    require(root.get('dependencies') == CONTEXT_DEPENDENCY_PINS,
            'Lock root dependencies must equal the approved exact pins')
    require(root.get('engines') == {'node': CONTEXT_NODE_FLOOR},
            'Lock root engines must pin the Node floor ' + CONTEXT_NODE_FLOOR)
    entries = {}
    for key, row in packages.items():
        if key == '':
            continue
        name = key.removeprefix('node_modules/')
        # Conflicting nested transitive versions would stage an ambiguous tree;
        # the approved closure resolves to one version per package.
        require(key == 'node_modules/' + name and '/' not in name,
                'Unexpected nested lock entry: ' + key)
        resolved = row.get('resolved')
        require(isinstance(resolved, str) and resolved.startswith('https://registry.npmjs.org/'),
                'Lock entry must resolve from the npm registry: ' + name)
        integrity = row.get('integrity')
        require(isinstance(integrity, str) and integrity.startswith('sha512-'),
                'Lock entry must carry a sha512 integrity: ' + name)
        digest = base64.b64decode(integrity[len('sha512-'):], validate=True)
        require(len(digest) == 64, 'Lock integrity must decode to a sha512 digest: ' + name)
        require(isinstance(row.get('version'), str), 'Lock entry has no version: ' + name)
        entries[name] = row
    for name, version in CONTEXT_DEPENDENCY_PINS.items():
        require(entries.get(name, {}).get('version') == version,
                'Lock must pin ' + name + ' at exactly ' + version)
    for name, row in entries.items():
        for dependency in row.get('dependencies', {}):
            require(dependency in entries,
                    'Lock closure is missing ' + dependency + ' required by ' + name)
    return entries


def fetch_context_dependencies(entries, logs):
    destination = logs / 'context-dependencies'
    destination.mkdir(parents=True, exist_ok=True)
    fetched = []
    for name, row in sorted(entries.items()):
        with urllib.request.urlopen(row['resolved'], timeout=300) as response:
            data = response.read()
        require(base64.b64encode(hashlib.sha512(data).digest()).decode('ascii')
                == row['integrity'][len('sha512-'):],
                'Dependency bytes do not match the lockfile integrity: ' + name)
        path = destination / (name + '.tgz')
        path.write_bytes(data)
        fetched.append({'name': name, 'version': row['version'], 'resolved': row['resolved'],
                        'integrity': row['integrity'],
                        'tarball': {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}})
    return fetched


def extract_context_dependency(payload, name, tarball_path):
    module = payload / CONTEXT_STAGE_ROOT / 'node_modules' / name
    module.mkdir(parents=True)
    extracted = 0
    with tarfile.open(tarball_path, 'r:gz') as archive:
        for member in archive.getmembers():
            member_path = PurePosixPath(member.name)
            require(not member_path.is_absolute() and '..' not in member_path.parts,
                    'Unsafe dependency archive member: ' + member.name)
            if not member.isfile():
                require(member.isdir() and member.name == 'package',
                        'Unsafe dependency archive member: ' + member.name)
                continue
            relative = member_path.relative_to('package')
            destination = module.joinpath(*relative.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.extractfile(member).read())
            destination.chmod(0o644)
            extracted += 1
    require(extracted > 0, 'Dependency archive staged no files: ' + name)
    return module


def context_tree_digest(directory):
    digest = hashlib.sha256()
    for relative, path in sorted((path.relative_to(directory).as_posix(), path)
                                 for path in directory.rglob('*') if path.is_file()):
        digest.update(relative.encode('utf-8'))
        digest.update(b'\0')
        digest.update(sha256(path).encode('ascii'))
        digest.update(b'\n')
    return digest.hexdigest()


def context_closure_manifest(entries, digests):
    packages = {name: {'version': row['version'], 'integrity': row['integrity'],
                       'treeSha256': digests[name]}
                for name, row in sorted(entries.items())}
    return {'schema': 'baton2-context-dependency-closure-v1', 'packages': packages}


def stage_context_sources(payload):
    directory = payload / CONTEXT_STAGE_ROOT
    directory.mkdir(parents=True)
    staged = []
    for source in sorted(CONTEXT_PACKAGE_DIR.rglob('*')):
        if not source.is_file():
            continue
        relative = source.relative_to(CONTEXT_PACKAGE_DIR)
        if relative.parts[0] == 'node_modules' or relative.as_posix() in ('package.json', 'package-lock.json'):
            continue
        destination = directory / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        destination.chmod(0o644)
        staged.append(relative.as_posix())
    return staged


def stage_context_notices(payload, entries):
    directory = payload / 'notices/context'
    directory.mkdir(parents=True, exist_ok=True)
    terms = {}
    for name, row in sorted(entries.items()):
        module = payload / CONTEXT_STAGE_ROOT / 'node_modules' / name
        files = []
        for candidate in sorted(module.rglob('*')):
            if not candidate.is_file():
                continue
            base = candidate.name.upper()
            if (base in ('LICENSE', 'NOTICE', 'COPYING')
                    or base.startswith(('LICENSE.', 'NOTICE.', 'COPYING.'))
                    or candidate.name in CONTEXT_EXTRA_NOTICES.get(name, ())):
                destination = directory / name / candidate.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(candidate, destination)
                files.append({'path': destination.relative_to(payload).as_posix(),
                              'source': CONTEXT_STAGE_ROOT + '/node_modules/' + name + '/'
                                        + candidate.relative_to(module).as_posix(),
                              **file_info(destination)})
        require(files, 'Staged dependency has no staged license or notice file: ' + name)
        terms[name] = {'version': row['version'], 'license': row.get('license'), 'files': files}
    lines = ['Context dependency terms staged from lockfile-resolved npm bytes verified',
             'against the lockfile integrity hashes.', '']
    for name, row in terms.items():
        lines.append(name + '@' + row['version'] + ' - ' + str(row['license'])
                     + ' - ' + ', '.join(item['path'] for item in row['files']))
    (directory / 'context-packages.md').write_text('\n'.join(lines) + '\n')
    return terms


def context_gate_environment(node, logs, name):
    home = logs / ('context-gate-home-' + name)
    scratch = logs / ('context-gate-tmp-' + name)
    home.mkdir(parents=True, exist_ok=True)
    scratch.mkdir(parents=True, exist_ok=True)
    return {'PATH': str(node.parent) + ':/usr/bin:/bin', 'HOME': str(home),
            'TMPDIR': str(scratch), 'LC_ALL': 'C'}


def context_node_identity(node, payload, logs, name, suffix=''):
    version = command([str(node), '--version'], payload,
                      context_gate_environment(node, logs, name), logs,
                      'context-node-version-' + name + suffix)
    return {'path': str(node.resolve()), 'bytes': node.stat().st_size,
            'sha256': sha256(node), 'version': version}


def child_signal(returncode):
    if returncode is not None and returncode < 0:
        try:
            return signal.Signals(-returncode).name
        except ValueError:
            return 'signal-' + str(-returncode)
    return None


def retained_stream(record, error):
    if error is not None:
        return {'path': record.name, 'available': False, 'error': error}
    if not record.is_file():
        return {'path': record.name, 'available': False, 'error': 'stream file is absent'}
    return {'path': record.name, 'available': True, **file_info(record)}


def snapshot_evidence(path, state, evidence_errors, label):
    try:
        write_json(path, state)
    except BaseException as error:
        evidence_errors.append(label + ' snapshot write failed: ' + repr(error))
        return {'path': path.name, 'available': False, 'error': repr(error)}
    return {'path': path.name, 'available': True, **file_info(path)}


def context_receipt_logs(logs):
    return sorted(path for pattern in ('context-gate-*', 'context-node-version-*')
                  for path in logs.glob(pattern) if path.is_file())


def context_tree_state(payload):
    directory = payload / CONTEXT_STAGE_ROOT
    return {path.relative_to(payload).as_posix(): file_info(path)
            for path in sorted(directory.rglob('*')) if path.is_file()}


def run_context_gate(payload, logs, node, name, extra_env=None):
    env = context_gate_environment(node, logs, name)
    if extra_env:
        env.update(extra_env)
    cwd = payload / CONTEXT_STAGE_ROOT
    node_identity = context_node_identity(node, payload, logs, name)
    stdout = logs / ('context-gate-' + name + '.stdout')
    stderr = logs / ('context-gate-' + name + '.stderr')
    before_path = logs / ('context-gate-' + name + '.payload-before.json')
    after_path = logs / ('context-gate-' + name + '.payload-after.json')
    evidence_errors = []
    before = context_tree_state(payload)
    before_ref = snapshot_evidence(before_path, before, evidence_errors, 'before-payload')
    started = time.monotonic()
    stream_errors = {}
    out_handle = None
    err_handle = None
    try:
        out_handle = stdout.open('wb')
    except OSError as error:
        stream_errors['stdout'] = repr(error)
    try:
        err_handle = stderr.open('wb')
    except OSError as error:
        stream_errors['stderr'] = repr(error)
    spawn_stage = 'completed'
    spawn_error = None
    interrupted = None
    outcome = None
    if stream_errors:
        spawn_stage = 'streams-unavailable'
        spawn_error = '; '.join(name + ': ' + value
                                for name, value in sorted(stream_errors.items()))
    else:
        process = None
        try:
            # Only a Popen construction failure proves non-creation.
            process = subprocess.Popen([str(node), 'context-package-gate.mjs'], cwd=cwd, env=env,
                                       stdin=subprocess.DEVNULL, stdout=out_handle,
                                       stderr=err_handle)
        except (OSError, ValueError) as error:
            spawn_stage = 'unspawned'
            spawn_error = repr(error)
        except BaseException as error:
            spawn_stage = 'interrupted'
            spawn_error = repr(error)
            interrupted = error
        if process is not None:
            try:
                outcome = subprocess.CompletedProcess(process.args, process.wait())
                spawn_stage = 'completed'
            except BaseException as error:
                # Preserve subprocess.run owned-child cleanup: terminate and
                # reap before re-raising, never leaking a running child and
                # never claiming a settled outcome.
                process.kill()
                try:
                    process.wait()
                except BaseException:
                    pass
                spawn_stage = 'started-outcome-unknown'
                spawn_error = repr(error)
                interrupted = error
    for handle in (out_handle, err_handle):
        if handle is not None:
            try:
                handle.close()
            except OSError as error:
                evidence_errors.append('stream close failed: ' + repr(error))
    secondary_error = None
    if interrupted is None:
        after = context_tree_state(payload)
        after_ref = snapshot_evidence(after_path, after, evidence_errors, 'after-payload')
        post_identity = None
        post_error = None
        try:
            post_identity = context_node_identity(node, payload, logs, name, '-after')
        except BaseException as error:
            post_error = repr(error)
    else:
        post_identity = None
        post_error = 'not attempted: the gate child raised an interruption'
        try:
            after = context_tree_state(payload)
            after_ref = snapshot_evidence(after_path, after, evidence_errors, 'after-payload')
        except BaseException as error:
            secondary_error = error
            after_ref = {'path': after_path.name, 'available': False, 'error': repr(error)}
    if post_identity is None:
        node_identity['postIdentity'] = {'available': False, 'error': post_error}
        node_identity['versionAfter'] = None
        node_identity['sha256After'] = None
        node_identity['bytesAfter'] = None
    else:
        node_identity['postIdentity'] = {'available': True, 'version': post_identity['version'],
                                         'sha256': post_identity['sha256'],
                                         'bytes': post_identity['bytes']}
        node_identity['versionAfter'] = post_identity['version']
        node_identity['sha256After'] = post_identity['sha256']
        node_identity['bytesAfter'] = post_identity['bytes']
    if outcome is not None:
        child = {'spawned': True, 'stage': spawn_stage}
    elif spawn_stage == 'started-outcome-unknown':
        child = {'spawned': True, 'stage': spawn_stage, 'error': spawn_error}
    else:
        child = {'spawned': None if interrupted is not None else False,
                 'stage': spawn_stage}
        if spawn_error is not None:
            child['error'] = spawn_error
    receipt = {'runtime': name, 'node': node_identity,
               'argv': [str(node), 'context-package-gate.mjs'], 'cwd': str(cwd),
               'environmentKeys': sorted(env),
               'child': child,
               'exit_code': None if outcome is None else outcome.returncode,
               'signal': child_signal(None if outcome is None else outcome.returncode),
               'elapsed_seconds': time.monotonic() - started,
               'stdout': retained_stream(stdout, stream_errors.get('stdout')),
               'stderr': retained_stream(stderr, stream_errors.get('stderr')),
               'payloadSnapshot': {'before': before_ref, 'after': after_ref,
                                   'equal': None if not after_ref.get('available')
                                            else before == after},
               'evidenceErrors': evidence_errors,
               'nodeVersionChanged': None if post_identity is None
                                     else post_identity['version'] != node_identity['version'],
               'nodeIdentityChanged': None if post_identity is None
                                      else (post_identity['sha256'] != node_identity['sha256']
                                            or post_identity['bytes'] != node_identity['bytes'])}
    receipt_path = logs / ('context-gate-' + name + '.json')
    try:
        write_json(receipt_path, receipt)
    except BaseException as error:
        if interrupted is not None or secondary_error is not None:
            original = interrupted if interrupted is not None else secondary_error
            # The original interruption stays the raised exception; the
            # receipt-write failure is retained as its chained cause.
            raise original from error
        raise
    if interrupted is not None:
        # The completed receipt retains the evidence; interruption semantics
        # are preserved instead of converting the interrupt into a refusal.
        raise interrupted
    require(spawn_stage == 'completed',
            'The context gate child did not complete (stage ' + spawn_stage + '): '
            + str(receipt_path))
    require(post_identity is not None,
            'The context gate node identity is unavailable after the package gate: '
            + str(receipt_path))
    require(not receipt['nodeVersionChanged'],
            'The context gate node reported a different version after the package gate: '
            + str(receipt_path))
    require(not receipt['nodeIdentityChanged'],
            'The context gate node executable bytes changed during the package gate: '
            + str(receipt_path))
    require(receipt['payloadSnapshot']['equal'],
            'The context payload changed during the package gate: ' + str(receipt_path))
    return receipt, stdout.read_text(errors='replace')


def require_gate_report(text, expected_packages):
    require(text.strip(), 'The context package gate printed no report')
    report = json.loads(text)
    require(report.get('gate') == 'baton2-context-package-gate',
            'Unexpected context gate report identity')
    closure = report.get('closure')
    require(isinstance(closure, dict) and closure.get('digestsVerified') is True
            and closure.get('packages') == expected_packages,
            'The context gate closure verification is missing or incomplete')
    stages = report.get('stages')
    require(isinstance(stages, list) and len(stages) == 3,
            'The context gate report is missing probes')
    ajv, zod_probe, typescript = stages
    require(ajv.get('version') == '8.17.1' and len(ajv.get('invalidErrors', [])) >= 2,
            'The Ajv gate probe is not useful')
    require(zod_probe.get('version') == '4.3.6'
            and zod_probe.get('validValue') == {'id': 7, 'name': 'report'}
            and len(zod_probe.get('invalidIssues', [])) >= 2,
            'The Zod gate probe is not useful')
    require(typescript.get('version') == '5.9.3'
            and typescript.get('resolvedDeclarationType') == '(name: string) => string'
            and typescript.get('messageType') == 'string',
            'The TypeScript gate probe is not useful')
    return report


def run_context_gates(payload, logs, args, entries):
    runs = []
    floor = {'requested': '22.15.0'}
    if args.context_node22 is not None:
        node22 = args.context_node22.resolve()
        identity = context_node_identity(node22, payload, logs, 'floor')
        require(identity['version'] == 'v22.15.0',
                'The supplied context floor node is not v22.15.0: ' + identity['version'])
        floor['available'] = True
        floor['node'] = identity
        receipt, text = run_context_gate(payload, logs, node22, 'node22.15.0')
        require(receipt['exit_code'] == 0,
                'The context package gate failed on the Node 22.15.0 floor; see '
                + str(logs / 'context-gate-node22.15.0.json'))
        require_gate_report(text, len(entries))
        runs.append(receipt)
    else:
        floor['available'] = False
        floor['reason'] = ('No --context-node22 executable was supplied; '
                           'floor gate evidence is pending provision.')
    host_node = executable('node')
    receipt, text = run_context_gate(payload, logs, host_node, 'host')
    require(receipt['exit_code'] == 0,
            'The context package gate failed on the host Node; see '
            + str(logs / 'context-gate-host.json'))
    require_gate_report(text, len(entries))
    runs.append(receipt)
    return {'floor': floor, 'runs': runs}


def compose_context(payload, logs, args):
    entries = context_lockfile()
    context_package_manifest()
    fetched = fetch_context_dependencies(entries, logs)
    staged_first_party = stage_context_sources(payload)
    for row in fetched:
        extract_context_dependency(payload, row['name'],
                                   logs / 'context-dependencies' / (row['name'] + '.tgz'))
    digests = {name: context_tree_digest(payload / CONTEXT_STAGE_ROOT / 'node_modules' / name)
               for name in entries}
    closure = context_closure_manifest(entries, digests)
    (payload / CONTEXT_STAGE_ROOT / 'dependency-closure.json').write_text(
        json.dumps(closure, indent=2, sort_keys=True) + '\n')
    terms = stage_context_notices(payload, entries)
    gate = run_context_gates(payload, logs, args, entries)
    return {'pins': dict(sorted(CONTEXT_DEPENDENCY_PINS.items())),
            'manifest': {'path': 'bend2/context/package.json',
                         **file_info(CONTEXT_PACKAGE_DIR / 'package.json')},
            'lockfile': {'path': 'bend2/context/package-lock.json',
                         **file_info(CONTEXT_PACKAGE_DIR / 'package-lock.json')},
            'dependencies': fetched,
            'stagedFirstParty': staged_first_party,
            'dependencyClosure': closure,
            'gate': gate,
            'terms': terms}


def append_context_distribution(payload, terms):
    lines = ['',
             'Context dependencies are staged from lockfile-resolved npm tarballs verified',
             'against the lockfile integrity hashes before staging.']
    for name, row in terms.items():
        lines.append(name + '@' + row['version'] + ' is distributed under ' + str(row['license'])
                     + '; staged terms: ' + ', '.join(item['path'] for item in row['files']) + '.')
    with (payload / 'notices/distribution.md').open('a') as distribution:
        distribution.write('\n'.join(lines) + '\n')


def stage_notices(payload, archive_notices, kind='development'):
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
                            'path': destination.relative_to(payload).as_posix(),
                            **file_info(destination)}
            distribution.append('baton2-' + name + ' contains the Baton2 project '
                                + name.lower() + ' copied from root ' + name + '.')
    if terms['baton_root_license'] is None:
        distribution.extend(['This source snapshot has no root LICENSE.',
                             'The maintainer must resolve Baton2 distribution terms before a public release.'])
    reference = ROOT / 'docs/bend2/reference/upstream/LICENSE'
    require(sha256(reference) == COMPILER_LICENSE_SHA256, 'The upstream Bend license differs from its versioned pin')
    shutil.copyfile(reference, directory / 'bend-reference-LICENSE')
    shutil.copyfile(reference, directory / 'bend-2.0.25-LICENSE')
    for path, data in archive_notices:
        destination = directory / 'compiler-archive' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    distribution.extend([
        'bend-2.0.25-LICENSE is the pinned upstream compiler/runtime license at ' + COMPILER_LICENSE_URL + '.',
        'bend-reference-LICENSE applies to the separately pinned Bend reference.',
        'compiler-archive/ retains any license and notice files found in the verified Bend archive.'])
    (directory / 'distribution.md').write_text('\n'.join(distribution) + '\n')
    return terms


def check_project_terms(terms, source_files, files):
    sources = {entry['path']: entry for entry in source_files}
    staged = {entry['path']: entry for entry in files}
    for name, field in (('LICENSE', 'baton_root_license'), ('NOTICE', 'baton_root_notice')):
        source = sources.get(name)
        path = 'notices/baton2-' + name
        expected = None if source is None else {
            'source_path': name, 'path': path, 'bytes': source['bytes'], 'sha256': source['sha256']}
        require(terms[field] == expected, 'Baton2 ' + name + ' terms differ from the source inventory')
        file_expected = None if expected is None else {
            key: expected[key] for key in ('path', 'bytes', 'sha256')}
        require(staged.get(path) == file_expected, 'Baton2 ' + name + ' file differs from its terms')


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
    logs = output / 'gates'
    logs.mkdir()
    result = {'status': 'running', 'source_directory': str(ROOT), 'output': str(output)}
    write_json(output / 'result.json', result)
    try:
        require(platform.system() == 'Darwin' and platform.machine() == 'arm64', 'This native artifact requires a Darwin arm64 build host')
        initial = snapshot()
        same_source(initial, initial)
        context_package_manifest()
        context_entries = context_lockfile()
        identity = artifact_identity(args.release_version)
        compiler = args.bend.resolve()
        env = dict(os.environ, BEND=str(compiler), BEND_NO_TELEMETRY='1')
        if args.gate_receipt:
            receipt, summary = reuse_gates(args.gate_receipt.resolve(), args.gate_receipt_sha256, compiler, logs, initial)
        before_inputs = inputs(compiler, env, logs, 'before')
        archive, notices = archive_inputs(args.compiler_archive.resolve(), compiler)
        write_json(output / 'compiler-archive.json', archive)
        if args.gate_receipt:
            if 'inputs_after' in summary:
                require(summary['inputs_after'] == before_inputs, 'The receipt toolchain or host inputs differ from current inputs')
            input_boundary = 'Compiler libraries, CC and host captured after the supplied gates and checked again during packaging.'
        else:
            receipt, summary = run_gates(compiler, env, logs, initial, before_inputs)
            input_boundary = 'Compiler libraries, CC and host captured before and after the three gates.'
        binary = ROOT / '.scratch/bend2/baton2'
        generated = ROOT / '.scratch/bend2/baton2.c'
        require(binary.is_file() and generated.is_file(), 'The gated executable and generated C are required')
        require(command(['lipo', '-archs', str(binary)], ROOT, env, logs, 'binary-architectures') == 'arm64',
                'The gated executable must contain the arm64 architecture')
        linked = command(['otool', '-L', str(binary)], ROOT, env, logs, 'linked-libraries')
        command(['otool', '-l', str(binary)], ROOT, env, logs, 'mach-o-load-commands')
        libraries = []
        for line in linked.splitlines()[1:]:
            name = line.strip().split(' (', 1)[0]
            path = Path(name)
            libraries.append({'path': name, 'file': file_info(path) if path.is_file() else None,
                              'capture': 'regular file' if path.is_file() else 'load-command reference; file bytes unavailable'})
        after_inputs = inputs(compiler, env, logs, 'package-end')
        require(after_inputs == before_inputs, 'Toolchain or host inputs changed during packaging')
        final = snapshot()
        same_source(final, initial)
        require(final['binary_sha256'] == summary['after']['binary_sha256'], 'The gated native executable changed before packaging')
        payload = output / identity['archive_root']
        (payload / 'bin').mkdir(parents=True)
        shutil.copyfile(binary, payload / 'bin/baton2')
        (payload / 'bin/baton2').chmod(0o755)
        stage_adapters(payload)
        shutil.copytree(logs, payload / 'logs')
        terms = stage_notices(payload, notices, identity['kind'])
        context = compose_context(payload, logs, args)
        context['dependencyClosureEntries'] = len(context_entries)
        terms['context_packages'] = context.pop('terms')
        append_context_distribution(payload, terms['context_packages'])
        receipt_logs = context_receipt_logs(logs)
        for receipt_log in receipt_logs:
            shutil.copyfile(receipt_log, payload / 'logs' / receipt_log.name)
        generated_dir = output / 'generated'
        generated_dir.mkdir()
        shutil.copyfile(generated, generated_dir / 'baton2.c')
        files = [{'path': path.relative_to(payload).as_posix(), **file_info(path)}
                 for path in sorted(payload.rglob('*')) if path.is_file()]
        source_files = [{'path': name, **file_info(ROOT / name)}
                        for name in git('ls-files', 'bend2', 'docs/bend2/reference', '.github/workflows/bend2-native.yml',
                                        'LICENSE', 'NOTICE').splitlines()
                        if (ROOT / name).is_file()]
        check_project_terms(terms, source_files, files)
        manifest = {
            'schema': 'baton2-native-artifact-v1', **identity,
            'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'platform': 'darwin-arm64',
            'source': {'commit': final['head'], 'tree': final['tree'], 'bend2_tree': final['bend2_tree'],
                       'directory': str(ROOT), 'status': final['status'], 'files': source_files},
            'binary': {'path': 'bin/baton2', **file_info(binary)}, 'files': files,
            'build': {'inputs_before': before_inputs, 'inputs_after': after_inputs,
                      'input_capture_boundary': input_boundary, 'compiler_archive': archive,
                      'generated_c': {'path': str(generated), **file_info(generated)},
                      'linked_libraries': libraries,
                      'context': context},
            'gates': {'receipt': 'logs/summary.json', **file_info(receipt),
                      'validation': summary['validation'], 'reused': bool(args.gate_receipt)},
            'terms': terms,
        }
        write_json(payload / 'manifest.json', manifest)
        shutil.copyfile(payload / 'manifest.json', output / 'manifest.json')
        destination = output / (identity['archive_root'] + '-' + final['head'] + '.tar.gz')
        with tarfile.open(destination, 'x:gz') as artifact:
            artifact.add(payload, arcname=identity['archive_root'])
        require(sha256(payload / 'bin/baton2') == final['binary_sha256'], 'The staged executable changed')
        same_source(snapshot(), final)
        archive_sha = sha256(destination)
        (output / 'SHA256SUMS').write_text(archive_sha + '  ' + destination.name + '\n')
        result.update(status='packaged', archive={'path': destination.name, **file_info(destination)},
                      manifest={'path': 'manifest.json', **file_info(output / 'manifest.json')},
                      gate_summary=str(receipt), gate_summary_sha256=sha256(receipt), source=final)
        write_json(output / 'result.json', result)
        print(json.dumps(result), flush=True)
    except BaseException as error:
        result.update(status='failed', error=repr(error))
        write_json(output / 'result.json', result)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path, help='new owned output directory, retained on failure')
    parser.add_argument('--bend', required=True, type=Path)
    parser.add_argument('--compiler-archive', required=True, type=Path, help='preserved official Darwin arm64 Bend 2.0.25 archive')
    parser.add_argument('--release-version', help='version identifier for a release archive; requires the project root LICENSE')
    parser.add_argument('--gate-receipt', type=Path, help='reuse a completed exact-source three-gate summary')
    parser.add_argument('--gate-receipt-sha256', help='required SHA256 pin when reusing a gate receipt')
    parser.add_argument('--context-node22', type=Path,
                        help='exact Node v22.15.0 executable for the context package floor gate')
    args = parser.parse_args()
    require(bool(args.gate_receipt) == bool(args.gate_receipt_sha256), 'Gate receipt and SHA256 must be supplied together')
    package(args)


if __name__ == '__main__':
    main()
