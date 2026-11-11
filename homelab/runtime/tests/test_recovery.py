"""Exercise interrupted jobs, completed outputs, and interrupted recovery moves."""
import json, os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import farm
import recovery


class Recovery(unittest.TestCase):
    def setUp(self):
        farm.STOP.clear();self.addCleanup(farm.STOP.clear)
        self.temp=tempfile.TemporaryDirectory()
        self.jobs=Path(self.temp.name)
        self.cards=[dict(label='gpu0',uuid='GPU-test')]
        self.patches=[patch.object(farm,'JOBS',self.jobs),patch.object(farm,'boot_id',return_value='new-boot'),
                      patch.dict(farm.CONFIG,gpus=self.cards,gpu_job_gpus=self.cards,protocol_enabled=False)]
        for item in self.patches:item.start();self.addCleanup(item.stop)
        self.addCleanup(self.temp.cleanup)

    def job(self,name='render',prepared=True):
        job=self.jobs/name;job.mkdir()
        request=dict(kind='gpu',gpu_kind='blender',gpu_count=1,commit='pinned',protocol_id=name)
        farm.write(job/'request.json',request)
        farm.write(job/'status.json',dict(state='interrupted',phase='rendering',execution_boot_id='old-boot'))
        (job/'logs').mkdir();(job/'logs/gpujob.log').write_text('prior GPU activity')
        if prepared:
            (job/'repo/videos/scripts').mkdir(parents=True)
            adapter=job/'repo/videos/scripts/gpu_job.farm.py';adapter.write_text('pinned helper')
            farm.write(job/'dependencies.json',dict(cache_key='pinned'))
            context=dict(request=request,commit='pinned',inputs={'videos/scripts/gpu_job.farm.py':farm.file_sha256(adapter)},
                         dependencies_manifest_sha256=farm.file_sha256(job/'dependencies.json'),host_memory_gib=24)
            farm.write(job/'prepared.json',context)
        output=job/'out/gpu'/name/'out';output.mkdir(parents=True)
        (output/'frame.png').write_text('partial frame')
        return job

    def run_recovery(self,containers='',kernel=''):
        def command(argv,**kwargs):return containers if argv[:2]==['docker','ps'] else 'pinned'
        with patch.object(farm,'run',side_effect=command), \
             patch.object(recovery.subprocess,'run',return_value=subprocess.CompletedProcess([],0,kernel,'')):
            recovery.recover()

    def test_same_id_and_prepared_inputs_survive_with_partial_outputs_preserved(self):
        job=self.job();before=(job/'request.json').read_bytes()
        self.run_recovery()
        status=json.loads((job/'status.json').read_text())
        self.assertEqual(status['state'],'prepared')
        self.assertEqual((job/'request.json').read_bytes(),before)
        attempt=Path(status['previous_attempt'])
        self.assertEqual((attempt/'gpu-output/out/frame.png').read_text(),'partial frame')
        self.assertEqual((attempt/'logs/gpujob.log').read_text(),'prior GPU activity')
        self.assertFalse((job/'out/gpu/render').exists())
        self.assertTrue((job/'prepared.json').exists())

    def test_current_boot_fault_does_not_rerun_interrupted_job(self):
        job=self.job()
        farm.write(job/'status.json',dict(state='failed',phase='rendering',error='GPU kernel check failed',execution_boot_id='new-boot'))
        self.run_recovery()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'failed')
        self.assertFalse((job/'attempts').exists())

    def test_new_boot_kernel_fault_holds_recovery(self):
        job=self.job()
        self.run_recovery(kernel='NVRM: Xid 79 GPU has fallen off the bus')
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'interrupted')
        self.assertFalse((job/'attempts').exists())
        self.assertTrue(farm.STOP.is_set())

    def test_current_boot_fault_blocks_new_dispatch_without_interrupted_jobs(self):
        job=self.job();farm.write(job/'status.json',dict(state='prepared'))
        with patch.dict(farm.CONFIG,gpu_activity_directory=str(self.jobs/'activity')):
            self.run_recovery(kernel='NVRM: Xid 79 GPU has fallen off the bus')
        self.assertTrue(farm.STOP.is_set())
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'prepared')

    def test_canonical_completed_job_keeps_outputs_and_is_not_rendered_again(self):
        job=self.job()
        with patch.dict(farm.CONFIG,protocol_enabled=True), \
             patch('protocol_bridge.command',return_value=json.dumps(dict(state='done'))) as command:
            self.run_recovery()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'remote_complete')
        self.assertEqual((job/'out/gpu/render/out/frame.png').read_text(),'partial frame')
        self.assertEqual(command.call_count,1)

    def test_canonical_lease_owned_by_other_worker_holds_recovery(self):
        job=self.job()
        with patch.dict(farm.CONFIG,protocol_enabled=True), \
             patch('protocol_bridge.command',return_value=json.dumps(dict(state='claimed',claim=dict(by='other-worker')))):
            self.run_recovery()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'interrupted')
        self.assertFalse((job/'attempts').exists())

    def test_live_container_holds_recovery_without_changing_its_outputs(self):
        job=self.job()
        self.run_recovery(containers='acp-render-gpujob\n')
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'interrupted')
        self.assertEqual((job/'out/gpu/render/out/frame.png').read_text(),'partial frame')

    def test_changed_prepared_input_is_retained_for_inspection(self):
        job=self.job()
        (job/'repo/videos/scripts/gpu_job.farm.py').write_text('changed')
        self.run_recovery()
        status=json.loads((job/'status.json').read_text())
        self.assertEqual(status['state'],'interrupted')
        self.assertIn('Prepared input changed',status['recovery_error'])
        self.assertFalse((job/'attempts').exists())

    def test_interrupted_preparation_requeues_with_same_request_and_retains_workspace(self):
        job=self.job(prepared=False);(job/'repo').mkdir();(job/'repo/partial').write_text('checkout')
        self.run_recovery()
        status=json.loads((job/'status.json').read_text())
        self.assertEqual(status['state'],'queued')
        self.assertEqual((Path(status['previous_attempt'])/'repo/partial').read_text(),'checkout')
        self.assertFalse((job/'repo').exists())
        self.assertTrue((job/'request.json').exists())

    def test_request_persisted_before_initial_status_write_is_requeued(self):
        job=self.job(prepared=False)
        (job/'status.json').unlink()
        os.utime(job/'request.json',(0,0))
        self.run_recovery()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'queued')
        self.assertEqual(json.loads((job/'request.json').read_text())['protocol_id'],'render')

    def test_legacy_startup_interrupted_status_recovers_prior_boot_checkpoint(self):
        job=self.job()
        farm.write(job/'status.json',dict(state='interrupted',error='Worker exited before completing; inspect logs before resubmitting'))
        os.utime(job/'prepared.json',(0,0))
        self.run_recovery()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'prepared')

    def test_second_power_failure_during_output_move_resumes_transaction(self):
        job=self.job();status=json.loads((job/'status.json').read_text())
        real_move=recovery.move
        def interrupted_move(source,target):
            real_move(source,target)
            if target.name=='gpu-output':raise OSError('Simulated power loss after rename')
        with patch.object(farm,'run',return_value='pinned'),patch.object(recovery,'move',side_effect=interrupted_move):
            with self.assertRaisesRegex(OSError,'Simulated power loss'):
                recovery.restore(job,status)
        pending=json.loads((job/'status.json').read_text())
        self.assertEqual(pending['state'],'recovering')
        attempt=pending['recovery_attempt']
        self.run_recovery()
        status=json.loads((job/'status.json').read_text())
        self.assertEqual(status['state'],'prepared')
        self.assertEqual(Path(status['previous_attempt']).name,attempt)
        self.assertEqual(len(list((job/'attempts').iterdir())),1)
        self.assertTrue((Path(status['previous_attempt'])/'gpu-output/out/frame.png').exists())

    def test_completed_gpu_receipt_recovers_to_delivery_without_another_render(self):
        job=self.job();deliver=job/'out/gpu/render/deliver';deliver.mkdir()
        output=deliver/'image.png';output.write_text('finished image')
        farm.write(deliver/'receipt.json',dict(job='render',repo=dict(commit='pinned'),status='ok',exit_code=0,
                   gpus=self.cards,seconds=dict(run=45),files=[dict(name='image.png',sha256=farm.file_sha256(output))]))
        self.run_recovery()
        self.assertEqual(json.loads((job/'status.json').read_text())['state'],'pictured')
        self.assertTrue((job/'pictured.json').exists())
        self.assertEqual(output.read_text(),'finished image')
        self.assertFalse(any(p.name=='gpu-output' for p in (job/'attempts').rglob('*')))

    def test_powercut_receipt_is_archived_and_verified_prepared_job_resumes(self):
        for content in ('', '{"status":"ok",'):
            with self.subTest(content=content):
                name='render'+str(len(list(self.jobs.iterdir())))
                job=self.job(name)
                deliver=job/'out/gpu'/name/'deliver';deliver.mkdir()
                (deliver/'receipt.json').write_text(content)
                self.run_recovery()
                status=json.loads((job/'status.json').read_text())
                self.assertEqual(status['state'],'prepared')
                attempt=Path(status['previous_attempt'])
                self.assertEqual((attempt/'gpu-output/deliver/receipt.json').read_text(),content)
                self.assertFalse((job/'pictured.json').exists())
                self.assertEqual(json.loads((job/'request.json').read_text())['protocol_id'],name)

    def test_partial_npm_directory_is_preserved_and_removed_before_retry(self):
        job=self.job()
        modules=job/'repo/videos/web/node_modules'
        (modules/'three').mkdir(parents=True)
        (modules/'partial.txt').write_text('interrupted install')
        self.run_recovery()
        status=json.loads((job/'status.json').read_text())
        self.assertEqual(status['state'],'prepared')
        self.assertFalse(modules.exists())
        archived=Path(status['previous_attempt'])/'runtime-node-modules'
        self.assertTrue((archived/'three').is_dir())
        self.assertEqual((archived/'partial.txt').read_text(),'interrupted install')

    def test_failed_fsync_keeps_the_previous_checkpoint(self):
        path=self.jobs/'checkpoint.json';farm.write(path,dict(state='prepared'))
        with patch.object(farm.os,'fsync',side_effect=OSError('Simulated disk failure')):
            with self.assertRaisesRegex(OSError,'Simulated disk failure'):
                farm.write(path,dict(state='pictured'))
        self.assertEqual(json.loads(path.read_text()),dict(state='prepared'))


if __name__=='__main__':unittest.main()
