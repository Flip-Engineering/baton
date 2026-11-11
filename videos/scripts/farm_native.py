#!/usr/bin/env python3
"""Studio helper for the optional native backend recipe (farm-adapter owner).

  python3 videos/scripts/farm_native.py post --scene S --end SEC --commit SHA --by NAME --id ID --job-doc JOB.json --assigned-doc ASSIGNED.json --backend-doc BACKEND.json [--retry-of ID] [--piece P]
  python3 videos/scripts/farm_native.py next --backend BACKEND.json --by NAME

post is disabled until the real backend and qualification gates are complete.
The recipe builder and immutable staging helpers can be tested independently
without posting any farm job. There is no command-line override for this gate.

next prints the oldest open native-backend job this backend digest may claim:
jobs already held for the same backend digest are skipped (their hold lineage
is in job history via `touch --note`), so a held job never spins through
re-admission while unrelated admitted work advances. The caller then claims
that exact id with `farm.py claim ID --by NAME`. Existing Chromium jobs,
controllers and pins are untouched: native jobs are opt-in per post.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
NATIVE = os.path.join(REPO, 'videos', 'web', 'native')
RECIPE = os.path.join(NATIVE, 'recipe.mjs')
FARM = os.path.join(HERE, 'farm.py')
BACKEND_ID = 'fframes-native/v1'
NODE_DIGEST = ("import {readFile} from 'node:fs/promises';"
               "import {digest} from '%s/contract.mjs';"
               "process.stdout.write(digest(JSON.parse(await readFile(process.argv[1], 'utf8'))))" % NATIVE)


def recipe_json(args):
    cmd = ['node', RECIPE, '--id', args.id, '--scene', args.scene, '--end', str(args.end)]
    if args.retry_of:
        cmd += ['--retry-of', args.retry_of]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO)
    if r.returncode:
        sys.exit('farm_native: recipe failed: %s' % (r.stderr.strip() or r.stdout.strip()))
    return json.loads(r.stdout)


def canonical_digest(path):
    """The lead contract digest (canonical JSON), identical to the worker's
    verdict digests — never the raw file bytes."""
    r = subprocess.run(['node', '--input-type=module', '-e', NODE_DIGEST, '--', path],
                       capture_output=True, text=True, cwd=REPO)
    if r.returncode or not re.fullmatch(r'[a-f0-9]{64}', r.stdout.strip()):
        sys.exit('farm_native: cannot digest %s: %s' % (path, (r.stderr.strip() or r.stdout.strip())[:200]))
    return r.stdout.strip()


ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\Z')
SHA40_RE = re.compile(r'^[a-f0-9]{40}\Z')


def check_post_binding(args):
    """Bind queue pin to staged identities BEFORE staging or posting: the out
    id must equal job.jobId, the queue commit must equal job.source.commit,
    and the assigned doc must be canonically identical to the job doc."""
    if not ID_RE.match(args.id):
        sys.exit('farm_native: refusing unsafe --id %r' % args.id)
    try:
        job = json.load(open(args.job_doc, encoding='utf-8'))
        assigned = json.load(open(args.assigned_doc, encoding='utf-8'))
        backend = json.load(open(args.backend_doc, encoding='utf-8'))
    except (OSError, ValueError) as e:
        sys.exit('farm_native: cannot read staged docs: %s' % e)
    if job.get('jobId') != args.id:
        sys.exit('farm_native: job.jobId %r != --id %r' % (job.get('jobId'), args.id))
    if not SHA40_RE.match(job.get('source', {}).get('commit', '') or ''):
        sys.exit('farm_native: job.source.commit is not an exact Git SHA')
    if job.get('source', {}).get('commit') != args.commit:
        sys.exit('farm_native: job.source.commit != --commit queue pin')
    for key in ('schema', 'id'):
        if backend.get(key) in (None, ''):
            sys.exit('farm_native: backend doc missing %s' % key)
    return job, assigned, backend


def stage_docs(args, job, assigned, backend):
    """Reserve a fresh ID exclusively and write the already-checked snapshots.
    Never reread mutable source files after binding their job/pin identities.
    A failed partial staging retains its ID for inspection; it cannot be reused.
    This helper does not post or claim a farm job."""
    if not ID_RE.fullmatch(args.id) or job.get('jobId') != args.id:
        sys.exit('farm_native: staged ID must safely match job.jobId')
    out = os.path.join(REPO, 'videos', 'out', 'native', args.id)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    try:
        os.mkdir(out, mode=0o700)
    except FileExistsError:
        sys.exit('farm_native: refusing existing immutable staging ID %s' % out)
    staged = {}
    for name, document in (('job', job), ('assigned', assigned), ('backend', backend)):
        dst = os.path.join(out, '%s.json' % name)
        with open(dst, 'x', encoding='utf-8') as stream:
            json.dump(document, stream, allow_nan=False)
        staged[name] = dst
    if canonical_digest(staged['assigned']) != canonical_digest(staged['job']):
        sys.exit('farm_native: assigned doc differs from job doc (assignment must be immutable)')
    return canonical_digest(staged['job']), canonical_digest(staged['backend'])


def backend_sha(path):
    return canonical_digest(path)


def open_ids():
    r = subprocess.run([sys.executable, FARM, 'list', '--state', 'open'],
                       capture_output=True, text=True, cwd=REPO)
    if r.returncode:
        sys.exit('farm_native: list failed: %s' % (r.stderr.strip() or r.stdout.strip())[:300])
    return [l.split()[0] for l in r.stdout.splitlines() if l.split() and ID_RE.match(l.split()[0])]


def show(job_id):
    r = subprocess.run([sys.executable, FARM, 'show', job_id], capture_output=True, text=True, cwd=REPO)
    if r.returncode:
        return None
    try:
        return json.loads(r.stdout)
    except ValueError:
        return None


def pick_next(jobs, backend_id=BACKEND_ID, backend_sha=''):
    """Pure selection: oldest open native job not held for this backend digest."""
    for job in jobs:
        if not job or job.get('state') != 'open':
            continue
        if ('backend: %s' % backend_id) not in (job.get('notes') or ''):
            continue
        held = any(isinstance(h.get('event'), str) and ('backend %s' % backend_sha) in h['event']
                   for h in job.get('history') or [])
        if held:
            continue
        return job.get('id')
    return None


def next_job(backend_path):
    sha = backend_sha(backend_path)
    jobs = []
    for i in open_ids():
        j = show(i)
        if j:
            jobs.append(j)
    found = pick_next(jobs, BACKEND_ID, sha)
    if not found:
        print('farm_native: no admissible native job')
        return 3
    print(found)
    return 0


def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('post')
    p.add_argument('--scene', required=True)
    p.add_argument('--end', type=float, required=True)
    p.add_argument('--commit', required=True, help='full 40-char pipeline SHA (the job pin)')
    p.add_argument('--by', required=True)
    p.add_argument('--id', required=True, help='stable native job/out id')
    p.add_argument('--retry-of', default='')
    p.add_argument('--piece', default='')
    p.add_argument('--job-doc', required=True, help='immutable prepared-render job document to stage')
    p.add_argument('--assigned-doc', required=True, help='immutable assigned contract (must equal the job doc)')
    p.add_argument('--backend-doc', required=True, help='backend descriptor whose digest gates hold skipping')
    n = sub.add_parser('next')
    n.add_argument('--backend', required=True, help='backend descriptor file (digest gates hold skipping)')
    n.add_argument('--by', required=True)
    a = ap.parse_args(argv)
    if a.cmd == 'next':
        sys.exit(next_job(a.backend))
    sys.exit('farm_native: native recipe is disabled-pending-canary (CLI wiring, audio finish, trusted admission and qualification required)')


if __name__ == '__main__':
    main(sys.argv[1:])
