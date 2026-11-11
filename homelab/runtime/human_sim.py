"""Source-validated human-simulation record assembly for issue #87.

Every metric in a result comes from an actual specialist solver, bake or
measured record (human_anatomy_sim, human_skin_hair, motion_collision, or
the cloth seam-contact comparison record). There are no invented proxy
measurements: a subsystem with no validated record in the spec reports
its metrics as unavailable (None) and is excluded from pass claims.

The record distinguishes the source of each value.  A production
measurement supplied by the render/validation pipeline is ``production``;
the default skin/hair CPU response is ``analytical-model``; anatomy and
motion solver evaluations are ``model``; a cloth comparison is ``record``.
A metric with no production measurement is listed in
``production_unavailable`` even when an analytical value passes its
threshold, and ``compare`` reports ``production_passed`` separately from
the analytical preflight ``passed``.  A specialist subsystem that reports
``passed: false`` is propagated as a subsystem failure and can never be
hidden by threshold checks.

Pin validation verifies the actual referenced bytes (SHA-256 of the file
at spec root) and, in a git checkout, that source_commit is an ancestor
of HEAD. Render admission is owned by the farm (admission_policy /
gpu_jobs); this module adds no admission system of its own.
"""
import hashlib
import json
import math
import pathlib
import subprocess

VERSION = 'human-sim-validated-v3'
ISSUE87_SEED = '6a5980a305c1b7a4fb352b1cd4e405ed58fc3f486e734ce9efaf13b7a7b4d42e316df18768e311e463ce1fafa7039e4f1f33e39010ef9fac6c569cb7f196ceb0'
SUBSYSTEMS = ('anatomy', 'cloth', 'skin', 'hair', 'collision', 'rig')
STYLES = ('photorealistic', 'stylized')
MEASUREMENT_SOURCES = ('production', 'analytical-model', 'model', 'record', 'unavailable')
THRESHOLDS = {
    'photorealistic': {'joint_rms_deg': ('max', 2.0), 'volume_preservation': ('min', 0.97),
                       'cloth_penetration_mm': ('max', 1.0), 'cloth_stretch': ('max', 1.08),
                       'skin_stretch': ('max', 1.06), 'hair_deviation_mm': ('max', 3.0),
                       'min_clearance_mm': ('min', 2.0)},
    'stylized': {'joint_rms_deg': ('max', 4.0), 'volume_preservation': ('min', 0.92),
                 'cloth_penetration_mm': ('max', 2.5), 'cloth_stretch': ('max', 1.15),
                 'skin_stretch': ('max', 1.12), 'hair_deviation_mm': ('max', 6.0),
                 'min_clearance_mm': ('min', 1.0)},
}
METRICS = ('joint_rms_deg', 'volume_preservation', 'cloth_penetration_mm', 'cloth_stretch',
           'skin_stretch', 'hair_deviation_mm', 'min_clearance_mm')


def _is_hex(s, n):
    return isinstance(s, str) and len(s) == n and all(c in '0123456789abcdef' for c in s.lower()) and s == s.lower()


def derive_seed(master_seed, subsystem):
    if not _is_hex(master_seed, 128):
        raise ValueError('master_seed must be 128 lowercase hex characters (512-bit)')
    if subsystem not in SUBSYSTEMS:
        raise ValueError('unknown subsystem: ' + str(subsystem))
    return int.from_bytes(hashlib.sha256(bytes.fromhex(master_seed) + b':' + subsystem.encode()).digest()[:8], 'big')


def validate_pins(pins, root='.'):
    """Verify actual referenced bytes + commit ancestry; fail closed."""
    if not isinstance(pins, list) or not pins:
        raise ValueError('at least one source-pinned asset is required')
    root = pathlib.Path(root)
    seen = set()
    for p in pins:
        if not isinstance(p, dict) or not p.get('path') or p['path'] in seen:
            raise ValueError('asset pin path missing or duplicated')
        seen.add(p['path'])
        if not _is_hex(p.get('sha256', ''), 64):
            raise ValueError('asset pin sha256 must be 64 lowercase hex: ' + str(p.get('path')))
        if not _is_hex(p.get('source_commit', ''), 40):
            raise ValueError('asset pin source_commit must be 40 lowercase hex: ' + str(p.get('path')))
        path = root / p['path']
        if path.is_symlink() or not path.is_file():
            raise ValueError('pinned asset not found: ' + p['path'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != p['sha256']:
            raise ValueError('pinned asset bytes do not match sha256: ' + p['path'])
        if (root / '.git').exists():
            ok = subprocess.run(['git', '-C', str(root), 'merge-base', '--is-ancestor',
                                 p['source_commit'], 'HEAD'], capture_output=True).returncode
            if ok != 0:
                raise ValueError('pinned source_commit is not an ancestor of HEAD: ' + p['path'])
    return pins


def _production_measurements(spec):
    value = spec.get('production_measurements', {})
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError('production_measurements must be a dict')
    unknown = set(value) - set(METRICS)
    if unknown:
        raise ValueError('unknown production measurements: ' + ', '.join(sorted(unknown)))
    result = {}
    for metric in METRICS:
        if metric not in value:
            continue
        item = value[metric]
        if item is None:
            continue
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise ValueError('production measurement must be a finite number or null: ' + metric)
        result[metric] = float(item)
    return result


def validate_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError('spec must be a dict')
    if spec.get('style') not in STYLES:
        raise ValueError('style must be photorealistic or stylized')
    validate_pins(spec.get('assets'), root=spec.get('root', '.'))
    frames = spec.get('frames', 30)
    if type(frames) is not int or frames < 1:
        raise ValueError('frames must be a positive int')
    _production_measurements(spec)
    return dict(spec, style=spec['style'], frames=frames,
                master_seed=spec.get('master_seed', ISSUE87_SEED))


def _import(name, label):
    try:
        return __import__(name)
    except ImportError as error:
        raise ValueError(label + ' asset requires its specialist module') from error


def _set_metric(out, metric, value, source):
    if out[metric] is None:
        out[metric] = value
        out['measurement_sources'][metric] = source


def simulate(spec):
    """Assemble validated metrics; absent subsystems stay unavailable."""
    spec = validate_spec(spec)
    seed = spec['master_seed']
    production = _production_measurements(spec)
    out = {'version': VERSION, 'style': spec['style'], 'frames': spec['frames'],
           'measurement_sources': {}, 'production_measurements': production,
           'subsystem_failures': {}}
    for metric in METRICS:
        out[metric] = production.get(metric)
        if metric in production:
            out['measurement_sources'][metric] = 'production'
    out['subsystem_manifests'] = {}
    kinds = {a.get('kind') for a in spec['assets'] if isinstance(a, dict)}
    if 'kin' in kinds:
        anatomy = _import('human_anatomy_sim', 'kin').evaluate(
            {'style': spec['style'], 'assets': spec['assets'], 'frames': spec['frames'],
             'master_seed': seed,
             **{k: spec[k] for k in ('root', 'limit_scale', 'normalize_pose', 'volume_corrective') if k in spec}})
        _set_metric(out, 'joint_rms_deg', anatomy['joint_rms_deg'], 'model')
        _set_metric(out, 'volume_preservation', anatomy['volume_preservation'], 'model')
        out.update(manifest_sha256=anatomy['manifest_sha256'], anatomy_source='human_anatomy_sim.evaluate',
                   anatomy_passed=anatomy['passed'], anatomy_checks=anatomy.get('checks'),
                   anatomy_baseline=anatomy['baseline'])
        out['subsystem_manifests']['anatomy'] = anatomy['manifest_sha256']
    if kinds & {'skin', 'hair'}:
        skin_hair = _import('human_skin_hair', 'skin/hair').evaluate(
            {'style': spec['style'], 'master_seed': seed, 'groom': bool(spec.get('groom', True)),
             **({'source_commit': spec['source_commit']} if 'source_commit' in spec else {})})
        _set_metric(out, 'skin_stretch', skin_hair['skin_stretch'], 'analytical-model')
        _set_metric(out, 'hair_deviation_mm', skin_hair['hair_deviation_mm'], 'analytical-model')
        out.update(skin_hair_source='human_skin_hair.evaluate')
        if 'passed' in skin_hair:
            out['skin_hair_passed'] = skin_hair['passed']
        if 'checks' in skin_hair:
            out['skin_hair_checks'] = skin_hair['checks']
        out['subsystem_manifests']['skin_hair'] = skin_hair['manifest_sha256']
    if kinds & {'motion', 'bvh', 'collision'}:
        motion = _import('motion_collision', 'motion').audit(
            {'style': spec['style'], 'master_seed': seed,
             **{k: spec[k] for k in ('takes', 'count', 'source_commit', 'capsule_radii_m') if k in spec}})
        _set_metric(out, 'min_clearance_mm', motion['metrics']['body_self_clearance_mm'], 'model')
        out.update(motion_source='motion_collision.audit', motion_passed=motion['passed'],
                   motion_checks=motion.get('checks'), motion_metrics=motion['metrics'])
        out['subsystem_manifests']['motion'] = motion['manifest_sha256']
    if 'cloth' in kinds:
        record = spec.get('cloth_comparison')
        if not isinstance(record, dict) or not isinstance(record.get('scenarios'), list):
            raise ValueError('cloth asset requires spec.cloth_comparison (S2 record)')
        chosen = [s for s in record['scenarios'] if s.get('seam_contact')]
        if not chosen:
            raise ValueError('cloth comparison has no seam_contact scenario')
        scenario = chosen[-1]
        _set_metric(out, 'cloth_penetration_mm', scenario['cloth_penetration_mm'], 'record')
        _set_metric(out, 'cloth_stretch', scenario['cloth_stretch'], 'record')
        out.update(cloth_source='cloth-contact-comparison.json:seam_contact',
                   cloth_scenario={k: scenario[k] for k in
                                   ('relax', 'fabric', 'seam_penetration_mm',
                                    'seam_clearance_mm', 'cloth_stretch')})
    out['unavailable'] = sorted(m for m in METRICS if out[m] is None)
    for metric in METRICS:
        out['measurement_sources'].setdefault(metric, 'unavailable')
    out['production_unavailable'] = sorted(
        metric for metric in METRICS if out['measurement_sources'][metric] != 'production')
    failures = {}
    for label in ('anatomy', 'motion', 'skin_hair'):
        passed = out.get(label + '_passed')
        checks = out.get(label + '_checks') or {}
        failed = sorted(name for name, ok in checks.items() if ok is False)
        if passed is False or failed:
            failures[label] = failed or ['passed']
    out['subsystem_failures'] = failures
    if 'manifest_sha256' not in out:
        out['manifest_sha256'] = hashlib.sha256(json.dumps(
            {'seed': seed, 'assets': spec['assets'], 'manifests': out['subsystem_manifests']},
            sort_keys=True).encode()).hexdigest()
    return out


def compare(baseline, candidate):
    """Pass claims cover available metrics; production and failures are explicit."""
    if baseline.get('style') != candidate.get('style'):
        raise ValueError('comparison requires same style')
    limits = THRESHOLDS[candidate['style']]
    checks, deltas, unavailable = {}, {}, []
    for metric, (kind, limit) in limits.items():
        value = candidate.get(metric)
        if value is None:
            unavailable.append(metric)
            continue
        checks[metric] = (value <= limit) if kind == 'max' else (value >= limit)
        if baseline.get(metric) is not None:
            deltas[metric] = round(value - baseline[metric], 6)
    failures = dict(candidate.get('subsystem_failures') or {})
    for label in ('anatomy', 'motion', 'skin_hair'):
        if candidate.get(label + '_passed') is False:
            failures.setdefault(label, ['passed'])
    passed = bool(checks) and all(checks.values()) and not failures
    production_unavailable = sorted(candidate.get('production_unavailable') or [])
    return {
        'passed': passed,
        'checks': checks,
        'deltas': deltas,
        'unavailable': sorted(unavailable),
        'subsystem_failures': failures,
        'production_unavailable': production_unavailable,
        'production_passed': passed and not production_unavailable,
        'measurement_sources': dict(candidate.get('measurement_sources') or {}),
        'thresholds': {k: v[1] for k, v in limits.items() if k in checks},
        'style': candidate['style'],
    }
