#!/usr/bin/env python3
"""FABRIC7 photograph side (HELPER FABRIC7-1): one cloth-only chest patch per clothed portrait / figure in the REFMEASURE photo library, the
SAME cloth_stats.stats() on it as on our plates. NUMBERS ONLY: no photograph is written anywhere but the local-only debug sheets
(videos/review/studio_human_c8/refs_local/fabric7/), results are keyed by manifest id.

Run under the MediaPipe venv (one MediaPipe process at a time, nice -n 10):
  nice -n 10 ~/.cache/acp_human/figvenv/bin/python photo_cloth.py detect            # pose landmarks + person mask per candidate -> ~/.cache/f7_scratch/photo/
  nice -n 10 ~/.cache/acp_human/figvenv/bin/python photo_cloth.py patches           # patch geometry, rejects, local contact sheets
  nice -n 10 ~/.cache/acp_human/figvenv/bin/python photo_cloth.py stats             # cloth_stats at 0.6 and 1.5 mm/px for the survivors (needs cloth_labels.csv from the eye pass)
"""
import csv, json, math, os, sys, time
import numpy as np
import cv2
from PIL import Image, ImageOps
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'refmeasure'))
import cloth_stats as CS
import rm_common as C
import derive

SCR = os.path.expanduser('~/.cache/f7_scratch/photo'); os.makedirs(SCR, exist_ok=True)
LOCAL = os.path.join(C.C8, 'refs_local', 'fabric7'); os.makedirs(LOCAL, exist_ok=True)
MEAS = CS.OUTDIR
BARE = ('nude', 'swim', 'leotard', 'sport bra', 'bikini', 'drape', 'underwear', 'briefs', 'shirtless', 'semi-nude', 'topless')
MAXSIDE = 1600            # MediaPipe pose runs on at most this many px (its input is 256 px anyway); landmarks are scaled back to the full photograph
SCALES = (0.6, 0.9, 1.5, 2.2)       # mm/px: 0.6 '1:1 bust', 0.9 the finest the photographs reach (extra), 1.5 'row full' (the brief), 2.2 integration 6's row full as drawn (4320 px / 9.45 m)
BIACROMIAL = {'f': 380.0, 'm': 410.0}     # mm: the brief's standard bi-acromial breadth, divided by the shoulder-joint distance in px


def load_full(path):
    return np.asarray(ImageOps.exif_transpose(Image.open(path)).convert('RGB'))


def candidates():
    out = []
    for r in C.typical():
        p = C.photo_path(r)
        if not (p and os.path.isfile(p)): continue
        if r['view'] not in ('front', 'q34') or r['crop'] not in ('close_head_neck', 'full', 'detail'): continue
        cl = (r['clothing'] or '').lower()
        if any(b in cl for b in BARE): continue
        out.append(r)
    return out


# ------------------------------------------------------------------ stage 1: pose
def stage_detect():
    lmk = derive.load_landmarker()
    cs = candidates(); print(len(cs), 'candidates', flush=True); t0 = time.time()
    for i, r in enumerate(cs):
        f = os.path.join(SCR, r['id'] + '.npz')
        if os.path.exists(f): continue
        full = load_full(C.photo_path(r)); H, W = full.shape[:2]; s = min(1.0, MAXSIDE / max(H, W))
        rgb = cv2.resize(full, (int(round(W * s)), int(round(H * s))), interpolation=cv2.INTER_AREA) if s < 1 else full
        det = derive.detect(lmk, rgb)
        if det is None: np.savez_compressed(f, ok=0, size=[W, H]); print(i, r['id'], 'no pose', flush=True); continue
        L = det['L'].copy(); L[:, :2] /= s; L[:, 2] /= s
        M = (det['M'] > 0.5).astype(np.uint8) if det['M'] is not None else np.zeros(rgb.shape[:2], np.uint8)
        np.savez_compressed(f, ok=1, size=[W, H], L=L, W=det['W'], M=M, scale=s, n=det['n'])
        if i % 20 == 0: print(i, r['id'], f'{time.time() - t0:.0f}s', flush=True)
    print('done', flush=True)


# ------------------------------------------------------------------ stage 2: patch geometry and the automatic rejects
PATCH_SIDE, PATCH_DROP = 0.30, 0.28          # x the shoulder-joint distance d: the square's side; its centre's distance below the mid-shoulder line
PD = os.path.join(SCR, 'patches'); os.makedirs(PD, exist_ok=True)


def skin_frac(rgb):
    lab = CS.lab_of(rgb); C_ = np.hypot(lab[..., 1], lab[..., 2]); hue = np.degrees(np.arctan2(lab[..., 2], lab[..., 1])) % 360
    return float(((hue > 15) & (hue < 80) & (C_ > 4)).mean())


def clip_frac(rgb):
    Y = CS.srgb_to_lin(rgb.astype(np.float64)) @ np.array([0.2126, 0.7152, 0.0722])
    return float(((Y < 0.01) | (Y > 0.95)).mean())


def grad_frac(rgb):
    L = CS.lab_of(rgb)[..., 0].astype(np.float32)
    gx = cv2.Sobel(L, cv2.CV_32F, 1, 0, ksize=3); gy = cv2.Sobel(L, cv2.CV_32F, 0, 1, ksize=3); g = np.hypot(gx, gy)[1:-1, 1:-1]
    return float((g > 4 * (np.median(g) + 1e-6)).mean())


def cut_patch(full, centre, side, ang):
    """a side x side square of the photograph centred on centre, rotated by ang degrees (the shoulder line's tilt) so its y is the garment's vertical;
    an integer crop when the tilt is under 1.5 degrees (no resampling), else a cubic warp"""
    s = int(round(side)); cx, cy = centre
    if abs(ang) < 1.5:
        x0, y0 = int(round(cx - s / 2)), int(round(cy - s / 2)); return full[y0:y0 + s, x0:x0 + s].copy()
    a = math.radians(ang); R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    # output (u, v) -> source = centre + R (u - s/2, v - s/2)
    Mi = np.zeros((2, 3)); Mi[:, :2] = R; Mi[:, 2] = np.array([cx, cy]) - R @ np.array([s / 2, s / 2])
    return cv2.warpAffine(full, Mi, (s, s), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT)


def geometry(r, z):
    """shoulder landmarks -> d, tilt, yaw, patch centre; a dict with reasons (list of reject strings)"""
    g = dict(id=r['id'], sex=r['sex'], age_band=r['age_band'], background_group=r['background_group'], view=r['view'], crop=r['crop'], pose=r['pose'],
             shard=r['shard'], clothing=r['clothing'], reasons=[])
    W_, H_ = [int(v) for v in z['size']]; g['px'] = [W_, H_]
    if not int(z['ok']): g['reasons'].append('no pose'); return g
    L = z['L']; Wd = z['W']; ls, rs = L[derive.I['l_shoulder']], L[derive.I['r_shoulder']]
    g['vis'] = [round(float(ls[3]), 2), round(float(rs[3]), 2)]
    v = ls[:2] - rs[:2]
    if v[0] < 0: v = -v
    d = float(np.hypot(*v)); tilt = math.degrees(math.atan2(v[1], v[0])); g['d_px'] = round(d, 1); g['tilt'] = round(tilt, 1)
    wv = Wd[derive.I['l_shoulder']] - Wd[derive.I['r_shoulder']]; g['yaw'] = round(math.degrees(math.atan2(abs(wv[2]), abs(wv[0]) + 1e-9)), 1)
    g['mm_px'] = round(BIACROMIAL[r['sex']] / d, 3)
    if min(ls[3], rs[3]) < 0.5: g['reasons'].append('shoulders not visible'); return g
    if abs(tilt) > 25: g['reasons'].append(f'tilted {tilt:.0f} deg')
    if g['yaw'] > 50: g['reasons'].append(f'turned {g["yaw"]:.0f} deg')      # the world-landmark yaw is noisy (front photographs read 2-32 deg at p10-p90): only a clear turn is a reject
    mid = (ls[:2] + rs[:2]) / 2; down = np.array([-math.sin(math.radians(tilt)), math.cos(math.radians(tilt))])
    ctr = mid + PATCH_DROP * d * down; side = PATCH_SIDE * d; g['centre'] = [round(float(ctr[0]), 1), round(float(ctr[1]), 1)]; g['side'] = round(side, 1)
    half = side / 2 * (abs(math.cos(math.radians(tilt))) + abs(math.sin(math.radians(tilt))))
    if ctr[0] - half < 0 or ctr[1] - half < 0 or ctr[0] + half > W_ or ctr[1] + half > H_: g['reasons'].append('patch outside the frame'); return g
    nose = L[derive.I['nose']]
    if nose[3] > 0.5 and nose[1] > mid[1]: g['reasons'].append('head below the shoulders')
    M = z['M']; s = float(z['scale']); mm = M[int(max(0, (ctr[1] - half) * s)):int((ctr[1] + half) * s) + 1, int(max(0, (ctr[0] - half) * s)):int((ctr[0] + half) * s) + 1]
    g['mask_cover'] = round(float(mm.mean()), 3) if mm.size else 0.0
    if g['mask_cover'] < 0.95: g['reasons'].append(f'patch not on the person mask ({g["mask_cover"]:.2f})')
    return g


def stage_patches():
    recs = []; cs = candidates()
    for r in cs:
        z = np.load(os.path.join(SCR, r['id'] + '.npz')); g = geometry(r, z)
        if 'centre' in g and not any(x.startswith('patch outside') for x in g['reasons']) or ('centre' in g and False):
            pass
        if 'centre' in g and 'patch outside the frame' not in g['reasons']:
            full = load_full(C.photo_path(r)); tilt = g['tilt']
            P = cut_patch(full, g['centre'], g['side'], tilt)
            np.save(os.path.join(PD, r['id'] + '.npy'), P)
            g['skin_frac'] = round(skin_frac(P), 4); g['clip_frac'] = round(clip_frac(P), 4); g['grad_frac'] = round(grad_frac(P), 4)
            if g['mm_px'] > SCALES[-1] * 1.02: g['reasons'].append(f'coarser than every scale ({g["mm_px"]:.1f} mm/px)')
            if g['skin_frac'] > 0.08: g['reasons'].append(f'skin-like {100 * g["skin_frac"]:.0f}%')
            if g['clip_frac'] > 0.04: g['reasons'].append(f'clipped {100 * g["clip_frac"]:.0f}%')
            if g['grad_frac'] > 0.03: g['reasons'].append(f'print/seam/edge (gradient {100 * g["grad_frac"]:.1f}%)')
        recs.append(g)
    json.dump(recs, open(os.path.join(SCR, 'geometry.json'), 'w'), indent=1)
    import collections
    first = collections.Counter((g['reasons'][0].split(' (')[0].split(' ')[0] + (' ' + g['reasons'][0].split(' ')[1] if g['reasons'] and g['reasons'][0].startswith(('shoulders', 'patch', 'head')) else '')) if g['reasons'] else 'pass' for g in recs)
    print(len(recs), 'candidates;', first)
    ok = [g for g in recs if not g['reasons']]
    print('pass the automatic tests:', len(ok), collections.Counter(g['sex'] for g in ok))
    for sc in SCALES: print(' mm/px <=', sc, ':', sum(1 for g in ok if g['mm_px'] <= sc * 1.02), 'of', len(ok))


# ------------------------------------------------------------------ stage 3: LOCAL contact sheets (refs_local, never committed) for the eye pass
def reason_kind(g):
    """which automatic tests a patch failed: a sorted tuple of 'skin', 'clip', 'grad', 'geom'"""
    k = set()
    for x in g['reasons']:
        k.add('skin' if x.startswith('skin') else 'clip' if x.startswith('clipped') else 'grad' if x.startswith('print') else 'geom' if not x.startswith('coarser') else 'coarse')
    return tuple(sorted(k))


def sheet(tag, items, geo, per=15, cols=3):
    from PIL import ImageDraw
    ids = [g['id'] for g in items]
    for s0 in range(0, len(items), per):
        chunk = items[s0:s0 + per]; rows_ = math.ceil(len(chunk) / cols); CW, CH = 372, 210
        sh = Image.new('RGB', (cols * CW, rows_ * CH), (40, 40, 40)); dr = ImageDraw.Draw(sh)
        for i, g in enumerate(chunk):
            r = geo[g['id']]; full = Image.open(C.photo_path(r)); full = ImageOps.exif_transpose(full).convert('RGB')
            P = Image.fromarray(np.load(os.path.join(PD, g['id'] + '.npy'))).resize((190, 190), Image.LANCZOS)
            ctx = full.copy(); k = 190 / max(ctx.size); ctx = ctx.resize((max(1, int(ctx.width * k)), max(1, int(ctx.height * k))), Image.LANCZOS); dd = ImageDraw.Draw(ctx)
            cx, cy = g['centre']; hs = g['side'] / 2
            dd.rectangle([(cx - hs) * k, (cy - hs) * k, (cx + hs) * k, (cy + hs) * k], outline=(255, 0, 255))
            ox, oy = (i % cols) * CW, (i // cols) * CH
            sh.paste(P, (ox + 4, oy + 16)); sh.paste(ctx, (ox + 198, oy + 16))
            dr.text((ox + 4, oy + 2), f"#{s0 + i} {g['sex']} d{g['d_px']:.0f} {g['mm_px']:.2f}mm sk{100 * g['skin_frac']:.0f} cl{100 * g['clip_frac']:.0f} gr{100 * g['grad_frac']:.1f} {g['clothing'][:14]}", fill=(255, 255, 255))
        out = os.path.join(LOCAL, f'sheet_{tag}_{s0 // per:02d}.jpg'); sh.save(out, quality=88); print(out)


def stage_sheets(which):
    geo = {r['id']: r for r in candidates()}; recs = json.load(open(os.path.join(SCR, 'geometry.json')))
    inside = [g for g in recs if 'skin_frac' in g and not any(x.startswith(('tilted', 'turned', 'head', 'patch not')) for x in g['reasons'])]
    sel = {'pass': [g for g in inside if not g['reasons']], 'grad': [g for g in inside if reason_kind(g) == ('grad',)],
           'skin': [g for g in inside if reason_kind(g) == ('skin',)], 'clip': [g for g in inside if reason_kind(g) == ('clip',)],
           'multi': [g for g in inside if len(reason_kind(g)) > 1]}[which]
    json.dump([g['id'] for g in sel], open(os.path.join(SCR, f'sheet_{which}.json'), 'w'))
    print(which, len(sel)); sheet(which, sel, geo)


# ------------------------------------------------------------------ stage 4: the eye pass (labels keyed by manifest id) and the stats
# cloth class by eye: knit (tee / jersey / polo / stretch knit), woven (shirt: poplin / oxford / chambray), twill (denim / twill / canvas), other.
# Decisions made on the local contact sheets (refs_local/fabric7/sheet_*.jpg); 'keep' False = dropped by eye with the reason.
EYE = {
    'c2f2_ov_30s_standing_front_d0ec82': dict(keep=True, cls='other', note='woven shawl / sari over the chest (plain weave): not a top'),
    'c2f2_ov_20s_standing_front_20f5f1': dict(keep=True, cls='knit', note='dark stretch-knit dress; high-ISO noise visible, so hp_cv is partly sensor noise'),
    'c3_f_ov_30s_portrait_front_7ceaca': dict(keep=False, cls='knit', note='black tee but a long hair lies across the patch (a vertical line would inflate lane_ratio)'),
    'c3_f_ov_40s_standing_front_58da77': dict(keep=True, cls='other', note='navy cardigan / sweater knit'),
    'c3_m_ov_60s_portrait_front_1ba773': dict(keep=False, cls='woven', note='regular dot pattern (halftone-like print or moire), not weave'),
    'c3_m_ov_20s_portrait_front_791929': dict(keep=True, cls='knit', note='black polo / tee'),
    'c3_m_ov_40s_portrait_front_5924cf': dict(keep=True, cls='knit', note='black tee'),
    'c3_f_ov_40s_portrait_q34_6b94bb': dict(keep=True, cls='knit', note='burgundy matte top, probably stretch knit'),
    'c3_f_ov_20s_portrait_q34_46c0c8': dict(keep=True, cls='knit', note='yellow tee'),
    'c3_f_ov_50s_portrait_front_322472': dict(keep=False, cls='other', note='embroidered yarn motif on knitwear'),
    'c3_f_ov_20s_portrait_front_9e8130': dict(keep=True, cls='other', note='woven shawl / wrap (teal), not a top'),
    'c3_m_ov_20s_portrait_front_87cc20': dict(keep=True, cls='knit', note='blue-grey tee'),
    'c3_m_ov_30s_portrait_q34_e4aec1': dict(keep=False, cls='other', note='chunky knit scarf, not a top'),
    'c3_f_ov_40s_portrait_front_b1fd00': dict(keep=True, cls='knit', note='grey heather tee'),
    'c3_m_ov_30s_portrait_front_8c6c61': dict(keep=True, cls='knit', note='red tee: the skin-like rule (hue 15-80, chroma > 4) flags saturated red cloth, 100 %; kept by eye (clean cloth, no skin)', skin_override=True),
    'c3_f_ov_30s_portrait_front_2e4d1d': dict(keep=False, cls='other', note='lace / beadwork'),
    'c3_f_ov_40s_portrait_front_b4d6d3': dict(keep=False, cls='other', note='fur trim, not a top'),
    'sketchdaily_m50_hands_front_0cb59d': dict(keep=False, cls='other', note='not cloth (an object)'),
}
STAT_KEYS = ['Y', 'hp_cv', 'mid_cv', 'low_cv', 'lane_ratio', 'lane_len_y', 'lane_len_x', 'dL', 'dC', 'L', 'cr_val']


def stage_stats():
    recs = json.load(open(os.path.join(SCR, 'geometry.json'))); out = {}
    for g in recs:
        o = dict(sex=g['sex'], age_band=g['age_band'], background_group=g['background_group'], view=g['view'], crop=g['crop'],
                 mm_per_px=g.get('mm_px'), shoulder_px=g.get('d_px'), tilt_deg=g.get('tilt'), yaw_deg=g.get('yaw'), patch_px=None,
                 skin_frac=g.get('skin_frac'), clip_frac=g.get('clip_frac'), grad_frac=g.get('grad_frac'), cloth_class=None, keep=False, reject=None, note=None, stats={})
        auto = [x for x in g['reasons']]
        e = EYE.get(g['id'])
        if e:
            o['cloth_class'] = e['cls']; o['note'] = e['note']
            if e.get('skin_override'): auto = [x for x in auto if not x.startswith('skin')]
        if auto: o['reject'] = '; '.join(auto)
        elif e and not e['keep']: o['reject'] = 'eye: ' + e['note']
        elif not e: o['reject'] = 'not reviewed'
        else: o['keep'] = True
        # stats for every patch that passed the automatic tests (kept or dropped by eye: the dropped ones are listed, not pooled)
        if not auto and e:
            P = np.load(os.path.join(PD, g['id'] + '.npy')); o['patch_px'] = int(P.shape[0])
            for sc in SCALES:
                if g['mm_px'] <= sc * 1.02: st = CS.stats(P, g['mm_px'], sc); o['stats'][str(sc)] = {k: st[k] for k in STAT_KEYS if k in st} | {'n_px': st['px'], 'hp_code': CS.hp_code(P, g['mm_px'], sc)}
        out[g['id']] = o
    meta = dict(rules=dict(patch='square, side 0.30 x shoulder-joint distance d, centre 0.28 d below the mid-shoulder line, rotated by the shoulder line tilt (tilt > 25 deg or world-landmark yaw > 50 deg rejected; both shoulders visible >= 0.5; the whole patch inside the frame and on the pose mask)',
                      scale='mm/px = 380 / d (women), 410 / d (men): a standard bi-acromial breadth (the brief); foreshortening of a turned q34 torso is NOT corrected (yaw is listed per photograph; it is noisy)',
                      rejects='skin-like (hue 15-80, chroma > 4) > 8 %; clipped (Y < 0.01 or > 0.95 linear) > 4 %; Sobel(L*) share above 4 x the patch median > 3 %; then the eye pass (EYE in photo_cloth.py)'),
                scales_mm_per_px=list(SCALES), stats_instrument='videos/scripts/fabric7/cloth_stats.py stats(rgb, mm_in, mm_out)',
                n_candidates=len(recs))
    json.dump(dict(meta=meta, photographs=out), open(os.path.join(SCR, 'photo_stats.json'), 'w'), indent=1)
    kept = [k for k, v in out.items() if v['keep']]
    print('kept', len(kept)); import collections
    for sc in SCALES: print(sc, sum(1 for k in kept if str(sc) in out[k]['stats']), collections.Counter(out[k]['sex'] for k in kept if str(sc) in out[k]['stats']))
    return out


# ------------------------------------------------------------------ stage 5: OUR plates, the same stats on matched patches, and the output tables
ROW_PLATE = os.path.join(CS.ROW, 'row6_dressed_studio5_full.png')
ROW_MM = 4320 / 9.45 and 1000.0 / (4320 / 9.45)          # mm/px of the full row at the figure plane: a 12-person row, 0.75 m a slot, half width 5.5 x 0.75 + 0.6 m = 4.725 m: 4320 px / 9.45 m = 457 px/m
ROW_SLOT, ROW_NAMES = 343.1, ['L08', 'L21', 'L22', 'L11', 'L20', 'L17', 'L12', 'L03', 'L14', 'L23', 'L06', 'L05']
SEX_OF = {'L08': 'f', 'L21': 'm', 'L22': 'f', 'L11': 'm', 'L20': 'f', 'L17': 'm', 'L12': 'f', 'L03': 'm', 'L14': 'f', 'L23': 'm', 'L06': 'f', 'L05': 'm'}
CLS_OF = {'L08': 'knit', 'L21': 'knit', 'L22': 'woven', 'L11': 'knit', 'L17': 'knit', 'L12': 'twill', 'L03': 'woven', 'L23': 'twill', 'L06': 'knit', 'L05': 'woven'}
FAB_OF = {'L08': 'heather jersey tee', 'L21': 'fleece sweatshirt', 'L22': 'scrub poplin', 'L11': 'jersey tee', 'L17': 'jersey tee', 'L12': 'canvas jacket', 'L03': 'oxford shirt',
          'L23': 'canvas chore coat', 'L06': 'jersey tee', 'L05': 'oxford shirt'}
ROW_WIN = {'L08': (15, 372), 'L21': (10, 335), 'L22': (-60, 323), 'L11': (-35, 330), 'L17': (60, 390), 'L12': (-5, 352), 'L03': (-27, 393), 'L23': (24, 322), 'L06': (66, 362), 'L05': (52, 327)}
# L20 (crossed forearms on the chest) and L14 (long hair and a hand on the chest) have no clean 52 px window in the row: left out


def stage_ours():
    out = {'bust': {}, 'row': {}}
    for nm, (what, (x0, y0, x1, y1)) in CS.BUST_BOXES.items():
        k = nm.split('_')[0]; sx = SEX_OF[k]; im = np.asarray(Image.open(os.path.join(CS.BUST, f'bust6_studio5_{nm}.png')).convert('RGB'))
        side = int(round(BIACROMIAL[sx] * PATCH_SIDE / 0.547)); bw, bh = x1 - x0, y1 - y0; sd = min(side, bw, bh)
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2; tile = im[cy - sd // 2:cy - sd // 2 + sd, cx - sd // 2:cx - sd // 2 + sd]; box = im[y0:y1, x0:x1]
        o = dict(sex=sx, cloth_class=CLS_OF[k], fabric=what, mm_per_px=0.547, tile_mm=round(sd * 0.547, 1), tile_px=sd, box=[x0, y0, x1, y1], matched={}, whole_box={})
        for sc in SCALES:
            o['matched'][str(sc)] = {q: v for q, v in CS.stats(tile, 0.547, sc).items() if q in STAT_KEYS or q == 'px'}
            o['whole_box'][str(sc)] = {q: v for q, v in CS.stats(box, 0.547, sc).items() if q in STAT_KEYS or q == 'px'}
        out['bust'][nm] = o
    im = np.asarray(Image.open(ROW_PLATE).convert('RGB'))
    for k, nm in enumerate(ROW_NAMES):
        if nm not in ROW_WIN: continue
        sx = SEX_OF[nm]; s = int(round(BIACROMIAL[sx] * PATCH_SIDE / ROW_MM)); cx = int(round(2160 + (k - 5.5) * ROW_SLOT)); dx, yy = ROW_WIN[nm]
        P = im[yy - s // 2:yy - s // 2 + s, cx + dx - s // 2:cx + dx - s // 2 + s]
        st = CS.stats(P, ROW_MM, 2.2)
        out['row'][nm] = dict(sex=sx, cloth_class=CLS_OF[nm], fabric=FAB_OF[nm], mm_per_px=round(ROW_MM, 3), patch_px=s, window_centre=[cx + dx, yy], stats={'2.2': {q: v for q, v in st.items() if q in STAT_KEYS or q == 'px'}})
    json.dump(out, open(os.path.join(SCR, 'ours.json'), 'w'), indent=1)
    return out


def _q(v):
    v = [x for x in v if x is not None]
    if not v: return None
    a = np.asarray(v, float); return dict(n=len(a), **{f'p{q}': float(np.percentile(a, q)) for q in (10, 25, 50, 75, 90)}, min=float(a.min()), max=float(a.max()))


def stage_write():
    P = json.load(open(os.path.join(SCR, 'photo_stats.json'))); ours = stage_ours()
    ph = P['photographs']; kept = {k: v for k, v in ph.items() if v['keep']}
    KEYS = ['hp_cv', 'mid_cv', 'low_cv', 'lane_ratio', 'dL', 'dC', 'L', 'cr_val', 'Y']
    groups = {'all kept': lambda v: True, 'women': lambda v: v['sex'] == 'f', 'men': lambda v: v['sex'] == 'm', 'knit tee/jersey': lambda v: v['cloth_class'] == 'knit',
              'other (shawl, cardigan)': lambda v: v['cloth_class'] == 'other', 'woven shirt': lambda v: v['cloth_class'] == 'woven', 'denim/twill/canvas': lambda v: v['cloth_class'] == 'twill'}
    dist = {}
    for sc in SCALES:
        dist[str(sc)] = {}
        for gn, f in groups.items():
            items = [v for v in kept.values() if f(v) and str(sc) in v['stats']]
            dist[str(sc)][gn] = dict(n=len(items), **{k: _q([v['stats'][str(sc)][k] for v in items]) for k in KEYS}) if items else dict(n=0)
    # sensitivity to the 380 / 410 mm assumption: MediaPipe on OUR OWN dressed-row figures (known 2.19 mm/px) reads shoulder landmarks 0.86-0.92 of that (see HELPER_DONE), so the
    # photographs' true mm/px is probably ~0.85 of the labelled one: the same patches with mm/px x 0.85
    sens = {}; KSENS = 0.85
    for sc in SCALES:
        its = []
        for gid, v in kept.items():
            if v['mm_per_px'] * KSENS <= sc * 1.02:
                its.append(CS.stats(np.load(os.path.join(PD, gid + '.npy')), v['mm_per_px'] * KSENS, sc))
        sens[str(sc)] = dict(n=len(its), **({k: _q([x[k] for x in its]) for k in KEYS} if its else {}))
    # ours: matched patch per person, at each scale; medians
    ours_sum = {}
    for sc in SCALES:
        b = [o['matched'][str(sc)] for o in ours['bust'].values()]
        ours_sum[str(sc)] = dict(bust={k: _q([x[k] for x in b]) for k in KEYS}, row=({k: _q([o['stats'][str(sc)][k] for o in ours['row'].values()]) for k in KEYS} if str(sc) == '2.2' else None))
    # the JSON
    out = dict(meta=dict(P['meta'], produced='8 Oct 2026 (HELPER FABRIC7-1)', note='numbers only, keyed by manifest id; no photograph, title, URL, author or file path appears here',
                         ours_row_mm_per_px=round(ROW_MM, 3), n_kept=len(kept), n_by_scale={str(sc): sum(1 for v in kept.values() if str(sc) in v['stats']) for sc in SCALES}),
               photographs=ph, distributions=dist, sensitivity_mm_px_x0_85=sens, ours=ours, ours_summary=ours_sum)
    json.dump(out, open(os.path.join(MEAS, 'photo_cloth_stats.json'), 'w'), indent=1)
    # the markdown
    fm = lambda x: '-' if x is None else (f'{x:.3f}' if abs(x) < 1 else f'{x:.2f}' if abs(x) < 10 else f'{x:.1f}')
    L = ['# FABRIC7 photograph side: cloth statistics of clothed chests, photographs against our plates (HELPER FABRIC7-1, 8 Oct)', '',
         'Numbers only, keyed by manifest id in photo_cloth_stats.json. Every statistic is `cloth_stats.stats()` on a cloth-only chest patch at a common scale; our plates are measured with the SAME code on a MATCHED patch (the same size in mm: 0.30 x 380 mm = 114 mm for women, 123 mm for men) so the patch size does not bias low_cv / cr_val.',
         '', '## How many photographs each scale could use', '',
         f"Candidates: {P['meta']['n_candidates']} (typical, kept, modern, front or q34, close_head_neck / full / detail, clothing not nude / swim / leotard / sport bra / drape).", '',
         '| stage | n |', '|---|---|']
    import collections
    grp = collections.Counter()
    for v in ph.values():
        if v['keep']: grp['KEPT: a cloth patch measured'] += 1; continue
        r = (v['reject'] or '').split(';')[0].strip()
        key = ('dropped by eye (hair on the patch, print / moire, embroidery, scarf, lace, fur, object)' if r.startswith('eye') else 'tilted > 25 deg or turned > 50 deg' if r.startswith(('tilted', 'turned'))
               else 'skin-like pixels > 8 %' if r.startswith('skin') else 'clipped (Y < 0.01 or > 0.95) > 4 %' if r.startswith('clipped') else 'print / seam / button / edge (gradient test) > 3 %' if r.startswith('print')
               else 'patch not wholly inside the frame (portrait cut above 0.43 d below the shoulder line)' if r.startswith('patch outside') else 'shoulder-derived mm/px coarser than 2.2' if r.startswith('coarser')
               else 'no pose found' if r.startswith('no pose') else 'shoulders not visible / head below the shoulders / off the person mask' if r.startswith(('shoulders', 'head', 'patch not')) else r)
        grp[key] += 1
    for k, n in sorted(grp.items(), key=lambda z: -z[1]): L.append(f'| {k} | {n} |')
    L += ['', '(first reason only; a patch can fail several tests)', '',
          '| scale (mm/px) | photographs that can be measured (shoulder-derived mm/px <= scale) | women | men |', '|---|---|---|---|']
    names = {0.6: "0.6 ('1:1 bust')", 0.9: '0.9 (extra: the finest the photographs reach)', 1.5: "1.5 ('row full' of the brief)", 2.2: "2.2 (integration 6's 'row full' as drawn: 4320 px / 9.45 m = 2.19 mm/px)"}
    for sc in SCALES:
        it = [v for v in kept.values() if str(sc) in v['stats']]
        L.append(f"| {names[sc]} | {len(it)} | {sum(1 for v in it if v['sex'] == 'f')} | {sum(1 for v in it if v['sex'] == 'm')} |")
    L += ['', '## Distributions, photographs | ours', '',
          'Photographs: p10..p90 over the kept patches (n shown; with n < 8 the percentiles are only a spread: min / max are in the JSON). Ours: the matched patch of each of our five integration-6 busts (bust6_studio5_*, 0.547 mm/px box-averaged to the scale), and at 2.2 also the ten dressed-row figures at their native 2.19 mm/px. ratio = ours p50 / photographs p50.', '']
    for sc in SCALES:
        d = dist[str(sc)]['all kept']; os_ = ours_sum[str(sc)]
        L += [f'### {names[sc]}', '']
        if d['n'] == 0:
            L += ['No photograph can be measured at this scale (the instrument refuses a patch coarser than the target); ours alone:', '',
                  '| statistic | ours busts p50 [min - max] |', '|---|---|']
            for k in KEYS: L.append(f"| {k} | {fm(os_['bust'][k]['p50'])} [{fm(os_['bust'][k]['min'])} - {fm(os_['bust'][k]['max'])}] |")
            L.append(''); continue
        L += ['| statistic | n | p10 | p25 | p50 | p75 | p90 | ours busts p50 [min - max] (n=5) | ratio | ' + ('ours row p50 [min - max] (n=10) | ratio |' if os_['row'] else ''),
              '|---|---|---|---|---|---|---|---|---|' + ('---|---|' if os_['row'] else '')]
        for k in KEYS:
            q = d[k]; ob = os_['bust'][k]; row = f"| {k} | {q['n']} | {fm(q['p10'])} | {fm(q['p25'])} | {fm(q['p50'])} | {fm(q['p75'])} | {fm(q['p90'])} | {fm(ob['p50'])} [{fm(ob['min'])} - {fm(ob['max'])}] | {fm(ob['p50'] / q['p50']) if q['p50'] else '-'} |"
            if os_['row']: orr = os_['row'][k]; row += f" {fm(orr['p50'])} [{fm(orr['min'])} - {fm(orr['max'])}] | {fm(orr['p50'] / q['p50']) if q['p50'] else '-'} |"
            L.append(row)
        L.append('')
        L += ['By group (n >= 8 would be needed for a gate; every group here is smaller, so the pooled row above is the one to read):', '',
              '| group | n | hp_cv p50 | mid_cv p50 | low_cv p50 | lane_ratio p50 | dL p50 | dC p50 | cr_val p50 |', '|---|---|---|---|---|---|---|---|---|']
        for gn, gd in dist[str(sc)].items():
            if gd['n']: L.append(f"| {gn} | {gd['n']}{'' if gd['n'] >= 8 else ' (n<8)'} | " + ' | '.join(fm(gd[k]['p50']) for k in ('hp_cv', 'mid_cv', 'low_cv', 'lane_ratio', 'dL', 'dC', 'cr_val')) + ' |')
        L.append('')
    L += ['## Sensitivity to the 380 / 410 mm shoulder-joint assumption', '',
          'The same pose pass (MediaPipe) on OUR dressed-row figures, whose scale is known (2.19 mm/px), reads the shoulder landmarks at 0.85 of 380 / 410 mm on average (women 0.83, men 0.87, range 0.74-0.92 over the 12 figures: see HELPER_DONE_FABRIC7-1.md). If real subjects behave the same, the true mm/px of every photograph is ~0.85 of the one used above (the photograph is finer-resolved than labelled, so its hp_cv is overstated a little). The same patches with mm/px x 0.85:', '',
          '| scale | n | hp_cv p50 (p10 - p90) | mid_cv p50 | dC p50 | dL p50 | lane_ratio p50 | cr_val p50 |', '|---|---|---|---|---|---|---|---|']
    for sc in SCALES:
        d_ = sens[str(sc)]
        if d_['n']: L.append(f"| {sc} | {d_['n']} | {fm(d_['hp_cv']['p50'])} ({fm(d_['hp_cv']['p10'])} - {fm(d_['hp_cv']['p90'])}) | {fm(d_['mid_cv']['p50'])} | {fm(d_['dC']['p50'])} | {fm(d_['dL']['p50'])} | {fm(d_['lane_ratio']['p50'])} | {fm(d_['cr_val']['p50'])} |")
        else: L.append(f'| {sc} | 0 | - | - | - | - | - | - |')
    L += ['', '## Ours, every patch', '', '| plate | person | sex | fabric | scale | patch (px) | hp_cv | mid_cv | low_cv | lane_ratio | dL | dC | L | cr_val |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for nm, o in ours['bust'].items():
        for sc in SCALES:
            s_ = o['matched'][str(sc)]; L.append(f"| bust 0.547 | {nm.split('_')[0]} | {o['sex']} | {o['fabric']} | {sc} | {s_['px'][0]}x{s_['px'][1]} | " + ' | '.join(fm(s_[k]) for k in ('hp_cv', 'mid_cv', 'low_cv', 'lane_ratio', 'dL', 'dC', 'L', 'cr_val')) + ' |')
    for nm, o in ours['row'].items():
        s_ = o['stats']['2.2']; L.append(f"| row full 2.19 | {nm} | {o['sex']} | {o['fabric']} | 2.2 | {s_['px'][0]}x{s_['px'][1]} | " + ' | '.join(fm(s_[k]) for k in ('hp_cv', 'mid_cv', 'low_cv', 'lane_ratio', 'dL', 'dC', 'L', 'cr_val')) + ' |')
    L += ['', '## Photographs, every measured patch (kept and dropped-by-eye, by manifest id)', '',
          '| id | sex | age band | background group | class | mm/px | patch px | keep | scale | hp_cv | mid_cv | low_cv | lane_ratio | dL | dC | L | cr_val | note |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for k, v in ph.items():
        for sc, s_ in v['stats'].items():
            L.append(f"| {k} | {v['sex']} | {v['age_band']} | {v['background_group']} | {v['cloth_class']} | {v['mm_per_px']} | {v['patch_px']} | {'yes' if v['keep'] else 'no'} | {sc} | " + ' | '.join(fm(s_[q]) for q in ('hp_cv', 'mid_cv', 'low_cv', 'lane_ratio', 'dL', 'dC', 'L', 'cr_val')) + f" | {v['note'] or ''} |")
    open(os.path.join(MEAS, 'photo_cloth_dist.md'), 'w').write('\n'.join(L) + '\n')
    print('\n'.join(L[:90]))


if __name__ == '__main__':
    a = sys.argv[1:]
    if a and a[0] == 'detect': stage_detect()
    elif a and a[0] == 'patches': stage_patches()
    elif a and a[0] == 'sheets': stage_sheets(a[1])
    elif a and a[0] == 'stats': stage_stats()
    elif a and a[0] == 'write': stage_write()
