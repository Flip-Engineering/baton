#!/usr/bin/env python3
"""FARM PLATES: a bench's plates shot on the farm's V100s as a GPU job, delivered as PNG stills (TOOLING-GPUPLATES, 8 Oct).

Since 8 Oct ~04:14 UTC the farm refuses every bench pinned to a later commit ("Renderer changed: adapter needs review"): main
changed render.mjs, and the worker's renderer adapter is verified only for the old one. The farm's GPU job type
(gpu_job.sh, research/capabilities/farm_gpu.md) runs no render.mjs. This posts the same plate list as a GPU job,
videos/gpu/plates_job.py, which runs lib/bench_scene.js's protocol in headless Chromium on the GPU (lib/plates_gpu.mjs,
launched through lib/launch.mjs) and delivers <tag>.png per plate plus plates_receipt.json. There is no video, no closer and no song.

  farm_plates.py NAME --by LANE --plates FILE.json [--time MIN] [--mem GB] [--pool N] [--dry] [--wait]
      FILE.json is farm_bench's plate list ([{tag, lab, query, t, warm, caption, ready_s, transfer}, ...] or {"plates": [...],
      "deps": [...]}). It is validated with farm_bench.py's own build_list()/make_plate() (imported, not forked): the same
      rules and messages. The normalised list travels INLINE in the job's arguments (--list-z: zlib + base64, ~600 characters
      for 34 plates), because the farm's checkout is sparse and has no videos/review/, where lanes keep their plates files
      (the first test job, 1008-085725, failed on exactly that). So FILE.json itself need not be committed. Without
      --include-deps nothing is committed, so the job must find at HEAD:
        - every plate's lab and what it imports (farm_bench's check_deps, the same refusals: missing, or uncommitted edits in
          lab files unless --allow-dirty), plus the file's "deps" data paths (refused under videos/review/: not on the farm);
        - the plates harness (plates_job.py, plates_gpu.mjs, launch.mjs, bench_scene.js, farm_bench.py, the npm lock).
      farm.py pins HEAD itself (a full 40-character SHA), and refuses if HEAD is not pushed.
  farm_plates.py NAME --by LANE --plates FILE.json --include-deps [--dep PATH ...] [--skip-dep PATH ...] [--yes]
      for lanes that may not commit: farm_bench's --include-deps machinery, reused as it is. The plates' own uncommitted files are
      traced in the working tree and listed, and the command stops. --yes commits them together with the normalised list
      videos/web/assets/bench/NAME.json and its stub, in one compare-and-swap commit, and pushes it (rebased onto the remote tip
      if the remote moved, without moving the local branch). The job is pinned to that commit (--commit); the list still goes inline.
      The refusals are farm_bench's: videos/review/, refs_local, ~/.cache, symlinks, gitignored or LFS files, files over 50 MB.
  --dry      validate, check, and print the farm.py command; nothing is committed or posted
  --wait     after posting, wait for the job and fetch it to videos/out/plates/NAME/<job>/ (default: post and print the commands)
  --pool N   plates in flight in the job (1-4, default 2);  --gl gpu|auto|cpu (default gpu: no silent SwiftShader);
  --render-timeout S (opt into per-plate deadlines; default none, the farm's no-time-gates policy);  --only TAG,TAG (only these plates)
Fetch:  python3 videos/scripts/farm.py fetch <job> --to videos/out/plates/NAME/<job>    (<tag>.png, plates_receipt.json,
        gpu_info.json, receipt.json, log.txt; a failed plate comes as <tag>.ERROR.png with the reason in it and in the receipt)
Compare with a bench:  python3 videos/scripts/farm_bench.py --compare videos/out/bench/<bench>/<job> videos/out/plates/NAME/<job>
"""
import argparse, atexit, base64, json, os, re, shlex, shutil, subprocess, sys, tempfile, time, types, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)
REPO = os.path.dirname(VID)
sys.path.insert(0, HERE)
import farm_bench as fb                                    # noqa: E402  (validation, dependency checks, --include-deps: reused)

JOB = 'videos/gpu/plates_job.py'
HARNESS = [JOB, 'videos/web/lib/plates_gpu.mjs', 'videos/web/lib/launch.mjs', 'videos/web/lib/bench_scene.js', 'videos/web/cache_server.mjs',
           'videos/scripts/farm_bench.py', 'videos/scripts/gpu_job.py', 'videos/scripts/gpu_job.sh', 'videos/web/package.json',
           'videos/web/package-lock.json', 'videos/blender/pw_resolve.mjs', 'videos/blender/pw_hook.mjs']
NOTES = ('GPU PLATES job (TOOLING-GPUPLATES, videos/gpu/plates_job.py): lab stills captured with headless Chromium on the GPU '
         '(lib/launch.mjs launchRender; the lib/bench_scene.js plate protocol, lib/plates_gpu.mjs) inside the gpu_job.sh harness. '
         'It runs no render.mjs and makes no video. Deliver every file in videos/out/gpu/<id>/deliver/ (<tag>.png, plates_receipt.json, '
         'gpu_info.json, receipt.json, log.txt).')


def log(*a):
    print('farm_plates:', *a, flush=True)


def die(msg, code=2):
    print('farm_plates: ' + msg, file=sys.stderr, flush=True)
    sys.exit(code)


def committed_clean(head, paths, what):
    """each path (file or folder) has something at head; returns (missing, dirty) lists"""
    missing, dirty = [], []
    for p in paths:
        if not fb.git('ls-tree', '-r', '--name-only', head, '--', p).strip():
            missing.append('%s (%s)' % (p, what)); continue
        st = fb.git('status', '--porcelain=v1', '--untracked-files=all', '--', p).strip()
        if st:
            dirty.append('%s (%s): %s' % (p, what, ' '.join(l[3:] for l in st.splitlines()[:4])))
    return missing, dirty


def harness_check(rev):
    have = fb.blobs_at(rev, HARNESS)
    miss = [p for p in HARNESS if p not in have]
    if miss:
        die('REFUSED: the GPU plates harness is not committed at %s: %s (it is part of the TOOLING commit that added '
            'farm_plates.py; pull, or ask the orchestrator)' % (rev[:9], ', '.join(miss)))
    diff = [p for p in HARNESS if os.path.isfile(os.path.join(REPO, p)) and
            fb.blob_sha(open(os.path.join(REPO, p), 'rb').read()) != have[p][1]]
    if diff:
        log('NOTE: harness file(s) differ here from %s; the farm runs the committed version: %s' % (rev[:9], ', '.join(diff)))


def farm(*args, retries=3):
    for attempt in range(retries + 1):
        r = subprocess.run([sys.executable, os.path.join(HERE, 'farm.py')] + list(args), capture_output=True, text=True)
        if r.returncode and 'git fetch:' in r.stderr and attempt < retries:     # failed reading main, before any write: safe to retry
            log('farm.py could not read main (%s); retry in %d s' % (r.stderr.strip().splitlines()[-1][:100], 2 ** (attempt + 1)))
            time.sleep(2 ** (attempt + 1)); continue
        return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('name', help='[a-z0-9_]{1,40}: names the job and its fetch folder (and, with --include-deps, the committed list)')
    ap.add_argument('--by', default=os.environ.get('FARM_BY'), help='your lane (required; or FARM_BY)')
    ap.add_argument('--plates', help='the plate list (farm_bench format)')
    ap.add_argument('--plate', action='append', default=[], help="TAG=LAB.html?QUERY[#t=S&warm=N&caption=TEXT] (repeatable)")
    ap.add_argument('--include-deps', action='store_true', help="commit the plates' own uncommitted files with the list (lists them; --yes commits)")
    ap.add_argument('--dep', action='extend', nargs='+', default=[], metavar='PATH', help='--include-deps: a file or folder a lab fetch()es')
    ap.add_argument('--skip-dep', action='extend', nargs='+', default=[], metavar='PATH', help='--include-deps: keep this at its committed version')
    ap.add_argument('--yes', action='store_true', help='--include-deps: commit the listed files, push and post')
    ap.add_argument('--allow-dirty', action='store_true', help='post although lab files have uncommitted edits (the farm renders the committed ones)')
    ap.add_argument('--time', type=float, default=60, help='the job\'s --time, minutes (default 60)')
    ap.add_argument('--mem', type=float, default=32, help='the job\'s host RAM, GB (default 32)')
    ap.add_argument('--pool', type=int, default=2, help='plates in flight in the job (1-4, default 2)')
    ap.add_argument('--gl', choices=('gpu', 'auto', 'cpu'), default='gpu', help='gpu (default): hardware WebGL required; auto: else SwiftShader')
    ap.add_argument('--gl-args', default='', help="Chromium args tried first (default: ANGLE GL/EGL, the bench workers' backend); 'launch' = launch.mjs's order")
    ap.add_argument('--render-timeout', type=float, default=0, help='opt into per-plate deadlines (S s after ready_s); default none, the farm\'s policy')
    ap.add_argument('--only', default='', help='comma list of tags to capture (a subset of the list)')
    ap.add_argument('--dry', action='store_true', help='check and print the farm.py command; commit and post nothing')
    ap.add_argument('--wait', action='store_true', help='wait for the job and fetch it to videos/out/plates/NAME/<job>/')
    ap.add_argument('--timeout', type=float, default=5400, help='--wait: give up after this many seconds')
    a = ap.parse_args()
    if not re.fullmatch(r'[a-z0-9_]{1,40}', a.name):
        die('NAME %r: [a-z0-9_]{1,40}, e.g. farm_plates.py detail7_i2 --by DETAIL7 --plates FILE.json' % a.name)
    if not a.by:
        die('say who the job is for: --by LANE (or FARM_BY)')
    if not a.plates and not a.plate:
        die('--plates FILE.json (or --plate TAG=LAB.html?QUERY, repeatable)')
    if (a.dep or a.skip_dep) and not a.include_deps:
        die('--dep / --skip-dep go with --include-deps')
    cli_deps = list(a.dep)
    ns = types.SimpleNamespace(name=a.name, by=a.by, plate=a.plate, plates=a.plates, dep=list(a.dep), skip_dep=a.skip_dep, repeat=3)
    lst = fb.build_list(ns)                                  # farm_bench's validation (dies with its message on a bad plate)
    file_deps = ns.dep[len(cli_deps):]                       # "deps" the list file names (build_list added them)
    if a.only:
        want = [t.strip() for t in a.only.split(',') if t.strip()]
        bad = [t for t in want if t not in {p['tag'] for p in lst['plates']}]
        if bad:
            die('--only: no such tag(s) in the list: %s' % ', '.join(bad))
        lst['plates'] = [p for p in lst['plates'] if p['tag'] in want]
    n = len(lst['plates'])
    log('%s: %d plate(s) (%s), by %s' % (a.name, n, ', '.join(sorted({p['lab'] for p in lst['plates']})), a.by))
    head = fb.git('rev-parse', 'HEAD').strip()
    commit = None
    if a.include_deps:
        inc = fb.collect_deps(lst, ns, head)
        fb.show_deps(inc, lst, a.yes and not a.dry)
        if a.dry:
            log('--dry: --yes would commit exactly those files on HEAD %s, push, and post the job pinned to that commit' % head[:9])
            harness_check(head)
        elif not a.yes:
            log('nothing committed or posted. Re-run with --yes to commit exactly these files with the plate list, push and post.')
            return 3
        else:
            harness_check(head)
            branch, sha, data = fb.commit_bench(lst, a.by, inc)
            commit = fb.push(branch, sha, lst, data, a.by, inc)
            harness_check(commit)
    else:
        dp = [fb.rpath(d) for d in file_deps]
        bad = [p for p in dp if p.startswith('videos/review/') or 'refs_local' in p.split('/')]
        if bad:
            die('REFUSED: the list\'s "deps" name review material, which the farm\'s sparse checkout does not have: %s' % ', '.join(bad))
        missing, dirty = committed_clean(head, dp, 'a "deps" entry of the list')
        if missing:
            die('REFUSED: not committed at %s, so the farm would not have them:\n  %s\nCommit them, or use --include-deps.'
                % (head[:9], '\n  '.join(missing)))
        if dirty and not a.allow_dirty:
            die('REFUSED: uncommitted edits in the list\'s "deps" (the farm reads the committed version):\n  %s\nCommit them, use '
                '--include-deps, or --allow-dirty.' % '\n  '.join(dirty))
        deps, missing, dirty_lab, dirty_lib = fb.check_deps(lst, head, a.allow_dirty, skip=fb.bench_paths(a.name))
        missing = [m for m in missing if not m.startswith('videos/web/audio/songs.py')]   # the bench song alias: not used here
        fb.report_deps(deps, missing, dirty_lab, dirty_lib, a.allow_dirty, head)
        harness_check(head)
    z = base64.urlsafe_b64encode(zlib.compress(json.dumps({'plates': lst['plates']}, separators=(',', ':')).encode(), 9)).decode().rstrip('=')
    if len(z) > 60000:
        die('the plate list is %d characters inline; split it into several jobs (NAME_a, NAME_b, ...)' % len(z))
    src = os.path.relpath(os.path.abspath(a.plates), REPO) if a.plates else '--plate'
    job_args = ['--list-z', z, '--name', a.name, '--by', a.by, '--source', src]
    if a.pool != 2:
        job_args += ['--pool', str(max(1, min(4, a.pool)))]
    if a.gl != 'gpu':
        job_args += ['--gl', a.gl]
    if a.gl_args:
        job_args += ['--gl-args', a.gl_args]
    if a.render_timeout:
        job_args += ['--render-timeout', '%g' % a.render_timeout]
    cmd = ['gpu', '--python', JOB, '--time', '%g' % a.time, '--mem', '%g' % a.mem, '--no-wait', '--by', a.by,
           '--title', 'plates %s (%d plates)' % (a.name, n), '--notes', NOTES] + (['--commit', commit] if commit else []) + ['--'] + job_args
    shown = 'python3 videos/scripts/farm.py ' + ' '.join(shlex.quote(c) for c in cmd)
    if a.dry:
        log('--dry: would post%s:\n  %s' % (' (pinned by farm.py to HEAD %s, which must be pushed)' % head if not a.include_deps else
                                              ' (pinned to the commit --yes makes)', shown))
        return 0
    cache = os.path.dirname(os.path.expanduser(os.environ.get('FARM_CACHE', '~/.cache/acp-farm')))
    os.makedirs(cache, exist_ok=True)                        # a private farm.py cache per run: no shared git lock with other agents
    os.environ['FARM_CACHE'] = tempfile.mkdtemp(prefix='farm_plates_', dir=cache)
    atexit.register(shutil.rmtree, os.environ['FARM_CACHE'], True)
    log('posting: ' + shown)
    r = farm(*cmd)
    out = (r.stdout or '') + (r.stderr or '')
    m = re.search(r'^posted (\S+)', r.stdout or '', re.M)
    if r.returncode or not m:
        die('farm.py gpu failed (exit %d): %s' % (r.returncode, out.strip()[-800:]))
    jid = m.group(1)
    to = 'videos/out/plates/%s/%s' % (a.name, jid)
    print(out.strip(), flush=True)
    log('posted %s%s' % (jid, ' at %s' % commit if commit else ' (pinned to HEAD %s)' % head))
    log('watch:  python3 videos/scripts/farm.py show %s      (state open -> claimed -> done | failed)' % jid)
    log('fetch:  python3 videos/scripts/farm.py fetch %s --to %s' % (jid, to))
    if not a.wait:
        return 0
    w = farm('wait', jid, '--timeout', '%g' % a.timeout, retries=0)
    print((w.stdout or '').strip()[-1500:], flush=True)
    if w.returncode:
        die('%s did not finish done (see farm.py show %s)' % (jid, jid), 1)
    f = farm('fetch', jid, '--to', os.path.join(REPO, to))
    print(((f.stdout or '') + (f.stderr or '')).strip()[-1500:], flush=True)
    for rc in (os.path.join(REPO, to, 'plates_receipt.json'), os.path.join(REPO, to, 'out', 'plates_receipt.json')):
        if os.path.exists(rc):
            r = json.load(open(rc))
            log('%s: %s; GL %s; errors: %s' % (jid, r.get('counts'), (r.get('gl') or {}).get('renderer'), r.get('errors') or 'none'))
            break
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
