#!/usr/bin/env python3
"""Publish every finished farm render as soon as it lands (the client, 8 Oct: "push all completed videos to remote ... stop
sitting on them"; OPERATIONS.md "Publish on delivery").

Every few minutes: list the farm's done render jobs; for each one not yet handled, take its piece from the job, its scene from
the run command (--seg SCENE:...), and the next version from the archive's own listing (the highest PIECE_vN under videos/out,
including videos/out/archive, plus one); fetch the master and the share, run publish.sh with the gate, delete the local copies.
Handled job ids are kept in videos/logs/autopublish.done, so a restart never publishes a render twice.

  python3 videos/scripts/autopublish.py --seed      mark every job done so far as handled (publish nothing)
  python3 videos/scripts/autopublish.py [--once]    publish what is new (loop every 300 s unless --once)
"""
import json, os, re, shutil, subprocess, sys, tempfile, time

P = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FARM = [sys.executable, os.path.join(P, 'videos/scripts/farm.py')]
DONE = os.path.join(P, 'videos/logs/autopublish.done')
WORK = os.environ.get('AUTOPUB_DIR', os.path.join(tempfile.gettempdir(), 'autopub'))   # masters run to 400 MB: download in temporary storage
ARCH = 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive'


def sh(args, cwd=P, timeout=1800):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def done_jobs():
    r = sh(FARM + ['list', '--state', 'done'], timeout=300)
    return [ln.split()[0] for ln in r.stdout.splitlines() if ln.strip() and re.match(r'^\d{4}-\d{6}-', ln)]


def handled():
    try:
        return set(open(DONE).read().split())
    except OSError:
        return set()


def mark(job):
    os.makedirs(os.path.dirname(DONE), exist_ok=True)
    with open(DONE, 'a') as f:
        f.write(job + '\n')


def published_names():
    """file names under videos/out on the archive's main (listing only: a blobless depth-1 fetch)"""
    d = tempfile.mkdtemp(prefix='_autopub.')
    try:
        sh(['git', 'init', '-q', d]); sh(['git', 'remote', 'add', 'origin', ARCH], cwd=d)
        sh(['git', 'fetch', '-q', '--filter=blob:none', '--depth=1', 'origin', 'main'], cwd=d, timeout=600)
        r = sh(['git', 'ls-tree', '-r', '--name-only', 'FETCH_HEAD', 'videos/out'], cwd=d)
        return [os.path.basename(x) for x in r.stdout.split()]
    finally:
        shutil.rmtree(d, ignore_errors=True)


def next_version(piece, names):
    vs = [int(m.group(1)) for n in names for m in [re.match(re.escape(piece) + r'_v(\d+)(?:_share)?\.mp4$', n)] if m]
    return 'v%d' % (max(vs) + 1 if vs else 1)


def publish(job, names):
    j = json.loads(sh(FARM + ['show', job], timeout=300).stdout)
    if j.get('state') != 'done':
        return 'not done'
    if j.get('posted_by') != 'studio' or not str(j.get('title', '')).startswith('render '):
        return 'skip: not this studio\'s scene render'   # other studios post bench and person jobs to the same queue
    m = re.search(r'--seg\s+([A-Za-z0-9_]+):', ' '.join(j.get('run') or []))
    piece = j.get('piece')
    if not m or not piece:
        return 'skip: not a full scene render (no --seg scene or no piece)'
    scene = m.group(1)
    files = [f['name'] for f in ((j.get('delivery') or {}).get('files') or [])]
    if scene + '.mp4' not in files or scene + '_share.mp4' not in files:
        return 'skip: no master and share in the delivery'
    ver = next_version(piece, names)
    os.makedirs(WORK, exist_ok=True)
    if os.statvfs(WORK).f_bavail * os.statvfs(WORK).f_frsize < 900 << 20:
        return 'wait: under 900 MB free in ' + WORK
    d = tempfile.mkdtemp(prefix='_pub.', dir=WORK)
    try:
        os.environ.setdefault('FARM_CACHE', os.path.join(WORK, 'cache'))
        sh(FARM + ['fetch', job, '--only', scene + '.mp4', '--only', scene + '_share.mp4', '--to', d], timeout=1800)
        found = {f: os.path.join(r, f) for r, _, fs in os.walk(d) for f in fs}
        M, S = found.get(scene + '.mp4'), found.get(scene + '_share.mp4')
        if not (M and S):
            return 'fetch failed'
        env = dict(os.environ, GATE='1', GATE_SCENE=scene)
        r = subprocess.run(['sh', 'videos/scripts/publish.sh', '%s:%s:%s:%s' % (piece, ver, M, S)], cwd=P, env=env,
                           capture_output=True, text=True, timeout=3600)
        out = r.stdout + r.stderr
        hit = re.search(r'published to main \(([0-9a-f]+)\)', out)
        return ('published %s_%s (%s)' % (piece, ver, hit.group(1))) if hit else ('publish failed: ' + out.strip()[-300:])
    finally:
        shutil.rmtree(d, ignore_errors=True)
        for root in (os.path.expanduser('~/.cache/acp-farm'), os.path.join(WORK, 'cache')):
            for c in os.listdir(root) if os.path.isdir(root) else []:
                if c.startswith('arch-'):   # farm.py's archive cache keeps every fetched master; drop it after each publish
                    shutil.rmtree(os.path.join(root, c), ignore_errors=True)


def run_once():
    new = [x for x in done_jobs() if x not in handled()]
    if not new:
        return
    names = published_names()
    for job in sorted(new):
        res = publish(job, names)
        print(time.strftime('%H:%M:%S'), job, res, flush=True)
        if res.startswith(('published', 'skip')):
            mark(job)
            if res.startswith('published'):
                names = published_names()


if __name__ == '__main__':
    if '--seed' in sys.argv:
        for x in done_jobs():
            if x not in handled():
                mark(x)
        print('seeded', len(handled()))
    elif '--once' in sys.argv:
        run_once()
    else:
        while True:
            try:
                run_once()
            except Exception as e:
                print('autopublish error:', e, flush=True)
            time.sleep(300)
