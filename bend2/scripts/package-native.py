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


CONTROL_SCRIPT = 'bend2/scripts/laws-check.mjs'
CONTROL_FIELDS = ('id', 'kind', 'law', 'module', 'definition_sha256')
CHILD_FIELDS = ('exit_code', 'signal', 'spawn_error')
ORIGIN_FIELDS = ('workflow', 'run_id', 'run_attempt', 'jobs', 'image_os', 'image_version')


def discover_controls():
    """Read the control definitions through the checker's own discovery API."""
    script = ROOT / CONTROL_SCRIPT
    require(script.is_file(), 'The laws-check script is missing: ' + str(script))
    try:
        output = subprocess.check_output(['node', str(script), '--discover'], cwd=ROOT, text=True,
                                         stderr=subprocess.PIPE)
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError('The checker discovery API did not answer: ' + repr(error)) from error
    controls = []
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            raise RuntimeError('A checker discovery line is not a control record: '
                               + line[:120]) from error
        absent = [field for field in CONTROL_FIELDS if field not in record]
        require(not absent, 'A discovered control omits ' + ', '.join(absent) + ': '
                + json.dumps(record, sort_keys=True))
        require((ROOT / record['module']).is_file(),
                'A discovered control names a module outside this source: ' + str(record['module']))
        controls.append({field: record[field] for field in CONTROL_FIELDS})
    identities = [(control['id'], control['definition_sha256']) for control in controls]
    require(len(identities) == len(set(identities)), 'The discovered controls are not unique')
    ordered = sorted(controls, key=lambda control: control['id'])
    return {'controls': ordered,
            'sha256': hashlib.sha256('\n'.join(
                '\t'.join(control[field] for field in CONTROL_FIELDS)
                for control in ordered).encode()).hexdigest()}


def native_suites():
    return sorted(path.relative_to(ROOT).as_posix()
                  for path in (ROOT / 'bend2' / 'test').glob('*.py'))


def control_rows(text):
    """Separate the per-control rows a complete laws-check run prints."""
    laws, mutations, other = [], [], 0
    for line in text.splitlines():
        line = line.strip()
        if not (line.startswith('{') and line.endswith('}')):
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and 'law' in row and 'module' in row and 'proof' in row:
            laws.append(row)
        elif isinstance(row, dict) and 'mutation' in row and 'law' in row:
            mutations.append(row)
        else:
            other += 1
    return laws, mutations, other


def require_all_rows(rows, predicate, message):
    rejected = [row for row in rows if not predicate(row)]
    if rejected:
        require(False, message + '; first: ' + json.dumps(rejected[0], sort_keys=True)
                + (' and ' + str(len(rejected) - 1) + ' more' if len(rejected) > 1 else ''))


def succinct(values, limit=3):
    return json.dumps(values[:limit]) + (' (+' + str(len(values) - limit) + ' more)'
                                         if len(values) > limit else '')


def reconcile_controls(expected, laws, mutations):
    """Bind the complete invocation's rows to the discovered controls.

    The complete invocation prints one row per control, and its exit status is
    the gate's authority. This reconciliation establishes that every discovered
    control reported exactly once with its refusal recorded.
    """
    controls = {control['id']: control for control in expected['controls']}
    wanted_laws = {(control['law'], control['module']): control
                   for control in controls.values() if control['kind'] == 'proof-removal'}
    wanted_mutations = {control['id'].removeprefix('mutation:'): control
                        for control in controls.values() if control['kind'] == 'mutation'}

    observed = [(row.get('law'), row.get('module')) for row in laws]
    duplicates = len(observed) - len(set(observed))
    require(duplicates == 0, str(duplicates) + ' duplicate law control rows')
    missing = sorted(set(wanted_laws) - set(observed))
    require(not missing, 'Missing law control rows: ' + succinct(missing))
    unexpected = sorted(set(observed) - set(wanted_laws))
    require(not unexpected, 'Law control rows absent from this source: ' + succinct(unexpected))
    require_all_rows(laws,
                     lambda row: row.get('passed') is True and row.get('gate') == 'refuses'
                     and row.get('proof') == 'removed',
                     'A law control row did not record an attributable refusal')

    seen = []
    for row in mutations:
        name = row.get('mutation')
        require(name in wanted_mutations,
                'Mutation control row absent from this source: ' + json.dumps(name))
        require(row.get('law') == wanted_mutations[name]['law'],
                'Mutation ' + json.dumps(name) + ' names a different law than this source')
        seen.append(name)
    duplicates = len(seen) - len(set(seen))
    require(duplicates == 0, str(duplicates) + ' duplicate mutation control rows')
    missing = sorted(set(wanted_mutations) - set(seen))
    require(not missing, 'Missing mutation control rows: ' + succinct(missing))
    require_all_rows(mutations,
                     lambda row: row.get('applied') is True and row.get('passed') is True
                     and row.get('gate') == 'refuses',
                     'A mutation control row did not record an applied attributable refusal')


def validation(logs):
    law_text = (logs / 'laws-check.log').read_text(errors='replace')
    match = re.search(r'^laws-check: green - (\d+) laws, (\d+) mutations, (\d+) compiles, 0 failures$',
                      law_text, re.MULTILINE)
    require(match is not None, 'The complete laws-check success summary is missing')
    counts = dict(zip(('laws', 'mutations', 'compiles'), map(int, match.groups())))
    expected = discover_controls()
    laws = [control for control in expected['controls'] if control['kind'] == 'proof-removal']
    mutations = [control for control in expected['controls'] if control['kind'] == 'mutation']
    require(counts['laws'] == len(laws) and counts['mutations'] == len(mutations),
            'The laws-check summary counts ' + str(counts['laws']) + ' laws and '
            + str(counts['mutations']) + ' mutations; this source defines ' + str(len(laws))
            + ' laws and ' + str(len(mutations)) + ' mutations')
    require(counts['compiles'] == counts['laws'] + counts['mutations'] + 1,
            'The laws-check compile count does not equal its controls plus one baseline: '
            + str(counts['compiles']))
    law_rows, mutation_rows, _ = control_rows(law_text)
    reconcile_controls(expected, law_rows, mutation_rows)
    native_text = (logs / 'check-native.log').read_text(errors='replace')
    return {'laws': counts, 'controls_sha256': expected['sha256'],
            'native': reconcile_native(native_text)}


def reconcile_native(text):
    """Match the native log to the suites check-native.sh selects.

    The stage's exit status carries the pass or failure of these suites. This
    records which of the selected suites reported and the unittest totals they
    printed, and it fails when a selected suite is absent or an unselected file
    reported instead.
    """
    wanted = native_suites()
    lines = [line.strip() for line in text.splitlines()]
    suite_lines = [index for index, line in enumerate(lines)
                   if line.startswith('bend2/') and line.endswith('.py')]
    observed = [lines[index] for index in suite_lines]
    duplicates = len(observed) - len(set(observed))
    require(duplicates == 0, str(duplicates) + ' duplicate native suite runs')
    missing = sorted(set(wanted) - set(observed))
    require(not missing, 'Missing native suite evidence: ' + succinct(missing))
    unexpected = sorted(set(observed) - set(wanted))
    require(not unexpected, 'Native suite evidence absent from this source: ' + succinct(unexpected))
    total, reported = 0, 0
    for position, index in enumerate(suite_lines):
        end = suite_lines[position + 1] if position + 1 < len(suite_lines) else len(lines)
        found = [line for line in lines[index + 1:end]
                 if re.fullmatch(r'Ran (\d+) tests? in [^\n]+', line)]
        require(len(found) == 1, 'Native suite reported ' + str(len(found))
                + ' unittest summaries: ' + json.dumps(lines[index]))
        total += int(re.fullmatch(r'Ran (\d+) tests? in [^\n]+', found[0]).group(1))
        reported += 1
    return {'python_tests': total, 'python_suites': reported}


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
    require(summary.get('runner_sha256') == sha256(Path(__file__)),
            'The supplied gate receipt names different producing gate runner bytes')
    require('inputs_before' in summary and 'inputs_after' in summary,
            'The supplied gate receipt carries no historical toolchain and host inputs')
    require(summary['inputs_after'] == summary['inputs_before'],
            'The supplied gate receipt records changed inputs across its own gates')
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


def evidence_stream(directory, record, label):
    require(isinstance(record, dict), 'A controls evidence record omits its ' + label)
    path = (directory / str(record.get('path', ''))).resolve()
    require(directory.resolve() in path.parents,
            'A controls evidence ' + label + ' names a file outside the evidence directory')
    require(path.is_file(), 'A controls evidence ' + label + ' is missing: ' + str(record.get('path')))
    data = path.read_bytes()
    require(len(data) == record.get('bytes'), 'A controls evidence ' + label + ' changed size')
    require(hashlib.sha256(data).hexdigest() == record.get('sha256'),
            'A controls evidence ' + label + ' does not match its recorded digest')
    return path


def verify_process(record, baseline, label):
    outcome = record.get('process')
    require(isinstance(outcome, dict), 'A controls evidence ' + label + ' omits its process outcome')
    require(outcome.get('state') == 'exited' and outcome.get('signal') is None
            and outcome.get('spawn_error') is None,
            'A controls evidence ' + label + ' did not complete as an exited child')
    code = outcome.get('exit_code')
    require(type(code) is int and (code == 0 if baseline else code > 0),
            'A controls evidence ' + label + ' records exit ' + repr(code))
    require(outcome.get('ended') >= outcome.get('started') >= 0,
            'A controls evidence ' + label + ' records an invalid child interval')
    require(outcome.get('attempt') not in (None, ''),
            'A controls evidence ' + label + ' records no attempt identity')
    return outcome


def controls_evidence(directory, initial, compiler):
    """Validate remote module-group control evidence against this source.

    The evidence is the aggregate of one control job per module group. Each
    bundle carries its baseline child outcome, every control's definition, its
    process outcome, its diagnostic classification and the complete hashes of its
    two output streams. This qualifies the narrow remote controls; it replaces no
    local gate.
    """
    path = directory / 'controls-summary.json'
    require(path.is_file(), 'The controls evidence has no controls-summary.json: ' + str(path))
    summary = json.loads(path.read_text())
    expected = discover_controls()
    wanted = {control['id']: control for control in expected['controls']}
    modules = {control['module'] for control in expected['controls']}
    require(not summary.get('rejections'),
            'The controls evidence reports rejections: ' + json.dumps(summary.get('rejections', [])[:3]))
    require(summary.get('binding') == expected['sha256'],
            'The controls evidence checked a different control definition set')
    for field, value in (('source_sha', initial['head']), ('source_tree', initial['tree']),
                         ('source_bend2_tree', initial['bend2_tree'])):
        require(summary.get(field) == value,
                'The controls evidence names a different ' + field)
    require(summary.get('checker_sha256') == sha256(ROOT / CONTROL_SCRIPT),
            'The controls evidence names different checker bytes')
    require(summary.get('compiler_sha256') == sha256(compiler),
            'The controls evidence names a different compiler than the selected one')
    origin = summary.get('origin') or {}
    absent = [field for field in ORIGIN_FIELDS if not origin.get(field)]
    require(not absent, 'The controls evidence does not name its producing origin: '
            + ', '.join(absent))
    for variable, field in (('GITHUB_WORKFLOW', 'workflow'), ('GITHUB_RUN_ID', 'run_id'),
                            ('GITHUB_RUN_ATTEMPT', 'run_attempt')):
        if os.environ.get(variable):
            require(str(origin[field]) == os.environ[variable],
                    'The controls evidence names a different ' + field + ' than this run')

    bundles = summary.get('bundles')
    require(isinstance(bundles, list) and bundles, 'The controls evidence holds no module bundles')
    seen_modules, seen_cases, attempts = set(), {}, {}
    for bundle in bundles:
        module = bundle.get('module')
        require(module in modules, 'A controls evidence bundle is absent from this source: '
                + json.dumps(module))
        require(module not in seen_modules, 'A controls evidence module appears twice: '
                + json.dumps(module))
        seen_modules.add(module)
        require(bundle.get('binding') == expected['sha256'],
                'A bundle checked a different control definition set: ' + json.dumps(module))
        baseline = verify_process(bundle.get('baseline') or {}, baseline=True,
                                  label='baseline of ' + json.dumps(module))
        baseline_streams = [evidence_stream(directory, (bundle.get('baseline') or {}).get(stream),
                                            'baseline ' + stream)
                            for stream in ('stdout', 'stderr')]
        intervals = [(baseline['started'], baseline['ended'])]
        attempts = {baseline['attempt']}
        for result in bundle.get('results') or []:
            case = result.get('case') or {}
            identity = case.get('id')
            control = wanted.get(identity)
            require(control is not None, 'A controls evidence case is absent from this source: '
                    + json.dumps(identity))
            require(identity not in seen_cases, 'A controls evidence case appears twice: '
                    + json.dumps(identity))
            require(case == control, 'A controls evidence case definition differs from this source: '
                    + json.dumps(identity))
            require(case.get('module') == module, 'A case is bound to another module: '
                    + json.dumps(identity))
            require(result.get('setup') == 'applied',
                    'A control edit did not apply: ' + json.dumps(identity))
            outcome = verify_process(result, baseline=False, label=json.dumps(identity))
            require(outcome['attempt'] not in attempts, 'A controls evidence attempt repeats: '
                    + json.dumps(outcome['attempt']))
            attempts.add(outcome['attempt'])
            require(outcome['started'] >= baseline['ended'],
                    'A control started before its baseline ended: ' + json.dumps(identity))
            intervals.append((outcome['started'], outcome['ended']))
            diagnostic = result.get('diagnostic') or {}
            require(diagnostic.get('class') == 'intended-law-refusal',
                    'A control diagnostic is not an intended law refusal: ' + json.dumps(identity))
            require(diagnostic.get('attributed_law') == control['law'],
                    'A control diagnostic names another law: ' + json.dumps(identity))
            for stream in ('stdout', 'stderr'):
                evidence_stream(directory, result.get(stream), json.dumps(identity) + ' ' + stream)
            resource = result.get('resource') or {}
            require(bool(resource.get('real_seconds')),
                    'A control carries no resource sample: ' + json.dumps(identity))
            seen_cases[identity] = {'resource': resource, 'group': module}
        intervals.sort()
        require(all(left[1] <= right[0] for left, right in zip(intervals, intervals[1:])),
                'Two compilers overlapped in one module group: ' + json.dumps(module))
    missing_modules = sorted(modules - seen_modules)
    require(not missing_modules, 'The controls evidence omits module groups: '
            + succinct(missing_modules))
    missing_cases = sorted(set(wanted) - set(seen_cases))
    require(not missing_cases, 'The controls evidence omits controls: ' + succinct(missing_cases))
    return {'path': str(path), **file_info(path), 'cases': len(wanted), 'groups': len(modules),
            'binding': expected['sha256'], 'origin': origin,
            'slowest_seconds': max(entry['resource']['real_seconds']
                                   for entry in seen_cases.values()),
            'largest_child_max_rss_bytes': max((entry['resource'].get('max_rss_bytes') or 0)
                                               for entry in seen_cases.values())}


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
        controls = (controls_evidence(args.controls_evidence.resolve(), initial, compiler)
                    if args.controls_evidence else None)
        if args.gate_receipt:
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
                      **({'controls': controls} if controls else {})},
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
    parser.add_argument('--controls-evidence', type=Path,
                        help='directory holding controls-summary.json and its control logs, validated against this source')
    args = parser.parse_args()
    require(bool(args.gate_receipt) == bool(args.gate_receipt_sha256), 'Gate receipt and SHA256 must be supplied together')
    package(args)


if __name__ == '__main__':
    main()
