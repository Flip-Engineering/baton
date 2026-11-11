"""Validated retry planning for scene frame ranges."""
import json
import re
import subprocess
from pathlib import Path

import farm

PLAN_NAME = 'range-retry.json'
MAX_EXPLICIT_RETRIES = 3

def pins(job, context):
    return {'request_sha256': farm.file_sha256(job / 'request.json'),
            'prepared_sha256': farm.file_sha256(job / 'prepared.json'),
            'commit': context['commit'], 'scene': context['scene'],
            'ranges': [{'label': i['gpu']['label'], 'first': i['first'],
                        'end_exclusive': i['end_exclusive']} for i in context['ranges']]}

def eligible(job, status, context):
    return (context.get('request', {}).get('kind') != 'gpu'
            and status.get('state') == 'failed'
            and status.get('failure_kind') == 'render_context'
            and status.get('phase') == 'rendering'
            and 'WebGL context loss' in status.get('error', '')
            and bool(farm.context_loss_logs(job)))

def range_key(item):
    return (item['gpu']['label'], int(item['first']), int(item['end_exclusive']))

def record_key(row):
    return (row.get('label'), int(row.get('first', -1)), int(row.get('end_exclusive', -1)))

def _probe(path, expected):
    result = json.loads(farm.run(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',path]))
    video = next((s for s in result.get('streams', []) if s.get('codec_type') == 'video'), None)
    count = int(video['nb_read_frames']) if video else -1
    if (not video or count != expected or int(video.get('width',0)) != 1080
            or int(video.get('height',0)) != 1920 or video.get('avg_frame_rate') != '30/1'):
        raise ValueError('Scene range output failed geometry or frame-count validation: '+str(path))
    farm.run(['ffmpeg','-v','error','-xerror','-i',path,'-f','null','-'])
    return {'frames':count,'width':1080,'height':1920,'fps':'30/1','full_decode':'passed'}

def validate_output(job, item, log_dir, require_log):
    label=item['gpu']['label']; path=job/'out'/(label+'.mp4')
    if path.is_symlink() or not path.is_file(): return None
    if require_log:
        log=Path(log_dir)/(label+'.log')
        if not log.is_file(): return None
        text=log.read_text(errors='replace')
        if re.search(r'GL_CONTEXT_LOST_KHR|Unexpected driver error|"name":\s*"FarmWebGLContextLost"',text): return None
        marker=re.compile(r'^.+: wrote /work/videos/out/'+re.escape(label)+r'\.mp4 in [0-9.]+s \(',re.M)
        if not marker.search(text): return None
    try: validation=_probe(path,int(item['end_exclusive'])-int(item['first']))
    except (OSError,ValueError,KeyError,StopIteration,subprocess.CalledProcessError): return None
    return {'label':label,'first':int(item['first']),'end_exclusive':int(item['end_exclusive']),
            'sha256':farm.file_sha256(path),'validation':validation}

def load_plan(job, context):
    path=job/PLAN_NAME
    if not path.is_file(): return None
    plan=json.loads(path.read_text())
    if plan.get('pins') != pins(job,context):
        raise ValueError('Scene retry plan no longer matches the pinned request and preparation')
    return plan

def validate_plan_outputs(job, context, plan):
    valid={}
    for item in context['ranges']:
        found=next((r for r in plan.get('completed',[]) if record_key(r)==range_key(item)),None)
        if not found: continue
        path=job/'out'/(item['gpu']['label']+'.mp4')
        if path.is_symlink() or not path.is_file() or farm.file_sha256(path)!=found.get('sha256'): continue
        try: details=_probe(path,int(item['end_exclusive'])-int(item['first']))
        except (OSError,ValueError,KeyError,StopIteration,subprocess.CalledProcessError): continue
        if details==found.get('validation'): valid[range_key(item)]=found
    return valid

def begin_or_update(job, status, context, attempt):
    current_pins=pins(job,context); path=job/PLAN_NAME
    plan=json.loads(path.read_text()) if path.is_file() else None
    if plan and plan.get('pins')!=current_pins: raise ValueError('Existing scene retry plan has different input pins')
    if plan is None: plan={'schema':'acp.scene-range-retry/v1','pins':current_pins,
                           'retry_count':0,'completed':[],'attempts':[]}
    if plan['retry_count']>=MAX_EXPLICIT_RETRIES:
        raise ValueError('Scene range retry limit reached; outputs retained for inspection')
    by_key={record_key(r):r for r in plan.get('completed',[])}
    for item in context['ranges']:
        accepted=validate_output(job,item,job/'logs',require_log=True)
        if accepted: by_key[range_key(item)]=accepted
    plan['completed']=list(by_key.values()); plan['retry_count']+=1
    plan['attempts'].append({'attempt':attempt.name,'error':status.get('error',''),
        'failed_at':status.get('finished',farm.now()),
        'completed_ranges':[{'label':r['label'],'first':r['first'],'end_exclusive':r['end_exclusive']} for r in plan['completed']]})
    farm.write(path,plan)
    return plan

def pending_ranges(job, context):
    plan=load_plan(job,context)
    if plan is None: return list(context['ranges']),None
    valid=validate_plan_outputs(job,context,plan)
    return [i for i in context['ranges'] if range_key(i) not in valid],plan

def archive_unvalidated(job, context, attempt, plan):
    valid=validate_plan_outputs(job,context,plan)
    for item in context['ranges']:
        if range_key(item) in valid: continue
        source=job/'out'/(item['gpu']['label']+'.mp4')
        if source.exists():
            target=attempt/'partial-picture'/source.name
            target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists(): raise ValueError('Recovery destination already contains data: '+str(target))
            source.rename(target); farm.sync_directory(source.parent); farm.sync_directory(target.parent)
    return valid
