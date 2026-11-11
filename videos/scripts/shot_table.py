#!/usr/bin/env python3
"""Declared cuts: the reader of the cuts and oners a piece already declares. It sets no shot-length rule.

ffmpeg's scene-change score misses cuts between two frames of one printed palette (MELTDOWN c3: 8 real cuts in
22-28.6 s, 1 found) and cannot know that a section is one shot on purpose (ALL POWER's wire oner, b2.5-10). Tools
that need to know where shots start (boards, timing readouts) read the piece's own declaration, in this order:

  1. research/scripts_final/<key>.json
       "cuts": [0, 4, 5.5, ...]        beats where a new shot starts (overrides the scene's table)
       "oner": [[2.5, 10], ...]        beat windows that are one shot by design
  2. the scene's own `const SHOTS = [...]` (web/scenes/<scene>.js and the ./modules it imports), any of the shapes
     in use on the slate: [b0, ...] rows, { b0: .. } / { b: [b0, b1] } / { at: .. } / { beat: .. } objects.
     The first number of each row is its start beat.

Library:
  from shot_table import declared
  d = declared('allpower', spb=60/92)  -> {'cuts_s': [...], 'oner_s': [[a, b], ...], 'source': 'SHOTS in allpower.js'}
  merge_cuts(detected_s, declared_s, tol=0.12) -> sorted union
CLI:
  scripts/shot_table.py allpower            # the table in beats and seconds
  scripts/shot_table.py --selftest
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
SCENES = os.path.join(VIDEOS, 'web', 'scenes')
SCRIPTS_FINAL = os.path.join(ROOT, 'research', 'scripts_final')
OUT = os.path.join(VIDEOS, 'out')


def strip_js_comments(src):
    """Remove // and /* */ comments, leaving strings (and regex-free code) intact enough for scanning."""
    out, i, n = [], 0, len(src)
    q = None
    while i < n:
        c = src[i]
        if q:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1]); i += 2; continue
            if c == q:
                q = None
            i += 1
        elif c in '\'"`':
            q = c; out.append(c); i += 1
        elif src.startswith('//', i):
            j = src.find('\n', i)
            i = n if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            i = n if j < 0 else j + 2
        else:
            out.append(c); i += 1
    return ''.join(out)


def _array_at(src, i):
    """The text of the balanced [...] that starts at src[i] == '['."""
    depth, q = 0, None
    for j in range(i, len(src)):
        c = src[j]
        if q:
            if c == '\\':
                continue
            if c == q:
                q = None
            continue
        if c in '\'"`':
            q = c
        elif c in '[({':
            depth += 1
        elif c in '])}':
            depth -= 1
            if depth == 0:
                return src[i:j + 1]
    return None


def _top_items(arr):
    """Split the body of a JS array literal into its top-level items."""
    body, items, depth, q, cur = arr[1:-1], [], 0, None, []
    for c in body:
        if q:
            cur.append(c)
            if c == q:
                q = None
            continue
        if c in '\'"`':
            q = c
        if c in '[({':
            depth += 1
        elif c in '])}':
            depth -= 1
        if c == ',' and depth == 0:
            items.append(''.join(cur)); cur = []
        else:
            cur.append(c)
    if ''.join(cur).strip():
        items.append(''.join(cur))
    return [s.strip() for s in items if s.strip()]


NUM = r'(-?\d+(?:\.\d+)?)'
ROW_PATTERNS = [re.compile(r'^\[\s*' + NUM), re.compile(r'\bb0\s*:\s*' + NUM), re.compile(r'\bb\s*:\s*\[\s*' + NUM),
                re.compile(r'\b(?:at|beat|start|from)\s*:\s*' + NUM)]


def shots_from_js(src):
    """Start beats of `const|let SHOTS = [...]` in one JS source, or None when there is no table."""
    src = strip_js_comments(src)
    m = re.search(r'\b(?:const|let|var)\s+SHOTS\s*=\s*\[', src)
    if not m:
        return None
    arr = _array_at(src, m.end() - 1)
    if not arr:
        return None
    beats = []
    for it in _top_items(arr):
        for p in ROW_PATTERNS:
            k = p.search(it)
            if k:
                beats.append(float(k.group(1)))
                break
    return sorted(set(beats)) or None


def scene_files(scene):
    main = os.path.join(SCENES, scene + '.js')
    if not os.path.exists(main):
        return []
    out = [main]
    for mod in re.findall(r"from\s+'\./([\w.]+\.js)'", open(main, errors='ignore').read()):
        p = os.path.join(SCENES, mod)
        if os.path.exists(p) and p not in out:
            out.append(p)
    return out


def script_for(scene, key=None):
    if not key:   # TOOLING WM1: exact name first (machines_e1, gary2036), then minus digits
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from script_key import script_path
        return script_path(scene or '')
    k = key
    if k and k.endswith('.json') and os.path.exists(k):
        return k
    p = os.path.join(SCRIPTS_FINAL, f'{k}.json')
    return p if os.path.exists(p) else None


def bpm_for(scene):
    for s in (scene, re.sub(r'\d+$', '', scene or '')):
        p = os.path.join(OUT, f'.{s}.hits.json')
        if os.path.exists(p):
            try:
                return json.load(open(p)).get('bpm')
            except Exception:  # noqa: BLE001
                pass
    return None


def declared(scene, spb=None, key=None):
    """{'cuts_b', 'cuts_s', 'oner_b', 'oner_s', 'source'} or None when the piece declares nothing."""
    if spb is None:
        bpm = bpm_for(scene)
        spb = 60.0 / bpm if bpm else None
    cuts, oner, src = None, [], None
    sp = script_for(scene, key)
    if sp:
        try:
            J = json.load(open(sp))
            if J.get('cuts'):
                cuts, src = sorted(float(b) for b in J['cuts']), os.path.basename(sp) + ' "cuts"'
            oner = [[float(a), float(b)] for a, b in (J.get('oner') or [])]
        except Exception:  # noqa: BLE001
            pass
    if cuts is None:
        for f in scene_files(scene):
            b = shots_from_js(open(f, errors='ignore').read())
            if b:
                cuts, src = b, f'SHOTS in {os.path.basename(f)}'
                break
    if cuts is None and not oner:
        return None
    cuts = [b for b in (cuts or []) if b > 0]
    # a oner's inner boundaries are not cuts
    cuts = [b for b in cuts if not any(a < b < e for a, e in oner)]
    d = {'cuts_b': cuts, 'oner_b': oner, 'source': src or 'script "oner"', 'spb': spb}
    if spb:
        d['cuts_s'] = [round(b * spb, 3) for b in cuts]
        d['oner_s'] = [[round(a * spb, 3), round(e * spb, 3)] for a, e in oner]
    return d


def merge_cuts(detected, decl, tol=0.12):
    out = sorted(detected)
    for c in decl:
        if not any(abs(c - d) < tol for d in out):
            out.append(c)
    return sorted(out)


def selftest():
    js = """
    // const SHOTS = [[99, x]]  (a comment: ignored)
    const SHOTS = [
      [0, s => a(s, [1, 2])],   // hook
      [4, s => b(s)], [5.5, s => c({ k: 3 })],
    ];
    """
    assert shots_from_js(js) == [0, 4, 5.5], shots_from_js(js)
    js2 = "const SHOTS = [ { b0: 0, b1: 2.5, name: 'a' }, { b0: 2.5, b1: 10 }, { b: [10, 14], f: u => ({ pos: [1, 2] }) } ];"
    assert shots_from_js(js2) == [0, 2.5, 10], shots_from_js(js2)
    assert shots_from_js("let X = 1;") is None
    assert strip_js_comments("a = '//not'; // yes\nb") == "a = '//not'; \nb"
    assert merge_cuts([1.0, 2.0], [1.05, 3.0]) == [1.0, 2.0, 3.0]
    print('shot_table selftest: OK (row arrays, b0 objects, b:[..] objects, comments, merge)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('scene', nargs='?')
    ap.add_argument('--bpm', type=float)
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.scene:
        ap.error('scene required')
    d = declared(a.scene, 60.0 / a.bpm if a.bpm else None)
    if not d:
        sys.exit(f'{a.scene}: no SHOTS table and no "cuts"/"oner" in the script')
    print(f"{a.scene}: {len(d['cuts_b'])} declared cuts from {d['source']}"
          + (f" at {60 / d['spb']:.0f} BPM" if d.get('spb') else ' (no BPM: beats only)'))
    print('  beats  ', d['cuts_b'])
    if d.get('cuts_s'):
        print('  seconds', d['cuts_s'])
    if d['oner_b']:
        print('  oner   ', d['oner_b'])


if __name__ == '__main__':
    main()
