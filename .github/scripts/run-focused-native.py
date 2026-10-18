#!/usr/bin/env python3
"""Run the focused observer recovery qualification in a measured cgroup scope."""
import argparse
import hashlib
import json
import os
import pathlib
import resource
import re
import shutil
import signal
import subprocess
import sys
import threading
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


def number_env(name):
    value = os.environ.get(name, '')
    if not value.isdecimal() or int(value) <= 0:
        raise SystemExit('missing or invalid runner policy variable: ' + name)
    return int(value)


def read_int(path):
    try:
        value = pathlib.Path(path).read_text().strip()
        return None if value == 'max' else int(value)
    except (OSError, ValueError):
        return None


def unified_cgroup():
    for line in pathlib.Path('/proc/self/cgroup').read_text().splitlines():
        if line.startswith('0::'):
            return line[3:]
    raise SystemExit('cgroup v2 membership is unavailable')


def parent_headroom():
    relative = unified_cgroup().lstrip('/')
    path = pathlib.Path('/sys/fs/cgroup') / relative
    available = []
    details = []
    current = path
    root = pathlib.Path('/sys/fs/cgroup')
    while current == root or root in current.parents:
        limit = read_int(current / 'memory.max')
        usage = read_int(current / 'memory.current')
        if limit is not None and usage is not None:
            available.append(max(0, limit - usage))
            details.append({'cgroup': str(current), 'memory_max': limit,
                            'memory_current': usage})
        if current == root:
            break
        current = current.parent
    return path, (min(available) if available else None), details


def mem_available():
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        if line.startswith('MemAvailable:'):
            return int(line.split()[1]) * 1024
    raise SystemExit('MemAvailable is unavailable')


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


class Sampler:
    def __init__(self, cg):
        self.cg = cg
        self.stop_event = threading.Event()
        self.peak = 0
        self.samples = []
        self.thread = threading.Thread(target=self.run, daemon=True)

    def run(self):
        while not self.stop_event.is_set():
            current = read_int(self.cg / 'memory.current') or 0
            self.peak = max(self.peak, current)
            self.samples.append({'time': time.time(), 'memory_current': current,
                                 'memory_swap_current': read_int(self.cg / 'memory.swap.current'),
                                 'pids_current': read_int(self.cg / 'pids.current')})
            self.stop_event.wait(0.5)

    def start(self):
        self.thread.start()

    def finish(self):
        self.stop_event.set()
        self.thread.join()
        return {'sample_count': len(self.samples), 'sample_peak_memory_current': self.peak,
                'samples': self.samples,
                'memory_peak': read_int(self.cg / 'memory.peak'),
                'memory_events': pathlib.Path(self.cg / 'memory.events').read_text().splitlines(),
                'pids_events': (self.cg / 'pids.events').read_text().splitlines()
                               if (self.cg / 'pids.events').exists() else []}


def run_command(label, argv, cwd, env, evidence, deadline, records):
    stdout_path = evidence / (label + '.stdout')
    stderr_path = evidence / (label + '.stderr')
    started = time.time()
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('focused run exceeded configured runtime')
    with stdout_path.open('wb') as stdout, stderr_path.open('wb') as stderr:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=stdout, stderr=stderr,
                                   start_new_session=True)
        try:
            code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise TimeoutError('command exceeded remaining focused runtime: ' + label)
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
        raise SystemExit('GitHub action credentials are prohibited in the admitted scope')
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


def one_source(root, label, run, compiler, cgroup, deadline, records, base_env,
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
    env.update({'BEND': str(compiler), 'BATON2_ADMISSION_CGROUP': str(cgroup),
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
                str(recovery)], root, env, evidence, deadline, records)
    recovery_c = pathlib.Path(str(recovery) + '.c')
    env.pop('BATON2_RECOVERY_HELPER', None)
    run_command(label + '-build-fixture', ['sh', 'bend2/scripts/build-native.sh',
                'bend2/test/monitor-fixture.bend', str(fixture)],
                root, env, evidence, deadline, records)
    env['OBSERVER_RECOVERY_BIN'] = str(recovery)
    run_command(label + '-helper-help', [str(recovery), '--help'],
                root, env, evidence, deadline, records)
    run_command(label + '-full-help', [str(full), '--help'],
                root, env, evidence, deadline, records)
    for suffix in ('stdout', 'stderr'):
        helper_help = evidence / (label + '-helper-help.' + suffix)
        full_help = evidence / (label + '-full-help.' + suffix)
        if helper_help.read_bytes() != full_help.read_bytes():
            raise SystemExit(label + ' helper delegation differs from the full runtime')
    run_command(label + '-observer-monitor', [sys.executable,
                'bend2/test/observer-monitor.py', '-v'], root, env, evidence, deadline, records)
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
    cg = pathlib.Path('/sys/fs/cgroup') / unified_cgroup().lstrip('/')
    expected_memory = int(args.memory)
    expected_tasks = int(args.tasks)
    if read_int(cg / 'memory.max') != expected_memory:
        raise SystemExit('created cgroup memory.max differs from admitted limit')
    if pathlib.Path(cg / 'memory.swap.max').read_text().strip() != '0':
        raise SystemExit('created cgroup does not disable swap')
    if read_int(cg / 'pids.max') != expected_tasks:
        raise SystemExit('created cgroup pids.max differs from runner policy')
    if resource.getrlimit(resource.RLIMIT_AS)[0] != resource.RLIM_INFINITY:
        raise SystemExit('RLIMIT_AS is capped')
    scope_current = read_int(cg / 'memory.current') or 0
    ancestor_rows = []
    ancestor = cg.parent
    root_cgroup = pathlib.Path('/sys/fs/cgroup')
    while ancestor == root_cgroup or root_cgroup in ancestor.parents:
        limit = read_int(ancestor / 'memory.max')
        usage = read_int(ancestor / 'memory.current')
        if limit is not None and usage is not None:
            headroom = max(0, limit - usage)
            required = max(0, expected_memory - scope_current) + int(args.reserve)
            ancestor_rows.append({'cgroup': str(ancestor), 'memory_max': limit,
                                  'memory_current': usage, 'available': headroom,
                                  'required_with_reserve': required})
            if headroom < required:
                raise SystemExit('scope would exceed finite ancestor headroom after reserve')
        if ancestor == root_cgroup:
            break
        ancestor = ancestor.parent
    write_json(run / 'evidence' / 'scope.json', {
        'cgroup': str(cg), 'memory_max': expected_memory, 'memory_swap_max': 0,
        'driver_sha256': digest(pathlib.Path(__file__)),
        'tasks_max': expected_tasks, 'runtime_limit_seconds': int(args.runtime),
        'cgroup_membership': pathlib.Path('/proc/self/cgroup').read_text(),
        'ancestor_cgroup_headroom': ancestor_rows,
        'host_memory_pressure_before': pathlib.Path('/proc/pressure/memory').read_text(),
        'memory_events_before': pathlib.Path(cg / 'memory.events').read_text().splitlines(),
        'memory_current_before': scope_current,
        'memory_swap_current_before': read_int(cg / 'memory.swap.current'),
        'host_mem_available_before': mem_available()})
    host_available_now = mem_available()
    required_host_headroom = max(0, expected_memory - scope_current) + int(args.reserve)
    if host_available_now < required_host_headroom:
        raise SystemExit('measured host headroom fell below the scope limit plus reserve')
    sampler = Sampler(cg)
    sampler.start()
    deadline = time.monotonic() + int(args.runtime)
    records = []
    target_root = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()
    candidate_root = pathlib.Path(args.candidate).resolve()
    source = args.source
    target = args.target
    verify_lineage(target_root, target, target)
    verify_lineage(candidate_root, source, target)
    safe_env = safe_environment()
    full_runtime = verify_full_runtime(args.full_runtime, args.full_runtime_sha256)
    try:
        target_result = one_source(target_root, 'target', run, pathlib.Path(args.compiler), cg,
                                   deadline, records, safe_env, full_runtime, args.full_runtime_sha256)
        candidate_result = one_source(candidate_root, 'candidate', run, pathlib.Path(args.compiler), cg,
                                      deadline, records, safe_env, full_runtime, args.full_runtime_sha256)
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
        metrics = sampler.finish()
        metrics['host_memory_pressure_after'] = pathlib.Path('/proc/pressure/memory').read_text()
        metrics['host_mem_available_after'] = mem_available()
        write_json(run / 'evidence' / 'scope-result.json', metrics)
        events = pathlib.Path(cg / 'memory.events').read_text().splitlines()
        if any(line.startswith('oom_kill ') and int(line.split()[1]) > 0 for line in events):
            raise SystemExit('focused cgroup recorded oom_kill')


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
    configured_max = number_env('BATON2_FOCUSED_MEMORY_MAX_BYTES')
    reserve = number_env('BATON2_FOCUSED_MEMORY_RESERVE_BYTES')
    tasks = number_env('BATON2_FOCUSED_TASKS_MAX')
    runtime = number_env('BATON2_FOCUSED_RUNTIME_SECONDS')
    if runtime >= 21600:
        raise SystemExit('runner runtime policy must leave time for artifact retention')
    physical = mem_available()
    _, parent_available, ancestor_limits = parent_headroom()
    available = min(physical, parent_available) if parent_available is not None else physical
    usable = available - reserve
    if usable <= 0:
        raise SystemExit('measured host headroom is below the configured reserve')
    memory = min(configured_max, usable)
    if memory <= 0:
        raise SystemExit('runner policy did not produce a finite positive memory limit')
    write_json(run / 'evidence' / 'admission.json', {
        'source': source, 'target': target, 'current_main': actual_main,
        'suite': args.suite, 'driver_sha256': digest(pathlib.Path(__file__)),
        'full_runtime': {'path': str(full_runtime), 'sha256': args.full_runtime_sha256},
        'configured_memory_max': configured_max,
        'memory_limit': memory, 'memory_reserve': reserve,
        'mem_available_before': physical, 'parent_cgroup_available': parent_available,
        'ancestor_cgroup_limits': ancestor_limits,
        'tasks_max': tasks, 'runtime_limit_seconds': runtime,
        'no_automatic_retry': True})
    unit = 'baton2-focused-' + os.environ.get('GITHUB_RUN_ID', 'local') + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '1')
    argv = ['systemd-run', '--user', '--scope', '--wait', '--unit=' + unit,
            '--property=MemoryMax=' + str(memory), '--property=MemorySwapMax=0',
            '--property=TasksMax=' + str(tasks), '--',
            sys.executable, str(pathlib.Path(__file__).resolve()), '--inside',
            '--run', str(run), '--source', source, '--target', target,
            '--candidate', args.candidate, '--suite', args.suite, '--compiler', args.compiler,
            '--memory', str(memory), '--tasks', str(tasks), '--runtime', str(runtime),
            '--reserve', str(reserve), '--full-runtime', str(full_runtime),
            '--full-runtime-sha256', args.full_runtime_sha256]
    stdout = (run / 'evidence' / 'scope.stdout').open('wb')
    stderr = (run / 'evidence' / 'scope.stderr').open('wb')
    process = subprocess.Popen(argv, stdout=stdout, stderr=stderr, env=safe_environment(),
                               start_new_session=True)
    try:
        code = process.wait(timeout=runtime + 60)
    except subprocess.TimeoutExpired:
        subprocess.run(['systemctl', '--user', 'kill', '--kill-who=all', unit],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        write_json(run / 'evidence' / 'launcher-timeout.json', {'unit': unit, 'argv': argv})
        raise SystemExit('focused systemd scope exceeded configured runtime')
    finally:
        stdout.close()
        stderr.close()
    launcher = {'unit': unit, 'argv': argv, 'exit_code': code,
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
    parser.add_argument('--memory', default='0')
    parser.add_argument('--tasks', default='0')
    parser.add_argument('--runtime', default='0')
    parser.add_argument('--reserve', default='0')
    args = parser.parse_args()
    if args.launch == args.inside:
        parser.error('select exactly one of --launch or --inside')
    if args.launch:
        launch(args)
    else:
        inside(args)


if __name__ == '__main__':
    main()
