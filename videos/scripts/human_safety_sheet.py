#!/usr/bin/env python3
"""human_safety_sheet.py: the raised-arm sheet (HUMAN studio, cycle 2), for a person to look at.

There is no gesture ban (client, 28 Sep). Every raised arm, at phone-feed size, in every rendering: each frame is shrunk
to 390x693 (the size it is seen in the feed), and a crop around every raised hand that the gesture measure listed
(lib/fx/gesture.js, via folk.gestures() / hero.gestures() in the lab, or the render audit out/.<scene>.people*.json for a
piece) is blown up 3x with nearest-neighbour, so a person can see how each pose reads. A crop the measure points at
(SALUTE_STRAIGHT, SALUTE_FOREARM: a straight raised arm or a forearm leaning forward) is labelled with the pointer; it is
a place to look, not a fail.

    python3 videos/scripts/human_safety_sheet.py --lab review/studio_human_c2/after \
        --pieces review/studio_human_c2/after/pieces --out review/studio_human_c2/after/safety_sheet_fists_feed.jpg

--lab DIR: reads DIR/checks.jsonl rows whose job is crowd:* / face:* / climb:* and their images.
--pieces DIR: reads DIR/<scene>.people.json (render.mjs stills audit) and DIR/<scene>_<t>.jpg.
Prints a JSON summary (arms, flags per row) and writes the sheet.
"""
import argparse
import glob
import json
import os

from PIL import Image, ImageDraw, ImageFont

FW, FH = 390, 693
K = FW / 1080
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'


def font(n):
    try:
        return ImageFont.truetype(FONT, n)
    except Exception:
        return ImageFont.load_default()


def row(title, img_path, arms, cols=6, crop=44, zoom=3):
    im = Image.open(img_path).convert('RGB').resize((FW, FH), Image.LANCZOS)
    cw, ch = crop * zoom, crop * zoom + 34
    n = max(1, len(arms))
    rows = (n + cols - 1) // cols
    H = max(FH, rows * ch) + 30
    out = Image.new('RGB', (FW + 12 + cols * (cw + 6), H), (18, 18, 18))
    d = ImageDraw.Draw(out)
    f1, f2 = font(15), font(11)
    d.text((6, 6), title, fill=(240, 240, 240), font=f1)
    feed = im.copy()
    dd = ImageDraw.Draw(feed)
    for a in arms:
        h = a.get('hand')
        if not h or h[0] is None:
            continue
        x, y = h[0] * K, h[1] * K
        col = (240, 200, 90) if a.get('flags') else (200, 200, 190)
        dd.rectangle([x - crop / 2, y - crop / 2, x + crop / 2, y + crop / 2], outline=col, width=1)
    out.paste(feed, (0, 30))
    for k, a in enumerate(arms):
        h = a.get('hand')
        if not h or h[0] is None:
            continue
        x, y = h[0] * K, h[1] * K
        c = im.crop((int(x - crop / 2), int(y - crop / 2), int(x + crop / 2), int(y + crop / 2))).resize((cw, cw), Image.NEAREST)
        ox, oy = FW + 12 + (k % cols) * (cw + 6), 30 + (k // cols) * ch
        out.paste(c, (ox, oy))
        look = [f for f in (a.get('flags') or []) if f != 'FIST_UNREADABLE']
        d.rectangle([ox, oy + cw, ox + cw, oy + ch - 4], fill=(70, 56, 20) if look else (32, 32, 30))
        d.text((ox + 3, oy + cw + 2), f"{a.get('name', '')[:14]}", fill=(255, 255, 255), font=f2)
        d.text((ox + 3, oy + cw + 16), ('look: ' + ','.join(look))[:22] if look else '', fill=(240, 210, 120), font=f2)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lab')
    ap.add_argument('--pieces')
    ap.add_argument('--out', required=True)
    ap.add_argument('--jobs', default='crowd:rim,crowd:lit,crowd:print,crowd:halftone')
    a = ap.parse_args()
    rows, summary = [], []
    if a.lab:
        seen = {}
        for line in open(os.path.join(a.lab, 'checks.jsonl')):
            try:
                r = json.loads(line)
            except Exception:
                continue
            seen[r['job']] = r            # the last run of each job wins
        for job in a.jobs.split(','):
            r = seen.get(job)
            if not r or not os.path.exists(os.path.join(a.lab, r['file'])):
                continue
            arms = r.get('gestures') or []
            nflag = sum(1 for g in arms if g.get('flags'))
            summary.append({'row': job, 'arms': len(arms), 'flags': nflag, 'hazards': r.get('hazards')})
            rows.append(row(f"{job} @feed 390x693: {len(arms)} raised arms, {nflag} to look at, crotch pairs {r.get('hazards')}",
                            os.path.join(a.lab, r['file']), arms))
    if a.pieces:
        for pj in sorted(glob.glob(os.path.join(a.pieces, '*.people.json'))):
            scene = os.path.basename(pj).split('.')[0]
            J = json.load(open(pj))
            arms = J.get('all') or []
            by_t = {}
            for g in arms:
                by_t.setdefault(g['t'], []).append(g)
            for g in J.get('flags') or []:
                if 'CROTCH' in g.get('flags', []):
                    by_t.setdefault(g['t'], [])
            tot = sum(len(v) for v in by_t.values())
            nflag = sum(1 for v in by_t.values() for g in v if g.get('flags'))
            summary.append({'row': scene, 'frames': J.get('frames'), 'arms': tot, 'flags': nflag, 'counts': J.get('counts')})
            for t, v in sorted(by_t.items()):
                if not v:
                    continue
                img = os.path.join(a.pieces, f'{scene}_{t:.2f}.jpg')
                if os.path.exists(img):
                    rows.append(row(f"{scene} {t:.2f}s @feed: {len(v)} raised arms, {sum(1 for g in v if g.get('flags'))} to look at",
                                    img, v[:36]))
    if not rows:
        raise SystemExit('nothing to draw')
    W = max(r.width for r in rows)
    sheet = Image.new('RGB', (W, sum(r.height for r in rows)), (10, 10, 10))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height
    sheet.save(a.out, quality=86)
    print(json.dumps({'sheet': a.out, 'rows': summary}, indent=1))


if __name__ == '__main__':
    main()
