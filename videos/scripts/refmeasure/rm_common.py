"""REFMEASURE shared helpers: paths, the photo manifest and its selections, quantiles, our-plate discovery (and gate(), the retired PASS / FAIL band:
RETIRED (8 Oct 2026): the comparison tables and pass bands no longer judge the people. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread.)

Everything here is numbers and paths. The photographs stay local (~/.cache/acp_human/figure_photos/); nothing in this package writes a photo
into a committed folder. Run everything with the MediaPipe venv (the entry point re-executes itself under it when it is not already).
"""
import csv, glob, json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
VIDEOS = os.path.join(REPO, 'videos')
C8 = os.path.join(VIDEOS, 'review', 'studio_human_c8')
REFS_DIR = os.path.join(VIDEOS, 'web', 'assets', 'figure_refs', 'photo_derived')
MANIFEST = os.path.join(REFS_DIR, 'manifest.csv')
CACHE = os.path.expanduser('~/.cache/acp_human/figure_photos')
FIGVENV_PY = os.path.expanduser('~/.cache/acp_human/figvenv/bin/python')
FACE_MODEL = os.path.expanduser('~/.cache/acp_human/face_landmarker.task')
OUT = os.path.join(C8, 'refmeasure')                       # committed: tables, notes, boards of OUR renders
LOCAL = os.path.join(C8, 'refs_local', 'refmeasure')      # never committed: photos beside ours
SCRATCH = os.path.expanduser('~/.cache/acp_human/refmeasure_scratch')
TOOLS = os.path.join(C8, 'refs', 'tools')
for _p in (TOOLS, os.path.join(C8, 'after', 'skin6', 'tools')):
    if _p not in sys.path: sys.path.insert(0, _p)

TWELVE = ['L08_f24_hispanic', 'L21_m32_black', 'L22_f27_black', 'L11_m23_white', 'L20_f29_asian', 'L17_m28_hispanic',
          'L12_f39_white', 'L03_m38_asian', 'L14_f42_black', 'L23_m45_white', 'L06_f53_white', 'L05_m59_black']
GROUP_OF = {'hispanic': 'Hispanic/Latino', 'black': 'Black', 'white': 'white', 'asian': 'East Asian'}   # cast group -> manifest background_group


def person_info(name):
    """L08_f24_hispanic -> sex, age, our group, the manifest's background name"""
    m = re.match(r'(L\d\d)_([fm])(\d\d)_(\w+)', name)
    return dict(name=name, sex=m.group(2), age=int(m.group(3)), group=m.group(4), bg=GROUP_OF.get(m.group(4), m.group(4)))


def age_band(a):
    return '20-29' if a < 30 else '30-39' if a < 40 else '40-49' if a < 50 else '50-59' if a < 60 else '60+'


def load_manifest():
    return list(csv.DictReader(open(MANIFEST)))


def is_modern(r):
    """dated 1990 or later (or a digital-era source with no date); the LoC FSA/OWI rows (1935-45) are not modern (c2_merge.is_modern)"""
    return not (r.get('source') or '').startswith('loc') and (not r.get('date') or (r['date'][:4] >= '1990'))


def photo_path(r):
    return os.path.join(CACHE, r['local_path']) if r.get('local_path') else None


def typical(rows=None, modern=True):
    rows = rows if rows is not None else load_manifest()
    return [r for r in rows if r['use'] == 'typical' and r['status'] == 'kept' and (is_modern(r) or not modern)]


def portraits(rows=None):
    """c3's head-and-shoulders portraits: typical, kept, modern, head and neck in frame, not a full figure, with a local file"""
    out = []
    for r in typical(rows):
        if r['crop'] != 'close_head_neck' or 'head_neck' not in r['region']: continue
        p = photo_path(r)
        if p and os.path.isfile(p): out.append(r)
    return out


# ---------------------------------------------------------------- statistics
def quant(v, qs=(10, 25, 50, 75, 90)):
    v = [float(x) for x in v if x is not None and not (isinstance(x, float) and math.isnan(x))]
    if not v: return dict(n=0)
    import numpy as np
    a = np.asarray(v)
    d = dict(n=len(v))
    for q in qs: d[f'p{q}'] = round(float(np.percentile(a, q)), 4)
    return d


def pct_rank(v, dist_values):
    a = [x for x in dist_values if x is not None]
    if not a or v is None: return None
    return round(100.0 * sum(1 for x in a if x < v) / len(a) + 50.0 * sum(1 for x in a if x == v) / len(a), 1)


def gate(v, q, wide=False, floor=8):
    """PASS when v is inside the photos' interquartile range (wide: inside p10-p90); None when there is nothing to compare"""
    if v is None or q is None or q.get('n', 0) < floor: return None
    lo, hi = (q['p10'], q['p90']) if wide else (q['p25'], q['p75'])
    return 'PASS' if lo <= v <= hi else 'FAIL'


def side(v, q, floor=8):
    if v is None or q is None or q.get('n', 0) < floor: return ''
    if v < q['p10']: return 'below p10'
    if v < q['p25']: return 'below IQR'
    if v <= q['p75']: return ''
    if v <= q['p90']: return 'above IQR'
    return 'above p90'


def pick_dist(dists, sex, bg, min_n=15):
    """dists: {(sex, bg): quant, (sex, None): quant, (None, None): quant}. The finest photo group with n >= min_n: sex x background, then sex, then all."""
    for k in ((sex, bg), (sex, None), (None, None)):
        q = dists.get(k)
        if q and q.get('n', 0) >= min_n: return k, q
    k = (sex, None); return k, dists.get(k) or dists.get((None, None))


def group_dists(items, key, by_age=False):
    """items: list of dicts with sex, bg, age_band, and key -> the {(sex, bg): quant} table (also by sex, all, and optionally age band)"""
    out = {}
    def add(k, rows): out[k] = quant([r.get(key) for r in rows])
    add((None, None), items)
    for bg in sorted({r['bg'] for r in items if r.get('bg')}):
        B = [r for r in items if r['bg'] == bg]
        if len(B) >= 5: add((None, bg), B)
    for s in ('f', 'm'):
        S = [r for r in items if r['sex'] == s]; add((s, None), S)
        for bg in sorted({r['bg'] for r in S if r.get('bg')}):
            B = [r for r in S if r['bg'] == bg]
            if len(B) >= 5: add((s, bg), B)
        if by_age:
            for ab in ('20-29', '30-39', '40-49', '50-59', '60+'):
                A = [r for r in S if r.get('age_band') == ab]
                if len(A) >= 5: add((s, 'age ' + ab), A)
    return out


def dist_table_json(dists):
    return {f"{k[0] or 'all'}|{k[1] or 'all'}": v for k, v in dists.items()}


# ---------------------------------------------------------------- our plates
def find_plates(dirs, pattern):
    """pattern: a glob relative to each dir (searched recursively). Returns {basename without extension: path} (the first one found wins)."""
    out = {}
    for d in dirs:
        for p in sorted(glob.glob(os.path.join(d, '**', pattern), recursive=True)):
            k = os.path.splitext(os.path.basename(p))[0]
            out.setdefault(k, p)
    return out


def default_ours_dirs():
    b = os.path.join(VIDEOS, 'out', 'bench')
    ds = [os.path.join(b, x) for x in sorted(os.listdir(b)) if x.startswith(('human8_integ', 'human8_refm'))] if os.path.isdir(b) else []
    return ds + [os.path.join(C8, 'after', 'integration6', 'clips'), os.path.join(SCRATCH, 'front')]


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(obj, open(path, 'w'), indent=1, sort_keys=False)


def write_csv(path, rows, cols=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cols = cols or list(rows[0].keys())
    w = csv.writer(open(path, 'w', newline=''))
    w.writerow(cols)
    for r in rows: w.writerow([r.get(c, '') for c in cols])
