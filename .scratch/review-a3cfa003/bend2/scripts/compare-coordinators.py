#!/usr/bin/env python3
"""Measure retained coordination operations against a pinned JS implementation.

Example:
  python3 bend2/scripts/compare-coordinators.py --old-repo /path/to/old/baton \
    --old-ref 8120395a --samples 25 --workers 9 --reports 58

The old runtime stays loaded with controlled worker ports. Every Bend2 operation
uses its ordinary executable. Scratch stores and raw results are retained.
"""
import argparse
import hashlib
import io
import json
import math
import os
import pathlib
import platform
import random
import re
import select
import shutil
import subprocess
import tarfile
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
HELPER = pathlib.Path(__file__).with_name('compare-old-coordinator.mjs')


def execute(argv, cwd=None, env=None):
    result = subprocess.run([str(item) for item in argv], cwd=cwd, env=env,
                            capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: '
                           f'{result.stderr.decode(errors="replace")[-4000:]}')
    return result


def git(repo, *args):
    return execute(['git', '-C', repo, *args]).stdout.decode().strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def describe(values):
    ordered = sorted(values)
    return {'n': len(values), 'min': ordered[0],
            'p50': ordered[(len(values) - 1) // 2],
            'p95': ordered[math.ceil(len(values) * .95) - 1],
            'max': ordered[-1], 'mean': sum(values) / len(values)}


def retained_bytes(path):
    return sum(item.stat().st_size for item in path.rglob('*') if item.is_file())


def host_observation():
    processes = execute(['ps', '-axo', 'pid,ppid,%cpu,comm']).stdout.decode().splitlines()[1:]
    rows = sorted((line.split(None, 3) for line in processes),
                  key=lambda fields: float(fields[2]), reverse=True)
    return {'load_average': list(os.getloadavg()), 'top_cpu_processes': rows[:12]}


def dependency_metadata(source, directory):
    package = json.loads((source / 'impl/package.json').read_text())
    names = sorted(set(package.get('dependencies', {})) | set(package.get('optionalDependencies', {})))
    packages = {}
    for name in names:
        path = directory / name / 'package.json'
        if path.is_file():
            packages[name] = {'version': json.loads(path.read_text()).get('version'),
                              'package_json_sha256': digest(path)}
        else:
            packages[name] = {'installed': False}
    return {'directory': str(directory), 'contents_pinned': False,
            'scope': 'Declared direct dependency package metadata; installed contents and transitive dependencies are not pinned.',
            'packages': packages}


class Old:
    def __init__(self, node, source, store, workers, cwd, env):
        self.stderr = (cwd / f'old-{time.time_ns()}.stderr').open('w')
        started = time.perf_counter_ns()
        self.process = subprocess.Popen([node, str(HELPER), str(source), str(store), str(workers)],
                                        cwd=cwd, env=env, stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=self.stderr, text=True)
        try:
            self.ready = self.read()
        except BaseException:
            self.close()
            raise
        self.startup_ms = (time.perf_counter_ns() - started) / 1e6
        if not self.ready.get('ready'):
            raise RuntimeError(f'Old helper did not become ready: {self.ready}')

    def read(self):
        if not select.select([self.process.stdout], [], [], 120)[0]:
            raise RuntimeError('Old helper exceeded the measurement timeout')
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError(f'Old helper exited; see {self.stderr.name}')
        value = json.loads(line)
        if 'error' in value:
            raise RuntimeError(json.dumps(value['error']))
        return value

    def call(self, op, **args):
        started = time.perf_counter_ns()
        self.process.stdin.write(json.dumps({'op': op, **args}) + '\n')
        self.process.stdin.flush()
        answer = self.read()
        elapsed = (time.perf_counter_ns() - started) / 1e6
        return answer['value'], {'wall_ms': elapsed, 'dispatch_ms': answer['dispatch_ms'],
                                 'durable_ms': answer['durable_ms'], 'fsyncs': answer['fsyncs'],
                                 'result_bytes': answer['result_bytes']}

    def close(self):
        try:
            if self.process.poll() is None:
                try:
                    if not self.process.stdin.closed:
                        self.process.stdin.write('{"op":"close"}\n')
                        self.process.stdin.flush()
                        self.process.stdin.close()
                    self.process.wait(timeout=10)
                except (BrokenPipeError, subprocess.TimeoutExpired):
                    pass
                finally:
                    if self.process.poll() is None:
                        self.process.kill()
                        self.process.wait()
        finally:
            for stream in (self.process.stdin, self.process.stdout, self.stderr):
                if stream is not None and not stream.closed:
                    try:
                        stream.close()
                    except OSError:
                        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--old-repo', type=pathlib.Path, required=True)
    parser.add_argument('--old-ref', required=True)
    parser.add_argument('--binary', type=pathlib.Path, default=ROOT / '.scratch/bend2/baton2')
    parser.add_argument('--samples', type=int, default=25)
    parser.add_argument('--warmups', type=int, default=3)
    parser.add_argument('--workers', type=int, default=9)
    parser.add_argument('--reports', type=int, default=58)
    parser.add_argument('--body-bytes', type=int, default=4096)
    parser.add_argument('--seed', type=int, default=20260928)
    parser.add_argument('--output-root', type=pathlib.Path, default=ROOT / '.scratch/comparison')
    args = parser.parse_args()
    if min(args.samples, args.workers, args.body_bytes) < 1 or min(args.warmups, args.reports) < 0:
        parser.error('samples, workers and body-bytes must be positive; warmups and reports nonnegative')
    node = shutil.which('node')
    if node is None:
        parser.error('node is required')
    args.binary = args.binary.resolve()
    old_sha = git(args.old_repo, 'rev-parse', f'{args.old_ref}^{{commit}}')
    args.output_root.mkdir(parents=True, exist_ok=True)
    run = pathlib.Path(tempfile.mkdtemp(prefix='run-', dir=args.output_root)).resolve()
    source = run / 'old-source'
    source.mkdir()
    archive = execute(['git', '-C', args.old_repo, 'archive', old_sha,
                       'impl/src', 'impl/scripts', 'impl/package.json']).stdout
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(source, filter='data')
    dependencies = args.old_repo.resolve() / 'impl/node_modules'
    if dependencies.exists():
        (source / 'impl/node_modules').symlink_to(dependencies, target_is_directory=True)
    old_dependencies = dependency_metadata(source, dependencies)
    home = run / 'home'
    home.mkdir()
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(home), 'LANG': 'en_US.UTF-8'}
    body = ('Report with Unicode λ and a quoted value \'ready\'.\n' * (args.body_bytes + 1))
    body = body.encode()[:args.body_bytes].decode(errors='ignore')
    body += 'x' * (args.body_bytes - len(body.encode()))
    db = run / 'bend2.db'
    old_store = run / 'old-store'
    expected_reports = {}
    expected_guides = {}
    expected_old_guides = {}
    samples = []
    host_before = host_observation()

    def request_body(identifier):
        text = (identifier + '\n' + body).encode()[:args.body_bytes].decode(errors='ignore')
        return text + 'x' * (args.body_bytes - len(text.encode()))

    def bend(*command):
        started = time.perf_counter_ns()
        answer = execute([args.binary, db, *command], cwd=run, env=env)
        value = json.loads(answer.stdout)
        elapsed = (time.perf_counter_ns() - started) / 1e6
        return value, {'wall_ms': elapsed, 'result_bytes': len(answer.stdout)}

    old = None
    try:
        old = Old(node, source, old_store, args.workers, run, env)
        startup = {'old_initial_process_ready_ms': old.startup_ms,
                   'old_initial_rss_bytes': old.ready['rss_bytes']}
        old.call('setup')
        bend('attach', 'root', 'controlled-root', 'root-session', '')
        # Recruited sessions need a real repository and base commit.
        benchmark_repo = run / 'benchmark-repo'
        execute(['git', 'init', '-q', '-b', 'main', str(benchmark_repo)])
        execute(['git', '-C', str(benchmark_repo), 'config', 'user.email', 'benchmark@example.invalid'])
        execute(['git', '-C', str(benchmark_repo), 'config', 'user.name', 'Coordinator comparison'])
        (benchmark_repo / 'seed.txt').write_text('benchmark seed\n')
        execute(['git', '-C', str(benchmark_repo), 'add', 'seed.txt'])
        execute(['git', '-C', str(benchmark_repo), 'commit', '-q', '-m', 'seed'])
        benchmark_base = execute(['git', '-C', str(benchmark_repo), 'rev-parse', 'HEAD']).stdout.decode().strip()
        for index in range(args.workers):
            bend('recruit', f'worker-{index}', 'root', 'controlled-oneshot', 'controlled-model',
                 'high', str(benchmark_repo), f'branch-{index}',
                 str(run / f'workspace-{index}'), benchmark_base)

        def perform(system, operation, unique):
            worker = f'worker-{unique % args.workers}'
            identifier = f'{operation}-{unique}'
            text = request_body(identifier)
            if operation == 'report_write':
                expected_reports[identifier] = text
                if system == 'old':
                    return old.call('report', id=identifier, worker=worker, body=text)
                return bend('report', identifier, worker, text)
            if operation == 'guidance_write':
                expected_guides[identifier] = (worker, text)
                if system == 'old':
                    value, timing = old.call('guide', id=identifier, worker=worker, body=text)
                    expected_old_guides[value['guide']['messageId']] = (worker, text)
                    return value, timing
                return bend('message', identifier, 'root', worker, 'guidance', text)
            if operation == 'roster_read':
                value, timing = old.call('workers') if system == 'old' else bend('workers')
                rows = value['participants'] if system == 'old' else value
                identities = {row['participantId' if system == 'old' else 'id'] for row in rows}
                assert identities == {f'worker-{index}' for index in range(args.workers)}
                return value, timing
            if operation == 'reports_read':
                value, timing = old.call('reports') if system == 'old' else bend('inbox', 'root')
                rows = value['contributions'] if system == 'old' else value
                actual = {row['contributionId' if system == 'old' else 'id']: row['body'] for row in rows}
                assert actual == expected_reports
                return value, timing
            raise ValueError(operation)

        for index in range(args.reports):
            for system in ('old', 'bend2'):
                perform(system, 'report_write', index)
        seeded_bytes = {'old_store': retained_bytes(old_store), 'bend2_db': db.stat().st_size}
        operations = ['roster_read', 'reports_read', 'guidance_write', 'report_write']
        rng = random.Random(args.seed)
        for iteration in range(args.warmups + args.samples):
            rng.shuffle(operations)
            for operation in operations:
                systems = ['old', 'bend2']
                rng.shuffle(systems)
                unique = args.reports + iteration
                for system in systems:
                    _, timing = perform(system, operation, unique)
                    if iteration >= args.warmups:
                        samples.append({'system': system, 'operation': operation,
                                        'iteration': iteration - args.warmups, **timing})

        verified, _ = old.call('verify')
        assert {row['messageId']: (row['participantId'], row['message'])
                for row in verified['guides']} == expected_old_guides
        pending, _ = bend('pending')
        assert {row['id']: row['body'] for row in pending} == expected_reports | {
            key: value[1] for key, value in expected_guides.items()}
        assert {row['id']: (row['recipient'], row['body']) for row in pending
                if row['kind'] == 'guidance'} == expected_guides
        final_counts = {'workers': args.workers, 'reports': len(expected_reports),
                        'guidance': len(expected_guides), 'old_events': verified['events']}
        old.close()
        old = None
        replay = []
        for _ in range(3):
            old = Old(node, source, old_store, args.workers, run, env)
            _, timing = perform('old', 'reports_read', 0)
            recovered, _ = old.call('verify')
            assert {row['messageId']: (row['participantId'], row['message'])
                    for row in recovered['guides']} == expected_old_guides
            replay.append({'old_process_ready_ms': old.startup_ms,
                           'old_rss_bytes': old.ready['rss_bytes'], 'old_first_read_ms': timing['wall_ms']})
            old.close()
            old = None
            perform('bend2', 'reports_read', 0)
        memory = {'old_after_workload_rss_bytes': verified['rss_bytes']}
        if platform.system() == 'Darwin':
            result = execute(['/usr/bin/time', '-l', args.binary, db, 'workers'], cwd=run, env=env)
            match = re.search(rb'(\d+)\s+maximum resident set size', result.stderr)
            if match:
                memory['bend2_roster_process_peak_rss_bytes'] = int(match[1])
        summary = {}
        for operation in operations:
            summary[operation] = {}
            for system in ('old', 'bend2'):
                rows = [row for row in samples if row['system'] == system and row['operation'] == operation]
                summary[operation][system] = {field: describe([row[field] for row in rows])
                    for field in ('wall_ms', 'result_bytes', 'dispatch_ms', 'durable_ms') if field in rows[0]}
        runtime_sources = sorted((ROOT / 'bend2/src').rglob('*'))
        fingerprint = hashlib.sha256()
        for path in runtime_sources:
            if path.is_file():
                fingerprint.update(str(path.relative_to(ROOT)).encode() + b'\0' + path.read_bytes())
        report = {
            'schema': 1, 'created_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            'run_directory': str(run), 'configuration': {key: str(value) if isinstance(value, pathlib.Path)
                                                        else value for key, value in vars(args).items()},
            'pins': {'old_commit': old_sha, 'old_source_archive_sha256': hashlib.sha256(archive).hexdigest(),
                     'bend2_commit': git(ROOT, 'rev-parse', 'HEAD'),
                     'bend2_runtime_sources_sha256': fingerprint.hexdigest(),
                     'bend2_binary_sha256': digest(args.binary),
                     'benchmark_sha256': digest(pathlib.Path(__file__)),
                     'old_helper_sha256': digest(HELPER),
                     'node': execute([node, '--version']).stdout.decode().strip(),
                     'python': platform.python_version(), 'platform': platform.platform(),
                     'machine': platform.machine(), 'logical_cpus': os.cpu_count()},
            'method': {
                'old': 'Production SwarmRuntime.command with real CoordinationStore, retained Node process, controlled worker ports, private stdio transport.',
                'bend2': 'Production executable and SQLite store; one new process per command; empty root endpoint.',
                'mapping': {'roster_read': 'swarm.view projection=participants / workers',
                            'reports_read': 'swarm.view projection=contributions / inbox root',
                            'guidance_write': 'swarm.guide retained for one-shot worker / message guidance',
                            'report_write': 'swarm.update contribution_recorded / report to parent'},
                'old_durability': 'Real fsync wrapper; durable_ms includes scheduled group fsync before helper response. dispatch_ms ends when the runtime returns.',
                'timing': 'Monotonic wall time including caller JSON parsing on both sides; deterministic interleaving; warmups excluded; p95 nearest rank; no cache flush.',
                'correctness': 'Every roster and report read checked; exact Unicode body and report IDs checked before and after three old process restarts; guidance bodies checked in retained records.',
                'limitations': ['Old worker recruitment uses controlled ports; no provider or native process launch.',
                               'Old Web/CLI transport, auth, host-capacity service and delivery endpoints are excluded.',
                               'Bend2 root native delivery is excluded; reports remain pending.',
                               'Report records differ: old contributions include review machinery; Bend2 messages include recipient receipts.',
                               'Writes grow both stores during samples; raw iteration order and sizes are retained.',
                               'RSS compares an old retained runtime with one native roster process; this is not whole-deployment RSS.',
                               'Measurements do not establish live end-to-end worker, landing, or publication performance.'],
            },
            'body_bytes': len(body.encode()), 'seeded_retained_bytes': seeded_bytes,
            'final_retained_bytes': {'old_store': retained_bytes(old_store), 'bend2_db': db.stat().st_size},
            'final_counts': final_counts, 'startup': startup, 'replay': replay, 'memory': memory,
            'summary': summary, 'samples': samples,
            'host_before': host_before, 'host_after': host_observation(),
            'old_dependencies': old_dependencies,
        }
        output = run / 'results.json'
        output.write_text(json.dumps(report, indent=2) + '\n')
        print(output)
        print('operation\told IPC p50 ms\told durable p50 ms\tbend2 process p50 ms')
        for operation, systems in sorted(summary.items()):
            print(f"{operation}\t{systems['old']['wall_ms']['p50']:.3f}\t"
                  f"{systems['old']['durable_ms']['p50']:.3f}\t{systems['bend2']['wall_ms']['p50']:.3f}")
    finally:
        if old is not None:
            old.close()


if __name__ == '__main__':
    main()
