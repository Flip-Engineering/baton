#!/usr/bin/env python3
"""ACCELERATE c10: depth-bake NASA public-domain stills for the living-photo shots (intelligence2.photo.js).
Fetches the 'large' (1920 px) jpg from images-assets.nasa.gov, runs Depth Anything V2 Small (plate_bake.depths) and writes
web/assets/accelerate/<id>.jpg + <id>_d.png (8-bit disparity, 0 far..255 near) + meta.json.  Run from anywhere."""
import os, sys, json, urllib.request
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__))
VID = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(VID, 'scripts'))
import plate_bake as pb
OUT = os.path.join(VID, 'web', 'assets', 'accelerate'); os.makedirs(OUT, exist_ok=True)
IDS = {'9260665': 'JFK addressing Congress, 25 May 1961', '6900563': 'Firing Room 1, Apollo 11 countdown, 16 Jul 1969',
       'KSC-69P-631': 'KSC team rising from their consoles at liftoff, 16 Jul 1969', '6760478': 'Boeing worker installing an F-1 engine, Michoud, 1967',
       '6759510': 'stacking the S-IC stage, Boeing VAB at Michoud, 1967', '6760483': 'stacking the S-IC stage, Michoud, 1967',
       '6527705': 'S-IC stage static firing, 1965', 'S69-39959': 'Apollo 11 liftoff, 16 Jul 1969', 'as11-40-5878': 'bootprint in lunar soil, 20 Jul 1969',
       'KSC-69PC-387': 'Launch Control Center watching the Apollo 11 liftoff', 'S69-34332': 'Firing Room 3, LCC, 13 May 1969'}
meta = {}
for i, title in IDS.items():
    jp = os.path.join(OUT, i + '.jpg')
    if not os.path.exists(jp):
        urllib.request.urlretrieve(f'https://images-assets.nasa.gov/image/{i}/{i}~large.jpg', jp)
    img = cv2.imread(jp)
    dm, info = pb.depths([img])
    d = np.clip(dm[0] * 255 + .5, 0, 255).astype(np.uint8)
    cv2.imwrite(os.path.join(OUT, i + '_d.png'), pb.half(d))
    meta[i] = dict(title=title, size=[img.shape[1], img.shape[0]], source=f'https://images.nasa.gov/details/{i}', licence='NASA media, public domain')
    print(i, img.shape, flush=True)
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
