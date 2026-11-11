#!/usr/bin/env python3
"""stock_use.py: where does a scene use archive footage, and which other scenes share the same film (c36).

  python3 videos/tools/stock_use.py SCENE                 per source film: baked clips, and the scene's CODE lines that name each clip
  python3 videos/tools/stock_use.py SCENE --source MasterHa   only clips cut from films whose file name contains the text
  python3 videos/tools/stock_use.py SCENE --word grip     every code line naming a word (an alias, a constant: cutHand('grip', ...), GRIPS)
  python3 videos/tools/stock_use.py SCENE --others        also: other scenes that name the same films or share the same clips
  python3 videos/tools/stock_use.py --selftest

Why. A builder reported "the Master Hands grip is removed" and it was still in the scene (productive2.js line 231 and a GRIPS table).
Removing a clip's draw is not the same as removing its name from a helper that still cuts it, and a grep for the film's name finds
nothing because the scene only knows baked clip names. This reads the asset dir's clips.json (clip -> source film), maps it to
the scene's code lines (comments and strings-after-// ignored, so a comment saying "grip is gone" does not count), and says plainly
"no code line names clip X". Check a removal claim with it before reporting it. Reads only.
Limits: matching is on quoted names ('lever'), so a name built at run time ('cl' + i) is not seen; the // test is a line heuristic
(a // inside a string or a URL after a quote is treated as code up to the first ` //` with a space before it); `--others` matches
by film file stem or by shared clip names inside other scenes' asset dirs and says which, it cannot say a shot is on screen.
Whether sharing a film is a problem is a creative and client call (HANDBOOK Part I: each video its own lineage); this only finds it.
"""
import argparse, glob, json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WEB = os.path.join(ROOT, 'videos', 'web')


def code_part(line):
    s = line.strip()
    if s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        return ''
    m = re.search(r'\s//\s', line + ' ')
    return line[:m.start()] if m else line


def scene_path(name, web=WEB):
    for p in (name, os.path.join(web, 'scenes', name), os.path.join(web, 'scenes', name + '.js')):
        if os.path.isfile(p):
            return p
    sys.exit('no scene %r under %s/scenes' % (name, web))


def asset_clip_sets(text, web=WEB):
    """clips.json files in the asset dirs the scene names -> {dir: {clip: meta}}"""
    out = {}
    for d in sorted(set(re.findall(r'assets/([A-Za-z0-9_/\-]+?)/', text))):
        p = os.path.join(web, 'assets', d, 'clips.json')
        if os.path.isfile(p):
            try:
                out[d] = json.load(open(p))
            except Exception:
                pass
    return out


def stem(src):
    return re.sub(r'(_\d+)?(_\d+kb)?\.\w+$', '', src)


def name_lines(lines, name):
    pat = re.compile(r'''(['"`])%s\1''' % re.escape(name))
    return [(i + 1, l.strip()) for i, l in enumerate(lines) if pat.search(code_part(l))]


def analyse(text, web=WEB, source=None):
    lines = text.split('\n')
    res = []
    for d, clips in asset_clip_sets(text, web).items():
        for c, m in clips.items():
            src = m.get('src', '?')
            if source and source.lower() not in src.lower():
                continue
            res.append(dict(dir=d, clip=c, src=src, frames=m.get('n'), uses=name_lines(lines, c)))
    return res


def others(scene_file, films, clipsets, web=WEB):
    """other scenes that name one of the films by stem, or an asset dir whose clips.json shares a source stem"""
    found = {}
    stems = {stem(f) for f in films}
    for p in sorted(glob.glob(os.path.join(web, 'scenes', '**', '*'), recursive=True)):
        if not p.endswith(('.js', '.py')) or os.path.abspath(p) == os.path.abspath(scene_file):
            continue
        try:
            t = open(p, errors='ignore').read()
        except Exception:
            continue
        hit = [s for s in stems if s in t]
        dirs = []
        for d in set(re.findall(r'assets/([A-Za-z0-9_/\-]+?)/', t)):
            q = os.path.join(web, 'assets', d, 'clips.json')
            if d in clipsets or not os.path.isfile(q):
                continue
            try:
                o = json.load(open(q))
            except Exception:
                continue
            ss = {stem(v.get('src', '')) for v in o.values()} & stems
            if ss:
                dirs.append('%s(%s)' % (d, ','.join(sorted(ss))))
        if hit or dirs:
            found[os.path.relpath(p, web)] = (hit, dirs)
    return found


def report(scene, source=None, word=None, show_others=False, web=WEB):
    p = scene_path(scene, web)
    text = open(p).read()
    lines = text.split('\n')
    print('scene %s' % os.path.relpath(p, ROOT))
    if word:
        pat = re.compile(r'\b%s\b' % re.escape(word), re.I)
        hits = [(i + 1, l.strip()) for i, l in enumerate(lines) if pat.search(code_part(l))]
        print('code lines naming %r: %d' % (word, len(hits)))
        for n, l in hits:
            print('  %5d  %s' % (n, l[:140]))
        return 0
    res = analyse(text, web, source)
    if not res:
        print('no baked clips found%s (asset dirs with clips.json named by the scene: %s)' %
              (' for source %r' % source if source else '', list(asset_clip_sets(text, web)) or 'none'))
        return 0
    films = {}
    for r in res:
        films.setdefault(r['src'], []).append(r)
    for f, rs in sorted(films.items()):
        used = [r for r in rs if r['uses']]
        print('\n%s: %d clips baked, %d named in code' % (f, len(rs), len(used)))
        for r in rs:
            if r['uses']:
                print('  %-12s %3s lines %s' % (r['clip'], len(r['uses']), ', '.join(str(n) for n, _ in r['uses'][:14])))
                for n, l in r['uses'][:3]:
                    print('       %5d  %s' % (n, l[:120]))
            else:
                print('  %-12s no code line names it' % r['clip'])
    if show_others:
        o = others(p, films, asset_clip_sets(text, web), web)
        print('\nother scenes that name these films or share their clips: %d' % len(o))
        for k, (h, d) in o.items():
            print('  %-44s %s %s' % (k, 'names ' + ','.join(h) if h else '', 'dirs ' + ' '.join(d) if d else ''))
    return 0


def selftest():
    import tempfile
    tmp = tempfile.mkdtemp()
    os.makedirs(tmp + '/scenes'); os.makedirs(tmp + '/assets/a'); os.makedirs(tmp + '/assets/b')
    json.dump({'lever': {'src': 'MasterHa1936.mp4', 'n': 5}, 'pour': {'src': 'steel_1.mp4', 'n': 4}}, open(tmp + '/assets/a/clips.json', 'w'))
    json.dump({'x': {'src': 'MasterHa1936_2.mp4', 'n': 5}}, open(tmp + '/assets/b/clips.json', 'w'))
    open(tmp + '/scenes/s.js', 'w').write("const A = new URL('../assets/a/clips.json');\n// 'lever' is gone\nawait cut('grip', 'lever', 1);  // note\nconst G = ['grip','pinch'];\nuse('pour');\n")
    open(tmp + '/scenes/o.js', 'w').write("fetch('../assets/b/clips.json'); // MasterHa1936\n")
    t = open(tmp + '/scenes/s.js').read()
    r = {x['clip']: x for x in analyse(t, tmp)}
    assert [n for n, _ in r['lever']['uses']] == [3], r['lever']['uses']   # the comment line is not counted
    assert [n for n, _ in r['pour']['uses']] == [5]
    assert not analyse(t, tmp, source='steel')[0]['clip'] != 'pour'
    o = others(tmp + '/scenes/s.js', {'MasterHa1936.mp4'}, asset_clip_sets(t, tmp), tmp)
    assert 'scenes/o.js' in o and o['scenes/o.js'][0] and o['scenes/o.js'][1], o
    assert code_part("x // c") == 'x' and code_part('// c') == '' and code_part("u('http://a')") == "u('http://a')"
    report('s', web=tmp); report('s', word='grip', web=tmp)
    print('selftest ok')


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('scene', nargs='?'); ap.add_argument('--source'); ap.add_argument('--word')
    ap.add_argument('--others', action='store_true'); ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        selftest(); sys.exit(0)
    if not a.scene:
        ap.error('scene required')
    sys.exit(report(a.scene, a.source, a.word, a.others))
