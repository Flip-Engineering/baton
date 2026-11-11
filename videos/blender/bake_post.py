#!/usr/bin/env python3
# CYCLES step 3b (system python3: numpy, scipy, PIL): turn the raw bake passes (web/labs/human8/bake_skin.mjs) into the maps Cycles reads.
#   python3 videos/blender/bake_post.py <export dir> [--atlases 0,1]
# Each island is dilated into the margins (every empty texel takes its nearest covered texel: scipy's distance transform), then:
#   skin_albedo_a<k>.png        sRGB albedo, the register as built (underwear painted when the export was bare)
#   skin_albedo_clean_a<k>.png  sRGB albedo with the underwear and the bust band off (the skin under clothes)
#   skin_uw_a<k>.png            the underwear mask (where the two albedos differ), softened by 1 texel
#   skin_normal_a<k>.png        16-bit tangent-space normal map (x = +u, y = +v, z = out), from lane B's micro-relief gradient
#   skin_rough_a<k>.png         lane B's roughness (with its Toksvig widening at the bake's texel), linear
#   skin_spec_a<k>.png          r: the oily lobe's weight, g: cavity AO, b: specular occlusion (linear)
#   cloth_metal.png             (garments, only when some texel is metallic: the shoe eyelets) metalness, linear
import sys, os, zlib, struct, time
import numpy as np
from PIL import Image
from scipy import ndimage

def png16(path, rgb):
    """a 16-bit RGB PNG (PIL cannot write one): rgb float 0..1, (h, w, 3)"""
    h, w, _ = rgb.shape
    a = np.clip(np.rint(rgb * 65535), 0, 65535).astype('>u2').reshape(h, w * 3)
    raw = b''.join(b'\x00' + a[y].tobytes() for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 16, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

def main():
    d = sys.argv[1]
    atl = [int(x) for x in (sys.argv[sys.argv.index('--atlases') + 1] if '--atlases' in sys.argv else '0,1').split(',')]
    m = os.path.join(d, 'maps')
    for a in atl:
        t0 = time.time()
        if not os.path.exists(os.path.join(m, f'raw_a{a}_p0.png')):
            continue
        raw = {p: np.asarray(Image.open(os.path.join(m, f'raw_a{a}_p{p}.png')).convert('RGBA')) for p in range(5) if os.path.exists(os.path.join(m, f'raw_a{a}_p{p}.png'))}
        cov = raw[0][..., 3] > 0
        _, idx = ndimage.distance_transform_edt(~cov, return_indices=True)
        fill = lambda x: x[idx[0], idx[1]]
        # the canvas's top row is the framebuffer's top (v = 1) and Blender reads a PNG's top row at v = 1: no flip
        flip = lambda x: x
        alb = fill(raw[0][..., :3])
        Image.fromarray(flip(alb)).save(os.path.join(m, f'skin_albedo_a{a}.png'))
        if 3 in raw:
            cln = fill(raw[3][..., :3])
            Image.fromarray(flip(cln)).save(os.path.join(m, f'skin_albedo_clean_a{a}.png'))
            uw = (np.abs(alb.astype(int) - cln.astype(int)).max(axis=2) > 3).astype(np.float32)
            uw = ndimage.uniform_filter(uw, 3)
            Image.fromarray(flip(np.clip(uw * 255, 0, 255).astype(np.uint8))).save(os.path.join(m, f'skin_uw_a{a}.png'))
        if 1 in raw:
            g = fill(raw[1]).astype(np.float32) / 255.0
            e = (g[..., :2] - 0.5) * 2.0
            gr = np.sign(e) * e * e
            n = np.stack([-gr[..., 0], -gr[..., 1], np.ones_like(gr[..., 0])], axis=2)
            n /= np.linalg.norm(n, axis=2, keepdims=True)
            png16(os.path.join(m, f'skin_normal_a{a}.png'), flip(n * 0.5 + 0.5))
            Image.fromarray(flip((g[..., 2] * 255).astype(np.uint8))).save(os.path.join(m, f'skin_rough_a{a}.png'))
            print(f'atlas {a}: micro-relief slope p50 {np.percentile(np.hypot(*gr[cov].T), 50):.4f} p99 {np.percentile(np.hypot(*gr[cov].T), 99):.4f}, roughness mean {g[..., 2][cov].mean():.3f}')
        if 2 in raw:
            Image.fromarray(flip(fill(raw[2][..., :3]))).save(os.path.join(m, f'skin_spec_a{a}.png'))
        if 4 in raw:   # SKIN OPTICS iteration 13: the column's transport, sqrt(l_d / 4 mm) per channel (lab_bake.js pass 4); none written when the shader had no transport plane
            ld = raw[4][..., :3]
            if cov.any() and float(ld[cov].mean()) > 2.0:
                Image.fromarray(flip(fill(ld))).save(os.path.join(m, f'skin_ld_a{a}.png'))
                q = (ld[cov].astype(np.float32) / 255.0) ** 2 * 4.0
                print(f'atlas {a}: transport l_d p5 / p50 / p95 (mm) R ' + ' / '.join(f'{x:.2f}' for x in np.percentile(q[:, 0], [5, 50, 95])) + ' G ' + ' / '.join(f'{x:.2f}' for x in np.percentile(q[:, 1], [5, 50, 95])) + ' B ' + ' / '.join(f'{x:.2f}' for x in np.percentile(q[:, 2], [5, 50, 95])))
            else:
                print(f'atlas {a}: pass 4 (transport) is empty: no skin_ld map (the person keeps one radius)')
        dp = os.path.join(m, f'raw_dressed_a{a}_p0.png')
        if os.path.exists(dp):   # the skin hero.js does not draw under a dressed person's clothes (its hCover discards)
            dc = np.asarray(Image.open(dp).convert('RGBA'))[..., 3] > 0
            cover = (cov & ~dc).astype(np.uint8) * 255
            Image.fromarray(flip(fill(cover))).save(os.path.join(m, f'skin_cover_a{a}.png'))
            print(f'atlas {a}: {100 * (cov & ~dc).sum() / max(1, cov.sum()):.1f} % of the skin is under the clothes')
        print(f'atlas {a}: coverage {cov.mean():.3f}, maps written in {time.time() - t0:.1f} s')
    # ---- garments (one atlas): albedo, tangent normal (already encoded), roughness
    if os.path.exists(os.path.join(m, 'cloth_a0_p0.png')):
        raw = {p: np.asarray(Image.open(os.path.join(m, f'cloth_a0_p{p}.png')).convert('RGBA')) for p in range(3) if os.path.exists(os.path.join(m, f'cloth_a0_p{p}.png'))}
        cov = raw[0][..., 3] > 0
        _, idx = ndimage.distance_transform_edt(~cov, return_indices=True)
        fill = lambda x: x[idx[0], idx[1]]
        Image.fromarray(fill(raw[0][..., :3])).save(os.path.join(m, 'cloth_albedo.png'))
        # where the engine's cloth shader DISCARDS (a shirt below its tuck, past a cuff, above the neckline: hero.js CLOTH_FRAG) the
        # garment is not there: inside the UV islands the bake's alpha is 0. Islands from the atlas itself (garment_uv.bin), the
        # margins take their nearest island texel's value, so only true discards go transparent
        guv_p = os.path.join(d, 'garment_uv.bin')
        if os.path.exists(guv_p):
            from PIL import ImageDraw
            U = np.fromfile(guv_p, dtype=np.float32).reshape(-1, 3, 2); Hh, Ww = cov.shape
            isl = Image.new('L', (Ww, Hh)); dr = ImageDraw.Draw(isl)
            for t in U:
                dr.polygon([(q[0] * Ww, (1 - q[1]) * Hh) for q in t], fill=255)
            isl = np.asarray(isl) > 0
            _, ix = ndimage.distance_transform_edt(~isl, return_indices=True)
            alpha = np.where(isl, cov, cov[ix[0], ix[1]])
            alpha = ndimage.binary_erosion(~alpha, iterations=1) == 0      # keep a 1-texel rim opaque at discard edges (bilinear)
            Image.fromarray((alpha * 255).astype(np.uint8)).save(os.path.join(m, 'cloth_alpha.png'))
            print(f'garments: {100 * (isl & ~cov).sum() / max(1, isl.sum()):.1f} % of the atlas islands are discarded by the engine')
        if 1 in raw:
            Image.fromarray(fill(raw[1][..., :3])).save(os.path.join(m, 'cloth_normal.png'))
        if 2 in raw:
            Image.fromarray(fill(raw[2][..., 0])).save(os.path.join(m, 'cloth_rough.png'))
            # pass 2 is (roughness, metalness, 0) (labs/human8/lab_bake.js): the metalness as its own map, FABRIC7 (8 Oct): the shoe eyelets are metal. Written only when some texel is metallic
            # (a garment atlas of all-dielectric cloth gets no file, so a person without metal builds exactly as before); person_scene.fabric_material_baked reads it when present.
            met = raw[2][..., 1]
            if met[cov].max() > 12:
                Image.fromarray(fill(met)).save(os.path.join(m, 'cloth_metal.png'))
                print(f'garments: metalness map written ({100 * (met[cov] > 128).mean():.2f} % of the covered texels metallic)')
        print(f'garments: coverage {cov.mean():.3f}, roughness mean {raw[2][..., 0][cov].mean() / 255 if 2 in raw else -1:.3f}')

if __name__ == '__main__':
    main()
