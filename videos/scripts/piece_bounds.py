#!/usr/bin/env python3
"""piece_bounds.py: where a piece really starts and ends, what its frame 0 must say, and a frame-0 reference for
clips that do not contain frame 0 (TOOLING c4, 2026-09-28).

    python3 videos/scripts/piece_bounds.py meltdown8            # end, closer, hook line, head reference
    python3 videos/scripts/piece_bounds.py --all                # every scene with a hits.json
    python3 videos/scripts/piece_bounds.py --selftest

Why: the song usually runs past the picture (the sonic logo's tail, reverb, a loop pad), so hits.json 'duration'
is not where the piece ends. The gate used it as the piece end, so a test clip that stopped at the real end
(closer beat + 1.4 s, the kit closer) never had its lockup, last second or loop seam checked (MELTDOWN v11: song
46.4 s, piece 45.4 s).

API (gate.py imports it):
    piece_end(scene, key=None, hits=None) -> {'end', 'closer_beat', 'closer_t', 'song_dur', 'source'}
        end = closer beat x 60/BPM + CLOSER_S, capped at the song length. The closer beat comes from
        web/audio/logo_at.json (the sonic logo's lock), else the script's 'closer_beat'. A script 'end_s' wins.
    hook_line(key) -> {'text', 'beat', 'strict'} | None
        the script line on beat 0 (what the thumbnail must read). strict = the script says so: 'hook_frame0': true,
        or its 'hook' note starts with 'Frame 0'.
    head_reference(scene, exclude=()) -> path | None
        the newest render that holds the piece's frame 0 and is newer than the scene's code: out/<scene>.mp4,
        out/<scene>_0-*.mp4, out/stills/<scene>_0.00.jpg.
    first_frame(path, w=270, h=480) -> uint8 array h x w x 3 (mp4 or image)
"""
import glob
import json
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.path.dirname(HERE)
ROOT = os.path.dirname(VIDEOS)
OUT = os.path.join(VIDEOS, 'out')
SCENES = os.path.join(VIDEOS, 'web', 'scenes')
LIB = os.path.join(VIDEOS, 'web', 'lib')
LOGO_AT = os.path.join(VIDEOS, 'web', 'audio', 'logo_at.json')
SCRIPTS = [os.path.join(ROOT, 'research', 'scripts_final'), os.path.join(ROOT, 'research', 'scripts_wip')]
CLOSER_S = 1.4          # lib/kit.js closer(): the lockup slams in and holds 1.4 s


def _json(p):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def script_for(key):
    """(dict, path) for a script key ('meltdown') or a JSON path, else (None, None)."""
    if not key:
        return None, None
    cands = [key] if str(key).endswith('.json') else [os.path.join(d, key + '.json') for d in SCRIPTS]
    for p in cands:
        d = _json(p)
        if isinstance(d, dict):
            return d, p
    return None, None


def default_key(scene):
    try:   # TOOLING WM1: exact name first (machines_e1, gary2036), then minus digits
        from script_key import script_key
        return script_key(scene or '', dirs=SCRIPTS) or ''
    except Exception:  # noqa: BLE001
        return re.sub(r'\d+$', '', scene or '')


def piece_end(scene, key=None, hits=None):
    hits = hits if hits is not None else (_json(os.path.join(OUT, f'.{scene}.hits.json')) or {})
    song = float(hits.get('duration') or 0) or None
    bpm = hits.get('bpm')
    d, _ = script_for(key or default_key(scene))
    d = d or {}
    bpm = bpm or d.get('bpm')
    res = {'end': song, 'closer_beat': None, 'closer_t': None, 'song_dur': song, 'source': 'song length (hits.json)'}
    if d.get('end_s'):
        res.update(end=float(d['end_s']), source="script 'end_s'")
        return res
    at, src = (_json(LOGO_AT) or {}).get(scene), 'logo_at.json'
    if at is None and d.get('closer_beat') is not None:
        at, src = d['closer_beat'], "script 'closer_beat'"
    if at is None or not bpm:
        if song is None:
            res['source'] = 'unknown (no hits.json: build the song)'
        return res
    ct = float(at) * 60.0 / float(bpm)
    end = ct + CLOSER_S
    if song:
        end = min(end, song)
    res.update(end=round(end, 3), closer_beat=float(at), closer_t=round(ct, 3),
               source=f'closer b{float(at):g} ({src}) + {CLOSER_S} s' + (' (capped at the song)' if song and ct + CLOSER_S > song else ''))
    return res


def hook_line(key):
    d, _ = script_for(key)
    if not d:
        return None
    ws = [w for w in d.get('words') or [] if isinstance(w, dict) and w.get('text') and w.get('beat') is not None]
    first = [w for w in ws if float(w['beat']) <= 0.05]
    if not first:
        return None
    strict = bool(d.get('hook_frame0')) or bool(re.match(r'\s*frame\s*0\b', str(d.get('hook') or ''), re.I))
    return {'text': first[0]['text'], 'beat': float(first[0]['beat']), 'strict': strict}


def _code_mtime(scene):
    """Newest mtime of the scene's html/js and its sibling modules (./x.js), one level."""
    fs = [p for p in (os.path.join(SCENES, scene + '.js'), os.path.join(SCENES, scene + '.html')) if os.path.exists(p)]
    try:
        src = open(os.path.join(SCENES, scene + '.js'), errors='replace').read()
        fs += [os.path.join(SCENES, m) for m in re.findall(r"from\s+'\./([\w.]+\.js)'", src)
               if os.path.exists(os.path.join(SCENES, m))]
    except OSError:
        pass
    return max((os.path.getmtime(p) for p in fs), default=0.0)


def head_reference(scene, exclude=()):
    """Newest render holding frame 0 of the piece, newer than the scene code; None when there is none."""
    ex = {os.path.abspath(p) for p in exclude}
    cands = [os.path.join(OUT, f'{scene}.mp4'), os.path.join(OUT, 'stills', f'{scene}_0.00.jpg')]
    cands += glob.glob(os.path.join(OUT, f'{scene}_0-*.mp4')) + glob.glob(os.path.join(OUT, f'{scene}_0.0-*.mp4'))
    code = _code_mtime(scene)
    ok = [p for p in cands if os.path.exists(p) and os.path.abspath(p) not in ex and os.path.getsize(p) > 5000
          and os.path.getmtime(p) >= code]
    return max(ok, key=os.path.getmtime) if ok else None


def _ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001
        return 'ffmpeg'


def first_frame(path, w=270, h=480):
    if path.lower().endswith(('.jpg', '.jpeg', '.png')):
        return np.asarray(Image.open(path).convert('RGB').resize((w, h), Image.BOX))
    r = subprocess.run([_ffmpeg(), '-hide_banner', '-loglevel', 'error', '-i', path, '-an', '-frames:v', '1',
                        '-vf', f'scale={w}:{h}:flags=area', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True)
    if len(r.stdout) < w * h * 3:
        raise RuntimeError(f'{path}: could not decode frame 0')
    return np.frombuffer(r.stdout[:w * h * 3], np.uint8).reshape(h, w, 3)


def describe(scene):
    e = piece_end(scene)
    hk = hook_line(default_key(scene))
    hd = head_reference(scene)
    end = f"{e['end']:.2f}s" if e['end'] else '?'
    song = f"{e['song_dur']:.2f}s" if e['song_dur'] else '?'
    return (f"{scene:<16} end {end:>7} (song {song}) from {e['source']}; hook "
            f"{repr(hk['text']) + (' [frame 0 strict]' if hk['strict'] else '') if hk else '-'}; "
            f"head ref {os.path.relpath(hd, VIDEOS) if hd else '-'}")


def selftest():
    import tempfile
    global OUT, LOGO_AT, SCRIPTS
    saved = OUT, LOGO_AT, SCRIPTS
    with tempfile.TemporaryDirectory() as tmp:
        OUT = os.path.join(tmp, 'out'); os.makedirs(OUT)
        sd = os.path.join(tmp, 'scripts'); os.makedirs(sd); SCRIPTS = [sd]
        LOGO_AT = os.path.join(tmp, 'logo_at.json')
        json.dump({'demo3': 110}, open(LOGO_AT, 'w'))
        json.dump({'bpm': 150, 'duration': 46.4}, open(os.path.join(OUT, '.demo3.hits.json'), 'w'))
        json.dump({'hook': 'Frame 0: THANK YOU', 'words': [{'beat': 0, 'text': 'THANK YOU, MONOPOLY.'},
                                                          {'beat': 4, 'text': 'EVERY PRICE.'}]}, open(os.path.join(sd, 'demo.json'), 'w'))
        e = piece_end('demo3')
        assert abs(e['end'] - 45.4) < 1e-6 and e['closer_beat'] == 110, e
        h = hook_line('demo')
        assert h == {'text': 'THANK YOU, MONOPOLY.', 'beat': 0.0, 'strict': True}, h
        # no closer declared -> the song length
        json.dump({'bpm': 120, 'duration': 30.0}, open(os.path.join(OUT, '.other.hits.json'), 'w'))
        assert piece_end('other')['end'] == 30.0
        # closer past the song -> capped
        json.dump({'demo3': 116}, open(LOGO_AT, 'w'))
        assert piece_end('demo3')['end'] == 46.4
        # script end_s wins
        json.dump({'end_s': 40.0, 'words': []}, open(os.path.join(sd, 'demo.json'), 'w'))
        assert piece_end('demo3')['end'] == 40.0
        # frame-0 reference from an image
        im = os.path.join(tmp, 'f.png'); Image.new('RGB', (1080, 1920), (200, 10, 10)).save(im)
        a = first_frame(im)
        assert a.shape == (480, 270, 3) and a[0, 0, 0] == 200
    OUT, LOGO_AT, SCRIPTS = saved
    print('piece_bounds selftest: ok (closer end 45.4 s, cap, end_s, strict hook, frame-0 decode)')


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
    elif a[0] == '--selftest':
        selftest()
    elif a[0] == '--all':
        for p in sorted(glob.glob(os.path.join(OUT, '.*.hits.json'))):
            s = os.path.basename(p)[1:-len('.hits.json')]
            if os.path.exists(os.path.join(SCENES, s + '.js')):
                print(describe(s))
    else:
        for s in a:
            print(describe(s))
