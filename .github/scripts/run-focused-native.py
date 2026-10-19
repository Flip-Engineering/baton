#!/usr/bin/env python3
"""Run the focused observer recovery qualification in an owned process group."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import time


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def mem_available():
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise SystemExit('MemAvailable is unavailable')


def die_with_parent():
    try:
        import ctypes
        ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL)
    except Exception:
        pass


def verify_lineage(root, source, target):
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=root, text=True).strip()
    if git('rev-parse', 'HEAD') != source:
        raise SystemExit('checkout HEAD does not match source_commit')
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
                                   preexec_fn=die_with_parent)
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
    env = {name: os.environ[name] for name in names if name in os.environ}
    forbidden = ('GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN')
    if any(name in env for name in forbidden):
        raise SystemExit('GitHub action credentials are prohibited in the owned scope')
    return env


def verify_full_runtime(path, expected):
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise SystemExit('full runtime SHA256 must contain 64 lowercase hex digits')
    path = pathlib.Path(path).resolve(strict=True)
    if not path.is_file() or not os.access(path, os.X_OK):
        raise SystemExit('full runtime must be an executable regular file')
    if digest(path) != expected:
        raise SystemExit('full runtime SHA256 differs from the selected artifact')
    return path


def one_source(root, label, run, compiler, records, base_env,
               full_runtime, full_sha256):
    evidence = run / 'evidence' / label
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
    env.update({'BEND': str(compiler),
                'BEND_NO_TELEMETRY': '1', 'CC': '/usr/bin/clang-19',
                'BUN_JSC_maxPerThreadStackUsage': '67108864',
                'OBSERVER_RECOVERY_BIN': str(recovery),
                'KEEP_OBSERVER_FIXTURE': '1'})
    for name in ('BATON2_ADMISSION_RECEIPT', 'BEND_GENERATED_C',
                 'BATON2_NATIVE_RECEIVER_ROUTER', 'BATON2_RECEIVE_FOCUSED'):
        env.pop(name, None)
    env['BATON2_RECOVERY_HELPER'] = '1'
    run_command(label + '-build-recovery', ['sh', 'bend2/scripts/build-native.sh',
                'bend2/src/coordinator/receive-recovery-focused.bend',
                str(recovery)], root, env, evidence, records)
    recovery_c = pathlib.Path(str(recovery) + '.c')
    env.pop('BATON2_RECOVERY_HELPER', None)
    run_command(label + '-build-fixture', ['sh', 'bend2/scripts/build-native.sh',
                'bend2/test/monitor-fixture.bend', str(fixture)],
                root, env, evidence, records)
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
    run_command(label + '-observer-monitor', [sys.executable,
                'bend2/test/observer-monitor.py', '-v'], root, env, evidence, records)
    fixture_output = evidence / (label + '-observer-monitor.stdout')
    retained = []
    if fixture_output.exists():
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
    manifest = {'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
                'tree': subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=root, text=True).strip(),
                'tracked_source': before, 'recovery_c_sha256': digest(recovery_c),
                'recovery_binary_sha256': digest(recovery),
                'fixture_c_sha256': digest(str(fixture) + '.c'),
                'fixture_binary_sha256': digest(fixture),
                'retained_fixture_paths': retained,
                'full_runtime': {'selected_path': str(selected), 'staged_path': str(full),
                                 'sha256': digest(full),
                                 'qualification': 'installed-artifact-delegation-compatibility'}}
    write_json(evidence / 'source-result.json', manifest)
    return manifest


def inside(args):
    run = pathlib.Path(args.run).resolve()
    records = []
    target_root = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()
    candidate_root = pathlib.Path(args.candidate).resolve()
    source = args.source
    target = args.target
    verify_lineage(target_root, target, target)
    verify_lineage(candidate_root, source, target)
    safe_env = safe_environment()
    full_runtime = verify_full_runtime(args.full_runtime, args.full_runtime_sha256)
    write_json(run / 'evidence' / 'scope.json', {
        'process_group': os.getpgrp(),
        'driver_sha256': digest(pathlib.Path(__file__)),
        'cgroup_membership': pathlib.Path('/proc/self/cgroup').read_text(),
        'host_memory_pressure_before': pathlib.Path('/proc/pressure/memory').read_text(),
        'host_mem_available_before': mem_available()})
    try:
        target_result = one_source(target_root, 'target', run, pathlib.Path(args.compiler),
                                   records, safe_env, full_runtime, args.full_runtime_sha256)
        candidate_result = one_source(candidate_root, 'candidate', run, pathlib.Path(args.compiler),
                                      records, safe_env, full_runtime, args.full_runtime_sha256)
        outcome = {'result': 'pass', 'qualification': 'focused-observer-recovery-only',
                   'source': source, 'target': target, 'suite': args.suite,
                   'target_result': target_result, 'candidate_result': candidate_result,
                   'commands': records}
        write_json(run / 'evidence' / 'result.json', outcome)
    except BaseException as error:
        write_json(run / 'evidence' / 'result.json', {
            'result': 'fail', 'qualification': 'focused-observer-recovery-only',
            'source': source, 'target': target, 'suite': args.suite,
            'error_type': type(error).__name__, 'error': str(error), 'commands': records})
        raise
    finally:
        write_json(run / 'evidence' / 'scope-result.json', {
            'process_group': os.getpgrp(),
            'host_memory_pressure_after': pathlib.Path('/proc/pressure/memory').read_text(),
            'host_mem_available_after': mem_available()})


def stop_process_group(pid):
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    end = time.monotonic() + 3
    while time.monotonic() < end:
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        return
    for _ in range(20):
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)


def launch(args):
    run = pathlib.Path(args.run).resolve()
    run.mkdir(parents=True, exist_ok=True)
    target_root = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()
    candidate_root = pathlib.Path(args.candidate).resolve()
    source = args.source
    target = args.target
    verify_lineage(target_root, target, target)
    verify_lineage(candidate_root, source, target)
    actual_main = os.environ.get('BATON2_FOCUSED_CURRENT_MAIN', '')
    if actual_main != target:
        raise SystemExit('preflight did not verify target_commit against current GitHub main')
    if args.suite != 'observer-recovery':
        raise SystemExit('unsupported focused suite')
    full_runtime = verify_full_runtime(args.full_runtime, args.full_runtime_sha256)
    write_json(run / 'evidence' / 'dispatch.json', {
        'source': source, 'target': target, 'current_main': actual_main,
        'suite': args.suite, 'driver_sha256': digest(pathlib.Path(__file__)),
        'full_runtime': {'path': str(full_runtime), 'sha256': args.full_runtime_sha256},
        'host_mem_available_before': mem_available(),
        'cgroup_membership': pathlib.Path('/proc/self/cgroup').read_text(),
        'no_automatic_retry': True})
    argv = [sys.executable, str(pathlib.Path(__file__).resolve()), '--inside',
            '--run', str(run), '--source', source, '--target', target,
            '--candidate', args.candidate, '--suite', args.suite, '--compiler', args.compiler,
            '--full-runtime', str(full_runtime),
            '--full-runtime-sha256', args.full_runtime_sha256]
    stdout = (run / 'evidence' / 'scope.stdout').open('wb')
    stderr = (run / 'evidence' / 'scope.stderr').open('wb')

    def cancel(signum, frame):
        raise SystemExit(128 + signum)

    previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGTERM, signal.SIGINT)}
    process = subprocess.Popen(argv, stdout=stdout, stderr=stderr, env=safe_environment(),
                               preexec_fn=die_with_parent, start_new_session=True)
    try:
        code = process.wait()
    except BaseException:
        stop_process_group(process.pid)
        raise
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        stdout.close()
        stderr.close()
        stop_process_group(process.pid)
    launcher = {'process_group': process.pid, 'argv': argv, 'exit_code': code,
                'stdout_sha256': digest(run / 'evidence' / 'scope.stdout'),
                'stderr_sha256': digest(run / 'evidence' / 'scope.stderr')}
    write_json(run / 'evidence' / 'launcher.json', launcher)
    if code:
        raise SystemExit(code)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--launch', action='store_true')
    parser.add_argument('--inside', action='store_true')
    parser.add_argument('--run', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--suite', choices=['observer-recovery'], required=True)
    parser.add_argument('--compiler', required=True)
    parser.add_argument('--full-runtime', required=True)
    parser.add_argument('--full-runtime-sha256', required=True)
    args = parser.parse_args()
    if args.launch == args.inside:
        parser.error('select exactly one of --launch or --inside')
    if args.launch:
        launch(args)
    else:
        inside(args)


if __name__ == '__main__':
    main()
