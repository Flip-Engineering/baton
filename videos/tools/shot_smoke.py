#!/usr/bin/env python3
"""One still per declared shot, before a full render (TOOLING c37; REJUVENATION v6 lost 22 min to a render that died at
frame 450 on a missing import, and BANK v8 took 78 min per full render).

    python3 videos/tools/shot_smoke.py SCENE [--at mid|start|end|0.5] [--extra 0,1.5] [--out DIR] [--dry]
Reads the scene's declared shots (scripts/shot_table.py: SHOTS table, or "cuts" in scripts_final), picks one beat inside
each shot (default: 60% of the way through, so a reveal has started and a cut has not come), and renders exactly those frames
with render.mjs --beats --out DIR --sheet DIR/smoke.jpg.  A missing import, a texture that never loaded, a shot that throws,
a black frame: they all show here in minutes, one Chrome, no encode.  Afterwards it reports any still that is nearly black
(mean luma < 6) or nearly flat (std < 3), which is how a dead shot looks.
  --at       start / mid / end of each shot, or a fraction 0-1 (default 0.6)
  --extra    more beats to add (the last frame is always added: end of piece minus 1 beat's tenth)
  --out      default videos/out/smoke_SCENE (delete it when done; 20-40 JPEGs, a few MB)
  --dry      print the beats and the command, render nothing
Needs the song's wav for render.mjs; it passes --reuse-audio when out/.SCENE.wav exists (build it with make_audio.py first
otherwise; render.mjs does that by itself without the flag).  Takes a stills lane, not a heavy one (<= 24 frames); over 24 beats
the list is thinned evenly to 24 so the smoke test never queues as a full render (--all to keep all).
No scene is changed. Exit 1 if a page error or a dead still is found.
"""
import argparse, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(VIDEOS, 'scripts'))


def pick(cuts_b, end_b, at):
    f = {'start': 0.02, 'mid': 0.5, 'end': 0.95}.get(at)
    f = float(at) if f is None else f
    edges = sorted(set([0.0] + [c for c in cuts_b if 0 < c < end_b])) + [end_b]
    return [round(a + (b - a) * f, 3) for a, b in zip(edges, edges[1:]) if b - a > 0.02]


def thin(bs, n=24):
    if len(bs) <= n:
        return bs
    return [bs[round(i * (len(bs) - 1) / (n - 1))] for i in range(n)]


def selftest():
    p = pick([2, 4, 4.01], 8, 0.5)
    assert p == [1.0, 3.0, 6.005], p
    assert len(thin(list(range(100)))) == 24 and thin([1, 2]) == [1, 2]
    print('selftest ok')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('scene', nargs='?'); ap.add_argument('--at', default='0.6')
    ap.add_argument('--extra', default=''); ap.add_argument('--out'); ap.add_argument('--dry', action='store_true')
    ap.add_argument('--all', action='store_true'); ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.scene:
        ap.error('SCENE needed')
    import shot_table
    hits = os.path.join(VIDEOS, 'out', f'.{a.scene}.hits.json')
    bpm = json.load(open(hits))['bpm'] if os.path.exists(hits) else None
    d = shot_table.declared(a.scene, spb=60 / bpm if bpm else 60 / 120)
    if not d:
        sys.exit(f'{a.scene}: the piece declares no shots (no SHOTS table, no "cuts" in scripts_final); use render.mjs --beats by hand')
    if not bpm:
        print('no out/.%s.hits.json yet: assuming 120 bpm only for the beat list; run make_audio.py for true beats' % a.scene)
        bpm = 120
    spb = 60 / bpm
    cuts_b = [c / spb for c in d['cuts_s']]
    dur = json.load(open(hits)).get('duration') if os.path.exists(hits) else None
    end_b = (dur / spb) if dur else (max(cuts_b) + 4 if cuts_b else 16)
    beats = pick(cuts_b, end_b, a.at)
    beats += [float(x) for x in a.extra.split(',') if x.strip()]
    beats.append(round(end_b - 0.1, 3))
    beats = sorted(set(beats))
    if not a.all:
        beats = thin(beats)
    out = a.out or os.path.join('out', f'smoke_{a.scene}')
    cmd = ['node', 'web/render.mjs', a.scene, '--beats', ','.join(f'{b:g}' for b in beats), '--out', out, '--sheet', os.path.join(out, 'smoke.jpg')]
    if os.path.exists(os.path.join(VIDEOS, 'out', f'.{a.scene}.wav')):
        cmd.append('--reuse-audio')
    print(f'{a.scene}: {len(cuts_b)} cuts ({d["source"]}), {len(beats)} frames: {beats}')
    print(' '.join(cmd))
    if a.dry:
        return
    r = subprocess.run(cmd, cwd=VIDEOS, capture_output=True, text=True)
    tail = (r.stdout + r.stderr).strip().splitlines()
    print('\n'.join(tail[-12:]))
    bad = r.returncode != 0 or any('pageerror' in l.lower() for l in tail)
    try:
        import numpy as np
        from PIL import Image
        sd = os.path.join(VIDEOS, out)
        for f in sorted(os.listdir(sd)):
            if f.endswith('.jpg') and f != 'smoke.jpg':
                g = np.asarray(Image.open(os.path.join(sd, f)).convert('L').resize((135, 240)), float)
                if g.mean() < 6 or g.std() < 3:
                    print(f'DEAD still {f}: mean {g.mean():.1f} std {g.std():.1f}'); bad = True
    except Exception as e:
        print('still check skipped:', e)
    print(f'sheet: {os.path.join(VIDEOS, out, "smoke.jpg")}  (delete {os.path.join(VIDEOS, out)} when done)')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
