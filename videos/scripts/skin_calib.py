#!/usr/bin/env python3
"""HUMAN c8 likeness (lane B): calibrate our biophysical skin albedo model and write web/assets/likeness/skin_model.json.

    python3 videos/scripts/skin_calib.py            (from the repo root or videos/; fetches the three public data files into
                                                     ~/.cache/acp_human/ if they are missing; ~20 s)

The model is ours; only data is taken. A two-layer skin in the spirit of Donner and Jensen 2006 ("A spectral BSSRDF for
shading human skin") and Jimenez et al. 2010 ("A practical appearance model for dynamic facial color"), reduced to what an
albedo needs:
  - epidermis: a thin absorbing layer. Melanin volume fraction Cm, a blend of eumelanin and pheomelanin (fraction beta of
    eumelanin; spectral shapes lambda^-3.33 and lambda^-4.75, Jacques 1998 / Donner and Jensen 2006), carotene Cc (beta-carotene
    molar extinction, PhotochemCAD via Prahl / OMLC), the bloodless tissue baseline (Jacques 1998). One-way diffuse transmittance
    t = exp(-2 mu_a d) (a Lambertian flux crosses a slab with a mean path of 2d).
  - dermis: semi-infinite, blood volume fraction Ch at oxygen saturation gamma (oxy- and deoxyhemoglobin molar extinction,
    Prahl's compilation of Gratzer and Kollias, 150 g/L Hb), plus the baseline; reduced scattering mu_s' = a (lambda/500)^-b
    (Jacques 2013's skin fit a = 46 cm^-1, b = 1.42 is the start; a and b are fitted). Diffuse reflectance of a matched
    half-space from the diffusion dipole: Rd = a'/2 (1 + exp(-4/3 sqrt(3(1-a')))) exp(-sqrt(3(1-a'))) (Jensen et al. 2001).
  - the skin-air boundary (n = 1.4): internal diffuse reflectance Fdr (Egan and Hilgeman fit), so light that turns back at the
    surface crosses the epidermis again: R_body = t^2 Rd (1 - Fdr) / (1 - Fdr t^2 Rd); a measured (sphere) reflectance adds the
    surface reflection Rs (fitted; Weyrich et al. 2006 put skin's index at ~1.38, a diffuse-averaged Fresnel of a few per cent).
The renderer uses the BODY reflectance (no Rs): three.js adds the specular itself (ior 1.4).

Calibration (the "gamut covers the measurements" test the plan asks for):
  1. NIST skin reflectance (Cooksey, Allen, Tsai 2017; 100 subjects, US Government public data): each spectrum 400-700 nm is
     fitted by (Cm, beta, Ch, gamma, Cc) with the global constants (a, b, Rs, d) shared, and the globals fitted to minimise the
     summed error. Reported: per-subject CIELAB dE76, the fitted parameter ranges, and Y / C* of the fits against the data.
  2. The deep end NIST does not reach (its darkest L* is ~43): published adult colorimetry. ITA classes (Chardon et al. 1991;
     Del Bino et al. 2006, 2013: very light > 55 > light > 41 > intermediate > 28 > tan > 10 > brown > -30 > dark) and the
     measured adult range down to ITA ~ -65..-67 (forehead and finger, Leeb et al. 2024, PLOS Digit Health / PMC10943300);
     palm against ventral arm on highly pigmented skin L* 60 vs 39 (CR-400, cited in Vasudevan et al. 2024, PMC11239860);
     photoexposed vs photoprotected melanin up to 2x (Alaluf et al. 2002). L* for an ITA is taken at an ASSUMED b* (deep skin
     b* ~ 9-14); these are anchors for the extrapolation, not spectra. The model's melanin axis is extended until it passes
     ITA -67 and the colours along it are written out with their L*, a*, b*, ITA.
  3. Presets: the CREW8 skins as biophysical parameters (Cm, beta, Ch, gamma, Cc) chosen to keep each person's intended
     lightness and hue at measured chroma (the c7 hexes were ~1.6x NIST's chroma), plus a ladder of ten people across the ITA
     classes for boards.

Colour: CIE 1931 2-degree (Wyman, Sloan, Shirley 2013 fit, as light/color.js), illuminant: 6504 K Planck (as the critic's
skin_albedo.py; a reflectance ratio, white-balanced so a flat reflector is neutral), linear Rec.709. Output JSON carries the
spectral tables at 10 nm and the 3x31 spectrum-to-linear-RGB weights so web/lib/fx/likeness/skin_lut.js evaluates the same
model in JS at load (no hidden constants in the shader).
"""
import json, math, os, sys, urllib.request
import numpy as np
from scipy.optimize import least_squares

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))            # videos/
OUT = os.path.join(ROOT, 'web', 'assets', 'likeness', 'skin_model.json')
CACHE = os.path.expanduser('~/.cache/acp_human')
SRC = {
    'nist': (os.path.join(CACHE, 'refs', 'nist_skin.txt'), 'https://opendata.nist.gov/1832_Data_JResNIST_skinrefl%20v3.txt'),
    'hb': (os.path.join(CACHE, 'likeness', 'hb.html'), 'https://omlc.org/spectra/hemoglobin/summary.html'),
    'car': (os.path.join(CACHE, 'likeness', 'carotene_abs.txt'), 'https://omlc.org/spectra/PhotochemCAD/data/041-abs.txt'),
}
for k, (p, u) in SRC.items():
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True); print('fetch', u); open(p, 'wb').write(urllib.request.urlopen(u, timeout=120).read())

WL = np.arange(400, 701, 10, dtype=float); NW = len(WL)

# ---------------------------------------------------------------- data
def nist():
    L = open(SRC['nist'][0], encoding='latin-1').read().splitlines()
    rows = [l.split(',') for l in L[8:] if l and l[0].isdigit()]
    wl = np.array([float(r[0]) for r in rows]); M = np.array([[float(x) if x else np.nan for x in r[1:]] for r in rows])
    avg = M[:, 3::4]
    ok = ~np.isnan(avg[(wl >= 400) & (wl <= 700)]).any(0)
    R = np.stack([np.interp(WL, wl, avg[:, j]) for j in range(avg.shape[1]) if ok[j]], 1)
    return R                                                                        # (31, n)
def hb():
    t = open(SRC['hb'][0]).read(); t = t[t.index('nm\tcm-1/M'):]; rows = []
    for l in t.splitlines()[1:]:
        p = l.split()
        if len(p) < 3 or not p[0].isdigit(): break
        rows.append([float(x) for x in p[:3]])
    a = np.array(rows); return np.interp(WL, a[:, 0], a[:, 1]), np.interp(WL, a[:, 0], a[:, 2])   # eps HbO2, Hb (cm-1/M)
def car():
    a = np.array([[float(x) for x in l.split()[:2]] for l in open(SRC['car'][0]) if l.strip() and not l.startswith('#')])
    return np.interp(WL, a[:, 0], a[:, 1])

# ---------------------------------------------------------------- optics (cm^-1)
EPS_O2, EPS_HB = hb()
MU_OXY = 2.303 * EPS_O2 * 150 / 64500          # whole blood, 150 g Hb / L
MU_DEOXY = 2.303 * EPS_HB * 150 / 64500
EPS_CAR = car()
MU_CAR = 2.303 * EPS_CAR * 1e-5                # per 10 umol/L (a scale; Cc is fitted in these units)
MU_EU = 6.6e11 * WL ** -3.33                   # melanosome interior, eumelanin (Jacques 1998)
MU_PHEO = 2.9e15 * WL ** -4.75                 # pheomelanin (Donner and Jensen 2006, same units convention)
MU_BASE = 0.244 + 85.3 * np.exp(-(WL - 154) / 66.2)   # bloodless tissue (Jacques 1998)
ETA = 1.4
FDR = -1.440 / ETA ** 2 + 0.710 / ETA + 0.668 + 0.0636 * ETA   # Egan and Hilgeman: internal diffuse reflectance

def body(p, g):
    """body reflectance spectrum (no surface term). p: Cm, beta, Ch, gamma, Cc. g: a, fRay, bMie, d (mm), ksc, psc, phi."""
    Cm, be, Ch, ga, Cc = p; a, fr, b, d, ksc, psc, phi = g
    mu_m = Cm * (be * MU_EU + (1 - be) * MU_PHEO)
    mu_e = mu_m + (1 - Cm) * MU_BASE + Cc * MU_CAR
    t2 = np.exp(-2 * 2 * mu_e * d * 0.1)                     # two crossings, mean path 2d each; d in mm -> cm
    mu_d = Ch * (ga * MU_OXY + (1 - ga) * MU_DEOXY) + (1 - Ch) * MU_BASE + 0.15 * Cc * MU_CAR
    mus = a * (fr * (WL / 500) ** -4 + (1 - fr) * (WL / 500) ** -b)          # Rayleigh + Mie (Jacques 2013's two-term form)
    al = mus / (mus + mu_d); s = np.sqrt(3 * (1 - al))
    Rd = al / 2 * (1 + np.exp(-4 / 3 * s)) * np.exp(-s)
    # light the stratum corneum and upper epidermis send back before it reaches the basal layer; a fraction phi of the melanin sits
    # above that (melanin 'dust' carried up to the corneum, Del Bino et al. 2018), so on deep skin the return is filtered too
    rsc = np.clip(ksc * (WL / 500) ** -psc, 0, 0.3) * np.exp(-4 * phi * mu_m * d * 0.1)
    return rsc + (1 - rsc) ** 2 * t2 * Rd * (1 - FDR) / (1 - FDR * t2 * Rd)   # reaches the basal melanin (why deep skin is never black)

# ---------------------------------------------------------------- colour
def gss(x, mu, s1, s2): return np.where(x < mu, np.exp(-0.5 * ((x - mu) / s1) ** 2), np.exp(-0.5 * ((x - mu) / s2) ** 2))
XB = 1.056 * gss(WL, 599.8, 37.9, 31.0) + 0.362 * gss(WL, 442.0, 16.0, 26.7) - 0.065 * gss(WL, 501.1, 20.4, 26.2)
YB = 0.821 * gss(WL, 568.8, 46.9, 40.5) + 0.286 * gss(WL, 530.9, 16.3, 31.1)
ZB = 1.217 * gss(WL, 437.0, 11.8, 36.0) + 0.681 * gss(WL, 459.0, 26.0, 13.8)
lam = WL * 1e-9; SPD = 1 / (lam ** 5 * (np.exp(6.626e-34 * 2.998e8 / (lam * 1.381e-23 * 6504)) - 1)); SPD /= SPD.max()
CMF = np.stack([SPD * XB, SPD * YB, SPD * ZB])                  # (3, 31)
WXYZ = CMF.sum(1); CMF_N = CMF / WXYZ[1]                         # a perfect white -> Y = 1
M709 = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
WRGB = M709 @ (WXYZ / WXYZ[1])
SPEC2RGB = (M709 @ CMF_N) / WRGB[:, None]                        # (3, 31): spectrum -> white-balanced linear Rec.709
def rgb(R): return SPEC2RGB @ R
def xyz_from_rgb(c): return np.linalg.solve(M709, c * WRGB)
def lab(c):
    xyz = xyz_from_rgb(c) / (WXYZ / WXYZ[1])
    f = lambda t: np.where(t > 216 / 24389, np.cbrt(np.maximum(t, 1e-9)), (24389 / 27 * t + 16) / 116)
    fx, fy, fz = f(xyz[0]), f(xyz[1]), f(xyz[2]); return np.array([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)])
def ita(L): return math.degrees(math.atan2(L[0] - 50, L[2]))
LUM = np.array([0.2126, 0.7152, 0.0722])

# ---------------------------------------------------------------- fit NIST
R = nist(); n = R.shape[1]; print(f'NIST subjects with full 400-700 nm spectra: {n}')
LO = np.array([0.0005, 0.3, 0.0005, 0.3, 0.0]); HI = np.array([0.6, 1.0, 0.2, 1.0, 6.0])
def fit_one(Rm, g, Rs, p0=None):
    p0 = np.array([0.03, 0.8, 0.02, 0.75, 0.5]) if p0 is None else p0
    w = 1 + 0.5 * (WL < 480)                                     # a little more weight in the blue, where melanin type shows
    r = least_squares(lambda p: (body(p, g) + Rs - Rm) * w, p0, bounds=(LO, HI), x_scale=[0.02, 0.2, 0.01, 0.2, 0.5])
    return r.x, r.fun
# deep-end anchors join the global fit as colorimetric targets (L*, b*), each with its own melanin and the NIST medians otherwise:
# NIST alone cannot say how much of the blue light comes back above the melanin, which decides whether deep skin stays warm
ANCHORS = [  # (ITA deg, assumed b*) -> L* = 50 + b* tan(ITA)
    ('ITA -30 (brown/dark bound)', -30, 14), ('ITA -45', -45, 12), ('ITA -60', -60, 10), ('ITA -67 (darkest adult forehead/finger, Leeb 2024)', -67, 9)]
ANC = [(50 + b * math.tan(math.radians(a)), b) for _, a, b in ANCHORS]
P_MED = np.array([0.026, 0.73, 0.014, 0.69, 0.03])
def anchor_res(g, Rs, w=0.5):
    out = []
    for L_t, b_t in ANC:
        def f(lc): R_ = body(np.array([math.exp(lc[0]), *P_MED[1:]]), g) + Rs; L_ = lab(rgb(R_)); return [L_[0] - L_t, L_[2] - b_t]
        r = least_squares(f, [math.log(0.2)], bounds=([math.log(0.01)], [math.log(0.9)])); out += list(np.array(r.fun) * w)
    return np.array(out)
def total(gv):
    *g, Rs = gv; out = []
    for j in range(n): x, f = fit_one(R[:, j], g, Rs); out.append(f)
    return np.concatenate(out + [anchor_res(g, Rs) * 0.02])
G0 = np.array([43.6, 0.41, 0.562, 0.08, 0.02, 1.0, 0.3, 0.03])               # Jacques 2013 skin: a' 43.6, fRay 0.41, bMie 0.562
GLO = [20, 0.0, 0.2, 0.05, 0.0, 0.0, 0.0, 0.026]; GHI = [160, 0.9, 2.0, 0.15, 0.12, 4.0, 1.0, 0.034]   # Rs: Fresnel at 8 deg for n 1.4 is 0.028; a rough corneum a little more
gfit = least_squares(total, G0, bounds=(GLO, GHI), x_scale=[10, 0.1, 0.2, 0.02, 0.01, 0.5, 0.2, 0.005], max_nfev=60, diff_step=0.02)
*G, RS_ = gfit.x; G = tuple(G); A_, FR_, B_, D_, KSC_, PSC_, PHI_ = G
print('anchor residuals (L*, b*):', np.round(anchor_res(G, RS_, 1.0), 2))
print(f'global fit: dermis mu_s\' = {A_:.1f} [{FR_:.2f} (l/500)^-4 + {1 - FR_:.2f} (l/500)^-{B_:.3f}] cm^-1, epidermis d = {D_ * 1000:.0f} um, '
      f'epidermal return {KSC_:.4f} (l/500)^-{PSC_:.2f} under {PHI_:.2f} of the melanin, surface Rs = {RS_:.4f}')
P = []; dE = []; meas = []; model = []
for j in range(n):
    x, _ = fit_one(R[:, j], G, RS_); P.append(x)
    cm, cd = rgb(R[:, j]), rgb(body(x, G) + RS_); meas.append(cm); model.append(cd); dE.append(float(np.linalg.norm(lab(cm) - lab(cd))))
P = np.array(P); dE = np.array(dE); meas = np.array(meas); model = np.array(model)
LABm = np.array([lab(c) for c in meas]); LABf = np.array([lab(c) for c in model])
Cm_ = np.hypot(LABm[:, 1], LABm[:, 2]); Cf_ = np.hypot(LABf[:, 1], LABf[:, 2]); Ym = meas @ LUM; Yf = model @ LUM
q = lambda v: [round(float(x), 4) for x in np.percentile(v, [0, 10, 50, 90, 100])]
print(f'per-subject fit dE76 p50 {np.median(dE):.2f} p90 {np.percentile(dE, 90):.2f} max {dE.max():.2f}')
print('measured Y p0/10/50/90/100', q(Ym), ' model', q(Yf)); print('measured C* p0/10/50/90/100', q(Cm_), ' model', q(Cf_))
names = ['Cm', 'beta', 'Ch', 'gamma', 'Cc']
for k, nm in enumerate(names): print(f'  {nm:6} p0/10/50/90/100 {q(P[:, k])}')

# ---------------------------------------------------------------- the deep end
med = np.median(P, 0)
def colour(p, surface=True): R_ = body(p, G) + (RS_ if surface else 0); c = rgb(R_); L_ = lab(c); return c, L_
ladder = []
for Cm in np.geomspace(0.005, 0.6, 40):
    p = np.array([Cm, med[1], med[2], med[3], med[4]]); c, L_ = colour(p)
    ladder.append({'Cm': round(float(Cm), 4), 'Y': round(float(c @ LUM), 4), 'L': round(float(L_[0]), 1), 'a': round(float(L_[1]), 1), 'b': round(float(L_[2]), 1), 'ITA': round(ita(L_), 1)})
print('melanin ladder at the NIST median (beta, Ch, gamma, Cc):')
for r in ladder[::4] + [ladder[-1]]: print('  ', r)
deepest = ladder[-1]
anchors = []
for nm, a, b in ANCHORS:
    L_ = 50 + b * math.tan(math.radians(a))
    best = min(ladder, key=lambda r: abs(r['ITA'] - a))
    anchors.append({'name': nm, 'ITA': a, 'b_assumed': b, 'L_from_ITA': round(L_, 1), 'model_nearest': best})
    print(f'  anchor {nm}: L* {L_:.1f} at b* {b}; model at that ITA: L* {best["L"]} b* {best["b"]} Y {best["Y"]} (Cm {best["Cm"]})')

# ---------------------------------------------------------------- presets: CREW8 + an ITA ladder of people
def lin(hx): v = np.array([int(hx[i:i + 2], 16) / 255 for i in (1, 3, 5)]); return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)
def fit_target(L_t, h_t, C_t, guess):
    """melanin and carotene whose colour (with surface) has lightness L_t and, as far as the model lets it, hue h_t; blood, its
    oxygenation and the melanin type stay at the guess (NIST medians, men a little more blood): chroma then comes out of the
    model instead of being asked for, so no preset can leave the measured gamut"""
    def f(q):
        p = np.array([math.exp(q[0]), guess[1], guess[2], guess[3], q[1]]); _, L_ = colour(p); h = math.degrees(math.atan2(L_[2], L_[1]))
        return [(L_[0] - L_t), (h - h_t) / 4.0, (q[1] - guess[4]) * 2]
    r = least_squares(f, [math.log(0.05), guess[4]], bounds=([math.log(0.002), 0.0], [math.log(0.6), 2.0]))
    return np.array([math.exp(r.x[0]), guess[1], guess[2], guess[3], r.x[1]])
def chroma_target(L_):          # the chroma NIST skin has at that lightness (a linear fit of the NIST fits, kept inside its p10..p90)
    k = np.polyfit(LABf[:, 0], Cf_, 1); return float(np.clip(np.polyval(k, L_), 14.5, 23.5)) if L_ > 43 else 15.5 - 0.12 * (43 - L_)
CREW = [('Ada', '#6e4430', 'f'), ('Walt', '#c89a7a', 'm'), ('Rosa', '#b07a58', 'f'), ('Otis', '#4e3020', 'm'), ('Kai', '#c8956e', 'm'), ('June', '#d8a888', 'f'), ('Ray', '#8a5a3c', 'm'), ('Mei', '#d0a07a', 'f')]
presets = {}
for nm, hx, sx in CREW:
    L_h = lab(lin(hx)); h_h = math.degrees(math.atan2(L_h[2], L_h[1]))
    # the c7 hex was authored by eye on a display, ~1.6x too saturated and before any exposure fix; keep its lightness ordering but pull
    # lightness into the measured range (the hex Ys 0.07-0.47 are albedos the person CAN have) and its hue toward NIST's hue band
    L_t = float(np.clip(L_h[0], 29.5, 74)); h_t = float(np.clip(h_h, 50, 72)); C_t = chroma_target(L_t)
    g0 = np.array([0.04, med[1], med[2] * (1.12 if sx == 'm' else 0.95), med[3], max(med[4], 0.2)])   # men's facial skin redder (more blood) on average
    x = fit_target(L_t, h_t, C_t, g0); c, L_ = colour(x); cb = rgb(body(x, G))
    presets[nm] = {'sex': sx, 'hex_c7': hx, 'Cm': round(float(x[0]), 5), 'beta': round(float(x[1]), 3), 'Ch': round(float(x[2]), 5), 'gamma': round(float(x[3]), 3), 'Cc': round(float(x[4]), 3),
                   'lab': [round(float(v), 1) for v in L_], 'ITA': round(ita(L_), 1), 'rgb_body': [round(float(v), 4) for v in cb], 'Y_body': round(float(cb @ LUM), 4),
                   'hex_lab': [round(float(v), 1) for v in L_h], 'C_hex': round(float(math.hypot(L_h[1], L_h[2])), 1)}
    print(f'  {nm:5} {hx} hex L*{L_h[0]:5.1f} C*{presets[nm]["C_hex"]:5.1f} -> model L*{L_[0]:5.1f} a*{L_[1]:5.1f} b*{L_[2]:5.1f} C*{math.hypot(L_[1], L_[2]):5.1f} ITA {ita(L_):6.1f} Y_body {cb @ LUM:.3f}  Cm {x[0]:.4f} beta {x[1]:.2f} Ch {x[2]:.4f} g {x[3]:.2f} Cc {x[4]:.2f}')
# a ladder of ten people (ITA classes, two per class where wide), for boards and the population sampler (lane A can draw from it)
people = []
for k, (nm, a) in enumerate([('very light', 60), ('light', 48), ('intermediate', 34), ('tan', 20), ('tan-brown', 10), ('brown', -5), ('brown', -20), ('dark', -35), ('dark', -50), ('darkest', -62)]):
    best = min(ladder, key=lambda r: abs(r['ITA'] - a)); x = np.array([best['Cm'], med[1], med[2], med[3], med[4]])
    c, L_ = colour(x); cb = rgb(body(x, G))
    people.append({'class': nm, 'ITA_target': a, 'Cm': best['Cm'], 'beta': round(float(med[1]), 3), 'Ch': round(float(med[2]), 5), 'gamma': round(float(med[3]), 3), 'Cc': round(float(med[4]), 3),
                   'lab': [round(float(v), 1) for v in L_], 'ITA': round(ita(L_), 1), 'Y_body': round(float(cb @ LUM), 4)})

out = {
    'about': 'HUMAN c8 likeness: biophysical skin albedo model, calibrated by videos/scripts/skin_calib.py (see its header). Evaluated in JS by web/lib/fx/likeness/skin_lut.js.',
    'provenance': {
        'model': 'ours: two-layer (absorbing epidermis over a diffusing dermis), after Donner and Jensen 2006 and Jimenez et al. 2010; Aliaga et al. 2023 as a reference for the parameter space',
        'data': [
            {'what': 'NIST skin reflectance, 100 subjects, 250-2500 nm', 'cite': 'Cooksey CC, Allen DW, Tsai BK. J Res NIST 122:026 (2017); doi 10.18434/M38597', 'url': SRC['nist'][1], 'licence': 'US Government work, public'},
            {'what': 'oxy- and deoxyhemoglobin molar extinction', 'cite': 'S. Prahl (OMLC), compiled from W. B. Gratzer and N. Kollias', 'url': SRC['hb'][1], 'licence': 'freely available tabulated data (OMLC); cite Prahl'},
            {'what': 'beta-carotene molar extinction (hexane)', 'cite': 'PhotochemCAD 2 (Du et al. 1998; Dixon et al. 2005), via Prahl / OMLC; scaled to Zechmeister and Polgar 1943', 'url': SRC['car'][1], 'licence': 'freely available tabulated data (OMLC)'},
            {'what': 'melanin and bloodless-tissue absorption, dermal scattering', 'cite': 'Jacques SL 1998 (OMLC skin optics summary); Jacques SL 2013 Phys Med Biol 58:R37 (skin mu_s\' fit); Donner and Jensen 2006 (pheomelanin)', 'licence': 'published formulas'},
            {'what': 'deep-skin anchors', 'cite': 'ITA classes: Chardon et al. 1991 Int J Cosmet Sci 13:191; Del Bino et al. 2006 Pigment Cell Res 19:606; Del Bino and Bernerd 2013 Br J Dermatol 169 S3:33. Adult ITA to -65.7 (forehead) / -67 (finger): Leeb et al. 2024 (PMC10943300). Palm vs ventral arm L* 60 vs 39 on highly pigmented skin: Vasudevan et al. 2024 review (PMC11239860). Photoexposed melanin up to 2x photoprotected: Alaluf et al. 2002 Pigment Cell Res 15:112', 'licence': 'numbers from the papers'},
        ],
        'colour': 'CIE 1931 2 deg (Wyman, Sloan, Shirley 2013 fit), 6504 K Planck illuminant, white-balanced linear Rec.709',
    },
    'wl': WL.tolist(), 'eta': ETA, 'Fdr': FDR,
    'mu': {'eu': MU_EU.round(4).tolist(), 'pheo': MU_PHEO.round(4).tolist(), 'base': MU_BASE.round(5).tolist(), 'oxy': MU_OXY.round(4).tolist(), 'deoxy': MU_DEOXY.round(4).tolist(), 'car': MU_CAR.round(5).tolist()},
    'global': {'mus_a': round(float(A_), 4), 'mus_fRay': round(float(FR_), 4), 'mus_bMie': round(float(B_), 4), 'd_mm': round(float(D_), 5), 'ksc': round(float(KSC_), 5), 'psc': round(float(PSC_), 4), 'phi': round(float(PHI_), 4), 'Rs': round(float(RS_), 5), 'carDermis': 0.15},
    'spec2rgb': SPEC2RGB.round(6).tolist(),
    'nist_fit': {'n': int(n), 'dE76': {'p50': round(float(np.median(dE)), 2), 'p90': round(float(np.percentile(dE, 90)), 2), 'max': round(float(dE.max()), 2)},
                 'Y_meas': q(Ym), 'Y_model': q(Yf), 'C_meas': q(Cm_), 'C_model': q(Cf_), 'L_meas': q(LABm[:, 0]),
                 'params': {nm: q(P[:, k]) for k, nm in enumerate(names)}, 'median': {nm: round(float(med[k]), 5) for k, nm in enumerate(names)},
                 'subjects': [{'lab_meas': [round(float(v), 2) for v in LABm[j]], 'Y_meas': round(float(Ym[j]), 4), 'p': [round(float(v), 5) for v in P[j]], 'dE': round(float(dE[j]), 2)} for j in range(n)]},
    'deep': {'ladder': ladder, 'anchors': anchors, 'palm_vs_arm_deep_L': [60, 39], 'tan_melanin_max': 2.0},
    'presets': presets, 'people': people,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True); json.dump(out, open(OUT, 'w'), separators=(',', ':')); print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT), 'bytes')
