#!/usr/bin/env python3
"""TYPE studio review sheets (cycle 1).

    python3 scripts/type_review.py reel  review/studio_type_c1/after/reel      -> reel_stills.jpg, reel_feed270.jpg
    python3 scripts/type_review.py strip review/studio_type_c1/after BEFORE_DIR AFTER_DIR [--gate-before R.json --gate-after R.json]
                                                                           -> bank_load_strip.jpg

reel: the 18 hero stills of a world-type lab (tools/type_reel.mjs wrote reel.json): a labelled full sheet, and a
feed-size twin (270 px wide cells) with the Reels/TikTok UI bands shaded red (top 14 %, bottom 35 %, the right
button rail) and every audited type block outlined (red only when it sits under those UI bands or is cropped by the frame
edge; how the type reads is judged on the stills).
strip: two rows per 10 s (before / after) of the 2 fps stills tools/type_strip.mjs wrote; a cell with type on screen
gets a red bar (the gate's OCR when a gate report is given, else the scene's own cue table / type audit).
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

W, H = 1080, 1920
SAFE = (60, 270, 960, 1250)


def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def ui_bands(im, k):
    """shade the phone UI zones on a cell scaled by k"""
    ov = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    w, h = im.size
    d.rectangle([0, 0, w, int(0.14 * H * k)], fill=(255, 0, 0, 70))
    d.rectangle([0, int(0.65 * H * k), w, h], fill=(255, 0, 0, 70))
    d.rectangle([int(SAFE[2] * k), int(0.14 * H * k), w, int(0.65 * H * k)], fill=(255, 0, 0, 40))
    return Image.alpha_composite(im.convert('RGBA'), ov)


def reel(d):
    R = json.load(open(os.path.join(d, 'reel.json')))
    cells = sorted(R['cells'], key=lambda c: c['k'])
    worlds = ['engraved', 'riso', 'highway', 'stamped', 'letterpress', 'skylight']
    lines = ['hook', 'chant', 'payoff']
    cw, ch, top, left, foot = 360, 640, 60, 120, 92
    sheet = Image.new('RGB', (left + 6 * cw, top + 3 * (ch + foot)), (18, 16, 16))
    dr = ImageDraw.Draw(sheet)
    for i, w in enumerate(worlds):
        dr.text((left + i * cw + 12, 16), w.upper(), fill=(240, 230, 210), font=font(26))
    feed = Image.new('RGB', (left + 6 * 270, top + 3 * 480), (18, 16, 16))
    fd = ImageDraw.Draw(feed)
    for i, w in enumerate(worlds):
        fd.text((left + i * 270 + 8, 18), w.upper(), fill=(240, 230, 210), font=font(20))
    for li, ln in enumerate(lines):
        dr.text((10, top + li * (ch + foot) + ch // 2), ln.upper(), fill=(240, 230, 210), font=font(24))
        fd.text((8, top + li * 480 + 230), ln.upper(), fill=(240, 230, 210), font=font(20))
    for c in cells:
        wi, li = worlds.index(c['world']), lines.index(c['line'])
        im = Image.open(os.path.join(d, c['hero']['file'])).convert('RGB')
        x, y = left + wi * cw, top + li * (ch + foot)
        sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
        chk = c['checks']
        issues = sorted({s for k in chk for it in k['items'] for s in it['issues']})
        ms = c.get('heroMs')
        col = (240, 90, 80) if issues else (230, 220, 200)
        dr.text((x + 8, y + ch + 6), f"{c['world']} {c['line']}", fill=(230, 220, 200), font=font(17))
        dr.text((x + 8, y + ch + 28), ('placement: ' + '; '.join(issues))[:40] if issues else '', fill=col, font=font(15))
        dr.text((x + 8, y + ch + 50), (f"{ms} ms frame+jpg" if ms else ''), fill=(230, 220, 200), font=font(15))
        # feed twin
        k = 270 / W
        small = ui_bands(im.resize((270, 480), Image.LANCZOS), k)
        sd = ImageDraw.Draw(small)
        for it in c['hero']['info']['items']:
            b = it['bbox']
            sd.rectangle([b['x1'] * k, b['y1'] * k, b['x2'] * k, b['y2'] * k], outline=(200, 200, 190, 255) if not it['issues'] else (255, 40, 40, 255), width=2)
        feed.paste(small.convert('RGB'), (left + wi * 270, top + li * 480))
    sheet.save(os.path.join(d, '..', 'reel_stills.jpg'), quality=88)
    feed.save(os.path.join(d, '..', 'reel_feed270.jpg'), quality=90)
    print('wrote', os.path.normpath(os.path.join(d, '..', 'reel_stills.jpg')), os.path.normpath(os.path.join(d, '..', 'reel_feed270.jpg')))


def gate_present(path):
    """per-sample text presence from a gate report (metrics.load.samples when saved) or None"""
    if not path or not os.path.exists(path):
        return None
    r = json.load(open(path))
    s = r.get('metrics', {}).get('load', {}).get('present')
    return {round(float(t), 2): bool(v) for t, v in s} if s else None


def strip(out, before, after, gb=None, ga=None, secs=30, fps=2):
    cw, chh, lab = 108, 192, 110
    per = 10 * fps
    rows = []
    B = json.load(open(os.path.join(before, 'strip.json')))
    A = json.load(open(os.path.join(after, 'strip.json')))
    gpB, gpA = gate_present(gb), gate_present(ga)
    Wd = lab + per * cw
    Ht = 70 + (secs // 10) * (2 * (chh + 8) + 30)
    im = Image.new('RGB', (Wd, Ht), (16, 14, 14))
    d = ImageDraw.Draw(im)

    def present(S, gp, k, t):
        if gp is not None:
            return gp.get(round(t, 2))
        info = S['rows'][k].get('info') if k < len(S['rows']) else None
        return bool(info and any(i.get('read', 1) >= 0.6 for i in info.get('items', [])))
    y = 60
    for seg in range(secs // 10):
        for name, S, gp, dirn in [('before v6', B, gpB, before), ('after c1', A, gpA, after)]:
            d.text((6, y + chh // 2 - 10), name, fill=(240, 230, 210), font=font(17))
            for j in range(per):
                k = seg * per + j
                t = k / fps
                p = os.path.join(dirn, f's{k:03d}.jpg')
                if not os.path.exists(p):
                    continue
                c = Image.open(p).convert('RGB').resize((cw - 4, chh), Image.LANCZOS)
                im.paste(c, (lab + j * cw, y))
                pr = present(S, gp, k, t)
                d.rectangle([lab + j * cw, y + chh + 1, lab + j * cw + cw - 5, y + chh + 6], fill=(230, 40, 40) if pr else (60, 60, 60))
            y += chh + 8
        d.text((lab, y), f'{seg * 10}-{seg * 10 + 10} s', fill=(200, 190, 170), font=font(15))
        y += 30

    def share(S, gp):
        n = min(len(S['rows']), secs * fps)
        v = [present(S, gp, k, k / fps) for k in range(n)]
        return sum(1 for x in v if x) / max(1, n)
    hdr = (f"PEOPLE'S BANK text load, 0-{secs} s at {fps} fps (red bar = type on screen, "
           f"{'gate OCR' if gpA is not None else 'scene cue table'}):  before {share(B, gpB):.0%}   after {share(A, gpA):.0%}")
    if A.get('load'):
        L = A['load']
        hdr += f"   | c1 plan: {L['share']:.0%} of the cut, {L['held']} held lines ({L['per30']:.1f}/30 s) + {L['slams']} slams"
    d.text((10, 16), hdr, fill=(250, 240, 220), font=font(19))
    im.save(os.path.join(out, 'bank_load_strip.jpg'), quality=86)
    print('wrote', os.path.join(out, 'bank_load_strip.jpg'))


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[0] == 'reel':
        reel(a[1])
    else:
        opt = lambda k: a[a.index(k) + 1] if k in a else None
        strip(a[1], a[2], a[3], opt('--gate-before'), opt('--gate-after'))
