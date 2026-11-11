"""REFMEASURE board of OUR renders annotated with the measures (committed: no photograph on it). Sections: square-on faces with the face frame and patches drawn,
the posed bodies' silhouettes with the shoulder / waist / hip lines, the dressed front row with the leg widths at the knee and ankle, the lift frames with
the skeleton and its angles. Credit line: our renders of CAST's lineup; v5 faces carry FACE4's identity statistics (HSRD-100, Digital Reality Lab, CC BY 4.0).
    refmeasure.py board --tag v6 [--ours <dirs>]  ->  review/studio_human_c8/refmeasure/board_refmeasure_<tag>.jpg"""
import json, os
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
import rm_common as C
import facepass as FP
import m_body as MB
import m_motion as MM
import posepass as PP
import derive

CREDIT_V5 = 'v5 faces: face shape statistics from HSRD-100 scans, Digital Reality Lab, CC BY 4.0. Our renders of CAST\'s lineup; no reference photograph on this board.'
CREDIT_V6 = 'Our renders of CAST\'s lineup (v6, face rev 7); instruments as revised 8 Oct (INSTRUMENTS REVISED in NOTES.md); no reference photograph on this board.'


def font(sz):
    for f in ('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', '/usr/share/fonts/dejavu/DejaVuSansMono.ttf'):
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


def face_tile(path, w=300, h=375, mm=None):
    """a plate with the face frame and the patches drawn: GREEN = a clean patch, RED = a patch the skin gate rejected (hair, shadow edge, spread). mm: the merged measures from ours_facepass (numbers, flags)"""
    rgb = FP.load_rgb(path); m, fr = FP.analyse(rgb, want=('geo',))
    mm = mm or m
    im = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    if fr is not None:
        sc = max(2, int(round(rgb.shape[1] / 540)))
        pt = lambda p: tuple(int(v) for v in p)
        g = (0, 255, 255); r = (80, 80, 255); b = (255, 160, 0); GOOD = (0, 255, 0); BAD = (0, 0, 255)
        # pupil line, stomion line, bizygomatic width, brow band, patches
        cv2.line(im, pt(fr.P(-1.6, 0)), pt(fr.P(1.6, 0)), g, sc)
        sto = fr.fy(FP.STO_U); cv2.line(im, pt(fr.P(-0.8, sto)), pt(fr.P(0.8, sto)), r, sc)
        cv2.line(im, pt(fr.L[FP.ZY_R, :2]), pt(fr.L[FP.ZY_L, :2]), b, sc)
        for (u, l) in ((FP.BROW_UP_R, FP.BROW_LO_R), (FP.BROW_UP_L, FP.BROW_LO_L)):
            for k in (1, 2, 3): cv2.line(im, pt(fr.L[u[k], :2]), pt(fr.L[l[k], :2]), (0, 200, 0), sc)
        def box(cx, cy, hx, hy, col):
            cv2.polylines(im, [np.array([fr.P(cx - hx, cy - hy), fr.P(cx + hx, cy - hy), fr.P(cx + hx, cy + hy), fr.P(cx - hx, cy + hy)]).astype(np.int32)], True, col, sc)
        yb = np.mean([fr.fy(105), fr.fy(334)]); y10 = fr.fy(10); box(0.0, yb + 0.45 * (y10 - yb), 0.25, 0.09, GOOD if mm.get('forehead') else BAD)
        for cid, side in ((FP.CHEEK_R, 'cheek_R'), (FP.CHEEK_L, 'cheek_L')):
            c = fr.F(fr.L[cid]); box(c[0], c[1], 0.14, 0.14, GOOD if (mm.get(side) or {}).get('ok') else BAD)
        if mm.get('hairline'):
            for sg in (-1, 1): cv2.circle(im, pt(fr.P(sg * 0.3, fr.fy(105 if sg < 0 else 334) - mm['hairline'])), 3 * sc, (255, 0, 255), -1)
    im = cv2.resize(im, (w, h), interpolation=cv2.INTER_AREA)
    return Image.fromarray(cv2.cvtColor(im, cv2.COLOR_BGR2RGB)), mm


def make(args):
    ver = args.tag
    from refmeasure import our_face_plates, people_list, tag_n, ours_facepass
    n = tag_n(ver)
    P = people_list(); fp = our_face_plates(args.ours, ver, args.stage)
    F9, F12, F16 = font(9), font(12), font(16)
    W, tw, th = 12 * 300, 300, 375
    secs = []
    # --- faces
    people = ours_facepass(args)
    sec = Image.new('RGB', (W, th + 110), (22, 22, 22)); d = ImageDraw.Draw(sec)
    for k, p in enumerate(P):
        pm = next(q for q in people if q['name'] == p['name']); m0 = pm['m']
        if p['name'] not in fp or 'error' in m0:
            why = m0.get('error', 'no plate') if 'error' in m0 else 'no plate'
            d.text((k * tw + 8, 8), f"{p['name'].split('_')[0]} {p['sex'].upper()}{p['age']} {p['bg'][:5]}", font=F12, fill=(200, 200, 200)); d.text((k * tw + 8, 28), why[:44], font=F9, fill=(255, 160, 120)); continue
        kind, path = fp[p['name']]; t, m = face_tile(path, tw, th, m0); sec.paste(t, (k * tw, 0))
        ok = abs(m.get('yaw', 1)) < FP.YAW_MAX
        kname = {'tele': 'tele (2.5 m)', 'front': 'square-on', 'face': 'lab_person face'}.get(kind, kind)
        line1 = f"{p['name'].split('_')[0]} {p['sex'].upper()}{p['age']} {p['bg'][:5]}  {kname}  yaw {m.get('yaw', 0):+.2f}" + ('' if ok else ' TURNED')
        raw = m.get('midface_h_w_raw'); line2 = f"mid/w {m.get('midface_h_w') or 0:.3f}" + (f"({raw:.3f})" if raw else '') + f" w {m.get('face_w') or 0:.2f} lv {m.get('lower_verm') or 0:.3f} br {m.get('brow_img') or 0:.3f}"
        fh, ch = m.get('forehead') or {}, m.get('cheek') or {}
        line3 = (f"fore L{fh.get('L', 0):.0f} a{fh.get('a', 0):.1f} h{fh.get('h', 0):.0f}  " if fh else 'fore REJECTED  ') + (f"cheek({ch.get('sides')}) a{ch.get('a', 0):.1f}  " if ch else 'cheek REJECTED  ') + f"hf {m.get('cheek_hf') if m.get('cheek_hf') is not None else '-'}"
        why = ' | '.join(m.get('cheek_reject') or []) or ''
        d.text((k * tw + 4, th + 4), line1, font=F9, fill=(240, 240, 240)); d.text((k * tw + 4, th + 20), line2, font=F9, fill=(160, 230, 255)); d.text((k * tw + 4, th + 36), line3, font=F9, fill=(255, 220, 160))
        for j in range(0, min(len(why), 150), 50): d.text((k * tw + 4, th + 54 + 12 * (j // 50)), why[j:j + 50], font=F9, fill=(255, 140, 140))
    secs.append(('FACE / SKIN / HAIR: pupil line (yellow), stomion (red), cheek width (blue), brow pairs (green), skin patches (GREEN = clean, RED = rejected: reason under the tile), hairline (magenta); IPD units; JPEG plates are refused', sec))
    # --- bodies
    D = args.bodies; bh = 520
    sec = Image.new('RGB', (W, bh + 40), (22, 22, 22)); d = ImageDraw.Draw(sec)
    for k, p in enumerate(P):
        try: o, img, res = MB.measure_body(D, f"{ver}_{p['name']}")
        except Exception as e: continue
        fl, un = res['_floor'], res['_unit']
        vis = cv2.cvtColor(img * 255, cv2.COLOR_GRAY2BGR)
        for key, col in (('shoulder', (0, 255, 255)), ('waist', (80, 80, 255)), ('hip', (255, 160, 0))):
            v = res['measures'].get(key)
            if v and v['value'] and v['at'] is not None: yy = int(round(fl - v['at'] * un)); cv2.line(vis, (0, yy), (vis.shape[1], yy), col, 3)
        s = bh / vis.shape[0]; vis = cv2.resize(vis, None, fx=s, fy=s); t = Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB))
        sec.paste(t, (k * tw + (tw - t.width) // 2, 0))
        d.text((k * tw + 4, bh + 4), f"{p['name'].split('_')[0]} sh {o['shoulder'] or 0:.3f} wa {o['waist'] or 0:.3f} hi {o['hip'] or 0:.3f}", font=F9, fill=(240, 240, 240))
    secs.append(('BODY: nude body silhouette over stature; shoulder (yellow), waist (red), hip (blue) lines; read against c2 + knee-normalised c4 together (results_body_*.csv; the raw c4 gate is retired)', sec))
    # --- legs on the dressed front row
    rowp = C.find_plates(args.ours, f'row{n}_dressed_studio5_full.png').get(f'row{n}_dressed_studio5_full')
    if rowp:
        rgb = np.asarray(Image.open(rowp).convert('RGB'))[:1000]; lh = 520
        sec = Image.new('RGB', (W, lh + 40), (22, 22, 22)); d = ImageDraw.Draw(sec)
        for k, p in enumerate(P):
            crop, x0 = PP.crop_cell(rgb, k, 12, pad=0.0)
            o = PP.run(crop, dict(id=p['name'], view='front', pose='standing', crop='full'))
            vis = cv2.cvtColor(crop, cv2.COLOR_RGB2BGR).copy(); txt = ''
            if o:
                res, m, det = o; fl, un = res['_floor'], res['_unit']; Lm = det['L']
                kh = float(np.mean([(fl - Lm[derive.I[f'{s}_knee'], 1]) / un for s in 'lr']))
                for hh, col in ((kh, (0, 255, 255)), (0.08, (80, 80, 255)), (0.12, (255, 160, 0))):
                    yy = int(round(fl - hh * un)); W_ = PP.leg_widths(m, Lm, fl, un, [round(hh, 3)])[round(hh, 3)]
                    cv2.line(vis, (0, yy), (vis.shape[1], yy), col, 2)
                    if W_[0] and W_[1]: txt += f"{(W_[0] + W_[1]) / 2:.3f} "
            s = lh / vis.shape[0]; vis = cv2.resize(vis, None, fx=s, fy=s); t = Image.fromarray(cv2.cvtColor(vis, cv2.COLOR_BGR2RGB))
            sec.paste(t.crop((0, 0, min(t.width, tw), t.height)), (k * tw, 0))
            d.text((k * tw + 4, lh + 4), f"{p['name'].split('_')[0]} knee/0.08/0.12: {txt}", font=F9, fill=(240, 240, 240))
        secs.append(('CLOTHING leg line: widths over stature at the knee (yellow), 0.08 (red: the ankle zone) and 0.12 (blue: the hem zone) of the dressed front row', sec))
    # --- the lift
    try:
        frames, fps = MM.frames_for(ver, args.ours, getattr(args, 'ours_given', True))
        pick = [int(t * fps) for t in (0.3, 1.5, 2.3, 3.2, 4.8, 5.8)]; pick = [min(len(frames) - 1, k) for k in pick]
        tiles = [Image.fromarray(cv2.cvtColor(MM.overlay_frame(frames[k]), cv2.COLOR_BGR2RGB)).crop((0, 100, 960, 480)) for k in pick]
        tw3 = W // 3; th3 = int(380 * tw3 / 960); sec = Image.new('RGB', (W, 2 * th3), (22, 22, 22))
        for i, t in enumerate(tiles): sec.paste(t.resize((tw3, th3), Image.LANCZOS), ((i % 3) * tw3, (i // 3) * th3))
        secs.append((f'MOTION lift ({ver}): the pose pass on frames at 0.3 1.5 2.3 3.2 4.8 5.8 s: elbow flexion, hip flexion and trunk lean (3-D MediaPipe), degrees; NO GATE, but the squat (hip 127, lean 76) is above all 6 photographed lifting rows (hip 9-89, lean 5-30)', sec))
    except Exception as e: print('lift strip skipped:', e)
    # --- assemble
    H = sum(s.height + 26 for _, s in secs) + 70
    board = Image.new('RGB', (W, H), (14, 14, 14)); dd = ImageDraw.Draw(board)
    dd.text((10, 8), f'REFMEASURE {ver}: the twelve with the measures drawn (numbers: results_*_{ver}.csv)', font=F16, fill=(255, 255, 255))
    dd.text((10, 32), CREDIT_V5 if ver == 'v5' else CREDIT_V6.replace('(v6, face rev 7)', f'({ver})') if ver != 'v6' else CREDIT_V6, font=F12, fill=(190, 190, 190))
    y = 60
    for cap, s in secs:
        dd.text((10, y + 2), cap, font=F12, fill=(255, 230, 120)); board.paste(s, (0, y + 22)); y += s.height + 26
    out = os.path.join(C.OUT, f'board_refmeasure_{ver}.jpg'); board.crop((0, 0, W, y + 6)).save(out, quality=88)
    print(out, board.size)
    return out
