#!/usr/bin/env python3
"""MODELING c1: the catalogue sheet. One row per asset from web/assets/objects/catalog.json: the source it was built from (a photograph or
film frame), its render at working size and at 270 px, licence and credit, triangles and LOD sizes, what was changed."""
import json, os, sys, textwrap
from PIL import Image, ImageDraw, ImageFont
VID = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AFTER = os.path.join(VID, 'review/studio_modeling_c1/after'); BEFORE = os.path.join(VID, 'review/studio_modeling_c1/before/ref')
SCR = os.environ.get('MODELING_SCRATCH', '/tmp/claude-0/-home-user-Blog-Posts/3001c6c1-cab9-5784-8806-2fdf4f7a480a/scratchpad')
cat = json.load(open(os.path.join(VID, 'web/assets/objects/catalog.json')))['assets']
def F(sz, b=False):
    for p in (['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if b else ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()
ROWS = [  # asset key, source image, source caption, render
    ('cobot_wrist', os.path.join(VID, 'web/assets/plate/hand36/color.jpg'), 'hand36: Master Hands (1936) NFPF 23:36, PD', 'cat_cobot_cobot_wrist_0.00.jpg'),
    ('container_40hc', os.path.join(BEFORE, 'wm_newark.jpg'), 'Port Newark-Elizabeth, VynedJ, CC BY 4.0', 'cat_containers_set_0.00.jpg'),
    ('sts_crane', os.path.join(BEFORE, 'wm_newark.jpg'), 'same photograph; trolley + spreader are their own assets', 'cat_cranes_set_0.00.jpg'),
    ('tractor_aero', os.path.join(VID, 'web/assets/plate/trucker_wide_poster_original.jpg'), "client poster 'OWN THE FUTURE' (cab, mirror, lamp)", 'cat_trucks_rig_0.00.jpg'),
    ('mill_stand', os.path.join(BEFORE, 'mill_0.jpg'), 'HAER Bethlehem Steel rolling mill, PD (LoC)', 'cat_mill_mill_stand_0.00.jpg'),
    ('part_barrel_03', os.path.join(SCR, 'ph/barrel_03.png'), 'Poly Haven, Serhii Khromov, CC0', 'cat_part_barrel_03_0.00.jpg'),
    ('part_metal_tool_chest', os.path.join(SCR, 'ph/metal_tool_chest.png'), 'Poly Haven, Kervran / Hutcheson, CC0', 'cat_part_metal_tool_chest_0.00.jpg'),
    ('part_hanging_industrial_lamp', os.path.join(SCR, 'ph/hanging_industrial_lamp.png'), 'Poly Haven, Kuutti Siitonen, CC0', 'cat_part_hanging_industrial_lamp_0.00.jpg'),
]
RH = 480; W = 2000; sheet = Image.new('RGB', (W, 60 + RH * len(ROWS)), (14, 14, 14)); d = ImageDraw.Draw(sheet)
d.text((12, 12), 'MODELING c1: the asset library (web/assets/objects/catalog.json). Source | render | 270 px | record', fill=(255, 255, 255), font=F(20, True))
for i, (k, src, cap, ren) in enumerate(ROWS):
    y = 50 + i * RH; a = cat.get(k, {})
    try:
        im = Image.open(src).convert('RGB'); im.thumbnail((520, 400)); sheet.paste(im, (12, y + 40)); d.text((12, y + 445), cap, fill=(240, 220, 60), font=F(13))
    except Exception as e: d.text((12, y + 40), 'no source image', fill=(200, 60, 60), font=F(14))
    rp = os.path.join(AFTER, ren)
    if os.path.exists(rp):
        r = Image.open(rp).convert('RGB'); big = r.resize((int(r.width * 440 / r.height), 440)); sheet.paste(big, (560, y + 20))
        sm = r.resize((270, 480)); sm.thumbnail((270, 270 * 16 // 9)); sheet.paste(r.resize((150, 267)), (560 + big.width + 12, y + 20))
    x0 = 560 + int(1080 * 440 / 1920) + 190
    d.text((x0, y + 12), f"{k}  ({a.get('title','')})", fill=(255, 255, 255), font=F(17, True))
    lic = a.get('licence', {}); lic_s = lic.get('spdx') or lic.get('geometry') or ''
    tri = f"{a.get('triangles','?')} tris ({a.get('bytes',0)//1024} KB)" + (f", lod1 {a['triangles_lod1']} tris" if a.get('triangles_lod1') else '') + ('  +far ' + str(a['variants']['far']['triangles']) + ' tris' if a.get('variants', {}).get('far') else '')
    lines = ['type: ' + a.get('type', ''), tri, 'licence: ' + lic_s + (' | ' + lic.get('holder', '') if lic.get('holder') else ''), 'built: ' + a.get('built', '')]
    refs = [r.get('what', '') + (' [' + r['licence'] + ']' if r.get('licence') else '') for r in a.get('references', [])][:3]
    if refs: lines.append('references:'); lines += ['  - ' + t for t in refs]
    ch = a.get('changes', [])[:4]
    if ch: lines.append('what we changed:'); lines += ['  - ' + t for t in ch]
    if a.get('bakes'): lines.append('bake: ' + a['bakes'].get('vertex_color', ''))
    if a.get('decals'): lines.append('decals: ' + ', '.join(a['decals']))
    if a.get('kitbash') is True: lines.append('kitbash part, placed as set dressing in the mill demo')
    yy = y + 44
    for ln in lines:
        for w in textwrap.wrap(ln, 74) or ['']:
            d.text((x0, yy), w, fill=(210, 210, 210), font=F(13)); yy += 17
sheet.save(os.path.join(AFTER, '05_catalog_sheet.jpg'), quality=88); print('wrote 05_catalog_sheet.jpg', sheet.size)
