#!/usr/bin/env python3
"""HUMAN c8 lane A: the population tables the body studio samples from and checks against (our own calibration, from public data).

    python3 videos/scripts/body_calib.py fetch            # downloads the public files into ~/.cache/acp_human/data (about 50 MB, not vendored)
    python3 videos/scripts/body_calib.py build            # -> videos/web/assets/body/population.json (compact derived tables, ~100 KB)
    python3 videos/scripts/body_calib.py report [cast.json]   # prints the tables; with a cast, its measures against them

What it derives (all from microdata we do not vendor; only the derived tables are written):
  - NHANES 2017-2018 body measures (BMX_J + DEMO_J; the cycle with a HIP tape), adults 20+, by sex x age band (20-39, 40-59, 60-79,
    80+) x group (Hispanic, NH White, NH Black, NH Asian; 'all' includes other/multiracial). A Gaussian copula per cell: the survey-
    weighted marginal quantiles of each variable (age, stature, BMI, waist at the iliac crest, hip, mid-upper-arm circumference,
    upper-leg length, upper-arm length) and the correlation of their normal scores, so a sampled person carries her measures
    together (a short wide-hipped woman, a tall thin one) and the marginals are exactly the survey's, skew and all. This is the
    form Anny used with WHO tables (phenotype distributions conditioned on age and sex), with the joint structure kept. Pregnant
    participants are their own reference row (RIDEXPRG = 1).
  - ANSUR II (US Army 2012, public release; ALL 4,082 men and 1,986 women): linear models of 50 measures (bust/chest, thigh, calf,
    biacromial, bicristal and hip breadths, sitting and crotch heights, segment lengths ...) on stature, BMI, hip (buttock)
    circumference, age and group, with the residual SD and the residual correlation, so a person sampled from NHANES gets a frame
    and girths that go with her stature and build. ANSUR is a young, fit sample; conditioning on BMI and hip carries it to civilians
    only partly (stated in the notes).
  - NHANES DXA (2017-2018 DXX_J ages 20-59; 2005-2006 DXX_D ages 60-85, implicate 1): percent fat, trunk / arm / leg shares of the fat
    mass, appendicular lean mass index and fat-free mass index, as models on BMI, age and group with residuals. This is where the fat
    depots' sex and age weighting comes from (Wells 2007 and Kuk et al. 2009 describe the same shifts; here they are measured).
  - NHANES 2005-2006 skinfolds (triceps, subscapular) by sex and age band: the check for the depot layer's peripheral/central balance.
  - NHANES 2017-2018 reproductive health (RHQ_J): parity by age band, and the share of women post-menopause by age (a logistic fit).
  - Constants from the literature, each with its citation, for the sampler and the kinematic model (FFIT shares, breast volume,
    de Leva 1996, the CDC normal-ROM reference table, carrying angle, gait and stance): written to the same JSON under 'lit'.

Licences: NHANES and the CDC ROM reference table are US Government works (public domain); ANSUR II public release is a US Government
work. de Leva's table, Smith 2002, Chumanov 2008, Van Roy 2005, Coltman 2017/2018, McIlroy and Maki 1997, Whitcome 2007, Janssen 2000,
Schutz 2002 and Ambikairajah 2019 are published numbers transcribed with citation. Nothing here is a copy of anyone's model.
"""
import os, sys, json, struct, math, csv
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.expanduser('~/.cache/acp_human/data')
OUT = os.path.join(HERE, '..', 'web', 'assets', 'body', 'population.json')
NH = 'https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public/{y}/DataFiles/{f}.XPT'
FILES = {'BMX_J': 2017, 'DEMO_J': 2017, 'DXX_J': 2017, 'RHQ_J': 2017, 'BMX_D': 2005, 'DEMO_D': 2005, 'DXX_D': 2005}
ANSUR = {'m': 'https://tools.openlab.psu.edu/publicData/ANSUR_II_MALE_Public.csv', 'f': 'https://tools.openlab.psu.edu/publicData/ANSUR_II_FEMALE_Public.csv'}

def fetch():
    import urllib.request
    os.makedirs(CACHE, exist_ok=True)
    for f, y in FILES.items():
        p = os.path.join(CACHE, f + '.XPT')
        if not os.path.exists(p): urllib.request.urlretrieve(NH.format(y=y, f=f), p); print('got', f)
    for s, u in ANSUR.items():
        p = os.path.join(CACHE, os.path.basename(u))
        if not os.path.exists(p): urllib.request.urlretrieve(u, p); print('got', p)

# ---------------------------------------------------------------- SAS XPORT v5 (IBM floats), vectorised
def read_xpt(p):
    d = open(p, 'rb').read(); i = d.index(b'HEADER RECORD*******NAMESTR HEADER RECORD'); nvar = int(d[i + 54:i + 58]); i += 80
    vs = []
    for k in range(nvar):
        r = d[i + k * 140:i + (k + 1) * 140]; t, _, ln, _ = struct.unpack('>hhhh', r[:8]); vs.append((r[8:16].decode().strip(), t, ln, struct.unpack('>i', r[84:88])[0]))
    j = d.index(b'HEADER RECORD*******OBS     HEADER RECORD', i + nvar * 140 - 80) + 80
    rl = sum(v[2] for v in vs); n = (len(d) - j) // rl; raw = np.frombuffer(d[j:j + n * rl], dtype=np.uint8).reshape(n, rl); out = {}
    for nm, t, ln, pos in vs:
        b = raw[:, pos:pos + ln]
        if t != 1: out[nm] = np.array([bytes(x).decode('latin1').strip() for x in b]); continue
        bb = np.zeros((n, 8), np.uint8); bb[:, :ln] = b; u = bb.astype(np.uint64)
        hi = (u[:, 0] << 24) | (u[:, 1] << 16) | (u[:, 2] << 8) | u[:, 3]; lo = (u[:, 4] << 24) | (u[:, 5] << 16) | (u[:, 6] << 8) | u[:, 7]
        v = np.where(hi & 0x80000000, -1.0, 1.0) * ((((hi & 0x00ffffff) << 32) | lo).astype(np.float64) / float(1 << 56)) * np.power(16.0, ((hi >> 24) & 0x7f).astype(np.int64) - 64)
        miss = (bb[:, 1:] == 0).all(1) & (((bb[:, 0] >= 0x41) & (bb[:, 0] <= 0x5a)) | (bb[:, 0] == 0x2e) | (bb[:, 0] == 0x5f))
        v[miss] = np.nan; out[nm] = v
    keep = ~np.isnan(out['SEQN']) if 'SEQN' in out else slice(None)
    return {k: v[keep] for k, v in out.items()}
def join(a, b):   # rows of b aligned to a's SEQN (nan where absent)
    ix = {s: k for k, s in enumerate(b['SEQN'])}; m = np.array([ix.get(s, -1) for s in a['SEQN']])
    return {k: np.where(m >= 0, v[np.maximum(m, 0)], np.nan) if v.dtype.kind == 'f' else v[np.maximum(m, 0)] for k, v in b.items()}

# ---------------------------------------------------------------- weighted statistics
from math import erf, sqrt
def ndtri(p):   # inverse normal CDF (Acklam), vectorised
    p = np.clip(np.asarray(p, float), 1e-9, 1 - 1e-9)
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]
    q = np.where(p < 0.5, p, 1 - p); r = np.sqrt(-2 * np.log(q))
    x = (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
    lo = p < 0.02425; mid = (p >= 0.02425) & (p <= 1 - 0.02425)
    qq = p - 0.5; rr = qq * qq
    xm = (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * qq / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1)
    return np.where(mid, xm, np.where(lo, x, -x))     # Acklam's tail formula is negative for small p: lower tail as is, upper tail mirrored
def wquant(x, w, P):
    o = np.argsort(x); x, w = x[o], w[o]; c = (np.cumsum(w) - 0.5 * w) / w.sum(); return np.interp(P, c, x)
def wscores(x, w):   # weighted mid-rank normal scores
    o = np.argsort(x, kind='stable'); c = (np.cumsum(w[o]) - 0.5 * w[o]) / w.sum(); z = np.empty(len(x)); z[o] = ndtri(c); return z
def wcorr(Z, w):
    w = w / w.sum(); m = (Z * w[:, None]).sum(0); Zc = Z - m; C = (Zc * w[:, None]).T @ Zc; s = np.sqrt(np.diag(C)); return C / np.outer(s, s)
def wls(X, y, w):
    W = w / w.mean(); A = X * W[:, None]; beta = np.linalg.solve(X.T @ A + 1e-9 * np.eye(X.shape[1]), A.T @ y); r = y - X @ beta
    return beta, r, math.sqrt(float((W * r * r).sum() / max(1, W.sum() - X.shape[1])))
R = lambda a, k=4: [round(float(v), k) for v in np.asarray(a).ravel()]

P = np.array([0.005, 0.01, 0.025, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99, 0.995])
BANDS = [('20-39', 20, 39), ('40-59', 40, 59), ('60-79', 60, 79), ('80+', 80, 200)]
GROUPS = {'hispanic': [1, 2], 'white': [3], 'black': [4], 'asian': [6]}
VARS = ['age', 'stature', 'bmi', 'waist', 'hip', 'muac', 'upperleg', 'upperarm']
NHCOL = {'stature': 'BMXHT', 'bmi': 'BMXBMI', 'waist': 'BMXWAIST', 'hip': 'BMXHIP', 'muac': 'BMXARMC', 'upperleg': 'BMXLEG', 'upperarm': 'BMXARML'}

def nhanes_cells():
    bmx = read_xpt(f'{CACHE}/BMX_J.XPT'); demo = join(bmx, read_xpt(f'{CACHE}/DEMO_J.XPT'))
    sex, age, race, preg, wt = demo['RIAGENDR'], demo['RIDAGEYR'], demo['RIDRETH3'], demo['RIDEXPRG'], demo['WTMEC2YR']
    X = np.stack([age] + [bmx[NHCOL[v]] for v in VARS[1:]], 1)
    ok = np.isfinite(X).all(1) & (age >= 20) & np.isfinite(wt) & (wt > 0)
    cells = {}
    for s, sx in ((1, 'm'), (2, 'f')):
        for band, a0, a1 in BANDS:
            m = ok & (sex == s) & (age >= a0) & (age <= a1) & (preg != 1)
            Z = np.zeros((m.sum(), len(VARS))); idx = np.where(m)[0]; gz = race[idx]
            q = {'all': {v: R(wquant(X[m, k], wt[m], P), 2) for k, v in enumerate(VARS)}}; ng = {'all': int(m.sum())}
            for g, codes in GROUPS.items():
                mg = m & np.isin(race, codes); ng[g] = int(mg.sum())
                if mg.sum() >= 40: q[g] = {v: R(wquant(X[mg, k], wt[mg], P), 2) for k, v in enumerate(VARS)}
            # normal scores within the person's own group cell (so the pooled correlation is not inflated by group differences)
            for g, codes in list(GROUPS.items()) + [('other', [7])]:
                sel = np.isin(gz, codes)
                if sel.sum() < 5: continue
                for k in range(len(VARS)): Z[sel, k] = wscores(X[idx[sel], k], wt[idx[sel]])
            cells[f'{sx}|{band}'] = {'n': ng, 'rho': R(wcorr(Z, wt[m]), 3), 'q': q}
    # groups too small for their own band cell: shift the band's 'all' quantiles by the group's offset pooled over bands (same sex)
    for sx in 'mf':
        for g, codes in GROUPS.items():
            pooled = ok & (sex == (1 if sx == 'm' else 2)) & np.isin(race, codes) & (preg != 1); allp = ok & (sex == (1 if sx == 'm' else 2)) & (preg != 1)
            off = {v: wquant(X[pooled, k], wt[pooled], P) - wquant(X[allp, k], wt[allp], P) for k, v in enumerate(VARS) if v != 'age'}
            for band, *_ in BANDS:
                c = cells[f'{sx}|{band}']
                if g not in c['q']: c['q'][g] = {v: (c['q']['all'][v] if v == 'age' else R(np.array(c['q']['all'][v]) + off[v], 2)) for v in VARS}; c['q'][g]['_from'] = 'band all + pooled group offset'
    pm = ok & (sex == 2) & (preg == 1)
    preg_row = {'n': int(pm.sum()), 'ages': R(wquant(age[pm], wt[pm], [0.1, 0.5, 0.9]), 1), **{v: R(wquant(X[pm, k], wt[pm], [0.1, 0.5, 0.9]), 1) for k, v in enumerate(VARS) if v != 'age'}}
    return cells, preg_row, (sex, age, race, wt, X, ok, preg)

ANS_T = ['chestcircumference', 'waistcircumference', 'buttockcircumference', 'thighcircumference', 'lowerthighcircumference', 'calfcircumference', 'anklecircumference',
         'bicepscircumferenceflexed', 'forearmcircumferenceflexed', 'wristcircumference', 'neckcircumference', 'neckcircumferencebase', 'shouldercircumference', 'headcircumference',
         'biacromialbreadth', 'bideltoidbreadth', 'bicristalbreadth', 'hipbreadth', 'chestbreadth', 'chestdepth', 'waistbreadth', 'waistdepth', 'buttockdepth', 'headbreadth', 'headlength',
         'sittingheight', 'crotchheight', 'acromialheight', 'axillaheight', 'chestheight', 'suprasternaleheight', 'cervicaleheight', 'tenthribheight', 'waistheightomphalion', 'iliocristaleheight',
         'trochanterionheight', 'buttockheight', 'kneeheightmidpatella', 'lateralfemoralepicondyleheight', 'tibialheight', 'lateralmalleolusheight', 'shoulderelbowlength', 'forearmhandlength',
         'radialestylionlength', 'handlength', 'handbreadth', 'footlength', 'footbreadthhorizontal', 'span', 'interscyei']
ANS_X = ['1', 'stature', 'bmi', 'hip', 'age', 'black', 'hispanic', 'asian']
def ansur_models():
    out = {}
    for sx in 'mf':
        rows = list(csv.DictReader(open(os.path.join(CACHE, os.path.basename(ANSUR[sx])), encoding='latin-1')))
        g = lambda c: np.array([float(r[c]) for r in rows])
        H = g('stature') / 10; Wt = g('weightkg') / 10; bmi = Wt / (H / 100) ** 2; hip = g('buttockcircumference') / 10; age = g('Age'); race = g('DODRace')
        X = np.stack([np.ones(len(H)), H, bmi, hip, age, race == 2, race == 3, race == 4], 1).astype(float)
        mods = {}; res = []
        for c in ANS_T:
            y = g(c) / 10; beta, r, sd = wls(X, y, np.ones(len(y))); mods[c] = {'b': R(beta, 5), 'sd': round(sd, 3), 'mean': round(float(y.mean()), 2)}; res.append(r / sd)
        rho = np.corrcoef(np.array(res))
        out[sx] = {'n': len(rows), 'x': ANS_X, 'models': mods, 'rho': R(rho, 3), 'targets': ANS_T,
                   'summary': {'stature': R(np.percentile(H, [10, 50, 90]), 1), 'bmi': R(np.percentile(bmi, [10, 50, 90]), 1), 'age': R(np.percentile(age, [10, 50, 90]), 0), 'over50': int((age > 50).sum())}}
    return out

def dxa_models():
    out = {}
    def load(sfx, mult=None):
        dx = read_xpt(f'{CACHE}/DXX_{sfx}.XPT')
        if '_MULT_' in dx: k = dx['_MULT_'] == 1; dx = {a: b[k] for a, b in dx.items()}
        bm = join(dx, read_xpt(f'{CACHE}/BMX_{sfx}.XPT')); de = join(dx, read_xpt(f'{CACHE}/DEMO_{sfx}.XPT'))
        race = de['RIDRETH3'] if 'RIDRETH3' in de else np.where(de['RIDRETH1'] == 5, 7, de['RIDRETH1'])
        return dx, bm, de, race
    parts = []
    for sfx, a0, a1 in (('J', 20, 59), ('D', 60, 90)):
        dx, bm, de, race = load(sfx)
        tf = dx['DXDTOFAT'] / 1000; trf = dx['DXXTRFAT'] / 1000; af = (dx['DXXLAFAT'] + dx['DXXRAFAT']) / 1000; lf = (dx['DXXLLFAT'] + dx['DXXRLFAT']) / 1000
        al = (dx['DXDLALE'] + dx['DXDRALE'] + dx['DXDLLLE'] + dx['DXDRLLE']) / 1000; ffm = (dx['DXDTOLE'] + dx['DXDTOBMC']) / 1000
        H = bm['BMXHT'] / 100; age = de['RIDAGEYR']; bmi = bm['BMXBMI']; wt = de['WTMEC2YR']; preg = de.get('RIDEXPRG', np.full(len(age), np.nan))
        ok = np.isfinite(tf + trf + af + lf + al + ffm + H + bmi + wt) & (age >= a0) & (age <= a1) & (tf > 0) & (preg != 1) & (dx['DXAEXSTS'] == 1)
        parts.append(dict(sex=de['RIAGENDR'][ok], age=age[ok], bmi=bmi[ok], race=race[ok], w=wt[ok] / wt[ok].mean(), pf=100 * tf[ok] / (tf[ok] + ffm[ok]), ftr=trf[ok] / tf[ok],
                          farm=af[ok] / tf[ok], fleg=lf[ok] / tf[ok], almi=al[ok] / H[ok] ** 2, ffmi=ffm[ok] / H[ok] ** 2, fmi=tf[ok] / H[ok] ** 2))
    D = {k: np.concatenate([p[k] for p in parts]) for k in parts[0]}
    for s, sx in ((1, 'm'), (2, 'f')):
        m = D['sex'] == s; a = D['age'][m]; b = D['bmi'][m]; rc = D['race'][m]; w = D['w'][m]
        X = np.stack([np.ones(m.sum()), 1 / b, b, (a - 50) / 10, ((a - 50) / 10) ** 2, rc == 4, np.isin(rc, [1, 2]), rc == 6], 1).astype(float)
        mods = {}; res = []
        for k in ('pf', 'ftr', 'farm', 'fleg', 'almi', 'ffmi'):
            beta, r, sd = wls(X, D[k][m], w); mods[k] = {'b': R(beta, 5), 'sd': round(sd, 4)}; res.append(r / sd)
        bands = {}
        for band, a0, a1 in BANDS:
            mm = (a >= a0) & (a <= a1)
            if mm.sum() > 30: bands[band] = {k: R(wquant(D[k][m][mm], w[mm], [0.1, 0.5, 0.9]), 3) for k in ('pf', 'ftr', 'farm', 'fleg', 'almi', 'ffmi', 'fmi')} | {'n': int(mm.sum())}
        out[sx] = {'x': ['1', '1/bmi', 'bmi', '(age-50)/10', '((age-50)/10)^2', 'black', 'hispanic', 'asian'], 'models': mods, 'rho': R(np.corrcoef(np.array(res)), 3), 'bands': bands, 'n': int(m.sum())}
    out['note'] = 'NHANES DXA: 2017-2018 DXX_J ages 20-59 and 2005-2006 DXX_D ages 60-85 (first imputation; 2005-06 has no NH Asian code, so the asian term is fitted on 20-59 only). Fat fractions are of total fat mass; ALMI = arm + leg lean (no BMC) / H^2; FFMI = lean + BMC / H^2.'
    return out

def skinfolds():
    bmx = read_xpt(f'{CACHE}/BMX_D.XPT'); de = join(bmx, read_xpt(f'{CACHE}/DEMO_D.XPT')); out = {}
    for s, sx in ((1, 'm'), (2, 'f')):
        for band, a0, a1 in BANDS:
            m = (de['RIAGENDR'] == s) & (de['RIDAGEYR'] >= a0) & (de['RIDAGEYR'] <= a1) & np.isfinite(bmx['BMXTRI']) & np.isfinite(bmx['BMXSUB']) & (de['RIDEXPRG'] != 1)
            w = de['WTMEC2YR'][m]
            out[f'{sx}|{band}'] = {'n': int(m.sum()), 'tri': R(wquant(bmx['BMXTRI'][m], w, [0.1, 0.5, 0.9]), 1), 'sub': R(wquant(bmx['BMXSUB'][m], w, [0.1, 0.5, 0.9]), 1),
                                    'sub_tri_p50': round(float(np.median(bmx['BMXSUB'][m] / bmx['BMXTRI'][m])), 3),
                                    'thigh': R(wquant(bmx['BMXTHICR'][m][np.isfinite(bmx['BMXTHICR'][m])], w[np.isfinite(bmx['BMXTHICR'][m])], [0.1, 0.5, 0.9]), 1),
                                    'calf': R(wquant(bmx['BMXCALF'][m][np.isfinite(bmx['BMXCALF'][m])], w[np.isfinite(bmx['BMXCALF'][m])], [0.1, 0.5, 0.9]), 1) if np.isfinite(bmx['BMXCALF'][m]).sum() > 30 else None}
    return out

def reproductive():
    rh = read_xpt(f'{CACHE}/RHQ_J.XPT'); de = join(rh, read_xpt(f'{CACHE}/DEMO_J.XPT')); age = de['RIDAGEYR']; w = de['WTINT2YR']
    par = np.where(rh['RHQ131'] == 2, 0, rh['RHQ171']); par = np.where(par > 50, np.nan, par)
    out = {'parity': {}}
    for band, a0, a1 in BANDS:
        m = (age >= a0) & (age <= a1) & np.isfinite(par)
        if m.sum() < 20: continue
        p = par[m]; ww = w[m]; out['parity'][band] = {'n': int(m.sum()), 'p0': 0, 'p1': 0, 'p2': 0, 'p3': 0, 'p4+': 0}
        for k, sel in (('p0', p == 0), ('p1', p == 1), ('p2', p == 2), ('p3', p == 3), ('p4+', p >= 4)): out['parity'][band][k] = round(float(ww[sel].sum() / ww.sum()), 3)
    # menopause: no regular periods in 12 months and the reason given is menopause/change of life (RHD043 == 7), or age at last period known
    m = (age >= 35) & (age <= 70) & ((rh['RHQ031'] == 1) | ((rh['RHQ031'] == 2) & (rh['RHD043'] == 7)))   # hysterectomy (3), other and unknown reasons left out
    post = (rh['RHQ031'] == 2) & np.isin(rh['RHD043'], [7]); a = age[m]; y = post[m].astype(float)
    best = None
    for a50 in np.arange(44, 60, 0.1):
        for s in np.arange(1.0, 6.0, 0.1):
            p = 1 / (1 + np.exp(-(a - a50) / s)); ll = (w[m] * (y * np.log(p + 1e-9) + (1 - y) * np.log(1 - p + 1e-9))).sum()
            if best is None or ll > best[0]: best = (ll, a50, s)
    out['menopause'] = {'a50': round(best[1], 1), 's': round(best[2], 2), 'form': 'P(post | age) = 1 / (1 + exp(-(age - a50) / s)); fitted to NHANES 2017-18 RHQ031/RHD043 (no regular period in 12 months, reason menopause), women 35-70, survey-weighted; women with a hysterectomy or another or unknown reason left out of the fit',
                        'n': int(m.sum())}
    return out

# ---------------------------------------------------------------- literature constants (transcribed with citation)
LIT = {
  'ffit_sizeusa': {'shares': {'rectangle': 0.46, 'spoon': 0.20, 'inverted_triangle': 0.14, 'hourglass': 0.08, 'other': 0.12},
                   'cite': 'SizeUSA women classed by the Female Figure Identification Technique (Simmons, Istook and Devarajan 2004, JTATM 4(1)); shares as reported by NC State (Istook) and in the same order by Lee, Istook, Nam and Park 2007 (IJCST 19:374). "other" = triangle, top and bottom hourglass.',
                   'rules_in': 'FFIT on bust B, natural waist W, hip H, high hip HH (inches): hourglass (B-H<=1 and H-B<3.6 and (B-W>=9 or H-W>=10)); bottom hourglass (H-B>=3.6 and H-B<10 and H-W>=9 and HH/W<1.193); top hourglass (B-H>1 and B-H<10 and B-W>=9); spoon (H-B>2 and H-W>=7 and HH/W>=1.193); triangle (H-B>=3.6 and H-W<9); inverted triangle (B-H>=3.6 and B-W<9); rectangle (|H-B|<3.6 and B-W<9 and H-W<10).'},
  'breast_volume': {'form': 'per breast, mL: exp(ln(v22) + k (BMI - 22) + e), e ~ N(0, sd)', 'v22': 380, 'k': 0.088, 'sd': 0.42, 'min': 50, 'max': 3100,
                    'cite': 'Coltman, Steele and McGhee 2017 (Ergonomics 60:1576): 356 women 18-84 y, BMI 18-55, volumes 48-3,100 mL; volume follows BMI, not age; overweight and obese women 2-3x normal-BMI volumes. The curve is OUR fit to those statements (median ~380 mL at BMI 22, x2.4 by BMI 32), not their equation.'},
  'ptosis': {'cite': 'Regnault 1976 grades 0-3 (nipple relative to the inframammary fold); Coltman et al. 2018 (Ergonomics 61:1232): four clusters, ptosis rising with age and BMI. Our grade model: logistic in age, volume and parity (assumption, stated in the notes).'},
  'deleva1996': {'cite': 'de Leva P. Adjustments to Zatsiorsky-Seluyanov segment inertia parameters. J Biomech 29:1223-30, 1996 (values as tabulated in github.com/BMClab/BMC data/BSP{female,male}_ZdeLeva.txt). Mass = fraction of body mass; CM = from the proximal endpoint as a fraction of length; Rg = radii of gyration (sagittal, transverse, longitudinal) as fractions of length.',
                 'cols': ['mass', 'cm', 'rg_sag', 'rg_trans', 'rg_long'],
                 'f': {'head': ['VERT', 'MIDG', 0.0668, 0.5894, 0.33, 0.359, 0.318], 'trunk': ['SUPR', 'MIDH', 0.4257, 0.4151, 0.357, 0.339, 0.171], 'upperTrunk': ['SUPR', 'XYPH', 0.1545, 0.2077, 0.746, 0.502, 0.718],
                       'midTrunk': ['XYPH', 'OMPH', 0.1465, 0.4512, 0.433, 0.354, 0.415], 'lowerTrunk': ['OMPH', 'MIDH', 0.1247, 0.492, 0.433, 0.402, 0.444], 'upperArm': ['SJC', 'EJC', 0.0255, 0.5754, 0.278, 0.26, 0.148],
                       'forearm': ['EJC', 'WJC', 0.0138, 0.4559, 0.261, 0.257, 0.094], 'hand': ['WJC', 'MET3', 0.0056, 0.7474, 0.531, 0.454, 0.335], 'thigh': ['HJC', 'KJC', 0.1478, 0.3612, 0.369, 0.364, 0.162],
                       'shank': ['KJC', 'AJC', 0.0481, 0.4352, 0.267, 0.263, 0.092], 'foot': ['HEEL', 'TTIP', 0.0129, 0.4014, 0.299, 0.279, 0.139], 'head2': ['VERT', 'CERV', 0.0668, 0.4841, 0.271, 0.295, 0.261]},
                 'm': {'head': ['VERT', 'MIDG', 0.0694, 0.5976, 0.362, 0.376, 0.312], 'trunk': ['SUPR', 'MIDH', 0.4346, 0.4486, 0.372, 0.347, 0.191], 'upperTrunk': ['SUPR', 'XYPH', 0.1596, 0.2999, 0.716, 0.454, 0.659],
                       'midTrunk': ['XYPH', 'OMPH', 0.1633, 0.4502, 0.482, 0.383, 0.468], 'lowerTrunk': ['OMPH', 'MIDH', 0.1117, 0.6115, 0.615, 0.551, 0.587], 'upperArm': ['SJC', 'EJC', 0.0271, 0.5772, 0.285, 0.269, 0.158],
                       'forearm': ['EJC', 'WJC', 0.0162, 0.4574, 0.276, 0.265, 0.121], 'hand': ['WJC', 'MET3', 0.0061, 0.79, 0.628, 0.513, 0.401], 'thigh': ['HJC', 'KJC', 0.1416, 0.4095, 0.329, 0.329, 0.149],
                       'shank': ['KJC', 'AJC', 0.0433, 0.4395, 0.251, 0.246, 0.102], 'foot': ['HEEL', 'TTIP', 0.0137, 0.4415, 0.257, 0.245, 0.124], 'head2': ['VERT', 'CERV', 0.0694, 0.5002, 0.303, 0.315, 0.261]}},
  'rom_cdc': {'cite': 'CDC Normal Joint Range of Motion Study (2003-2006), published reference values (Soucie JM et al., Haemophilia 17:500-507, 2011; table at archive.cdc.gov/www_cdc_gov/ncbddd/jointrom). Means (95% CI half-width) in degrees. Only the published table is used, not the restricted microdata. Elbow and knee "extension" are hyperextension past straight.',
              'bands': ['20-44', '45-69'],
              'f': {'hipExt': [[18.1, 1.1], [16.7, 1.2]], 'hipFlex': [[133.8, 1.3], [130.8, 1.6]], 'kneeFlex': [[141.9, 1.0], [137.8, 1.3]], 'kneeExt': [[1.6, 0.5], [1.2, 0.5]], 'ankleDorsi': [[13.8, 0.9], [11.6, 1.0]],
                    'anklePlantar': [[62.1, 1.5], [56.5, 1.5]], 'shoulderFlex': [[172.0, 1.1], [168.1, 1.4]], 'elbowFlex': [[150.0, 0.9], [148.3, 1.0]], 'elbowExt': [[4.7, 0.8], [3.6, 1.0]], 'pronation': [[82.0, 1.0], [80.8, 1.1]], 'supination': [[90.6, 1.4], [87.2, 1.2]]},
              'm': {'hipExt': [[17.4, 1.1], [13.5, 1.0]], 'hipFlex': [[130.4, 1.4], [127.2, 1.5]], 'kneeFlex': [[137.7, 1.2], [132.9, 1.3]], 'kneeExt': [[1.0, 0.4], [0.5, 0.4]], 'ankleDorsi': [[12.7, 1.1], [11.9, 1.0]],
                    'anklePlantar': [[54.6, 1.4], [49.4, 1.7]], 'shoulderFlex': [[168.8, 1.5], [164.0, 1.7]], 'elbowFlex': [[144.6, 1.0], [143.5, 1.2]], 'elbowExt': [[0.8, 0.7], [-0.7, 0.8]], 'pronation': [[76.9, 1.3], [77.7, 1.2]], 'supination': [[85.0, 1.2], [82.4, 1.5]]},
              'spread': 'per-person SD estimated from the CI: SD = halfwidth x sqrt(n) / 1.96 with n ~ 80 per sex x band cell (an assumption: the cell sizes are in the study, not the table); floored at 3 deg'},
  'carrying_angle': {'f': [16.7, 2.6], 'm': [11.6, 3.2], 'cite': 'Van Roy et al. 2005 (Ergonomics 48:1645): electromagnetic tracking, 10 women and 10 men, mean age 25; extension, mean +/- SD (deg). Small sample; other reports run 13-17 (women) and 10-12 (men). The angle falls to ~2 deg varus at full flexion (also from Van Roy).'},
  'gait': {'pelvicObliquity': {'f': [9.4, 3.5], 'm': [7.4, 3.4]}, 'comVertical': {'f': [3.3, 0.8], 'm': [3.7, 0.9]},
           'cite': 'Smith, Lelas and Kerrigan 2002 (J Womens Health 11:453), 120 adults: frontal pelvic obliquity RANGE (deg, mean +/- SD) and vertical COM displacement (% leg length; the abstract reports 3.7 for women and 3.3 for men in one sentence, then concludes women have LESS: we take the conclusion, women 3.3 and men 3.7, and flag the ambiguity). Chumanov, Wall-Scheffler and Heiderscheit 2008 (Clin Biomech 23:1260): women greater peak hip adduction and internal rotation in walking, correlated with bitrochanteric width / leg length (no numbers used: we scale an assumed 2-4 deg difference by that ratio).'},
  'stance': {'heelSep': 0.17, 'footAngle': 14, 'cite': 'McIlroy and Maki 1997 (Clin Biomech 12:66): preferred quiet stance in 262 adults 19-97 y: 0.17 m between heel centres, 14 deg between the feet; large variation between people, small mean differences by sex or age.'},
  'pregnancy': {'cite': 'Fundal height ~ gestational week in cm, weeks 20-36 (clinical rule, +/- 2 cm). Weight-gain components at 40 weeks (Hytten 1991 as summarised in IOM 2009, Weight Gain During Pregnancy, table 4-1): fetus 3.4, placenta 0.65, amniotic fluid 0.8, uterus 0.97, breasts 0.41, blood 1.45, extracellular fluid 1.5, maternal fat 3.35 kg. Recommended total gain by pre-pregnancy BMI (IOM 2009): <18.5: 12.5-18; 18.5-25: 11.5-16; 25-30: 7-11.5; 30+: 5-9 kg. Lumbar extension in late pregnancy up to ~28 deg (Whitcome, Shapiro and Lieberman 2007, Nature 450:1075).',
                'term_kg': {'fetus': 3.4, 'placenta': 0.65, 'fluid': 0.8, 'uterus': 0.97, 'breasts': 0.41, 'blood': 1.45, 'ecf': 1.5, 'fat': 3.35}, 'gain_by_bmi': [[18.5, 15.25], [25, 13.75], [30, 9.25], [99, 7.0]]},
  'muscle_age': {'cite': 'Janssen, Heymsfield, Wang and Ross 2000 (J Appl Physiol 89:81): MRI skeletal muscle in 468 adults 18-88: men 33.0 vs women 21.0 kg; the sex gap larger in the upper body (40 %) than the lower (33 %); absolute loss from the end of the 5th decade, mostly in the lower body.'},
  'ffmi': {'cite': 'Schutz, Kyle and Pichard 2002 (Int J Obes 26:953): median FFMI 18-34 y: men 18.9, women 15.4 kg/m2; FMI rises 55 % (men) and 62 % (women) from young to old. Women of normal BMI 14.6-16.8 kg/m2 (their percentiles, as quoted by the women critic).'},
  'menopause_shift': {'cite': 'Ambikairajah et al. 2019 (Am J Obstet Gynecol 221:393), meta-analysis pre vs post menopause: +4.6 cm waist, +2.0 cm hip, +0.04 WHR, +5.5 % trunk fat, leg fat % down 3.2 %.'},
}

def build():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cells, preg, _ = nhanes_cells(); print('nhanes cells', len(cells))
    ans = ansur_models(); print('ansur', {k: v['n'] for k, v in ans.items()})
    dxa = dxa_models(); print('dxa', dxa['f']['n'], dxa['m']['n'])
    sk = skinfolds(); rep = reproductive()
    doc = {'version': 1, 'built': 'scripts/body_calib.py build', 'P': R(P, 4), 'vars': VARS, 'units': {'age': 'y', 'stature': 'cm', 'bmi': 'kg/m2', 'waist': 'cm (NHANES: iliac crest)', 'hip': 'cm (max buttock)', 'muac': 'cm', 'upperleg': 'cm', 'upperarm': 'cm'},
           'nhanes': {'cells': cells, 'pregnant': preg}, 'ansur': ans, 'dxa': dxa, 'skinfolds': sk, 'reproductive': rep, 'lit': LIT,
           'provenance': {
             'nhanes': 'CDC/NCHS NHANES 2017-2018 BMX_J, DEMO_J, DXX_J, RHQ_J; 2005-2006 BMX_D, DEMO_D, DXX_D. wwwn.cdc.gov/Nchs/Data/Nhanes/Public/{2017,2005}/DataFiles/. US Government work, public domain. Survey-weighted (WTMEC2YR, WTINT2YR).',
             'ansur': 'ANSUR II (2012) public release, US Army Natick; full files ANSUR_II_MALE_Public.csv (4,082) and ANSUR_II_FEMALE_Public.csv (1,986) from tools.openlab.psu.edu/publicData/. US Government work, public. Only model coefficients are written here.',
             'derived_by': 'videos/scripts/body_calib.py (ours, CC0)'}}
    s = json.dumps(doc, separators=(',', ':')); open(OUT, 'w').write(s); print('wrote', OUT, f'{len(s) / 1024:.0f} KB')

def report():
    doc = json.load(open(OUT)); c = doc['nhanes']['cells']; Pp = np.array(doc['P']); at = lambda q, p: round(float(np.interp(p, Pp, q)), 1)
    for k, v in c.items():
        q = v['q']['all']; print(f"{k:9} n={v['n']['all']:4}  H {at(q['stature'], .5)}  BMI {at(q['bmi'], .1)}/{at(q['bmi'], .5)}/{at(q['bmi'], .9)}  waist {at(q['waist'], .1)}/{at(q['waist'], .5)}/{at(q['waist'], .9)}  hip {at(q['hip'], .5)}  groups {v['n']}")
    print('pregnant', doc['nhanes']['pregnant'])
    for sx in 'fm':
        print(sx, 'DXA bands', json.dumps(doc['dxa'][sx]['bands'])[:600])
    print('skinfolds', json.dumps(doc['skinfolds'])[:900]); print('reproductive', doc['reproductive'])

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'build'
    {'fetch': fetch, 'build': build, 'report': report}[cmd]()
