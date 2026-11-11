#!/usr/bin/env python3
"""Will HEAD render this scene? Checks every file a scene imports is in git (TOOLING c6, 2026-09-29).

In cycle 6 two builders' edits were swept into other agents' commits (`git add -A` under unrelated messages) while a
new module the scene imports (`ownfuture2.hands.js`) stayed untracked, so HEAD's `ownfuture2.js` could not load on a
clean checkout or a farm box. This walks a scene's module graph from its .html (script src, static and dynamic
imports, `export ... from`, `new URL('x', import.meta.url)`) and reports each file's git state.

    python3 videos/scripts/head_check.py ownfuture2 machines      # scenes by name (web/scenes/<name>.html or .js)
    python3 videos/scripts/head_check.py --all                    # every scene with an .html
    python3 videos/scripts/head_check.py ownfuture2 --assets      # also images/json/audio named by literal paths
    python3 videos/scripts/head_check.py --staged                 # before a commit: do staged scene files import
                                                                  # anything that is neither tracked nor staged?
    python3 videos/scripts/head_check.py --selftest

States: ok (tracked, clean) · modified (tracked, working tree differs: HEAD renders the committed version) ·
untracked · ignored · missing. Exit 1 when a *module* (js/mjs/html) is untracked, ignored or missing, since then
HEAD cannot load the scene. Assets are reported only; files under videos/out/ are baked, never in git by design, and
are listed as "baked" so a farm box knows to rebuild them. Nothing here changes git state.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
WEB = os.path.join(VIDEOS, 'web')
SCENES = os.path.join(WEB, 'scenes')

IMPORT = re.compile(r"""(?:^|[;\s}])(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]""", re.M)
DYN = re.compile(r"""import\(\s*['"]([^'"]+)['"]\s*\)""")
URL = re.compile(r"""new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)""")
SRC = re.compile(r"""<script[^>]*\bsrc\s*=\s*['"]([^'"]+)['"]""", re.I)
IMAP = re.compile(r"""<script[^>]*type\s*=\s*['"]importmap['"][^>]*>(.*?)</script>""", re.I | re.S)
ASSET = re.compile(r"""['"`]([^'"`\s]+?\.(?:png|jpe?g|webp|gif|json|wav|mp3|ogg|bin|glb|gltf|bvh|ttf|otf|woff2?|svg|mp4|webm))['"`]""", re.I)
MODULE_EXT = ('.js', '.mjs', '.html')


def git(*args, cwd=VIDEOS):
    return subprocess.run(['git', *args], cwd=cwd, capture_output=True, text=True)


def repo_root(start=VIDEOS):
    r = git('rev-parse', '--show-toplevel', cwd=start)
    return r.stdout.strip() if r.returncode == 0 else None


def strip_comments(src):
    src = re.sub(r'/\*.*?\*/', ' ', src, flags=re.S)
    return re.sub(r'(^|[^:\\])//[^\n]*', r'\1', src)


def resolve(spec, base_file, imap):
    if spec.startswith(('http:', 'https:', 'data:', 'blob:')):
        return None
    if not spec.startswith(('.', '/')):                     # bare specifier: importmap or skip
        for k, v in imap.items():
            if spec == k or (k.endswith('/') and spec.startswith(k)):
                spec = v + spec[len(k):]
                base_file = imap['__base__']
                break
        else:
            return None
    spec = spec.split('?')[0].split('#')[0]
    base = os.path.dirname(base_file)
    return os.path.normpath(os.path.join(WEB if spec.startswith('/') else base, spec.lstrip('/') if spec.startswith('/') else spec))


def read_worktree(f):
    try:
        return open(f, encoding='utf-8', errors='ignore').read() if os.path.isfile(f) else None
    except OSError:
        return None


def walk(entry, assets=False, read=read_worktree):
    """-> (modules set, assets set) reachable from entry (an .html or .js path). `read(path)` gives a file's text
    (None when absent): the working tree by default, or a commit's version (Git.reader)."""
    mods, found, todo, imap = set(), set(), [entry], {}
    while todo:
        f = todo.pop()
        if f in mods:
            continue
        mods.add(f)
        if '/node_modules/' in f:
            continue
        src = read(f)
        if src is None:
            continue
        specs = []
        if f.endswith('.html'):
            for m in IMAP.finditer(src):
                try:
                    imap.update(json.loads(m.group(1)).get('imports', {}))
                    imap['__base__'] = f
                except ValueError:
                    pass
            specs += [x if x.startswith(('.', '/', 'http')) else './' + x for x in SRC.findall(src)]
            for block in re.findall(r'<script[^>]*type\s*=\s*[\'"]module[\'"][^>]*>(.*?)</script>', src, re.I | re.S):
                c = strip_comments(block)
                specs += IMPORT.findall(c) + DYN.findall(c)
        else:
            c = strip_comments(src)
            specs += IMPORT.findall(c) + DYN.findall(c)
            for u in URL.findall(c):
                p = resolve(u, f, imap)
                if p and p.endswith(MODULE_EXT):
                    specs.append(u)
                elif p and assets and os.path.isfile(p):
                    found.add(p)
            if assets:
                for a in ASSET.findall(c):
                    if '${' in a or a.startswith(('http', 'data:')):
                        continue
                    for cand in (resolve(a, f, imap), os.path.normpath(os.path.join(SCENES, a)) if not a.startswith('.') else None):
                        if cand and os.path.isfile(cand):
                            found.add(cand)
                            break   # literal paths that resolve to no file (runtime bases, templates) are skipped
        for s in specs:
            p = resolve(s, f, imap)
            if p:
                todo.append(p)
    return mods, found


class Git:
    def __init__(self, root, ref='HEAD'):
        self.root, self.ref = root, ref
        self.tracked = set(git('ls-files', '-z', cwd=root).stdout.split('\0'))
        self.at_ref = set(git('ls-tree', '-r', '--name-only', '-z', ref, cwd=root).stdout.split('\0'))
        self.staged = set(git('diff', '--cached', '--name-only', '-z', cwd=root).stdout.split('\0'))
        self.dirty = set(git('diff', '--name-only', '-z', cwd=root).stdout.split('\0')) | self.staged
        self._cache = {}

    def rel(self, path):
        return os.path.relpath(path, self.root)

    def read_ref(self, path):
        """The file's text at self.ref (None when the commit does not have it)."""
        rel = self.rel(path)
        if rel not in self.at_ref:
            return None
        if rel not in self._cache:
            r = subprocess.run(['git', 'show', f'{self.ref}:{rel}'], cwd=self.root, capture_output=True)
            self._cache[rel] = r.stdout.decode('utf-8', 'ignore') if r.returncode == 0 else None
        return self._cache[rel]

    def state(self, path):
        rel = self.rel(path)
        if rel.startswith('..'):
            return 'outside'
        if not os.path.exists(path):
            return 'staged' if rel in self.staged else 'missing'
        if rel in self.tracked:
            return 'modified' if rel in self.dirty else 'ok'
        ig = git('check-ignore', '-q', rel, cwd=self.root).returncode == 0
        return 'ignored' if ig else 'untracked'


def entry_for(name):
    for c in (os.path.join(SCENES, name + '.html'), os.path.join(SCENES, name + '.js'), name):
        if os.path.exists(c):
            return os.path.abspath(c)
    return None


def importers(mods, target, read):
    """Which of `mods` import `target` (for the "commit together" hint)."""
    out = []
    for m in mods:
        if m == target:
            continue
        sub, _ = walk_one(m, read)
        if target in sub:
            out.append(m)
    return out


def walk_one(f, read):
    """Direct imports of one file only."""
    src = read(f)
    if src is None:
        return set(), set()
    c = strip_comments(src)
    specs = IMPORT.findall(c) + DYN.findall(c) + [u for u in URL.findall(c) if u.endswith(MODULE_EXT)]
    if f.endswith('.html'):
        specs += [x if x.startswith(('.', '/', 'http')) else './' + x for x in SRC.findall(src)]
    return {p for p in (resolve(s, f, {}) for s in specs) if p}, set()


def check(names, assets=False, quiet=False, g=None):
    """Per scene: (1) walk the graph as committed at HEAD: a module HEAD imports but HEAD lacks = BROKEN AT HEAD;
    (2) walk the working tree: a module imported now that is untracked/ignored/missing = COMMIT TOGETHER (committing
    its importer alone would break HEAD). Returns the number of scenes with either problem."""
    g = g or Git(repo_root())
    bad = 0
    for n in names:
        e = entry_for(n)
        if not e:
            print(f'{n}: no web/scenes/{n}.html or .js')
            bad += 1
            continue
        head_mods, _ = walk(e, False, g.read_ref) if g.rel(e) in g.at_ref else ({e}, set())
        head_missing = sorted(p for p in head_mods if '/node_modules/' not in p and g.rel(p) not in g.at_ref)
        mods, found = walk(e, assets)
        rows = [(g.state(p), 'module', p) for p in sorted(mods) if '/node_modules/' not in p]
        for p in sorted(found):
            st = g.state(p)
            rows.append(('baked' if st == 'ignored' and '/videos/out/' in p else st, 'asset', p))
        loose = [r for r in rows if r[1] == 'module' and r[0] in ('untracked', 'ignored', 'missing')]
        mod = [r for r in rows if r[0] in ('modified', 'staged')]
        verdict = []
        if head_missing:
            verdict.append('BROKEN AT HEAD')
        if loose:
            verdict.append('COMMIT TOGETHER')
        if not verdict:
            verdict.append('uncommitted edits' if mod else 'ok')
        nm = sum(1 for r in rows if r[1] == 'module')
        print(f'{n}: {", ".join(verdict)}  ({nm} modules' + (f', {len(found)} assets' if assets else '') + ')')
        for p in head_missing:
            print(f'   HEAD lacks  module {os.path.relpath(p, VIDEOS)} (imported by the committed graph; now {g.state(p)})')
        for st, kind, p in rows:
            if st == 'ok' or (quiet and st in ('modified', 'staged', 'baked')):
                continue
            hint = ''
            if kind == 'module' and st in ('untracked', 'ignored', 'missing'):
                who = [os.path.relpath(x, VIDEOS) for x in importers(mods, p, read_worktree)]
                hint = f'  <- imported by {", ".join(who)}' if who else ''
            print(f'   {st:10s} {kind:6s} {os.path.relpath(p, VIDEOS)}{hint}')
        bad += bool(head_missing or loose)
    return bad


def staged_check(g=None):
    """Staged scene/lib modules whose imports are neither tracked nor staged (what a commit would leave broken)."""
    g = g or Git(repo_root())
    staged = [os.path.join(g.root, s) for s in g.staged if s.endswith(MODULE_EXT) and '/web/' in '/' + s]
    bad = 0
    for f in staged:
        if not os.path.exists(f):
            continue
        mods, _ = walk(f)
        for p in sorted(mods):
            if p == f or '/node_modules/' in p:
                continue
            st = g.state(p)
            if st in ('untracked', 'ignored', 'missing'):
                print(f'{os.path.relpath(f, VIDEOS)} imports {os.path.relpath(p, VIDEOS)} ({st}): stage it too')
                bad += 1
    if not bad:
        print(f'staged: ok ({len(staged)} staged web modules, every import tracked or staged)')
    return bad


def selftest():
    """A throwaway repo: scene.html -> a.js -> b.js (untracked) + dyn import + URL import; baked asset in out/."""
    global VIDEOS, WEB, SCENES
    saved = VIDEOS, WEB, SCENES
    with tempfile.TemporaryDirectory() as d:
        VIDEOS, WEB = os.path.join(d, 'videos'), os.path.join(d, 'videos', 'web')
        SCENES = os.path.join(WEB, 'scenes')
        os.makedirs(SCENES)
        os.makedirs(os.path.join(WEB, 'lib'))
        os.makedirs(os.path.join(VIDEOS, 'out'))
        w = lambda p, s: open(os.path.join(d, p), 'w').write(s)
        w('.gitignore', 'videos/out/\n')
        w('videos/web/scenes/s.html', '<script type="importmap">{"imports":{"three":"../node_modules/three.js"}}</script>'
          '<script type="module" src="s.js"></script>')
        w('videos/web/scenes/s.js', "import * as T from 'three';\nimport { a } from '../lib/a.js';\n// import x from './gone.js'\n"
          "const k = await import('./s.dyn.js');\nconst u = new URL('./s.worker.js', import.meta.url);\n"
          "fetch('../../out/.s_bake/index.json'); const p = 'red.png';\n")
        w('videos/web/lib/a.js', "export { b } from './b.js';\nexport const a = 1;\n")
        w('videos/web/lib/b.js', 'export const b = 2;\n')
        w('videos/web/scenes/s.dyn.js', 'export default 1;\n')
        w('videos/web/scenes/s.worker.js', '\n')
        w('videos/web/scenes/red.png', 'x')
        os.makedirs(os.path.join(VIDEOS, 'out', '.s_bake'))
        w('videos/out/.s_bake/index.json', '{}')
        for c in (['init', '-q'], ['add', '.gitignore', 'videos/web/scenes/s.html', 'videos/web/scenes/s.js',
                                   'videos/web/lib/a.js', 'videos/web/scenes/s.dyn.js', 'videos/web/scenes/red.png'],
                  ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'x']):
            subprocess.run(['git', *c], cwd=d, check=True, capture_output=True)
        ok = True
        mods, found = walk(os.path.join(SCENES, 's.html'), True)
        names = {os.path.relpath(p, WEB) for p in mods}
        exp = {'scenes/s.html', 'scenes/s.js', 'lib/a.js', 'lib/b.js', 'scenes/s.dyn.js', 'scenes/s.worker.js'}
        ok &= exp <= names and 'scenes/gone.js' not in names
        print(('ok  ' if exp <= names else 'BAD ') + 'module graph: html src, static, export-from, dynamic, URL; comments skipped')
        g = Git(d)
        st = {os.path.relpath(p, WEB): g.state(p) for p in mods if '/node_modules/' not in p}
        t = st.get('lib/b.js') == 'untracked' and st.get('scenes/s.worker.js') == 'untracked' and st.get('lib/a.js') == 'ok'
        ok &= t
        print(('ok  ' if t else 'BAD ') + f'states: {st}')
        fs = {os.path.relpath(p, VIDEOS) if os.path.isabs(p) else p: g.state(p) if os.path.isabs(p) else 'missing' for p in found}
        t = fs.get('out/.s_bake/index.json') == 'ignored' and fs.get('web/scenes/red.png') == 'ok'
        ok &= t
        print(('ok  ' if t else 'BAD ') + f'assets: {fs}')
        r = check(['s'], assets=True, g=g)
        ok &= r == 1
        print(('ok  ' if r == 1 else 'BAD ') + 'check() flags the scene as broken at HEAD')
        subprocess.run(['git', 'add', 'videos/web/lib/b.js', 'videos/web/scenes/s.worker.js'], cwd=d, check=True)
        subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'y'], cwd=d, check=True)
        r = check(['s'], g=Git(d))
        ok &= r == 0
        print(('ok  ' if r == 0 else 'BAD ') + 'after committing the two files the scene is whole at HEAD')
        w('videos/web/lib/c.js', 'export const c = 3;\n')
        w('videos/web/lib/a.js', "export { b } from './b.js';\nexport { c } from './c.js';\nexport const a = 1;\n")
        g = Git(d)
        head_ok = not [p for p in walk(os.path.join(SCENES, 's.html'), False, g.read_ref)[0]
                       if '/node_modules/' not in p and g.rel(p) not in g.at_ref]
        r = check(['s'], g=g)
        ok &= r == 1 and head_ok
        print(('ok  ' if r == 1 and head_ok else 'BAD ') + 'an edited a.js importing a new c.js: HEAD still whole, flagged COMMIT TOGETHER')
        subprocess.run(['git', 'add', 'videos/web/lib/a.js'], cwd=d, check=True)
        r = staged_check(Git(d))
        ok &= r == 1
        print(('ok  ' if r == 1 else 'BAD ') + '--staged catches a staged module importing an unstaged new file')
    VIDEOS, WEB, SCENES = saved
    print('selftest', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('scenes', nargs='*')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('--assets', action='store_true')
    ap.add_argument('--staged', action='store_true')
    ap.add_argument('--quiet', '-q', action='store_true', help='hide modified and baked rows')
    ap.add_argument('--selftest', action='store_true')
    A = ap.parse_args()
    if A.selftest:
        return selftest()
    if A.staged:
        return 1 if staged_check() else 0
    names = A.scenes
    if A.all:
        names = sorted(f[:-5] for f in os.listdir(SCENES) if f.endswith('.html'))
    if not names:
        ap.error('name a scene, or --all / --staged / --selftest')
    return 1 if check(names, A.assets, A.quiet) else 0


if __name__ == '__main__':
    sys.exit(main())
