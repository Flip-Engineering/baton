"""Source-pinned skin and hair material response for issue #87 (S3).

This is the skin/hair workstream's material register and CPU response model.
It reads the pinned person-pipeline sources (below), emits the exact material
values a renderer needs for skin and hair, and computes the two S3 metrics
that the human-sim preflight compares:

  skin_stretch        max principal skin stretch under a standard tension
  hair_deviation_mm   groomed fibre deflection under a standard comb load

The seed motif (the assignment's 128-hex seed) is used the way the issue uses
its shared seed: one master seed, a per-subsystem derived seed, and a stable
canonical JSON hash over every input and output.  The high-entropy seed is not
consumed as decoration: it seeds the deterministic material scatter (per-patch
collagen volume fraction, per-person skin modulus, per-fibre diameter and
ellipticity) so the same seed and spec produce byte-identical metrics, while a
different seed produces a different but still reproducible population.

What is modelled
----------------
Skin.  The current pipeline carries a layered optics model (optics.js:
Donner-Jensen/Jimenez; measured Weyrich 2006 per-region diffuse mean free path
and Torrance-Sparrow specular), but the render registers still collapse the
specular to zone roughness and the mechanical response to a single soft-tissue
modulus.  The register here adds the two missing physical terms:

  * measured per-region specular (alpha = sqrt(2) * Beckmann rms slope, lobe
    weight from Weyrich's rho_s), and measured per-region transport l_d, so a
    renderer can use the face's own cheek/forehead/neck response instead of
    one uniform lobe;
  * a collagen-recruited constitutive response.  The baseline is the
    elastin-dominated linear modulus; the candidate adds the collagen term
    sigma = Ee*eps + Vf*Ec*(eps/eps_r)^n.  Collagen recruitment is the
    mechanism that makes real skin stiffen at a few percent strain; without it
    the standard 8 kPa tension over-stretches the material.

Hair.  fibre.js already derives each person's diameter, ellipticity, density,
growth, melanin and the far-field Marschner/Chiang lobes; engine.js and
hairmat7.py shade with them.  The register here exposes the per-person fibre
geometry and lobe shares to the preflight and fixes the mechanical response:
the baseline treats the fibre as a circular section (the area-equivalent
diameter), the candidate uses the elliptical section's major-axis second
moment, which is the stiffness of a groomed lock whose major axis lies in the
scalp plane.  A groom-hold parameter (the fraction of the free length held by
product/fibre friction) is compared on and off.

Frame
-----
Every metric is a CPU material response.  No render is launched here and no
image is produced.  `check_no_render` refuses a plan that asks for one; the
lead's `human_sim.check_render_admission` and the farm admission policy remain
the only render gate.

Seed qualities (brief)
----------------------
The 128 hex chars are 512 bits: a stable frame (the whole population is one
material register), high entropy inside it (per-patch/per-fibre variation),
deterministic recurrence (same seed + spec -> same metrics), and byte-motif
repetition with an offset (the same 8-byte seed word is reused per subsystem
and per labelled draw, with the label as the offset).  That is why the two
metrics below are compared without re-rendering.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import subprocess
from pathlib import Path

VERSION = "human-skin-hair-material-v1"

# The issue's shared seed, recorded by the coordinating lead in
# homelab/HUMANS_ISSUE87.md.  It is the default so every specialist's
# comparison can be replayed with one value.
ISSUE87_SEED = (
    "6a5980a305c1b7a4fb352b1cd4e405ed58fc3f486e734ce9efaf13b7a7b4d42e"
    "316df18768e311e463ce1fafa7039e4f1f33e39010ef9fac6c569cb7f196ceb0"
)
# This assignment's seed (the operator's 128-hex value).  It is kept as a
# named input: the comparison can be replayed with it via --seed.
ASSIGNMENT_SEED = (
    "ba7404598201b9b6d0a30c33b2c5df9f021936849833f53215e28e9ecae8bfa31"
    "70cf88b86e242104bd57e90874b35f39bcfda7c403ccadd3da44b9d585b08cd"
)
DEFAULT_MASTER_SEED = ISSUE87_SEED
SUBSYSTEMS = ("skin", "hair")
STYLES = ("photorealistic", "stylized")

# The coordinating lead's thresholds (human_sim.THRESHOLDS).  Kept identical
# so `compare` can be spliced into human_sim.compare without translation.
THRESHOLDS = {
    "photorealistic": {
        "joint_rms_deg": ("max", 2.0),
        "volume_preservation": ("min", 0.97),
        "cloth_penetration_mm": ("max", 1.0),
        "cloth_stretch": ("max", 1.08),
        "skin_stretch": ("max", 1.06),
        "hair_deviation_mm": ("max", 3.0),
        "min_clearance_mm": ("min", 2.0),
    },
    "stylized": {
        "joint_rms_deg": ("max", 4.0),
        "volume_preservation": ("min", 0.92),
        "cloth_penetration_mm": ("max", 2.5),
        "cloth_stretch": ("max", 1.15),
        "skin_stretch": ("max", 1.12),
        "hair_deviation_mm": ("max", 6.0),
        "min_clearance_mm": ("min", 1.0),
    },
}

# The pinned pipeline sources this register reads.  Hashes were taken from
# commit SOURCE_COMMIT; `pins()` re-reads and verifies them.
SOURCE_COMMIT = "e235ca432f1514842da8e99ec28addf77c99b2d4"
SOURCE_PINS = (
    ("videos/web/lib/fx/likeness/optics.js", "beec3e2e938b491d204fc8ab9c18d85e75bf2ce4a5f78d6d7192cebec0fa10e4"),
    ("videos/web/lib/fx/likeness/skin.js", "f57ec37be94870c0f2fe2b9dca773e06108cedf2b4cbbd3cda31727fd93b488d"),
    ("videos/web/lib/fx/hair/material/fibre.js", "6ea424e87dcf5ed7287ea490694ed7b758420f38c4ff6db4df75780b4ba1c697"),
    ("videos/web/lib/fx/hair/material/engine.js", "e66a33c4877edd2cb6abc71de6c7c3db0119f5d7a53b0203933c531fc5ea177a"),
    ("videos/web/lib/fx/hair/shade.js", "8c7b291d5916b80c6bdcdd78b248e74d8d2a6ae7b5e22097bb85fd5792973183"),
    ("videos/blender/hairmat7.py", "4d7f1a1edf43b603a522725087b0d1259e27bb1dba17820a81eaa2530282eb9a"),
    ("videos/blender/person_scene.py", "146ed65e20a2f2e92dd6f96ba7330d60f669cce120e447b8cc68874217f7328d"),
    ("videos/web/lib/fx/person/build.js", "c3bf81655ec299fa7bac76e6d2c9d12cbdb26544f337cdeb4e17d6ecf617cd8c"),
    ("videos/web/lib/fx/person/core.js", "2f20cd427c21cf60541cf45685280f70142316af547c25f69ebce22cb8efb505"),
)

# This module never renders.  The flag is public so a test/consumer can
# assert the comparison stayed CPU-only.
RENDER_LAUNCHED = False


def canonical_json(value) -> str:
    """Canonical JSON used for every manifest and comparison hash."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(value) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def _is_hex(value, length: int) -> bool:
    return (
        isinstance(value, str)
        and len(value) == length
        and value == value.lower()
        and all(c in "0123456789abcdef" for c in value)
    )


def derive_seed(master_seed: str, subsystem: str) -> int:
    """Deterministic 64-bit subsystem seed (same contract as human_sim)."""
    if not _is_hex(master_seed, 128):
        raise ValueError("master_seed must be 128 lowercase hex chars (512-bit)")
    if subsystem not in SUBSYSTEMS:
        raise ValueError("unknown subsystem: " + str(subsystem))
    return int.from_bytes(
        hashlib.sha256(bytes.fromhex(master_seed) + b":" + subsystem.encode()).digest()[:8],
        "big",
    )


def _rng(master_seed: str, subsystem: str, label: str) -> random.Random:
    """A labelled draw from the subsystem seed (the seed motif's offset)."""
    word = derive_seed(master_seed, subsystem)
    offset = int.from_bytes(hashlib.sha256(label.encode()).digest()[:8], "big")
    return random.Random(word ^ offset)


# --------------------------------------------------------------------------
# Measured inputs (verbatim from the pinned sources)
# --------------------------------------------------------------------------

# optics.js WEYRICH06: measured diffuse mean free path l_d (mm) and
# Torrance-Sparrow m = Beckmann rms slope, rho_s = lobe scale.
WEYRICH06 = {
    "ld": {
        "cheek": (1 / 0.5572, 1 / 0.9751, 1 / 1.5494),
        "forehead": (1 / 0.5443, 1 / 0.9831, 1 / 1.5499),
        "neck": (1 / 0.6911, 1 / 1.2488, 1 / 1.9159),
        "min": (1.0904, 0.6376, 0.6035),
        "max": (2.8106, 1.2607, 0.6590),
    },
    "ts": {
        "upperLip": (0.305, 0.248),
        "forehead": (0.270, 0.275),
        "brows": (0.280, 0.295),
        "lids": (0.262, 0.290),
        "nose": (0.235, 0.305),
        "cheek": (0.272, 0.235),
        "lips": (0.290, 0.290),
        "chin": (0.290, 0.225),
        "jaw": (0.285, 0.205),
    },
}
FACE_BLOOD = 2.0  # optics.js: the face's dermis blood relative to the arm

# fibre.js ANCESTRY: area-equivalent diameter (um), cross-section ellipticity
# major/minor, terminal density (per cm2), growth (cm/month).
HAIR_ANCESTRY = {
    "african": {"d_um": 75.0, "ell": 1.75, "density_cm2": 161.0, "growth_cm_month": 0.78},
    "east_asian": {"d_um": 88.0, "ell": 1.20, "density_cm2": 175.0, "growth_cm_month": 1.25},
    "european": {"d_um": 70.0, "ell": 1.40, "density_cm2": 226.0, "growth_cm_month": 1.20},
    "hispanic": {"d_um": 80.0, "ell": 1.40, "density_cm2": 174.0, "growth_cm_month": 1.22},
    "south_asian": {"d_um": 78.0, "ell": 1.44, "density_cm2": 200.0, "growth_cm_month": 1.20},
    "mena": {"d_um": 75.0, "ell": 1.40, "density_cm2": 210.0, "growth_cm_month": 1.20},
    "indigenous": {"d_um": 85.0, "ell": 1.20, "density_cm2": 175.0, "growth_cm_month": 1.25},
}
HAIR_GROUP = {
    "black": "african",
    "african": "african",
    "asian": "east_asian",
    "east_asian": "east_asian",
    "white": "european",
    "european": "european",
    "hispanic": "hispanic",
    "latino": "hispanic",
    "south_asian": "south_asian",
    "indian": "south_asian",
    "mena": "mena",
    "indigenous": "indigenous",
}
# Representative cast pigments (eu, ph in fibre.js's Cycles units).  These are
# register inputs, not claims about a particular person: the cast record's
# exact hair colour lives in the pipeline's casting records.
HAIR_MELANIN = {
    "african": {"eu": 1.80, "ph": 0.05},
    "east_asian": {"eu": 1.40, "ph": 0.03},
    "european": {"eu": 0.55, "ph": 0.08},
    "hispanic": {"eu": 1.00, "ph": 0.06},
    "south_asian": {"eu": 1.50, "ph": 0.04},
    "mena": {"eu": 0.90, "ph": 0.06},
    "indigenous": {"eu": 1.30, "ph": 0.03},
}
# fibre.js constants used by the shading response.
HAIR_ETA = 1.55
HAIR_BETA_N = 0.30
HAIR_EU = (0.506, 0.841, 1.653)
HAIR_PH = (0.343, 0.733, 1.924)
HAIR_WHITE = {"eu": 0.010, "ph": 0.020}
HAIR_DIAMETER_SD = 0.10  # fibre.js SHAFT.sd
HAIR_ELLIPTICITY_SD = 0.05  # a register input around the ancestry value
HAIR_CHORD = None  # computed below from fibre.js's normal-incidence integral


def _hair_chord(samples: int = 400) -> float:
    total = 0.0
    for i in range(samples):
        h = (i + 0.5) / samples
        total += 2 * math.cos(math.asin(h / HAIR_ETA))
    return total / samples


HAIR_CHORD = _hair_chord()


def _chiang_k(beta_n: float = HAIR_BETA_N) -> float:
    return (((((0.245 * beta_n) + 5.574) * beta_n - 10.73) * beta_n + 2.532) * beta_n - 0.215) * beta_n + 5.969


def _sigma_a(eu: float, ph: float = 0.0):
    return [eu * e + ph * p for e, p in zip(HAIR_EU, HAIR_PH)]


def _mass_albedo(eu: float, ph: float = 0.0, beta_n: float = HAIR_BETA_N):
    k = _chiang_k(beta_n)
    return [math.exp(-math.sqrt(max(0.0, s)) * k) for s in _sigma_a(eu, ph)]


def _fibre_transmittance(eu: float, ph: float = 0.0):
    return [math.exp(-s * HAIR_CHORD) for s in _sigma_a(eu, ph)]


def _fresnel_d(cos_i: float, eta: float = HAIR_ETA) -> float:
    cos_i = min(1.0, max(0.0, cos_i))
    s2 = (1.0 - cos_i * cos_i) / (eta * eta)
    if s2 >= 1.0:
        return 1.0
    ct = math.sqrt(1.0 - s2)
    rs = (cos_i - eta * ct) / (cos_i + eta * ct)
    rp = (eta * cos_i - ct) / (eta * cos_i + ct)
    return 0.5 * (rs * rs + rp * rp)


def _hair_lobes(eu: float, ph: float = 0.0, beta_n: float = HAIR_BETA_N, nh: int = 400):
    """Marschner/Chiang far-field lobe shares (fibre.js farField rho only)."""
    sigma = _sigma_a(eu, ph)
    rho_r = 0.0
    rho_tt = [0.0, 0.0, 0.0]
    rho_trt = [0.0, 0.0, 0.0]
    for j in range(nh):
        h = -1.0 + (j + 0.5) * 2.0 / nh
        dh = 2.0 / nh
        go = math.asin(h)
        gt = math.asin(h / HAIR_ETA)
        f = _fresnel_d(math.cos(go))
        trans = [math.exp(-s * 2.0 * math.cos(gt)) for s in sigma]
        a1 = [(1.0 - f) ** 2 * t for t in trans]
        a2 = [(1.0 - f) ** 2 * f * t * t for t in trans]
        rho_r += 0.5 * f * dh
        for c in range(3):
            rho_tt[c] += 0.5 * a1[c] * dh
            rho_trt[c] += 0.5 * a2[c] * dh
    return {
        "R": rho_r,
        "TT": rho_tt,
        "TRT": rho_trt,
        "mass_albedo": _mass_albedo(eu, ph, beta_n),
        "fibre_transmittance": _fibre_transmittance(eu, ph),
    }


# --------------------------------------------------------------------------
# Cast
# --------------------------------------------------------------------------

# The twelve baked lineup people (human.md).  Age, ancestry and the hair
# pigment are the cast's own records (core.js V2_PLAN / V2_HAIR); the
# per-ancestry HAIR_MELANIN table is only the fallback for a cast record that
# does not carry a pigment.
CAST = (
    {"name": "L08_f24_hispanic", "sex": "f", "age": 24, "group": "hispanic", "melanin": {"eu": 1.8, "ph": 0.04}, "grey": 0.0},
    {"name": "L21_m32_black", "sex": "m", "age": 32, "group": "black", "melanin": {"eu": 3.2, "ph": 0.02}, "grey": 0.0},
    {"name": "L22_f27_black", "sex": "f", "age": 27, "group": "black", "melanin": {"eu": 3.2, "ph": 0.02}, "grey": 0.0},
    {"name": "L11_m23_white", "sex": "m", "age": 23, "group": "white", "melanin": {"eu": 1.1, "ph": 0.04}, "grey": 0.0},
    {"name": "L20_f29_asian", "sex": "f", "age": 29, "group": "asian", "melanin": {"eu": 3.0, "ph": 0.02}, "grey": 0.0},
    {"name": "L17_m28_hispanic", "sex": "m", "age": 28, "group": "hispanic", "melanin": {"eu": 2.2, "ph": 0.04}, "grey": 0.0},
    {"name": "L12_f39_white", "sex": "f", "age": 39, "group": "white", "melanin": {"eu": 0.12, "ph": 0.06}, "grey": 0.04},
    {"name": "L03_m38_asian", "sex": "m", "age": 38, "group": "asian", "melanin": {"eu": 3.0, "ph": 0.02}, "grey": 0.0},
    {"name": "L14_f42_black", "sex": "f", "age": 42, "group": "black", "melanin": {"eu": 3.2, "ph": 0.02}, "grey": 0.03},
    {"name": "L23_m45_white", "sex": "m", "age": 45, "group": "white", "melanin": {"eu": 0.35, "ph": 0.06}, "grey": 0.16},
    {"name": "L06_f53_white", "sex": "f", "age": 53, "group": "white", "melanin": {"eu": 0.45, "ph": 0.05}, "grey": 0.30},
    {"name": "L05_m59_black", "sex": "m", "age": 59, "group": "black", "melanin": {"eu": 3.2, "ph": 0.02}, "grey": 0.34},
)


def cast_specs():
    """A fresh, mutable copy of the twelve cast records."""
    return [dict(person) for person in CAST]


def _check_cast(cast):
    if not isinstance(cast, (list, tuple)) or not cast:
        raise ValueError("cast must be a non-empty list")
    out = []
    seen = set()
    for person in cast:
        if not isinstance(person, dict):
            raise ValueError("cast record must be a dict")
        name = person.get("name")
        if not isinstance(name, str) or not name or name in seen:
            raise ValueError("cast name missing or duplicated")
        seen.add(name)
        age = person.get("age")
        if type(age) is not int or not (18 <= age <= 90):
            raise ValueError("cast age must be an int in 18..90: " + str(name))
        group = str(person.get("group", "")).lower()
        if group not in HAIR_GROUP:
            raise ValueError("unknown cast group: " + str(group))
        out.append(dict(person, group=group, ancestry=HAIR_GROUP[group]))
    return out


# --------------------------------------------------------------------------
# Skin
# --------------------------------------------------------------------------

# Baseline: elastin-dominated linear skin, one uniform specular lobe, the old
# hand transport (optics.js's pre-SKIN7 radius 2.0 / 0.85 / 0.45 mm).
# Candidate: collagen recruitment + measured per-region specular/transport.
SKIN_REGISTERS = {
    "photorealistic": {
        "load_kpa": 8.0,
        "samples": 48,
        "percentile": 0.95,
        "collagen": {
            "vf": 0.18,
            "vf_sd": 0.02,
            "vf_age_decay": 0.006,  # fraction per year past 25
            "vf_floor": 0.55,
            "ee_kpa": 80.0,
            "ee_sd_kpa": 10.0,
            "ec_kpa": 900.0,
            "ec_sd_kpa": 120.0,
            "recruit_strain": 0.04,
            "recruit_sd": 0.006,
            "exponent": 2.0,
        },
        "sites": {"cheek": 1.0, "forehead": 1.10, "neck": 0.85},
    },
    "stylized": {
        "load_kpa": 8.0,
        "samples": 48,
        "percentile": 0.95,
        "collagen": {
            "vf": 0.12,
            "vf_sd": 0.02,
            "vf_age_decay": 0.006,
            "vf_floor": 0.55,
            "ee_kpa": 80.0,
            "ee_sd_kpa": 10.0,
            "ec_kpa": 600.0,
            "ec_sd_kpa": 100.0,
            "recruit_strain": 0.05,
            "recruit_sd": 0.008,
            "exponent": 2.0,
        },
        "sites": {"cheek": 1.0, "forehead": 1.10, "neck": 0.85},
    },
}
SKIN_BASELINE_TRANSPORT_MM = (2.0, 0.85, 0.45)
# The stylized register keeps the form of the measured specular but collapses
# the nine face regions to two lobes (oily T-zone versus dry cheek), so it is
# region-aware without pretending to carry the photoreal register's detail.
SPECULAR_GROUPS = {
    "oily": ("forehead", "nose", "upperLip", "brows", "lids"),
    "dry": ("cheek", "chin", "jaw", "lips"),
}


def _solve_skin_strain(stress_kpa, ee_kpa, vf, ec_kpa, recruit_strain, exponent):
    """Solve sigma = Ee*eps + Vf*Ec*(eps/eps_r)^n by bisection (monotone)."""
    lo, hi = 0.0, 1.0
    for _ in range(64):
        mid = (lo + hi) / 2.0
        value = ee_kpa * mid + vf * ec_kpa * (mid / recruit_strain) ** exponent
        if value < stress_kpa:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _skin_site(style, master_seed, person, site, site_factor, baseline):
    register = SKIN_REGISTERS[style]
    c = register["collagen"]
    age_factor = max(c["vf_floor"], 1.0 - c["vf_age_decay"] * max(0, person["age"] - 25))
    vf_base = c["vf"] * age_factor * site_factor
    rng = _rng(master_seed, "skin", person["name"] + ":" + site)
    stretches = []
    for _ in range(register["samples"]):
        ee = min(160.0, max(30.0, rng.gauss(c["ee_kpa"], c["ee_sd_kpa"])))
        ec = min(1800.0, max(200.0, rng.gauss(c["ec_kpa"], c["ec_sd_kpa"])))
        recruit = min(0.10, max(0.015, rng.gauss(c["recruit_strain"], c["recruit_sd"])))
        vf = 0.0 if baseline else min(0.30, max(0.0, rng.gauss(vf_base, c["vf_sd"])))
        eps = _solve_skin_strain(register["load_kpa"], ee, vf, ec, recruit, c["exponent"])
        stretches.append(1.0 + eps)
    stretches.sort()
    index = min(len(stretches) - 1, int(register["percentile"] * (len(stretches) - 1)))
    return {
        "site": site,
        "site_factor": site_factor,
        "age_factor": round(age_factor, 6),
        "vf_base": round(vf_base, 6),
        "mean": round(sum(stretches) / len(stretches), 6),
        "p95": round(stretches[index], 6),
        "max": round(stretches[-1], 6),
        "samples": register["samples"],
        "load_kpa": register["load_kpa"],
    }


def skin_material(style: str, cast=None, baseline: bool = False):
    """The skin material register (per-region specular + transport + collagen)."""
    if style not in STYLES:
        raise ValueError("unknown style: " + str(style))
    _check_cast(cast if cast is not None else cast_specs())
    ts = WEYRICH06["ts"]
    weights = [v[1] for v in ts.values()]
    mean_weight = sum(weights) / len(weights)
    mean_m = sum(v[0] for v in ts.values()) / len(ts)
    group_of = {name: group for group, names in SPECULAR_GROUPS.items() for name in names}
    group_stats = {}
    for group, names in SPECULAR_GROUPS.items():
        group_stats[group] = (
            sum(ts[name][0] for name in names) / len(names),
            sum(ts[name][1] for name in names) / len(names),
        )
    regions = {}
    specular_error = 0.0
    for name, (m, rho_s) in ts.items():
        target_alpha = math.sqrt(2.0) * m
        target_weight = rho_s / mean_weight
        if baseline:
            alpha = math.sqrt(2.0) * mean_m
            weight = 1.0
            source = "uniform"
        elif style == "stylized":
            alpha = math.sqrt(2.0) * group_stats[group_of[name]][0]
            weight = group_stats[group_of[name]][1] / mean_weight
            source = "two-lobe:" + group_of[name]
        else:
            alpha = target_alpha
            weight = target_weight
            source = "measured"
        specular_error += (alpha - target_alpha) ** 2 + (weight - target_weight) ** 2
        regions[name] = {
            "m_beckmann": m,
            "alpha_ggx": round(alpha, 6),
            "weight": round(weight, 6),
            "rho_s_measured": rho_s,
            "source": source,
        }
    specular_error = math.sqrt(specular_error / len(regions))
    transport = {}
    transport_error = 0.0
    for site in ("cheek", "forehead", "neck"):
        measured = WEYRICH06["ld"][site]
        actual = SKIN_BASELINE_TRANSPORT_MM if baseline else measured
        transport[site] = {
            "ld_mm": [round(v, 6) for v in actual],
            "ld_mm_measured": [round(v, 6) for v in measured],
        }
        for value, target in zip(actual, measured):
            transport_error += (value - target) ** 2
    transport_error = math.sqrt(transport_error / (len(transport) * 3))
    return {
        "register": "baseline" if baseline else style,
        "face_blood": FACE_BLOOD,
        "regions": regions,
        "transport": transport,
        "specular_error": round(specular_error, 6),
        "transport_error_mm": round(transport_error, 6),
        "specular_contrast": round(max(v["weight"] for v in regions.values()) / min(v["weight"] for v in regions.values()), 6),
        "collagen": dict(SKIN_REGISTERS[style]["collagen"]),
        "baseline_transport_mm": list(SKIN_BASELINE_TRANSPORT_MM),
    }


def skin_response(style: str, master_seed: str, cast=None, baseline: bool = False):
    """Worst-site p95 skin stretch over the cast (deterministic)."""
    if style not in STYLES:
        raise ValueError("unknown style: " + str(style))
    cast = _check_cast(cast if cast is not None else cast_specs())
    register = SKIN_REGISTERS[style]
    rows = []
    worst = None
    for person in cast:
        sites = []
        for site, factor in register["sites"].items():
            row = _skin_site(style, master_seed, person, site, factor, baseline)
            sites.append(row)
            if worst is None or row["p95"] > worst["p95"]:
                worst = dict(row, cast=person["name"], ancestry=person["ancestry"])
        rows.append({"name": person["name"], "age": person["age"], "sites": sites})
    return {
        "register": "baseline" if baseline else style,
        "metric": "skin_stretch",
        "worst": worst,
        "per_cast": rows,
        "material": skin_material(style, cast, baseline),
    }


# --------------------------------------------------------------------------
# Hair
# --------------------------------------------------------------------------

# E = 3.5 GPa for dry keratin (Robbins, Chemical and Physical Behavior of
# Human Hair, 5th ed. 2012); density 1.32 g/cm3.  The standard probe is a
# 20 mm free strand under an 8 uN tip load, the scale of a light combing force
# on one fibre.  Groom hold = the fraction of the free length held by product
# and inter-fibre friction (the rendered groom's own parameter).
HAIR_REGISTERS = {
    "photorealistic": {
        "groom_hold": 0.25,
        "strand_mm": 20.0,
        "comb_uN": 8.0,
        "samples": 64,
        "percentile": 0.95,
        "E_gpa": 3.5,
        "density_kg_m3": 1320.0,
        "beta_n": HAIR_BETA_N,
        "card_mix": 0.0,
    },
    "stylized": {
        "groom_hold": 0.15,
        "strand_mm": 20.0,
        "comb_uN": 8.0,
        "samples": 64,
        "percentile": 0.95,
        "E_gpa": 3.5,
        "density_kg_m3": 1320.0,
        "beta_n": 0.45,
        "card_mix": 0.35,
    },
}


def _grey_fraction(age: int, ancestry: str) -> float:
    """A register prior: greying begins around 30 and rises with age."""
    base = min(0.50, max(0.0, (age - 30) * 0.010))
    if ancestry == "european":
        base = min(0.60, base * 1.15)
    return round(base, 4)


def _hair_person(style, master_seed, person, baseline, groom):
    register = HAIR_REGISTERS[style]
    ancestry = HAIR_ANCESTRY[person["ancestry"]]
    hold = register["groom_hold"] if groom else 0.0
    free_m = (register["strand_mm"] / 1000.0) * (1.0 - hold)
    force_n = register["comb_uN"] * 1e-6
    e_pa = register["E_gpa"] * 1e9
    rng = _rng(master_seed, "hair", person["name"])
    deviations = []
    for _ in range(register["samples"]):
        d_um = ancestry["d_um"] * math.exp(rng.gauss(0.0, HAIR_DIAMETER_SD))
        d_um = min(1.6 * ancestry["d_um"], max(0.6 * ancestry["d_um"], d_um))
        ell = ancestry["ell"] * math.exp(rng.gauss(0.0, HAIR_ELLIPTICITY_SD))
        ell = min(2.2, max(1.05, ell))
        radius_m = (d_um * 1e-6) / 2.0
        if baseline:
            second_moment = math.pi * radius_m ** 4 / 4.0
        else:
            a = radius_m * math.sqrt(ell)
            b = radius_m / math.sqrt(ell)
            second_moment = math.pi * a ** 3 * b / 4.0
        deviation_mm = force_n * free_m ** 3 / (3.0 * e_pa * second_moment) * 1000.0
        deviations.append(deviation_mm)
    deviations.sort()
    index = min(len(deviations) - 1, int(register["percentile"] * (len(deviations) - 1)))
    return {
        "name": person["name"],
        "ancestry": person["ancestry"],
        "d_um": ancestry["d_um"],
        "ellipticity": ancestry["ell"],
        "density_cm2": ancestry["density_cm2"],
        "growth_cm_month": ancestry["growth_cm_month"],
        "free_mm": round(free_m * 1000.0, 6),
        "groom_hold": hold,
        "mean_mm": round(sum(deviations) / len(deviations), 6),
        "p95_mm": round(deviations[index], 6),
        "max_mm": round(deviations[-1], 6),
        "samples": register["samples"],
        "section": "circular" if baseline else "elliptical-major",
    }


def hair_material(style: str, cast=None, baseline: bool = False, groom: bool = True):
    """Per-person fibre geometry and the mechanical register."""
    if style not in STYLES:
        raise ValueError("unknown style: " + str(style))
    cast = _check_cast(cast if cast is not None else cast_specs())
    register = HAIR_REGISTERS[style]
    rows = []
    for person in cast:
        ancestry = HAIR_ANCESTRY[person["ancestry"]]
        rows.append(
            {
                "name": person["name"],
                "ancestry": person["ancestry"],
                "d_um": ancestry["d_um"],
                "ellipticity": ancestry["ell"],
                "density_cm2": ancestry["density_cm2"],
                "growth_cm_month": ancestry["growth_cm_month"],
                "melanin": dict(person.get("melanin") or HAIR_MELANIN[person["ancestry"]]),
                "grey_fraction": person.get("grey", _grey_fraction(person["age"], person["ancestry"])),
            }
        )
    return {
        "register": "baseline" if baseline else style,
        "metric": "hair_deviation_mm",
        "groom": bool(groom),
        "groom_hold": register["groom_hold"] if groom else 0.0,
        "strand_mm": register["strand_mm"],
        "comb_uN": register["comb_uN"],
        "E_gpa": register["E_gpa"],
        "density_kg_m3": register["density_kg_m3"],
        "section": "circular" if baseline else "elliptical-major",
        "per_cast": rows,
    }


def hair_response(style: str, master_seed: str, cast=None, baseline: bool = False, groom: bool = True):
    """Worst-person mean fibre deflection over the cast (deterministic)."""
    if style not in STYLES:
        raise ValueError("unknown style: " + str(style))
    cast = _check_cast(cast if cast is not None else cast_specs())
    rows = [_hair_person(style, master_seed, person, baseline, groom) for person in cast]
    worst = max(rows, key=lambda row: row["mean_mm"])
    return {
        "register": "baseline" if baseline else style,
        "metric": "hair_deviation_mm",
        "groom": bool(groom),
        "worst": dict(worst),
        "per_cast": rows,
        "material": hair_material(style, cast, baseline, groom),
    }


def hair_shading(style: str, cast=None, baseline: bool = False):
    """The hair shading register: lobe shares, mass albedo, grey translucency."""
    if style not in STYLES:
        raise ValueError("unknown style: " + str(style))
    cast = _check_cast(cast if cast is not None else cast_specs())
    beta_n = HAIR_BETA_N if baseline else HAIR_REGISTERS[style]["beta_n"]
    card_mix = 1.0 if baseline else HAIR_REGISTERS[style]["card_mix"]
    rows = []
    for person in cast:
        melanin = person.get("melanin") or HAIR_MELANIN[person["ancestry"]]
        lobes = _hair_lobes(melanin["eu"], melanin["ph"], beta_n)
        white = _hair_lobes(HAIR_WHITE["eu"], HAIR_WHITE["ph"], beta_n)
        grey = person.get("grey", _grey_fraction(person["age"], person["ancestry"]))
        r = lobes["R"]
        tt = sum(lobes["TT"]) / 3.0
        trt = sum(lobes["TRT"]) / 3.0
        total = r + tt + trt
        backlit = (1.0 - card_mix) * tt / total
        sheen = (1.0 - card_mix) * r / total + card_mix * 0.075
        secondary = (1.0 - card_mix) * trt / total
        mass = lobes["mass_albedo"]
        mass_white = white["mass_albedo"]
        effective = [(1.0 - grey) * mass[c] + grey * mass_white[c] for c in range(3)]
        rows.append(
            {
                "name": person["name"],
                "ancestry": person["ancestry"],
                "grey_fraction": grey,
                "backlit_share": round(backlit, 6),
                "sheen_share": round(sheen, 6),
                "secondary_share": round(secondary, 6),
                "mass_albedo": [round(v, 6) for v in mass],
                "mass_albedo_white": [round(v, 6) for v in mass_white],
                "mass_albedo_effective": [round(v, 6) for v in effective],
                "energy_max": round(max(r + lobes["TT"][c] + lobes["TRT"][c] for c in range(3)), 6),
                "white_backlit_share": round(
                    (sum(white["TT"]) / 3.0) / (white["R"] + sum(white["TT"]) / 3.0 + sum(white["TRT"]) / 3.0), 6
                ),
            }
        )
    count = len(rows)
    return {
        "register": "baseline" if baseline else style,
        "beta_n": beta_n,
        "card_mix": card_mix,
        "baseline": {"backlit_share": 0.0, "sheen_share": 0.075, "translucent": False},
        "cast_mean": {
            "backlit_share": round(sum(r["backlit_share"] for r in rows) / count, 6),
            "sheen_share": round(sum(r["sheen_share"] for r in rows) / count, 6),
            "mass_albedo": [round(sum(r["mass_albedo"][c] for r in rows) / count, 6) for c in range(3)],
            "white_backlit_share": round(sum(r["white_backlit_share"] for r in rows) / count, 6),
        },
        "per_cast": rows,
    }


# --------------------------------------------------------------------------
# Evaluate / compare / registers
# --------------------------------------------------------------------------


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("spec must be a dict")
    style = spec.get("style")
    if style not in STYLES:
        raise ValueError("style must be photorealistic or stylized")
    seed = spec.get("master_seed", DEFAULT_MASTER_SEED)
    if not _is_hex(seed, 128):
        raise ValueError("master_seed must be 128 lowercase hex chars")
    groom = spec.get("groom", True)
    if not isinstance(groom, bool):
        raise ValueError("groom must be a bool")
    baseline = spec.get("baseline", False)
    if not isinstance(baseline, bool):
        raise ValueError("baseline must be a bool")
    cast = _check_cast(spec.get("cast", cast_specs()))
    source_commit = spec.get("source_commit", SOURCE_COMMIT)
    if not _is_hex(source_commit, 40):
        raise ValueError("source_commit must be 40 lowercase hex chars")
    return {
        "style": style,
        "master_seed": seed,
        "groom": groom,
        "baseline": baseline,
        "cast": cast,
        "source_commit": source_commit,
    }


def evaluate(spec):
    """Deterministic S3 metrics + material registers.  Launches no render."""
    spec = validate_spec(spec)
    hair = hair_response(spec["style"], spec["master_seed"], spec["cast"], spec["baseline"], spec["groom"])
    skin = skin_response(spec["style"], spec["master_seed"], spec["cast"], spec["baseline"])
    shading = hair_shading(spec["style"], spec["cast"], baseline=spec["baseline"])
    pins = [
        {"path": path, "sha256": sha, "source_commit": spec["source_commit"]}
        for path, sha in SOURCE_PINS
    ]
    out = {
        "version": VERSION,
        "style": spec["style"],
        "master_seed": spec["master_seed"],
        "source_commit": spec["source_commit"],
        "groom": spec["groom"],
        "baseline": spec["baseline"],
        "skin_stretch": skin["worst"]["p95"],
        "hair_deviation_mm": hair["worst"]["mean_mm"],
        "skin_specular_error": skin["material"]["specular_error"],
        "skin_transport_error_mm": skin["material"]["transport_error_mm"],
        "hair_backlit_share": shading["cast_mean"]["backlit_share"],
        "hair_mass_albedo": shading["cast_mean"]["mass_albedo"],
        "skin": skin,
        "hair": hair,
        "hair_shading": shading,
        "pins": pins,
        "render_launched": RENDER_LAUNCHED,
    }
    out["manifest_sha256"] = digest({k: v for k, v in out.items() if k != "manifest_sha256"})
    return out


def compare(baseline, candidate):
    """human_sim.compare-compatible subset over the metrics both carry."""
    if not isinstance(baseline, dict) or not isinstance(candidate, dict):
        raise ValueError("comparison requires result dicts")
    style = candidate.get("style")
    if style not in STYLES:
        raise ValueError("candidate style must be photorealistic or stylized")
    if baseline.get("style") != style:
        raise ValueError("comparison requires same style")
    limits = THRESHOLDS[style]
    checks, deltas = {}, {}
    for metric, (kind, limit) in limits.items():
        if metric not in baseline or metric not in candidate:
            continue
        value = candidate[metric]
        checks[metric] = (value <= limit) if kind == "max" else (value >= limit)
        deltas[metric] = round(value - baseline[metric], 6)
    if not checks:
        raise ValueError("no comparable skin/hair metrics")
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "deltas": deltas,
        "thresholds": {k: v[1] for k, v in limits.items() if k in checks},
        "style": candidate["style"],
        "metrics": sorted(checks),
    }


def material_registers(style: str, cast=None):
    """The actionable material values for both renderers."""
    if style not in STYLES:
        raise ValueError("unknown style: " + str(style))
    cast = _check_cast(cast if cast is not None else cast_specs())
    return {
        "version": VERSION,
        "style": style,
        "skin": skin_material(style, cast, baseline=False),
        "hair": hair_material(style, cast, baseline=False, groom=True),
        "hair_shading": hair_shading(style, cast),
        "baseline": {
            "skin": skin_material(style, cast, baseline=True),
            "hair": hair_material(style, cast, baseline=True, groom=True),
        },
    }


def check_no_render(plan):
    """Refuse anything that would launch a render; admission is the lead's."""
    if not isinstance(plan, dict):
        raise ValueError("plan must be a dict")
    if plan.get("render") not in (None, False):
        raise ValueError("skin/hair comparison launches no render; use human_sim.check_render_admission")
    for key in ("gpu_slots", "memory_bytes", "job_id", "render_request"):
        if key in plan and plan[key] not in (None, False):
            raise ValueError("render admission fields belong to the lead gate: " + key)
    return {"render_launched": False, "admitted": False, "reason": "CPU material comparison only"}


# --------------------------------------------------------------------------
# Source pins
# --------------------------------------------------------------------------


def validate_pins(pins):
    """pins: [{path, sha256(64hex), source_commit(40hex)}]; fail closed."""
    if not isinstance(pins, list) or not pins:
        raise ValueError("at least one source-pinned input is required")
    seen = set()
    for pin in pins:
        if not isinstance(pin, dict) or not pin.get("path") or pin["path"] in seen:
            raise ValueError("asset pin path missing or duplicated")
        seen.add(pin["path"])
        if not _is_hex(pin.get("sha256", ""), 64):
            raise ValueError("asset pin sha256 must be 64 lowercase hex: " + str(pin.get("path")))
        if not _is_hex(pin.get("source_commit", ""), 40):
            raise ValueError("asset pin source_commit must be 40 lowercase hex: " + str(pin.get("path")))
    return pins


def _read_source(root: Path, commit: str, path: str) -> bytes:
    local = root / path
    if not (root / ".git").exists():
        if local.is_file():
            return local.read_bytes()
        raise ValueError("pinned source not readable without a git checkout: " + path)
    result = subprocess.run(
        ["git", "-C", str(root), "show", commit + ":" + path],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise ValueError(
            "pinned source not readable: "
            + path
            + " ("
            + result.stderr.decode(errors="replace").strip().splitlines()[-1]
            + ")"
        )
    if local.is_file() and local.read_bytes() != result.stdout:
        raise ValueError("local source differs from pinned commit: " + path)
    return result.stdout


def pins(source_root=None, commit: str = SOURCE_COMMIT):
    """Re-read every pinned source and verify its SHA-256; fail closed."""
    if not _is_hex(commit, 40):
        raise ValueError("commit must be 40 lowercase hex chars")
    root = Path(source_root) if source_root else Path(__file__).resolve().parents[2]
    result = []
    for path, expected in SOURCE_PINS:
        data = _read_source(root, commit, path)
        actual = hashlib.sha256(data).hexdigest()
        if actual != expected:
            raise ValueError("pinned source hash changed: " + path + " expected " + expected + " got " + actual)
        result.append({"path": path, "sha256": actual, "source_commit": commit})
    return validate_pins(result)
