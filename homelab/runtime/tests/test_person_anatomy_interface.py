import unittest
from unittest.mock import patch

import human_anatomy_sim as anatomy
import person_anatomy
import person_pelvis

PIN = 'a' * 64
COMMIT = anatomy.SOURCE_COMMIT
KIN = {'cast': [
    {'name': 'p', 'sex': 'f', 'hipFlex': 130.0, 'kneeFlex': 135.0, 'elbowFlex': 145.0},
]}
SOFT = {'breastVersion': 5, 'people': [
    {'name': 'p', 'side': 'L', 'stats': {'converged': True, 'inverted': 0, 'Jmin': 0.8,
     'surfVolCm3': {'ref': 800.0, 'loaded': 795.0, 'errPct': -0.625}}},
]}
PELVIS = {'p': {
    'solve': {'Jmin': 0.8, 'inverted': 0, 'residualMmS': 2.0},
    'bend': {'dThetaDeg': {'p50': 2.0, 'p95': 9.0, 'max': 30.0}},
    'disp': {'meanMm': 12.0, 'maxMm': 40.0},
}}


def spec(assets=None):
    return {'style': 'photorealistic', 'frames': 12, 'assets': assets or [
        {'kind': 'kin', 'path': 'kin.json', 'sha256': PIN, 'source_commit': COMMIT,
         'fixture': True, 'report': KIN},
        {'kind': 'soft', 'path': 'soft.json', 'sha256': PIN, 'source_commit': COMMIT,
         'fixture': True, 'report': SOFT},
    ]}


class AnatomyInterface(unittest.TestCase):
    def test_deformation_preflight_returns_human_sim_metric_names(self):
        report = person_anatomy.deformation_preflight(spec())
        for key in ('joint_rms_deg', 'volume_preservation', 'manifest_sha256',
                    'passed', 'checks', 'deltas', 'thresholds', 'style',
                    'qualification'):
            self.assertIn(key, report)
        self.assertIn('joint_rms_deg', report['checks'])
        self.assertEqual(report['thresholds']['joint_rms_deg'], 2.0)
        self.assertTrue(report['qualification']['ready'])

    def test_qualify_deformation_requires_soft_evidence(self):
        report = person_anatomy.deformation_preflight(spec())
        self.assertIs(person_anatomy.qualify_deformation(report), report)
        kin_only = person_anatomy.deformation_preflight(spec(spec()['assets'][:1]))
        self.assertFalse(kin_only['qualification']['ready'])
        with self.assertRaises(ValueError):
            person_anatomy.qualify_deformation(kin_only)
        bad = dict(report, passed=False, checks=dict(report['checks'], joint_rms_deg=False))
        with self.assertRaises(ValueError):
            person_anatomy.qualify_deformation(bad)
        with self.assertRaises(ValueError):
            person_anatomy.qualify_deformation({'passed': True})
        with self.assertRaises(ValueError):
            person_anatomy.qualify_deformation(report, repo='/nonexistent')

    def test_production_qualification_requires_qualified_source(self):
        with patch.object(person_anatomy, 'qualified', return_value=False):
            with self.assertRaises(ValueError):
                person_anatomy.production_qualification(spec(), '/nonexistent')
        with patch.object(person_anatomy, 'qualified', return_value=True):
            report = person_anatomy.production_qualification(spec(), '/nonexistent')
            self.assertTrue(report['qualification']['ready'])

    def test_pelvis_deformation_metrics(self):
        metrics = person_pelvis.deformation_metrics(PELVIS)
        self.assertEqual(metrics['count'], 1)
        self.assertEqual(metrics['inverted'], 0)
        self.assertEqual(metrics['jmin_min'], 0.8)
        self.assertEqual(metrics['bend_p95_max_deg'], 9.0)


if __name__ == '__main__':
    unittest.main()
