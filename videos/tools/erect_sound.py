#!/usr/bin/env python3
"""ERECT sound (MODELING c4): sound for the giant's scale events, built from the act's own contact cues.

Why: a foot plant is half sound. c3's reveal had none. The craft rule here is that a big thing is heard as LOW, LATE and LONG:
the impact is felt before it is heard clearly, its tail rolls for seconds, small things (clods, plates, snow) keep falling after
it, and the machine's effort is a groan under the motion, not a whoosh. Everything is recorded material from the library
(videos/sources/audio, all PD / CC0 / CC-BY, credits printed) pitched and filtered, plus a sub sweep; nothing is a synth "boom".

  python3 tools/erect_sound.py kneel  --cues rep.json --dur 9.2 --out kneel.wav [--video clip.mp4 --mux out.mp4]
  python3 tools/erect_sound.py carry  --cues rep.json --dur 13.4 --out carry.wav ...
  python3 tools/erect_sound.py build  --dur 13 --out build.wav ...
  python3 tools/erect_sound.py build5 --cues holds.json --dur 10.1 --out build5.wav   (c5: holds [{t0, dur, seat}] from lab_erect5)

Cues come from the lab's report (`cues`: [{t, kind, strength, x, z}]) or from the act's defaults below; `--shots` gives camera
cut times and distances so each shot hears from where its camera is.
"""
import argparse, json, os, subprocess, sys
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

SR = 48000
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sources', 'audio')
CREDITS = {
    'foundry/steel_press.flac': 'thomasmartinnutt, radio aporee (archive.org/details/aporee_52741_60256), PD',
    'foundry/heavy_door_scrape.flac': 'radio aporee (foundry library), PD',
    'foundry/rails_crane_a.flac': 'radio aporee (foundry library), PD',
    'foundry/iron_pipes.flac': 'radio aporee (foundry library), PD',
    'industry/industry_steam_hiss.wav': "'steam1' by gadzooks (freesound.org), CC-BY 3.0, edit ALEXbr",
    'fx/fx_bass_impact.wav': 'D4XX (freesound 617043), CC0 1.0',
    'fx/fx_thunder_roll.wav': 'US National Park Service, Natural Sounds and Night Skies Division, public domain',
    'industry/metal_clang_dull.wav': "The Designer's Choice UCS Collection, Nicholas A. Judy (archive.org), composed by djeada",
    'industry/metal_clang_thin.wav': "The Designer's Choice UCS Collection, Nicholas A. Judy (archive.org), composed by djeada",
    'places/yard_hhi_bed.wav': 'archive.org/details/201107-004, public domain mark 1.0',
    'places/yard_hhi_impacts.wav': 'archive.org/details/201107-004, public domain mark 1.0',
    'crowd/crowd_ambience_murmur.wav': 'FlatHill (freesound 324757), CC0 1.0',
}
_cache = {}
def load(rel):
    if rel in _cache: return _cache[rel]
    x, sr = sf.read(os.path.join(ROOT, rel), always_2d=True); x = x.mean(axis=1)
    if sr != SR: x = resample_poly(x, SR, sr)
    _cache[rel] = x.astype(np.float64); return _cache[rel]
def pitch(x, ratio):
    """ratio > 1 = lower and longer by that factor (a tape-speed change: the way a bigger thing sounds)"""
    return resample_poly(x, int(round(1000 * ratio)), 1000)
def filt(x, lo=None, hi=None, order=4):
    if lo: x = sosfilt(butter(order, lo, 'highpass', fs=SR, output='sos'), x)
    if hi: x = sosfilt(butter(order, hi, 'lowpass', fs=SR, output='sos'), x)
    return x
def env(n, a=.01, r=.5):
    e = np.ones(n); na, nr = min(n, int(a * SR)), min(n, int(r * SR))
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr) ** 2
    return e
def lvl(x, db):
    """set a bed's RMS (dBFS) so its gain means the same whatever the recording's own level"""
    r = np.sqrt(np.mean(x ** 2)) + 1e-12; return x * 10 ** (db / 20) / r
def seg(x, t0, dur):
    i0 = int(t0 * SR); return x[i0:i0 + int(dur * SR)].copy()
class Mix:
    def __init__(self, dur): self.L = np.zeros(int(dur * SR) + SR); self.R = np.zeros_like(self.L); self.dur = dur
    def add(self, x, t, gain_db=0, pan=0.0, width=0.0):
        i = int(t * SR); x = x * 10 ** (gain_db / 20)
        n = min(len(x), len(self.L) - i)
        if n <= 0 or i < 0: return
        gl, gr = np.sqrt(.5 * (1 - pan)), np.sqrt(.5 * (1 + pan))
        if width > 0:   # a little decorrelation: a short delay on one side
            d = int(width * .012 * SR); xr = np.concatenate([np.zeros(d), x])[:len(x)]
        else: xr = x
        self.L[i:i + n] += x[:n] * gl; self.R[i:i + n] += xr[:n] * gr
    def out(self):
        y = np.stack([self.L, self.R], 1)[:int(self.dur * SR)]
        return y

def sub_sweep(dur=1.6, f0=48, f1=28):
    t = np.arange(int(dur * SR)) / SR; f = f0 + (f1 - f0) * (t / dur); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / (dur * .35)) * np.minimum(1, t / .015)
def patter(n, spread, seed, size=(.2, .8), dist=20.0):
    """clods and ice landing: short low thuds with a gritty top, spread in time"""
    rng = np.random.default_rng(seed); out = np.zeros(int((spread + 1.0) * SR))
    for _ in range(n):
        t = rng.random() ** 1.6 * spread; s = size[0] + rng.random() * (size[1] - size[0]); L = int(SR * (.04 + .1 * s))
        b = rng.standard_normal(L) * np.exp(-np.arange(L) / (SR * (.012 + .03 * s)))
        b = filt(b, 60, 900 + 1800 * (1 - s)) * (.3 + s)
        i = int(t * SR); out[i:i + L] += b[:len(out) - i]
    return filt(out, 40, 9000 * 20 / (20 + dist))

def shot_at(shots, t):
    for s in shots:
        if s['t0'] <= t < s['t1']: return s
    return shots[-1]

def kneel_mix(cues, dur, shots):
    M = Mix(dur)
    # the place: a working yard, low and wide; a murmur of people; it never cuts with the picture
    bed = filt(load('places/yard_hhi_bed.wav'), 50, 3500); M.add(lvl(seg(bed, 3, dur + .5), -24) * env(int((dur + .5) * SR), .25, .6), 0, 0, -.1, 1)
    mur = filt(load('crowd/crowd_ambience_murmur.wav'), 150, 2500); M.add(lvl(seg(mur, 8, dur + .5), -31) * env(int((dur + .5) * SR), .3, .6), 0, 0, .2, 1)
    wind = filt(np.random.default_rng(3).standard_normal(int((dur + 1) * SR)), 80, 600); M.add(wind * env(len(wind), 1, 1), 0, -38, 0, 1)
    press = load('foundry/steel_press.flac'); creak = load('foundry/heavy_door_scrape.flac'); whine = load('foundry/rails_crane_a.flac')
    T = {c['kind']: c['t'] for c in cues if c['kind'] not in ('debris', 'plant')}
    plant = [c for c in cues if c['kind'] == 'plant']; tPlant = plant[0]['t'] if plant else 5.5
    tLift = T.get('knee_lift', 2.9)
    # the machine taking its weight: a low groan (the press, an octave down) swelling through the lean and the rise
    g = filt(pitch(seg(press, 6, 5.2), 1.9), 30, 900); g = g[:int(6.2 * SR)]; g *= env(len(g), 1.2, 1.4)
    M.add(g, max(0, tLift - 1.9), -12, -.15, .6)
    # its rams: a strained whine under the rise, quiet
    w = filt(pitch(seg(whine, 2, 3.6), 1.25), 120, 2600); w *= env(len(w), .8, 1.0); M.add(w, tLift + .1, -25, .3, .4)
    # frame creaks as the weight shifts forward and as the knee comes off the ground
    for t0, r, db in [(T.get('hiss', 1.4) + .3, 2.2, -17), (tLift - .15, 2.6, -14), (tPlant + .9, 2.4, -18)]:
        c = filt(pitch(seg(creak, 4 + t0, 1.6), r), 40, 1400); c *= env(len(c), .05, .8); M.add(c, t0, db, -.3, .3)
    # steam let go from the hips and knees
    hiss = load('industry/industry_steam_hiss.wav')
    for c in cues:
        if c['kind'] == 'hiss': h = filt(pitch(hiss, 1.25), 300, 9000); h *= env(len(h), .02, 1.2); M.add(h, c['t'], -20 + 6 * c['strength'], .4, .8)
    # the knee leaving the ground: an unsticking thud, frozen clods falling ~1-2 m
    bi = load('fx/fx_bass_impact.wav')
    M.add(filt(pitch(bi, 1.6), 25, 700) * .8, tLift, -7, 0, .3)
    M.add(patter(46, 1.1, 5, dist=40), tLift + .35, -8, -.2, .6)
    if 'foot_lift' in T: M.add(patter(30, 1.0, 6, dist=30), T['foot_lift'] + .85, -14, -.4, .6)
    # THE PLANT: felt first (sub), then the hit (impact an octave down + a dull structural clank), then the roll (thunder, low
    # passed), then the frame ringing down (yard impacts, plates) and the debris; heard closer in shot B than in A or C
    s = shot_at(shots, tPlant); near = 30.0 / (30.0 + s.get('dist', 30)); lp = 1200 + 4000 * near
    M.add(sub_sweep(1.8), tPlant - .03, -7, 0)
    M.add(filt(pitch(bi, 1.8), 20, lp), tPlant, -4 + 4 * near, 0, .4)
    clank = load('industry/metal_clang_dull.wav'); M.add(filt(pitch(clank, 3.2), 30, 1500), tPlant + .02, -9, -.1, .3)
    roll = filt(load('fx/fx_thunder_roll.wav'), 25, 520); r = seg(roll, .4, 4.2); r *= env(len(r), .05, 3.2); M.add(r, tPlant + .06, -9, 0, 1)
    yi = filt(load('places/yard_hhi_impacts.wav'), 80, 3000); M.add(seg(yi, 11.2, 2.2) * env(int(2.2 * SR), .01, 1.2), tPlant + .25, -22, .3, .7)
    thin = load('industry/metal_clang_thin.wav')
    for k, (dt, p) in enumerate([(.35, .5), (.6, .45), (.9, .55), (1.3, .5)]): M.add(filt(pitch(thin, 1 / p), 80, 4000), tPlant + dt, -25 - 2 * k, (-1) ** k * .4)
    M.add(patter(40, 1.6, 7, dist=s.get('dist', 30)), tPlant + .2, -11, .1, .8)
    # snow off the beam: a long soft hiss arriving ~3 s later (52 m at g)
    for c in cues:
        if c['kind'] == 'snow_land': n = filt(np.random.default_rng(9).standard_normal(int(2.5 * SR)), 900, 7000) * env(int(2.5 * SR), .6, 1.5); M.add(n, max(0, c['t'] - 1.2), -30, .5, 1)
    # the settle: the weight arriving (a dip) and the rams catching it
    if 'settle' in T: M.add(filt(pitch(clank, 2.6), 30, 1200), T['settle'], -15); x = filt(pitch(seg(press, 12, 1.4), 1.6), 30, 800); M.add(x * env(len(x), .1, .8), T['settle'] + .1, -19)
    return M

def carry_mix(cues, dur, shots):
    M = Mix(dur)
    bed = filt(load('places/yard_hhi_bed.wav'), 50, 3500); M.add(lvl(seg(bed, 10, dur + .5), -24) * env(int((dur + .5) * SR), .25, .6), 0, 0, -.1, 1)
    mur = filt(load('crowd/crowd_ambience_murmur.wav'), 150, 2500); M.add(lvl(seg(mur, 20, dur + .5), -31) * env(int((dur + .5) * SR), .3, .6), 0, 0, .2, 1)
    press = load('foundry/steel_press.flac'); creak = load('foundry/heavy_door_scrape.flac'); clank = load('industry/metal_clang_dull.wav'); bi = load('fx/fx_bass_impact.wav'); thin = load('industry/metal_clang_thin.wav')
    T = {c['kind']: c['t'] for c in cues}
    tG, tSet, tLet = T.get('grip', 4.4), T.get('set_down', 11.6), T.get('release', 12.6)
    # the crouch: a long groan; the grip: steel on steel, a dull clank and a creak as the fingers close
    g = filt(pitch(seg(press, 2, 3.4), 1.9), 30, 900); g *= env(len(g), .8, 1.0); M.add(g, .6, -14, -.1, .5)
    M.add(filt(pitch(clank, 2.4), 40, 2000), tG, -10); M.add(filt(pitch(thin, 1.8), 60, 3000), tG + .05, -20, .3)
    c = filt(pitch(seg(creak, 9, 1.4), 2.0), 40, 1500); c *= env(len(c), .05, .7); M.add(c, tG + .1, -15, -.2)
    # the load coming off the cribs (the trestles unload with a crack), the lift: the press groaning under effort
    M.add(filt(pitch(bi, 1.4), 25, 900), tG + .5, -13); M.add(patter(18, .8, 11, dist=40), tG + .6, -18)
    g2 = filt(pitch(seg(press, 18, 6.0), 1.7), 30, 900); g2 *= env(len(g2), 1.0, 1.6); M.add(g2, tG + .4, -11, .1, .6)
    hiss = load('industry/industry_steam_hiss.wav')
    for c in cues:
        if c['kind'] == 'hiss': h = filt(pitch(hiss, 1.25), 300, 9000); h *= env(len(h), .02, 1.2); M.add(h, c['t'], -20 + 6 * c['strength'], .4, .8)
    # set down on the column heads: a great dull clang, the columns ringing, grit and snow off the flanges
    M.add(sub_sweep(1.2, 60, 38), tSet - .02, -12); M.add(filt(pitch(bi, 1.5), 25, 1500), tSet, -6, 0, .4)
    M.add(filt(pitch(clank, 2.0), 40, 3500), tSet, -6, 0); M.add(filt(pitch(thin, 1.4), 100, 5000), tSet + .03, -14, .3, .5); M.add(filt(pitch(thin, 1.9), 100, 5000), tSet + .2, -20, -.3, .5)
    M.add(patter(20, 1.2, 12, size=(.1, .3), dist=30), tSet + .5, -18, .1)
    M.add(filt(pitch(clank, 2.8), 40, 1600), tLet, -16)
    return M

def build_mix(dur):
    """the time-lapse: the yard compressed (hammering, cranes, traffic) under a slow wind; no events"""
    M = Mix(dur); yi = filt(load('places/yard_hhi_impacts.wav'), 60, 6000)
    M.add(lvl(seg(yi, 2, dur + .5), -22) * env(int((dur + .5) * SR), .5, 1.0), 0, 0, -.1, 1); M.add(lvl(seg(yi, 18, dur + .5), -25) * env(int((dur + .5) * SR), .5, 1.0), 0, 0, .2, 1)
    wind = filt(np.random.default_rng(4).standard_normal(int((dur + 1) * SR)), 80, 500); M.add(wind * env(len(wind), 1, 1), 0, -34, 0, 1)
    return M

def build5_mix(dur, holds):
    """(MODELING c5) the time-lapse as holds: each hold is its own moment of the yard (the bed cuts with the picture, a different
    stretch of the recording each time), the active crane's slew motor and brake under its swing, a dull landing clank and a
    rattle of shackles when the load seats, a quieter yard in the last hold with the stacks breathing"""
    M = Mix(dur); yi = filt(load('places/yard_hhi_impacts.wav'), 60, 6000); bed = filt(load('places/yard_hhi_bed.wav'), 50, 3500)
    sg = lambda x, t0, d: seg(x, t0 % max(.1, len(x) / SR - d - .1), d)
    whine = load('foundry/rails_crane_a.flac'); clank = load('industry/metal_clang_dull.wav'); thin = load('industry/metal_clang_thin.wav'); hiss = load('industry/industry_steam_hiss.wav')
    for k, h in enumerate(holds):
        t0, d = h['t0'], h['dur']; n = int((d + .05) * SR); e = env(n, .01, .04)
        M.add(lvl(sg(bed, 4 + 9 * k, d + .05), -24) * e, t0, 0, -.1, 1)
        M.add(lvl(sg(yi, 3 + 13 * k, d + .05), -27 if h.get('seat') is not None else -30) * e, t0, 0, .2, 1)
        if h.get('seat') is not None:
            w = filt(pitch(sg(whine, 2 + 3 * k, min(d, h['seat'])), 1.15), 140, 3200); w *= env(len(w), .02, .5); M.add(w, t0, -24, (-1) ** k * .4, .5)
            ts = t0 + h['seat']; M.add(filt(pitch(clank, 2.2), 40, 2500), ts, -11, (-1) ** k * .3); M.add(filt(pitch(thin, 1.6), 80, 4500), ts + .08, -22, -.2)
            M.add(patter(10, .5, 20 + k, size=(.05, .15), dist=60), ts + .05, -24)
        else:
            hh = filt(pitch(hiss, 1.4), 200, 6000); hh = sg(hh, 0, d); hh *= env(len(hh), .4, .8); M.add(hh, t0, -27, .3, 1)
    wind = filt(np.random.default_rng(4).standard_normal(int((dur + 1) * SR)), 80, 500); M.add(wind * env(len(wind), 1, 1), 0, -34, 0, 1)
    return M

def master(y, target=-16.0):
    import pyloudnorm as pyln
    meter = pyln.Meter(SR); L = meter.integrated_loudness(y); y = y * 10 ** ((target - L) / 20)
    pk = np.max(np.abs(y)); lim = 10 ** (-1.5 / 20)
    if pk > lim * .7: k = lim * .7; a = np.abs(y); y = np.where(a > k, np.sign(y) * (k + (lim - k) * np.tanh((a - k) / (lim - k))), y)   # soft knee above -4.6 dBFS: the hits are rounded, nothing passes -1.5
    return y, L

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('act'); ap.add_argument('--cues'); ap.add_argument('--dur', type=float, required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--shots', default=None, help='json: [{"t0":0,"t1":3.7,"dist":60}, ...]'); ap.add_argument('--video'); ap.add_argument('--mux'); ap.add_argument('--scale', default=None)
    a = ap.parse_args()
    cues = []
    if a.cues:
        d = json.load(open(a.cues)); cues = d if isinstance(d, list) else (d.get('cues') or d)
    shots = json.loads(a.shots) if a.shots else [{'t0': 0, 't1': 1e9, 'dist': 40}]
    M = kneel_mix(cues, a.dur, shots) if a.act == 'kneel' else carry_mix(cues, a.dur, shots) if a.act == 'carry' else build5_mix(a.dur, cues) if a.act == 'build5' else build_mix(a.dur)
    y, L0 = master(M.out()); sf.write(a.out, y, SR, subtype='PCM_24')
    print(f'{a.out}: {a.dur:.1f} s, pre-master {L0:.1f} LUFS -> -16 LUFS, peak {20*np.log10(np.max(np.abs(y))):.1f} dBFS')
    if a.video and a.mux:
        FF = '/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2'
        vf = ['-vf', f'scale={a.scale}:flags=lanczos'] if a.scale else []
        subprocess.run([FF, '-y', '-loglevel', 'error', '-i', a.video, '-i', a.out, *vf, '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', a.mux], check=True)
        print('muxed', a.mux)
    print('sources:'); [print('  ', k, '-', v) for k, v in CREDITS.items()]

if __name__ == '__main__': main()
