import hashlib, pathlib, sys, tempfile, types, unittest, unittest.mock
import human_sim

COMMIT = 'b' * 40

def fixture(tmp, kind=None, name='asset.json'):
    path = pathlib.Path(tmp) / name
    path.write_bytes(b'{"fixture": true}')
    pin = {'path': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'source_commit': COMMIT}
    if kind: pin['kind'] = kind
    return pin

class HumanSim(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.pin = fixture(self.tmp.name)

    def spec(self, **kw):
        base = dict(style='photorealistic', root=self.tmp.name, assets=[self.pin])
        base.update(kw); return base

    def test_missing_subsystems_are_unavailable_not_invented(self):
        out = human_sim.simulate(self.spec())
        self.assertTrue(all(out[m] is None for m in human_sim.METRICS))
        self.assertEqual(out['unavailable'], sorted(human_sim.METRICS))
        rep = human_sim.compare(out, out)
        self.assertFalse(rep['passed']); self.assertEqual(rep['checks'], {})
        self.assertEqual(rep['unavailable'], sorted(human_sim.METRICS))

    def test_pin_bytes_and_shape_fail_closed(self):
        bad = dict(self.pin, sha256='a' * 64)
        with self.assertRaises(ValueError): human_sim.simulate(self.spec(assets=[bad]))
        with self.assertRaises(ValueError): human_sim.simulate(self.spec(assets=[dict(self.pin, sha256='bad')]))
        with self.assertRaises(ValueError): human_sim.simulate(self.spec(assets=[dict(self.pin, path='missing.json')]))
        with self.assertRaises(ValueError): human_sim.simulate(self.spec(style='realistic'))

    def test_seed_derivation_contract(self):
        self.assertNotEqual(human_sim.derive_seed(human_sim.ISSUE87_SEED, 'cloth'),
                            human_sim.derive_seed(human_sim.ISSUE87_SEED, 'hair'))
        with self.assertRaises(ValueError): human_sim.derive_seed('zz', 'cloth')

    def test_kin_overlay_from_actual_module(self):
        stub = types.ModuleType('human_anatomy_sim')
        stub.evaluate = lambda req: {'joint_rms_deg': 0.12077, 'volume_preservation': 0.992686,
            'manifest_sha256': 'c' * 64, 'passed': True,
            'baseline': {'joint_rms_deg': 0.80514, 'volume_preservation': 0.959417}}
        kin = fixture(self.tmp.name, kind='kin', name='kin.json')
        with unittest.mock.patch.dict(sys.modules, {'human_anatomy_sim': stub}):
            out = human_sim.simulate(self.spec(assets=[kin]))
        self.assertEqual((out['joint_rms_deg'], out['volume_preservation']), (0.12077, 0.992686))
        self.assertNotIn('joint_rms_deg', out['unavailable'])
        self.assertIn('skin_stretch', out['unavailable'])
        rep = human_sim.compare(out, out)
        self.assertTrue(rep['passed']); self.assertEqual(set(rep['checks']), {'joint_rms_deg', 'volume_preservation'})

    def test_skin_motion_cloth_overlays(self):
        sh = types.ModuleType('human_skin_hair')
        sh.evaluate = lambda req: {'skin_stretch': 1.031, 'hair_deviation_mm': 1.42, 'manifest_sha256': 'd' * 64}
        mc = types.ModuleType('motion_collision')
        mc.audit = lambda req: {'metrics': {'body_self_clearance_mm': 7.5}, 'passed': True, 'manifest_sha256': 'e' * 64}
        record = {'scenarios': [{'seam_contact': True, 'relax': 0, 'fabric': 'chambray',
            'seam_penetration_mm': 0, 'seam_clearance_mm': 2.65, 'cloth_penetration_mm': 0, 'cloth_stretch': 1.006763}]}
        assets = [fixture(self.tmp.name, 'skin', 's.json'), fixture(self.tmp.name, 'motion', 'm.bvh'),
                  fixture(self.tmp.name, 'cloth', 'c.js')]
        with unittest.mock.patch.dict(sys.modules, {'human_skin_hair': sh, 'motion_collision': mc}):
            out = human_sim.simulate(self.spec(assets=assets, cloth_comparison=record))
            self.assertEqual((out['skin_stretch'], out['min_clearance_mm'], out['cloth_penetration_mm']), (1.031, 7.5, 0))
            with self.assertRaises(ValueError):
                human_sim.simulate(self.spec(assets=assets))

    def test_analytical_skin_hair_is_not_a_production_measurement(self):
        sh = types.ModuleType('human_skin_hair')
        sh.evaluate = lambda req: {'skin_stretch': 1.01, 'hair_deviation_mm': 1.2,
                                   'manifest_sha256': 'd' * 64}
        skin = fixture(self.tmp.name, 'skin', 's.json')
        with unittest.mock.patch.dict(sys.modules, {'human_skin_hair': sh}):
            out = human_sim.simulate(self.spec(assets=[skin]))
        self.assertEqual(out['measurement_sources']['skin_stretch'], 'analytical-model')
        self.assertEqual(out['measurement_sources']['hair_deviation_mm'], 'analytical-model')
        self.assertIn('skin_stretch', out['production_unavailable'])
        rep = human_sim.compare(out, out)
        self.assertTrue(rep['passed'])
        self.assertFalse(rep['production_passed'])
        self.assertIn('skin_stretch', rep['production_unavailable'])

    def test_production_measurements_override_and_are_labelled(self):
        sh = types.ModuleType('human_skin_hair')
        sh.evaluate = lambda req: {'skin_stretch': 1.20, 'hair_deviation_mm': 9.0,
                                   'manifest_sha256': 'd' * 64}
        skin = fixture(self.tmp.name, 'skin', 's.json')
        with unittest.mock.patch.dict(sys.modules, {'human_skin_hair': sh}):
            out = human_sim.simulate(self.spec(assets=[skin], production_measurements={
                'skin_stretch': 1.01, 'hair_deviation_mm': 1.2}))
        self.assertEqual((out['skin_stretch'], out['hair_deviation_mm']), (1.01, 1.2))
        self.assertEqual(out['measurement_sources']['skin_stretch'], 'production')
        self.assertIn('joint_rms_deg', out['production_unavailable'])
        all_production = {'joint_rms_deg': 0.2, 'volume_preservation': 0.99,
                          'cloth_penetration_mm': 0.0, 'cloth_stretch': 1.0,
                          'skin_stretch': 1.0, 'hair_deviation_mm': 1.0,
                          'min_clearance_mm': 5.0}
        complete = human_sim.simulate(self.spec(production_measurements=all_production))
        rep = human_sim.compare(complete, complete)
        self.assertTrue(rep['passed'])
        self.assertTrue(rep['production_passed'])
        self.assertEqual(rep['production_unavailable'], [])
        self.assertEqual(set(rep['measurement_sources'].values()), {'production'})

    def test_subsystem_failures_propagate(self):
        anatomy = types.ModuleType('human_anatomy_sim')
        anatomy.evaluate = lambda req: {'joint_rms_deg': 0.1, 'volume_preservation': 0.99,
            'manifest_sha256': 'c' * 64, 'passed': False,
            'checks': {'joint_rms_deg': False, 'volume_preservation': True},
            'baseline': {'joint_rms_deg': 0.8, 'volume_preservation': 0.96}}
        kin = fixture(self.tmp.name, 'kin', 'kin.json')
        with unittest.mock.patch.dict(sys.modules, {'human_anatomy_sim': anatomy}):
            out = human_sim.simulate(self.spec(assets=[kin]))
        rep = human_sim.compare(out, out)
        self.assertFalse(rep['passed'])
        self.assertEqual(rep['subsystem_failures']['anatomy'], ['joint_rms_deg'])
        self.assertFalse(rep['production_passed'])

        motion = types.ModuleType('motion_collision')
        motion.audit = lambda req: {'metrics': {'body_self_clearance_mm': 5.0},
                                    'passed': False, 'manifest_sha256': 'e' * 64}
        bvh = fixture(self.tmp.name, 'motion', 'm.bvh')
        with unittest.mock.patch.dict(sys.modules, {'motion_collision': motion}):
            out = human_sim.simulate(self.spec(assets=[bvh]))
        self.assertFalse(human_sim.compare(out, out)['passed'])

        sh = types.ModuleType('human_skin_hair')
        sh.evaluate = lambda req: {'skin_stretch': 1.0, 'hair_deviation_mm': 1.0,
                                   'manifest_sha256': 'd' * 64, 'passed': False,
                                   'checks': {'skin_stretch': False}}
        skin = fixture(self.tmp.name, 'skin', 's2.json')
        with unittest.mock.patch.dict(sys.modules, {'human_skin_hair': sh}):
            out = human_sim.simulate(self.spec(assets=[skin]))
        rep = human_sim.compare(out, out)
        self.assertFalse(rep['passed'])
        self.assertEqual(rep['subsystem_failures']['skin_hair'], ['skin_stretch'])

    def test_style_thresholds_recorded(self):
        self.assertGreater(human_sim.THRESHOLDS['stylized']['joint_rms_deg'][1],
                           human_sim.THRESHOLDS['photorealistic']['joint_rms_deg'][1])

if __name__ == '__main__': unittest.main()
