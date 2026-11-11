import pathlib,tempfile,unittest
from unittest.mock import patch
import farm,gpu_lane,gpu_allocation
class Lanes(unittest.TestCase):
 def test_distinct_gpu_ownership_locks_and_shared_memory_coordinator(self):
  cards=[{'label':'gpu'+str(i),'uuid':'GPU-'+str(i)} for i in (0,1,3)]
  results=[]
  for card in cards:
   with patch.dict(farm.CONFIG,gpus=cards,gpu_job_gpus=cards,storage='/tmp/farm'),patch.object(farm,'BASE',pathlib.Path('/tmp/farm')),patch.object(farm,'JOBS',pathlib.Path('/tmp/farm/jobs')):
    gpu_lane.configure(card['label']);self.assertEqual(gpu_allocation.pool(),[card])
    results.append((farm.BASE/'worker.lock',farm.JOBS,farm.CONFIG['coordinator_root']))
  self.assertEqual(len({r[0] for r in results}),3);self.assertEqual(len({r[1] for r in results}),3)
  self.assertEqual(len({r[2] for r in results}),1)
 def test_unknown_lane_refused(self):
  with self.assertRaises(ValueError):gpu_lane.configure('missing')
 def test_host_budget_limits_admission_memory(self):
  with patch.dict(farm.CONFIG,host_memory_budget_bytes=1):self.assertEqual(gpu_allocation.memory_available(),1)
 def test_other_lane_running_and_pending_reservations_are_counted(self):
  import tempfile,json
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp);own=root/'lanes/gpu1/jobs';own.mkdir(parents=True)
   other=root/'jobs/job';other.mkdir(parents=True)
   farm.write(other/'request.json',{'kind':'gpu','gpu_argv':['--mem','48']})
   farm.write(other/'status.json',{'state':'running','execution_boot_id':farm.boot_id()})
   with patch.dict(farm.CONFIG,coordinator_root=str(root)),patch.object(farm,'JOBS',own):
    self.assertEqual(gpu_allocation.external_reserved(),48*2**30)
    farm.write(other/'status.json',{'state':'prepared'})
    self.assertEqual(gpu_allocation.external_reserved(),0)
    gpu_allocation.reserve(other,24*2**30)
    self.assertEqual(gpu_allocation.external_reserved(),24*2**30)
    farm.write(other/'status.json',{'state':'complete'})
    self.assertEqual(gpu_allocation.external_reserved(),0)
 def test_dead_owner_pending_reservation_does_not_block_queue(self):
  import tempfile,json
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp);job=root/'jobs/job';job.mkdir(parents=True)
   farm.write(job/'status.json',{'state':'prepared'})
   farm.write(job/'admission.json',{'memory_bytes':100,'boot_id':farm.boot_id(),'owner_pid':999999999,'owner_start':'dead'})
   with patch.dict(farm.CONFIG,coordinator_root=str(root)),patch.object(farm,'JOBS',root/'lanes/gpu1/jobs'):
    self.assertEqual(gpu_allocation.external_reserved(),0)
 def test_lane_bootstrap_provides_gpu_environment_mount_before_claim(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp)
   for name in ('plugins','npm-cache','gpu-work','object-cache'):(root/name).mkdir()
   base=root/'lanes/gpu1'
   with patch.object(farm,'BASE',base):gpu_lane.prepare_storage(root)
   self.assertEqual((base/'gpu-work').resolve(),root/'gpu-work')
   self.assertTrue((base/'jobs').is_dir())
 def test_missing_shared_gpu_cache_fails_before_claim(self):
  with tempfile.TemporaryDirectory() as temp:
   root=pathlib.Path(temp)
   with patch.object(farm,'BASE',root/'lanes/gpu1'),self.assertRaisesRegex(ValueError,'environment cache is missing'):
    gpu_lane.prepare_storage(root)
if __name__=='__main__':unittest.main()
