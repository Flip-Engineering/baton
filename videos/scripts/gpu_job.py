#!/usr/bin/env python3
"""GPU JOB: the one command form the homelab farm runs for Blender and Python GPU work (FARMGPU, 3 Oct 2026).

  sh videos/scripts/gpu_job.sh blender videos/blender/SCRIPT.py [OPTIONS] [-- SCRIPT ARGS]
  sh videos/scripts/gpu_job.sh python  videos/gpu/SCRIPT.py     [OPTIONS] [-- SCRIPT ARGS]
  sh videos/scripts/gpu_job.sh check        what this machine has for GPU jobs (Blender, EGL, GPUs, the venv); exit 0 = ready
  sh videos/scripts/gpu_job.sh setup-venv   build the pinned Python venv now (else the first python job builds it)

OPTIONS (between the script and `--`)
  --gpus N       cards the job needs (default 1). The worker allocates them and sets CUDA_VISIBLE_DEVICES; with
                 GPU_JOB_REQUIRE_GPU=1 (the farm) the job is refused unless exactly N GPUs are visible.
  --per-gpu      one process per card (each sees one card; GPU_JOB_SHARD=k, GPU_JOB_SHARDS=N in its environment).
                 Default: one process sees all N cards (Cycles then splits every frame across them).
  --time MIN     wall-clock limit for the script, minutes (default 60, capped at GPU_JOB_MAX_TIME, default 230)
  --mem GB       host RAM limit for the job's processes together (default 24, capped at GPU_JOB_MAX_MEM, default 64)
  --device D     blender only: cuda (default) | optix | auto (CUDA, then OptiX) | cpu (refused when GPU_JOB_REQUIRE_GPU=1)
  --blend FILE   blender only: open this .blend (a committed file under videos/) before the script runs
  --id ID        the farm job id (farm.py gpu writes it into the command): the out folder is videos/out/gpu/<ID>/.
                 If the worker also sets GPU_JOB_ID, the two must agree.

What it guarantees
  - The script is a regular, git-tracked .py file under videos/blender/ (kind blender) or videos/gpu/ (kind python), named
    by a plain relative path: no '..', no absolute path, no symlink anywhere on the way. Anything else is refused before a
    GPU is touched (exit 2).
  - It runs from the repo root at whatever commit is checked out (the job's pipeline_commit), headless: Blender as
    `blender -b --factory-startup` (Cycles on CUDA or OptiX across the job's cards via videos/blender/gpujob/devices.py;
    EEVEE through EGL), Python in a venv pinned by videos/gpu/requirements*.txt (built once per requirements hash).
  - The script writes its outputs to $GPU_OUT (= videos/out/gpu/<id>/out/); scratch goes to $GPU_TMP (deleted after).
    Only files under $GPU_OUT are delivered: they are linked flat into videos/out/gpu/<id>/deliver/ (a/b.png -> a__b.png)
    with receipt.json (versions, GPUs, timings, limits, every file with size and sha256) and log.txt. Symlinks and other
    non-regular files in $GPU_OUT are not delivered (a warning says so).
  - Time and RAM limits: SIGTERM to the whole process group, SIGKILL after GPU_JOB_GRACE seconds (default 60;
    GPU_JOB_GRACE=never waits instead). GPU memory is sampled (nvidia-smi) into the receipt; it is not limited.
  - Exit 0 and a last line `GPU_JOB OK <id> ...`, or a non-zero exit and `GPU_JOB FAILED <id>: <reason>` (the reason is
    what the worker passes to farm.py fail --why). Codes: 2 refused, 3 setup (Blender/venv/GPUs), 4 the script failed,
    5 time limit, 6 RAM limit, 7 outputs (too many/too big). A receipt is written whenever the out folder could be made.

Environment the worker sets (all optional on a laptop)
  GPU_JOB_ID            the farm job id; the out folder is videos/out/gpu/<GPU_JOB_ID>/ (default local-<UTC time>-<script>)
  CUDA_VISIBLE_DEVICES  the job's cards (UUIDs or indexes), as the worker already does for its Chromium workers
  GPU_JOB_REQUIRE_GPU=1 refuse to run without exactly --gpus visible cards (no silent CPU fallback)
  GPU_JOB_BLENDER       the Blender binary (default: blender on PATH, then /opt/blender/blender)
  GPU_JOB_PYTHON        the Python the venv is made from (default python3; 3.10-3.13)
  GPU_JOB_HOME          caches: venvs/, models (HF_HOME, TORCH_HOME), pip (default ~/.cache/acp-gpu)
  GPU_JOB_TORCH_INDEX   the PyTorch wheel index (default https://download.pytorch.org/whl/cu126: the last CUDA line that
                        still builds for Volta sm_70; .../whl/cpu for a CPU-only test machine)
  GPU_JOB_VENV_BUILD=0  never build a venv inside a job (fail with a hint instead)
  GPU_JOB_MAX_TIME, GPU_JOB_MAX_MEM, GPU_JOB_MAX_GPUS (default 2), GPU_JOB_MAX_OUT_MB (default 2000),
  GPU_JOB_MAX_FILES (default 5000), GPU_JOB_NICE (default 5), GPU_JOB_THREADS (Blender -t; default all cores),
  GPU_JOB_ALLOW_UNTRACKED=1 (a local dry run of a script not committed yet; never on the farm)
Docs: research/capabilities/farm_gpu.md
"""
import collections, datetime, hashlib, json, os, platform, re, shlex, shutil, signal, subprocess, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
KINDS = {'blender': 'videos/blender/', 'python': 'videos/gpu/'}
SCRIPT_RE = re.compile(r'^videos/(blender|gpu)/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.py$')
BLEND_RE = re.compile(r'^videos/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.blend$')
ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$')
TORCH_INDEX = 'https://download.pytorch.org/whl/cu126'
BLENDER_PIN = '5.2'                    # the LTS line the farm installs (videos/blender/gpujob/README in farm_gpu.md)
PROGRESS = re.compile(r'\|\s*(Sample|Rendering|Path Tracing Sample|Remaining)\b.*\d+/\d+|^Fra:\d+ .*\| (Sample|Rendered) ')
LOG_CAP = 8 * 1024 * 1024


def env_int(name, default):
    try:
        return int(float(os.environ.get(name, default)))
    except ValueError:
        return default


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


class Fail(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


def sh(cmd, timeout=60, env=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env, cwd=REPO)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, str(e)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


# ------------------------------------------------------------------ parsing and the refusals
def parse(argv):
    if not argv or argv[0] not in KINDS:
        raise Fail(2, 'usage: gpu_job.sh blender|python SCRIPT.py [--gpus N] [--time MIN] [--mem GB] [--device D] [--blend F] '
                      '[--per-gpu] [-- ARGS] (or: check, setup-venv); got %r' % ' '.join(argv[:3]))
    kind = argv[0]
    if len(argv) < 2:
        raise Fail(2, 'which script? (a .py under %s)' % KINDS[kind])
    o = {'kind': kind, 'script': argv[1], 'gpus': 1, 'time': 60.0, 'mem': 24.0, 'device': 'cuda', 'blend': None,
         'per_gpu': False, 'args': [], 'id': None}
    rest = argv[2:]
    i = 0
    while i < len(rest):
        a = rest[i]
        if a == '--':
            o['args'] = rest[i + 1:]
            break
        key = a.split('=', 1)[0]
        val = a.split('=', 1)[1] if '=' in a else None
        if key == '--per-gpu':
            o['per_gpu'] = True; i += 1; continue
        if key not in ('--gpus', '--time', '--mem', '--device', '--blend', '--id'):
            raise Fail(2, 'unknown option %r (script arguments go after --)' % a)
        if val is None:
            if i + 1 >= len(rest):
                raise Fail(2, '%s needs a value' % key)
            val = rest[i + 1]; i += 1
        i += 1
        try:
            if key == '--gpus':
                o['gpus'] = int(val)
            elif key in ('--time', '--mem'):
                o[key[2:]] = float(val)
            elif key == '--device':
                o['device'] = val.lower()
            elif key == '--id':
                o['id'] = val
            else:
                o['blend'] = val
        except ValueError:
            raise Fail(2, '%s %r is not a number' % (key, val))
    for x in o['args']:
        if '\0' in x or '\n' in x or '\r' in x:
            raise Fail(2, 'script arguments may not hold NUL or newlines')
    max_gpus, max_time, max_mem = env_int('GPU_JOB_MAX_GPUS', 2), env_int('GPU_JOB_MAX_TIME', 230), env_int('GPU_JOB_MAX_MEM', 64)
    if not 1 <= o['gpus'] <= max_gpus:
        raise Fail(2, '--gpus %d: this worker gives 1 to %d cards a job (GPU_JOB_MAX_GPUS)' % (o['gpus'], max_gpus))
    if not 0 < o['time'] <= max_time:
        raise Fail(2, '--time %g min: the limit here is %d min (GPU_JOB_MAX_TIME)' % (o['time'], max_time))
    if not 0 < o['mem'] <= max_mem:
        raise Fail(2, '--mem %g GB: the limit here is %d GB (GPU_JOB_MAX_MEM)' % (o['mem'], max_mem))
    if o['device'] not in ('cuda', 'optix', 'auto', 'cpu'):
        raise Fail(2, '--device %s: cuda, optix, auto or cpu' % o['device'])
    if kind == 'python' and (o['blend'] or o['device'] != 'cuda'):
        raise Fail(2, '--blend and --device are for blender jobs')
    if o['device'] == 'cpu' and os.environ.get('GPU_JOB_REQUIRE_GPU') == '1':
        raise Fail(2, '--device cpu: this worker runs GPU jobs only (GPU_JOB_REQUIRE_GPU=1)')
    o['script'] = check_path(o['script'], SCRIPT_RE, 'script', KINDS[kind])
    if o['blend']:
        o['blend'] = check_path(o['blend'], BLEND_RE, 'blend file', 'videos/')
    return o


def check_path(p, rx, what, under):
    """a plain repo-relative path to a regular, tracked file: refused otherwise (named, with why)"""
    if '\\' in p or p.startswith('/') or p.startswith('~'):
        raise Fail(2, '%s %r: give a path relative to the repo root, under %s' % (what, p, under))
    parts = p.split('/')
    if any(x in ('', '.', '..') for x in parts):
        raise Fail(2, '%s %r: no "..", "." or empty parts in the path' % (what, p))
    if not p.startswith(under) or not rx.match(p):
        raise Fail(2, '%s %r: must be a %s under %s (letters, digits, _ . - in names)' % (
            what, p, '.py' if what == 'script' else '.blend', under))
    cur = REPO
    for x in parts:
        cur = os.path.join(cur, x)
        if os.path.islink(cur):
            raise Fail(2, '%s %r: %s is a symlink; not followed' % (what, p, os.path.relpath(cur, REPO)))
    full = os.path.join(REPO, p)
    if not os.path.isfile(full):
        raise Fail(2, '%s %r: no such file at this commit' % (what, p))
    if os.path.realpath(full) != os.path.join(os.path.realpath(REPO), p):
        raise Fail(2, '%s %r: resolves outside its own path; not followed' % (what, p))
    if os.environ.get('GPU_JOB_ALLOW_UNTRACKED') != '1':
        rc, out = sh(['git', 'ls-files', '--error-unmatch', '--', p])
        if rc == 127:
            pass                                          # no git here: the worker's checkout is the commit anyway
        elif rc:
            raise Fail(2, '%s %r is not committed (the farm runs only committed files)' % (what, p))
    return p


# ------------------------------------------------------------------ GPUs
def visible_gpus():
    """the cards this job sees: nvidia-smi rows filtered by CUDA_VISIBLE_DEVICES (None: no nvidia-smi)"""
    if not shutil.which('nvidia-smi'):
        return None
    rc, out = sh(['nvidia-smi', '--query-gpu=index,uuid,name,driver_version,memory.total,compute_cap,pci.bus_id',
                  '--format=csv,noheader,nounits'], timeout=30)
    if rc:
        # an older driver may not know compute_cap
        rc, out = sh(['nvidia-smi', '--query-gpu=index,uuid,name,driver_version,memory.total,pci.bus_id',
                      '--format=csv,noheader,nounits'], timeout=30)
        if rc:
            raise Fail(3, 'nvidia-smi failed: %s' % out.strip()[-300:])
    rows = []
    for line in out.strip().splitlines():
        f = [x.strip() for x in line.split(',')]
        if len(f) == 7:
            rows.append(dict(zip(('index', 'uuid', 'name', 'driver', 'memory_mib', 'compute_cap', 'bus'), f)))
        elif len(f) == 6:
            rows.append(dict(zip(('index', 'uuid', 'name', 'driver', 'memory_mib', 'bus'), f)))
    cvd = os.environ.get('CUDA_VISIBLE_DEVICES')
    if cvd is None:
        return rows
    want = [x.strip() for x in cvd.split(',') if x.strip()]
    sel = []
    for w in want:
        m = [r for r in rows if r['uuid'] == w or r['uuid'].startswith(w) or r['index'] == w]
        if not m and re.fullmatch(r'\d+', w) and int(w) < len(rows):
            m = [rows[int(w)]]                    # in a container, nvidia-smi may number its cards differently
        sel += [r for r in m if r not in sel]
    return sel


class GpuSampler(threading.Thread):
    """nvidia-smi every few seconds: peak memory and mean utilisation per visible card"""
    def __init__(self, uuids, every=5.0):
        super().__init__(daemon=True)
        self.uuids, self.every, self.stop = set(uuids), every, threading.Event()
        self.peak, self.util, self.n, self.temp = {}, collections.defaultdict(float), collections.defaultdict(int), {}

    def run(self):
        while not self.stop.is_set():
            rc, out = sh(['nvidia-smi', '--query-gpu=uuid,memory.used,utilization.gpu,temperature.gpu',
                          '--format=csv,noheader,nounits'], timeout=20)
            if rc == 0:
                for line in out.strip().splitlines():
                    f = [x.strip() for x in line.split(',')]
                    if len(f) == 4 and f[0] in self.uuids:
                        try:
                            self.peak[f[0]] = max(self.peak.get(f[0], 0), int(f[1]))
                            self.util[f[0]] += float(f[2]); self.n[f[0]] += 1
                            self.temp[f[0]] = max(self.temp.get(f[0], 0), int(f[3]))
                        except ValueError:
                            pass
            self.stop.wait(self.every)

    def summary(self):
        return {u: {'peak_memory_mib': self.peak.get(u), 'mean_util_pct': round(self.util[u] / self.n[u], 1) if self.n[u] else None,
                    'max_temp_c': self.temp.get(u), 'samples': self.n[u]} for u in sorted(self.uuids)}


# ------------------------------------------------------------------ Blender and the venv
def blender_bin():
    b = os.environ.get('GPU_JOB_BLENDER') or shutil.which('blender') or '/opt/blender/blender'
    if not (os.path.isfile(b) and os.access(b, os.X_OK)):
        raise Fail(3, 'Blender not found (GPU_JOB_BLENDER, blender on PATH, /opt/blender/blender): install Blender %s LTS '
                      '(research/capabilities/farm_gpu.md)' % BLENDER_PIN)
    rc, out = sh([b, '--factory-startup', '-b', '--version'], timeout=120)
    m = re.search(r'Blender (\d+\.\d+(?:\.\d+)?)(?: (LTS))?', out)
    if rc or not m:
        raise Fail(3, 'Blender at %s does not start: %s' % (b, out.strip()[-400:]))
    ver = m.group(1) + (' LTS' if m.group(2) else '')
    h = re.search(r'build hash: (\w+)', out)
    return b, {'path': b, 'version': ver, 'hash': h.group(1) if h else None, 'pinned_line': BLENDER_PIN,
               'matches_pin': ver.startswith(BLENDER_PIN + '.')}


def gpu_home():
    return os.path.expanduser(os.environ.get('GPU_JOB_HOME', '~/.cache/acp-gpu'))


def venv_key():
    reqs = [os.path.join(REPO, 'videos/gpu', n) for n in ('requirements-torch.txt', 'requirements.txt')]
    for r in reqs:
        if not os.path.isfile(r):
            raise Fail(3, 'missing %s' % os.path.relpath(r, REPO))
    py = os.environ.get('GPU_JOB_PYTHON', 'python3')
    rc, out = sh([py, '-c', 'import sys; print("%d.%d.%d" % sys.version_info[:3])'])
    if rc:
        raise Fail(3, 'GPU_JOB_PYTHON=%s does not run: %s' % (py, out.strip()[-200:]))
    pyver = out.strip()
    index = os.environ.get('GPU_JOB_TORCH_INDEX', TORCH_INDEX).rstrip('/')
    h = hashlib.sha256()
    for r in reqs:
        h.update(open(r, 'rb').read())
    h.update(('\0%s\0%s' % (index, '.'.join(pyver.split('.')[:2]))).encode())
    return h.hexdigest()[:12], py, pyver, index, reqs


def ensure_venv(log=print, build=None):
    """the venv for the current requirements (built under a lock if missing); returns (python, info)"""
    key, py, pyver, index, (req_torch, req) = venv_key()
    root = os.path.join(gpu_home(), 'venvs')
    d = os.path.join(root, key)
    ready = os.path.join(d, '.ready.json')
    if os.path.isfile(ready):
        return os.path.join(d, 'bin', 'python'), json.load(open(ready))
    if build is None:
        build = os.environ.get('GPU_JOB_VENV_BUILD', '1') != '0'
    if not build:
        raise Fail(3, 'the Python venv %s (for the committed videos/gpu/requirements*.txt) is not built on this worker; '
                      'run: sh videos/scripts/gpu_job.sh setup-venv' % key)
    os.makedirs(root, exist_ok=True)
    import fcntl
    with open(os.path.join(root, key + '.lock'), 'w') as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        if os.path.isfile(ready):
            return os.path.join(d, 'bin', 'python'), json.load(open(ready))
        shutil.rmtree(d, ignore_errors=True)
        t0 = time.time()
        log('gpu_job: building the venv %s (Python %s, torch from %s); once per requirements change' % (key, pyver, index))
        pip_env = dict(os.environ, PIP_CACHE_DIR=os.path.join(gpu_home(), 'pip'), PIP_DISABLE_PIP_VERSION_CHECK='1')
        steps = [[py, '-m', 'venv', d],
                 [os.path.join(d, 'bin', 'python'), '-m', 'pip', 'install', '-q', '--index-url', index, '-r', req_torch],
                 [os.path.join(d, 'bin', 'python'), '-m', 'pip', 'install', '-q', '-r', req]]
        for cmd in steps:
            rc, out = sh(cmd, timeout=env_int('GPU_JOB_VENV_TIMEOUT', 2400), env=pip_env)
            if rc:
                shutil.rmtree(d, ignore_errors=True)
                raise Fail(3, 'venv build failed at `%s`: %s' % (' '.join(cmd[-4:]), out.strip()[-800:]))
        vp = os.path.join(d, 'bin', 'python')
        rc, out = sh([vp, '-c', 'import json, torch, torchvision, numpy; print(json.dumps({"torch": torch.__version__, '
                                '"torchvision": torchvision.__version__, "numpy": numpy.__version__, "cuda": torch.version.cuda, '
                                '"arch_list": torch.cuda.get_arch_list() if torch.version.cuda else []}))'], timeout=300)
        if rc:
            shutil.rmtree(d, ignore_errors=True)
            raise Fail(3, 'the new venv does not import torch: %s' % out.strip()[-600:])
        info = json.loads(out.strip().splitlines()[-1])
        flavour = index.rsplit('/', 1)[-1]
        if '+' + flavour not in info['torch']:
            shutil.rmtree(d, ignore_errors=True)
            raise Fail(3, 'torch %s is not the %s build the index promised; venv removed' % (info['torch'], flavour))
        if flavour.startswith('cu') and 'sm_70' not in info['arch_list']:
            shutil.rmtree(d, ignore_errors=True)
            raise Fail(3, 'torch %s has no sm_70 (Volta) kernels: %s; pin a cu12x build' % (info['torch'], info['arch_list']))
        _, freeze = sh([vp, '-m', 'pip', 'freeze'], timeout=120)
        _, chk = sh([vp, '-m', 'pip', 'check'], timeout=120)
        open(os.path.join(d, 'freeze.txt'), 'w').write(freeze)
        info.update({'key': key, 'python': pyver, 'torch_index': index, 'built_at': now(), 'build_s': round(time.time() - t0, 1),
                     'pip_check': chk.strip()[-400:], 'path': d,
                     'requirements_sha256': {os.path.basename(r): sha256(r) for r in (req_torch, req)}})
        json.dump(info, open(ready + '.tmp', 'w'), indent=1)
        os.replace(ready + '.tmp', ready)
        log('gpu_job: venv %s ready in %.0f s (torch %s)' % (key, time.time() - t0, info['torch']))
        return vp, info


# ------------------------------------------------------------------ running, with limits
def group_rss(sids):
    """resident memory (bytes) of every process in these sessions"""
    total, page = 0, os.sysconf('SC_PAGE_SIZE')
    for p in os.listdir('/proc'):
        if not p.isdigit():
            continue
        try:
            st = open('/proc/%s/stat' % p).read()
            f = st[st.rindex(')') + 2:].split()
            if int(f[3]) in sids:                        # field 6: session id
                total += int(open('/proc/%s/statm' % p).read().split()[1]) * page
        except (OSError, ValueError, IndexError):
            pass
    return total


class Child:
    def __init__(self, cmd, env, log_path, echo):
        self.log_path, self.tail, self.size = log_path, collections.deque(maxlen=60), 0
        self.logf = open(log_path, 'wb')
        nice = env_int('GPU_JOB_NICE', 5)
        self.p = subprocess.Popen(cmd, cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  stdin=subprocess.DEVNULL, start_new_session=True,
                                  preexec_fn=(lambda: os.nice(nice)) if nice else None)
        self.t = threading.Thread(target=self.pump, args=(echo,), daemon=True)
        self.t.start()

    def pump(self, echo):
        for raw in iter(self.p.stdout.readline, b''):
            if self.size < LOG_CAP:
                self.logf.write(raw); self.size += len(raw)
                if self.size >= LOG_CAP:
                    self.logf.write(b'\n[gpu_job: log capped at %d MB; the tail is in the receipt]\n' % (LOG_CAP >> 20))
            line = raw.decode('utf-8', 'replace').rstrip()
            self.tail.append(line)
            if echo is not None and not PROGRESS.search(line):
                print(echo + line, flush=True)
        self.logf.close()

    def signal(self, sig):
        try:
            os.killpg(self.p.pid, sig)
        except ProcessLookupError:
            pass


def run_children(cmds, limit_s, mem_bytes):
    """start every (cmd, env, log) at once; enforce the time and RAM limits on them together.
    Returns (exit codes, reason or None, seconds, peak RSS bytes)"""
    kids = [Child(c, e, lp, tag) for c, e, lp, tag in cmds]
    t0, peak, reason = time.time(), 0, None
    grace = os.environ.get('GPU_JOB_GRACE', '60')
    while any(k.p.poll() is None for k in kids):
        rss = group_rss({k.p.pid for k in kids})
        peak = max(peak, rss)
        if reason is None and time.time() - t0 > limit_s:
            reason = (5, 'time limit: the script ran past %g min (--time)' % round(limit_s / 60, 2))
        if reason is None and rss > mem_bytes:
            reason = (6, 'RAM limit: the job\'s processes held %.1f GB, over --mem %.1f GB' % (rss / 2 ** 30, mem_bytes / 2 ** 30))
        if reason:
            print('gpu_job: %s; stopping (SIGTERM)' % reason[1], flush=True)
            for k in kids:
                k.signal(signal.SIGTERM)
            t1 = time.time()
            while any(k.p.poll() is None for k in kids):
                if grace != 'never' and time.time() - t1 > float(grace):
                    print('gpu_job: still running %s s after SIGTERM; SIGKILL' % grace, flush=True)
                    for k in kids:
                        k.signal(signal.SIGKILL)
                    break
                time.sleep(1)
            break
        time.sleep(1.0)
    for k in kids:
        k.p.wait()
        k.t.join(timeout=30)
    return [k.p.returncode for k in kids], reason, time.time() - t0, peak, kids


# ------------------------------------------------------------------ outputs
def collect(out_dir, deliver):
    """link every regular file under out_dir flat into deliver/ (a/b.png -> a__b.png); returns (files, warnings)"""
    files, warns, total = [], [], 0
    max_bytes, max_files = env_int('GPU_JOB_MAX_OUT_MB', 2000) * 2 ** 20, env_int('GPU_JOB_MAX_FILES', 5000)
    taken = {'receipt.json'} | {n for n in os.listdir(deliver)}
    for root, dirs, names in os.walk(out_dir):
        dirs.sort()
        for d in list(dirs):
            if os.path.islink(os.path.join(root, d)):
                warns.append('not delivered (a symlinked folder): %s' % os.path.relpath(os.path.join(root, d), out_dir))
                dirs.remove(d)
        for n in sorted(names):
            src = os.path.join(root, n)
            rel = os.path.relpath(src, out_dir)
            if os.path.islink(src) or not os.path.isfile(src):
                warns.append('not delivered (a symlink or not a regular file): %s' % rel)
                continue
            name = rel.replace(os.sep, '__')
            if name in taken:
                name = 'out__' + name
            if name in taken or len(name) > 200:
                raise Fail(7, 'output %s: its delivery name %s clashes or is too long' % (rel, name))
            taken.add(name)
            size = os.path.getsize(src)
            total += size
            if len(files) + 1 > max_files:
                raise Fail(7, 'more than %d output files (GPU_JOB_MAX_FILES); pack them (tar/zip) in the script' % max_files)
            if total > max_bytes:
                raise Fail(7, 'outputs pass %d MB (GPU_JOB_MAX_OUT_MB) at %s' % (max_bytes >> 20, rel))
            dst = os.path.join(deliver, name)
            try:
                os.link(src, dst)
            except OSError:
                shutil.copy2(src, dst)
            files.append({'path': rel, 'name': name, 'size': size, 'sha256': sha256(dst)})
    return files, warns


def repo_state():
    st = {}
    rc, out = sh(['git', 'rev-parse', 'HEAD'])
    st['commit'] = out.strip() if rc == 0 else None
    rc, out = sh(['git', 'status', '--porcelain=v1', '--untracked-files=all', '--', 'videos/blender', 'videos/gpu',
                  'videos/scripts/gpu_job.py', 'videos/scripts/gpu_job.sh'])
    st['dirty'] = [l[3:] for l in out.splitlines() if l.strip()] if rc == 0 else None
    return st


def host_info():
    mem = None
    try:
        mem = round(int(re.search(r'MemTotal:\s+(\d+)', open('/proc/meminfo').read()).group(1)) / 2 ** 20, 1)
    except (OSError, AttributeError):
        pass
    return {'os': platform.platform(), 'cpus': os.cpu_count(), 'ram_gb': mem, 'python': platform.python_version()}


def egl_info():
    rc, out = sh(['ldconfig', '-p'])
    libs = {m for m in re.findall(r'(libEGL(?:_nvidia|_mesa)?\.so\.\d+)', out)} if rc == 0 else set()
    for d in os.environ.get('LD_LIBRARY_PATH', '').split(':'):
        if d and os.path.isdir(d):
            libs |= {f for f in os.listdir(d) if re.fullmatch(r'libEGL(?:_nvidia|_mesa)?\.so\.\d+', f)}
    libs = sorted(libs)
    vendors = []
    for d in ('/usr/share/glvnd/egl_vendor.d', '/etc/glvnd/egl_vendor.d') + tuple(
            x for x in os.environ.get('__EGL_VENDOR_LIBRARY_DIRS', '').split(':') if x):
        if os.path.isdir(d):
            vendors += sorted(os.listdir(d))
    return {'libs': libs, 'vendors': vendors, 'nvidia_driver_capabilities': os.environ.get('NVIDIA_DRIVER_CAPABILITIES')}


# ------------------------------------------------------------------ the job
def job(argv):
    t_start = time.time()
    o = parse(argv)                                       # refusals happen here, before anything is made
    if o['id'] and os.environ.get('GPU_JOB_ID') and o['id'] != os.environ['GPU_JOB_ID']:
        raise Fail(2, '--id %s but GPU_JOB_ID=%s: they must agree' % (o['id'], os.environ['GPU_JOB_ID']))
    jid = o['id'] or os.environ.get('GPU_JOB_ID') or 'local-%s-%s' % (
        datetime.datetime.now(datetime.timezone.utc).strftime('%m%d-%H%M%S'), os.path.basename(o['script'])[:-3])
    if not ID_RE.match(jid):
        raise Fail(2, 'GPU_JOB_ID %r: letters, digits, _ . - only' % jid)
    base = os.path.join(REPO, 'videos', 'out', 'gpu', jid)
    if os.path.exists(base) and os.listdir(base):
        raise Fail(2, 'videos/out/gpu/%s/ already exists (a job id runs once; delete it to run again)' % jid)
    out_dir, deliver, tmp = (os.path.join(base, x) for x in ('out', 'deliver', 'tmp'))
    for d in (out_dir, deliver, tmp):
        os.makedirs(d, exist_ok=True)
    receipt = {'job': jid, 'kind': o['kind'], 'script': o['script'], 'args': o['args'], 'command': 'sh videos/scripts/gpu_job.sh ' +
               ' '.join(shlex.quote(a) for a in argv), 'options': {k: o[k] for k in ('gpus', 'per_gpu', 'time', 'mem', 'device', 'blend')},
               'started': now(), 'repo': repo_state(), 'host': host_info(), 'status': 'running', 'warnings': []}
    rpath = os.path.join(deliver, 'receipt.json')

    def write_receipt():
        json.dump(receipt, open(rpath + '.tmp', 'w'), indent=1)
        os.replace(rpath + '.tmp', rpath)

    try:
        return run_job(o, jid, base, out_dir, deliver, tmp, receipt, write_receipt, t_start)
    except Fail as f:
        receipt.update({'status': 'failed', 'exit_code': f.code, 'reason': f.msg, 'ended': now(),
                        'seconds': dict(receipt.get('seconds') or {}, total=round(time.time() - t_start, 1))})
        write_receipt()
        raise
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_job(o, jid, base, out_dir, deliver, tmp, receipt, write_receipt, t_start):
    require = os.environ.get('GPU_JOB_REQUIRE_GPU') == '1'
    gpus = visible_gpus()
    if gpus is None:
        if require:
            raise Fail(3, 'no nvidia-smi on this worker, but GPU_JOB_REQUIRE_GPU=1')
        receipt['warnings'].append('no NVIDIA GPU here (no nvidia-smi): the script runs on the CPU')
        gpus = []
    elif require and len(gpus) != o['gpus']:
        raise Fail(3, 'the job asked for %d GPU(s) but sees %d (CUDA_VISIBLE_DEVICES=%s): the worker allocates them' % (
            o['gpus'], len(gpus), os.environ.get('CUDA_VISIBLE_DEVICES')))
    elif not require and len(gpus) > o['gpus'] and os.environ.get('CUDA_VISIBLE_DEVICES') is None:
        receipt['warnings'].append('CUDA_VISIBLE_DEVICES is unset: the script sees all %d cards here' % len(gpus))
    receipt['gpus'] = gpus
    receipt['egl'] = egl_info()
    t_setup = time.time()
    home = gpu_home()
    env = dict(os.environ, GPU_OUT=out_dir, GPU_TMP=tmp, GPU_JOB_ID=jid, TMPDIR=tmp, GPU_JOB_GPUS=str(len(gpus)),
               GPU_JOB_DEVICE=o['device'], PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1',
               HF_HOME=os.path.join(home, 'models', 'huggingface'), TORCH_HOME=os.path.join(home, 'models', 'torch'),
               XDG_CACHE_HOME=os.path.join(home, 'cache'))
    env.pop('PYTHONPATH', None)
    if o['kind'] == 'blender':
        b, info = blender_bin()
        receipt['blender'] = info
        if not info['matches_pin']:
            receipt['warnings'].append('Blender %s is not the pinned %s LTS line' % (info['version'], BLENDER_PIN))
        boot = os.path.join(REPO, 'videos', 'blender', 'gpujob', 'boot.py')
        base_cmd = [b, '-b'] + ['--factory-startup', '-noaudio', '--python-exit-code', '1']
        if os.environ.get('GPU_JOB_THREADS'):
            base_cmd += ['-t', os.environ['GPU_JOB_THREADS']]
        if o['blend']:
            base_cmd += [os.path.join(REPO, o['blend'])]
        base_cmd += ['--python', boot, '--python', os.path.join(REPO, o['script']), '--'] + o['args']
    else:
        vp, info = ensure_venv(log=lambda m: print(m, flush=True))
        receipt['venv'] = {k: info.get(k) for k in ('key', 'python', 'torch', 'torchvision', 'numpy', 'cuda', 'torch_index',
                                                     'built_at', 'requirements_sha256', 'pip_check')}
        env.update(PYTHONNOUSERSITE='1', PYTHONPATH=os.path.join(REPO, 'videos', 'gpu'), VIRTUAL_ENV=os.path.dirname(os.path.dirname(vp)))
        base_cmd = [vp, os.path.join(REPO, o['script'])] + o['args']
    setup_s = time.time() - t_setup
    # one process seeing every card, or one per card
    if o['per_gpu'] and len(gpus) > 1:
        cmds = []
        for k, g in enumerate(gpus):
            e = dict(env, CUDA_VISIBLE_DEVICES=g['uuid'], GPU_JOB_SHARD=str(k), GPU_JOB_SHARDS=str(len(gpus)), GPU_JOB_GPUS='1')
            cmds.append((base_cmd, e, os.path.join(deliver, 'log_gpu%d.txt' % k), '[gpu%d] ' % k))
    else:
        e = dict(env, GPU_JOB_SHARD='0', GPU_JOB_SHARDS='1')
        cmds = [(base_cmd, e, os.path.join(deliver, 'log.txt'), '')]
    receipt['run'] = [' '.join(shlex.quote(x) for x in c[0]) for c in cmds[:1]]
    receipt['status'] = 'running'
    write_receipt()
    print('gpu_job: %s %s on %s, %s; limits %g min, %g GB; out videos/out/gpu/%s/' % (
        o['kind'], o['script'], ', '.join('%s %s' % (g['name'], g['uuid'][:12]) for g in gpus) or 'the CPU',
        'one process per card' if len(cmds) > 1 else 'one process', o['time'], o['mem'], jid), flush=True)
    sampler = None
    if gpus:
        sampler = GpuSampler([g['uuid'] for g in gpus]); sampler.start()
    codes, reason, run_s, peak, kids = run_children(cmds, o['time'] * 60, o['mem'] * 2 ** 30)
    if sampler:
        sampler.stop.set(); sampler.join(timeout=30)
        receipt['gpu_usage'] = sampler.summary()
    receipt['peak_rss_gb'] = round(peak / 2 ** 30, 2)
    receipt['exit_codes'] = codes
    receipt['log_tail'] = [l for k in kids for l in list(k.tail)[-40:]]
    for name in sorted(os.listdir(tmp)):                 # what Blender's device setup chose (gpujob/devices.py), per process
        p = os.path.join(tmp, name)
        if name.startswith('blender_devices') and name.endswith('.json'):
            try:
                receipt.setdefault('blender_devices', []).append(json.load(open(p)))
            except ValueError:
                pass
    receipt['seconds'] = {'setup': round(setup_s, 1), 'run': round(run_s, 1)}
    if reason:
        raise Fail(*reason)
    bad = [(i, c) for i, c in enumerate(codes) if c]
    if bad:
        tail = ' | '.join(l for l in list(kids[bad[0][0]].tail)[-6:] if l.strip())[-500:]
        raise Fail(4, 'the script exited %s%s: %s' % (bad[0][1], ' (signal %d)' % -bad[0][1] if bad[0][1] < 0 else '', tail))
    files, warns = collect(out_dir, deliver)
    receipt['warnings'] += warns
    if not files:
        receipt['warnings'].append('the script wrote nothing to $GPU_OUT')
    receipt.update({'status': 'ok', 'exit_code': 0, 'ended': now(), 'files': files,
                    'out_bytes': sum(f['size'] for f in files)})
    receipt['seconds']['total'] = round(time.time() - t_start, 1)
    receipt['logs'] = sorted(n for n in os.listdir(deliver) if n.startswith('log'))
    receipt['deliver'] = 'videos/out/gpu/%s/deliver/' % jid
    for w in receipt['warnings']:
        print('gpu_job: WARNING: ' + w, flush=True)
    return receipt, write_receipt


# ------------------------------------------------------------------ check and setup-venv (the worker's own steps)
def check():
    rows, ok_b, ok_p = [], True, True
    gp = visible_gpus()
    rows.append(('GPUs', '%d: %s' % (len(gp), '; '.join('%s %s %s MiB driver %s cc %s' % (g['index'], g['name'], g['memory_mib'], g['driver'],
                                                                                         g.get('compute_cap', '?')) for g in gp))
                 if gp is not None else 'none (no nvidia-smi)'))
    e = egl_info()
    rows.append(('EGL', '%s; vendors %s; NVIDIA_DRIVER_CAPABILITIES=%s' % (', '.join(e['libs']) or 'NO libEGL.so.1 (Blender 5 will not start)',
                                                                           ', '.join(e['vendors']) or 'none', e['nvidia_driver_capabilities'])))
    try:
        b, info = blender_bin()
        rows.append(('Blender', '%s at %s%s' % (info['version'], b, '' if info['matches_pin'] else '  (NOT the pinned %s LTS line)' % BLENDER_PIN)))
        probe = ('import bpy, json\np = bpy.context.preferences.addons["cycles"].preferences\nout = {}\n'
                 'for t in ("CUDA", "OPTIX"):\n    try:\n        p.compute_device_type = t\n        p.refresh_devices()\n'
                 '        out[t] = [d.name for d in p.devices if d.type == t]\n    except Exception as e:\n        out[t] = "error: %s" % e\n'
                 'print("GPUJOB_PROBE " + json.dumps(out))\n')
        rc, out = sh([b, '-b', '--factory-startup', '-noaudio', '--python-expr', probe], timeout=300)
        m = re.search(r'GPUJOB_PROBE (.*)', out)
        rows.append(('Cycles devices', m.group(1) if m else 'probe failed: %s' % out.strip()[-300:]))
        if gp and not (m and json.loads(m.group(1)).get('CUDA')):
            ok_b = False
            rows.append(('', 'NOT READY: nvidia-smi lists cards but Blender sees no CUDA device (driver too old? container without compute?)'))
        kern = [k for k in ('kernel_sm_70.cubin', 'kernel_sm_70.cubin.zst')
                if any(os.path.exists(os.path.join(dp, k)) for dp, _, _ in os.walk(os.path.dirname(b)) if dp.endswith('cycles/lib'))]
        rows.append(('Cycles sm_70 kernel', 'present' if kern else 'not found next to this Blender'))
    except Fail as f:
        ok_b = False
        rows.append(('Blender', f.msg))
    try:
        key, py, pyver, index, _ = venv_key()
        d = os.path.join(gpu_home(), 'venvs', key)
        st = json.load(open(os.path.join(d, '.ready.json'))) if os.path.isfile(os.path.join(d, '.ready.json')) else None
        rows.append(('Python venv', '%s (Python %s, %s): %s' % (key, pyver, index, 'ready, torch %s' % st['torch'] if st else
                                                                'NOT BUILT (sh videos/scripts/gpu_job.sh setup-venv)')))
        ok_p = bool(st)
    except Fail as f:
        ok_p = False
        rows.append(('Python venv', f.msg))
    rows.append(('caches', gpu_home()))
    for k, v in rows:
        print('%-20s %s' % (k, v))
    print('ready: blender jobs %s, python jobs %s' % ('yes' if ok_b else 'NO', 'yes' if ok_p else 'NO (setup-venv)'))
    return 0 if ok_b and ok_p else 1


def main(argv):
    if argv[:1] == ['check']:
        return check()
    if argv[:1] == ['setup-venv']:
        try:
            vp, info = ensure_venv(build=True)
        except Fail as f:
            print('GPU_JOB FAILED setup-venv: %s' % f.msg, flush=True)
            return f.code
        print(json.dumps({k: info.get(k) for k in ('key', 'python', 'torch', 'torchvision', 'cuda', 'arch_list', 'path')}, indent=1))
        return 0
    if argv[:1] in (['-h'], ['--help'], ['help']):
        print(__doc__); return 0
    head = argv[:argv.index('--')] if '--' in argv else argv
    jid = os.environ.get('GPU_JOB_ID') or (head[head.index('--id') + 1] if '--id' in head[:-1] else '(local)')
    try:
        receipt, write_receipt = job(argv)
    except Fail as f:
        print('GPU_JOB FAILED %s: %s' % (jid, f.msg), flush=True)
        return f.code
    except Exception as e:                                # a bug here: still a clean, named failure
        import traceback
        traceback.print_exc()
        print('GPU_JOB FAILED %s: gpu_job.py error: %s: %s' % (jid, type(e).__name__, e), flush=True)
        return 3
    write_receipt()
    print('GPU_JOB OK %s: %d file(s), %.1f MB; run %.0f s of %.0f s; deliver every file in %s' % (
        receipt['job'], len(receipt['files']), receipt['out_bytes'] / 1e6, receipt['seconds']['run'], receipt['seconds']['total'],
        receipt['deliver']), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
