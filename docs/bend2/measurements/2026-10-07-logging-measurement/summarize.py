#!/usr/bin/env python3
"""Assemble the issue #686 measurement record from the per-run result files.

Usage: summarize.py WORKDIR RECORD_DIR RECORD_JSON

Copies every per-run result.json, inventory.json and run log into RECORD_DIR,
writes RECORD_DIR/runs.json with the full detail, and writes RECORD_JSON with
the headline figures.
"""
import hashlib
import json
import pathlib
import shutil
import sys

RUNS = ('run1-before-default', 'run2-after-default', 'run3-after-segments',
        'run4-after-diagnostic', 'run5-replay-omp-window', 'run6-replay-codex-a-default',
        'run7-replay-codex-b-default', 'run8-replay-codex-a-diagnostic', 'run9-incomplete')


def load(path):
    try:
        return json.loads(pathlib.Path(path).read_text())
    except FileNotFoundError:
        return None


def batch_rows(run):
    if not run:
        return None
    return {'exe_sha256': run['exe_sha256'], 'level': run['level'], 'budget': run['budget'],
            'segments': run['segments'], 'returncode': run['returncode'],
            'live_log_paths': [pathlib.Path(path).name for path in run.get('live_log_paths', [])],
            'retained_log_bytes': run['retained_log_bytes'],
            'batches': [{'batch': row['batch'], 'emitted_bytes': row['bytes'],
                         'emitted_frames': row['frames'], 'retained_bytes': row['retained_bytes'],
                         'wall_seconds': row['wall_seconds'],
                         **({'by_type': row['by_type']} if 'by_type' in row else {})}
                        for row in run['measurements']]}


def replay_rows(run):
    if not run:
        return None
    return {'emitted_bytes': run['emitted_bytes'], 'emitted_lines': run['emitted_lines'],
            'retained_bytes_matched': run['retained_bytes_matched'],
            'retained_lines': run['retained_lines'], 'dropped_lines': run['dropped_lines'],
            'log_bytes': run['log_bytes'], 'note_lines': len(run['note_lines']),
            'terminal_report': run['terminal_report'], 'by_type': run['by_type'],
            'retained_samples': run['retained_samples'], 'dropped_samples': run['dropped_samples'],
            'appended_terminal_frames': run.get('appended_terminal_frames'),
            'policy': run.get('policy')}


def largest_peak(runs, wanted):
    """The largest sampled size of the file class named by `wanted(name, path)`."""
    best = None
    for run_name, run in runs.items():
        if not run:
            continue
        for path, size in run.get('peaks', {}).items():
            label = wanted(pathlib.Path(path).name, path)
            if label is None:
                continue
            if best is None or size > best['bytes']:
                best = {'bytes': size, 'file': pathlib.Path(path).name, 'run': run_name,
                        'class': label}
    return best


def classify_peak(name, path):
    if name.startswith('native.jsonl') or name.startswith('turn.jsonl'):
        return 'public_log' if name.endswith('.jsonl') else 'public_log_generation'
    if name == 'stdout':
        return 'attempt_spool_stdout'
    if name == 'stderr.log':
        return 'driver_capture_stderr'
    if name.endswith('.pending'):
        return 'pending_checkpoint'
    if name == 'native.stderr':
        return 'attempt_native_stderr'
    return None


def main():
    work = pathlib.Path(sys.argv[1])
    record_dir = pathlib.Path(sys.argv[2])
    record_json = pathlib.Path(sys.argv[3])
    (record_dir / 'runs').mkdir(parents=True, exist_ok=True)
    for name in RUNS:
        for source in ('result.json', 'inventory.json'):
            origin = work / name / source
            if origin.is_file():
                target = record_dir / 'runs' / ('%s-%s' % (name, source))
                shutil.copy(origin, target)
        for origin in sorted(work.glob('logs-%s*.txt' % name)):
            shutil.copy(origin, record_dir / 'runs' / origin.name)
    runs = {name: load(work / name / 'result.json') for name in RUNS}
    inventories = {name: load(work / name / 'inventory.json') for name in RUNS}
    identity = dict(line.split('=', 1) for line in (work / 'identity.txt').read_text().splitlines()
                    if '=' in line)
    extraction = load(work / 'inputs' / 'extraction.json')
    codex_a = runs['run6-replay-codex-a-default']
    codex_b = runs['run7-replay-codex-b-default']
    codex_a_raw = runs['run8-replay-codex-a-diagnostic']
    omp = runs['run5-replay-omp-window']
    default = runs['run2-after-default']
    raw = runs['run4-after-diagnostic']
    baseline = runs['run1-before-default']
    incomplete = runs['run9-incomplete']

    def total(run):
        return run['retained_log_bytes'] if run else None

    detail = {'identity': identity, 'extraction': extraction,
              'runs': {name: runs[name] for name in RUNS},
              'inventories': {name: inventories[name] for name in RUNS}}
    (record_dir / 'runs.json').write_text(json.dumps(detail, indent=2) + '\n')

    record = {
        'description': (
            'Retained coordinator log bytes before and after the issue #686 log policy for one '
            'fixed provider-free OMP workload, plus the policy disposition of the retained OMP and '
            'Codex traces, the diagnostic opt-in cost, the peak size of each transient file, the '
            'aggregate retained bytes with a breakdown, and the incomplete-turn checkpoint.'),
        'issue': 686,
        'worker': 'logging-measure-ds-20261007',
        'conductor': 'logging-conductor-20261006',
        'date': '2026-10-07',
        'source_revisions': {
            'measured': '351c9aba85c69f4e4aab1f86cc31fb0f415fe327',
            'measured_tree': '9afffc172eec7b77eb5d3df1a15aaa6cc2e334c5',
            'measured_archive_sha256':
                'a70a745a741aa48467a80eb6cd4104d73f7cb650868db81293acbe65448b0e09',
            'baseline': 'fca7af876c8260c32d17f95f3e19bc68ee1bf561',
            'baseline_bend2_subtree_sha256':
                '682faa27a05cabe23292b39b572e78ef409c34064d2b96c10d429354dcf6b48d',
        },
        'executable_sha256': {
            'baseline_linux_rebuild_of_fca7af87':
                '93e7f20a271fe9834be3e8ca19469d34408b859f618ffd7475f5eeb5690ae46b',
            'measured_351c9aba':
                '4a0cf22357c0f40c8ba405d7894218f32eccca81dd0b615b1d7ad6c8ebc84928',
            'recorded_baseline_darwin_arm64_release_1_1_0':
                '972d620ce6209193cb91273350a9c1ea2713cac6b4b2bcf692a6303df75c766c',
        },
        'hosts': {'measured': 'Linux x86_64 acp-compute-cluster-001, ' + identity.get('kernel', ''),
                  'recorded_baseline': 'Darwin arm64 development host, release 1.1.0 executable'},
        'toolchain': {key: identity.get(key) for key in ('bend', 'clang', 'python', 'sqlite')},
        'workload': {
            'driver': 'measure-driver.py',
            'source_omp_log': 'logging-impl-20261006-provider.jsonl',
            'source_omp_log_sha256':
                '9dc892779bf6e77c01e1a624d146212a3435f93a99087de24518467db6038096',
            'inputs': extraction,
            'batches': {
                'native-small': '1000 message_update frames, 128 characters, no identity',
                'native-cumulative': '1000 message_update frames, +51 characters each',
                'native-tool-bash': '1000 tool_execution_update frames, toolName bash, +51 each',
                'native-tool-task': '300 contiguous real task tool-call frames (7206498 bytes)',
                'native-omp-window': '140 contiguous real frames, eight frame types (69001 bytes)',
                'native-semantic': '8 fixed lines pinning unusual type-value classification',
            },
        },
        'retained_bytes': {
            'baseline_default_policy_absent': batch_rows(baseline),
            'measured_default': batch_rows(default),
            'measured_default_budget_65536_two_segments': batch_rows(runs['run3-after-segments']),
            'measured_diagnostic': batch_rows(raw),
        },
        'reduction': {
            'workload_retained_bytes': {
                'baseline': total(baseline), 'default': total(default), 'diagnostic': total(raw)},
            'per_batch_baseline_to_default': {
                row['batch']: {'baseline': row['retained_bytes'], 'default': default_row['retained_bytes']}
                for row, default_row in (zip(baseline['measurements'], default['measurements'])
                                         if baseline and default else [])},
        },
        'peak_spool': {
            'peak_public_log': largest_peak(runs, lambda name, path:
                                            'public_log' if name.endswith('.jsonl') else None),
            'peak_pending_checkpoint': largest_peak(runs, lambda name, path:
                                                    'pending_checkpoint' if name.endswith('.pending')
                                                    else None),
            'peak_stderr': largest_peak(runs, lambda name, path:
                                        'stderr' if 'stderr' in name else None),
            'peak_attempt_spool': largest_peak(runs, lambda name, path:
                                               'attempt_spool' if name == 'stdout' else None),
            'per_run': {name: runs[name].get('peaks') for name in RUNS if runs[name]},
        },
        'aggregate_retained': {
            name: (inventories[name] or {}).get('classification', {}).get('totals')
            for name in ('run1-before-default', 'run2-after-default', 'run3-after-segments',
                         'run4-after-diagnostic')},
        'aggregate_retained_detail': {
            name: {'files': (inventories[name] or {}).get('files'),
                   'tables': (inventories[name] or {}).get('tables'),
                   'logs_storage': (inventories[name] or {}).get('storage')}
            for name in ('run2-after-default', 'run3-after-segments', 'run4-after-diagnostic',
                         'run1-before-default')},
        'omp_trace': replay_rows(omp),
        'codex_traces': {
            'a_sha256': '24df212a02c49e11695949a03f257b42256d613bebac2b9fa189a2b3cf4f5d26',
            'b_sha256': '83dbaeda96749724cf7c39b57e5928f63fff161688f3cedf7d69f67af3b44dac',
            'a_default': replay_rows(codex_a), 'b_default': replay_rows(codex_b),
            'a_diagnostic': replay_rows(codex_a_raw),
            'aggregate_saving_measurable': bool(
                codex_a and codex_a['dropped_lines']) or bool(codex_b and codex_b['dropped_lines']),
        },
        'incomplete_turn': incomplete,
        'limits': [
            'The fixture starts no provider. The batches are frames the driver writes, so the '
            'figures cover the coordinator retention and not a provider own behaviour.',
            'One receiver or turn process, one database and one log path per run.',
            'Wall times are recorded and are not a performance claim.',
            'The before executable is the Linux rebuild of release 1.1.0 on the same host as the '
            'after executable; the recorded baseline figure for this workload was taken on a '
            'Darwin arm64 host with a different executable build.',
        ],
    }
    record_json.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'detail': str(record_dir / 'runs.json'), 'record': str(record_json),
                      'record_bytes': record_json.stat().st_size,
                      'default_total': total(default), 'baseline_total': total(baseline),
                      'diagnostic_total': total(raw)}))


if __name__ == '__main__':
    main()
