#!/usr/bin/env python3
"""Delta sync: put the project's own commits onto the pipeline repo's main, and nothing else.

Why (8 Oct 2026). sync_repo.sh's snapshot replaces main's tree with the project's. That assumes the project is the only
writer to main. On 8 Oct 13:27 the client merged another studio's branch into main (a8726ff, "Merge the studio person
pipeline into main": 1460 commits, 2749 new files, 35 changed). From then on the snapshot either refuses (its stale
check) or would delete that work, and its full fetch of main is over 1.3 GB, more than the disk holds. Several studios
now write to main, so a sync must touch only the paths this project changed.

How. A blobless fetch of main (commits and trees only, a few MB), the same plumbing publish.sh uses. The project paths
changed between the last synced project commit and HEAD are written as blobs from HEAD (deletions removed) onto main's
own tree, then committed and pushed. Each sync commit carries a "Project-Commit: <sha>" trailer, which the next sync finds
as its base. If none is found, SYNC_BASE=<project sha> sets it.

A path the project changed whose version on main is neither what the project had at the base nor the project's new
version (someone else changed it) stops the sync. It is listed, and nothing is pushed. Bring the upstream version in
(merging), commit, and sync again. Paths only upstream changed are left exactly as upstream has them.

  python3 videos/scripts/sync_delta.py "message"        (sync_repo.sh calls this for every sync)
  SYNC_DRY=1 lists the delta and the checks, and pushes nothing.
"""
import os, re, subprocess, sys, tempfile, shutil, time

SRC = '/home/user/acp-agitprop'
URL = 'https://github.com/flip-engineer/automated-content-pipeline'
EXCL = [':!farm', ':!videos/out', ':!videos/review', ':!videos/archive', ':!videos/models']
HITS = re.compile(r'^videos/out/\.[^/]+\.hits\.json$')
TRAILER = 'Project-Commit: '
FOOT = ('\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
        'Claude-Session: https://claude.ai/code/session_01XkFQQwGRpJN2GiVpXu9H78')


def run(args, cwd, inp=None, check=True):
    r = subprocess.run(args, cwd=cwd, input=inp, capture_output=True)
    if check and r.returncode:
        raise SystemExit(f"sync_delta: {' '.join(args[:4])} failed: {r.stderr.decode(errors='replace').strip()[-400:]}")
    return r.stdout


def src(*a, **k):
    return run(['git', *a], SRC, **k)


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else 'sync'
    dry = os.environ.get('SYNC_DRY') == '1'
    head = src('rev-parse', 'HEAD').decode().strip()
    os.makedirs('/home/user/farm', exist_ok=True)
    G = tempfile.mkdtemp(prefix='_sync.', dir='/home/user/farm')
    g = lambda *a, **k: run(['git', *a], G, **k)
    try:
        g('init', '-q'); g('remote', 'add', 'origin', URL)
        g('config', 'extensions.partialClone', 'origin'); g('config', 'remote.origin.promisor', 'true')
        g('config', 'remote.origin.partialclonefilter', 'blob:none')
        for attempt in range(1, 6):
            g('fetch', '-q', '--filter=blob:none', '--shallow-since=10.days.ago', 'origin', 'main')
            tip = g('rev-parse', 'FETCH_HEAD').decode().strip()
            # the base: the newest sync commit on main whose Project-Commit is in the project's history
            base = os.environ.get('SYNC_BASE'); base_sync = None
            for line in g('log', '--format=%H%x09%B%x00', tip).decode().split('\0'):
                m = re.search(TRAILER + r'([0-9a-f]{40})', line)
                if m and subprocess.run(['git', 'merge-base', '--is-ancestor', m.group(1), head], cwd=SRC,
                                        capture_output=True).returncode == 0:
                    if not base:
                        base = m.group(1)
                    if m.group(1) == src('rev-parse', base).decode().strip():
                        base_sync = line.split('\t', 1)[0].strip(); break
            if not base:
                raise SystemExit('sync_delta: no Project-Commit trailer on main in the last 10 days; set SYNC_BASE=<project commit last synced>')
            base = src('rev-parse', base).decode().strip()
            # the delta: what the project's commits changed since the base
            rows = src('diff', '--no-renames', '--name-status', '-z', base, head, '--', '.', *EXCL).decode().split('\0')
            rows += src('diff', '--no-renames', '--name-status', '-z', base, head, '--', 'videos/out').decode().split('\0')
            delta = {}
            it = iter([r for r in rows if r])
            for st in it:
                p = next(it)
                if p.startswith('videos/out/') and not HITS.match(p):
                    continue
                delta[p] = st[0]
            if not delta:
                print(f'sync_delta: nothing to sync (project {head[:7]} matches base {base[:7]})'); return
            # conflicts: main holds a version of the path that the project never had at its base (someone else's change), and
            # the project's HEAD is not that version either. The reference is always the PROJECT's blob at the base, never
            # main's blob at the base sync commit: a delta sync leaves main's other paths as upstream had them, so a file another
            # studio changed before that sync (a8726ff's hero.js, farm.py, ...) equals itself there and would read as untouched,
            # and the project's older-based edit would silently revert it.
            def blob(tree_ish, p, repo):
                r = subprocess.run(['git', 'rev-parse', '-q', '--verify', f'{tree_ish}:{p}'], cwd=repo, capture_output=True)
                return r.stdout.decode().strip() or None
            def bases_for(p, was):
                """the versions of p main and the project last shared, and only those (an older base would make a stale copy
                look as if it already held upstream's deletions): the project's own at the base, and the newest version this
                project itself wrote to main (a sync, or an old snapshot that could hold uncommitted files) that is not
                main's current one, i.e. what the other studio started from."""
                out = [was]
                r = subprocess.run(['git', 'log', '--format=%H', '--author=^Claude <', '-n', '12', tip, '--', p], cwd=G,
                                   capture_output=True, text=True)
                for c in r.stdout.split():
                    v = blob(c, p, G)
                    if v and v != blob(tip, p, G):
                        out.append(v); break
                return [x for i, x in enumerate(out) if x and x not in out[:i]]

            def subsumes(was, mine, up, p=None):
                """the project's version already holds main's changes: for some version both last shared (bases_for), a
                three-way merge of main's version into the project's is clean, or a union merge, and changes nothing. True
                after the project merged upstream's edit in; False for a stale copy (the merge would add upstream's lines)
                and for anything binary, deleted or absent."""
                if not (mine and up):
                    return False
                for b in (bases_for(p, was) if p else [was]):
                    if b and b != up and b != mine and subsumes_from(b, mine, up):
                        return True
                return False

            def subsumes_from(was, mine, up):
                d = tempfile.mkdtemp(dir=G)
                try:
                    for name, sha, repo in (('base', was, None), ('mine', mine, SRC), ('up', up, G)):
                        # a base can come from either repo; the blobless main fetches its blob on demand
                        r = subprocess.run(['git', 'cat-file', 'blob', sha], cwd=repo or SRC, capture_output=True)
                        if r.returncode and repo is None:
                            r = subprocess.run(['git', 'cat-file', 'blob', sha], cwd=G, capture_output=True)
                        if r.returncode or b'\0' in r.stdout[:8000]:
                            return False
                        open(os.path.join(d, name), 'wb').write(r.stdout)
                    mine_b = open(os.path.join(d, 'mine'), 'rb').read()
                    # strict merge first; then union (a conflicted hunk becomes ours followed by theirs): if that reproduces the
                    # project's file, main's lines are already in it, e.g. a .gitignore both sides added to at the same place
                    for flags in ([], ['--union']):
                        r = subprocess.run(['git', 'merge-file', '-p', *flags, os.path.join(d, 'mine'), os.path.join(d, 'base'),
                                            os.path.join(d, 'up')], capture_output=True)
                        if r.returncode == 0 and r.stdout == mine_b:
                            return True
                    return False
                finally:
                    shutil.rmtree(d, ignore_errors=True)
            clash = []
            same = set()          # already on main exactly as the project has it (e.g. files merged in from main): not rewritten
            for p in delta:
                up = blob(tip, p, G)
                was = blob(base, p, SRC)
                mine = blob(head, p, SRC)
                if up == mine:
                    same.add(p); continue
                # the publish guard's videos/out/.X.hits.json are this project's own records; the old snapshot never synced
                # videos/out, so most are absent on main and would read as someone else's deletion
                if up != was and up != mine and not (HITS.match(p) and up is None) and not subsumes(was, mine, up, p):
                    clash.append(p)
            print(f'sync_delta: project {base[:7]}..{head[:7]}: {len(delta)} paths '
                  f"({sum(v == 'A' for v in delta.values())} added, {sum(v == 'M' for v in delta.values())} changed, "
                  f"{sum(v == 'D' for v in delta.values())} deleted; {len(same)} already on main as they are) onto main {tip[:7]}")
            if clash:
                print('sync_delta: upstream changed these since the last sync, and the project changed them differently. Not syncing:', file=sys.stderr)
                for p in clash:
                    print('  ' + p, file=sys.stderr)
                sys.exit(1)
            if dry:
                for p, s in sorted(delta.items()):
                    print(f'  {s} {p}')
                print('SYNC_DRY=1: nothing pushed'); return
            # build main's tree plus the delta, without fetching a single blob of main's
            idx = os.path.join(G, '.git', 'index.sync')
            env = dict(os.environ, GIT_INDEX_FILE=idx)
            gi = lambda *a, inp=None: subprocess.run(['git', *a], cwd=G, env=env, input=inp, capture_output=True, check=True).stdout
            if os.path.exists(idx):
                os.unlink(idx)
            gi('read-tree', tip)
            info = []
            for p, s in sorted(delta.items()):
                if p in same:
                    continue
                if s == 'D':
                    gi('update-index', '--force-remove', '--', p); continue
                mode, typ, sha = src('ls-tree', head, '--', p).decode().split('\t')[0].split()
                data = src('cat-file', 'blob', sha)
                new = gi('hash-object', '-w', '--stdin', inp=data).decode().strip()
                info.append(f'{mode} {new}\t{p}')
            if info:
                gi('update-index', '--add', '--index-info', inp=('\n'.join(info) + '\n').encode())
            tree = gi('write-tree', '--missing-ok').decode().strip()
            body = f'{msg}\n\nDelta sync of project {base[:7]}..{head[:7]} ({len(delta)} paths).{FOOT}\n{TRAILER}{head}\n'
            c = run(['git', '-c', 'user.name=Claude', '-c', 'user.email=noreply@anthropic.com', 'commit-tree', tree, '-p', tip],
                    G, inp=body.encode()).decode().strip()
            r = subprocess.run(['git', '-c', 'pack.window=0', 'push', '-q', '--no-thin', 'origin', f'{c}:refs/heads/main'],
                               cwd=G, capture_output=True)
            now = g('ls-remote', 'origin', 'refs/heads/main').decode().split('\t')[0]
            if now == c:
                print(f'pushed main {c[:7]} (delta of project {base[:7]}..{head[:7]})'); return
            print(f'main moved, retrying ({attempt}): {r.stderr.decode(errors="replace").strip()[-200:]}')
            time.sleep(attempt * 3)
        raise SystemExit('sync_delta: could not land on main after 5 tries')
    finally:
        shutil.rmtree(G, ignore_errors=True)


if __name__ == '__main__':
    main()
