// MODELING ingest (run through videos/scripts/model_ingest.mjs): a downloaded CC0 part (Poly Haven glTF) into a small catalogued
// .glb: weld, dedup, prune, simplify to a triangle budget, textures resized to 512 px webp. Kitbash parts keep their PBR
// textures (they are photographed / painted assets), so they load with asset.js loadPart(), not the house-material path.
//   node videos/scripts/model_ingest.mjs polyhaven barrel_03 [--tris 1500] [--tex 512]
//
// GRAPHICS 4.C (8 Oct 2026; research/GRAPHICS_UPGRADE_20261008.md section 4.C). The line above is unchanged. New, opt-in:
//   model_ingest.mjs fetch polyhaven <id> [--res 2k]
//       Poly Haven's /info and /files into ~/.cache/acp_models/polyhaven/<id>/ (the glTF, its .bin and textures, md5-checked;
//       info.json keeps the API's /info: authors, dimensions in mm, lods). Refuses unless the disk keeps at least 600 MB free
//       after the fetch, and stops if it falls under 400 MB while fetching.
//   model_ingest.mjs polyhaven <id> --roles hero,mid,far [--pieces] [--res 2k] [--count] [--accept-scale] [--replace] [--kit K]
//       One file per role, under the names loadAsset/loadPart already resolve:
//         hero  parts/<id>.glb       <= 40,000 triangles, textures <= 2048 px
//         mid   parts/<id>.lod1.glb  <=  8,000 triangles, textures <= 1024 px
//         far   parts/<id>.far.glb   <=  1,500 triangles, textures <=  512 px
//       Where Poly Haven ships its own LODs (nodes named *_LOD0.._LODn), hero takes LOD0, mid LOD1, far the last.
//       Normal maps add no loss: the source's own image when it fits the role (a 2k source for hero), else resized and
//       encoded webp lossless (--normals near: webp near-lossless, smaller); base colour and ORM as webp q90.
//       --pieces skips flatten() and join(): the source's top-level nodes stay named parts (loadPart(...).part(name)).
//       The scale check refuses when the glTF's bounding box differs from /info's dimensions (mm, Z-up: x, y, z ->
//       glTF x, z, y) by more than 2% on any axis; with --pieces the whole layout is checked. --accept-scale "<why>" (a kit
//       member's accept_scale) overrides it, recorded in the catalogue: for a rigged part posed differently, not a wrong scale.
//       --count builds every role in memory and prints triangles, bytes, textures and the checks; nothing is written.
//       Refuses to overwrite a published single-file part (barrel_03 ...) unless --replace.
//       Catalogue: part_<id> with one entry per role (file, triangles, bytes, texture px, CC0, authors, source URLs).
//   model_ingest.mjs kit <name> [--fetch] [--prune] [--count] [--again]
//       assets/objects/parts/kits.json: each member in turn (one at a time). --fetch fetches a member that is not cached (and
//       stops at the first disk refusal). A member is ingested only when its "markings" is "clear" or "covered: ...": every
//       member is checked for real-world markings (brands, logos, maker plates, legible text) under the invented-owners rule
//       before it is ingested. --prune deletes a member's cached textures once it is ingested.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, dedup, prune, simplify, textureCompress, flatten, join, getBounds, compactPrimitive, listTextureSlots } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// ================================================================ GRAPHICS 4.C: fetch, roles, kits
export const ROLES = {
  hero: { suffix: '', tris: 40000, px: 2048 },
  mid: { suffix: '.lod1', tris: 8000, px: 1024 },
  far: { suffix: '.far', tris: 1500, px: 512 },
};
const MiB = 1024 * 1024, FETCH_KEEP_FREE = 600 * MiB, FETCH_STOP_FREE = 400 * MiB;
const UA = 'acp-agitprop-model-ingest/1 (studio asset pipeline)';
const PARTS = path.join(WEB, 'assets/objects/parts'), CATALOG = path.join(WEB, 'assets/objects/catalog.json'), KITS = path.join(PARTS, 'kits.json');
const today = () => new Date().toISOString().slice(0, 10);
const tris = d => { let t = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3; return t; };
class Refusal extends Error { constructor(msg, code = 3) { super(msg); this.code = code; } }

function parseOpts(args) {
  const val = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
  return {
    roles: (val('roles') || 'hero,mid,far').split(',').map(s => s.trim()).filter(Boolean), res: val('res') || '2k', kit: val('kit'),
    pieces: args.includes('--pieces'), count: args.includes('--count'), acceptScale: args.includes('--accept-scale') ? (/^--/.test(val('accept-scale') || '--') ? 'accepted by hand' : val('accept-scale')) : null, replace: args.includes('--replace'),
    fetch: args.includes('--fetch'), prune: args.includes('--prune'), again: args.includes('--again'), normals: val('normals') || 'lossless', cache: val('cache') || path.join(os.homedir(), '.cache/acp_models'),
  };
}

async function cli(args) {
  try {
    if (args[0] === 'fetch') await fetchModel(args[1], args[2], parseOpts(args.slice(3)));
    else if (args[0] === 'kit') await ingestKit(args[1], parseOpts(args.slice(2)));
    else await ingestRoles(args[0], args[1], parseOpts(args.slice(2)));
  } catch (e) {
    if (e instanceof Refusal) { console.error('model_ingest: REFUSED: ' + e.message); process.exitCode = e.code; } else throw e;
  }
}

// ---------------------------------------------------------------- fetch (Poly Haven API)
function freeBytes(p) { while (!fs.existsSync(p)) p = path.dirname(p); const s = fs.statfsSync(p); return s.bavail * s.bsize; }
function curlJSON(url) { return JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '2', '--max-time', '60', '-A', UA, url], { maxBuffer: 64 * MiB }).toString()); }
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

export async function fetchModel(srcName, id, o) {
  if (srcName !== 'polyhaven') throw new Refusal(`fetch knows polyhaven only, not ${srcName}`, 2);
  if (!/^[a-z0-9_]+$/.test(id || '')) throw new Refusal(`bad id ${id}`, 2);
  const dir = path.join(o.cache, 'polyhaven', id);
  const api = curlJSON('https://api.polyhaven.com/info/' + id), files = curlJSON('https://api.polyhaven.com/files/' + id);
  if (api.type !== 2) throw new Refusal(`${id} is not a model on Poly Haven (type ${api.type})`, 2);
  const g = files.gltf?.[o.res]?.gltf;
  if (!g) throw new Refusal(`${id}: no glTF at ${o.res} (has ${Object.keys(files.gltf || {}).join(', ')})`, 2);
  const list = [[path.basename(new URL(g.url).pathname), g], ...Object.entries(g.include || {})];
  const have = ([rel, f]) => { const p = path.join(dir, rel); return fs.existsSync(p) && fs.statSync(p).size === f.size && (!f.md5 || md5(p) === f.md5); };
  const todo = list.filter(x => !have(x)), need = todo.reduce((s, [, f]) => s + (f.size || 0), 0), free = freeBytes(dir);
  console.log(`${id}: ${o.res} glTF, ${list.length} files, ${(need / MiB).toFixed(1)} MB to fetch; ${(free / MiB).toFixed(0)} MB free`);
  if (free - need < FETCH_KEEP_FREE) throw new Refusal(`${id}: the fetch would leave ${((free - need) / MiB).toFixed(0)} MB free (needs >= ${FETCH_KEEP_FREE / MiB} MB after it); not fetched`, 4);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, f] of todo) {
    if (freeBytes(dir) < FETCH_STOP_FREE) throw new Refusal(`${id}: free space fell under ${FETCH_STOP_FREE / MiB} MB; stopped before ${rel}`, 4);
    const p = path.join(dir, rel), tmp = p + '.part'; fs.mkdirSync(path.dirname(p), { recursive: true });
    try { execFileSync('curl', ['-sSfL', '--retry', '2', '--max-time', '900', '-A', UA, '-o', tmp, f.url]); }
    catch (e) { fs.rmSync(tmp, { force: true }); throw new Refusal(`${id}: fetching ${rel} failed (${e.message.split('\n')[0]})`, 5); }
    if (f.md5 && md5(tmp) !== f.md5) { fs.rmSync(tmp, { force: true }); throw new Refusal(`${id}: ${rel} md5 mismatch`, 5); }
    fs.renameSync(tmp, p); console.log(`  ${rel} ${(f.size / MiB).toFixed(1)} MB`);
  }
  const info = {
    name: id, title: api.name, authors: api.authors, categories: api.categories, tags: api.tags, polycount: api.polycount, lods: api.lods ?? null,
    dimensions: api.dimensions, dimensions_note: 'mm, Z-up (x, y, z); glTF is Y-up metres: x, z, y',
    license: 'CC0', source: 'https://polyhaven.com/a/' + id, files_url: g.url, res: o.res,
    bytes: list.reduce((s, [, f]) => s + (f.size || 0), 0), files_hash: api.files_hash, fetched: today(), api,
  };
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 1));
  console.log(`${id}: fetched to ${dir} (${(freeBytes(dir) / MiB).toFixed(0)} MB free)`);
  return info;
}

// ---------------------------------------------------------------- roles
function sourceGLTF(dir, id, res) {
  for (const r of [res, '2k', '1k', '4k']) { const p = path.join(dir, `${id}_${r}.gltf`); if (fs.existsSync(p)) return [p, r]; }
  throw new Refusal(`${id}: no cached glTF in ${dir} (model_ingest.mjs fetch polyhaven ${id} --res ${res})`, 2);
}
// the scene's named parts: its root nodes, or the children of a lone empty root (the usual Blender export)
function topNodes(doc) {
  const sc = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0]; let nodes = sc.listChildren();
  if (nodes.length === 1 && !nodes[0].getMesh() && nodes[0].listChildren().length > 1) nodes = nodes[0].listChildren();
  return nodes;
}
export function scaleCheck(doc, info) {
  const dims = info.dimensions || info.api?.dimensions;
  const sc = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0], { min, max } = getBounds(sc);
  const glb = [0, 1, 2].map(k => max[k] - min[k]);
  if (!dims) return { ok: false, glb, why: 'info.json has no dimensions (fetch writes them from /info)' };
  const want = [dims[0] / 1000, dims[2] / 1000, dims[1] / 1000], err = glb.map((v, k) => Math.abs(v - want[k]) / want[k]);
  return { ok: Math.max(...err) <= 0.02, glb, want, err, worst: Math.max(...err) };
}
// Poly Haven LODs: nodes named *_LOD<n>; keep one level, drop the rest
function keepLod(doc, role) {
  const nodes = doc.getRoot().listNodes(), lv = n => +(/_LOD(\d+)$/i.exec(n.getName() || '')?.[1] ?? -1), levels = [...new Set(nodes.map(lv).filter(x => x >= 0))].sort((a, b) => a - b);
  if (levels.length < 2) return null;
  const want = role === 'hero' ? levels[0] : role === 'mid' ? levels[Math.min(1, levels.length - 1)] : levels[levels.length - 1];
  for (const n of nodes) { const l = lv(n); if (l >= 0 && l !== want) n.dispose(); }
  return want;
}

export async function ingestRoles(srcName, id, o) {
  const dir = path.join(o.cache, srcName, id), info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8'));
  const [gltf, res] = sourceGLTF(dir, id, o.res), io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.WARN));
  const bad = o.roles.filter(r => !ROLES[r]); if (bad.length) throw new Refusal(`unknown role ${bad.join(', ')} (hero, mid, far)`, 2);
  const cat0 = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : { assets: {} }, prev = cat0.assets['part_' + id];
  if (!o.count && !o.replace && fs.existsSync(path.join(PARTS, id + '.glb')) && !prev?.roles)
    throw new Refusal(`parts/${id}.glb is a published single-file part (scenes load it); --replace to overwrite it with the roles`, 2);
  await MeshoptSimplifier.ready;
  const source = await io.read(gltf), sourceTris = tris(source);
  const scale = scaleCheck(source, info), fmt = a => a ? a.map(v => v.toFixed(3)).join(' x ') : '-';
  console.log(`${id}: source ${path.basename(gltf)} ${sourceTris} tris; bbox ${fmt(scale.glb)} m, /info ${fmt(scale.want)} m: ${scale.ok ? 'ok' : 'MISMATCH'} (worst ${scale.worst != null ? (100 * scale.worst).toFixed(2) + '%' : scale.why})`);
  if (!scale.ok && !o.acceptScale) throw new Refusal(`${id}: scale check failed (${scale.why || 'over 2% on an axis'}); --accept-scale "<why>" to ingest anyway (recorded; in a kit, the member's accept_scale)`, 3);
  const pieces = o.pieces ? topNodes(source).map(n => n.getName()) : null;
  if (pieces) console.log(`  pieces (${pieces.length}): ${pieces.join(', ')}`);
  const out = {};
  for (const role of o.roles) {
    const R = ROLES[role], doc = await io.read(gltf), lod = info.lods ? keepLod(doc, role) : null, covered = await applyCover(doc, o.cover);
    if (!o.pieces) await doc.transform(flatten(), join());
    await doc.transform(weld(), dedup());
    let glb = await io.writeBinary(doc), t = tris(doc), error = 0, method = null;
    const welded = t, src = glb;
    if (t > R.tris) for (error = 0.002, method = 'meshopt'; ; error *= 2) {       // simplify to the budget; widen the error bound until it fits
      const d = await io.readBinary(src); await d.transform(simplify({ simplifier: MeshoptSimplifier, ratio: R.tris / welded, error }));
      t = tris(d); if (t <= R.tris || error >= 1) { glb = await io.writeBinary(d); break; }
    }
    // still over (UV and normal seams, many small pieces): meshoptimizer's Permissive + Prune flags, then sloppy, per primitive
    for (const how of ['permissive', 'sloppy']) {
      if (t <= R.tris) break;
      const d = await io.readBinary(src); simplifyHard(d, R.tris / welded, how); t = tris(d); glb = await io.writeBinary(d); method = how;
    }
    const d = await io.readBinary(glb);
    // normal maps lose nothing more: kept as the source's own bytes when they fit the role, else resized and webp lossless
    const normalsResize = d.getRoot().listTextures().some(x => listTextureSlots(x).includes('normalTexture') && Math.max(...(x.getSize() || [0, 0])) > R.px);
    await d.transform(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [R.px, R.px], quality: 90, slots: /^(?!normalTexture$)/ }),
      ...(normalsResize ? [textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [R.px, R.px], ...(o.normals === 'near' ? { nearLossless: true, quality: 60 } : { lossless: true }), slots: /^normalTexture$/ })] : []),
      prune());
    const bytes = await io.writeBinary(d), texPx = Math.max(0, ...d.getRoot().listTextures().map(x => Math.max(...(x.getSize() || [0, 0])))), tri = tris(d);
    const file = `parts/${id}${R.suffix}.glb`, budget = tri <= R.tris && texPx <= R.px;
    console.log(`  ${role.padEnd(4)} ${file}: ${tri} tris (budget ${R.tris}${method ? `, ${method}${method === 'meshopt' ? ' error ' + error : ''}` : ''}), textures ${texPx} px (budget ${R.px}), ${(bytes.byteLength / MiB).toFixed(2)} MB${lod != null ? `, Poly Haven LOD${lod}` : ''}: ${budget ? 'ok' : 'OVER BUDGET'}`);
    if (!budget && !o.count) throw new Refusal(`${id} ${role}: over its budget`, 3);
    if (!o.count) fs.writeFileSync(path.join(PARTS, `${id}${R.suffix}.glb`), bytes);
    out[role] = {
      file, triangles: tri, bytes: bytes.byteLength, texture_px: texPx, simplify: method, simplify_error: error || null, polyhaven_lod: lod,
      licence: 'CC0-1.0', authors: info.authors, sources: [info.source, info.files_url].filter(Boolean),
    };
  }
  if (o.count) { console.log(`${id}: --count, nothing written`); return out; }
  const cat = fs.existsSync(CATALOG) ? JSON.parse(fs.readFileSync(CATALOG, 'utf8')) : { assets: {} };   // read again just before the write
  const hero = out.hero || prev?.roles?.hero;
  cat.assets['part_' + id] = {
    type: 'parts', title: info.title, file: `parts/${id}.glb`, triangles: hero?.triangles ?? null, triangles_source: sourceTris, bytes: hero?.bytes ?? null,
    kitbash: true, kit: o.kit || prev?.kit || null, roles: { ...(prev?.roles || {}), ...out }, pieces,
    references: [{ what: `${info.title} (Poly Haven)`, url: info.source, authors: info.authors }],
    licence: { spdx: 'CC0-1.0', holder: Object.keys(info.authors || {}).join(', '), note: 'Poly Haven models are CC0; credit not required, recorded anyway', source_files: info.files_url },
    scale_check: { glb_m: scale.glb, info_m: scale.want || null, worst: scale.worst ?? null, ok: scale.ok, accepted: !scale.ok ? o.acceptScale : null },
    changes: [`source ${path.basename(gltf)} (${res})`, ...(o.cover?.length ? [`invented-owners rule: blurred ${o.cover.length} region(s) of the base colour (${o.cover.map(c => c.what || c.rect.join(' ')).join('; ')})`] : []), o.pieces ? 'pieces: top-level nodes kept as named parts (no flatten or join)' : 'flatten and join meshes',
      'weld, dedup; per role: simplify to its triangle budget, textures resized to its size (base colour and ORM webp q90, normal map webp lossless)'],
    materials: 'original PBR textures (loadPart), not the house palette', load: `loadPart('${id}', { lod: 0 | 1 | 'far' | 'auto', camera, lit })`,
    used_by: prev?.used_by || [], built: today(),
  };
  fs.writeFileSync(CATALOG, JSON.stringify(cat, null, 1));
  console.log(`${id}: catalogued as part_${id} (${Object.keys(out).join(', ')})`);
  return out;
}

// invented-owners rule: blur regions of the base colour that carry a maker's plate, a logo or legible text (a kit member's
// "cover": [{ what, rect: [u0, v0, u1, v1] as fractions of the image from its top left, texture?: a substring of its name }])
export async function applyCover(doc, cover) {
  let n = 0; if (!cover?.length) return n;
  for (const t of doc.getRoot().listTextures()) {
    if (!listTextureSlots(t).includes('baseColorTexture')) continue;
    const img = t.getImage(), meta = await sharp(img).metadata(), W = meta.width, H = meta.height, comps = [];
    for (const c of cover) {
      if (c.texture && !`${t.getURI()} ${t.getName()}`.includes(c.texture)) continue;
      const [u0, v0, u1, v1] = c.rect, left = Math.max(0, Math.floor(u0 * W)), top = Math.max(0, Math.floor(v0 * H));
      const width = Math.min(W - left, Math.ceil((u1 - u0) * W)), height = Math.min(H - top, Math.ceil((v1 - v0) * H));
      comps.push({ input: await sharp(img).extract({ left, top, width, height }).blur(Math.max(4, Math.min(width, height) * 0.12)).png().toBuffer(), left, top });
    }
    if (!comps.length) continue;
    const jpg = meta.format === 'jpeg', outImg = await sharp(img).composite(comps)[jpg ? 'jpeg' : 'png'](jpg ? { quality: 95 } : {}).toBuffer();
    t.setImage(new Uint8Array(outImg)); n += comps.length;
  }
  return n;
}

// the last resorts for a role's budget: meshoptimizer with collapses across attribute seams allowed and small disconnected
// pieces dropped ('permissive'), or the topology-free sloppy simplifier ('sloppy'); one ratio for every primitive
function simplifyHard(doc, ratio, how) {
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION'); if (!idx || p.getMode() !== 4) continue;
    const P = Float32Array.from({ length: pos.getCount() * 3 }, (_, i) => pos.getElement(Math.floor(i / 3), [0, 0, 0])[i % 3]), I = Uint32Array.from(idx.getArray());
    const target = Math.max(3, Math.floor(I.length * ratio / 3) * 3);
    const [res] = how === 'sloppy' ? MeshoptSimplifier.simplifySloppy(I, P, 3, null, target, 1) : MeshoptSimplifier.simplify(I, P, 3, target, 1, ['Permissive', 'Prune']);
    idx.setArray(idx.getArray().constructor.from(res)); compactPrimitive(p);
  }
}

// ---------------------------------------------------------------- kits
export async function ingestKit(kitName, o) {
  const kits = JSON.parse(fs.readFileSync(KITS, 'utf8')), kit = kits.kits?.[kitName];
  if (!kit) throw new Refusal(`no kit ${kitName} in ${path.relative(WEB, KITS)} (have ${Object.keys(kits.kits || {}).join(', ')})`, 2);
  const res = kit.res || '2k', save = () => fs.writeFileSync(KITS, JSON.stringify(kits, null, 1) + '\n');
  for (const m of kit.members) {
    const dir = path.join(o.cache, kit.source || 'polyhaven', m.id), cached = fs.existsSync(path.join(dir, 'info.json')) && fs.existsSync(path.join(dir, `${m.id}_${res}.gltf`)) && fs.existsSync(path.join(dir, 'textures'));
    if (/^refused/.test(m.markings || '')) { console.log(`${m.id}: refused (${m.markings}); skipped`); continue; }
    if (/^ingested/.test(m.status || '') && !o.again) { console.log(`${m.id}: ${m.status} (--again to redo it)`); continue; }
    if (!cached) {
      if (!o.fetch) { console.log(`${m.id}: not fetched (model_ingest.mjs fetch polyhaven ${m.id} --res ${res}, or kit ${kitName} --fetch)`); continue; }
      try { await fetchModel(kit.source || 'polyhaven', m.id, { ...o, res }); m.status = `fetched ${today()}`; if (!o.count) save(); }
      catch (e) { if (e instanceof Refusal && e.code === 4) { console.log(e.message); console.log(`kit ${kitName}: stopped at ${m.id} for disk; the rest wait`); return; } throw e; }
    }
    if (!/^(clear|covered)/.test(m.markings || '')) {
      console.log(`${m.id}: markings "${m.markings || 'unchecked'}": look at ${path.join(dir, 'textures')} and ${m.page || 'https://polyhaven.com/a/' + m.id} for brands, logos, maker plates or legible text; set its "markings" in kits.json to clear | covered: <how> | refused: <why>`);
      continue;
    }
    await ingestRoles(kit.source || 'polyhaven', m.id, { ...o, res, pieces: !!m.pieces, kit: kitName, roles: o.roles, acceptScale: o.acceptScale || m.accept_scale || null, cover: m.cover || null });
    if (!o.count) { m.status = `ingested ${today()}`; save(); }
    if (o.prune && !o.count) { fs.rmSync(path.join(dir, 'textures'), { recursive: true, force: true }); console.log(`${m.id}: cached textures pruned`); }
  }
}

// ================================================================ dispatch: the 4.C commands, else the original single-part ingest (unchanged)
const ARGV = process.argv.slice(2);
if (ARGV[0] === 'fetch' || ARGV[0] === 'kit' || ARGV.includes('--roles')) { await cli(ARGV); process.exit(process.exitCode || 0); }
const [src, name, ...rest] = ARGV;
const opt = k => { const i = rest.indexOf('--' + k); return i >= 0 ? Number(rest[i + 1]) : null; };
const dir = path.join(os.homedir(), '.cache/acp_models', src, name), info = JSON.parse(fs.readFileSync(path.join(dir, 'info.json'), 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(path.join(dir, name + '_1k.gltf'));
const triOf = d => { let t = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() || p.getAttribute('POSITION').getCount()) / 3; return t; };
const before = triOf(doc);
await MeshoptSimplifier.ready;
await doc.transform(flatten(), join(), weld(), dedup());
const budget = opt('tris') || 3000;
const now = triOf(doc);
if (now > budget) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: budget / now, error: 0.01 }));
await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [opt('tex') || 512, opt('tex') || 512], quality: 82 }), prune());
const out = path.join(WEB, 'assets/objects/parts', name + '.glb'); fs.mkdirSync(path.dirname(out), { recursive: true });
await io.write(out, doc);
const after = triOf(doc), bytes = fs.statSync(out).size;
const cp = path.join(WEB, 'assets/objects/catalog.json'), cat = fs.existsSync(cp) ? JSON.parse(fs.readFileSync(cp, 'utf8')) : { assets: {} };
cat.assets['part_' + name] = {
  type: 'parts', title: info.title, file: `parts/${name}.glb`, triangles: after, triangles_source: before, bytes,
  kitbash: true, references: [{ what: `${info.title} (Poly Haven)`, url: info.source, authors: info.authors }],
  licence: { spdx: 'CC0-1.0', holder: Object.keys(info.authors || {}).join(', '), note: 'Poly Haven models are CC0; credit not required, recorded anyway', source_files: info.files_url },
  changes: [`flatten and join meshes, weld, dedup, simplify ${before} -> ${after} triangles`, 'textures resized to 512 px webp'],
  materials: 'original PBR textures (loadPart), not the house palette', used_by: [], built: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(cp, JSON.stringify(cat, null, 1));
console.log(`${name}: ${before} -> ${after} tris, ${(bytes / 1024).toFixed(0)} KB -> assets/objects/parts/${name}.glb`);
