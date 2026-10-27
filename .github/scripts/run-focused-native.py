#!/usr/bin/env python3
"""Run the focused observer recovery qualification on the native runner."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time


def digest(path):
    value = hashlib.sha256()
    with pathlib.Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def host_observation():
    available = None
    pressure = None
    try:
        for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
            if line.startswith('MemAvailable:'):
                available = int(line.split()[1]) * 1024
                break
    except (OSError, ValueError):
        pass
    try:
        pressure = pathlib.Path('/proc/pressure/memory').read_text()
    except OSError:
        pass
    return {'observed_at': time.time(), 'mem_available_bytes': available,
            'memory_pressure': pressure}


def verify_lineage(root, source, target):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True).strip()

    if git('rev-parse', 'HEAD') != source:
        raise SystemExit('checkout HEAD does not match the requested source commit')
    subprocess.run(['git', 'cat-file', '-e', target + '^{commit}'], cwd=root, check=True)
    subprocess.run(['git', 'merge-base', '--is-ancestor', target, source], cwd=root, check=True)
    if git('status', '--porcelain', '--untracked-files=no'):
        raise SystemExit('tracked candidate source is dirty')


def tracked_manifest(root):
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    return {path: digest(pathlib.Path(root) / path)
            for path in paths if path and (pathlib.Path(root) / path).is_file()}


def run_command(label, argv, cwd, env, evidence, records):
    stdout_path = evidence / (label + '.stdout')
    stderr_path = evidence / (label + '.stderr')
    started = time.time()
    with stdout_path.open('wb') as stdout, stderr_path.open('wb') as stderr:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=stdout, stderr=stderr,
                                   start_new_session=True)
        code = process.wait()
    row = {'label': label, 'argv': argv, 'cwd': str(cwd), 'started_at': started,
           'ended_at': time.time(), 'exit_code': code,
           'stdout': stdout_path.name, 'stdout_sha256': digest(stdout_path),
           'stderr': stderr_path.name, 'stderr_sha256': digest(stderr_path)}
    records.append(row)
    write_json(evidence / 'commands.json', records)
    if code:
        raise subprocess.CalledProcessError(code, argv)
    return row


def safe_environment():
    names = ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG',
             'LC_ALL', 'LC_CTYPE', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
             'GITHUB_WORKSPACE', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT',
             'GITHUB_REPOSITORY', 'RUNNER_TEMP')
    return {name: os.environ[name] for name in names if name in os.environ}


def verify_full_runtime(path, expected):
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise SystemExit('full runtime SHA256 must contain 64 lowercase hex digits')
    path = pathlib.Path(path).resolve(strict=True)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise SystemExit('full runtime must be an executable regular file')
    if digest(path) != expected:
        raise SystemExit('full runtime SHA256 differs from the selected artifact')
    return path


def one_source(root, label, run, compiler, evidence_root, base_env,
               full_runtime, full_sha256, records):
    evidence = evidence_root / label
    evidence.mkdir(parents=True, exist_ok=True)
    before = tracked_manifest(root)
    scratch = root / '.scratch' / 'bend2'
    scratch.mkdir(parents=True, exist_ok=True)
    runtime = scratch / (label + '-recovery-runtime')
    runtime.mkdir(exist_ok=True)
    recovery = runtime / 'baton'
    full = runtime / 'baton-full'
    selected = verify_full_runtime(full_runtime, full_sha256)
    shutil.copyfile(selected, full)
    full.chmod(0o755)
    if digest(full) != full_sha256:
        raise SystemExit('staged full runtime differs from the selected artifact')

    fixture = scratch / 'monitor-fixture'
    env = dict(base_env)
    env.update({'BEND': str(compiler), 'BEND_NO_TELEMETRY': '1',
                'CC': '/usr/bin/clang-19', 'BUN_JSC_maxPerThreadStackUsage': '67108864',
                'OBSERVER_RECOVERY_BIN': str(recovery), 'KEEP_OBSERVER_FIXTURE': '1'})
    for name in ('BATON2_NATIVE_RECEIVER_ROUTER', 'BATON2_RECEIVE_FOCUSED'):
        env.pop(name, None)
    env['BATON2_RECOVERY_HELPER'] = '1'
    run_command(label + '-build-recovery',
                ['sh', 'bend2/scripts/build-native.sh',
                 'bend2/src/coordinator/receive-recovery-focused.bend', str(recovery)],
                root, env, evidence, records)
    recovery_c = pathlib.Path(str(recovery) + '.c')

    env.pop('BATON2_RECOVERY_HELPER', None)
    run_command(label + '-build-fixture',
                ['sh', 'bend2/scripts/build-native.sh', 'bend2/test/monitor-fixture.bend',
                 str(fixture)], root, env, evidence, records)
    env['OBSERVER_RECOVERY_BIN'] = str(recovery)
    run_command(label + '-helper-help', [str(recovery), '--help'],
                root, env, evidence, records)
    run_command(label + '-full-help', [str(full), '--help'],
                root, env, evidence, records)
    for suffix in ('stdout', 'stderr'):
        helper_help = evidence / (label + '-helper-help.' + suffix)
        full_help = evidence / (label + '-full-help.' + suffix)
        if helper_help.read_bytes() != full_help.read_bytes():
            raise SystemExit(label + ' helper delegation differs from the full runtime')
    run_command(label + '-observer-monitor',
                [sys.executable, 'bend2/test/observer-monitor.py', '-v'],
                root, env, evidence, records)

    fixture_output = evidence / (label + '-observer-monitor.stdout')
    retained = []
    for line in fixture_output.read_text(errors='replace').splitlines():
        if line.startswith('fixture_directory='):
            path = pathlib.Path(line.split('=', 1)[1])
            if path.is_dir():
                destination = evidence / 'retained-fixtures' / path.name
                shutil.copytree(path, destination, dirs_exist_ok=True)
                retained.append(str(destination))
    after = tracked_manifest(root)
    if before != after:
        raise SystemExit(label + ' changed tracked source during qualification')

    fixture_c = pathlib.Path(str(fixture) + '.c')
    result = {
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'tree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=root, text=True).strip(),
        'driver_sha256': digest(pathlib.Path(__file__)),
        'tracked_source': before,
        'recovery_c_sha256': digest(recovery_c),
        'recovery_binary_sha256': digest(recovery),
        'fixture_c_sha256': digest(fixture_c),
        'fixture_binary_sha256': digest(fixture),
        'retained_fixture_paths': retained,
        'full_runtime': {'selected_path': str(selected), 'staged_path': str(full),
                         'sha256': digest(full),
                         'qualification': 'installed-artifact-delegation-compatibility'}}
    write_json(evidence / 'source-result.json', result)
    return result


def run_qualification(args):
    run = pathlib.Path(args.run).resolve()
    run.mkdir(parents=True, exist_ok=True)
    target_root = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()
    candidate_root = pathlib.Path(args.candidate).resolve()
    verify_lineage(target_root, args.target, args.target)
    verify_lineage(candidate_root, args.source, args.target)
    if os.environ.get('BATON2_FOCUSED_CURRENT_MAIN') != args.target:
        raise SystemExit('preflight did not verify target commit against current GitHub main')
    if args.suite != 'observer-recovery':
        raise SystemExit('unsupported focused suite')

    full_runtime = verify_full_runtime(args.full_runtime, args.full_runtime_sha256)
    evidence = run / 'evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    records = []
    observations = {'before': host_observation()}
    write_json(evidence / 'host-observation.json', observations)
    safe_env = safe_environment()
    try:
        target_result = one_source(target_root, 'target', run, pathlib.Path(args.compiler),
                                   evidence, safe_env, full_runtime,
                                   args.full_runtime_sha256, records)
        candidate_result = one_source(candidate_root, 'candidate', run,
                                      pathlib.Path(args.compiler), evidence, safe_env,
                                      full_runtime, args.full_runtime_sha256, records)
        outcome = {'result': 'pass', 'qualification': 'focused-observer-recovery-only',
                   'source': args.source, 'target': args.target, 'suite': args.suite,
                   'driver_sha256': digest(pathlib.Path(__file__)),
                   'target_result': target_result, 'candidate_result': candidate_result,
                   'commands': records}
        write_json(evidence / 'result.json', outcome)
    except BaseException as error:
        write_json(evidence / 'result.json', {
            'result': 'fail', 'qualification': 'focused-observer-recovery-only',
            'source': args.source, 'target': args.target, 'suite': args.suite,
            'driver_sha256': digest(pathlib.Path(__file__)),
            'error_type': type(error).__name__, 'error': str(error), 'commands': records})
        raise
    finally:
        observations['after'] = host_observation()
        write_json(evidence / 'host-observation.json', observations)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--suite', choices=['observer-recovery'], required=True)
    parser.add_argument('--compiler', required=True)
    parser.add_argument('--full-runtime', required=True)
    parser.add_argument('--full-runtime-sha256', required=True)
    run_qualification(parser.parse_args())


if __name__ == '__main__':
    main()
