#!/usr/bin/env python3
"""QUILT: example-based texture synthesis (Efros & Freeman 2001, image quilting with minimum-error boundary cuts).

    python3 videos/tools/imagelib/quilt.py SRC OUT [--size 2048] [--block 96] [--overlap 24] [--tol 0.1]
                                          [--tile] [--seed 1] [--scale 1] [--dihedral]
    python3 videos/tools/imagelib/quilt.py --lib tex_brick --size 2048 --tile      # SRC from the library manifest

A 256-512 px CC0 swatch becomes a 2048+ px texture with no visible repeat: blocks are chosen by SSD over the
overlap strips (OpenCV matchTemplate with a mask, so a 2048^2 output takes ~10-40 s on one core), picked at random
among candidates within (1+tol) of the best, and stitched along the dynamic-programming minimum-error cut.
--tile makes the result wrap (the last column/row of blocks is matched against the first), so it can repeat in a
shader with no seam. Output rows go into the manifest as derived textures that inherit the source's licence.
Why: repeated 512 px textures show as a grid on a 1080x1920 frame (VISUAL_BIBLE 'no repeated sprite textures').
"""
import argparse, json, os, time
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.abspath(os.path.join(HERE, '..', '..', 'sources', 'library'))


def min_cut(err):
    """err: (h, w) overlap error, cut runs top->bottom; returns a mask (h, w) True = take the new block."""
    h, w = err.shape; E = err.copy(); back = np.zeros((h, w), np.int8)
    for y in range(1, h):
        prev = E[y - 1]; l = np.r_[np.inf, prev[:-1]]; r = np.r_[prev[1:], np.inf]
        st = np.vstack([l, prev, r]); k = st.argmin(0); E[y] += st[k, np.arange(w)]; back[y] = k - 1
    m = np.zeros((h, w), bool); x = int(E[-1].argmin())
    for y in range(h - 1, -1, -1):
        m[y, x:] = True
        x = int(np.clip(x + back[y, x], 0, w - 1))
    return m


def quilt(src, size, B, O, tol, tile, rng, seams=()):
    S = src.astype(np.float32); sh, sw = S.shape[:2]; step = B - O
    n = int(np.ceil((size - O) / step)); N = n * step + O
    out = np.zeros((N, N, 3), np.float32); filled = np.zeros((N, N), bool)
    used = np.zeros((sh - B + 1, sw - B + 1), np.float32)     # reuse penalty: stops one distinctive block from tiling a pattern
    ban = np.zeros_like(used, bool)                           # atlas seams (--dihedral): no block may straddle a mirror line
    for ax, c in seams:
        if ax == 'x': ban[:, max(0, c - B + 1):c] = True
        else: ban[max(0, c - B + 1):c, :] = True
    for by in range(n):
        for bx in range(n):
            y, x = by * step, bx * step
            tgt = out[y:y + B, x:x + B]; msk = filled[y:y + B, x:x + B].astype(np.float32)
            if tile:                                           # wrap: the last blocks also match the first ones
                if bx == n - 1: tgt = tgt.copy(); tgt[:, B - O:] = out[y:y + B, 0:O]; msk = msk.copy(); msk[:, B - O:] = 1
                if by == n - 1: tgt = tgt.copy(); tgt[B - O:, :] = out[0:O, x:x + B]; msk = msk.copy(); msk[B - O:, :] = 1
            if msk.sum() == 0:
                py, px = rng.integers(0, (sh - B) if not seams else seams[1][1] - B), rng.integers(0, (sw - B) if not seams else seams[0][1] - B)
            else:
                m3 = np.repeat(msk[..., None], 3, 2)
                d = cv2.matchTemplate(S, tgt.astype(np.float32), cv2.TM_SQDIFF, mask=m3)
                d = np.maximum(d, 0); d = d * (1 + 1.5 * used); d[ban] = np.inf; best = d.min()
                cand = np.argwhere(d <= best * (1 + tol) + 1e-3)
                py, px = cand[rng.integers(len(cand))]
            r = B // 2; used[max(0, py - r):py + r, max(0, px - r):px + r] += 1
            blk = S[py:py + B, px:px + B].copy()
            take = np.ones((B, B), bool)
            def seam_l(a, b):          # vertical seam in the left strip: True right of the cut
                m = np.ones((B, B), bool); m[:, :O] = min_cut(((a - b) ** 2).sum(2)); return m
            if bx > 0: take &= seam_l(blk[:, :O], tgt[:, :O])
            if by > 0: take &= seam_l(blk[:O, :].transpose(1, 0, 2), tgt[:O, :].transpose(1, 0, 2)).T
            if tile and bx == n - 1:
                m = np.ones((B, B), bool); m[:, B - O:] = ~min_cut(((blk[:, B - O:] - tgt[:, B - O:]) ** 2).sum(2)); take &= m
            if tile and by == n - 1:
                m = np.ones((B, B), bool); m[B - O:, :] = ~min_cut(((blk[B - O:, :] - tgt[B - O:, :]) ** 2).sum(2).T).T; take &= m
            # feather the cut by 1.5 px so no hard pixel step survives
            w = cv2.GaussianBlur(take.astype(np.float32), (0, 0), 1.5)
            if bx == 0 and by == 0: w[:] = 1
            reg = out[y:y + B, x:x + B]
            reg[:] = reg * (1 - w[..., None]) + blk * w[..., None]
            filled[y:y + B, x:x + B] = True
    if tile:   # the wrap overlap is duplicated at the far edges: crop so the period is exact
        out = out[:N - O, :N - O]
    return out[:size, :size] if not tile else cv2.resize(out, (size, size), interpolation=cv2.INTER_AREA)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', nargs='?'); ap.add_argument('out', nargs='?'); ap.add_argument('--lib')
    ap.add_argument('--size', type=int, default=2048); ap.add_argument('--block', type=int, default=96)
    ap.add_argument('--overlap', type=int, default=24); ap.add_argument('--tol', type=float, default=0.25)
    ap.add_argument('--tile', action='store_true'); ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--scale', type=float, default=1.0); ap.add_argument('--dihedral', action='store_true')
    a = ap.parse_args()
    man = json.load(open(os.path.join(LIB, 'manifest.json')))
    if a.lib:
        row = man[a.lib]; a.src = os.path.join(LIB, row['file'])
        a.out = a.out or os.path.join(LIB, 'derived', f'{a.lib}.quilt{a.size}{"t" if a.tile else ""}.jpg')
    src = cv2.imread(a.src, cv2.IMREAD_COLOR)
    if a.scale != 1: src = cv2.resize(src, None, fx=a.scale, fy=a.scale, interpolation=cv2.INTER_AREA)
    seams = ()
    if a.dihedral:
        seams = (('x', src.shape[1]), ('y', src.shape[0]))   # isotropic textures: a 2x2 atlas of the swatch and its mirrors quadruples the choice of blocks
        src = np.vstack([np.hstack([src, src[:, ::-1]]), np.hstack([src[::-1], src[::-1, ::-1]])])
    t0 = time.time()
    out = quilt(src, a.size, a.block, a.overlap, a.tol, a.tile, np.random.default_rng(a.seed), seams)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    cv2.imwrite(a.out, np.clip(out, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f'{a.out}: {a.size}^2 in {time.time() - t0:.1f}s')
    if a.lib:
        man[a.lib].setdefault('derived', {})[f'quilt{a.size}{"t" if a.tile else ""}'] = os.path.relpath(a.out, LIB)
        json.dump(man, open(os.path.join(LIB, 'manifest.json'), 'w'), indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
