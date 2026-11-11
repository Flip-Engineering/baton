"""Allocate balanced worker slots on configured GPU UUIDs."""
import csv, datetime, json, math, os, subprocess
from pathlib import Path
import farm

_activity = {}


def activity_records(path):
    """Read appended activity rows and retain the latest sample for each UUID."""
    identity = (str(path), path.stat().st_ino)
    state = _activity.setdefault(identity, dict(offset=0, pending='', records={}))
    if path.stat().st_size < state['offset']:
        state.update(offset=0, pending='', records={})
    with path.open() as stream:
        stream.seek(state['offset'])
        data = state['pending'] + stream.read()
        state['offset'] = stream.tell()
    lines = data.splitlines(keepends=True)
    state['pending'] = lines.pop() if lines and not lines[-1].endswith('\n') else ''
    for row in csv.reader(lines):
        if len(row) >= 14 and row[1].strip().startswith('GPU-'):
            state['records'][row[1].strip()] = row
    return state['records']


def unavailable():
    """Block new allocations when current-boot thermal telemetry is unsafe or stale."""
    held=dict(farm.CONFIG.get('gpu_admission_holds',{}))
    directory = farm.CONFIG.get('gpu_activity_directory')
    if not directory:
        return held
    cards = pool()
    try:
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        records = activity_records(Path(directory) / boot / 'gpu-activity.csv')
    except OSError as error:
        return {g['uuid']: 'GPU activity unavailable: '+str(error) for g in cards}
    blocked = held
    now = datetime.datetime.now()
    for card in cards:
        uuid = card['uuid']
        row = records.get(uuid)
        if row is None or len(row) < 16:
            blocked[uuid] = 'Current memory temperature and thermal flags unavailable'
            continue
        try:
            sampled = datetime.datetime.strptime(row[0].strip(), '%Y/%m/%d %H:%M:%S.%f')
            age = (now-sampled).total_seconds()
            if abs(age) > farm.CONFIG['gpu_health_timeout_seconds']:
                blocked[uuid] = 'GPU activity sample is stale'
                continue
            flags = int(row[15].strip(), 0)
            # NVML bits: software thermal 0x20, hardware thermal 0x40, power brake 0x80.
            if flags & 0xe0:
                blocked[uuid] = 'Active thermal slowdown or external power brake: '+hex(flags)
            maximum = card.get('memory_max_celsius')
            if maximum is not None and float(row[14].split()[0]) >= maximum:
                blocked[uuid] = 'Memory temperature reached the reported maximum'
        except (ValueError, IndexError):
            blocked[uuid] = 'GPU thermal activity sample could not be decoded'
    return blocked


def pool():
    cards = {g['uuid']: g for g in farm.CONFIG['gpus']}
    for gpu in farm.CONFIG.get('gpu_job_gpus', []):
        cards[gpu['uuid']] = gpu
    return list(cards.values())


def memory_available():
    from pathlib import Path
    info=Path('/proc/meminfo')
    if info.exists():
        available=next(int(line.split()[1])*1024 for line in info.read_text().splitlines() if line.startswith('MemAvailable:'))
        return min(available,farm.CONFIG.get('host_memory_budget_bytes',available))
    return os.sysconf('SC_AVPHYS_PAGES')*os.sysconf('SC_PAGE_SIZE')


def memory_required(job):
    request=json.loads((job/'request.json').read_text())
    prepared=job/'prepared.json'
    value=json.loads(prepared.read_text()).get('host_memory_gib') if prepared.exists() else None
    if request.get('kind') != 'gpu':
        # Scene renders need a measured or explicitly declared request. A
        # missing value is unknown capacity, not a zero-byte reservation.
        if value is None:
            return None
        context=json.loads(prepared.read_text())
        declaration=job/'resource-declaration.json'
        expected_declaration=context.get('resource_declaration_sha256')
        if expected_declaration is not None:
            if not declaration.is_file() or farm.file_sha256(declaration)!=expected_declaration:
                raise ValueError('Scene resource declaration hash does not match its prepared checkpoint')
            receipt=json.loads(declaration.read_text())
            if (receipt.get('schema') not in ('acp.scene-canary-resources/v1','acp.scene-resources/v1') or
                    receipt.get('job')!=job.name or
                    receipt.get('request_sha256')!=farm.file_sha256(job/'request.json') or
                    receipt.get('source_commit')!=context.get('commit') or
                    receipt.get('ranges')!=context.get('ranges') or
                    receipt.get('host_memory_gib')!=value):
                raise ValueError('Scene resource declaration does not match its prepared checkpoint')
        if not math.isfinite(float(value)) or float(value) <= 0:
            raise ValueError('Invalid host memory request')
        return math.ceil(float(value) * 2**30)
    if value is None:
        argv=request.get('gpu_argv',[])
        for index,arg in enumerate(argv):
            if arg=='--':break
            if arg=='--mem':value=float(argv[index+1]);break
            if arg.startswith('--mem='):value=float(arg.split('=',1)[1]);break
    # Older checkpoints without normalized resource limits reserve all free RAM.
    if value is None:return memory_available()
    if not math.isfinite(float(value)) or float(value)<=0:
        raise ValueError('Invalid host memory request')
    return math.ceil(float(value)*2**30)


class CgroupUnavailable(RuntimeError):
    """Measured usage cannot be read; admission must reserve the full budget."""


class CgroupStale(CgroupUnavailable):
    """The recorded container/cgroup no longer describes the running job."""


_cgroup_paths = {}


def _container_cgroup(job, proc_root=Path('/proc'), cgroup_root=Path('/sys/fs/cgroup')):
    """Resolve the live Docker cgroup for a job without trusting status alone."""
    container = 'acp-' + Path(job).name + '-gpujob'
    key = (container, str(proc_root), str(cgroup_root), farm.boot_id())
    cached = _cgroup_paths.get(key)
    if cached and Path(cached).is_dir():
        return Path(cached)
    _cgroup_paths.pop(key, None)
    try:
        state = json.loads(subprocess.check_output(
            ['docker', 'inspect', '--format', '{{json .State}}', container],
            env=farm.ENV, text=True, stderr=subprocess.DEVNULL, timeout=5))
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise CgroupUnavailable('Container state unavailable: ' + str(error))
    if not isinstance(state, dict) or state.get('Running') is not True or state.get('Status') != 'running':
        raise CgroupStale('Container is not running: ' + container)
    pid = state.get('Pid')
    if not isinstance(pid, int) or pid <= 0:
        raise CgroupStale('Container has no live PID: ' + container)
    try:
        lines = (Path(proc_root) / str(pid) / 'cgroup').read_text().splitlines()
    except OSError as error:
        raise CgroupUnavailable('Container cgroup state unreadable: ' + str(error))
    path = next((line.split('::', 1)[1] for line in lines if line.startswith('0::')), None)
    if not path or 'docker-' not in path:
        raise CgroupStale('Container PID is not in a Docker cgroup: ' + container)
    cgroup = Path(cgroup_root) / path.lstrip('/')
    if not cgroup.is_dir():
        raise CgroupStale('Container cgroup disappeared: ' + container)
    _cgroup_paths[key] = str(cgroup)
    return cgroup


def measured_usage(job, proc_root=Path('/proc'), cgroup_root=Path('/sys/fs/cgroup')):
    """Return resident memory.current for a running job's container cgroup."""
    cgroup = _container_cgroup(job, proc_root, cgroup_root)
    try:
        value = int((cgroup / 'memory.current').read_text().strip())
    except (OSError, ValueError) as error:
        raise CgroupUnavailable('Container memory.current unreadable: ' + str(error))
    if value < 0:
        raise CgroupUnavailable('Container memory.current is invalid')
    return value


def reserved_memory(job, state, reservation=None, measure=None):
    """Reserve only headroom MemAvailable does not already include.

    Running jobs already contribute their resident usage to MemAvailable, so
    their reservation is the declared budget remaining above memory.current.
    Prepared or unstarted reservations stay at their full recorded amount.
    Unreadable or stale cgroup state fails closed to the full declared budget.
    """
    if state == 'prepared':
        value = reservation if reservation is not None else memory_required(job)
        if value is None:
            return memory_available()
        return max(0, int(value))
    if state != 'running':
        return 0
    budget = memory_required(job)
    if budget is None:
        # Unknown running scene usage consumes all available admission headroom.
        return memory_available()
    if budget <= 0:
        return 0
    try:
        usage = (measure or measured_usage)(job)
    except CgroupUnavailable:
        return budget
    return max(0, budget - max(0, int(usage)))

def slot_limits():
    limit=farm.CONFIG.get('gpu_jobs_per_gpu',farm.CONFIG['workers_per_gpu'])
    if not isinstance(limit,int) or limit<1:raise ValueError('gpu_jobs_per_gpu must be positive')
    return {g['uuid']:limit for g in pool()}


def slot_costs(job,gpus):
    request=json.loads((job/'request.json').read_text())
    if request.get('kind')=='gpu':return {g['uuid']:1 for g in gpus}
    if request.get('scene') in farm.CONFIG.get('scene_exclusive_gpu',[]):
        return {g['uuid']:slot_limits()[g['uuid']] for g in gpus}
    from collections import Counter
    checkpoint=job/'prepared.json'
    ranges=json.loads(checkpoint.read_text()).get('ranges',[]) if checkpoint.exists() else []
    return dict(Counter(r['gpu']['uuid'] for r in ranges)) or {g['uuid']:slot_limits()[g['uuid']] for g in gpus}


def select(job, occupied, unavailable=frozenset()):
    request = json.loads((job / 'request.json').read_text())
    limits=slot_limits()
    used=occupied if hasattr(occupied,'get') else {u:limits[u] for u in occupied}
    if request.get('kind') == 'gpu':
        candidates = farm.CONFIG.get('gpu_job_gpus', farm.CONFIG['gpus'])
        count = request['gpu_count']
        free = sorted((g for g in candidates if used.get(g['uuid'],0)<limits[g['uuid']] and g['uuid'] not in unavailable), key=lambda g:(used.get(g['uuid'],0)/limits[g['uuid']],g['label']))
        return free[:count] if len(free) >= count else None
    checkpoint = job / 'prepared.json'
    if checkpoint.exists():
        ranges = json.loads(checkpoint.read_text()).get('ranges', [])
        wanted = {r['gpu']['uuid'] for r in ranges}
    else:
        wanted = set()
    if not wanted:
        wanted = {g['uuid'] for g in farm.CONFIG['gpus']}
    cards = {g['uuid']: g for g in pool()}
    if not wanted <= cards.keys():
        raise ValueError('Prepared scene requests an unconfigured GPU')
    chosen=[cards[u] for u in cards if u in wanted]
    costs=slot_costs(job,chosen)
    return chosen if not wanted & set(unavailable) and all(used.get(u,0)+costs.get(u,0)<=limits[u] for u in wanted) else None


from contextlib import contextmanager
import fcntl


@contextmanager
def admission_guard():
    root=Path(farm.CONFIG.get('coordinator_root',farm.JOBS.parent))
    with (root/'admission.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        yield


def process_start(pid):
    try:return Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
    except (OSError,IndexError):return None


def reserve(job,amount):
    prepared=job/'prepared.json'
    farm.write(job/'admission.json',dict(memory_bytes=amount,
        prepared_sha256=farm.file_sha256(prepared) if prepared.is_file() else None,
        boot_id=farm.boot_id(),owner_pid=os.getpid(),owner_start=process_start(os.getpid())))


def external_reserved():
    root=Path(farm.CONFIG.get('coordinator_root',farm.JOBS.parent));total=0
    directories=[root/'jobs',*root.glob('lanes/*/jobs')]
    for directory in directories:
        if directory.resolve()==farm.JOBS.resolve():continue
        for p in directory.glob('*/status.json'):
            s=json.loads(p.read_text());job=p.parent
            if s.get('execution_boot_id') not in (None,farm.boot_id()):continue
            marker=job/'admission.json'
            if s.get('state') == 'running':
                total += reserved_memory(job, 'running')
            elif s.get('state') == 'prepared' and marker.exists():
                d = json.loads(marker.read_text())
                if d.get('boot_id') == farm.boot_id() and d.get('owner_start') and process_start(d['owner_pid']) == d['owner_start']:
                    total += reserved_memory(job, 'prepared', reservation=d['memory_bytes'])
    return total
