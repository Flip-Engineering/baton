#!/usr/bin/env python3
"""FARM GPU: Blender / Python GPU jobs on the homelab farm from a lane's working tree (FARMGPU, 3 Oct 2026).

farm.py gpu posts a job for a script that is already committed and pushed. Builders who may not commit use this, the
farm_bench-style loop (research/capabilities/farm_bench.md, --include-deps): it lists the files the job needs that are new or
changed here, commits exactly those on the current branch (a private index and a compare-and-swap on the branch ref; the
working tree is never written), pushes, posts the job pinned to that commit (farm.py gpu --commit), waits and fetches the
delivery to videos/out/gpu/<job>/.

  farm_gpu.py stills NAME [--scene videos/blender/....py] [--blend FILE] [--scene-args "..."]
                     (--still TAG=FRAME[@CAMERA] ... | --frames A-B[:STEP]) [--samples N] [--res WxH] [--engine cycles|eevee]
                     [--denoise oidn|optix|none] [--format png|png16|exr|jpg] [--view AgX] [--seed N]
                     [JOB OPTIONS] [--dep PATH ...] [--yes | --dry]
        a still list or a frame range of a Blender scene (videos/blender/gpujob/stills.py on the farm)
  farm_gpu.py run (--blender videos/blender/S.py | --python videos/gpu/S.py) [JOB OPTIONS] [--dep PATH ...] [--yes | --dry] [-- ARGS]
        any gpu job script
  JOB OPTIONS: --gpus N  --per-gpu  --time MIN  --mem GB  --device cuda|optix|auto  --by WHO  --no-wait  --to DIR  --timeout S

Without --yes it prints exactly which files a commit would hold and stops (exit 3, nothing written). Which files: the job
script, the scene builder, the .blend, the Python modules they import from their own folder, videos/blender/ or videos/gpu/
(traced), the GPU harness itself (videos/scripts/gpu_job.*, videos/blender/gpujob/, videos/gpu/requirements*.txt) when it
differs from HEAD, and every --dep PATH (a file or a folder: data a scene reads, e.g. exported meshes and textures).
Refused, naming them (as farm_bench): anything under videos/review/, a refs_local folder or ~/.cache (reference photographs
are never committed), symlinks, paths outside videos/, gitignored or LFS-filtered files, files over 50 MB.
--dry runs the same job HERE through gpu_job.sh (the CPU when there is no NVIDIA card; keep --samples and --res small),
from the working tree, no git and no farm: the quickest check that the scene builds and every camera exists.
Docs: research/capabilities/farm_gpu.md
"""
import argparse, datetime, os, re, shlex, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import farm_bench as fb                                   # noqa: E402  (git helpers, refusals, the compare-and-swap commit)

REPO = fb.REPO
HARNESS = ['videos/scripts/gpu_job.sh', 'videos/scripts/gpu_job.py', 'videos/gpu/requirements.txt', 'videos/gpu/requirements-torch.txt']
HARNESS_DIRS = ['videos/blender/gpujob']
IMPORT_RE = re.compile(r'^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import\b|import\s+([A-Za-z_][\w., ]*))', re.M)


def log(*a):
    print('farm_gpu:', *a, flush=True)


def die(msg, code=2):
    print('farm_gpu: ' + msg, file=sys.stderr, flush=True)
    sys.exit(code)


def rel(p):
    p = os.path.normpath(p.strip())
    if os.path.isabs(p):
        p = os.path.relpath(p, REPO)
    return p


# ------------------------------------------------------------------ which files
def py_imports(path, roots):
    """repo .py files this script imports from its own folder or the job roots (videos/blender, videos/gpu), recursively"""
    seen, todo = set(), [path]
    while todo:
        p = todo.pop()
        if p in seen or not os.path.isfile(os.path.join(REPO, p)):
            continue
        seen.add(p)
        src = open(os.path.join(REPO, p), encoding='utf-8', errors='replace').read()
        names = []
        for m in IMPORT_RE.finditer(src):
            if m.group(1):
                names.append(m.group(1))
            else:
                names += [x.strip().split(' ')[0] for x in m.group(2).split(',') if x.strip()]
        for n in names:
            parts = n.split('.')
            for base in [os.path.dirname(p)] + roots:
                cand = os.path.join(base, *parts)
                if os.path.isfile(os.path.join(REPO, cand + '.py')):
                    todo.append(cand + '.py'); break
                if os.path.isdir(os.path.join(REPO, cand)) and os.path.isfile(os.path.join(REPO, cand, '__init__.py')):
                    todo += [os.path.join(cand, f) for f in sorted(os.listdir(os.path.join(REPO, cand))) if f.endswith('.py')]
                    break
                top = os.path.join(base, parts[0])
                if len(parts) > 1 and os.path.isfile(os.path.join(REPO, top, '__init__.py')):
                    todo += [os.path.join(top, f) for f in sorted(os.listdir(os.path.join(REPO, top))) if f.endswith('.py')]
                    break
    return seen


def wanted(a, kind, script):
    why = {}
    roots = ['videos/blender'] if kind == 'blender' else ['videos/gpu']
    for p in [script] + ([a.scene] if getattr(a, 'scene', None) else []):
        for f in py_imports(rel(p), roots):
            why.setdefault(f, 'job script' if f == rel(p) else 'imported')
    if a.blend:
        why[rel(a.blend)] = '--blend'
    for h in HARNESS:
        why.setdefault(h, 'GPU harness')
    for d in HARNESS_DIRS:
        for f in sorted(os.listdir(os.path.join(REPO, d))):
            if f.endswith('.py'):
                why.setdefault(os.path.join(d, f), 'GPU harness')
    for d in a.dep:
        p = rel(d)
        if fb.refusal(p):
            why[p] = '--dep'; continue
        if os.path.isdir(os.path.join(REPO, p)):
            fs = [f for f in fb.git('ls-files', '-z', '-c', '-o', '--exclude-standard', '--', p).split('\0') if f]
            if not fs:
                log('NOTE: --dep %s: no files in it (gitignored files are left out of a folder)' % d)
            for f in fs:
                why.setdefault(f, '--dep %s' % d)
        elif os.path.lexists(os.path.join(REPO, p)):
            why.setdefault(p, '--dep')
        else:
            die('--dep %s: no such file' % d)
    return why


def collect(why, base):
    """{path: bytes} of the files that are new or differ from base; dies (naming them) on a refused or missing file"""
    was = fb.blobs_at(base, [p for p in why if not p.startswith('..')])
    files, rows, refused, missing = {}, [], [], []
    for p in sorted(why):
        r = fb.refusal(p)
        full = os.path.join(REPO, p)
        if r:
            if p in was and why[p] != '--dep' and not why[p].startswith('--dep '):
                continue
            refused.append((p, r)); continue
        if not os.path.isfile(full):
            if p in was:
                continue                                  # not here, committed: the farm has it
            missing.append(p); continue
        b = open(full, 'rb').read()
        if was.get(p, (None, None))[1] == fb.blob_sha(b):
            continue
        if len(b) > fb.MAX_DEP_BYTES:
            refused.append((p, '%.0f MB is over the %d MB a commit here carries' % (len(b) / 2 ** 20, fb.MAX_DEP_BYTES >> 20))); continue
        files[p] = b
        fb.MODES[p] = was[p][0] if p in was else ('100755' if os.access(full, os.X_OK) else '100644')
        rows.append(('modified' if p in was else 'new', p, len(b), why[p]))
    if files:
        ign = fb.git('check-ignore', '-z', '--stdin', inp='\0'.join(files).encode(), check=False).stdout.decode().split('\0')
        refused += [(p, 'it is gitignored') for p in ign if p in files]
        attr = fb.git('check-attr', '-z', 'filter', '--stdin', inp='\0'.join(files).encode()).split('\0')
        refused += [(attr[i], 'it has a git filter (%s)' % attr[i + 2]) for i in range(0, len(attr) - 2, 3)
                    if attr[i + 2] not in ('unspecified', 'unset')]
    if refused:
        die('REFUSED: these files are not committed by a gpu job:\n  %s\nNothing committed.' % '\n  '.join(
            '%s: %s (%s)' % (p, r, why.get(p, '')) for p, r in refused))
    if missing:
        die('REFUSED: the job needs these files, which are neither here nor committed:\n  %s' % '\n  '.join(missing))
    return {'base': base, 'files': files, 'was': {p: v[1] for p, v in was.items() if p in files}, 'rows': rows}


# ------------------------------------------------------------------ commit, push
def message(name, by, inc):
    return ('farm gpu: %s (%d file%s) for the homelab farm\n\nThe files a GPU job needs, as %s had them in the working tree '
            '(videos/scripts/farm_gpu.py):\n%s\n\n%s\n%s\n' % (name, len(inc['files']), 's' if len(inc['files']) != 1 else '', by,
                                                           '\n'.join('  ' + p for p in sorted(inc['files'])), fb.COAUTHOR, fb.SESSION))


def third_version(inc, rev):
    now = fb.blobs_at(rev, inc['files'])
    return [p for p, b in inc['files'].items() if now.get(p, (None, None))[1] not in (inc['was'].get(p), fb.blob_sha(b))]


def commit(name, by, inc):
    br = fb.git('symbolic-ref', '-q', '--short', 'HEAD', check=False)
    if br.returncode:
        die('HEAD is detached: check out the branch first')
    branch = br.stdout.decode().strip()
    for attempt in range(10):
        head = fb.git('rev-parse', 'HEAD').strip()
        bad = third_version(inc, head) if head != inc['base'] else []
        if bad:
            die('REFUSED: since these files were read, a commit on %s changed them to another version: %s. Nothing committed; '
                'run again.' % (branch, ', '.join(bad)))
        if fb.holds(head, inc['files']):
            log('the files are already committed at %s' % head[:9])
            return branch, head
        c = fb.commit_on(head, inc['files'], message(name, by, inc))
        r = fb.git('update-ref', '-m', 'farm_gpu: %s' % name, 'refs/heads/' + branch, c, head, check=False)
        if r.returncode == 0:
            log('committed %s on %s (%d files)' % (c[:9], branch, len(inc['files'])))
            fb.sync_index(inc, head)
            return branch, c
        log('the branch moved while committing; retrying on the new HEAD')
        time.sleep(1 + attempt)
    die('the branch kept moving; nothing committed, try again')


def push(branch, sha, name, by, inc):
    delays = [2, 4, 8, 16]
    for attempt in range(8):
        r = fb.git('push', 'origin', '%s:refs/heads/%s' % (sha, branch), check=False)
        err = (r.stderr + r.stdout).decode(errors='replace')
        if r.returncode == 0:
            break
        if fb.REJECT.search(err) and not fb.NET.search(err):
            if fb.git('fetch', '-q', 'origin', branch, check=False).returncode == 0:
                rem = fb.git('rev-parse', 'FETCH_HEAD').strip()
                if fb.git('merge-base', '--is-ancestor', sha, rem, check=False).returncode == 0:
                    break
                if fb.git('merge-base', '--is-ancestor', rem, sha, check=False).returncode == 0:
                    time.sleep(2); continue
                if fb.holds(rem, inc['files']):
                    sha = rem; break
                bad = third_version(inc, rem)
                if bad:
                    die('push refused: origin/%s moved on and holds another version of %s; not overriding it, nothing posted' % (
                        branch, ', '.join(bad)))
                sha = fb.commit_on(rem, inc['files'], message(name, by, inc))
                log('origin/%s has commits this tree lacks: the job commit is rebased onto %s -> %s (the local branch is '
                    'not moved; the farm runs the remote versions of everything else)' % (branch, rem[:9], sha[:9]))
                continue
        if fb.NET.search(err) and delays:
            time.sleep(delays.pop(0)); continue
        die('push failed: %s' % err.strip()[-600:])
    else:
        die('push did not land after retries')
    log('pushed %s to origin/%s' % (sha[:9], branch))
    return sha


# ------------------------------------------------------------------ the job
def job_args(a):
    """(kind, script, script args) for this command"""
    if a.cmd == 'stills':
        args = []
        if a.scene:
            args += ['--scene', rel(a.scene)]
            if a.scene_args:
                args += ['--scene-args', a.scene_args]
        for s in a.still:
            args += ['--still', s]
        if a.frames:
            args += ['--frames', a.frames]
        for k in ('samples', 'res', 'engine', 'denoise', 'format', 'view', 'seed'):
            v = getattr(a, k)
            if v not in (None, ''):
                args += ['--' + k, str(v)]
        if a.save_blend:
            args += ['--save-blend']
        return 'blender', 'videos/blender/gpujob/stills.py', args + a.passthru
    if bool(a.blender) == bool(a.python):
        die('run: --blender videos/blender/S.py or --python videos/gpu/S.py')
    return ('blender', rel(a.blender), a.passthru) if a.blender else ('python', rel(a.python), a.passthru)


def opts(a):
    o = ['--gpus', str(a.gpus), '--time', '%g' % a.time, '--mem', '%g' % a.mem]
    if a.per_gpu:
        o.append('--per-gpu')
    if a.device:
        o += ['--device', a.device]
    if a.blend:
        o += ['--blend', rel(a.blend)]
    return o


def dry(a, kind, script, args):
    jid = 'dry-%s-%s' % (re.sub(r'[^A-Za-z0-9_.-]', '_', a.name), datetime.datetime.now().strftime('%m%d-%H%M%S'))
    o = opts(a)
    nv = subprocess.run(['sh', '-c', 'command -v nvidia-smi'], capture_output=True).returncode == 0
    if not nv and kind == 'blender' and not a.device:
        o += ['--device', 'cpu']
    cmd = ['sh', 'videos/scripts/gpu_job.sh', kind, script, '--id', jid] + o + ['--'] + args
    log('dry run here (%s): %s' % ('GPU' if nv else 'CPU', ' '.join(shlex.quote(c) for c in cmd)))
    env = dict(os.environ, GPU_JOB_ALLOW_UNTRACKED='1')
    env.pop('GPU_JOB_REQUIRE_GPU', None)
    r = subprocess.run(cmd, cwd=REPO, env=env)
    log('outputs: videos/out/gpu/%s/out/ (receipt: deliver/receipt.json)' % jid)
    sys.exit(r.returncode)


def main():
    argv = sys.argv[1:]
    passthru = []
    if '--' in argv:
        k = argv.index('--'); argv, passthru = argv[:k], argv[k + 1:]
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['stills', 'run'])
    ap.add_argument('name', nargs='?', default='')
    ap.add_argument('--scene', default=''); ap.add_argument('--scene-args', default=''); ap.add_argument('--blend', default='')
    ap.add_argument('--still', action='append', default=[]); ap.add_argument('--frames', default='')
    ap.add_argument('--samples'); ap.add_argument('--res'); ap.add_argument('--engine'); ap.add_argument('--denoise')
    ap.add_argument('--format'); ap.add_argument('--view'); ap.add_argument('--seed'); ap.add_argument('--save-blend', action='store_true')
    ap.add_argument('--blender', default=''); ap.add_argument('--python', default='')
    ap.add_argument('--gpus', type=int, default=1); ap.add_argument('--per-gpu', action='store_true')
    ap.add_argument('--time', type=float, default=60); ap.add_argument('--mem', type=float, default=24)
    ap.add_argument('--device', default='')
    ap.add_argument('--dep', action='append', default=[]); ap.add_argument('--yes', action='store_true')
    ap.add_argument('--dry', action='store_true'); ap.add_argument('--by', default=os.environ.get('FARM_BY', 'studio'))
    ap.add_argument('--no-wait', action='store_true'); ap.add_argument('--to', default=''); ap.add_argument('--timeout', type=float, default=5400)
    a = ap.parse_args(argv)
    a.passthru = passthru
    if not a.name:
        a.name = os.path.basename(a.blender or a.python or a.scene or 'job').rsplit('.', 1)[0]
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,40}', a.name):
        die('NAME: letters, digits, _ . - (up to 40)')
    kind, script, args = job_args(a)
    if a.dry:
        dry(a, kind, script, args)
    inc = collect(wanted(a, kind, script), fb.git('rev-parse', 'HEAD').strip())
    br = fb.git('symbolic-ref', '-q', '--short', 'HEAD', check=False).stdout.decode().strip() or '(detached)'
    log('%s on %s: %s' % ('COMMITTING these files' if a.yes else 'a commit would hold exactly these files', br,
                          '' if inc['rows'] else 'none (everything the job needs is committed at HEAD)'))
    for st, p, n, why in inc['rows']:
        print('  %-9s %-70s %9s  %s' % (st, p, '%.1f KB' % (n / 1024), why), flush=True)
    if not a.yes:
        log('nothing written. Check the list, then run again with --yes (or --dry to run it here first).')
        sys.exit(3)
    if inc['files']:
        branch, sha = commit(a.name, a.by, inc)
    else:
        branch, sha = br, fb.git('rev-parse', 'HEAD').strip()
    sha = push(branch, sha, a.name, a.by, inc)
    cmd = [sys.executable, os.path.join(HERE, 'farm.py'), 'gpu', '--' + kind, script, '--commit', sha, '--by', a.by,
           '--title', 'gpu %s %s' % (a.cmd, a.name), '--timeout', '%g' % a.timeout] + opts(a)
    if a.no_wait:
        cmd.append('--no-wait')
    if a.to:
        cmd += ['--to', a.to]
    if args:
        cmd += ['--'] + args
    sys.exit(subprocess.run(cmd).returncode)


if __name__ == '__main__':
    main()
