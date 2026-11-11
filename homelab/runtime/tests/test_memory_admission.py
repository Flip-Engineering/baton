import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import admission_policy
import farm
import gpu_allocation
import scheduler

GIB = 2**30


class MemoryAdmission(unittest.TestCase):
    def setUp(self):
        gpu_allocation._cgroup_paths.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cards = [dict(label='gpu0', uuid='GPU-test-0')]
        self.config = patch.dict(farm.CONFIG, gpus=self.cards, gpu_job_gpus=self.cards,
                                 gpu_jobs_per_gpu=6, coordinator_root=str(self.root))
        self.config.start()
        self.addCleanup(self.config.stop)
        self.own = self.root / 'lanes/gpu1/jobs'
        self.own.mkdir(parents=True)
        self.jobs_patch = patch.object(farm, 'JOBS', self.own)
        self.jobs_patch.start()
        self.addCleanup(self.jobs_patch.stop)

    def job(self, name, memory=48, state='prepared', lane=True):
        base = self.own if lane else self.root / 'jobs'
        job = base / name
        job.mkdir(parents=True)
        farm.write(job / 'request.json', dict(kind='gpu', gpu_count=1,
                                              protocol_id=name, submitted='2026-10-18T00:00:00Z'))
        farm.write(job / 'status.json', dict(state=state, execution_boot_id=farm.boot_id()))
        farm.write(job / 'prepared.json', dict(host_memory_gib=memory))
        return job

    def scene_job(self, name, state='prepared'):
        job = self.own / name
        job.mkdir(parents=True)
        farm.write(job / 'request.json', dict(scene='oneshot2', protocol_id=name))
        farm.write(job / 'status.json', dict(state=state, execution_boot_id=farm.boot_id()))
        farm.write(job / 'prepared.json', dict(ranges=[dict(gpu=self.cards[0])]))
        return job

    def test_running_job_reserves_budget_remaining_above_cgroup_usage(self):
        job = self.job('running', memory=48, state='running')
        self.assertEqual(gpu_allocation.reserved_memory(job, 'running', measure=lambda _: 10 * GIB), 38 * GIB)

    def test_prepared_job_keeps_full_reservation(self):
        job = self.job('prepared', memory=48, state='prepared')
        self.assertEqual(gpu_allocation.reserved_memory(job, 'prepared'), 48 * GIB)
        self.assertEqual(gpu_allocation.reserved_memory(job, 'prepared', reservation=24 * GIB), 24 * GIB)

    def test_unreadable_cgroup_fails_closed_to_full_budget(self):
        job = self.job('unreadable', memory=48, state='running')
        def unreadable(_):
            raise gpu_allocation.CgroupUnavailable('memory.current unreadable')
        self.assertEqual(gpu_allocation.reserved_memory(job, 'running', measure=unreadable), 48 * GIB)

    def test_stale_cgroup_fails_closed_to_full_budget(self):
        job = self.job('stale', memory=48, state='running')
        def stale(_):
            raise gpu_allocation.CgroupStale('container is no longer running')
        self.assertEqual(gpu_allocation.reserved_memory(job, 'running', measure=stale), 48 * GIB)

    def test_over_budget_running_job_reserves_zero_further_headroom(self):
        job = self.job('over', memory=48, state='running')
        self.assertEqual(gpu_allocation.reserved_memory(job, 'running', measure=lambda _: 60 * GIB), 0)

    def test_scene_without_memory_declaration_is_unknown_and_fails_closed(self):
        job = self.scene_job('scene-unknown')
        self.assertIsNone(gpu_allocation.memory_required(job))
        with patch.object(gpu_allocation, 'memory_available', return_value=32 * GIB):
            self.assertEqual(gpu_allocation.reserved_memory(job, 'prepared'), 32 * GIB)

    def test_running_scene_without_memory_declaration_consumes_admission_headroom(self):
        job = self.scene_job('scene-running', state='running')
        with patch.object(gpu_allocation, 'memory_available', return_value=20 * GIB):
            self.assertEqual(gpu_allocation.reserved_memory(job, 'running'), 20 * GIB)

    def test_measured_usage_reads_memory_current_from_the_container_cgroup(self):
        job = self.job('measured', memory=48, state='running')
        proc = self.root / 'proc'
        cgroup = self.root / 'sys/fs/cgroup'
        (proc / '123').mkdir(parents=True)
        (proc / '123/cgroup').write_text('0::/system.slice/docker-' + 'a' * 64 + '.scope\n')
        scope = cgroup / ('system.slice/docker-' + 'a' * 64 + '.scope')
        scope.mkdir(parents=True)
        (scope / 'memory.current').write_text('12345\n')
        state = json.dumps(dict(Running=True, Status='running', Pid=123))
        with patch.object(gpu_allocation.subprocess, 'check_output', return_value=state):
            self.assertEqual(gpu_allocation.measured_usage(job, proc, cgroup), 12345)

    def test_missing_memory_current_and_dead_container_fail_closed(self):
        job = self.job('unreadable', memory=48, state='running')
        proc = self.root / 'proc'
        cgroup = self.root / 'sys/fs/cgroup'
        (proc / '123').mkdir(parents=True)
        (proc / '123/cgroup').write_text('0::/system.slice/docker-' + 'b' * 64 + '.scope\n')
        (cgroup / ('system.slice/docker-' + 'b' * 64 + '.scope')).mkdir(parents=True)
        running = json.dumps(dict(Running=True, Status='running', Pid=123))
        stopped = json.dumps(dict(Running=False, Status='exited', Pid=0))
        with patch.object(gpu_allocation.subprocess, 'check_output', return_value=running):
            with self.assertRaises(gpu_allocation.CgroupUnavailable):
                gpu_allocation.measured_usage(job, proc, cgroup)
        gpu_allocation._cgroup_paths.clear()
        with patch.object(gpu_allocation.subprocess, 'check_output', return_value=stopped):
            with self.assertRaises(gpu_allocation.CgroupStale):
                gpu_allocation.measured_usage(job, proc, cgroup)

    def test_no_double_count_admits_where_full_budget_would_block(self):
        external = self.job('external', memory=48, state='running', lane=False)
        with patch.object(gpu_allocation, 'measured_usage', return_value=38 * GIB):
            reserved = gpu_allocation.external_reserved()
        self.assertEqual(reserved, 10 * GIB)
        new = self.job('new', memory=48, state='prepared')
        plan = admission_policy.plan([new], {}, {}, 58 * GIB, reserved)
        self.assertEqual([job for job, _, _ in plan], [new])
        # The pre-fix full-budget reservation double-counted the 38 GiB resident.
        self.assertGreater(48 * GIB + 48 * GIB, 58 * GIB)

    def test_scheduler_reserves_same_lane_and_external_headroom(self):
        same = self.job('same', memory=48, state='running')
        external = self.job('external', memory=48, state='running', lane=False)
        def usage(job):
            return 10 * GIB if job == same else 30 * GIB
        with patch.object(gpu_allocation, 'measured_usage', side_effect=usage):
            self.assertEqual(scheduler.reserved_ram({same: (None, self.cards)}), 38 * GIB + 18 * GIB)

    def test_external_prepared_reservation_stays_full(self):
        external = self.job('prepared-external', memory=48, state='prepared', lane=False)
        farm.write(external / 'admission.json', dict(memory_bytes=24 * GIB, boot_id=farm.boot_id(),
                   owner_pid=os.getpid(), owner_start=gpu_allocation.process_start(os.getpid())))
        self.assertEqual(gpu_allocation.external_reserved(), 24 * GIB)

    def test_scene_canary_declaration_keeps_full_frame_span_and_records_finite_budget(self):
        job=self.scene_job('scene-canary')
        request=json.loads((job/'request.json').read_text())
        request.update(commit='a'*40,scene='oneshot2_b')
        farm.write(job/'request.json',request)
        prepared=dict(request=request,commit='a'*40,scene='oneshot2_b',frames=1430,
                      renderer_original_sha256='b'*64,renderer_adapted_sha256='c'*64,
                      ranges=[dict(gpu=dict(label='gpu0-w'+str(i),uuid='GPU-test-0'),
                                   first=i*238,end_exclusive=min((i+1)*238,1430),preroll=0)
                              for i in range(6)])
        farm.write(job/'prepared.json',prepared)
        self.assertIsNone(gpu_allocation.memory_required(job))
        receipt=farm.declare_scene_canary(job,8.0)
        updated=json.loads((job/'prepared.json').read_text())
        self.assertEqual(updated['ranges'],[dict(gpu=dict(label='gpu0',uuid='GPU-test-0'),
                                                  first=0,end_exclusive=1430,preroll=0)])
        self.assertEqual(updated['host_memory_gib'],8.0)
        self.assertEqual(receipt['previous_ranges'],prepared['ranges'])
        self.assertEqual(receipt['request_sha256'],farm.file_sha256(job/'request.json'))
        self.assertEqual(json.loads((job/'resource-declaration.json').read_text()),receipt)
        self.assertEqual(gpu_allocation.memory_required(job),8*GIB)
        self.assertEqual(farm.scene_worker_memory_bytes(updated),8*GIB)
        updated['ranges'][0]['end_exclusive']=1429
        farm.write(job/'prepared.json',updated)
        with self.assertRaisesRegex(ValueError,'does not match'):
            gpu_allocation.memory_required(job)

    def test_scene_resource_declaration_preserves_six_ranges_and_source_inputs(self):
        job=self.scene_job('scene-resources')
        request=json.loads((job/'request.json').read_text())
        request.update(commit='a'*40,scene='atrest4')
        farm.write(job/'request.json',request)
        bounds=[(0,334),(334,669),(669,1003),(1003,1338),(1338,1672),(1672,2007)]
        ranges=[dict(gpu=dict(label='gpu0-w'+str(i),uuid='GPU-test-0'),
                     first=first,end_exclusive=end,preroll=first)
                for i,(first,end) in enumerate(bounds)]
        prepared=dict(request=request,commit='a'*40,scene='atrest4',frames=2007,
                      renderer_original_sha256='b'*64,renderer_adapted_sha256='c'*64,
                      audio_sha256='d'*64,ranges=ranges)
        farm.write(job/'prepared.json',prepared)
        original_request=(job/'request.json').read_bytes()
        receipt=farm.declare_scene_resources(job,16.0)
        updated=json.loads((job/'prepared.json').read_text())
        self.assertEqual(updated['ranges'],ranges)
        self.assertEqual(updated['commit'],'a'*40)
        self.assertEqual(updated['audio_sha256'],'d'*64)
        self.assertEqual((job/'request.json').read_bytes(),original_request)
        self.assertEqual(receipt['schema'],'acp.scene-resources/v1')
        self.assertEqual(receipt['ranges'],ranges)
        self.assertEqual(receipt['host_memory_gib'],16.0)
        self.assertEqual(receipt['memory_basis'],'operator_configured_limit')
        self.assertEqual(updated['host_memory_basis'],'operator_configured_limit')
        self.assertEqual(gpu_allocation.memory_required(job),16*GIB)
        self.assertEqual(farm.scene_worker_memory_bytes(updated),16*GIB//6)

    def test_scene_resource_declaration_refusals_leave_job_files_unchanged(self):
        job=self.scene_job('scene-resources-running',state='running')
        farm.write(job/'prepared.json',dict(commit='a'*40,frames=30,ranges=[dict(gpu=self.cards[0],first=0,end_exclusive=30)]))
        before={name:(job/name).read_bytes() for name in ('status.json','request.json','prepared.json')}
        with self.assertRaisesRegex(ValueError,'prepared scene job'):
            farm.declare_scene_resources(job,16.0)
        self.assertEqual({name:(job/name).read_bytes() for name in before},before)
        job2=self.scene_job('scene-resources-reserved')
        farm.write(job2/'prepared.json',dict(commit='a'*40,frames=30,ranges=[dict(gpu=self.cards[0],first=0,end_exclusive=30)]))
        farm.write(job2/'admission.json',dict(memory_bytes=GIB))
        before=(job2/'prepared.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'closed after scheduler admission'):
            farm.declare_scene_resources(job2,16.0)
        self.assertEqual((job2/'prepared.json').read_bytes(),before)
        job3=self.scene_job('scene-resources-invalid-budget')
        farm.write(job3/'prepared.json',dict(commit='a'*40,frames=30,ranges=[dict(gpu=self.cards[0],first=0,end_exclusive=30)]))
        before=(job3/'prepared.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'finite and positive'):
            farm.declare_scene_resources(job3,float('inf'))
        self.assertEqual((job3/'prepared.json').read_bytes(),before)
        farm.write(job3/'resource-declaration.json',dict(schema='prior'))
        before=(job3/'prepared.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'already exists'):
            farm.declare_scene_resources(job3,16.0)
        self.assertEqual((job3/'prepared.json').read_bytes(),before)

    def test_scene_canary_declaration_rejects_started_job_and_invalid_budget(self):
        job=self.scene_job('scene-running-canary',state='running')
        farm.write(job/'prepared.json',dict(frames=30,ranges=[dict(gpu=self.cards[0])]))
        with self.assertRaisesRegex(ValueError,'prepared scene job'):
            farm.declare_scene_canary(job,8.0)
        job2=self.scene_job('scene-invalid-budget')
        farm.write(job2/'prepared.json',dict(frames=30,ranges=[dict(gpu=self.cards[0])]))
        with self.assertRaisesRegex(ValueError,'finite and positive'):
            farm.declare_scene_canary(job2,float('inf'))

    def test_docker_sets_equal_memory_and_swap_caps_for_scene_worker(self):
        job=self.own/'docker-cap'; job.mkdir()
        with patch.dict(farm.CONFIG,runtime_home_caches={}), patch.object(farm,'run',return_value='') as run:
            farm.docker(job,['node','render.mjs'],gpu=self.cards[0],picture=True,memory_bytes=8*GIB)
        args=run.call_args.args[0]
        self.assertEqual(args[args.index('--memory')+1],str(8*GIB))
        self.assertEqual(args[args.index('--memory-swap')+1],str(8*GIB))

    def test_admission_binds_render_to_the_reserved_prepared_checkpoint(self):
        job=self.scene_job('bound-checkpoint')
        context=dict(commit='a'*40,frames=30,ranges=[dict(gpu=self.cards[0])])
        farm.write(job/'prepared.json',context)
        gpu_allocation.reserve(job,8*GIB)
        self.assertEqual(farm.read_admitted_context(job),context)
        admission=json.loads((job/'admission.json').read_text())
        self.assertEqual(admission['prepared_sha256'],farm.file_sha256(job/'prepared.json'))
        context['ranges'][0]['gpu']['label']='gpu1'
        farm.write(job/'prepared.json',context)
        with self.assertRaisesRegex(farm.JobInputError,'changed after scheduler admission'):
            farm.read_admitted_context(job)

    def test_scene_canary_declaration_refuses_a_reserved_checkpoint(self):
        job=self.scene_job('reserved-canary')
        farm.write(job/'prepared.json',dict(frames=30,ranges=[dict(gpu=self.cards[0])]))
        farm.write(job/'admission.json',dict(memory_bytes=8*GIB))
        with self.assertRaisesRegex(ValueError,'closed after scheduler admission'):
            farm.declare_scene_canary(job,8.0)


if __name__ == '__main__':
    unittest.main()
