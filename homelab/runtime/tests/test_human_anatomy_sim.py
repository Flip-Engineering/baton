import hashlib
import json
import math
import pathlib
import tempfile
import unittest

import human_anatomy_sim as anatomy

ROOT = pathlib.Path(__file__).resolve().parents[3]
PIN = 'a' * 64
COMMIT = anatomy.SOURCE_COMMIT

KIN = {'cast': [
    {'name': 'p10', 'sex': 'f', 'age': 25, 'H': 1.60, 'kg': 55, 'hipFlex': 120.0,
     'kneeFlex': 130.0, 'elbowFlex': 140.0, 'kneeExt': 2.0, 'elbowExt': 3.0,
     'carry': 15.0, 'step': 0.65, 'cadence': 112.0, 'speed': 1.25},
    {'name': 'p50', 'sex': 'f', 'age': 45, 'H': 1.65, 'kg': 70, 'hipFlex': 130.0,
     'kneeFlex': 136.0, 'elbowFlex': 146.0, 'kneeExt': 1.0, 'elbowExt': 2.0,
     'carry': 14.0, 'step': 0.70, 'cadence': 116.0, 'speed': 1.33},
    {'name': 'p90', 'sex': 'm', 'age': 65, 'H': 1.75, 'kg': 90, 'hipFlex': 137.0,
     'kneeFlex': 141.0, 'elbowFlex': 152.0, 'kneeExt': 0.0, 'elbowExt': 1.0,
     'carry': 10.0, 'step': 0.74, 'cadence': 120.0, 'speed': 1.40},
]}
SOFT = {'breastVersion': 5, 'people': [
    {'name': 'p10', 'side': 'L', 'stats': {'converged': True, 'inverted': 0, 'Jmin': 0.80,
     'surfVolCm3': {'ref': 800.0, 'loaded': 795.0, 'errPct': -0.625}}},
]}
PELVIS = {'p10': {
    'solve': {'Jmin': 0.80, 'inverted': 0, 'residualMmS': 2.0},
    'bend': {'dThetaDeg': {'p50': 2.0, 'p95': 9.0, 'max': 30.0}},
    'disp': {'meanMm': 12.0, 'maxMm': 40.0},
}}


def spec(**overrides):
    base = {
        'style': 'photorealistic',
        'frames': 24,
        'assets': [
            {'kind': 'kin', 'path': 'kin.json', 'sha256': PIN, 'source_commit': COMMIT,
             'fixture': True, 'report': KIN},
            {'kind': 'soft', 'path': 'soft.json', 'sha256': PIN, 'source_commit': COMMIT,
             'fixture': True, 'report': SOFT},
            {'kind': 'pelvis', 'path': 'pelvis.json', 'sha256': PIN, 'source_commit': COMMIT,
             'fixture': True, 'report': PELVIS},
        ],
    }
    base.update(overrides)
    return base


class AnatomyModel(unittest.TestCase):
    def test_seed_determinism_and_subsystem_derivation(self):
        first = anatomy.evaluate(spec())
        second = anatomy.evaluate(spec())
        self.assertEqual(first, second)
        self.assertEqual(len(anatomy.DEFAULT_SEED), 128)
        self.assertNotEqual(anatomy.derive_seed(anatomy.DEFAULT_SEED, 'anatomy'),
                            anatomy.derive_seed(anatomy.DEFAULT_SEED, 'deformation'))
        changed = anatomy.evaluate(spec(master_seed=anatomy.ISSUE87_SEED))
        self.assertNotEqual(first['joint_rms_deg'], changed['joint_rms_deg'])
        self.assertNotEqual(first['manifest_sha256'], changed['manifest_sha256'])

    def test_metrics_are_in_range_and_default_candidate_is_volume_only(self):
        report = anatomy.evaluate(spec())
        self.assertTrue(0.0 <= report['joint_rms_deg'] < 10.0)
        self.assertTrue(0.5 <= report['volume_preservation'] <= 1.0)
        self.assertEqual(report['joint_rms_deg'], report['baseline']['joint_rms_deg'])
        self.assertGreater(report['volume_preservation'], report['baseline']['volume_preservation'])
        self.assertTrue(report['passed'])
        self.assertTrue(report['qualification']['ready'])
        self.assertEqual(report['thresholds'], {'joint_rms_deg': 2.0, 'volume_preservation': 0.97})
        clamped = anatomy.evaluate(spec(normalize_pose=True))
        self.assertEqual(clamped['joint_rms_deg'], 0.0)
        self.assertNotEqual(clamped['manifest_sha256'], report['manifest_sha256'])

    def test_stylized_uses_looser_thresholds_and_limit_scale(self):
        photo = anatomy.evaluate(spec(style='photorealistic'))
        styl = anatomy.evaluate(spec(style='stylized'))
        self.assertEqual(photo['style'], 'photorealistic')
        self.assertEqual(styl['style'], 'stylized')
        self.assertGreater(styl['thresholds']['joint_rms_deg'], photo['thresholds']['joint_rms_deg'])
        self.assertLess(styl['thresholds']['volume_preservation'],
                        photo['thresholds']['volume_preservation'])
        self.assertEqual(styl['model']['limit_scale'], 1.10)

    def test_compare_rejects_style_mixing_and_reports_deltas(self):
        base = anatomy.evaluate(spec())
        cand = anatomy.evaluate(spec(style='stylized'))
        with self.assertRaises(ValueError):
            anatomy.compare(base, cand)
        result = anatomy.compare(base, base)
        self.assertTrue(result['passed'])
        self.assertEqual(result['deltas']['joint_rms_deg'], 0.0)

    def test_lbs_volume_factor_is_monotone_and_dimensionally_isotropic(self):
        self.assertAlmostEqual(anatomy.lbs_volume_factor(0), 1.0)
        values = [anatomy.lbs_volume_factor(angle) for angle in (0, 30, 60, 90, 120, 180)]
        self.assertEqual(values, sorted(values, reverse=True))
        base = 1.0 - anatomy.BLEND_FRACTION * 2.0 / 3.0
        self.assertAlmostEqual(anatomy.lbs_volume_factor(180), base ** anatomy.LBS_VOLUME_EXPONENT)
        for angle in (30, 60, 90, 120, 180):
            linear_sq = 1.0 - anatomy.BLEND_FRACTION * (
                1.0 - math.cos(math.radians(angle))) / 3.0
            self.assertAlmostEqual(anatomy.lbs_volume_factor(angle),
                                   linear_sq ** anatomy.LBS_VOLUME_EXPONENT)
        repaired = anatomy.lbs_volume_factor(180, corrective=True)
        self.assertGreater(repaired, values[-1])
        self.assertLessEqual(repaired, 1.0)

    def test_fail_closed_on_bad_pins_missing_kin_and_nonfinite_values(self):
        with self.assertRaises(ValueError):
            anatomy.evaluate(spec(assets=[]))
        with self.assertRaises(ValueError):
            anatomy.evaluate({'style': 'realistic', 'assets': spec()['assets']})
        with self.assertRaises(ValueError):
            anatomy.evaluate(spec(frames=0))
        with self.assertRaises(ValueError):
            anatomy.evaluate(spec(assets=[{'kind': 'soft', 'path': 's', 'sha256': PIN,
                                           'source_commit': COMMIT, 'fixture': True,
                                           'report': SOFT}]))
        bad = json.loads(json.dumps(KIN))
        bad['cast'][0]['hipFlex'] = float('nan')
        with self.assertRaises(ValueError):
            anatomy.evaluate(spec(assets=[{'kind': 'kin', 'path': 'k', 'sha256': PIN,
                                           'source_commit': COMMIT, 'fixture': True,
                                           'report': bad}]))
        with self.assertRaises(ValueError):
            anatomy.evaluate(spec(assets=[{'kind': 'kin', 'path': 'k', 'sha256': PIN,
                                           'source_commit': COMMIT, 'report': KIN}]))
        with self.assertRaises(ValueError):
            anatomy.evaluate(spec(assets=[{'kind': 'kin', 'path': 'k', 'sha256': PIN,
                                           'source_commit': 'c' * 40, 'fixture': True,
                                           'report': KIN}]))

    def test_file_pin_mismatch_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'kin.json'
            path.write_text(json.dumps(KIN))
            asset = {'kind': 'kin', 'path': 'kin.json', 'sha256': 'c' * 64,
                     'source_commit': COMMIT}
            with self.assertRaises(ValueError):
                anatomy.evaluate({'style': 'photorealistic', 'assets': [asset], 'root': tmp})

    def test_soft_and_pelvis_aggregation_match_committed_assets(self):
        soft_report = json.loads((ROOT / 'videos/review/studio_human_c8/after/anat8_body/measures/soft_i11.json').read_text())
        soft = anatomy.soft_metrics(soft_report)
        self.assertEqual(soft['count'], 4)
        self.assertEqual(soft['inverted'], 0)
        self.assertTrue(0.99 <= soft['volume_min'] <= 1.0)
        pelvis_report = json.loads((ROOT / 'videos/review/studio_human_c8/after/anat8_pelvis/measures/solve_i16.json').read_text())
        pelvis = anatomy.pelvis_metrics(pelvis_report)
        self.assertEqual(pelvis['count'], 12)
        self.assertEqual(pelvis['inverted'], 0)
        self.assertAlmostEqual(pelvis['jmin_min'], 0.435)
        self.assertAlmostEqual(pelvis['bend_p95_max_deg'], 10.5)

    def test_manifest_binds_effective_flags(self):
        repaired = anatomy.evaluate(spec(volume_corrective=True))
        raw = anatomy.evaluate(spec(volume_corrective=False))
        self.assertNotEqual(repaired['manifest_sha256'], raw['manifest_sha256'])
        self.assertNotEqual(repaired['volume_preservation'], raw['volume_preservation'])
        again = anatomy.evaluate(spec(volume_corrective=True))
        self.assertEqual(repaired['manifest_sha256'], again['manifest_sha256'])
        clamped = anatomy.evaluate(spec(normalize_pose=True))
        self.assertNotEqual(clamped['manifest_sha256'], repaired['manifest_sha256'])

    def test_source_pins_match_the_pinned_git_blobs(self):
        result = anatomy.verify_source_pins_git(ROOT)
        self.assertEqual(result['method'], 'git')
        self.assertEqual(result['missing'], [])
        self.assertEqual(result['mismatched'], [])
        self.assertEqual(len(result['verified']), len(anatomy.SOURCE_PINS))

    def test_human_sim_hook_shape_with_unrelated_pins_and_default_root(self):
        kin_pin = anatomy.ASSET_PINS[0]
        hook_spec = {
            'style': 'photorealistic',
            'frames': 12,
            'master_seed': anatomy.ISSUE87_SEED,
            'assets': [
                {'kind': 'kin', 'path': kin_pin['path'], 'sha256': kin_pin['sha256'],
                 'source_commit': anatomy.SOURCE_COMMIT},
                {'path': 'videos/web/lib/fx/material/other.js', 'sha256': 'c' * 64,
                 'source_commit': anatomy.SOURCE_COMMIT},
                {'kind': 'material', 'path': 'videos/web/lib/fx/material/body.js',
                 'sha256': 'd' * 64, 'source_commit': anatomy.SOURCE_COMMIT},
            ],
        }
        report = anatomy.evaluate(hook_spec)
        for key in ('joint_rms_deg', 'volume_preservation', 'manifest_sha256',
                    'version', 'passed', 'baseline'):
            self.assertIn(key, report)
        self.assertEqual(report['evidence']['cast']['count'], 31)
        without_other = anatomy.evaluate(dict(hook_spec, assets=hook_spec['assets'][:1]))
        self.assertNotEqual(report['manifest_sha256'], without_other['manifest_sha256'])

    def test_existing_assets_compare_photoreal_fails_raw_volume(self):
        result = anatomy.compare_existing_assets()
        self.assertEqual(result['asset_verification']['missing'], [])
        self.assertEqual(result['asset_verification']['mismatched'], [])
        self.assertEqual(result['source_verification']['missing'], [])
        self.assertEqual(result['source_verification']['mismatched'], [])
        self.assertEqual(len(result['source_verification']['verified']), len(anatomy.SOURCE_PINS))
        photo = result['styles']['photorealistic']
        styl = result['styles']['stylized']
        self.assertEqual(photo['evidence']['cast']['count'], 31)
        self.assertEqual(photo['evidence']['soft']['count'], 4)
        self.assertEqual(photo['evidence']['pelvis'][0]['count'], 12)
        self.assertLess(photo['baseline']['volume_preservation'], 0.97)
        self.assertEqual(photo['joint_rms_deg'], photo['baseline']['joint_rms_deg'])
        self.assertTrue(photo['passed'])
        self.assertTrue(styl['passed'])
        self.assertTrue(styl['baseline']['joint_rms_deg'] >= 0.0)
        for report in (photo, styl):
            self.assertRegex(report['manifest_sha256'], r'^[0-9a-f]{64}$')

    def test_source_pin_verifier_reports_missing_and_mismatch(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = anatomy.verify_source_pins(tmp)
            self.assertEqual(result['verified'], [])
            self.assertEqual(len(result['missing']), len(anatomy.SOURCE_PINS))
            target = pathlib.Path(tmp) / anatomy.SOURCE_PINS[0]['path']
            target.parent.mkdir(parents=True)
            target.write_text('not the pinned source')
            result = anatomy.verify_source_pins(tmp)
            self.assertEqual(len(result['mismatched']), 1)
            self.assertEqual(result['mismatched'][0]['path'], anatomy.SOURCE_PINS[0]['path'])


if __name__ == '__main__':
    unittest.main()
