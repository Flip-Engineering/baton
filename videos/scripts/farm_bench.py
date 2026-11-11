#!/usr/bin/env python3
"""FARM BENCH: lab views shot on the homelab farm's V100s (TOOLING, 3 Oct; research/capabilities/farm_bench.md).

The farm renders one recipe only (local_render.sh --seg SCENE:CLOSER[:BPM], one full scene per job, at the job's
pipeline_commit). A bench turns lab views into such a scene: web/lib/bench_scene.js loads each plate's lab in an iframe,
renders it and shows it 1:1 as frames of a 1080x1920 scene (plates wider or taller than the frame as tiles over
consecutive frames, a coded strip on every frame saying which plate and tile it is). This script is the whole loop:

  farm_bench.py NAME --plate 'TAG=LAB.html?QUERY[#t=S&warm=N&caption=TEXT]' [--plate ...] [--by WHO] [--out DIR]
      1. checks every plate's lab (and what it imports) is committed at HEAD; refuses, naming them, if not
      2. writes web/assets/bench/NAME.json (the plate list) and web/scenes/bench_NAME.html (the stub)
      3. commits ONLY those two files to the current branch (a private index and a compare-and-swap on the branch ref),
         pushes that commit (backoff 2/4/8/16 s on network errors; never forced; if the remote moved on, the bench commit
         is rebased onto the remote tip, re-checked there and pushed, and the local branch is left alone)
      4. posts the job pinned to that commit (farm.py post --commit SHA), waits for it, fetches the master and receipt
      5. decodes the master's frames, reassembles the tiles: OUT/<tag>.png (lossless from the decoded master), report.json
  farm_bench.py NAME --plate ... --include-deps [--dep PATH ...] [--skip-dep PATH ...] [--yes]
      for builders who may not commit: the plates' OWN uncommitted files (the lab page and everything it reaches by static
      imports, literal import(), new URL(.., import.meta.url), import maps, traced in the WORKING TREE, plus files the lab
      fetch()es named with --dep) are committed WITH the two bench files in the same compare-and-swap commit. It prints exactly
      which files (read once: the bytes listed are the bytes committed) and stops; --yes commits, pushes and posts. Refused:
      videos/review/, refs_local, ~/.cache, symlinks, gitignored or filtered (LFS) files, files over 50 MB. The worktree is
      never written (beyond the two bench files); a committed file's shared-index entry is set to the committed blob only if
      it still held the parent's version. --skip-dep PATH keeps a file (or folder) at its committed version.
  farm_bench.py NAME --plate ... --dry [--at REV]   the same bench rendered HERE through render.mjs (SwiftShader), no git,
      no farm: tests the plate list and the harness (REV: render the committed tree at REV from an export, not the working tree)
  farm_bench.py NAME --plate ... --dry --include-deps [--dep ...]   render the exact tree --yes would commit (HEAD + the
      listed files, exported; no ref moved): proves the farm will have everything the plates need
  farm_bench.py --resume JOB [--out DIR]          wait for / fetch / extract an earlier bench job (e.g. after a timeout)
  farm_bench.py --extract MASTER.mp4 --list NAME.json [--out DIR]   extract plates from a master you already have
  farm_bench.py --compare DIR_A DIR_B [--out DIR] per-plate difference of two sets of stills (farm vs local)

QUERY must carry the lab's canvas size as w=..&h=.. (the stills come back at exactly that size). Fragment options:
t (seconds, default 0), warm (frames rendered first with renderFrame(t - i/30, true), as shoot.mjs --pre), caption,
ready_s (default 300), transfer=drawimage (keep the lab's own WebGL->2D drawImage; default is an explicit readPixels).
--plates FILE.json takes a list instead ([{tag, lab, query, t, warm, caption}, ...] or {"plates": [...]}).
Options: --repeat N (frames per tile, default 3), --timeout S (wait, default 3600), --allow-dirty (post although a lab
file has uncommitted edits: the farm renders the COMMITTED version), --no-wait (post and stop; --resume later), --jpg.
"""
import argparse, atexit, datetime, hashlib, json, math, os, re, shutil, subprocess, sys, tempfile, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.dirname(HERE)                              # videos/
WEB = os.path.join(VID, 'web')
REPO = os.path.dirname(VID)
sys.path.insert(0, HERE)
FFMPEG, FFPROBE = '/usr/bin/ffmpeg', '/usr/bin/ffprobe'
W, H, FPS, STRIP, AW, AH, BLOCK = 1080, 1920, 30, 16, 1080, 1920 - 32, 24
SYNC = [1, 0, 1, 1, 0, 1]
BPM = 102                    # the unit the closer is given in (scene:closer:bpm)
MAX_FRAMES = 720             # 24 s of plates: until the worker takes --silent, its song (13 bars at 102) must outlast the closer
# A bench has NO soundtrack (the client, 8 Oct: 'bench doesnt need a soundtrack, stop assigning it one'). The recipe is
# local_render.sh --silent --seg (picture only: no song, no finish) once the homelab worker's note says it takes --silent; until
# then the worker accepts only the plain recipe, builds songs.py's bench_* stand-in and finishes it (engine.finish refuses a
# silent song), so fetch() strips the audio stream from what it brings home. farm/notes/studio.md (8 Oct) asks for the recipe.
COAUTHOR = os.environ.get('FARM_BENCH_COAUTHOR', 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>')
SESSION = os.environ.get('FARM_BENCH_SESSION', 'Claude-Session: https://claude.ai/code/session_01WuNoxBhnYSTQtApcjerFok')
STUB = '''<!doctype html>
<html><head><meta charset="utf-8"><title>farm bench</title>
<!-- FARM BENCH scene (scripts/farm_bench.py, lib/bench_scene.js): plays the plate list web/assets/bench/<name>.json -->
<style>html,body{margin:0;background:#000;overflow:hidden}canvas#out{display:block;position:relative;z-index:1}</style>
</head><body><canvas id="out" width="1080" height="1920"></canvas>
<script type="module">import { bench } from '../lib/bench_scene.js';
bench(location.pathname.replace(/^.*\\/bench_([a-z0-9_]+)\\.html$/, '$1')).catch(e => { console.error(e.stack || e); window.sceneError = String(e.stack || e); });</script>
</body></html>
'''


def log(*a):
    print('farm_bench:', *a, flush=True)


def die(msg, code=2):
    print('farm_bench: ' + msg, file=sys.stderr, flush=True)
    sys.exit(code)


def git(*a, inp=None, env=None, check=True, cwd=REPO):
    r = subprocess.run(['git'] + list(a), input=inp, capture_output=True, cwd=cwd, env=dict(os.environ, **(env or {})))
    if check and r.returncode:
        raise RuntimeError('git %s: %s' % (' '.join(a[:2]), (r.stderr or r.stdout).decode(errors='replace').strip()))
    return r if not check else r.stdout.decode(errors='replace')


# ------------------------------------------------------------------ plates and the frame table (same rules as bench_scene.js)
def tiles(w, h):
    nx, ny = math.ceil(w / AW), math.ceil(h / AH)
    tw, th = math.ceil(w / nx), math.ceil(h / ny)
    return [(kx * tw, ky * th, min(w, kx * tw + tw), min(h, ky * th + th)) for ky in range(ny) for kx in range(nx)]


def frame_table(lst):
    R = max(1, int(lst.get('repeat', 3)))
    return [(p, k) for p, pl in enumerate(lst['plates']) for k in range(len(tiles(pl['w'], pl['h']))) for _ in range(R)]


def norm_lab(path):
    p = path.strip().lstrip('./')
    for pre in ('videos/web/', 'web/', '/web/'):
        if p.startswith(pre.lstrip('/')):
            p = p[len(pre.lstrip('/')):]
    return p


def make_plate(tag, url, extra=None):
    """'LAB.html?QUERY#opts' -> plate dict; extra: fields from a JSON plate."""
    extra = dict(extra or {})
    lab, _, rest = url.partition('?')
    query, _, frag = rest.partition('#')
    if '#' in lab:
        lab, _, frag = lab.partition('#')
    opts = dict(urllib.parse.parse_qsl(frag, keep_blank_values=True))
    q = dict(urllib.parse.parse_qsl(query, keep_blank_values=True))
    pl = {'tag': tag, 'lab': norm_lab(lab), 'query': query}
    try:
        pl['w'], pl['h'] = int(extra.get('w') or q['w']), int(extra.get('h') or q['h'])
    except (KeyError, ValueError):
        die('plate %s: put the lab canvas size in its query (w=..&h=..), e.g. %s?%s&w=1080&h=1350' % (tag, pl['lab'], query))
    for k, cast in (('t', float), ('warm', int), ('ready_s', float), ('caption', str), ('transfer', str)):
        v = extra.get(k, opts.get(k))
        if v not in (None, ''):
            pl[k] = cast(v)
    pl.setdefault('t', 0.0); pl.setdefault('warm', 0)
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,48}', tag):
        die('plate tag %r: letters, digits, _ . - only (it names the still)' % tag)
    if not pl['lab'].endswith('.html') or not os.path.isfile(os.path.join(WEB, pl['lab'])):
        die('plate %s: no lab page web/%s' % (tag, pl['lab']))
    return pl


def build_list(a):
    plates = []
    for spec in a.plate:
        tag, eq, url = spec.partition('=')
        if not eq:
            die('--plate TAG=LAB.html?QUERY  (got %r)' % spec)
        plates.append(make_plate(tag.strip(), url.strip()))
    if a.plates:
        src = json.load(open(a.plates))
        if isinstance(src, dict):                     # --include-deps: {"deps": [...]} beside the plates, or per plate
            a.dep += list(src.get('deps') or [])
        for e in (src.get('plates') if isinstance(src, dict) else src):
            url = e['lab'] + ('?' + e['query'] if e.get('query') else '')
            plates.append(make_plate(e['tag'], url, e))
            a.dep += list(e.get('deps') or [])
    if not plates:
        die('no plates: --plate TAG=LAB.html?QUERY or --plates FILE.json')
    tags = [p['tag'] for p in plates]
    if len(set(tags)) != len(tags):
        die('plate tags must be unique: %s' % tags)
    if len(plates) > 250:
        die('at most 250 plates per bench')
    for p in plates:
        if len(tiles(p['w'], p['h'])) > 63:
            die('plate %s: %dx%d is more than 63 tiles of %dx%d' % (p['tag'], p['w'], p['h'], AW, AH))
    lst = {'name': a.name, 'by': a.by, 'made': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           'repeat': a.repeat, 'plates': plates}
    try:                                     # the same bench again: keep its stamp, so the files (and the commit) don't change
        old = json.load(open(os.path.join(REPO, bench_paths(a.name)[0])))
        if (old.get('plates'), old.get('repeat'), old.get('by')) == (plates, a.repeat, a.by):
            lst['made'] = old.get('made', lst['made'])
    except (OSError, ValueError):
        pass
    n = len(frame_table(lst))
    if n > MAX_FRAMES:
        die('%d frames (%d plates, repeat %d) is more than one bench holds (%d); split it or use --repeat 2' % (n, len(plates), a.repeat, MAX_FRAMES))
    return lst


def closer_for(nframes):
    """the closer beat (at BPM) a little after the last plate frame: local_render.sh locks there and draws ~1.4-3.5 s more"""
    return max(3.0, math.ceil((nframes + 6) / FPS * BPM / 60 * 10) / 10)   # at least the face test's b3 (95 frames)


def bench_paths(name):
    return 'videos/web/assets/bench/%s.json' % name, 'videos/web/scenes/bench_%s.html' % name


def bench_bytes(lst):
    return (json.dumps(lst, indent=1) + '\n').encode(), STUB.encode()


# ------------------------------------------------------------------ what a lab needs, as committed at REV
IMPORT_RES = [re.compile(r'''\bimport\s*(?:[\w$*{}\s,]+?\s*from\s*)?['"]([^'"\n]+)['"]'''),
              re.compile(r'''\bexport\s+(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*['"]([^'"\n]+)['"]'''),
              re.compile(r'''\b(?:import|tryImport)\s*\(\s*['"]([^'"\n]+)['"]\s*\)'''),   # tryImport: person/index.js's guarded import()
              re.compile(r'''new\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url''')]
HTML_RES = [re.compile(r'''<(?:script|link|img|iframe|source|video|audio|embed)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"'#?]+)''', re.I),
            re.compile(r'''['"]((?:\.{1,2}/|/web/)[^'"\s]+\.m?js)['"]''')]


def tree_index(rev):
    out = {}
    for line in git('ls-tree', '-r', rev, '--', 'videos/web').splitlines():
        meta, path = line.split('\t', 1)
        out[path] = meta.split()[2]
    return out


def dirty_index():
    r = git('status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'videos/web')
    st = {}
    ents = r.split('\0')
    i = 0
    while i < len(ents):
        e = ents[i]
        if len(e) > 3:
            st[e[3:]] = e[:2]
            if e[0] in 'RC':
                i += 1
        i += 1
    return st


def resolve(spec, frm, imap):
    if re.match(r'^(https?:|data:|blob:)', spec) or spec.endswith('/'):
        return None
    if not spec.startswith(('.', '/')):
        hit = next((v + spec[len(k):] for k, v in sorted(imap.items(), key=lambda kv: -len(kv[0]))
                    if spec == k or (k.endswith('/') and spec.startswith(k))), None)
        if hit is None:
            return None
        spec = hit
    if spec.startswith('/web/'):
        p = 'videos' + spec
    elif spec.startswith('/'):
        p = 'videos' + spec
    else:
        p = os.path.normpath(os.path.join(os.path.dirname(frm), spec))
    return None if '/node_modules/' in p or p.startswith('..') else p


def lab_deps(rev, entries, idx, read=None):
    """BFS over static imports, literal dynamic imports and new URL(.., import.meta.url) from each entry page, read AT rev
    (or through read(path) over idx, e.g. the working tree: WorkTree).
    Returns {path: (first importer, lazy)}; lazy = reached only through a dynamic import() (loaded on some paths only).
    node_modules (npm ci on the farm) and directory URLs are not followed."""
    read = read or (lambda p: git('cat-file', 'blob', '%s:%s' % (rev, p)))
    seen, queue = {}, [(e, None, {}, False) for e in entries]
    while queue:
        path, by, imap, lazy = queue.pop(0)
        if path in seen and (not seen[path][1] or lazy):
            continue
        seen[path] = (by if path not in seen else seen[path][0], lazy)
        if path not in idx or not path.endswith(('.html', '.js', '.mjs')):
            continue
        src = read(path)
        if not path.endswith('.html'):                          # usage examples in comments are not imports
            src = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
            src = re.sub(r'(?m)^\s*//.*$', '', src)
        found = []                                             # (spec, dynamic)
        if path.endswith('.html'):
            imap = {}
            for m in re.finditer(r'<script[^>]*type=["\']importmap["\'][^>]*>(.*?)</script>', src, re.S):
                try:
                    imap.update(json.loads(m.group(1)).get('imports', {}))
                except ValueError:
                    pass
            for rx in HTML_RES:
                found += [(f, False) for f in rx.findall(src)]
            for m in re.finditer(r'<script type="module">(.*?)</script>', src, re.S):
                for n, rx in enumerate(IMPORT_RES):
                    found += [(f, False) for f in rx.findall(m.group(1))]
        else:
            for n, rx in enumerate(IMPORT_RES):
                found += [(f, n == 2) for f in rx.findall(src)]
        for f, dyn in found:
            p = resolve(f, path, imap)
            if p:
                queue.append((p, path, imap, lazy or dyn))
    return seen


class WorkTree:
    """lab_deps over the working tree (what the builder sees here, committed or not)"""
    def __contains__(self, p):
        return os.path.isfile(os.path.join(REPO, p))

    @staticmethod
    def read(p):
        with open(os.path.join(REPO, p), 'rb') as f:
            return f.read().decode('utf-8', 'replace')


def blob_sha(b):
    """git's blob id of these bytes (what hash-object --stdin gives: no path, no filters)"""
    return hashlib.sha1(b'blob %d\0' % len(b) + b).hexdigest()


def blobs_at(rev, paths):
    """{path: (mode, blob)} for those of these paths that rev's tree has"""
    out, paths = {}, list(paths)
    for i in range(0, len(paths), 200):
        for e in git('ls-tree', '-r', '-z', rev, '--', *paths[i:i + 200]).split('\0'):
            if e:
                meta, p = e.split('\t', 1)
                out[p] = (meta.split()[0], meta.split()[2])
    return out


def check_deps(lst, rev, allow_dirty, skip=()):
    idx, st = tree_index(rev), dirty_index()
    entries = ['videos/web/' + p['lab'] for p in lst['plates']] + ['videos/web/lib/bench_scene.js']
    deps = lab_deps(rev, entries, idx)
    missing = sorted(p for p in deps if p not in idx and p not in skip and not deps[p][1])
    lazy_missing = sorted(p for p in deps if p not in idx and p not in skip and deps[p][1])
    labdirs = {os.path.dirname('videos/web/' + p['lab']) for p in lst['plates']} | {'videos/web/lib'}
    dirty_lab, dirty_lib = [], []
    for p in sorted(deps):
        if p in idx and st.get(p, '  ').strip():
            (dirty_lab if any(p.startswith(d + '/') for d in labdirs) or p == 'videos/web/lib/bench_scene.js' else dirty_lib).append(p)
    for p in lazy_missing:
        log('NOTE: %s is not committed; %s imports it with import(), so a plate that takes that path fails on the farm' % (p, deps[p][0]))
    return deps, missing, dirty_lab, dirty_lib


def report_deps(deps, missing, dirty_lab, dirty_lib, allow_dirty, rev):
    log('%d files reached from the plates at %s (node_modules not counted)' % (len(deps), rev[:9]))
    if missing:
        die('REFUSED: not committed at %s, so the farm would not have them:\n  %s\nCommit them first (or ask the orchestrator), or let this bench commit them: --include-deps.' %
            (rev[:9], '\n  '.join('%s  (%s)' % (m, 'imported by %s' % deps[m][0] if deps.get(m) and deps[m][0] else 'a plate lab')
                                    for m in missing)))
    if dirty_lab and not allow_dirty:
        die('REFUSED: uncommitted edits in lab files; the farm renders the committed version, not what you see here:\n  %s\n'
            'Commit them (or ask the orchestrator), let this bench commit them (--include-deps), or pass --allow-dirty to render the '
            'committed version knowingly.' % '\n  '.join(dirty_lab))
    for p in dirty_lab:
        log('NOTE (--allow-dirty): %s has uncommitted edits; the farm renders the committed version' % p)
    if dirty_lib:
        log('NOTE: %d imported file(s) have uncommitted edits (the farm renders the committed versions): %s%s' % (
            len(dirty_lib), ', '.join(p.replace('videos/web/', '') for p in dirty_lib[:6]), ' ...' if len(dirty_lib) > 6 else ''))


# ------------------------------------------------------------------ --include-deps: the plates' own uncommitted files
MODES = {}                     # path -> git mode for files committed with the bench (default 100644)
MAX_DEP_BYTES = 50 * 1024 * 1024


def rpath(arg):
    """--dep / --skip-dep PATH -> repo-relative: relative to videos/web/ (like a lab), or videos/..., or absolute"""
    p = os.path.expanduser(arg.strip())
    if os.path.isabs(p):
        return os.path.relpath(os.path.abspath(p), REPO)
    p = os.path.normpath(p)
    if p == 'videos' or p.startswith('videos/'):
        return p
    return os.path.normpath(os.path.join('videos/web', p[4:] if p.startswith('web/') else p))


def refusal(p):
    """why this file must never be committed by a bench (None: it may)"""
    full = os.path.normpath(os.path.join(os.path.realpath(REPO), p))
    real, cache = os.path.realpath(full), os.path.realpath(os.path.expanduser('~/.cache'))
    if real == cache or real.startswith(cache + os.sep):
        return 'it is in ~/.cache (%s)' % real
    if p.startswith('..') or os.path.isabs(p):
        return 'it is outside the repo (%s)' % real
    if p.startswith('videos/review/'):
        return 'it is under videos/review/ (review material is never a bench dependency)'
    if 'refs_local' in p.split('/'):
        return 'it is under refs_local (reference photographs are never committed)'
    if real != full:
        return 'it is a symlink or under one (-> %s); not followed' % real
    if not p.startswith('videos/'):
        return 'it is not under videos/ (the labs are served from videos/)'
    return None


def collect_deps(lst, a, base):
    """the plates' own uncommitted files, traced in the WORKING TREE and read ONCE (the bytes listed are the bytes committed).
    A file counts when it is new or differs from base's blob. Dies (naming them) on a refused or missing file."""
    base = git('rev-parse', base).strip()
    entries = ['videos/web/' + p['lab'] for p in lst['plates']] + ['videos/web/lib/bench_scene.js']
    wt = WorkTree()
    deps = lab_deps(None, entries, wt, read=wt.read)
    why = {p: ('plate lab' if by is None and p != entries[-1] else 'bench harness' if by is None else
               'import()ed by ' + by.replace('videos/web/', '') if lazy else 'imported by ' + by.replace('videos/web/', ''))
           for p, (by, lazy) in deps.items()}
    named, refused = [], []
    for d in a.dep:
        p = rpath(d)
        if refusal(p):                                # named outright: refused whether committed or not
            refused.append((p, refusal(p))); why[p] = '--dep'; continue
        if os.path.isdir(os.path.join(REPO, p)) and not p.startswith('..'):
            fs = [f for f in git('ls-files', '-z', '-c', '-o', '--exclude-standard', '--', p).split('\0') if f]
            if not fs:
                log('NOTE: --dep %s: no files in it (gitignored files are left out of a folder)' % d)
            named += fs
            for f in fs:
                why.setdefault(f, '--dep %s' % d)
        elif os.path.lexists(os.path.join(REPO, p)) or p.startswith('..'):
            named.append(p); why.setdefault(p, '--dep')
        else:
            die('--dep %s: no such file (%s)' % (d, p))
    skips = [rpath(x).rstrip('/') for x in a.skip_dep]
    skipped = lambda p: any(p == x or p.startswith(x + '/') for x in skips)
    want = sorted(set(deps) | set(named))
    was = blobs_at(base, [p for p in want if not p.startswith('..')])
    files, rows, skip_rows, missing, notes = {}, [], [], [], []
    labdirs = {os.path.dirname('videos/web/' + p['lab']) for p in lst['plates']}
    for p in want:
        if skipped(p):
            if p in was:
                skip_rows.append((p, 'the farm renders its committed version'))
            elif not deps.get(p, (None, True))[1]:
                missing.append(p); why[p] += '; --skip-dep, and not committed'

            else:
                skip_rows.append((p, 'not committed: the farm lacks it'))
            continue
        why_not = refusal(p)
        full = os.path.join(REPO, p)
        if why_not is None and not os.path.isfile(full):
            if p in was:
                notes.append('%s is missing here but committed: the farm gets the committed version' % p)
            elif deps.get(p, (None, False))[1]:
                notes.append('%s is not here or committed; %s, so a plate that takes that path fails' % (p, why[p]))
            else:
                missing.append(p)
            continue
        if why_not:
            if p in was and p not in named:      # committed and unchanged is fine wherever it lives
                continue
            refused.append((p, why_not)); continue
        b = open(full, 'rb').read()
        if was.get(p, (None, None))[1] == blob_sha(b):
            continue                                  # committed as it is here
        if len(b) > MAX_DEP_BYTES:
            refused.append((p, '%.0f MB is over the %d MB a bench commits' % (len(b) / 2 ** 20, MAX_DEP_BYTES // 2 ** 20))); continue
        files[p] = b
        MODES[p] = was[p][0] if p in was else ('100755' if os.access(full, os.X_OK) else '100644')
        shared = p in was and not any(p.startswith(d + '/') for d in labdirs)
        rows.append(('modified' if p in was else 'new', p, len(b), why.get(p, ''), shared))
    if files:                                         # gitignored (untracked) or filtered (LFS) files: refused
        ign = git('check-ignore', '-z', '--stdin', inp='\0'.join(files).encode(), check=False).stdout.decode().split('\0')
        refused += [(p, 'it is gitignored (the studio keeps it out of git)') for p in ign if p in files]
        attr = git('check-attr', '-z', 'filter', '--stdin', inp='\0'.join(files).encode()).split('\0')
        refused += [(attr[i], 'it has a git filter (%s): not supported' % attr[i + 2]) for i in range(0, len(attr) - 2, 3)
                    if attr[i + 2] not in ('unspecified', 'unset')]
    for n in notes:
        log('NOTE: ' + n)
    if refused:
        die('REFUSED (--include-deps): these files are not committed by a bench:\n  %s\nMove them, or --skip-dep them (the farm then '
            'renders without them). Nothing committed.' % '\n  '.join('%s: %s  (%s)' % (p, r, why.get(p, '')) for p, r in refused))
    if missing:
        die('REFUSED (--include-deps): the plates reach these files, which are not committed and would not be (missing here, or --skip-dep):\n  %s\nNothing committed.'
            % '\n  '.join('%s  (%s)' % (p, why.get(p, '')) for p in missing))
    return {'base': base, 'files': files, 'was': {p: v[1] for p, v in was.items() if p in files}, 'rows': rows,
            'skipped': skip_rows, 'reached': len(deps)}


def show_deps(inc, lst, yes):
    rows, paths = inc['rows'], bench_paths(lst['name'])
    log('--include-deps: %d files reached from the plates in the working tree; %s on %s (base %s):' % (
        inc['reached'], 'COMMITTING these files' if yes else 'a commit would hold exactly these files',
        git('symbolic-ref', '-q', '--short', 'HEAD', check=False).stdout.decode().strip() or '(detached)', inc['base'][:9]))
    for st, p, n, why, shared in rows:
        print('  %-9s %-64s %9s  %s%s' % (st, p, '%.1f KB' % (n / 1024), why,
                                         '  [shared: outside the lab folder; another lane may be editing it]' if shared else ''), flush=True)
    for p in paths:
        print('  %-9s %s' % ('bench', p), flush=True)
    for p, r in inc['skipped']:
        print('  %-9s %s  (%s)' % ('skipped', p, r), flush=True)
    log('%d file(s): %d dependency file(s), %.1f KB, + the 2 bench files%s' % (
        len(rows) + 2, len(rows), sum(r[2] for r in rows) / 1024, '' if rows else ' (nothing of the plates is uncommitted)'))


def dep_conflicts(inc, rev):
    """dep files that rev holds in a THIRD version (neither the one they were read against nor ours): never overridden"""
    if not inc or not inc['files']:
        return []
    now = blobs_at(rev, inc['files'])
    return [p for p, b in inc['files'].items() if now.get(p, (None, None))[1] not in (inc['was'].get(p), blob_sha(b))]


def sync_index(inc, parent):
    """the shared index after a dep commit: an entry is set to the committed blob only if it still held the parent's version
    (or neither had the file), so `git status` shows the committed files clean; anything else staged there is left alone"""
    paths = list(inc['files'])
    cur = {}
    for e in git('--literal-pathspecs', 'ls-files', '-s', '-z', '--', *paths).split('\0'):
        if e:
            meta, p = e.split('\t', 1)
            cur.setdefault(p, []).append(meta.split())
    par = blobs_at(parent, paths)
    upd, left = [], []
    for p, b in inc['files'].items():
        mine, c = blob_sha(b), cur.get(p)
        if c and (len(c) > 1 or c[0][2] != '0'):
            left.append(p); continue
        if (c[0][1] if c else None) == mine:
            continue
        if (c[0][1] if c else None) == par.get(p, (None, None))[1]:
            upd.append('%s %s\t%s\n' % (MODES.get(p, '100644'), mine, p))
        else:
            left.append(p)
    for attempt in range(20):
        if not upd or git('update-index', '--index-info', inp=''.join(upd).encode(), check=False).returncode == 0:
            break
        time.sleep(0.5)
    else:
        log('NOTE: could not refresh the shared index (index.lock held); git status may list the committed files as staged changes')
    if left:
        log('NOTE: the shared index holds other staged versions of %s; left as they are' % ', '.join(left))


# ------------------------------------------------------------------ commit the two files (+ --include-deps files), push
def bench_msg(lst, by, data=None):
    paths = bench_paths(lst['name'])
    deps = sorted(p for p in (data or {}) if p not in paths)
    return ('farm bench: bench_%s (%d plate%s%s) for the homelab farm\n\n'
            'The plate list %s and its scene stub %s, written by videos/scripts/farm_bench.py for %s:\n%s\n\n%s%s\n%s\n' % (
                lst['name'], len(lst['plates']), 's' if len(lst['plates']) > 1 else '',
                ' + %d of its files' % len(deps) if deps else '', paths[0], paths[1], by,
                '\n'.join('  %s: %s?%s' % (p['tag'], p['lab'], p['query']) for p in lst['plates']),
                ('With --include-deps, the plates\' own uncommitted files as %s had them in the working tree:\n%s\n\n' % (
                    by, '\n'.join('  ' + p for p in deps))) if deps else '', COAUTHOR, SESSION))


def holds(rev, data):
    """rev already has exactly these files"""
    have = blobs_at(rev, data)
    return all(have.get(p, (None, None))[1] == blob_sha(b) for p, b in data.items())


def tree_on(base, data):
    """base's tree plus these files (a private index; the shared one is not read)"""
    with tempfile.TemporaryDirectory() as td:
        env = {'GIT_INDEX_FILE': os.path.join(td, 'index')}
        git('read-tree', base, env=env)
        info = ''.join('%s %s\t%s\n' % (MODES.get(p, '100644'), git('hash-object', '-w', '--stdin', inp=b).strip(), p)
                       for p, b in data.items())
        git('update-index', '--index-info', inp=info.encode(), env=env)
        return git('write-tree', env=env).strip()


def commit_on(base, data, msg):
    """a commit whose tree is base's tree plus the bench files, parent base"""
    sign = ['-S'] if git('config', '--bool', 'commit.gpgsign', check=False).stdout.decode().strip() == 'true' else []
    return git('commit-tree', *sign, tree_on(base, data), '-p', base, inp=msg.encode()).strip()


def commit_bench(lst, by, inc=None):
    branch = git('symbolic-ref', '-q', '--short', 'HEAD', check=False)
    if branch.returncode:
        die('HEAD is detached: check out the branch the farm should render first')
    branch = branch.stdout.decode().strip()
    paths = bench_paths(lst['name'])
    data = dict(zip(paths, bench_bytes(lst)))
    data.update((inc or {}).get('files') or {})
    for attempt in range(10):
        head = git('rev-parse', 'HEAD').strip()
        bad = dep_conflicts(inc, head) if inc and head != inc['base'] else []
        if bad:
            die('REFUSED: since these files were read, a commit on %s (%s) changed them to another version: %s. Not overriding it; '
                'nothing committed. Run again (the files are read afresh).' % (branch, head[:9], ', '.join(bad)))
        if holds(head, data):
            log('the bench files%s are already committed at %s' % (' and the listed files' if len(data) > 2 else '', head[:9]))
            c = head
            break
        c = commit_on(head, data, bench_msg(lst, by, data))
        if inc:                                                # the commit itself must hold everything the plates import
            _, missing, _, _ = check_deps(lst, c, True)
            if missing:
                die('REFUSED: the commit would still lack: %s. Nothing committed.' % ', '.join(missing))
        # compare-and-swap: lands only if the branch is still where we read it (another agent committing makes us retry)
        r = git('update-ref', '-m', 'farm_bench: bench_%s' % lst['name'], 'refs/heads/' + branch, c, head, check=False)
        if r.returncode == 0:
            log('committed %s on %s: %s%s' % (c[:9], branch, ', '.join(paths),
                                              ' + the %d files listed above' % (len(data) - 2) if len(data) > 2 else ''))
            if inc and inc['files']:
                sync_index(inc, head)
            break
        log('the branch moved while committing (another agent); retrying on the new HEAD')
        time.sleep(1 + attempt)
    else:
        die('the branch kept moving; nothing committed, try again')
    for p in paths:                    # the two bench files: the working tree and the shared index show what was committed
        b = data[p]                    # (an --include-deps file is never written: its working-tree copy is the builder's)
        os.makedirs(os.path.dirname(os.path.join(REPO, p)), exist_ok=True)
        with open(os.path.join(REPO, p), 'wb') as f:
            f.write(b)
    for attempt in range(20):                                  # only these two index entries; nothing else in it is touched
        if git('update-index', '--add', '--', *paths, check=False).returncode == 0:
            break
        time.sleep(0.5)
    else:
        log('NOTE: could not refresh the shared index for %s (index.lock held); run: git add %s' % (paths, ' '.join(paths)))
    return branch, c, data


NET = re.compile(r'Could not resolve|Connection (reset|refused|timed out)|timed out|RPC failed|early EOF|unexpected disconnect|'
                 r'HTTP (5\d\d|429)|The requested URL returned error: 5|SSL|gnutls|Operation timed out|remote end hung up', re.I)
REJECT = re.compile(r'rejected|non-fast-forward|fetch first|failed to push some refs', re.I)


def push(branch, sha, lst, data, by, inc=None):
    """push the bench commit to origin/<branch>, never forced. Refused because the remote moved:
    - the remote already holds sha: done;  - the remote is behind sha: push again;
    - the remote has commits we lack: REBASE the bench commit onto the remote tip (its tree = the remote's + our two files),
      check the plates' files are committed there, push that commit, and post it. The local branch is NOT moved (its working
      tree belongs to the other agents); the orchestrator pulls as usual (both sides add the same two files: a clean merge).
    Returns the commit that is on the remote, the one to post."""
    ahead = git('rev-list', '--count', 'refs/remotes/origin/%s..%s' % (branch, sha), check=False)
    if ahead.returncode == 0 and int(ahead.stdout.decode().strip() or 0) > 1:
        log('NOTE: this push also carries %d earlier local commit(s) of %s that were not on origin yet' % (int(ahead.stdout) - 1, branch))
    delays, rebased = [2, 4, 8, 16], False
    for attempt in range(8):
        r = git('push', 'origin', '%s:refs/heads/%s' % (sha, branch), check=False)
        err = (r.stderr + r.stdout).decode(errors='replace')
        if r.returncode == 0:
            break
        if REJECT.search(err) and not NET.search(err):
            f = git('fetch', '-q', 'origin', branch, check=False)
            if f.returncode == 0:
                rem = git('rev-parse', 'FETCH_HEAD').strip()
                if git('merge-base', '--is-ancestor', sha, rem, check=False).returncode == 0:
                    log('the remote branch already holds %s (pushed by another agent)' % sha[:9]); break
                if git('merge-base', '--is-ancestor', rem, sha, check=False).returncode == 0:
                    log('push refused, the remote moved within our history; pushing again'); time.sleep(2); continue
                if holds(rem, data):
                    log('origin/%s (%s) already has these bench files; posting that commit' % (branch, rem[:9])); sha = rem; break
                bad = dep_conflicts(inc, rem)
                if bad:
                    die('push refused: origin/%s (%s) moved on and holds another version of %s. Not overriding it; no job '
                        'posted (the local commit stays; the orchestrator integrates).' % (branch, rem[:9], ', '.join(bad)))
                c2 = commit_on(rem, data, bench_msg(lst, by, data))
                deps, missing, _, _ = check_deps(lst, c2, True, skip=bench_paths(lst['name']))
                if missing:
                    die('push refused and origin/%s (%s) moved on; rebased onto it, these are not committed there: %s. Not forcing; '
                        'no job posted. The orchestrator integrates the two histories.' % (branch, rem[:9], ', '.join(missing)))
                changed = [p for p in deps if p.startswith('videos/') and git('diff', '--quiet', sha, c2, '--', p, check=False).returncode]
                log('push refused: origin/%s has commits this tree lacks; rebased the bench commit onto %s -> %s%s. The local branch '
                    'stays as it is (pull later).' % (branch, rem[:9], c2[:9], (' NOTE: the farm renders the REMOTE version of %s' %
                                                                                   ', '.join(changed[:6])) if changed else ''))
                sha, rebased = c2, True
                time.sleep(1); continue
        if NET.search(err) and delays:
            d = delays.pop(0)
            log('push failed on the network (%s); retry in %d s' % (err.strip().splitlines()[-1][:120], d))
            time.sleep(d); continue
        die('push failed: %s' % err.strip()[-600:])
    else:
        die('push did not land after retries')
    rem = git('ls-remote', 'origin', 'refs/heads/' + branch).split()
    if not rem:
        die('origin has no branch %s after the push' % branch)
    git('fetch', '-q', 'origin', branch, check=False)
    if git('merge-base', '--is-ancestor', sha, rem[0], check=False).returncode:
        die('origin/%s (%s) does not contain %s after the push' % (branch, rem[0][:9], sha[:9]))
    log('pushed: origin/%s at %s contains %s%s' % (branch, rem[0][:9], sha[:9], ' (rebased; local branch not moved)' if rebased else ''))
    return sha


# ------------------------------------------------------------------ the farm
def farm_cmd(*a, capture=True):
    r = subprocess.run([sys.executable, os.path.join(HERE, 'farm.py')] + list(a), capture_output=capture, text=True)
    return r


def worker_takes_silent():
    """True once the homelab worker's own note on main says it runs local_render.sh --silent (picture only)"""
    git('fetch', '-q', 'origin', '+main:refs/remotes/origin/main', check=False)
    r = git('cat-file', 'blob', 'origin/main:farm/notes/homelab-v100-farm.md', check=False)
    return r.returncode == 0 and b'--silent' in r.stdout


def post(lst, sha, by):
    n = len(frame_table(lst))
    spec = 'bench_%s:%g:%d' % (lst['name'], closer_for(n), BPM)
    recipe = 'sh videos/scripts/local_render.sh %s--seg ' % ('--silent ' if worker_takes_silent() else '')
    notes = ('TOOLING farm bench (scripts/farm_bench.py): a normal scene whose frames are lab views (lib/bench_scene.js loads each '
             'plate\'s lab page in an iframe and shows it 1:1; %d plate(s), %d picture frames, then the closer). The studio decodes '
             'the master\'s frames, so please deliver the master as usual. Plates: %s.' % (
                 len(lst['plates']), n, ', '.join('%s=%s' % (p['tag'], p['lab']) for p in lst['plates'])))
    for attempt in range(4):
        r = farm_cmd('post', '--title', 'bench %s (%d plates)' % (lst['name'], len(lst['plates'])), '--piece', 'BENCH',
                     '--run', recipe + spec, '--commit', sha, '--by', by, '--notes', notes,
                     '--out', 'videos/out/farm/bench_%s.mp4' % lst['name'])
        if r.returncode and 'git fetch:' in r.stderr and attempt < 3:     # failed reading main, before any write: safe to retry
            log('farm.py post could not read main (%s); retry in %d s' % (r.stderr.strip().splitlines()[-1][:100], 2 ** (attempt + 1)))
            time.sleep(2 ** (attempt + 1)); continue
        break
    if r.returncode:
        die('farm.py post failed: %s' % (r.stderr or r.stdout).strip()[-800:])
    jid = r.stdout.strip().splitlines()[-1].strip()
    log('posted %s: %s at %s' % (jid, spec, sha[:9]))
    return jid, spec


def wait(jid, timeout):
    import farm
    pipe = farm.Repo(farm.PIPE, 'pipe')
    t0, last, failed_at = time.time(), None, None
    while time.time() - t0 < timeout:
        try:
            rev = pipe.head(); j = farm.get(pipe, rev, jid)
        except Exception as e:                                       # the network: keep polling
            log('poll failed (%s); retrying' % str(e)[:120]); time.sleep(20); continue
        st = (j['state'], (j.get('claim') or {}).get('by'))
        if st != last:
            log('%s %s%s (%.0f s)' % (jid, j['state'], ' by ' + st[1] if st[1] else '', time.time() - t0)); last = st
        if j['state'] == 'done':
            return j
        if j['state'] == 'failed':
            for k in sorted(farm.load_jobs(pipe, rev)):
                if k != jid and farm.retry_of(farm.get(pipe, rev, k)) == jid:
                    log('%s failed; following its retry %s' % (jid, k))
                    return wait(k, timeout - (time.time() - t0))
            failed_at = failed_at or time.time()
            if time.time() - failed_at > 180:
                return j
        time.sleep(20)
    return None


def times(j):
    h = {e['event'].split(' ')[0]: e['at'] for e in j.get('history', [])}
    ts = lambda s: datetime.datetime.strptime(s, '%Y-%m-%dT%H:%M:%SZ') if s else None
    p, c, d = ts(j.get('posted_at')), ts((j.get('claim') or {}).get('at') or h.get('claimed')), ts((j.get('delivery') or {}).get('at'))
    return {'posted': j.get('posted_at'), 'claimed': c and c.strftime('%H:%M:%SZ'), 'ended': d and d.strftime('%H:%M:%SZ'),
            'queue_s': (c - p).total_seconds() if p and c else None, 'render_s': (d - c).total_seconds() if c and d else None,
            'total_s': (d - p).total_seconds() if p and d else None}


def fetch(jid, name, to):
    r = farm_cmd('fetch', jid, '--to', to, '--only', 'bench_%s.mp4' % name, '--only', 'receipt.json', '--only', 'renderer.json')
    out = (r.stdout + r.stderr).strip()
    master = os.path.join(to, 'bench_%s.mp4' % name)
    if r.returncode or not os.path.exists(master):
        hint = ''
        if re.search(r'could not read Username|Authentication|403|not found', out, re.I):
            hint = ('\nThis session cannot read the archive repo (flip-engineer/automated-content-pipeline-video-studies-archive). '
                    'The job is done and its files are in the archive under farm/%s/; from a session with archive access run:\n'
                    '  python3 videos/scripts/farm_bench.py --resume %s' % (jid, jid))
        log('fetch failed: %s%s' % (out[-600:], hint))
        return None
    silence(master)
    return master


def silence(mp4):
    """a bench has no soundtrack: drop the audio stream the current worker's recipe muxes in (the picture is copied, not re-encoded)"""
    tmp = mp4[:-4] + '.video.mp4'
    r = subprocess.run([FFMPEG, '-y', '-v', 'error', '-i', mp4, '-map', '0:v', '-c', 'copy', '-an', '-movflags', '+faststart', tmp],
                       capture_output=True, text=True)
    if r.returncode == 0 and os.path.getsize(tmp) > 0:
        os.replace(tmp, mp4)
    else:
        log('NOTE: could not strip the audio from %s (%s); the picture is unaffected' % (mp4, r.stderr.strip()[-200:]))
        try:
            os.remove(tmp)
        except OSError:
            pass


# ------------------------------------------------------------------ frames -> plates
def bits_at(fr, y0, n):
    ys = slice(y0 + 3, y0 + STRIP - 3)
    return [1 if fr[ys, i * BLOCK + 6:i * BLOCK + BLOCK - 6].mean() > 127 else 0 for i in range(n)]


def num(b):
    v = 0
    for x in b:
        v = v * 2 + x
    return v


def read_id(fr):
    b = bits_at(fr, 0, 37)
    if b[:6] != SYNC:
        return None
    p, k, n, s, c = num(b[6:14]), num(b[14:20]), num(b[20:26]), num(b[26:29]), num(b[29:37])
    return (p, k, n, s) if c == (p * 7 + k * 13 + n * 29 + s * 53 + 101) & 255 else None


def read_time(fr):
    b = bits_at(fr, H - STRIP, 40)
    if b[:6] != SYNC:
        return None
    r, m, c = num(b[6:20]), num(b[20:32]), num(b[32:40])
    return (r / 10, m / 100) if c == (r * 3 + m * 11 + 57) & 255 else None    # m == 4095: 40.95 s or MORE (the field is full)


def decode(mp4):
    """yield (index, HxWx3 uint8 RGB) for every frame of a BT.709 tv-range master"""
    import numpy as np
    pr = subprocess.run([FFPROBE, '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4],
                        capture_output=True, text=True)
    w, h = [int(x) for x in pr.stdout.strip().split(',')[:2]]
    if (w, h) != (W, H):
        die('%s is %dx%d, not a %dx%d bench master' % (mp4, w, h, W, H))
    p = subprocess.Popen([FFMPEG, '-v', 'error', '-i', mp4, '-map', '0:v:0', '-vf',
                          'scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=rgb24',
                          '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
    n, sz = 0, W * H * 3
    while True:
        b = p.stdout.read(sz)
        if len(b) < sz:
            break
        yield n, np.frombuffer(b, np.uint8).reshape(H, W, 3)
        n += 1
    p.wait()


def extract(mp4, lst, outdir, jpg=False):
    import numpy as np
    from PIL import Image
    os.makedirs(outdir, exist_ok=True)
    table = frame_table(lst)
    best, run, seen_t, codes, nframes = {}, [], {}, {}, 0

    def close(run):
        if not run:
            return
        (p, k, n, s), idxs, crops = run[0][1], [r[0] for r in run], [r[2] for r in run]
        if p >= len(lst['plates']):
            return
        if (p, k) not in best or len(idxs) > len(best[(p, k)]['frames']):
            best[(p, k)] = {'frames': idxs, 'status': s, 'crop': crops[len(crops) // 2]}

    for i, fr in decode(mp4):
        nframes = i + 1
        code = read_id(fr)
        tm = read_time(fr)
        if code is None:
            close(run); run = []; codes[i] = None; continue
        codes[i] = code[:2]
        p, k, n, s = code
        crop = None
        if p < len(lst['plates']):
            pl = lst['plates'][p]; T = tiles(pl['w'], pl['h'])
            if k < len(T):
                x0, y0, x1, y1 = T[k]
                crop = fr[STRIP:STRIP + y1 - y0, 0:x1 - x0].copy()
            if tm:
                seen_t.setdefault(p, set()).add(tm)
        if run and run[0][1] != code:
            close(run); run = []
        run.append((i, code, crop))
    close(run)
    plates = []
    for p, pl in enumerate(lst['plates']):
        T = tiles(pl['w'], pl['h'])
        img = np.zeros((pl['h'], pl['w'], 3), np.uint8); img[..., 0] = 255; img[..., 2] = 255   # missing tiles stay magenta
        got, status = [], set()
        for k, (x0, y0, x1, y1) in enumerate(T):
            b = best.get((p, k))
            if b is None or b['crop'] is None:
                continue
            img[y0:y1, x0:x1] = b['crop']; got.append(k); status.add(b['status'])
            b['crop'] = None
        st = max(status) if status else None
        row = {'tag': pl['tag'], 'tiles': len(T), 'tiles_found': len(got), 'status': st,
               'status_text': {0: 'ok', 1: 'sceneError', 2: 'ready timeout', 3: 'renderFrame threw', 4: 'size differs', 5: 'no #out'}.get(st, 'missing'),
               'frames': {str(k): best[(p, k)]['frames'] for k in got},
               'ready_s': sorted({t[0] for t in seen_t.get(p, ())}), 'render_s': sorted({t[1] for t in seen_t.get(p, ())})}
        if any(t[1] >= 40.95 for t in seen_t.get(p, ())):
            row['render_s_note'] = 'the strip field is full: at least 40.95 s'
        if got:
            stem = pl['tag'] + ('' if st in (0, 4) and len(got) == len(T) else '.ERROR' if st not in (0, 4) else '.PARTIAL')
            f = os.path.join(outdir, stem + ('.jpg' if jpg else '.png'))
            Image.fromarray(img).save(f, **({'quality': 95, 'subsampling': 0} if jpg else {'optimize': False}))
            row['file'] = f
        plates.append(row)
    expect = len(table)
    log('decoded %d frames (%d plate frames expected); plates back: %s' % (
        nframes, expect, ', '.join('%s %s%s' % (r['tag'], r['status_text'], '' if r['tiles_found'] == r['tiles'] else
                                               ' (%d/%d tiles)' % (r['tiles_found'], r['tiles'])) for r in plates)))
    return {'frames_decoded': nframes, 'plate_frames_expected': expect,
            'plate_frames_seen': sum(1 for c in codes.values() if c is not None and c[0] < len(lst['plates'])),
            'first_plate_frame': min((i for i, c in codes.items() if c is not None), default=None), 'plates': plates}


# ------------------------------------------------------------------ local renders (--dry)
def export_tree(rev, private=False):
    """the committed videos/web at rev, exported once into the scratch cache (node_modules linked from this tree);
    private: into a fresh folder of its own (an --include-deps would-be tree; removed after the run)"""
    sha = git('rev-parse', rev).strip()
    trees = os.environ.get('FARM_BENCH_TREES', os.path.join(VID, 'out', '.bench_trees'))
    if private:
        os.makedirs(trees, exist_ok=True)
    root = tempfile.mkdtemp(prefix='deps_%s_' % sha[:9], dir=trees) if private else os.path.join(trees, sha[:12])
    if not os.path.isdir(os.path.join(root, 'videos', 'web')):
        os.makedirs(root, exist_ok=True)
        a = subprocess.Popen(['git', 'archive', sha, 'videos/web'], cwd=REPO, stdout=subprocess.PIPE)
        subprocess.run(['tar', '-x', '-C', root], stdin=a.stdout, check=True); a.wait()
        os.symlink(os.path.join(WEB, 'node_modules'), os.path.join(root, 'videos', 'web', 'node_modules'))
    return os.path.join(root, 'videos'), sha


def dry(lst, a):
    vid, rev = (export_tree(a.at, bool(getattr(a, 'deps_tree', None))) if a.at else (VID, None))
    if getattr(a, 'deps_tree', None):                          # the export of a would-be tree is not kept
        atexit.register(shutil.rmtree, os.path.dirname(vid), True)
    scene = 'bench_' + lst['name']
    if rev:
        deps, missing, dl, dlib = check_deps(lst, rev, True, skip=bench_paths(lst['name']))
        if missing:
            die('at %s these are not committed: %s' % (rev[:9], ', '.join(missing)))
    for p, b in zip(bench_paths(lst['name']), bench_bytes(lst)):
        f = os.path.join(vid, p[len('videos/'):]); os.makedirs(os.path.dirname(f), exist_ok=True)
        open(f, 'wb').write(b)
    n = len(frame_table(lst))
    outdir = a.out or os.path.join(VID, 'out', 'bench', lst['name'], 'dry' + ('_deps' if getattr(a, 'deps_tree', None) else '') +
                                   ('_' + rev[:9] if rev else ''))
    os.makedirs(outdir, exist_ok=True)
    mp4 = os.path.join(outdir, '%s_dry.mp4' % scene)
    env = dict(os.environ, ACP_CODEC='0', ACP_NO_INBOX='1', ACP_SLOT_DIR=os.environ.get('ACP_SLOT_DIR', os.path.join(VID, 'out', '.slots')))
    if subprocess.run([sys.executable, '-c', 'import imageio_ffmpeg'], capture_output=True).returncode:
        # render.mjs asks python for imageio_ffmpeg's binary; a fresh container may not have it: a one-function stand-in
        shim = tempfile.mkdtemp(prefix='farm_bench_ffshim_'); atexit.register(shutil.rmtree, shim, True)
        open(os.path.join(shim, 'imageio_ffmpeg.py'), 'w').write('def get_ffmpeg_exe():\n    return %r\n' % FFMPEG)
        env['PYTHONPATH'] = shim + os.pathsep + env.get('PYTHONPATH', '')
        log('imageio_ffmpeg is not installed here; render.mjs uses %s for this dry run' % FFMPEG)
    log('rendering %d frames of %s locally (%s) -> %s' % (n, scene, 'tree at ' + rev[:9] if rev else 'working tree', mp4))
    t0 = time.time()
    # render.mjs stays the farm-verified one: it reads a silent stand-in (tools/silent_input.py) and the audio is dropped below
    stand_in = [sys.executable, os.path.join(VID, 'tools', 'silent_input.py'), scene, '--videos', vid]
    subprocess.run(stand_in[:3] + ['%.4f' % (n / FPS + 1)] + stand_in[3:], check=True)
    r = subprocess.run(['node', os.path.join(vid, 'web', 'render.mjs'), scene, '--reuse-audio', '--to', '%.4f' % (n / FPS), '--file', mp4],
                       cwd=vid, env=env, capture_output=True, text=True)
    open(os.path.join(outdir, 'render.log'), 'w').write(r.stdout + r.stderr)
    subprocess.run(stand_in + ['--clean'])
    if not r.returncode and os.path.exists(mp4):
        silence(mp4)   # the stand-in's silent track out: the dry master is picture only
    for line in (r.stdout + r.stderr).splitlines():
        if '[bench]' in line or 'error' in line.lower():
            print('  ' + line[:300])
    if r.returncode or not os.path.exists(mp4):
        die('local render failed (exit %d); log: %s' % (r.returncode, os.path.join(outdir, 'render.log')))
    rep = extract(mp4, lst, outdir, a.jpg)
    for m in re.finditer(r'\[bench\] plate (\d+) \S+: status \d+.*?ready ([\d.]+) s, render ([\d.]+) s', r.stdout + r.stderr):
        row = rep['plates'][int(m.group(1))]                     # this machine's own log has the exact times (no 40.95 s cap)
        row['log_ready_s'], row['log_render_s'] = float(m.group(2)), float(m.group(3))
    rep.update({'mode': 'dry', 'tree': rev or 'working tree', 'render_s': round(time.time() - t0, 1), 'master': mp4, 'list': lst})
    if getattr(a, 'deps_tree', None):
        rep['include_deps'] = {'base': a.deps_tree[1], 'tree': rev, 'files': a.deps_tree[2]}
    json.dump(rep, open(os.path.join(outdir, 'report.json'), 'w'), indent=1)
    log('dry run: %.0f s; stills and report.json in %s' % (time.time() - t0, outdir))


# ------------------------------------------------------------------ farm loop
def finish(jid, lst, a, j=None, extra=None):
    j = j or wait(jid, a.timeout)
    outdir = a.out or os.path.join(VID, 'out', 'bench', lst['name'], jid)
    os.makedirs(outdir, exist_ok=True)
    rep = {'job': jid, 'name': lst['name'], **(extra or {})}
    if not j:
        rep['state'] = 'timeout'
        log('no answer within %d s; later: farm_bench.py --resume %s' % (a.timeout, jid))
    else:
        rep.update({'state': j['state'], 'job_id': j['id'], 'commit': j.get('pipeline_commit'), 'timings': times(j),
                    'delivery_note': (j.get('delivery') or {}).get('note'), 'why': (j.get('delivery') or {}).get('why'),
                    'delivery_files': {f['name']: f.get('size') for f in (j.get('delivery') or {}).get('files') or []}})
        m = re.search(r'(\d+) frames at (\d+) fps', rep.get('delivery_note') or '')
        if m:                                                      # the queue's own record: readable without the archive
            rep['farm_frames'] = int(m.group(1))
        if j['state'] == 'done':
            master = fetch(j['id'], lst['name'], outdir)
            if master:
                rep['master'] = master
                rep['master_sha256'] = hashlib.sha256(open(master, 'rb').read()).hexdigest()
                try:
                    rc = json.load(open(os.path.join(outdir, 'receipt.json')))
                    rep['receipt'] = {k: v for k, v in rc.items() if re.search(r'dur|time|second|frame|stage|worker|gpu', k, re.I)}
                except (OSError, ValueError):
                    pass
                rep.update(extract(master, lst, outdir, a.jpg))
            else:
                rep['fetch'] = ('failed: the delivery is in the archive under farm/%s/; reading it needs archive access. From a session '
                                'that has it: python3 videos/scripts/farm_bench.py --resume %s' % (j['id'], j['id']))
        else:
            log('%s ended %s: %s' % (j['id'], j['state'], ((j.get('delivery') or {}).get('why') or '')[-800:]))
    rep['list'] = lst
    json.dump(rep, open(os.path.join(outdir, 'report.json'), 'w'), indent=1)
    t = rep.get('timings') or {}
    log('report %s  (job %s: %s; queue %s s, claim->delivered %s s, total %s s)' % (
        os.path.join(outdir, 'report.json'), rep.get('job_id', jid), rep.get('state'), t.get('queue_s'), t.get('render_s'), t.get('total_s')))
    return 0 if rep.get('plates') else 1


def list_at(commit, name):
    path = 'videos/web/assets/bench/%s.json' % name
    r = git('cat-file', 'blob', '%s:%s' % (commit, path), check=False)
    if r.returncode:
        git('fetch', '-q', 'origin', commit, check=False)
        r = git('cat-file', 'blob', '%s:%s' % (commit, path), check=False)
    if r.returncode:
        die('cannot read %s at %s' % (path, commit[:9]))
    return json.loads(r.stdout)


def resume(a):
    import farm
    pipe = farm.Repo(farm.PIPE, 'pipe')
    j = farm.get(pipe, pipe.head(), a.resume)
    m = re.search(r'--seg\s+bench_([a-z0-9_]+):', ' '.join(j.get('run', [])))
    if not m:
        die('%s is not a bench job (%s)' % (a.resume, j.get('run')))
    lst = list_at(j['pipeline_commit'], m.group(1))
    return finish(a.resume, lst, a, None if j['state'] not in ('done',) else j)


# ------------------------------------------------------------------ compare two sets of stills
def compare(a):
    import numpy as np
    from PIL import Image
    da, db = a.compare
    outdir = a.out or db
    os.makedirs(outdir, exist_ok=True)
    rows = []
    for f in sorted(os.listdir(da)):
        if not f.endswith(('.png', '.jpg')) or f.startswith('diff_'):
            continue
        tag = re.sub(r'\.(png|jpg)$', '', f)
        cand = [g for g in sorted(os.listdir(db)) if g.endswith(('.png', '.jpg')) and not g.startswith('diff_') and
                (re.sub(r'\.(png|jpg)$', '', g) == tag or g.startswith(tag + '_'))]
        if not cand:
            continue
        A = np.asarray(Image.open(os.path.join(da, f)).convert('RGB')).astype(np.int16)
        B = np.asarray(Image.open(os.path.join(db, cand[0])).convert('RGB')).astype(np.int16)
        if A.shape != B.shape:
            rows.append({'tag': tag, 'a': f, 'b': cand[0], 'error': 'sizes differ %s vs %s' % (A.shape, B.shape)}); continue
        d = B - A; ad = np.abs(d); mse = float((d.astype(np.float64) ** 2).mean())
        mx = ad.max(2)
        rows.append({'tag': tag, 'a': f, 'b': cand[0], 'mean_abs': round(float(ad.mean()), 3), 'max_abs': int(ad.max()),
                     'psnr_db': round(10 * math.log10(255 ** 2 / mse), 2) if mse else None,
                     'mean_b_minus_a_rgb': [round(float(d[..., c].mean()), 3) for c in range(3)],
                     'pct_px_over_8': round(float((mx > 8).mean() * 100), 3), 'pct_px_over_32': round(float((mx > 32).mean() * 100), 3)})
        Image.fromarray(np.clip(mx * 4, 0, 255).astype(np.uint8)).save(os.path.join(outdir, 'diff_%s.png' % tag))
    json.dump(rows, open(os.path.join(outdir, 'compare.json'), 'w'), indent=1)
    for r in rows:
        print('  %-24s %s' % (r['tag'], r.get('error') or 'PSNR %s dB, mean |d| %.2f, max %d, >8: %.2f%%, >32: %.3f%%, mean(B-A) rgb %s' % (
            r['psnr_db'], r['mean_abs'], r['max_abs'], r['pct_px_over_8'], r['pct_px_over_32'], r['mean_b_minus_a_rgb'])))
    log('compare.json and diff_<tag>.png (|B-A| x4, max over channels) in %s' % outdir)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('name', nargs='?', help='bench name: [a-z0-9_]+ (scene bench_<name>)')
    ap.add_argument('--plate', action='append', default=[], help="TAG=LAB.html?QUERY[#t=S&warm=N&caption=TEXT] (repeatable)")
    ap.add_argument('--plates', help='a JSON plate list instead of / besides --plate')
    ap.add_argument('--repeat', type=int, default=3, help='frames per tile (default 3; the middle one is extracted)')
    ap.add_argument('--by', default=os.environ.get('FARM_BY', 'studio'))
    ap.add_argument('--out', help='where stills and report.json go (default videos/out/bench/<name>/<job or dry>/)')
    ap.add_argument('--timeout', type=float, default=3600)
    ap.add_argument('--allow-dirty', action='store_true')
    ap.add_argument('--include-deps', action='store_true',
                    help="commit the plates' own uncommitted files (traced in the working tree, + --dep) with the bench; lists them, needs --yes")
    ap.add_argument('--dep', action='extend', nargs='+', default=[], metavar='PATH',
                    help='--include-deps: a file (or folder) a lab fetch()es; relative to videos/web/, or videos/..., or absolute')
    ap.add_argument('--skip-dep', action='extend', nargs='+', default=[], metavar='PATH',
                    help='--include-deps: leave this file (or folder) at its committed version')
    ap.add_argument('--yes', action='store_true', help='--include-deps: commit the listed files (without it: list them and stop)')
    ap.add_argument('--no-wait', action='store_true', help='post and stop (finish later with --resume JOB)')
    ap.add_argument('--dry', action='store_true', help='render the bench here through render.mjs; no git, no farm')
    ap.add_argument('--at', help='--dry: render the committed tree at this rev (exported) instead of the working tree')
    ap.add_argument('--jpg', action='store_true', help='stills as JPEG q95 4:4:4 instead of PNG')
    ap.add_argument('--resume', metavar='JOB')
    ap.add_argument('--extract', metavar='MP4')
    ap.add_argument('--list', help='--extract: the plate list (a file, or COMMIT:videos/web/assets/bench/NAME.json)')
    ap.add_argument('--compare', nargs=2, metavar=('DIR_A', 'DIR_B'))
    a = ap.parse_args()
    # a private farm.py cache per run (FARM_CACHE): several agents polling or posting at once never share a git lock
    cache = tempfile.mkdtemp(prefix='farm_bench_', dir=os.path.dirname(os.path.expanduser(os.environ.get('FARM_CACHE', '~/.cache/acp-farm'))))
    os.environ['FARM_CACHE'] = cache
    atexit.register(shutil.rmtree, cache, True)
    if a.compare:
        return compare(a)
    if a.resume:
        return resume(a)
    if a.extract:
        if not a.list:
            die('--extract needs --list')
        lst = json.loads(git('show', a.list)) if ':' in a.list and not os.path.exists(a.list) else json.load(open(a.list))
        rep = extract(a.extract, lst, a.out or os.path.join(os.path.dirname(os.path.abspath(a.extract)), 'stills'), a.jpg)
        json.dump(rep, open(os.path.join(a.out or os.path.join(os.path.dirname(os.path.abspath(a.extract)), 'stills'), 'report.json'), 'w'), indent=1)
        return 0
    if not a.name or not re.fullmatch(r'[a-z0-9_]{1,40}', a.name):
        die('a bench NAME ([a-z0-9_]+) is needed, e.g. farm_bench.py cloth_c1 --plate ...')
    lst = build_list(a)
    n = len(frame_table(lst))
    log('bench_%s: %d plate(s), %d picture frames (%.1f s), closer b%g at %d bpm' % (a.name, len(lst['plates']), n, n / FPS, closer_for(n), BPM))
    if (a.dep or a.skip_dep) and not a.include_deps:
        die('--dep / --skip-dep go with --include-deps')
    head = git('rev-parse', 'HEAD').strip()
    inc = None
    if a.include_deps:
        if a.at:
            die('--dry --include-deps renders HEAD plus the listed files; leave out --at')
        inc = collect_deps(lst, a, head)
        show_deps(inc, lst, a.yes and not a.dry)
    if a.dry:
        if inc:                                   # the exact tree --yes would commit (HEAD + the files), exported and rendered
            a.at = tree_on(head, inc['files']) if inc['files'] else head
            a.deps_tree = (a.at, head, sorted(inc['files']))
        return dry(lst, a)
    if inc and not a.yes:
        log('nothing committed or posted. Re-run with --yes to commit exactly these files with the bench, push and post '
            '(--dry first renders that tree here).')
        return 3
    if not inc:
        report_deps(*check_deps(lst, head, a.allow_dirty, skip=bench_paths(a.name)), a.allow_dirty, head)
    t0 = time.time()
    branch, sha, data = commit_bench(lst, a.by, inc)
    sha = push(branch, sha, lst, data, a.by, inc)
    jid, spec = post(lst, sha, a.by)
    extra = {'spec': spec, 'branch': branch, 'commit': sha, 'posted_local': datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%SZ')}
    if a.no_wait:
        log('posted; finish later with: python3 videos/scripts/farm_bench.py --resume %s' % jid)
        return 0
    rc = finish(jid, lst, a, None, extra)
    log('wall clock %.0f s' % (time.time() - t0))
    return rc


if __name__ == '__main__':
    sys.exit(main() or 0)
