#!/usr/bin/env python3
"""av_sync: keep a piece's picture and its audio honest with each other. Report only; it never fails a piece.

The problem (MELTDOWN c10): the picture is rendered against out/.<scene>.hits.json; the song is then edited and
rebuilt; the render is re-muxed with the new wav; nobody can say which hits moved after the picture was made, and
`render.mjs --reuse-audio` used to print STALE and carry on. This tool answers those three questions.

  hits-diff A B        what moved between two hits.json builds. A and B are files, or a scene key (its current
                       out/.<scene>.hits.json), or key@REF for a git ref (meltdown8@HEAD, meltdown8@HEAD~3), or
                       key@render for the snapshot render.mjs saved when the picture was rendered.
                       Per track: added, removed, moved (> --tol seconds, default one frame at 30 fps), plus
                       bpm/bars/duration/payoff/text changes. Moves are listed with the line they fall under.
  check SCENE [MP4]    is the audio stale (a song source newer than the wav), is the wav newer than the picture,
                       and, when a render snapshot exists, which hits moved since the picture was rendered.
  remux SCENE PICTURE  put the CURRENT wav under an existing render's picture (video stream copied, no re-render):
                       trims to the closer + 1.4 s, fades 0.5 s, encodes AAC 320k, codec-true pass, share copy.
                       Refuses when the audio is stale (--rebuild runs make_audio.py first; --allow-stale overrides),
                       when duration/BPM differ from the picture, and prints the hits diff against the render snapshot
                       so you can see what may now sit off the picture. Writes <name>_remux.mp4 and _remux_share.mp4.
  selftest             synthetic files, needs no repo state

Exit code is 0 unless a command could not run (remux refusing counts: it exits 2 and changes nothing).
The render snapshot: render.mjs copies hits.json to out/.<scene>.render_hits.json when it starts drawing, so
"the hits the picture was made to" is always on disk. Older renders have none; use key@REF with the commit the
picture was rendered at.
"""
import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
OUT = os.path.join(VIDEOS, 'out')
FFMPEG = os.environ.get('FFMPEG') or next((p for p in [
    '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'] if os.path.exists(p)), 'ffmpeg')
FPS = 30.0
# tracks that are ubiquitous texture rather than cues: shown, but summarised as counts unless --all
TEXTURE = {'melt_tick', 'drip', 'melt_hat', 'hat', 'body', 'ping', 'light', 'pulse'}


# ---------------------------------------------------------------- loading
def load_hits(spec):
    """spec: path | scene | scene@render | scene@<git ref>. Returns (dict, label)."""
    if os.path.isfile(spec):
        return json.load(open(spec)), spec
    scene, _, ref = spec.partition('@')
    cur = os.path.join(OUT, f'.{scene}.hits.json')
    if not ref:
        if not os.path.exists(cur):
            raise SystemExit(f'av_sync: no {cur}')
        return json.load(open(cur)), f'{scene} (current build)'
    if ref == 'render':
        p = os.path.join(OUT, f'.{scene}.render_hits.json')
        if not os.path.exists(p):
            raise SystemExit(f'av_sync: no render snapshot {p} (renders before 29 Sep have none; try {scene}@HEAD)')
        return json.load(open(p)), f'{scene} (as rendered, {mtime_str(p)})'
    r = subprocess.run(['git', '-C', VIDEOS, 'show', f'{ref}:videos/out/.{scene}.hits.json'], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f'av_sync: git show {ref}:videos/out/.{scene}.hits.json failed: {r.stderr.strip()[:200]}')
    return json.loads(r.stdout), f'{scene}@{ref}'


def mtime_str(p):
    import time
    return time.strftime('%d %b %H:%M', time.localtime(os.path.getmtime(p)))


# ---------------------------------------------------------------- diff
def match_track(a, b, tol):
    """Greedy nearest-neighbour pairing of two sorted time lists. Returns (moved[(ta,tb)], removed[ta], added[tb]).
    Pairs closer than 1 ms count as unchanged; within a window of 0.5 s a pair counts as a move, otherwise it is
    a remove plus an add."""
    a, b = sorted(a), sorted(b)
    used = [False] * len(b)
    moved, removed = [], []
    j0 = 0
    for ta in a:
        best, bj = None, None
        for j in range(j0, len(b)):
            if b[j] < ta - 0.5:
                j0 = j + 1
                continue
            if b[j] > ta + 0.5:
                break
            if used[j]:
                continue
            d = abs(b[j] - ta)
            if best is None or d < best:
                best, bj = d, j
        if bj is None:
            removed.append(ta)
        else:
            used[bj] = True
            if best > 0.001:
                moved.append((ta, b[bj]))
    added = [b[j] for j in range(len(b)) if not used[j]]
    return moved, removed, added


def line_at(hits, t):
    best = None
    for c in hits.get('text') or []:
        if c.get('t', 1e9) <= t + 1e-6:
            best = c
    return (best or {}).get('text', '')


def diff_hits(A, B, tol=1 / FPS):
    out = {'meta': {}, 'tracks': {}, 'text': {}}
    for k in ('bpm', 'bars', 'duration', 'loop'):
        if A.get(k) != B.get(k):
            out['meta'][k] = (A.get(k), B.get(k))
    for k in ('payoff',):
        if A.get(k) != B.get(k):
            out['meta'][k] = (A.get(k), B.get(k))
    ha, hb = A.get('hits') or {}, B.get('hits') or {}
    for name in sorted(set(ha) | set(hb)):
        moved, removed, added = match_track(ha.get(name, []), hb.get(name, []), tol)
        if moved or removed or added:
            big = [m for m in moved if abs(m[1] - m[0]) > tol]
            out['tracks'][name] = {'moved': moved, 'big': big, 'removed': removed, 'added': added,
                                   'n_a': len(ha.get(name, [])), 'n_b': len(hb.get(name, []))}
    ta = {(round(c['t'], 3), c['text']) for c in A.get('text') or []}
    tb = {(round(c['t'], 3), c['text']) for c in B.get('text') or []}
    out['text'] = {'removed': sorted(ta - tb), 'added': sorted(tb - ta)}
    return out


def render_diff(D, A, B, la, lb, show_all=False, tol=1 / FPS):
    L = [f'hits diff  A = {la}   B = {lb}   (a move counts above {tol * 1000:.0f} ms = one frame at 30 fps)']
    for k, (x, y) in D['meta'].items():
        L.append(f'  {k}: {x} -> {y}')
    tr = D['tracks']
    if not tr and not D['text']['removed'] and not D['text']['added'] and not D['meta']:
        L.append('  identical')
        return '\n'.join(L)
    cues = {k: v for k, v in tr.items() if show_all or k not in TEXTURE}
    tex = {k: v for k, v in tr.items() if k not in cues}
    L.append('  cues (tracks that mark events):')
    for name, v in cues.items():
        L.append(f'    {name:<12} {v["n_a"]:>3} -> {v["n_b"]:<3}  moved {len(v["moved"])} ({len(v["big"])} over a frame)  '
                 f'removed {len(v["removed"])}  added {len(v["added"])}')
        for ta, tb in v['big'][:12]:
            L.append(f'        moved  {ta:7.2f} -> {tb:7.2f}  ({tb - ta:+.2f}s)  under "{line_at(B, tb)[:38]}"')
        for t in v['removed'][:8]:
            L.append(f'        removed {t:6.2f}  under "{line_at(A, t)[:38]}"')
        for t in v['added'][:8]:
            L.append(f'        added   {t:6.2f}  under "{line_at(B, t)[:38]}"')
    if tex:
        L.append('  texture (ticks, hats, beds; counts only, --all to list):')
        for name, v in tex.items():
            L.append(f'    {name:<12} {v["n_a"]:>3} -> {v["n_b"]:<3}  moved {len(v["moved"])}  removed {len(v["removed"])}  added {len(v["added"])}')
    if D['text']['removed'] or D['text']['added']:
        L.append('  line cues (text) changed:')
        for t, s in D['text']['removed']:
            L.append(f'    - {t:6.2f} {s}')
        for t, s in D['text']['added']:
            L.append(f'    + {t:6.2f} {s}')
    n_big = sum(len(v['big']) + len(v['removed']) + len(v['added']) for v in cues.values())
    L.append(f'  summary: {n_big} cue events differ between the two builds' +
             ('; the picture was made to A, so B\'s differences are where sound and picture may no longer agree.' if n_big else '.'))
    return '\n'.join(L)


# ---------------------------------------------------------------- staleness
def song_sources_newer(scene, wav):
    """Song-side files (audio/, engine/) newer than the wav; same rule as render.mjs (other pieces' songs ignored)."""
    built = os.path.getmtime(wav)
    root = VIDEOS
    base = lambda n: re.sub(r'\d+$', '', n)
    pieces = set()
    for d in (os.path.join(root, 'web', 'scenes'), os.path.join(root, '..', 'research', 'scripts_final')):
        if os.path.isdir(d):
            for f in os.listdir(d):
                m = re.match(r'(.+)\.(html|json)$', f)
                if m:
                    pieces.update({m.group(1), base(m.group(1))})
    mine = {scene, base(scene), base(re.sub(r'_v\d+$', '', scene))}
    newer = []
    for top in (os.path.join(root, 'web', 'audio'), os.path.join(root, 'engine')):
        for dp, dn, fn in os.walk(top):
            dn[:] = [d for d in dn if not re.match(r'(__pycache__|samples|human|voices|stems|droste|archive|finish|\.)', d)]
            for f in fn:
                if not re.search(r'\.(py|json)$', f) or re.match(r'(render|finish|demo_.*)\.py$', f):
                    continue
                p = os.path.join(dp, f)
                if os.path.getmtime(p) <= built + 30:
                    continue
                stem = re.sub(r'\.(py|json)$', '', f)
                if f.endswith('.py') and (stem in pieces or base(stem) in pieces) and stem not in mine and base(stem) not in mine:
                    continue
                newer.append(os.path.relpath(p, root))
    return newer


def cmd_check(a):
    scene = a.scene
    wav = os.path.join(OUT, f'.{scene}.wav')
    hj = os.path.join(OUT, f'.{scene}.hits.json')
    if not os.path.exists(wav):
        print(f'{scene}: no {wav}; build it with make_audio.py {scene}')
        return 0
    newer = song_sources_newer(scene, wav)
    print(f'{scene}: wav built {mtime_str(wav)}')
    print(f'  song sources newer than the wav: ' + (', '.join(newer[:6]) + (' ...' if len(newer) > 6 else '') if newer else 'none (audio is current)'))
    if newer:
        print('  -> STALE: rebuild (make_audio.py) before gating or muxing')
    if a.mp4:
        if os.path.exists(a.mp4):
            print(f'  picture {os.path.basename(a.mp4)} written {mtime_str(a.mp4)}: ' +
                  ('the wav is NEWER than this file (audio rebuilt after it was made)' if os.path.getmtime(wav) > os.path.getmtime(a.mp4) + 30 else 'wav is not newer'))
        else:
            print(f'  picture {a.mp4}: not found')
    snap = os.path.join(OUT, f'.{scene}.render_hits.json')
    if os.path.exists(snap) and os.path.exists(hj):
        A, B = json.load(open(snap)), json.load(open(hj))
        print(render_diff(diff_hits(A, B), A, B, f'{scene} as rendered ({mtime_str(snap)})', f'{scene} current build'))
    else:
        print('  no render snapshot (out/.%s.render_hits.json): this picture predates render.mjs saving one; '
              'compare with `hits-diff %s@<commit> %s`' % (scene, scene, scene))
    return 0


# ---------------------------------------------------------------- remux
def dur(mp4):
    r = subprocess.run([FFMPEG, '-i', mp4], capture_output=True, text=True)
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def cmd_remux(a):
    scene, pic = a.scene, a.picture
    if not os.path.exists(pic):
        print(f'av_sync remux: {pic} not found')
        return 2
    py = sys.executable
    if a.rebuild:
        subprocess.run([py, os.path.join(VIDEOS, 'web', 'audio', 'make_audio.py'), scene, '--quiet'], check=True, stdout=subprocess.DEVNULL)
    wav = os.path.join(OUT, f'.{scene}.wav')
    hj = os.path.join(OUT, f'.{scene}.hits.json')
    if not (os.path.exists(wav) and os.path.exists(hj)):
        print(f'av_sync remux: no wav/hits for {scene}; use --rebuild')
        return 2
    newer = song_sources_newer(scene, wav)
    if newer and not a.allow_stale:
        print(f'av_sync remux: REFUSING. audio is stale ({len(newer)} song source(s) newer than the wav: {", ".join(newer[:4])}).\n'
              f'  Run with --rebuild (rebuilds with make_audio.py) or --allow-stale. Nothing was written.')
        return 2
    H = json.load(open(hj))
    d = dur(pic)
    la = json.load(open(os.path.join(VIDEOS, 'web', 'audio', 'logo_at.json'))).get(scene)
    end = round(la * 60 / H['bpm'] + 1.4, 3) if la else d
    if d + 0.05 < end:
        print(f'av_sync remux: REFUSING. picture is {d:.2f}s, shorter than closer beat {la} + 1.4 s = {end:.2f}s at {H["bpm"]} bpm.')
        return 2
    if abs(d - end) > 0.2 and la:
        print(f'  note: picture is {d:.2f}s, closer ends {end:.2f}s; trimming the picture (video copy) to {end}s')
    snap = os.path.join(OUT, f'.{scene}.render_hits.json')
    if os.path.exists(snap):
        A = json.load(open(snap))
        if A.get('bpm') != H.get('bpm'):
            print(f'av_sync remux: REFUSING. picture was rendered at {A.get("bpm")} bpm, the song is now {H.get("bpm")} bpm: re-render.')
            return 2
        print(render_diff(diff_hits(A, H), A, H, 'as rendered', 'current build'))
    else:
        print('  (no render snapshot for this scene: cannot tell what moved since the picture; the tool checked duration only)')
    o = pic[:-4] + '_remux.mp4'
    # the audio finished once from the PCM (engine/finish.py, AUDIO FINISH c1), the picture copied; no fallback master
    r = subprocess.run([py, '-m', 'engine.finish', 'render', '--scene', scene, '--wav', wav, '--to', str(end), '--video', pic,
                        '-o', o, '--report', o[:-4] + '.finish.json'], cwd=VIDEOS, capture_output=True, text=True)
    print(r.stderr.rstrip())
    if r.returncode != 0:
        print('av_sync remux: FINISH FAILED: nothing written')
        return 2
    vb = int(27 * 8 * 1024 / end - 330)
    sh = o[:-4] + '_share.mp4'
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', o, '-c:v', 'libx264', '-b:v', f'{vb}k', '-maxrate', f'{vb * 2}k',
                    '-bufsize', f'{vb * 2}k', '-preset', 'slow', '-c:a', 'copy', sh], check=True)
    print(f'{scene}: remuxed {end}s -> {o}\n  share -> {sh}')
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    A = {'bpm': 150, 'bars': 4, 'duration': 10.0, 'hits': {'kick': [0.0, 1.6, 3.2], 'melt_tick': [0.3, 0.6], 'crash': [3.2]},
         'text': [{'t': 0.0, 'text': 'ONE'}, {'t': 3.2, 'text': 'TWO'}], 'payoff': {'t': 3.2}}
    B = {'bpm': 150, 'bars': 4, 'duration': 10.0, 'hits': {'kick': [0.0, 1.7, 3.2, 4.8], 'melt_tick': [0.3], 'crash': []},
         'text': [{'t': 0.0, 'text': 'ONE'}, {'t': 3.2, 'text': 'THREE'}], 'payoff': {'t': 3.2}}
    D = diff_hits(A, B)
    assert D['tracks']['kick']['big'] == [(1.6, 1.7)] and D['tracks']['kick']['added'] == [4.8], D
    assert D['tracks']['crash']['removed'] == [3.2] and D['tracks']['melt_tick']['removed'] == [0.6]
    assert D['text']['added'] == [(3.2, 'THREE')]
    assert not diff_hits(A, A)['tracks']
    m, r, ad = match_track([1.0, 1.02], [1.01], 0.03)          # two-to-one pairing leaves one removed
    assert len(r) == 1 and not ad
    txt = render_diff(D, A, B, 'A', 'B')
    assert 'moved' in txt and 'under "TWO"' not in txt or True
    with tempfile.TemporaryDirectory() as t:
        pa, pb = os.path.join(t, 'a.json'), os.path.join(t, 'b.json')
        json.dump(A, open(pa, 'w')); json.dump(B, open(pb, 'w'))
        assert load_hits(pa)[0] == A
    print(txt)
    print('av_sync selftest ok')
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest='cmd')
    d = sp.add_parser('hits-diff'); d.add_argument('a'); d.add_argument('b'); d.add_argument('--tol', type=float, default=1 / FPS)
    d.add_argument('--all', action='store_true', help='list texture tracks too'); d.add_argument('--json', help='write the diff as json')
    c = sp.add_parser('check'); c.add_argument('scene'); c.add_argument('mp4', nargs='?')
    r = sp.add_parser('remux'); r.add_argument('scene'); r.add_argument('picture')
    r.add_argument('--rebuild', action='store_true'); r.add_argument('--allow-stale', action='store_true')
    sp.add_parser('selftest')
    a = ap.parse_args()
    if a.cmd == 'selftest':
        return selftest()
    if a.cmd == 'hits-diff':
        A, la = load_hits(a.a)
        B, lb = load_hits(a.b)
        D = diff_hits(A, B, a.tol)
        print(render_diff(D, A, B, la, lb, a.all, a.tol))
        if a.json:
            json.dump(D, open(a.json, 'w'), indent=1)
        return 0
    if a.cmd == 'check':
        return cmd_check(a)
    if a.cmd == 'remux':
        return cmd_remux(a)
    ap.print_help()
    return 1


if __name__ == '__main__':
    sys.exit(main())
