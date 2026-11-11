#!/usr/bin/env python3
"""STAGE (round 4): the ground textures of lib/fx/stage, made here from noise (our own; no outside material), read by BOTH renderers:
the engine (lib/fx/stage/grounds.js, three's TextureLoader) and Cycles (videos/blender/stage_scene.py, image nodes), so the floor
under a person is the same floor in both.
   python3 videos/blender/stage_textures.py [names...]        (default: all; writes videos/web/assets/stage/<name>_{albedo,rough,normal}.jpg
                                                               and <name>_macro.jpg; ~0.3-0.7 MB a ground)
Every map is periodic (spectral synthesis on the torus; stamps wrap), one tile = TILE metres (stages.js carries the same numbers).
albedo: sRGB JPEG (linear reflectance x macro in the renderer); rough: linear JPEG (roughness 0-1); normal: tangent space, OpenGL
convention (+v up the image, as three.js and Blender read it), from a height field in metres; macro: a 16 m tile, grey 128 = x1.0,
multiplying albedo at the scale where a 2 m tile would repeat visibly (a row of twelve is ~9 m wide)."""
import os, sys
import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'stage')
N = 1024
TILE = {'paper': 2.0, 'concrete': 2.0, 'wood': 2.0, 'asphalt': 2.0, 'earth': 2.0, 'plaster': 2.0}
MACRO_M, MACRO_N = 16.0, 256


def spec_noise(n, tile, wl_lo, wl_hi, beta=1.0, seed=0, aniso=(1.0, 1.0)):
    """periodic band-limited noise, zero mean, unit std. wl_lo..wl_hi: the wavelengths kept (m); beta: the spectral slope (amplitude
    ~ f^-beta); aniso (ax, ay) stretches features: ax < 1 makes them longer along x (columns)"""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal((n, n)))
    f1 = np.fft.fftfreq(n, d=tile / n)
    FY, FX = np.meshgrid(f1, f1, indexing='ij')
    f = np.sqrt((FX * aniso[0]) ** 2 + (FY * aniso[1]) ** 2) + 1e-9
    lo, hi = 1.0 / wl_hi, 1.0 / wl_lo
    band = 1 / (1 + (lo / f) ** 6) / (1 + (f / hi) ** 6)
    a = np.real(np.fft.ifft2(F * f ** (-beta) * band))
    a -= a.mean()
    return a / (a.std() + 1e-12)


def stamp(field, cx, cy, r, val, mode='max', soft=1.0):
    """a disc (radius r px, soft edge) stamped into field at (cx, cy) with wrap; mode max | add | min | set"""
    n = field.shape[0]; R = int(np.ceil(r + 2 * soft)); ys = np.arange(-R, R + 1)
    dy, dx = np.meshgrid(ys, ys, indexing='ij')
    d = np.sqrt(dx ** 2 + dy ** 2)
    w = np.clip((r + soft - d) / (2 * soft), 0, 1)
    iy = (int(cy) + ys) % n; ix = (int(cx) + ys) % n
    sub = field[np.ix_(iy, ix)]
    if mode == 'max': sub = np.maximum(sub, w * val)
    elif mode == 'add': sub = sub + w * val
    elif mode == 'min': sub = np.minimum(sub, 1 - w * (1 - val))
    elif mode == 'set': sub = sub * (1 - w) + w * val
    field[np.ix_(iy, ix)] = sub


def line(field, x0, y0, ang, length, width, val, wobble=0.0, seed=0, mode='add'):
    """a thin wrapped line (scratch, crack) as a chain of soft dots"""
    rng = np.random.default_rng(seed); x, y = x0, y0; a = ang
    for _ in range(int(length)):
        stamp(field, x, y, width, val, mode=mode, soft=0.7)
        a += rng.normal(0, wobble); x += np.cos(a); y += np.sin(a)


def normal_from_height(h, px_m):
    """tangent-space normal (OpenGL: +x right, +y up the image) from a height field in metres"""
    dhdx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px_m)
    dhdrow = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px_m)
    nx, ny, nz = -dhdx, dhdrow, np.ones_like(h)     # rows run DOWN the image = -v, so d/dv = -d/drow and ny = -dh/dv = dh/drow
    L = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    return np.stack([nx / L, ny / L, nz / L], -1)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def save(name, albedo, rough, height, macro, px_m, q=90):
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray((lin2srgb(albedo) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_albedo.jpg'), quality=q)
    Image.fromarray((np.clip(rough, 0, 1) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_rough.jpg'), quality=q)
    n = normal_from_height(height, px_m)
    Image.fromarray(((n * 0.5 + 0.5) * 255 + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_normal.jpg'), quality=95)
    Image.fromarray((np.clip(macro * 128, 0, 255) + 0.5).astype(np.uint8)).save(os.path.join(OUT, f'{name}_macro.jpg'), quality=92)
    mean = albedo.reshape(-1, 3).mean(0)
    print(f'{name}: mean linear albedo {mean.round(3).tolist()}, roughness {rough.mean():.2f} ({rough.min():.2f}-{rough.max():.2f}), height sd {height.std() * 1000:.2f} mm')
    return mean


def macro_noise(amp, seed, wl=(1.5, 12.0)):
    return 1.0 + amp * np.clip(spec_noise(MACRO_N, MACRO_M, wl[0], wl[1], 0.8, seed), -2.5, 2.5)


# ------------------------------------------------------------------------------------------------ the grounds
def paper():
    """seamless background paper (a warm mid-light grey): fibre, faint mottling, cockling, a few scuffs where people walk"""
    T = TILE['paper']; px = T / N
    base = np.array([0.30, 0.292, 0.278])
    mot = spec_noise(N, T, 0.08, 1.0, 0.8, 11) * 0.018 + spec_noise(N, T, 0.002, 0.02, 0.3, 12) * 0.012
    scuff = np.zeros((N, N)); rng = np.random.default_rng(13)
    for k in range(9):    # dull grey smears (a shoe's rubber), elongated
        line(scuff, rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0, 2 * np.pi), rng.uniform(20, 70), rng.uniform(2, 5), 0.25, wobble=0.08, seed=100 + k)
    scuff = np.clip(scuff, 0, 1)
    alb = base[None, None, :] * (1 + mot[..., None]) * (1 - 0.07 * scuff[..., None])
    rough = 0.88 + 0.03 * spec_noise(N, T, 0.01, 0.5, 0.5, 14) - 0.08 * scuff
    h = spec_noise(N, T, 0.15, 1.0, 1.0, 15) * 0.0004 + spec_noise(N, T, 0.002, 0.01, 0.2, 16) * 0.00002
    return save('paper', alb, rough, h, macro_noise(0.03, 17), px)


def plaster():
    """a painted plaster wall (the window room's back wall): an off-white with roller stipple and faint patches"""
    T = TILE['plaster']; px = T / N
    base = np.array([0.52, 0.50, 0.465])
    mot = spec_noise(N, T, 0.1, 1.5, 0.8, 21) * 0.025 + spec_noise(N, T, 0.002, 0.012, 0.2, 22) * 0.012
    alb = base[None, None, :] * (1 + mot[..., None])
    rough = 0.82 + 0.04 * spec_noise(N, T, 0.003, 0.05, 0.3, 23)
    h = spec_noise(N, T, 0.002, 0.012, 0.4, 24) * 0.00012 + spec_noise(N, T, 0.2, 1.5, 1.0, 25) * 0.0003
    return save('plaster', alb, rough, h, macro_noise(0.04, 26), px)


def concrete():
    """a sealed, power-trowelled slab (a studio or shop floor): mottled burnish, fine aggregate and pits, hairline cracks, old stains"""
    T = TILE['concrete']; px = T / N; rng = np.random.default_rng(31)
    base = np.array([0.215, 0.205, 0.19])
    m1 = spec_noise(N, T, 0.15, 1.8, 1.0, 32); m2 = spec_noise(N, T, 0.03, 0.25, 0.6, 33); burn = spec_noise(N, T, 0.25, 1.2, 1.0, 34, aniso=(0.6, 1.0))
    tone = 1 + 0.07 * m1 + 0.035 * m2 - 0.05 * np.clip(burn, 0, None)
    spk = np.zeros((N, N))
    for _ in range(9000):   # aggregate fines at the surface, 1-3 mm, lighter or darker
        stamp(spk, rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0.3, 1.0), rng.choice([0.18, -0.15]), mode='add', soft=0.6)
    pits = np.zeros((N, N))
    for _ in range(1400):
        stamp(pits, rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0.4, 1.4), 1.0, mode='max', soft=0.6)
    cr = np.zeros((N, N))
    for k in range(3):
        line(cr, rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0, 2 * np.pi), rng.uniform(250, 600), 0.45, 1.0, wobble=0.12, seed=300 + k, mode='max')
    stain = np.clip(spec_noise(N, T, 0.08, 0.6, 1.2, 35) - 1.3, 0, None)
    alb = base[None, None, :] * (tone * (1 + spk) * (1 - 0.45 * pits) * (1 - 0.5 * cr) * (1 - 0.18 * stain))[..., None]
    rough = np.clip(0.62 - 0.14 * np.clip(burn, 0, None) + 0.06 * m2 + 0.25 * pits + 0.2 * cr - 0.1 * stain, 0.3, 0.95)
    h = 0.0003 * m1 - 0.0008 * pits - 0.0006 * cr + 0.00004 * spec_noise(N, T, 0.002, 0.01, 0.2, 36)
    return save('concrete', alb, rough, h, macro_noise(0.06, 37), px)


def wood():
    """worn wooden boards (a hall or a loft floor): 14 strips of 0.143 m along x in a 2 m tile, butt joints staggered, per-board tone,
    long grain and ring figure, dark gaps, a lighter worn path where the varnish is gone, scratches"""
    T = TILE['wood']; px = T / N; rng = np.random.default_rng(41)
    rows = 14; bw = N / rows
    Y, X = np.meshgrid(np.arange(N), np.arange(N), indexing='ij')
    r = np.floor(Y / bw).astype(int); yl = (Y - r * bw) / bw     # board row, position across it 0..1
    grain = spec_noise(N, T, 0.004, 0.6, 0.9, 42, aniso=(0.06, 1.0))
    fine = spec_noise(N, T, 0.0025, 0.02, 0.3, 43, aniso=(0.05, 1.0))
    alb = np.zeros((N, N, 3)); rough = np.zeros((N, N)); h = np.zeros((N, N)); gap = np.zeros((N, N))
    worn = spec_noise(N, T, 0.4, 2.0, 1.0, 44)                  # the path: where feet go
    for k in range(rows):
        # cut points round the tile (boards 0.45-1.4 m), a fresh offset per row
        cuts, x0 = [], rng.uniform(0, N); x = x0
        while True:
            cuts.append(x); x += rng.uniform(0.45, 1.4) / px
            if x >= x0 + N - 0.4 / px: break
        cuts = np.array(cuts) % N; cuts.sort()
        sel = r == k
        xs = X[sel]; idx = np.searchsorted(cuts, xs) % len(cuts)    # board index along the row (wraps)
        tone_b = rng.lognormal(0, 0.14, len(cuts)); hue = rng.normal(0, 0.035, len(cuts)); ph = rng.uniform(0, 50, len(cuts))
        yy = yl[sel]; g = grain[sel]; fn = fine[sel]
        ring = np.sin(2 * np.pi * (yy * rng.uniform(2.5, 6) + 0.35 * g + ph[idx]))     # the figure: rings cut across the board
        lum = tone_b[idx] * (1 + 0.10 * g + 0.06 * ring + 0.05 * fn)
        c = np.stack([0.285 * (1 + hue[idx]), 0.172 * np.ones_like(yy), 0.088 * (1 - hue[idx])], -1) * lum[:, None]
        alb[sel] = c
        rough[sel] = 0.42 + 0.05 * fn
        cup = (yy - 0.5) ** 2 * 0.0006                                 # boards cup a little
        h[sel] = cup + 0.00005 * fn
        # butt joints: a dark 1.5 mm line at each cut
        dcut = np.min(np.abs(((xs[:, None] - cuts[None, :]) + N / 2) % N - N / 2), 1)
        gap[sel] = np.maximum(gap[sel], np.clip(1.6 - dcut, 0, 1))
    dyg = np.minimum(yl, 1 - yl) * bw
    gap = np.maximum(gap, np.clip(1.6 - dyg, 0, 1))
    wear = np.clip(0.5 + 0.5 * worn, 0, 1) ** 1.5
    sc = np.zeros((N, N))
    for k in range(60):
        line(sc, rng.uniform(0, N), rng.uniform(0, N), rng.normal(0, 0.25) + (np.pi if k % 2 else 0), rng.uniform(15, 120), 0.4, 0.5, wobble=0.02, seed=500 + k)
    sc = np.clip(sc, 0, 1)
    lumw = 1 + 0.18 * wear + 0.25 * sc                              # worn: the varnish gone, the wood paler and greyer
    grey = alb.mean(-1, keepdims=True)
    alb = (alb * (1 - 0.25 * wear[..., None]) + grey * 0.25 * wear[..., None]) * lumw[..., None]
    alb = alb * (1 - 0.8 * gap[..., None])
    rough = np.clip(rough + 0.28 * wear + 0.2 * sc + 0.4 * gap, 0.3, 0.95)
    h = h - 0.0015 * gap - 0.0001 * sc
    return save('wood', alb, rough, h, macro_noise(0.05, 45), px)


def asphalt():
    """weathered asphalt (a yard, a lot): dark binder worn back from grey aggregate, fines, a few cracks and oil spots"""
    T = TILE['asphalt']; px = T / N; rng = np.random.default_rng(51)
    binder = 0.055 * (1 + 0.15 * spec_noise(N, T, 0.01, 0.5, 0.8, 52))
    stones = np.zeros((N, N)); tone = np.zeros((N, N)); hs = np.zeros((N, N))
    for _ in range(26000):
        x, y, rr = rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0.7, 3.8)
        v = rng.uniform(0.12, 0.32)
        stamp(stones, x, y, rr, 1.0, mode='max', soft=0.7); stamp(tone, x, y, rr, v, mode='set', soft=0.7); stamp(hs, x, y, rr, rr * px * 0.35, mode='max', soft=0.7)
    alb1 = binder * (1 - stones) + tone * stones
    cr = np.zeros((N, N))
    for k in range(4):
        line(cr, rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0, 2 * np.pi), rng.uniform(200, 700), 0.8, 1.0, wobble=0.18, seed=600 + k, mode='max')
    oil = np.clip(spec_noise(N, T, 0.1, 0.8, 1.3, 53) - 1.6, 0, None)
    dust = 0.5 + 0.5 * spec_noise(N, T, 0.3, 2.0, 1.0, 54)
    a = alb1 * (1 - 0.6 * cr) * (1 - 0.35 * np.clip(oil, 0, 1)) + 0.02 * dust
    warm = np.stack([a * 1.02, a, a * 0.96], -1)
    rough = np.clip(0.86 + 0.05 * stones - 0.15 * np.clip(oil, 0, 1) + 0.04 * spec_noise(N, T, 0.005, 0.1, 0.3, 55), 0.5, 0.97)
    h = hs - 0.002 * cr + 0.0004 * spec_noise(N, T, 0.1, 1.5, 1.0, 56)
    return save('asphalt', warm, rough, h, macro_noise(0.08, 57), px)


def earth():
    """packed earth (a yard, a path): ochre-brown dust over darker compacted soil, small pebbles, fine clods, a scuffed track"""
    T = TILE['earth']; px = T / N; rng = np.random.default_rng(61)
    m1 = spec_noise(N, T, 0.15, 1.8, 1.0, 62); m2 = spec_noise(N, T, 0.01, 0.15, 0.7, 63)
    dust = np.clip(0.5 + 0.5 * spec_noise(N, T, 0.08, 1.0, 1.0, 64), 0, 1)
    base = np.array([0.20, 0.145, 0.095]); dustc = np.array([0.30, 0.245, 0.18])
    alb = base[None, None, :] * (1 - dust[..., None]) + dustc[None, None, :] * dust[..., None]
    alb = alb * (1 + 0.08 * m1 + 0.06 * m2)[..., None]
    peb = np.zeros((N, N)); pt = np.zeros((N, N)); ph = np.zeros((N, N))
    for _ in range(5000):
        x, y, rr = rng.uniform(0, N), rng.uniform(0, N), rng.uniform(0.6, 4.5)
        stamp(peb, x, y, rr, 1.0, mode='max', soft=0.8); stamp(pt, x, y, rr, rng.uniform(0.6, 1.5), mode='set', soft=0.8); stamp(ph, x, y, rr, rr * px * 0.5, mode='max', soft=0.8)
    alb = alb * (1 - peb[..., None] + (peb * pt)[..., None])
    rough = np.clip(0.93 - 0.05 * peb + 0.03 * m2, 0.6, 0.98)
    h = 0.0012 * m1 + 0.0004 * m2 + ph
    return save('earth', alb, rough, h, macro_noise(0.08, 65), px)


ALL = {'paper': paper, 'plaster': plaster, 'concrete': concrete, 'wood': wood, 'asphalt': asphalt, 'earth': earth}
if __name__ == '__main__':
    for n in (sys.argv[1:] or ALL):
        ALL[n]()
