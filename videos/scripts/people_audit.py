#!/usr/bin/env python3
"""People audit merger: one gesture audit per piece out of the windows render.mjs wrote.

render.mjs writes the people (gesture) audit next to what it rendered:
  out/.<scene>.people.json            a full render
  out/.<scene>.people_<from>-<to>.json  a clip (--from/--to), one per window
  out/.<scene>.people.stills.json     a stills run (--stills)
gate.py used to read only the first, so every clip-gated piece needed a hand copy (IRON c3) or a private merge script
(HORDE c3). This module finds every audit of a scene, drops stale ones (older than the scene or the people code),
merges the rest (flags de-duplicated by frame time, counts recomputed where the flag list is complete, coverage as a
union of intervals) and reports which part of the piece, or of a clip window, is covered.

Library (gate.py uses it):
  from people_audit import merged
  J = merged('horde3', window=(16.4, 20.2), newest_src=mtime)   # -> dict like one audit, plus
      J['coverage'] = [[a, b], ...] (piece s), J['covered_s'], J['window'], J['sources'] = [file names], J['stale'] = [...]
CLI:
  scripts/people_audit.py horde3                  # list the audits, coverage, counts
  scripts/people_audit.py horde3 --from 16.4 --to 20.2
  scripts/people_audit.py horde3 --write          # write the merge to out/.horde3.people.merged.json
  scripts/people_audit.py --selftest
"""
import argparse
import glob
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
OUT = os.path.join(VIDEOS, 'out')
KINDS = ('SALUTE_STRAIGHT', 'SALUTE_FOREARM', 'CROTCH')
CAP = 400                        # gesture.js keeps at most 400 flags per audit
WIN_RE = re.compile(r'\.people_(-?[\d.]+)-(-?[\d.]+)\.json$')


def find(scene, out=OUT):
    """[(path, kind, (from, to) | None)] kind: 'full' | 'window' | 'stills' | 'merged'"""
    res = []
    for p in sorted(glob.glob(os.path.join(out, f'.{scene}.people*.json'))):
        b = os.path.basename(p)
        m = WIN_RE.search(b)
        if b == f'.{scene}.people.json':
            res.append((p, 'full', None))
        elif m:
            res.append((p, 'window', (float(m.group(1)), float(m.group(2)))))
        elif b == f'.{scene}.people.stills.json':
            res.append((p, 'stills', None))
        elif b == f'.{scene}.people.merged.json':
            continue                             # our own output is never an input
    return res


def _span(J, kind, win):
    """The piece-time intervals an audit covers."""
    if kind == 'window':
        return [list(win)]
    if J.get('stills'):
        return [[float(t) - 0.02, float(t) + 0.02] for t in J['stills']]
    f, t = J.get('from'), J.get('to')
    if f is not None and t is not None:
        return [[float(f), float(t)]]
    if J.get('duration'):
        return [[0.0, float(J['duration'])]]
    return []


def union(iv):
    out = []
    for a, b in sorted(iv):
        if out and a <= out[-1][1] + 1e-3:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return out


def clip_to(iv, w):
    if not w:
        return iv
    return [[max(a, w[0]), min(b, w[1])] for a, b in iv if min(b, w[1]) > max(a, w[0])]


def inside(t, iv):
    return any(a - 1e-3 <= t <= b + 1e-3 for a, b in iv)


def merged(scene, window=None, newest_src=None, out=OUT, stills=None):
    """Merge every fresh audit of `scene`. window=(from, to) keeps the audits (and flags) inside a clip window.
    stills: include the stills audit (default: only when no clip or full audit covers anything).
    Returns None when the scene has no audit at all."""
    found = find(scene, out)
    if not found:
        return None
    loaded, stale, bad = [], [], []
    for p, kind, win in found:
        try:
            J = json.load(open(p))
        except Exception as e:  # noqa: BLE001
            bad.append(f'{os.path.basename(p)}: {e}')
            continue
        age_ok = newest_src is None or os.path.getmtime(p) + 1 >= newest_src
        loaded.append((p, kind, win, J, age_ok))
        if not age_ok:
            stale.append(os.path.basename(p))
    fresh = [x for x in loaded if x[4]] or loaded          # all stale: use them anyway, the caller warns
    use_stills = stills if stills is not None else not any(k != 'stills' for _, k, *_ in fresh)
    fresh = [x for x in fresh if x[1] != 'stills' or use_stills]
    # full renders first, then windows newest first: an overlap is counted once, from the best source
    fresh.sort(key=lambda x: (x[1] != 'full', -os.path.getmtime(x[0])))
    acc = {'version': 1, 'scene': scene, 'frames': 0, 'raised': 0, 'flagged': 0, 'hazards': 0, 'flags': [],
           'samples': [], 'counts': {}, 'sources': [], 'stale': stale, 'unreadable': bad, 'window': window}
    covered = []
    duration = None
    for p, kind, win, J, ok in fresh:
        span = clip_to(_span(J, kind, win), window)
        if window and not span:
            continue
        duration = duration or J.get('duration')
        new = clip_to(span, None)
        # the part of this audit no earlier source covered
        todo = []
        for a, b in new:
            cur = [[a, b]]
            for c, d in covered:
                nxt = []
                for x, y in cur:
                    if d <= x or c >= y:
                        nxt.append([x, y])
                    else:
                        if c > x:
                            nxt.append([x, c])
                        if d < y:
                            nxt.append([d, y])
                cur = nxt
            todo += [s for s in cur if s[1] - s[0] > 1e-3]
        if not todo:
            continue
        full_len = sum(b - a for a, b in _span(J, kind, win)) or 1.0
        share = sum(b - a for a, b in todo) / full_len
        flags = [f for f in (J.get('flags') or []) if inside(float(f.get('t', -1)), todo)]
        complete = len(J.get('flags') or []) < CAP
        if complete:
            for f in flags:
                for k in f.get('flags') or []:
                    acc['counts'][k] = acc['counts'].get(k, 0) + 1
        else:                                   # capped list: scale the audit's own counts by the new share
            for k, v in (J.get('counts') or {}).items():
                acc['counts'][k] = acc['counts'].get(k, 0) + int(round(v * share)) or (1 if v else 0)
        for k in ('frames', 'raised', 'flagged', 'hazards'):
            acc[k] += int(round((J.get(k) or 0) * share))
        acc['flags'] += flags
        acc['samples'] += [s for s in (J.get('samples') or []) if inside(float(s.get('t', -1)), todo)][:12]
        acc['sources'].append(os.path.basename(p))
        covered = union(covered + todo)
    acc['flags'].sort(key=lambda f: f.get('t', 0))
    acc['flags'] = acc['flags'][:CAP]
    acc['samples'] = sorted(acc['samples'], key=lambda s: s.get('t', 0))[:60]
    acc['coverage'] = [[round(a, 3), round(b, 3)] for a, b in covered]
    acc['covered_s'] = round(sum(b - a for a, b in covered), 3)
    acc['duration'] = duration
    if covered:
        acc['from'], acc['to'] = acc['coverage'][0][0], acc['coverage'][-1][1]
    return acc


def gaps(J, span, min_gap=0.6):
    """The parts of span=(a, b) the merged audit does not cover (each longer than min_gap)."""
    out, cur = [], span[0]
    for a, b in J.get('coverage') or []:
        if a - cur > min_gap:
            out.append((round(cur, 2), round(min(a, span[1]), 2)))
        cur = max(cur, b)
    if span[1] - cur > min_gap:
        out.append((round(cur, 2), round(span[1], 2)))
    return [g for g in out if g[1] > g[0]]


def show(J, span=None):
    w = sys.stdout.write
    w(f"people audit {J['scene']}: {len(J['sources'])} source(s): {', '.join(J['sources']) or '-'}\n")
    if J['stale']:
        w(f"  stale (older than the scene / people code, used only if nothing fresh): {', '.join(J['stale'])}\n")
    w(f"  coverage {J['coverage']} = {J['covered_s']} s" + (f" of the piece's {J['duration']} s" if J.get('duration') else '') + '\n')
    if span:
        g = gaps(J, span)
        w(f"  gaps in {span[0]}-{span[1]} s: {g or 'none'}\n")
    w(f"  {J['frames']} frames, {J['raised']} raised arm-frames, counts {J['counts'] or '{} (clean)'}\n")


def selftest():
    d = tempfile.mkdtemp(prefix='pa_')
    def wr(name, **kw):
        base = {'version': 1, 'frames': 10, 'raised': 20, 'flagged': 0, 'hazards': 0, 'flags': [], 'samples': [], 'counts': {}}
        base.update(kw)
        json.dump(base, open(os.path.join(d, name), 'w'))
    wr('.x.people_0-2.json', frames=60, flags=[{'t': 1.0, 'flags': ['SALUTE_FOREARM']}], counts={'SALUTE_FOREARM': 1}, flagged=1)
    wr('.x.people_1.5-4.json', frames=75, flags=[{'t': 1.0, 'flags': ['SALUTE_FOREARM']}, {'t': 3.0, 'flags': ['CROTCH']}],
       counts={'SALUTE_FOREARM': 1, 'CROTCH': 1})
    wr('.x.people.stills.json', stills=[0.5, 9.0], frames=2)
    J = merged('x', out=d)
    assert J['coverage'] == [[0.0, 4.0]], J['coverage']
    assert J['counts'] == {'SALUTE_FOREARM': 1, 'CROTCH': 1}, J['counts']      # the overlap at t=1 counted once
    assert gaps(J, (0, 6)) == [(4.0, 6)], gaps(J, (0, 6))
    Jw = merged('x', window=(2.5, 4.0), out=d)
    assert Jw['counts'] == {'CROTCH': 1} and Jw['coverage'] == [[2.5, 4.0]], Jw
    assert merged('y', out=d) is None
    Js = merged('x', out=d, stills=True)
    assert [9.0 - 0.02, 9.0 + 0.02] in [[round(a, 2), round(b, 2)] for a, b in Js['coverage']]
    print('people_audit selftest: OK (overlap de-duplicated, window clip, gaps, stills)')


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('scene', nargs='?')
    ap.add_argument('--from', dest='f', type=float)
    ap.add_argument('--to', dest='t', type=float)
    ap.add_argument('--stills', action='store_true', help='include the stills audit')
    ap.add_argument('--write', action='store_true', help='write out/.<scene>.people.merged.json')
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.scene:
        ap.error('scene required')
    win = (a.f, a.t) if a.f is not None and a.t is not None else None
    J = merged(a.scene, window=win, stills=a.stills or None)
    if J is None:
        sys.exit(f'no out/.{a.scene}.people*.json: render with the current render.mjs')
    if a.write:
        p = os.path.join(OUT, f'.{a.scene}.people.merged.json')
        json.dump(J, open(p, 'w'))
        print('wrote', os.path.relpath(p, VIDEOS))
    if a.json:
        json.dump(J, sys.stdout, indent=1)
        print()
    else:
        show(J, win or ((0.0, float(J['duration'])) if J.get('duration') else None))


if __name__ == '__main__':
    main()
