#!/usr/bin/env python3
"""Build a Darwin arm64 native artifact with exact-source gate evidence."""
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
GATES = (
    ('build-native', ['sh', 'bend2/scripts/build-native.sh']),
    ('laws-check', ['node', 'bend2/scripts/laws-check.mjs']),
    ('check-native', ['sh', 'bend2/scripts/check-native.sh']),
)
# The parallel gate set is derived from GATES: one isolated job per gate, then
# assembly binds the complete set. No separate count, list, or ceiling is kept.
GATE_NAMES = tuple(name for name, _ in GATES)


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


def producer_identity():
    return {'workflow': os.environ.get('GITHUB_WORKFLOW') or None,
            'run_id': os.environ.get('GITHUB_RUN_ID') or None,
            'run_attempt': os.environ.get('GITHUB_RUN_ATTEMPT') or None,
            'job': os.environ.get('GITHUB_JOB') or None,
            'sha': os.environ.get('GITHUB_SHA') or None,
            'runner': os.environ.get('RUNNER_NAME') or None}


def producer_run_binding(producer):
    producer = producer or {}
    return {key: producer.get(key) for key in ('workflow', 'run_id', 'run_attempt', 'sha')}


def bend_version(compiler):
    return subprocess.check_output([str(compiler), 'version'], cwd=ROOT,
                                   stdin=subprocess.DEVNULL, text=True).strip()


def check_compiler_version(compiler):
    require(bend_version(compiler) == 'bend 2.0.25', 'The artifact requires Bend 2.0.25')


def cc_version(cc):
    return subprocess.check_output([cc, '--version'], cwd=ROOT,
                                   stdin=subprocess.DEVNULL, text=True).strip()


def run_one_gate(gate_name, compiler, env, output, initial):
    """Run a single gate exactly as run_gates runs it and record a receipt.

    The workflow runs one isolated job per gate, each calling this entry point
    with the same exact source and pinned compiler. The receipt binds the gate
    command, the exact-source snapshots, the compiler bytes, the runner source
    bytes, the producer run identity, and the complete log bytes.
    """
    names = dict(GATES)
    require(gate_name in names, 'Unknown gate: ' + gate_name)
    argv = names[gate_name]
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    check_compiler_version(compiler)
    # Stable request identity for the gate producer, shared with the receipt
    # below. A parallel scheduler inside the gate adopts BATON2_GATE_REQUEST as
    # its request directory and BATON2_GATE_JOB as its producer directory
    # instead of minting its own identity.
    producer = producer_identity()
    request = 'local'
    if producer.get('run_id') is not None:
        request = '/'.join((producer.get('workflow') or 'workflow', producer['run_id'],
                            producer.get('run_attempt') or '1', producer.get('sha') or 'sha'))
    env = dict(env, BATON2_GATE_REQUEST=request,
               BATON2_GATE_JOB=producer.get('job') or gate_name)
    generated = ROOT / '.scratch/bend2/baton2.c'
    cc = env.get('CC', 'clang')
    receipt = {'gate': gate_name, 'status': 'running', 'worktree': str(ROOT),
               'output': str(output), 'log': gate_name + '.log',
               'before': snapshot(),
               'environment': {'BEND': str(compiler), 'BEND_NO_TELEMETRY': '1', 'CC': cc},
               'compiler_sha256': sha256(compiler),
               'compiler_version': bend_version(compiler),
               'compiler_arch': platform.machine(),
               'cc_version': cc_version(cc),
               'runner_sha256': sha256(Path(__file__)),
               'producer': producer}
    same_source(receipt['before'], initial)
    stage = {'name': gate_name, 'argv': argv, 'status': 'running',
             'before': receipt['before'], 'log': receipt['log']}
    write_json(output / 'summary.json', receipt)
    print(json.dumps({'gate': gate_name, 'status': 'running',
                      'log': str(output / receipt['log'])}), flush=True)
    started = time.monotonic()
    with (output / receipt['log']).open('wb') as log:
        result = subprocess.run(argv, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT)
    stage.update(exit_code=result.returncode, elapsed_seconds=time.monotonic() - started,
                 status='passed' if result.returncode == 0 else 'failed', after=snapshot())
    stage['log_sha256'] = sha256(output / stage['log'])
    receipt['stage'] = stage
    binary = ROOT / '.scratch/bend2/baton2'
    receipt['binary_sha256'] = sha256(binary) if binary.is_file() else None
    receipt['generated_sha256'] = sha256(generated) if generated.is_file() else None
    write_json(output / 'summary.json', receipt)
    require(result.returncode == 0, gate_name + ' failed; full output is retained at ' +
            str(output / stage['log']))
    same_source(stage['after'], initial)
    digest = sha256(output / 'summary.json')
    print(json.dumps({'gate': gate_name, 'status': 'passed',
                      'receipt': str(output / 'summary.json'), 'sha256': digest}), flush=True)
    return output / 'summary.json', receipt


def gate_evidence(gate_name, log_text):
    """Recompute a gate's success evidence from its complete log bytes.

    Omitted, duplicated, altered, or unfinished producer work cannot pass: the
    laws gate must carry its complete green summary line, the native gate must
    show executed suites, and the build gate must have produced its binary.
    """
    if gate_name == 'laws-check':
        match = re.search(r'^laws-check: green - (\d+) laws, (\d+) mutations, (\d+) compiles, 0 failures$',
                          log_text, re.MULTILINE)
        require(match is not None, 'The complete laws-check success summary is missing')
        return {'laws': dict(zip(('laws', 'mutations', 'compiles'), map(int, match.groups())))}
    if gate_name == 'check-native':
        suites = re.findall(r'Ran (\d+) tests? in [^\n]+', log_text)
        require(suites, 'The check-native log shows no executed test suites')
        return {'native': {'python_tests': sum(map(int, suites)), 'python_suites': len(suites)}}
    require(gate_name == 'build-native', 'Unknown gate: ' + gate_name)
    return {'build': True}


def verify_gate_receipt(directory, initial, compiler):
    """Verify one parallel gate receipt against exact source and toolchain.

    A matching source hash alone does not establish producer authenticity: the
    receipt must also bind the runner source bytes, the complete log bytes with
    recomputed success evidence, and the exact gate identity. The compiler is
    bound by its actual bytes, version, architecture, and selected C toolchain,
    never by its absolute install path, which differs across isolated runners.
    """
    summary_path = directory / 'summary.json'
    require(summary_path.is_file(), 'Missing gate receipt: ' + str(summary_path))
    summary = json.loads(summary_path.read_text())
    require(summary.get('gate') == directory.name,
            'Gate receipt misfiled: ' + str(summary_path))
    require(summary.get('gate') in dict(GATES),
            'Gate receipt names an unknown gate: ' + str(summary.get('gate')))
    require(summary.get('runner_sha256') == sha256(Path(__file__)),
            'Gate receipt runner source differs from this runner source')
    require(summary.get('compiler_sha256') == sha256(compiler),
            'Gate receipt compiler differs from the selected compiler')
    require(summary.get('compiler_version') == bend_version(compiler),
            'Gate receipt compiler version differs from the selected compiler')
    require(summary.get('compiler_arch') == platform.machine(),
            'Gate receipt compiler architecture differs from this host')
    cc = summary.get('environment', {}).get('CC', 'clang')
    require(summary.get('cc_version') == cc_version(cc),
            'Gate receipt C toolchain differs from the selected toolchain')
    require(summary.get('environment', {}).get('BEND_NO_TELEMETRY') == '1',
            'Gate receipt must disable compiler telemetry')
    stage = summary.get('stage', {})
    require([(stage.get('name'), stage.get('argv'))] ==
            [(summary['gate'], dict(GATES)[summary['gate']])],
            'Gate receipt must contain its exact gate command')
    require(stage.get('status') == 'passed' and stage.get('exit_code') == 0,
            'A supplied gate did not pass')
    same_source(stage.get('before', {}), initial)
    same_source(stage.get('after', {}), initial)
    require(stage.get('log') == summary['gate'] + '.log', 'Unexpected gate log path')
    log_path = directory / stage['log']
    require(sha256(log_path) == stage.get('log_sha256'), 'Supplied gate log bytes changed')
    log_text = log_path.read_text(errors='replace')
    evidence = gate_evidence(summary['gate'], log_text)
    if summary['gate'] == 'build-native':
        require(summary.get('binary_sha256') is not None, 'The build gate produced no binary')
    return summary, evidence


def assemble_gate_receipts(receipts_dir, build_outputs, compiler, env, logs, initial, before_inputs):
    """Assemble the complete parallel gate set into one gate summary.

    The receipts directory must contain exactly one subdirectory per gate in
    GATES, named for its gate. Each receipt ran on its own isolated runner, so
    build directories legitimately differ; authenticity comes from the shared
    producer run identity plus exact source, toolchain, runner source, and
    complete log bytes, not from matching worktree paths.
    """
    receipts_dir = receipts_dir.resolve()
    found = sorted(p for p in receipts_dir.iterdir() if p.is_dir())
    expected = sorted(GATE_NAMES)
    require([p.name for p in found] == expected,
            'Gate receipts must contain exactly one directory per gate in GATES: expected '
            + ','.join(expected) + ' but found ' + ','.join(p.name for p in found))
    verified, producers = {}, []
    for directory in found:
        summary, _ = verify_gate_receipt(directory, initial, compiler)
        verified[summary['gate']] = summary
        producers.append(summary.get('producer'))
    bindings = [producer_run_binding(producer) for producer in producers]
    require(all(binding == bindings[0] for binding in bindings),
            'Gate receipts carry different producers')
    current = producer_identity()
    if current.get('run_id') is not None:
        require(all(all(binding.get(key) for key in
                       ('workflow', 'run_id', 'run_attempt', 'sha')) for binding in bindings),
                'Gate receipts must carry complete run fields in hosted mode')
        require(bindings[0] == producer_run_binding(current), 'Gate receipts belong to another run')
        for summary in verified.values():
            require((summary.get('producer') or {}).get('job') == 'gate-' + summary['gate'],
                    'Gate receipt producer job must be its actual workflow job')
    build = verified['build-native']
    binary = Path(build_outputs).resolve() / 'baton2'
    generated = Path(build_outputs).resolve() / 'baton2.c'
    require(binary.is_file() and generated.is_file(), 'The gated build outputs are required')
    require(sha256(binary) == build['binary_sha256'], 'The supplied binary differs from its gate receipt')
    require(sha256(generated) == build['generated_sha256'], 'The supplied generated C differs from its gate receipt')
    scratch = ROOT / '.scratch/bend2'
    scratch.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(binary, scratch / 'baton2')
    shutil.copyfile(generated, scratch / 'baton2.c')
    for name in GATE_NAMES:
        shutil.copyfile(receipts_dir / name / (name + '.log'), logs / (name + '.log'))
    summary = {'status': 'passed', 'worktree': str(ROOT), 'output': str(logs),
               'before': initial, 'environment': {'BEND': str(compiler), 'BEND_NO_TELEMETRY': '1',
                                                'CC': env.get('CC', 'clang')},
               'compiler_sha256': sha256(compiler), 'runner_sha256': sha256(Path(__file__)),
               'producer': producers[0], 'inputs_before': before_inputs,
               'stages': [verified[name]['stage'] for name in GATE_NAMES],
               'assembled_from': {name: sha256(receipts_dir / name / 'summary.json')
                                  for name in GATE_NAMES}}
    path = logs / 'summary.json'
    write_json(path, summary)
    summary['validation'] = validation(logs)
    summary['after'] = snapshot()
    require(summary['after']['binary_sha256'] == build['binary_sha256'],
            'The staged native executable differs from its gate receipt')
    write_json(path, summary)
    return path, summary


def stage_adapters(payload):
    directory = payload / 'libexec/baton2'
    directory.mkdir(parents=True)
    for harness in ('codex', 'omp', 'mcp'):
        for suffix in ('conductor', 'root'):
            name = harness + '-' + suffix + '.mjs'
            shutil.copyfile(ROOT / 'bend2/scripts' / name, directory / name)
    shutil.copyfile(ROOT / 'bend2/harness/git-series.mjs', directory / 'git-series.mjs')


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
        elif args.assemble_gates:
            receipt, summary = assemble_gate_receipts(
                args.assemble_gates, args.build_outputs, compiler, env, logs, initial, before_inputs)
            input_boundary = ('Each gate ran on its own isolated runner; the assembler captured compiler '
                              'libraries, CC and host, and every receipt binds identical exact source, '
                              'toolchain, runner source, run identity, and complete logs.')
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
                      'linked_libraries': libraries},
            'gates': {'receipt': 'logs/summary.json', **file_info(receipt),
                      'validation': summary['validation'], 'reused': bool(args.gate_receipt),
                      'assembled': bool(args.assemble_gates)},
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


def run_gate(args):
    initial = snapshot()
    compiler = args.bend.resolve()
    env = dict(os.environ, BEND=str(compiler), BEND_NO_TELEMETRY='1')
    run_one_gate(args.run_gate, compiler, env, args.gate_output, initial)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='new owned output directory, retained on failure')
    parser.add_argument('--bend', type=Path)
    parser.add_argument('--compiler-archive', type=Path, help='preserved official Darwin arm64 Bend 2.0.25 archive')
    parser.add_argument('--release-version', help='version identifier for a release archive; requires the project root LICENSE')
    parser.add_argument('--gate-receipt', type=Path, help='reuse a completed exact-source three-gate summary')
    parser.add_argument('--gate-receipt-sha256', help='required SHA256 pin when reusing a gate receipt')
    parser.add_argument('--run-gate', choices=GATE_NAMES,
                        help='run one gate on this exact source and record its receipt')
    parser.add_argument('--gate-output', type=Path, help='new owned receipt directory for --run-gate')
    parser.add_argument('--assemble-gates', type=Path,
                        help='assemble one receipt subdirectory per gate into a complete gate summary')
    parser.add_argument('--build-outputs', type=Path,
                        help='directory holding the build gate baton2 and baton2.c for --assemble-gates')
    args = parser.parse_args()
    require(bool(args.gate_receipt) == bool(args.gate_receipt_sha256), 'Gate receipt and SHA256 must be supplied together')
    if args.run_gate:
        require(args.gate_output is not None and args.output is None and args.gate_receipt is None
                and args.assemble_gates is None and args.build_outputs is None and args.compiler_archive is None,
                'Gate mode runs one gate with --bend and --gate-output only')
        require(args.bend is not None, 'Gate mode requires --bend')
        run_gate(args)
        return
    require(args.output is not None and args.bend is not None and args.compiler_archive is not None,
            'Packaging requires --output, --bend, and --compiler-archive')
    require(bool(args.assemble_gates) == bool(args.build_outputs),
            'Gate assembly and build outputs must be supplied together')
    require(not (args.gate_receipt and args.assemble_gates), 'Supply at most one gate source')
    package(args)


if __name__ == '__main__':
    main()
