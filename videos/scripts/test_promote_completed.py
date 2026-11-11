import contextlib
import base64
import hashlib
import importlib.util
import io
import json
import multiprocessing
import os
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('promote_under_test', pathlib.Path(__file__).with_name('promote_completed.py'))
PC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PC)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class PromoteCompletedTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.repo = self.root / 'repo'
        (self.repo / 'videos/scripts').mkdir(parents=True)
        lfs_module = self.repo / 'homelab/runtime/protocol/lfs_archive.py'
        lfs_module.parent.mkdir(parents=True)
        lfs_module.write_text('')
        self.farm = self.root / 'farm'
        job = self.farm / 'jobs/protocol-job1'
        job.mkdir(parents=True)
        self.master = self.root / 'atrest4.mp4'
        self.share = self.root / 'atrest4_share.mp4'
        self.master.write_bytes(b'master-bytes')
        self.share.write_bytes(b'share-bytes')
        self.mhash = sha(self.master.read_bytes())
        self.shash = sha(self.share.read_bytes())
        out = job / 'out'
        out.mkdir()
        (out / 'atrest4.mp4').write_bytes(self.master.read_bytes())
        (out / 'atrest4_share.mp4').write_bytes(self.share.read_bytes())
        self.plan = {
            'job': 'job1',
            'title': 'AT_REST_v3',
            'piece': 'AT_REST',
            'source_commit': 'abc123',
            'media': [
                {'name': 'atrest4.mp4', 'sha256': self.mhash, 'path': str(self.master), 'target': 'videos/out/AT_REST_v3.mp4'},
                {'name': 'atrest4_share.mp4', 'sha256': self.shash, 'path': str(self.share), 'target': 'videos/out/AT_REST_v3_share.mp4'},
            ],
        }
        self.protocol = {
            'state': 'delivered',
            'pipeline_job': {
                'id': 'job1', 'piece': 'AT_REST', 'pipeline_commit': 'abc123',
                'run': ['sh', 'videos/scripts/local_render.sh', '--seg', 'at_rest:1'],
                'delivery': {'files': [
                    {'name': 'atrest4.mp4', 'sha256': self.mhash},
                    {'name': 'atrest4_share.mp4', 'sha256': self.shash},
                ]},
            },
        }
        self.receipt = {'output_sha256': self.mhash, 'frames': 10, 'seconds': 1.0, 'full_decode': 'passed'}
        (job / 'protocol.json').write_text(json.dumps(self.protocol))
        (job / 'receipt.json').write_text(json.dumps(self.receipt))
        self.inventory = self.root / 'inventory.json'
        self.inventory.write_text(json.dumps({'plans': [self.plan]}))
        self.ledger = self.root / 'ledger.jsonl'
        self.marker = self.root / 'published.txt'
        self.fake_publish = self.root / 'publish.sh'
        self.fake_publish.write_text(
            '#!/bin/sh\n'
            'echo "$@" >> "$MARKER"\n'
            'echo "published to main (deadbeef)"\n'
        )
        self.env = patch.dict(os.environ, {'MARKER': str(self.marker)})
        self.env.start()
        self.patches = [
            patch.object(PC, 'REPO', self.repo),
            patch.object(PC, 'PUBLISH', self.fake_publish),
            patch.object(PC, 'FARM', self.root / 'farm.py'),
            patch.object(PC, 'MASTER_AUDIO', self.root / 'master_audio.py'),
            patch.object(PC, 'master_media', return_value=''),
            patch.object(PC, 'read_archive_pointers', side_effect=self.fake_read_archive_pointers),
            patch.object(PC, 'verify_lfs_readback', return_value=None),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.env.stop()
        self.tmp.cleanup()

    def fake_read_archive_pointers(self, media_items, ref='main'):
        if not self.marker.exists():
            return {pathlib.Path(item.get('target') or item['name']).name: None for item in media_items}
        return {
            pathlib.Path(item.get('target') or item['name']).name:
                (item['sha256'], item['size'])
            for item in media_items
        }

    def args(self, **kw):
        base = dict(inventory=str(self.inventory), job=None, farm_root=str(self.farm),
                    ledger=str(self.ledger), reservations=str(self.root / 'reservations.jsonl'),
                    lock=str(self.root / 'promotion.lock'),
                    archive_pointers=None, plan=False, dry_run=False, verbose=False)
        base.update(kw)
        return SimpleNamespace(**base)

    def run_cli(self, **kw):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            rc = PC.run(self.args(**kw))
        return rc, out.getvalue()

    def test_split_title(self):
        self.assertEqual(PC.split_title('THE_CHASM_v1_take_a'), ('THE_CHASM', 'v1_take_a'))
        self.assertEqual(PC.split_title('AT_REST_v3'), ('AT_REST', 'v3'))
        with self.assertRaises(ValueError):
            PC.split_title('AT_REST')

    def test_plan_media_selects_master_and_share(self):
        master, share = PC.plan_media(self.plan)
        self.assertTrue(master['name'].endswith('.mp4') and not master['name'].endswith('_share.mp4'))
        self.assertTrue(share['name'].endswith('_share.mp4'))

    def test_verify_plan_accepts_delivered_job(self):
        facts = PC.job_facts(self.farm / 'jobs/protocol-job1')
        master, share = PC.plan_media(self.plan)
        self.assertEqual(PC.verify_plan(self.plan, facts, master, share), [])

    def test_verify_plan_rejects_hash_and_commit_drift(self):
        facts = PC.job_facts(self.farm / 'jobs/protocol-job1')
        master, share = PC.plan_media(self.plan)
        bad = dict(self.plan, source_commit='other')
        self.assertTrue(PC.verify_plan(bad, facts, master, share))
        bad_media = dict(master, sha256='0' * 64)
        self.assertTrue(PC.verify_plan(self.plan, facts, bad_media, share))

    def test_verify_plan_rejects_missing_source_receipt_and_delivery_facts(self):
        facts = PC.job_facts(self.farm / 'jobs/protocol-job1')
        master, share = PC.plan_media(self.plan)
        cases = (
            ('missing source commit', {**facts, 'source_commit': None}, self.plan, master, share, 'job is missing source commit'),
            ('missing piece', {**facts, 'piece': None}, self.plan, master, share, 'job is missing piece'),
            ('missing receipt hash', {**facts, 'output_sha256': None}, self.plan, master, share, 'receipt is missing output_sha256'),
            ('missing master delivery', {**facts, 'delivery_files': [facts['delivery_files'][1]]}, self.plan, master, share, 'atrest4.mp4: delivery record is missing'),
            ('missing share delivery hash', {**facts, 'delivery_files': [facts['delivery_files'][0], {'name': 'atrest4_share.mp4'}]}, self.plan, master, share, 'atrest4_share.mp4: delivery record is missing sha256'),
            ('missing planned source', facts, {**self.plan, 'source_commit': None}, master, share, 'plan is missing source commit'),
        )
        plan_without_piece = dict(self.plan)
        plan_without_piece.pop('piece')
        self.assertEqual(PC.verify_plan(plan_without_piece, facts, master, share), [])
        for label, candidate_facts, candidate_plan, candidate_master, candidate_share, expected in cases:
            with self.subTest(label=label):
                self.assertIn(expected, '; '.join(PC.verify_plan(candidate_plan, candidate_facts, candidate_master, candidate_share)))

    def test_load_pointers_preserves_full_targets_and_root_fallback(self):
        p = self.root / 'pointers.json'
        p.write_text(json.dumps({'videos/out/AT_REST_v3.mp4': self.mhash}))
        pointers = PC.load_pointers(p)
        self.assertEqual(pointers, {'videos/out/AT_REST_v3.mp4': self.mhash})
        self.assertEqual(PC.pointer_for(pointers, 'videos/out/AT_REST_v3.mp4'), self.mhash)
        basename_pointers = {'AT_REST_v3.mp4': self.mhash}
        self.assertEqual(PC.pointer_for(basename_pointers, 'videos/out/AT_REST_v3.mp4'), self.mhash)
        self.assertIsNone(PC.pointer_for(
            basename_pointers, 'videos/out/archive/AT_REST_v3.mp4'))

    def test_run_promotes_once_and_records_ledger(self):
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn('promoted AT_REST_v3 -> deadbeef', out)
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)
        rows = [json.loads(x) for x in self.ledger.read_text().splitlines()]
        self.assertEqual(rows[0]['status'], 'promoted')
        self.assertEqual(rows[0]['archive_commit'], 'deadbeef')
        self.assertEqual(rows[0]['master_target'], 'videos/out/AT_REST_v3.mp4')
        self.assertEqual(rows[0]['share_target'], 'videos/out/AT_REST_v3_share.mp4')
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn('verified row unchanged; skipping media staging/master/readback', out)
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)

    def test_watch_fast_path_skips_staging_master_and_lfs_readback(self):
        fetch_calls = []
        master_calls = []
        real_fetch = PC.fetch_media
        def counted_fetch(plan, job_dir, work):
            fetch_calls.append(plan['job'])
            return real_fetch(plan, job_dir, work)
        def counted_master(plan, media):
            master_calls.append(plan['job'])
            return ''
        with patch.object(PC, 'fetch_media', side_effect=counted_fetch):
            with patch.object(PC, 'master_media', side_effect=counted_master):
                rc, out = self.run_cli()
                self.assertEqual(rc, 0, out)
                self.assertEqual(len(fetch_calls), 1)
                self.assertEqual(len(master_calls), 1)
                self.assertEqual(PC.verify_lfs_readback.call_count, 2)
                PC.verify_lfs_readback.reset_mock()
                fetch_calls.clear()
                master_calls.clear()
                rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn('skipping media staging/master/readback', out)
        self.assertEqual(fetch_calls, [])
        self.assertEqual(master_calls, [])
        self.assertEqual(PC.verify_lfs_readback.call_count, 0)
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)

    def test_watch_fast_path_reports_changed_live_pointer(self):
        rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        fetch_calls = []
        master_calls = []
        real_fetch = PC.fetch_media
        def counted_fetch(plan, job_dir, work):
            fetch_calls.append(plan['job'])
            return real_fetch(plan, job_dir, work)
        def counted_master(plan, media):
            master_calls.append(plan['job'])
            return ''
        PC.verify_lfs_readback.reset_mock()
        with patch.object(PC, 'fetch_media', side_effect=counted_fetch):
            with patch.object(PC, 'master_media', side_effect=counted_master):
                with patch.object(PC, 'read_archive_pointers', return_value={
                        'AT_REST_v3.mp4': ('0' * 64, self.master.stat().st_size),
                        'AT_REST_v3_share.mp4': (self.shash, self.share.stat().st_size)}):
                    rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('live archive pointer changed', out)
        self.assertEqual(fetch_calls, [])
        self.assertEqual(master_calls, [])
        self.assertEqual(PC.verify_lfs_readback.call_count, 0)
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)

    def test_exact_live_pointers_skip_upload_and_conflicts_fail(self):
        with patch.object(PC, 'read_archive_pointers', return_value={
            'AT_REST_v3.mp4': (self.mhash, self.master.stat().st_size),
            'AT_REST_v3_share.mp4': (self.shash, self.share.stat().st_size),
        }):
            rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn('already present in archive', out)
        self.assertFalse(self.marker.exists())
        with patch.object(PC, 'read_archive_pointers', return_value={
            'AT_REST_v3.mp4': ('0' * 64, self.master.stat().st_size),
            'AT_REST_v3_share.mp4': (self.shash, self.share.stat().st_size),
        }):
            rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('live archive pointer changed', out)

    def test_publisher_mutation_is_staged_and_ledger_uses_final_hashes(self):
        original_master = self.master.read_bytes()
        original_share = self.share.read_bytes()
        def mutate_copies(plan, media):
            pathlib.Path(media['atrest4.mp4']).write_bytes(b'mastered-master')
            pathlib.Path(media['atrest4_share.mp4']).write_bytes(b'mastered-share')
        with patch.object(PC, 'master_media', side_effect=mutate_copies):
            rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.master.read_bytes(), original_master)
        self.assertEqual(self.share.read_bytes(), original_share)
        row = json.loads(self.ledger.read_text().splitlines()[0])
        self.assertEqual(row['source_master_sha256'], self.mhash)
        self.assertEqual(row['source_share_sha256'], self.shash)
        self.assertEqual(row['master_sha256'], sha(b'mastered-master'))
        self.assertEqual(row['share_sha256'], sha(b'mastered-share'))
        self.assertEqual(row['identity']['master_target'], 'videos/out/AT_REST_v3.mp4')
        self.assertEqual(row['identity']['share_target'], 'videos/out/AT_REST_v3_share.mp4')
        self.assertEqual(row['identity']['master_oid'], row['master_sha256'])
        self.assertEqual(row['identity']['share_oid'], row['share_sha256'])

    def test_post_publish_pointer_mismatch_does_not_write_ledger(self):
        calls = []
        def pointers(items, ref='main'):
            calls.append(items)
            if len(calls) == 1:
                return {'AT_REST_v3.mp4': None, 'AT_REST_v3_share.mp4': None}
            return {'AT_REST_v3.mp4': ('0' * 64, 99), 'AT_REST_v3_share.mp4': None}
        with patch.object(PC, 'read_archive_pointers', side_effect=pointers):
            rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('pointer/readback mismatch', out)
        self.assertFalse(self.ledger.exists())

    def test_plan_mode_does_not_publish(self):
        rc, out = self.run_cli(plan=True)
        self.assertEqual(rc, 0, out)
        self.assertIn('"status": "planned"', out)
        self.assertFalse(self.marker.exists())
        self.assertFalse(self.ledger.exists())

    def test_publish_does_not_enable_optional_gate(self):
        captured = {}
        def fake_run(argv, **kwargs):
            captured['env'] = kwargs['env']
            return SimpleNamespace(returncode=0, stdout='published to main (deadbeef)\n', stderr='')
        media = {'atrest4.mp4': str(self.master), 'atrest4_share.mp4': str(self.share)}
        with patch.object(PC.subprocess, 'run', side_effect=fake_run):
            with patch.dict(os.environ, {'GATE': '1', 'GATE_ARGS': '--skip all', 'ARCHIVE_URL': 'https://wrong.invalid'}):
                PC.publish(self.plan, 'AT_REST', 'v3', media)
        self.assertNotIn('GATE', captured['env'])
        self.assertNotIn('GATE_ARGS', captured['env'])
        self.assertEqual(captured['env']['ARCHIVE_URL'], 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive')

    def test_dry_run_does_not_write_ledger(self):
        rc, out = self.run_cli(dry_run=True)
        self.assertEqual(rc, 0, out)
        self.assertIn('dry-run checked', out)
        self.assertFalse(self.ledger.exists())
        self.assertTrue(self.marker.exists())

    def test_target_mismatch_fails(self):
        plan = json.loads(json.dumps(self.plan))
        plan['title'] = 'AT_REST_v4'
        self.inventory.write_text(json.dumps({'plans': [plan]}))
        rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('do not match title', out)
        self.assertFalse(self.marker.exists())

    def test_local_hash_mismatch_fails_before_publish(self):
        self.master.write_bytes(b'corrupt-master')
        rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('local hash', out)
        self.assertFalse(self.marker.exists())
        self.assertFalse(self.ledger.exists())

    def test_discover_completed_receipt_and_next_version(self):
        job2 = self.farm / 'jobs/protocol-job2'
        job2.mkdir()
        master2 = self.root / 'bread.mp4'
        share2 = self.root / 'bread_share.mp4'
        master2.write_bytes(b'bread-master')
        share2.write_bytes(b'bread-share')
        m2, s2 = sha(master2.read_bytes()), sha(share2.read_bytes())
        (job2 / 'protocol.json').write_text(json.dumps({
            'protocol_id': 'job2',
            'state': 'delivered',
            'pipeline_job': {
                'piece': 'BREAD_BREAD', 'pipeline_commit': 'def456',
                'run': ['sh', 'videos/scripts/local_render.sh', '--seg', 'bread:1'],
                'delivery': {'files': [
                    {'name': 'bread.mp4', 'sha256': m2},
                    {'name': 'bread_share.mp4', 'sha256': s2},
                ]},
            },
        }))
        (job2 / 'receipt.json').write_text(json.dumps({
            'output_sha256': m2, 'full_decode': 'passed', 'frames': 1, 'seconds': 1.0,
        }))
        plans = PC.discover_completed_jobs(
            self.farm, ['BREAD_BREAD_v1.mp4', 'BREAD_BREAD_v1_share.mp4'])
        by_job = {plan['job']: plan for plan in plans}
        self.assertIn('job2', by_job)
        self.assertEqual(by_job['job2']['title'], 'BREAD_BREAD_v2')
        self.assertEqual(by_job['job2']['media'][0]['sha256'], m2)
        self.assertEqual(by_job['job2']['media'][1]['sha256'], s2)

    def test_missing_share_pointer_publishes(self):
        def pointers(items, ref='main'):
            if not self.marker.exists():
                return {
                    'AT_REST_v3.mp4': (self.mhash, self.master.stat().st_size),
                    'AT_REST_v3_share.mp4': None,
                }
            return {
                'AT_REST_v3.mp4': (self.mhash, self.master.stat().st_size),
                'AT_REST_v3_share.mp4': (self.shash, self.share.stat().st_size),
            }
        with patch.object(PC, 'read_archive_pointers', side_effect=pointers):
            rc, out = self.run_cli()
        self.assertEqual(rc, 0, out)
        self.assertIn('promoted AT_REST_v3', out)
        self.assertTrue(self.marker.exists())
        row = json.loads(self.ledger.read_text().splitlines()[0])
        self.assertEqual(row['status'], 'promoted')

    def test_concurrent_runs_publish_once_under_lock(self):
        slow = self.root / 'slow_publish.sh'
        slow.write_text('#!/bin/sh\n echo "$@" >> "$MARKER"\n sleep 0.3\n echo "published to main (deadbeef)"\n')
        ctx = multiprocessing.get_context('fork')
        with patch.object(PC, 'PUBLISH', slow):
            procs = [ctx.Process(target=lambda: PC.run(self.args())) for _ in range(2)]
            for proc in procs:
                proc.start()
            for proc in procs:
                proc.join(20)
        self.assertEqual([proc.exitcode for proc in procs], [0, 0])
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)
        rows = [json.loads(line) for line in self.ledger.read_text().splitlines()]
        self.assertEqual([row['status'] for row in rows], ['promoted'])

    def test_parse_pointer_accepts_four_line_format(self):
        oid = 'a' * 64
        content = (b'version https://git-lfs.github.com/spec/v1\n'
                   b'oid sha256:' + oid.encode() + b'\n'
                   b'size 123\n')
        self.assertEqual(PC.parse_pointer(content), (oid, 123))
        with self.assertRaises(RuntimeError):
            PC.parse_pointer(b'not a pointer\n')

    def test_verify_lfs_readback_uses_tracked_homelab_module(self):
        lfs_patch = next(p for p in self.patches
                         if getattr(p, 'attribute', None) == 'verify_lfs_readback')
        lfs_patch.stop()
        try:
            repo = self.root / 'runtime-repo'
            module = repo / 'homelab/runtime/protocol/lfs_archive.py'
            module.parent.mkdir(parents=True)
            marker = self.root / 'lfs-readback.txt'
            module.write_text(
                'def verify_remote(archive_url, oid, size):\n'
                f'    with open({str(marker)!r}, "w") as handle:\n'
                f'        handle.write(archive_url + "|" + oid + "|" + str(size))\n')
            oid = 'a' * 64
            with patch.object(PC, 'REPO', repo):
                PC.verify_lfs_readback((oid, 49179305))
            self.assertEqual(marker.read_text(), f'{PC.ARCHIVE_URL}|{oid}|49179305')
            with patch.object(PC, 'REPO', self.root / 'missing-repo'):
                with self.assertRaisesRegex(RuntimeError, 'lfs_archive.py'):
                    PC.verify_lfs_readback((oid, 49179305))
        finally:
            lfs_patch.start()

    def test_run_refuses_upload_without_lfs_helper(self):
        (self.repo / 'homelab/runtime/protocol/lfs_archive.py').unlink()
        rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('lfs_archive.py', out)
        self.assertFalse(self.marker.exists())


    def test_discovery_reuses_reservation_instead_of_advancing_version(self):
        reservations = self.root / 'reservations.jsonl'
        rows = PC.load_reservations(reservations)
        first = next(p for p in PC.discover_completed_jobs(
            self.farm, [], reservations, rows) if p['job'] == 'job1')
        self.assertEqual(first['title'], 'AT_REST_v1')
        rows = PC.load_reservations(reservations)
        second = next(p for p in PC.discover_completed_jobs(
            self.farm, ['AT_REST_v1.mp4', 'AT_REST_v1_share.mp4'], reservations, rows)
            if p['job'] == 'job1')
        self.assertEqual(second['title'], 'AT_REST_v1')
        self.assertEqual(second['media'][0]['target'], 'videos/out/AT_REST_v1.mp4')

    def test_discovery_preserves_published_study_title_and_avoids_new_version(self):
        inventory = self.root / 'studies.json'
        inventory.write_text(json.dumps({'studies': [{
            'job': 'job1', 'scene': 'at_rest', 'source_commit': 'abc123',
            'media': [
                {'path': 'videos/out/AT_REST_study_1.mp4', 'sha256': self.mhash,
                 'bytes': self.master.stat().st_size},
                {'path': 'videos/out/AT_REST_study_1_share.mp4', 'sha256': self.shash,
                 'bytes': self.share.stat().st_size},
            ],
        }]}))
        completed = PC.load_completed_plans([inventory])
        reservations = self.root / 'reservations.jsonl'
        rows = PC.load_reservations(reservations)
        plans = PC.discover_completed_jobs(
            self.farm, [], reservations, rows, reserve=True, completed_plans=completed)
        plan = next(p for p in plans if p['job'] == 'job1')
        self.assertEqual(plan['title'], 'AT_REST_study_1')
        self.assertTrue(plan['explicit'])
        self.assertEqual(plan['media'][0]['target'], 'videos/out/AT_REST_study_1.mp4')
        saved = PC.load_reservations(reservations)
        self.assertEqual([row['title'] for row in saved.values()], ['AT_REST_study_1'])
        self.assertNotIn('AT_REST_v1', json.dumps(saved))

    def test_load_completed_plans_published_media_schema_preserves_source_media(self):
        inventory = self.root / 'actual-schema.json'
        inventory.write_text(json.dumps({
            'schema': 'acp.completed-render-inventory/v2',
            'entries': [{
                'job_id': 'job1', 'title': 'render intelligence2:171.645:120',
                'piece': 'ACCELERATE', 'source_commit': 'abc123',
                'published_media': [
                    {'kind': 'master', 'sha256': self.mhash,
                     'bytes': self.master.stat().st_size,
                     'paths': ['videos/out/ACCELERATE_v16.mp4']},
                    {'kind': 'share', 'sha256': self.shash,
                     'bytes': self.share.stat().st_size,
                     'paths': ['videos/out/ACCELERATE_v16_share.mp4']},
                ],
            }],
        }))
        completed = PC.load_completed_plans([inventory])
        plan = completed['job1']
        self.assertEqual(plan['title'], 'ACCELERATE_v16')
        self.assertFalse(plan['explicit'])
        self.assertEqual([m['kind'] for m in plan['media']], ['master', 'share'])
        self.assertEqual([m['target'] for m in plan['media']],
                         ['videos/out/ACCELERATE_v16.mp4',
                          'videos/out/ACCELERATE_v16_share.mp4'])
        discovered = PC.discover_completed_jobs(
            self.farm, [], None, None, completed_plans=completed)
        out = next(p for p in discovered if p['job'] == 'job1')
        self.assertEqual(out['title'], 'ACCELERATE_v16')
        self.assertEqual([m['name'] for m in out['media']],
                         ['atrest4.mp4', 'atrest4_share.mp4'])
        self.assertEqual([m['target'] for m in out['media']],
                         ['videos/out/ACCELERATE_v16.mp4',
                          'videos/out/ACCELERATE_v16_share.mp4'])

    @unittest.skipUnless(os.path.exists('/var/tmp/root-completed-publications-20261018.json'),
                         'actual canonical inventory is unavailable')
    def test_actual_canonical_inventory_loads_49_destinations(self):
        plans = PC.load_completed_plans(
            ['/var/tmp/root-completed-publications-20261018.json'])
        self.assertEqual(len(plans), 49)
        destinations = set()
        for job, plan in plans.items():
            targets = [media['target'] for media in plan['media']]
            self.assertEqual(len(targets), 2, job)
            self.assertEqual([media['kind'] for media in plan['media']],
                             ['master', 'share'], job)
            for target in targets:
                self.assertTrue(target.startswith('videos/out/'), (job, target))
                self.assertTrue(target.endswith('.mp4'), (job, target))
            self.assertEqual(plan['title'], os.path.basename(targets[0])[:-4], job)
            self.assertFalse(plan['title'].startswith('render '), job)
            destinations.update(targets)
        self.assertEqual(len(destinations), 98)

    def test_discovery_reuses_live_published_version_without_reservation(self):
        pointers = {'AT_REST_v4.mp4': self.mhash, 'AT_REST_v4_share.mp4': self.shash}
        plans = PC.discover_completed_jobs(
            self.farm, [], None, None, pointers=pointers)
        plan = next(p for p in plans if p['job'] == 'job1')
        self.assertEqual(plan['title'], 'AT_REST_v4')
        self.assertEqual(plan['media'][0]['target'], 'videos/out/AT_REST_v4.mp4')
        self.assertNotIn('AT_REST_v1', json.dumps(plans))

    def test_discovery_reuses_archive_snapshot_pair(self):
        snapshot = self.root / 'archive-snapshot.json'
        snapshot.write_text(json.dumps({'files': [
            {'path': 'videos/out/archive/AT_REST_v9.mp4',
             'oid': self.mhash, 'bytes': self.master.stat().st_size},
            {'path': 'videos/out/archive/AT_REST_v9_share.mp4',
             'oid': self.shash, 'bytes': self.share.stat().st_size},
        ]}))
        indexed = PC.load_archive_snapshot(snapshot)
        plans = PC.discover_completed_jobs(
            self.farm, [], None, None, archive_snapshot=indexed)
        plan = next(p for p in plans if p['job'] == 'job1')
        self.assertEqual(plan['title'], 'AT_REST_v9')
        self.assertTrue(plan['explicit'])
        self.assertEqual([m['target'] for m in plan['media']],
                         ['videos/out/archive/AT_REST_v9.mp4',
                          'videos/out/archive/AT_REST_v9_share.mp4'])
        self.assertNotIn('AT_REST_v1', json.dumps(plans))

    def test_archive_snapshot_prefers_current_root_destination(self):
        snapshot = self.root / 'archive-snapshot-root.json'
        snapshot.write_text(json.dumps({'files': [
            {'path': 'videos/out/AT_REST_v10.mp4',
             'oid': self.mhash, 'bytes': self.master.stat().st_size},
            {'path': 'videos/out/AT_REST_v10_share.mp4',
             'oid': self.shash, 'bytes': self.share.stat().st_size},
            {'path': 'videos/out/archive/AT_REST_v9.mp4',
             'oid': self.mhash, 'bytes': self.master.stat().st_size},
            {'path': 'videos/out/archive/AT_REST_v9_share.mp4',
             'oid': self.shash, 'bytes': self.share.stat().st_size},
        ]}))
        indexed = PC.load_archive_snapshot(snapshot)
        plans = PC.discover_completed_jobs(
            self.farm, [], None, None, archive_snapshot=indexed)
        plan = next(p for p in plans if p['job'] == 'job1')
        self.assertEqual(plan['title'], 'AT_REST_v10')
        self.assertFalse(plan['explicit'])
        self.assertEqual(plan['media'][0]['target'], 'videos/out/AT_REST_v10.mp4')

    @unittest.skipUnless(
        os.path.exists('/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/publication-state/archive-pointers-20261019.json')
        and os.path.exists('/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/publication-state/adoption-plan-20261019.log'),
        'actual archive snapshot or adoption log is unavailable')
    def test_actual_archive_snapshot_reuses_known_pairs(self):
        indexed = PC.load_archive_snapshot(
            '/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/publication-state/archive-pointers-20261019.json')
        plans = {}
        with open('/mnt/nvme4tb/automated-content-pipeline-homelab-20261002/publication-state/adoption-plan-20261019.log') as f:
            for line in f:
                line = line.strip()
                if not line.startswith('{'):
                    continue
                row = json.loads(line)
                if 'source_master_sha256' in row:
                    plans[row['job']] = row
        cases = (
            ('1002-191611-productive_forces_original_v3_re', 'PRODUCTIVE_FORCES_ORIGINAL_v3'),
            ('1002-191133-mecha_proletariat_archive_v1', 'MECHA_PROLETARIAT_ARCHIVE_v1'),
            ('1015-133608-the_core_c20_takes_retry_person', 'CORE_A_study_1015-133608'),
        )
        for job, expected in cases:
            row = plans[job]
            got = PC.archived_title_for(
                {'sha256': row['source_master_sha256']},
                {'sha256': row['source_share_sha256']}, indexed)
            self.assertIsNotNone(got, job)
            self.assertEqual(got[0], expected, job)
            self.assertTrue(got[1][0].endswith(expected + '.mp4'), job)
            self.assertTrue(got[1][1].endswith(expected + '_share.mp4'), job)

    def test_cli_discovery_accepts_archive_snapshot(self):
        snapshot = self.root / 'archive-snapshot-cli.json'
        snapshot.write_text(json.dumps({'files': [
            {'path': 'videos/out/archive/AT_REST_v9.mp4',
             'oid': self.mhash, 'bytes': self.master.stat().st_size},
            {'path': 'videos/out/archive/AT_REST_v9_share.mp4',
             'oid': self.shash, 'bytes': self.share.stat().st_size},
        ]}))
        with patch.object(PC, 'read_archive_names', return_value=[]):
            rc, out = self.run_cli(
                discover=True, inventory=None, plan=True,
                archive_pointer_snapshot=str(snapshot))
        self.assertEqual(rc, 0, out)
        self.assertIn('"title": "AT_REST_v9"', out)
        self.assertIn('videos/out/archive/AT_REST_v9.mp4', out)

    def test_archive_only_adoption_and_repeat_fast_path(self):
        snapshot = self.root / 'archive-only-snapshot.json'
        snapshot.write_text(json.dumps({'files': [
            {'path': 'videos/out/archive/AT_REST_v9.mp4',
             'oid': self.mhash, 'bytes': self.master.stat().st_size},
            {'path': 'videos/out/archive/AT_REST_v9_share.mp4',
             'oid': self.shash, 'bytes': self.share.stat().st_size},
        ]}))
        pointers = {
            'videos/out/archive/AT_REST_v9.mp4':
                (self.mhash, self.master.stat().st_size),
            'videos/out/archive/AT_REST_v9_share.mp4':
                (self.shash, self.share.stat().st_size),
        }
        fetch_calls = []
        master_calls = []
        real_fetch = PC.fetch_media
        def counted_fetch(plan, job_dir, work):
            fetch_calls.append(plan['job'])
            return real_fetch(plan, job_dir, work)
        def counted_master(plan, media):
            master_calls.append(plan['job'])
            return ''
        with patch.object(PC, 'read_archive_names', return_value=[]):
            with patch.object(PC, 'read_archive_pointers', return_value=pointers):
                with patch.object(PC, 'fetch_media', side_effect=counted_fetch):
                    with patch.object(PC, 'master_media', side_effect=counted_master):
                        rc, out = self.run_cli(
                            discover=True, inventory=None,
                            archive_pointer_snapshot=str(snapshot))
                        self.assertEqual(rc, 0, out)
                        self.assertEqual(len(fetch_calls), 1)
                        self.assertEqual(len(master_calls), 1)
                        self.assertEqual(PC.verify_lfs_readback.call_count, 2)
                        self.assertFalse(self.marker.exists())
                        fetch_calls.clear()
                        master_calls.clear()
                        PC.master_media.reset_mock()
                        PC.verify_lfs_readback.reset_mock()
                        rc, out = self.run_cli(
                            discover=True, inventory=None,
                            archive_pointer_snapshot=str(snapshot))
        self.assertEqual(rc, 0, out)
        self.assertIn('skipping media staging/master/readback', out)
        self.assertEqual(fetch_calls, [])
        self.assertEqual(master_calls, [])
        self.assertEqual(PC.verify_lfs_readback.call_count, 0)
        self.assertEqual(len(self.ledger.read_text().splitlines()), 1)
        row = json.loads(self.ledger.read_text().splitlines()[0])
        self.assertEqual(row['master_target'], 'videos/out/archive/AT_REST_v9.mp4')
        self.assertEqual(row['share_target'], 'videos/out/archive/AT_REST_v9_share.mp4')

    def test_archive_root_basename_collision_uses_archive_oid(self):
        snapshot = self.root / 'archive-collision-snapshot.json'
        snapshot.write_text(json.dumps({'files': [
            {'path': 'videos/out/archive/AT_REST_v9.mp4',
             'oid': self.mhash, 'bytes': self.master.stat().st_size},
            {'path': 'videos/out/archive/AT_REST_v9_share.mp4',
             'oid': self.shash, 'bytes': self.share.stat().st_size},
        ]}))
        pointers = {
            'videos/out/AT_REST_v9.mp4': ('f' * 64, self.master.stat().st_size),
            'videos/out/AT_REST_v9_share.mp4': ('e' * 64, self.share.stat().st_size),
            'videos/out/archive/AT_REST_v9.mp4':
                (self.mhash, self.master.stat().st_size),
            'videos/out/archive/AT_REST_v9_share.mp4':
                (self.shash, self.share.stat().st_size),
        }
        requested = []
        def archive_pointers(items, ref='main'):
            requested.extend(item['target'] for item in items)
            return pointers
        with patch.object(PC, 'read_archive_names', return_value=[]):
            with patch.object(PC, 'read_archive_pointers', side_effect=archive_pointers):
                rc, out = self.run_cli(
                    discover=True, inventory=None,
                    archive_pointer_snapshot=str(snapshot))
        self.assertEqual(rc, 0, out)
        self.assertEqual(requested, [
            'videos/out/archive/AT_REST_v9.mp4',
            'videos/out/archive/AT_REST_v9_share.mp4'])
        self.assertFalse(self.marker.exists())
        row = json.loads(self.ledger.read_text().splitlines()[0])
        self.assertEqual(row['master_target'], 'videos/out/archive/AT_REST_v9.mp4')

    def test_read_archive_pointers_uses_full_archive_target(self):
        pointer = (b'version https://git-lfs.github.com/spec/v1\n'
                   b'oid sha256:' + self.mhash.encode() + b'\n'
                   b'size ' + str(self.master.stat().st_size).encode() + b'\n')
        calls = []
        def fake_run(argv, **kwargs):
            calls.append(argv)
            return SimpleNamespace(
                returncode=0,
                stdout=json.dumps({'content': base64.b64encode(pointer).decode()}),
                stderr='')
        reader_patch = next(p for p in self.patches
                            if getattr(p, 'attribute', None) == 'read_archive_pointers')
        reader_patch.stop()
        try:
            with patch.object(PC.subprocess, 'run', side_effect=fake_run):
                pointers = PC.read_archive_pointers([{
                    'target': 'videos/out/archive/AT_REST_v9.mp4'}])
        finally:
            reader_patch.start()
        self.assertEqual(pointers, {
            'videos/out/archive/AT_REST_v9.mp4':
                (self.mhash, self.master.stat().st_size)})
        self.assertIn('contents/videos/out/archive/AT_REST_v9.mp4', calls[0][2])

    def test_read_archive_pointers_rejects_bad_paths(self):
        reader_patch = next(p for p in self.patches
                            if getattr(p, 'attribute', None) == 'read_archive_pointers')
        reader_patch.stop()
        try:
            for target in ('videos/out/../AT_REST_v9.mp4',
                           'videos/other/AT_REST_v9.mp4',
                           '/videos/out/AT_REST_v9.mp4',
                           'videos/out//AT_REST_v9.mp4'):
                with self.subTest(target=target):
                    with self.assertRaisesRegex(RuntimeError, 'invalid archive target'):
                        PC.read_archive_pointers([{'target': target}])
        finally:
            reader_patch.start()

    def test_video_job_intent_accepts_full_scene_and_rejects_fragments(self):
        def facts(piece, run):
            return {'protocol': {'pipeline_job': {'piece': piece, 'run': run}}}
        for piece, scene in (('PERSON', 'person'), ('PERSONA', 'persona'),
                             ('PLATE', 'plate'), ('PLATEAU', 'plateau'),
                             ('PROBE', 'probe')):
            with self.subTest(piece=piece):
                self.assertEqual(PC.video_job_reason(facts(
                    piece, ['sh', 'videos/scripts/local_render.sh', '--seg', f'{scene}:1']), 'j'), '')
        self.assertIn('protocol kind', PC.video_job_reason(
            {'protocol': {'pipeline_job': {'piece': 'X', 'kind': 'diagnostic',
                                           'run': ['sh', 'videos/scripts/local_render.sh',
                                                   '--seg', 'x:1']}}}, 'j'))
        self.assertEqual(PC.video_job_reason(
            {'protocol': {'pipeline_job': {'piece': 'THE_CHASM'}}}, 'j'), '')
        self.assertEqual(PC.video_job_reason(
            {'protocol': {'pipeline_job': {'piece': 'THE_CHASM',
                                           'run': 'sh videos/scripts/local_render.sh --seg the_chasm:1'}}}, 'j'), '')
        self.assertEqual(PC.video_job_reason(facts(
            'THE_CHASM', ['sh', 'videos/scripts/local_render.sh',
                          '--workers', '4', '--seg', 'the_chasm:1']), 'j'), '')
        self.assertEqual(PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'fframes',
                'run': ['sh', 'videos/scripts/gpu_job.sh', 'python',
                        'videos/gpu/fframes_full_scene.py', '--id', 'x']}}}, 'j'), '')
        self.assertEqual(PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'film',
                'run': ['sh', 'videos/scripts/local_render.sh',
                        '--seg', 'stillness2:1']}}}, 'j'), '')
        self.assertEqual(PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'film',
                'run': ['python', '/srv/diagnostics/film_renderer.py',
                        '--scene', 'the_chasm']}}}, 'j'), '')
        self.assertEqual(PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'film',
                'run': ['node', '/srv/renderers/custom_film.mjs',
                        '--scene', 'the_chasm']}}}, 'j'), '')
        self.assertEqual(PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'film',
                'run': ['sh', 'videos/scripts/gpu_job.sh', 'python',
                        'videos/gpu/generic_asset.py']}}}, 'j'), '')
        self.assertIn('diagnostic', PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'film',
                'run': ['sh', 'videos/scripts/gpu_job.sh', 'python',
                        'videos/gpu/fframes_chasm_glass_diagnostic.py']}}}, 'j'))
        self.assertIn('diagnostic', PC.video_job_reason({
            'protocol': {'pipeline_job': {
                'piece': 'THE_CHASM', 'kind': 'film',
                'run': ['python',
                        '"videos/gpu/fframes_chasm_glass_diagnostic.py"']}}}, 'j'))
        self.assertIn('benchmark', PC.video_job_reason(facts(
            'BENCH', ['sh', 'videos/scripts/local_render.sh', '--seg', 'bench_x:1']), 'j'))
        self.assertIn('GPU', PC.video_job_reason(facts(
            'GPU', ['sh', 'videos/scripts/gpu_job.sh']), 'j'))
        self.assertIn('not a full-scene', PC.video_job_reason(facts(
            'X', ['sh', 'videos/scripts/local_render.sh']), 'j'))

    def test_adopts_49_archived_takes_without_new_version_or_upload(self):
        protocol_path = self.farm / 'jobs/protocol-job1/protocol.json'
        protocol = json.loads(protocol_path.read_text())
        protocol['state'] = 'draft'
        protocol_path.write_text(json.dumps(protocol))
        studies = []
        for index in range(49):
            job = f'manual{index:02d}'
            piece = f'TAKE_{index:02d}'
            title = f'{piece}_study'
            job_dir = self.farm / 'jobs' / f'protocol-{job}'
            job_dir.mkdir(parents=True)
            master_bytes = f'master-{index}'.encode()
            share_bytes = f'share-{index}'.encode()
            master_hash, share_hash = sha(master_bytes), sha(share_bytes)
            out = job_dir / 'out'
            out.mkdir()
            (out / f'take{index}.mp4').write_bytes(master_bytes)
            (out / f'take{index}_share.mp4').write_bytes(share_bytes)
            source_commit = f'commit{index:02d}'
            (job_dir / 'protocol.json').write_text(json.dumps({
                'protocol_id': job, 'state': 'delivered',
                'pipeline_job': {
                    'piece': piece, 'pipeline_commit': source_commit,
                    'run': ['sh', 'videos/scripts/local_render.sh', '--seg', f'take_{index:02d}:1'],
                    'delivery': {'files': [
                        {'name': f'take{index}.mp4', 'sha256': master_hash},
                        {'name': f'take{index}_share.mp4', 'sha256': share_hash},
                    ]},
                },
            }))
            (job_dir / 'receipt.json').write_text(json.dumps({
                'output_sha256': master_hash, 'full_decode': 'passed',
                'frames': 1, 'seconds': 1.0,
            }))
            studies.append({
                'job': job, 'scene': f'take_{index:02d}', 'source_commit': source_commit,
                'media': [
                    {'path': f'videos/out/{title}.mp4', 'sha256': master_hash,
                     'bytes': len(master_bytes)},
                    {'path': f'videos/out/{title}_share.mp4', 'sha256': share_hash,
                     'bytes': len(share_bytes)},
                ],
            })
        inventory = self.root / 'archived-takes.json'
        inventory.write_text(json.dumps({'studies': studies}))
        completed = PC.load_completed_plans([inventory])
        self.assertEqual(len(completed), 49)
        reservations = self.root / 'adopt-reservations.jsonl'
        ledger = self.root / 'adopt-ledger.jsonl'
        def exact_pointers(items, ref='main'):
            return {pathlib.Path(item['target']).name: (item['sha256'], item.get('size', 0))
                    for item in items}
        fetch_calls = []
        real_fetch = PC.fetch_media
        def counted_fetch(plan, job_dir, work):
            fetch_calls.append(plan['job'])
            return real_fetch(plan, job_dir, work)
        with patch.object(PC, 'read_archive_names', return_value=[]):
            with patch.object(PC, 'read_archive_pointers', side_effect=exact_pointers):
                with patch.object(PC, 'fetch_media', side_effect=counted_fetch):
                    rc, out = self.run_cli(
                        discover=True, inventory=None, completed_inventory=[inventory],
                        reservations=str(reservations), ledger=str(ledger),
                        lock=str(self.root / 'adopt.lock'))
                    self.assertEqual(rc, 0, out)
                    self.assertEqual(len(fetch_calls), 49)
                    self.assertEqual(PC.master_media.call_count, 49)
                    self.assertEqual(PC.verify_lfs_readback.call_count, 98)
                    fetch_calls.clear()
                    PC.master_media.reset_mock()
                    PC.verify_lfs_readback.reset_mock()
                    rc, out = self.run_cli(
                        discover=True, inventory=None, completed_inventory=[inventory],
                        reservations=str(reservations), ledger=str(ledger),
                        lock=str(self.root / 'adopt.lock'))
        self.assertEqual(rc, 0, out)
        self.assertIn('skipping media staging/master/readback', out)
        self.assertEqual(fetch_calls, [])
        self.assertEqual(PC.master_media.call_count, 0)
        self.assertEqual(PC.verify_lfs_readback.call_count, 0)
        self.assertFalse(self.marker.exists(), 'existing takes must not be uploaded again')
        rows = [json.loads(line) for line in ledger.read_text().splitlines()]
        self.assertEqual(len(rows), 49)
        self.assertEqual({row['status'] for row in rows}, {'present'})
        saved = PC.load_reservations(reservations)
        self.assertEqual(len(saved), 49)
        self.assertFalse(any('_v1' in row['title'] for row in saved.values()))

    def test_crash_after_publish_recovers_reserved_destination(self):
        real_append = PC.append_ledger
        crashed = []
        def crash_once(path, entry):
            if entry.get('status') == 'promoted' and not crashed:
                crashed.append(True)
                raise RuntimeError('simulated crash before ledger')
            return real_append(path, entry)
        with patch.object(PC, 'read_archive_names', return_value=[]):
            with patch.object(PC, 'append_ledger', side_effect=crash_once):
                rc, out = self.run_cli(discover=True, inventory=None)
        self.assertEqual(rc, 1)
        self.assertTrue(self.marker.exists(), out)
        rows = PC.load_reservations(self.root / 'reservations.jsonl')
        self.assertEqual(next(iter(rows.values()))['master_target'], 'videos/out/AT_REST_v1.mp4')
        self.assertFalse(self.ledger.exists() and self.ledger.read_text().strip())
        with patch.object(PC, 'read_archive_names',
                          return_value=['AT_REST_v1.mp4', 'AT_REST_v1_share.mp4']):
            rc, out = self.run_cli(discover=True, inventory=None)
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.marker.read_text().splitlines()), 1)
        ledger_rows = [json.loads(line) for line in self.ledger.read_text().splitlines()]
        self.assertEqual(ledger_rows[-1]['master_target'], 'videos/out/AT_REST_v1.mp4')
        self.assertIn('AT_REST_v1', out)
        self.assertNotIn('AT_REST_v2', out)

    def test_malformed_discovery_receipt_is_reported(self):
        job2 = self.farm / 'jobs/protocol-job2'
        job2.mkdir()
        (job2 / 'protocol.json').write_text(json.dumps({
            'protocol_id': 'job2', 'state': 'delivered',
            'pipeline_job': {'piece': 'X', 'pipeline_commit': 'c',
                             'run': ['sh', 'videos/scripts/local_render.sh', '--seg', 'x:1'],
                             'delivery': {'files': [
                                 {'name': 'x.mp4', 'sha256': 'a' * 64},
                                 {'name': 'x_share.mp4', 'sha256': 'b' * 64}]}},
        }))
        (job2 / 'receipt.json').write_text('{not json')
        errors, skipped = [], []
        plans = PC.discover_completed_jobs(self.farm, [], None, None, errors, skipped)
        self.assertNotIn('job2', [p['job'] for p in plans])
        self.assertTrue(any(job == 'job2' for job, _ in errors))

    def test_benchmark_fragment_excluded_by_job_intent(self):
        job3 = self.farm / 'jobs/protocol-job3'
        job3.mkdir()
        (job3 / 'protocol.json').write_text(json.dumps({
            'protocol_id': '1016-000000-bench_human8_fragment', 'state': 'delivered',
            'pipeline_job': {'piece': 'BENCH', 'pipeline_commit': 'c',
                             'delivery': {'files': [
                                 {'name': 'bench.mp4', 'sha256': 'a' * 64},
                                 {'name': 'bench_share.mp4', 'sha256': 'b' * 64}]}},
        }))
        (job3 / 'receipt.json').write_text(json.dumps({
            'output_sha256': 'a' * 64, 'full_decode': 'passed'}))
        errors, skipped = [], []
        plans = PC.discover_completed_jobs(self.farm, [], None, None, errors, skipped)
        self.assertNotIn('1016-000000-bench_human8_fragment', [p['job'] for p in plans])
        self.assertTrue(any(job == '1016-000000-bench_human8_fragment' for job, _ in skipped))

    def test_present_pointer_branch_requires_lfs_readback(self):
        with patch.object(PC, 'read_archive_pointers', return_value={
                'AT_REST_v3.mp4': (self.mhash, self.master.stat().st_size),
                'AT_REST_v3_share.mp4': (self.shash, self.share.stat().st_size)}):
            with patch.object(PC, 'verify_lfs_readback', side_effect=RuntimeError('readback failed')):
                rc, out = self.run_cli()
        self.assertEqual(rc, 1)
        self.assertIn('readback failed', out)
        self.assertFalse(self.ledger.exists())

    def test_discovery_plan_does_not_reserve_targets(self):
        with patch.object(PC, 'read_archive_names', return_value=[]):
            rc, out = self.run_cli(discover=True, inventory=None, plan=True)
        self.assertEqual(rc, 0, out)
        self.assertFalse((self.root / 'reservations.jsonl').exists())

if __name__ == '__main__':
    unittest.main()
