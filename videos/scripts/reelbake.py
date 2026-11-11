#!/usr/bin/env python3
"""REELBAKE (7 Oct 2026): the studio's one footage-plate baker. A piece declares a shot list; this cuts each shot as a portrait window into
numbered JPEG plates the scene plays back with lib/fx/reel.js.

    python3 videos/scripts/reelbake.py videos/web/assets/<piece>/reel.json [shot ...] [--force]
      -> videos/web/assets/<piece>/plates/<shot>/0001.jpg ... + plates/index.json

reel.json:
  { "size": [540, 960], "fps": 24, "color": true,
    "sources": { "steel": { "url": "https://archive.org/download/...mp4" },          # remote: read through the range proxy, only the window
                 "mh4":   { "path": "videos/sources/footage/MasterHa1936_4.mp4" } },   # local (repo-relative)
    "shots": { "pit": { "src": "steel", "t0": 67.0, "dur": 3.0, "cx0": 0.5, "cx1": 0.55, "note": "...",
                        "color": true, "reverse": false, "cy": 0.5, "zoom": 1.0, "box": [x0, x1] } } }
  cx0 -> cx1 pans the window across the source (fractions of the usable width); zoom > 1 crops tighter; box limits the usable width (a
  pillarboxed 4:3 inside 16:9, e.g. [0.125, 0.875]).
Grew out of horde3.bake.py, footnote.bake.py and flint.bake.py, which each carried a copy of this; new pieces use this instead.
"""
import json, os, re, subprocess, sys, time
import numpy as np
from PIL import Image

FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PROXY = os.path.join(REPO, 'videos', 'web', 'scenes', 'horde3.rangeproxy.py')


def open_source(spec, port):
    """-> (input url/path, cleanup)"""
    if 'path' in spec:
        return os.path.join(REPO, spec['path']), (lambda: None)
    ext = spec.get('ext', 'mp4')
    p = subprocess.Popen([sys.executable, PROXY, spec['url'], str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(3)
    return 'http://127.0.0.1:%d/f.%s' % (port, ext), p.terminate


def size_of(inp):
    r = subprocess.run([FF, '-hide_banner', '-i', inp], capture_output=True, text=True).stderr
    return tuple(map(int, re.search(r', (\d{3,4})x(\d{3,4})', r.split('Video:')[1]).groups()))


def bake(name, shot, inp, sw, sh, out, size, fps, color_default, force=False):
    d = os.path.join(out, name)
    if os.path.exists(os.path.join(d, 'done')) and not force:
        return len([x for x in os.listdir(d) if x.endswith('.jpg')])
    os.makedirs(d, exist_ok=True)
    for x in os.listdir(d):
        os.remove(os.path.join(d, x))
    PW, PH = shot.get('size', size)                            # a shot may carry its own plate size (a landscape window in a portrait piece)
    color = shot.get('color', color_default)
    bx0, bx1 = shot.get('box', [0.0, 1.0])
    ux0, uw = bx0 * sw, (bx1 - bx0) * sw                      # the usable width (inside any pillarbox)
    z = shot.get('zoom', 1.0)
    ch = min(sh - 8, uw * PH / PW) / z
    cw = ch * PW / PH
    xs = lambda c: min(max(ux0, ux0 + c * uw - cw / 2), ux0 + uw - cw)
    cy = shot.get('cy', 0.5); y0 = min(max(0, cy * sh - ch / 2), sh - ch)
    dur = shot['dur']
    x_expr = "%f+(%f)*t/%f" % (xs(shot.get('cx0', 0.5)), xs(shot.get('cx1', shot.get('cx0', 0.5))) - xs(shot.get('cx0', 0.5)), dur)
    pix = 'rgb24' if color else 'gray'
    vf = "crop=w=%d:h=%d:x='%s':y=%d:exact=1,scale=%d:%d:flags=lanczos,format=%s,fps=%d" % (cw, ch, x_expr, y0, PW, PH, pix, fps)
    if shot.get('reverse'):
        vf += ',reverse'
    raw = subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-ss', str(shot['t0']), '-t', str(dur), '-i', inp, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', pix, '-'],
                         capture_output=True).stdout
    nb = PW * PH * (3 if color else 1)
    n = len(raw) // nb
    for i in range(n):
        a = np.frombuffer(raw, np.uint8, nb, i * nb).reshape((PH, PW, 3) if color else (PH, PW))
        Image.fromarray(a, 'RGB' if color else 'L').save(os.path.join(d, '%04d.jpg' % (i + 1)), quality=int(os.environ.get("REEL_Q", "86")))
    open(os.path.join(d, 'done'), 'w').write(shot.get('note', ''))
    return n


def main(argv):
    force = '--force' in argv
    args = [a for a in argv if not a.startswith('--')]
    cfg_path = os.path.abspath(args[0]); cfg = json.load(open(cfg_path))
    out = os.path.join(os.path.dirname(cfg_path), 'plates')
    names = args[1:] or list(cfg['shots'])
    size, fps, color = tuple(cfg.get('size', [540, 960])), cfg.get('fps', 24), cfg.get('color', False)
    os.makedirs(out, exist_ok=True)
    ip = os.path.join(out, 'index.json')
    idx = json.load(open(ip)) if os.path.exists(ip) else {}
    for k, src in enumerate(sorted({cfg['shots'][n]['src'] for n in names})):
        inp, close = open_source(cfg['sources'][src], 8840 + k)
        try:
            sw, sh = size_of(inp)
            for n in names:
                s = cfg['shots'][n]
                if s['src'] != src:
                    continue
                c = bake(n, s, inp, sw, sh, out, size, fps, color, force)
                idx[n] = {'n': c, 'fps': fps, 'color': s.get('color', color), 'size': list(s.get('size', size)), 'note': s.get('note', '')}
                print(n, c, flush=True)
                json.dump(idx, open(ip, 'w'), indent=1)
        finally:
            close()


if __name__ == '__main__':
    main(sys.argv[1:])
