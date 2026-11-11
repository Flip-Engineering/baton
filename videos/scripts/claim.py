#!/usr/bin/env python3
"""Advisory per-piece claim: who is editing a piece's scene, song and script JSON right now (2 Oct, TOOLING c27).

Two cycle-14 builders were launched on one piece (ACCELERATE, IRON_IS_HOT) and overwrote each other's files and audio.
A claim is a small file, research/claims/<PIECE>.json, with an owner, a note and a time. It never blocks anything:
it makes a collision visible before work starts. A claim not refreshed for 3 h (--ttl) reads as stale and can be taken.

    python3 videos/scripts/claim.py take ACCELERATE builderA "late notes: type voice, pacing"   # exit 3 if held by a live other
    python3 videos/scripts/claim.py take ACCELERATE builderA "..." --force                       # take over knowingly
    python3 videos/scripts/claim.py check ACCELERATE builderB     # exit 0 free or mine, 3 held by someone else (live)
    python3 videos/scripts/claim.py touch ACCELERATE builderA     # refresh the time (do it at each render)
    python3 videos/scripts/claim.py release ACCELERATE builderA   # (--force releases another's)
    python3 videos/scripts/claim.py list                          # every claim, live or stale
Names resolve like inbox.py (a scene name such as intelligence2 means its piece). Owner is any label you choose.
"""
import datetime
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
DIR = os.path.join(ROOT, 'research', 'claims')
TTL = 3 * 3600


def piece(name):
    sys.path.insert(0, HERE)
    try:
        import inbox
        p = inbox.pieces()
        if name in p:
            return name
        for k, v in p.items():
            if v == name:
                return k
    except Exception:
        pass
    return name


def path(p):
    return os.path.join(DIR, p + '.json')


def load(p):
    try:
        return json.load(open(path(p)))
    except Exception:
        return None


def save(p, owner, note):
    os.makedirs(DIR, exist_ok=True)
    c = {'piece': p, 'owner': owner, 'note': note, 'at': time.time(),
         'when': datetime.datetime.now().isoformat(timespec='minutes')}
    tmp = path(p) + '.tmp%d' % os.getpid()
    json.dump(c, open(tmp, 'w'), indent=1)
    os.replace(tmp, path(p))


def live(c, ttl=TTL):
    return bool(c) and time.time() - c.get('at', 0) < ttl


def describe(c):
    age = int((time.time() - c['at']) / 60)
    return '%s: %s held by %s, refreshed %d min ago%s -- %s' % (
        c['piece'], 'CLAIM' if live(c) else 'stale claim', c['owner'], age, '' if live(c) else ' (free to take)', c.get('note', ''))


def main(a):
    ttl = TTL
    if '--ttl' in a:
        i = a.index('--ttl')
        ttl = int(float(a[i + 1]) * 3600)
        del a[i:i + 2]
    force = '--force' in a
    a = [x for x in a if x != '--force']
    if not a or a[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    cmd = a[0]
    if cmd == 'list':
        cs = [json.load(open(os.path.join(DIR, f))) for f in sorted(os.listdir(DIR)) if f.endswith('.json')] if os.path.isdir(DIR) else []
        print('\n'.join(describe(c) for c in cs) or 'no claims')
        return 0
    if len(a) < 3:
        print('usage: claim.py %s PIECE OWNER ["note"]' % cmd)
        return 2
    p, owner, note = piece(a[1]), a[2], ' '.join(a[3:])
    c = load(p)
    other = bool(c) and live(c, ttl) and c['owner'] != owner
    if cmd == 'check':
        print(describe(c) if c else '%s: free' % p)
        if other:
            print('NOT YOURS: ask the owner or the studio before editing this piece\'s scene, song or script JSON.')
        return 3 if other else 0
    if cmd == 'take':
        if other and not force:
            print(describe(c))
            print('refused: held by a live claim. Coordinate, or use --force to take over knowingly.')
            return 3
        save(p, owner, note or (c or {}).get('note', ''))
        print('%s: claimed by %s%s' % (p, owner, ' (took over from %s)' % c['owner'] if other else ''))
        return 0
    if cmd == 'touch':
        if other and not force:
            print(describe(c))
            return 3
        save(p, owner, (c or {}).get('note', '') if c else note)
        return 0
    if cmd == 'release':
        if c and c['owner'] != owner and not force:
            print('%s is held by %s; use --force to release it' % (p, c['owner']))
            return 3
        if c:
            os.remove(path(p))
        print('%s: released' % p)
        return 0
    print('unknown command', cmd)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
