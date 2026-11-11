// MODELING c1: build a catalogued asset (run through videos/scripts/model_build.mjs). Builder (lib/fx/modeling/assets/<name>.js) -> manifold solids -> geometry ->
// per-vertex AO / convex edge / part id bake (lib/fx/modeling/bake.js) -> glTF Transform (weld, prune, dedup, LOD by
// meshoptimizer simplify) -> web/assets/objects/<type>/<name>.glb (+ .lod1.glb) -> catalog.json entry.
//
//   cd videos/web && node ../scripts/model_build.mjs cobot_wrist          (from anywhere: paths are absolute)
//   node ../scripts/model_build.mjs --list
//   node ../scripts/model_build.mjs sts_crane --count                     build, bake and simplify in memory; print the triangle counts; write nothing
//   node ../scripts/model_build.mjs sts_crane --gen weld                  write <name>.weld.glb / .weld.lod1.glb / .weld.<variant>.glb beside the
//                                                                         published files (left untouched), recorded under catalog gens.weld;
//                                                                         loadAsset(name, { gen: 'weld' }) loads them
//   --ao-seed index|position                                              the AO seed (bake.js aoSeed). Default: 'index' (the 29 Sep seed, one
//                                                                         LOD pass), so a plain rebuild reproduces the published files that
//                                                                         EVERY DOLLAR v3 and MECHA load; 'position' (the weld + the 40% LOD1
//                                                                         cap) is the default only under --gen. Promoting the weld onto the
//                                                                         published names is an explicit --ao-seed position, after its A/B.
//
// A builder exports { meta, build(kit, opts) } where build returns { parts: [{ name, mat, geo, maxEdge? }], anchors?: {} }.
// meta: { type, title, refs: [...], licence: { ... }, changes: [...], bake: { maxEdge, rays, maxDist } }.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, prune, dedup, simplify, flatten } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Kit } from './geo.js';
import { bakeAsset } from './bake.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../..');
const OBJ = path.join(WEB, 'assets/objects');
const name = process.argv[2];
if (!name || name === '--list') { console.log(fs.readdirSync(path.join(WEB, 'lib/fx/modeling/assets')).map(f => f.replace('.js', '')).join('\n')); process.exit(0); }
const ARGS = process.argv.slice(3), argOf = k => { const i = ARGS.indexOf('--' + k); return i >= 0 ? ARGS[i + 1] : null; };
const GEN = argOf('gen'), COUNT = ARGS.includes('--count'), AO_SEED = argOf('ao-seed') || (GEN ? 'position' : 'index');
if (GEN !== null && (!/^[a-z0-9_]+$/.test(GEN) || GEN === 'lod1' || GEN === 'far')) { console.error(`model_build: --gen wants a tag of a-z 0-9 _ (not lod1 or far), got ${GEN}`); process.exit(2); }
if (!['position', 'index'].includes(AO_SEED)) { console.error(`model_build: --ao-seed position|index, got ${AO_SEED}`); process.exit(2); }
const STEM = GEN ? `${name}.${GEN}` : name;   // file stem: the published name, or a generation beside it

function toDoc(asset, extras = {}) {
  const doc = new Document(); const buf = doc.createBuffer(); const scene = doc.createScene(name);
  doc.createExtension(KHRMeshQuantization).setRequired(true);
  const mats = new Map(); const node = doc.createNode(name); scene.addChild(node);
  const mat = key => { if (!mats.has(key)) mats.set(key, doc.createMaterial(key).setExtras({ mat: key })); return mats.get(key); };
  for (const p of asset.parts) {
    const g = p.geo, acc = (t, a) => doc.createAccessor().setType(t).setArray(a).setBuffer(buf);
    const prim = doc.createPrimitive().setMaterial(mat(p.mat)).setAttribute('POSITION', acc('VEC3', new Float32Array(g.attributes.position.array)));
    if (g.attributes.normal) { const nn = g.attributes.normal.array, q = new Int8Array(nn.length); for (let i = 0; i < nn.length; i++) q[i] = Math.round(Math.max(-1, Math.min(1, nn[i])) * 127); prim.setAttribute('NORMAL', acc('VEC3', q).setNormalized(true)); }
    if (g.attributes.uv && !p.noUV) prim.setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(g.attributes.uv.array)));
    if (g.attributes.color) { const cc = g.attributes.color.array, q = new Uint8Array(cc.length); for (let i = 0; i < cc.length; i++) q[i] = Math.round(Math.max(0, Math.min(1, cc[i])) * 255); prim.setAttribute('COLOR_0', acc('VEC3', q).setNormalized(true)); }
    const n = g.attributes.position.count; prim.setIndices(acc('SCALAR', Uint32Array.from({ length: n }, (_, i) => i)));
    const mesh = doc.createMesh(p.name).addPrimitive(prim).setExtras({ mat: p.mat, part: p.name, id: p.id });
    node.addChild(doc.createNode(p.name).setMesh(mesh).setExtras({ mat: p.mat, part: p.name, id: p.id }));
  }
  node.setExtras({ ...extras, anchors: asset.anchors || {} });
  return doc;
}

const mod = await import(path.join(WEB, 'lib/fx/modeling/assets', name + '.js'));
const meta = mod.meta;
const t0 = Date.now();
const kit = await Kit.create();
const asset = await mod.build(kit, {});
const b = meta.bake || {};
console.log(`${name}: built ${asset.parts.length} parts in ${Date.now() - t0} ms`);
const t1 = Date.now();
bakeAsset(asset, { maxEdge: b.maxEdge ?? 0.25, rays: b.rays ?? 24, maxDist: b.maxDist ?? 1.5, ao: b.ao ?? true, aoSeed: AO_SEED });
let tris = 0; for (const p of asset.parts) tris += p.geo.attributes.position.count / 3;
console.log(`${name}: baked ${tris} triangles in ${Date.now() - t1} ms`);
kit.done();

const io = new NodeIO().registerExtensions([KHRMeshQuantization]); const outDir = path.join(OBJ, meta.type); fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, STEM + '.glb');
const doc = toDoc(asset, { name, type: meta.type });
await doc.transform(weld({ tolerance: 1e-5 }), dedup(), prune({ keepAttributes: true, keepExtras: true }));
const glb0 = await io.writeBinary(doc); if (!COUNT) fs.writeFileSync(file, glb0);   // the bytes io.write(file) writes
const size = glb0.byteLength;
// LOD1: meshoptimizer simplify (ratio from meta.lod1 or 0.25, applied to every part). A LOD1 must reduce (8 Oct): at most
// 40% of LOD0's triangles (or meta.lod1, if a builder asks for more). Parts made of small separate pieces cannot reduce
// (van53's DOT tape, the crane's ladder rungs), so when they hold the asset above that cap the part ratio steps down (x0.85,
// to half of meta.lod1 at most). The cap loop runs only with the position seed; 'index' (the default without --gen) is one
// pass at meta.lod1, as the 29 Sep build.
await MeshoptSimplifier.ready;
const triOf = d => { let t = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() || 0) / 3; return t; };
const lodTarget = meta.lod1 ?? 0.25, lodCap = Math.max(lodTarget, 0.4), tri0 = triOf(await io.readBinary(glb0));
let doc1, tri1, lodRatio = lodTarget;
for (;;) {
  doc1 = await io.readBinary(glb0);
  await doc1.transform(simplify({ simplifier: MeshoptSimplifier, ratio: lodRatio, error: meta.lod1error ?? 0.03, lockBorder: false }), prune({ keepAttributes: true, keepExtras: true }));
  tri1 = triOf(doc1);
  if (AO_SEED !== 'position' || tri1 <= Math.floor(lodCap * tri0) || lodRatio <= lodTarget / 2 + 1e-9) break;
  lodRatio = Math.max(lodTarget / 2, lodRatio * 0.85);
}
const f1 = path.join(outDir, STEM + '.lod1.glb'), glb1 = await io.writeBinary(doc1); if (!COUNT) fs.writeFileSync(f1, glb1);
const verts = d => { let v = 0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) v += p.getAttribute('POSITION').getCount(); return v; };
console.log(`${name}: lod0 ${tri0} tris ${verts(doc)} verts (${(size / 1024).toFixed(0)} KB) -> lod1 ${tri1} tris ${verts(doc1)} verts (${(glb1.byteLength / 1024).toFixed(0)} KB): lod1/lod0 = ${(100 * tri1 / tri0).toFixed(1)}% (target ${lodTarget}, cap ${lodCap}, part ratio ${lodRatio.toFixed(3)}) [ao-seed ${AO_SEED}]`);

// variants (a flat far LOD, ...): same builder with options, baked with fewer rays, written beside the asset
const variantFiles = {};
for (const [vk, vopt] of Object.entries(mod.variants || {})) {
  const k2 = await Kit.create(); const a2 = await mod.build(k2, vopt);
  bakeAsset(a2, { maxEdge: (b.maxEdge ?? 0.25) * 2, rays: Math.max(6, (b.rays ?? 24) >> 1), maxDist: b.maxDist ?? 1.5, ao: b.ao ?? true, aoSeed: AO_SEED }); k2.done();
  const d2 = toDoc(a2, { name: name + '.' + vk, type: meta.type }); await d2.transform(weld({ tolerance: 1e-5 }), dedup(), prune({ keepAttributes: true, keepExtras: true }));
  const f2 = path.join(outDir, `${STEM}.${vk}.glb`), glb2 = await io.writeBinary(d2); if (!COUNT) fs.writeFileSync(f2, glb2);
  let t2 = 0; for (const m of d2.getRoot().listMeshes()) for (const p of m.listPrimitives()) t2 += (p.getIndices()?.getCount() || 0) / 3;
  variantFiles[vk] = { file: `${meta.type}/${STEM}.${vk}.glb`, triangles: t2, bytes: glb2.byteLength, options: vopt };
  console.log(`${name}.${vk}: ${t2} tris (${(glb2.byteLength / 1024).toFixed(0)} KB)`);
}
if (COUNT) { console.log(`${name}: --count, nothing written`); process.exit(0); }
// catalog
const cp = path.join(OBJ, 'catalog.json');
const cat = fs.existsSync(cp) ? JSON.parse(fs.readFileSync(cp, 'utf8')) : { note: 'MODELING studio catalogue. Every asset: sources, licence, what we changed, sizes, bakes, users. Built by videos/scripts/model_build.mjs', assets: {} };
const bakes = { vertex_color: 'COLOR_0 = (ambient occlusion, convex edge, part id / 255)', maxEdge: b.maxEdge ?? 0.25, rays: b.rays ?? 24, maxDist: b.maxDist ?? 1.5, ao_seed: AO_SEED,
  lod1: { target: lodTarget, cap: lodCap, part_ratio: +lodRatio.toFixed(4), error: meta.lod1error ?? 0.03 } };
const built = new Date().toISOString().slice(0, 10);
if (GEN) {   // a generation beside the published files: the asset's entry (and its files) stay as they are
  const e = cat.assets[name] || (cat.assets[name] = { type: meta.type, title: meta.title });
  e.gens = { ...(e.gens || {}), [GEN]: { file: `${meta.type}/${STEM}.glb`, lod1: `${meta.type}/${STEM}.lod1.glb`, triangles: tri0, triangles_lod1: tri1, bytes: size, bytes_lod1: glb1.byteLength,
    bakes, variants: variantFiles, load: `loadAsset('${meta.type}/${name}', { gen: '${GEN}', lod })`, built } };
} else {
  cat.assets[name] = {
    type: meta.type, title: meta.title, file: `${meta.type}/${name}.glb`, lod1: `${meta.type}/${name}.lod1.glb`,
    triangles: tri0, triangles_lod1: tri1, bytes: size, bytes_lod1: glb1.byteLength,
    parts: asset.parts.map(p => ({ id: p.id, name: p.name, material: p.mat })),
    references: meta.refs || [], kitbash: meta.kitbash || [], licence: meta.licence || {}, changes: meta.changes || [],
    bakes, variants: variantFiles, decals: meta.decals || [], anchors: asset.anchors || {}, used_by: meta.used_by || [], built, gens: cat.assets[name]?.gens,
  };
}
fs.writeFileSync(cp, JSON.stringify(cat, null, 1));
console.log(`${name}: ${tri0} tris (${(size / 1024).toFixed(0)} KB) -> lod1 ${tri1} tris (${(glb1.byteLength / 1024).toFixed(0)} KB) -> ${path.relative(WEB, file)}`);
