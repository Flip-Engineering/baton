#!/usr/bin/env python3
"""MODELING c1: the before/after boards. Each board is the published frame(s), the OBJECTS c1 attempt (where one exists) and the
rebuild at a working size, then the same frames at 270 px (feed size); plus 1:1 crops of the places a model fails first.

  python3 videos/scripts/modeling_sheets.py all            (needs the published frames pulled into PUB and the after/ stills)
  python3 videos/scripts/modeling_sheets.py board same_hands

Published frames are pulled one at a time from the share archive (see review/studio_modeling_c1/before/NOTES.md) and deleted.
"""
import os, sys, glob
from PIL import Image, ImageDraw, ImageFont

VID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AFTER = os.path.join(VID, 'review/studio_modeling_c1/after')
BEFORE = os.path.join(VID, 'review/studio_modeling_c1/before')
OBJ = os.path.join(VID, 'review/studio_objects_c1/after')
PUB = os.environ.get('MODELING_PUB', '/tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad/pub')
WEB = os.path.join(VID, 'web')


def font(sz):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf']:
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def board(items, out, full_h=900, small_w=270, title=None, gap=8):
    """items: [(label, path)] -> row 1 at full_h tall, row 2 at small_w wide"""
    ims = [(l, Image.open(p).convert('RGB')) for l, p in items if p and os.path.exists(p)]
    if not ims: return
    r1 = [(l, im.resize((int(im.width * full_h / im.height), full_h), Image.LANCZOS)) for l, im in ims]
    r2 = [(l, im.resize((small_w, int(im.height * small_w / im.width)), Image.LANCZOS)) for l, im in ims]
    W = sum(i.width for _, i in r1) + gap * (len(r1) + 1); lab = 26
    H1 = full_h + lab; H2 = max(i.height for _, i in r2) + lab
    top = 34 if title else 0
    sheet = Image.new('RGB', (W, top + H1 + H2 + gap * 3), (14, 14, 14)); d = ImageDraw.Draw(sheet); f = font(15)
    if title: d.text((gap, 8), title, fill=(255, 255, 255), font=font(18))
    x = gap
    for l, im in r1: d.text((x, top + 4), l, fill=(240, 220, 60), font=f); sheet.paste(im, (x, top + lab)); x += im.width + gap
    x = gap; y = top + H1 + gap
    d.text((gap, y - 2), 'feed size: 270 px wide', fill=(170, 170, 170), font=f)
    for l, im in r2: sheet.paste(im, (x, y + lab)); x += im.width + gap
    sheet.save(out, quality=88); print('wrote', os.path.relpath(out, VID), sheet.size)


def crops(items, out, box, size=600, title=None):
    """1:1 crops (box in 1080x1920 px) of each frame, side by side"""
    ims = [(l, Image.open(p).convert('RGB').crop(box)) for l, p in items if p and os.path.exists(p)]
    if not ims: return
    W = sum(i.width for _, i in ims) + 8 * (len(ims) + 1); H = max(i.height for _, i in ims) + 30
    sheet = Image.new('RGB', (W, H + 4), (14, 14, 14)); d = ImageDraw.Draw(sheet); x = 8
    for l, im in ims: d.text((x, 5), l, fill=(240, 220, 60), font=font(14)); sheet.paste(im, (x, 26)); x += im.width + 8
    sheet.save(out, quality=90); print('wrote', os.path.relpath(out, VID), sheet.size)


def pub(name): return os.path.join(PUB, name)


BOARDS = {
    'same_hands': dict(title='SAME HANDS. (COMMON WEALTH 13.50-14.27 s): published v10, v12, the OBJECTS c1 cobot, and the MODELING rebuild (shot A: the 1936 lever, shot B: the same hand on the cobot wrist)',
        items=[('CW v10 13.6 ROBOTICS.', pub('cw10_13.6.jpg')), ('CW v12 13.6 SAME HANDS. (published)', pub('cw12_13.6.jpg')), ('CW v12 14.1 (published, 2nd cut)', pub('cw12_14.1.jpg')),
               ('OBJECTS c1 cobot (no hand)', os.path.join(OBJ, 'cobot_kit_0.60.jpg')), ('MODELING A 13.70: 1936 hand on the lever', os.path.join(AFTER, 'hands_final_13.70.jpg')), ('MODELING B 14.10: same hand on the 2026 cobot', os.path.join(AFTER, 'hands_final_14.10.jpg'))],
        out='01_same_hands_before_after.jpg'),
    'truck': dict(title='THE TRUCK. (MACHINES v1 3.9-5.4 s / OTF 10.1-11.5 s): the client poster, published, the OBJECTS c1 long-hood, and the modelled aero sleeper in the poster plate with the man in front',
        items=[('client poster (source)', os.path.join(WEB, 'assets/plate/trucker_wide_poster_original.jpg')), ('MACHINES v1 0.35', pub('mach1_0.35.jpg')), ('MACHINES v1 4.25 THE TRUCK.', pub('mach1_4.25.jpg')), ('OTF v7 10.5', pub('otf7_10.5.jpg')),
               ('OBJECTS c1 truck (no man)', os.path.join(OBJ, 'truck_kit_0.60.jpg')), ('MODELING 10.50', os.path.join(AFTER, 'truck_final_10.50.jpg')), ('MODELING 10.90', os.path.join(AFTER, 'truck_final_10.90.jpg'))],
        out='02_truck_before_after.jpg'),
    'port': dict(title='PORT NEWARK. (OWN THE FUTURE 12.93-13.87 s): published v2 (best earlier), v7 (what replaced it), the real terminal, and the modelled crane over five-high stacks (no OBJECTS c1 attempt exists for this slot)',
        items=[('OTF v2 13.1 PORT NEWARK.', pub('otf2_13.1.jpg')), ('OTF v2 14.2 100s OF TRUCKERS.', pub('otf2_14.2.jpg')), ('OTF v7 18.0', pub('otf7_18.0.jpg')), ('MODELING 13.40', os.path.join(AFTER, 'port_final_13.40.jpg')), ('MODELING 14.20', os.path.join(AFTER, 'port_final_14.20.jpg'))],
        out='03_port_before_after.jpg'),
}


def strip_from_plate(out):
    """the film alone beside the composites: Steel (1938) rod mill, frames at the same times, in the same portrait window"""
    import json
    d = os.path.join(WEB, 'assets/plate/steel_rod'); meta = json.load(open(os.path.join(d, 'meta.json'))); ts = [0.5, 1.5, 2.5, 3.5]
    row0, row1 = [], []
    cx, w = 0.55, 607
    for t in ts:
        i = int(t * 24); im = Image.open(os.path.join(d, 'color_%03d.jpg' % i)).convert('RGB'); x0 = int(cx * 1440 - w / 2)
        row0.append(('film alone t=%.1f' % t, im.crop((x0, 0, x0 + w, 1080)).resize((1080, 1920), Image.LANCZOS)))
        p = os.path.join(AFTER, 'mill_final_%.2f.jpg' % t)
        if os.path.exists(p): row1.append(('with the stand t=%.1f' % t, Image.open(p).convert('RGB')))
    h = 640; tiles = [(l, i.resize((int(i.width * h / i.height), h), Image.LANCZOS)) for l, i in row0 + row1]
    W = sum(i.width for _, i in tiles[:4]) + 40; H = 2 * h + 80
    sheet = Image.new('RGB', (W, H), (14, 14, 14)); dr = ImageDraw.Draw(sheet); x = 8
    for k, (l, i) in enumerate(tiles):
        if k == 4: x = 8
        y = 30 if k < 4 else 40 + h + 26
        dr.text((x, y - 24), l, fill=(240, 220, 60), font=font(14)); sheet.paste(i, (x, y)); x += i.width + 8
    sheet.save(out, quality=88); print('wrote', os.path.relpath(out, VID), sheet.size)


if __name__ == '__main__':
    a = sys.argv[1:]
    names = list(BOARDS) if not a or a[0] == 'all' else [a[-1]] if a[0] == 'board' else a
    for n in names:
        if n in BOARDS:
            b = BOARDS[n]; board(b['items'], os.path.join(AFTER, b['out']), title=b['title'])
    if not a or a[0] == 'all' or 'event' in a: strip_from_plate(os.path.join(AFTER, '04_event_light_film_vs_model.jpg'))
