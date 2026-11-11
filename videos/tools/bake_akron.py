#!/usr/bin/env python3
"""CIVILIZATION c20: bake east and central Akron (street centrelines, rails, the Little Cuyahoga and the canal, Summit Lake)
from the Census Bureau's TIGERweb (TIGER/Line roads 2xxx, rails, linear and areal hydrography) into web/assets/geo/akron.json,
in the same shape as lower_manhattan.json, so the piece's second dive (to where the work is done) lands on a real street grid
the way the first lands on Wall St.  Box: lon -81.545..-81.465, lat 41.050..41.095 (downtown, the old rubber works on the east
side along E Market St and Goodyear Blvd).  Network needed once; the render reads the file.
    python3 videos/tools/bake_akron.py [--cache DIR]
"""
import json, os, subprocess, sys
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'geo', 'akron.json')
BOX = (-81.545, 41.050, -81.465, 41.095)
TW = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb'


def get(svc, layer):
    a = ['curl', '-sS', '-m', '120', '-G', f'{TW}/{svc}/MapServer/{layer}/query']
    for k, v in dict(geometry=','.join(map(str, BOX)), geometryType='esriGeometryEnvelope', inSR='4326', outSR='4326',
                     spatialRel='esriSpatialRelIntersects', outFields='NAME,MTFCC', f='geojson').items():
        a += ['--data-urlencode', f'{k}={v}']
    d = json.loads(subprocess.check_output(a))
    if d.get('error'):
        raise SystemExit(f'{svc}/{layer}: {d["error"]}')
    return d['features']


def lines(geom):
    if geom['type'] == 'LineString':
        return [geom['coordinates']]
    if geom['type'] == 'MultiLineString':
        return geom['coordinates']
    return []


r5 = lambda ln: [[round(x, 5), round(y, 5)] for x, y in ln]
streets, seen = [], set()
# road class -> (t, width m): 1 local, 2 primary/secondary (drawn wider), as lower_manhattan's t / w
for layer, t, w in ((2, 2, 60), (4, 2, 40), (6, 2, 40), (8, 1, 30)):
    for f in get('Transportation', layer):
        n = (f['properties'].get('NAME') or '').upper()
        for ln in lines(f['geometry']):
            key = (round(ln[0][0], 5), round(ln[0][1], 5), round(ln[-1][0], 5), round(ln[-1][1], 5))
            if key in seen:
                continue
            seen.add(key)
            streets.append({'n': n, 'w': w, 't': t, 'p': r5(ln)})
rails = [r5(ln) for f in get('Transportation', 9) for ln in lines(f['geometry'])]
water = [{'n': (f['properties'].get('NAME') or '').upper(), 'p': r5(ln)} for f in get('Hydro', 0) for ln in lines(f['geometry'])]
lakes = []
for f in get('Hydro', 1):
    g = f['geometry']
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for poly in polys:
        lakes.append(r5(poly[0]))
json.dump({'src': 'U.S. Census Bureau TIGERweb (TIGER/Line roads, rails, hydrography)', 'box': BOX, 'streets': streets, 'rails': rails,
           'water': water, 'lakes': lakes}, open(OUT, 'w'), separators=(',', ':'))
print(len(streets), 'streets', len(rails), 'rails', len(water), 'water lines', len(lakes), 'lakes', os.path.getsize(OUT) // 1024, 'KB')
