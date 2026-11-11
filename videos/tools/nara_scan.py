"""nara_scan.py: scan a range of NARA catalog record ids through the record proxy (no key needed) and print one JSON line per record (droste c2, 1 Oct 2026).

    python3 tools/nara_scan.py 293500 295300 > nara_scan.jsonl        # about 2.5 ids/s; RG 115 Construction Photographs (Hoover, Grand Coulee, CCC) are in this range

Each line: naid, title, date, use (the record's useRestriction status), objs [(url, bytes)], level, parent series. Rights are the record's own statement
("Unrestricted" for the Bureau of Reclamation construction photographs). The digital object of an item is usually a small GIF (413x600 for the Hoover drillers,
NAID 293843): the 3000 px scans live on Wikimedia Commons (rate limited: wait and retry with backoff, upload.wikimedia.org by the md5 path of the file name).
The scan of 293500-295300 on 1 Oct found 1,433 unrestricted items: wide views of equipment, small figures. Heroes and film leads, not portrait tiles.
"""
import json, subprocess, sys
UA = 'acp-studio/1.0 (research; public-domain archive study)'


def rec(n):
    r = subprocess.run(['curl', '-sS', '-m', '30', '-A', UA, 'https://catalog.archives.gov/proxy/records/search?naId=%d' % n], capture_output=True, text=True)
    try:
        h = json.loads(r.stdout)['body']['hits']['hits']
        if not h:
            return None
        s = h[0]['_source']['record']
        return dict(naid=n, title=s.get('title'), date=(s.get('productionDates') or [{}])[0].get('logicalDate'), use=(s.get('useRestriction') or {}).get('status'),
                    objs=[(o.get('objectUrl'), o.get('objectFileSize')) for o in s.get('digitalObjects', [])], level=s.get('levelOfDescription'),
                    parent=(s.get('ancestors') or [{}])[-1].get('title') if s.get('ancestors') else None)
    except Exception:
        return None


if __name__ == '__main__':
    a, b = int(sys.argv[1]), int(sys.argv[2])
    for n in range(a, b):
        r = rec(n)
        print(json.dumps(r) if r else n, flush=True)
