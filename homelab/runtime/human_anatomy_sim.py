"""Source-grounded anatomy / body-deformation preflight for ACP issue #87 (S1).

This module does not launch a render and does not modify the JS anatomy solve.
It evaluates the *existing* anatomy and deformation assets at the pinned head:
the 31-person ``kin_test.json`` cast (joint ranges, carrying angle, gait terms),
the measured soft-tissue solve reports (surface-volume conservation) and the
pelvis solve reports (hinge turn, displacement, Jmin).  It then models the
engine's linear-blend skinning at the person's hip, knee and elbow joints under
a seeded motion envelope and reports the two S1 criteria:

    joint_rms_deg         shared-envelope clamp residual against the cast
    volume_preservation   isotropic LBS hinge volume ratio x measured soft ratio

This is a report-derived joint-limit/hinge proxy, not a mesh deformation: it
does not read skin weights, joint centres, mesh topology or anatomy bake blobs.
The shared envelope is the same for baseline and candidate; the candidate's
only default change is a volume-preserving blend correction.  An explicit
``normalize_pose=True`` optionally clamps the envelope to each person's own
limits (a pose-space clamp, not an independent deformation measurement).  Both
registers use the same model; photorealistic and stylized differ in limit scale
and thresholds, matching the issue #87 brief.

Seed qualities (operator seed below): 512 bits / 128 hex chars, 56 distinct
bytes, high entropy inside a fixed length.  One master seed derives one integer
per subsystem (``derive_seed``); the same seed, spec and assets reproduce the
same metrics byte for byte.  That deterministic recurrence is why the
comparison is reviewable without re-rendering.

Source pins are SHA-256 of the actual files at ACP head e235ca432f15...;
asset pins are SHA-256 of the committed review measurements.  Asset reports
must be supplied as file paths (or as inline fixtures for tests); a path whose
bytes do not match the pinned SHA-256 is refused.
"""
import hashlib
import json
import math
import pathlib
import statistics
import subprocess

VERSION = 'human-anatomy-deform-v2'
DEFAULT_SEED = ('50ac7f0fb66719db5001145a6092f714b4902017762bf1998acc03484508f5422'
                '4e51136a0b638becc18d5d2d93f7d1a28e6a8c945754c56c806f7b12f1a8ff7')
ISSUE87_SEED = ('6a5980a305c1b7a4fb352b1cd4e405ed58fc3f486e734ce9efaf13b7a7b4d42e3'
                '16df18768e311e463ce1fafa7039e4f1f33e39010ef9fac6c569cb7f196ceb0')
SOURCE_COMMIT = 'e235ca432f1514842da8e99ec28addf77c99b2d4'
SUBSYSTEMS = ('anatomy', 'deformation')

# The two S1 criteria, same names and directions as human_sim.THRESHOLDS.
STYLE_PRESETS = {
    'photorealistic': {
        'limit_scale': 1.0,
        'thresholds': {'joint_rms_deg': ('max', 2.0), 'volume_preservation': ('min', 0.97)},
    },
    'stylized': {
        'limit_scale': 1.10,
        'thresholds': {'joint_rms_deg': ('max', 4.0), 'volume_preservation': ('min', 0.92)},
    },
}
STYLES = tuple(STYLE_PRESETS)
# human_sim.THRESHOLDS-compatible view (metric -> (direction, limit)).
THRESHOLDS = {style: preset['thresholds'] for style, preset in STYLE_PRESETS.items()}

# Model constants.  JOINT_FIELDS are the flex limits published by kin.js
# (CDC Normal Joint ROM + the person's own soft-tissue limit when stricter).
JOINT_FIELDS = ('hipFlex', 'kneeFlex', 'elbowFlex')
ENVELOPE_NEUTRAL = 0.65          # shared track: 65 % of the canonical limit
ENVELOPE_AMPLITUDE = 0.30        # ... plus a 30 % sinusoid, peak 95 %
BLEND_FRACTION = 0.08            # share of a segment's volume in the blend band
LBS_VOLUME_EXPONENT = 1.5        # isotropic volume = linear-scale cubed
VOLUME_CORRECTIVE = 0.95         # strength of the blend cross-section repair
DEFAULT_FRAMES = 30
JOINT_RMS_SEMANTICS = 'shared_envelope_clamp_residual'
MODEL_KIND = 'report_derived_joint_limit_hinge_proxy'


# Files whose bytes ground the model.  Hashes were verified against the
# pipeline checkout whose blobs equal ACP head e235ca4.
SOURCE_PINS = (
    {'path': 'videos/web/lib/fx/body/kin.js', 'role': 'kinematics, joint limits, gait',
     'sha256': '8cc8e0d83f8e3fded5cd320fe285e42c0b240255e73b58432f5d18ba3da1dd96',
     'git_blob': 'a39daea049fa0aa6bea02bfd7c929a7873446e2a'},
    {'path': 'videos/web/lib/fx/body/index.js', 'role': 'body build and skinning entry',
     'sha256': '16a28d2bf96b32dc42aeaaad3b9a02bc37ef12cb8e81929035dd872741c59188',
     'git_blob': '5ac8586c08a07d8102f4f5806b665ba68ae1aeab'},
    {'path': 'videos/web/lib/fx/anatomy/soft/hook.js', 'role': 'soft-tissue solve hook',
     'sha256': '027f91aca9b0b1cd6f0d59e86b11aa774ddba1c3f4ca9b93423d9b2f54981a1c',
     'git_blob': '26f1b34d7983624de098c0cb6cc4c98818367c64'},
    {'path': 'videos/web/lib/fx/anatomy/soft/index.js', 'role': 'volumetric soft-tissue solver',
     'sha256': 'e929d6173628b7816ef1c8618d10c9bbd49fcb2a0a5e5d4d5f41e7a4e163cffe',
     'git_blob': 'f2508e8abe515e635f78fdbcd5f1a1f41cbe98f3'},
    {'path': 'videos/web/lib/fx/anatomy/soft/envelope.js', 'role': 'soft envelope bake format',
     'sha256': 'e010004db2a3b0a4bcd5fd0346a06f74af5c5a1c3fd741c064aaa085d8d96048',
     'git_blob': '0945949b2d8178227977e61c5fbb5ace45f9d5f5'},
    {'path': 'videos/web/lib/fx/anatomy/soft/breast.js', 'role': 'breast solve and volume checks',
     'sha256': 'aa0329026f79895f0ac660ca1b479321c96e95fdc32fe04ec6fced834a180d61',
     'git_blob': '7ebe94bd2c298cb8054f1d18006c45483e346d1c'},
    {'path': 'videos/web/lib/fx/anatomy/pelvis/hook.js', 'role': 'pelvis solve hook',
     'sha256': '0f46334458869b66ca0148ffe8ab7ccab934ac7241655564b8c07857c7c24854',
     'git_blob': 'fb77f27324f1050052bf901b5c0aac09af90cab0'},
    {'path': 'videos/web/lib/fx/anatomy/pelvis/index.js', 'role': 'pelvis solve and reports',
     'sha256': 'aa51e1ed7a106c2fd17329aa7e3637786745fe8ca5fd6a970f1663daa5e339c1',
     'git_blob': '95becf1474541b68b862c39c41b808c46063538f'},
    {'path': 'videos/web/lib/fx/person/build.js', 'role': 'person slot order and skinning build',
     'sha256': 'c3bf81655ec299fa7bac76e6d2c9d12cbdb26544f337cdeb4e17d6ecf617cd8c',
     'git_blob': 'e9f537fe0012b5ec470975332af341f10c8279b5'},
)

# Committed human-asset measurements used for the comparison.  These are
# read-only inputs; the model never writes them.
ASSET_PINS = (
    {'kind': 'kin', 'path': 'videos/review/studio_human_c8/after/kin/kin_test.json',
     'role': '31-person kinematic cast', 'sha256': 'd7c1e9145b72591ab642963525e8aa6e10aef4fba4a6b788cb068de71d134c42'},
    {'kind': 'soft', 'path': 'videos/review/studio_human_c8/after/anat8_body/measures/soft_i12.json',
     'role': 'soft solve v5, L08 L and L06 L', 'sha256': '099b646c1ce1f0330a25f0d7040187e6c41b5ada5b9671bc2c15a8be768d6590'},
    {'kind': 'soft', 'path': 'videos/review/studio_human_c8/after/anat8_body/measures/soft_i11.json',
     'role': 'soft solve v4, both sides of L08 and L06', 'sha256': '5ebbbe456cf425d06300fbf6de11f99a51478c94adcc60c835f41de4bd88773e'},
    {'kind': 'pelvis', 'path': 'videos/review/studio_human_c8/after/anat8_pelvis/measures/solve_i16.json',
     'role': 'pelvis v13 solve, twelve lineup people', 'sha256': '9f4cfc0bb29c680fd1ef6adbba7bbc613dca8151279894b82f1f73c1c09f57cb'},
)

# Non-JSON evidence carried in the same comparison record.
EVIDENCE_PINS = (
    {'kind': 'pelvis', 'path': 'videos/review/studio_human_c8/after/anat8_pelvis/measures/solve_i16.md',
     'role': 'pelvis v13 human-readable measures', 'sha256': '3f95a582ee602bf327f9e514916edcb81fe2ab9f9b74bb4ee0b348ab00b59f2a'},
)


def _is_hex(value, length):
    return (isinstance(value, str) and len(value) == length
            and all(c in '0123456789abcdef' for c in value.lower()) and value == value.lower())


def derive_seed(master_seed, subsystem):
    """Derive one 64-bit subsystem seed from the 512-bit master seed."""
    if not _is_hex(master_seed, 128):
        raise ValueError('master_seed must be 128 lowercase hex chars (512-bit)')
    if subsystem not in SUBSYSTEMS:
        raise ValueError('unknown subsystem: ' + str(subsystem))
    digest = hashlib.sha256(bytes.fromhex(master_seed) + b':' + subsystem.encode()).digest()
    return int.from_bytes(digest[:8], 'big')


def _unit(*parts):
    """Deterministic [0, 1) from the seed material, independent of Python PRNG."""
    digest = hashlib.sha256('|'.join(str(p) for p in parts).encode()).digest()
    return int.from_bytes(digest[:8], 'big') / 2.0**64


def _fit(value, label):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(label + ' must be a finite number')
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(label + ' must be finite')
    return value


def validate_pins(pins):
    """Validate the source-pin list carried by a spec; fail closed."""
    if not isinstance(pins, list) or not pins:
        raise ValueError('at least one pinned asset is required')
    paths = set()
    for pin in pins:
        if not isinstance(pin, dict) or not pin.get('path'):
            raise ValueError('asset pin path is required')
        if pin['path'] in paths:
            raise ValueError('duplicate asset pin path: ' + pin['path'])
        paths.add(pin['path'])
        if not _is_hex(pin.get('sha256', ''), 64):
            raise ValueError('asset pin sha256 must be 64 lowercase hex: ' + pin['path'])
        if not _is_hex(pin.get('source_commit', ''), 40):
            raise ValueError('asset pin source_commit must be 40 lowercase hex: ' + pin['path'])
        if 'kind' in pin and not isinstance(pin['kind'], str):
            raise ValueError('asset pin kind must be a string: ' + pin['path'])
    return pins


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError('spec must be a dict')
    style = spec.get('style')
    if style not in STYLE_PRESETS:
        raise ValueError('style must be photorealistic or stylized')
    assets = spec.get('assets')
    validate_pins(assets)
    frames = spec.get('frames', DEFAULT_FRAMES)
    if type(frames) is not int or not (1 <= frames <= 600):
        raise ValueError('frames must be int in 1..600')
    seed = spec.get('master_seed', DEFAULT_SEED)
    if not _is_hex(seed, 128):
        raise ValueError('master_seed must be 128 lowercase hex chars (512-bit)')
    limit_scale = _fit(spec.get('limit_scale', STYLE_PRESETS[style]['limit_scale']), 'limit_scale')
    if not 0.5 <= limit_scale <= 1.5:
        raise ValueError('limit_scale must be in 0.5..1.5')
    for key in ('normalize_pose', 'volume_corrective'):
        if key in spec and not isinstance(spec[key], bool):
            raise ValueError(key + ' must be a boolean')
    return dict(spec, style=style, frames=frames, master_seed=seed, limit_scale=limit_scale)


def _load_asset(asset, root):
    if 'report' in asset:
        if asset.get('fixture') is not True:
            raise ValueError('inline reports require fixture=True: ' + asset['path'])
        return asset['report']
    path = pathlib.Path(asset['path'])
    if not path.is_absolute():
        path = pathlib.Path(root or '.') / path
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ValueError('cannot read asset %s: %s' % (asset['path'], error))
    digest = hashlib.sha256(data).hexdigest()
    if digest != asset['sha256']:
        raise ValueError('asset sha256 mismatch: %s' % asset['path'])
    try:
        return json.loads(data)
    except ValueError as error:
        raise ValueError('asset is not JSON: %s: %s' % (asset['path'], error))


def _kin_person(record):
    if not isinstance(record, dict):
        raise ValueError('kin record must be a dict')
    for key in ('name', 'sex') + JOINT_FIELDS:
        if key not in record:
            raise ValueError('kin record missing ' + key)
    person = {'name': str(record['name']), 'sex': str(record['sex'])}
    for key in JOINT_FIELDS:
        person[key] = _fit(record[key], key)
        if person[key] <= 0:
            raise ValueError(key + ' must be positive')
    for key in ('age', 'H', 'kg', 'comH', 'speed', 'cadence', 'step', 'carry',
                'kneeExt', 'elbowExt', 'sway', 'obl', 'hipAdd'):
        if key in record:
            person[key] = _fit(record[key], key)
    return person


def _soft_entry(entry, solver_version):
    if not isinstance(entry, dict):
        raise ValueError('soft entry must be a dict')
    stats = entry.get('stats')
    if not isinstance(stats, dict):
        raise ValueError('soft entry missing stats')
    surface = stats.get('surfVolCm3')
    if not isinstance(surface, dict):
        raise ValueError('soft entry missing surfVolCm3')
    loaded = _fit(surface.get('loaded'), 'loaded')
    reference = _fit(surface.get('ref'), 'ref')
    if reference <= 0 or loaded <= 0:
        raise ValueError('soft volumes must be positive')
    ratio = loaded / reference
    if not 0.5 <= ratio <= 1.5:
        raise ValueError('soft volume ratio out of range')
    return {'name': str(entry.get('name', '')), 'side': str(entry.get('side', '')),
            'volume_ratio': ratio, 'err_pct': _fit(surface.get('errPct'), 'errPct'),
            'converged': bool(stats.get('converged')), 'inverted': int(stats.get('inverted', 0)),
            'jmin': _fit(stats.get('Jmin', 1.0), 'Jmin'), 'solver_version': solver_version}


def _collect_soft(report, source):
    entries = report.get('people') if isinstance(report, dict) else None
    if not isinstance(entries, list):
        raise ValueError('soft report must hold a people list')
    version = report.get('breastVersion', 0)
    out = []
    for entry in entries:
        out.append(_soft_entry(entry, version))
    return out, source


def _pelvis_metrics(report, source):
    """Aggregate the pelvis solve reports without inventing a shape metric."""
    if not isinstance(report, dict):
        raise ValueError('pelvis report must be a dict')
    people = []
    for name, record in report.items():
        if name in ('version', 'note'):
            continue
        if not isinstance(record, dict) or not isinstance(record.get('solve'), dict):
            raise ValueError('pelvis record missing solve: ' + str(name))
        solve = record['solve']
        bend = record.get('bend', {}).get('dThetaDeg', {})
        disp = record.get('disp', {})
        people.append({
            'name': name,
            'jmin': _fit(solve.get('Jmin'), 'Jmin'),
            'inverted': int(solve.get('inverted', 0)),
            'residual_mm_s': _fit(solve.get('residualMmS'), 'residualMmS'),
            'bend_p50_deg': _fit(bend.get('p50'), 'bend p50'),
            'bend_p95_deg': _fit(bend.get('p95'), 'bend p95'),
            'bend_max_deg': _fit(bend.get('max'), 'bend max'),
            'disp_mean_mm': _fit(disp.get('meanMm'), 'disp mean'),
            'disp_max_mm': _fit(disp.get('maxMm'), 'disp max'),
        })
    if not people:
        raise ValueError('pelvis report is empty')
    return {
        'count': len(people),
        'inverted': sum(p['inverted'] for p in people),
        'jmin_min': min(p['jmin'] for p in people),
        'jmin_mean': round(statistics.mean(p['jmin'] for p in people), 5),
        'bend_p95_mean_deg': round(statistics.mean(p['bend_p95_deg'] for p in people), 4),
        'bend_p95_max_deg': max(p['bend_p95_deg'] for p in people),
        'bend_max_deg': max(p['bend_max_deg'] for p in people),
        'disp_mean_mm': round(statistics.mean(p['disp_mean_mm'] for p in people), 4),
        'people': people,
        'source': source,
    }


def _soft_aggregate(entries):
    if not entries:
        return None
    # Latest solver version wins for a repeated (person, side) solve.
    latest = {}
    for entry in entries:
        key = (entry['name'], entry['side'])
        if key not in latest or entry['solver_version'] > latest[key]['solver_version']:
            latest[key] = entry
    values = list(latest.values())
    ratios = [entry['volume_ratio'] for entry in values]
    return {
        'count': len(values),
        'volume_min': min(ratios),
        'volume_mean': round(statistics.mean(ratios), 6),
        'inverted': sum(entry['inverted'] for entry in values),
        'unconverged': sum(0 if entry['converged'] else 1 for entry in values),
        'people': [{'name': entry['name'], 'side': entry['side'],
                    'volume_ratio': round(entry['volume_ratio'], 6),
                    'err_pct': round(entry['err_pct'], 4),
                    'solver_version': entry['solver_version']} for entry in values],
    }


def _canonical(cast):
    return {field: statistics.median(person[field] for person in cast) for field in JOINT_FIELDS}


def lbs_volume_factor(angle_deg, corrective=False):
    """Isotropic LBS hinge volume ratio over a uniform blend band.

    For a hinge rotated by theta with blend weight w, the planar blend's
    squared length scale is 1 - 2w(1-w)(1-cos theta); averaging over w in
    [0, 1] gives the mean squared linear scale f = 1 - (1-cos theta)/3.
    Under the stated isotropic assumption the volume scale is f^(3/2)
    (LBS_VOLUME_EXPONENT).
    Only the blend band (BLEND_FRACTION of the segment) sees it, hence the
    convex combination below.  This is a deformation-gradient model, not a
    measured mesh volume.
    """
    angle_deg = _fit(angle_deg, 'angle_deg')
    linear_sq = 1.0 - BLEND_FRACTION * (1.0 - math.cos(math.radians(max(0.0, angle_deg)))) / 3.0
    factor = max(0.0, linear_sq) ** LBS_VOLUME_EXPONENT
    if corrective:
        factor = 1.0 - (1.0 - factor) * (1.0 - VOLUME_CORRECTIVE)
    return factor


def _evaluate_cast(cast, frames, style, limit_scale, seed, normalize_pose, volume_corrective):
    """Return RMS joint correction and LBS volume ratio over the seeded track."""
    anatomy_seed = derive_seed(seed, 'anatomy')
    deformation_seed = derive_seed(seed, 'deformation')
    canonical = _canonical(cast)
    residual_sq = 0.0
    volume_sum = 0.0
    samples = 0
    rows = []
    for person in cast:
        person_phase = 0.10 * (2.0 * _unit(deformation_seed, person['name']) - 1.0)
        phase_offsets = [2.0 * math.pi * _unit(anatomy_seed, 'phase', field) for field in JOINT_FIELDS]
        person_residual_sq = 0.0
        person_volume = 0.0
        for frame in range(frames):
            phase = 2.0 * math.pi * frame / frames + person_phase
            for index, field in enumerate(JOINT_FIELDS):
                envelope = ENVELOPE_NEUTRAL + ENVELOPE_AMPLITUDE * (
                    0.5 + 0.5 * math.sin(phase + phase_offsets[index]))
                target = canonical[field] * limit_scale * envelope
                limit = person[field]
                if normalize_pose:
                    target = min(target, limit)
                achieved = min(target, limit)
                residual = target - achieved
                person_residual_sq += residual * residual
                factor = lbs_volume_factor(achieved, corrective=volume_corrective)
                person_volume += factor
                volume_sum += factor
                samples += 1
        joint_rms = math.sqrt(person_residual_sq / (frames * len(JOINT_FIELDS)))
        volume = person_volume / (frames * len(JOINT_FIELDS))
        residual_sq += person_residual_sq
        rows.append({'name': person['name'], 'joint_rms_deg': round(joint_rms, 5),
                     'volume_preservation': round(volume, 6)})
    return {
        'joint_rms_deg': round(math.sqrt(residual_sq / samples), 5),
        'volume_preservation': round(volume_sum / samples, 6),
        'people': rows,
        'style': style,
    }


def compare(baseline, candidate):
    """Compare candidate metrics against the style thresholds."""
    if baseline.get('style') != candidate.get('style'):
        raise ValueError('comparison requires the same style')
    style = candidate['style']
    if style not in STYLE_PRESETS:
        raise ValueError('unknown style: ' + str(style))
    limits = STYLE_PRESETS[style]['thresholds']
    checks = {}
    deltas = {}
    for metric, (direction, limit) in limits.items():
        if metric not in candidate:
            raise ValueError('candidate missing ' + metric)
        value = _fit(candidate[metric], metric)
        checks[metric] = value <= limit if direction == 'max' else value >= limit
        if metric in baseline:
            deltas[metric] = round(value - _fit(baseline[metric], metric), 6)
    return {
        'passed': all(checks.values()),
        'checks': checks,
        'deltas': deltas,
        'thresholds': {metric: limit for metric, (_, limit) in limits.items()},
        'style': style,
    }


def validate_report(report):
    """Strict shape check for a preflight/qualification report."""
    if not isinstance(report, dict):
        raise ValueError('deformation report must be a dict')
    if report.get('version') != VERSION:
        raise ValueError('deformation report version mismatch')
    style = report.get('style')
    if style not in STYLE_PRESETS:
        raise ValueError('deformation report style is not photo/stylized')
    if not _is_hex(report.get('manifest_sha256', ''), 64):
        raise ValueError('deformation report manifest_sha256 must be 64 hex')
    checks = report.get('checks')
    if not isinstance(checks, dict) or not checks:
        raise ValueError('deformation checks must be a non-empty dict')
    expected = set(STYLE_PRESETS[style]['thresholds'])
    if set(checks) != expected:
        raise ValueError('deformation checks do not match the style thresholds')
    if any(type(value) is not bool for value in checks.values()):
        raise ValueError('deformation checks must be booleans')
    if report.get('passed') is not all(checks.values()):
        raise ValueError('deformation passed does not equal all(checks)')
    thresholds = report.get('thresholds')
    if not isinstance(thresholds, dict) or set(thresholds) != expected:
        raise ValueError('deformation thresholds do not match the checks')
    for metric in ('joint_rms_deg', 'volume_preservation'):
        value = _fit(report.get(metric), metric)
        if metric == 'volume_preservation' and not 0.0 <= value <= 1.0:
            raise ValueError('volume_preservation must be in 0..1')
        if metric == 'joint_rms_deg' and value < 0.0:
            raise ValueError('joint_rms_deg must be non-negative')
    qualification = report.get('qualification')
    if not isinstance(qualification, dict):
        raise ValueError('deformation qualification block is required')
    if type(qualification.get('ready')) is not bool:
        raise ValueError('deformation qualification.ready must be a boolean')
    if qualification.get('requires_soft_evidence') is not True:
        raise ValueError('deformation qualification must require soft evidence')
    if report.get('model', {}).get('reads_mesh_topology') is not False:
        raise ValueError('deformation report must declare the no-topology proxy')
    return report


def evaluate(spec):
    """Evaluate the S1 anatomy/deformation criteria for one spec.

    Required assets: one or more ``kind`` -> ``kin`` reports.  Soft and pelvis
    reports are optional evidence; when present, the soft surface-volume ratio
    multiplies ``volume_preservation`` (worst case, fail closed).
    """
    spec = validate_spec(spec)
    root = spec.get('root') or pathlib.Path(__file__).resolve().parents[2]
    kin = []
    soft = []
    pelvis = []
    sources = []
    for asset in spec['assets']:
        kind = asset.get('kind')
        if kind not in ('kin', 'soft', 'pelvis'):
            continue  # pins owned by other subsystems stay in the manifest only
        if asset['source_commit'] != SOURCE_COMMIT:
            raise ValueError('anatomy asset source_commit does not match pinned head: ' + asset['path'])
        report = _load_asset(asset, root)
        if kind == 'kin':
            rows = report.get('cast') if isinstance(report, dict) else None
            if isinstance(rows, list):
                kin.extend(_kin_person(row) for row in rows)
            elif isinstance(report, dict) and 'joints' in report:
                kin.append(_kin_person(report))
            else:
                raise ValueError('kin asset must hold a cast list or a person.kin object')
        elif kind == 'soft':
            entries, source = _collect_soft(report, asset['path'])
            soft.extend(entries)
            sources.append(source)
        elif kind == 'pelvis':
            metrics = _pelvis_metrics(report, asset['path'])
            pelvis.append(metrics)
            sources.append(asset['path'])
    if not kin:
        raise ValueError('at least one kin asset is required')

    soft_metrics = _soft_aggregate(soft)
    measured_volume = soft_metrics['volume_min'] if soft_metrics else 1.0
    style = spec['style']
    frames = spec['frames']
    seed = spec['master_seed']
    limit_scale = spec['limit_scale']
    normalize_pose = spec.get('normalize_pose', False)
    volume_corrective = spec.get('volume_corrective', True)

    baseline = _evaluate_cast(cast=kin, frames=frames, style=style, limit_scale=limit_scale,
                              seed=seed, normalize_pose=False, volume_corrective=False)
    candidate = _evaluate_cast(cast=kin, frames=frames, style=style, limit_scale=limit_scale,
                               seed=seed, normalize_pose=normalize_pose,
                               volume_corrective=volume_corrective)
    baseline['volume_preservation'] = round(baseline['volume_preservation'] * measured_volume, 6)
    candidate['volume_preservation'] = round(candidate['volume_preservation'] * measured_volume, 6)
    report = compare(baseline, candidate)
    manifest = hashlib.sha256(json.dumps({
        'version': VERSION,
        'style': style,
        'master_seed': seed,
        'frames': frames,
        'limit_scale': limit_scale,
        'model': {
            'joints': JOINT_FIELDS,
            'envelope_neutral': ENVELOPE_NEUTRAL,
            'envelope_amplitude': ENVELOPE_AMPLITUDE,
            'blend_fraction': BLEND_FRACTION,
            'lbs_volume_exponent': LBS_VOLUME_EXPONENT,
            'volume_corrective_strength': VOLUME_CORRECTIVE,
            'joint_rms_semantics': JOINT_RMS_SEMANTICS,
            'model_kind': MODEL_KIND,
            'reads_mesh_topology': False,
            'normalize_pose': normalize_pose,
            'volume_corrective': volume_corrective,
        },
        'assets': [{'kind': a.get('kind'), 'path': a['path'], 'sha256': a['sha256'],
                    'source_commit': a['source_commit']} for a in spec['assets']],
        'source_pins': [{'path': p['path'], 'sha256': p['sha256']} for p in SOURCE_PINS],
        'source_commit': SOURCE_COMMIT,
        'source_commit_binding': 'anatomy assets must equal the pinned head',
    }, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {
        'version': VERSION,
        'style': style,
        'master_seed': seed,
        'frames': frames,
        'joint_rms_deg': candidate['joint_rms_deg'],
        'volume_preservation': candidate['volume_preservation'],
        'manifest_sha256': manifest,
        'passed': report['passed'],
        'checks': report['checks'],
        'deltas': report['deltas'],
        'thresholds': report['thresholds'],
        'baseline': {'joint_rms_deg': baseline['joint_rms_deg'],
                     'volume_preservation': baseline['volume_preservation']},
        'candidate': {'joint_rms_deg': candidate['joint_rms_deg'],
                      'volume_preservation': candidate['volume_preservation']},
        'evidence': {
            'cast': {'count': len(kin), 'people': candidate['people']},
            'soft': soft_metrics,
            'pelvis': pelvis,
            'sources': sources,
            'source_pins': list(SOURCE_PINS),
            'measured_volume_multiplier': round(measured_volume, 6),
        },
        'qualification': {
            'ready': bool(soft_metrics and soft_metrics['count']),
            'requires_soft_evidence': True,
            'preflight_only': True,
            'source_qualified': None,
            'reads_mesh_topology': False,
            'model_kind': MODEL_KIND,
        },
        'model': {'normalize_pose': normalize_pose, 'volume_corrective': volume_corrective,
                  'limit_scale': limit_scale, 'joint_rms_semantics': JOINT_RMS_SEMANTICS,
                  'lbs_volume_exponent': LBS_VOLUME_EXPONENT,
                  'reads_mesh_topology': False},
    }


def pelvis_metrics(report):
    """Public aggregator for the pelvis solve report schema."""
    return _pelvis_metrics(report, None)


def soft_metrics(report):
    """Public aggregator for one soft solve report."""
    entries, _ = _collect_soft(report, None)
    return _soft_aggregate(entries)


def _verify_pins(root, pins):
    root = pathlib.Path(root)
    verified, missing, mismatched = [], [], []
    for pin in pins:
        path = root / pin['path']
        if not path.is_file():
            missing.append(pin['path'])
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != pin['sha256']:
            mismatched.append({'path': pin['path'], 'expected': pin['sha256'], 'actual': digest})
        else:
            verified.append(pin['path'])
    return {'verified': verified, 'missing': missing, 'mismatched': mismatched}


def verify_source_pins(root):
    """Check SOURCE_PINS against a materialised checkout at the pinned head."""
    return _verify_pins(root, SOURCE_PINS)


def verify_source_pins_git(repo=None):
    """Check SOURCE_PINS against the pinned Git blobs, independent of checkout."""
    repo = pathlib.Path(repo) if repo else pathlib.Path(__file__).resolve().parents[2]
    verified, missing, mismatched = [], [], []
    for pin in SOURCE_PINS:
        result = subprocess.run(
            ['git', '-C', str(repo), 'show', SOURCE_COMMIT + ':' + pin['path']],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if result.returncode:
            missing.append(pin['path'])
            continue
        digest = hashlib.sha256(result.stdout).hexdigest()
        if digest != pin['sha256']:
            mismatched.append({'path': pin['path'], 'expected': pin['sha256'], 'actual': digest})
        else:
            verified.append(pin['path'])
    return {'method': 'git', 'verified': verified, 'missing': missing, 'mismatched': mismatched}


def verify_asset_pins(root):
    """Check ASSET_PINS and EVIDENCE_PINS against the workspace."""
    return _verify_pins(root, ASSET_PINS + EVIDENCE_PINS)


def compare_existing_assets(root=None, source_root=None):
    """Run the two style registers against the committed human-asset measures."""
    root = pathlib.Path(root) if root else pathlib.Path(__file__).resolve().parents[2]
    required = [{'kind': pin['kind'], 'path': pin['path'], 'sha256': pin['sha256'],
                 'source_commit': SOURCE_COMMIT} for pin in ASSET_PINS]
    results = {}
    for style in STYLES:
        spec = {'style': style, 'master_seed': DEFAULT_SEED, 'frames': DEFAULT_FRAMES,
                'assets': required, 'root': str(root)}
        results[style] = evaluate(spec)
    source = verify_source_pins(source_root) if source_root else verify_source_pins_git(root)
    assets = verify_asset_pins(root)
    return {'version': VERSION, 'root': str(root), 'source_commit': SOURCE_COMMIT,
            'assets': list(ASSET_PINS), 'evidence': list(EVIDENCE_PINS),
            'asset_verification': assets,
            'source_pins': list(SOURCE_PINS), 'source_verification': source,
            'styles': results}
