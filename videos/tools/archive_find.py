#!/usr/bin/env python3
"""archive_find.py: one search across many public-access archives (ARCHIVE SCENES c2). Reports; never decides.

    python3 videos/tools/archive_find.py search "Hoover Dam construction workers 1933" [--kind photo|film|audio|print|map ...] [--years 1930 1945] [--place "Gary, Indiana"]
                                                [--n 8] [--sources a,b] [--sheet out.jpg] [--json out.json] [--top 15] [--budget 150]
        --kind   photo, film, audio, print (newspapers, engravings, posters), map; commas or spaces; synonyms: video/newsreel -> film, newspaper -> print, sound -> audio, plat -> map
        --years  1930 1945 | 1930-1945 | 1930s | 1937: a FILTER (dated items outside go, undated items stay, flagged). A year written in the query text only ranks.
        The flags may come before or after the query. --budget: seconds a source may spend (with its back-off) before the search moves on without it.
    python3 videos/tools/archive_find.py status [--md out.md] [--json out.json]     # every source live: reachable / blocked (HTTP status, challenge type), key needed, rate-limit headers
    python3 videos/tools/archive_find.py sources                                      # the static facts: access, rights quality, max size, quirks
    python3 videos/tools/archive_find.py period                                       # the period-name table (Hoover Dam -> Boulder Dam ...)
    python3 videos/tools/archive_find.py used-index [--rebuild]                       # what 'used on the slate' knows

Keys (optional, set in the environment by a person who requested them): DPLA_API_KEY, SI_API_KEY (api.data.gov), FLICKR_API_KEY, FREESOUND_TOKEN.
Library: videos/engine/archive/fed/ (see its __init__ docstring). Film and sound by shot and phrase: videos/tools/video_find.py and audio_find.py.
"""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'engine'))
from archive import fed
from archive.fed import adapters, sheet, model

def md_status(rows):
    L = ['| source | state | HTTP | s | access | rights statement | max size | quirks |', '|---|---|---|---|---|---|---|---|']
    for r in rows:
        L.append('| %s | %s | %s | %s | %s | %s | %s | %s |' % (r.get('label') or r['source'], r['state'] + (' [key: %s]' % r['key'] if r.get('key') else ''), r.get('status') or '-', r.get('secs', ''),
                 (r.get('info_access') or '').replace('|', '/'), (r.get('info_rights') or '').replace('|', '/'), (r.get('info_max_size') or '').replace('|', '/'),
                 ((r.get('info_quirks') or r.get('note') or '') + (' ratelimit: %s' % r['ratelimit'] if r.get('ratelimit') else '')).replace('|', '/')))
    return '\n'.join(L)

def read_filters(a, ap):
    """--kind and --years take one or more words, so `search --kind photo "steel mill"` would hand the query to --kind: a word that is not a kind (or a year) is
    given back to the query. Unknown kinds and unreadable years are an error with the fix, never a silent empty search."""
    words = [a.q] if a.q else []
    kinds = None
    if a.kind:
        kinds, left = [], []
        for raw in a.kind:
            ks, bad = model.parse_kinds([raw])
            if bad: left.append(raw)
            else: kinds += ks
        if left and not words and len(left) == 1: words.append(left[0]); left = []
        if left: ap.error('unknown --kind %s; use %s (synonyms: video, newsreel, newspaper, poster, sound, plat ...)' % (', '.join(map(repr, left)), ', '.join(model.KINDS)))
        kinds = list(dict.fromkeys(kinds))
        if not kinds: ap.error('--kind needs one of %s' % ', '.join(model.KINDS))
    years = None
    if a.years:
        ys = [t for t in a.years if re.fullmatch(r'\d{4}s?|\d{4}\s*(-|\.\.|to|\u2013)\s*\d{4}|-|to', t.strip())]
        rest = [t for t in a.years if t not in ys]
        if rest and not words: words.append(' '.join(rest)); rest = []
        if rest: ap.error('cannot read --years %s; use 1930 1945, 1930-1945, 1930s or 1937' % ' '.join(a.years))
        try: years = model.parse_years(ys)
        except ValueError as e: ap.error(str(e))
    if len(words) != 1 or not words[0].strip(): ap.error('give one query, in quotes: search "steel strike Gary" --kind photo --years 1919 1920')
    return words[0], kinds, years

def main():
    try: sys.stdout.reconfigure(line_buffering=True)          # a piped or timed-out run still shows each source as it answers
    except Exception: pass
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter); sp = ap.add_subparsers(dest='cmd', required=True)
    s = sp.add_parser('search', description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter); s.add_argument('q', nargs='?'); s.add_argument('--kind', '--kinds', nargs='+', action='extend', help='photo film audio print map (commas ok)')
    s.add_argument('--n', type=int, default=8); s.add_argument('--sources'); s.add_argument('--sheet'); s.add_argument('--json'); s.add_argument('--top', type=int, default=15)
    s.add_argument('--years', nargs='+', help='1930 1945 | 1930-1945 | 1930s | 1937'); s.add_argument('--place', help='a town for the map sources (geocoded), and a ranking term')
    s.add_argument('--budget', type=float, default=150, help='seconds per source, back-off included (default 150)')
    s.add_argument('--fi'); s.add_argument('--fr'); s.add_argument('--papers', nargs='*', help='Chronicling America: names of papers (CIO News, Victory Worker ...); no names = the built-in labour list'); s.add_argument('--no-measure', action='store_true')
    t = sp.add_parser('status'); t.add_argument('--md'); t.add_argument('--json')
    sp.add_parser('sources'); sp.add_parser('period')
    u = sp.add_parser('used-index'); u.add_argument('--rebuild', action='store_true')
    a = ap.parse_args()
    if a.cmd == 'search':
        q, kinds, years = read_filters(a, s)
        extra = {k: v for k, v in (('fi', a.fi), ('fr', a.fr)) if v}
        if a.papers is not None: extra['papers'] = [p.lower() for p in a.papers] or True
        print('query %r  kinds=%s  years=%s%s' % (q, ','.join(kinds) if kinds else 'all', '%d-%d (filter)' % years if years else '-', '  place=%r' % a.place if a.place else ''))
        try:
            res = fed.search(q, kinds=kinds, sources=a.sources.split(',') if a.sources else None, n=a.n, years=years, extra=extra, top=a.top, do_measure=not a.no_measure, progress=print, place=a.place, budget=a.budget)
        except ValueError as e: s.error(str(e))
        f = res.get('filtered') or {}
        print('%d raw items from %d sources; filters dropped %d of another kind, %d dated outside the years; %d undated kept (flagged)' % (
            res['raw_items'], sum(1 for v in res['per_source'].values() if v.get('ok')), f.get('other_kind', 0), f.get('outside_years', 0), f.get('undated_kept', 0)))
        if not res['items']:
            asked = {k: v for k, v in res['per_source'].items() if v.get('state') != 'not asked'}
            print('NO ITEMS. Sources asked: %d (%s).' % (len(asked), ', '.join('%s: %s' % (k, v.get('state') or ('%d items' % v.get('n', 0))) for k, v in asked.items())))
            if f.get('outside_years'): print('  every dated item fell outside --years; widen the range, or put the year in the query text to rank instead of filter.')
            if f.get('other_kind'): print('  %d items were of another kind; drop --kind to see them.' % f['other_kind'])
        for i, it in enumerate(res['items'][:a.top]):
            m = it['master']
            print('%2d %5.1f  %-44s %-10s %-22s %s  %s' % (i + 1, it['score'], ' + '.join(it['sources'])[:44], it['rights']['class'], ('%sx%s' % (m['w'], m['h'])) if m.get('w') else '?', it['date'][:12], it['title'][:70]))
        if a.sheet: print('sheet', sheet.make(res, a.sheet, top=a.top))
        if a.json: sheet.dump(res, a.json)
    elif a.cmd == 'status':
        rows = fed.status()
        for r in rows: print('%-22s %-34s %s' % (r['source'], r['state'], r.get('status')))
        if a.md: open(a.md, 'w').write(md_status(rows))
        if a.json: json.dump(rows, open(a.json, 'w'), indent=1)
    elif a.cmd == 'sources':
        for x in adapters.ADAPTERS: print('%-22s %-9s %s\n    access: %s\n    rights: %s\n    size: %s\n    quirks: %s' % (x.name, ','.join(x.kinds), x.label, x.info.get('access'), x.info.get('rights'), x.info.get('max_size'), x.info.get('quirks')))
    elif a.cmd == 'period':
        for k, v in model.load_period().items():
            if not k.startswith('_'): print('%-20s -> %s   places: %s' % (k, ', '.join(v.get('names', [])), ', '.join(v.get('places', []))))
    elif a.cmd == 'used-index':
        ix = fed.used.build() if a.rebuild else fed.used.index()
        print('%d images hashed, %d ids from manifests' % (len(ix['files']), len(ix['ids'])))

if __name__ == '__main__':
    main()
