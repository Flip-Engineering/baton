import datetime, json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import farm
import gpu_allocation
import scheduler


class Allocation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.jobs = Path(self.temp.name)
        self.cards = [dict(label='gpu'+str(i), uuid='GPU-test-'+str(i)) for i in range(4)]
        self.config = patch.dict(farm.CONFIG, gpus=self.cards[:2], gpu_job_gpus=self.cards,
                                 protocol_enabled=False, stage_poll_seconds=0.001,
                                 gpu_activity_directory=None,gpu_admission_holds={},coordinator_root=str(self.jobs))
        self.config.start()
        self.memory=patch.object(gpu_allocation,'memory_available',return_value=256*2**30)
        self.memory.start()
        farm.STOP.clear()

    def tearDown(self):
        farm.STOP.clear()
        self.config.stop()
        self.memory.stop()
        self.temp.cleanup()

    def job(self, name, count=1, kind='gpu'):
        path = self.jobs/name
        path.mkdir()
        farm.write(path/'request.json', dict(kind=kind, gpu_count=count))
        farm.write(path/'status.json', dict(state='prepared'))
        farm.write(path/'prepared.json', dict(host_memory_gib=24))
        return path

    def test_multi_gpu_request_waits_for_complete_allocation(self):
        job = self.job('dual', 2)
        self.assertIsNone(gpu_allocation.select(job, {c['uuid'] for c in self.cards[:3]}))
        allocated = gpu_allocation.select(job, {c['uuid'] for c in self.cards[:2]})
        self.assertEqual(allocated, self.cards[2:])

    def test_scene_reserves_checkpoint_cards_and_leaves_other_cards_free(self):
        scene = self.job('scene', kind='scene')
        farm.write(scene/'prepared.json', dict(ranges=[dict(gpu=g) for g in self.cards[:2]]))
        self.assertIsNone(gpu_allocation.select(scene, {self.cards[0]['uuid']}))
        allocated = gpu_allocation.select(scene, set())
        single = self.job('single')
        self.assertEqual(gpu_allocation.select(single, {g['uuid'] for g in allocated}), self.cards[2:3])

    def test_atrest4_context_loss_policy_serializes_and_reserves_uuid(self):
        config=json.loads((Path(__file__).parents[1]/"config.json").read_text())
        self.assertEqual(config["scene_workers_per_gpu"].get("atrest4"),1)
        self.assertIn("atrest4",config["scene_exclusive_gpu"])
        policy=config["scene_policy_qualification"]["atrest4"]
        self.assertEqual(policy["selected_workers"],1)
        self.assertEqual(policy["qualification_status"],"observed_context_loss")
        gpu=dict(label="gpu1",uuid="GPU-atrest4")
        with patch.dict(farm.CONFIG,gpus=[gpu],workers_per_gpu=6,gpu_jobs_per_gpu=6,
                        scene_workers_per_gpu=config["scene_workers_per_gpu"],
                        scene_exclusive_gpu=config["scene_exclusive_gpu"]):
            ranges=farm.worker_ranges(2007,scene="atrest4")
            self.assertEqual(ranges,[dict(gpu=gpu,first=0,end_exclusive=2007,preroll=0)])
            job=self.job("atrest4",kind="scene")
            farm.write(job/"request.json",dict(kind="scene",scene="atrest4"))
            farm.write(job/"prepared.json",dict(ranges=ranges))
            self.assertEqual(gpu_allocation.slot_costs(job,[gpu]),{gpu["uuid"]:6})

    def test_unavailable_cards_are_excluded_from_single_and_scene_allocations(self):
        blocked={self.cards[0]['uuid']: 'HW thermal slowdown'}
        self.assertEqual(gpu_allocation.select(self.job('single'), set(), blocked), self.cards[1:2])
        scene=self.job('scene',kind='scene')
        self.assertIsNone(gpu_allocation.select(scene,set(),blocked))

    def sample(self, card, flags='0x0000000000000000', timestamp=None, memory='51'):
        timestamp=timestamp or datetime.datetime.now().strftime('%Y/%m/%d %H:%M:%S.%f')
        return ', '.join([timestamp,card['uuid'],'0000:23:00.0','54','42','0','5','P8',
                          '135','877','3','4','0','0',memory,flags])+'\n'

    def thermal_status(self, rows):
        directory=self.jobs/'activity'
        target=directory/'test-boot'
        target.mkdir(parents=True,exist_ok=True)
        (target/'gpu-activity.csv').write_text(rows)
        gpu_allocation._activity.clear()
        with patch.dict(farm.CONFIG,gpu_activity_directory=str(directory)), \
             patch.object(Path,'read_text',return_value='test-boot'):
            return gpu_allocation.unavailable()

    def test_thermal_slowdown_blocks_only_the_hot_card(self):
        rows=''.join(self.sample(g,flags='0x48' if i==2 else '0x1',memory='83' if i==2 else '51')
                     for i,g in enumerate(self.cards))
        self.assertEqual(set(self.thermal_status(rows)),{self.cards[2]['uuid']})

    def test_external_power_brake_blocks_admission(self):
        rows=''.join(self.sample(g,flags='0x80' if i==0 else '0x0') for i,g in enumerate(self.cards))
        self.assertEqual(set(self.thermal_status(rows)),{self.cards[0]['uuid']})

    def test_stale_and_missing_samples_block_admission(self):
        old=datetime.datetime.now()-datetime.timedelta(seconds=farm.CONFIG['gpu_health_timeout_seconds']+1)
        rows=self.sample(self.cards[0],timestamp=old.strftime('%Y/%m/%d %H:%M:%S.%f'))
        rows+=''.join(self.sample(g) for g in self.cards[1:3])
        self.assertEqual(set(self.thermal_status(rows)),{self.cards[0]['uuid'],self.cards[3]['uuid']})

    def test_legacy_telemetry_without_thermal_flags_blocks_admission(self):
        rows=''.join(','.join(self.sample(g).strip().split(',')[:14])+'\n' for g in self.cards)
        self.assertEqual(set(self.thermal_status(rows)),{g['uuid'] for g in self.cards})

    def test_appended_samples_restore_cooled_card_after_partial_row_finishes(self):
        path=self.jobs/'activity.csv'
        path.write_text(self.sample(self.cards[2],flags='0x48'))
        gpu_allocation._activity.clear()
        self.assertEqual(gpu_allocation.activity_records(path)[self.cards[2]['uuid']][15].strip(),'0x48')
        row=self.sample(self.cards[2])
        with path.open('a') as stream:stream.write(row[:-1])
        self.assertEqual(gpu_allocation.activity_records(path)[self.cards[2]['uuid']][15].strip(),'0x48')
        with path.open('a') as stream:stream.write('\n')
        self.assertEqual(gpu_allocation.activity_records(path)[self.cards[2]['uuid']][15].strip(),'0x0000000000000000')

    def test_four_single_gpu_jobs_render_concurrently_without_sharing(self):
        for i in range(4):
            self.job(str(i))
        barrier = threading.Barrier(4, timeout=5)
        lock = threading.Lock()
        allocations = []
        finished = []
        errors = []
        def picture(job, gpus):
            try:
                with lock:
                    allocations.append([g['uuid'] for g in gpus])
                barrier.wait()
                farm.write(job/'status.json', dict(state='pictured'))
            except Exception as error:
                errors.append(error)
                raise
        def finish(job):
            farm.write(job/'status.json', dict(state='complete'))
            with lock:
                finished.append(job.name)
                if len(finished) == 4:
                    farm.STOP.set()
        with patch.object(farm, 'JOBS', self.jobs), patch.object(farm, 'picture', side_effect=picture), \
                patch.object(farm, 'finish', side_effect=finish), patch.object(scheduler, 'Lease'):
            scheduler.work()
        self.assertEqual(errors, [])
        self.assertEqual(len(finished), 4)
        self.assertEqual({ids[0] for ids in allocations}, {c['uuid'] for c in self.cards})
        self.assertTrue(all(len(ids) == 1 for ids in allocations))

    def test_two_gpu_job_and_single_gpu_jobs_share_only_free_capacity(self):
        self.job('a', 2)
        self.job('b')
        self.job('c')
        barrier = threading.Barrier(3, timeout=5)
        lock = threading.Lock()
        allocations = []
        finished = []
        def picture(job, gpus):
            with lock:
                allocations.append({g['uuid'] for g in gpus})
            barrier.wait()
            farm.write(job/'status.json', dict(state='pictured'))
        def finish(job):
            farm.write(job/'status.json', dict(state='complete'))
            with lock:
                finished.append(job.name)
                if len(finished) == 3:
                    farm.STOP.set()
        with patch.object(farm, 'JOBS', self.jobs), patch.object(farm, 'picture', side_effect=picture), \
                patch.object(farm, 'finish', side_effect=finish), patch.object(scheduler, 'Lease'):
            scheduler.work()
        self.assertEqual(len(finished), 3)
        self.assertEqual(sorted(map(len, allocations)), [1, 1, 2])
        self.assertEqual(sum(map(len, allocations)), len(set().union(*allocations)))

    def test_memory_reservations_delay_jobs_until_active_job_finishes(self):
        for name in ['a','b']:
            job=self.job(name)
            farm.write(job/'prepared.json',dict(host_memory_gib=48))
        active=set();finished=[];lock=threading.Lock()
        def picture(job,gpus):
            with lock:
                self.assertEqual(active,set())
                active.add(job.name)
            # Allow a scheduler cycle while the job holds its memory reservation.
            threading.Event().wait(0.02)
            with lock:active.remove(job.name)
            farm.write(job/'status.json',dict(state='pictured'))
        def finish(job):
            farm.write(job/'status.json',dict(state='complete'))
            finished.append(job.name)
            if len(finished)==2:farm.STOP.set()
        with patch.object(gpu_allocation,'memory_available',return_value=64*2**30), \
             patch.object(farm,'JOBS',self.jobs),patch.object(farm,'picture',side_effect=picture), \
             patch.object(farm,'finish',side_effect=finish),patch.object(scheduler,'Lease'):
            scheduler.work()
        self.assertEqual(finished,['a','b'])


if __name__ == '__main__':
    unittest.main()
