#!/usr/bin/env python3
"""NOT A FOOTNOTE v2 bake (5 Oct 2026): the film of October for the body of the piece, cut into 540x960 gray plates the scene inks onto the page.
   python3 videos/web/scenes/footnote.bake.py [shot ...] [--force]     -> videos/web/assets/footnote/plates/<shot>/0001.jpg ... + index.json

Sources (public domain in the United States: published 1928 and 1929, more than 95 years ago; the footage is never labelled in the piece):
  October (Ten Days that Shook the World), Sergei Eisenstein and Grigori Aleksandrov, 1928 (IA october1928, the 640x480 BBC transfer: no channel logo;
      its English subtitle lines sit only on the intertitle cards, which are never cut to)
  Turksib, Viktor Turin, 1929 (IA turksib-1929-by-viktor-alexandrovich-turin, 1440x1072)
The big files are never downloaded: horde3.rangeproxy.py serves one remote file on localhost with HTTP range reads and ffmpeg reads only the window.
"""
import json, os, subprocess, sys, time
import numpy as np
from PIL import Image
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(VID, 'web', 'assets', 'footnote', 'plates')
IA = 'https://archive.org/download/'
SRC = {
    'oct': (IA + 'october1928/BBC.October.Ten.Days.that.Shook.the.World.720p.HDTV.x264.AAC.MVGroup.Forum.mp4', 'mp4'),
    'tsib': (IA + 'turksib-1929-by-viktor-alexandrovich-turin/Turksib.1929.1080p.BluRay.x264-%5BYTS.LT%5D.mp4', 'mp4'),
}
PW, PH = 540, 960
# name: (source, t0 s, dur s, cx0, cx1 (fractions of source width: a pan), note)
SHOTS = {
    'oc_tsar':     ('oct', 59.6, 2.0, 0.50, 0.50, 'October: the Tsar Alexander III monument, the head'),
    'oc_steps':    ('oct', 92.8, 2.4, 0.50, 0.55, 'October: the people storming up the monument steps'),
    'oc_ladder':   ('oct', 104.0, 2.5, 0.45, 0.45, 'October: men on ladders on the monument'),
    'oc_ropes':    ('oct', 116.2, 2.5, 0.50, 0.50, 'October: the monument roped'),
    'oc_topple':   ('oct', 150.4, 3.0, 0.50, 0.50, 'October: the ropes pulled, the monument coming down'),
    'oc_raised':   ('oct', 161.1, 1.5, 0.50, 0.50, 'October: scythes and rifles raised'),
    'oc_banners':  ('oct', 647.5, 3.0, 0.50, 0.50, 'October: the July masses with their banners'),
    'oc_demo':     ('oct', 785.1, 3.0, 0.50, 0.50, 'October: the demonstration from above, banners'),
    'oc_demo2':    ('oct', 789.1, 3.0, 0.50, 0.50, 'October: the street packed with the demonstration'),
    'oc_chand':    ('oct', 5192.1, 1.4, 0.50, 0.50, 'October: a Winter Palace chandelier'),
    'oc_chand2':   ('oct', 5195.1, 1.4, 0.50, 0.50, 'October: the palace chandeliers'),
    'oc_aurora':   ('oct', 5240.0, 1.0, 0.45, 0.45, 'October: the cruiser on the Neva at dawn'),
    'oc_gun':      ('oct', 5242.5, 1.4, 0.50, 0.50, 'October: a sailor at the gun'),
    'oc_bourg':    ('oct', 5251.9, 2.2, 0.50, 0.50, 'October: the Committee for Saving the Motherland: the bourgeois faces'),
    'oc_mensh':    ('oct', 5315.3, 2.1, 0.50, 0.50, 'October: a Menshevik in pince-nez'),
    'oc_mensh2':   ('oct', 5319.0, 1.7, 0.50, 0.50, 'October: the Mensheviks'),
    'oc_storm':    ('oct', 5441.2, 2.0, 0.50, 0.50, 'October: the storming, the crowd under the lamps in smoke'),
    'oc_storm2':   ('oct', 5444.8, 3.0, 0.50, 0.50, 'October: the palace facade in smoke'),
    'oc_run':      ('oct', 5477.0, 1.9, 0.50, 0.50, 'October: the masses running in smoke'),
    'oc_gate':     ('oct', 5504.3, 2.0, 0.50, 0.50, 'October: the palace gate'),
    'oc_eagle':    ('oct', 5507.7, 1.4, 0.55, 0.55, 'October: the gate with its eagle against the sky'),
    'oc_through':  ('oct', 5521.0, 1.6, 0.50, 0.50, 'October: the masses pouring through the gate'),
    'oc_through2': ('oct', 5526.0, 1.7, 0.50, 0.50, 'October: the masses under the gate in smoke'),
    'oc_stairs':   ('oct', 5527.8, 2.6, 0.50, 0.50, 'October: the masses under the palace arches'),
    'oc_stairs2':  ('oct', 5539.3, 1.6, 0.50, 0.50, 'October: the masses on the palace stairs'),
    'oc_bayonets': ('oct', 5874.4, 3.0, 0.50, 0.50, 'October: the masses with their bayonets raised'),
    'oc_crowd':    ('oct', 5922.4, 3.0, 0.50, 0.50, 'October: the crowd at the declaration'),
    'oc_clock':    ('oct', 5933.4, 1.6, 0.50, 0.50, 'October: the clock of Petersburg'),
    'oc_clocks2':  ('oct', 5935.0, 1.5, 0.50, 0.50, 'October: the clocks of Petersburg and Moscow'),
    'oc_clocks':   ('oct', 5938.2, 2.2, 0.50, 0.50, 'October: the ring of clocks'),
    'oc_clockny':  ('oct', 5945.2, 1.4, 0.50, 0.50, 'October: the clock of New York'),
    'oc_clockp':   ('oct', 5947.9, 1.2, 0.50, 0.50, 'October: the clock of Paris'),
}
TSIB = {   # Turksib: the railway built across the steppe (the modernization the last line names)
    'ts_sleepers': ('tsib', 2888.5, 2.0, 0.50, 0.50, 'Turksib: sleepers laid across the steppe to the horizon'),
    'ts_dig':      ('tsib', 2915.0, 2.0, 0.50, 0.50, 'Turksib: men breaking the slope with picks'),
    'ts_masses':   ('tsib', 2939.2, 2.6, 0.50, 0.50, 'Turksib: the workers across the land, digging'),
    'ts_shovel':   ('tsib', 2994.2, 2.0, 0.50, 0.50, 'Turksib: the steam shovel'),
    'ts_excav':    ('tsib', 3104.3, 2.0, 0.40, 0.40, 'Turksib: the excavator and the train in steam'),
    'ts_loco':     ('tsib', 3120.0, 2.0, 0.55, 0.55, 'Turksib: the locomotive and its cars on the new grade'),
    'ts_bridge':   ('tsib', 3844.2, 2.5, 0.50, 0.50, 'Turksib: the bridge going up'),
    'ts_girder':   ('tsib', 3854.2, 2.0, 0.50, 0.50, 'Turksib: the bridge girders'),
    'ts_wheels':   ('tsib', 3934.2, 1.6, 0.50, 0.50, 'Turksib: the wheels from below'),
    'ts_rivets':   ('tsib', 3944.2, 2.0, 0.50, 0.50, 'Turksib: the rivets on the steel'),
    'ts_line':     ('tsib', 3970.2, 2.0, 0.50, 0.50, 'Turksib: the line of workers'),
    'ts_drive':    ('tsib', 4599.0, 1.5, 0.50, 0.50, 'Turksib: the driving wheels at speed'),
    'ts_smoke':    ('tsib', 4636.2, 2.0, 0.50, 0.50, 'Turksib: the locomotive head-on in its smoke'),
}
SHOTS.update(TSIB)


def proxy(src):
    url, ext = SRC[src]; port = 8790 + (abs(hash(src)) % 40)
    p = subprocess.Popen([sys.executable, os.path.join(HERE, 'horde3.rangeproxy.py'), url, str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(3)
    return p, 'http://127.0.0.1:%d/f.%s' % (port, ext)


def size_of(url):
    r = subprocess.run([FF, '-hide_banner', '-i', url], capture_output=True, text=True).stderr
    import re
    return tuple(map(int, re.search(r', (\d{3,4})x(\d{3,4})', r.split('Video:')[1]).groups()))


def bake(name, url, sw, sh, force=False):
    src, t0, dur, cx0, cx1, note = SHOTS[name]
    d = os.path.join(OUT, name)
    if os.path.exists(os.path.join(d, 'done')) and not force:
        return len([x for x in os.listdir(d) if x.endswith('.jpg')])
    os.makedirs(d, exist_ok=True)
    for x in os.listdir(d): os.remove(os.path.join(d, x))
    ch = sh - 8; cw = int(round(ch * 9 / 16))
    xs = lambda c: min(max(0, c * sw - cw / 2), sw - cw)
    x_expr = "%f+(%f)*t/%f" % (xs(cx0), xs(cx1) - xs(cx0), dur)
    vf = "crop=w=%d:h=%d:x='%s':y=4:exact=1,scale=%d:%d:flags=lanczos,format=gray,fps=24" % (cw, ch, x_expr, PW, PH)
    raw = subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-ss', str(t0), '-t', str(dur), '-i', url, '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], capture_output=True).stdout
    n = len(raw) // (PW * PH)
    for i in range(n):
        im = np.frombuffer(raw, np.uint8, PW * PH, i * PW * PH).reshape(PH, PW)
        Image.fromarray(im, 'L').save(os.path.join(d, '%04d.jpg' % (i + 1)), quality=88)
    open(os.path.join(d, 'done'), 'w').write(note)
    return n


if __name__ == '__main__':
    force = '--force' in sys.argv
    names = [a for a in sys.argv[1:] if not a.startswith('--')] or list(SHOTS)
    os.makedirs(OUT, exist_ok=True)
    res = {}
    for src in sorted({SHOTS[n][0] for n in names}):
        p, url = proxy(src)
        try:
            sw, sh = size_of(url)
            for n in names:
                if SHOTS[n][0] == src:
                    res[n] = bake(n, url, sw, sh, force); print(n, res[n], flush=True)
        finally:
            p.terminate()
    ip = os.path.join(OUT, 'index.json')
    idx = json.load(open(ip)) if os.path.exists(ip) else {}
    for k in names:
        idx[k] = {'n': res[k], 'fps': 24, 'note': SHOTS[k][-1]}
    json.dump(idx, open(ip, 'w'), indent=1)
