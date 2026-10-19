#!/usr/bin/env python3
"""Run every native Python suite and Node group in four isolated workers."""
import concurrent.futures
import datetime
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback

ROOT = pathlib.Path(__file__).resolve().parents[2]


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def copy_tree(source, destination, log):
    destination.mkdir()
    argv = ['cp', '-a', '--reflink=auto', str(source) + '/.', str(destination)]
    result = subprocess.run(argv, stdout=log, stderr=log) if sys.platform.startswith('linux') else None
    if result is None or result.returncode:
        # Both attempts retain their output. A failed ordinary copy fails this suite.
        if result is not None:
            log.write(('Reflink copy exited ' + str(result.returncode) + '; running cp -a.\n').encode())
            log.flush()
        subprocess.run(['cp', '-a', str(source) + '/.', str(destination)],
                       stdout=log, stderr=log, check=True)


def cleanup_successful_run(work, ipc, successful):
    """Remove only this run's copies after every test child has exited cleanly."""
    if not successful:
        return False
    shutil.rmtree(work)
    shutil.rmtree(ipc)
    return True


def process_group_exists(process_group):
    """Return whether a suite process group still has members after its leader exits."""
    try:
        os.killpg(process_group, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def main():
    work = pathlib.Path(tempfile.mkdtemp(prefix='native-suites-', dir=ROOT / '.scratch'))
    ipc = pathlib.Path(tempfile.mkdtemp(prefix='b2-native-'))
    run = os.environ.get('BATON2_LINUX_RUN')
    output = ((pathlib.Path(run) / 'evidence/native-suites') if run else
              pathlib.Path(tempfile.mkdtemp(prefix='native-suites-results-',
                                            dir=ROOT / '.scratch/bend2')))
    output.mkdir(parents=True, exist_ok=True)
    seed = work / 'seed'
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    with (output / 'prepare.log').open('wb') as log:
        subprocess.run(['git', 'clone', '--no-hardlinks', '--no-checkout', '--', str(ROOT), str(seed)],
                       stdout=log, stderr=log, check=True)
        subprocess.run(['git', '-C', str(seed), 'checkout', '--detach', commit],
                       stdout=log, stderr=log, check=True)
    # Include the current worktree bytes when the script is used before a commit.
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).split(b'\0')
    extra = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'],
                                    cwd=ROOT).split(b'\0')
    for name in dict.fromkeys(tracked + extra):
        if not name:
            continue
        relative = os.fsdecode(name)
        source, destination = ROOT / relative, seed / relative
        if destination.exists() or destination.is_symlink():
            destination.unlink()
        if not source.exists() and not source.is_symlink():
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source.is_symlink():
            destination.symlink_to(os.readlink(source))
        else:
            shutil.copy2(source, destination)
    for dependency in ('.bend', 'node_modules'):
        if (ROOT / dependency).exists() and not (seed / dependency).exists():
            (seed / dependency).symlink_to((ROOT / dependency).resolve(), target_is_directory=True)
    scratch = seed / '.scratch/bend2'
    scratch.mkdir(parents=True)
    for name in ('baton2', 'process-test', 'process-test.c', 'instance-test', 'git-test', 'land-test'):
        shutil.copy2(ROOT / '.scratch/bend2' / name, scratch / name)
    python = sys.argv[1]
    # The real delegated cgroup test requires a privileged systemd scope and
    # refuses without it; it is run separately by the operator.
    privileged = {'cgroup-confinement-real.py'}
    queue = [{'label': path.name, 'argv': [python, 'bend2/test/' + path.name]}
             for path in sorted((seed / 'bend2/test').glob('*.py'))
             if path.name not in privileged]
    queue.extend([
        {'label': 'node-git-series', 'argv': ['node', '--test', 'bend2/test/git-series.mjs']},
        {'label': 'node-api-key-exec', 'argv': ['node', '--test', 'bend2/test/api-key-exec.test.mjs']},
        {'label': 'node-provider-availability', 'argv': ['node', '--test', 'bend2/test/provider-availability.mjs']},
        {'label': 'node-context-runtime', 'argv': ['node', '--test',
            'bend2/test/context-provider.test.mjs', 'bend2/test/context-project-policy.test.mjs',
            'bend2/test/ui-orchestra-server.test.mjs',
            *[str(path.relative_to(seed)) for path in sorted((seed / 'bend2/tests/context-models').glob('*.test.mjs'))],
            *[str(path.relative_to(seed)) for path in sorted((seed / 'bend2/tests/runtime').glob('*.test.mjs'))]]},
    ])
    write(output / 'queue.json', {'source': str(ROOT), 'commit': commit, 'work': str(work),
                                 'runtime_root': str(ipc), 'concurrency': 4, 'suites': queue})
    lock = threading.Lock()
    results = []

    def run_suite(item):
        index, spec = item
        directory = work / str(index)
        directory.mkdir(mode=0o700)
        runtime = ipc / str(index)
        runtime.mkdir(mode=0o700)
        evidence = output / spec['label']
        evidence.mkdir()
        source = directory / 'source'
        started = time.monotonic()
        row = {'label': spec['label'], 'argv': spec['argv'], 'cwd': str(source),
               'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'stdout': str(evidence / 'stdout'), 'stderr': str(evidence / 'stderr')}
        try:
            with (evidence / 'prepare.log').open('wb') as log:
                copy_tree(seed, source, log)
            for name in ('tmp', 'runtime'):
                (runtime / name).mkdir(mode=0o700)
            native_evidence = evidence / 'native-context'
            native_evidence.mkdir(mode=0o700)
            environment = dict(os.environ, TMPDIR=str(runtime / 'tmp'),
                               XDG_RUNTIME_DIR=str(runtime / 'runtime'),
                               FINAL_NATIVE_CONTEXT_EVIDENCE=str(native_evidence))
            # The inherited Python shim records each selected suite in its original output directory.
            with (evidence / 'stdout').open('wb') as stdout, (evidence / 'stderr').open('wb') as stderr:
                child = subprocess.Popen(spec['argv'], cwd=source, env=environment,
                                         stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                         start_new_session=True)
                row.update(pid=child.pid, native_evidence=str(native_evidence))
                write(evidence / 'execution.json', row)
                with lock:
                    print(json.dumps({'started': spec['label'], 'pid': child.pid,
                                      'evidence': str(evidence)}), flush=True)
                child_code = child.wait()
                has_remaining_processes = process_group_exists(child.pid)
                row.update(exit_code=1 if has_remaining_processes else child_code,
                           child_exit_code=child_code,
                           natural_wait_completed=True,
                           process_group_empty=not has_remaining_processes)
        except Exception:
            with (evidence / 'stderr').open('ab') as stderr:
                stderr.write(traceback.format_exc().encode())
            row.update(exit_code=1, preparation_or_wait_error=True)
        row.update(elapsed_seconds=time.monotonic() - started,
                   completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
        write(evidence / 'execution.json', row)
        with lock:
            results.append(row)
            write(output / 'results.json', results)
            print(json.dumps({'completed': spec['label'], 'exit_code': row['exit_code'],
                              'elapsed_seconds': row['elapsed_seconds'], 'evidence': str(evidence)}), flush=True)
        return row['exit_code']

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(run_suite, enumerate(queue)))
    cleaned = cleanup_successful_run(work, ipc, not any(codes))
    if not cleaned:
        print(json.dumps({'preserved_work': str(work), 'preserved_runtime_root': str(ipc),
                          'reason': 'one or more suites failed; retain isolated trees for review'}),
              flush=True)
    print(json.dumps({'suites': len(codes), 'failures': sum(code != 0 for code in codes),
                      'results': str(output / 'results.json'), 'work': str(work),
                      'scratch_cleanup': 'removed' if cleaned else 'preserved'}), flush=True)
    return int(any(code != 0 for code in codes))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: check-native-parallel.py PYTHON3')
    raise SystemExit(main())
