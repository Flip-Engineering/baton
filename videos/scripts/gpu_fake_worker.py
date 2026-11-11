#!/usr/bin/env python3
"""A minimal farm worker for GPU jobs: the test double for the homelab worker, and a reference for its harness extension
(FARMGPU, 3 Oct 2026; research/capabilities/farm_gpu.md). It is NOT the homelab worker and is never pointed at the real queue
by the studio: tests run it against local bare repos through PIPE_URL / ARCH_URL (farm.py's overrides).

  PIPE_URL=file:///.../pipe.git ARCH_URL=file:///.../arch.git FARM_CACHE=/tmp/x \\
    python3 videos/scripts/gpu_fake_worker.py --by fake-gpu [--once] [--gpu-uuids GPU-a,GPU-b] [--require-gpu] [--work DIR]

Each round: farm.py claim; accept the job only if gpu_job_argv() (below: the exact allowlist rule the homelab harness adds)
says so, else farm.py fail with the reason before any GPU is given out; allocate --gpus cards from --gpu-uuids; check out
the job's pipeline_commit into a fresh folder; run the argv WITHOUT a shell, with GPU_JOB_ID and CUDA_VISIBLE_DEVICES set;
renew the lease while it runs; deliver every file in videos/out/gpu/<id>/deliver/, or fail with the `GPU_JOB FAILED` line.
"""
import argparse, json, os, re, shlex, shutil, subprocess, sys, tempfile, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
FARM = os.path.join(HERE, 'farm.py')
SCRIPT = {'blender': re.compile(r'videos/blender/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.py'),
          'python': re.compile(r'videos/gpu/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.py')}


def gpu_job_argv(job, max_gpus=2):
    """THE ALLOWLIST RULE (copy into the worker harness): (argv, gpus) for an acceptable GPU job, or (None, reason).
    One run line; shlex-split; exactly `sh videos/scripts/gpu_job.sh blender|python SCRIPT ...` with SCRIPT a plain .py path
    under videos/blender/ or videos/gpu/ (no '..', no absolute path); `--id` naming this job; --gpus within the worker's cards;
    no NUL/CR/LF anywhere. The argv is then executed without a shell, from the checkout of job['pipeline_commit']."""
    run = job.get('run') or []
    if len(run) != 1:
        return None, 'a GPU job has exactly one run line'
    try:
        argv = shlex.split(run[0])
    except ValueError as e:
        return None, 'run line does not parse: %s' % e
    if any(c in x for x in argv for c in '\0\r\n'):
        return None, 'control characters in the run line'
    if len(argv) < 4 or argv[:2] != ['sh', 'videos/scripts/gpu_job.sh'] or argv[2] not in SCRIPT:
        return None, 'not a gpu_job.sh blender|python command'
    if not SCRIPT[argv[2]].fullmatch(argv[3]):
        return None, 'script %r is not a plain .py path under %s' % (argv[3], 'videos/blender/' if argv[2] == 'blender' else 'videos/gpu/')
    head = argv[4:argv.index('--')] if '--' in argv else argv[4:]
    if '--id' not in head or head.index('--id') + 1 >= len(head) or head[head.index('--id') + 1] != job['id']:
        return None, '--id must name this job (%s)' % job['id']
    gpus = 1
    if '--gpus' in head:
        try:
            gpus = int(head[head.index('--gpus') + 1])
        except (ValueError, IndexError):
            return None, '--gpus is not a number'
    if not 1 <= gpus <= max_gpus:
        return None, '--gpus %d: this worker gives 1-%d cards a job' % (gpus, max_gpus)
    return argv, gpus


def farm(*a, check=True):
    r = subprocess.run([sys.executable, FARM] + list(a), capture_output=True, text=True)
    if check and r.returncode:
        raise RuntimeError('farm.py %s: %s' % (a[0], (r.stderr or r.stdout).strip()[-400:]))
    return r


def one(a):
    r = farm('claim', '--by', a.by, check=False)
    if r.returncode == 3:
        return False
    if r.returncode:
        print('fake worker: claim failed: %s' % (r.stderr or r.stdout).strip()[-300:], flush=True)
        return False
    lines = r.stdout.strip().splitlines()
    jid, spec = lines[0].strip(), json.loads('\n'.join(lines[1:]))
    job = dict(spec, id=jid)
    argv, gpus = gpu_job_argv(job, a.max_gpus)
    print('fake worker: claimed %s: %s' % (jid, ' '.join(job['run'])), flush=True)
    if argv is None:
        farm('fail', jid, '--by', a.by, '--why', 'unsupported recipe (before any GPU was allocated): %s' % gpus)
        print('fake worker: refused %s: %s' % (jid, gpus), flush=True)
        return True
    uuids = [u for u in a.gpu_uuids.split(',') if u]
    if uuids and gpus > len(uuids):
        farm('fail', jid, '--by', a.by, '--why', 'asks for %d GPUs; this worker has %d' % (gpus, len(uuids)))
        return True
    work = os.path.join(a.work, jid)
    shutil.rmtree(work, ignore_errors=True)
    t0 = time.time()
    for cmd in (['git', 'clone', '-q', '--no-checkout', os.environ.get('PIPE_URL'), work],
                ['git', '-C', work, 'checkout', '-q', '--detach', spec['pipeline_commit']]):
        c = subprocess.run(cmd, capture_output=True, text=True)
        if c.returncode:
            farm('fail', jid, '--by', a.by, '--why', 'checkout failed: %s' % c.stderr.strip()[-300:])
            return True
    env = dict(os.environ, GPU_JOB_ID=jid)
    if uuids:
        env['CUDA_VISIBLE_DEVICES'] = ','.join(uuids[:gpus])
    if a.require_gpu:
        env['GPU_JOB_REQUIRE_GPU'] = '1'
    stop = threading.Event()

    def renew():
        while not stop.wait(a.touch_every):
            farm('touch', jid, '--by', a.by, '--note', 'gpu job running %.0f s' % (time.time() - t0), check=False)
    threading.Thread(target=renew, daemon=True).start()
    p = subprocess.run(argv, cwd=work, env=env, capture_output=True, text=True)          # no shell
    stop.set()
    out = (p.stdout or '') + (p.stderr or '')
    with open(os.path.join(a.work, jid + '.log'), 'w') as f:
        f.write(out)
    last = [l for l in out.splitlines() if l.startswith('GPU_JOB ')]
    deliver = os.path.join(work, 'videos', 'out', 'gpu', jid, 'deliver')
    if p.returncode == 0 and os.path.isdir(deliver):
        files = [os.path.join(deliver, f) for f in sorted(os.listdir(deliver)) if os.path.isfile(os.path.join(deliver, f))]
        farm('deliver', jid, '--by', a.by, *files, '--note', (last[-1] if last else 'ok')[:300])
        print('fake worker: delivered %s (%d files, %.0f s)' % (jid, len(files), time.time() - t0), flush=True)
    else:
        why = (last[-1] if last else 'exit %d' % p.returncode) + ' | ' + ' / '.join(out.strip().splitlines()[-5:])
        farm('fail', jid, '--by', a.by, '--why', why[-900:])
        print('fake worker: failed %s: %s' % (jid, why[:300]), flush=True)
    if not a.keep:
        shutil.rmtree(work, ignore_errors=True)
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--by', default='fake-gpu'); ap.add_argument('--once', action='store_true')
    ap.add_argument('--gpu-uuids', default=''); ap.add_argument('--max-gpus', type=int, default=2)
    ap.add_argument('--require-gpu', action='store_true'); ap.add_argument('--work', default='')
    ap.add_argument('--poll', type=float, default=10); ap.add_argument('--touch-every', type=float, default=1800)
    ap.add_argument('--keep', action='store_true'); ap.add_argument('--rounds', type=int, default=0)
    a = ap.parse_args()
    if not os.environ.get('PIPE_URL') or 'github.com' in os.environ.get('PIPE_URL', '') + os.environ.get('ARCH_URL', ''):
        sys.exit('fake worker: set PIPE_URL and ARCH_URL to test repos (never the real queue)')
    a.work = a.work or tempfile.mkdtemp(prefix='gpu_fake_worker_')
    n = 0
    while True:
        did = one(a)
        n += 1
        if a.once or (a.rounds and n >= a.rounds):
            break
        if not did:
            time.sleep(a.poll)


if __name__ == '__main__':
    main()
