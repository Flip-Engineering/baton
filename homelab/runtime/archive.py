"""Deliver validated farm outputs to archive main using the repo's LFS uploader."""
import base64, fcntl, hashlib, importlib.util, json, os, pathlib, subprocess
import farm

def make_share(job, receipt):
    scene = receipt["scene"]
    master = job / "out" / (scene + ".mp4")
    share = job / 'out' / (scene + '_share.mp4')
    # Follow farm_job.sh's <30 MiB share-copy contract, preserving the AAC stream.
    target = farm.CONFIG['share_target_mib']
    bitrate = max(1, int(target * 8 * 1024 / receipt['seconds'] - 330))
    farm.run(['ffmpeg', '-y', '-v', 'error', '-i', master, '-c:v', 'libx264', '-b:v', str(bitrate)+'k',
              '-maxrate', str(bitrate*2)+'k', '-bufsize', str(bitrate*2)+'k', '-preset', 'medium',
              '-vf', 'scale=in_color_matrix=auto:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd',
              '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
              '-c:a', 'copy', '-movflags', '+faststart', share], log=job / 'logs/archive-share.log')
    if share.stat().st_size >= farm.CONFIG['share_max_mib'] * 1024**2:
        raise RuntimeError('Share copy exceeds archive delivery limit')
    probe = json.loads(farm.run(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',share]))
    video = next(s for s in probe['streams'] if s['codec_type'] == 'video')
    if int(video['nb_read_frames']) != receipt['frames']:
        raise RuntimeError('Share-copy frame count mismatch')
    farm.run(['ffmpeg','-v','error','-xerror','-i',share,'-f','null','-'],log=job/'logs/archive-share-decode.log')
    def audio_hash(path):
        return farm.run(['ffmpeg','-v','error','-i',path,'-map','0:a','-c','copy','-f','hash','-hash','sha256','-'])
    if audio_hash(master) != audio_hash(share):
        raise RuntimeError('Share copy changed the mastered AAC stream')
    return share

def publish(job):
    with open(job / 'archive.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = job / 'archive.json'
        if marker.exists() and json.loads(marker.read_text()).get('state') == 'published':
            return json.loads(marker.read_text())
        status = json.loads((job / 'status.json').read_text())
        if status['state'] != 'complete':
            raise RuntimeError('Only validated, complete jobs may be archived')
        receipt = json.loads((job / 'receipt.json').read_text())
        scene = receipt['scene']
        master = job / 'out' / (scene + '.mp4')
        with open(master, 'rb') as content:
            actual_hash = hashlib.file_digest(content, 'sha256').hexdigest()
        if actual_hash != receipt['output_sha256']:
            raise RuntimeError('Completed master changed after validation')
        share = make_share(job, receipt)
        spec = importlib.util.spec_from_file_location('pipeline_lfs_put', job/'repo/videos/scripts/lfs_put.py')
        uploader = importlib.util.module_from_spec(spec); spec.loader.exec_module(uploader)
        token = subprocess.check_output(['gh','auth','token'],text=True).strip()
        auth = base64.b64encode(('x-access-token:'+token).encode()).decode()
        uploader.H['Authorization'] = 'Basic ' + auth
        # Do not emit credentials or authenticated request headers in logs.
        destination = 'videos/out/farm/homelab/' + job.name
        blobs = []
        hashes = {}
        for path in (master, share):
            oid, size = uploader.put(str(path))
            pointer = f'version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {size}\n'
            blobs.append((destination+'/'+path.name, pointer.encode()))
            hashes[path.name] = {'sha256':oid,'bytes':size}
        for path in [job/'receipt.json',job/'request.json',job/'out/contact-sheet.jpg',
                     *sorted((job/'out').glob('homelab-*-renderer.json')),
                     *sorted((job/'out').glob('*.finish.json'))]:
            blobs.append((destination+'/'+path.name,path.read_bytes()))
        for path in sorted((job/'harness').glob('*')):
            if path.is_file():
                blobs.append((destination+'/harness/'+path.name,path.read_bytes()))
        note = (f'# Homelab render job {job.name}\n\nScene: `{scene}`. Source commit: `{receipt["commit"]}`.\n'
                f'Picture: {receipt["frames"]} frames, {receipt["seconds"]} seconds, 1080x1920 at 30 fps.\n'
                'Rendered on GPU0 and GPU1 in independent frame ranges. GPU2 was excluded.\n'
                'Master and share copy carry the same measured AAC stream. Full decode and frame counts passed.\n'
                'These are revision-pinned farm builds for review. See receipt.json for audio and seam measurements.\n'
                'The receipt records phone-playback guidance separately from the transport checks.\n')
        blobs.append((destination+'/README.md',note.encode()))
        git = job / 'archive-git'
        if not (git/'.git').exists():
            git.mkdir(exist_ok=True)
            farm.run(['git','init','-q',git])
            farm.run(['git','remote','add','origin',farm.CONFIG['archive_repository']],cwd=git)
            farm.run(['git','config','extensions.partialClone','origin'],cwd=git)
        objects=[]
        for path,data in blobs:
            oid = subprocess.check_output(['git','hash-object','-w','--stdin'],cwd=git,input=data,env=farm.ENV).decode().strip()
            objects.append((path,oid))
        while True:
            farm.run(['git','fetch','-q','--filter=blob:none','--depth=1','origin','main'],cwd=git)
            parent=farm.run(['git','rev-parse','FETCH_HEAD'],cwd=git)
            farm.run(['git','read-tree',parent],cwd=git)
            for path,oid in objects:
                farm.run(['git','update-index','--add','--cacheinfo','100644,'+oid+','+path],cwd=git)
            tree=farm.run(['git','write-tree','--missing-ok'],cwd=git)
            message=f'Archive homelab farm job {job.name}: {scene}\n\nSource: {receipt["commit"]}\n'
            commit=subprocess.check_output(['git','-c','user.name=Homelab render farm',
                '-c','user.email=flip-engineer@users.noreply.github.com','commit-tree',tree,'-p',parent],
                cwd=git,input=message.encode(),env=farm.ENV).decode().strip()
            result=subprocess.run(['git','-c','pack.window=0','-c','core.bigFileThreshold=1','push','--no-thin',
                'origin',commit+':refs/heads/main'],cwd=git,env=farm.ENV,capture_output=True,text=True)
            if result.returncode == 0:
                break
            latest=farm.run(['git','ls-remote','origin','refs/heads/main'],cwd=git).split()[0]
            if latest == parent:
                raise RuntimeError('Archive push failed: '+result.stderr)
            print('Archive main advanced; rebuilding an additive commit on the new parent',flush=True)
        # Confirm GitHub serves the committed receipt, rather than treating a local ref as delivery.
        remote=json.loads(subprocess.check_output(['gh','api',
            'repos/flip-engineer/automated-content-pipeline-video-studies-archive/contents/'+destination+'/receipt.json?ref='+commit],text=True))
        if base64.b64decode(remote['content']) != (job/'receipt.json').read_bytes():
            raise RuntimeError('Remote archive receipt differs from local receipt')
        result={'state':'published','commit':commit,'path':destination,'files':hashes,'published':farm.now(),
                'url':'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive/tree/'+commit+'/'+destination}
        farm.write(marker,result)
        return result
