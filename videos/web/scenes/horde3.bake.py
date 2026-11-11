#!/usr/bin/env python3
"""HORDE c15 bake: cut the found-film shots into 540x960 single-channel plates (gray JPEG, 24 fps) the scene grades itself.
   python3 videos/web/scenes/horde3.bake.py [shot ...] [--force] [--keep]     -> videos/out/.horde_c15/<shot>/0001.jpg ... + index.json   (gitignored)
Each shot is a 9:16 window (centre x pan cx0->cx1 and width cw, in source pixels; ytop may be negative = sky made up above the picture).

Sources (all public domain on the Internet Archive; the footage is never labelled in the piece):
  The Iron Horse (1924, John Ford; IA the-iron-horse-1924-1080p, original 1508x1080)       -> ih_*
  Tumbleweeds (1925, William S. Hart; IA tumbleweeds-1925, original 964x720)                 -> tw_*
  The Plow That Broke the Plains (1936; frames baked by the c9 pass into videos/out/.horde_c9, 640x480)  -> pl_*  (python3 videos/web/scenes/horde3.bake.py can not
        rebuild those: they come from IA 0315_Plow_that_Broke_the_Plains_The_16_38_41_28 at 12:09 tract, 11:17 plowdust, 14:37 combE, 15:20 combL, 24 fps)
The big originals are never downloaded: horde3.rangeproxy.py serves one remote file on localhost with HTTP range reads, so the static ffmpeg (which crashes on https) can
seek in it and read only the bytes of a window (a 30 s window of the 2.5 GB Iron Horse is about 70 MB at CRF 17). Windows are cached in videos/out/.horde_c15/_src and
deleted after the bake unless --keep. Wide shots only, no costume or vehicle that dates a particular event reads in them (checked frame by frame).
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image
FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(VID, 'web', 'assets', 'horde', 'plates'); WORK = os.path.join(VID, 'out', '.horde_c15', '_src')   # c22: plates live in the repo so the farm can render (out/ is gitignored)
IA = 'https://archive.org/download/'
WINDOWS = {   # file: (url, origin s on the source clock, length s, container)
    'ih_wave.mp4': (IA + 'the-iron-horse-1924-1080p/The%20Iron%20Horse%20%281924%29%20%5B1080p%5D.mp4', 7384, 34, 'mp4'),
    'ih_loco.mp4': (IA + 'the-iron-horse-1924-1080p/The%20Iron%20Horse%20%281924%29%20%5B1080p%5D.mp4', 7326, 26, 'mp4'),
    'tw_b.mp4': (IA + 'tumbleweeds-1925/Tumbleweeds%20%20%281925%29.mkv', 3534, 36, 'mkv'),
    'tw_c.mp4': (IA + 'tumbleweeds-1925/Tumbleweeds%20%20%281925%29.mkv', 3618, 76, 'mkv'),
    'tw_rush.mp4': (IA + 'tumbleweeds-1925/Tumbleweeds%20%20%281925%29.mkv', 3406, 20, 'mkv'),
}

LOCAL = os.path.abspath(os.path.join(VID, 'review', 'HORDE_c13', 'work'))   # c13/v16: windows fetched once by review/HORDE_c13/work/fetch.py (same range-read method)
LOCAL2 = os.path.abspath(os.path.join(VID, 'review', 'HORDE_c14', 'work'))   # c14/v17: the track-laying race (Iron Horse 8266-8312) and the hats window (7176-7226), fetched with the same range-read method
def ensure(f):
    if os.path.exists(os.path.join(LOCAL2, f)): return os.path.join(LOCAL2, f)
    if os.path.exists(os.path.join(LOCAL, f)): return os.path.join(LOCAL, f)
    p = os.path.join(WORK, f)
    if os.path.exists(p) or f not in WINDOWS: return p
    import time
    os.makedirs(WORK, exist_ok=True); url, o, d, ext = WINDOWS[f]; port = 8700 + (hash(f) % 90)
    px = subprocess.Popen([sys.executable, os.path.join(HERE, 'horde3.rangeproxy.py'), url, str(port)]); time.sleep(3)
    try:
        subprocess.run([FF, '-nostdin', '-loglevel', 'error', '-y', '-ss', str(o), '-i', 'http://127.0.0.1:%d/f.%s' % (port, ext), '-t', str(d), '-an', '-c:v', 'libx264', '-crf', '17', '-preset', 'veryfast', p + '.part.mp4'], check=True)
        os.replace(p + '.part.mp4', p)
    finally: px.terminate()
    return p
PW, PH = 540, 960
# name: (file, origin_t of the file, t0 on the source clock, dur, cx0, cx1 (fractions of source width), cw (source px), ytop (source px), note)
SHOTS = {
 'ih_mass':   ('ih_wave.mp4', 7384, 7390.0, 3.4, 0.46, 0.46, 607, 0, 'Iron Horse: the wave at full gallop, in profile, blurred by its own speed'),
 'ih_dense':  ('ih_wave.mp4', 7384, 7396.2, 3.4, 0.50, 0.50, 607, 0, 'Iron Horse: the dense mass'),
 'ih_wide':   ('ih_wave.mp4', 7384, 7387.0, 3.0, 0.50, 0.50, 1000, -330, 'Iron Horse: the wave emerging from the distance, wide'),
 'ih_engine': ('ih_wave.mp4', 7384, 7414.0, 3.4, 0.30, 0.55, 760, -260, 'Iron Horse: riders crossing in front of the locomotive'),
 'ih_loco':   ('ih_loco.mp4', 7326, 7334.3, 2.9, 0.52, 0.52, 607, 0, 'Iron Horse: the locomotive head-on, stack and smoke'),
 'ih_train':  ('ih_loco.mp4', 7326, 7330.5, 1.5, 0.50, 0.60, 760, -260, 'Iron Horse: the train under its smoke across the plain'),
 'tw_line':   ('tw_b.mp4', 3534, 3541.2, 1.8, 0.50, 0.50, 560, 0, 'Tumbleweeds: a line of riders charging the lens'),
 'tw_rider':  ('tw_c.mp4', 3618, 3668.5, 4.4, 0.55, 0.55, 480, 0, 'Tumbleweeds: one rider, low, at full gallop'),
 'tw_row':    ('tw_c.mp4', 3618, 3676.0, 5.0, 0.50, 0.50, 640, -120, 'Tumbleweeds: a row of riders along the horizon'),
 'tw_rise':   ('tw_c.mp4', 3618, 3643.8, 4.0, 0.50, 0.50, 640, -120, 'Tumbleweeds: riders pouring down a rise in dust'),

 # v16 (c13): the class itself, in place of the attack wave. Source clocks as in the director's c13 notes.
 'tw_rush':   ('tw_rush.mp4', 3406, 3416.6, 3.2, 0.50, 0.50, 640, -120, 'Tumbleweeds: the land-rush mass of wagons and riders at full gallop (frame 0)'),
 'tw_rush2':  ('tw_rush.mp4', 3406, 3420.2, 3.6, 0.40, 0.58, 520, -60, 'Tumbleweeds: wagons and riders tearing across the lens'),
 'tw_hor':    ('tw_hor.mp4', 3503, 3512.0, 1.7, 0.50, 0.50, 640, -120, 'Tumbleweeds: a line of riders and wagons on the horizon in dust'),
 'tw_hor2':   ('tw_hor.mp4', 3503, 3505.5, 1.5, 0.50, 0.50, 560, -120, 'Tumbleweeds: wagons and riders in dust on the horizon, wider ground'),
 'ih_hats':   ('ih_hats.mp4', 7180, 7180.4, 3.4, 0.24, 0.42, 430, 316, 'Iron Horse: a sea of workers hats seen from above'),
 'ih_hats2':  ('ih_hats.mp4', 7180, 7216.2, 2.4, 0.50, 0.40, 430, 316, 'Iron Horse: a sea of workers hats, second shot'),
 'ih_charge': ('ih_dust.mp4', 7234, 7257.6, 3.4, 0.40, 0.55, 720, -260, 'Iron Horse: riders in hats charging through dust (the drovers, not the attack)'),
 'ih_backlit':('ih_dust.mp4', 7234, 7249.6, 3.2, 0.50, 0.50, 760, -260, 'Iron Horse: backlit men in hats on the horizon in dust'),
 'ih_flat':   ('ih_trn.mp4', 7296, 7312.3, 3.0, 0.62, 0.45, 760, -260, 'Iron Horse: the train packed with the track gangs, under smoke'),

 # Pageant of Steel (Bethlehem Steel, c. 1940; IA Pageant_of_Steel_P1, 2048x1536 master, fetched at 1366x1024): the machines of today's frontier, white-hot
 'ps_tap':    ('steel.mp4', 0, 424.2, 3.6, 0.44, 0.58, 270, 0, 'Pageant of Steel: the open-hearth tap, fire pouring into the ladle'),
 'ps_run':    ('steel.mp4', 0, 436.0, 3.4, 0.55, 0.45, 270, 0, 'Pageant of Steel: molten runners glowing along the floor'),
 'ps_ladle':  ('steel.mp4', 0, 459.0, 4.2, 0.62, 0.72, 270, 0, 'Pageant of Steel: the ladle pour in a storm of sparks'),
 'ps_ingot':  ('steel.mp4', 0, 480.4, 3.6, 0.45, 0.58, 270, 0, 'Pageant of Steel: glowing ingot moulds in a row'),
 # v17 (c14): the class lays the rail. The Iron Horse, the track-laying race (8266 origin of gang.mp4). Men as a mass at work, backs and hats; no close-ups (the crews are played for comedy there).
 'rg_heave':  ('gang.mp4', 8266, 8269.0, 3.9, 0.47, 0.50, 607, 0, 'Iron Horse: the gang heaving ties in dust, the engine behind them'),
 'rg_heave2': ('gang.mp4', 8266, 8272.9, 4.0, 0.42, 0.52, 607, 0, 'Iron Horse: the gang heaving ties, second take'),
 'rg_mass':   ('gang.mp4', 8266, 8280.0, 6.0, 0.50, 0.50, 607, 0, 'Iron Horse: the mass of men on the track, from behind'),
 'ih_head':   ('ih_trn.mp4', 7296, 7304.5, 1.5, 0.47, 0.47, 640, 0, 'Iron Horse: the engine head-on, workers on the tender'),

 # c22 (3 Oct): THE FRONTIER MONTAGE between the ALL OF IT. hits and the sea of hats: the country built at a gallop (all public domain on the Internet Archive:
 # Plow That Broke the Plains 1936; Boulder Dam: The Pictorial Record 1930 (Prelinger 0385); Manhatta 1921 (Strand/Sheeler); San Francisco-Oakland Bay Bridge
 # Construction 1933 (Prelinger 0254); Pageant of Steel (Prelinger). Whole small files fetched into out/.horde_c15/_src, deleted after the bake.
 'fm_tract':  ('frames:tract', 0, 0.5, 2.0, 0.40, 0.52, 320, -90, 'Plow That Broke the Plains: tractors breaking the plain in dust'),
 'fm_town':   ('dam.mp4', 0, 111.0, 2.0, 0.40, 0.52, 270, 0, 'Boulder Dam 1930: the new town going up in rows in the desert'),
 'fm_dig':    ('manhatta.mp4', 0, 192.3, 1.5, 0.45, 0.52, 135, 0, 'Manhatta 1921: men digging a foundation'),
 'fm_derrick':('manhatta.mp4', 0, 200.0, 1.3, 0.45, 0.55, 135, 0, 'Manhatta 1921: the great derrick'),
 'fm_pour':   ('steel.mp4', 0, 540.0, 2.0, 0.45, 0.55, 270, 0, 'Pageant of Steel: the pour'),
 'fm_beam':   ('bay.mp4', 0, 133.0, 2.0, 0.40, 0.55, 270, 0, 'Bay Bridge 1933: ironworkers walking the beams'),
 'fm_rider':  ('manhatta.mp4', 0, 209.0, 1.6, 0.50, 0.50, 135, 0, 'Manhatta 1921: an ironworker riding a girder up on the crane'),
 'fm_towers': ('bay.mp4', 0, 305.0, 2.0, 0.40, 0.50, 270, 0, 'Bay Bridge 1933: the towers and the cables rising over the water'),
 'fm_city':   ('manhatta.mp4', 0, 160.0, 2.0, 0.45, 0.55, 135, 0, 'Manhatta 1921: the towers from above'),
 'fm_trucks': ('dam.mp4', 0, 461.0, 1.8, 0.45, 0.55, 270, 0, 'Boulder Dam 1930: trucks in the canyon cut'),
 'fm_runner': ('steel.mp4', 0, 505.0, 2.0, 0.40, 0.55, 270, 0, 'Pageant of Steel: molten runners'),
 'fm_girder': ('bay.mp4', 0, 205.0, 2.0, 0.45, 0.55, 270, 0, 'Bay Bridge 1933: the girders from below'),
 'fm_frame':  ('manhatta.mp4', 0, 217.0, 2.0, 0.45, 0.55, 135, 0, 'Manhatta 1921: the steel frame with its derricks'),
 'fm_catwalk':('dam.mp4', 0, 430.2, 1.2, 0.40, 0.55, 270, 0, 'Boulder Dam 1930: the workers camp, tents in rows across the desert'),
 'fm_loco':   ('manhatta.mp4', 0, 343.0, 2.0, 0.45, 0.55, 135, 0, 'Manhatta 1921: a locomotive in its steam'),
 'fm_crowd':  ('manhatta.mp4', 0, 109.0, 2.5, 0.45, 0.50, 135, 0, 'Manhatta 1921: a crowd of hats from above'),

 # c23 (5 Oct): THE MONTAGE GROWS (client: it 'ends ... way too early, need to deepen and grow larger and more impactful ... a hype montage of infrastructure and labor/the masses').
 # Master Hands (1936, Jam Handy for Chevrolet; IA MasterHa1936 / MasterHa1936_2, 640x480) for the foundry at scale; Manhatta (1921, IA silent-manhatta, 624x480) for the masses
 # from above; Pageant of Steel re-cut from the 640x480 derivative (steel.mp4).  Whole small files in out/.horde_c15/_src, deleted after the bake.
 'mh_cupola': ('mh2.mp4', 0, 7.6, 3.6, 0.50, 0.50, 270, 0, 'Master Hands 1936: the cupola tapped, fire bursting from it'),
 'mh_ladle':  ('mh2.mp4', 0, 268.5, 3.0, 0.50, 0.50, 270, 0, 'Master Hands 1936: a man at the ladle, the iron pouring'),
 'mh_pour':   ('mh2.mp4', 0, 303.0, 3.5, 0.50, 0.50, 270, 0, 'Master Hands 1936: the big ladle pour, flames off the moulds'),
 'mh_chains': ('mh2.mp4', 0, 342.0, 3.0, 0.50, 0.50, 270, 0, 'Master Hands 1936: the castings swinging on their chains'),
 'mh_blocks': ('mh2.mp4', 0, 357.0, 3.5, 0.50, 0.50, 270, 0, 'Master Hands 1936: engine blocks by the hundred moving on the line'),
 'mn_ferry2': ('manhatta2.mp4', 0, 84.0, 3.0, 0.50, 0.50, 270, 0, 'Manhatta 1921: the ferry coming in, packed to the rails'),
 'mn_ferry':  ('manhatta2.mp4', 0, 93.0, 3.0, 0.62, 0.62, 270, 0, 'Manhatta 1921: the ferry deck, a sea of people from above'),
 'mn_close':  ('manhatta2.mp4', 0, 118.3, 2.0, 0.50, 0.50, 270, 0, 'Manhatta 1921: the crowd from above, close'),
 'mn_pour':   ('manhatta2.mp4', 0, 124.3, 3.0, 0.66, 0.66, 270, 0, 'Manhatta 1921: the crowd pouring off the ferry, from high above'),
 'mn_street': ('manhatta2.mp4', 0, 130.2, 3.0, 0.50, 0.50, 270, 0, 'Manhatta 1921: the street from straight above, people crossing it'),

 'pl_tract':  ('frames:tract', 0, 0.0, 6.0, 0.40, 0.58, 320, -90, 'Plow That Broke the Plains: tractors advancing in dust'),
 'pl_disc':   ('frames:plowdust', 0, 0.0, 8.0, 0.50, 0.50, 330, -100, 'Plow That Broke the Plains: the disc plows tearing the sod'),
 'pl_comb':   ('frames:combL', 0, 1.0, 9.0, 0.28, 0.72, 340, -110, 'Plow That Broke the Plains: the combine line to the horizon'),
 'pl_echelon':('frames:combE', 0, 0.0, 7.0, 0.30, 0.55, 330, -100, 'Plow That Broke the Plains: the combines in echelon'),
}
def bake(name, force=False):
    f, o, t0, dur, cx0, cx1, cw, ytop, note = SHOTS[name]
    d = os.path.join(OUT, name)
    if os.path.exists(os.path.join(d, 'done')) and not force: return len([x for x in os.listdir(d) if x.endswith('.jpg')])
    os.makedirs(d, exist_ok=True)
    for x in os.listdir(d): os.remove(os.path.join(d, x))
    if f.startswith('frames:'): return bake_frames(name, d, f[7:], t0, dur, cx0, cx1, cw, ytop, note)
    p = ensure(f)
    # source size
    r = subprocess.run([FF, '-hide_banner', '-i', p], capture_output=True, text=True).stderr
    import re
    sw, sh = map(int, re.search(r'(\d{3,4})x(\d{3,4})', r.split('Stream')[1]).groups())
    ch = cw * 16 / 9
    y0 = max(0, ytop) if ytop >= 0 else (10 if f.startswith('tw') else 0)
    ytop_eff = ytop if ytop >= 0 else (ytop + (y0 if y0 else 0) if False else ytop)
    y1 = min(sh - (14 if f.startswith('tw') else 8), ytop + ch); hin = y1 - y0
    xs = lambda c: c * sw - cw / 2
    x_expr = "%f+(%f)*t/%f" % (xs(cx0), xs(cx1) - xs(cx0), dur)
    outh = int(round(hin * PW / cw)); ext = PH - outh
    if ext < 0: outh = PH; ext = 0
    vf = "crop=w=%d:h=%d:x='%s':y=%d:exact=1,scale=%d:%d:flags=lanczos,format=gray" % (cw, round(hin), x_expr, round(y0), PW, outh)
    cmd = [FF, '-nostdin', '-loglevel', 'error', '-ss', str(t0 - o), '-t', str(dur), '-i', p, '-vf', vf + ',fps=24', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    raw = subprocess.run(cmd, capture_output=True).stdout
    n = len(raw) // (PW * outh); rng = np.random.default_rng(7)
    for i in range(n):
        im = np.frombuffer(raw, np.uint8, PW * outh, i * PW * outh).reshape(outh, PW).astype(np.float32)
        if ext:
            top = im[:6].mean(0); k = np.ones(41) / 41; top = np.convolve(np.pad(top, 20, mode='edge'), k, 'valid')
            yy = np.arange(ext)[:, None]; g = 1 - 0.62 * ((ext - 1 - yy) / ext) ** 1.2        # darker toward the top of the frame
            e = top[None, :] * (1 - g * 0) * (1 - 0.62 * ((ext - yy) / ext) ** 1.2) + rng.normal(0, 1.2, (ext, PW))
            im = np.vstack([e, im])
        Image.fromarray(np.clip(im, 0, 255).astype(np.uint8), 'L').save(os.path.join(d, '%04d.jpg' % (i + 1)), quality=90)
    open(os.path.join(d, 'done'), 'w').write(note)
    return n
def bake_frames(name, d, src, t0, dur, cx0, cx1, cw, ytop, note):
    sd = os.path.join(VID, 'out', '.horde_c9', src); fs = sorted(x for x in os.listdir(sd) if x.endswith('.jpg'))
    i0 = int(round(t0 * 24)); n = min(int(round(dur * 24)), len(fs) - i0); rng = np.random.default_rng(7)
    ch = cw * 16 / 9
    for i in range(n):
        im = Image.open(os.path.join(sd, fs[i0 + i])).convert('L'); sw, sh = im.size
        cx = (cx0 + (cx1 - cx0) * i / max(1, n - 1)) * sw; x0 = min(max(cx - cw / 2, 8), sw - 8 - cw)
        y0 = 14 if ytop < 0 else ytop; y1 = min(sh - 12, ytop + ch); hin = y1 - y0; sc = PW / cw
        crop = im.crop((x0, y0, x0 + cw, y1)).resize((PW, int(round(hin * sc))), Image.LANCZOS)
        a = np.array(crop).astype(np.float32); ext = PH - a.shape[0]
        if ext > 0:
            top = a[14:46].mean(0); k = np.ones(41) / 41; top = np.convolve(np.pad(top, 20, mode='edge'), k, 'valid')
            yy = np.arange(ext)[:, None]; e = top[None, :] * (1 - 0.22 * ((ext - yy) / ext) ** 1.2) + rng.normal(0, 1.2, (ext, PW)); a = np.vstack([e, a])
        Image.fromarray(np.clip(a[-PH:], 0, 255).astype(np.uint8), 'L').save(os.path.join(d, '%04d.jpg' % (i + 1)), quality=90)
    open(os.path.join(d, 'done'), 'w').write(note); return n
if __name__ == '__main__':
    force = '--force' in sys.argv; names = [a for a in sys.argv[1:] if not a.startswith('--')] or list(SHOTS)
    os.makedirs(OUT, exist_ok=True); res = {k: bake(k, force) for k in names}
    if '--keep' not in sys.argv:
        import shutil; shutil.rmtree(WORK, ignore_errors=True)
    idx = json.load(open(os.path.join(OUT, 'index.json'))) if os.path.exists(os.path.join(OUT, 'index.json')) else {}
    for k in names: idx[k] = {'n': res[k], 'fps': 24, 'note': SHOTS[k][-1]}
    json.dump(idx, open(os.path.join(OUT, 'index.json'), 'w'), indent=1); print(res)
