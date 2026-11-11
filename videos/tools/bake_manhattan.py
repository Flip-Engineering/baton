#!/usr/bin/env python3
"""Bake lower Manhattan (street centerlines + the shoreline-clipped island polygon) from NYC OpenData into
web/assets/geo/lower_manhattan.json.  Sources: NYC DoITT/DOT 'Centerline' (inkn-q76z) and 'Borough Boundaries' (gthc-hcne).
Box: lon -74.035..-73.965, lat 40.684..40.738 (about 6 km by 6 km: the tip of Manhattan, the harbour, Brooklyn Heights).  Streets are rw_type 1 (street), 2 (highway), 3 (bridge); ferry routes,
paths, bike links, tunnels and ramps are left out.  Network needed once; the render reads the file."""
import json, subprocess, sys, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'web', 'assets', 'geo', 'lower_manhattan.json')
BOX = (-74.035, 40.684, -73.965, 40.738)
def get(url, **q):
    a = ['curl', '-sS', '-m', '120', '-G', url]
    for k, v in q.items(): a += ['--data-urlencode', f'{k}={v}']
    return json.loads(subprocess.check_output(a))
cl = get('https://data.cityofnewyork.us/resource/inkn-q76z.json', **{'$select': 'the_geom,full_street_name,rw_type,streetwidth',
    '$where': f'within_box(the_geom,{BOX[1]},{BOX[0]},{BOX[3]},{BOX[2]})', '$limit': 8000})
bad = ('FERRY', 'PATH', 'BIKE', 'GREENWAY', 'PEDESTRIAN', 'UNDERPASS', 'TUNNEL', 'TUNL', 'RAMP', 'ESPL')
streets = []
for s in cl:
    if s.get('rw_type') not in ('1', '2', '3'): continue
    n = s.get('full_street_name') or ''
    if any(b in n for b in bad): continue
    for ln in s['the_geom']['coordinates']:
        streets.append({'n': n, 'w': int(float(s.get('streetwidth') or 30)), 't': int(s['rw_type']), 'p': [[round(x, 5), round(y, 5)] for x, y in ln]})
def rdp(pts, tol):
    if len(pts) < 3: return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1; n = (dx * dx + dy * dy) ** 0.5 or 1e-12
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        dd = abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / n
        if dd > dmax: dmax, idx = dd, i
    if dmax > tol: return rdp(pts[:idx + 1], tol)[:-1] + rdp(pts[idx:], tol)
    return [pts[0], pts[-1]]
land = []                                    # all five boroughs, simplified (30 m near the tip, 15 m tolerance elsewhere): the whole harbour
for code in ('1', '2', '3', '4', '5'):
    bo = get('https://data.cityofnewyork.us/resource/gthc-hcne.json', **{'$where': f"borocode='{code}'"})[0]['the_geom']['coordinates']
    for poly in bo:
        ring = poly[0]
        if len(ring) < 5: continue
        ring = [[round(x, 5), round(y, 5)] for x, y in ring]; h = len(ring) // 2
        ring = rdp(ring[:h + 1], 0.00012)[:-1] + rdp(ring[h:], 0.00012)
        if len(ring) >= 4: land.append(ring)
json.dump({'src': 'NYC Open Data: Centerline (inkn-q76z), Borough Boundaries (gthc-hcne)', 'box': BOX, 'streets': streets, 'land': land}, open(OUT, 'w'), separators=(',', ':'))
print(len(streets), 'segments', len(land), 'land rings', os.path.getsize(OUT) // 1024, 'KB')
