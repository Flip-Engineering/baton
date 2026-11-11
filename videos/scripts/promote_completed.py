#!/usr/bin/env python3
"""Promote completed farm jobs to the archive's canonical videos/out.

With ``--discover`` the command scans the farm root for delivered receipts, verifies
the receipt/delivery facts, stages copies of the master and share, and publishes
through ``videos/scripts/publish.sh``. With ``--inventory`` it processes the supplied
publication plans instead. Both modes take an exclusive lock, read the live canonical
master/share LFS pointers, and reconcile the post-master_audio hash and size of both
files against the uploaded pointers before recording completion.

The publisher never mutates the farm originals: media is copied into a temporary
staging directory first. Publication uses the canonical archive URL and the merged
publisher; no approval gate is added.

  python3 videos/scripts/promote_completed.py --discover --plan
  python3 videos/scripts/promote_completed.py --discover
  python3 videos/scripts/promote_completed.py --inventory PLAN.json --job JOB
  python3 videos/scripts/promote_completed.py --inventory PLAN.json --dry-run

``--watch`` repeats discovery on ``--interval`` seconds. Exit status: 0 when every
selected job is promoted, already present, or skipped for a recorded reason; 1 when a
job fails verification, the archive has a conflicting pointer, or the publisher fails.
"""
import argparse
import base64
import fcntl
import glob
import hashlib
import json
import os
import re
import posixpath
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

REPO = Path(__file__).resolve().parents[2]
PUBLISH = REPO / 'videos/scripts/publish.sh'
FARM = REPO / 'videos/scripts/farm.py'
MASTER_AUDIO = REPO / 'videos/scripts/master_audio.py'
ARCHIVE_REPO = 'flip-engineer/automated-content-pipeline-video-studies-archive'
ARCHIVE_URL = 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive.git'
DEFAULT_LEDGER = REPO / 'videos/logs/completed-promotion.jsonl'
DEFAULT_RESERVATIONS = REPO / 'videos/logs/completed-promotion.reservations.jsonl'
DEFAULT_LOCK = REPO / 'videos/logs/.completed-promotion.lock'


def load_json(path):
    with open(path) as f:
        return json.load(f)


def plans_from_inventory(path):
    data = load_json(path)
    if isinstance(data, list):
        return data
    plans = data.get('plans')
    if not isinstance(plans, list):
        raise ValueError(f'{path}: expected a list or an object with "plans"')
    return plans


def split_title(title):
    """'THE_CHASM_v1_take_a' -> ('THE_CHASM', 'v1_take_a'); requires a _vN suffix."""
    m = re.match(r'^(.*)_v([0-9][A-Za-z0-9_.-]*)$', title or '')
    if not m:
        raise ValueError(f'title {title!r} has no _vN version suffix')
    return m.group(1), 'v' + m.group(2)


def plan_media(plan):
    files = plan.get('media') or []
    master = share = None
    for item in files:
        name = item.get('name') or ''
        target = item.get('target') or name
        if not name.endswith('.mp4'):
            continue
        if name.endswith('_share.mp4'):
            share = dict(item, target=target)
        elif master is None:
            master = dict(item, target=target)
    if not master or not share:
        raise ValueError(f'{plan.get("job")}: plan needs one master and one _share mp4')
    return master, share


def find_job_dir(farm_root, job_id):
    roots = [Path(farm_root) / 'jobs', *[Path(p) for p in glob.glob(str(Path(farm_root) / 'lanes/*/jobs'))]]
    names = [f'protocol-{job_id}', job_id]
    for root in roots:
        for name in names:
            candidate = root / name
            if (candidate / 'protocol.json').exists():
                return candidate
    return None


def job_facts(job_dir):
    protocol = load_json(job_dir / 'protocol.json')
    receipt_path = job_dir / 'receipt.json'
    receipt = load_json(receipt_path) if receipt_path.exists() else {}
    pj = protocol.get('pipeline_job') or {}
    delivery = pj.get('delivery') or {}
    return {
        'protocol': protocol,
        'receipt': receipt,
        'state': protocol.get('state') or pj.get('state'),
        'source_commit': pj.get('pipeline_commit') or receipt.get('commit'),
        'piece': pj.get('piece'),
        'delivery_files': delivery.get('files') or [],
        'output_sha256': receipt.get('output_sha256'),
        'frames': receipt.get('frames'),
        'seconds': receipt.get('seconds'),
    }


def verify_plan(plan, facts, master, share):
    """Return a list of failures; empty means the job supports the plan."""
    errors = []
    if facts['state'] not in ('delivered', 'done', 'complete'):
        errors.append(f'job state is {facts["state"]!r}, not delivered')
    planned_piece = plan.get('piece')
    if not planned_piece and plan.get('title'):
        try:
            planned_piece = split_title(plan['title'])[0]
        except ValueError:
            pass
    for planned, recorded, label in (
        (plan.get('source_commit'), facts.get('source_commit'), 'source commit'),
        (planned_piece, facts.get('piece'), 'piece'),
    ):
        if not planned:
            errors.append(f'plan is missing {label}')
        elif not recorded:
            errors.append(f'job is missing {label}')
        elif planned != recorded:
            errors.append(f'{label} {recorded} does not match plan {planned}')
    output_sha256 = facts.get('output_sha256')
    if not output_sha256:
        errors.append('job receipt is missing output_sha256')
    elif output_sha256 != master.get('sha256'):
        errors.append(f'receipt output {output_sha256} does not match master {master.get("sha256")}')
    delivered = {f.get('name'): f.get('sha256') for f in facts['delivery_files']}
    for item in (master, share):
        name = item.get('name')
        planned_sha256 = item.get('sha256')
        if not name or not planned_sha256:
            errors.append('plan media is missing a name or sha256')
        elif name not in delivered:
            errors.append(f'{name}: delivery record is missing')
        elif not delivered[name]:
            errors.append(f'{name}: delivery record is missing sha256')
        elif delivered[name] != planned_sha256:
            errors.append(f'{name}: delivery {delivered[name]} does not match plan {planned_sha256}')
    return errors


def ledger_key(row):
    fields = (row.get('job'), row.get('master_target'), row.get('share_target'),
              row.get('master_sha256'), row.get('share_sha256'))
    return fields if all(fields) else None


def load_ledger(path):
    promoted = set()
    if not Path(path).exists():
        return promoted
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get('status') in ('promoted', 'present'):
                key = ledger_key(row)
                if key is not None:
                    promoted.add(key)
    return promoted


class PromotionLock:
    """Serialize discovery, ledger reads/writes, publication and readback."""

    def __init__(self, path):
        self.path = Path(path)
        self.fd = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fd = os.open(self.path, os.O_CREAT | os.O_RDWR, 0o644)
        fcntl.flock(self.fd, fcntl.LOCK_EX)
        return self

    def __exit__(self, *exc):
        if self.fd is not None:
            fcntl.flock(self.fd, fcntl.LOCK_UN)
            os.close(self.fd)
            self.fd = None


def load_identities(path):
    """Identities are destination + both post-master_audio LFS object ids."""
    identities = set()
    if not Path(path).exists():
        return identities
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            ident = row.get('identity')
            if isinstance(ident, dict):
                fields = (ident.get('master_target'), ident.get('share_target'),
                          ident.get('master_oid'), ident.get('share_oid'))
                if all(fields):
                    identities.add(fields)
            key = ledger_key(row)
            if key is not None:
                identities.add(key[1:])
    return identities


def load_completed_rows(path):
    """Durable completed rows with source and final hashes for watch fast path."""
    rows = []
    if not path or not Path(path).exists():
        return rows
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if row.get('status') not in ('promoted', 'present'):
                continue
            if (row.get('source_master_sha256') and row.get('source_share_sha256')
                    and row.get('master_sha256') and row.get('share_sha256')):
                rows.append(row)
    return rows


def completed_row_for(rows, job, master, share, targets):
    """Match a durable row by job, both source hashes and both destinations."""
    for row in reversed(rows):
        if row.get('job') != job:
            continue
        if (row.get('source_master_sha256'), row.get('source_share_sha256')) != (
                master['sha256'], share['sha256']):
            continue
        if (row.get('master_target'), row.get('share_target')) != tuple(targets):
            continue
        if row.get('master_sha256') and row.get('share_sha256'):
            return row
    return None


def load_reservations(path):
    rows = {}
    if not path or not Path(path).exists():
        return rows
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            intent = row.get('intent')
            if intent:
                rows[intent] = row
    return rows


def append_reservation(path, row):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a') as f:
        f.write(json.dumps(row, sort_keys=True) + '\n')
        f.flush()
        os.fsync(f.fileno())


def intent_for(job, piece, master_sha256, share_sha256):
    """Stable intent: source job, both source hashes, canonical piece family."""
    return f'{job}:{piece}:{master_sha256}:{share_sha256}'


def ensure_reservation(path, rows, intent, job, piece, source_master, source_share, targets, title):
    row = rows.get(intent)
    if row:
        existing = (row.get('master_target'), row.get('share_target'))
        if existing != tuple(targets):
            raise RuntimeError(f'{job}: reserved destination {existing} conflicts with {targets}')
        return row
    row = {
        'intent': intent, 'job': job, 'piece': piece,
        'source_master_sha256': source_master, 'source_share_sha256': source_share,
        'title': title, 'master_target': targets[0], 'share_target': targets[1],
        'status': 'reserved', 'at': datetime.now(timezone.utc).isoformat(),
    }
    if path:
        append_reservation(path, row)
    rows[intent] = row
    return row

VIDEO_KINDS = ('render', 'scene', 'video', 'film', 'take', 'fframes')
NON_FILM_KINDS = ('bench', 'benchmark', 'asset', 'diagnostic', 'canary', 'gpu',
                   'still', 'stills', 'tooling')
FFRAMES_RENDERERS = re.compile(
    r'(?:fframes_full_scene\.py\b|fframes_render\.(?:py|mjs|js)\b|'
    r'render_frames\.(?:py|mjs|js)\b|fframes[^ ]*\.(?:py|mjs|js)\b)')
DIAGNOSTIC_EXECUTABLE = re.compile(
    r'(?:^|[\s/\"\'])fframes_chasm_glass_diagnostic(?:\.py)?(?:\s|$|[\"\'])', re.I)


def video_job_reason(facts, job):
    """Exclude known non-film jobs by recorded intent, not argument substrings."""
    pj = facts['protocol'].get('pipeline_job') or {}
    kind = str(pj.get('kind') or '').lower()
    if kind in NON_FILM_KINDS:
        return f'protocol kind {kind!r} is not a film render'
    if kind and kind not in VIDEO_KINDS:
        return f'protocol kind {kind!r} is not a film render'
    run_value = pj.get('run')
    if isinstance(run_value, (list, tuple)):
        run = ' '.join(str(value) for value in run_value)
    else:
        run = str(run_value or '')
    piece = (pj.get('piece') or '').upper()
    if piece == 'BENCH' or re.search(r'--seg[=\s]+bench_', run):
        return 'benchmark fragment'
    if piece == 'GPU':
        return 'GPU/asset job, not a full film'
    if DIAGNOSTIC_EXECUTABLE.search(run):
        return 'diagnostic executable, not a full film'
    if kind in VIDEO_KINDS:
        return ''
    full_film = FFRAMES_RENDERERS.search(run)
    if 'gpu_job.sh' in run and not full_film:
        return 'GPU/asset job, not a full film'
    if not run:
        return ''
    match = re.search(
        r'local_render\.sh\b[^;|&]*?--seg[=\s]+([A-Za-z0-9_]+)', run)
    if match:
        scene = match.group(1)
        if scene.startswith('bench_'):
            return 'benchmark fragment'
        return ''
    if 'local_render.sh' in run:
        return 'run is not a full-scene local_render --seg'
    if full_film:
        return ''
    return 'run is not a supported full-film renderer'


def next_version(piece, names):
    versions = []
    pattern = re.compile(re.escape(piece) + r'_v(\d+)(?:_share)?\.mp4$')
    for name in names:
        match = pattern.match(name)
        if match:
            versions.append(int(match.group(1)))
    return 'v%d' % (max(versions) + 1 if versions else 1)


def delivery_media(facts):
    master = share = None
    for item in facts.get('delivery_files') or []:
        name = item.get('name') or ''
        if not name.endswith('.mp4'):
            continue
        if name.endswith('_share.mp4'):
            share = item
        elif master is None:
            master = item
    if not master or not share:
        raise RuntimeError(f'{facts.get("job_dir", "job")}: delivery lacks a master/share pair')
    return master, share


def find_completed_job_dirs(farm_root):
    roots = [Path(farm_root) / 'jobs', *[Path(p) for p in glob.glob(str(Path(farm_root) / 'lanes/*/jobs'))]]
    seen = set()
    for root in roots:
        for job_dir in sorted(root.glob('protocol-*')):
            if not (job_dir / 'protocol.json').exists() or not (job_dir / 'receipt.json').exists():
                continue
            resolved = str(job_dir.resolve())
            if resolved in seen:
                continue
            seen.add(resolved)
            yield job_dir


def _oid(value):
    return value[0] if isinstance(value, tuple) else value


def load_completed_plans(paths):
    """Load existing study/publication records into job -> explicit-title plans."""
    plans = {}
    for path in paths or []:
        data = load_json(path)
        rows = data.get('studies') or data.get('plans') or data.get('entries') or []
        for row in rows:
            job = row.get('job') or row.get('job_id')
            if not job:
                continue
            media = []
            for item in row.get('media') or []:
                name = item.get('name') or os.path.basename(item.get('path') or item.get('target') or '')
                target = item.get('target') or item.get('path')
                if name and target:
                    media.append({'name': name, 'sha256': item.get('sha256'),
                                  'size': item.get('bytes') or item.get('size'), 'target': target,
                                  'kind': item.get('kind')})
            for item in row.get('video_files') or []:
                name = item.get('name') or ''
                target = item.get('target')
                if name and target:
                    media.append({'name': name, 'sha256': item.get('sha256'),
                                  'size': item.get('size_bytes') or item.get('size'), 'target': target,
                                  'kind': item.get('kind')})
            published = row.get('published_media') or []
            for item in published:
                paths = item.get('paths') or []
                target = next((candidate for candidate in paths if candidate), None)
                if not target:
                    continue
                name = os.path.basename(target)
                media.append({'name': name, 'sha256': item.get('sha256'),
                              'size': item.get('bytes') or item.get('size'), 'target': target,
                              'kind': item.get('kind')})
            if len(media) < 2:
                continue
            if published:
                master = next((m for m in media if m.get('kind') == 'master'), None)
                share = next((m for m in media if m.get('kind') == 'share'), None)
                if not master or not share:
                    continue
            else:
                master = next((m for m in media if not m['name'].endswith('_share.mp4')), media[0])
                share = next((m for m in media if m['name'].endswith('_share.mp4')), media[1])
            if os.path.dirname(master['target']) != os.path.dirname(share['target']):
                continue
            title = row.get('title')
            if published or not isinstance(title, str) or not title:
                title = os.path.basename(master['target'])[:-4]
            targets = (master['target'], share['target'])
            canonical_targets = (f'videos/out/{title}.mp4', f'videos/out/{title}_share.mp4')
            plans[job] = {
                'job': job, 'title': title, 'piece': row.get('piece') or row.get('scene'),
                'source_commit': row.get('source_commit'), 'media': [master, share],
                'explicit': (not bool(re.search(r'_v\d', title))
                             or tuple(targets) != canonical_targets),
            }
    return plans


def plan_matches_facts(plan, facts):
    planned = plan.get('source_commit')
    recorded = facts.get('source_commit')
    return not (planned and recorded and planned != recorded)


def published_title_for(piece, master, share, pointers):
    """Find a published PIECE_vN pair, preserving its exact videos/out directory."""
    for name, pointer in (pointers or {}).items():
        name = str(name)
        base = os.path.basename(name)
        match = re.match(re.escape(piece) + r'(_v\d+)\.mp4$', base)
        if not match:
            continue
        title = piece + match.group(1)
        directory = os.path.dirname(name) if name.startswith('videos/out/') else 'videos/out'
        master_path = f'{directory}/{title}.mp4'
        share_path = f'{directory}/{title}_share.mp4'
        if (_oid(pointer_for(pointers, master_path)) == master['sha256']
                and _oid(pointer_for(pointers, share_path)) == share['sha256']):
            return title, (master_path, share_path)
    return None


def load_archive_snapshot(path):
    """Index a read-only archive pointer snapshot by LFS object id."""
    if not path:
        return {}
    data = load_json(path)
    files = data.get('files') if isinstance(data, dict) else data
    by_oid = {}
    for item in files or []:
        oid = item.get('oid')
        target = item.get('path')
        if oid and target:
            by_oid.setdefault(oid, []).append(target)
    return by_oid


def archived_title_for(master, share, by_oid):
    """Reuse an existing archive master/share destination matching both source OIDs."""
    candidates = []
    for master_path in (by_oid or {}).get(master.get('sha256'), []):
        try:
            master_path = archive_target(master_path)
        except ValueError:
            continue
        name = os.path.basename(master_path)
        if not name.endswith('.mp4') or name.endswith('_share.mp4'):
            continue
        title = name[:-4]
        for share_path in (by_oid or {}).get(share.get('sha256'), []):
            try:
                share_path = archive_target(share_path)
            except ValueError:
                continue
            if (os.path.dirname(share_path) == os.path.dirname(master_path)
                    and os.path.basename(share_path) == title + '_share.mp4'):
                candidates.append((master_path.startswith('videos/out/archive/'),
                                   len(master_path), master_path, share_path, title))
    if not candidates:
        return None
    candidates.sort()
    _, _, master_path, share_path, title = candidates[0]
    return title, (master_path, share_path)


def discover_completed_jobs(farm_root, archive_names, reservations_path=None,
                            reservations=None, errors=None, skipped=None, reserve=True,
                            completed_plans=None, pointers=None, archive_snapshot=None):
    """Turn completed, delivered receipts into stable publication plans."""
    plans = []
    reservations = {} if reservations is None else reservations
    errors = [] if errors is None else errors
    skipped = [] if skipped is None else skipped
    names = set(archive_names)
    for row in reservations.values():
        for key in ('master_target', 'share_target'):
            if row.get(key):
                names.add(os.path.basename(row[key]))
    for job_dir in find_completed_job_dirs(farm_root):
        job = job_dir.name.removeprefix('protocol-')
        try:
            facts = job_facts(job_dir)
            job = facts['protocol'].get('protocol_id') or job
            if facts['state'] not in ('delivered', 'done', 'complete'):
                continue
            reason = video_job_reason(facts, job)
            if reason:
                skipped.append((job, reason))
                continue
            receipt = facts['receipt'] or {}
            if receipt.get('full_decode') != 'passed':
                errors.append((job, 'receipt full_decode is not passed'))
                continue
            if not facts['output_sha256']:
                errors.append((job, 'receipt is missing output_sha256'))
                continue
            piece = facts['piece']
            if not piece:
                errors.append((job, 'protocol is missing piece'))
                continue
            master, share = delivery_media(facts)
            if not master.get('sha256') or not share.get('sha256'):
                errors.append((job, 'delivery media is missing sha256'))
                continue
            intent = intent_for(job, piece, master['sha256'], share['sha256'])
            row = reservations.get(intent)
            if row:
                title = row.get('title') or os.path.basename(row['master_target'])[:-4]
                targets = (row['master_target'], row['share_target'])
            else:
                planned = (completed_plans or {}).get(job)
                if planned and plan_matches_facts(planned, facts):
                    title = planned['title']
                    targets = tuple(item['target'] for item in planned['media'][:2])
                else:
                    archived = archived_title_for(master, share, archive_snapshot)
                    if archived:
                        title, targets = archived
                    else:
                        published = published_title_for(piece, master, share, pointers)
                        if published:
                            title, targets = published
                        else:
                            version = next_version(piece, names)
                            title = f'{piece}_{version}'
                            targets = (f'videos/out/{title}.mp4', f'videos/out/{title}_share.mp4')
                ensure_reservation(reservations_path if reserve else None,
                                   reservations, intent, job, piece,
                                   master['sha256'], share['sha256'], targets, title)
                names.update(os.path.basename(target) for target in targets)
            out = job_dir / 'out'
            canonical_targets = (f'videos/out/{title}.mp4', f'videos/out/{title}_share.mp4')
            plans.append({
                'job': job,
                'title': title,
                'piece': piece,
                'intent': intent,
                'explicit': (not bool(re.search(r'_v\d', title))
                             or tuple(targets) != canonical_targets),
                'source_commit': facts['source_commit'],
                'media': [
                    {'name': master['name'], 'sha256': master.get('sha256'),
                     'path': str(out / master['name']) if (out / master['name']).exists() else None,
                     'target': targets[0]},
                    {'name': share['name'], 'sha256': share.get('sha256'),
                     'path': str(out / share['name']) if (out / share['name']).exists() else None,
                     'target': targets[1]},
                ],
            })
        except Exception as exc:  # report the malformed job, keep discovering
            errors.append((job, str(exc)))
    return plans


def append_ledger(path, entry):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a') as f:
        f.write(json.dumps(entry, sort_keys=True) + '\n')
        f.flush()
        os.fsync(f.fileno())




def archive_target(target):
    if not isinstance(target, str) or not target:
        raise ValueError(f'invalid archive target {target!r}')
    if target.startswith('/') or '\\' in target:
        raise ValueError(f'invalid archive target {target!r}')
    normalized = posixpath.normpath(target)
    if normalized != target or not normalized.startswith('videos/out/'):
        raise ValueError(f'invalid archive target {target!r}')
    if any(part in ('', '.', '..') for part in normalized.split('/')):
        raise ValueError(f'invalid archive target {target!r}')
    return normalized

def load_pointers(path):
    """A JSON map name -> oid, preserving full videos/out paths when supplied."""
    if not path:
        return {}
    data = load_json(path)
    if isinstance(data, dict) and 'files' in data:
        rows = {x['name']: x.get('oid') or x.get('sha256') for x in data['files']}
    elif isinstance(data, list):
        rows = {x['name']: x.get('oid') or x.get('sha256') for x in data}
    else:
        rows = dict(data)
    pointers = {}
    for name, oid in rows.items():
        name = str(name)
        if name.startswith('videos/out/') or name.startswith('/'):
            try:
                pointers[archive_target(name)] = oid
            except ValueError:
                continue
        else:
            pointers[os.path.basename(name)] = oid
    return pointers


def pointer_for(pointers, target):
    """Exact full target first; basename fallback only for unambiguous root-target inputs."""
    normalized = archive_target(target)
    if normalized in pointers:
        return pointers[normalized]
    if os.path.dirname(normalized) != 'videos/out':
        return None
    base = os.path.basename(normalized)
    if base not in pointers:
        return None
    matches = [key for key in pointers if os.path.basename(key) == base]
    return pointers[base] if len(matches) == 1 else None


def pointer_state(media, pointers):
    """'conflict', 'present' or 'absent' for one media target."""
    pointer = pointer_for(pointers, media.get('target') or media['name'])
    if not pointer:
        return 'absent'
    if isinstance(pointer, tuple):
        return 'present' if pointer == (media['sha256'], media.get('size')) else 'conflict'
    return 'present' if pointer == media['sha256'] else 'conflict'


def pointer_oid(pointer):
    return pointer[0] if isinstance(pointer, tuple) else pointer


def parse_pointer(content):
    match = re.fullmatch(
        rb'version https://git-lfs\.github\.com/spec/v1\n'
        rb'oid sha256:([0-9a-f]{64})\n'
        rb'size ([0-9]+)\n',
        content,
    )
    if match is None:
        raise RuntimeError('not a valid four-line Git LFS pointer')
    return match.group(1).decode('ascii'), int(match.group(2))


def read_archive_pointers(media_items, ref='main'):
    """Read canonical LFS pointer files from the archive at ``ref``."""
    pointers = {}
    for item in media_items:
        try:
            target = archive_target(item.get('target') or item['name'])
        except ValueError:
            raise RuntimeError(f'invalid archive target {item.get("target") or item.get("name")!r}') from None
        endpoint = f'repos/{ARCHIVE_REPO}/contents/{quote(target, safe="/")}?ref={quote(ref)}'
        r = subprocess.run(['gh', 'api', endpoint], capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            if '404' in (r.stderr or ''):
                pointers[target] = None
                continue
            raise RuntimeError(f'archive pointer read failed for {target} (gh exit {r.returncode})')
        try:
            response = json.loads(r.stdout)
            content = base64.b64decode(response['content'], validate=False)
        except (KeyError, ValueError, json.JSONDecodeError):
            raise RuntimeError(f'archive file {target} is not a valid Git LFS pointer') from None
        pointers[target] = parse_pointer(content)
    return pointers


def read_archive_names(ref='main'):
    """List canonical videos/out names at ``ref`` through the GitHub API."""
    endpoint = f'repos/{ARCHIVE_REPO}/contents/videos/out?ref={quote(ref)}'
    r = subprocess.run(['gh', 'api', endpoint], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f'archive listing failed (gh exit {r.returncode})')
    try:
        rows = json.loads(r.stdout)
        return [row['name'] for row in rows if row.get('type') == 'file']
    except (ValueError, KeyError, TypeError):
        raise RuntimeError('archive listing returned invalid metadata') from None


def lfs_module_path():
    path = REPO / 'homelab/runtime/protocol/lfs_archive.py'
    if not path.exists():
        raise RuntimeError(
            f'LFS readback helper missing at {path}; the deployed checkout must '
            'include the tracked homelab/runtime/protocol/lfs_archive.py and archive credentials')
    return path


def verify_lfs_readback(pointer, archive_url=ARCHIVE_URL):
    """Verify the uploaded LFS object is readable at the archive."""
    oid, size = pointer
    module_path = lfs_module_path()
    import importlib.util
    try:
        spec = importlib.util.spec_from_file_location('acp_lfs_archive', module_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except Exception as exc:
        raise RuntimeError(f'LFS readback helper failed to load from {module_path}: {exc}') from exc
    module.verify_remote(archive_url, oid, size)

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def fetch_media(plan, job_dir, work):
    master, share = plan_media(plan)
    expected = {master['name']: master['sha256'], share['name']: share['sha256']}
    wanted = list(expected)
    found = {}
    for item in (master, share):
        p = item.get('path')
        if p and Path(p).exists():
            found[item['name']] = p
    if len(found) < len(wanted):
        tmp = Path(work)
        tmp.mkdir(parents=True, exist_ok=True)
        args = [sys.executable, str(FARM), 'fetch', plan['job']]
        for name in wanted:
            args += ['--only', name]
        args += ['--to', str(tmp)]
        r = subprocess.run(args, capture_output=True, text=True, timeout=1800)
        if r.returncode != 0:
            raise RuntimeError(f'farm fetch failed: {r.stderr.strip()[-500:]}')
        for root, _, names in os.walk(tmp):
            for name in names:
                if name in wanted:
                    found[name] = os.path.join(root, name)
    missing = [name for name in wanted if name not in found]
    if missing:
        raise RuntimeError(f'farm fetch did not produce {missing}')
    staged = {}
    for name, path in found.items():
        got = sha256_file(path)
        if got != expected[name]:
            raise RuntimeError(f'{name}: local hash {got} does not match plan {expected[name]}')
        destination = Path(work) / name
        if Path(path).resolve() != destination.resolve():
            shutil.copyfile(path, destination)
        staged[name] = str(destination)
    return staged


def master_media(plan, media):
    master, share = plan_media(plan)
    scene = plan.get('scene') or Path(master['name']).stem
    args = [sys.executable, str(MASTER_AUDIO), media[master['name']],
            '--share', media[share['name']], '--scene', scene]
    r = subprocess.run(args, cwd=str(REPO), capture_output=True, text=True, timeout=1800)
    if r.returncode != 0:
        detail = (r.stderr or '').strip()[-800:]
        raise RuntimeError(f'master_audio failed ({r.returncode}): {detail}')
    return r.stdout or ''


def publish(plan, piece, version, media, dry_run=False):
    master, share = plan_media(plan)
    env = dict(os.environ)
    env.pop('GATE', None)
    env.pop('GATE_ARGS', None)
    env['ARCHIVE_URL'] = 'https://github.com/flip-engineer/automated-content-pipeline-video-studies-archive'
    if dry_run:
        env['PUBLISH_DRY'] = '1'
    spec = f'{piece}:{version}:{media[master["name"]]}:{media[share["name"]]}'
    r = subprocess.run(['sh', str(PUBLISH), spec], cwd=str(REPO), env=env,
                       capture_output=True, text=True, timeout=3600)
    out = (r.stdout or '') + (r.stderr or '')
    if r.returncode != 0:
        raise RuntimeError(f'publish failed ({r.returncode}): {out.strip()[-800:]}')
    m = re.search(r'published to main \(([0-9a-f]+)\)', out)
    if not m and not dry_run:
        raise RuntimeError('publish did not report an archive commit: ' + out.strip()[-500:])
    return (m.group(1) if m else None), out


def title_parts(plan):
    title = plan.get('title') or plan.get('job')
    try:
        return split_title(title)
    except ValueError:
        return plan.get('piece') or title, None


def _run_once(args):
    reservations_path = getattr(args, 'reservations', str(DEFAULT_RESERVATIONS))
    reservations = load_reservations(reservations_path)
    completed_paths = getattr(args, 'completed_inventory', None) or []
    if isinstance(completed_paths, str):
        completed_paths = [completed_paths]
    completed_plans = load_completed_plans(completed_paths)
    archive_snapshot = load_archive_snapshot(
        getattr(args, 'archive_pointer_snapshot', None))
    discovery_errors = []
    discovery_skipped = []
    supplied = load_pointers(getattr(args, 'archive_pointers', None))
    if not args.plan and not args.dry_run:
        try:
            lfs_module_path()
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
    if getattr(args, 'discover', False):
        if not supplied and completed_plans and not args.plan and not args.dry_run:
            for plan in completed_plans.values():
                items = [m for m in plan.get('media') or [] if m.get('target')]
                try:
                    supplied.update(read_archive_pointers(items))
                except Exception as exc:
                    discovery_errors.append((plan['job'], f'live pointer read failed: {exc}'))
        names = read_archive_names(getattr(args, 'archive_ref', 'main'))
        plans = discover_completed_jobs(args.farm_root, names, reservations_path,
                                        reservations, discovery_errors, discovery_skipped,
                                        reserve=not args.plan and not args.dry_run,
                                        completed_plans=completed_plans, pointers=supplied,
                                        archive_snapshot=archive_snapshot)
    else:
        plans = plans_from_inventory(args.inventory)
    if args.job:
        plans = [p for p in plans if p.get('job') == args.job]
    identities = load_identities(args.ledger)
    completed_rows = load_completed_rows(args.ledger)
    summary = {'promoted': 0, 'present': 0, 'ledgered': 0, 'planned': 0, 'dry_run': 0,
               'failed': 0, 'selected': len(plans),
               'discovery_errors': len(discovery_errors),
               'discovery_skipped': len(discovery_skipped)}
    for job, reason in discovery_errors:
        print(f'{job}: discovery error: {reason}', file=sys.stderr)
    if args.verbose:
        for job, reason in discovery_skipped:
            print(f'{job}: discovery skipped: {reason}')
    for plan in plans:
        job = plan.get('job')
        title = plan.get('title') or job
        try:
            piece, version = title_parts(plan)
            explicit = bool(plan.get('explicit')) or version is None
            master, share = plan_media(plan)
            targets = (master.get('target') or master['name'],
                       share.get('target') or share['name'])
            if explicit:
                expected_targets = tuple(item.get('target') for item in plan.get('media') or [])
            else:
                expected_targets = (f'videos/out/{title}.mp4', f'videos/out/{title}_share.mp4')
            if targets != expected_targets:
                raise RuntimeError(f'plan targets {sorted(targets)} do not match title {sorted(expected_targets)}')
            job_dir = find_job_dir(args.farm_root, job)
            if job_dir is None:
                raise RuntimeError(f'job directory not found under {args.farm_root}')
            facts = job_facts(job_dir)
            errors = verify_plan(plan, facts, master, share)
            if errors:
                raise RuntimeError('; '.join(errors))
            intent = plan.get('intent') or intent_for(
                job, piece, master['sha256'], share['sha256'])
            entry = {
                'job': job, 'title': title, 'piece': piece, 'version': version,
                'intent': intent, 'explicit': explicit,
                'source_commit': facts['source_commit'],
                'source_master_sha256': master['sha256'],
                'source_share_sha256': share['sha256'],
                'master_target': targets[0], 'share_target': targets[1],
                'frames': facts['frames'], 'seconds': facts['seconds'],
                'job_dir': str(job_dir), 'archive_repo': ARCHIVE_REPO,
                'status': 'planned', 'at': None,
            }
            if not args.plan and not args.dry_run:
                recorded = completed_row_for(completed_rows, job, master, share, targets)
                if recorded is not None:
                    final_master = recorded['master_sha256']
                    final_share = recorded['share_sha256']
                    recorded_media = (
                        {'name': master['name'], 'target': targets[0],
                         'sha256': final_master, 'size': 0},
                        {'name': share['name'], 'target': targets[1],
                         'sha256': final_share, 'size': 0},
                    )
                    pointers = supplied or read_archive_pointers(
                        recorded_media, getattr(args, 'archive_ref', 'main'))
                    observed = [
                        pointer_oid(pointer_for(pointers, item['target']))
                        for item in recorded_media
                    ]
                    expected = (final_master, final_share)
                    if any(value and value != want for value, want in zip(observed, expected)):
                        raise RuntimeError(
                            f'{job}: live archive pointer changed; requalify before publication')
                    if all(value == want for value, want in zip(observed, expected)):
                        summary['ledgered'] += 1
                        print(f'{job}: verified row unchanged; skipping media staging/master/readback ({title})')
                        continue
            if explicit and args.dry_run:
                print(f'{job}: explicit published title {title}; dry-run does not republish')
                continue
            if args.plan:
                summary['planned'] += 1
                print(json.dumps(entry, sort_keys=True))
                continue
            if not args.dry_run:
                ensure_reservation(reservations_path, reservations, intent, job, piece,
                                   master['sha256'], share['sha256'], targets, title)
            with tempfile.TemporaryDirectory(prefix='acp-promote-') as work:
                media = fetch_media(plan, job_dir, work)
                master_media(plan, media)
                final_hashes = {name: sha256_file(path) for name, path in media.items()}
                final_media = (
                    dict(master, sha256=final_hashes[master['name']], size=os.path.getsize(media[master['name']])),
                    dict(share, sha256=final_hashes[share['name']], size=os.path.getsize(media[share['name']])),
                )
                identity = (targets[0], targets[1], final_media[0]['sha256'], final_media[1]['sha256'])
                if args.dry_run:
                    archive_commit, output = publish(plan, piece, version, media, dry_run=True)
                    summary['dry_run'] += 1
                    print(f'{job}: dry-run checked {title}; no ledger entry')
                    if args.verbose:
                        print(output)
                    continue

                if supplied:
                    pointers = supplied
                else:
                    pointers = read_archive_pointers(final_media, getattr(args, 'archive_ref', 'main'))
                states = [pointer_state(final_media[0], pointers), pointer_state(final_media[1], pointers)]
                if 'conflict' in states:
                    raise RuntimeError('archive pointer exists with a different object id or size')
                if all(state == 'present' for state in states):
                    for item in final_media:
                        pointer = pointer_for(pointers, item['target'])
                        if isinstance(pointer, str):
                            pointer = (pointer, item['size'])
                        verify_lfs_readback(pointer)
                    entry.update({
                        'master_sha256': final_media[0]['sha256'],
                        'share_sha256': final_media[1]['sha256'],
                        'identity': {
                            'master_target': targets[0], 'share_target': targets[1],
                            'master_oid': final_media[0]['sha256'], 'share_oid': final_media[1]['sha256'],
                        },
                        'status': 'present',
                        'at': datetime.now(timezone.utc).isoformat(),
                    })
                    if identity in identities:
                        summary['ledgered'] += 1
                        print(f'{job}: already in ledger with matching live pointers ({title})')
                    else:
                        append_ledger(args.ledger, entry)
                        identities.add(identity)
                        summary['present'] += 1
                        print(f'{job}: already present in archive ({title})')
                    continue

                if explicit:
                    raise RuntimeError(
                        f'explicit published title {title} is missing or stale; refusing a new version')
                archive_commit, output = publish(plan, piece, version, media)
                post_hashes = {name: sha256_file(path) for name, path in media.items()}
                if post_hashes != final_hashes:
                    raise RuntimeError('published media changed during publisher finalization')
                pointers = read_archive_pointers(final_media, archive_commit)
                for item in final_media:
                    pointer = pointer_for(pointers, item['target'])
                    expected_pointer = (item['sha256'], item['size'])
                    if pointer != expected_pointer:
                        raise RuntimeError(f'archive pointer/readback mismatch for {item["target"]}')
                    verify_lfs_readback(pointer)
                entry.update({
                    'master_sha256': final_media[0]['sha256'],
                    'share_sha256': final_media[1]['sha256'],
                    'identity': {
                        'master_target': targets[0], 'share_target': targets[1],
                        'master_oid': final_media[0]['sha256'], 'share_oid': final_media[1]['sha256'],
                    },
                    'archive_commit': archive_commit,
                    'publisher': 'videos/scripts/publish.sh',
                    'status': 'promoted',
                    'at': datetime.now(timezone.utc).isoformat(),
                })
                append_ledger(args.ledger, entry)
                identities.add(identity)
                summary['promoted'] += 1
                print(f'{job}: promoted {title} -> {archive_commit}')
                if args.verbose:
                    print(output)
        except Exception as e:  # one bad plan must not hide the others
            summary['failed'] += 1
            print(f'{job}: FAILED: {e}', file=sys.stderr)
    print(json.dumps(summary, sort_keys=True))
    return 1 if summary['failed'] else 0


def run(args):
    lock = getattr(args, 'lock', str(DEFAULT_LOCK))
    if getattr(args, 'watch', False):
        while True:
            with PromotionLock(lock):
                status = _run_once(args)
            if status:
                return status
            time.sleep(getattr(args, 'interval', 300))
    with PromotionLock(lock):
        return _run_once(args)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--inventory', help='completed-publication plan JSON')
    ap.add_argument('--discover', action='store_true', help='discover completed receipts and publish them')
    ap.add_argument('--job', help='only this job id')
    ap.add_argument('--farm-root', default=os.environ.get('ACP_FARM_ROOT', '/mnt/nvme4tb/automated-content-pipeline-homelab-20261002'))
    ap.add_argument('--ledger', default=str(DEFAULT_LEDGER))
    ap.add_argument('--reservations', default=str(DEFAULT_RESERVATIONS))
    ap.add_argument('--lock', default=str(DEFAULT_LOCK))
    ap.add_argument('--completed-inventory', action='append',
                    help='published studies/plans JSON used to preserve existing titles')
    ap.add_argument('--archive-pointers', help='JSON map of canonical videos/out names to LFS object ids')
    ap.add_argument('--archive-pointer-snapshot',
                    help='read-only archive snapshot {files:[{path,oid,bytes}]} for historical pair reuse')
    ap.add_argument('--archive-ref', default='main', help='archive ref for live pointer checks')
    ap.add_argument('--plan', action='store_true', help='verify and print, publish nothing')
    ap.add_argument('--dry-run', action='store_true', help='run the publisher dry run; write no ledger')
    ap.add_argument('--watch', action='store_true', help='repeat discovery/publication on an interval')
    ap.add_argument('--interval', type=int, default=300)
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args(argv)
    if not args.inventory and not args.discover:
        ap.error('one of --inventory or --discover is required')
    return run(args)


if __name__ == '__main__':
    sys.exit(main())
