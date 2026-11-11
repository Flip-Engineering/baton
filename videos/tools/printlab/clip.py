"""The demo clip: the neutral type set inked, printed and pulled (python3 tools/printlab/clip.py OUT.mp4).

7.5 s at 24 fps, camera on the press bed. The forme is the type set as sorts (mirrored on the bed, each sort its own
block); the roller inks the faces; a sheet comes down; the platen hits; the sheet is peeled off the forme from the right,
so its printed face turns up reading right; then the pulled sheet is laid face up, a second colour lands off register,
and the camera pushes in on the impression. Every image of the print comes from engine.printlab (no compositing tricks
stand in for the press: the pulled sheet IS the letterpress() result for this forme on this paper).
"""
import os
import subprocess
import sys

import numpy as np
from scipy import ndimage

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from engine.printlab import core, press as P, sorts  # noqa: E402
from engine.printlab.core import blur, field, lin_to_srgb, srgb_to_lin  # noqa: E402

OUT = sys.argv[1]
W, H, FPS, DUR = 1080, 1920, 24, 7.5
N = int(FPS * DUR)
VIEW, X0, Y0 = 178.0, -14.0, -40.0


def forme(cam, seed=3):
    F = sorts.set_line('WOOD', cam, 14, 70, lines=9, face='ultra', seed=seed)
    F = sorts.set_line('TYPE', cam, 14, 112, lines=9, face='ultra', seed=seed + 1, forme=F)
    F = sorts.merge(F, sorts.set_line('Specimen', cam, 14, 160, lines=4, face='fell', material='metal', seed=seed + 2))
    F = sorts.merge(F, sorts.set_line('of Printing Types, 1874', cam, 14, 185, lines=1.6, face='fell', material='metal', seed=seed + 3))
    return F


def ease(u): u = np.clip(u, 0, 1); return u * u * (3 - 2 * u)


print('pressing...', flush=True)
cam = P.Camera(view_mm=VIEW, x_mm=X0, y_mm=Y0)
F = forme(cam)
red = sorts.set_line('No. 5', cam, 120, 200, lines=3, face='ultra', seed=9)
paper = P.paper('book1874', cam, seed=2)
p1 = P.letterpress(paper, F, ink='black1874', pressure=0.45)
P1 = p1.srgb()
# the push-in at the end: the twice-printed sheet rendered at 1.5x so the zoom shows real structure, not upsampling
camZ = P.Camera(view_mm=VIEW, x_mm=X0, y_mm=Y0, w=int(W * 1.5), h=int(H * 1.5))
FZ = forme(camZ); redZ = sorts.set_line('No. 5', camZ, 120, 200, lines=3, face='ultra', seed=9)
pz = P.letterpress(P.paper('book1874', camZ, seed=2), FZ, ink='black1874', pressure=0.45)
pz2 = P.letterpress(pz, redZ, ink='vermilion', pressure=0.4, misreg=(0.9, -0.5, 0.35)).srgb()
pz1 = pz.srgb()

print('bed...', flush=True)
# ---- the bed, seen from above: the forme is mirrored; every sort is a block; furniture fills the chase
face = F['face'][:, ::-1]; sid = F['sort'][:, ::-1]; fig = F['figure'][:, ::-1]
mm = cam.mm_px
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
steel = np.array([0.055, 0.058, 0.064], np.float32)[None, None, :] * (1 + 0.15 * field(H, W, 30, 5)[..., None])
bed = steel.copy()
furn_w = srgb_to_lin(np.array([0.52, 0.42, 0.30], np.float32))
chase = np.zeros((H, W), bool)
cy0, cy1 = int((22 - Y0) / mm), int((212 - Y0) / mm); cx0, cx1 = int(W - (156 - X0) / mm), int(W - (4 - X0) / mm)
chase[max(cy0, 0):cy1, max(cx0, 0):cx1] = True
grainf = field(H, W, 2.0 / mm, 7, 0, 0, (14, 1), 0.0)
bed[chase] = (furn_w[None, :] * (0.8 + 0.12 * grainf[chase][:, None]))
block = np.zeros((H, W), np.int32) - 1
top = np.zeros((H, W, 3), np.float32)
for i, s in enumerate(F['sorts']):
    x0, y0, adv, body = s['rect_px']
    if s['ch'] == ' ': continue
    bx0, bx1 = W - (x0 + max(adv, 1)), W - x0
    by0 = y0 + int(body * 0.02); by1 = by0 + int(body * 0.98)
    ya, yb, xa, xb = max(by0, 0), min(by1, H), max(bx0, 0), min(bx1, W)
    if yb <= ya or xb <= xa: continue
    wood = s['material'] == 'wood'
    rng = np.random.default_rng(s['seed'])
    base = srgb_to_lin(np.array([0.80, 0.64, 0.44] if wood else [0.46, 0.46, 0.48], np.float32)) * (0.85 + 0.25 * rng.random())
    g = field(yb - ya, xb - xa, 1.0 / mm if wood else 3, s['seed'] + 2, xa, ya, (12, 1) if wood else (1, 1), np.pi / 2 + rng.normal(0, 0.08))
    bed[ya:yb, xa:xb] = base[None, None, :] * (1 + (0.10 if wood else 0.04) * g[..., None])
    block[ya:yb, xa:xb] = i
# block edges: a dark gap between neighbouring pieces
edge = (ndimage.grey_dilation(block, 5) != ndimage.grey_erosion(block, 5)) & (block >= 0)
bed[edge] *= 0.18
# the faces stand type-high above the shoulders: light from the top left
hgt = blur(face, 1.5)
gy, gx = np.gradient(hgt)
lit = 1 + 1.8 * (-gx * 0.6 - gy * 0.8)
stain = np.clip(0.55 + 0.25 * field(H, W, 6 / mm, 12), 0, 1)[..., None]                 # a century of ink worked into the faces
bare = bed * (1 - face[..., None]) + bed * (0.42 + 0.1 * fig[..., None]) * stain * face[..., None]
bare *= lit[..., None]
ink_face = np.array([0.012, 0.012, 0.013], np.float32)
sheen = 0.06 * np.clip(field(H, W, 18, 9, 0, 0, (1, 6), 0.0), 0, None)
inked = bed * (1 - face[..., None]) + (ink_face[None, None, :] + sheen[..., None] * np.array([0.9, 0.9, 1.0])) * face[..., None]
inked *= lit[..., None]
# after the pull: some ink stays on the faces (about half transfers)
spent = bed * (1 - face[..., None]) + (ink_face * 3 + sheen[..., None] * 0.6) * face[..., None]
spent *= lit[..., None]

# the back of the sheet: paper with the impression showing through as a faint emboss, and a little ink show-through
back = paper.rgb[:, ::-1] * 0.98
bump = blur(p1.layers[0][2][:, ::-1], 2.0)
bgy, bgx = np.gradient(bump)
back_imp = back * (1 + 0.7 * (bgx * 0.6 + bgy * 0.8))[..., None] * (1 - 0.06 * bump[..., None])
P1lin = srgb_to_lin(P1)
pz1l, pz2l = srgb_to_lin(pz1), srgb_to_lin(pz2)


def roller(img, yc, r):
    """An ink roller crossing the bed: a dark cylinder with a specular line and a soft shadow ahead of it."""
    out = img.copy()
    d = (yy - yc) / r
    inside = np.abs(d) < 1
    nz = np.sqrt(np.clip(1 - d * d, 0, 1))
    shade = 0.02 + 0.05 * nz + 0.5 * np.exp(-((d + 0.45) / 0.08) ** 2)
    cyl = np.array([0.9, 0.9, 1.0], np.float32)[None, None, :] * shade[..., None]
    out = np.where(inside[..., None], cyl, out)
    sh = np.clip(1 - np.abs((yy - yc - r * 1.05) / (r * 0.35)), 0, 1) * (yy > yc + r)
    return out * (1 - 0.55 * sh[..., None])


def frame(i):
    t = i / FPS
    if t < 1.0:                                  # the forme on the bed
        img = bare
    elif t < 2.2:                                # inking: the roller travels down, faces behind it are inked
        u = ease((t - 1.0) / 1.2); r = 25 / mm; yc = -r + u * (H + 2 * r)
        img = np.where((yy < yc)[..., None], inked, bare)
        img = roller(img, yc, r)
    elif t < 2.8:                                # the sheet comes down onto the forme from the top
        u = ease((t - 2.2) / 0.6)
        ys = -H + u * H                          # sheet's lower edge sits at ys + H
        sc = core.shift(back, 0, ys, 0)
        cov = (yy < ys + H)[..., None]
        shadow = 1 - 0.55 * np.clip(1 - (yy - (ys + H)) / 60, 0, 1) * (yy >= ys + H)
        img = np.where(cov, sc, inked * shadow[..., None])
    elif t < 3.3:                                # the platen: one hit, the sheet jolts and takes the impression
        u = (t - 2.8) / 0.5
        hit = np.exp(-((u - 0.2) / 0.08) ** 2)
        img = back * (1 - ease(u * 3)) + back_imp * ease(u * 3)
        img = core.shift(img, 0, 4 * hit, 0) * (1 - 0.25 * hit)
    elif t < 5.2:                                # the pull: the right edge lifts and folds back over to the left
        u = ease((t - 3.3) / 1.9)
        f = W - u * (W * 1.25)                   # fold line, px
        img = spent.copy()
        flat = xx < f
        img = np.where(flat[..., None], back_imp, img)
        x_src = 2 * f - xx                       # bed column whose ink is now up on the flap
        flap = (xx < f) & (x_src < W) & (x_src >= f)
        shiftp = int(round(W - 1 - 2 * f))
        cols = np.clip(xx + shiftp, 0, W - 1).astype(int)
        front = P1lin[yy.astype(int), cols]
        dist = (f - xx) / (W * 0.08)
        curl = 0.75 + 0.25 * np.clip(dist, 0, 1) + 0.12 * np.exp(-((dist - 0.25) / 0.15) ** 2)
        img = np.where(flap[..., None], front * curl[..., None], img)
        edge_x = 2 * f - W                       # the flap's free edge casts a shadow on the sheet below
        sh = np.clip(1 - (edge_x - xx) / 40, 0, 1) * (xx < edge_x) * (xx < f)
        img = img * (1 - 0.4 * sh[..., None])
    else:                                        # the pulled sheet, face up; the second colour lands; push in
        u = (t - 5.2)
        src = pz1l if t < 5.9 else pz2l
        z = 1.0 + 0.10 * ease((t - 5.2) / 2.3)
        hit = np.exp(-((t - 5.9) / 0.05) ** 2) if t >= 5.85 else 0
        # crop from the 1.5x render: view shrinks by z around the type block
        Hs, Ws = src.shape[:2]; cw, ch_ = Ws / z, Hs / z
        cx, cy = Ws * 0.45, Hs * 0.42
        x0 = int(np.clip(cx - cw * 0.45, 0, Ws - cw)); y0 = int(np.clip(cy - ch_ * 0.42, 0, Hs - ch_))
        crop = src[y0:int(y0 + ch_), x0:int(x0 + cw)]
        img = np.stack([ndimage.zoom(crop[..., k], (H / crop.shape[0], W / crop.shape[1]), order=1) for k in range(3)], -1)[:H, :W]
        if u < 0.12: img = img * ease(u / 0.12) + back_imp * (1 - ease(u / 0.12))
        if hit: img = core.shift(img, 0, 5 * hit, 0) * (1 - 0.2 * hit)
    return core.to_u8(lin_to_srgb(np.clip(img, 0, 1)))


try:
    import imageio_ffmpeg; FF = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FF = 'ffmpeg'
cmd = [FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
       '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', OUT]
pr = subprocess.Popen(cmd, stdin=subprocess.PIPE)
for i in range(N):
    pr.stdin.write(frame(i).tobytes())
    if i % 24 == 0: print('frame', i, flush=True)
pr.stdin.close(); pr.wait()
print('wrote', OUT)
