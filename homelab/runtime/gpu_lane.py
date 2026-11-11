"""Run a durable worker for one configured GPU with its own queue and lock."""
import json,pathlib,sys
import farm


def configure(label):
    cards={g['label']:g for g in __import__('gpu_allocation').pool()}
    if label not in cards:raise ValueError('Unknown configured GPU lane: '+label)
    root=pathlib.Path(farm.CONFIG['storage'])
    if label!='gpu0':farm.BASE=root/'lanes'/label
    farm.JOBS=farm.BASE/'jobs'
    farm.CONFIG.update(gpus=[cards[label]],gpu_job_gpus=[cards[label]],worker_lane=label)
    farm.CONFIG['coordinator_root']=str(root)
    return root


def prepare_storage(root):
    farm.BASE.mkdir(parents=True,exist_ok=True)
    for name in ('jobs','tmp'):(farm.BASE/name).mkdir(exist_ok=True)
    for name in ('plugins','npm-cache','gpu-work','object-cache'):
        source=root/name;target=farm.BASE/name
        if target.exists():continue
        if source.exists():target.symlink_to(source,target_is_directory=True)
        elif name=='gpu-work':raise ValueError('Shared GPU environment cache is missing: '+str(source))


def main():
    label=sys.argv.pop(1);root=configure(label);prepare_storage(root)
    if len(sys.argv)>1 and sys.argv[1]=='repair':
        sys.argv.pop(1);__import__('repair_queue').main()
    else:farm.main()

if __name__=='__main__':main()
