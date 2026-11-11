#!/usr/bin/env python3
"""Render-farm queue: check a render job out, render it, check it back in with its outputs in the archive (2 Oct).

Any machine can be a farm: the studio posts jobs, a remote worker (the client's render server, a cloud session)
claims one, renders it with the pipeline's own scripts and delivers the files. The queue is a folder of small JSON
files, farm/jobs/<id>.json, on main of the PIPELINE repo (flip-engineer/automated-content-pipeline); the outputs go
to the ARCHIVE repo (flip-engineer/automated-content-pipeline-video-studies-archive) under farm/<id>/. Every change is
one small commit pushed to main. A push only lands on top of what it read, so two workers claiming the same job can't
both win: the loser's push is refused, it re-reads and sees the job taken. Nothing here touches a working tree; both
repos are reached through small blobless caches (FARM_CACHE, default ~/.cache/acp-farm).

  farm.py list [--state open|claimed|done|failed|all]          what is queued (default: everything not done)
  farm.py show ID                                               one job, whole
  farm.py post --title T --run "CMD" [--run "CMD" ...] [--out PATH ...] [--piece P] [--notes N] [--by NAME]
                                                                queue a job (prints its id); CMDs run from the
                                                                pipeline repo root at --commit (default: main now)
  farm.py claim [ID] --by NAME [--lease H]                      take ID, or the oldest open job (or one whose lease
                                                                ran out); exit 3 if there is nothing to take
  farm.py touch ID --by NAME [--note N]                         still working: renews the lease (default 4 h)
  farm.py deliver ID --by NAME FILE [FILE ...] [--note N]       push the files to the archive's farm/<ID>/ (over 95 MB
                                                                split into .partNN, sha256 in farm/<ID>/MANIFEST.json)
                                                                and mark the job done
  farm.py fail ID --by NAME --why W                             give up, with the reason (the log tail helps)
  farm.py release ID --by NAME                                  put it back as open, unrendered
  farm.py post ... --retry-of ID                              (a worker reposting a fixed retry names the original)
  farm.py render SCENE:CLOSER[:BPM] [...] --by NAME [--piece P] [--title T] [--no-sync]
                                                                (studio) the whole loop in one step: sync_repo.sh, one job per
                                                                spec, wait (following retries), fetch the share, sheet, finish
                                                                report and receipt to videos/out/farm/<id>/ (masters stay in the
                                                                archive; --only to choose). A 45 s scene takes ~5 min on the farm.
  farm.py wait ID [--timeout S]                                 block until done/failed (follows a worker's retry)
  farm.py fetch ID [--to DIR] [--only NAME]                                   (studio side) download a delivery, parts rejoined,
                                                                sha256 checked; default DIR videos/out/farm/<ID>/
  farm.py gpu --blender videos/blender/S.py | --python videos/gpu/S.py [--gpus N] [--per-gpu] [--time MIN] [--mem GB]
              [--device cuda|optix] [--blend FILE] [--commit SHA | --main] [--no-wait] [--to DIR] --by NAME [-- ARGS]
                                                                (studio) a GPU job (FARMGPU, 3 Oct): posts
                                                                `sh videos/scripts/gpu_job.sh KIND SCRIPT --id <id> ...` pinned to
                                                                the commit (default: this checkout's HEAD, which must be pushed),
                                                                waits, fetches the delivery to videos/out/gpu/<id>/ (the out tree
                                                                rebuilt from receipt.json). Needs a worker that runs gpu_job.sh
                                                                (research/capabilities/farm_gpu.md); farm_gpu.py commits a lane's
                                                                uncommitted files first.

The studio publishes a delivered video as the piece's next version with publish.sh, as with any render.
PIPE_URL / ARCH_URL override the two repos. Docs: research/capabilities/farm.md.
"""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time

from farm_dependencies import normalize as normalize_dependencies, parse as parse_dependencies

PIPE = os.environ.get('PIPE_URL', 'https://github.com/flip-engineer/automated-content-pipeline.git')
ARCH = os.environ.get('ARCH_URL', 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive.git')
CACHE = os.path.expanduser(os.environ.get('FARM_CACHE', '~/.cache/acp-farm'))
PART = 95 * 1000 * 1000
LEASE_H = 4.0


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def age_h(ts):
    t = datetime.datetime.strptime(ts, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc)
    return (datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() / 3600


class Repo:
    """A bare, blobless, depth-1 cache of one repo's main. Blobs come down only when read."""
    def __init__(self, url, name):
        self.url, self.dir = url, os.path.join(CACHE, name)
        if not self.made():
            self.make()

    def made(self):
        return os.path.isfile(os.path.join(self.dir, 'HEAD')) and subprocess.run(
            ['git', '--git-dir', self.dir, 'config', 'remote.origin.url'], capture_output=True).returncode == 0

    def make(self):
        """The cache is built in a sibling temp dir and renamed into place, so a farm.py that dies mid-init, or two that race,
        never leave a half-made cache (one held only `config`, and every later fetch failed until FARM_CACHE was moved)."""
        os.makedirs(CACHE, exist_ok=True)
        tmp = tempfile.mkdtemp(prefix='.%s.' % os.path.basename(self.dir), dir=CACHE)
        for a in (('init', '-q', '--bare'), ('remote', 'add', 'origin', self.url), ('config', 'remote.origin.promisor', 'true'),
                  ('config', 'remote.origin.partialclonefilter', 'blob:none')):
            subprocess.run(['git', '--git-dir', tmp] + list(a), check=True, capture_output=True)
        if os.path.exists(self.dir) and not self.made():    # a half-made cache left by an older farm.py: move it aside, then drop it
            junk = tempfile.mkdtemp(prefix='.%s.junk.' % os.path.basename(self.dir), dir=CACHE)
            try:
                os.rename(self.dir, os.path.join(junk, 'x'))
            except OSError:
                pass
            shutil.rmtree(junk, ignore_errors=True)
        try:
            os.rename(tmp, self.dir)
        except OSError:                                     # another process put its cache in place first: use that one
            shutil.rmtree(tmp, ignore_errors=True)
            if not self.made():
                raise

    def git(self, *a, inp=None, env=None):
        e = dict(os.environ, GIT_LFS_SKIP_SMUDGE='1', **(env or {}))
        for k in range(6):          # several farm.py processes share this cache: a concurrent fetch can race on the shallow file or a lock
            r = subprocess.run(['git', '--git-dir', self.dir] + list(a), input=inp, capture_output=True, env=e)
            err = r.stderr.decode(errors='replace')
            if r.returncode and ('shallow file has changed' in err or '.lock' in err) and k < 5:
                time.sleep(1.5 + 2 * k); continue
            break
        if r.returncode:
            raise RuntimeError('git %s: %s' % (a[0], r.stderr.decode(errors='replace').strip()))
        return r.stdout

    def head(self):
        # (8 Oct) into a ref, not FETCH_HEAD: with a dozen farm.py waits polling one cache, a concurrent fetch rewrites FETCH_HEAD
        # while another reads it ('git rev-parse: ... FETCH_HEAD'); a ref is updated under its lock and renamed into place
        for k in range(4):
            try:
                self.git('fetch', '-q', '--filter=blob:none', '--depth=1', 'origin', '+main:refs/remotes/origin/main')
                return self.git('rev-parse', '--verify', 'refs/remotes/origin/main^{commit}').decode().strip()
            except RuntimeError:
                if k == 3:
                    raise
                time.sleep(1 + 2 * k)

    def ls(self, rev, prefix):
        out = self.git('ls-tree', '-r', '-l', rev, '--', prefix).decode()
        rows = []
        for line in out.splitlines():
            meta, path = line.split('\t', 1)
            _, _, sha, size = meta.split()
            rows.append((path, sha, int(size) if size.isdigit() else 0))
        return rows

    def read(self, rev, path):
        return self.git('cat-file', 'blob', '%s:%s' % (rev, path))

    def commit(self, parent, files, msg):
        """files: {repo_path: local_file_path or bytes}. One commit on parent; returns True if the push landed."""
        with tempfile.TemporaryDirectory() as td:
            env = {'GIT_INDEX_FILE': os.path.join(td, 'index')}
            self.git('read-tree', parent, env=env)
            info = []
            for path, src in files.items():
                if isinstance(src, bytes):
                    sha = self.git('hash-object', '-w', '--stdin', inp=src).decode().strip()
                else:
                    sha = self.git('hash-object', '-w', src).decode().strip()
                info.append('100644 %s\t%s' % (sha, path))
            self.git('update-index', '--index-info', inp=('\n'.join(info) + '\n').encode(), env=env)
            tree = self.git('write-tree', '--missing-ok', env=env).decode().strip()
            c = self.git('-c', 'user.name=' + os.environ.get('FARM_NAME', 'farm'),
                         '-c', 'user.email=' + os.environ.get('FARM_EMAIL', 'farm@users.noreply.github.com'),
                         'commit-tree', tree, '-p', parent, inp=msg.encode()).decode().strip()
        try:
            self.git('push', '-q', 'origin', '%s:refs/heads/main' % c)
            return True
        except RuntimeError as err:
            if re.search(r'rejected|non-fast-forward|fetch first|stale', str(err)):
                return False
            raise


def drop(repo):
    shutil.rmtree(repo.dir, ignore_errors=True)


def jobpath(i):
    return 'farm/jobs/%s.json' % i


def load_jobs(pipe, rev):
    return {os.path.basename(p)[:-5]: (p, sha) for p, sha, _ in pipe.ls(rev, 'farm/jobs') if p.endswith('.json')}


def get(pipe, rev, i):
    return json.loads(pipe.read(rev, jobpath(i)))


def dump(job):
    return (json.dumps(job, indent=2) + '\n').encode()


def takeable(job):
    if job['state'] == 'open':
        return True
    return job['state'] == 'claimed' and age_h(job['claim']['until']) > 0


def change(pipe, i, fn, msg):
    """Read job i on the newest main, let fn edit it (fn returns an error string to refuse), push; retry on a race."""
    for _ in range(6):
        rev = pipe.head()
        job = get(pipe, rev, i)
        err = fn(job)
        if err:
            sys.exit('farm: %s: %s' % (i, err))
        job.setdefault('history', []).append({'at': now(), 'event': msg})
        if pipe.commit(rev, {jobpath(i): dump(job)}, 'farm: %s %s' % (i, msg)):
            return job
        time.sleep(2)
    sys.exit('farm: %s: main kept moving; try again' % i)


def mine(job, by):
    if job['state'] != 'claimed' or job['claim']['by'] != by:
        return 'not claimed by %s (state %s%s)' % (by, job['state'],
                                                    ', by ' + job['claim']['by'] if job.get('claim') else '')


def lease(h):
    return (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=h)).strftime('%Y-%m-%dT%H:%M:%SZ')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


HERE = os.path.dirname(os.path.abspath(__file__))


def lint_runs(runs):
    """8 Oct: static scene lint (tools/scene_lint.mjs: load-order TDZ, imports, asset paths) for every scene a job's commands render, so a
    load-time crash is caught before a job waits hours in the queue. Returns (ok, report)."""
    import re
    scenes = []
    for r in runs:
        m = re.search(r'local_render\.sh\s+(?:--[a-z-]+\s+)*([A-Za-z0-9_]+):', r) or re.search(r'stills_quick\.sh\s+([A-Za-z0-9_]+)\s', r) or re.search(r'render\.mjs\s+([A-Za-z0-9_]+)', r)
        if m and m.group(1) not in scenes:
            scenes.append(m.group(1))
    if not scenes:
        return True, ''
    tool = os.path.join(HERE, '..', 'tools', 'scene_lint.mjs')
    try:
        r = subprocess.run(['node', tool] + scenes, capture_output=True, text=True, timeout=120)
    except Exception as e:      # no node, a hung parse: never block a post on the linter itself
        return True, 'scene_lint not run: %s' % e
    rep = (r.stdout + r.stderr).strip()
    if r.returncode and ('MODULE_NOT_FOUND' in rep or 'Cannot find module' in rep) and 'scene_lint.mjs' in rep:
        return True, 'scene_lint not run (its parser is not installed on this machine)'    # the linter itself could not load
    return r.returncode == 0, rep


def post_job(pipe, title, run, piece, by, notes, commit, retry_of, outs, dependencies=None):
    dependencies = normalize_dependencies(dependencies)
    if commit and not re.fullmatch(r'[0-9a-f]{40}', commit):
        # (8 Oct) the worker fails any job whose pipeline commit is not a full 40-character SHA: expand a short one here
        rc, full = local_git('rev-parse', '--verify', '--quiet', commit + '^{commit}')
        if rc or not re.fullmatch(r'[0-9a-f]{40}', full):
            sys.exit('farm post: --commit %s is not a commit this checkout knows; pass the full SHA' % commit)
        commit = full
    i = datetime.datetime.now().strftime('%m%d-%H%M%S') + '-' + re.sub(r'[^a-z0-9]+', '_', title.lower())[:32].strip('_')
    run, outs = [r.replace('{id}', i) for r in run], [o.replace('{id}', i) for o in outs]     # a gpu job names its own id
    for _ in range(6):
        rev = pipe.head()
        job = {'id': i, 'title': title, 'piece': piece, 'posted_by': by, 'posted_at': now(),
               'pipeline_commit': commit or rev, 'run': run, 'outputs': outs, 'notes': notes,
               'state': 'open', 'claim': None, 'delivery': None, 'retry_of': retry_of or None,
               'dependencies': dependencies,
               'history': [{'at': now(), 'event': 'posted by %s' % by}]}
        if pipe.commit(rev, {jobpath(i): dump(job)}, 'farm: post %s\n\n%s' % (i, title)):
            return i
        time.sleep(2)
    sys.exit('farm post: main kept moving; try again')


def retry_of(j):
    return j.get('retry_of') or (re.match(r'Retry of (\S+?)\.?\s', (j.get('notes') or '') + ' ') or [None, None])[1]


def wait_job(pipe, i, timeout):
    """Poll until job i (or the retry a worker posted for it) is done or failed; None on timeout."""
    t0 = time.time(); next_note = 300
    while time.time() - t0 < timeout:
        rev = pipe.head()
        j = get(pipe, rev, i)
        if j['state'] == 'failed':
            # a worker that fixed the failure reposts it; follow the retry if there is one
            for k in sorted(load_jobs(pipe, rev)):
                if k != i and retry_of(get(pipe, rev, k)) == i:
                    print('farm: %s failed; following its retry %s' % (i, k))
                    return wait_job(pipe, k, timeout - (time.time() - t0))
            if time.time() - t0 > 180:                      # a worker gets a few minutes to post its retry
                return j
        elif j['state'] == 'done':
            return j
        if time.time() - t0 >= next_note:                    # a line every 5 min so a long wait is not silent
            next_note += 300
            ahead = sum(1 for k in load_jobs(pipe, rev) if k < i and get(pipe, rev, k)['state'] == 'open') if j['state'] == 'open' else 0
            print('farm: %s %s%s (%d min)' % (i, j['state'], ', %d open ahead' % ahead if j['state'] == 'open' else '', (time.time() - t0) / 60), flush=True)
        time.sleep(20)
    return None


def fetch_job(i, to, only):
    arch = Repo(ARCH, 'arch-%d' % os.getpid()); rev = arch.head()   # (8 Oct) private: a shared 'arch' was dropped under concurrent fetches
    man = json.loads(arch.read(rev, 'farm/%s/MANIFEST.json' % i))
    to = to or os.path.join(os.path.dirname(HERE), 'out', 'farm', i)
    os.makedirs(to, exist_ok=True)
    for f in man['files']:
        if only and not any(o in f['name'] for o in only):
            continue
        dst = os.path.join(to, f['name'])
        if os.path.exists(dst) and sha256(dst) == f['sha256']:
            print('have', dst); continue
        with open(dst, 'wb') as o:
            for p in (f['parts'] or [f['name']]):
                o.write(arch.read(rev, 'farm/%s/%s' % (i, p)))
        print(('ok  ' if sha256(dst) == f['sha256'] else 'BAD ') + dst)
    drop(arch)  # the cache keeps nothing big: the next run refetches the tree (about 1 MB)
    gpu_tree(to)
    return to


def gpu_tree(to):
    """a gpu_job delivery is flat (a/b.png came as a__b.png): put each output back at out/<its path> (from receipt.json);
    receipt.json and the logs stay at the top"""
    rp = os.path.join(to, 'receipt.json')
    try:
        r = json.load(open(rp))
    except (OSError, ValueError):
        return
    if r.get('kind') not in ('blender', 'python') or not isinstance(r.get('files'), list):
        return
    base = os.path.join(os.path.abspath(to), 'out')
    for f in r['files']:
        src, dst = os.path.join(to, f['name']), os.path.normpath(os.path.join(base, f['path']))
        if not os.path.isfile(src) or not dst.startswith(base + os.sep):
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.replace(src, dst)


def gpu_summary(to):
    try:
        r = json.load(open(os.path.join(to, 'receipt.json')))
    except (OSError, ValueError):
        print('farm gpu: no receipt.json in %s' % to); return
    gp = ', '.join('%s (%s MiB peak)' % (g['name'], (r.get('gpu_usage') or {}).get(g['uuid'], {}).get('peak_memory_mib'))
                   for g in r.get('gpus') or []) or 'no GPU'
    print('farm gpu: %s %s %s: %s; run %s s, total %s s; %s; %d file(s) in %s' % (
        r.get('job'), r.get('kind'), r.get('script'), r.get('status'), (r.get('seconds') or {}).get('run'),
        (r.get('seconds') or {}).get('total'), gp, len(r.get('files') or []), os.path.join(to, 'out')))
    for w in r.get('warnings') or []:
        print('farm gpu: WARNING ' + w)


def queue_report(pipe, watch, by_hours=24):
    """Is the farm taking work? Counts, where the given jobs stand, and when a worker last claimed/delivered.
    Newest-first read of jobs, so it stops once the last day of activity is known."""
    rev = pipe.head()
    ids = sorted(load_jobs(pipe, rev))
    jobs = {}
    for i in reversed(ids):                                  # ids start with MMDD-HHMMSS: newest first
        j = get(pipe, rev, i)
        jobs[i] = j
        if j['state'] == 'done' and len(jobs) > 400 and i < min(list(watch) + [ids[-1]]):
            break
    open_ids = sorted(i for i, j in jobs.items() if takeable(j) and j['state'] == 'open')
    claimed = sorted(i for i, j in jobs.items() if j['state'] == 'claimed')
    events = []
    for i, j in jobs.items():
        if j.get('claim') and j['claim'].get('by') not in (None, 'studio') and j['claim'].get('at'):
            events.append((j['claim']['at'], 'claimed', i, j['claim']['by']))
        if j.get('delivery') and j['delivery'].get('at'):
            events.append((j['delivery']['at'], 'delivered', i, j['delivery'].get('by', '')))
    events.sort()
    out = ['farm queue @ %s: %d open, %d claimed, %d jobs read' % (now(), len(open_ids), len(claimed), len(jobs))]
    if events:
        for kind in ('claimed', 'delivered'):
            e = [x for x in events if x[1] == kind]
            if e:
                out.append('last %-9s %s  (%.1f h ago)  %s by %s' % (kind, e[-1][0], age_h(e[-1][0]), e[-1][2], e[-1][3]))
    for i in claimed:
        c = jobs[i]['claim']
        out.append('  running  %-44s %s since %s, lease %s' % (i, c['by'], c['at'], 'EXPIRED' if age_h(c['until']) > 0 else 'until ' + c['until']))
    for w in watch:
        j = jobs.get(w)
        if not j:
            out.append('  %s: not found' % w); continue
        if j['state'] == 'open':
            ahead = sum(1 for k in open_ids if k < w)
            out.append('  %s: open, %d open job(s) ahead of it, posted %s (%.1f h ago)' % (w, ahead, j.get('posted_at', '?'), age_h(j['posted_at']) if j.get('posted_at') else 0))
        else:
            out.append('  %s: %s' % (w, j['state']))
    last = events[-1][0] if events else None
    if open_ids and (not last or age_h(last) > 2):
        out.append('VERDICT: STALLED - %d open, nothing claimed or delivered for %s. Rendering waits; do not render here.' % (len(open_ids), '%.1f h' % age_h(last) if last else 'the whole window'))
    elif open_ids:
        out.append('VERDICT: moving - a worker was active %.1f h ago; queue is %d deep.' % (age_h(last), len(open_ids)))
    else:
        out.append('VERDICT: empty queue')
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['list', 'show', 'post', 'claim', 'touch', 'deliver', 'fail', 'release', 'fetch', 'wait', 'render', 'gpu', 'queue'])
    ap.add_argument('--no-lint', action='store_true', help='post without the static scene lint (tools/scene_lint.mjs)')
    ap.add_argument('args', nargs='*')
    ap.add_argument('--by', default=os.environ.get('FARM_BY', 'studio'))
    ap.add_argument('--state', default='')
    ap.add_argument('--title'); ap.add_argument('--piece', default='')
    ap.add_argument('--run', action='append', default=[]); ap.add_argument('--out', action='append', default=[])
    ap.add_argument('--notes', default=''); ap.add_argument('--note', default=''); ap.add_argument('--why', default='')
    ap.add_argument('--commit', default=''); ap.add_argument('--lease', type=float, default=LEASE_H)
    ap.add_argument('--to', default='')
    ap.add_argument('--only', action='append', default=[], help='fetch/render: only files whose name contains this (repeatable)')
    ap.add_argument('--timeout', type=float, default=5400, help='wait/render: give up after this many seconds')
    ap.add_argument('--no-sync', action='store_true', help='render: skip sync_repo.sh (the scene is already on pipeline main)')
    ap.add_argument('--retry-of', default='', help='post: this job retries an earlier one (a worker that fixes a failure and reposts says so)')
    ap.add_argument('--blender', default='', help='gpu: a Blender job script under videos/blender/')
    ap.add_argument('--python', default='', help='gpu: a Python job script under videos/gpu/')
    ap.add_argument('--blend', default='', help='gpu: a committed .blend to open first (blender jobs)')
    ap.add_argument('--gpus', type=int, default=1); ap.add_argument('--per-gpu', action='store_true')
    ap.add_argument('--time', type=float, default=60, help='gpu: the job\'s time limit, minutes')
    ap.add_argument('--mem', type=float, default=24, help='gpu: host RAM limit, GB')
    ap.add_argument('--device', default='', help='gpu: cuda (default), optix or auto (blender jobs)')
    ap.add_argument('--main', action='store_true', help='gpu: pin the job to pipeline main (the script is on main)')
    ap.add_argument('--no-wait', action='store_true', help='gpu: post and stop (farm.py wait / fetch later)')
    ap.add_argument('--dependencies', default='{}', help='post/render: dependency JSON object or @local-file.json (python/system/npm lists)')
    argv = sys.argv[1:]
    passthru = []
    if argv[:1] == ['gpu'] and '--' in argv:                # gpu: everything after -- goes to the job script
        k = argv.index('--')
        argv, passthru = argv[:k], argv[k + 1:]
    a = ap.parse_intermixed_args(argv)
    try: a.dependencies = parse_dependencies(a.dependencies)
    except (ValueError,OSError) as error: ap.error(str(error))
    pipe = Repo(PIPE, 'pipe')

    if a.cmd == 'queue':
        print(queue_report(pipe, a.args))
        return

    # a unique prefix of a job id is enough for every command that names one (1008-223652 -> 1008-223652-bench_cam7_...)
    if a.args and a.cmd in ('show', 'claim', 'touch', 'deliver', 'fail', 'release', 'fetch', 'wait') and re.match(r'^\d{4}-\d', a.args[0]):
        ids0 = sorted(load_jobs(pipe, pipe.head()))
        if a.args[0] not in ids0:
            hit = [i for i in ids0 if i.startswith(a.args[0])]
            if len(hit) != 1: sys.exit('farm %s: %s matches %s' % (a.cmd, a.args[0], ', '.join(hit[:5]) or 'no job'))
            a.args[0] = hit[0]
    if a.cmd in ('list', 'show'):
        rev = pipe.head()
        ids = sorted(load_jobs(pipe, rev))
        if a.cmd == 'show':
            sys.stdout.write(pipe.read(rev, jobpath(a.args[0])).decode())
            return
        for i in ids:
            j = get(pipe, rev, i)
            st = j['state'] + ('(lease out)' if j['state'] == 'claimed' and takeable(j) else '')
            if a.state == 'all' or (a.state and j['state'] == a.state) or (not a.state and j['state'] != 'done'):
                who = j['claim']['by'] if j.get('claim') else ''
                # a retry names its original in retry_of (or, as the homelab's first one did, 'Retry of <id>' in notes)
                m = j.get('retry_of') or (re.match(r'Retry of (\S+?)\.?\s', j.get('notes', '') + ' ') or [None, None])[1]
                print('%-28s %-18s %-14s %s%s' % (i, st, who, j.get('title', ''), '  (retry of %s)' % m if m else ''))
        return

    if a.cmd == 'post':
        if not a.title or not a.run:
            sys.exit('farm post: --title and at least one --run')
        if not a.no_lint:
            ok, rep = lint_runs(a.run)
            if not ok:
                sys.exit('farm post: scene lint failed (fix it, or --no-lint):\n' + rep)
        print(post_job(pipe, a.title, a.run, a.piece, a.by, a.notes, a.commit, a.retry_of, a.out, a.dependencies))
        return

    if a.cmd == 'render':
        # the studio's one-step loop: push the project, post one job per spec, wait, fetch the light files to look at
        specs = a.args
        if not specs:
            sys.exit('farm render: SCENE:CLOSER[:BPM] ...')
        if not a.no_lint:
            ok, rep = lint_runs(['sh videos/scripts/local_render.sh --seg %s' % sp for sp in specs])
            if not ok:
                sys.exit('farm render: scene lint failed (fix it, or --no-lint):\n' + rep)
        if not a.no_sync:
            print('farm render: syncing the repo (pushes committed work; can take minutes) ...', flush=True)
            t_sync = time.time()
            r = subprocess.run(['sh', os.path.join(HERE, 'sync_repo.sh'), 'farm render: ' + ' '.join(specs)],
                               capture_output=True, text=True)
            print((r.stdout + r.stderr).strip().splitlines()[-1:] or '', 'sync took %d s' % (time.time() - t_sync), flush=True)
        ids = [post_job(pipe, a.title or 'render %s' % sp, ['sh videos/scripts/local_render.sh --seg %s' % sp], a.piece,
                        a.by, a.notes, a.commit, '', [], a.dependencies) for sp in specs]
        for i in ids:
            print('posted', i)
        only = a.only or ['_share.mp4', '_sheet.jpg', '.finish.json', 'receipt.json']
        for i in ids:
            j = wait_job(pipe, i, a.timeout)
            if j and j['state'] == 'done':
                fetch_job(j['id'], a.to, only)
            else:
                print('farm render: %s ended %s: %s' % (i, j['state'] if j else 'timeout',
                                                         ((j or {}).get('delivery') or {}).get('why', '')[-600:]))
        return

    if a.cmd == 'gpu':
        gpu(a, pipe, passthru)
        return

    if a.cmd == 'wait':
        j = wait_job(pipe, a.args[0], a.timeout)
        print(json.dumps({'id': j['id'], 'state': j['state'], 'delivery': j.get('delivery')} if j else {'state': 'timeout'}, indent=1))
        sys.exit(0 if j and j['state'] == 'done' else 1)

    if a.cmd == 'claim':
        i = a.args[0] if a.args else None
        if not i:
            rev = pipe.head()
            free = [k for k in sorted(load_jobs(pipe, rev)) if takeable(get(pipe, rev, k))]
            if not free:
                print('farm: nothing to take'); sys.exit(3)
            i = free[0]

        def take(j):
            if not takeable(j):
                return 'held by %s until %s' % (j['claim']['by'], j['claim']['until'])
            j['state'], j['claim'] = 'claimed', {'by': a.by, 'at': now(), 'until': lease(a.lease)}
        j = change(pipe, i, take, 'claimed by %s' % a.by)
        print(i); print(json.dumps({'run': j['run'], 'pipeline_commit': j['pipeline_commit'],
                                    'outputs': j['outputs'], 'notes': j['notes'],
                                    'dependencies': normalize_dependencies(j.get('dependencies'))}, indent=2))
        return

    i = a.args[0] if a.args else sys.exit('farm %s: which job?' % a.cmd)

    if a.cmd == 'touch':
        def t(j):
            e = mine(j, a.by)
            if not e: j['claim']['until'] = lease(a.lease)
            return e
        change(pipe, i, t, 'touch by %s%s' % (a.by, ': ' + a.note if a.note else '')); return

    if a.cmd == 'release':
        def r(j):
            e = mine(j, a.by)
            if not e: j['state'], j['claim'] = 'open', None
            return e
        change(pipe, i, r, 'released by %s' % a.by); return

    if a.cmd == 'fail':
        def f(j):
            e = mine(j, a.by)
            if not e: j['state'], j['delivery'] = 'failed', {'by': a.by, 'at': now(), 'why': a.why}
            return e
        change(pipe, i, f, 'failed (%s): %s' % (a.by, a.why[:200])); return

    if a.cmd == 'deliver':
        files = a.args[1:]
        if not files:
            sys.exit('farm deliver: which files?')
        rev = pipe.head(); e = mine(get(pipe, rev, i), a.by)
        if e:
            sys.exit('farm: %s: %s' % (i, e))
        arch = Repo(ARCH, 'arch-%d' % os.getpid())
        manifest, put, tmp = {'job': i, 'by': a.by, 'at': now(), 'note': a.note, 'files': []}, {}, tempfile.mkdtemp()
        for src in files:
            name, size = os.path.basename(src), os.path.getsize(src)
            ent = {'name': name, 'size': size, 'sha256': sha256(src), 'parts': []}
            if size <= PART:
                put['farm/%s/%s' % (i, name)] = src
            else:
                with open(src, 'rb') as f:
                    for n in range((size + PART - 1) // PART):
                        p = os.path.join(tmp, '%s.part%02d' % (name, n))
                        with open(p, 'wb') as o:
                            o.write(f.read(PART))
                        put['farm/%s/%s.part%02d' % (i, name, n)] = p
                        ent['parts'].append('%s.part%02d' % (name, n))
            manifest['files'].append(ent)
        put['farm/%s/MANIFEST.json' % i] = dump(manifest)
        for _ in range(6):
            if arch.commit(arch.head(), put, 'farm: deliver %s (%s)' % (i, a.by)):
                break
            time.sleep(2)
        else:
            sys.exit('farm deliver: archive main kept moving; try again')
        shutil.rmtree(tmp); drop(arch)

        def d(j):
            e = mine(j, a.by)
            if not e:
                j['state'] = 'done'
                j['delivery'] = {'by': a.by, 'at': now(), 'archive_dir': 'farm/%s/' % i, 'note': a.note,
                                 'files': [{k: f[k] for k in ('name', 'size', 'sha256')} for f in manifest['files']]}
            return e
        change(pipe, i, d, 'delivered by %s: %s' % (a.by, ', '.join(os.path.basename(f) for f in files)))
        print('delivered to archive farm/%s/' % i); return

    if a.cmd == 'fetch':
        fetch_job(i, a.to, a.only)
        return

def gpu_command(kind, script, a, passthru):
    """the run string for one gpu job; {id} is filled in by post_job"""
    import shlex
    cmd = ['sh', 'videos/scripts/gpu_job.sh', kind, script, '--id', '{id}']
    if a.gpus != 1:
        cmd += ['--gpus', str(a.gpus)]
    if a.per_gpu:
        cmd += ['--per-gpu']
    cmd += ['--time', '%g' % a.time, '--mem', '%g' % a.mem]
    if a.device:
        cmd += ['--device', a.device]
    if a.blend:
        cmd += ['--blend', a.blend]
    if passthru:
        cmd += ['--'] + passthru
    return ' '.join(c if c == '{id}' else shlex.quote(c) for c in cmd)


def local_git(*args):
    r = subprocess.run(['git'] + list(args), capture_output=True, text=True, cwd=os.path.dirname(os.path.dirname(HERE)))
    return r.returncode, r.stdout.strip()


def gpu(a, pipe, passthru):
    if bool(a.blender) == bool(a.python):
        sys.exit('farm gpu: --blender videos/blender/SCRIPT.py or --python videos/gpu/SCRIPT.py (one of them)')
    kind, script = ('blender', a.blender) if a.blender else ('python', a.python)
    script = script.lstrip('./') if script.startswith('./') else script
    under = 'videos/blender/' if kind == 'blender' else 'videos/gpu/'
    if not re.fullmatch(r'videos/(blender|gpu)/(?:[A-Za-z0-9_][A-Za-z0-9_.-]*/)*[A-Za-z0-9_][A-Za-z0-9_.-]*\.py', script) \
            or not script.startswith(under):
        sys.exit('farm gpu: %s must be a .py under %s, a plain relative path (the worker refuses anything else)' % (script, under))
    if a.main:
        commit = pipe.head()
        if not pipe.ls(commit, script):
            sys.exit('farm gpu: %s is not on pipeline main (%s)' % (script, commit[:9]))
    else:
        commit = a.commit
        if not commit:
            rc, commit = local_git('rev-parse', 'HEAD')
            rc2, remotes = local_git('branch', '-r', '--contains', commit)
            if rc or rc2 or not remotes.strip():
                sys.exit('farm gpu: this checkout\'s HEAD %s is not on the remote (as far as this clone knows): the worker could not '
                         'check it out. Push it, pass --commit SHA (a pushed commit) or --main, or use videos/scripts/farm_gpu.py, '
                         'which commits and pushes the lane\'s files.' % commit[:9])
        for p in [script] + ([a.blend] if a.blend else []):
            rc, _ = local_git('cat-file', '-e', '%s:%s' % (commit, p))
            if rc:
                sys.exit('farm gpu: %s is not committed at %s (the worker renders that commit)' % (p, commit[:9]))
    run = gpu_command(kind, script, a, passthru)
    title = a.title or 'gpu %s %s' % (kind, os.path.basename(script)[:-3])
    notes = a.notes or ('FARMGPU job: run it with the gpu_job.sh harness (research/capabilities/farm_gpu.md), %d GPU(s); deliver every '
                        'file in videos/out/gpu/<id>/deliver/ (receipt.json and log.txt included).' % a.gpus)
    i = post_job(pipe, title, [run], a.piece or 'GPU', a.by, notes, commit, '', ['videos/out/gpu/{id}/deliver/'])
    print('posted', i)
    print('  ' + run.replace('{id}', i))
    if a.no_wait:
        print('farm gpu: not waiting; later: farm.py wait %s && farm.py fetch %s --to videos/out/gpu/%s' % (i, i, i))
        return
    j = wait_job(pipe, i, a.timeout)
    if not j or j['state'] != 'done':
        sys.exit('farm gpu: %s ended %s: %s' % (i, j['state'] if j else 'timeout',
                                                 ((j or {}).get('delivery') or {}).get('why', '')[-800:]))
    to = fetch_job(j['id'], a.to or os.path.join(os.path.dirname(HERE), 'out', 'gpu', j['id']), a.only)
    gpu_summary(to)


if __name__ == '__main__':
    main()
