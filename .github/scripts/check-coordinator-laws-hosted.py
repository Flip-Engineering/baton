#!/usr/bin/env python3
"""Check the selected coordinator laws with the pinned Bend2 compiler."""
import argparse
import hashlib
import json
import os
import pathlib
import resource
import subprocess
import time


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip()


def source_identity(root, plan):
    actual = {'commit': git(root, 'rev-parse', 'HEAD'),
              'tree': git(root, 'rev-parse', 'HEAD^{tree}'),
              'changes': git(root, 'status', '--porcelain')}
    if actual != {'commit': plan['source_commit'], 'tree': plan['source_tree'], 'changes': ''}:
        raise RuntimeError('The selected source differs from the frozen commit and tree.')
    return actual


def compiler_identity(root, bun):
    provenance = json.loads((root.parent / 'repl-upstream.provenance.json').read_text())
    files = []
    for entry in provenance['files']:
        path = root / entry['path']
        actual = {'path': entry['path'], 'bytes': path.stat().st_size, 'sha256': digest(path)}
        if actual != entry:
            raise RuntimeError('Compiler source changed: ' + entry['path'])
        files.append(actual)
    expected = '9fd36f87e4b90b07632b987a2e4ec81ca15a62c81bf983190cea6d715be2ad74'
    if digest(bun) != expected:
        raise RuntimeError('The Bun binary differs from the pinned build.')
    return {'files': files, 'bun_sha256': expected, 'bun_bytes': bun.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, required=True)
    parser.add_argument('--bun', type=pathlib.Path, required=True)
    parser.add_argument('--evidence', type=pathlib.Path, required=True)
    args = parser.parse_args()
    here = pathlib.Path(__file__).resolve().parent
    plan_path = here / 'coordinator-laws-hosted-plan.json'
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes)
    source = args.source.resolve()
    bun = args.bun.resolve()
    compiler = here.parent.parent / 'bend2/compiler/upstream'
    evidence = args.evidence.resolve()
    evidence.mkdir(mode=0o700)
    result = {'plan_sha256': hashlib.sha256(plan_bytes).hexdigest(),
              'driver_commit': git(here, 'rev-parse', 'HEAD'), 'status': 'preflight'}
    write(evidence / 'result.json', result)
    try:
        result['source_before'] = source_identity(source, plan)
        result['compiler_before'] = compiler_identity(compiler, bun)
        result['host'] = {'uname': list(os.uname()), 'meminfo': pathlib.Path('/proc/meminfo').read_text(),
                          'stack_limits': list(resource.getrlimit(resource.RLIMIT_STACK))}
        resource.setrlimit(resource.RLIMIT_STACK, (resource.RLIM_INFINITY, resource.RLIM_INFINITY))
        result['host']['effective_stack_limits'] = list(resource.getrlimit(resource.RLIMIT_STACK))
        home = evidence / 'home'
        home.mkdir(mode=0o700)
        env = {'HOME': str(home), 'PATH': os.environ['PATH'], 'LANG': 'C.UTF-8',
               'BEND_NO_TELEMETRY': '1', 'BUN_JSC_maxPerThreadStackUsage': '67108864'}
        argv = [str(bun), '--smol', str(compiler / 'main.ts'),
                'bend2/src/coordinator/laws.bend', '--check-only']
        result.update(argv=argv, cwd=str(source), environment=env, started=time.time())
        with (evidence / 'check.stdout').open('xb') as stdout, (evidence / 'check.stderr').open('xb') as stderr:
            child = subprocess.Popen(argv, cwd=source, env=env, stdout=stdout, stderr=stderr)
            try:
                result.update(pid=child.pid, status='running')
                write(evidence / 'result.json', result)
            finally:
                while True:
                    try:
                        waited_pid, raw_status, usage = os.wait4(child.pid, 0)
                        break
                    except InterruptedError:
                        continue
                child.returncode = os.waitstatus_to_exitcode(raw_status)
                result.update(waited_pid=waited_pid, raw_wait_status=raw_status,
                              returncode=child.returncode, elapsed_seconds=time.time() - result['started'],
                              max_rss_kib=usage.ru_maxrss, status='completed')
                write(evidence / 'result.json', result)
        result['streams'] = {name: {'bytes': (evidence / name).stat().st_size,
                                    'sha256': digest(evidence / name)}
                             for name in ('check.stdout', 'check.stderr')}
        result['source_after'] = source_identity(source, plan)
        result['compiler_after'] = compiler_identity(compiler, bun)
        if plan_path.read_bytes() != plan_bytes:
            raise RuntimeError('The qualification plan changed during the check.')
        result['qualified'] = waited_pid == child.pid and child.returncode == 0
        write(evidence / 'result.json', result)
        print(json.dumps({key: result[key] for key in ('status', 'returncode', 'elapsed_seconds',
                                                      'max_rss_kib', 'qualified')}))
        return 0 if result['qualified'] else 1
    except Exception as error:
        result.update(qualified=False, error=repr(error))
        write(evidence / 'result.json', result)
        raise


if __name__ == '__main__':
    raise SystemExit(main())
