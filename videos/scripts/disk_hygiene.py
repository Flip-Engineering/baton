#!/usr/bin/env python3
"""Disk hygiene for the render machine: see where the space went, prune stale scratch safely, stop renders early.

The machine is one 252 GB volume shared by every agent. Renders, gate scans and review clips pile up in
scratchpads and untracked folders until a render dies half-written. This tool is the one approved way to
look and to prune. It is DRY-RUN by default: nothing is deleted without --apply.

  disk_hygiene.py report                        free space + the biggest things in each zone, protected ones marked
  disk_hygiene.py prune --older-than 24         list what WOULD go (stale for 24 h, in every zone)
  disk_hygiene.py prune --older-than 24 --zone scratch --apply     actually delete
  disk_hygiene.py check --min-gb 1.5            exit 2 when free space is under 1.5 GB (render preflight)
  disk_hygiene.py --selftest                    builds a fake tree in a temp dir and proves the rules

Zones:
  scratch   top-level entries of every Claude scratchpad (/tmp/claude-*/*/*/scratchpad/*)
  review    UNTRACKED files under videos/review/ (git-tracked files are never touched: they are history)
  out       UNTRACKED media under videos/out/ (the song wavs/hits .<scene>.* and .footage/ caches are kept)
  logs      untracked videos/logs/*.log
  cache     pip and npm download caches (never the playwright browsers)

Never touched, whatever the flags (NEVER below, plus videos/scripts/disk_protect.txt, one path per line):
  - /home/user/music-video-studies (the remote git archive) and every .git directory;
  - anything git-tracked; anything inside a tree that holds a .git (repo clones in a scratchpad);
  - scratch entries named deliver* / final* / publish* (finished videos that may exist nowhere else);
  - any directory holding a file named .keep;
  - anything modified within --older-than hours (default 24): in-flight work of other agents.
Every deletion is appended to videos/logs/disk_hygiene.log (path, bytes, age).
"""
import argparse
import glob
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
REPO = os.path.dirname(VIDEOS)
HOME = os.path.expanduser('~')
NEVER = ['/home/user/music-video-studies', os.path.join(REPO, '.git'), os.path.join(REPO, 'research'),
         os.path.join(HOME, '.cache', 'ms-playwright'), '/opt', '/usr', '/root/.ccr']
KEEP_NAMES = ('deliver', 'final', 'publish')
PROTECT_FILE = os.path.join(HERE, 'disk_protect.txt')
LOG = os.path.join(VIDEOS, 'logs', 'disk_hygiene.log')
SCRATCH_GLOB = '/tmp/claude-*/*/*/scratchpad'


def gb(n):
    return f'{n / 1e9:6.2f} GB' if n >= 1e8 else f'{n / 1e6:6.1f} MB'


def free_bytes(path='/'):
    return shutil.disk_usage(path).free


def protected_roots():
    roots = list(NEVER)
    if os.path.exists(PROTECT_FILE):
        for ln in open(PROTECT_FILE):
            ln = ln.split('#')[0].strip()
            if ln:
                roots.append(os.path.abspath(os.path.expanduser(ln)))
    return [os.path.realpath(r) for r in roots]


def under(path, roots):
    p = os.path.realpath(path)
    return any(p == r or p.startswith(r.rstrip('/') + '/') for r in roots)


def tree_stats(path):
    """(bytes, newest mtime, has .git, has .keep) of a file or tree; symlinks are not followed."""
    if os.path.islink(path) or os.path.isfile(path):
        st = os.lstat(path)
        return st.st_size, st.st_mtime, False, False
    size, newest, git, keep = 0, 0.0, False, False     # newest FILE mtime (dir mtimes move when files are added)
    for d, dirs, files in os.walk(path):
        if '.git' in dirs or '.git' in files:
            git = True
        if '.keep' in files:
            keep = True
        for f in files:
            try:
                st = os.lstat(os.path.join(d, f))
            except OSError:
                continue
            size += st.st_size
            newest = max(newest, st.st_mtime)
    return size, newest or os.lstat(path).st_mtime, git, keep


def git_untracked(sub):
    """Untracked (incl. ignored) files under REPO/sub, absolute paths."""
    try:
        r = subprocess.run(['git', '-C', REPO, 'ls-files', '--others', '-z', '--', sub], capture_output=True, check=True)
    except Exception:  # noqa: BLE001
        return []
    return [os.path.join(REPO, p) for p in r.stdout.decode(errors='replace').split('\0') if p]


# ------------------------------------------------------------------ candidates per zone
def cand_scratch(roots):
    for sp in glob.glob(SCRATCH_GLOB):
        for e in sorted(os.listdir(sp)):
            p = os.path.join(sp, e)
            why = None
            if e.lower().startswith(KEEP_NAMES):
                why = f'name starts {"/".join(KEEP_NAMES)} (finished work)'
            yield 'scratch', p, why


def cand_repo(sub, keep=lambda p: False):
    for p in git_untracked(sub):
        if os.path.isfile(p) or os.path.islink(p):
            yield p, ('song/cache file render.mjs reads' if keep(p) else None)


def cand_review(roots):
    for p, why in cand_repo('videos/review'):
        yield 'review', p, why


def cand_out(roots):
    keep = lambda p: any(c.startswith('.') for c in os.path.relpath(p, os.path.join(VIDEOS, 'out')).split(os.sep)) \
        or '/farm/' in p      # .<scene>.wav/.hits.json, .footage/, .pcache/ ... are caches render.mjs reads
    for p, why in cand_repo('videos/out', keep):
        yield 'out', p, why


def cand_logs(roots):
    for p, why in cand_repo('videos/logs'):
        if p.endswith('.log') and os.path.abspath(p) != LOG:
            yield 'logs', p, why


def cand_cache(roots):
    for p in (os.path.join(HOME, '.cache', 'pip'), os.path.join(HOME, '.npm', '_cacache')):
        if os.path.exists(p):
            yield 'cache', p, None


ZONES = {'scratch': cand_scratch, 'review': cand_review, 'out': cand_out, 'logs': cand_logs, 'cache': cand_cache}


def plan(zones, older_h, now=None):
    """[(zone, path, bytes, age_h, reason_kept or None)] for every candidate in the zones."""
    now = now or time.time()
    roots = protected_roots()
    rows = []
    for z in zones:
        for zone, p, why in ZONES[z](roots):
            if not os.path.lexists(p):
                continue
            size, newest, git, keep = tree_stats(p)
            age = (now - newest) / 3600
            if why is None and (under(p, roots) or '/.git/' in p + '/' or os.path.basename(p) == '.git'):
                why = 'protected path'
            if why is None and git:
                why = 'holds a .git (a repo clone)'
            if why is None and keep:
                why = 'holds a .keep file'
            if why is None and age < older_h:
                why = f'touched {age:.1f} h ago (< {older_h:g} h)'
            rows.append((zone, p, size, age, why))
    return rows


def delete(p):
    if os.path.isdir(p) and not os.path.islink(p):
        shutil.rmtree(p)
    else:
        os.remove(p)


def prune(zones, older_h, apply=False, out=sys.stdout, log=LOG):
    rows = plan(zones, older_h)
    go = [r for r in rows if r[4] is None]
    kept = [r for r in rows if r[4] is not None]
    w = out.write
    w(f'{"DELETE" if apply else "WOULD DELETE"} ({len(go)} items, {gb(sum(r[2] for r in go)).strip()}), '
      f'stale for {older_h:g} h+:\n')
    for z, p, s, a, _ in sorted(go, key=lambda r: -r[2])[:60]:
        w(f'  {z:8} {gb(s)}  {a:6.1f} h  {p}\n')
    if len(go) > 60:
        w(f'  ... and {len(go) - 60} more (smaller)\n')
    big_kept = sorted(kept, key=lambda r: -r[2])[:15]
    if big_kept:
        w('KEPT (largest):\n')
        for z, p, s, a, why in big_kept:
            w(f'  {z:8} {gb(s)}  {p}  -- {why}\n')
    freed = 0
    if apply:
        os.makedirs(os.path.dirname(log), exist_ok=True)
        with open(log, 'a') as lf:
            for z, p, s, a, _ in go:
                try:
                    delete(p)
                    freed += s
                    lf.write(f'{time.strftime("%Y-%m-%dT%H:%M:%S")}\t{z}\t{s}\t{a:.1f}h\t{p}\n')
                except OSError as e:
                    w(f'  could not delete {p}: {e}\n')
        w(f'freed {gb(freed).strip()}; free now {gb(free_bytes()).strip()}\n')
    else:
        w('dry run: nothing deleted (add --apply)\n')
    return go, freed


def du(path):
    try:
        return tree_stats(path)[0]
    except OSError:
        return 0


def report(out=sys.stdout):
    w = out.write
    u = shutil.disk_usage('/')
    w(f'/: {gb(u.total).strip()} total, {gb(u.used).strip()} used, {gb(u.free).strip()} free ({u.used / (u.used + u.free):.0%} used, as df counts it)\n')
    roots = protected_roots()
    places = [('scratchpads', p) for p in glob.glob(SCRATCH_GLOB)] + [
        ('repo .git', os.path.join(REPO, '.git')), ('videos/review', os.path.join(VIDEOS, 'review')),
        ('videos/out', os.path.join(VIDEOS, 'out')), ('videos/logs', os.path.join(VIDEOS, 'logs')),
        ('music-video-studies', '/home/user/music-video-studies'), ('~/.cache', os.path.join(HOME, '.cache')),
        ('~/.npm', os.path.join(HOME, '.npm'))]
    for name, p in places:
        if os.path.exists(p):
            w(f'  {gb(du(p))}  {name:20} {p}{"  [PROTECTED]" if under(p, roots) else ""}\n')
    for sp in glob.glob(SCRATCH_GLOB):
        ents = [(du(os.path.join(sp, e)), e) for e in os.listdir(sp)]
        w(f'  largest in {sp}:\n')
        for s, e in sorted(ents, reverse=True)[:8]:
            w(f'    {gb(s)}  {e}\n')
    for sub in ('videos/review', 'videos/out'):
        un = git_untracked(sub)
        w(f'  untracked in {sub}: {len(un)} files, {gb(sum(os.path.getsize(p) for p in un if os.path.isfile(p))).strip()}\n')


def check(min_gb, path='/'):
    f = free_bytes(path)
    if f < min_gb * 1e9:
        sys.stderr.write(f'disk_hygiene: only {gb(f).strip()} free on {path} (need {min_gb:g} GB). '
                         f'Run: python3 videos/scripts/disk_hygiene.py prune --older-than 24   (dry run first)\n')
        return 2
    print(f'disk ok: {gb(f).strip()} free (need {min_gb:g} GB)')
    return 0


def selftest():
    """Fake scratchpad + protect file in a temp dir; prune must delete only the stale, unprotected entry."""
    import io
    import tempfile
    global SCRATCH_GLOB, PROTECT_FILE, NEVER
    saved = SCRATCH_GLOB, PROTECT_FILE, NEVER
    with tempfile.TemporaryDirectory() as td:
        sp = os.path.join(td, 'claude-x', 'proj', 'sess', 'scratchpad')
        old = time.time() - 72 * 3600

        def mk(rel, age=old, size=1000):
            p = os.path.join(sp, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(b'\0' * size)
            os.utime(p, (age, age))
            return p
        mk('stale/a.mp4'); mk('stale/b.wav')
        mk('fresh/a.mp4', age=time.time())
        mk('deliver/final.mp4')
        mk('clone/.git/HEAD'); mk('clone/x.py')
        mk('pinned/.keep'); mk('pinned/big.mp4')
        mk('guarded/x.mp4')
        pf = os.path.join(td, 'protect.txt')
        open(pf, 'w').write(os.path.join(sp, 'guarded') + '  # test\n')
        SCRATCH_GLOB, PROTECT_FILE, NEVER = os.path.join(td, 'claude-*/*/*/scratchpad'), pf, []
        try:
            buf = io.StringIO()
            go, _ = prune(['scratch'], 24, apply=False, out=buf)
            assert [os.path.basename(r[1]) for r in go] == ['stale'], buf.getvalue()
            assert os.path.exists(os.path.join(sp, 'stale')), 'dry run deleted something'
            go, freed = prune(['scratch'], 24, apply=True, out=io.StringIO(), log=os.path.join(td, 'log'))
            assert not os.path.exists(os.path.join(sp, 'stale')) and freed == 2000
            for keep in ('fresh', 'deliver', 'clone', 'pinned', 'guarded'):
                assert os.path.exists(os.path.join(sp, keep)), keep
            assert 'stale' in open(os.path.join(td, 'log')).read()
        finally:
            SCRATCH_GLOB, PROTECT_FILE, NEVER = saved
    assert under('/home/user/music-video-studies/x', protected_roots())
    assert check(0.0) == 0 and check(1e9) == 2
    print('disk_hygiene selftest: OK (stale pruned; fresh, deliver, clone, .keep, protect-file entries kept)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__)
    ap.add_argument('cmd', nargs='?', choices=['report', 'prune', 'check'], default='report')
    ap.add_argument('--older-than', type=float, default=24.0, help='hours untouched before an item may go (default 24)')
    ap.add_argument('--zone', default='scratch,review,out,logs,cache', help='comma list of ' + ','.join(ZONES))
    ap.add_argument('--apply', action='store_true', help='really delete (default: dry run)')
    ap.add_argument('--min-gb', type=float, default=1.5)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.cmd == 'report':
        return report()
    if a.cmd == 'check':
        sys.exit(check(a.min_gb))
    zones = [z for z in a.zone.split(',') if z]
    bad = [z for z in zones if z not in ZONES]
    if bad:
        ap.error(f'unknown zone {bad}')
    if a.older_than < 2:
        ap.error('--older-than under 2 h would hit other agents\' in-flight work')
    prune(zones, a.older_than, a.apply)


if __name__ == '__main__':
    main()
