# HUMAN c8 BENCH: the figure-study bench's reference plates and photographs. Run from videos/:
#   python3 scripts/fetch_figure_refs.py            fetch what is missing into ~/.cache/acp_human/refs/bench/, cut the crops, write the manifest
#   python3 scripts/fetch_figure_refs.py --check    also write a check sheet (every crop with its calibrated vertex and floor lines)
# Out: web/assets/figure_refs/<id>.jpg (small crops: the longest side <= 900 px, JPEG q84) and web/assets/figure_refs/manifest.json
# (id, file, title, work, plate, url, licence, note, sex, view, kind, and for standing figures `fig` = { top, floor, cx } in CROP pixels:
# the vertex and the sole line and the figure's centre, so refs.js can set a plate beside a render at matched stature on one ground
# line, or over it as an onion skin). Full pages stay in the cache; only the crops are vendored.
#
# Choice of references (the client: "we build our own studio and tools and take outside material only where it's appropriate"):
# plates and photographs are taken as REFERENCES to look and measure against, never as material for a piece. Women and men are carried
# as equals: Richer's 1890 male topography and canon beside his 1920 volume on women; Muybridge's men AND women in the same labour
# acts; the Library of Congress's 1942-43 women war workers beside the Master Hands (1936) men as dressed controls.
# Adults only, in the neutral artistic-anatomy register. NOT taken: Richer 1920 pl. 25, 27, 35, 50 C (their captions name models under
# 18), Muybridge's child series (79-87) and any plate with a child, the 1971 Hale translation of Richer (in copyright) and the 2015
# English translation of the 1920 volume, Stratz and other normative 'beauty' plate books, Sheldon's somatotype photographs.
#
# Sources and licences:
#   Richer P. Anatomie artistique (Paris: Plon, 1890), tome 2, plates. Scan: Bibliotheque nationale de France, Gallica ark:/12148/bpt6k205846w,
#     uploaded to the Internet Archive (AnatomieArtistiqueDescriptionDesFormesExtrieuresDuCorpsHumain, Public Domain Mark 1.0). Work public
#     domain (author d. 1933). BnF's own reuse terms ask for a licence for COMMERCIAL reuse of its digitisations: we keep these as internal
#     references (the bench, the review boards), never in a piece; if a page is ever to be reproduced, re-source it (see NOTES).
#   Richer P. Nouvelle anatomie artistique du corps humain. II. Cours superieur. Morphologie: La femme (Paris: Plon-Nourrit, (c) 1920).
#     Internet Archive nouvelleanatomie02rich (University of Ottawa scan). Public domain (US: published before 1929; FR: author d. 1933).
#   Muybridge E. The Human Figure in Motion (London: Chapman & Hall, 1907; plates from Animal Locomotion, 1887). Internet Archive
#     the-human-figure-in-motion-1907. Public domain. (That scan carries a previous reader's red dashed boxes on s39; we crop around them.)
#   Library of Congress, Prints & Photographs, FSA/OWI collections: each "No known restrictions on publication" (checked per item by the
#     women's critic, before/women/NOTES.md section 6).
#   Master Hands (Jam Handy for Chevrolet, 1936): Internet Archive master-hands-1936, Public Domain Mark 1.0 (frames grabbed from the ogv).
#   Albinus BS. Tabulae sceleti et musculorum corporis humani (Leiden, 1747): Wellcome Collection scan, Internet Archive b33543963, PDM 1.0.
#   (Thomson 1896, Bridgman 1920: not taken this round; Richer 1890/1920 and Albinus cover the bench's views.)
import os, sys, json, subprocess, urllib.request
from PIL import Image, ImageDraw, ImageFont
CACHE = os.path.expanduser('~/.cache/acp_human/refs/bench'); OUT = 'web/assets/figure_refs'; os.makedirs(CACHE, exist_ok=True); os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'}
R90 = 'https://archive.org/download/AnatomieArtistiqueDescriptionDesFormesExtrieuresDuCorpsHumain/AnatomieArtistiqueT2.pdf'
R20 = 'https://archive.org/download/nouvelleanatomie02rich/page/n{}_w1600.jpg'
MU = 'https://archive.org/download/the-human-figure-in-motion-1907/page/n{}_w2400.jpg'
LOC = 'https://tile.loc.gov/storage-services/service/pnp/{}v.jpg'
MH = 'https://archive.org/download/master-hands-1936/master-hands-1936-6mbps.ogv'
AL = 'https://archive.org/download/b33543963/page/n{}_w1600.jpg'
L_R90 = 'Public domain work (Richer d. 1933); scan BnF Gallica via Internet Archive, Public Domain Mark 1.0; BnF asks a licence for commercial reuse of its scans: internal reference only'
L_R20 = 'Public domain (published 1920, before 1929 in the US; author d. 1933 in France); scan University of Ottawa via Internet Archive'
L_MU = 'Public domain (1887 plates, 1907 book; Muybridge d. 1904)'
L_LOC = 'Library of Congress FSA/OWI: no known restrictions on publication'
L_MH = 'Master Hands (1936), Internet Archive master-hands-1936, Public Domain Mark 1.0'
L_AL = 'Public domain (1747); Wellcome Collection scan via Internet Archive b33543963, Public Domain Mark 1.0'
# (id, source page key, crop box in page px, meta). Page keys: r90:<pdf page>, r20:<leaf>, mu:<leaf>, loc:<path>, mh:<seconds>
# fig = (top, floor, cx) in PAGE px for a standing figure (the vertex, the sole line, the body's centre), None otherwise.
REFS = [
  # ---- Richer 1890, men (topography: front, back, profile; the canon)
  ('richer1890_pl74_front', 'r90:83', (160, 130, 1290, 1400), dict(fig=(176, 1345, 735), title='Richer 1890 pl. 74: topographie morphologique, plan anterieur', sex='m', view='front', plate='pl. 74')),
  ('richer1890_pl75_back', 'r90:84', (150, 80, 1270, 1370), dict(fig=(115, 1317, 736), title='Richer 1890 pl. 75: topographie morphologique, plan posterieur', sex='m', view='back', plate='pl. 75')),
  ('richer1890_pl76_profile', 'r90:85', (150, 90, 1290, 1390), dict(fig=(140, 1335, 705), title='Richer 1890 pl. 76: topographie morphologique, plan lateral', sex='m', view='profile', plate='pl. 76')),
  ('richer1890_pl108_canon', 'r90:148', (130, 60, 1300, 1330), dict(fig=(115, 1290, 838), title='Richer 1890 pl. 108: proportions du corps humain (the male canon, 7.5 heads)', sex='m', view='front', plate='pl. 108')),
  ('richer1890_pl109_canon_back', 'r90:149', (130, 60, 1300, 1330), dict(fig=None, title='Richer 1890 pl. 109: proportions, plan posterieur', sex='m', view='back', plate='pl. 109')),
  # ---- Richer 1920, women (La femme): canon, varieties (surface front/back/profile, two women), skeleton, muscles, fat, torso types, pelvis, arm, leg axes
  ('richer1920_pl02_canon', 'r20:22', (40, 230, 2250, 3210), dict(fig=(317, 3133, 1467), title='Richer 1920 pl. 2: proportions moyennes de la femme (7 1/3 heads; mid-height at the pubis)', sex='f', view='front', plate='pl. 2')),
  ('richer1920_pl03A_front', 'r20:36', (200, 300, 580, 1650), dict(fig=(343, 1623, 390), title='Richer 1920 pl. 3 A: proportions, varietes (woman A, front)', sex='f', view='front', plate='pl. 3 A')),
  ('richer1920_pl03A_back', 'r20:36', (800, 300, 1240, 1650), dict(fig=(343, 1623, 1020), title='Richer 1920 pl. 3 A: woman A, back', sex='f', view='back', plate='pl. 3 A')),
  ('richer1920_pl03A_profile', 'r20:36', (1340, 300, 1720, 1650), dict(fig=(343, 1623, 1513), title='Richer 1920 pl. 3 A: woman A, profile', sex='f', view='profile', plate='pl. 3 A')),
  ('richer1920_pl03B_front', 'r20:36', (170, 1770, 620, 3140), dict(fig=(1810, 3110, 390), title='Richer 1920 pl. 3 B: woman B, front', sex='f', view='front', plate='pl. 3 B')),
  ('richer1920_pl03B_back', 'r20:36', (780, 1770, 1260, 3140), dict(fig=(1810, 3110, 1020), title='Richer 1920 pl. 3 B: woman B, back', sex='f', view='back', plate='pl. 3 B')),
  ('richer1920_pl03B_profile', 'r20:36', (1340, 1770, 1740, 3140), dict(fig=(1810, 3110, 1513), title='Richer 1920 pl. 3 B: woman B, profile', sex='f', view='profile', plate='pl. 3 B')),
  ('richer1920_pl04_skeleton', 'r20:44', (0, 150, 2385, 3550), dict(fig=None, title='Richer 1920 pl. 4: squelette de la femme, front and lateral', sex='f', view='front+profile', plate='pl. 4')),
  ('richer1920_pl10_muscles', 'r20:78', (0, 150, 2385, 3550), dict(fig=None, title='Richer 1920 pl. 10: muscles de la femme, front and lateral', sex='f', view='front+profile', plate='pl. 10')),
  ('richer1920_pl11_muscles_back', 'r20:82', (0, 150, 2385, 3550), dict(fig=None, title='Richer 1920 pl. 11: muscles de la femme, back', sex='f', view='back', plate='pl. 11')),
  ('richer1920_pl12_fat', 'r20:86', (0, 150, 2385, 3550), dict(fig=None, title="Richer 1920 pl. 12: localisations graisseuses chez l'homme et chez la femme (sections)", sex='both', view='sections', plate='pl. 12')),
  ('richer1920_pl37_torso_types', 'r20:236', (0, 150, 2412, 3650), dict(fig=None, title="Richer 1920 pl. 37: types du torse chez l'homme et chez la femme", sex='both', view='front', plate='pl. 37')),
  ('richer1920_pl41_pelvis', 'r20:252', (0, 150, 2412, 3650), dict(fig=None, title='Richer 1920 pl. 41: bassin droit et bassin incline', sex='f', view='profile', plate='pl. 41')),
  ('richer1920_pl46_arm', 'r20:292', (0, 150, 2412, 3650), dict(fig=None, title="Richer 1920 pl. 46: the woman's arm, supination and elbow hyperextension (the carrying angle)", sex='f', view='front', plate='pl. 46')),
  ('richer1920_pl49_leg_axes', 'r20:306', (0, 150, 2412, 3650), dict(fig=None, title='Richer 1920 pl. 49: axes et aplombs des membres inferieurs (men A-B, women C-D)', sex='both', view='front', plate='pl. 49')),
  # ---- Albinus 1747: the skeleton front and back and the first muscle figure (a man; Richer 1920 pl. 4 and 10-11 are the woman's)
  ('albinus1747_skeleton_front', 'al:22', None, dict(fig=None, title='Albinus 1747, Tab. I: the skeleton, front', sex='m', view='front', plate='Tab. I')),
  ('albinus1747_skeleton_back', 'al:28', None, dict(fig=None, title='Albinus 1747: the skeleton, back', sex='m', view='back', plate='Tab. III')),
  ('albinus1747_muscles_front', 'al:40', None, dict(fig=None, title='Albinus 1747: muscles, first order, front', sex='m', view='front', plate='Tab. muscl. I')),
  # ---- Muybridge, the same acts for men and women: the lateral strip, and one frame matched to the bench pose (fig: stature from a standing frame)
  ('muybridge_s1_man_walking', 'mu:13', (197, 185, 1395, 470), dict(fig=None, title='Muybridge s.1 (1887): athlete walking, lateral', sex='m', view='profile', plate='series 1', pose='walk')),
  ('muybridge_s1_man_walking_f', 'mu:13', (1057, 185, 1228, 470), dict(fig=(232, 462, 1140), title='Muybridge s.1: man walking, the heel strike', sex='m', view='profile', plate='series 1', pose='walk')),
  ('muybridge_s39_woman_walking', 'mu:51', (198, 325, 1388, 518), dict(fig=None, title='Muybridge s.39 (1887): woman walking, lateral', sex='f', view='profile', plate='series 39', pose='walk')),
  ('muybridge_s39_woman_walking_f', 'mu:51', (496, 325, 595, 518), dict(fig=(338, 510, 545), title='Muybridge s.39: woman walking, the heel strike', sex='f', view='profile', plate='series 39', pose='walk')),
  ('muybridge_s4_man_weight', 'mu:16', (210, 355, 1395, 530), dict(fig=None, title='Muybridge s.4: man walking with a 50-pound weight in one hand', sex='m', view='profile', plate='series 4', pose='carry')),
  ('muybridge_s4_man_weight_f', 'mu:16', (605, 355, 704, 530), dict(fig=(382, 525, 655), title='Muybridge s.4: man carrying a weight in one hand', sex='m', view='profile', plate='series 4', pose='carry')),
  ('muybridge_s43_woman_buckets', 'mu:55', (202, 200, 1390, 432), dict(fig=None, title='Muybridge s.43: woman with a bucket of water in each hand, ascending stairs (lateral)', sex='f', view='profile', plate='series 43', pose='carry')),
  ('muybridge_s43_woman_buckets_f', 'mu:55', (301, 200, 400, 432), dict(fig=(225, 428, 350), title='Muybridge s.43: woman carrying two buckets', sex='f', view='profile', plate='series 43', pose='carry')),
  ('muybridge_s43_woman_buckets_stairs_f', 'mu:55', (1192, 200, 1291, 432), dict(fig=None, title='Muybridge s.43: woman with two buckets on the stair', sex='f', view='profile', plate='series 43', pose='stairs')),
  ('muybridge_s6_man_stairs', 'mu:18', (355, 198, 1242, 435), dict(fig=None, title='Muybridge s.6: athlete ascending a stairway, lateral', sex='m', view='profile', plate='series 6', pose='stairs')),
  ('muybridge_s6_man_stairs_f', 'mu:18', (436, 198, 516, 435), dict(fig=None, title='Muybridge s.6: man stepping up', sex='m', view='profile', plate='series 6', pose='stairs')),
  ('muybridge_s41_woman_stairs', 'mu:53', (202, 285, 1390, 500), dict(fig=None, title='Muybridge s.41: woman turning and ascending a stairway', sex='f', view='profile', plate='series 41', pose='stairs')),
  ('muybridge_s41_woman_stairs_f', 'mu:53', (400, 285, 499, 500), dict(fig=None, title='Muybridge s.41: woman stepping up', sex='f', view='profile', plate='series 41', pose='stairs')),
  ('muybridge_s25_man_lifting', 'mu:37', (220, 170, 1390, 393), dict(fig=None, title='Muybridge s.25: athlete lifting and heaving a 75-pound rock', sex='m', view='profile', plate='series 25', pose='lift')),
  ('muybridge_s25_man_lifting_f', 'mu:37', (480, 170, 610, 393), dict(fig=None, title='Muybridge s.25: man taking the rock from the ground', sex='m', view='profile', plate='series 25', pose='lift')),
  ('muybridge_s74_woman_lifting', 'mu:86', (210, 190, 1398, 402), dict(fig=None, title='Muybridge s.74: woman lifting a bushel basket (draped)', sex='f', view='profile', plate='series 74', pose='lift')),
  ('muybridge_s74_woman_lifting_f', 'mu:86', (606, 190, 738, 402), dict(fig=None, title='Muybridge s.74: woman taking the basket from the ground', sex='f', view='profile', plate='series 74', pose='lift')),
  # ---- dressed controls: women at war work (LoC FSA/OWI, 1942-43) and men at work (Master Hands, 1936)
  ('loc_vachon1943_shipyard_women', 'loc:fsa/8d19000/8d19800/8d19825', None, dict(fig=None, title='John Vachon, Beaumont TX, May 1943: women shipyard workers (loc.gov/pictures/item/2017856363)', sex='f', view='dressed')),
  ('loc_delano1943_hart', 'loc:fsac/1a34000/1a34800/1a34801', None, dict(fig=None, title='Jack Delano, Clinton IA, April 1943: Marcella Hart, wiper, C&NW roundhouse (2017878358)', sex='f', view='dressed')),
  ('loc_delano1943_wipers', 'loc:fsac/1a34000/1a34800/1a34806', None, dict(fig=None, title='Jack Delano, Clinton IA, April 1943: women wipers at an H-class locomotive (2017878363)', sex='f', view='dressed')),
  ('loc_hollem1943_oconnell', 'loc:fsac/1a34000/1a34900/1a34978', None, dict(fig=None, title="Howard R. Hollem, Milwaukee, Feb 1943: Enola O'Connell, 32, welder (2017878340)", sex='f', view='dressed')),
  ('loc_hollem1943_vilter49', 'loc:fsac/1a34000/1a34900/1a34975', None, dict(fig=None, title='Howard R. Hollem, Milwaukee, Feb 1943: war production worker, 49, Vilter Mfg. (2017878336)', sex='f', view='dressed')),
  ('loc_hollem1942_lathe', 'loc:fsac/1a34000/1a34900/1a34944', None, dict(fig=None, title='Howard R. Hollem, Fort Worth, Oct 1942: lathe operator, Consolidated Aircraft (2017878306)', sex='f', view='dressed')),
  ('loc_joseph1943_owens', 'loc:fsa/8d18000/8d18700/8d18716', None, dict(fig=None, title='E. F. Joseph, Kaiser shipyards, Richmond CA, 1943: welder-trainee Josie Lucille Owens (2017854462)', sex='f', view='dressed')),
  ('loc_siegel1943_welders', 'loc:fsa/8d18000/8d18700/8d18721', None, dict(fig=None, title='Arthur S. Siegel, Bethlehem-Fairfield shipyards, Baltimore, May 1943: women welders (2017854467)', sex='f', view='dressed')),
  ('loc_parks1943_welders', 'loc:fsa/8d39000/8d39700/8d39781', None, dict(fig=None, title='Gordon Parks, New Britain CT, June 1943: women welders, Landers, Frary and Clark (2017859313)', sex='f', view='dressed')),
]
# Master Hands frames, chosen from contact sheets of the film (1 frame / 4 s over 96-192, 696-792 and 1160-1288 s; the seek lands within ~1 s)
MH_FRAMES = [('masterhands1936_apron', 141, 'Master Hands (1936), t=141 s: an older machinist in cap and shop apron at his machine'),
             ('masterhands1936_foundry_cap', 729, 'Master Hands (1936), t=729 s: an older foundry worker in cap and glasses'),
             ('masterhands1936_machines', 1188, 'Master Hands (1936), t=1188 s: men at the machines, standing figures'),
             ('masterhands1936_press', 1281, 'Master Hands (1936), t=1281 s: a pressman in a cap')]
for mid, sec, title in MH_FRAMES: REFS.append((mid, f'mh:{sec}', None, dict(fig=None, title=title, sex='m', view='dressed')))

def page(key):
    kind, arg = key.split(':', 1)
    if kind == 'r90':
        p = os.path.join(CACHE, f'r1890_p{arg}.png')
        if not os.path.exists(p):
            pdf = os.path.expanduser('~/.cache/acp_human/refs/richerT2.pdf')
            if not os.path.exists(pdf): open(pdf, 'wb').write(urllib.request.urlopen(urllib.request.Request(R90, headers=UA), timeout=300).read())
            subprocess.run(['pdftoppm', '-f', arg, '-l', arg, '-r', '100', '-png', pdf, os.path.join(CACHE, 'r1890_tmp')], check=True)
            tmp = [f for f in os.listdir(CACHE) if f.startswith('r1890_tmp')][0]; os.rename(os.path.join(CACHE, tmp), p)
        return p, R90 + f'#page={arg}'
    url = {'r20': R20, 'mu': MU, 'loc': LOC, 'al': AL}.get(kind)
    if kind == 'mh':
        p = os.path.join(CACHE, 'mh', f'mh_{arg}.jpg')
        ogv = os.path.join(CACHE, 'mh', 'mh.ogv'); os.makedirs(os.path.dirname(ogv), exist_ok=True)
        if not os.path.exists(ogv): open(ogv, 'wb').write(urllib.request.urlopen(urllib.request.Request(MH, headers=UA), timeout=900).read())   # 141 MB, once
        if not os.path.exists(p): subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', arg, '-i', os.path.join(CACHE, 'mh', 'mh.ogv'), '-frames:v', '1', '-y', p], check=True)
        return p, MH + f'#t={arg}'
    p = os.path.join(CACHE, {'r20': 'r1920_n', 'mu': 'muy_n', 'loc': 'loc_', 'al': 'albinus_n'}[kind] + arg.replace('/', '_') + '.jpg'); u = url.format(arg)
    if not os.path.exists(p):
        open(p, 'wb').write(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=120).read())
    return p, u

WORK = {'r90': 'Paul Richer, Anatomie artistique (Paris: Plon, 1890), tome 2 (planches)', 'r20': 'Paul Richer, Nouvelle anatomie artistique du corps humain II, Morphologie: La femme (Paris: Plon-Nourrit, 1920)',
        'mu': 'Eadweard Muybridge, The Human Figure in Motion (London: Chapman & Hall, 1907), plates from Animal Locomotion (1887)', 'al': 'Bernhard Siegfried Albinus, Tabulae sceleti et musculorum corporis humani (Leiden, 1747)', 'loc': 'Library of Congress Prints & Photographs, FSA/OWI', 'mh': 'Master Hands (Jam Handy Organization for Chevrolet, 1936)'}
LIC = {'r90': L_R90, 'r20': L_R20, 'mu': L_MU, 'loc': L_LOC, 'mh': L_MH, 'al': L_AL}
MAXS = 900
man, fails = [], []
for rid, key, box, meta in REFS:
    try: src, url = page(key)
    except Exception as e: fails.append((rid, str(e))); print('FAILED', rid, e); continue
    im = Image.open(src).convert('RGB'); box = box or (0, 0, im.width, im.height); c = im.crop(box)
    s = min(1.0, MAXS / max(c.size)); c = c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS)
    c.save(os.path.join(OUT, rid + '.jpg'), quality=84)
    fig = meta.pop('fig'); kind = key.split(':')[0]
    e = dict(id=rid, file=rid + '.jpg', w=c.width, h=c.height, work=WORK[kind], url=url, licence=LIC[kind], adult=True, kind={'r90': 'plate', 'r20': 'plate', 'al': 'plate', 'mu': 'frame' if rid.endswith('_f') else 'strip', 'loc': 'photo', 'mh': 'film'}[kind], **meta)
    if fig: t, f, cx = fig; e['fig'] = dict(top=round((t - box[1]) * s, 1), floor=round((f - box[1]) * s, 1), cx=round((cx - box[0]) * s, 1))
    man.append(e)
json.dump(dict(about='HUMAN c8 figure-study bench references (scripts/fetch_figure_refs.py). Internal references only: adults, neutral artistic-anatomy register.',
               excluded='Richer 1920 pl. 25, 27, 35, 50C (models under 18); Muybridge child series 79-87; Hale 1971 and 2015 translations (in copyright); Stratz and normative beauty plate books; Sheldon somatotypes',
               refs=man), open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print(f'{len(man)} refs -> {OUT}/manifest.json; {sum(os.path.getsize(os.path.join(OUT, e["file"])) for e in man) // 1024} KB of crops' + (f'; FAILED {len(fails)}' if fails else ''))
if '--check' in sys.argv:
    F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 13); tiles = []
    for e in man:
        im = Image.open(os.path.join(OUT, e['file'])).convert('RGB'); s = 300 / im.height; im = im.resize((max(1, round(im.width * s)), 300)); d = ImageDraw.Draw(im)
        if 'fig' in e: f = e['fig']; [d.line([(0, y * s), (im.width, y * s)], fill=(255, 0, 0), width=2) for y in (f['top'], f['floor'])]; d.line([(f['cx'] * s, 0), (f['cx'] * s, 300)], fill=(0, 160, 255), width=1)
        d.text((3, 3), e['id'][:40], fill=(0, 140, 0), font=F); tiles.append(im)
    W = 2400; rows, cur, x = [], [], 0
    for t in tiles:
        if x + t.width > W and cur: rows.append(cur); cur, x = [], 0
        cur.append(t); x += t.width + 6
    rows.append(cur); sheet = Image.new('RGB', (W, 306 * len(rows)), 'white')
    for r, row in enumerate(rows):
        x = 0
        for t in row: sheet.paste(t, (x, r * 306)); x += t.width + 6
    sheet.save(os.path.join(CACHE, 'check_sheet.jpg'), quality=85); print('check sheet', os.path.join(CACHE, 'check_sheet.jpg'))
