import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import farm

_protocol_dir=Path(__file__).resolve().parents[1]/'protocol'
sys.path.insert(0,str(_protocol_dir))
_spec=importlib.util.spec_from_file_location('pipeline_farm',_protocol_dir/'pipeline-farm.py')
pipeline_farm=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pipeline_farm)


class SavedAudioRetry(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.jobs=self.root/'jobs'
        self.jobs.mkdir()
        self.patch=patch.object(farm,'JOBS',self.jobs)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.source=self.jobs/'protocol-original'
        (self.source/'out').mkdir(parents=True)
        (self.source/'repo').mkdir()
        farm.write(self.source/'request.json',{'protocol_id':'original','scene':'atrest4','commit':'a'*40,'protocol_spec':{'pipeline_commit':'a'*40}})
        farm.write(self.source/'status.json',{'state':'prepared'})
        payloads={'.atrest4.wav':b'wave bytes','.atrest4.hits.json':b'{"bpm":72}','.atrest4.sting.wav':b'sting'}
        for name,data in payloads.items(): (self.source/'out'/name).write_bytes(data)
        farm.write(self.source/'prepared.json',{
            'scene':'atrest4','commit':'a'*40,'frames':6,
            'wav_sha256':farm.file_sha256(self.source/'out/.atrest4.wav'),
            'hits_sha256':farm.file_sha256(self.source/'out/.atrest4.hits.json'),
            'ranges':[{'first':0,'end_exclusive':3,'gpu':{'uuid':'GPU-old'}},
                      {'first':3,'end_exclusive':6,'gpu':{'uuid':'GPU-old'}}]})
        self.target=self.jobs/'protocol-retry'
        (self.target/'out').mkdir(parents=True)
        (self.target/'logs').mkdir()
        (self.target/'repo').mkdir()
        self.request={'protocol_id':'retry','commit':'b'*40,
                      'protocol_spec':{'retry_of':'original','reuse_audio_from':'original','pipeline_commit':'b'*40}}

    def test_copies_verified_audio_and_records_provenance(self):
        with patch.object(farm,'run',return_value='') as run:
            result=farm.prepare_reused_scene_audio(self.target,self.request,'atrest4',self.target/'repo')
        self.assertEqual(run.call_count,2)
        self.assertEqual(result['receipt']['source_protocol_id'],'original')
        self.assertEqual(result['receipt']['target_commit'],'b'*40)
        self.assertTrue(result['receipt']['audio_tree_unchanged'])
        self.assertEqual((self.target/'out/.atrest4.wav').read_bytes(),b'wave bytes')
        self.assertEqual((self.target/'out/.atrest4.sting.wav').read_bytes(),b'sting')
        self.assertEqual(json.loads((self.target/'audio-reuse.json').read_text()),result['receipt'])

    def test_audio_source_tree_change_refuses_without_copy(self):
        def changed(cmd,**kwargs):
            if cmd[1]=='diff': raise subprocess.CalledProcessError(1,cmd)
            return ''
        with patch.object(farm,'run',side_effect=changed):
            with self.assertRaisesRegex(farm.JobInputError,'Audio source tree differs'):
                farm.prepare_reused_scene_audio(self.target,self.request,'atrest4',self.target/'repo')
        self.assertFalse((self.target/'out/.atrest4.wav').exists())

    def test_unlinked_or_wrong_scene_retry_is_refused(self):
        self.request['protocol_spec']['retry_of']='someone-else'
        with self.assertRaisesRegex(farm.JobInputError,'same original retry job'):
            farm.prepare_reused_scene_audio(self.target,self.request,'atrest4',self.target/'repo')
        self.request['protocol_spec']['retry_of']='original'
        with self.assertRaisesRegex(farm.JobInputError,'matching prepared scene'):
            farm.prepare_reused_scene_audio(self.target,self.request,'other-scene',self.target/'repo')
        self.assertFalse((self.target/'out/.atrest4.wav').exists())

    def test_changed_saved_audio_hash_is_refused(self):
        (self.source/'out/.atrest4.wav').write_bytes(b'tampered')
        with patch.object(farm,'run',return_value=''):
            with self.assertRaisesRegex(farm.JobInputError,'hash changed'):
                farm.prepare_reused_scene_audio(self.target,self.request,'atrest4',self.target/'repo')
        self.assertFalse((self.target/'out/.atrest4.wav').exists())

    def test_exact_frame_boundaries_survive_current_gpu_assignment(self):
        old=json.loads((self.source/'prepared.json').read_text())
        current=[{'first':0,'end_exclusive':3,'gpu':{'uuid':'GPU-new'}},
                 {'first':3,'end_exclusive':6,'gpu':{'uuid':'GPU-new'}}]
        self.assertEqual(farm.preserve_scene_frame_ranges(old,6,current),current)
        current[1]['first']=4
        with self.assertRaisesRegex(farm.JobInputError,'original frame ranges'):
            farm.preserve_scene_frame_ranges(old,6,current)

    def test_queue_retry_records_audio_source_link(self):
        class Pipe:
            def __init__(self): self.job=None
            def head(self): return 'c'*40
            def commit(self, rev, files, message):
                self.job=json.loads(next(iter(files.values())))
                return True
        pipe=Pipe()
        pipeline_farm.post_job(pipe,'AT_REST corrected source',
            ['sh videos/scripts/local_render.sh --seg atrest4:76.4'],
            'atrest4','homelab','linked corrected retry','8'*40,'original',
            ['videos/out/farm/atrest4.mp4'],{},reuse_audio_from='original')
        self.assertEqual(pipe.job['retry_of'],'original')
        self.assertEqual(pipe.job['reuse_audio_from'],'original')
        self.assertEqual(pipe.job['pipeline_commit'],'8'*40)

    def test_queue_rejects_audio_source_without_matching_retry(self):
        class Pipe:
            def head(self): return 'c'*40
            def commit(self,*args): raise AssertionError('invalid retry must not write')
        with self.assertRaisesRegex(ValueError,'retry source'):
            pipeline_farm.post_job(Pipe(),'invalid',['render'],'atrest4','homelab','',
                '8'*40,'different-original',['out.mp4'],{},reuse_audio_from='original')


if __name__=='__main__':
    unittest.main()
