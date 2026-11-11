"""Source-pinned integration comparison for ACP issue #87 (humans).

Read-only over a git commit: pins the shared anatomy, cloth/contact,
skin/hair, motion/collision and style sources, extracts measurable
contracts, composes the shared anatomy adapters in a throwaway job
wrapper, and records the smallest render comparison that would still be
admissible.  It edits no specialist source and launches no render.

Seed contract: one 512-bit master seed; a subsystem seed is
``int.from_bytes(sha256(bytes.fromhex(master) + b':' + name).digest()[:8])``.
This is byte-compatible with ``human_sim.derive_seed`` in the coordinated
preflight work, so both records can be merged without re-deriving seeds.
"""
import argparse
import ast
import contextlib
import hashlib
import io
import json
import os
import pathlib
import platform
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from types import SimpleNamespace

VERSION = 'human-integration-source-compare-v2'
ISSUE = 87
PINNED_COMMIT = 'e235ca432f1514842da8e99ec28addf77c99b2d4'
# S1's merged anatomy hooks are the qualification for the live worktree.
# They add 24 lines to person_anatomy.py and 9 to person_pelvis.py; the
# executable probe accepts these blobs without changing the static pin.
MERGED_QUALIFICATIONS = {
    'homelab/runtime/person_anatomy.py': 'f70bffa60765ac06fb794924240d5a4d1b3b7fa88aadf96c16e88d78b2d7723d',
    'homelab/runtime/person_pelvis.py': 'b0ec90fcae63cba5167887e56ff2b6782c684881b99add77b5be7befbc0dc182',
}
MERGED_SOURCE = {
    'branch': 'codex/humans-integration-20261019',
    'commit': 'df41f06c1a4dc9ca95f492743230d3043170fa51',
    'anatomy_commit': '63235d3d9a9885a723e1e70ee0b11f9f3900b413',
}
# The consolidated runtime also qualifies person_pipeline.py with the child
# guard copy list; it is not part of S1's anatomy merge.
WORKTREE_QUALIFICATIONS = {path: {digest} for path, digest in MERGED_QUALIFICATIONS.items()}
WORKTREE_QUALIFICATIONS['homelab/runtime/person_anatomy.py'].add(
    '2b784326aafb38ce976878fe3292f0e185fb45a9460e34cd596763821663f434')
WORKTREE_QUALIFICATIONS['homelab/runtime/person_pipeline.py'] = {
    'f2f7417b7613b73ad17f17af34685e9b42b4b9a1322ca3e86fde8f3a2d65402d'}
GIB = 2 ** 30
SUBSYSTEMS = ('anatomy', 'cloth_contact', 'skin_hair', 'motion_collision', 'style', 'source_pins')
SEED_SUBSYSTEMS = ('anatomy', 'cloth', 'skin', 'hair', 'motion', 'collision', 'rig', 'style')

# The specialist surface, pinned by role.  The harness never rewrites these.
PINNED_SOURCES = (
    ('anatomy', 'homelab/runtime/person_anatomy.py'),
    ('anatomy', 'homelab/runtime/person_pelvis.py'),
    ('anatomy', 'videos/web/lib/fx/anatomy/soft/hook.js'),
    ('anatomy', 'videos/web/lib/fx/anatomy/pelvis/hook.js'),
    ('cloth_contact', 'videos/web/lib/fx/motion/cloth_motion.js'),
    ('cloth_contact', 'videos/web/lib/fx/cloth/wardrobe4/fabrics4.js'),
    ('cloth_contact', 'videos/web/lib/fx/cloth/fabrics.js'),
    ('cloth_contact', 'videos/web/lib/fx/cloth/cloth9/settle9.js'),
    ('skin_hair', 'homelab/runtime/person_fine_context.py'),
    ('skin_hair', 'videos/web/lib/fx/person/index.js'),
    ('skin_hair', 'videos/web/lib/fx/person/core.js'),
    ('skin_hair', 'videos/web/lib/fx/person/build.js'),
    ('motion_collision', 'homelab/runtime/person_pipeline.py'),
    ('motion_collision', 'videos/web/lib/fx/motion/bake7.js'),
    ('motion_collision', 'videos/web/lib/fx/motion/act7.js'),
    ('motion_collision', 'videos/web/lib/fx/motion/act6.js'),
    ('motion_collision', 'videos/web/lib/fx/motion/armdyn.js'),
    ('style', 'videos/web/lib/fx/style/recipes.js'),
    ('style', 'videos/web/scenes/oneshot2.js'),
    ('style', 'videos/web/lib/fx/light/pipeline.js'),
    ('style', 'videos/web/lib/fx/light/patch.js'),
    ('style', 'videos/web/lib/fx/stage/index.js'),
    ('source_pins', 'homelab/runtime/common_person.py'),
    ('source_pins', 'homelab/runtime/fframes_recipe.py'),
    ('source_pins', 'SOURCE_MANIFEST.json'),
)
PIN_PATHS = tuple(path for _, path in PINNED_SOURCES)

JS_SYNTAX = (
    'videos/web/lib/fx/motion/cloth_motion.js',
    'videos/web/lib/fx/cloth/wardrobe4/fabrics4.js',
    'videos/web/lib/fx/motion/bake7.js',
    'videos/web/lib/fx/motion/act7.js',
    'videos/web/lib/fx/style/recipes.js',
    'videos/web/scenes/oneshot2.js',
    'videos/web/lib/fx/person/index.js',
)
PY_RUNTIME = (
    'homelab/runtime/person_anatomy.py',
    'homelab/runtime/person_pelvis.py',
    'homelab/runtime/person_fine_context.py',
    'homelab/runtime/person_pipeline.py',
)

# The adapters embed deployment-owned Node preload modules.  They are not
# tracked by the pinned commit; the probe supplies deterministic fixtures
# and records their digests so the plumbing is reproducible.
MODULE_FIXTURES = {
    'soft_parallel.mjs': '// human-integration fixture: soft_parallel.mjs\n',
    'pelvis_coalesce.mjs': '// human-integration fixture: pelvis_coalesce.mjs\n',
    'farm_fine_context.mjs': '// human-integration fixture: farm_fine_context.mjs\n',
    'capture_fine_context.mjs': '// human-integration fixture: capture_fine_context.mjs\n',
    'scene_tiles.py': 'def install():\n    pass\n',
}

JOB_WRAPPER = '''
import json
import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
VIDEOS = os.environ['ACP_INTEGRATION_VIDEOS']
WORK = os.environ['ACP_INTEGRATION_WORK']
DRY = False
MAPS = {'bare': 'bare/maps'}
def farm_cpu_map(prepare, wears):
    return [prepare(w) for w in wears]
def farm_prepare_wear(wear):
    return wear
wears = ['bare']
farm_cpu_map(farm_prepare_wear, wears)
def run(cmd, cwd, fatal, tag, env):
    result = subprocess.run(cmd, cwd=cwd, env=env)
    print(json.dumps(env))
    if fatal and result.returncode:
        raise SystemExit(result.returncode)
    return result
boot = os.path.join(HERE, 'gpujob', 'boot.py')
'''

JS_PROBE = r'''
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [root, manifestPath] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const result = { node: process.version, syntax: {} };

for (const rel of manifest.check) {
  try {
    execFileSync(process.execPath, ['--check', path.join(root, rel)], { stdio: 'pipe' });
    result.syntax[rel] = true;
  } catch (error) {
    result.syntax[rel] = false;
    (result.syntaxErrors ||= {})[rel] = String(error.stderr || error.message).slice(-800);
  }
}

function objectAt(text, marker) {
  const found = text.indexOf(marker);
  if (found < 0) throw new Error('missing marker: ' + marker);
  const open = text.indexOf('{', found + marker.length);
  let depth = 0, quote = null, escape = false, line = false, block = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) { if (c === '*' && n === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && n === '/') { line = true; i++; continue; }
    if (c === '/' && n === '*') { block = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(open, i + 1);
  }
  throw new Error('unbalanced marker: ' + marker);
}

const styleText = fs.readFileSync(path.join(root, manifest.styles), 'utf8');
const styles = new Function('return (' + objectAt(styleText, 'export const STYLES = ') + ')')();
result.styles = {
  keys: Object.keys(styles),
  recipes: Object.fromEntries(['photoreal', 'notan', 'poster', 'cel', 'clay'].map(k => [k, styles[k] ?? null])),
};

const sceneText = fs.readFileSync(path.join(root, manifest.scene), 'utf8');
const cfg = new Function('return (' + objectAt(sceneText, 'const CFG = Object.assign(') + ')')();
result.scene = { who: cfg.who, K: cfg.K, seed: cfg.seed, song: cfg.song, look: cfg.look };

const fabrics = await import(pathToFileURL(path.join(root, manifest.fabrics)).href);
const first = fabrics.registerFabrics4();
const second = fabrics.registerFabrics4();
const required = ['gsm', 'mm', 'bend', 'stretch', 'shear', 'mu'];
const values = Object.values(fabrics.FABRICS4);
const range = key => [Math.min(...values.map(v => v[key])), Math.max(...values.map(v => v[key]))];
result.fabrics = {
  version: fabrics.FABRICS4_VERSION,
  fabrics: Object.keys(fabrics.FABRICS4),
  looks: Object.keys(fabrics.LOOKS4),
  cycles: Object.keys(fabrics.CYCLES4),
  first, second,
  idempotent: JSON.stringify(first) === JSON.stringify(second),
  missingFields: Object.fromEntries(Object.entries(fabrics.FABRICS4)
    .map(([key, value]) => [key, required.filter(field => value[field] === undefined)])),
  gsm: range('gsm'), mm: range('mm'), bend: range('bend'),
  knit: values.filter(v => v.construction === 'knit').length,
  woven: values.filter(v => v.construction !== 'knit').length,
  tableRows: fabrics.fabricTable(() => ({ c: 0.02 })).length,
};

const motion = await import(pathToFileURL(path.join(root, manifest.hair)).href);
const { Vector3 } = await import('three');
function hairRun(xs) {
  let index = 0;
  const h = { joint: () => new Vector3(xs[index++] ?? xs.at(-1), 1.5, 0) };
  const sway = new motion.HairSway(h);
  const frames = [];
  for (let i = 0; i < xs.length; i++) frames.push(sway.step(1 / 15, 6));
  return frames;
}
const moving = hairRun([0, 0.002, 0.008, 0.02, 0.035, 0.05, 0.06, 0.06, 0.06]);
const repeated = hairRun([0, 0.002, 0.008, 0.02, 0.035, 0.05, 0.06, 0.06, 0.06]);
const still = hairRun([0, 0, 0, 0, 0]);
const peak = (frames) => Math.max(...frames.flatMap(frame => Object.values(frame).map(Math.abs)));
result.hair = {
  groups: motion.HAIR_GROUPS,
  channels: motion.HAIR_CHANS.length,
  channelKeys: Object.keys(moving.at(-1)).sort(),
  peak_m: +peak(moving).toFixed(6),
  still_m: +peak(still).toFixed(6),
  repeat_equal: JSON.stringify(moving) === JSON.stringify(repeated),
};

const points = new Float32Array([0, 0, 0, 0.05, 0, 0, 0, 0.05, 0]);
const grid = new motion.Grid(points, 0.02);
const masked = new motion.Grid(points, 0.02, new Uint8Array([0, 1, 0]));
result.grid = {
  self: grid.nearest(0.01, 0, 0, 0.03),
  neighbor: grid.nearest(0.049, 0, 0, 0.03),
  outside: grid.nearest(0.2, 0, 0, 0.03),
  masked: masked.nearest(0.005, 0, 0, 0.03),
};

console.log(JSON.stringify(result));
'''


class ContractError(ValueError):
    """A pinned source no longer satisfies the integration contract."""


def _sha(value, length, label):
    if not _is_hex(value, length):
        raise ContractError(f'{label} must be {length} lowercase hex characters')
    return value


def _is_hex(value, length):
    return (isinstance(value, str) and len(value) == length
            and all(char in '0123456789abcdef' for char in value))


def _relative(path):
    if not isinstance(path, str) or not path or '\\' in path:
        raise ContractError('source path must be a relative POSIX path')
    pure = PurePosixPath(path)
    if pure.is_absolute() or '..' in pure.parts or '.' in pure.parts:
        raise ContractError('source path escapes the pinned tree: ' + path)
    return pure.as_posix()


def _git(repo, *args, binary=False):
    command = ['git', '-C', str(repo), *args]
    return subprocess.run(command, capture_output=True, text=not binary)


def _git_version(repo):
    try:
        line = _git(repo, '--version').stdout.strip().splitlines()[0]
        return line
    except (OSError, IndexError):
        return None


def _resolve_commit(repo, revision):
    run = _git(repo, 'rev-parse', '--verify', revision + '^{commit}')
    commit = run.stdout.strip()
    if run.returncode or not _is_hex(commit, 40):
        raise ContractError('unknown revision: ' + revision)
    return commit


def _sha256(data):
    return hashlib.sha256(data).hexdigest()


def _git_blob(data):
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def derive_seed(master_seed, subsystem):
    """Same bytes as human_sim.derive_seed so the two records interoperate."""
    _sha(master_seed, 128, 'master_seed')
    if subsystem not in SEED_SUBSYSTEMS:
        raise ContractError('unknown seed subsystem: ' + str(subsystem))
    digest = hashlib.sha256(bytes.fromhex(master_seed) + b':' + subsystem.encode()).digest()
    return int.from_bytes(digest[:8], 'big')


class SourceCommit:
    """Read-only blobs from one full commit, without trusting the worktree."""

    def __init__(self, repo, commit):
        self.repo = Path(repo).resolve()
        self.commit = _sha(commit, 40, 'commit')
        probe = _git(self.repo, 'cat-file', '-e', self.commit + '^{commit}')
        if probe.returncode:
            raise ContractError('pinned commit is not present: ' + self.commit)
        self._cache = {}

    def read(self, path):
        relative = _relative(path)
        if relative not in self._cache:
            run = _git(self.repo, 'show', self.commit + ':' + relative, binary=True)
            if run.returncode:
                raise ContractError('pinned source is missing: ' + relative)
            data = run.stdout
            self._cache[relative] = {
                'path': relative,
                'data': data,
                'text': data.decode('utf-8'),
                'sha256': _sha256(data),
                'git_blob': _git_blob(data),
                'bytes': len(data),
                'lines': data.count(b'\n') + (1 if data and not data.endswith(b'\n') else 0),
            }
        return self._cache[relative]

    def pin(self, path):
        item = self.read(path)
        return {key: item[key] for key in ('path', 'sha256', 'git_blob', 'bytes', 'lines')}


def _one(text, needle, label):
    count = text.count(needle)
    if count != 1:
        raise ContractError(f'{label}: expected exactly one occurrence, found {count}')
    return text


def _require(condition, label):
    if not condition:
        raise ContractError(label)


def _py_constants(text, names):
    tree = ast.parse(text)
    result = {}
    for node in tree.body:
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign) and node.value is not None:
            targets = [node.target]
        else:
            continue
        for target in targets:
            if not isinstance(target, ast.Name) or target.id not in names:
                continue
            try:
                result[target.id] = ast.literal_eval(node.value)
            except (ValueError, TypeError, SyntaxError):
                pass
    return result


def _function_source(text, name):
    tree = ast.parse(text)
    node = next((item for item in tree.body
                 if isinstance(item, ast.FunctionDef) and item.name == name), None)
    if node is None:
        raise ContractError('function is missing: ' + name)
    return ast.get_source_segment(text, node) or ''


def _balanced(text, start):
    if start < 0 or start >= len(text) or text[start] != '{':
        raise ContractError('expected an object at offset ' + str(start))
    depth = 0
    quote = None
    escape = False
    line = False
    block = False
    i = start
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if line:
            if char == '\n':
                line = False
        elif block:
            if char == '*' and nxt == '/':
                block = False
                i += 1
        elif quote:
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == quote:
                quote = None
        else:
            if char == '/' and nxt == '/':
                line = True
                i += 1
            elif char == '/' and nxt == '*':
                block = True
                i += 1
            elif char in '\'"`':
                quote = char
            elif char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
                if depth == 0:
                    return text[start:i + 1]
        i += 1
    raise ContractError('unbalanced object literal')


def _object_after(text, marker):
    found = text.find(marker)
    if found < 0:
        raise ContractError('missing marker: ' + marker)
    return _balanced(text, text.find('{', found + len(marker)))


def _split_top_level(text):
    parts = []
    start = 0
    depth = 0
    quote = None
    escape = False
    line = False
    block = False
    i = 0
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if line:
            if char == '\n':
                line = False
        elif block:
            if char == '*' and nxt == '/':
                block = False
                i += 1
        elif quote:
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == quote:
                quote = None
        else:
            if char == '/' and nxt == '/':
                line = True
                i += 1
            elif char == '/' and nxt == '*':
                block = True
                i += 1
            elif char in '\'"`':
                quote = char
            elif char in '([{':
                depth += 1
            elif char in ')]}':
                depth -= 1
            elif char == ',' and depth == 0:
                parts.append(text[start:i])
                start = i + 1
        i += 1
    parts.append(text[start:])
    return parts


def _js_literal(value):
    value = value.strip()
    if value == 'true':
        return True
    if value == 'false':
        return False
    if value in ('null', 'undefined'):
        return None
    if re.fullmatch(r'-?\d+', value):
        return int(value)
    if re.fullmatch(r'-?\d+\.\d+', value):
        return float(value)
    if value.startswith('[') and value.endswith(']'):
        return [_js_literal(part) for part in _split_top_level(value[1:-1]) if part.strip()]
    if len(value) >= 2 and value[0] == value[-1] and value[0] in '\'"`':
        return value[1:-1]
    return value


def _strip_js_comments(text):
    output = []
    quote = None
    escape = False
    i = 0
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if quote:
            output.append(char)
            if escape:
                escape = False
            elif char == '\\':
                escape = True
            elif char == quote:
                quote = None
        elif char in '\'"`':
            quote = char
            output.append(char)
        elif char == '/' and nxt == '/':
            while i < len(text) and text[i] != '\n':
                i += 1
            output.append('\n')
        elif char == '/' and nxt == '*':
            i += 2
            while i < len(text) and not (text[i] == '*' and i + 1 < len(text) and text[i + 1] == '/'):
                i += 1
            i += 1
        else:
            output.append(char)
        i += 1
    return ''.join(output)


def _js_options(text):
    options = {}
    for part in _split_top_level(_strip_js_comments(text)):
        part = part.strip()
        if not part:
            continue
        match = re.fullmatch(r'([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)\s*=\s*(.+)', part, re.S)
        if match:
            options[match.group(1)] = _js_literal(match.group(3))
            continue
        match = re.fullmatch(r'([A-Za-z_$][\w$]*)\s*=\s*(.+)', part, re.S)
        if match:
            options[match.group(1)] = _js_literal(match.group(2))
            continue
        match = re.fullmatch(r'([A-Za-z_$][\w$]*)\s*:\s*(.+)', part, re.S)
        if match:
            options[match.group(1)] = _js_literal(match.group(2))
            continue
        options[part] = None
    return options


def _options_after(text, marker):
    return _js_options(_object_after(text, marker)[1:-1])


def _scene_cfg(text):
    return _options_after(text, 'const CFG = Object.assign(')


def _find_node():
    candidates = [os.environ.get('NODE'), shutil.which('node')]
    candidates += [
        '/opt/flip/release-browser-authority-v1/node/bin/node',
        '/opt/flip/native-linux-wdio-v1/tools/bin/node',
        '/usr/local/bin/node',
        '/usr/bin/node',
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def _write_tree(root, sources, extra=None):
    for relative, text in sources.items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    for relative, text in (extra or {}).items():
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)


def run_node_probe(source, node=None):
    """Execute pinned JS registries with stubs; parse pinned style/scene data."""
    node = node or _find_node()
    if not node:
        return {'available': False, 'reason': 'node not found'}
    sources = {relative: source.read(relative)['text'] for relative in JS_SYNTAX}
    with tempfile.TemporaryDirectory(prefix='human-integration-node-') as temporary:
        root = Path(temporary)
        _write_tree(root, sources, {
            'package.json': '{"type":"module"}\n',
            # cloth_motion.js imports the fabric book and the solver gap; the
            # registry probe only needs their shapes, not their full tables.
            'videos/web/lib/fx/cloth/fabrics.js': 'export const FABRICS = {};\nexport const LOOKS = {};\n',
            'videos/web/lib/fx/cloth/cloth9/settle9.js': 'export const SETTLE9 = {};\n',
            # HairSway only needs Vector3; everything else in cloth_motion.js
            # is defined but not called by this probe.
            'node_modules/three/package.json': '{"name":"three","type":"module","main":"index.js"}\n',
            'node_modules/three/index.js': '''export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  length() { return Math.hypot(this.x, this.y, this.z); }
  setLength(length) { const current = this.length(); if (current > 0) this.multiplyScalar(length / current); return this; }
}
''',
        })
        manifest = {
            'check': list(JS_SYNTAX),
            'styles': 'videos/web/lib/fx/style/recipes.js',
            'scene': 'videos/web/scenes/oneshot2.js',
            'fabrics': 'videos/web/lib/fx/cloth/wardrobe4/fabrics4.js',
            'hair': 'videos/web/lib/fx/motion/cloth_motion.js',
        }
        (root / 'manifest.json').write_text(json.dumps(manifest))
        (root / 'probe.mjs').write_text(JS_PROBE)
        run = subprocess.run(
            [node, str(root / 'probe.mjs'), str(root), str(root / 'manifest.json')],
            capture_output=True, text=True, timeout=120,
        )
        if run.returncode:
            return {'available': True, 'version': None, 'path': node,
                    'error': (run.stderr or run.stdout)[-2000:]}
        try:
            result = json.loads(run.stdout)
        except json.JSONDecodeError as error:
            return {'available': True, 'version': None, 'path': node,
                    'error': 'invalid probe output: ' + str(error)}
        result.update(available=True, path=node, version=result.get('node'))
        return result


def _result(checks, metrics):
    return {'ok': all(checks.values()), 'checks': checks, 'metrics': metrics}


def analyse_anatomy(texts, node):
    anatomy = texts['homelab/runtime/person_anatomy.py']
    pelvis = texts['homelab/runtime/person_pelvis.py']
    common = texts['homelab/runtime/common_person.py']
    a = _py_constants(anatomy, {'VERSION', 'QUALIFIED_LIBRARIES', 'QUALIFIED_HOOKS'})
    p = _py_constants(pelvis, {'VERSION'})
    c = _py_constants(common, {
        'VERSION', 'QUALIFIED_CPU_POLICY', 'QUALIFIED_PERSON', 'QUALIFIED_HELPERS',
        'MODERN_LIBRARIES', 'MODERN_HELPERS', 'ADDITIONAL_LIBRARIES', 'CHILD_GUARD_SHA256',
    })
    libraries = a.get('QUALIFIED_LIBRARIES', set())
    hooks = a.get('QUALIFIED_HOOKS', set())
    people = c.get('QUALIFIED_PERSON', set())
    _one(anatomy, 'def library_digest(web):', 'anatomy library digest')
    _one(anatomy, 'def qualified(repo):', 'anatomy qualification')
    _one(anatomy, 'def adapt(source, module_source=None):', 'anatomy adapter')
    _one(pelvis, 'def adapt(source, module_source=None):', 'pelvis adapter')
    checks = {
        'library_pins_are_sha256': isinstance(libraries, set) and bool(libraries) and all(_is_hex(x, 64) for x in libraries),
        'hook_pins_are_sha256': isinstance(hooks, set) and bool(hooks) and all(_is_hex(x, 64) for x in hooks),
        'qualified_person_is_sha256': isinstance(people, set) and bool(people) and all(_is_hex(x, 64) for x in people),
        'library_digest_sorted_walk': 'for f in sorted(directory.iterdir()):' in anatomy,
        'qualification_checks_hook_and_library': 'hashlib.sha256(hook.read_bytes()).hexdigest() in QUALIFIED_HOOKS' in anatomy,
        'anatomy_adapter_idempotent': "if 'FARM_ANATOMY_VERSION = ' in source:" in anatomy,
        'pelvis_adapter_version_guard': "Unknown pelvis adapter version" in pelvis,
        'common_person_exact_cache': "VERSION = 'common-person-anatomy-v1'" in common,
        'common_person_deployed_helpers': set(c.get('QUALIFIED_HELPERS', {})) >= {'soft_parallel.mjs', 'pelvis_coalesce.mjs'},
        'common_person_modern_helpers': set(c.get('MODERN_HELPERS', {})) >= {'common_soft_fields.mjs', 'common_pelvis_fields.mjs'},
        'child_guard_pin': _is_hex(c.get('CHILD_GUARD_SHA256'), 64),
    }
    metrics = {
        'versions': {'person_anatomy': a.get('VERSION'), 'person_pelvis': p.get('VERSION'), 'common_person': c.get('VERSION')},
        'qualified_libraries': len(libraries),
        'qualified_hooks': len(hooks),
        'qualified_people': len(people),
        'qualified_helpers': sorted(c.get('QUALIFIED_HELPERS', {})),
        'cpu_policy_pin': c.get('QUALIFIED_CPU_POLICY'),
    }
    return _result(checks, metrics)


def analyse_cloth_contact(texts, node):
    cloth = texts['videos/web/lib/fx/motion/cloth_motion.js']
    fabrics = texts['videos/web/lib/fx/cloth/wardrobe4/fabrics4.js']
    settle = texts['videos/web/lib/fx/cloth/cloth9/settle9.js']
    defaults = _options_after(cloth, 'constructor(P, ')
    fabrics_table = _options_after(fabrics, 'export const FABRICS4 = ')
    looks_table = _options_after(fabrics, 'export const LOOKS4 = ')
    fabric_probe = (node or {}).get('fabrics') or {}
    checks = {
        'cloth_contact_floor': defaults.get('contact') is True,
        'cloth_substeps': defaults.get('sub') == 4,
        'cloth_relax_sweeps': defaults.get('relax') == 16,
        'cloth_woven_stretch_limit': defaults.get('stretch') == 0.04,
        'cloth_knit_stretch_limit': defaults.get('stretchKnit') == 0.15,
        'cloth_squeeze_limit': defaults.get('squeeze') == 0.15,
        'cloth_measure_rulers': all(token in cloth for token in ('out.all.skin++', 'out.all.sunk++', 'out.all.inside++')),
        'cloth_step_contract': 'step(dt, { first = false, measure = true } = {})' in cloth,
        'cloth_family_colliders': 'this._gF[s.fam[i]]' in cloth and 'this._relax(rep' in cloth,
        'fabric_registry_present': 'export function registerFabrics4()' in fabrics,
        'fabric_registry_never_overwrites': 'if (FABRICS[k]) continue;' in fabrics,
        'fabric_registry_idempotent': '_done' in fabrics,
        'fabric_table_has_nine': len(fabrics_table) == 9,
        'fabric_looks_match': set(looks_table) == set(fabrics_table),
        'garment_solver_contact_gap': 'SETTLE9' in cloth and 'SETTLE9' in settle,
    }
    grid_probe = (node or {}).get('grid') or {}
    if fabric_probe:
        checks.update({
            'node_fabric_registry_idempotent': fabric_probe.get('idempotent') is True,
            'node_fabric_fields_complete': all(not missing for missing in (fabric_probe.get('missingFields') or {}).values()),
            'node_fabric_table_rows': fabric_probe.get('tableRows') == 9,
        })
    if grid_probe:
        checks.update({
            'node_grid_finds_self': grid_probe.get('self') == 0,
            'node_grid_finds_neighbor': grid_probe.get('neighbor') == 1,
            'node_grid_rejects_outside': grid_probe.get('outside') == -1,
            'node_grid_honors_mask': grid_probe.get('masked') == -1,
        })
    metrics = {
        'defaults': {key: defaults.get(key) for key in ('hz', 'zeta', 'cap', 'sub', 'relax', 'contact', 'stretch', 'stretchKnit', 'squeeze')},
        'fabric_count': len(fabrics_table),
        'fabrics': sorted(fabrics_table),
        'measure_keys': ['skin', 'sunk', 'inside', 'covered'],
        'grid': grid_probe or None,
        'node': {key: fabric_probe.get(key) for key in ('version', 'idempotent', 'gsm', 'mm', 'bend', 'knit', 'woven', 'tableRows')} if fabric_probe else None,
    }
    return _result(checks, metrics)


def analyse_skin_hair(texts, node):
    fine = texts['homelab/runtime/person_fine_context.py']
    cloth = texts['videos/web/lib/fx/motion/cloth_motion.js']
    person = texts['videos/web/lib/fx/person/index.js']
    scene = texts['videos/web/scenes/oneshot2.js']
    f = _py_constants(fine, {'VERSION', 'EXPORT_SHA', 'FINE_SHA'})
    hair_defaults = _options_after(cloth, 'constructor(h, ')
    hair_probe = (node or {}).get('hair') or {}
    checks = {
        'fine_context_version': f.get('VERSION') == 'exact-export-context-v1',
        'fine_source_pin': _is_hex(f.get('FINE_SHA'), 64),
        'export_source_pin': _is_hex(f.get('EXPORT_SHA'), 64),
        'fine_patch_four_anchors': _function_source(fine, '_patch_source').count('_one(source, ') == 4,
        'fine_context_preload': "--import=' + (root / 'capture_fine_context.mjs').as_uri()" in fine,
        'fine_context_materialize': 'farm_fine_context_materialize' in fine,
        'person_exports_skin_sss': 'ensureSkinSSS' in person,
        'person_loads_hair_and_skin': 'if (hair)' in person and 'if (skin)' in person,
        'scene_skin_sss': 'PI.ensureSkinSSS(lr, scene)' in scene,
        'scene_hair_groom_gate': 'hair: !!P.groom' in scene,
        'scene_hair_player': 'new CM.HairPlayer(P, tp)' in scene,
        'scene_fine_detail_update': 'p.P.detail?.update?.()' in scene,
        'hair_sway_export': 'export class HairSway' in cloth,
        'hair_channels_nine': _hair_channel_count(cloth) == 9,
    }
    if hair_probe:
        checks.update({
            'node_hair_channels': hair_probe.get('channels') == 9,
            'node_hair_channel_keys': len(hair_probe.get('channelKeys') or []) == 9,
            'node_hair_sway_moves': (hair_probe.get('peak_m') or 0) > 0,
            'node_hair_sway_still_zero': hair_probe.get('still_m') == 0,
            'node_hair_sway_repeatable': hair_probe.get('repeat_equal') is True,
        })
    metrics = {
        'fine_context_version': f.get('VERSION'),
        'fine_source_sha256': f.get('FINE_SHA'),
        'export_source_sha256': f.get('EXPORT_SHA'),
        'hair_groups': hair_probe.get('groups') or ['L', 'R', 'C'],
        'hair_channels': hair_probe.get('channels') or _hair_channel_count(cloth),
        'hair_defaults': hair_defaults,
        'hair_probe': {key: hair_probe.get(key) for key in ('peak_m', 'still_m', 'repeat_equal')} if hair_probe else None,
    }
    return _result(checks, metrics)


def _hair_channel_count(cloth):
    match = re.search(r"HAIR_GROUPS = \[([^\]]*)\]", cloth)
    if not match:
        raise ContractError('HAIR_GROUPS table is missing')
    groups = [item.strip().strip('\'"') for item in match.group(1).split(',') if item.strip()]
    return len(groups) * 3


def analyse_motion_collision(texts, node):
    bake = texts['videos/web/lib/fx/motion/bake7.js']
    act = texts['videos/web/lib/fx/motion/act7.js']
    scene = texts['videos/web/scenes/oneshot2.js']
    defaults = _options_after(bake, 'export async function bakeTrack7(')
    scene_bake = _options_after(scene, 'bakeTrack7(')
    cfg = _scene_cfg(scene)
    checks = {
        'bake_fps': defaults.get('fps') == 15,
        'bake_frames': defaults.get('nf') == 91,
        'bake_cloth_key': defaults.get('key') == 1,
        'bake_hands_every': defaults.get('every') == 2,
        'bake_cloth_default': defaults.get('cloth') is True,
        'bake_hair_default': defaults.get('hair') is True,
        'bake_cloth_step': 'cloth.step(dt, { first: i === 0, measure: false })' in bake,
        'bake_cloth_keyframes': 'if (i % key === 0)' in bake,
        'bake_hair_groom_gate': 'wantHair && P.groom ? new HairSway(h) : null' in bake,
        'bake_channels_include_hair_and_face': '...HAIR_CHANS' in bake and '...FACE7' in bake,
        'clips_present': all(f'  {name}: clip7(' in act for name in ('row7', 'walk7', 'lift7', 'wave7')),
        'lift_contact_ruler': 'contact(M) {' in act and 'palmMin' in act and 'out.torso' in act,
        'scene_bake_cloth_offline': scene_bake.get('cloth') is False,
        'scene_bake_hair_groom': scene_bake.get('hair') == '!!P.groom',
        'scene_bake_key_three': scene_bake.get('key') == 3,
        'scene_bake_hands_two': scene_bake.get('every') == 2,
        'scene_track_player': 'new CM.TrackPlayer(P, Bk.T)' in scene,
        'scene_cloth_playback_off': 'p.tp.apply(tau, { cloth: false })' in scene,
        'scene_hair_player': 'new CM.HairPlayer(P, tp)' in scene,
        'scene_eye_player': 'new CM.EyePlayer(P)' in scene,
        'scene_face_channels': 'W3.A7.applyFace7' in scene,
    }
    metrics = {
        'bake_defaults': {key: defaults.get(key) for key in ('fps', 'nf', 'key', 'every', 'cloth', 'hair', 'rulers')},
        'scene_bake': {key: scene_bake.get(key) for key in ('clip', 'fps', 'key', 'every', 'cloth', 'hair')},
        'clips': ['row7', 'walk7', 'lift7', 'wave7'],
        'scene_fps': cfg.get('fps', 15),
        'scene_people': len(cfg.get('who') or []),
    }
    return _result(checks, metrics)


def _recipe_checks(prefix, recipe, level, surface, medium):
    _require(isinstance(recipe, dict), f'{prefix} recipe is missing')
    shape = recipe.get('shape') or {}
    surface_recipe = recipe.get('surface') or {}
    medium_recipe = recipe.get('medium') or {}
    return {
        f'{prefix}_shape_level': shape.get('level') == level,
        f'{prefix}_surface': surface_recipe.get('surface') == surface,
        f'{prefix}_medium': medium_recipe.get('kind') == medium,
    }


def analyse_style(texts, node):
    recipes = texts['videos/web/lib/fx/style/recipes.js']
    scene = texts['videos/web/scenes/oneshot2.js']
    person = texts['videos/web/lib/fx/person/index.js']
    cfg = _scene_cfg(scene)
    profiles = (node or {}).get('styles') or {}
    recipe_profiles = profiles.get('recipes') or {}
    photoreal = recipe_profiles.get('photoreal')
    notan = recipe_profiles.get('notan')
    checks = {
        'scene_seed': cfg.get('seed') == 2026,
        'scene_six_people': len(cfg.get('who') or []) == 6,
        'scene_look_default_cold': cfg.get('look') == 'cold',
        'scene_ink_register': "CFG.look === 'ink'" in scene,
        'scene_ink_filter': 'grayscale(1) contrast(2.2) brightness(1.05)' in scene,
        'scene_duotone_layers': "globalCompositeOperation = 'multiply'" in scene and "globalCompositeOperation = 'lighten'" in scene,
        'scene_cold_tint': '#a8d8ee' in scene and '#06121a' in scene,
        'scene_warm_tint': '#ffb98a' in scene and '#1a0c08' in scene,
        'style_stage_clip': "quality: 'clip'" in scene,
        'style_recipes_present': 'export const STYLES =' in recipes and "'photoreal'" in recipes and 'notan:' in recipes,
        'person_extra_styles': 'EXTRA_STYLES' in person and 'l1skin' in person,
    }
    metrics = {
        'scene': {**{key: cfg.get(key) for key in ('seed', 'song', 'look', 'K')}, 'fps': cfg.get('fps') or 15},
        'scene_people': list(cfg.get('who') or []),
        'style_keys': profiles.get('keys'),
        'photoreal': photoreal,
        'notan': notan,
    }
    if profiles:
        checks.update(_recipe_checks('photoreal', photoreal, 0, 'skin', 'lit'))
        checks['photoreal_meters_face'] = (photoreal.get('medium') or {}).get('meter') == 'face'
        checks.update(_recipe_checks('notan', notan, {'default': 2, 'head': 1.5, 'hands': 1}, 'notan', 'designed'))
        checks['notan_line_weight'] = (notan.get('line') or {}).get('weight') == 2.4
    return _result(checks, metrics)


def _manifest_probe(text):
    manifest = json.loads(text)
    files = manifest.get('files') or []
    paths = [item.get('path') for item in files]
    checks = {
        'source_manifest_head_is_commit': _is_hex(manifest.get('head'), 40),
        'source_manifest_files': len(files) == 10,
        'source_manifest_paths_unique': len(paths) == len(set(paths)),
        'source_manifest_hashes': all(_is_hex(item.get('sha256'), 64) and _is_hex(item.get('git_blob'), 40) for item in files),
    }
    metrics = {'head': manifest.get('head'), 'file_count': len(files), 'paths': sorted(paths)}
    return checks, metrics


def analyse_source_pins(texts, node):
    recipe = texts['homelab/runtime/fframes_recipe.py']
    constants = _py_constants(recipe, {
        'FULL_SCENE_SOURCE_COMMIT', 'FULL_SCENE_CAPTURE_COMMIT', 'FULL_SCENE_RENDERER_COMMIT',
        'FULL_SCENE_RENDERER_SOURCE', 'FULL_SCENE_RENDERER_TREE', 'FULL_SCENE_BINARY_SHA256',
        'FULL_SCENE_SOURCE_FILE_HASHES', 'FULL_SCENE_SEGMENTS', 'FULL_SCENE_SEGMENT_FRAMES',
        'DEFAULT_SOURCE_MANIFEST',
    })
    manifest_checks, manifest_metrics = _manifest_probe(texts['SOURCE_MANIFEST.json'])
    file_hashes = constants.get('FULL_SCENE_SOURCE_FILE_HASHES') or {}
    checks = {
        'recipe_source_commit': _is_hex(constants.get('FULL_SCENE_SOURCE_COMMIT'), 40),
        'recipe_capture_commit': _is_hex(constants.get('FULL_SCENE_CAPTURE_COMMIT'), 40),
        'recipe_renderer_commit': _is_hex(constants.get('FULL_SCENE_RENDERER_COMMIT'), 40),
        'recipe_renderer_source': _is_hex(constants.get('FULL_SCENE_RENDERER_SOURCE'), 40),
        'recipe_renderer_tree': _is_hex(constants.get('FULL_SCENE_RENDERER_TREE'), 40),
        'recipe_binary_sha256': _is_hex(constants.get('FULL_SCENE_BINARY_SHA256'), 64),
        'recipe_scene_file_hashes': len(file_hashes) == 4 and all(_is_hex(value, 64) for value in file_hashes.values()),
        'recipe_six_segments': constants.get('FULL_SCENE_SEGMENTS') == 6,
        'recipe_segment_frames': constants.get('FULL_SCENE_SEGMENT_FRAMES') == 289,
        'recipe_default_manifest': isinstance(constants.get('DEFAULT_SOURCE_MANIFEST'), str) and constants['DEFAULT_SOURCE_MANIFEST'].startswith('/run/'),
    }
    checks.update(manifest_checks)
    metrics = {
        'full_scene': {
            key: constants.get(key) for key in (
                'FULL_SCENE_SOURCE_COMMIT', 'FULL_SCENE_CAPTURE_COMMIT', 'FULL_SCENE_RENDERER_COMMIT',
                'FULL_SCENE_RENDERER_SOURCE', 'FULL_SCENE_RENDERER_TREE', 'FULL_SCENE_BINARY_SHA256',
                'FULL_SCENE_SEGMENTS', 'FULL_SCENE_SEGMENT_FRAMES',
            )
        },
        'source_manifest': manifest_metrics,
    }
    return _result(checks, metrics)


ANALYSERS = {
    'anatomy': analyse_anatomy,
    'cloth_contact': analyse_cloth_contact,
    'skin_hair': analyse_skin_hair,
    'motion_collision': analyse_motion_collision,
    'style': analyse_style,
    'source_pins': analyse_source_pins,
}


class _PipelinePath(pathlib.Path):
    """Give person_pipeline a fixture for its untracked scene_tiles.py."""

    scene_tiles = None

    def read_text(self, *args, **kwargs):
        if self.name == 'scene_tiles.py' and type(self).scene_tiles is not None:
            return type(self).scene_tiles
        return super().read_text(*args, **kwargs)


def _worktree_state(repo, commit, source):
    """Qualify worktree modules against the pin or the merged S1 blobs."""
    qualifications = {}
    for relative in PY_RUNTIME:
        path = Path(repo) / relative
        if not path.is_file():
            return False, 'worktree is missing ' + relative, {}
        actual = _sha256(path.read_bytes())
        if actual == source.read(relative)['sha256']:
            qualifications[relative] = 'pinned'
        elif actual in WORKTREE_QUALIFICATIONS.get(relative, ()):
            qualifications[relative] = 'merged'
        else:
            return False, 'worktree copy differs from pinned/merged blob: ' + relative, {}
    return True, '', qualifications


def probe_shared_anatomy(repo, commit):
    """Compose the four adapters on a throwaway wrapper and execute its dispatch."""
    repo = Path(repo).resolve()
    source = SourceCommit(repo, commit)
    checked, reason, qualifications = _worktree_state(repo, commit, source)
    if not checked:
        return {'status': 'skipped', 'required': False, 'ok': False,
                'checks': {'pinned_sources_in_worktree': False}, 'reason': reason}
    runtime = repo / 'homelab/runtime'
    sys.path.insert(0, str(runtime))
    saved = {}
    try:
        import person_anatomy
        import person_fine_context
        import person_pelvis
        import person_pipeline
        modules = {'person_anatomy': person_anatomy, 'person_fine_context': person_fine_context,
                   'person_pelvis': person_pelvis, 'person_pipeline': person_pipeline}
        for name, module in modules.items():
            path = Path(module.__file__).resolve()
            if runtime not in path.parents:
                return {'status': 'skipped', 'required': False, 'ok': False,
                        'checks': {'pinned_sources_in_worktree': False},
                        'reason': f'{name} imported from {path}, not {runtime}'}
        saved['anatomy'] = person_anatomy.adapt
        saved['pelvis'] = person_pelvis.adapt
        saved['context'] = person_fine_context.adapt
        saved['path'] = person_pipeline.Path
        person_anatomy.adapt = lambda text: saved['anatomy'](text, module_source=MODULE_FIXTURES['soft_parallel.mjs'])
        person_pelvis.adapt = lambda text: saved['pelvis'](text, module_source=MODULE_FIXTURES['pelvis_coalesce.mjs'])
        person_fine_context.adapt = lambda text: saved['context'](
            text,
            helper_source=MODULE_FIXTURES['farm_fine_context.mjs'],
            capture_source=MODULE_FIXTURES['capture_fine_context.mjs'],
        )
        person_pipeline.Path = _PipelinePath
        _PipelinePath.scene_tiles = MODULE_FIXTURES['scene_tiles.py']
        composed = person_pipeline.adapt(JOB_WRAPPER)
        compile(composed, 'human_integration.wrapper.py', 'exec')
        idempotent = person_pipeline.adapt(composed) == composed
    finally:
        if 'anatomy' in saved:
            person_anatomy.adapt = saved['anatomy']
        if 'pelvis' in saved:
            person_pelvis.adapt = saved['pelvis']
        if 'context' in saved:
            person_fine_context.adapt = saved['context']
        if 'path' in saved:
            person_pipeline.Path = saved['path']
        sys.path.remove(str(runtime))

    with tempfile.TemporaryDirectory(prefix='human-integration-probe-') as temporary:
        root = Path(temporary)
        work = root / 'work'
        videos = root / 'videos'
        work.mkdir()
        videos.mkdir()
        probe_env = {'ACP_INTEGRATION_VIDEOS': str(videos), 'ACP_INTEGRATION_WORK': str(work)}
        saved_env = {key: os.environ.get(key) for key in probe_env}
        os.environ.update(probe_env)
        namespace = {'__name__': 'human_integration_wrapper', '__file__': str(root / 'person_job.py')}
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                exec(compile(composed, namespace['__file__'], 'exec'), namespace)
            calls = []
            namespace['subprocess'] = SimpleNamespace(
                run=lambda cmd, cwd=None, env=None: (
                    calls.append((list(cmd), dict(env or {}))),
                    SimpleNamespace(returncode=0),
                )[1]
            )
            with contextlib.redirect_stdout(io.StringIO()):
                result = namespace['run'](
                    ['node', 'web/labs/human8/export_person.mjs'], str(root), False, 'integration', {},
                )
        finally:
            for key, value in saved_env.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        command, environment_out = calls[0]
        node_options = environment_out.get('NODE_OPTIONS', '')
        node_imports = sorted(
            token.split('=', 1)[1].split('/')[-1]
            for token in shlex.split(node_options)
            if token.startswith('--import=')
        )
        materialized = sorted(
            ({'name': str(path.relative_to(work)), 'sha256': _sha256(path.read_bytes())}
             for path in work.rglob('*') if path.is_file()),
            key=lambda item: item['name'],
        )
    checks = {
        'pinned_sources_in_worktree': True,
        'composed_compiles': True,
        'all_adapter_versions': all(
            marker in composed for marker in (
                'FARM_ANATOMY_VERSION', 'FARM_PELVIS_VERSION',
                'FARM_FINE_CONTEXT_VERSION', 'FARM_PERSON_PIPELINE',
            )
        ),
        'dispatch_reached_subprocess': result.returncode == 0 and command[1] == 'web/labs/human8/export_person.mjs',
        'three_preloads': len(node_imports) == 3,
        'four_private_modules': len(materialized) == 4,
        'cache_flags': environment_out.get('ACP_SOFT_PARALLEL') == '1' and environment_out.get('ACP_PELVIS_COALESCE') == '1',
        'idempotent': idempotent,
    }
    return {
        'status': 'ok', 'required': True, 'ok': all(checks.values()), 'checks': checks,
        'qualifications': qualifications,
        'merged_qualifications': sorted(path for path, kind in qualifications.items() if kind == 'merged'),
        'merged_source': MERGED_SOURCE,
        'adapter_versions': {
            'anatomy': 'soft-sides-coalesced-v1',
            'pelvis': 'pelvis-exact-coalesced-v1',
            'context': 'exact-export-context-v1',
            'pipeline': 'person-detail-overlap-and-shared-tiles-v4',
        },
        'wrapper_sha256': _sha256(composed.encode()),
        'execution': {
            'cmd': command,
            'env_keys': sorted(environment_out),
            'node_imports': node_imports,
            'materialized': materialized,
        },
    }


def _register_comparison(style, node, master_seed):
    metrics = style.get('metrics', {})
    scene = metrics.get('scene') or {}
    profiles = (node or {}).get('styles') or {}
    recipes = profiles.get('recipes') or {}
    photoreal = recipes.get('photoreal')
    notan = recipes.get('notan')
    scene_registers = {
        'shared': {
            'person_api': 'makePerson/loadPersonStudio',
            'wear': 'work',
            'clip': 'walk7',
            'seed_formula': 'CFG.seed + i',
            'stage': {'width': 1080, 'height': 1920, 'quality': 'clip'},
            'simulation': ['cloth bake', 'hair groom', 'eye gaze', 'face channels', 'skin SSS'],
        },
        'photorealistic': {'look': 'cold', 'ink': False},
        'stylized': {'look': 'ink', 'ink': True},
        'differing': ['look', 'postprocess.ink', 'postprocess.filter', 'duotone.tint'],
        'same_geometry': True,
    }
    recipe_registers = None
    if photoreal and notan:
        recipe_registers = {
            'photorealistic': photoreal,
            'stylized': notan,
            'differing': ['shape.level', 'surface', 'line', 'medium'],
            'same_geometry': False,
            'note': 'recipe registers change shape/surface/line/medium by design; the scene ink register keeps geometry fixed',
        }
    seed = {'master': master_seed, 'derived': {name: derive_seed(master_seed, name) for name in SEED_SUBSYSTEMS}}
    passed = (
        scene.get('look') == 'cold'
        and len(metrics.get('scene_people') or []) == 6
        and (recipe_registers is None or (
            (photoreal.get('shape') or {}).get('level') == 0
            and (notan.get('shape') or {}).get('level') == {'default': 2, 'head': 1.5, 'hands': 1}
        ))
    )
    return {
        'scene': scene_registers,
        'recipes': recipe_registers,
        'seed': seed,
        'comparison': {
            'passed': passed,
            'shared': scene_registers['shared'],
            'differing': scene_registers['differing'],
            'same_geometry_scene_register': True,
            'recipe_changes_shape': bool(recipe_registers),
        },
    }


def minimum_render_comparison(memory_bytes=8 * GIB, active_ids=(), job_id=None):
    """Describe, but never launch, the smallest real scene comparison."""
    if type(memory_bytes) is not int or memory_bytes <= 0:
        raise ContractError('memory_bytes must be a positive integer')
    job_id = job_id or ('issue87-human-compare-' + PINNED_COMMIT[:12])
    if job_id in set(active_ids or ()):
        raise ContractError('duplicate active render refused: ' + job_id)
    return {
        'job_id': job_id,
        'status': 'not_started',
        'admission_required': True,
        'gpu_slots': 1,
        'memory_bytes': memory_bytes,
        'memory_basis': '8 GiB is the existing scene-canary declaration in test_memory_admission; confirm at submission',
        'frames': 2,
        'resolution': [1080, 1920],
        'scene': 'videos/web/scenes/oneshot2.js',
        'beat': 18,
        'registers': ['cold', 'ink'],
        'engine': 'headless Chromium WebGL through the scene renderer',
        'outputs': ['png_sha256', 'mean_rgb'],
        'why_minimum': 'one already-metered pose (beat 18: all six people, three mid-walk), two register settings, no animation sequence',
        'admission': 'existing admission_policy.plan + gpu_jobs; finite memory and a free GPU slot are required',
    }


def _passed(report):
    if report['missing_pins']:
        return False
    node = report['node']
    if not node.get('available') or node.get('error'):
        return False
    if not all(node.get('syntax', {}).values()):
        return False
    fabrics = node.get('fabrics') or {}
    if fabrics.get('idempotent') is not True:
        return False
    if any(missing for missing in (fabrics.get('missingFields') or {}).values()):
        return False
    hair = node.get('hair') or {}
    if hair.get('channels') != 9 or not hair.get('repeat_equal'):
        return False
    for subsystem in report['subsystems'].values():
        if not subsystem.get('ok') or not all(subsystem.get('checks', {}).values()):
            return False
    probe = report['integration']['probe']
    if probe.get('required') and not probe.get('ok'):
        return False
    if not report['registers']['comparison']['passed']:
        return False
    return True


def build_report(repo, commit, master_seed, use_node=True):
    _sha(master_seed, 128, 'master_seed')
    commit = _sha(commit, 40, 'commit')
    source = SourceCommit(repo, commit)
    pins, texts, missing = {}, {}, []
    for path in PIN_PATHS:
        try:
            pins[path] = source.pin(path)
            texts[path] = source.read(path)['text']
        except ContractError as error:
            missing.append({'path': path, 'error': str(error)})
    if use_node:
        try:
            node = run_node_probe(source)
        except Exception as error:
            node = {'available': True, 'version': None, 'path': None,
                    'error': f'{type(error).__name__}: {error}'}
    else:
        node = {'available': False, 'reason': 'disabled'}
    subsystems = {}
    for name, analyser in ANALYSERS.items():
        try:
            subsystems[name] = analyser(texts, node)
        except Exception as error:  # fail closed, but keep the rest comparable
            subsystems[name] = {
                'ok': False, 'error': f'{type(error).__name__}: {error}',
                'checks': {}, 'metrics': {},
            }
    try:
        probe = probe_shared_anatomy(repo, commit)
    except Exception as error:
        probe = {'status': 'failed', 'required': True, 'ok': False, 'checks': {},
                 'error': f'{type(error).__name__}: {error}'}
    registers = _register_comparison(subsystems.get('style', {}), node, master_seed)
    report = {
        'version': VERSION,
        'issue': ISSUE,
        'pinned_commit': commit,
        'seed': {
            'master': master_seed,
            'contract': 'int.from_bytes(sha256(bytes.fromhex(master) + b":" + subsystem).digest()[:8], "big")',
            'derived': {name: derive_seed(master_seed, name) for name in SEED_SUBSYSTEMS},
        },
        'toolchain': {
            'python': platform.python_version(),
            'git': _git_version(repo),
            'node': {
                'available': bool(node.get('available')),
                'path': node.get('path'),
                'version': node.get('version') if node.get('available') else None,
            },
        },
        'pins': pins,
        'missing_pins': missing,
        'node': node,
        'subsystems': subsystems,
        'integration': {'probe': probe},
        'registers': registers,
        'render': {
            'needed_for_this_workstream': False,
            'reason': 'source-level integration contracts and executable registries are reproducible without a render; a pixel comparison is only needed for visual acceptance',
            'minimum_if_required': minimum_render_comparison(),
        },
        'incomplete': [],
    }
    if not report['toolchain']['node']['available']:
        report['incomplete'].append('node checks unavailable')
    if missing:
        report['incomplete'].append('missing pins')
    if probe.get('status') == 'skipped':
        report['incomplete'].append('executable probe skipped: ' + str(probe.get('reason')))
    report['passed'] = _passed(report)
    return report


def _flatten(value, prefix=''):
    result = {}
    if isinstance(value, dict):
        for key in sorted(value):
            result.update(_flatten(value[key], prefix + ('/' if prefix else '') + str(key)))
    elif isinstance(value, (bool, int, float, str)) or value is None:
        result[prefix] = value
    return result


def compare_reports(baseline, candidate):
    base_pins = baseline.get('pins') or {}
    candidate_pins = candidate.get('pins') or {}
    changed, added, removed = [], [], []
    for path in sorted(set(base_pins) | set(candidate_pins)):
        if path not in base_pins:
            added.append(path)
        elif path not in candidate_pins:
            removed.append(path)
        elif base_pins[path].get('sha256') != candidate_pins[path].get('sha256'):
            changed.append(path)
    metric_deltas = {}
    contract_deltas = {}
    for name in sorted(set(baseline.get('subsystems') or {}) | set(candidate.get('subsystems') or {})):
        before = (baseline.get('subsystems') or {}).get(name) or {}
        after = (candidate.get('subsystems') or {}).get(name) or {}
        base_metrics = _flatten(before.get('metrics') or {})
        candidate_metrics = _flatten(after.get('metrics') or {})
        for key in sorted(set(base_metrics) | set(candidate_metrics)):
            if base_metrics.get(key) != candidate_metrics.get(key):
                metric_deltas[f'{name}/{key}'] = {
                    'baseline': base_metrics.get(key),
                    'candidate': candidate_metrics.get(key),
                }
        base_checks = _flatten(before.get('checks') or {})
        candidate_checks = _flatten(after.get('checks') or {})
        for key in sorted(set(base_checks) | set(candidate_checks)):
            if base_checks.get(key) != candidate_checks.get(key):
                contract_deltas[f'{name}/{key}'] = {
                    'baseline': base_checks.get(key),
                    'candidate': candidate_checks.get(key),
                }
    return {
        'passed': bool(candidate.get('passed')),
        'review_required': bool(changed or added or removed or metric_deltas or contract_deltas),
        'changed_pins': changed,
        'added_pins': added,
        'removed_pins': removed,
        'metric_deltas': metric_deltas,
        'contract_deltas': contract_deltas,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--repo', default='.', help='git checkout to read')
    parser.add_argument('--commit', default=None, help='candidate commit (default HEAD)')
    parser.add_argument('--baseline', default=PINNED_COMMIT, help='baseline commit')
    parser.add_argument('--seed', required=True, help='128 lowercase hex master seed')
    parser.add_argument('--json', default=None, help='write the report here')
    parser.add_argument('--quiet', action='store_true')
    parser.add_argument('--no-node', action='store_true', help='skip the Node registry probes')
    args = parser.parse_args(argv)
    repo = Path(args.repo).resolve()
    commit = _resolve_commit(repo, args.commit or 'HEAD')
    baseline_commit = _resolve_commit(repo, args.baseline)
    report = build_report(repo, commit, args.seed, use_node=not args.no_node)
    baseline = build_report(repo, baseline_commit, args.seed, use_node=not args.no_node)
    report['comparison'] = compare_reports(baseline, report)
    report['baseline_commit'] = baseline['pinned_commit']
    report['report_sha256'] = _sha256(json.dumps(report, sort_keys=True).encode())
    output = json.dumps(report, indent=1, sort_keys=True)
    if args.json:
        Path(args.json).write_text(output + '\n')
    if not args.quiet:
        print(output)
    return 0 if report['passed'] and report['comparison']['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
