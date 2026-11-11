#!/usr/bin/env python3
"""Self-test of the farm's GPU job type (FARMGPU, 3 Oct 2026; research/capabilities/farm_gpu.md). Never touches the real queue.

  python3 videos/scripts/gpu_job_selftest.py            gpu_job.sh itself: refusals, limits, outputs, receipts, a fake
                                                        nvidia-smi (two V100s) for GPU allocation and --per-gpu, Blender stills
  python3 videos/scripts/gpu_job_selftest.py --e2e      also the whole loop on local bare repos (PIPE_URL / ARCH_URL): farm.py gpu
                                                        and farm_gpu.py post, gpu_fake_worker.py claims, runs, delivers, the studio
                                                        fetches; a refused recipe; a branch that moved under farm_gpu.py's push
Needs: Blender (GPU_JOB_BLENDER) and the venv (gpu_job.sh setup-venv; GPU_JOB_TORCH_INDEX=.../whl/cpu on a CPU machine).
Without an NVIDIA card Blender cases run with --device cpu. Out folders are removed afterwards (--keep keeps them).
"""
import json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
TS = time.strftime('%H%M%S')
FAKE_SMI = r'''#!/usr/bin/env python3
import sys
G = [('0', 'GPU-aaaaaaaa-0000-4000-8000-000000000000', 'Tesla V100-SXM2-32GB', '575.57.08', '32768', '7.0', '00000000:1A:00.0'),
     ('1', 'GPU-bbbbbbbb-0000-4000-8000-000000000001', 'Tesla V100-SXM2-32GB', '575.57.08', '32768', '7.0', '00000000:1B:00.0')]
q = [a for a in sys.argv if a.startswith('--query-gpu=')]
if not q:
    print('fake nvidia-smi'); sys.exit(0)
for g in G:
    d = {'index': g[0], 'uuid': g[1], 'name': g[2], 'driver_version': g[3], 'memory.total': g[4], 'compute_cap': g[5],
         'pci.bus_id': g[6], 'memory.used': '1234', 'utilization.gpu': '42', 'temperature.gpu': '55'}
    print(', '.join(d[f] for f in q[0].split('=', 1)[1].split(',')))
'''
U0, U1 = 'GPU-aaaaaaaa-0000-4000-8000-000000000000', 'GPU-bbbbbbbb-0000-4000-8000-000000000001'
results, made = [], []


def run(argv, env=None, cwd=REPO, timeout=900):
    e = dict(os.environ, GPU_JOB_ALLOW_UNTRACKED='1', GPU_JOB_NICE='15')
    for k in ('GPU_JOB_ID', 'GPU_JOB_REQUIRE_GPU', 'CUDA_VISIBLE_DEVICES'):
        e.pop(k, None)
    e.update(env or {})
    for k, v in list(e.items()):
        if v is None:
            e.pop(k)
    t0 = time.time()
    p = subprocess.run(['sh', 'videos/scripts/gpu_job.sh'] + argv, cwd=cwd, env=e, capture_output=True, text=True, timeout=timeout)
    return p.returncode, p.stdout + p.stderr, time.time() - t0


def receipt(jid):
    try:
        return json.load(open(os.path.join(REPO, 'videos/out/gpu', jid, 'deliver', 'receipt.json')))
    except (OSError, ValueError):
        return {}


def case(name, argv, want, env=None, check=None):
    jid = 'selftest-%s-%s' % (name, TS)
    if '--id' not in argv:
        argv = argv[:2] + ['--id', jid] + argv[2:] if len(argv) >= 2 else argv
    made.append(jid)
    code, out, dt = run(argv, env)
    last = [l for l in out.splitlines() if l.startswith('GPU_JOB')]
    ok = code == want
    note = ''
    if ok and check:
        try:
            note = check(receipt(jid), out) or ''
        except AssertionError as e:
            ok, note = False, 'check: %s' % e
    tail = last[-1] if last else (out.strip().splitlines() or [''])[-1]
    results.append((name, ok, code, want, round(dt, 1), tail[:150], note))
    print('%-22s %s exit %s (want %s) %.1fs  %s %s' % (name, 'PASS' if ok else 'FAIL', code, want, dt, results[-1][5], note), flush=True)
    if not ok:
        print(out[-1500:])


def main():
    keep, e2e_too = '--keep' in sys.argv, '--e2e' in sys.argv
    tmp = tempfile.mkdtemp(prefix='gpujob_selftest_')
    fake_bin = os.path.join(tmp, 'bin'); os.makedirs(fake_bin)
    open(os.path.join(fake_bin, 'nvidia-smi'), 'w').write(FAKE_SMI); os.chmod(os.path.join(fake_bin, 'nvidia-smi'), 0o755)
    fake = {'PATH': fake_bin + ':' + os.environ['PATH']}
    has_gpu = shutil.which('nvidia-smi') is not None
    dev = [] if has_gpu else ['--device', 'cpu']
    py = ['python', 'videos/gpu/gpujob_selftest.py']
    link = os.path.join(REPO, 'videos/gpu/_selftest_link.py'); untracked = os.path.join(REPO, 'videos/gpu/_selftest_untracked.py')
    try:
        os.symlink('gpujob_selftest.py', link)
        open(untracked, 'w').write('print(1)\n')
        # ---- refusals: exit 2, before anything runs
        case('refuse-kind', ['ruby', 'videos/gpu/gpujob_selftest.py'], 2)
        case('refuse-dotdot', ['python', 'videos/gpu/../scripts/farm.py'], 2)
        case('refuse-absolute', ['python', os.path.join(REPO, 'videos/gpu/gpujob_selftest.py')], 2)
        case('refuse-cross', ['python', 'videos/blender/gpujob/smoke.py'], 2)
        case('refuse-outside', ['python', 'videos/scripts/farm.py'], 2)
        case('refuse-symlink', ['python', 'videos/gpu/_selftest_link.py'], 2)
        case('refuse-untracked', ['python', 'videos/gpu/_selftest_untracked.py'], 2, env={'GPU_JOB_ALLOW_UNTRACKED': None})
        case('refuse-option', py + ['--bogus', '1'], 2)
        case('refuse-gpus', py + ['--gpus', '3'], 2)
        case('refuse-time', py + ['--time', '999'], 2)
        case('refuse-id-mismatch', py + ['--id', 'one'], 2, env={'GPU_JOB_ID': 'two'})
        case('refuse-cpu-on-farm', ['blender', 'videos/blender/gpujob/smoke.py', '--device', 'cpu'], 2, env={'GPU_JOB_REQUIRE_GPU': '1'})
        # ---- GPUs (a fake nvidia-smi with two V100s; the script itself runs on the CPU)
        nosmi = os.path.join(tmp, 'nosmi'); os.makedirs(nosmi)          # a PATH with the tools gpu_job needs but no nvidia-smi
        for t in ('sh', 'python3', 'git', 'dirname', 'ldconfig'):
            if shutil.which(t):
                os.symlink(shutil.which(t), os.path.join(nosmi, t))
        case('require-gpu-none', py, 3, env={'GPU_JOB_REQUIRE_GPU': '1', 'PATH': nosmi})
        case('gpus-mismatch', py + ['--gpus', '2'], 3, env=dict(fake, GPU_JOB_REQUIRE_GPU='1', CUDA_VISIBLE_DEVICES=U0))

        def per_gpu(r, out):
            assert len(r['gpus']) == 2 and set(r['gpu_usage']) == {U0, U1}, r.get('gpus')
            names = {f['name'] for f in r['files']}
            assert names == {'shard_0.json', 'shard_1.json'}, names
            s = [json.load(open(os.path.join(REPO, 'videos/out/gpu', r['job'], 'deliver', n))) for n in sorted(names)]
            assert [x['CUDA_VISIBLE_DEVICES'] for x in s] == [U0, U1] and all(x['GPU_JOB_SHARDS'] == '2' for x in s), s
            assert r['logs'] == ['log_gpu0.txt', 'log_gpu1.txt'], r['logs']
            return 'two shards, one card each'
        case('per-gpu', py + ['--gpus', '2', '--per-gpu', '--', 'shard'], 0, env=dict(fake, GPU_JOB_REQUIRE_GPU='1', CUDA_VISIBLE_DEVICES=U0 + ',' + U1),
             check=per_gpu)
        # ---- outputs and failures
        def outputs(r, out):
            names = {f['name']: f['path'] for f in r['files']}
            assert names == {'a__b__deep.txt': 'a/b/deep.txt', 'top.txt': 'top.txt', 'out__receipt.json': 'receipt.json',
                             'env.json': 'env.json'}, names
            assert any('link.txt' in w for w in r['warnings']), r['warnings']
            env = json.load(open(os.path.join(REPO, 'videos/out/gpu', r['job'], 'deliver', 'env.json')))
            assert env['GPU_JOB_ID'] == r['job'] and env['VIRTUAL_ENV'] and env['PYTHONPATH'].endswith('videos/gpu'), env
            sys.path.insert(0, HERE)
            import farm                                             # the studio side rebuilds the tree from the receipt
            d = os.path.join(tmp, 'fetched'); shutil.copytree(os.path.join(REPO, 'videos/out/gpu', r['job'], 'deliver'), d)
            farm.gpu_tree(d)
            assert open(os.path.join(d, 'out', 'a', 'b', 'deep.txt')).read() == 'deep\n'
            assert json.load(open(os.path.join(d, 'receipt.json')))['job'] == r['job']           # ours stays on top
            assert json.load(open(os.path.join(d, 'out', 'receipt.json'))) == {'mine': True}      # the script's, in out/
            return 'flat names, symlink skipped, tree rebuilt'
        case('outputs', py + ['--', 'ok'], 0, check=outputs)
        case('script-fails', py + ['--', 'fail'], 4, check=lambda r, o: (assert_in('on purpose', r['reason']), r['status'])[1])
        case('time-limit', py + ['--time', '0.05', '--', 'sleep', '600'], 5, check=lambda r, o: assert_lt(r['seconds']['run'], 70))
        case('ram-limit', py + ['--mem', '0.25', '--', 'mem', '600'], 6)
        case('out-too-big', py + ['--', 'big', '2'], 7, env={'GPU_JOB_MAX_OUT_MB': '1'})
        case('id-reused', py + ['--id', 'selftest-outputs-%s' % TS, '--', 'ok'], 2)
        # ---- Blender
        sargs = ['--', '--scene', 'videos/blender/gpujob/selftest_scene.py', '--scene-args', '--size 1.5', '--still', 'a=1@Cam_A',
                 '--still', 'b=10@Cam_B', '--frames', '1-3', '--res', '48x32', '--samples', '2']

        def stills(r, out):
            names = sorted(f['name'] for f in r['files'])
            assert names == ['frames__0001.png', 'frames__0002.png', 'frames__0003.png', 'stills__a.png', 'stills__b.png',
                             'stills_report_0.json'], names
            rep = json.load(open(os.path.join(REPO, 'videos/out/gpu', r['job'], 'deliver', 'stills_report_0.json')))
            assert rep['resolution'] == [48, 32] and rep['samples'] == 2 and [i['camera'] for i in rep['images']][:2] == ['Cam_A', 'Cam_B']
            assert r['blender']['version'] and r['blender_devices'], r.get('blender')
            return 'Blender %s, device %s' % (r['blender']['version'], r['blender_devices'][0]['type'])
        case('blender-stills', ['blender', 'videos/blender/gpujob/stills.py'] + dev + sargs, 0, check=stills)

        def stills_shards(r, out):
            names = sorted(f['name'] for f in r['files'])
            assert 'stills_report_0.json' in names and 'stills_report_1.json' in names and len(names) == 7, names
            return 'items dealt over two processes'
        case('blender-per-gpu', ['blender', 'videos/blender/gpujob/stills.py', '--gpus', '2', '--per-gpu'] + dev + sargs, 0,
             env=dict(fake, CUDA_VISIBLE_DEVICES=U0 + ',' + U1), check=stills_shards)
        case('blender-no-camera', ['blender', 'videos/blender/gpujob/stills.py'] + dev +
             ['--', '--scene', 'videos/blender/gpujob/selftest_scene.py', '--still', 'x=1@Nope', '--res', '16x16', '--samples', '1'], 4,
             check=lambda r, o: assert_in('Nope', r['reason']))
    finally:
        for p in (link, untracked):
            if os.path.lexists(p):
                os.remove(p)
    if e2e_too:
        e2e(tmp, dev)
    if not keep:
        for j in made:
            shutil.rmtree(os.path.join(REPO, 'videos/out/gpu', j), ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)
    bad = [r for r in results if not r[1]]
    print('\n%d/%d passed%s' % (len(results) - len(bad), len(results), '' if not bad else '; FAILED: ' + ', '.join(r[0] for r in bad)))
    return 1 if bad else 0


def assert_in(a, b):
    assert a in (b or ''), '%r not in %r' % (a, b)
    return 'ok'


def assert_lt(a, b):
    assert a < b, '%s >= %s' % (a, b)
    return '%.0f s' % a


# ------------------------------------------------------------------ the whole loop on local bare repos
def sh(cmd, cwd=None, env=None, check=True, timeout=1800):
    p = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout, shell=isinstance(cmd, str))
    if check and p.returncode:
        raise RuntimeError('%s: %s' % (cmd if isinstance(cmd, str) else ' '.join(cmd), (p.stderr + p.stdout)[-1500:]))
    return p


def e2e(tmp, dev):
    """studio and a fake worker, each with its own farm cache, on bare repos made here from this working tree's files"""
    t0 = time.time()
    root = os.path.join(tmp, 'e2e'); os.makedirs(root)
    pipe, arch = os.path.join(root, 'pipe.git'), os.path.join(root, 'arch.git')
    env = dict(os.environ, PIPE_URL='file://' + pipe, ARCH_URL='file://' + arch, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t',
               GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t', GPU_JOB_NICE='15')
    for k in ('GPU_JOB_ALLOW_UNTRACKED', 'GPU_JOB_ID', 'CUDA_VISIBLE_DEVICES', 'GPU_JOB_REQUIRE_GPU'):
        env.pop(k, None)
    for b in (pipe, arch):
        sh(['git', 'init', '-q', '--bare', '-b', 'main', b])
    seed = os.path.join(root, 'seed'); sh(['git', 'init', '-q', '-b', 'main', seed])
    files = ['videos/scripts/' + f for f in ('farm.py', 'farm_bench.py', 'farm_gpu.py', 'gpu_job.sh', 'gpu_job.py', 'gpu_fake_worker.py')]
    files += ['videos/blender/gpujob/' + f for f in os.listdir(os.path.join(REPO, 'videos/blender/gpujob')) if f.endswith('.py')]
    files += ['videos/gpu/' + f for f in os.listdir(os.path.join(REPO, 'videos/gpu')) if f.endswith(('.py', '.txt')) and not f.startswith('_selftest')]
    for f in files:
        os.makedirs(os.path.dirname(os.path.join(seed, f)), exist_ok=True)
        shutil.copy2(os.path.join(REPO, f), os.path.join(seed, f))
    open(os.path.join(seed, '.gitignore'), 'w').write('videos/out/*\n__pycache__/\n')
    os.makedirs(os.path.join(seed, 'farm/jobs')); open(os.path.join(seed, 'farm/jobs/.keep'), 'w').close()
    sh('git add -A && git commit -qm seed && git push -q %s main' % pipe, cwd=seed, env=env)
    sh('git commit -q --allow-empty -m archive && git push -q %s HEAD:main' % arch, cwd=seed, env=env)
    studio = os.path.join(root, 'studio'); sh(['git', 'clone', '-q', 'file://' + pipe, studio], env=env)
    senv = dict(env, FARM_CACHE=os.path.join(root, 'cache_studio'))
    wenv = dict(env, FARM_CACHE=os.path.join(root, 'cache_worker'))
    work = os.path.join(root, 'work')
    # the lane's uncommitted scene builder, importing a sibling module; and a branch that someone else moved on the remote
    sh('git checkout -q -b lane && git push -q origin lane', cwd=studio, env=env)
    other = os.path.join(root, 'other'); sh(['git', 'clone', '-q', '-b', 'lane', 'file://' + pipe, other], env=env)
    sh('echo note > other_lane.txt && git add other_lane.txt && git commit -qm "another lane" && git push -q origin lane', cwd=other, env=env)
    lane = os.path.join(studio, 'videos/blender/lane_test'); os.makedirs(lane)
    src = open(os.path.join(REPO, 'videos/blender/gpujob/selftest_scene.py')).read()
    open(os.path.join(lane, 'scene.py'), 'w').write('import lanehelp\n' + src + '\nlanehelp.mark()\n')
    open(os.path.join(lane, 'lanehelp.py'), 'w').write('def mark():\n    print("lanehelp: imported")\n')
    worker = subprocess.Popen([sys.executable, os.path.join(studio, 'videos/scripts/gpu_fake_worker.py'), '--by', 'fake-gpu',
                               '--rounds', '40', '--poll', '3', '--work', work], env=wenv, stdout=subprocess.PIPE,
                              stderr=subprocess.STDOUT, text=True)
    lines = []
    import threading
    threading.Thread(target=lambda: [lines.append(l.rstrip()) for l in worker.stdout], daemon=True).start()
    try:
        # 1. farm_gpu.py: list (exit 3), then commit + push (the remote moved: rebased) + post + wait + fetch
        stills = ['stills', 'e2e', '--scene', 'videos/blender/lane_test/scene.py', '--still', 'a=1@Cam_A', '--frames', '1-2',
                  '--res', '48x32', '--samples', '2', '--by', 'studio', '--timeout', '900', '--time', '10'] + dev
        p = sh([sys.executable, 'videos/scripts/farm_gpu.py'] + stills, cwd=studio, env=senv, check=False)
        listed = p.returncode == 3 and 'lane_test/lanehelp.py' in p.stdout and 'lane_test/scene.py' in p.stdout
        e2e_result('farm_gpu list (no --yes)', listed, p.stdout[-600:])
        p = sh([sys.executable, 'videos/scripts/farm_gpu.py'] + stills + ['--yes'], cwd=studio, env=senv, check=False)
        got = sorted(os.listdir(os.path.join(studio, 'videos/out/gpu'))) if os.path.isdir(os.path.join(studio, 'videos/out/gpu')) else []
        jid = got[-1] if got else ''
        d = os.path.join(studio, 'videos/out/gpu', jid)
        ok = p.returncode == 0 and os.path.isfile(os.path.join(d, 'out', 'stills', 'a.png')) and os.path.isfile(os.path.join(d, 'out', 'frames', '0002.png'))
        rebased = 'rebased' in p.stdout
        e2e_result('farm_gpu stills --yes: committed, pushed over a moved branch, delivered, fetched, tree rebuilt', ok and rebased,
                   (p.stdout + p.stderr)[-1500:])
        clean = sh('git status --porcelain', cwd=studio, env=env).stdout
        e2e_result('the lane files show clean after the commit (index synced; working tree untouched)',
                   'lane_test' not in clean, clean[-400:])
        # 2. farm.py gpu on main: the Python smoke test in the worker's venv
        p = sh([sys.executable, 'videos/scripts/farm.py', 'gpu', '--python', 'videos/gpu/smoke.py', '--main', '--by', 'studio',
                '--time', '5', '--timeout', '900'], cwd=studio, env=senv, check=False)
        e2e_result('farm.py gpu --python smoke --main: delivered and fetched', p.returncode == 0 and 'smoke.json' in p.stdout,
                   (p.stdout + p.stderr)[-1200:])
        # 3. a recipe the worker must refuse before allocating a GPU
        p = sh([sys.executable, 'videos/scripts/farm.py', 'post', '--title', 'bad gpu', '--by', 'studio', '--run',
                'sh videos/scripts/gpu_job.sh python videos/gpu/../scripts/farm.py --id {id}'], cwd=studio, env=senv)
        bad = p.stdout.strip().splitlines()[-1]
        w = sh([sys.executable, 'videos/scripts/farm.py', 'wait', bad, '--timeout', '300'], cwd=studio, env=senv, check=False)
        e2e_result('a "../" script is refused by the worker rule', w.returncode == 1 and 'unsupported recipe' in w.stdout, w.stdout[-500:])
    finally:
        worker.terminate()
        try:
            worker.wait(timeout=30)
        except subprocess.TimeoutExpired:
            worker.kill()
    print('\n'.join('  worker| ' + l for l in lines[-14:]))
    print('e2e: %.0f s' % (time.time() - t0))


def e2e_result(name, ok, detail):
    results.append(('e2e: ' + name, ok, '', '', 0, '', ''))
    print('%s %s' % ('PASS' if ok else 'FAIL', 'e2e: ' + name), flush=True)
    if not ok:
        print(detail)


if __name__ == '__main__':
    sys.exit(main())
