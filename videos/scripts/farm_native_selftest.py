#!/usr/bin/env python3
"""Self-test for farm_native.py queue plumbing (farm-adapter owner). No farm
network, no GPU: exercises post binding checks, the disabled gate, doc
staging digests, and hold-skipping selection with fixtures.

  python3 videos/scripts/farm_native_selftest.py [--keep]
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import farm_native as fn

COMMIT = 'b' * 40
failures = []


def check(name, cond, detail=''):
    print(('ok' if cond else 'FAIL'), '-', name, detail)
    if not cond:
        failures.append(name)


def docs(tmp, job_id='n1', commit=COMMIT, assigned_differs=False, backend_ok=True, tag=''):
    import shutil
    case = os.path.join(tmp, 'case%s' % tag)
    shutil.rmtree(case, ignore_errors=True)
    os.makedirs(case)
    base = {'path': 'x.bin', 'sha256': '0' * 64, 'bytes': 1}
    job = {'schema': 'acp.prepared-render/v1', 'jobId': job_id,
           'source': {'commit': commit, 'closure': dict(base)},
           'runtime': dict(base), 'inputs': dict(base),
           'prepared': dict(base, schema='s'), 'simulation': dict(base, schema='t')}
    assigned = dict(job) if not assigned_differs else dict(job, jobId='other')
    backend = {'schema': 'acp.backend-capabilities/v1', 'id': 'fframes-native/v1'} if backend_ok else {'id': 'x'}
    paths = {}
    for name, doc in (('job', job), ('assigned', assigned), ('backend', backend)):
        p = os.path.join(case, '%s.json' % name)
        json.dump(doc, open(p, 'w'))
        paths[name] = p
    return paths


def run_post(args):
    return subprocess.run([sys.executable, os.path.join(HERE, 'farm_native.py'), 'post'] + args,
                          capture_output=True, text=True, cwd=REPO)


tmp = tempfile.mkdtemp(prefix='farm-native-selftest-')
try:
    p = docs(tmp)
    base = ['--scene', 'closer', '--end', '45', '--commit', COMMIT, '--by', 'studio', '--id', 'n1',
            '--job-doc', p['job'], '--assigned-doc', p['assigned'], '--backend-doc', p['backend']]

    r = run_post(base)
    check('post disabled', r.returncode != 0 and 'disabled-pending-canary' in (r.stdout + r.stderr))
    r = run_post(base + ['--force-unqualified-post'])
    check('no override can enable unqualified posting', r.returncode != 0 and 'unrecognized arguments' in r.stderr)

    class A:  # minimal namespace mirroring argparse output
        pass
    a = A()
    a.id, a.commit = 'n1', COMMIT
    a.job_doc, a.assigned_doc, a.backend_doc = p['job'], p['assigned'], p['backend']
    job, assigned, _backend = fn.check_post_binding(a)
    check('binding accepts exact identities', job['jobId'] == 'n1')

    a2 = A()
    a2.__dict__.update(a.__dict__)
    a2.id = '../x'
    try:
        fn.check_post_binding(a2)
        check('unsafe id refused', False)
    except SystemExit as e:
        check('unsafe id refused', 'unsafe' in str(e))

    p_bad = docs(tmp, job_id='other', tag='-bad')
    a3 = A()
    a3.__dict__.update(a.__dict__)
    a3.job_doc, a3.assigned_doc = p_bad['job'], p_bad['assigned']
    try:
        fn.check_post_binding(a3)
        check('jobId/--id mismatch refused', False)
    except SystemExit as e:
        check('jobId/--id mismatch refused', '--id' in str(e))

    a4 = A()
    a4.__dict__.update(a.__dict__)
    a4.commit = 'c' * 40
    try:
        fn.check_post_binding(a4)
        check('commit pin mismatch refused', False)
    except SystemExit as e:
        check('commit pin mismatch refused', 'queue pin' in str(e))

    a5 = A()
    a5.__dict__.update(a.__dict__)
    fn.REPO = os.path.join(tmp, 'isolated-staging')
    # Changing the input file after binding must not change the staged snapshot.
    with open(a5.job_doc, 'w') as stream:
        json.dump({'jobId': 'substituted'}, stream)
    js, bs = fn.stage_docs(a5, job, assigned, _backend)
    check('staging binds canonical digests', len(js) == 64 and len(bs) == 64)
    with open(os.path.join(fn.REPO, 'videos', 'out', 'native', a5.id, 'job.json')) as stream:
        check('staging uses bound snapshot instead of changed input file', json.load(stream) == job)
    try:
        fn.stage_docs(a5, job, assigned, _backend)
        check('restaging same id refused', False)
    except SystemExit as e:
        check('restaging same id refused', 'immutable' in str(e))

    jobs = [
        {'id': 'b', 'state': 'open', 'notes': 'backend: fframes-native/v1',
         'history': [{'event': 'backend-hold fframes-native/v1 backend SHAX attempt 1: x'}]},
        {'id': 'a', 'state': 'open', 'notes': 'plain chromium', 'history': []},
        {'id': 'c', 'state': 'open', 'notes': 'backend: fframes-native/v1', 'history': []},
        {'id': 'd', 'state': 'claimed', 'notes': 'backend: fframes-native/v1', 'history': []},
    ]
    check('picker skips held digest, advances unrelated', fn.pick_next(jobs, 'fframes-native/v1', 'SHAX') == 'c')
    check('picker retries held job under a new backend', fn.pick_next(jobs, 'fframes-native/v1', 'OTHER') == 'b')
    check('picker empty when nothing admissible', fn.pick_next([], 'fframes-native/v1', 'SHAX') is None)
finally:
    if '--keep' not in sys.argv:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)

print('FAILURES:', failures if failures else 'none')
sys.exit(1 if failures else 0)
