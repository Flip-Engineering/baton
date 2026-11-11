"""Partition qualified independent bench plates across existing GPU workers."""
import collections
import hashlib
import json
import pathlib
import subprocess
import time
import uuid

BENCH_SHA256 = 'b47b2eb3eccdbef18c57433087aada27779c9f133bcd241e93533811f7c0a584'
HTML_SHA256 = '2d5364eda652c0843b50a35cebf09beea96245d72dd927bbf32296c519cd81cd'
POLICY = 'independent_bench_plates_v1'


def plate_starts(spec):
    repeat = spec.get('repeat', 3)
    if type(repeat) is not int or repeat < 1:
        raise ValueError('Bench repeat must be a positive integer')
    plates = spec.get('plates')
    if not isinstance(plates, list) or not plates:
        raise ValueError('Bench needs a plate list')
    starts = [0]
    for plate in plates:
        w, h = plate['w'], plate['h']
        if any(type(v) is not int or v < 1 for v in (w, h)):
            raise ValueError('Bench dimensions must be positive integers')
        starts.append(starts[-1] + ((w + 1079)//1080)*((h + 1887)//1888)*repeat)
    return starts


def plan(context, spec):
    starts = plate_starts(spec)
    original = context['ranges']
    frames = context['frames']
    if starts[-1] > frames:
        raise ValueError('Bench span omits requested plate frames')
    if len({r['gpu']['uuid'] for r in original}) != 1:
        raise ValueError('Qualification covers one UUID per render lane')
    if not original or len({r['gpu']['label'] for r in original}) != len(original):
        raise ValueError('Worker identities must be unique')
    if (original[0]['first'] != 0 or original[-1]['end_exclusive'] != frames or
            any(a['end_exclusive'] != b['first'] for a, b in zip(original, original[1:]))):
        raise ValueError('Original frame ranges must cover the picture')
    count = min(len(original), len(starts)-1)
    cuts = [starts[(len(starts)-1)*i//count] for i in range(count)] + [frames]
    ranges = [dict(gpu=dict(original[i]['gpu']), first=cuts[i],
                   end_exclusive=cuts[i+1], preroll=cuts[i]) for i in range(count)]
    # Every original worker replays its parent history, including skipped plates.
    old_loads = sum(sum(start < r['end_exclusive'] and end > r.get('preroll', r['first'])
                        for start, end in zip(starts, starts[1:])) for r in original)
    metadata = dict(policy=POLICY, original_ranges=original, plate_starts=starts,
                    original_plate_initializations=old_loads,
                    planned_plate_initializations=len(starts)-1,
                    workers=len(ranges), original_workers=len(original),
                    quality='Original plate warm frames, render time, dimensions, capture, and codec',
                    variable_metadata='Per-worker readiness and render duration strip and caption')
    return ranges, metadata


def qualify(job, context):
    scene = context.get('scene', '')
    if not scene.startswith('bench_') or context['request'].get('kind') == 'gpu':
        return None
    repo = job/'repo'
    paths = [('videos/web/lib/bench_scene.js', BENCH_SHA256),
             (f'videos/web/scenes/{scene}.html', HTML_SHA256)]
    spec_path = f'videos/web/assets/bench/{scene[6:]}.json'
    paths.append((spec_path, None))
    fingerprints = {}
    for rel, qualified in paths:
        path = repo/rel
        if path.is_symlink():
            raise ValueError('Bench input is a symlink: '+rel)
        current = hashlib.sha256(path.read_bytes()).hexdigest()
        if qualified and current != qualified:
            return None
        pinned = subprocess.check_output(['git', 'show', context['commit']+':'+rel], cwd=repo)
        if hashlib.sha256(pinned).hexdigest() != current:
            raise ValueError('Bench input differs from pinned source: '+rel)
        fingerprints[rel] = current
    bench = (repo/'videos/web/lib/bench_scene.js').read_text()
    expected = bench.replace('    const limit = (pl.ready_s || 300) * 1000;',
        '    // Wait for readiness or an explicit scene error; elapsed time is not failure.', 1).replace(
        '        else if (performance.now() - t0 > limit) { clearInterval(iv); ok({ status: 2, msg: `no sceneReady after ${limit / 1000} s` }); }', '', 1)
    renderer = (repo/'videos/web/render.farm.mjs').read_text()
    anchor = "await page.route('**/web/lib/bench_scene.js', route => route.fulfill({contentType: 'text/javascript', body: "
    if renderer.count(anchor) != 1:
        return None
    adapted, _ = json.JSONDecoder().raw_decode(renderer.split(anchor)[1])
    if adapted != expected:
        return None
    try:
        ranges, metadata = plan(context, json.loads((repo/spec_path).read_text()))
    except ValueError:
        return None
    metadata['source_sha256'] = fingerprints
    metadata['adapted_bench_sha256'] = hashlib.sha256(adapted.encode()).hexdigest()
    metadata['policy_sha256'] = hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
    return ranges, metadata


def apply_context(job, context):
    qualified = qualify(job, context)
    if qualified is None:
        return context
    ranges, metadata = qualified
    return dict(context, ranges=ranges, bench_parallel=metadata)


def validate_inputs(job, context):
    policy = context.get('bench_parallel')
    if not policy:
        return
    for rel, expected in policy['source_sha256'].items():
        path = job/'repo'/rel
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Prepared bench input changed: '+rel)


def upgrade(job):
    import farm
    import gpu_allocation
    from recovery import validate_prepared
    if json.loads((job/'status.json').read_text()).get('state') != 'prepared':
        return 'active_or_unprepared'
    marker = job/'admission.json'
    if marker.exists():
        owner = json.loads(marker.read_text())
        if (owner.get('boot_id') == farm.boot_id() and owner.get('owner_start') and
                owner['owner_start'] == gpu_allocation.process_start(owner['owner_pid'])):
            return 'live_owner'
    context = json.loads((job/'prepared.json').read_text())
    if context.get('bench_parallel', {}).get('policy') == POLICY:
        return 'current'
    qualified = qualify(job, context)
    if qualified is None:
        return 'unqualified'
    validate_prepared(job)
    ranges, metadata = qualified
    attempt = job/'attempts'/('bench-parallel-'+uuid.uuid4().hex)
    attempt.mkdir(parents=True)
    farm.write(attempt/'prepared.json', context)
    (attempt/'bench_parallel.py').write_bytes(pathlib.Path(__file__).read_bytes())
    farm.write(attempt/'upgrade.json', dict(state='prepared', policy=metadata,
               request_sha256=farm.file_sha256(job/'request.json'), started=farm.now()))
    # The atomic checkpoint switch changes only frame assignment and its evidence.
    # Source, generated renderer, audio, capture helpers, and arguments stay pinned.
    farm.write(job/'prepared.json', dict(context, ranges=ranges, bench_parallel=metadata))
    validate_prepared(job)
    farm.write(attempt/'upgrade.json', dict(state='complete', policy=metadata,
               request_sha256=farm.file_sha256(job/'request.json'), finished=farm.now()))
    print(json.dumps(dict(job=str(job), state='upgraded', policy=metadata,
                         backup=str(attempt))), flush=True)
    return 'upgraded'


def run():
    import farm
    import gpu_allocation
    root = pathlib.Path(farm.CONFIG['storage'])
    counts = collections.Counter()
    transactions = []
    for directory in (root/'jobs', *root.glob('lanes/*/jobs')):
        for status in sorted(directory.glob('*/status.json')):
            if json.loads(status.read_text()).get('state') != 'prepared':
                continue
            checkpoint = status.parent/'prepared.json'
            context = json.loads(checkpoint.read_text())
            if not context.get('scene', '').startswith('bench_') or context.get('bench_parallel', {}).get('policy') == POLICY:
                continue
            try:
                with gpu_allocation.admission_guard():
                    started = time.monotonic()
                    result = upgrade(status.parent)
                    transactions.append(dict(job=status.parent.name,
                                             admission_lock_seconds=time.monotonic()-started))
            except Exception as error:
                result = 'held'
                print(json.dumps(dict(job=str(status.parent), state=result, error=str(error))), flush=True)
            counts[result] += 1
    print(json.dumps(dict(finished=farm.now(), counts=counts, transactions=transactions)), flush=True)
    return counts


if __name__ == '__main__':
    if run().get('held'):
        raise SystemExit(1)
