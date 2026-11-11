import json,pathlib,tempfile,unittest
from unittest.mock import patch
import admission_policy,farm,scheduler


class AdmissionPolicy(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=pathlib.Path(self.tmp.name)
        self.cards=[dict(label='gpu'+str(i),uuid='GPU-'+str(i)) for i in range(2)]
        p=patch.dict(farm.CONFIG,gpus=self.cards,gpu_job_gpus=self.cards,gpu_jobs_per_gpu=6,
                     scene_exclusive_gpu=['exclusive'])
        p.start();self.addCleanup(p.stop)

    def job(self,name,submitted,card=0,kind='scene',memory=0,count=1):
        job=self.root/name;job.mkdir()
        request=dict(kind=kind,scene='exclusive',submitted=submitted,gpu_count=count)
        farm.write(job/'request.json',request);farm.write(job/'status.json',dict(state='prepared'))
        farm.write(job/'prepared.json',dict(host_memory_gib=memory or 1,ranges=[dict(gpu=self.cards[card])]))
        return job

    def test_older_scene_reserves_gpu_while_other_gpu_backfills(self):
        old=self.job('z_old','2026-10-15T01:00:00Z')
        late=self.job('a_new','2026-10-15T02:00:00Z',kind='gpu')
        plan=admission_policy.plan([late,old],{'GPU-0':1},{},100*2**30,0)
        self.assertEqual([(j,c) for j,c,_ in plan],[(late,[self.cards[1]])])

    def test_scene_starts_when_prior_work_drains(self):
        old=self.job('z_old','2026-10-15T01:00:00Z')
        later=self.job('a_new','2026-10-15T02:00:00Z',kind='gpu')
        plan=admission_policy.plan([later,old],{}, {},100*2**30,0)
        self.assertEqual([j for j,_,_ in plan],[old,later])
        self.assertEqual(plan[1][1],[self.cards[1]])

    def test_thermal_hold_keeps_healthy_card_busy(self):
        held=self.job('a','2026-10-15T01:00:00Z')
        healthy=self.job('b','2026-10-15T02:00:00Z',card=1)
        plan=admission_policy.plan([held,healthy],{}, {'GPU-0':'thermal'},10*2**30,0)
        self.assertEqual([j for j,_,_ in plan],[healthy])

    def test_memory_waiter_reserves_remaining_ram(self):
        old=self.job('a','2026-10-15T01:00:00Z',kind='gpu',memory=48)
        late=self.job('b','2026-10-15T02:00:00Z',kind='gpu',memory=8)
        plan=admission_policy.plan([old,late],{}, {},64*2**30,24*2**30)
        self.assertEqual(plan,[])

    def test_impossible_request_does_not_block_feasible_work(self):
        old=self.job('a','2026-10-15T01:00:00Z',kind='gpu',memory=128)
        late=self.job('b','2026-10-15T02:00:00Z',kind='gpu',memory=8)
        plan=admission_policy.plan([old,late],{}, {},64*2**30,0)
        self.assertEqual([j for j,_,_ in plan],[late])

    def test_scene_without_memory_declaration_stays_queued_with_hold_reason(self):
        unknown=self.job('unknown','2026-10-15T01:00:00Z')
        farm.write(unknown/'prepared.json',dict(ranges=[dict(gpu=self.cards[0])]))
        holds=[]
        plan=admission_policy.plan([unknown],{}, {},100*2**30,0,
                                   on_hold=lambda job,reason:holds.append((job,reason)))
        self.assertEqual(plan,[])
        self.assertEqual(holds,[(unknown,'missing-host-memory-declaration')])

    def test_unknown_prepared_jobs_do_not_block_valid_later_queue_intake(self):
        held=[self.job("older-unknown-"+str(i),"2026-10-15T01:00:00Z") for i in range(6)]
        for job in held:
            farm.write(job/"prepared.json",dict(ranges=[dict(gpu=self.cards[0])]))
        canary=self.job("later-canary","2026-10-15T02:00:00Z",kind="gpu",card=0,memory=8,count=1)
        self.assertEqual(scheduler.preparation_buffer_usage(held),0)
        self.assertLess(scheduler.preparation_buffer_usage(held),1)
        self.assertEqual(scheduler.preparation_buffer_usage(held+[canary]),1)
        plan=admission_policy.plan(held+[canary],{}, {},64*2**30,0)
        self.assertEqual([(job,gpus,memory) for job,gpus,memory in plan],
                         [(canary,[self.cards[0]],8*2**30)])
        self.assertTrue(all((job/"prepared.json").is_file() for job in held))

    def test_unknown_scene_does_not_reserve_slots_from_valid_later_canary(self):
        unknown=self.job('older-unknown','2026-10-15T01:00:00Z')
        ranges=[dict(gpu=self.cards[0]) for _ in range(6)]
        farm.write(unknown/'prepared.json',dict(ranges=ranges))
        canary=self.job('later-canary','2026-10-15T02:00:00Z',kind='gpu',card=0,memory=8,count=1)
        original_ranges=json.loads((unknown/'prepared.json').read_text())['ranges']
        holds=[]
        plan=admission_policy.plan([canary,unknown],{'GPU-1':6},{},64*2**30,0,
                                   on_hold=lambda job,reason:holds.append((job,reason)))
        self.assertEqual([(job,gpus,memory) for job,gpus,memory in plan],
                         [(canary,[self.cards[0]],8*2**30)])
        self.assertEqual(holds,[(unknown,'missing-host-memory-declaration')])
        self.assertEqual(json.loads((unknown/'prepared.json').read_text())['ranges'],original_ranges)

if __name__=='__main__':unittest.main()
