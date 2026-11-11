"""Save the final scripts from a final-scripts workflow journal and apply them to their scene files.
    python3 videos/scripts/apply_finals.py <journal.jsonl> [--apply]"""
import json, sys
J = sys.argv[1]; APPLY = '--apply' in sys.argv
FILES = {'meltdown': 'videos/web/scenes/meltdown7.js', 'unfinished': 'videos/web/scenes/unfinished2.js', 'bank': 'videos/web/scenes/bank2.js',
         'frontier': 'videos/web/scenes/frontier2.js', 'commonwealth': 'videos/web/scenes/commonwealth2.js', 'red_wedge': 'videos/web/scenes/red_wedge2.js',
         'empire': 'videos/web/scenes/empire2.js', 'productive': 'videos/web/scenes/productive.js', 'intelligence': 'videos/web/scenes/intelligence.js',
         'rejuvenation': 'videos/web/scenes/rejuvenation.js', 'ownfuture': 'videos/web/scenes/ownfuture.js', 'ascended': 'videos/web/scenes/ascended.js'}
rows = [json.loads(l) for l in open(J)]
lab = {r['key']: r['label'] for r in rows if r['type'] == 'started'}
last = {}
for r in rows:
    l = lab.get(r.get('key'), '')
    if r['type'] == 'result' and l.startswith(('punch:', 'revise:')) and r['result']:
        last[l.split(':')[1]] = r['result']
for k, f in last.items():
    json.dump(f, open(f'research/scripts_final/{k}.json', 'w'), indent=1)
    n = sum(1 for w in f['words'] if w.get('text'))
    print(f'===== {k}: {n} text frames\nHOOK: {f["hook"][:160]}\nCLIP: {f["clip_line"][:160]}\nREAD: {f["reading"][:900]}')
    if APPLY and k in FILES:
        p = FILES[k]; s = open(p).read()
        if f['old_snippet'] not in s: print('  !! old snippet not found in', p); continue
        s = s.replace(f['old_snippet'], f['new_snippet'], 1)
        for e in f.get('extra_edits') or []:
            if e['old'] in s: s = s.replace(e['old'], e['new'], 1)
            else: print('  !! extra edit not found:', e['old'][:70])
        open(p, 'w').write(s); print('  applied to', p)
