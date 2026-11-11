import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import human_integration as integration

REPO = HERE.parents[2]
SEED = 'f7508e0dead8aee03c8c98e2643069ae56bf1281febff62fd25dfbb006a94e2a6cfb8f89d5e60f40db709d19e4e8ffe398eedc039689e89b5b64993eefb3c6b2'
GOLDEN_SEEDS = {
    'anatomy': 12291250655184750784,
    'cloth': 4923195983857840051,
    'skin': 13991814265928222421,
    'hair': 10810237009745493656,
    'collision': 8412339064809474792,
    'rig': 15273355734386802396,
}


class HumanIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not (REPO / '.git').exists():
            raise unittest.SkipTest('not a git checkout')
        try:
            cls.report = integration.build_report(REPO, integration.PINNED_COMMIT, SEED)
        except integration.ContractError as error:
            if 'not present' in str(error):
                raise unittest.SkipTest(str(error))
            raise

    def require_node(self):
        if not self.report['toolchain']['node']['available']:
            self.skipTest('node is unavailable')

    def test_seed_contract_matches_coordinated_preflight(self):
        for subsystem, expected in GOLDEN_SEEDS.items():
            self.assertEqual(integration.derive_seed(SEED, subsystem), expected)
        self.assertNotEqual(integration.derive_seed(SEED, 'motion'),
                            integration.derive_seed(SEED, 'collision'))
        with self.assertRaises(integration.ContractError):
            integration.derive_seed('not-a-seed', 'anatomy')
        with self.assertRaises(integration.ContractError):
            integration.derive_seed(SEED, 'unknown')

    def test_source_pins_are_read_from_the_commit(self):
        source = integration.SourceCommit(REPO, integration.PINNED_COMMIT)
        pin = source.pin('homelab/runtime/person_anatomy.py')
        self.assertEqual(pin['sha256'], 'ca65c52e38079005c1ed648194bcc1c74b48e0b4ff044f80f6d391fcc0f64a5c')
        self.assertEqual(pin['git_blob'], '7ca01e5cbf0bd573b0108b51b202f81753dd0cbe')
        self.assertEqual(pin['bytes'], 5185)
        for path in ('../outside.py', '/etc/passwd', 'a\\b.py'):
            with self.subTest(path=path), self.assertRaises(integration.ContractError):
                source.pin(path)
        with self.assertRaises(integration.ContractError):
            source.pin('homelab/runtime/not-present.py')
        with self.assertRaises(integration.ContractError):
            integration.SourceCommit(REPO, '0' * 40)
        with self.assertRaises(integration.ContractError):
            integration.SourceCommit(REPO, integration.PINNED_COMMIT.upper())

    def test_report_passes_and_covers_every_subsystem(self):
        report = self.report
        self.assertEqual(report['issue'], 87)
        self.assertEqual(report['version'], integration.VERSION)
        self.assertEqual(report['pinned_commit'], integration.PINNED_COMMIT)
        self.assertEqual(set(report['subsystems']), set(integration.SUBSYSTEMS))
        self.assertEqual(report['missing_pins'], [])
        self.assertEqual(set(report['pins']), set(integration.PIN_PATHS))
        for path, pin in report['pins'].items():
            self.assertTrue(integration._is_hex(pin['sha256'], 64), path)
            self.assertTrue(integration._is_hex(pin['git_blob'], 40), path)
        if report['toolchain']['node']['available']:
            self.assertTrue(report['passed'])
        else:
            self.assertFalse(report['passed'])
            self.assertIn('node checks unavailable', report['incomplete'])

    def test_contracts_measure_cloth_skin_hair_motion_and_style(self):
        subsystems = self.report['subsystems']
        cloth = subsystems['cloth_contact']
        self.assertTrue(cloth['checks']['cloth_contact_floor'])
        self.assertEqual(cloth['metrics']['defaults']['sub'], 4)
        self.assertEqual(cloth['metrics']['defaults']['relax'], 16)
        self.assertEqual(cloth['metrics']['fabric_count'], 9)
        self.assertEqual(len(cloth['metrics']['fabrics']), 9)

        skin = subsystems['skin_hair']
        self.assertEqual(skin['metrics']['fine_source_sha256'],
                         'a85f51a9870a730b8516aa1bf9c8b1181d7dc1b64d463a21cd74bae3b3506193')
        self.assertEqual(skin['metrics']['hair_channels'], 9)
        self.assertTrue(skin['checks']['scene_hair_groom_gate'])
        self.assertTrue(skin['checks']['scene_skin_sss'])

        motion = subsystems['motion_collision']
        self.assertEqual(motion['metrics']['bake_defaults']['key'], 1)
        self.assertEqual(motion['metrics']['bake_defaults']['every'], 2)
        self.assertIs(motion['metrics']['scene_bake']['cloth'], False)
        self.assertEqual(motion['metrics']['scene_bake']['hair'], '!!P.groom')
        self.assertEqual(motion['metrics']['scene_bake']['key'], 3)
        self.assertEqual(motion['metrics']['clips'], ['row7', 'walk7', 'lift7', 'wave7'])

        style = subsystems['style']
        self.assertEqual(style['metrics']['scene']['look'], 'cold')
        self.assertEqual(len(style['metrics']['scene_people']), 6)
        self.assertTrue(style['checks']['scene_ink_register'])
        self.assertTrue(style['checks']['scene_duotone_layers'])
        if self.report['toolchain']['node']['available']:
            self.assertEqual(style['metrics']['photoreal']['medium'], {'kind': 'lit', 'meter': 'face'})
            self.assertEqual(style['metrics']['notan']['medium']['kind'], 'designed')
            self.assertTrue(style['checks']['notan_line_weight'])

    def test_merged_anatomy_qualification_accepts_s1_blobs(self):
        present = subprocess.run(
            ['git', '-C', str(REPO), 'cat-file', '-e', integration.MERGED_SOURCE['commit']],
            capture_output=True)
        if present.returncode:
            self.skipTest('merged source commit is not present')
        source = integration.SourceCommit(REPO, integration.PINNED_COMMIT)
        self.assertEqual(set(integration.MERGED_QUALIFICATIONS), {
            'homelab/runtime/person_anatomy.py',
            'homelab/runtime/person_pelvis.py',
        })
        for path, digest in integration.MERGED_QUALIFICATIONS.items():
            self.assertTrue(integration._is_hex(digest, 64), path)
            self.assertNotEqual(digest, source.read(path)['sha256'])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for relative in integration.PY_RUNTIME:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(subprocess.run(
                    ['git', '-C', str(REPO), 'show', f'{integration.PINNED_COMMIT}:{relative}'],
                    capture_output=True, check=True).stdout)
            merged_commit = integration.MERGED_SOURCE['commit']
            for relative in integration.MERGED_QUALIFICATIONS:
                (root / relative).write_bytes(subprocess.run(
                    ['git', '-C', str(REPO), 'show', f'{merged_commit}:{relative}'],
                    capture_output=True, check=True).stdout)
            qualified, reason, qualifications = integration._worktree_state(
                root, integration.PINNED_COMMIT, source)
            self.assertTrue(qualified, reason)
            self.assertEqual({path for path, kind in qualifications.items() if kind == 'merged'},
                             set(integration.MERGED_QUALIFICATIONS))
            (root / 'homelab/runtime/person_fine_context.py').write_text('unqualified')
            qualified, reason, _ = integration._worktree_state(
                root, integration.PINNED_COMMIT, source)
            self.assertFalse(qualified)
            self.assertIn('person_fine_context.py', reason)

    def test_shared_anatomy_probe_executes_the_export_path(self):
        probe = self.report['integration']['probe']
        if probe['status'] == 'skipped':
            self.skipTest(probe.get('reason', 'pinned worktree is not checked out'))
        self.assertEqual(probe['status'], 'ok')
        self.assertTrue(probe['ok'])
        self.assertTrue(all(probe['checks'].values()))
        self.assertEqual(probe['execution']['cmd'][1], 'web/labs/human8/export_person.mjs')
        self.assertIn('ACP_SOFT_PARALLEL', probe['execution']['env_keys'])
        self.assertIn('ACP_PELVIS_COALESCE', probe['execution']['env_keys'])
        self.assertEqual(len(probe['execution']['node_imports']), 3)
        self.assertEqual(len(probe['execution']['materialized']), 4)
        self.assertTrue(integration._is_hex(probe['wrapper_sha256'], 64))
        self.assertEqual(set(probe['qualifications']), set(integration.PY_RUNTIME))
        self.assertTrue(all(kind in ('pinned', 'merged') for kind in probe['qualifications'].values()))
        self.assertTrue(set(probe['merged_qualifications']) <= set(integration.WORKTREE_QUALIFICATIONS))

    def test_report_is_reproducible_and_comparison_isolates_changes(self):
        again = integration.build_report(REPO, integration.PINNED_COMMIT, SEED)
        self.assertEqual(self.report, again)
        same = integration.compare_reports(self.report, again)
        self.assertTrue(same['passed'])
        self.assertFalse(same['review_required'])
        self.assertEqual(same['changed_pins'], [])

        changed = copy.deepcopy(again)
        path = 'homelab/runtime/person_anatomy.py'
        changed['pins'][path]['sha256'] = 'f' * 64
        changed['subsystems']['cloth_contact']['metrics']['defaults']['sub'] = 8
        changed['subsystems']['skin_hair']['checks']['scene_skin_sss'] = False
        diff = integration.compare_reports(self.report, changed)
        self.assertEqual(diff['changed_pins'], [path])
        self.assertEqual(diff['metric_deltas']['cloth_contact/defaults/sub'],
                         {'baseline': 4, 'candidate': 8})
        self.assertEqual(diff['contract_deltas']['skin_hair/scene_skin_sss'],
                         {'baseline': True, 'candidate': False})
        self.assertTrue(diff['review_required'])

    def test_minimum_render_plan_is_inert_and_admission_checked(self):
        plan = integration.minimum_render_comparison()
        self.assertEqual(plan['status'], 'not_started')
        self.assertTrue(plan['admission_required'])
        self.assertEqual(plan['frames'], 2)
        self.assertEqual(plan['gpu_slots'], 1)
        self.assertEqual(plan['resolution'], [1080, 1920])
        self.assertEqual(plan['registers'], ['cold', 'ink'])
        self.assertEqual(plan['beat'], 18)
        self.assertGreater(plan['memory_bytes'], 0)
        self.assertFalse(self.report['render']['needed_for_this_workstream'])
        with self.assertRaises(integration.ContractError):
            integration.minimum_render_comparison(active_ids=[plan['job_id']])
        for memory in (0, -1, 1.5, '8589934592', None):
            with self.subTest(memory=memory), self.assertRaises(integration.ContractError):
                integration.minimum_render_comparison(memory_bytes=memory)

    def test_node_probe_runs_pinned_fabrics_and_hair(self):
        self.require_node()
        node = self.report['node']
        self.assertTrue(all(node['syntax'].values()), node.get('syntaxErrors'))
        fabrics = node['fabrics']
        self.assertEqual(fabrics['version'], 1)
        self.assertEqual(len(fabrics['fabrics']), 9)
        self.assertEqual(set(fabrics['fabrics']), set(fabrics['looks']))
        self.assertEqual(set(fabrics['fabrics']), set(fabrics['cycles']))
        self.assertTrue(fabrics['idempotent'])
        self.assertTrue(all(not missing for missing in fabrics['missingFields'].values()))
        self.assertEqual(fabrics['tableRows'], 9)
        self.assertEqual(fabrics['knit'] + fabrics['woven'], 9)
        hair = node['hair']
        self.assertEqual(hair['groups'], ['L', 'R', 'C'])
        self.assertEqual(hair['channels'], 9)
        self.assertEqual(len(hair['channelKeys']), 9)
        self.assertGreater(hair['peak_m'], 0)
        self.assertEqual(hair['still_m'], 0)
        self.assertTrue(hair['repeat_equal'])
        self.assertEqual(node['grid'],
                         {'self': 0, 'neighbor': 1, 'outside': -1, 'masked': -1})
        self.assertEqual(self.report['registers']['seed']['derived'],
                         self.report['seed']['derived'])

    def test_javascript_option_parser_handles_comments_and_nesting(self):
        text = '''
        {
          // a comment before an entry
          fleece: L({ weave: { kind: 'jersey' }, rough: [0.88, 0.04] }),
          stretch: [3000, 1400],
          contact: true,
          sub = 4
        }
        '''
        options = integration._js_options(integration._object_after(text, '') [1:-1])
        self.assertIn('fleece', options)
        self.assertEqual(options['sub'], 4)
        self.assertIs(options['contact'], True)


if __name__ == '__main__':
    unittest.main()
