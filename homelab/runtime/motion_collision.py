"""Deterministic motion/rig/collision preflight for ACP issue #87.

CPU-only: reads the vendored CMU BVH takes, the actual rig tables
(``rig/limits.js``, ``rig/balance.js``) and the cloth contact constants
(``cloth8/contact8.js``, ``cloth9/settle9.js``), then reports measurable
motion quantities for photorealistic and stylized renders.  It launches no
render and changes no other owner's files.

Seed qualities used: the 512-bit master seed carries high-entropy detail in a
stable frame (same seed + spec -> same report), and every subsystem gets a
deterministic offset from it (``derive_seed``).  The seed therefore chooses the
representative CMU takes reproducibly; it never fabricates a metric.  All
metrics come from the pinned BVH frames and the pinned rig/cloth constants.

The cloth check is an envelope preflight, not a cloth solve: the minimum
capsule clearance between non-adjacent body segments must stay above the cloth
solver's own rest stand-off.  If it does not, no cloth can lie at rest without
being lifted, and the cloth/contact owner has to solve that frame.

FootPlant ownership is explicit but audit-scoped.  The take floor is the
constant floor from ``bvh.js``/``_take_geometry`` (0 after normalisation), not
a moving per-frame foot height.  Stance feet are pinned by an audit contact
detector patterned after ``rig/ground.js``; it is not a byte-for-byte mirror:
the audit adds a two-frame confirmation and a 25 mm horizontal slip release to
reject raw-BVH swing false contacts, while the runtime owner uses 28 mm/50 mm
plant/lift thresholds and a release blend.  Both sets are reported.  The
requested 45 mm stance is capped at 40 mm of actual shift.  The report records
the achieved stance, not the request: on 02_01 the mean is 36.22 mm and the
max 40.00 mm.  A 150 mm cap gives zero foot slide but pushes 12_01 limb-flex
excess above the photoreal 10 deg bound; 40 mm is the largest cap that keeps
the core set passing.  A swing-leg guard then moves only the unplanted leg
outward until the leg capsule pairs separate; it never moves a planted foot.
The guard is audit-only: it reports its maximum frame-to-frame shift change
and does not establish temporal continuity.  ``footplant=false`` reproduces the
raw clip and the lead's before numbers.
"""
import argparse
import csv
import hashlib
import json
import math
import re
import statistics
import sys
from pathlib import Path

VERSION = "motion-collision-preflight-v3"
ISSUE87_SEED = (
    "cbddeb6e385538d8aea2148927c0e0e15be5dfc9de01efb1046bd782f0c8bbbce8419bce63ef7d71abcb062cd241dbec6c108c31a92a82728f1b2fdcff76b114"
)
PINNED_SOURCE_COMMIT = "e235ca432f1514842da8e99ec28addf77c99b2d4"
SUBSYSTEMS = ("motion", "rig", "collision", "contact")
STYLES = ("photorealistic", "stylized")
REPO_ROOT = Path(__file__).resolve().parents[2]
MOCAP_DIR = REPO_ROOT / "videos/sources/mocap"
MOCAP_SOURCES = MOCAP_DIR / "SOURCES.csv"

# Files whose actual bytes back the rig/cloth constants used below.  They are
# read and hashed at audit time; a missing or changed source fails closed.
SOURCE_PATHS = (
    "videos/web/lib/fx/bvh.js",
    "videos/web/lib/fx/rig/ground.js",
    "videos/web/lib/fx/rig/balance.js",
    "videos/web/lib/fx/rig/limits.js",
    "videos/web/lib/fx/cloth/cloth8/contact8.js",
    "videos/web/lib/fx/cloth/cloth9/settle9.js",
    "videos/sources/mocap/SOURCES.csv",
)

# Conservative contact envelopes for a clothed adult limb (metres).  These are
# preflight envelopes, not anatomy measurements; the values can be overridden
# per call through spec["capsule_radii_m"].
DEFAULT_CAPSULE_RADII_M = {
    "trunk": 0.120,
    "thigh": 0.070,
    "shin": 0.042,
    "foot": 0.030,
    "uarm": 0.040,
    "farm": 0.032,
    "hand": 0.025,
}

# Non-adjacent segment pairs that can pinch cloth in locomotion.  Adjacent
# pairs (a segment and its parent) are excluded because they touch by design.
CONTACT_PAIRS = (
    ("thighL", "thighR"),
    ("shinL", "shinR"),
    ("footL", "footR"),
    ("farmL", "trunk"),
    ("farmR", "trunk"),
    ("handL", "trunk"),
    ("handR", "trunk"),
    ("farmL", "thighR"),
    ("farmR", "thighL"),
    ("handL", "thighR"),
    ("handR", "thighL"),
    ("uarmL", "uarmR"),
    ("farmL", "farmR"),
    ("handL", "handR"),
    ("shinL", "trunk"),
    ("shinR", "trunk"),
    ("shinL", "thighR"),
    ("shinR", "thighL"),
    ("footL", "shinR"),
    ("footR", "shinL"),
)

LEG_SEGMENT_JOINTS = {
    "thighL": ("LeftUpLeg", "LeftLeg"),
    "thighR": ("RightUpLeg", "RightLeg"),
    "shinL": ("LeftLeg", "LeftFoot"),
    "shinR": ("RightLeg", "RightFoot"),
    "footL": ("LeftFoot", "LeftToeBase"),
    "footR": ("RightFoot", "RightToeBase"),
}
LEG_GUARD_PAIRS = tuple(
    pair for pair in CONTACT_PAIRS
    if pair[0] in LEG_SEGMENT_JOINTS and pair[1] in LEG_SEGMENT_JOINTS
    and pair[0][-1] != pair[1][-1]
)
MAX_FOOTPLANT_CORRECTION_M = 0.040

# Hysteresis contact detector, after rig/ground.js.  The two-frame
# confirmation and the horizontal-slip release reject a swing foot that passes
# within one frame of the current ground plane.
PLANT_H_M = 0.010
TAKE_FLOOR_M = 0.0
RUNTIME_PLANT_H_M = 0.028
RUNTIME_LIFT_H_M = 0.050
RUNTIME_BLEND_S = 0.11
LIFT_H_M = 0.035
HEEL_TOE_HYSTERESIS_M = 0.012
SLIP_RELEASE_M = 0.025
PLANT_CONFIRM_FRAMES = 2
DEFAULT_STANCE_M = 0.045
MAX_GUARD_SHIFT_M = 0.060
GUARD_MARGIN_M = 0.001
GUARD_ITERATIONS = 4

# Preflight limits, not aesthetic gates.  photorealistic is the tighter
# physical-coherence bound; stylized preserves the same checks with looser
# excursion budgets for deliberately exaggerated motion.  The values were
# calibrated against the vendored CMU walk/march takes at the pinned head and
# are recorded again in the generated report.
MOTION_THRESHOLDS = {
    "photorealistic": {
        "foot_slide_mm": ("max", 25.0),
        "foot_drift_mm": ("max", 100.0),
        "com_support_margin_p05_mm": ("min", -20.0),
        "limb_flex_excess_deg": ("max", 10.0),
        "body_self_clearance_mm": ("min", -25.0),
        "cloth_contact_penetration_mm": ("max", 26.5),
        "cloth_layer_penetration_mm": ("max", 29.0),
        "rig_bone_length_drift_mm": ("max", 0.01),
    },
    "stylized": {
        "foot_slide_mm": ("max", 50.0),
        "foot_drift_mm": ("max", 200.0),
        "com_support_margin_p05_mm": ("min", -150.0),
        "limb_flex_excess_deg": ("max", 30.0),
        "body_self_clearance_mm": ("min", -50.0),
        "cloth_contact_penetration_mm": ("max", 51.5),
        "cloth_layer_penetration_mm": ("max", 54.0),
        "rig_bone_length_drift_mm": ("max", 0.05),
    },
}

# Joint-limit measurements: measured name -> (limits.js name, mode).
# "signed" uses the rig's flex sign; "unsigned" is the absolute joint angle.
JOINT_LIMIT_MAP = {
    "knee": ("shin", "signed"),
    "elbow": ("forearm", "unsigned"),
    "hip": ("thigh", "signed"),
    "shoulder": ("upperarm", "signed"),
}


# --------------------------------------------------------------------------
# validation and seed derivation


def _is_hex(value, length):
    if not isinstance(value, str) or len(value) != length:
        return False
    return value == value.lower() and all(c in "0123456789abcdef" for c in value)


def derive_seed(master_seed, subsystem):
    """Deterministic 64-bit subsystem seed from the 512-bit master seed."""
    if not _is_hex(master_seed, 128):
        raise ValueError("master_seed must be 128 lowercase hex chars (512-bit)")
    if subsystem not in SUBSYSTEMS:
        raise ValueError("unknown subsystem: %r" % (subsystem,))
    digest = hashlib.sha256(bytes.fromhex(master_seed) + b":" + subsystem.encode()).digest()
    return int.from_bytes(digest[:8], "big")


def _validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("spec must be a dict")
    style = spec.get("style")
    if style not in STYLES:
        raise ValueError("style must be photorealistic or stylized")
    seed = spec.get("master_seed", ISSUE87_SEED)
    if not _is_hex(seed, 128):
        raise ValueError("master_seed must be 128 lowercase hex chars (512-bit)")
    commit = spec.get("source_commit", PINNED_SOURCE_COMMIT)
    if not _is_hex(commit, 40):
        raise ValueError("source_commit must be 40 lowercase hex chars")
    count = spec.get("count", 3)
    if type(count) is not int or not 1 <= count <= 8:
        raise ValueError("count must be an int in 1..8")
    takes = spec.get("takes")
    if takes is not None and (not isinstance(takes, list) or not takes
                              or any(not isinstance(t, str) or not t for t in takes)):
        raise ValueError("takes must be a non-empty list of take names or paths")
    radii = spec.get("capsule_radii_m", DEFAULT_CAPSULE_RADII_M)
    if not isinstance(radii, dict) or not radii:
        raise ValueError("capsule_radii_m must be a non-empty dict")
    for name, value in radii.items():
        if not isinstance(name, str) or not name:
            raise ValueError("capsule radius names must be strings")
        if not isinstance(value, (int, float)) or value <= 0 or value > 0.5:
            raise ValueError("capsule radius must be in (0, 0.5] m: " + name)
    assets = spec.get("assets", [])
    if not isinstance(assets, list):
        raise ValueError("assets must be a list")
    for asset in assets:
        if not isinstance(asset, dict) or not asset.get("path"):
            raise ValueError("asset pin path is required")
        if not _is_hex(asset.get("sha256"), 64):
            raise ValueError("asset pin sha256 must be 64 lowercase hex: " + str(asset.get("path")))
        if not _is_hex(asset.get("source_commit"), 40):
            raise ValueError("asset pin source_commit must be 40 lowercase hex: " + str(asset.get("path")))
    footplant = spec.get("footplant", True)
    if type(footplant) is not bool:
        raise ValueError("footplant must be a bool")
    stance_m = spec.get("stance_m", DEFAULT_STANCE_M)
    if (not isinstance(stance_m, (int, float)) or isinstance(stance_m, bool)
            or not 0.0 <= float(stance_m) <= 0.15):
        raise ValueError("stance_m must be a number in 0..0.15 m")
    collision_guard = spec.get("collision_guard", True)
    if type(collision_guard) is not bool:
        raise ValueError("collision_guard must be a bool")
    if not footplant:
        collision_guard = False
    footplant_cap_m = spec.get("footplant_cap_m", MAX_FOOTPLANT_CORRECTION_M)
    if (not isinstance(footplant_cap_m, (int, float))
            or isinstance(footplant_cap_m, bool)
            or not 0.0 <= float(footplant_cap_m) <= 0.15):
        raise ValueError("footplant_cap_m must be a number in 0..0.15 m")
    return dict(spec, style=style, master_seed=seed, source_commit=commit,
                count=count, capsule_radii_m=dict(radii), assets=assets,
                footplant=footplant, stance_m=float(stance_m),
                collision_guard=collision_guard,
                footplant_cap_m=float(footplant_cap_m))


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _source_pins(extra=()):
    pins = []
    for relative in (*SOURCE_PATHS, *extra):
        path = Path(relative)
        if not path.is_absolute():
            path = REPO_ROOT / path
        if not path.is_file():
            raise ValueError("pinned source is missing: " + str(path))
        pins.append({"path": str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path),
                     "sha256": _sha256_file(path)})
    return pins


# --------------------------------------------------------------------------
# JS source tables (read-only; the rig and cloth owners keep ownership)


def _balanced(text, marker, open_char="{", close_char="}"):
    start = text.find(marker)
    if start < 0:
        raise ValueError("source block not found: " + marker)
    start += len(marker)
    depth = 1
    for index in range(start, len(text)):
        char = text[index]
        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return text[start:index]
    raise ValueError("unclosed source block: " + marker)


def load_limits():
    """Parse the static LIMITS table from rig/limits.js."""
    path = REPO_ROOT / "videos/web/lib/fx/rig/limits.js"
    text = path.read_text()
    block = _balanced(text, "export const LIMITS = {")
    pattern = re.compile(
        r"(\w+):\s*\{[^}]*flex:\s*\[(-?\d+),\s*(-?\d+)\][^}]*"
        r"abd:\s*\[(-?\d+),\s*(-?\d+)\][^}]*twist:\s*\[(-?\d+),\s*(-?\d+)\]"
    )
    limits = {}
    for name, flex0, flex1, abd0, abd1, twist0, twist1 in pattern.findall(block):
        limits[name] = {
            "flex": [int(flex0), int(flex1)],
            "abd": [int(abd0), int(abd1)],
            "twist": [int(twist0), int(twist1)],
        }
    required = {"shin", "forearm", "thigh", "upperarm"}
    if not required.issubset(limits):
        raise ValueError("rig/limits.js did not yield the required joint ranges")
    return limits


def load_segments():
    """Parse the DEMPSTER segment table from rig/balance.js."""
    path = REPO_ROOT / "videos/web/lib/fx/rig/balance.js"
    text = path.read_text()
    block = _balanced(text, "export const SEGMENTS = [", "[", "]")
    pattern = re.compile(
        r"\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\]"
    )
    segments = [
        {"name": name, "a": a, "b": b, "mass": float(mass), "com": float(com)}
        for name, a, b, mass, com in pattern.findall(block)
    ]
    if len(segments) != 14:
        raise ValueError("rig/balance.js SEGMENTS did not yield 14 segments")
    total = sum(segment["mass"] for segment in segments)
    if abs(total - 1.0) > 1e-6:
        raise ValueError("rig/balance.js segment masses do not sum to 1")
    return segments


def load_cloth_constants():
    """Read the cloth/body rest stand-offs both cloth owners use."""
    contact = (REPO_ROOT / "videos/web/lib/fx/cloth/cloth8/contact8.js").read_text()
    contact_block = _balanced(contact, "export const CONTACT8_DEFAULT = {")
    floor = re.search(r"floor:\s*([0-9.]+)", contact_block)
    if not floor:
        raise ValueError("cloth8/contact8.js has no CONTACT8_DEFAULT.floor")
    settle = (REPO_ROOT / "videos/web/lib/fx/cloth/cloth9/settle9.js").read_text()
    settle_block = _balanced(settle, "export const SETTLE9 = {")
    gap = re.search(r"gap:\s*([0-9.]+)", settle_block)
    layer_gap = re.search(r"layerGap:\s*([0-9.]+)", settle_block)
    if not gap:
        raise ValueError("cloth9/settle9.js has no SETTLE9.gap")
    return {
        "contact8_floor_m": float(floor.group(1)),
        "settle9_gap_m": float(gap.group(1)),
        "settle9_layer_gap_m": float(layer_gap.group(1)) if layer_gap else None,
    }


# --------------------------------------------------------------------------
# vector and quaternion helpers (pure Python; no numpy dependency)


class V(tuple):
    def __new__(cls, x=0.0, y=0.0, z=0.0):
        return tuple.__new__(cls, (float(x), float(y), float(z)))

    def __add__(self, other):
        return V(self[0] + other[0], self[1] + other[1], self[2] + other[2])

    def __sub__(self, other):
        return V(self[0] - other[0], self[1] - other[1], self[2] - other[2])

    def __mul__(self, scalar):
        return V(self[0] * scalar, self[1] * scalar, self[2] * scalar)

    __rmul__ = __mul__

    def dot(self, other):
        return self[0] * other[0] + self[1] * other[1] + self[2] * other[2]

    def cross(self, other):
        return V(self[1] * other[2] - self[2] * other[1],
                 self[2] * other[0] - self[0] * other[2],
                 self[0] * other[1] - self[1] * other[0])

    def length(self):
        return math.sqrt(self.dot(self))

    def normalized(self):
        length = self.length()
        return V(0.0, 0.0, 0.0) if length < 1e-12 else self * (1.0 / length)


class Q(tuple):
    def __new__(cls, w=1.0, x=0.0, y=0.0, z=0.0):
        return tuple.__new__(cls, (float(w), float(x), float(y), float(z)))

    def __mul__(self, other):
        w1, x1, y1, z1 = self
        w2, x2, y2, z2 = other
        return Q(w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
                 w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                 w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                 w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2)

    def conjugate(self):
        return Q(self[0], -self[1], -self[2], -self[3])

    def normalized(self):
        length = math.sqrt(sum(value * value for value in self))
        return Q(1.0, 0.0, 0.0, 0.0) if length < 1e-12 else Q(*(value / length for value in self))

    def rotate(self, vector):
        result = self * Q(0.0, vector[0], vector[1], vector[2]) * self.conjugate()
        return V(result[1], result[2], result[3])


def _axis_angle(axis, angle):
    half = angle * 0.5
    sine = math.sin(half)
    return Q(math.cos(half), axis[0] * sine, axis[1] * sine, axis[2] * sine)


def _yaw_quaternion(angle):
    return _axis_angle(V(0.0, 1.0, 0.0), angle)


_AXES = {"Xrotation": V(1.0, 0.0, 0.0),
         "Yrotation": V(0.0, 1.0, 0.0),
         "Zrotation": V(0.0, 0.0, 1.0)}
_DEG = math.pi / 180.0


# --------------------------------------------------------------------------
# BVH parsing and forward kinematics (the same frames bvh.js consumes)


def parse_bvh(path):
    tokens = Path(path).read_text().split()
    index = 0
    joints = []
    channel_count = 0

    if tokens[index] != "HIERARCHY":
        raise ValueError("bvh: no HIERARCHY: " + str(path))
    index += 1
    if tokens[index] != "ROOT":
        raise ValueError("bvh: no ROOT: " + str(path))
    index += 1

    def read_joint(parent, end=False, name=None):
        nonlocal index, channel_count
        if name is None:
            name = tokens[index]
            index += 1
        joint = {"name": name, "parent": parent, "offset": V(),
                 "channels": [], "ch0": channel_count, "end": end, "children": []}
        joint_id = len(joints)
        joints.append(joint)
        if parent >= 0:
            joints[parent]["children"].append(joint_id)
        if tokens[index] != "{":
            raise ValueError("bvh: expected { after " + name)
        index += 1
        while tokens[index] != "}":
            token = tokens[index]
            index += 1
            if token == "OFFSET":
                joint["offset"] = V(float(tokens[index]), float(tokens[index + 1]), float(tokens[index + 2]))
                index += 3
            elif token == "CHANNELS":
                count = int(tokens[index])
                index += 1
                for _ in range(count):
                    joint["channels"].append(tokens[index])
                    index += 1
                channel_count += count
            elif token == "JOINT":
                read_joint(joint_id)
            elif token == "End":
                if tokens[index] != "Site":
                    raise ValueError("bvh: expected End Site")
                index += 1
                read_joint(joint_id, True, name + "_end")
            else:
                raise ValueError("bvh: unexpected token " + token)
        index += 1

    read_joint(-1)
    if tokens[index] != "MOTION":
        raise ValueError("bvh: no MOTION")
    index += 1
    if tokens[index] != "Frames:":
        raise ValueError("bvh: no Frames:")
    index += 1
    frame_count = int(tokens[index])
    index += 1
    if tokens[index] != "Frame" or tokens[index + 1] != "Time:":
        raise ValueError("bvh: no Frame Time:")
    index += 2
    frame_time = float(tokens[index])
    index += 1
    values = [float(value) for value in tokens[index:index + frame_count * channel_count]]
    if len(values) != frame_count * channel_count:
        raise ValueError("bvh: frame/channel count mismatch")
    return {
        "path": Path(path),
        "joints": joints,
        "channel_count": channel_count,
        "frame_count": frame_count,
        "frame_time": frame_time,
        "values": values,
        "by_name": {joint["name"]: number for number, joint in enumerate(joints)},
    }


def forward_kinematics(bvh):
    joint_count = len(bvh["joints"])
    frame_count = bvh["frame_count"]
    channel_count = bvh["channel_count"]
    values = bvh["values"]
    rotations = [[Q() for _ in range(joint_count)] for _ in range(frame_count)]
    positions = [[V() for _ in range(joint_count)] for _ in range(frame_count)]
    for frame in range(frame_count):
        row = values[frame * channel_count:(frame + 1) * channel_count]
        for joint_id, joint in enumerate(bvh["joints"]):
            rotation = Q()
            offset = V(*joint["offset"])
            for channel_index, channel in enumerate(joint["channels"]):
                value = row[joint["ch0"] + channel_index]
                if channel == "Xposition":
                    offset = V(offset[0] + value, offset[1], offset[2])
                elif channel == "Yposition":
                    offset = V(offset[0], offset[1] + value, offset[2])
                elif channel == "Zposition":
                    offset = V(offset[0], offset[1], offset[2] + value)
                else:
                    rotation = rotation * _axis_angle(_AXES[channel], value * _DEG)
            parent = joint["parent"]
            if parent < 0:
                rotations[frame][joint_id] = rotation.normalized()
                positions[frame][joint_id] = offset
            else:
                rotations[frame][joint_id] = (rotations[frame][parent] * rotation).normalized()
                positions[frame][joint_id] = positions[frame][parent] + rotations[frame][parent].rotate(offset)
    return rotations, positions


# --------------------------------------------------------------------------
# take geometry and measurement helpers


REQUIRED_JOINTS = (
    "Hips", "Neck", "Head_end", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftFingerBase", "RightArm", "RightForeArm", "RightHand", "RightFingerBase",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "Spine1",
)
JOINT_ALIASES = {
    "neck": "Neck", "headTop": "Head_end", "hips": "Hips",
    "shL": "LeftArm", "elL": "LeftForeArm", "wrL": "LeftHand", "fiL": "LeftFingerBase",
    "shR": "RightArm", "elR": "RightForeArm", "wrR": "RightHand", "fiR": "RightFingerBase",
    "hipL": "LeftUpLeg", "knL": "LeftLeg", "anL": "LeftFoot", "toL": "LeftToeBase",
    "hipR": "RightUpLeg", "knR": "RightLeg", "anR": "RightFoot", "toR": "RightToeBase",
}


def _require_joints(bvh, path):
    missing = [name for name in REQUIRED_JOINTS if name not in bvh["by_name"]]
    if missing:
        raise ValueError("%s: missing required joints %s" % (path, ", ".join(missing)))


def _take_geometry(bvh, rotations, positions):
    by_name = bvh["by_name"]
    frame_count = bvh["frame_count"]
    first = 1 if frame_count > 1 else 0

    def raw_position(frame, name):
        return positions[frame][by_name[name]]

    leg_length = ((raw_position(0, "LeftUpLeg") - raw_position(0, "LeftLeg")).length()
                  + (raw_position(0, "LeftLeg") - raw_position(0, "LeftFoot")).length())
    if leg_length <= 1e-9:
        raise ValueError("bvh: degenerate leg length")
    unit = 0.84 / leg_length
    foot_names = ("LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase")
    floor = min(raw_position(frame, name)[1]
                for frame in range(first, frame_count)
                for name in foot_names)
    hips0 = raw_position(first, "Hips")
    hips1 = raw_position(frame_count - 1, "Hips")
    dx = hips1[0] - hips0[0]
    dz = hips1[2] - hips0[2]
    if math.hypot(dx, dz) > 0.2 / unit:
        yaw = math.atan2(dx, dz)
    else:
        side = raw_position(first, "LeftUpLeg") - raw_position(first, "RightUpLeg")
        facing = V(side[2], 0.0, -side[0]).normalized() * -1.0
        yaw = math.atan2(facing[0], facing[2])
    cos_yaw, sin_yaw = math.cos(-yaw), math.sin(-yaw)

    def position(frame, name):
        raw = raw_position(frame, name)
        x = raw[0] - hips0[0]
        y = raw[1] - floor
        z = raw[2] - hips0[2]
        return V((x * cos_yaw + z * sin_yaw) * unit,
                 y * unit,
                 (-x * sin_yaw + z * cos_yaw) * unit)

    return {
        "unit": unit,
        "floor": floor,
        "yaw": yaw,
        "position": position,
        "rotation": lambda frame, name: _yaw_quaternion(-yaw) * rotations[frame][by_name[name]],
        "first": first,
        "last": frame_count - 1,
        "duration": max(0.0, (frame_count - first) * bvh["frame_time"]),
    }


def _lowest_foot(geometry, frame, side):
    position = geometry["position"]
    return min(position(frame, side + "Foot")[1], position(frame, side + "ToeBase")[1])


def _ground_height(geometry, frame):
    """The take floor is constant after _take_geometry normalisation."""
    return TAKE_FLOOR_M


def _signed_angle(first, second, lateral):
    a = first.normalized()
    b = second.normalized()
    return math.atan2(a.cross(b).dot(lateral), max(-1.0, min(1.0, a.dot(b)))) / _DEG


def _unsigned_angle(first, second):
    a = first.normalized()
    b = second.normalized()
    return math.acos(max(-1.0, min(1.0, a.dot(b)))) / _DEG


def _segment_distance(a, b, c, d):
    u = b - a
    v = d - c
    w = a - c
    aa = u.dot(u)
    bb = u.dot(v)
    cc = v.dot(v)
    dd = u.dot(w)
    ee = v.dot(w)
    denominator = aa * cc - bb * bb

    def clamp(value):
        return max(0.0, min(1.0, value))

    s = clamp((bb * ee - cc * dd) / denominator) if abs(denominator) > 1e-12 else 0.0
    t = (bb * s + ee) / cc if cc > 1e-12 else 0.0
    if t < 0.0:
        t = 0.0
        s = clamp(-dd / aa) if aa > 1e-12 else 0.0
    elif t > 1.0:
        t = 1.0
        s = clamp((bb - dd) / aa) if aa > 1e-12 else 0.0
    return (a + u * s - (c + v * t)).length()


def _convex_hull(points):
    unique = sorted(set((round(x, 9), round(z, 9)) for x, z in points))
    if len(unique) <= 2:
        return unique

    def cross(origin, a, b):
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])

    lower = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _inside_distance(polygon, x, z):
    """Signed distance to the convex hull: negative inside, positive outside."""
    inside = True
    minimum = float("inf")
    count = len(polygon)
    for index in range(count):
        a = polygon[index]
        b = polygon[(index + 1) % count]
        ex = b[0] - a[0]
        ez = b[1] - a[1]
        px = x - a[0]
        pz = z - a[1]
        cross = ex * pz - ez * px
        if cross < 0:
            inside = False
        length_sq = ex * ex + ez * ez
        t = max(0.0, min(1.0, (px * ex + pz * ez) / length_sq)) if length_sq else 0.0
        minimum = min(minimum, math.hypot(px - t * ex, pz - t * ez))
    return -minimum if inside else minimum


class FootPlant:
    """Audit contact detector, not the runtime owner's FootPlant.

    It follows the rig/ground.js contact/pin/heel-toe shape but adds a
    two-frame confirmation and a horizontal slip release for raw BVH clips;
    the runtime owner uses 28/50 mm thresholds and a release blend.  The audit
    uses these states twice: on the raw clip and to pin stance feet before
    collision/cloth clearance is measured.  The class name is kept for the
    report key; the constants in ``constants`` record both models.
    """

    def __init__(self, plant_h=PLANT_H_M, lift_h=LIFT_H_M,
                 hysteresis=HEEL_TOE_HYSTERESIS_M, slip_release=SLIP_RELEASE_M,
                 confirm_frames=PLANT_CONFIRM_FRAMES):
        self.plant_h = plant_h
        self.lift_h = lift_h
        self.hysteresis = hysteresis
        self.slip_release = slip_release
        self.confirm_frames = confirm_frames
        self.reset()

    def reset(self):
        self.planted = False
        self.cp = None
        self.previous = None
        self.pin = None
        self.confirm = 0
        self.just_planted = False
        self.just_released = False
        self.slide_mm = None
        self.drift_mm = None
        self.contact_float_mm = None

    def _release(self):
        self.planted = False
        self.cp = None
        self.previous = None
        self.pin = None
        self.confirm = 0
        self.just_released = True

    def state(self):
        state = {
            "planted": self.planted,
            "cp": self.cp,
            "pin": self.pin,
            "just_planted": self.just_planted,
            "just_released": self.just_released,
        }
        if self.slide_mm is not None:
            state["foot_slide_mm"] = self.slide_mm
            state["foot_drift_mm"] = self.drift_mm
            state["contact_float_mm"] = self.contact_float_mm
        return state

    def update(self, heel, toe, floor):
        self.just_planted = False
        self.just_released = False
        self.slide_mm = self.drift_mm = self.contact_float_mm = None
        height_heel = heel[1] - floor
        height_toe = toe[1] - floor
        minimum = min(height_heel, height_toe)
        if not self.planted:
            if minimum < self.plant_h:
                self.confirm += 1
                if self.confirm >= self.confirm_frames:
                    self.planted = True
                    self.just_planted = True
                    self.cp = "H" if height_heel <= height_toe else "T"
                    point = heel if self.cp == "H" else toe
                    self.pin = (point[0], point[2])
                    self.previous = self.pin
                    self.confirm = 0
            else:
                self.confirm = 0
            return self.state()
        current = heel if self.cp == "H" else toe
        if (self.previous is not None
                and math.hypot(current[0] - self.previous[0],
                               current[2] - self.previous[1]) > self.slip_release):
            self._release()
            return self.state()
        if minimum > self.lift_h:
            self._release()
            return self.state()
        wanted = ("H" if height_heel < height_toe - self.hysteresis
                  else "T" if height_toe < height_heel - self.hysteresis
                  else self.cp)
        if wanted != self.cp:
            old = heel if self.cp == "H" else toe
            self.cp = wanted
            current = heel if self.cp == "H" else toe
            if self.pin is not None:
                self.pin = (self.pin[0] + current[0] - old[0],
                            self.pin[1] + current[2] - old[2])
            self.previous = (current[0], current[2])
            return self.state()
        self.slide_mm = math.hypot(current[0] - self.previous[0],
                                   current[2] - self.previous[1]) * 1000.0
        self.drift_mm = math.hypot(current[0] - self.pin[0],
                                   current[2] - self.pin[1]) * 1000.0
        self.contact_float_mm = minimum * 1000.0
        self.previous = (current[0], current[2])
        return self.state()


def _contact_stats(geometry):
    """Foot contact, slide, drift and float from the take's own foot heights."""
    first, last = geometry["first"], geometry["last"]
    results = {}
    states = {}
    for side in ("Left", "Right"):
        plant = FootPlant()
        frame_states = {}
        slide_max = 0.0
        drift_max = 0.0
        float_max = 0.0
        planted_frames = 0
        slide_sum = 0.0
        slide_count = 0
        for frame in range(first, last + 1):
            heel = geometry["position"](frame, side + "Foot")
            toe = geometry["position"](frame, side + "ToeBase")
            state = plant.update(heel, toe, TAKE_FLOOR_M)
            frame_states[frame] = state
            if state.get("foot_slide_mm") is not None:
                slide = state["foot_slide_mm"]
                slide_max = max(slide_max, slide)
                drift_max = max(drift_max, state["foot_drift_mm"])
                float_max = max(float_max, state["contact_float_mm"])
                slide_sum += slide
                slide_count += 1
                planted_frames += 1
        results[side] = {
            "foot_slide_mm": slide_max,
            "foot_slide_mean_mm": slide_sum / slide_count if slide_count else 0.0,
            "foot_drift_mm": drift_max,
            "contact_float_mm": float_max,
            "planted_frames": planted_frames,
        }
        states[side] = frame_states
    foot_heights = [min(_lowest_foot(geometry, frame, "Left"),
                       _lowest_foot(geometry, frame, "Right"))
                    for frame in range(first, last + 1)]
    return {
        "feet": results,
        "floor": {"floor_m": TAKE_FLOOR_M,
                  "min_foot_mm": min(foot_heights) * 1000.0,
                  "max_foot_mm": max(foot_heights) * 1000.0,
                  "below_floor_mm": max(0.0, -min(foot_heights) * 1000.0)},
        "states": states,
    }


def _two_bone(hip, target, thigh, shin, pole):
    """Analytic two-bone IK; the ankle is reached, the knee takes the pole side."""
    delta = target - hip
    distance = delta.length()
    if distance < 1e-9:
        return hip, hip, distance
    axis = delta.normalized()
    maximum = thigh + shin
    minimum = abs(thigh - shin) + 1e-6
    reach = min(max(distance, minimum), maximum - 1e-6)
    cos_angle = (thigh * thigh + reach * reach - shin * shin) / (2.0 * thigh * reach)
    cos_angle = max(-1.0, min(1.0, cos_angle))
    sin_angle = math.sqrt(max(0.0, 1.0 - cos_angle * cos_angle))
    bend = pole - axis * pole.dot(axis)
    if bend.length() < 1e-9:
        bend = V(0.0, 0.0, 1.0) - axis * axis[2]
    if bend.length() < 1e-9:
        bend = V(1.0, 0.0, 0.0) - axis * axis[0]
    bend = bend.normalized()
    knee = hip + axis * (thigh * cos_angle) + bend * (thigh * sin_angle)
    ankle = hip + axis * reach
    return knee, ankle, (target - ankle).length()


def _correct_legs(geometry, states, stance_m=0.0,
                  max_correction_m=MAX_FOOTPLANT_CORRECTION_M):
    """Pin planted feet with the same FootPlant state and solve both legs.

    This is the audit's ownership of the scene correction: stance feet keep
    the pin from FootPlant, the knee/ankle are re-solved with fixed bone
    lengths, and the swing foot stays the animated one.  The returned stats
    say how far the pin moved the foot and how much of the pin the leg could
    not reach; nothing is hidden.
    """
    first, last = geometry["first"], geometry["last"]
    position = geometry["position"]
    lengths = {}
    for side in ("Left", "Right"):
        hip0 = position(0, side + "UpLeg")
        knee0 = position(0, side + "Leg")
        ankle0 = position(0, side + "Foot")
        lengths[side] = ((hip0 - knee0).length(), (knee0 - ankle0).length())
    corrected = {frame: {} for frame in range(first, last + 1)}
    max_correction = 0.0
    max_miss = 0.0
    corrected_frames = 0
    capped_frames = 0
    stance_achieved = []
    for frame in range(first, last + 1):
        for side in ("Left", "Right"):
            hip = position(frame, side + "UpLeg")
            knee = position(frame, side + "Leg")
            ankle = position(frame, side + "Foot")
            toe = position(frame, side + "ToeBase")
            state = states[side][frame]
            if state["planted"] and state["pin"] is not None:
                contact = ankle if state["cp"] == "H" else toe
                outward = stance_m if side == "Left" else -stance_m
                shift = V(state["pin"][0] + outward - contact[0], 0.0,
                          state["pin"][1] - contact[2])
                if shift.length() > max_correction_m:
                    shift = shift.normalized() * max_correction_m
                    capped_frames += 1
                stance_achieved.append(shift[0] * (1.0 if side == "Left" else -1.0) * 1000.0)
                target = ankle + shift
                axis = target - hip
                pole = knee - hip
                if axis.length() > 1e-9:
                    axis_unit = axis.normalized()
                    pole = pole - axis_unit * pole.dot(axis_unit)
                knee_c, ankle_c, miss = _two_bone(hip, target, lengths[side][0],
                                                  lengths[side][1], pole)
                toe_c = ankle_c + (toe - ankle)
                corrected[frame][side + "UpLeg"] = hip
                corrected[frame][side + "Leg"] = knee_c
                corrected[frame][side + "Foot"] = ankle_c
                corrected[frame][side + "ToeBase"] = toe_c
                max_correction = max(max_correction, shift.length() * 1000.0)
                max_miss = max(max_miss, miss * 1000.0)
                corrected_frames += 1
            else:
                corrected[frame][side + "UpLeg"] = hip
                corrected[frame][side + "Leg"] = knee
                corrected[frame][side + "Foot"] = ankle
                corrected[frame][side + "ToeBase"] = toe
    return corrected, {
        "enabled": True,
        "corrected_frames": corrected_frames,
        "capped_frames": capped_frames,
        "stance_mm": stance_m * 1000.0,
        "stance_achieved_mean_mm": (statistics.mean(stance_achieved) if stance_achieved else 0.0),
        "stance_achieved_max_mm": (max(stance_achieved) if stance_achieved else 0.0),
        "max_correction_cap_mm": max_correction_m * 1000.0,
        "max_correction_mm": max_correction,
        "max_ik_miss_mm": max_miss,
    }


def _corrected_geometry(geometry, corrected):
    def position(frame, name):
        return corrected.get(frame, {}).get(name, geometry["position"](frame, name))
    return dict(geometry, position=position)


def _leg_gap(corrected, frame, pair, radii):
    a_joint, b_joint = LEG_SEGMENT_JOINTS[pair[0]]
    c_joint, d_joint = LEG_SEGMENT_JOINTS[pair[1]]
    gap = (_segment_distance(corrected[frame][a_joint], corrected[frame][b_joint],
                             corrected[frame][c_joint], corrected[frame][d_joint])
           - _capsule_radius(pair[0], radii) - _capsule_radius(pair[1], radii))
    return gap


def _guard_legs(geometry, corrected, states, radii):
    """Keep the swing leg out of the stance leg after FootPlant.

    FootPlant owns the stance pin; this guard owns the swing leg's separation.
    It shifts only an unplanted foot outward along the hip line, re-solves that
    leg with fixed bone lengths, and reports the shift, IK miss and maximum
    frame-to-frame shift change.  Planted feet are never moved.  This is an
    audit-only separation pass: it does not establish temporal continuity for a
    scene that adopts it.
    """
    first, last = geometry["first"], geometry["last"]
    position = geometry["position"]
    lengths = {}
    for side in ("Left", "Right"):
        hip0 = position(0, side + "UpLeg")
        knee0 = position(0, side + "Leg")
        ankle0 = position(0, side + "Foot")
        lengths[side] = ((hip0 - knee0).length(), (knee0 - ankle0).length())
    max_shift = 0.0
    max_miss = 0.0
    max_delta = 0.0
    guarded_frames = 0
    previous_guard = {}
    for frame in range(first, last + 1):
        left_planted = states["Left"][frame]["planted"]
        right_planted = states["Right"][frame]["planted"]
        if left_planted != right_planted:
            swing = "Right" if left_planted else "Left"
        else:
            ground = _ground_height(geometry, frame)
            heights = {}
            for side in ("Left", "Right"):
                ankle = corrected[frame][side + "Foot"]
                toe = corrected[frame][side + "ToeBase"]
                heights[side] = min(ankle[1], toe[1]) - ground
            if abs(heights["Left"] - heights["Right"]) < 0.006:
                continue
            swing = max(heights, key=heights.get)
        if states[swing][frame]["planted"]:
            continue
        hip = position(frame, swing + "UpLeg")
        total_shift = 0.0
        for _ in range(GUARD_ITERATIONS):
            gaps = [(_leg_gap(corrected, frame, pair, radii), pair)
                    for pair in LEG_GUARD_PAIRS]
            minimum_gap, _ = min(gaps)
            if minimum_gap >= 0.0:
                break
            lateral = position(frame, "LeftUpLeg") - position(frame, "RightUpLeg")
            lateral = lateral.normalized() if lateral.length() > 1e-9 else V(1.0, 0.0, 0.0)
            outward = lateral if swing == "Left" else lateral * -1.0
            remaining = MAX_GUARD_SHIFT_M - total_shift
            shift_length = min(remaining, -minimum_gap + GUARD_MARGIN_M)
            if shift_length <= 1e-6:
                break
            shift = outward * shift_length
            ankle = corrected[frame][swing + "Foot"]
            toe = corrected[frame][swing + "ToeBase"]
            target = ankle + shift
            axis = target - hip
            if axis.length() > 1e-9:
                axis_unit = axis.normalized()
                pole = outward - axis_unit * outward.dot(axis_unit)
            else:
                pole = outward
            knee_c, ankle_c, miss = _two_bone(hip, target, lengths[swing][0],
                                              lengths[swing][1], pole)
            corrected[frame][swing + "Leg"] = knee_c
            corrected[frame][swing + "Foot"] = ankle_c
            corrected[frame][swing + "ToeBase"] = ankle_c + (toe - ankle)
            total_shift += shift_length
            max_shift = max(max_shift, total_shift * 1000.0)
            max_miss = max(max_miss, miss * 1000.0)
        if total_shift > 0.0:
            guarded_frames += 1
            shift_mm = total_shift * 1000.0
            previous = previous_guard.get(swing)
            if previous is not None and previous[0] == frame - 1:
                max_delta = max(max_delta, abs(shift_mm - previous[1]))
            previous_guard[swing] = (frame, shift_mm)
    return corrected, {
        "enabled": True,
        "audit_only": True,
        "guarded_frames": guarded_frames,
        "max_shift_mm": max_shift,
        "max_delta_mm": max_delta,
        "max_ik_miss_mm": max_miss,
    }


def _joint_limits(geometry, limits):
    first, last = geometry["first"], geometry["last"]
    rotations = geometry["rotation"]
    maximum = 0.0
    worst = None
    for frame in range(first, last + 1):
        pelvis = rotations(frame, "Hips")
        chest = rotations(frame, "Spine1")
        lateral = pelvis.rotate(V(1.0, 0.0, 0.0))
        down = pelvis.rotate(V(0.0, 1.0, 0.0)) * -1.0
        chest_lateral = chest.rotate(V(1.0, 0.0, 0.0))
        chest_down = chest.rotate(V(0.0, 1.0, 0.0)) * -1.0
        for side in ("Left", "Right"):
            hip = geometry["position"](frame, side + "UpLeg")
            knee = geometry["position"](frame, side + "Leg")
            ankle = geometry["position"](frame, side + "Foot")
            thigh = knee - hip
            shin = ankle - knee
            knee_flex = _signed_angle(thigh, shin, lateral)
            hip_flex = -_signed_angle(down, thigh, lateral)
            shoulder = geometry["position"](frame, side + "Arm")
            elbow = geometry["position"](frame, side + "ForeArm")
            wrist = geometry["position"](frame, side + "Hand")
            upper_arm = elbow - shoulder
            forearm = wrist - elbow
            elbow_angle = _unsigned_angle(upper_arm, forearm)
            shoulder_flex = -_signed_angle(chest_down, upper_arm, chest_lateral)
            values = {"knee": knee_flex, "elbow": elbow_angle,
                      "hip": hip_flex, "shoulder": shoulder_flex}
            for joint, value in values.items():
                limit_name, mode = JOINT_LIMIT_MAP[joint]
                flex = limits[limit_name]["flex"]
                if joint == "knee":
                    low, high = -flex[1], -flex[0]
                else:
                    low, high = flex[0], flex[1]
                excess = max(0.0, value - high, low - value)
                if excess > maximum:
                    maximum = excess
                    worst = {"joint": joint, "side": side, "frame": frame,
                             "value_deg": round(value, 4),
                             "allowed_deg": [low, high]}
    return {"limb_flex_excess_deg": maximum, "joint_limit_worst": worst}


def _percentile(values, percentile):
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * percentile / 100.0
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1.0 - weight) + ordered[upper] * weight


def _com_support(geometry, segments):
    first, last = geometry["first"], geometry["last"]

    def joints(frame):
        position = geometry["position"]
        values = {"hips": position(frame, "Hips"), "neck": position(frame, "Neck"),
                  "headTop": position(frame, "Head_end"),
                  "shoulderMid": (position(frame, "LeftArm") + position(frame, "RightArm")) * 0.5}
        for name in JOINT_ALIASES:
            if name not in ("hips", "neck", "headTop"):
                values[name] = position(frame, JOINT_ALIASES[name])
        return values

    # Gate balance only in double support.  In single support the centre of
    # mass may leave the footprint by design (dynamic walking); the contact
    # detector reports those frames but they are not a coherence fault.
    minimum = float("inf")
    margins = []
    support_frames = 0
    worst_frame = None
    for frame in range(first, last + 1):
        position = geometry["position"]
        feet = []
        ground = _ground_height(geometry, frame)
        for side in ("Left", "Right"):
            heel = position(frame, side + "Foot")
            toe = position(frame, side + "ToeBase")
            if min(heel[1], toe[1]) - ground < PLANT_H_M + 0.02:
                feet.append((heel, toe))
        if len(feet) < 2:
            continue
        points = [(point[0], point[2]) for foot in feet for point in foot]
        if len(points) < 3:
            continue
        polygon = _convex_hull(points)
        if len(polygon) < 3:
            continue
        values = joints(frame)
        centre = V()
        total = 0.0
        for segment in segments:
            a = values[segment["a"]]
            b = values[segment["b"]]
            centre = centre + (a + (b - a) * segment["com"]) * segment["mass"]
            total += segment["mass"]
        centre = centre * (1.0 / total)
        margin = -_inside_distance(polygon, centre[0], centre[2]) * 1000.0
        margins.append(margin)
        if margin < minimum:
            minimum = margin
            worst_frame = frame
        support_frames += 1
    return {
        "com_support_margin_mm": minimum if support_frames else None,
        "com_support_margin_p05_mm": _percentile(margins, 5.0),
        "com_support_margin_median_mm": _percentile(margins, 50.0),
        "com_support_frames": support_frames,
        "com_worst_frame": worst_frame,
    }


def _capsule_radius(segment_name, radii):
    if segment_name in radii:
        return float(radii[segment_name])
    base = segment_name[:-1] if segment_name[-1] in "LR" else segment_name
    if base not in radii:
        raise ValueError("no capsule radius for segment " + segment_name)
    return float(radii[base])


def _clearance(geometry, segments, radii, cloth):
    first, last = geometry["first"], geometry["last"]
    by_name = {segment["name"]: segment for segment in segments}
    for a, b in CONTACT_PAIRS:
        if a not in by_name or b not in by_name:
            raise ValueError("contact pair references unknown segment: %s/%s" % (a, b))
    minimum = float("inf")
    worst = None
    for frame in range(first, last + 1):
        position = geometry["position"]
        values = {"trunk": (position(frame, "Hips"),
                            (position(frame, "LeftArm") + position(frame, "RightArm")) * 0.5)}
        for segment in segments:
            if segment["name"] == "trunk":
                continue
            a = JOINT_ALIASES.get(segment["a"], segment["a"])
            b = JOINT_ALIASES.get(segment["b"], segment["b"])
            values[segment["name"]] = (position(frame, a), position(frame, b))
        for a, b in CONTACT_PAIRS:
            gap = (_segment_distance(values[a][0], values[a][1], values[b][0], values[b][1])
                   - _capsule_radius(a, radii) - _capsule_radius(b, radii))
            if gap < minimum:
                minimum = gap
                worst = {"frame": frame, "a": a, "b": b, "gap_mm": round(gap * 1000.0, 4)}
    penetration = max(0.0, (cloth["contact8_floor_m"] - minimum) * 1000.0)
    layer_penetration = None
    if cloth["settle9_layer_gap_m"] is not None:
        layer_standoff = cloth["contact8_floor_m"] + cloth["settle9_layer_gap_m"]
        layer_penetration = max(0.0, (layer_standoff - minimum) * 1000.0)
    return {
        "body_self_clearance_mm": minimum * 1000.0,
        "cloth_contact_penetration_mm": penetration,
        "cloth_layer_penetration_mm": layer_penetration,
        "contact_worst": worst,
    }


def _bone_length_drift(geometry, bvh):
    positions = bvh["positions"] if "positions" in bvh else None
    if positions is None:
        return 0.0
    first, last = geometry["first"], geometry["last"]
    maximum = 0.0
    for joint_id, joint in enumerate(bvh["joints"]):
        parent = joint["parent"]
        if parent < 0:
            continue
        reference = (positions[0][joint_id] - positions[0][parent]).length()
        if reference <= 1e-9:
            continue
        for frame in range(first, last + 1):
            length = (positions[frame][joint_id] - positions[frame][parent]).length()
            maximum = max(maximum, abs(length - reference) * geometry["unit"] * 1000.0)
    return maximum


def _measure_clip(path, style, limits, segments, cloth, radii, footplant=True,
                  stance_m=DEFAULT_STANCE_M, collision_guard=True,
                  footplant_cap_m=MAX_FOOTPLANT_CORRECTION_M):
    bvh = parse_bvh(path)
    _require_joints(bvh, path)
    rotations, positions = forward_kinematics(bvh)
    bvh["positions"] = positions
    geometry = _take_geometry(bvh, rotations, positions)
    raw_contact = _contact_stats(geometry)
    if footplant:
        corrected, correction = _correct_legs(geometry, raw_contact["states"], stance_m,
                                              footplant_cap_m)
        if collision_guard:
            corrected, guard = _guard_legs(geometry, corrected,
                                           raw_contact["states"], radii)
        else:
            guard = {"enabled": False, "audit_only": True, "guarded_frames": 0,
                     "max_shift_mm": 0.0, "max_delta_mm": 0.0,
                     "max_ik_miss_mm": 0.0}
        measured_geometry = _corrected_geometry(geometry, corrected)
        measured_contact = _contact_stats(measured_geometry)
    else:
        measured_geometry = geometry
        measured_contact = raw_contact
        correction = {"enabled": False, "corrected_frames": 0,
                      "capped_frames": 0, "stance_mm": 0.0,
                      "stance_achieved_mean_mm": 0.0,
                      "stance_achieved_max_mm": 0.0,
                      "max_correction_cap_mm": 0.0,
                      "max_correction_mm": 0.0, "max_ik_miss_mm": 0.0}
        guard = {"enabled": False, "audit_only": True, "guarded_frames": 0,
                 "max_shift_mm": 0.0, "max_delta_mm": 0.0,
                 "max_ik_miss_mm": 0.0}
    com = _com_support(measured_geometry, segments)
    joints = _joint_limits(measured_geometry, limits)
    clearance = _clearance(measured_geometry, segments, radii, cloth)
    metrics = {
        "foot_slide_mm": max(measured_contact["feet"]["Left"]["foot_slide_mm"],
                             measured_contact["feet"]["Right"]["foot_slide_mm"]),
        "foot_drift_mm": max(measured_contact["feet"]["Left"]["foot_drift_mm"],
                             measured_contact["feet"]["Right"]["foot_drift_mm"]),
        "com_support_margin_mm": com["com_support_margin_mm"],
        "com_support_margin_p05_mm": com["com_support_margin_p05_mm"],
        "limb_flex_excess_deg": joints["limb_flex_excess_deg"],
        "body_self_clearance_mm": clearance["body_self_clearance_mm"],
        "cloth_contact_penetration_mm": clearance["cloth_contact_penetration_mm"],
        "cloth_layer_penetration_mm": clearance["cloth_layer_penetration_mm"],
        "rig_bone_length_drift_mm": _bone_length_drift(geometry, bvh),
    }
    checks = {}
    for metric, (direction, limit) in MOTION_THRESHOLDS[style].items():
        value = metrics[metric]
        if value is None:
            checks[metric] = False
        elif direction == "max":
            checks[metric] = value <= limit
        else:
            checks[metric] = value >= limit
    return {
        "take": Path(path).stem,
        "path": str(Path(path).relative_to(REPO_ROOT)) if Path(path).is_relative_to(REPO_ROOT) else str(path),
        "sha256": _sha256_file(path),
        "frames": bvh["frame_count"],
        "duration_s": round(geometry["duration"], 6),
        "fps": round(1.0 / bvh["frame_time"], 6),
        "metrics": {name: round(value, 4) if isinstance(value, float) else value
                    for name, value in metrics.items()},
        "checks": checks,
        "checks_passed": all(checks.values()),
        "detail": {
            "feet": {side: {name: round(value, 4) if isinstance(value, float) else value
                            for name, value in stats.items()}
                     for side, stats in measured_contact["feet"].items()},
            "raw_feet": {side: {name: round(value, 4) if isinstance(value, float) else value
                                for name, value in stats.items()}
                         for side, stats in raw_contact["feet"].items()},
            "footplant": {name: (round(value, 4) if isinstance(value, float) else value)
                          for name, value in correction.items()},
            "floor": {name: (round(value, 6) if isinstance(value, float) else value)
                      for name, value in raw_contact["floor"].items()},
            "joint_limit_coverage": {"joints": ["knee", "elbow", "hip", "shoulder"],
                                     "axes": ["flex"],
                                     "note": "limb-flex subset; abduction/twist and spine/neck/head/hand/foot are not gated"},
            "collision_guard": {name: (round(value, 4) if isinstance(value, float) else value)
                                for name, value in guard.items()},
            "support_frames": com["com_support_frames"],
            "com_worst_frame": com["com_worst_frame"],
            "com_support_margin_p05_mm": (round(com["com_support_margin_p05_mm"], 4)
                                          if com["com_support_margin_p05_mm"] is not None else None),
            "com_support_margin_median_mm": (round(com["com_support_margin_median_mm"], 4)
                                             if com["com_support_margin_median_mm"] is not None else None),
            "joint_limit_worst": joints["joint_limit_worst"],
            "contact_worst": clearance["contact_worst"],
            "cloth_layer_penetration_mm": (round(clearance["cloth_layer_penetration_mm"], 4)
                                           if clearance["cloth_layer_penetration_mm"] is not None else None),
        },
    }


# --------------------------------------------------------------------------
# source selection and public API


def load_mocap_sources():
    if not MOCAP_SOURCES.is_file():
        raise ValueError("mocap source index is missing: " + str(MOCAP_SOURCES))
    with open(MOCAP_SOURCES, newline="") as stream:
        rows = list(csv.DictReader(stream))
    required = {"take", "use"}
    if not rows or not required.issubset(rows[0]):
        raise ValueError("mocap source index is malformed")
    for row in rows:
        path = MOCAP_DIR / "cmu" / (row["take"] + ".bvh")
        if not path.is_file():
            raise ValueError("mocap take is missing: " + str(path))
        row["path"] = path
    return rows


def select_takes(master_seed, count=3):
    """Deterministic seed selection from the vendored locomotion takes."""
    if not _is_hex(master_seed, 128):
        raise ValueError("master_seed must be 128 lowercase hex chars (512-bit)")
    if type(count) is not int or count < 1:
        raise ValueError("count must be a positive int")
    rows = [row for row in load_mocap_sources()
            if "walk" in row["use"].lower() or "march" in row["use"].lower()]
    if not rows:
        raise ValueError("no walk/march takes in the mocap source index")
    prefix = bytes.fromhex(master_seed) + b":motion:"
    rows.sort(key=lambda row: hashlib.sha256(prefix + row["take"].encode()).hexdigest())
    return [row["take"] for row in rows[:count]]


def _resolve_takes(spec):
    rows = {row["take"]: row for row in load_mocap_sources()}
    takes = spec.get("takes")
    if takes is None:
        takes = select_takes(spec["master_seed"], spec["count"])
    resolved = []
    for take in takes:
        path = Path(take)
        if not path.is_absolute():
            if take in rows:
                path = rows[take]["path"]
            else:
                path = REPO_ROOT / take
        if not path.is_file() or path.suffix.lower() != ".bvh":
            raise ValueError("take is not a BVH file: " + str(take))
        resolved.append(path)
    return resolved


def _aggregate(clips, style):
    metrics = {}
    checks = {}
    for metric, (direction, limit) in MOTION_THRESHOLDS[style].items():
        values = [clip["metrics"][metric] for clip in clips if clip["metrics"][metric] is not None]
        if not values:
            metrics[metric] = None
            checks[metric] = False
            continue
        metrics[metric] = round(max(values) if direction == "max" else min(values), 4)
        checks[metric] = all(clip["checks"][metric] for clip in clips)
    return metrics, checks


def _manifest(payload):
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def audit(spec):
    """Audit one style against the pinned takes; returns metrics, checks and hashes."""
    spec = _validate_spec(spec)
    style = spec["style"]
    limits = load_limits()
    segments = load_segments()
    cloth = load_cloth_constants()
    if spec["assets"]:
        for asset in spec["assets"]:
            path = Path(asset["path"])
            if not path.is_absolute():
                path = REPO_ROOT / path
            if not path.is_file():
                raise ValueError("asset pin is missing: " + str(path))
            actual = _sha256_file(path)
            if actual != asset["sha256"]:
                raise ValueError("asset pin does not match: " + str(path))
    take_paths = _resolve_takes(spec)
    clips = [_measure_clip(path, style, limits, segments, cloth,
                           spec["capsule_radii_m"], spec["footplant"],
                           spec["stance_m"], spec["collision_guard"],
                           spec["footplant_cap_m"])
             for path in take_paths]
    metrics, checks = _aggregate(clips, style)
    pins = _source_pins(extra=[str(path) for path in take_paths])
    constants = {
        "contact_model": "audit-footplant-heuristic",
        "take_floor_mm": TAKE_FLOOR_M * 1000.0,
        "plant_h_mm": PLANT_H_M * 1000.0,
        "lift_h_mm": LIFT_H_M * 1000.0,
        "runtime_plant_h_mm": RUNTIME_PLANT_H_M * 1000.0,
        "runtime_lift_h_mm": RUNTIME_LIFT_H_M * 1000.0,
        "runtime_blend_s": RUNTIME_BLEND_S,
        "heel_toe_hysteresis_mm": HEEL_TOE_HYSTERESIS_M * 1000.0,
        "slip_release_mm": SLIP_RELEASE_M * 1000.0,
        "plant_confirm_frames": PLANT_CONFIRM_FRAMES,
        "stance_mm": spec["stance_m"] * 1000.0,
        "footplant_cap_mm": spec["footplant_cap_m"] * 1000.0,
        "max_guard_shift_mm": MAX_GUARD_SHIFT_M * 1000.0,
        "guard_margin_mm": GUARD_MARGIN_M * 1000.0,
        "guard_iterations": GUARD_ITERATIONS,
        "contact8_floor_mm": cloth["contact8_floor_m"] * 1000.0,
        "settle9_gap_mm": cloth["settle9_gap_m"] * 1000.0,
        "settle9_layer_gap_mm": (cloth["settle9_layer_gap_m"] * 1000.0
                                 if cloth["settle9_layer_gap_m"] is not None else None),
        "capsule_radii_m": spec["capsule_radii_m"],
    }
    report = {
        "version": VERSION,
        "style": style,
        "footplant": spec["footplant"],
        "stance_m": spec["stance_m"],
        "collision_guard": spec["collision_guard"],
        "footplant_cap_m": spec["footplant_cap_m"],
        "master_seed": spec["master_seed"],
        "source_commit": spec["source_commit"],
        "takes": [clip["take"] for clip in clips],
        "clips": clips,
        "metrics": metrics,
        "checks": checks,
        "passed": all(checks.values()),
        "thresholds": {metric: {"direction": direction, "limit": limit}
                       for metric, (direction, limit) in MOTION_THRESHOLDS[style].items()},
        "constants": constants,
        "pins": pins,
        "notes": [
            "The take floor is constant after _take_geometry normalisation; floor drift/penetration are not gated. COM is gated only in double support, so a take with no double support (20_06) fails closed on the missing COM value.",
            "The FootPlant class is an audit contact heuristic, not a byte-for-byte mirror of rig/ground.js: audit uses 10/35 mm plus a 2-frame confirmation and 25 mm slip release; the runtime uses 28/50 mm with a release blend. Both constant sets are reported.",
            "With footplant=true, stance feet are pinned before slide, COM, limb-flex and clearance measurement. The requested 45 mm stance is capped at 40 mm of actual shift; the report gives the achieved stance. A 150 mm cap gives zero slide but exceeds the photoreal limb-flex bound on 12_01.",
            "The collision guard shifts only unplanted feet outward; a planted pin is never moved. It is audit-only: max_delta_mm reports the frame-to-frame shift change and no temporal-continuity claim is made. footplant=false reproduces the raw clip.",
            "limb_flex_excess_deg covers hip/knee/elbow/shoulder flexion only; abduction/twist and spine/neck/head/hand/foot are outside the gate. cloth_layer_penetration_mm is gated against contact8 floor plus settle9 layer gap.",
        ],
    }
    report["manifest_sha256"] = _manifest({
        "version": report["version"], "style": style,
        "footplant": spec["footplant"], "stance_m": spec["stance_m"],
        "collision_guard": spec["collision_guard"],
        "footplant_cap_m": spec["footplant_cap_m"],
        "master_seed": spec["master_seed"], "source_commit": spec["source_commit"],
        "takes": report["takes"], "metrics": metrics, "checks": checks,
        "pins": pins, "constants": constants,
    })
    return report


def check(spec):
    """Pass/fail view of audit() for an admission caller."""
    report = audit(spec)
    failures = {}
    for metric, passed in report["checks"].items():
        if not passed:
            direction, limit = MOTION_THRESHOLDS[report["style"]][metric]
            failures[metric] = {"value": report["metrics"][metric],
                                "direction": direction, "limit": limit}
    return {
        "passed": report["passed"],
        "style": report["style"],
        "failures": failures,
        "metrics": report["metrics"],
        "manifest_sha256": report["manifest_sha256"],
        "pins": report["pins"],
    }


def admit(spec):
    """Fail-closed preflight for a motion render; launches no render."""
    result = check(spec)
    if not result["passed"]:
        raise ValueError("motion preflight failed: " + json.dumps(result["failures"], sort_keys=True))
    return {
        "admitted": True,
        "style": result["style"],
        "metrics": result["metrics"],
        "manifest_sha256": result["manifest_sha256"],
        "pins": result["pins"],
    }


def footplant_comparison(spec):
    """Before/after evidence for one pinned take: raw, FootPlant only, FootPlant+guard."""
    spec = _validate_spec(spec)
    takes = spec.get("takes")
    if not takes or len(takes) != 1:
        raise ValueError("footplant_comparison needs exactly one take")
    take = takes[0]
    base = dict(spec, takes=[take])
    before = audit(dict(base, footplant=False, collision_guard=False,
                        stance_m=0.0, footplant_cap_m=0.0))
    footplant_only = audit(dict(base, footplant=True, collision_guard=False,
                                stance_m=DEFAULT_STANCE_M,
                                footplant_cap_m=MAX_FOOTPLANT_CORRECTION_M))
    after = audit(dict(base, footplant=True, collision_guard=True,
                       stance_m=DEFAULT_STANCE_M,
                       footplant_cap_m=MAX_FOOTPLANT_CORRECTION_M))
    return {"take": take, "before": before,
            "footplant_only": footplant_only, "after": after}


def main(argv=None):
    parser = argparse.ArgumentParser(description="CPU-only motion/rig/collision preflight")
    parser.add_argument("--style", choices=(*STYLES, "both"), default="both")
    parser.add_argument("--takes", nargs="*", default=None)
    parser.add_argument("--seed", default=ISSUE87_SEED)
    parser.add_argument("--source-commit", default=PINNED_SOURCE_COMMIT)
    parser.add_argument("--report", default=None)
    parser.add_argument("--sample", action="store_true",
                        help="also audit the seed-selected three takes")
    parser.add_argument("--no-footplant", dest="footplant", action="store_false",
                        default=True, help="measure the raw clip instead of FootPlant-corrected stance")
    parser.add_argument("--stance-mm", type=float, default=DEFAULT_STANCE_M * 1000.0,
                        help="outward FootPlant stance correction per side (mm)")
    parser.add_argument("--no-collision-guard", dest="collision_guard",
                        action="store_false", default=True,
                        help="disable the swing-leg separation guard after FootPlant")
    parser.add_argument("--footplant-cap-mm", type=float,
                        default=MAX_FOOTPLANT_CORRECTION_M * 1000.0,
                        help="maximum FootPlant pin correction per planted frame (mm)")
    parser.add_argument("--footplant-take", default=None,
                        help="also record before/FootPlant-only/after for one take")
    args = parser.parse_args(argv)
    styles = STYLES if args.style == "both" else (args.style,)
    reports = {}
    for style in styles:
        spec = {"style": style, "master_seed": args.seed,
                "source_commit": args.source_commit, "footplant": args.footplant,
                "stance_m": args.stance_mm / 1000.0,
                "collision_guard": args.collision_guard,
                "footplant_cap_m": args.footplant_cap_mm / 1000.0}
        if args.takes:
            spec["takes"] = args.takes
        reports[style] = audit(spec)
    sample = None
    if args.sample:
        sample_takes = select_takes(args.seed, 3)
        sample = {"takes": sample_takes, "reports": {}}
        for style in styles:
            sample["reports"][style] = audit({"style": style, "master_seed": args.seed,
                                              "source_commit": args.source_commit,
                                              "footplant": args.footplant,
                                              "stance_m": args.stance_mm / 1000.0,
                                              "collision_guard": args.collision_guard,
                                              "footplant_cap_m": args.footplant_cap_mm / 1000.0,
                                              "takes": sample_takes})
    payload = {
        "version": VERSION,
        "master_seed": args.seed,
        "source_commit": args.source_commit,
        "seed_selected_takes": select_takes(args.seed, 3),
        "reports": reports,
    }
    if sample is not None:
        payload["seed_sample"] = sample
    if args.footplant_take:
        payload["footplant_comparison"] = footplant_comparison({
            "style": styles[0], "master_seed": args.seed,
            "source_commit": args.source_commit,
            "takes": [args.footplant_take]})
    text = json.dumps(payload, indent=2, sort_keys=True)
    if args.report:
        path = Path(args.report)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text + "\n")
    summary = {
        "version": VERSION,
        "source_commit": args.source_commit,
        "seed_selected_takes": payload["seed_selected_takes"],
        "reports": {style: {"passed": report["passed"],
                            "metrics": report["metrics"],
                            "failures": {name: report["metrics"][name]
                                         for name, passed in report["checks"].items() if not passed},
                            "manifest_sha256": report["manifest_sha256"]}
                    for style, report in reports.items()},
        "seed_sample": (None if sample is None else {
            "takes": sample["takes"],
            "reports": {style: {"passed": report["passed"],
                                "metrics": report["metrics"],
                                "failures": {name: report["metrics"][name]
                                             for name, passed in report["checks"].items() if not passed},
                                "manifest_sha256": report["manifest_sha256"]}
                        for style, report in sample["reports"].items()},
        }),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
