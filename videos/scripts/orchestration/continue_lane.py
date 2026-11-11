#!/usr/bin/env python3
"""Make a continuation run of a round-7 scripted-team lane (orchestrator, 8 Oct; the client: 'DEEPLY ITERATE').
   python3 continue_lane.py <lane> [iterations]  ->  wf_r7_<lane>_cN.js (N = the next free number), the same team, its lead told it is a
   continuation: read NOTES.md (its NEXT ITERATIONS list and the last measures/it*.md) and keep going; the house text re-read from house_r7c.txt."""
import sys, re, json, os
lane = sys.argv[1]; iters = int(sys.argv[2]) if len(sys.argv) > 2 else 3
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, f'wf_r7_{lane}.js')
s = open(src).read()
n = 2
while os.path.exists(os.path.join(here, f'wf_r7_{lane}_c{n}.js')): n += 1
cont = (f"CONTINUATION RUN c{n} (the client, 8 Oct: 'DEEPLY ITERATE'): you are NOT starting over. Read your NOTES.md whole (its NEXT ITERATIONS list, the Log, the "
        "ORCHESTRATOR blocks at its top) and your last measures/it*.md and CHECK.md if any; continue from where the last run stopped, one coherent change per iteration, "
        "small decisive farm jobs (3-8 plates where the defect lives), node measures between renders; renumber your iterations from where the Log left off. ")
m = re.search(r'const LEAD = (".*?")\n', s, re.S); lead = json.loads(m.group(1))
lead = cont + re.sub(r'^CONTINUATION RUN c\d+ .*?renumber your iterations from where the Log left off\. ', '', lead)
s = s.replace(m.group(0), 'const LEAD = ' + json.dumps(lead) + '\n')
H = open(os.path.join(here, 'house_r7c.txt')).read()
s = re.sub(r'const H = \(typeof args !== "undefined" && args && args\.house\) \|\| ".*?"\n', lambda _: 'const H = (typeof args !== "undefined" && args && args.house) || ' + json.dumps(H) + '\n', s, count=1, flags=re.S)
s = s.replace('const H = args.house\n', 'const H = (typeof args !== "undefined" && args && args.house) || ' + json.dumps(H) + '\n')
s = re.sub(r'const N = args\.iters \|\| \d+', 'const N = (typeof args !== "undefined" && args && args.iters) || 3', s)
s = re.sub(r'const N = \(typeof args !== "undefined" && args && args\.iters\) \|\| \d+', f'const N = (typeof args !== "undefined" && args && args.iters) || {iters}', s)
s = re.sub(r"name: '([^']+)'", lambda mm: f"name: '{mm.group(1)}-c{n}'", s, count=1)
out = os.path.join(here, f'wf_r7_{lane}_c{n}.js'); open(out, 'w').write(s); print(out)
