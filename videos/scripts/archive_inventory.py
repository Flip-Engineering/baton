#!/usr/bin/env python3
"""Inventory every video we have produced, check the archive's LFS store, and publish whatever is missing.

Target: flip-engineer/automated-content-pipeline-video-studies-archive (the ARCHIVE). Rerunnable and idempotent: a second run prints
"nothing missing".

  python3 videos/scripts/archive_inventory.py                 # inventory + LFS check + upload what is missing
  python3 videos/scripts/archive_inventory.py --dry-run       # inventory + report only; nothing is pushed
  python3 videos/scripts/archive_inventory.py --report-json X # also write the full inventory to X

What it does
  1. Inventory every video file (mp4 mov webm m4v; m4a listening reels are "optional") from every source:
       archive-history  archive repo: main's tree + every commit on every branch (incl. import/history)
       pipeline         flip-engineer/automated-content-pipeline, all branches, full history (videos/out was tracked there)
       blog-posts       whargis/Blog-Posts (READ-ONLY: only ls-remote / local reads; never pushed). If the remote
                        is empty or unreachable the local clone /home/user/Blog-Posts is the source of truth.
       work-git         the work repo's own history (git rev-list --all --objects)
       work             files on disk in the work repo (videos/out incl. untracked + subfolders, review, ...)
       scratch          other local places (session scratchpad, /tmp, uploads). Reported; only finished pieces
                        (NAME_vN[_share].mp4) are ever uploaded.
     A video is identified by content: the LFS oid (sha256 from the pointer) for LFS pointers, else the sha256
     of the bytes. Blobs are only downloaded/hashed when their git blob id is not already known, and any pack
     fetched just to hash a blob is deleted straight after.
  2. Ask the archive's LFS batch API (download) whether every pointer in main + history exists on the server;
     upload the ones that do not (content from a local LFS store, the pipeline's LFS, a local file, or git).
  3. Publish everything whose hash is not in the archive's main tree under
       videos/out/recovered/<source>/<original path>
     through the archive's mechanism (an incoming/<id> branch with ops.sh `put` lines that the publish-videos
     Action applies, exactly like publish.sh, in batches of <= ~500 MB), and write videos/out/INVENTORY.md
     and videos/out/inventory.json into the archive.
Never rewrites history, never force-pushes, never pushes to whargis/Blog-Posts.
"""
import argparse, ast, hashlib, json, os, re, shutil, subprocess, sys, tempfile, time

VIDEO_EXT = ('.mp4', '.mov', '.webm', '.m4v')
OPT_EXT = ('.m4a',)
ALL_EXT = VIDEO_EXT + OPT_EXT
PTR_HEAD = b'version https://git-lfs.github.com/spec/v1'
ARCHIVE_URL = os.environ.get('ARCHIVE_URL', 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive')
PIPELINE_URL = 'https://github.com/flip-engineer/automated-content-pipeline'
BLOG_URL = 'https://github.com/whargis/Blog-Posts'
WORK = '/home/user/acp-agitprop'
SCRATCH = '/tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad'
DEFAULTS = dict(
    archive_clone='/home/user/automated-content-pipeline-video-studies-archive',
    pipeline_clone='/home/user/music-video-studies',
    blog_clone='/home/user/Blog-Posts',
    cache=os.environ.get('ARCHIVE_INV_CACHE', os.path.join(SCRATCH, 'inv')),
)
# priority for choosing which record supplies the path/bytes of a recovered file
PRIORITY = ['archive-history', 'pipeline', 'blog-posts', 'work', 'work-git', 'scratch']
FINISHED_RE = re.compile(r'^[A-Za-z0-9_]+_v\d+(_share)?\.(mp4|mov|webm|m4v)$')
NOENV = dict(os.environ, GIT_NO_LAZY_FETCH='1', GIT_LFS_SKIP_SMUDGE='1', GIT_TERMINAL_PROMPT='0')
LAZYENV = dict(os.environ, GIT_LFS_SKIP_SMUDGE='1', GIT_TERMINAL_PROMPT='0')
STATE = {}


LOGFILE = [None]


def log(*a):
    print(*a, file=sys.stderr, flush=True)
    if LOGFILE[0]:
        with open(LOGFILE[0], 'a') as f:
            print(time.strftime('%H:%M:%S'), *a, file=f)


def run(cmd, cwd=None, env=None, input=None, check=True, text=True):
    r = subprocess.run(cmd, cwd=cwd, env=env or NOENV, input=input, capture_output=True, text=text)
    if check and r.returncode:
        raise RuntimeError('%s failed (%d): %s' % (' '.join(cmd[:6]), r.returncode, (r.stderr or '')[-500:]))
    return r


def free_mb():
    s = os.statvfs('/')
    return s.f_bavail * s.f_frsize // 2**20


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def parse_pointer(data):
    if not data.startswith(PTR_HEAD) or len(data) > 1024:
        return None
    m = re.search(rb'oid sha256:([0-9a-f]{64})', data)
    s = re.search(rb'size (\d+)', data)
    return (m.group(1).decode(), int(s.group(1))) if m and s else None


def is_video(path, optional=True):
    p = path.lower()
    return p.endswith(ALL_EXT if optional else VIDEO_EXT)


# ---------------------------------------------------------------- hash cache (git blob id -> sha256)
def load_cache(cache):
    p = os.path.join(cache, 'blobhash.json')
    try:
        STATE['hc'] = json.load(open(p))
    except Exception:
        STATE['hc'] = {}
    STATE['hc_path'] = p


def save_cache():
    try:
        json.dump(STATE['hc'], open(STATE['hc_path'], 'w'))
    except Exception:
        pass


# ---------------------------------------------------------------- git sources
def refs_of(gitdir):
    out = run(['git', 'for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes', 'refs/tags'], cwd=gitdir).stdout.split()
    return [r for r in out if not r.endswith('/HEAD')]


def unquote(p):
    if p.startswith('"'):
        try:
            return ast.literal_eval(p).encode('latin1').decode('utf8')
        except Exception:
            return p
    return p


def pack_dir(gitdir):
    return run(['git', 'rev-parse', '--path-format=absolute', '--git-path', 'objects/pack'], cwd=gitdir).stdout.strip()


def ensure_blob(gitdir, oid):
    """Fetch one missing blob (promisor repo) into its own pack; returns the new pack names that hold only this blob."""
    pd = pack_dir(gitdir)
    before = set(os.listdir(pd))
    run(['git', 'cat-file', '-s', oid], cwd=gitdir, env=LAZYENV, check=False)  # lazy-fetches just this blob from the promisor remote
    mine = []
    for n in sorted(set(os.listdir(pd)) - before):
        if n.endswith('.idx'):
            r = subprocess.run(['git', 'show-index'], stdin=open(os.path.join(pd, n), 'rb'), capture_output=True, text=True)
            oids = {l.split()[1] for l in r.stdout.splitlines()}
            if oids <= {oid}:
                mine.append(n)
    return mine


def drop_packs(gitdir, names):
    pd = pack_dir(gitdir)
    for n in names:
        base = os.path.join(pd, n.rsplit('.', 1)[0])
        for ext in ('.pack', '.idx', '.rev', '.promisor', '.keep', '.bitmap'):
            try:
                os.unlink(base + ext)
            except FileNotFoundError:
                pass


def blob_info(gitdir, blobs):
    """blob -> dict(size, ptr=(oid,size)|None) ; missing blobs are fetched one by one when needed."""
    res = {}
    todo = sorted(blobs)
    p = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=gitdir, env=NOENV, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    missing = []
    gone = {l[1:] for l in run(['git', 'rev-list', '--all', '--objects', '--missing=print'], cwd=gitdir).stdout.splitlines() if l.startswith('?')}
    for oid in todo:
        if oid in gone:
            missing.append(oid); continue
        p.stdin.write((oid + '\n').encode()); p.stdin.flush()
        hdr = p.stdout.readline().split()
        if len(hdr) == 2 and hdr[1] == b'missing':
            missing.append(oid); continue
        size = int(hdr[2])
        data = p.stdout.read(size); p.stdout.read(1)
        res[oid] = dict(size=size, ptr=parse_pointer(data) if size <= 1024 else None)
    p.stdin.close(); p.wait()
    for oid in missing:
        packs = ensure_blob(gitdir, oid)
        r = run(['git', 'cat-file', '-s', oid], cwd=gitdir, check=False)
        if r.returncode:
            res[oid] = dict(size=None, ptr=None, missing=True); continue
        size = int(r.stdout)
        data = run(['git', 'cat-file', 'blob', oid], cwd=gitdir, text=False).stdout if size <= 1024 else b''
        ptr = parse_pointer(data) if size <= 1024 else None
        if size > 1024:
            h = hashlib.sha256()
            q = subprocess.Popen(['git', 'cat-file', 'blob', oid], cwd=gitdir, env=NOENV, stdout=subprocess.PIPE)
            for b in iter(lambda: q.stdout.read(1 << 20), b''):
                h.update(b)
            q.wait()
            STATE['hc'][oid] = h.hexdigest()
            drop_packs(gitdir, packs)  # delete the downloaded blob as soon as it is hashed
        res[oid] = dict(size=size, ptr=ptr)
    return res


def scan_git(source, gitdir, tips=None):
    """Return records for every video path/blob reachable from any ref of gitdir + per-ref tip trees."""
    log('scan git', source, gitdir)
    seen = {}  # (blob, path) -> dict(commit, n)
    log_out = run(['git', '-c', 'core.quotepath=false', 'log', '--all', '--no-renames', '--root', '-m', '--raw', '--no-abbrev', '--format=C%H'],
                  cwd=gitdir).stdout
    commit = None
    for line in log_out.splitlines():
        if line.startswith('C') and len(line) == 41:
            commit = line[1:]; continue
        if line.startswith(':'):
            meta, _, path = line.partition('\t')
            f = meta.split()
            path = unquote(path.split('\t')[0])
            if not is_video(path) or f[4][0] == 'D':
                continue
            blob = f[3]
            e = seen.setdefault((blob, path), dict(commit=commit, n=0))
            e['commit'] = commit; e['n'] += 1  # log is newest-first, so the last value is the oldest commit
    # completeness: anything rev-list finds that log did not (e.g. path first seen only via merges)
    objs = run(['git', 'rev-list', '--all', '--objects', '--missing=allow-any'], cwd=gitdir).stdout.splitlines()
    known = {b for b, _ in seen}
    for l in objs:
        oid, _, path = l.partition(' ')
        if path and is_video(path) and oid not in known:
            seen[(oid, path)] = dict(commit='', n=0)
    tiptrees = {}
    for ref in refs_of(gitdir):
        if tips is not None and ref not in tips:
            continue
        t = {}
        for l in run(['git', '-c', 'core.quotepath=false', 'ls-tree', '-r', '--full-tree', ref], cwd=gitdir).stdout.splitlines():
            meta, _, path = l.partition('\t')
            path = unquote(path)
            if is_video(path):
                t[path] = meta.split()[2]
        tiptrees[ref] = t
        for path, blob in t.items():
            seen.setdefault((blob, path), dict(commit='', n=0))
    info = blob_info(gitdir, {b for b, _ in seen})
    br_cache = {}

    def branches(c):
        if not c:
            return []
        if c not in br_cache:
            br_cache[c] = sorted(x.replace('refs/heads/', '').replace('refs/remotes/origin/', 'origin/') for x in run(
                ['git', 'for-each-ref', '--contains', c, '--format=%(refname)', 'refs/heads', 'refs/remotes'], cwd=gitdir).stdout.split()
                if not x.endswith('/HEAD'))
        return br_cache[c]
    recs = []
    for (blob, path), e in sorted(seen.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        i = info.get(blob, {})
        rec = dict(source=source, path=path, blob=blob, commit=e['commit'], branches=branches(e['commit']),
                   size=i.get('size'), optional=path.lower().endswith(OPT_EXT), gitdir=gitdir, kind='git')
        if i.get('missing'):
            rec['error'] = 'blob unavailable'
        elif i.get('ptr'):
            rec['sha256'], rec['size'] = i['ptr']; rec['lfs'] = True
        else:
            rec['lfs'] = False
            rec['sha256'] = STATE['hc'].get(blob)
        rec['tips'] = sorted(r for r, t in tiptrees.items() if t.get(path) == blob)
        recs.append(rec)
    return recs, tiptrees


def hash_git_blob(rec):
    """sha256 for a non-LFS blob whose hash is not cached yet (local read; blob may need fetching)."""
    gitdir, blob = rec['gitdir'], rec['blob']
    packs = []
    if run(['git', 'cat-file', '-e', blob], cwd=gitdir, check=False).returncode:
        packs = ensure_blob(gitdir, blob)
    h = hashlib.sha256()
    q = subprocess.Popen(['git', 'cat-file', 'blob', blob], cwd=gitdir, env=NOENV, stdout=subprocess.PIPE)
    for b in iter(lambda: q.stdout.read(1 << 20), b''):
        h.update(b)
    q.wait()
    STATE['hc'][blob] = h.hexdigest()
    drop_packs(gitdir, packs)
    return STATE['hc'][blob]


def remote_has_refs(url):
    r = run(['git', 'ls-remote', '--heads', url], check=False, env=LAZYENV)
    return r.returncode == 0 and bool(r.stdout.strip())


def bare_clone(url, dest):
    """separate blobless-ish bare clone (small blobs = LFS pointers included, big blobs omitted), full history."""
    if not os.path.isdir(dest):
        run(['git', 'clone', '--bare', '--filter=blob:limit=2k', url, dest], env=LAZYENV)
        run(['git', 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*'], cwd=dest)
    run(['git', 'fetch', '-q', '--prune', '--filter=blob:limit=2k', 'origin'], cwd=dest, env=LAZYENV)
    if run(['git', 'rev-parse', '--is-shallow-repository'], cwd=dest).stdout.strip() == 'true':
        run(['git', 'fetch', '-q', '--unshallow', '--filter=blob:limit=2k', 'origin'], cwd=dest, env=LAZYENV)
    return dest


# ---------------------------------------------------------------- local files
def scan_files(source, root, cls, skip=(), settle=0):
    recs = []
    now = time.time()
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in ('.git', 'node_modules', '__pycache__') and os.path.join(dp, d) not in skip]
        for f in fn:
            if not is_video(f):
                continue
            p = os.path.join(dp, f)
            try:
                st = os.stat(p)
            except OSError:
                continue
            if not os.path.isfile(p):
                continue
            rec = dict(source=source, path=os.path.relpath(p, root), abspath=p, size=st.st_size, kind='file', cls=cls,
                       optional=f.lower().endswith(OPT_EXT), lfs=False,
                       mtime=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(st.st_mtime)))
            if settle and now - st.st_mtime < settle * 60:
                rec['in_progress'] = True
            head = open(p, 'rb').read(1100) if st.st_size <= 1024 else b''
            ptr = parse_pointer(head) if head else None
            if ptr:
                rec['sha256'], rec['size'], rec['lfs'], rec['pointer_file'] = ptr[0], ptr[1], True, True
            else:
                key = 'f:%s:%d:%d' % (p, st.st_size, int(st.st_mtime))
                h = STATE['hc'].get(key)
                if not h:
                    h = sha256_file(p); STATE['hc'][key] = h
                rec['sha256'] = h
            recs.append(rec)
    return recs


# ---------------------------------------------------------------- LFS
def cred_header(url):
    if 'cred' not in STATE:
        r = run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', check=False, env=LAZYENV)
        d = dict(l.split('=', 1) for l in r.stdout.splitlines() if '=' in l)
        import base64
        STATE['cred'] = 'Authorization: Basic ' + base64.b64encode(('%s:%s' % (d.get('username', ''), d.get('password', ''))).encode()).decode() if d.get('password') else None
    return STATE['cred']


def lfs_batch(repo_url, objs, op='download'):
    """objs: [(oid,size)] -> {oid: (exists, action_or_None)}; tries anonymously first, then with git's credential."""
    out = {}
    objs = sorted(set(objs))
    for i in range(0, len(objs), 100):
        chunk = objs[i:i + 100]
        body = json.dumps(dict(operation=op, transfers=['basic'], objects=[dict(oid=o, size=s) for o, s in chunk]))
        d = None
        for auth in (None, 'cred'):
            hdrs = ['-H', 'Accept: application/vnd.git-lfs+json', '-H', 'Content-Type: application/vnd.git-lfs+json']
            if auth:
                c = cred_header(repo_url)
                if not c:
                    break
                hdrs += ['-H', c]
            r = subprocess.run(['curl', '-sS', '--max-time', '120', '-X', 'POST'] + hdrs + ['--data-binary', '@-', '-w', '\n%{http_code}',
                                repo_url.rstrip('/') + '.git/info/lfs/objects/batch'], input=body.encode(), capture_output=True)
            txt, _, code = r.stdout.decode().rpartition('\n')
            if code == '200':
                d = json.loads(txt); break
        if d is None:
            raise RuntimeError('LFS batch failed for %s (%s)' % (repo_url, code))
        for o in d['objects']:
            ok = 'error' not in o and (op != 'download' or 'download' in o.get('actions', {}))
            out[o['oid']] = (ok, (o.get('actions') or {}).get('download'), o.get('error'))
    return out


def lfs_download(action, dest, oid):
    hdr = []
    for k, v in (action.get('header') or {}).items():
        hdr += ['-H', '%s: %s' % (k, v)]
    r = subprocess.run(['curl', '-fsSL', '--retry', '3', '--max-time', '1800'] + hdr + ['-o', dest, action['href']], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError('LFS download failed: ' + r.stderr[-300:])
    if sha256_file(dest) != oid:
        os.unlink(dest); raise RuntimeError('LFS download hash mismatch for ' + oid)


def local_lfs_object(oid, clones):
    for c in clones:
        p = os.path.join(c, '.git', 'lfs', 'objects', oid[:2], oid[2:4], oid)
        if os.path.isfile(p):
            return p
    return None


# ---------------------------------------------------------------- content retrieval
def get_content(group, tmpdir, clones, arch_url, pipe_url):
    """Return (path, is_temp) of a file holding the bytes of this hash, or raise."""
    h = group['sha256']
    for r in group['records']:  # 1) a real file on disk
        if r['kind'] == 'file' and not r.get('pointer_file') and os.path.isfile(r['abspath']) and not r.get('in_progress'):
            if os.path.getsize(r['abspath']) == group['size'] and sha256_file(r['abspath']) == h:
                return r['abspath'], False
    p = local_lfs_object(h, clones)  # 2) a local LFS store
    if p:
        return p, False
    for r in group['records']:  # 3) real (non-LFS) blob in a git object store
        if r['kind'] == 'git' and not r['lfs'] and r.get('sha256') == h:
            out = os.path.join(tmpdir, h)
            with open(out, 'wb') as fh:
                packs = []
                if run(['git', 'cat-file', '-e', r['blob']], cwd=r['gitdir'], check=False).returncode:
                    packs = ensure_blob(r['gitdir'], r['blob'])
                subprocess.run(['git', 'cat-file', 'blob', r['blob']], cwd=r['gitdir'], stdout=fh, check=True, env=NOENV)
                drop_packs(r['gitdir'], packs)
            return out, True
    for url in (u for u in (arch_url, pipe_url) if u):  # 4) an LFS server that has it
        b = lfs_batch(url, [(h, group['size'])])[h]
        if b[0]:
            out = os.path.join(tmpdir, h)
            lfs_download(b[1], out, h)
            return out, True
    raise RuntimeError('no content source for ' + h)


# ---------------------------------------------------------------- publishing (same mechanism as publish.sh)
def publish_bundle(ops_files, extra_ops, label, args):
    """ops_files: [(dest_path_in_archive, getter() -> (source_file, is_temp))] ; pushes incoming/<id> and waits for the Action.
    Same bundle format as publish.sh: ops.sh + <95 MB parts + the workflow file. Each file is split, committed and its
    parts removed straight away, so the disk only ever holds ~1x the batch (plus the file being split)."""
    incoming = '/home/user/farm/_incoming'
    os.makedirs(incoming, exist_ok=True)
    bid = time.strftime('%m%d-%H%M%S') + '-inventory-' + re.sub(r'[^a-z0-9_-]', '-', label.lower())
    B = os.path.join(incoming, bid)
    shutil.rmtree(B, ignore_errors=True)
    os.makedirs(os.path.join(B, '.github', 'workflows'))
    wf = os.path.join(WORK, '.github/workflows/publish-videos.yml')
    shutil.copy(wf, os.path.join(B, '.github/workflows/'))
    env = dict(LAZYENV, GIT_AUTHOR_NAME='Claude', GIT_AUTHOR_EMAIL='noreply@anthropic.com',
               GIT_COMMITTER_NAME='Claude', GIT_COMMITTER_EMAIL='noreply@anthropic.com')
    gitc = ['git', '-c', 'core.compression=0', '-c', 'pack.compression=0', '-c', 'commit.gpgsign=false']
    run(['git', 'init', '-q'], cwd=B, env=env)
    run(['git', 'checkout', '-q', '-b', 'incoming'], cwd=B, env=env)
    ops = []
    done, failed = [], {}
    try:
        for i, (dest, getter) in enumerate(ops_files):
            name = 'f%04d' % i
            try:
                src, is_tmp = getter()
            except Exception as e:
                failed[dest] = str(e)
                log('  UNRECOVERABLE %s: %s' % (dest, e))
                continue
            parts = []
            with open(src, 'rb') as fi:
                n = 0
                while True:
                    chunk = fi.read(95 * 1000 * 1000)  # < 95 MB parts, like publish.sh's split -b 95m
                    if not chunk and n:
                        break
                    pp = os.path.join(B, '%s.part%02d' % (name, n))
                    with open(pp, 'wb') as fo:
                        fo.write(chunk)
                    parts.append(pp)
                    n += 1
                    if not chunk:
                        break
            if is_tmp:
                os.unlink(src)
            run(gitc + ['add', '--'] + [os.path.basename(x) for x in parts], cwd=B, env=env)
            for x in parts:
                os.unlink(x)
            ops.append('put %s %s' % (shlex_q(dest), name))
            done.append(dest)
        if not done and not extra_ops:
            shutil.rmtree(B, ignore_errors=True)
            return None, done, failed
        ops += extra_ops
        with open(os.path.join(B, 'ops.sh'), 'w') as f:
            f.write('\n'.join(ops) + '\n')
        run(gitc + ['add', 'ops.sh', '.github'], cwd=B, env=env)
        run(gitc + ['commit', '-qm', 'incoming: archive inventory %s' % label], cwd=B, env=env)
        r = run(['git', 'push', '-q', ARCHIVE_URL, 'HEAD:refs/heads/incoming/' + bid], cwd=B, env=env, check=False)  # fresh branch name: no force
        if r.returncode:
            raise RuntimeError('push failed: ' + r.stderr[-400:])
    except Exception:
        shutil.rmtree(B, ignore_errors=True)
        raise
    log('pushed incoming/%s (%d files); waiting for the Action' % (bid, len(ops_files)))
    shutil.rmtree(B, ignore_errors=True)  # objects are on the remote now: free the disk while the Action runs
    ac = args.archive_clone
    for _ in range(120):
        time.sleep(15)
        if run(['git', 'ls-remote', '--exit-code', ARCHIVE_URL, 'refs/heads/incoming/' + bid], check=False, env=LAZYENV).returncode != 0:
            break
        if 'incoming/' + bid in dead_branches():
            raise RuntimeError('the publish-videos run for incoming/%s FAILED (see its log in the Actions tab); branch left in place' % bid)
    else:
        raise RuntimeError('incoming/%s still pending after 30 min: check the publish-videos run' % bid)
    run(['git', 'fetch', '-q', 'origin', 'main', '--filter=blob:none'], cwd=ac, env=LAZYENV)
    tree = set(run(['git', 'ls-tree', '-r', '--name-only', 'origin/main'], cwd=ac).stdout.splitlines())
    lost = [d for d in done if d not in tree]
    if lost:
        raise RuntimeError('batch published but %d file(s) are not in main: %s' % (len(lost), lost[:3]))
    log('published and verified in main (%d files; main is now %s)' % (len(done), run(['git', 'rev-parse', '--short', 'origin/main'], cwd=ac).stdout.strip()))
    return bid, done, failed


def shlex_q(s):
    import shlex
    return shlex.quote(s)


def dead_branches():
    """incoming/* branches whose publish run already failed/was cancelled (only the Action may delete them)."""
    try:
        out = subprocess.run(['curl', '-sS', 'https://api.github.com/repos/flip-engineer/automated-content-pipeline-video-studies-archive/actions/runs?per_page=50'],
                             capture_output=True, text=True).stdout
        return {r['head_branch'] for r in json.loads(out)['workflow_runs']
                if r['status'] == 'completed' and r['conclusion'] in ('failure', 'cancelled')}
    except Exception:
        return set()


def wait_no_incoming():
    for _ in range(120):
        heads = [l.split()[-1].replace('refs/heads/', '') for l in run(['git', 'ls-remote', '--heads', ARCHIVE_URL, 'incoming/*'], check=False, env=LAZYENV).stdout.splitlines()]
        live = [h for h in heads if h not in dead_branches()]
        if not live:
            return
        log('another publish is pending (%s); waiting' % live[0])
        time.sleep(15)
    raise RuntimeError('incoming/* branches never cleared')


# ---------------------------------------------------------------- inventory model
def build_groups(records):
    groups = {}
    for r in records:
        h = r.get('sha256')
        if not h:
            continue
        g = groups.setdefault(h, dict(sha256=h, size=r['size'], records=[], optional=True))
        g['records'].append(r)
        g['optional'] = g['optional'] and r['optional']
    return groups


def choose_dest(rec):
    return 'videos/out/recovered/%s/%s' % (rec['source'], rec['path'].lstrip('/'))


def plan_dests(missing):
    """distinct destination path per missing hash; path collisions get a short-hash suffix."""
    by_path = {}
    for g in missing:
        pr = primary(g)
        g['dest'] = choose_dest(pr)
        by_path.setdefault(g['dest'], []).append(g)
    for d, gs in by_path.items():
        if len(gs) > 1:
            for g in gs:
                stem, ext = os.path.splitext(g['dest'])
                g['dest'] = '%s.%s%s' % (stem, g['sha256'][:8], ext)
    return missing


def locate(missing, clones):
    """how the bytes of each missing hash can be obtained (sets g['how'])."""
    need = [g for g in missing]
    on_arch = lfs_batch(ARCHIVE_URL, [(g['sha256'], g['size']) for g in need if any(r.get('lfs') for r in g['records'])]) if need else {}
    on_pipe = {}
    unresolved = []
    for g in need:
        h = g['sha256']
        if any(r['kind'] == 'file' and not r.get('pointer_file') and os.path.isfile(r['abspath']) and not r.get('in_progress') for r in g['records']):
            g['how'] = 'local file'
        elif h in on_arch and on_arch[h][0]:
            g['how'] = 'pointer only (object already on archive LFS)'
        elif local_lfs_object(h, clones):
            g['how'] = 'local LFS store'
        elif any(r['kind'] == 'git' and not r['lfs'] for r in g['records']):
            g['how'] = 'git blob'
        else:
            unresolved.append(g)
    if unresolved:
        on_pipe = lfs_batch(PIPELINE_URL, [(g['sha256'], g['size']) for g in unresolved])
        for g in unresolved:
            g['how'] = 'pipeline LFS download' if on_pipe[g['sha256']][0] else 'UNAVAILABLE'


def primary(g):
    def key(r):
        return (PRIORITY.index(r['source']), r.get('in_progress', False), r['path'])
    return sorted(g['records'], key=key)[0]


# ---------------------------------------------------------------- reporting
def fmt_mb(n):
    return '%.1f MB' % ((n or 0) / 1e6)


def write_inventory(groups, all_records, main_paths, extra_status, outdir):
    """INVENTORY.md + inventory.json content (deterministic)."""
    rows = []
    for r in all_records:
        if r.get('in_progress') or r['source'] == 'scratch':
            continue  # unstable / not ours to list: reported on stdout only
        h = r.get('sha256')
        mp = main_paths.get(h)
        st = None
        if r['source'] == 'archive-history' and 'origin/main' in r.get('tips', []):
            st = 'recovered' if '/recovered/' in '/' + r['path'] else 'in main'
        elif h in extra_status:
            st = extra_status[h]
        elif mp:
            st = 'duplicate'
        else:
            st = 'not archived'
        rows.append(dict(source=r['source'], path=r['path'], ref=('origin/main' if r['source'] == 'archive-history' and '/recovered/' in '/' + r['path'] else r.get('commit', '')[:10] + (' ' + ','.join(r.get('branches', [])[:4]) if r.get('branches') else '')).strip() or r.get('mtime', ''),
                         size=r.get('size'), sha256=h, status=st, in_archive_at=mp, optional=r['optional'],
                         note=('in progress (skipped)' if r.get('in_progress') else '')))
    rows.sort(key=lambda x: (x['source'], x['path'], x['ref'], x['sha256'] or ''))
    js = dict(archive='flip-engineer/automated-content-pipeline-video-studies-archive',
              summary=dict(records=len(rows), unique_hashes=len({r['sha256'] for r in rows if r['sha256']}),
                           by_status={s: sum(1 for r in rows if r['status'] == s) for s in sorted({r['status'] for r in rows})}),
              videos=rows)
    md = ['# Video inventory', '',
          'Every video file found in every source, identified by content hash (LFS oid for LFS pointers, else sha256 of the bytes).',
          'Status: **in main** = the file is in the archive main tree; **recovered** = published under `videos/out/recovered/`; '
          '**duplicate** = same content already in the archive under another path/source (see "in archive at"). '
          'Scratch temporaries, session uploads and third-party source footage are reported by the script but not listed here. '
          'Generated by `videos/scripts/archive_inventory.py`.', '', '## Summary', '',
          '| source | files | unique hashes |', '|---|---|---|']
    for s in [x for x in PRIORITY if x != 'scratch']:
        rs = [r for r in rows if r['source'] == s]
        md.append('| %s | %d | %d |' % (s, len(rs), len({r['sha256'] for r in rs})))
    md.append('| **all** | %d | %d |' % (len(rows), js['summary']['unique_hashes']))
    md += ['', 'By status: ' + ', '.join('%s %d' % kv for kv in js['summary']['by_status'].items()), '', '## Files', '',
           '| source | path | ref | size | sha256 | status | in archive at |', '|---|---|---|---|---|---|---|']
    for r in rows:
        md.append('| %s | `%s` | %s | %s | `%s` | %s%s | %s |' % (
            r['source'], r['path'], r['ref'], fmt_mb(r['size']), (r['sha256'] or '?')[:16], r['status'],
            ' (optional)' if r['optional'] else '', ('`%s`' % r['in_archive_at']) if r['in_archive_at'] else ''))
    return '\n'.join(md) + '\n', json.dumps(js, indent=1, sort_keys=True) + '\n'


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='report only; push nothing')
    ap.add_argument('--no-optional', action='store_true', help='do not upload the optional m4a listening reels')
    ap.add_argument('--batch-mb', type=int, default=450, help='max bundle size per push (default 450; shrinks when disk is tight)')
    ap.add_argument('--settle-minutes', type=int, default=10, help='skip local files modified more recently than this (still being written)')
    ap.add_argument('--max-files', type=int, default=0, help='upload at most this many files this run (testing)')
    ap.add_argument('--report-json', help='write the raw inventory here')
    ap.add_argument('--scratch-dir', action='append', default=None, help='extra scratch directories to scan (report only)')
    for k, v in DEFAULTS.items():
        ap.add_argument('--' + k.replace('_', '-'), default=v)
    ap.add_argument('--log', default=None, help='progress log file (default: <cache>/archive_inventory.log)')
    a = ap.parse_args()
    LOGFILE[0] = a.log or os.path.join(a.cache, 'archive_inventory.log')
    os.makedirs(a.cache, exist_ok=True)
    load_cache(a.cache)
    t0 = time.time()

    # ---- archive
    ac = a.archive_clone
    run(['git', 'fetch', '-q', '--all', '--prune', '--filter=blob:none'], cwd=ac, env=LAZYENV)
    if run(['git', 'rev-parse', '--is-shallow-repository'], cwd=ac).stdout.strip() == 'true':
        run(['git', 'fetch', '-q', '--unshallow', '--filter=blob:none', 'origin'], cwd=ac, env=LAZYENV)
    arch, tiptrees = scan_git('archive-history', ac)
    main_tree = tiptrees.get('refs/remotes/origin/main', {})
    for r in arch:
        r['tips'] = ['origin/main'] if r['tips'] and 'refs/remotes/origin/main' in r['tips'] else []
    for r in arch:
        if not r.get('lfs') and r.get('sha256') is None and 'error' not in r:
            hash_git_blob(r)
            r['sha256'] = STATE['hc'][r['blob']]
    records = list(arch)

    # ---- pipeline
    pl_dir = bare_clone(PIPELINE_URL, os.path.join(a.cache, 'pipeline.git'))
    pl, _ = scan_git('pipeline', pl_dir)
    for r in pl:
        if not r.get('lfs') and r.get('sha256') is None and 'error' not in r:
            r['sha256'] = STATE['hc'].get(r['blob']) or hash_git_blob(r)
    records += pl

    # ---- Blog-Posts: READ-ONLY. Remote via ls-remote; the local clone is always scanned.
    blog_dirs = []
    remote_note = 'remote not checked'
    try:
        if remote_has_refs(BLOG_URL):
            blog_dirs.append(bare_clone(BLOG_URL, os.path.join(a.cache, 'blog.git'))); remote_note = 'remote has refs (fetched read-only)'
        else:
            remote_note = 'remote is EMPTY (no branches/commits); local clone is the only copy'
    except Exception as e:
        remote_note = 'remote unreachable: %s' % e
    log('Blog-Posts:', remote_note)
    blog_dirs.append(os.path.join(a.blog_clone, '.git'))
    seen_keys = set()
    for d in blog_dirs:
        rs, _ = scan_git('blog-posts', d)
        for r in rs:
            k = (r['blob'], r['path'])
            if k in seen_keys:
                continue
            seen_keys.add(k)
            if not r.get('lfs') and r.get('sha256') is None and 'error' not in r:
                r['sha256'] = STATE['hc'].get(r['blob']) or hash_git_blob(r)
            records.append(r)

    # ---- work repo: history + files
    wg, _ = scan_git('work-git', os.path.join(WORK, '.git'))
    for r in wg:
        if not r.get('lfs') and r.get('sha256') is None and 'error' not in r:
            r['sha256'] = STATE['hc'].get(r['blob']) or hash_git_blob(r)
    records += wg
    records += scan_files('work', WORK, 'work', skip=(os.path.join(WORK, 'videos/sources'), os.path.join(WORK, 'videos/web')), settle=a.settle_minutes)
    input_recs = []
    for sub in ('videos/sources', 'videos/web'):
        if os.path.isdir(os.path.join(WORK, sub)):
            input_recs += scan_files('scratch', os.path.join(WORK, sub), 'input-footage')
    # blog / pipeline working trees
    for base in (a.blog_clone, a.pipeline_clone):
        for r in scan_files('scratch', base, 'other-clone-worktree'):
            r['path'] = os.path.relpath(r['abspath'], '/home/user'); input_recs.append(r)
    scratch_dirs = [SCRATCH, '/root/.claude/uploads'] + (a.scratch_dir or []) + \
        [os.path.join('/tmp', d) for d in os.listdir('/tmp') if os.path.isdir(os.path.join('/tmp', d)) and not d.startswith('claude-')]
    for d in scratch_dirs:
        if os.path.isdir(d):
            for r in scan_files('scratch', d, 'scratch', skip=(os.path.join(SCRATCH, 'inv'),), settle=a.settle_minutes):
                r['path'] = os.path.relpath(r['abspath'], '/'); input_recs.append(r)
    records += input_recs
    for r in records:
        if r['kind'] == 'git':
            r.pop('gitdir_', None)
    save_cache()

    bad = [r for r in records if not r.get('sha256')]
    records_h = [r for r in records if r.get('sha256')]
    groups = build_groups(records_h)

    # ---- main tree hashes
    main_paths = {}
    for path, blob in sorted(main_tree.items()):
        for r in arch:
            if r['path'] == path and r['blob'] == blob and r.get('sha256'):
                if r['sha256'] not in main_paths or ('/recovered/' in '/' + main_paths[r['sha256']] and '/recovered/' not in '/' + path):
                    main_paths[r['sha256']] = path
                break

    # ---- report per source
    print('== inventory (%.0fs)' % (time.time() - t0))
    print('%-16s %8s %8s' % ('source', 'files', 'unique'))
    for s in PRIORITY:
        rs = [r for r in records_h if r['source'] == s]
        print('%-16s %8d %8d' % (s, len(rs), len({r['sha256'] for r in rs})))
    print('%-16s %8d %8d' % ('ALL', len(records_h), len(groups)))
    if bad:
        print('unhashable records:', [(r['source'], r['path'], r.get('error')) for r in bad][:10])
    print('Blog-Posts:', remote_note)
    # pipeline paths absent from the archive
    arch_paths = {r['path'] for r in arch}
    arch_tail = {os.path.basename(p) for p in arch_paths}
    absent_paths = sorted({r['path'] for r in pl if r['path'] not in arch_paths})
    absent_names = sorted({r['path'] for r in pl if os.path.basename(r['path']) not in arch_tail})
    print('pipeline paths (any version) absent from the archive by exact path: %d; by file name: %d' % (len(absent_paths), len(absent_names)))
    absent_hash = sorted({r['sha256'] for r in pl if r.get('sha256') and r['sha256'] not in main_paths})
    print('pipeline versions whose content is not in archive main: %d' % len(absent_hash))

    # ---- LFS check on the archive
    ptrs = {(r['sha256'], r['size']) for r in arch if r.get('lfs')}
    lfs_state = lfs_batch(ARCHIVE_URL, list(ptrs))
    lfs_missing = sorted(o for (o, s) in ptrs if not lfs_state[o][0])
    print('== archive LFS: %d pointers (unique), %d missing on the server' % (len(ptrs), len(lfs_missing)))
    clones = [ac, a.pipeline_clone, a.blog_clone, WORK]
    tmpdir = tempfile.mkdtemp(prefix='ai_', dir=a.cache)
    fixed_lfs, unrecoverable = [], {}
    try:
        for oid in lfs_missing:
            g = groups[oid]
            print('  missing LFS object %s (%s) e.g. %s' % (oid[:12], fmt_mb(g['size']), primary(g)['path']))
        if lfs_missing and not a.dry_run:
            for oid in lfs_missing:
                g = groups[oid]
                try:
                    src, is_tmp = get_content(g, tmpdir, clones, None, PIPELINE_URL)
                except Exception as e:
                    unrecoverable[oid] = str(e); print('  UNRECOVERABLE %s: %s' % (oid[:12], e)); continue
                dst = os.path.join(ac, '.git', 'lfs', 'objects', oid[:2], oid[2:4], oid)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                copied = src != dst and not os.path.exists(dst)
                if copied:
                    shutil.copyfile(src, dst)
                if is_tmp:
                    os.unlink(src)
                r = run(['git', 'lfs', 'push', '--object-id', 'origin', oid], cwd=ac, env=LAZYENV, check=False)
                chk = lfs_batch(ARCHIVE_URL, [(oid, g['size'])])[oid][0]
                if chk:
                    fixed_lfs.append(oid); print('  uploaded LFS object', oid[:12])
                else:
                    unrecoverable[oid] = 'git lfs push did not make it appear: ' + (r.stderr or r.stdout)[-200:]
                if copied:
                    try: os.unlink(dst)
                    except OSError: pass
    finally:
        pass

    # ---- what is missing from main
    def in_main(h): return h in main_paths
    missing = []
    for h, g in groups.items():
        if in_main(h):
            continue
        recs = [r for r in g['records'] if not r.get('in_progress')]
        cls = {r.get('cls') for r in recs}
        # scratch: only finished pieces; footage/other-clone worktrees are inputs, reported not uploaded
        cand = [r for r in recs if r['source'] != 'scratch' or (r.get('cls') == 'scratch' and FINISHED_RE.match(os.path.basename(r['path'])))]
        if not cand:
            continue
        gg = dict(g); gg['records'] = cand
        missing.append(gg)
    inprog = [r for r in records_h if r.get('in_progress') and r['sha256'] not in main_paths]
    reported = [r for r in records_h if r['source'] == 'scratch' and r['sha256'] not in main_paths]
    plan_dests(missing)
    locate(missing, clones)
    for g in missing:
        if g['how'] == 'UNAVAILABLE':
            unrecoverable.setdefault(g['sha256'], 'content not found: no local file/LFS store/git blob, not on the archive or pipeline LFS server')
    hows = {}
    for g in missing:
        hows[g['how']] = hows.get(g['how'], 0) + 1
    print('content sources for the missing ones:', hows)
    n_opt = sum(1 for g in missing if g['optional'])
    print('== missing from archive main: %d unique (%d optional m4a) ; %d in-progress local files skipped ; %d scratch/input files not in archive (reported only)'
          % (len(missing), n_opt, len(inprog), len({r['sha256'] for r in reported})))
    for g in sorted(missing, key=lambda g: g['dest']):
        print('  %s  %s  %s  <- %s:%s [%s]' % (g['sha256'][:12], fmt_mb(g['size']).rjust(9), g['dest'], primary(g)['source'], primary(g)['path'], g['how']))
    for r in reported:
        print('  [not uploaded, scratch/input] %s  %s  %s' % (r['sha256'][:12], fmt_mb(r['size']).rjust(9), r['abspath']))
    for r in inprog:
        print('  [in progress, skipped] %s' % r['abspath'])
    if a.report_json:
        json.dump(dict(records=records_h, missing=[{k: v for k, v in g.items() if k != 'records'} for g in missing]), open(a.report_json, 'w'), default=str, indent=1)

    # ---- upload
    extra_status = {}
    uploaded = []
    todo = [g for g in missing if not (a.no_optional and g['optional'])]
    if a.max_files:
        todo = sorted(todo, key=lambda g: g['dest'])[:a.max_files]
    if todo and not a.dry_run:
        wait_no_incoming()
        # which archive LFS objects exist (pointer-only puts need no bytes)
        exist = lfs_batch(ARCHIVE_URL, [(g['sha256'], g['size']) for g in todo if any(r.get('lfs') for r in g['records'])])
        batch, bsize = [], 0
        def flush():
            nonlocal batch, bsize
            if not batch:
                return
            exts = sorted({g['dest'].rsplit('.', 1)[1].lower() for g, _ in batch} & {'mov', 'webm', 'm4v'})
            extra = ["grep -qs 'videos/out/\\*\\*/\\*.%s' .gitattributes || git lfs track 'videos/out/**/*.%s' >/dev/null" % (e, e) for e in exts]
            for attempt in (1, 2):
                try:
                    bid, done, failed = publish_bundle([(g['dest'], gt) for g, gt in batch], extra, time.strftime('%H%M%S'), a)
                    break
                except Exception as e:
                    log('batch failed (attempt %d): %s' % (attempt, e))
                    if attempt == 2:
                        for g, _ in batch:
                            unrecoverable[g['sha256']] = 'publish failed twice: %s' % e
                        bid, done, failed = None, [], {}
                    else:
                        wait_no_incoming()
            uploaded.extend(done)
            for g, _ in batch:
                if g['dest'] in failed:
                    unrecoverable[g['sha256']] = failed[g['dest']]
            batch, bsize = [], 0
        def make_getter(g, pointer_only):
            def getter():
                h, size = g['sha256'], g['size']
                if pointer_only:
                    pf = os.path.join(tmpdir, 'ptr_' + h)
                    open(pf, 'w').write('version https://git-lfs.github.com/spec/v1\noid sha256:%s\nsize %d\n' % (h, size))
                    return pf, True
                if free_mb() < size / 1e6 * 2 + 300:
                    raise RuntimeError('not enough disk (%d MB free) for %s; rerun later' % (free_mb(), fmt_mb(size)))
                return get_content(g, tmpdir, clones, ARCHIVE_URL, PIPELINE_URL)
            return getter
        for g in sorted(todo, key=lambda g: g['dest']):
            if g.get('how') == 'UNAVAILABLE':
                continue
            pointer_only = g['sha256'] in exist and exist[g['sha256']][0]
            cost = 0 if pointer_only else g['size'] / 1e6
            limit = min(a.batch_mb, max(50, (free_mb() - 400) // 2))
            if batch and bsize + cost > limit:
                flush()
            batch.append((g, make_getter(g, pointer_only))); bsize += cost
        flush()
    inv_records = list(records_h)
    for g in missing:
        if g['sha256'] not in unrecoverable and not a.dry_run and g['dest'] in uploaded:
            main_paths[g['sha256']] = g['dest']
            inv_records.append(dict(source='archive-history', path=g['dest'], size=g['size'], sha256=g['sha256'], tips=['origin/main'],
                                    optional=g['optional'], commit='', branches=[], kind='git'))
    for h in unrecoverable:
        extra_status[h] = 'unrecoverable'
    # ---- INVENTORY files
    md, js = write_inventory(groups, inv_records, main_paths, extra_status, None)
    if not a.dry_run:
        cur = {}
        for p in ('videos/out/INVENTORY.md', 'videos/out/inventory.json'):
            r = run(['git', 'show', 'origin/main:' + p], cwd=ac, check=False)
            cur[p] = r.stdout if r.returncode == 0 else None
        if uploaded:  # main now contains the recovered files: refresh, rebuild
            run(['git', 'fetch', '-q', '--all', '--prune', '--filter=blob:none'], cwd=ac, env=LAZYENV)
        if cur['videos/out/INVENTORY.md'] != md or cur['videos/out/inventory.json'] != js:
            wait_no_incoming()
            fm, fj = os.path.join(tmpdir, 'INVENTORY.md'), os.path.join(tmpdir, 'inventory.json')
            open(fm, 'w').write(md); open(fj, 'w').write(js)
            publish_bundle([('videos/out/INVENTORY.md', lambda: (fm, False)), ('videos/out/inventory.json', lambda: (fj, False))], [], 'inventory-files', a)
            print('INVENTORY.md / inventory.json published')
        else:
            print('INVENTORY.md / inventory.json already current')
    else:
        open(os.path.join(a.cache, 'INVENTORY.dryrun.md'), 'w').write(md)
    shutil.rmtree(tmpdir, ignore_errors=True)
    save_cache()
    real_missing = [g for g in missing if not (a.no_optional and g['optional'])]
    if not real_missing and not lfs_missing:
        print('nothing missing')
    else:
        print('missing (before this run): %d videos, %d LFS objects; uploaded now: %d videos, %d LFS objects; unrecoverable: %d'
              % (len(real_missing), len(lfs_missing), len(uploaded), len(fixed_lfs), len(unrecoverable)))
        for h, why in unrecoverable.items():
            print('  unrecoverable %s: %s' % (h[:12], why))
    return 0


if __name__ == '__main__':
    rc = 1
    try:
        rc = main()
    finally:
        log('EXIT=%s' % rc)
    sys.exit(rc)
