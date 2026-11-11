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
  farm.py deliver ID --by NAME FILE [FILE ...] [--note N]       push media through Git LFS and other files to the archive's farm/<ID>/ (large non-media files
                                                                split into .partNN, sha256 in farm/<ID>/MANIFEST.json)
                                                                and mark the job done after remote readback
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

The studio publishes a delivered video as the piece's next version with publish.sh, as with any render.
PIPE_URL / ARCH_URL override the two repos. Docs: research/capabilities/farm.md.
"""
import argparse, datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time
import lfs_archive

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
        if not os.path.isdir(self.dir):
            os.makedirs(self.dir)
            self.git('init', '-q', '--bare')
            self.git('remote', 'add', 'origin', url)
            self.git('config', 'remote.origin.promisor', 'true')
            self.git('config', 'remote.origin.partialclonefilter', 'blob:none')

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
        self.git('fetch', '-q', '--filter=blob:none', '--depth=1', 'origin', 'main')
        return self.git('rev-parse', 'FETCH_HEAD').decode().strip()

    def ls(self, rev, prefix):
        out = self.git('ls-tree', '-r', rev, '--', prefix).decode()
        rows = []
        for line in out.splitlines():
            meta, path = line.split('\t', 1)
            _, _, sha = meta.split()
            rows.append((path, sha, 0))
        return rows

    def prefetch(self, hashes):
        existing=set(self.git('cat-file', '--batch-all-objects',
                              '--batch-check=%(objectname)').decode().splitlines())
        missing=sorted(set(hashes)-existing)
        if missing:
            self.git('-c', 'fetch.negotiationAlgorithm=noop', 'fetch', 'origin',
                     '--no-tags', '--no-write-fetch-head', '--recurse-submodules=no',
                     '--filter=blob:none', '--stdin', inp=('\n'.join(missing)+'\n').encode())

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
    jobs={os.path.basename(p)[:-5]: (p, sha) for p, sha, _ in pipe.ls(rev, 'farm/jobs') if p.endswith('.json')}
    pipe.prefetch(sha for _,sha in jobs.values())
    return jobs


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


def post_job(pipe, title, run, piece, by, notes, commit, retry_of, outs, dependencies=None, reuse_audio_from=None):
    dependencies = normalize_dependencies(dependencies)
    if reuse_audio_from and (not re.fullmatch(r'[A-Za-z0-9_-]+', reuse_audio_from) or retry_of != reuse_audio_from):
        raise ValueError('Saved audio reuse must reference the retry source')
    i = datetime.datetime.now().strftime('%m%d-%H%M%S') + '-' + re.sub(r'[^a-z0-9]+', '_', title.lower())[:32].strip('_')
    run, outs = [r.replace("{id}", i) for r in run], [o.replace("{id}", i) for o in outs]
    for _ in range(6):
        rev = pipe.head()
        job = {'id': i, 'title': title, 'piece': piece, 'posted_by': by, 'posted_at': now(),
               'pipeline_commit': commit or rev, 'run': run, 'outputs': outs, 'notes': notes,
               'state': 'open', 'claim': None, 'delivery': None, 'retry_of': retry_of or None,
               'dependencies': dependencies,
               'history': [{'at': now(), 'event': 'posted by %s' % by}]}
        if reuse_audio_from:
            job['reuse_audio_from']=reuse_audio_from
        if pipe.commit(rev, {jobpath(i): dump(job)}, 'farm: post %s\n\n%s' % (i, title)):
            return i
        time.sleep(2)
    sys.exit('farm post: main kept moving; try again')


def retry_of(j):
    return j.get('retry_of') or (re.match(r'Retry of (\S+?)\.?\s', (j.get('notes') or '') + ' ') or [None, None])[1]


def wait_job(pipe, i, timeout):
    """Poll until job i (or the retry a worker posted for it) is done or failed; None on timeout."""
    t0 = time.time()
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
        time.sleep(20)
    return None


def is_lfs_media(name):
    return os.path.splitext(name)[1].lower() in {
        '.mp4', '.mov', '.m4v', '.webm', '.mkv',
        '.wav', '.flac', '.m4a', '.aac', '.mp3', '.ogg', '.opus'
    }


ARCHIVE_LFS_ATTRIBUTES = (
    b'farm/**/*.mp4 filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.mov filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.m4v filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.webm filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.mkv filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.wav filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.flac filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.m4a filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.aac filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.mp3 filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.ogg filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.opus filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[mM][pP]4 filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[mM][oO][vV] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[mM]4[vV] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[wW][eE][bB][mM] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[mM][kK][vV] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[wW][aA][vV] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[fF][lL][aA][cC] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[mM]4[aA] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[aA][aA][cC] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[mM][pP]3 filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[oO][gG][gG] filter=lfs diff=lfs merge=lfs -text\n'
    b'farm/**/*.[oO][pP][uU][sS] filter=lfs diff=lfs merge=lfs -text\n'
)


def archive_attributes(arch, rev):
    try:
        current = arch.read(rev, '.gitattributes')
    except RuntimeError:
        current = b''
    missing = [line for line in ARCHIVE_LFS_ATTRIBUTES.splitlines()
               if line not in current.splitlines()]
    if not missing:
        return current
    if current and not current.endswith(b'\n'):
        current += b'\n'
    return current + b'\n'.join(missing) + b'\n'


def copy_exact(source, destination, count, chunk_size=1 << 20):
    remaining = count
    while remaining:
        block = source.read(min(chunk_size, remaining))
        if not block:
            raise IOError('source ended while splitting an archive file')
        destination.write(block)
        remaining -= len(block)


def split_archive_file(src, temp_dir, name, size):
    parts = []
    with open(src, 'rb') as source:
        remaining = size
        index = 0
        while remaining:
            part_name = '%s.part%02d' % (name, index)
            part_path = os.path.join(temp_dir, part_name)
            count = min(PART, remaining)
            with open(part_path, 'wb') as output:
                copy_exact(source, output, count)
            parts.append((part_name, part_path))
            remaining -= count
            index += 1
    return parts


def deliver_job(pipe, identifier, by, files, note):
    current = get(pipe, pipe.head(), identifier)
    error = mine(current, by)
    if error:
        sys.exit('farm: %s: %s' % (identifier, error))
    names = [os.path.basename(path) for path in files]
    if len(set(names)) != len(names) or any(name in ('', '.', '..') for name in names):
        sys.exit('farm deliver: output basenames must be unique and non-empty')
    if any(name.casefold() == 'manifest.json' for name in names):
        raise RuntimeError('farm deliver: MANIFEST.json is a reserved archive manifest name')
    submitted_names = set(names)
    for src, name in zip(files, names):
        if not os.path.isfile(src):
            raise RuntimeError('farm deliver: output is not a regular file')
        size = os.path.getsize(src)
        if not is_lfs_media(name) and size > PART:
            part_count = (size + PART - 1) // PART
            for index in range(part_count):
                if '%s.part%02d' % (name, index) in submitted_names:
                    raise RuntimeError('farm deliver: generated archive part name collides with a submitted file')

    arch = Repo(ARCH, 'arch')
    manifest = {'job': identifier, 'by': by, 'at': now(), 'note': note, 'files': []}
    put = {}
    temp_dir = tempfile.mkdtemp()
    try:
        for src, name in zip(files, names):
            if not os.path.isfile(src):
                raise RuntimeError('farm deliver: output is not a regular file')
            size, digest = os.path.getsize(src), sha256(src)
            entry = {'name': name, 'size': size, 'sha256': digest, 'parts': []}
            archive_path = 'farm/%s/%s' % (identifier, name)
            if is_lfs_media(name):
                lfs_archive.upload_file(src, ARCH, digest, size)
                entry.update({'storage': 'lfs', 'lfs_oid': digest})
                put[archive_path] = lfs_archive.pointer(digest, size)
            elif size <= PART:
                put[archive_path] = src
            else:
                for part_name, part_path in split_archive_file(src, temp_dir, name, size):
                    put['farm/%s/%s' % (identifier, part_name)] = part_path
                    entry['parts'].append(part_name)
            manifest['files'].append(entry)

        put['farm/%s/MANIFEST.json' % identifier] = dump(manifest)
        archived = False
        for _ in range(6):
            parent = arch.head()
            put['.gitattributes'] = archive_attributes(arch, parent)
            if arch.commit(parent, put, 'farm: deliver %s (%s)' % (identifier, by)):
                archived = True
                break
            time.sleep(2)
        if not archived:
            raise RuntimeError('farm deliver: archive main kept moving; try again')

        remote_rev = arch.head()
        remote_manifest = json.loads(arch.read(remote_rev, 'farm/%s/MANIFEST.json' % identifier))
        if remote_manifest != manifest:
            raise RuntimeError('farm deliver: committed manifest differs from the submitted manifest')
        lfs_readback = []
        for entry in manifest['files']:
            if entry.get('storage') != 'lfs':
                continue
            pointer_data = arch.read(remote_rev, 'farm/%s/%s' % (identifier, entry['name']))
            oid, size = lfs_archive.parse_pointer(pointer_data)
            if oid != entry['lfs_oid'] or size != entry['size']:
                raise RuntimeError('farm deliver: committed LFS pointer differs from the manifest')
            lfs_archive.verify_remote(ARCH, oid, size)
            lfs_readback.append({'name': entry['name'], 'oid': oid, 'size': size, 'verified': True})

        receipt = {'archive_commit': remote_rev, 'archive_dir': 'farm/%s/' % identifier,
                   'lfs_readback': lfs_readback}
        def delivered(job):
            error = mine(job, by)
            if not error:
                job['state'] = 'done'
                job['delivery'] = {
                    'by': by, 'at': now(), 'archive_dir': receipt['archive_dir'], 'note': note,
                    'archive_commit': remote_rev, 'lfs_readback': lfs_readback,
                    'files': [{'name': f['name'], 'size': f['size'], 'sha256': f['sha256']}
                              for f in manifest['files']]
                }
            return error
        change(pipe, identifier, delivered,
               'delivered by %s: %s' % (by, ', '.join(names)))
        return receipt
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
        drop(arch)


def fetch_job(i, to, only):
    arch = Repo(ARCH, 'arch')
    try:
        rev = arch.head()
        manifest = json.loads(arch.read(rev, 'farm/%s/MANIFEST.json' % i))
        to = to or os.path.join(os.path.dirname(HERE), 'out', 'farm', i)
        os.makedirs(to, exist_ok=True)
        root = os.path.realpath(to)
        for entry in manifest['files']:
            name = entry.get('name', '')
            if not name or os.path.basename(name) != name or name in ('.', '..'):
                raise RuntimeError('farm fetch: invalid file name in archive manifest')
            if only and not any(value in name for value in only):
                continue
            dst = os.path.join(root, name)
            if os.path.exists(dst) and sha256(dst) == entry['sha256']:
                print('have', dst)
                continue
            if entry.get('storage') == 'lfs':
                pointer_data = arch.read(rev, 'farm/%s/%s' % (i, name))
                oid, pointer_size = lfs_archive.parse_pointer(pointer_data)
                if oid != entry.get('lfs_oid') or pointer_size != entry['size']:
                    raise RuntimeError('farm fetch: LFS pointer differs from the manifest')
                lfs_archive.download_verified(ARCH, oid, pointer_size, dst, entry['sha256'])
            else:
                descriptor, temp_path = tempfile.mkstemp(prefix='.archive-fetch-', dir=root)
                try:
                    with os.fdopen(descriptor, 'wb') as output:
                        for part in (entry.get('parts') or [name]):
                            output.write(arch.read(rev, 'farm/%s/%s' % (i, part)))
                    if os.path.getsize(temp_path) != entry['size'] or sha256(temp_path) != entry['sha256']:
                        raise RuntimeError('farm fetch: legacy payload failed size or SHA-256 validation')
                    os.replace(temp_path, dst)
                finally:
                    if os.path.exists(temp_path):
                        os.unlink(temp_path)
            print('ok  ' + dst)
    finally:
        drop(arch)



def repaired(j, by, commit, runs, outputs, dependencies, reason):
    if j['state']!='failed' or (j.get('delivery') or {}).get('by')!=by:
        return 'Repair requires this worker own the recorded failure'
    if not reason:return 'Repair reason required'
    if (j['pipeline_commit']!=commit or j['run']!=runs or j.get('outputs',[])!=outputs or
            normalize_dependencies(j.get('dependencies'))!=dependencies):
        return 'Pinned recipe changed; repair requires the original request'
    j.setdefault('repairs',[]).append({'at':now(),'by':by,'reason':reason,'failure':j['delivery']})
    j['state']='open';j['claim']=None;j['delivery']=None


def claim_available(pipe, by, hours):
    """Select a takeable job from each refreshed queue revision."""
    for _ in range(6):
        rev = pipe.head()
        jobs = [get(pipe, rev, key) for key in sorted(load_jobs(pipe, rev))]
        job = next((job for job in jobs if takeable(job)), None)
        if job is None:
            print('farm: nothing to take'); sys.exit(3)
        identifier = job['id']
        job['state'], job['claim'] = 'claimed', {'by': by, 'at': now(), 'until': lease(hours)}
        job.setdefault('history', []).append({'at': now(), 'event': 'claimed by '+by})
        if pipe.commit(rev, {jobpath(identifier): dump(job)}, 'farm: '+identifier+' claimed by '+by):
            return identifier, job
    sys.exit('farm: queue claims kept racing; try again')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['list', 'show', 'post', 'claim', 'touch', 'deliver', 'fail', 'release', 'repair', 'fetch', 'wait', 'render'])
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
    ap.add_argument('--reuse-audio-from', default='', help='post: reuse hash-verified audio from the linked retry source when audio source code is unchanged')
    ap.add_argument('--dependencies', default='{}', help='post/render: dependency JSON object or @local-file.json (python/system/npm lists)')
    a = ap.parse_intermixed_args()
    try: a.dependencies = parse_dependencies(a.dependencies)
    except (ValueError,OSError) as error: ap.error(str(error))
    pipe = Repo(PIPE, 'pipe')

    if a.cmd in ('list', 'show'):
        rev = pipe.head()
        if a.cmd == 'show':
            sys.stdout.write(pipe.read(rev, jobpath(a.args[0])).decode())
            return
        ids = sorted(load_jobs(pipe, rev))
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
        print(post_job(pipe, a.title, a.run, a.piece, a.by, a.notes, a.commit, a.retry_of, a.out, a.dependencies, a.reuse_audio_from))
        return

    if a.cmd == 'render':
        # the studio's one-step loop: push the project, post one job per spec, wait, fetch the light files to look at
        specs = a.args
        if not specs:
            sys.exit('farm render: SCENE:CLOSER[:BPM] ...')
        if not a.no_sync:
            r = subprocess.run(['sh', os.path.join(HERE, 'sync_repo.sh'), 'farm render: ' + ' '.join(specs)],
                               capture_output=True, text=True)
            print((r.stdout + r.stderr).strip().splitlines()[-1:] or '')
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

    if a.cmd == 'wait':
        j = wait_job(pipe, a.args[0], a.timeout)
        print(json.dumps({'id': j['id'], 'state': j['state'], 'delivery': j.get('delivery')} if j else {'state': 'timeout'}, indent=1))
        sys.exit(0 if j and j['state'] == 'done' else 1)

    if a.cmd == 'claim':
        i = a.args[0] if a.args else None
        def take(j):
            if not takeable(j):
                return 'held by %s until %s' % (j['claim']['by'], j['claim']['until'])
            j['state'], j['claim'] = 'claimed', {'by': a.by, 'at': now(), 'until': lease(a.lease)}
        if i:
            j = change(pipe, i, take, 'claimed by %s' % a.by)
        else:
            i, j = claim_available(pipe, a.by, a.lease)
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

    if a.cmd == 'repair':
        change(pipe,i,lambda j:repaired(j,a.by,a.commit,a.run,a.out,a.dependencies,a.note),'repair: '+a.note)
        return

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
        receipt = deliver_job(pipe, i, a.by, files, a.note)
        print('delivered to archive farm/%s/' % i)
        print(json.dumps(receipt, sort_keys=True))
        return

    if a.cmd == 'fetch':
        fetch_job(i, a.to, a.only)
        return

if __name__ == '__main__':
    main()
