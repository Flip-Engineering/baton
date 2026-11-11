"""One place that maps a scene / clip / song key to its script file (research/scripts_final/<key>.json).

TOOLING WM1 (2026-09-28). Before this, eight call sites stripped trailing digits blindly
(`re.sub(r'\\d+$', '', scene)` / `key.rstrip("0123456789")`), so:
  machines_e1 -> machines_e.json   (missing; THE FACTORY had to pass --script by hand)
  gary2036    -> gary.json         (missing; GARY 2036 lost its emphasis set and script beats)
The rule now: the EXACT name wins when its file exists; only then fall back through the build suffixes.

    from script_key import script_key, script_path
    script_key('machines_e1')  -> 'machines_e1'
    script_key('ownfuture2')   -> 'ownfuture'
    script_key('meltdown8_0-8_share') -> 'meltdown'   (clip / share / _vN stems work too)
    script_path('horde3')      -> '/.../research/scripts_final/horde.json'  (or scripts_wip/, or None)

CLI:  python3 videos/scripts/script_key.py SCENE [SCENE ...]     # prints scene -> key -> path
      python3 videos/scripts/script_key.py --all                  # every scene in web/scenes
      python3 videos/scripts/script_key.py --selftest
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
DIRS = (os.path.join(ROOT, 'research', 'scripts_final'), os.path.join(ROOT, 'research', 'scripts_wip'))
CLIP = re.compile(r'_\d+(?:\.\d+)?-\d+(?:\.\d+)?$')


def candidates(name):
    """Keys to try, most specific first: exact, then minus _share / clip range / _vN, then minus trailing digits."""
    out = []

    def add(k):
        k = (k or '').strip()
        if k and k not in out:
            out.append(k)
    s = os.path.splitext(os.path.basename(name or ''))[0] if (name or '').endswith(('.mp4', '.json', '.js', '.html')) else (name or '')
    add(s)
    for _ in range(3):   # peel suffixes in any order: _share, _12.4-20.1, _v7
        s2 = re.sub(r'_share$', '', s)
        s2 = CLIP.sub('', s2)
        s2 = re.sub(r'_v\d+$', '', s2)
        if s2 == s:
            break
        s = s2
        add(s)
    add(re.sub(r'_c\d+(?:_[a-z]+)?$', '', s))      # TOOLING c11: cycle builds giant_c5, ready_c9, giant_c5_share-peeled -> giant, ready
    add(re.sub(r'\d+$', '', s))                 # ownfuture2 -> ownfuture, horde3 -> horde
    add(re.sub(r'_?\d+$', '', s))              # foo_2 -> foo
    return out


def script_path(name, dirs=DIRS):
    """Absolute path of the script for a scene / clip / key, or None. A path to an existing .json is returned as is."""
    if not name:
        return None
    if name.endswith('.json') and os.path.exists(name):
        return os.path.abspath(name)
    for k in candidates(name):                  # scripts_final beats scripts_wip at each level
        for d in dirs:
            p = os.path.join(d, k + '.json')
            if os.path.exists(p):
                return p
    return None


def script_key(name, dirs=DIRS):
    """The key whose script exists (see module doc). With no script at all, the old digit-stripped guess, so callers
    that print 'missing research/scripts_final/<key>.json' still name something sensible."""
    p = script_path(name, dirs)
    if p:
        return os.path.splitext(os.path.basename(p))[0]
    c = candidates(name)
    return (re.sub(r'\d+$', '', c[-1]) or c[-1]) if c else None   # the old rule, on the peeled stem


def _selftest():
    ok = True
    have = {os.path.splitext(f)[0] for f in os.listdir(DIRS[0]) if f.endswith('.json')}
    cases = [('machines_e1', 'machines_e1'), ('machines_e2', 'machines_e2'), ('gary2036', 'gary2036'),
             ('ownfuture2', 'ownfuture'), ('meltdown8', 'meltdown'), ('horde3', 'horde'), ('unfinished3', 'unfinished'),
             ('meltdown8_0-8', 'meltdown'), ('meltdown8_38-45.4_share', 'meltdown'), ('machines_e1_12.41-22.09', 'machines_e1'),
             ('giant_c5', 'giant'), ('ready_c9', 'ready'), ('ready_c9_share', 'ready'), ('giant_c5_0-8', 'giant'), ('clip_v7', None), ('machines', 'machines')]
    for name, want in cases:
        if want is not None and want not in have:
            print(f'skip {name}: no {want}.json on this checkout')
            continue
        got = script_key(name) if want else None
        if want and got != want:
            ok = False
        print(f"{'ok  ' if (not want or got == want) else 'FAIL'} {name:28s} -> {got}")
    print('selftest', 'PASS' if ok else 'FAIL')
    return 0 if ok else 1


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    if a[0] == '--selftest':
        sys.exit(_selftest())
    if a[0] == '--all':
        a = sorted(f[:-5] for f in os.listdir(os.path.join(VIDEOS, 'web', 'scenes')) if f.endswith('.html'))
    for n in a:
        p = script_path(n)
        print(f"{n:28s} -> {script_key(n) or '-':16s} {os.path.relpath(p, ROOT) if p else '(no script)'}")
