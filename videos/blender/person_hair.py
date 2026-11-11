# CYCLES: lane D's hair cards (web/lib/fx/hair/) grown into strands for Cycles. Each card is a clump: its centreline (the midpoints of
# the ribbon's vertex pairs, posed), its half-width and side vector, its normal (lane D's bent volume normal). Strands are spread across
# the card's width and a little through its depth, trimmed at random lengths, with a per-strand frizz that grows toward the tip, and for
# coily hair a per-strand helix (the coil of an afro-textured fibre is millimetres across, much finer than a card). Shading is Cycles'
# Principled Hair BSDF (Chiang et al. 2016, the model lane D's cards approximate) with the person's pigment: lane D's eumelanin and
# pheomelanin are Chiang's units, which Cycles takes as melanin = 1 - exp(-(eu + ph)), redness = ph / (eu + ph).
import json
import math
import zlib
import numpy as np
import bpy

# per part: strand spacing across a card (m), root / tip radius (m), strands per card bounds, frizz (fraction of the half-width)
PART = {
    'scalp': dict(spacing=0.00042, r0=0.000036, r1=0.000014, smin=2, smax=48, frizz=0.35, depth=0.45, trim=0.22, rough=0.32),
    'beard': dict(spacing=0.0005, r0=0.00005, r1=0.00002, smin=2, smax=24, frizz=0.4, depth=0.4, trim=0.3, rough=0.35),
    'brows': dict(spacing=0.00035, r0=0.000032, r1=0.00001, smin=2, smax=6, frizz=0.15, depth=0.2, trim=0.25, rough=0.35),
    'lashes': dict(spacing=0.0004, r0=0.000045, r1=0.000012, smin=2, smax=5, frizz=0.08, depth=0.2, trim=0.2, rough=0.25),
    'lashesLow': dict(spacing=0.0004, r0=0.000032, r1=0.00001, smin=1, smax=3, frizz=0.08, depth=0.2, trim=0.2, rough=0.25),
}
# FACE7 c6 it 14 (15 Oct; the behaviour: the brows are FACE7's): THE BROW HAIR AS A BROW HAIR. The Cycles brows vanished (L08 a few pale
# hairlines where a dark brow should be; L03 a grey brow under near-black hair), and a 1.6x count (it 13) did not fix it: the cause was the
# render of each hair. Every brow card drew round(width / 0.35 mm) strands (3 on L08's 1.0-1.2 mm fol cards) of radius 0.032 -> 0.010 mm
# tapering over the WHOLE length (a mean diameter ~0.042 mm, a cut scalp hair's tip all the way), in person_hair.py's own flat Chiang
# material, while the scalp beside it is re-dressed by the fibre model (hairmat7: the ancestry's shaft, per-point pigment and roughness).
# A brow hair is a terminal hair of ~0.06-0.10 mm (finer in the tail), never cut, so constant along its shaft with a natural point over its
# last third; its pigment is the person's own hair melanin. So, for part 'brows':
#   calibre  the card's own: the engine draws a brow card's strands at STRAND (0.055) of the card's root width (hair/face.js growBrowsFol,
#            measured on the atlas tile), so the hair's diameter = 2 h0 x STRAND (fol cards: exactly face7's brows.fol.cal x the tail's wk;
#            the card brows: their tile's strand width); constant along the shaft (+-10 % hair to hair), tapering over the last `tip`
#            of its length to `k` of the root (fibre.js SHAFT.natural k 0.25: a natural point);
#   count    `n` hairs a card: the hairs the engine's card draws (the half brow tile's ~4 strands, measured: growBrowsFol's clump), not a
#            spacing across the card's width;
#   optics   the scalp's FIBRE BSDF (hairmat7.material reading per-point melanin / redness / roughness from hairmat7.attributes with the
#            person's scalp fibre: their own pigment, the fibre's cuticle and roughness), when hairmat7's mode is on; else as before.
# Nothing here is fitted to a render: the calibre is the card's, the pigment the person's, the BSDF the scalp's.
BROW7 = dict(strand=0.055, n=4, sd=0.10, tip=0.35, k=0.25)
# FACE7 c7 it 18 (15 Oct; FACE7's lashes, as the brows above): THE LASH AS A LASH. The Cycles lashes did not read as a lash line (L08 it 15:
# pale stripes on the lid, no dark line; the critics' first fault of the eye after the skin): every lash card drew round(width / 0.4 mm) strands
# (3 on the upper cards) spread at random across it, each tapering from 0.09 to 0.024 mm over its WHOLE length (a cut hair's taper: a mean
# ~0.057 mm), in this file's flat Chiang material. A lash is a terminal hair ~0.10 mm at the root (upper; ~0.075 lower), never cut: constant
# along the shaft with a natural point over its distal third, the upper row's lashes in clumps that gather toward the tips, the lower row
# single (Thibaut et al. 2010 and the oculoplastic texts, as recalled). So, for 'lashes' / 'lashesLow' when the engine's material says how
# its card is built (shade.lash7, written by hair/brow7.js lashMaterial7 from hair/face.js LASH_CARD7: the SAME numbers the engine's card
# draws its lashes with):
#   count    n lashes a card (4 upper: the clump; 1 lower), at fixed places across the card (so they gather as the card narrows: the clump);
#   calibre  2 h0 x strand (the card's root width x the share one lash is: exactly growLashesFol's cal), constant along the shaft
#            (+-10 % lash to lash), a natural point over the last `tip` of its length to `k` of the root; each ends at 0.85-1.0 of the card;
#   optics   the person's FIBRE BSDF (hairmat7: the scalp fibre's cuticle and roughness, per-lash lognormal pigment) with the LASH's own
#            pigment (the export's lash melanin), when hairmat7's mode is on; else this file's material as before.
# Without shade.lash7 (the engine's control arm: strands false) the cards draw as before.
COIL = {'coily': dict(A=0.0011, lam=0.0042, ramp=0.002), 'curly': dict(A=0.0018, lam=0.011, ramp=0.004), 'wavy': dict(A=0.0006, lam=0.03, ramp=0.01), 'straight': None}
# HAIR7 c3 iteration 1 (8 Oct; every scalp's since c7 it 1, 15 Oct: no switch):
# LOCKS. What the Cycles portraits showed beside the photographs (L08 curly, L12 straight, at 1:1): the long hair read as a uniform felt or
# a smooth translucent sheet: every strand of a card was spread evenly across it and (curly, wavy, coily) curled on its OWN random phase, so
# the curls cancelled into fuzz and nothing grouped. Real hair is organised in LOCKS (wisps): neighbouring fibres stick together along the
# length (capillary bridges of sebum and water, static, and for curly hair the helices nesting into each other), so a lock moves, curls and
# catches light as one: the highlight runs along each lock and the gaps between locks are dark (the wisp models: Plante et al. 2001,
# Bertails et al. 2006 for curly locks, the survey of Ward et al. 2007; cohesion in Daviet 2020). At the root the fibres leave their
# follicles evenly spaced (no clumping there); cohesion gathers them over the first centimetres. So, per card (the engine's card is a
# clump): k locks across it (k = card width / the form's lock width), each fibre joins the lock nearest its root and converges on that
# lock's axis along its length (cohesion `coh`, ramped in over s0..s1 of arc), the lock's fibres share ONE curl (phase, pitch, radius, a
# little jitter each), its members keep a fraction of the old frizz; `fly` of the fibres stay free (the flyaways). Lock widths by form are
# the typical wisp diameters (straight / wavy ~8 mm, curly ringlets ~6 mm, coily ~4 mm coil groups); nothing is fitted to a render.
# (c8 it 1) a straight fibre cannot nest: its lock's bond is its film alone (DRY below); coh is the curled forms' nesting
LOCK = {'straight': dict(w=0.008, coh=0.0, fly=0.03, frz=0.3), 'wavy': dict(w=0.008, coh=0.7, fly=0.04, frz=0.3),
        'curly': dict(w=0.006, coh=0.8, fly=0.05, frz=0.25), 'coily': dict(w=0.004, coh=0.55, fly=0.08, frz=0.4)}
LOCK_S = (0.01, 0.07)   # m of arc: cohesion ramps in from 1 cm (the fibres leave their follicles evenly) to full by 7 cm
# HAIR7 c7 iteration 1 (15 Oct; locks became every groom's): A FLYAWAY IS A STRETCH, NOT A WHOLE FIBRE. Until now a free fibre (`fly`)
# kept no cohesion along its whole length and the card's full frizz, while its neighbours drew in onto their lock axes: so it stayed
# where the card's uncohered spread put it, up to a card half-width OUTSIDE the visible mass, and with its curl resolved (eight points
# a turn) it hung there as a clean spring, 1-3 cm out in the air beside L08's hair over 10-20 cm (1008-204947, both arms). A real fibre
# leaves its lock where the bonds that hold it fail (a capillary bridge dried, a static charge, a curl that did not nest) and is caught
# again further down by the same contacts: the stray is a LOOP or a loose END, short for curled hair (helices interlock: a turn or a few,
# FLY['turns'] x the lock's pitch) and longer for straight hair, which slips (FLY['straight'] m, and more often at the tip, FLY['tip']).
# So a free fibre is its lock's member except over one window of its arc, where its cohesion goes and the card's frizz comes back
# (smooth in and out over a quarter of the window each). Constants are hair mechanics in kind, set once for every head.
FLY = dict(turns=(1.0, 3.0), straight=(0.03, 0.09), tip=0.5)
# HAIR7 c7 iteration 3 (15 Oct; the behaviour, no switch): THE CURL BELONGS TO THE FOLLICLE; A LOCK IS A BUNDLE OF DIFFERENT CURLS.
# What the critic read (it16.md, beside 616bb9, 409621: the 8 Oct locks + follicles renders, L08): sheaves of near-identical nested
# corkscrews beside the mass, the curly mass a regular knit, straight hair in smooth plastic sheets. The cause is in the model: every fibre of
# a lock (and every fibre of a ringlet card) took ONE curl, the lock's (radius +-8 %, pitch +-3 %, phase +-0.25 rad), over its whole length,
# every curl on the head turned the same way, and the other hairs of a follicular unit were COPIES of the first, offset 0.15-0.45 mm
# (fu_companions): a lock of thirty fibres drew thirty translated copies of one spring. A real fibre's curl is programmed in its own bulb
# (the bulb's asymmetry and the follicle's curvature set the shaft's: Thibaut et al. 2005, Br J Dermatol 152:632; Westgate et al. 2013,
# Exp Dermatol), so it belongs to the FOLLICLE: it varies from follicle to follicle a little and over the scalp regionally (a head's curl
# is not uniform: looser at the nape and the temples in many heads; the curve diameter of fibres from one head spreads over about one of
# the eight types of Loussouarn et al. 2007, Int J Dermatol 46 s1:2, as recalled); the hairs of one unit share an ostium but each has its
# own follicle (Headington 1984). A ringlet or a lock forms when neighbouring fibres of similar curl NEST by contact (capillary bridges,
# the helices interlocking), so it is a bundle of similar-but-different curls: its curl is its members' (their mean), each member keeps
# part of its own curl (the share the contacts do not hold: 1 - the lock's cohesion), sits at its own radius and phase in the ringlet's
# tube, and where the bundle thins (its members end at different lengths: fewer contacts) the members loosen into their own curls. So:
#   - the follicle carries a CURL STATE: tightness (x the form's radius and pitch together), a pitch factor (the helix angle), a phase and a
#     hand (the turn's sense), the tightness and the hand from smooth random fields over the scalp (correlation length `ell`, random
#     Fourier features: neighbouring follicles curl alike, a head varies by region) plus each follicle's own scatter (s_fol, s_hx);
#   - every HAIR of a unit is grown as its own fibre from its own follicle (the unit's pore), with its own curl, trim and place across the
#     card (fu_companions, the copies, are retired for the field's hairs; an afro's off-skin shells keep them: NEXT);
#   - a lock's curl is its members' (log-mean tightness and pitch, the majority's hand, a phase of its own); a member follows it with the
#     contact cohesion (the lock's cohesion along the arc x the square root of the share of its members still present there) at its own
#     radius in the tube (x U(rin)) and phase (+- ph_sd), and its OWN curl with the rest; near the root (no cohesion yet) every fibre
#     follows its own curl: the fibres leave the scalp each in its own curl and gather into ringlets lower down;
#   - straight hair is not geometrically straight: each fibre bends gently in its own plane (`straight`: a curve diameter of ~0.4 m, inside
#     the straightest type), so the fibres of a straight lock cross at small angles instead of lying as parallel copies.
# Constants are hair biology in kind, set once for every head; nothing is fitted to a render or a photograph.
CURL = dict(ell=0.025, nf=48, s_reg=0.15, s_fol=0.12, s_hx=0.08, hand_sd=0.6, rin=(0.8, 1.15), ph_sd=0.35, fu_u=0.06)
# HAIR7 c8 iteration 1 (16 Oct; the behaviour, no switch): THE DRY STRAIGHT LOCK: ITS FIBRES CROSS, ITS BOND IS THE HAIR'S OWN STATE.
# What the renders showed (1015-203527 L06 L12, 1015-212503 L12; the orchestrator's read beside the photographs, 16 Oct): long straight
# hair lit in flat light BANDS across the crown like card strips, and hanging as wet, stringy clumps with gaps; the blonde plastic. Both
# causes are in the model:
#   (1) every fibre of a straight lock was a parallel copy of its card's centreline: its place across the card fixed, the frizz grown only
#       toward the tip, and c7's bend (0.8 mm over 8 cm, x (1 - cohesion)) about one degree; so a card's ribbon of fibres shared ONE
#       tangent and lit as one surface (the specular R lobe, and TRT beside it, of thirty fibres in one place), its edges the card's;
#   (2) straight locks were pulled 65 % onto their axes (LOCK coh 0.65, the curled forms' order): what WET hair does (the water bridges
#       coalesce the fibres: Bico, Roman, Moulin & Boudaoud 2004, Nature 432:690), not dry hair.
# A real straight tress is neither. Its fibres lie at small angles to one another (each leaves its own follicle at its own angle and has
# its own slight curvature, and is held only where it touches its neighbours: the reason a tress's specular peak is broader and grainier
# than one fibre's: Stamm, Garcia & Fuchs 1977, J Soc Cosmet Chem 28:571; Reich & Robbins 1993, J Soc Cosmet Chem 44:221; HAIRMAT's
# 'lock' children take the same few degrees), and it is bonded only by what is on the fibres: a sebum film that spreads from the scalp
# along the shaft (strongest at the root, fading over ~10 cm: Robbins, Chemical and Physical Behavior of Human Hair, 5th ed. 2012, the
# hair's lipids), water and static. Curl adds a second bond, NESTING (neighbouring helices and waves interlock: LOCK coh of the curled
# forms, unchanged here); a straight fibre cannot nest. So, for straight hair:
#   - COHESION FROM THE HAIR'S STATE: a lock's bond is its film: film x exp(-s / reach) along the arc, under the elastocapillary ramp
#     LOCK_S as before (a bond bends a fibre over only where it is long enough), each lock's film its own (lognormal, film_sd, about the
#     head's: some locks carry more), the head's that of clean, dry hair a day or two after washing; x the share of the lock's members
#     still present (they end at different lengths), as before;
#   - THE FIBRE'S OWN COURSE: each fibre wanders about its place in its lock, across it and (less: the layer beneath holds it) through
#     it, as a smooth random function of its arc: `nw` waves of wavelengths log-uniform over `wave` (from the few centimetres between
#     contacts to a long drift), each carrying an equal share of the angle, so its tangent leaves its lock's by `deg` rms across and
#     `deg_d` through (two neighbours: ~1.4x that between them) and the long waves carry it a few millimetres across the lock and, at a
#     card's edge, in among the next card's fibres; zero at the root (it leaves its follicle where it is); a bond holds it (x (1 - the
#     cohesion)). It replaces c7's bend (CURL straight) and the curled forms keep theirs.
# The constants are hair physics in kind (the film's reach is the sebum's; the angle the tress's few degrees), set once for every head;
# nothing is fitted to a render or a photograph. The person's own sebum (age, sex) and a wet or freshly washed state are its levers.
DRY = dict(film=0.25, film_sd=0.5, reach=0.12, deg=4.0, deg_d=2.0, wave=(0.03, 0.30), nw=3)


def _grf(X, rng, ell, nf):
    """a smooth unit-variance random field at points X (n, 3) with correlation length ell (random Fourier features of a Gaussian kernel)"""
    W = rng.normal(0, 1.0 / ell, (nf, 3)); b = rng.uniform(0, 2 * math.pi, nf)
    return math.sqrt(2.0 / nf) * np.cos(np.asarray(X, float) @ W.T + b).sum(1)


def curl_states(X, rng):
    """(c7 it 3, CURL) per follicle at bind positions X (n, 3): its curl state (n, 4) = tightness, pitch factor, phase, hand (+-1); X None:
    n = rng-drawn states without the scalp's fields (a fibre with no follicle of the field), the same spread"""
    if isinstance(X, int):
        n = X; g1 = rng.normal(0, 1, n); g2 = rng.normal(0, 1, n)
    else:
        n = len(X); g1 = _grf(X, rng, CURL['ell'], CURL['nf']); g2 = _grf(X, rng, CURL['ell'], CURL['nf'])
    tk = np.exp(CURL['s_reg'] * g1 + CURL['s_fol'] * rng.normal(0, 1, n)); hx = np.exp(CURL['s_hx'] * rng.normal(0, 1, n))
    hd = np.where(g2 + CURL['hand_sd'] * rng.normal(0, 1, n) >= 0, 1.0, -1.0)
    return np.stack([tk, hx, rng.uniform(0, 2 * math.pi, n), hd], 1)


def _lock_curl(cs, members):
    """a lock's curl from its members' states: log-mean tightness and pitch factor, the majority's hand"""
    c = cs[members]
    tk = float(np.exp(np.mean(np.log(c[:, 0])))); hx = float(np.exp(np.mean(np.log(c[:, 1])))); h = float(np.sum(c[:, 3]))
    return tk, hx, (1.0 if h >= 0 else -1.0)


def _resample(p, m):
    """p (n,3) -> m points evenly along the arc"""
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    L = d[-1]
    if L <= 0:
        return np.repeat(p[:1], m, axis=0), d, 0.0
    s = np.linspace(0, L, m)
    return np.stack([np.interp(s, d, p[:, k]) for k in range(3)], axis=1), s, L


# HAIR4 (the scalp's cards; each card's tile slot rides in its random as
# (slot + r) / 16, grow.js CardBuilder4): a RINGLET card (slots 6 ringlet, 8 curlySparse) or a defined-COIL card (slot 7) carries its curl in
# the engine's texture and lies along a smooth guide, so here its strands are wound round the card's centreline as the baked tile shows
# them: a ribbon of strands on one helix (shared phase, a band along the axis), radius ~0.3 of the card's width, the pitch the engine's
# (4/3 of the root width for a ringlet, 4/5 for a coil). Other cards as before.
RING = {6: dict(rk=0.30, pk=4 / 3, n=1.0), 8: dict(rk=0.24, pk=4 / 3, n=0.6), 7: dict(rk=0.22, pk=4 / 5, n=0.8)}


def ringlet_strands(p, h, sd, nr, cfg, rng, density, slot, locks=False, fr=None, fol_u=None, fol_c=None, form='curly'):
    rc = RING[slot]; _, _, L = _resample(p, 2)
    if L <= 1e-5:
        return []
    w0 = 2 * float(h[0]); R0 = rc['rk'] * 2 * float(np.mean(h)); lam = rc['pk'] * w0
    m = int(np.clip(math.ceil(L / (lam / 10)) + 1, 6, 600 if locks else 160))   # (HAIR7 c3, locks: ten points a turn on long ringlets too)
    t = np.linspace(0, 1, len(p)); tm = np.linspace(0, 1, m)
    P = np.stack([np.interp(tm, t, p[:, k]) for k in range(3)], 1); H = np.interp(tm, t, h)
    SD = np.stack([np.interp(tm, t, sd[:, k]) for k in range(3)], 1)
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    SD = SD - T * np.sum(SD * T, 1, keepdims=True); SD /= np.linalg.norm(SD, axis=1, keepdims=True) + 1e-12; NR = np.cross(T, SD)
    s_arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    if fr is not None:   # (HAIR7 c3 iteration 2) the card's resampled frame: point k of every strand below lies on the card at s_arc[k]
        fr.update(P=P, SD=SD, H=H, s=s_arc, S=int(np.clip(round(rc['n'] * 2 * float(np.mean(h)) / cfg['spacing'] * density * 0.6), 6, 32)))
        if fr.get('frame_only'):
            return []
    S = int(np.clip(round(rc['n'] * 2 * float(np.mean(h)) / cfg['spacing'] * density * 0.6), 6, 32)); ph0 = rng.uniform(0, 6.283)
    if fol_u is not None:   # (HAIR7 c7 it 2, FIELD) one fibre a follicle of the field this card gathers
        S = len(fol_u)
    # (c7 it 3, CURL) the ringlet is its fibres' bundle: its turn's sense is its members' majority; each fibre sits at its own radius and phase
    # in the ringlet's tube, follows the ringlet by contact (the form's lock cohesion along the arc x the root of the share of its members
    # still present) and its OWN follicle's curl (the ringlet's turn scaled by its tightness and pitch factor, its own phase and hand) with
    # the rest: so near the scalp every fibre curls on its own, and a ringlet is a bundle of different curls, not one spring copied
    cs = np.asarray(fol_c, float) if fol_c is not None else curl_states(S, rng)
    mm = np.minimum(m, np.maximum(3, np.round(m * (1.0 - cfg['trim'] * rng.random(S) ** 1.5)).astype(int)))
    hdL = 1.0 if float(np.sum(cs[:, 3])) >= 0 else -1.0
    pres = np.mean(mm[:, None] > np.arange(m)[None, :], axis=0)
    LK = LOCK.get(form, LOCK['curly']); x = np.clip((s_arc - LOCK_S[0]) / (LOCK_S[1] - LOCK_S[0]), 0, 1)
    cc = (LK['coh'] * x * x * (3 - 2 * x) * np.sqrt(pres))[None, :]; own_w = 1 - cc
    sa = s_arc[None, :]; tk, hx, ph, hd = (cs[:, q][:, None] for q in range(4))
    Rr = R0 * rng.uniform(0.75, 1.12, S)[:, None] * (H / max(H[0], 1e-6))[None, :]; band = rng.uniform(-0.3, 0.3, S)[:, None] * lam
    phL = ph0 + rng.normal(0, CURL['ph_sd'], S)[:, None]
    thL = phL + hdL * (sa + band) / lam * 2 * math.pi; ramp = np.clip(sa / (0.6 * lam), 0, 1)
    Ro = R0 * tk; lo = lam * tk * hx; tho = ph + hd * sa / lo * 2 * math.pi
    X = ramp * (cc * Rr * np.cos(thL) + own_w * Ro * np.cos(tho)); Y = ramp * (cc * Rr * np.sin(thL) + own_w * Ro * np.sin(tho))
    Q = P[None] + SD[None] * X[..., None] + NR[None] * Y[..., None] + T[None] * (band * 0.15 * cc)[..., None]
    tt = np.clip(tm[None, :] / np.maximum(tm[mm - 1], 1e-9)[:, None], 0, 1); r = cfg['r0'] + (cfg['r1'] - cfg['r0']) * tt
    return [(Q[j, :mm[j]], r[j, :mm[j]]) for j in range(S)]


# (HAIR7 c6 iteration 1, 15 Oct) THE LAY of a rope's fibres. A braid's strand (and a loc's or a twist's lobe) is hundreds of fibres, and
# they do not run parallel to the strand: gathering a box's hair and crossing it over the middle twists each strand, so its fibres lie on
# helices about the strand's axis like a yarn's, at a helix angle growing from 0 on the axis to LAY['deg'] at its surface (a fibre at
# radius r: tan(angle) = r / rs x tan(LAY)). The render carries a strand as ~26 fibre CLUMPS (0.13 x the rope's radius; real fibres would
# be thousands a rope), and until now every clump of a strand ran PARALLEL to its neighbours: one strand's clumps turned to the light
# together, and each crest of the plait lit as one white bead (it11.md: 'a string of pearls'; 'plastic tubing'). Laid on their helices,
# neighbouring clumps meet the light at different angles along the strand, so the fibre optics (HAIRMAT's Chiang lobes, per fibre,
# untouched) spread one strand's highlight into a broken, broad sheen whose strength varies along the plait with the strand's own turn,
# as a real braid's does. The lay is the braider's technique (a style constant, the same for every head and every rope groom), not a
# fit: LAY['deg'] 12 degrees, a mildly twisted strand (yarns run 15-30). The twist builds in with the plait (ramp: the box's combed hair
# at the root is untwisted); its sense is one per head (a braider's hand), its rate +-20 % per strand. Phase (radians) along the arc s:
#   d(phase)/ds = tan(LAY) / rs(s) x ramp(s)
LAY = dict(deg=12.0, spread=0.2, sense=1.0)


def _lay(s, rs, ramp, rng):
    """the lay's rotation (radians) along the arc s (m) of a strand of radius rs (m, per point), built in by ramp (0..1 per point)"""
    rate = math.tan(math.radians(LAY['deg'])) / np.maximum(np.asarray(rs, float), 1e-5) * np.asarray(ramp, float)
    rate = rate * LAY['sense'] * (1.0 + LAY['spread'] * (2 * rng.random() - 1))
    ds = np.diff(np.asarray(s, float), prepend=float(s[0]))
    return np.cumsum(rate * ds)


# (integration v4) a braid / loc TUBE of a rev-4 groom (export.js: the manifest's per-card `tube` flag): a ROPE of three lobes twisted round
# the centreline (a plait or a two/three-strand twist reads that way at bust distance), each lobe a bundle of 24 fibre clumps
# (radius 0.13 x the rope's, tapering with it) that fill its section; single 36-micron strands would need thousands a rope
def rope_strands(p, h, sd, nr, cfg, rng, density):
    _, _, L = _resample(p, 2); m = max(6, int(L / 0.004)); P, Hh = _resample(p, m)[0], np.interp(np.linspace(0, 1, m), np.linspace(0, 1, len(h)), h)
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    S0 = np.cross(T, nr[:1].repeat(m, 0)); S0 /= np.linalg.norm(S0, axis=1, keepdims=True) + 1e-9; B0 = np.cross(T, S0)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]); pitch = max(0.012, 3.2 * float(np.mean(Hh)))
    out = []; n_per = max(8, int(24 * density))
    for lobe in range(3):
        ph = lobe * 2 * np.pi / 3 + 2 * np.pi * s / pitch
        cx, cy = 0.48 * Hh * np.cos(ph), 0.48 * Hh * np.sin(ph)
        tw = _lay(s, 0.5 * Hh, np.ones_like(s), rng)   # (HAIR7 c6 it 1) the lobe's fibres laid helically about the lobe (LAY)
        for _ in range(n_per):
            a, r = rng.random() * 2 * np.pi, 0.5 * Hh * np.sqrt(rng.random())
            ox, oy = cx + r * np.cos(a + tw), cy + r * np.sin(a + tw)
            q = P + S0 * ox[:, None] + B0 * oy[:, None]
            keep = 1.0 - 0.15 * rng.random(); mm = max(3, int(round(m * keep)))
            out.append((q[:mm], (0.13 * Hh[:mm]).astype(np.float32)))   # fibre CLUMPS (~0.5 mm), not single hairs: 72 a rope fill its section
    return out

# (HAIR7 c4 iteration 1, the behaviour since c5 it 9: the export marker's shade.box) a BOX BRAID is a THREE-STRAND PLAIT, not a twist: each strand
# crosses over (here under: the box-braid way, the braid stands proud) the middle in turn, so in the braid's own plane a strand swings from
# side to side (ax sin u) while it passes in front of and behind the others twice as often (az sin 2u; u = 2 pi s / P + 2 pi i / 3, the
# three strands a third of a period apart; az >= 1.155 rho keeps two crossing strands apart), a V on the surface per braid diameter (P =
# three V's = 6 radii). Each strand a bundle of fibre clumps (as rope_strands); the depth axis faces out from the head and body (the rope's
# card normal at its root), carried along by a parallel-transported frame; the swing grows in over the first 0.4 P (the box's hair joins
# the plait at the root). The engine draws the same plait as the tube's relief (v7.js plait7r).
PLAIT = dict(ax=0.55, az=0.6, rho=0.5, P=6.0, per=26, root=0.4, frizz=0.06)


def plait_strands(p, h, sd, nr, cfg, rng, density):
    _, _, L = _resample(p, 2)
    if L <= 1e-4:
        return []
    R0 = max(1e-4, float(np.mean(h))); Pp = PLAIT["P"] * R0; seg = min(0.002, Pp / 10); m = max(6, int(L / seg) + 1)
    Pc, s, _ = _resample(p, m); Hh = np.interp(np.linspace(0, 1, m), np.linspace(0, 1, len(h)), h)
    T, N1, N2 = (x[0] for x in _transport(Pc[None]))
    n0 = np.asarray(nr[0], float) - T[0] * float(np.dot(nr[0], T[0])); ln = np.linalg.norm(n0)
    if ln > 1e-6:   # turn the frame about the tangent so its depth axis faces out at the root (the turn is the same all along)
        n0 /= ln; ang = math.atan2(float(np.dot(n0, N1[0])), float(np.dot(n0, N2[0]))); ca, sa = math.cos(ang), math.sin(ang)
        N1, N2 = ca * N1 - sa * N2, sa * N1 + ca * N2
    ramp = np.clip(s / (PLAIT['root'] * Pp), 0, 1); ramp = ramp * ramp * (3 - 2 * ramp); ph = rng.uniform(0, 2 * math.pi)
    out = []; n_per = max(8, int(PLAIT['per'] * density)); tt = s / max(L, 1e-9)
    for i in range(3):
        u = 2 * math.pi * s / Pp + 2 * math.pi * i / 3 + ph
        cx = PLAIT['ax'] * np.sin(u) * Hh * ramp; cz = PLAIT['az'] * np.sin(2 * u) * Hh * ramp
        ctr = Pc + N1 * cx[:, None] + N2 * cz[:, None]
        tw = _lay(s, PLAIT['rho'] * Hh, ramp, rng)   # (HAIR7 c6 it 1) the strand's fibres laid helically about the strand (LAY)
        for _ in range(n_per):
            a, r = rng.random() * 2 * math.pi, PLAIT['rho'] * np.sqrt(rng.random())
            fz0, fz1 = PLAIT['frizz'] * rng.normal(0, 1, 2); gro = tt ** 1.5   # a fibre's stray from its strand, growing toward the end
            q = ctr + N1 * ((r * np.cos(a + tw) + fz0 * gro) * Hh)[:, None] + N2 * ((r * np.sin(a + tw) + fz1 * gro) * Hh)[:, None]
            keep = 1.0 - 0.1 * rng.random(); mm = max(3, int(round(m * keep)))
            out.append((q[:mm], (0.13 * Hh[:mm]).astype(np.float32)))
    return out


def strands_for_card(p, h, sd, nr, cfg, form, rng, density, part, slot=None, strip6=False, locks=False, fr=None, fol_u=None, fol_c=None):
    if slot in RING:
        return ringlet_strands(p, h, sd, nr, cfg, rng, density, slot, locks, fr, fol_u, fol_c, form)
    form0 = form
    if strip6:   # (HAIR6) a strip wound on the curl's helix by the engine's geometry: its strands follow it, no second curl, little frizz
        cfg = dict(cfg, frizz=cfg['frizz'] * 0.35, trim=cfg['trim'] * 0.6); form = 'straight'
    n = len(p)
    width = 2 * float(np.mean(h))
    S = int(np.clip(round(width / cfg['spacing'] * density), cfg['smin'], cfg['smax']))
    coil = COIL.get(form) if part in ('scalp', 'beard') else None
    coil0 = COIL.get(form0) if part == 'scalp' else None   # (c7 it 3) a strip's fibres keep their own follicle's curl about the strip
    _, _, L = _resample(p, 2)
    if L <= 1e-5:
        return []
    seg = 0.0009 if coil and coil['lam'] < 0.02 else 0.002
    # (HAIR7 c3, locks) the curl RESOLVED along the whole strand: 64 points at most aliased a long curl (a 40 cm curly strand: one point
    # every 6 mm against an 11 mm turn, so its helix became a random zigzag, the felt in the Cycles portraits); with locks, eight points a
    # turn (and 2 mm on straight hair) whatever the length; (c7 it 3) a helical strip's too, at its fibres' own curl
    if locks and part == 'scalp':
        seg = min(0.002, coil0['lam'] / 8) if coil0 else 0.002
    m = int(np.clip(math.ceil(L / seg) + 1, 4, 640 if (locks and part == 'scalp') else 64))
    out = []
    # the card's frame along its length, resampled to m points
    t = np.linspace(0, 1, n); tm = np.linspace(0, 1, m)
    P = np.stack([np.interp(tm, t, p[:, k]) for k in range(3)], 1)
    H = np.interp(tm, t, h)
    SD = np.stack([np.interp(tm, t, sd[:, k]) for k in range(3)], 1)
    NR = np.stack([np.interp(tm, t, nr[:, k]) for k in range(3)], 1)
    T = np.gradient(P, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    # orthonormal side / normal about the tangent
    SD = SD - T * np.sum(SD * T, 1, keepdims=True); SD /= np.linalg.norm(SD, axis=1, keepdims=True) + 1e-12
    NR = np.cross(T, SD);
    s_arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    if fr is not None:   # (HAIR7 c3 iteration 2) the card's resampled frame: point k of every strand below lies on the card at s_arc[k]
        fr.update(P=P, SD=SD, H=H, s=s_arc, S=S)
        if fr.get('frame_only'):
            return []
    if fol_u is not None:   # (HAIR7 c7 it 2, FIELD) one fibre a follicle of the field this card gathers, at its follicle's place across it
        S = len(fol_u)
    if locks and part == 'scalp':   # (c7 it 3) a helical strip too: its geometry is its lock's curl, its fibres add their own
        return lock_strands(P, H, SD, NR, s_arc, tm, m, S, width, cfg, form0, coil0, rng, fol_u, fol_c, lock_curl=not strip6)
    brow = part == 'brows'
    if brow:   # (FACE7 c6 it 14) the card's hairs at the card's calibre (BROW7 above)
        S = BROW7['n']; d0 = 2 * float(h[0]) * BROW7['strand']
    L7 = cfg.get('lash7') if part in ('lashes', 'lashesLow') else None
    if L7:     # (FACE7 c7 it 18) the card's lashes at the follicle's calibre (LASH7 above)
        S = max(1, int(L7['n'])); d0 = 2 * float(h[0]) * float(L7['strand'])
    for j in range(S):
        u = (rng.random() * 2 - 1) * 0.96
        if L7:   # fixed places across the card (hair/brow7.js strandsGLSL, gather): they converge as the card narrows
            u = (((j + 0.5) / S - 0.5) * 1.6 + rng.uniform(-0.12, 0.12)) if S > 1 else rng.uniform(-0.3, 0.3)
        dv = rng.normal(0, cfg['depth']) * 0.5
        keep = 1.0 - cfg['trim'] * rng.random() ** 1.5
        if L7:
            keep = 0.85 + 0.15 * rng.random()
        mm = max(3, int(round(m * keep)))
        tt = tm[:mm] / max(tm[mm - 1], 1e-9)
        # frizz: two smooth random offsets that grow toward the tip
        f1 = np.sin(tt * rng.uniform(2, 6) + rng.uniform(0, 6.28)) * rng.normal(0, 1); f2 = np.sin(tt * rng.uniform(2, 6) + rng.uniform(0, 6.28)) * rng.normal(0, 1)
        fr = cfg['frizz'] * (tt ** 1.5)
        q = P[:mm] + SD[:mm] * (u * H[:mm] + fr * f1 * H[:mm])[:, None] + NR[:mm] * ((dv + fr * f2) * H[:mm])[:, None]
        if coil:
            A = coil['A'] * rng.uniform(0.7, 1.25); lam = coil['lam'] * rng.uniform(0.8, 1.25); ph = rng.uniform(0, 6.28)
            ramp = np.clip(s_arc[:mm] / coil['ramp'], 0, 1)
            th = ph + s_arc[:mm] / lam * 2 * math.pi
            if form == 'wavy':
                q = q + SD[:mm] * (A * ramp * np.sin(th))[:, None]
            else:
                q = q + (SD[:mm] * np.cos(th)[:, None] + NR[:mm] * np.sin(th)[:, None]) * (A * ramp)[:, None]
        r = cfg['r0'] + (cfg['r1'] - cfg['r0']) * tt
        if brow:   # constant along the shaft, a natural point over the last `tip` of the hair (tt = 1 at its tip)
            r = 0.5 * d0 * float(np.clip(1 + rng.normal(0, BROW7['sd']), 0.75, 1.3)) * np.where(tt > 1 - BROW7['tip'], 1 - (1 - BROW7['k']) * (tt - (1 - BROW7['tip'])) / BROW7['tip'], 1.0)
        if L7:     # the lash: constant along the shaft, the natural point over its last `tip`
            tp, kk = float(L7.get('tip', 0.35)), float(L7.get('k', 0.25))
            r = 0.5 * d0 * float(np.clip(1 + rng.normal(0, float(L7.get('sd', 0.10))), 0.75, 1.3)) * np.where(tt > 1 - tp, 1 - (1 - kk) * (tt - (1 - tp)) / tp, 1.0)
        out.append((q, r))
    return out


def lock_strands(P, H, SD, NR, s_arc, tm, m, S, width, cfg, form, coil, rng, fol_u=None, fol_c=None, lock_curl=True):
    """(HAIR7 c3) the card's S fibres as k locks (LOCK above): convergence on the lock axis along the length, a few free; (c7 it 3, CURL)
    each fibre's curl its follicle's (fol_c, else drawn), the lock's curl its members', followed by contact; lock_curl False: the card's
    own geometry is the lock's curl (a helical strip), the members add only their own"""
    L = LOCK.get(form, LOCK['straight']); k = int(np.clip(round(width / L['w']), 1, 4))
    uc = -1 + (2 * np.arange(k) + 1) / k + rng.uniform(-0.15, 0.15, k) / k          # lock axes across the card (half-width units)
    dc = rng.normal(0, cfg['depth'], k) * 0.25                                        # and through its depth
    u0 = np.clip(np.asarray(fol_u, float), -0.96, 0.96) if fol_u is not None else rng.uniform(-0.96, 0.96, S)
    dv0 = rng.normal(0, cfg['depth'], S) * 0.5
    mm = np.maximum(3, np.round(m * (1.0 - cfg['trim'] * rng.random(S) ** 1.5)).astype(int)); mm = np.minimum(mm, m)
    li = np.argmin(np.abs(uc[None, :] - u0[:, None]), axis=1)
    cs = np.asarray(fol_c, float) if fol_c is not None else curl_states(S, rng)
    # contact: the share of each lock's members still present along the arc (they end at different lengths); cohesion x its square root
    ar = np.arange(m)
    pres = np.ones((k, m))
    for i in range(k):
        mi = mm[li == i]
        if len(mi):
            pres[i] = np.mean(mi[:, None] > ar[None, :], axis=0)
    x = np.clip((s_arc - LOCK_S[0]) / (LOCK_S[1] - LOCK_S[0]), 0, 1); rc = x * x * (3 - 2 * x)
    if coil:   # the curled forms: their nesting
        C = (L['coh'] * rc)[None, :] * np.sqrt(pres[li])                                 # (S, m)
    else:      # (c8 it 1, DRY) straight: the lock's own film, fading along the shaft from the scalp
        fl = DRY['film'] * np.exp(rng.normal(0, DRY['film_sd'], k))
        C = np.minimum(1.0, fl[li][:, None] * (rc * np.exp(-s_arc / DRY['reach']))[None, :]) * np.sqrt(pres[li])
    free = rng.random(S) < L['fly']
    lk = []
    for i in range(k):
        mem = np.nonzero(li == i)[0]
        tk, hx, hd = _lock_curl(cs, mem) if len(mem) else (1.0, 1.0, 1.0)
        lk.append(dict(ph=rng.uniform(0, 6.28), lam=(coil['lam'] * tk * hx) if coil else 0, A=(coil['A'] * tk) if coil else 0, hd=hd))
    WIN = np.zeros((S, m))
    for j in np.nonzero(free)[0]:   # (c7 it 1) the stretch where its lock lets it go (FLY above); elsewhere a member
        sa_ = s_arc[:mm[j]]; Ls = float(sa_[-1]); i = li[j]
        wl = rng.uniform(*FLY['turns']) * lk[i]['lam'] if coil else rng.uniform(*FLY['straight'])
        a0 = Ls - wl * rng.uniform(0.6, 1.0) if (not coil and rng.random() < FLY['tip']) else rng.uniform(LOCK_S[0], max(LOCK_S[0], Ls - wl))
        WIN[j, :mm[j]] = _sstep(a0, a0 + 0.25 * wl, sa_) * (1 - _sstep(a0 + 0.75 * wl, a0 + wl, sa_))
    cc = C * (1 - WIN)
    u = u0[:, None] + (uc[li] - u0)[:, None] * cc; dv = dv0[:, None] + (dc[li] - dv0)[:, None] * cc
    tt = np.clip(tm[None, :] / np.maximum(tm[mm - 1], 1e-9)[:, None], 0, 1)
    a1, b1, n1 = rng.uniform(2, 6, S), rng.uniform(0, 6.28, S), rng.normal(0, 1, S); a2, b2, n2 = rng.uniform(2, 6, S), rng.uniform(0, 6.28, S), rng.normal(0, 1, S)
    f1 = np.sin(tt * a1[:, None] + b1[:, None]) * n1[:, None]; f2 = np.sin(tt * a2[:, None] + b2[:, None]) * n2[:, None]
    fr = cfg['frizz'] * (tt ** 1.5) * (L['frz'] + (1 - L['frz']) * WIN)
    Q = P[None] + SD[None] * ((u + fr * f1) * H[None])[..., None] + NR[None] * ((dv + fr * f2) * H[None])[..., None]
    sa = s_arc[None, :]; tk, hx, ph, hd = (cs[:, q][:, None] for q in range(4))
    if coil:   # (c7 it 3) the lock's curl (its members': each at its own radius and phase in the tube) by contact, the fibre's own by the rest
        own = 1 - cc
        ramp = np.clip(sa / coil['ramp'], 0, 1)
        Ao = coil['A'] * tk; lo = coil['lam'] * tk * hx; tho = ph + hd * sa / lo * 2 * math.pi
        if lock_curl:
            AL = np.array([lk[i]['A'] for i in li])[:, None] * rng.uniform(*CURL['rin'], S)[:, None]
            lL = np.array([lk[i]['lam'] for i in li])[:, None]; hL = np.array([lk[i]['hd'] for i in li])[:, None]
            thL = np.array([lk[i]['ph'] for i in li])[:, None] + rng.normal(0, CURL['ph_sd'], S)[:, None] + hL * sa / lL * 2 * math.pi
        else:
            AL = np.zeros((S, 1)); thL = np.zeros((S, 1))
        if form == 'wavy':   # a wave in a plane: the lock's across the card, the fibre's own in its own plane
            ps = rng.uniform(0, math.pi, S)[:, None]
            Q = Q + SD[None] * (ramp * cc * AL * np.sin(thL))[..., None] \
                + (SD[None] * np.cos(ps)[..., None] + NR[None] * np.sin(ps)[..., None]) * (ramp * own * Ao * np.sin(tho))[..., None]
        else:
            Q = Q + SD[None] * (ramp * (cc * AL * np.cos(thL) + own * Ao * np.cos(tho)))[..., None] \
                + NR[None] * (ramp * (cc * AL * np.sin(thL) + own * Ao * np.sin(tho)))[..., None]
    else:      # (c8 it 1, DRY) straight hair: each fibre's own course about its place in the lock, across and through, held by its bond
        nw = DRY['nw']; lw = np.exp(rng.uniform(math.log(DRY['wave'][0]), math.log(DRY['wave'][1]), (2, S, nw)))
        pw = rng.uniform(0, 2 * math.pi, (2, S, nw)); bk = np.radians([DRY['deg'], DRY['deg_d']]) * math.sqrt(2.0 / nw)   # each wave's slope
        own = 1 - cc
        for ax, V in ((0, SD), (1, NR)):
            w = sum(bk[ax] * lw[ax, :, i, None] / (2 * math.pi) * (np.sin(2 * math.pi * sa / lw[ax, :, i, None] + pw[ax, :, i, None]) - np.sin(pw[ax, :, i, None]))
                    for i in range(nw))
            Q = Q + V[None] * (own * w)[..., None]
    R = cfg['r0'] + (cfg['r1'] - cfg['r0']) * tt
    return [(Q[j, :mm[j]], R[j, :mm[j]]) for j in range(S)]


# HAIR7 c3 iteration 2 (8 Oct; every groom's since c7 it 1, 15 Oct: the export's scalp shade.fol, v7.js fol7, always present):
# FOLLICLES. What the Cycles portraits showed beside the photographs (the critic's it5 rank 1, L08 L12 L22 L14): the hair-skin interface
# reads as a lace-front wig: L08's part a ruler-straight pale stripe with sparse dark strands either side over a painted brown 'lace' of
# scalp, the hairline a hard scalloped edge. Cause: every fibre of a card was rooted on the card's ROOT EDGE (one 2-8 mm segment), so the
# head's fibres left the skin from a few thousand short rows and lay flat in their card from the first millimetre; between the rows, near
# the part and the hairline where no card from further up lies over them, the painted root base showed. A scalp's follicles cover the whole
# area (of the order of 150-250 hairs / cm2, in units of 1-4); a lock or clump gathers the fibres of the follicles UNDER it (the scalp it
# lies on as it leaves the head); each fibre leaves the skin at its follicle's acute angle and only then joins its clump; at the frontal
# hairline terminal hairs give way, over about a centimetre, to finer, shorter, paler intermediate hairs; a part is where the hair diverges
# (follicles on its line, their hair to one side or the other, a few crossing), not a strip without roots. So, for every card that STARTS
# ON THE SKIN (its first point within hmax of the scalp; an afro's shells and the coils at a volume's surface are left as they were):
#   [c7 it 2: the per-card catchment below is RETIRED: the follicles are drawn as one field over the scalp and each card gathers those
#    lying under it (FIELD, field_plan); what follows the catchment (the follicle angle, the join, the hairline's hairs) stands]
#   - its catchment: the scalp under the card while it lies on the head (within hmax of the skin, at most `catch` of its arc), `wide` x its
#     width across; each fibre's follicle is drawn there (along the card with an exponential of scale `lam` from its root: the catchments
#     of the rows of cards behind each other then sum to an even field, and the first row, at the part's edge or the hairline, is not left
#     thin, as a uniform draw over the catchment would leave it; `up` of them up to `upL` BEHIND the card's root, on the line from it back
#     along the card's first direction: the follicles between a row and the part's line, which no card's catchment reached), on the skin
#     (the head's radius map), inside the hairline (the
#     field's own soft edge: accepted with the line's density), and on the card's side of the jagged part except within `cross` of it,
#     where `p_cross` of the draws are kept (the hairs that cross the part); `tries` draws, else the fibre keeps its old root;
#   - the fibre starts there, leaves the skin at the follicle angle (alpha, lower in the hairline band: alpha_line; +-alpha_sd) along its
#     card's direction, and joins its own place in the card (its lock, its curl) over `join` of arc (the offset fades with a smoothstep);
#   - in the hairline band (e < band inside the line) it is an INTERMEDIATE hair with probability p_int x (1 - e / band) eased: radius x
#     r_int, length len_int (shorter toward the line), pigment cut by pig_int (the per-fibre 'grey' attribute: the material mixes melanin
#     toward the unpigmented strand by it).
# The field (the hairline's knots, the part's plane and jag, the scalp's radius cube map) is the engine's own (v7.js fol7), in the head's
# bind frame; the export's eyes.headMatrix maps the posed cards back to it. Constants are anatomy, set once; nothing is fitted to a person.
#
# HAIR7 c3 iteration 3 (8 Oct 20:40; the critic's it6: 'the hair-skin interface is not made of hairs': L08's part a pale line in a flat
# brown fill, its hairline an airbrushed smear, L22 a dark shelf over bare skin, the mass ~30 % of a head's fibres): the FOLLICLE FIELD
# ALONE MAKES THE INTERFACE. Four pieces, one idea (the skin under hair is dark because it is shadowed and crowded
# with roots, the edge is soft because the follicles thin, shorten and stand singly there; not because the skin is painted):
#   - the painted root base is retired on a build for Cycles (index.js: baseK 0 under o.cycles; the engine's cards keep it): the scalp is skin;
#   - a follicle is a FOLLICULAR UNIT: 1-4 hairs leave one pore (Headington 1984: units of 1-4 terminal hairs, ~2.2 a unit behind the
#     line; the first few millimetres of the frontal hairline are single-hair units, the hair-restoration literature's 'single-hair
#     zone'), so `fu` (the size distribution behind the line) blends to singles over `fu_band` inside the line; a unit's other hairs
#     leave the same pore and part from it by fu_sp over fu_div of arc, then run with it in its lock (fu_companions);
#   - the hairline's intermediate hairs are PIGMENTED (pig_int 0: what thins them at the edge is their calibre, x r_int, and their
#     length; the 35 % pigment cut of iteration 2 drew a pale frost on dark hair where photographs show fine dark hairs); their relative
#     calibre rides in the curve attribute 'cal' (1 terminal) for HAIRMAT's shaft model;
#   - a card that starts OFF the skin (an afro's shells, a volume's surface coils) no longer floats: each of its fibres rises from a
#     follicle under it (behind its root by b_back x its height, b_lat x its height across, inside the line, on its side of the part)
#     along a curve that leaves the skin at the follicle angle and meets the fibre's start along its own direction, coiled as its form
#     (fading out where it joins), so an afro's volume is fibres from the scalp, not layers over bare skin (bridge_strands).
FOL = dict(catch=0.016, hmax=0.005, wide=1.35, join=(0.008, 0.014), alpha=0.6, alpha_line=0.35, alpha_sd=0.12,
           band=0.010, p_int=0.6, r_int=(0.4, 0.65), len_int=(0.015, 0.05), pig_int=0.0, cross=0.0015, p_cross=0.4, sink=0.0002,
           fu=(0.2, 0.45, 0.28, 0.07), fu_band=0.006, fu_sp=(0.00015, 0.00045), fu_pore=0.00004, fu_div=0.006, fu_trim=0.06,
           b_back=(0.2, 1.0), b_k=0.6, b_lat=0.35, b_tries=8)
_FACE = ((0, 2, 1), (0, 2, 1), (1, 0, 2), (1, 0, 2), (2, 0, 1), (2, 0, 1))   # field.js FACE: major axis, in-face axes u, v


def _sstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


class Follicles:
    """the head's follicle field (v7.js fol7, bind frame with three's axes, metres) and the export's head matrix (bind -> posed Blender)"""

    def __init__(self, fol, head_matrix):
        self.C = np.array(fol['C'], float); self.eyeY = float(fol['eyeY']); self.kn = np.array(fol['kn'], float)
        self.soft = max(1e-4, float(fol.get('soft', 0.004))); self.part = fol.get('part'); self.N = int(fol['N'])
        self.R = np.asarray(fol['R'], float) / 20000.0
        M = np.array(head_matrix, float).reshape(4, 4).T          # three's toArray is column-major
        self.M, self.Mi = M, np.linalg.inv(M)

    def to_bind(self, P):
        return P @ self.Mi[:3, :3].T + self.Mi[:3, 3]

    def dir_bind(self, D):
        d = D @ self.Mi[:3, :3].T
        return d / (np.linalg.norm(d, axis=-1, keepdims=True) + 1e-12)

    def to_posed(self, P):
        return P @ self.M[:3, :3].T + self.M[:3, 3]

    def dir_posed(self, D):
        d = D @ self.M[:3, :3].T
        return d / (np.linalg.norm(d, axis=-1, keepdims=True) + 1e-12)

    def r_at(self, D):
        """the scalp's radius about C along unit directions D (k, 3): field.js rAt (bilinear within a cube face; the largest corner where
        a corner was not hit)"""
        D = np.atleast_2d(D); A = np.abs(D); N = self.N; out = np.zeros(len(D))
        f = np.where((A[:, 0] >= A[:, 1]) & (A[:, 0] >= A[:, 2]), np.where(D[:, 0] > 0, 0, 1),
                     np.where(A[:, 1] >= A[:, 2], np.where(D[:, 1] > 0, 2, 3), np.where(D[:, 2] > 0, 4, 5)))
        for fi in range(6):
            sel = f == fi
            if not sel.any():
                continue
            m, a, b = _FACE[fi]; w = A[sel, m]; u = D[sel, a] / w; v = D[sel, b] / w
            x = np.clip((u + 1) / 2 * N - 0.5, 0, N - 1.001); y = np.clip((v + 1) / 2 * N - 0.5, 0, N - 1.001)
            i = np.floor(x).astype(int); j = np.floor(y).astype(int); fx = x - i; fy = y - j
            c = lambda ii, jj: self.R[(fi * N + jj) * N + ii]
            r00, r10, r01, r11 = c(i, j), c(i + 1, j), c(i, j + 1), c(i + 1, j + 1)
            bil = (r00 * (1 - fx) + r10 * fx) * (1 - fy) + (r01 * (1 - fx) + r11 * fx) * fy
            good = (r00 > 0) & (r10 > 0) & (r01 > 0) & (r11 > 0)
            out[sel] = np.where(good, bil, np.maximum(np.maximum(r00, r10), np.maximum(r01, r11)))
        return out

    def line(self, aph):
        """the hairline's height above the eyes at azimuth |aph| from the front (grow.js hairlineFn: a C1 cubic Hermite through the knots)"""
        K = self.kn; aph = np.asarray(aph, float); out = np.full(aph.shape, K[-1, 1]); done = np.zeros(aph.shape, bool)
        for k in range(1, len(K)):
            sel = (~done) & (aph <= K[k, 0])
            if sel.any():
                a0, v0, m0 = K[k - 1]; a1, v1, m1 = K[k]; dx = a1 - a0 + 1e-9; t = np.clip((aph[sel] - a0) / dx, 0, 1); t2 = t * t; t3 = t2 * t
                out[sel] = (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * dx * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * dx * m1
                done |= sel
        return out

    def inside(self, Pb):
        """metres over the scalp from the hairline, positive inside it (grow.js hairlineFn .dist)"""
        q = Pb - self.C; aph = np.abs(np.arctan2(q[:, 0], q[:, 2])); e = Pb[:, 1] - self.eyeY - self.line(aph)
        a0 = np.maximum(0.0, aph - 0.01); sl = (self.line(aph + 0.01) - self.line(a0)) / (aph + 0.01 - a0); R = np.maximum(0.03, np.hypot(q[:, 0], q[:, 2]))
        return e / np.sqrt(1 + (sl / R) ** 2)

    def part_sd(self, Pb):
        """the signed distance from the jagged part (v7.js part7 sd) and where the part runs (v5.js partOf along)"""
        P = self.part; q = Pb - self.C; a, l0, l1, ph0, ph1 = P['jag']
        jag = a * (0.65 * np.sin(q[:, 2] / l0 * 2 * np.pi + ph0) + 0.35 * np.sin(q[:, 2] / l1 * 2 * np.pi + ph1))
        sd = q[:, 0] * P['m'][0] + q[:, 2] * P['m'][1] - jag
        return sd, _sstep(0.22, 0.5, q[:, 1] / P['ry']) * _sstep(-0.6, -0.25, q[:, 2] / P['rz'])


def _fu_size(rng, inb):
    """a follicular unit's hair count: FOL fu behind the line, singles at it (inb: 0 at the line -> 1 at fu_band inside)"""
    p = np.asarray(FOL['fu'], float); p = p / p.sum(); w = float(inb)
    p = w * p + (1 - w) * np.array([1.0, 0, 0, 0])
    return int(np.searchsorted(np.cumsum(p), rng.random() * 0.999999) + 1)


# HAIR7 c7 iteration 2 (15 Oct; the behaviour, no switch): THE FOLLICLE FIELD COMES FIRST. What the critic read (it15.md, beside the
# photographs: 616bb9, 409621, 774135, 322226, c1971c): L08's part opens into a bald wedge toward the forehead with stepped, felt-cap edges;
# L03's crop reads as thinning, scalp in stripes through it; L12's front reads as a lace-front wig. One cause: until now each CARD drew its
# own follicles (a catchment under its first centimetre or so, `catch` along it, `wide` x its width across), so the scalp was covered only
# where some card's catchment reached: the field was the sum of the cards' footprints, dense where rows of cards overlap (L08 ~190 roots /
# cm2 4-8 mm inside the line) and thin or empty between them (~78 at 24-32 mm; a hole 1.4-2.6 cm behind the line at the part's front where
# no catchment lay; 8 Oct dumps, tools/fol2_node.py). A scalp is the other way round: the FOLLICLES are the primary structure, spread
# evenly over the hair-bearing skin (follicular units ~1 mm apart, Headington 1984; density varies little over the scalp of an unthinned
# adult), and a lock is whatever the fibres of the follicles beneath it gather into as they leave the skin. So:
#   - the field: follicular units evenly over the scalp (a Fibonacci lattice of directions about the head's centre, jittered by `jit` of
#     its spacing and turned at random, so it shows neither rows nor spirals), on the skin (the radius map, with its area: r^2 / cos of the
#     surface's tilt to the radius), with the hairline's own soft edge as its density (the line's smoothstep, as the per-card draws had),
#     at `fu_d` units a mm2 x the part's density (65 a cm2, ~2.2 hairs a unit with fu above: ~145 hairs a cm2, the low end of the
#     follicular-unit densities of the hair-restoration literature, 65-100 a cm2, and below every ancestry's measured hair density in
#     HAIRMAT's fibre model, 161-226 a cm2 (Loussouarn 2001), so HAIRMAT's render children, k >= 1 a fibre, bring each person to their
#     own density by ancestry and age, now over an EVEN field; at 0.8 an African head would be denser than measured, k clamped at 1);
#     the old catchments gave ~290 roots / cm2 6-10 mm inside L08's line and ~64-95 over the rest (8 Oct dumps), so the parent count
#     grows by the back and the gaps (the cost below) and HAIRMAT's k falls;
#   - each unit is GATHERED by a card lying over it as it leaves the skin: of its `cand` nearest card footprints (the card's arc while it
#     is within hmax of the skin, `wide` x its half-width across; behind its root counts as distance, as does beside it), one is drawn
#     with weight exp(-distance / tau): the card it lies under, shared evenly where cards overlap; on the follicle's side of the part
#     (within `cross` of the part's line, `p_cross` of them may go to the other side: the hairs that cross it); a unit no card lies
#     within `reach` of has no hair (the groom's own bare scalp: a short back, a temple left clear). A card's fibre count is no longer
#     its width / spacing (S): it is the follicles beneath it (the lock's size emerges from the scalp it covers; median S on the dumps);
#   - the card then draws ONE FIBRE PER UNIT it gathered (and the unit's companions, fu_companions), each at its follicle's place across
#     the card (so the lock a fibre joins is the one lying over its follicle: a lock is the cluster of the follicles beneath it), rooted
#     at the follicle, leaving the skin at the follicle angle and joining its place in the card over `join` (or jk x its distance from
#     the card, if longer); a card on the skin that gathered no unit draws nothing (its scalp went to the cards over it).
# The per-card catchment draws (FOL lam, up, upL, tries) are retired with this. Cards that start OFF the skin (an afro's shells) still
# rise from follicles under them (bridge_strands); braids and locs (tubes) are untouched. Constants are the scalp's, set once.
FIELD = dict(fu_d=0.65, jit=0.35, reach=0.015, cand=40, pre_cand=160, tau=0.0015, jk=1.25, pre=24000, kmax=24)
# HAIR7 c8 iteration 2 (16 Oct; the behaviour, no switch): A HAIR'S LENGTH IS ITS FOLLICLE'S, NOT ITS CARD'S.
# What the critic read (it18.md, 1015-212503 L12 and 1015-203527 L06 beside 322226, 5ae4ad at 1:1): on the crown left of the part, pale
# flat strips 0.8-1.4 cm wide with SQUARE ENDS stacked like shingles, a smooth cap right of it; nothing in the photographs ends on the dome.
# The cause is in the field (tools/cut_node.py on L12's cards): the engine lays short COVER cards for its own render (part5: 0.6-1.8 cm
# hairs along both edges of the part; fringe4 / line7: the hairline's fine short strands), 2,300 of L12's 4,190 cards, median 1.5 cm,
# and FIELD let a follicle be gathered by whichever card lay over it, so the follicle's hair took that CARD's length: 77 % of the hairs
# within 1 cm of the part (2 cm or more inside the line) and 9-15 % over the rest of the crown grew 1-6 cm and stopped on the dome, each
# card's fibres converging from the ~1 cm of scalp it gathered into a ribbon that ends in a line (its trim): the shingles.
# A hair's length is a property of its follicle: grown since its anagen began, at most the cut (Robbins 2012; the cut is a surface over
# the head that changes over centimetres, a layer at a time, never from one follicle to the next); a terminal hair does not stop where the
# clump it lies under stops. In the engine those short cards stand in for what the Cycles field makes itself (the hairline's intermediate
# hairs: FOL band / p_int / len_int; the part: follicles on its line, hair diverging to each side). So, in the gathering (assign_follicles):
#   - the CUT at a follicle's place is the longest card among those lying at its place (within `w` of its nearest footprint, on its side
#     of the part): the length the hair growing there has been cut to;
#   - a TERMINAL follicle's hair goes to a card that CARRIES that length: the gathering weight x sstep(carry) of the card's length over
#     the cut (a card shorter than ~half the cut there cannot hold the hair; the trim's own spread, ~0.8-1, passes); where no card at its
#     place carries it (a crop: all cards alike) nothing changes; the hairline's INTERMEDIATE hairs (short by their own state) are
#     gathered as before by the card nearest them; the fibre then rises at its follicle's angle and joins its card's lock as before
#     (root_fibres: over jk x its distance), so a part's edge is full-length hairs leaving the line to each side.
# The cover cards that lose their follicles draw nothing in Cycles (their scalp is the field's); the engine's own render is untouched.
# The constants are the cut's scale (a few mm: the footprints' spacing; the trim's spread), set once for every head; nothing is fitted.
CUT = dict(w=0.005, carry=(0.45, 0.7))
# ... AND ITS PLACE IS ITS FOLLICLE'S WHILE IT LIES ON THE HEAD (c8 iteration 2, the same change: the fibre, not the card, is the unit on the
# scalp). The gathering (assign_follicles) draws a card's follicles from the scalp beside it as well as under it: on L12's cards (8 Oct dump,
# tools/cut_node.py) the follicle lies a median 4.4 mm from its card's centreline (p90 9 mm) while the cards are 2.3 mm wide (median), so 59 %
# of the fibres sat CLAMPED on their card's two edges (|u| > 0.96) and root_fibres then joined every fibre onto its card over 8-14 mm of arc:
# each card's ~1 cm of scalp funnelled into a 2-3 mm ribbon within a centimetre of the roots, bare between ribbons: strips over the dome. On
# a head a hair lies where its follicle put it while it lies in the hair's layer over the scalp (it cannot pass through the hairs beside
# it; the flow, the comb and the part give it its direction, not its place); it gathers with its neighbours into locks only where the hair
# leaves the head and hangs. So the join brings a fibre onto its card's DIRECTION and depth over `join` as before, but its offset ACROSS the
# flow (along the card's side vector) is kept, carried in the card's frame, while the card lies within `lay` of the skin (the thickness of
# the layer a long-haired head's hair makes over the dome: L12's long cards rise 5 mm off the skin in a median 2.7 cm and 10 mm in 5.4 cm),
# and released over `gather` of arc after the card leaves it (the locks' own scale, LOCK_S). A crop, whose cards lie on the head all along,
# keeps every fibre at its follicle's place; curled hair, whose cards stand off the skin within a few cm, gathers into its locks there.
PLACE = dict(lay=0.012, gather=0.03)


def _fib_dirs(M, rng, jit):
    """M near-evenly spaced unit directions (a Fibonacci lattice), turned at random, each jittered in its tangent plane by up to jit x the
    lattice spacing"""
    i = np.arange(M) + 0.5; y = 1 - 2 * i / M; rr = np.sqrt(np.maximum(0, 1 - y * y)); ph = i * math.pi * (3 - math.sqrt(5))
    D = np.stack([rr * np.cos(ph), y, rr * np.sin(ph)], 1)
    Q, _ = np.linalg.qr(rng.normal(size=(3, 3))); D = D @ Q.T
    ref = np.where((np.abs(D[:, 0]) < 0.9)[:, None], np.array([[1.0, 0, 0]]), np.array([[0, 0, 1.0]]))
    t1 = np.cross(D, ref); t1 /= np.linalg.norm(t1, axis=1, keepdims=True); t2 = np.cross(D, t1)
    a = rng.uniform(0, 2 * math.pi, M); r = jit * math.sqrt(4 * math.pi / M) * np.sqrt(rng.random(M))
    D = D + t1 * (r * np.cos(a))[:, None] + t2 * (r * np.sin(a))[:, None]
    return D / np.linalg.norm(D, axis=1, keepdims=True)


def _field_weight(fol, D, rref):
    """per direction: the follicle's place on the skin, its distance inside the hairline, and its relative density per lattice point
    (the hairline's soft edge x the skin's area per solid angle, r^2 / cos(tilt), relative to rref^2)"""
    r = fol.r_at(D); ok = r > 0.02
    ref = np.where((np.abs(D[:, 0]) < 0.9)[:, None], np.array([[1.0, 0, 0]]), np.array([[0, 0, 1.0]]))
    t1 = np.cross(D, ref); t1 /= np.linalg.norm(t1, axis=1, keepdims=True); t2 = np.cross(D, t1); h = 0.01
    g1 = (fol.r_at(D + t1 * h) - fol.r_at(D - t1 * h)) / (2 * h); g2 = (fol.r_at(D + t2 * h) - fol.r_at(D - t2 * h)) / (2 * h)
    sec = np.sqrt(1 + (g1 * g1 + g2 * g2) / np.maximum(r, 1e-3) ** 2)
    rb = fol.C + D * (r - FOL['sink'])[:, None]; e = fol.inside(rb)
    w = np.where(ok, _sstep(-fol.soft, fol.soft, e) * (r / rref) ** 2 * np.minimum(sec, 2.5), 0.0)
    return rb, e, w


def field_follicles(fol, density, cover, rng, stats=None):
    """the follicular units over the hair-bearing scalp (FIELD above: fu_d a mm2 x density, the hairline's soft edge), bind frame:
    -> rb (n, 3), the skin's outward direction (n, 3), e (n,); only where cover(rb) says a card lies within reach"""
    rref = float(np.max(fol.R)); M0 = FIELD['pre']
    D0 = _fib_dirs(M0, rng, FIELD['jit']); rb0, e0, w0 = _field_weight(fol, D0, rref)
    sel = w0 > 0; cov0 = np.zeros(len(D0), bool)
    if density <= 0 or not sel.any():
        return None
    cov0[sel] = cover(rb0[sel], probe=True); wref = float(np.percentile(w0[sel], 99))
    area = float(np.sum(w0 * cov0)) * rref * rref * 4 * math.pi / M0             # m2 of hair-bearing skin, the line's soft edge weighted
    N = FIELD['fu_d'] * 1e6 * density * area
    mp = float(np.sum(np.minimum(w0 / wref, 1) * cov0)) / len(D0)
    if mp <= 0:
        return None
    M = int(min(4e6, N / mp)); D = _fib_dirs(M, rng, FIELD['jit']); rb, e, w = _field_weight(fol, D, rref)
    keep = rng.random(M) < np.minimum(w / wref, 1)
    rb, e, D = rb[keep], e[keep], D[keep]
    if stats is not None:
        stats.update(field_area_cm2=round(area * 1e4, 1), field_lattice=M, field_target=int(N), field_drawn=int(len(rb)))
    return rb, D, e


def assign_follicles(F, cards, fol, rng, stats=None, probe=False, term=None):
    """each follicle F (n, 3, bind) to the card lying over it (FIELD above): cards = dict of padded arrays P, T, SD, H (nC, K, ...),
    valid (nC, K), S (nC: its share), side (nC: its root's side of the part, 0 none), L (nC: its length) -> (card (n,) -1 for none, sample
    slot k (n,), place across u (n,)); probe: only whether some card lies within reach (n,) bool. Each follicle is drawn to one of its
    `cand` nearest footprints (the exact footprint distance fd) with weight exp(-fd / tau): the card it lies under, shared evenly where
    cards overlap; (c8 it 2, CUT) a terminal follicle (term (n,) bool) only to a card that carries the cut at its place"""
    P, T, SD, H, V = cards['P'], cards['T'], cards['SD'], cards['H'], cards['valid']; nC, K = V.shape
    cc = np.array([P[c][V[c]].mean(0) for c in range(nC)]); crad = np.array([np.max(np.linalg.norm(P[c][V[c]] - cc[c], axis=1) + H[c][V[c]] * FOL['wide']) for c in range(nC)])
    n = len(F); nk = min(FIELD['cand'], nC); npre = min(FIELD['pre_cand'], nC)
    CAND = np.zeros((n, nk), int); FD = np.full((n, nk), np.inf); KK = np.zeros((n, nk), int); UU = np.zeros((n, nk))
    sdf, alf = fol.part_sd(F) if fol.part is not None else (None, None)
    for c0 in range(0, n, 256):
        f = F[c0:c0 + 256]; dd = np.linalg.norm(f[:, None, :] - cc[None], axis=2) - crad[None]   # a lower bound of the footprint distance
        ci = np.argpartition(dd, npre - 1, axis=1)[:, :npre] if npre < nC else np.tile(np.arange(nC), (len(f), 1))
        near = np.take_along_axis(dd, ci, 1) < FIELD['reach']
        d = f[:, None, None, :] - P[ci]                                            # (b, npre, K, 3): the exact footprint distance
        al = np.sum(d * T[ci], -1); la = np.sum(d * SD[ci], -1)
        fd = np.sqrt(np.maximum(0, np.abs(la) - H[ci] * FOL['wide']) ** 2 + al * al); fd = np.where(V[ci], fd, np.inf)
        kb = np.argmin(fd, axis=2); fdb = np.take_along_axis(fd, kb[..., None], 2)[..., 0]
        ub = np.take_along_axis(la / np.maximum(H[ci], 1e-6), kb[..., None], 2)[..., 0]
        fdb = np.where(near & (fdb <= FIELD['reach']), fdb, np.inf)
        if nk < npre:   # the nk nearest footprints (a narrow card at the hairline lies inside a broad card's bound; it is kept by its own distance)
            j = np.argsort(fdb + rng.random(fdb.shape) * 1e-6, axis=1)[:, :nk]
            ci, fdb, kb, ub = (np.take_along_axis(x, j, 1) for x in (ci, fdb, kb, ub))
        if sdf is not None:   # on the follicle's side of the part, but for the few that cross it near its line
            sc = cards['side'][ci]; s_f = np.sign(sdf[c0:c0 + 256])[:, None]; a_f = (alf[c0:c0 + 256] > 0.05)[:, None]
            okx = (np.abs(sdf[c0:c0 + 256]) <= FOL['cross'])[:, None] & (rng.random((len(f), 1)) < FOL['p_cross'])
            fdb = np.where(a_f & (sc != 0) & (s_f != sc) & ~okx, np.inf, fdb)
        CAND[c0:c0 + 256] = ci; FD[c0:c0 + 256] = fdb; KK[c0:c0 + 256] = kb; UU[c0:c0 + 256] = ub
    has = np.isfinite(FD).any(axis=1)
    if probe:
        return has
    fin = np.isfinite(FD)
    W = np.exp(-np.where(fin, FD, 1.0) / FIELD['tau']) * fin   # nearer footprints gather more; equal ones share
    cut = None
    if term is not None and 'L' in cards:   # (c8 it 2, CUT) a terminal hair to a card that carries the cut at its place
        Lc = cards['L'][CAND]; fmin = np.min(np.where(fin, FD, np.inf), axis=1, keepdims=True)
        at = fin & (FD <= fmin + CUT['w'])
        cut = np.max(np.where(at, Lc, 0.0), axis=1)
        Wc = W * _sstep(CUT['carry'][0], CUT['carry'][1], Lc / np.maximum(cut, 1e-6)[:, None])
        use = np.asarray(term, bool) & (Wc.sum(1) > 0)
        W = np.where(use[:, None], Wc, W)
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-30)
    a = (rng.random(n)[:, None] > np.cumsum(W, 1)).sum(1).clip(0, nk - 1)
    r_ = np.arange(n); card = np.where(has, CAND[r_, a], -1)
    if stats is not None:
        cnt = np.bincount(card[has], minlength=nC).astype(float)
        stats.update(field_gathered=int(has.sum()), field_bare=int((~has).sum()), field_cards=int(nC), field_cards_none=int(np.sum(cnt == 0)),
                     field_per_card_vs_S_p10_p50_p90=[round(float(x), 2) for x in np.percentile(cnt / np.maximum(cards['S'], 1), (10, 50, 90))])
        if cut is not None:   # terminal units on a card under half the cut at their place (the shingles' hairs): what is left
            tg = np.asarray(term, bool) & has
            sh_ = cards['L'][card[tg]] < 0.5 * cut[tg]
            stats.update(cut_terminal=int(tg.sum()), cut_short_after=int(sh_.sum()))
    return card, KK[r_, a], UU[r_, a]


def root_fibres(st, fr, fol, A, rng, stats=None, place=True):
    """(c7 it 2, FIELD) the card's fibres st [(q, r)], fibre j from follicle j of A (rb, d: bind; e; k: its sample on the card's frame);
    -> [(q, r, pigment cut, relative calibre, hairs in its follicular unit)] as follicle_strands; (c8 it 2, PLACE) the fibre keeps its
    follicle's place across the flow while its card lies in the hair's layer on the head, and gathers into its card after"""
    s = fr['s']; out = []
    offi = None
    if place:   # where the card lies in the layer on the head (its centreline within PLACE lay of the skin): the arcs it leaves it
        Pb = fol.to_bind(fr['P']); dv = Pb - fol.C; dl = np.maximum(np.linalg.norm(dv, axis=1), 1e-6)
        offi = np.nonzero(dl - fol.r_at(dv / dl[:, None]) > PLACE['lay'])[0]
    for j, (q, r) in enumerate(st):
        if len(q) < 4:
            out.append((q, r, 0.0, 1.0, 1)); continue
        kk = int(min(A['k'][j], len(q) - 4)); ej = float(A['e'][j])
        r0 = fol.to_posed(A['rb'][j][None])[0]; n0 = fol.dir_posed(A['d'][j][None])[0]
        x = s[kk:len(q)] - s[kk]; d0 = r0 - q[kk]; lat = 0.0
        if offi is not None:   # (c8 it 2, PLACE) the offset across the flow is kept (in the card's frame), not joined
            lat = float(d0 @ fr['SD'][kk]); d0 = d0 - lat * fr['SD'][kk]
            i_off = np.searchsorted(offi, kk); x_on = (s[offi[i_off]] - s[kk]) if i_off < len(offi) else 1e3
        jl = max(rng.uniform(*FOL['join']), FIELD['jk'] * float(np.linalg.norm(d0))); f = 1 - _sstep(0, jl, x)
        inb = float(_sstep(0, FOL['band'], ej)); al = FOL['alpha_line'] + (FOL['alpha'] - FOL['alpha_line']) * inb + rng.normal(0, FOL['alpha_sd'])
        q2 = q[kk:] + d0[None, :] * f[:, None] + n0[None, :] * (math.tan(min(1.2, max(0.05, al))) * x * f)[:, None]
        if lat:
            q2 = q2 + fr['SD'][kk:kk + len(q2)] * (lat * (1 - _sstep(x_on, x_on + PLACE['gather'], x)))[:, None]
        r2 = np.array(r[:len(q2)], dtype=np.float64); pig = 0.0; cal = 1.0
        if bool(A['it'][j]):   # the hairline's intermediate hairs (c7 it 3: the field draws them, a single-hair unit each)
            cal = rng.uniform(*FOL['r_int']); r2 = r2 * cal; Li = rng.uniform(*FOL['len_int']) * (0.5 + 0.5 * inb)
            keep = max(3, min(len(q2), int(np.searchsorted(x, Li)) + 1)); q2, r2 = q2[:keep], r2[:keep]; pig = FOL['pig_int'] * (1 - 0.5 * inb)
            if stats is not None:
                stats['int'] += 1
        nfu = 1   # (c7 it 3) the unit's other hairs are fibres of their own (field_plan), not copies of this one
        if stats is not None:
            stats['moved'] += 1
        out.append((q2, r2, pig, cal, nfu))
    if stats is not None:
        stats['rooted'] += 1; stats['fibres'] += len(st)
    return out


def field_plan(cards_in, fol, rng, stats=None, density=1.0, cut=True):
    """(c7 it 2, FIELD) cards_in: {card index: fr (the card's resampled frame, posed; its S)} for the cards that may root on the skin ->
    ({card index: dict(u, k, rb, d, e)} for the cards that start on the skin, set of those that start off it)"""
    rows, off = [], set()
    for c, fr in cards_in.items():
        if 'P' not in fr:
            continue
        s = fr['s']; nn = int(np.sum(s <= FOL['catch'] + 0.01)); nn = max(1, nn)
        Pb = fol.to_bind(fr['P'][:nn]); dv = Pb - fol.C; dl = np.linalg.norm(dv, axis=1); hb = dl - fol.r_at(dv / dl[:, None])
        if not (hb[0] <= FOL['hmax']):
            off.add(c); continue
        hi = np.nonzero(hb > FOL['hmax'])[0]; klast = (hi[0] - 1) if len(hi) else nn - 1; klast = max(0, klast)
        ks = np.unique(np.linspace(0, klast, min(FIELD['kmax'], klast + 1)).round().astype(int))
        Tb = fol.dir_bind(fr['T'][:nn])
        SDb = fol.dir_bind(fr['SD'][:nn]); side = 0.0
        if fol.part is not None:
            sd0, al0 = fol.part_sd(Pb[:1])
            if al0[0] > 0.05:
                side = float(np.sign(sd0[0]) or 1.0)
        rows.append((c, Pb[ks], Tb[ks], SDb[ks], fr['H'][ks], ks, side, int(fr.get('S', 1)), float(fr.get('L', fr['s'][-1]))))
    if not rows:
        return {}, off
    nC, K = len(rows), FIELD['kmax']
    pad = lambda i, dim: np.stack([np.concatenate([r[i], np.repeat(r[i][-1:], K - len(r[i]), 0)]) if dim else np.concatenate([r[i], np.repeat(r[i][-1:], K - len(r[i]))]) for r in rows])
    cards = dict(P=pad(1, 3), T=pad(2, 3), SD=pad(3, 3), H=pad(4, 0), kix=pad(5, 0).astype(int),
                 valid=np.stack([np.arange(K) < len(r[5]) for r in rows]), side=np.array([r[6] for r in rows]), S=np.array([r[7] for r in rows]),
                 L=np.array([r[8] for r in rows]))

    def cover(F, probe=True):
        return assign_follicles(F, cards, fol, rng, probe=True)
    got = field_follicles(fol, density, cover, rng, stats)
    if got is None:
        return {}, off
    rb, D, e = got
    # the hairline's intermediate hairs (short by their own state) first: (c8 it 2, CUT) the terminal ones go to a card carrying the cut
    nU = len(rb); inb = _sstep(0, FOL['band'], e)
    intm = (e < FOL['band']) & (rng.random(nU) < FOL['p_int'] * _sstep(FOL['band'], 0, e))
    card, k, u = assign_follicles(rb, cards, fol, rng, stats, term=~intm if cut else None)
    # (c7 it 3, CURL) every hair of a unit is its own fibre from its own follicle at the unit's pore: the unit's size (singles at the line;
    # an intermediate hair of the hairline is a single-hair unit), each hair a little apart across the card, and its own curl state
    fub = _sstep(0, FOL['fu_band'], e); nfu = np.array([1 if intm[i] else _fu_size(rng, fub[i]) for i in range(nU)], int)
    hi = np.repeat(np.arange(nU), nfu); nH = len(hi)
    tng = rng.normal(0, 1, (nH, 3)); dn = D[hi]; tng -= dn * np.sum(tng * dn, 1, keepdims=True); tng /= np.linalg.norm(tng, axis=1, keepdims=True) + 1e-12
    first = np.r_[True, hi[1:] != hi[:-1]]
    rbh = rb[hi] + tng * (np.where(first, 0.0, FOL['fu_pore']))[:, None]
    uh = u[hi] + np.where(first, 0.0, rng.normal(0, CURL['fu_u'], nH)); csh = curl_states(rbh, rng)
    if stats is not None:
        stats.update(field_units=int(nU), field_hairs=int(nH), field_intermediate_units=int(intm.sum()))
    plan = {}
    cardh = card[hi]; order = np.argsort(cardh, kind='stable')
    for ci in np.unique(cardh[cardh >= 0]):
        idx = order[np.searchsorted(cardh[order], ci, 'left'):np.searchsorted(cardh[order], ci, 'right')]
        idx = idx[rng.permutation(len(idx))]
        plan[rows[ci][0]] = dict(u=uh[idx], k=cards['kix'][ci][k[hi[idx]]], rb=rbh[idx], d=D[hi[idx]], e=e[hi[idx]], c=csh[idx], it=intm[hi[idx]])
    for r in rows:
        plan.setdefault(r[0], None)
    return plan, off


def bridge_strands(st, fol, rng, stats=None, form='straight'):
    """(HAIR7 c3 iteration 3) the fibres of a card that starts OFF the skin (an afro's shell, a volume's surface coil), each grown from a
    follicle under it: a curve from the skin (leaving at the follicle angle toward the card) to the fibre's start (along its own
    direction), coiled as its form with the coil fading out at the join; a fibre with no follicle inside the line keeps its start"""
    S, T = len(st), FOL['b_tries']; coil = COIL.get(form)
    q0 = np.array([q[0] for q, _ in st], float); qk = np.array([q[min(2, len(q) - 1)] for q, _ in st], float)
    b0 = fol.to_bind(q0); dv = b0 - fol.C; dl = np.linalg.norm(dv, axis=1); d0 = dv / dl[:, None]; h = dl - fol.r_at(d0)
    tb = fol.dir_bind(qk - q0); tp = tb - d0 * np.sum(tb * d0, 1, keepdims=True); tl = np.linalg.norm(tp, axis=1)
    alt = np.cross(d0, np.array([0.0, 1.0, 0.0])); alt /= np.linalg.norm(alt, axis=1, keepdims=True) + 1e-12
    tp = np.where((tl > 0.2)[:, None], tp / np.maximum(tl, 1e-9)[:, None], alt); lat = np.cross(d0, tp)
    hc = np.maximum(h, FOL['hmax'])[:, None]
    back = rng.uniform(*FOL['b_back'], (S, T)) * hc * FOL['b_k']; lu = rng.normal(0, FOL['b_lat'], (S, T)) * hc
    base = (fol.C + d0 * fol.r_at(d0)[:, None])
    p = base[:, None, :] - tp[:, None, :] * back[..., None] + lat[:, None, :] * lu[..., None]
    dd = p - fol.C; dd /= np.linalg.norm(dd, axis=-1, keepdims=True)
    rb = fol.C + dd * (fol.r_at(dd.reshape(-1, 3)).reshape(S, T) - FOL['sink'])[..., None]
    e = fol.inside(rb.reshape(-1, 3)).reshape(S, T)
    acc = rng.random((S, T)) <= _sstep(-fol.soft, fol.soft, e)
    if fol.part is not None:
        sd0, al0 = fol.part_sd(base)
        sd, al = fol.part_sd(rb.reshape(-1, 3)); sd, al = sd.reshape(S, T), al.reshape(S, T)
        side0 = np.where(sd0 >= 0, 1.0, -1.0)[:, None]
        other = (al0[:, None] > 0.05) & (al > 0.05) & (np.sign(sd) != side0)
        acc &= ~other
    first = np.argmax(acc, axis=1); has = acc[np.arange(S), first] & (h > FOL['hmax'])
    out = []
    for j, (q, r) in enumerate(st):
        if not has[j]:
            out.append((q, r, 0.0, 1.0, 1)); continue
        t = first[j]; f = fol.to_posed(rb[j, t][None])[0]; n0 = fol.dir_posed(dd[j, t][None])[0]
        P1 = q[0]; L = float(np.linalg.norm(P1 - f))
        if L < 1e-4:
            out.append((q, r, 0.0, 1.0, 1)); continue
        tw = P1 - f; tw = tw - n0 * float(tw @ n0); tw /= (np.linalg.norm(tw) + 1e-12)
        al = min(1.2, max(0.15, FOL['alpha'] + rng.normal(0, FOL['alpha_sd'])))
        T0 = math.cos(al) * tw + math.sin(al) * n0; T1 = q[min(2, len(q) - 1)] - q[0]; T1 = T1 / (np.linalg.norm(T1) + 1e-12)
        seg = min(0.002, coil['lam'] / 8) if coil else 0.002; mb = int(np.clip(math.ceil(L * 1.3 / seg) + 1, 4, 400))
        u = np.linspace(0, 1, mb)[:, None]; u2, u3 = u * u, u * u * u
        B = (2 * u3 - 3 * u2 + 1) * f + (u3 - 2 * u2 + u) * L * T0 + (-2 * u3 + 3 * u2) * P1 + (u3 - u2) * L * T1
        if coil:
            Tb = np.gradient(B, axis=0); Tb /= np.linalg.norm(Tb, axis=1, keepdims=True) + 1e-12
            Sb = np.cross(Tb, n0); sl = np.linalg.norm(Sb, axis=1, keepdims=True); Sb = np.where(sl > 0.2, Sb / np.maximum(sl, 1e-9), np.cross(Tb, tw))
            Sb /= np.linalg.norm(Sb, axis=1, keepdims=True) + 1e-12; Nb = np.cross(Tb, Sb)
            sb = np.r_[0, np.cumsum(np.linalg.norm(np.diff(B, axis=0), axis=1))]; Lb = sb[-1]
            A = coil['A'] * rng.uniform(0.7, 1.25); lam = coil['lam'] * rng.uniform(0.8, 1.25); th = rng.uniform(0, 6.283) + sb / lam * 2 * math.pi
            amp = A * np.clip(sb / coil['ramp'], 0, 1) * (1 - _sstep(Lb - lam, Lb, sb))
            B = B + (Sb * np.cos(th)[:, None] + (Nb * np.sin(th)[:, None] if form != 'wavy' else 0)) * amp[:, None]
        qn = np.concatenate([B[:-1], q]); rn = np.concatenate([np.full(mb - 1, float(r[0])), np.asarray(r, float)])
        out.append((qn, rn, 0.0, 1.0, _fu_size(rng, 1.0)))
        if stats is not None:
            stats['bridged'] = stats.get('bridged', 0) + 1
    if stats is not None:
        stats['fibres'] += S
    return out


def _transport(Pp):
    """a parallel-transported frame along padded fibres Pp (n, mL, 3): tangent, N1, N2 (a padded tail keeps its last good tangent)"""
    n, mL, _ = Pp.shape
    T = np.zeros_like(Pp); T[:, 1:-1] = Pp[:, 2:] - Pp[:, :-2]; T[:, 0] = Pp[:, 1] - Pp[:, 0]; T[:, -1] = Pp[:, -1] - Pp[:, -2]
    nl = np.linalg.norm(T, axis=2, keepdims=True); T = np.where(nl > 1e-12, T / np.maximum(nl, 1e-12), 0)
    for i in range(1, mL):
        bad = np.linalg.norm(T[:, i], axis=1) < 0.5; T[bad, i] = T[bad, i - 1]
    ref = np.where(np.abs(T[:, 0, 2:3]) < 0.9, np.array([[0, 0, 1.0]]), np.array([[1.0, 0, 0]]))
    N = np.zeros_like(Pp); v = np.cross(T[:, 0], ref); N[:, 0] = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    for i in range(1, mL):
        v = N[:, i - 1] - (N[:, i - 1] * T[:, i]).sum(1, keepdims=True) * T[:, i]
        ln = np.linalg.norm(v, axis=1, keepdims=True); N[:, i] = np.where(ln > 1e-9, v / np.maximum(ln, 1e-12), N[:, i - 1])
    return T, N, np.cross(T, N)


def fu_companions(fib, rng, chunk=1500):
    """(HAIR7 c3 iteration 3; since c7 it 3 only an off-skin card's bridged fibres: the field's hairs are each their own fibre) the other
    hairs of each follicular unit: fib [(q, r, pig, cal, nfu)] -> [(q, r, pig, cal)] for nfu - 1
    companions of each, leaving the parent's pore (fu_pore apart) and parting to fu_sp over fu_div of arc in the parent's transported
    frame, then running with it (its lock, its curl); a little shorter or longer at the cut (fu_trim), the calibre +-10 %"""
    par = [j for j, it in enumerate(fib) if it[4] > 1]
    if not par:
        return []
    par.sort(key=lambda j: len(fib[j][0])); out = []
    for c0 in range(0, len(par), chunk):
        ids = par[c0:c0 + chunk]; sz = np.array([len(fib[j][0]) for j in ids]); mL = int(sz.max())
        Pp = np.stack([np.concatenate([fib[j][0], np.repeat(fib[j][0][-1:], mL - len(fib[j][0]), 0)]) for j in ids]).astype(np.float64)
        _, N1, N2 = _transport(Pp)
        sa = np.concatenate([np.zeros((len(ids), 1)), np.cumsum(np.linalg.norm(np.diff(Pp, axis=1), axis=2), axis=1)], axis=1)
        for a_, j in enumerate(ids):
            q, r, pig, cal, nfu = fib[j]; m = len(q)
            for _ in range(nfu - 1):
                a = rng.uniform(0, 2 * math.pi); rad = rng.uniform(*FOL['fu_sp'])
                off = FOL['fu_pore'] + (rad - FOL['fu_pore']) * _sstep(0, FOL['fu_div'], sa[a_, :m])
                dq = (math.cos(a) * N1[a_, :m] + math.sin(a) * N2[a_, :m]) * off[:, None]
                ln = max(3, min(m, int(round(m * rng.uniform(1 - FOL['fu_trim'], 1)))))
                out.append(((q + dq)[:ln], (np.asarray(r, float) * rng.uniform(0.9, 1.1))[:ln], pig, cal))
    return out


def hair_material(name, mel, grey, rough=0.32, form='straight', grey_mel=0.04):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    h = nt.nodes.new('ShaderNodeBsdfHairPrincipled'); h.model = 'CHIANG'; h.parametrization = 'MELANIN'
    M = max(1e-4, mel['eu'] + mel['ph'])
    mval = 1 - math.exp(-M)
    h.inputs['Melanin Redness'].default_value = mel['ph'] / M
    h.inputs['Tint'].default_value = (1, 1, 1, 1)
    h.inputs['Roughness'].default_value = rough + (0.08 if form in ('coily', 'curly') else 0)
    h.inputs['Radial Roughness'].default_value = 0.35
    h.inputs['Coat'].default_value = 0.0
    h.inputs['IOR'].default_value = 1.55
    h.inputs['Offset'].default_value = math.radians(2.5)
    h.inputs['Random Color'].default_value = 0.12
    h.inputs['Random Roughness'].default_value = 0.2
    # grey strands (curve attribute 'grey' = 1): almost no pigment
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'grey'; at.attribute_type = 'GEOMETRY'
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'FLOAT'
    mx.inputs['A'].default_value = mval; mx.inputs['B'].default_value = grey_mel
    nt.links.new(at.outputs['Fac'], mx.inputs['Factor']); nt.links.new(mx.outputs['Result'], h.inputs['Melanin'])
    hi = nt.nodes.new('ShaderNodeHairInfo'); nt.links.new(hi.outputs['Random'], h.inputs['Random'])
    nt.links.new(h.outputs['BSDF'], out.inputs['Surface'])
    return m


def grow_part(pp, hr, density=1.0, seed=1):
    """the part's render fibres, numpy only (build_part makes them Blender curves; the node checks call this directly):
    -> dict(sizes, P, R, G (grey per fibre, fractional), C (relative calibre per fibre), counts, form, fol (the field or None), fst (counts))"""
    part = hr['part']; cfg = PART.get(part, PART['scalp'])
    if part in ('lashes', 'lashesLow') and ((hr.get('shade') or {}).get('lash7')):   # (FACE7 c7 it 18) LASH7: the engine card's own lashes
        cfg = dict(cfg, lash7=hr['shade']['lash7'])
    counts = pp.arr(hr['counts']).astype(int)
    if not len(counts):
        return None
    pts, half, side, nrm = pp.arr(hr['points'], 3), pp.arr(hr['half']), pp.arr(hr['side'], 3), pp.arr(hr['normal'], 3)
    greyK = pp.arr(hr['greyK'])
    # (one current version, 8 Oct) the scalp's cards carry their tile slot in the random (rev 4's ringlet / coil strands, rev 6's helical
    # strips); the face cards (brows, lashes, beard) are plain clumps
    sh = hr.get('shade') or {}
    slots = np.floor(pp.arr(hr['rand']) * 16).astype(int) if part == 'scalp' and hr.get('rand') else None
    # (HAIR6) rev 6's helical curl strips: tile slot 0 with the card random in [0.9, 1) (v6.js CardBuilder6 helix6 tags them so)
    strip6 = (slots == 0) & (pp.arr(hr['rand']) * 16 - slots >= 0.9) if slots is not None else None
    locks = part == 'scalp'   # (HAIR7 c3: the lock cohesion; every groom's since c7 it 1, no marker, no switch)
    # (HAIR7 c3 iteration 2: the follicles, every groom's since c7 it 1; the field rides in the marker, the head matrix in the export's eyes)
    hm = (getattr(pp, 'm', None) or {}).get('eyes') or {}
    fol = Follicles(sh['fol'], hm['headMatrix']) if part == 'scalp' and sh.get('fol') and hm.get('headMatrix') else None
    fst = dict(rooted=0, off=0, fibres=0, moved=0, int=0, bridged=0, fu=0)
    # (HAIR7 c3 iteration 2) the stream seeded by crc32, not hash(): Python randomises hash() per process (HAIRMAT's ASK 3), so the same
    # person grew different strands in every render
    rng = np.random.default_rng(seed * 7919 + zlib.crc32(part.encode()) % 1000)
    form = hr.get('form') or 'straight'
    tube = pp.arr(hr['tube']) if hr.get('tube') else None   # (integration v4) rope cards (braids, locs)
    plait = bool(sh.get('box')) and part == 'scalp' and slots is not None   # (HAIR7 c4 iteration 1, the behaviour since c5 it 9: a braid tube carries the 'net' slot 15)
    sizes, P, R, G, C = [], [], [], [], []
    slot_of = lambda c: int(slots[c]) if slots is not None else None
    strip_of = lambda c: bool(strip6[c]) if strip6 is not None else False
    plan, offc, cut7 = {}, set(), True
    if fol is not None:   # (HAIR7 c7 it 2, FIELD) the follicle field first: every card's frame over the skin, then the field and its gathering
        fin = {}; o = 0
        for c, n in enumerate(counts):
            sl = slice(o, o + n); o += n
            if tube is not None and tube[c] > 0.5:
                continue
            fr = dict(frame_only=True)
            strands_for_card(pts[sl], half[sl], side[sl], nrm[sl], cfg, form, rng, density, part, slot_of(c), strip_of(c), locks, fr)
            if 'P' in fr:   # its first `catch` + 1 cm only (the field reads no further)
                nn = max(2, int(np.sum(fr['s'] <= FOL['catch'] + 0.01)))
                Tg = np.gradient(fr['P'][:max(nn + 1, 2)], axis=0)[:nn]
                fin[c] = dict(P=fr['P'][:nn], SD=fr['SD'][:nn], H=fr['H'][:nn], s=fr['s'][:nn], T=Tg, S=fr['S'], L=float(fr['s'][-1]))   # (c8 it 2) its length: the cut it carries
        # (c8 it 2) CUT + PLACE's A/B arm only, until the critic reads it: the export's popts {"hair7cut": false} gathers and joins as
        # before (default on)
        cut7 = ((((getattr(pp, 'm', None) or {}).get('spec') or {}).get('popts') or {}).get('hair7cut', True)) is not False
        plan, offc = field_plan(fin, fol, np.random.default_rng(seed * 7919 + 4243), fst, density, cut=cut7); fin = None
        fst['cut'] = int(cut7)
    o = 0
    for c, n in enumerate(counts):
        sl = slice(o, o + n); o += n
        isTube = tube is not None and tube[c] > 0.5; fr = {} if fol is not None and not isTube else None
        A = plan.get(c) if fr is not None else None
        if fr is not None and c in plan and A is None:   # (c7 it 2) a card on the skin that gathered no follicle: its scalp is its neighbours'
            continue
        st = (plait_strands(pts[sl], half[sl], side[sl], nrm[sl], cfg, rng, density) if plait and int(slots[c]) == 15 else rope_strands(pts[sl], half[sl], side[sl], nrm[sl], cfg, rng, density)) if isTube else strands_for_card(pts[sl], half[sl], side[sl], nrm[sl], cfg, form, rng, density, part, slot_of(c), strip_of(c), locks, fr, A['u'] if A is not None else None, A['c'] if A is not None else None)
        if fr is not None:
            if A is not None:            # (c7 it 2, FIELD) each fibre from the follicle of the field it was drawn for
                st = root_fibres(st, fr, fol, A, rng, fst, place=cut7)
            elif c in offc and st:       # a card that starts off the skin: its fibres rise from follicles under it
                fst['off'] += 1; st = bridge_strands(st, fol, rng, fst, form)
            else:
                st = [(q, r, 0.0, 1.0, 1) for q, r in st]
            comp = fu_companions(st, rng)                         # (c3 iteration 3) the other hairs of each follicular unit
            fst['fu'] += len(comp); st = list(st) + comp
        # lane D's per-card grey is a BIAS on the person's grey (temples first, crown last: Panhard 2012), not a share of its own
        pg = min(1.0, max(0.0, hr.get('grey', 0) * (1.0 + float(greyK[c]))))
        for it in st:
            q, r = it[0], it[1]
            sizes.append(len(q)); P.append(q); R.append(r); G.append(1.0 if rng.random() < pg else (it[2] if len(it) > 2 else 0.0))
            C.append(it[3] if len(it) > 3 else 1.0)
    return dict(sizes=sizes, P=P, R=R, G=G, C=C, counts=counts, form=form, fol=fol, fst=fst)


def brow_fibre_material(cv, pp, part, P, sizes, G, seed=1, pig=None):
    """(FACE7 c6 it 14) the brows in the scalp's fibre BSDF: hairmat7's per-point melanin / redness / roughness from the person's scalp
    fibre (their own pigment, a per-hair lognormal, the cuticle's roughness), written on the brow curves; None (person_hair.py's own
    material) when hairmat7 is off or fails. (c7 it 18) pig: the part's own pigment {eu, ph} in place of the scalp's (the lashes: the
    export's lash melanin), the same fibre otherwise"""
    try:
        import hairmat7
        if hairmat7.mode() == 'off':
            return None
        PJ = hairmat7.params(pp); F = (PJ.get('parts') or {}).get('scalp') or PJ.get('fibre')
        if not F:
            return None
        if pig:
            F = dict(F, pigment=dict(F['pigment'], eu=float(pig['eu']), ph=float(pig['ph'])))
        P_all = np.concatenate(P).astype(np.float64)
        mel, red, rough, st = hairmat7.attributes(F, P_all, sizes, G, hairmat7.rng_for(part, seed))
        for k, v in ((F['cycles']['attrs']['melanin'], mel), (F['cycles']['attrs']['redness'], red), (F['cycles']['attrs']['roughness'], rough)):
            a = cv.attributes.new(k, 'FLOAT', 'POINT'); a.data.foreach_set('value', np.ascontiguousarray(v, np.float32))
        print(('lash7 fibre ' + part if pig else 'brow7 fibre'), json.dumps({k: round(v, 4) for k, v in st.items()}), flush=True)
        return hairmat7.material('hairmat7_' + part, F)
    except Exception as e:
        print(f'{"lash7" if pig else "brow7"} fibre: NOT applied ({type(e).__name__}: {e}); person_hair.py\'s own material', flush=True)
        return None


# HAIR7 c8 iteration 3 (16 Oct): A HAIR'S COLOUR IS ITS OWN HISTORY (HISTORY: after HAIRMAT's fibre has dressed the scalp, every groom).
# What the critics read (it18.md, it19.md: 1015-212503 L12, 1015-203527 L06 beside 322226, 64d2c8, 5ae4ad at 1:1 and 270 px): ONE FLAT VALUE
# over every long head, no darker underlayer, no paler canopy, no lock-scale families of tone. The cause is in how the pigment is laid
# down: HAIRMAT's fibre (hairmat7.attributes) gives each fibre the cast's melanins x an INDEPENDENT lognormal (sd 0.15) x one bleaching law
# of its arc length, so every fibre of the head, outside or under the others, ages alike, and independent per-fibre values average to the
# same value over any lock a pixel sees. Two parts of a real hair's history are missing; this step adds them to HAIRMAT's per-point
# melanin (hm_mel, hm_red), its law and its parameters otherwise as HAIRMAT made them:
#   (1) THE FOLLICLE'S OWN OUTPUT OVER THE SCALP. The pigment is made in each follicle's bulb, and its amount varies over the scalp by
#       region (one head's nape, temples and crown differ in shade; the greying order, temples first, crown last, Panhard et al. 2012, is
#       the far end of it), so neighbouring follicles share a shade, a lock (the cluster of the follicles under it, FIELD) carries one,
#       and the locks of the fall, which come from different places on the scalp, differ. A smooth lognormal field over the scalp at each
#       fibre's root (sd reg_sd, correlation length reg_ell, mean one) multiplies its eumelanin and pheomelanin. reg_sd and reg_ell are
#       PARAMETERS (the regional variation is visible on any head; it is not measured here).
#   (2) THE LIGHT EACH PIECE OF SHAFT HAS RECEIVED. Photo-oxidation bleaches the shaft's melanin where the light reaches it (Nogueira &
#       Joekes 2004, J Photochem Photobiol B 74:109; Hoting et al. 1995, J Soc Cosmet Chem 46:85), and the hair shades itself: UV is
#       absorbed within the outer microns of a fibre, so a fibre under others receives little; the canopy, the crown and the outer
#       surface of the fall pale, the underlayer and the hair against the neck keep their pigment (the darker hair under the top layer
#       of any sun-lightened head). HAIRMAT's law w = 1 - exp(-age / tau) (age = s / the growth rate) is the AVERAGE fibre's: its tau
#       holds for the head's mean exposure. A fibre's own dose rate is its exposure e over the head's mean e_bar, so here
#       w = 1 - exp(-(e / e_bar) age / tau), with HAIRMAT's B and tau: the head's mean bleaching kept, distributed by where the light falls.
#       e = the sky's light reaching the point, averaged over directions of the upper hemisphere (rings at `elev` degrees, `naz` azimuths,
#       weighted by the solid angle each stands for), through the hair (each fibre opaque to UV: its projected area per volume,
#       pi/4 x d x ds / h^3, from the dressed fibres' own radii, HAIRMAT's children included) and the body and clothes (the export's
#       meshes, opaque), on a voxel grid of h: the scale over which the hair's own movement between combings spreads the dose (a choice,
#       not measured): the fibres within one cell share its light (a ray is attenuated from the next cell on), so the canopy is the
#       outer cell's depth of hair, not the outermost fibre. The pose rendered stands for the hair's habitual place. The follicle field
#       is normalised to mean one over the head's fibres (the cast's melanin is the head's mean).
# Left as HAIRMAT made them: the cuticle's roughness along the shaft (its wear is mostly mechanical: combing, age not light) and the
# eumelanin / pheomelanin ratio (HAIRMAT's note: the evidence on which bleaches faster is mixed); so the canopy pales and the underlayer
# stays deeper, and warmer (the same melanins at a higher concentration). Nothing is set per person or fitted to a render or a photograph.
# A/B arm for this change only, until the critic reads it: the export's popts {"hair7hist": false} skips the step.
HIST = dict(reg_ell=0.04, reg_sd=0.20, nf=48, h=0.004, elev=(90.0, 55.0, 25.0), naz=(1, 6, 8), occ_step=0.002, margin=0.03)


def _sky_dirs():
    """unit directions over the upper hemisphere (rings at HIST elev, naz azimuths each) and their weights (the solid angle of each ring's
    band, split among its azimuths; summing to one)"""
    el = np.radians(np.array(HIST['elev'], float)); edges = np.r_[np.radians(90.0), (el[:-1] + el[1:]) / 2, np.radians(10.0)]
    D, W = [], []
    for i, (e, n) in enumerate(zip(el, HIST['naz'])):
        band = abs(math.sin(edges[i]) - math.sin(edges[i + 1]))
        for k in range(n):
            a = 2 * math.pi * (k + 0.5 * (i % 2)) / n
            D.append((math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e))); W.append(band / n)
    W = np.array(W); return np.array(D), W / W.sum()


def _occluders(pp, lo, hi, step):
    """points on the export's meshes (the body, the clothes) inside the box [lo, hi], about `step` apart (area-weighted samples of their
    triangles); None when the export carries no meshes (the node checks)"""
    out = []
    for rec in ((getattr(pp, 'm', None) or {}).get('meshes') or []):
        if not (isinstance(rec, dict) and rec.get('kind') in ('body', 'garment') and rec.get('position') and rec.get('index')):
            continue
        try:
            V = pp.arr(rec['position'], 3).astype(np.float64); T = pp.arr(rec['index'], 3).astype(np.int64)
        except Exception:
            continue
        A, B, C = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
        cen = (A + B + C) / 3; ins = np.all((cen > lo - step) & (cen < hi + step), axis=1)
        A, B, C = A[ins], B[ins], C[ins]
        if not len(A):
            continue
        area = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1); n = np.maximum(1, np.ceil(area / (step * step))).astype(int)
        idx = np.repeat(np.arange(len(A)), n); rng = np.random.default_rng(len(A))
        u, v = rng.random(len(idx)), rng.random(len(idx)); f = u + v > 1; u[f], v[f] = 1 - u[f], 1 - v[f]
        out.append(A[idx] + u[:, None] * (B[idx] - A[idx]) + v[:, None] * (C[idx] - A[idx]))
        out.append(np.concatenate([A, B, C]))
    return np.concatenate(out) if out else None


def sky_exposure(P, sizes, R, occ=None, mult=1.0, stats=None):
    """per point of the fibres (P concatenated, sizes, radii R per point): the share of the sky's light reaching it through the hair and
    the occluders (HISTORY (2)); mult scales the fibres' projected area (the node checks grow fewer fibres than the render)"""
    h = HIST['h']; P = np.asarray(P, np.float64); sizes = np.asarray(sizes, int)
    lo = P.min(0) - HIST['margin']; hi = P.max(0) + HIST['margin']; dims = np.maximum(2, np.ceil((hi - lo) / h).astype(int) + 1)
    seg = np.r_[0.0, np.linalg.norm(np.diff(P, axis=0), axis=1)]; seg[np.r_[0, np.cumsum(sizes)[:-1]]] = 0.0
    seg = np.minimum(seg, 3 * h)
    ij = np.clip(((P - lo) / h).astype(int), 0, dims - 1); flat = np.ravel_multi_index(ij.T, dims)
    sig = np.bincount(flat, weights=(math.pi / 4) * 2 * np.asarray(R, np.float64) * seg * mult, minlength=int(np.prod(dims))) / h ** 3
    sig = sig.reshape(dims)
    solid = np.zeros(dims, bool)
    if occ is not None and len(occ):
        oij = ((occ - lo) / h).astype(int); keep = np.all((oij >= 0) & (oij < dims), axis=1)
        solid[tuple(oij[keep].T)] = True
    cells = np.unique(flat); cij = np.stack(np.unravel_index(cells, dims), 1)
    # the light at every cell the hair occupies and its neighbours (for the trilinear lookup below)
    nb = (cij[:, None, :] + np.array([[a, b, c] for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)])[None]).reshape(-1, 3)
    nb = np.unique(np.clip(nb, 0, dims - 1), axis=0); E = np.zeros(dims, np.float32)
    D, W = _sky_dirs(); nmax = int(np.ceil(np.linalg.norm(dims))) + 1
    for d, w in zip(D, W):
        acc = np.zeros(len(nb))
        for c0 in range(0, len(nb), 20000):
            cc = nb[c0:c0 + 20000].astype(np.float64) + 0.5; tau = np.zeros(len(cc)); live = np.ones(len(cc), bool)
            for t in range(1, nmax):   # from the next cell on: the fibres sharing a cell share its light (the movement's mixing, h)
                q = (cc + t * d).astype(int)
                ins = live & np.all((q >= 0) & (q < dims), axis=1)
                if not ins.any():
                    break
                qi = q[ins]; tau[ins] += sig[qi[:, 0], qi[:, 1], qi[:, 2]] * h
                hit = np.zeros(len(cc), bool); hit[ins] = solid[qi[:, 0], qi[:, 1], qi[:, 2]]; tau[hit] = np.inf; live &= ~hit
                live &= ins
            acc[c0:c0 + 20000] = np.exp(-tau)
        E[tuple(nb.T)] += (w * acc).astype(np.float32)
    # trilinear between cell centres
    x = (P - lo) / h - 0.5; i0 = np.clip(np.floor(x).astype(int), 0, dims - 2); f = np.clip(x - i0, 0, 1)
    e = np.zeros(len(P))
    for a in (0, 1):
        for b in (0, 1):
            for c in (0, 1):
                wt = (f[:, 0] if a else 1 - f[:, 0]) * (f[:, 1] if b else 1 - f[:, 1]) * (f[:, 2] if c else 1 - f[:, 2])
                e += wt * E[i0[:, 0] + a, i0[:, 1] + b, i0[:, 2] + c]
    if stats is not None:
        stats.update(grid=[int(v) for v in dims], cells=int(len(cells)), occluder_cells=int(solid.sum()),
                     e_pct=[round(float(v), 4) for v in np.percentile(e, (10, 50, 90, 99))], e_mean=round(float(e.mean()), 4))
    return e


def history_pigment(P, sizes, R, G, mel, red, F, roots_X, rng, occ=None, mult=1.0, stats=None):
    """HISTORY on HAIRMAT's per-point Cycles melanin / redness (mel, red; P, sizes, R per point, G per fibre): the follicle's regional
    output at each root (roots_X: the fibres' roots in the scalp's frame) and the light's dose along the shaft -> new (mel, red)"""
    import hairmat7
    sizes = np.asarray(sizes, int); s, L, start = hairmat7.arc(np.asarray(P, np.float64), sizes)
    pg, we = F['pigment'], F['weather']; Bl, tau, growth = float(we['bleach']), float(we['tauMonths']), float(F['density']['growthCmPerMonth'])
    q = -np.log(np.clip(1.0 - np.asarray(mel, np.float64), 1e-6, 1.0)); ph = np.asarray(red, np.float64) * q; eu = q - ph
    g = np.repeat(np.clip(np.asarray(G, np.float64), 0, 1), sizes)
    eu_p = np.maximum(eu - g * pg['white']['eu'], 0.0); ph_p = np.maximum(ph - g * pg['white']['ph'], 0.0)   # the pigmented share
    gr = _grf(roots_X, rng, HIST['reg_ell'], HIST['nf']); fol = np.exp(HIST['reg_sd'] * gr)
    fol = fol / max(float(fol.mean()), 1e-9)   # the cast's melanin is the head's mean: the field distributes it over the scalp
    e = sky_exposure(P, sizes, R, occ, mult, stats); eb = max(float(e.mean()), 1e-6)
    age = s * 100.0 / growth / tau
    keep_avg = 1 - Bl * (1 - np.exp(-age)); keep_own = 1 - Bl * (1 - np.exp(-(e / eb) * age))
    k = np.repeat(fol, sizes) * keep_own / np.maximum(keep_avg, 1e-6)
    eu2 = eu_p * k + g * pg['white']['eu']; ph2 = ph_p * k + g * pg['white']['ph']; q2 = eu2 + ph2
    mel2 = 1 - np.exp(-q2); red2 = np.where(q2 > 0, ph2 / np.maximum(q2, 1e-12), 0)
    if stats is not None:
        stats.update(fol_pct=[round(float(v), 3) for v in np.percentile(fol, (10, 50, 90))],
                     k_pct=[round(float(v), 3) for v in np.percentile(k, (5, 25, 50, 75, 95))],
                     q_ratio_pct=[round(float(v), 3) for v in np.percentile(q2 / np.maximum(q, 1e-9), (5, 50, 95))])
    return mel2.astype(np.float32), red2.astype(np.float32)


def hair_history(ob, pp, hr, fol, seed=1):
    """build_part's last step for the scalp (HISTORY): rewrite HAIRMAT's per-point melanin / redness on the dressed curves; any failure
    leaves them as HAIRMAT wrote them, and the log says so"""
    try:
        if ((((getattr(pp, 'm', None) or {}).get('spec') or {}).get('popts') or {}).get('hair7hist', True)) is False:
            print('hair7 history: off (popts hair7hist false)', flush=True); return
        import hairmat7, time
        if hairmat7.mode() == 'off':
            return
        F = hairmat7.active('scalp', pp); cv = ob.data; A = (F or {}).get('cycles', {}).get('attrs') or {}
        if F is None or A.get('melanin') not in cv.attributes or A.get('redness') not in cv.attributes:
            print('hair7 history: NOT applied (no HAIRMAT pigment on the curves)', flush=True); return
        t = time.time(); P, sizes, R, G, C = hairmat7._read(cv); n = len(P)
        mel = np.empty(n, np.float32); red = np.empty(n, np.float32)
        cv.attributes[A['melanin']].data.foreach_get('value', mel); cv.attributes[A['redness']].data.foreach_get('value', red)
        start = np.r_[0, np.cumsum(sizes)[:-1]]; roots = P[start].astype(np.float64)
        rX = fol.to_bind(roots) if fol is not None else roots
        occ = _occluders(pp, P.min(0) - HIST['margin'], P.max(0) + HIST['margin'], HIST['occ_step'])
        st = dict(occluder_points=0 if occ is None else int(len(occ)))
        rng = np.random.default_rng(seed * 7919 + zlib.crc32(b'hair7:history') % 100003)
        mel2, red2 = history_pigment(P, sizes, R, G, mel, red, F, rX, rng, occ, 1.0, st)
        cv.attributes[A['melanin']].data.foreach_set('value', mel2); cv.attributes[A['redness']].data.foreach_set('value', red2)
        st.update(points=int(n), fibres=int(len(sizes)), mel_p50=[round(float(np.median(mel)), 4), round(float(np.median(mel2)), 4)], s=round(time.time() - t, 1))
        print('hair7 history', json.dumps(st), flush=True)
    except Exception as ex:   # never break a render: HAIRMAT's pigment as it wrote it
        print(f'hair7 history: NOT applied ({type(ex).__name__}: {ex}); HAIRMAT\'s pigment as it wrote it', flush=True)


def build_part(pp, hr, coll, density=1.0, seed=1):
    part = hr['part']; cfg = PART.get(part, PART['scalp'])
    g = grow_part(pp, hr, density, seed)
    if g is None or not g['sizes']:
        return None
    sizes, P, R, G, C, counts, form, fol, fst = (g[k] for k in ('sizes', 'P', 'R', 'G', 'C', 'counts', 'form', 'fol', 'fst'))
    cv = bpy.data.hair_curves.new('hair_' + part)
    cv.add_curves(sizes)
    cv.position_data.foreach_set('vector', np.concatenate(P).astype(np.float32).ravel())
    ra = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT')
    ra.data.foreach_set('value', np.concatenate(R).astype(np.float32))
    ga = cv.attributes.new('grey', 'FLOAT', 'CURVE'); ga.data.foreach_set('value', np.array(G, dtype=np.float32))
    if fol is not None:   # (HAIR7 c3 iteration 3) the fibre's calibre relative to a terminal hair (the hairline's intermediates < 1), for HAIRMAT's shaft
        ca = cv.attributes.new('cal', 'FLOAT', 'CURVE'); ca.data.foreach_set('value', np.array(C, dtype=np.float32))
    # (HAIR5) a rev-5 groom's grey strands at melanin 0.012, the engine's rev-5 grey (shade.js GREY5): the same unpigmented strand
    mat = brow_fibre_material(cv, pp, part, P, sizes, G, seed) if part == 'brows' else None   # (FACE7 c6 it 14) the scalp's fibre BSDF
    if part in ('lashes', 'lashesLow') and (hr.get('shade') or {}).get('lash7'):   # (FACE7 c7 it 18) the person's fibre, the lash's pigment
        mat = brow_fibre_material(cv, pp, part, P, sizes, G, seed, pig=hr['melanin'])
    cv.materials.append(mat or hair_material('hairmat_' + part, hr['melanin'], hr.get('grey', 0), cfg['rough'], form, 0.012))
    ob = bpy.data.objects.new('hair_' + part, cv); coll.objects.link(ob)
    ob['strands'] = len(sizes); ob['points'] = int(sum(sizes))
    if part in ('lashes', 'lashesLow') and (hr.get('shade') or {}).get('lash7'):   # (FACE7 c7 it 18) the lashes' diameters as drawn
        r0s = np.array([float(r[0]) for r in R]) * 2e6
        print(f'lash7 calibre {part}: {len(counts)} cards -> {len(r0s)} lashes, root diameter um p10 {np.percentile(r0s, 10):.0f} p50 {np.median(r0s):.0f} p90 {np.percentile(r0s, 90):.0f}', flush=True)
    if part == 'brows':   # (FACE7 c6 it 14) the brow hairs' diameters as drawn
        r0s = np.array([float(r[0]) for r in R]) * 2e6
        print(f'brow7 calibre: {len(r0s)} hairs, root diameter um p10 {np.percentile(r0s, 10):.0f} p50 {np.median(r0s):.0f} p90 {np.percentile(r0s, 90):.0f}', flush=True)
    print(f'hair {part}: {len(counts)} cards -> {len(sizes)} strands, {sum(sizes)} points, form {form}, melanin {hr["melanin"]}, grey {hr.get("grey", 0):.2f}'
          + (f', follicles: {fst["rooted"]} rooted cards ({fst["off"]} off the skin, {fst["bridged"]} fibres rising to them), {fst["moved"]} / {fst["fibres"]} fibres from their own follicle, {fst["int"]} intermediate, {fst["fu"]} more hairs of their follicular units, cut {fst.get("cut")} ({fst.get("cut_terminal")} terminal units, {fst.get("cut_short_after")} on a card under half the cut, {fst.get("field_cards_none")} cards gathered none)' if fol is not None else ''))
    if fol is not None:
        ob['follicles'] = json.dumps(fst)
    # (HAIRMAT, landed 8 Oct) the hair FIBRE model re-dresses the scalp and the beard (optics, the fibre's shaft, the render density) by
    # its lane file videos/web/assets/person/v7lanes/HAIRMAT.json; any failure leaves the part exactly as built above (blender/hairmat7.py)
    import hairmat7
    ob = hairmat7.dress(ob, pp, hr, seed)
    if part == 'scalp' and ob is not None:   # (c8 it 3, HISTORY) the pigment from the follicle's place and the light the shaft has had
        hair_history(ob, pp, hr, fol, seed)
    return ob
