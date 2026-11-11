import assert from 'node:assert/strict';
import { test as nodeTest } from 'node:test';
import { encodePreparedPayload, decodePreparedPayload } from '../native/prepared-container.mjs';
import { PREPARED_SCHEMA, FRAMES, C2B_COLUMN_MAJOR, ATTRIBUTES, indexWidth, indexArray, sourceIndexWidth, jointTable,
  adaptMaterial, adaptMaterialRecord, adaptMesh, adaptChannels, exportPrepared, packPrepared, applyMatrix4, assertLittleEndian,
  captureAttribute, captureGeometry, captureJoints, capturePerson, adaptHairSim, inventoryPerson, extractPerson, groupRelativeMatrix, multiplyMatrices, adaptIdentity, preparationKey,
  validatePrepared, canonical, digest, PreparedError } from '../native/prepared.mjs';

const H64 = 'a'.repeat(64);
const COMMIT = 'd'.repeat(40);
// Full builder-record fixtures (material-shader contract): uniform helpers,
// exact per-kind sets, and a verifiable (composed:false) shader pin whose
// digest is recomputed here, the same rule the validator enforces.
const ULEN = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };
const U = (type, count = 1) => ({ type, ...(count === 1 ? {} : { count }), value: new Array(ULEN[type] * count).fill(0) });
const skinUniforms = () => ({
  likeAxes0: U('vec4'), likeAxes1: U('vec4'), likeBase: U('vec3'), likeNose: U('vec3'), likeSheen: U('vec3'),
  likeK0: U('vec4'), likeK1: U('vec4'), likeK2: U('vec4'), likeK3: U('vec4'), likeScale: U('f32'), likeOn: U('f32'),
  uPBand: U('vec2'), likeS6: U('vec4'), hEyeL: U('vec3'), hEyeR: U('vec3'),
});
const fabricUniforms = () => ({
  fW0: U('vec4'), fW1: U('vec4'), fW2: U('vec4'), fPh: U('vec4'), fRgh: U('vec4'), fShn: U('vec4'),
  fWr: U('vec4'), fWr2: U('vec4'), fIn: U('vec4'), fSeam: U('vec4'), fRad: U('vec4'), cA: U('vec4'),
  fFlu: U('vec3'), fEx: U('vec3'), fCore: U('vec3'), fLin: U('vec3'), fWeft: U('vec3'), fLen: U('vec2'),
  fLimbO: U('vec3', 4), fLimbD: U('vec3', 4), fLimbE: U('vec3', 4),
  cOpen: U('f32'), cSeed: U('f32'), cWear: U('f32'), cDirt: U('f32'), cSweat: U('f32'), cWet: U('f32'),
});
const eyeUniforms = () => ({
  eCam0: U('vec3'), eCam1: U('vec3'), eGeo0: U('vec4'), eGeo1: U('vec4'), eBase: U('vec3'), eFibre: U('vec3'),
  eCenter: U('vec3'), eLimbus: U('vec3'), eK: U('vec4'), eK2: U('vec4'), eCatch: U('vec4'),
});
const hairUniforms = () => ({
  hSig: U('vec3'), hSigG: U('vec3'), hTc: U('vec3'), hTcG: U('vec3'), hSpec: U('vec4'), hMisc: U('vec4'),
  hSub: U('vec4'), hLook: U('vec4'), hGrey: U('f32'), hExp: U('vec2'),
});
const shaderPin = (key, defines = []) => {
  const sources = [{ name: `${key}:pars`, sha256: H64 }, { name: `${key}:frag`, sha256: H64 }];
  const chain = [`${key}:pars`, `${key}:frag`];
  return { key, glslSha256: digest(canonical({ sources, chain })), defines, sources, chain, composed: false };
};
const tex = slot => ({ slot, sha256: H64, colorSpace: 'linear' });
const IDENT = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const identity = () => ({ sourceCommit: COMMIT, runtime: { three: '0.170.0', node: '24.0.0' }, inputsSha256: H64, closureSha256: 'b'.repeat(64) });
const f32 = (...v) => new Float32Array(v);
const buf = (type, itemSize, typed) => ({ type, itemSize, length: typed.length, typed });

function personInput() {
  const names = ['root', 'head'];
  return {
    name: 'synthetic',
    joints: { names, parents: [-1, 0], bindHeads: f32(0, 1, 0, 0, 1.6, 0),
      bindLocal: f32(0, 1, 0, 0, 0.6, 0), bindLocalSource: 'bindPos', groupScale: 1.0,
      inverseBinds: new Float32Array(32).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0)) },
    landmarks: { jawY: 1.5, eyeLY: 1.62, eyeRY: 1.62 },
    exprIndex: { smile: 0 },
    meshes: [{
      name: 'body', kind: 'body', vertexCount: 4, indexWidth: 16,
      matrix: IDENT, bindMatrix: IDENT, bindMatrixInverse: IDENT,
      attributes: {
        position: buf('Float32Array', 3, f32(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0)),
        normal: buf('Float32Array', 3, f32(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1)),
        uv: buf('Float32Array', 2, f32(0, 0, 1, 0, 1, 1, 0, 1)),
        skinIndex: buf('Uint16Array', 4, new Uint16Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])),
        skinWeight: buf('Float32Array', 4, f32(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)),
        aHero: buf('Float32Array', 4, new Float32Array(16)),
        aLikeA: buf('Float32Array', 4, new Float32Array(16)),
        aLikeB: buf('Float32Array', 4, new Float32Array(16)),
        aLikeC: buf('Float32Array', 4, new Float32Array(16)),
        aRest: buf('Float32Array', 3, new Float32Array(12)),
        index: buf('Uint16Array', 1, new Uint16Array([0, 1, 2, 0, 2, 3])),
      },
      morphs: [{ name: 'smile', relative: true, delta: buf('Float32Array', 3, new Float32Array(12)) }],
      material: { kind: 'skin-physical', params: { color: '#b07a58' },
        textures: [tex('likeLUT'), tex('likeSSS')],
        uniforms: skinUniforms(),
        shader: shaderPin('hero-skin') },
    }, {
      name: 'shirt', kind: 'garment', vertexCount: 3, indexWidth: 32,
      matrix: IDENT,
      attributes: {
        position: buf('Float32Array', 3, f32(0, 0.5, 0, 1, 0.5, 0, 0.5, 1.2, 0)),
        normal: buf('Float32Array', 3, f32(0, 0, 1, 0, 0, 1, 0, 0, 1)),
        uv: buf('Float32Array', 2, f32(0, 0, 1, 0, 0.5, 1)),
        aHero: buf('Float32Array', 4, new Float32Array(12)),
        index: buf('Uint32Array', 1, new Uint32Array([0, 1, 2])),
      },
      material: { kind: 'fabric', params: { color: '#5a7394' }, textures: [],
        uniforms: fabricUniforms(),
        shader: shaderPin('k3-fabric', ['FAB_UVQ']) },
    }],
    channels: {
      cloth: [{ part: 'shirt', offsets: buf('Int8Array', 3, new Int8Array([1, 0, -1, 0, 2, 0])), quantum: 0.001, active: [0, 2], k3: { name: 'shirt', group: 'garment' } }],
      hair: [{ part: 'scalp', points: buf('Float32Array', 3, f32(0, 1.7, 0, 0, 1.6, 0.01)), half: buf('Float32Array', 1, f32(0.01, 0.008)),
        melanin: { eu: 1.8, ph: 0.04 }, grey: 0 }],
      eyes: { headJoint: 'head', globes: [{ side: 'L', center: buf('Float32Array', 3, f32(0.03, 1.62, 0.05)), radius: 0.012 }] },
      face: ['smile', 'blink'],
    },
  };
}

const sceneInput = () => ({ nodes: [{ name: 'person0', person: 'synthetic' }],
  cameras: { full: { fovY: 20, W: 880, H: 1350, lens: { focal: 50 }, matrix: new Float32Array(16).map((_, i) => (i % 5 === 0 ? 1 : 0)) } },
  lights: { key: { kind: 'sun' } } });

await nodeTest('import rejects corrupted channel bindings and reference metadata before packing', () => {
  const cases = [
    m => { m.persons[0].channels.cloth[0].active = [0, 3]; },
    m => { m.persons[0].channels.cloth[0].active = [0, 0]; },
    m => { m.persons[0].channels.cloth[0].active = [0, 1, 2]; },
    m => { m.persons[0].channels.cloth[0].mesh = 'missing'; },
    m => { m.persons[0].channels.cloth[0].offsets.type = 'Uint8Array'; },
    m => { m.persons[0].channels.hair[0].half.length = 1; },
    m => { m.persons[0].channels.hair[0].points.itemSize = 1; },
    m => { m.persons[0].channels.hair[0].melanin = {}; },
    m => { m.persons[0].joints.bindLocal.frame = 'unknown'; },
    m => { m.persons[0].meshes[0].morphs[0].delta.length = 3; },
    m => { m.persons[0].meshes[0].attributes.normal.normalized = 'yes'; },
    m => { m.persons[0].meshes[1].name = 'body'; },
    m => { m.scene.cameras.full.matrix.key = 'missing'; },
  ];
  for (const mutate of cases) {
    const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
    validatePrepared(manifest, buffers);
    mutate(manifest);
    assert.throws(() => validatePrepared(manifest, buffers), PreparedError, String(mutate));
    assert.throws(() => packPrepared(manifest, buffers), PreparedError, String(mutate));
  }
});

function unpack(packed, files) {
  const out = {};
  for (const [key, f] of Object.entries(files)) {
    const Ctor = { Float32Array, Uint16Array, Uint32Array, Int8Array, Uint8Array }[f.type];
    out[key] = new Ctor(packed.bin.buffer, packed.bin.byteOffset + f.offset, f.count);
  }
  return out;
}

await nodeTest('serialized prepared payload binds exact bytes and rejects malformed ranges', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  const encoded = encodePreparedPayload(manifest, buffers);
  const document = JSON.parse(encoded.json);
  const decoded = decodePreparedPayload(document, encoded.bin);
  for (const [key, arr] of Object.entries(buffers)) assert.deepEqual(decoded[key], arr);
  for (const extra of [new Float64Array([1]), new Uint8Array(0)]) {
    assert.throws(() => encodePreparedPayload(manifest, { ...buffers, extra }), /supported typed array/);
    assert.throws(() => packPrepared(manifest, { ...buffers, extra }), /supported typed array/);
  }
  encoded.bin.fill(255);
  assert.deepEqual(decoded['p0.bindHeads'], buffers['p0.bindHeads'], 'import owns its validated bytes');
  assert.throws(() => decodePreparedPayload(document, encoded.bin), /digest mismatch/);
  for (const mutate of [
    d => { d.payload.path = '../prepared.bin'; },
    d => { d.payload.bytes++; },
    d => { Object.values(d.files)[0].type = 'Float64Array'; },
    d => { Object.values(d.files)[0].offset = 1; },
    d => { Object.values(d.files)[1].offset = 0; },
    d => { Object.values(d.files)[0].count++; },
    d => { Object.values(d.files)[0].bytes = Number.MAX_SAFE_INTEGER; },
    d => { delete d.files[Object.keys(d.files).at(-1)]; },
  ]) {
    const e = encodePreparedPayload(manifest, buffers);
    mutate(e.document);
    assert.throws(() => decodePreparedPayload(e.document, e.bin), PreparedError, String(mutate));
  }
});

await nodeTest('index width is the narrowest fit and overflow fails', () => {
  assert.equal(indexWidth(0), 16);
  assert.equal(indexWidth(65535), 16);
  assert.equal(indexWidth(65536), 32);
  const { array, width } = indexArray([0, 65535], 65536);
  assert.equal(width, 32);
  assert.ok(array instanceof Uint32Array);
  assert.throws(() => indexArray([0, 4], 4), PreparedError);
  assert.throws(() => indexArray([0, -1], 4), PreparedError);
});

await nodeTest('joint table rejects duplicates and parent mismatch', () => {
  const t = jointTable(['a', 'b'], [-1, 0], new Float32Array(6), new Float32Array(32));
  assert.deepEqual(t.indexOf, { a: 0, b: 1 });
  assert.throws(() => jointTable(['a', 'a'], [-1, 0], new Float32Array(6), new Float32Array(32)), PreparedError);
  assert.throws(() => jointTable(['a'], [-1, 0], new Float32Array(3), new Float32Array(16)), PreparedError);
  assert.throws(() => jointTable(['a'], [5], new Float32Array(3), new Float32Array(16)), PreparedError);
});

await nodeTest('material adapter never accepts live objects or silent GLSL', () => {
  assert.throws(() => adaptMaterial({ isMeshPhysicalMaterial: true }), PreparedError);
  assert.throws(() => adaptMaterial({ kind: 'custom-shader', params: {}, shader: { key: 'x', glslSha256: H64, defines: [] } }), PreparedError);
  assert.throws(() => adaptMaterial({ kind: 'fabric', params: {}, shader: { key: 'k3-fabric', defines: [] } }), PreparedError);
  assert.throws(() => adaptMaterial({ kind: 'fabric', params: {}, textures: [{ slot: 'map', sha256: H64 }], shader: { key: 'k3-fabric', glslSha256: H64, defines: [] } }), PreparedError);
  const ok = adaptMaterial({ kind: 'fabric', params: { color: '#fff' }, textures: [],
    shader: { key: 'k3-fabric', glslSha256: H64, defines: ['FAB_UVQ'] } });
  assert.equal(ok.kind, 'fabric');
});

await nodeTest('material records carry the exact builder set or fail', () => {
  const skin = () => personInput().meshes[0].material;
  const skinAttrs = () => Object.keys(personInput().meshes[0].attributes);
  // Positive: exact skin record validates standalone and at export/import.
  adaptMaterialRecord(skin(), skinAttrs());
  // Missing / extra / mistyped uniforms fail.
  const noS6 = skin(); delete noS6.uniforms.likeS6;
  assert.throws(() => adaptMaterialRecord(noS6, skinAttrs()), PreparedError);
  const extra = skin(); extra.uniforms.bogus = U('f32');
  assert.throws(() => adaptMaterialRecord(extra, skinAttrs()), PreparedError);
  const mistyped = skin(); mistyped.uniforms.likeK0 = U('vec3');
  assert.throws(() => adaptMaterialRecord(mistyped, skinAttrs()), PreparedError);
  const badCount = skin(); badCount.uniforms.likeBase = { type: 'vec3', count: 2, value: [0, 0, 0, 0, 0, 0] };
  assert.throws(() => adaptMaterialRecord(badCount, skinAttrs()), PreparedError);
  const nan = skin(); nan.uniforms.likeOn = { type: 'f32', value: [NaN] };
  assert.throws(() => adaptMaterialRecord(nan, skinAttrs()), PreparedError);
  // Texture slots are exact: skin without likeSSS, fabric with any texture.
  const noTex = skin(); noTex.textures = [tex('likeLUT')];
  assert.throws(() => adaptMaterialRecord(noTex, skinAttrs()), PreparedError);
  const fabricAttrs = () => Object.keys(personInput().meshes[1].attributes);
  const fabricWithTex = personInput().meshes[1].material;
  fabricWithTex.textures = [tex('map')];
  assert.throws(() => adaptMaterialRecord(fabricWithTex, fabricAttrs()), PreparedError);
  // Shader provenance: sources/chain/composed required; uncomposed digest
  // is recomputed, composed digests are builder-attested.
  const noSources = skin(); delete noSources.shader.sources;
  assert.throws(() => adaptMaterialRecord(noSources, skinAttrs()), PreparedError);
  const badDigest = skin(); badDigest.shader.glslSha256 = H64;
  assert.throws(() => adaptMaterialRecord(badDigest, skinAttrs()), PreparedError);
  const composed = skin();
  composed.shader = { key: 'hero-skin', glslSha256: H64, defines: [], sources: [{ name: 'page', sha256: H64 }], chain: ['onBeforeCompile'], composed: true };
  adaptMaterialRecord(composed, skinAttrs());
  // Unsupported features surface as defines or params keys: never downgrade.
  const plaid = personInput().meshes[1].material;
  plaid.params = { color: '#5a7394', plaid: true };
  assert.throws(() => adaptMaterialRecord(plaid, fabricAttrs()), PreparedError);
  const sheen = personInput().meshes[1].material;
  sheen.shader = { ...sheen.shader, defines: ['FAB_UVQ', 'SHEEN'] };
  assert.throws(() => adaptMaterialRecord(sheen, fabricAttrs()), PreparedError);
  const lips = skin(); lips.params = { sssPass: 1 };
  assert.throws(() => adaptMaterialRecord(lips, skinAttrs()), PreparedError);
  // Material-driven attributes: skin without aLikeA fails at export;
  // gated attributes follow their feature flags.
  const noLike = personInput(); delete noLike.meshes[0].attributes.aLikeA;
  assert.throws(() => exportPrepared({ persons: [noLike], identity: identity() }), PreparedError);
  const cover = personInput();
  cover.meshes[0].material.shader = { ...cover.meshes[0].material.shader, defines: ['SKIN_COVER'] };
  assert.throws(() => exportPrepared({ persons: [cover], identity: identity() }), PreparedError);
  cover.meshes[0].attributes.aCover = buf('Float32Array', 1, new Float32Array(4));
  exportPrepared({ persons: [cover], identity: identity() });
  const rest = personInput();
  rest.meshes[1].material.shader = { ...rest.meshes[1].material.shader, defines: ['FAB_UVQ', 'CLOTH_REST'] };
  assert.throws(() => exportPrepared({ persons: [rest], identity: identity() }), PreparedError);
  rest.meshes[1].attributes.aRest = buf('Float32Array', 3, new Float32Array(9));
  exportPrepared({ persons: [rest], identity: identity() });
  const sewn = personInput();
  sewn.meshes[1].material.params = { color: '#5a7394', seamD: true };
  assert.throws(() => exportPrepared({ persons: [sewn], identity: identity() }), PreparedError);
  sewn.meshes[1].attributes.aSeamD = buf('Float32Array', 1, new Float32Array(3));
  exportPrepared({ persons: [sewn], identity: identity() });
  const open = personInput();
  open.meshes[1].material.params = { color: '#5a7394', openD: true };
  assert.throws(() => exportPrepared({ persons: [open], identity: identity() }), PreparedError);
  // Import side enforces the same record: corrupted uniforms fail validate.
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  validatePrepared(manifest, buffers);
  const badImport = JSON.parse(JSON.stringify(manifest));
  delete badImport.persons[0].meshes[0].material.uniforms.likeS6;
  assert.throws(() => validatePrepared(badImport, buffers), PreparedError);
  // Eye and hair-card records validate standalone with their exact sets.
  const eyeMat = { kind: 'eye', params: {}, textures: [], uniforms: eyeUniforms(), shader: shaderPin('eye') };
  adaptMaterialRecord(eyeMat, ['position', 'normal', 'uv', 'aEyeL', 'index']);
  assert.throws(() => adaptMaterialRecord(eyeMat, ['position', 'normal', 'uv', 'index']), PreparedError);
  const hairMat = { kind: 'hair-card', params: {}, textures: [tex('hAtlas'), tex('hFlow'), tex('hNrm')],
    uniforms: hairUniforms(), shader: shaderPin('hair') };
  adaptMaterialRecord(hairMat, ['position', 'aHair', 'aHairD', 'aHairT', 'index']);
  const noHairD = { ...hairMat };
  assert.throws(() => adaptMaterialRecord(noHairD, ['position', 'aHair', 'aHairT', 'index']), PreparedError);
  // 'physical' stays the unmapped legacy hatch: shape-checked, no sets.
  adaptMaterialRecord({ kind: 'physical', params: {}, textures: [],
    shader: { key: 'fixture', glslSha256: H64, defines: [] } }, ['position', 'index']);
});

await nodeTest('skin option amounts scan extractor-side; rev-8 eye attr rejected', () => {
  const skin = () => personInput().meshes[0].material;
  const skinAttrs = () => Object.keys(personInput().meshes[0].attributes);
  const withAmount = (name, idx, v) => {
    const m = skin();
    m.uniforms[name] = { ...m.uniforms[name], value: m.uniforms[name].value.map((x, i) => (i === idx ? v : x)) };
    return m;
  };
  // Every mapped unsupported option amount fails (freckles/moles/relief,
  // lines/beard, veins/lips/nails).
  for (const [name, idx, feature] of [
    ['likeK1', 0, 'freckles'], ['likeK1', 1, 'moles'], ['likeK1', 3, 'pores.relief'],
    ['likeK2', 0, 'linesByAge'], ['likeK2', 2, 'beardShadow'],
    ['likeK3', 0, 'veins'], ['likeK3', 1, 'lips'], ['likeK3', 2, 'nails'],
  ]) {
    assert.throws(() => adaptMaterialRecord(withAmount(name, idx, 0.5), skinAttrs()), PreparedError, feature);
  }
  // Supported amounts stay green: tan/homog/health/weather, pores amount,
  // oil, and the builder-owned poreDark likeS6.w.
  const supported = skin();
  supported.uniforms.likeK0.value[0] = 0.5;
  supported.uniforms.likeK1.value[2] = 0.5;
  supported.uniforms.likeK2.value[1] = 0.5;
  supported.uniforms.likeS6.value[3] = 0.35;
  adaptMaterialRecord(supported, skinAttrs());
  const p = personInput();
  p.meshes[0].material = supported;
  exportPrepared({ persons: [p], identity: identity() });
  // skinCover (unimplemented skin-cull effect) fails as flag or key.
  const covered = skin(); covered.params = { skinCover: true };
  assert.throws(() => adaptMaterialRecord(covered, skinAttrs()), PreparedError);
  const coveredDef = skin();
  coveredDef.shader = { ...coveredDef.shader, defines: ['SKINCOVER'] };
  assert.throws(() => adaptMaterialRecord(coveredDef, skinAttrs()), PreparedError);
  // rev-8 aEye7L fails at capture: map to aEyeL upstream, never silently.
  assert.throws(() => captureGeometry({
    attributes: {
      position: { array: new Float32Array(12), itemSize: 3, count: 4 },
      aEye7L: { array: new Float32Array(16), itemSize: 4, count: 4 },
    },
    index: { array: new Uint16Array([0, 1, 2, 0, 2, 3]) },
  }, 'eye8'), /aEye7L/);
});

await nodeTest('mesh adapter rejects unregistered attributes and wrong index width', () => {
  const base = personInput().meshes[0];
  assert.throws(() => adaptMesh({ ...base, attributes: { ...base.attributes, aCustom: buf('Float32Array', 1, f32(1)) } }), PreparedError);
  assert.throws(() => adaptMesh({ ...base, morphs: [{ name: 'smile', relative: false, delta: buf('Float32Array', 3, new Float32Array(12)) }] }), PreparedError);
});

await nodeTest('source index width is preserved, never narrowed', () => {
  assert.equal(sourceIndexWidth(3, 32), 32);
  assert.equal(sourceIndexWidth(4, 16), 16);
  assert.throws(() => sourceIndexWidth(4, 8), PreparedError);
  assert.throws(() => sourceIndexWidth(70000, 16), PreparedError);
  const base = personInput().meshes[0];
  adaptMesh({ ...base, indexWidth: 32, attributes: { ...base.attributes, index: buf('Uint32Array', 1, new Uint32Array([0, 1, 2, 0, 2, 3])) } });
  assert.throws(() => adaptMesh({ ...base, indexWidth: 32 }), PreparedError);
  assert.throws(() => adaptMesh({ ...base, indexWidth: 16, vertexCount: 70000 }), PreparedError);
});

await nodeTest('mesh adapter rejects missing position/index and count mismatches', () => {
  const base = personInput().meshes[0];
  const noPos = { ...base, attributes: { ...base.attributes } };
  delete noPos.attributes.position;
  assert.throws(() => adaptMesh(noPos), PreparedError);
  const noIdx = { ...base, attributes: { ...base.attributes } };
  delete noIdx.attributes.index;
  assert.throws(() => adaptMesh(noIdx), PreparedError);
  assert.throws(() => adaptMesh({ ...base, vertexCount: 5 }), PreparedError);
  assert.throws(() => adaptMesh({ ...base, attributes: { ...base.attributes, index: buf('Uint16Array', 1, new Uint16Array([0, 1, 9])) } }), PreparedError);
  assert.throws(() => adaptMesh({ ...base, attributes: { ...base.attributes, index: buf('Uint16Array', 1, new Uint16Array([0, 1])) } }), PreparedError);
  assert.throws(() => adaptMesh({ ...base, kind: 'mystery' }), PreparedError);
});

await nodeTest('C2B maps (x,y,z)->(x,-z,y) and host is little-endian', () => {
  assert.deepEqual(applyMatrix4(C2B_COLUMN_MAJOR, 1, 2, 3), [1, -3, 2]);
  assertLittleEndian();
});

await nodeTest('joint cycles are rejected', () => {
  assert.throws(() => jointTable(['a', 'b'], [1, 0], new Float32Array(6), new Float32Array(32)), PreparedError);
  jointTable(['root', 'spine', 'head'], [-1, 0, 1], new Float32Array(9), new Float32Array(48));
});

await nodeTest('export/pack/unpack roundtrip preserves every byte', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  assert.equal(manifest.schema, PREPARED_SCHEMA);
  const packed = packPrepared(manifest, buffers);
  assert.equal(packed.bin.length % 16, 0);
  const back = unpack(packed, packed.files);
  for (const [key, arr] of Object.entries(buffers)) {
    assert.deepEqual(back[key], arr, `buffer ${key} roundtrips`);
  }
  validatePrepared({ ...manifest, files: packed.files }, back);
  const d1 = digest(manifest);
  const reordered = JSON.parse(JSON.stringify(manifest));
  validatePrepared({ ...reordered, files: packed.files }, back);
  assert.equal(digest(reordered), d1);
  assert.match(d1, /^[a-f0-9]{64}$/);
});

await nodeTest('validation fails closed on schema, buffers and identity', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  assert.throws(() => validatePrepared({ ...manifest, schema: 'acp.other/v9' }, buffers), PreparedError);
  const missing = { ...buffers };
  delete missing['p0.bindHeads'];
  assert.throws(() => validatePrepared(manifest, missing), PreparedError);
  const swapped = { ...buffers, 'p0.bindHeads': buffers['p0.inverseBinds'] };
  assert.throws(() => validatePrepared(manifest, swapped), PreparedError);
  assert.throws(() => validatePrepared({ ...manifest, identity: { ...manifest.identity, sourceCommit: 'short' } }, buffers), PreparedError);
});

await nodeTest('canonical form rejects closures and non-finite values', () => {
  assert.throws(() => canonical({ f() {} }), PreparedError);
  assert.throws(() => canonical({ x: NaN }), PreparedError);
  assert.throws(() => canonical({ x: undefined }), PreparedError);
  assert.equal(canonical({ b: 1, a: [1, 2] }), canonical({ a: [1, 2], b: 1 }));
  assert.ok(ATTRIBUTES.position && ATTRIBUTES.aHero && ATTRIBUTES.aHair && ATTRIBUTES.clothOffset);
});

await nodeTest('every position/normal buffer carries an explicit frame tag', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  assert.equal(manifest.persons[0].meshes[0].attributes.position.frame, FRAMES.BIND);
  assert.equal(manifest.persons[0].joints.bindHeads.frame, FRAMES.BIND);
  validatePrepared(manifest, buffers);
  const stripped = JSON.parse(JSON.stringify(manifest));
  delete stripped.persons[0].meshes[0].attributes.position.frame;
  assert.throws(() => validatePrepared(stripped, buffers), PreparedError);
});

await nodeTest('channels require explicit relative data, never absolute replay', () => {
  assert.throws(() => adaptChannels({ cloth: [], hair: [], face: [] }), PreparedError);
  assert.throws(() => adaptChannels({ cloth: [{ part: 'shirt', quantum: 0, active: [] }], hair: [], face: ['smile'] }), PreparedError);
  adaptChannels(personInput().channels);
});

await nodeTest('cloth quantization matches the MOT4 encoder exactly', () => {
  const good = () => ({ part: 'shirt', offsets: { type: 'Int8Array', itemSize: 3, typed: new Int8Array(6) }, quantum: 0.001, active: [0, 2] });
  const base = { cloth: [good()], hair: [], eyes: null, face: ['smile'] };
  adaptChannels(base);
  assert.throws(() => adaptChannels({ ...base, cloth: [{ ...good(), quantum: 0.0001 }] }), PreparedError);
  assert.throws(() => adaptChannels({ ...base, cloth: [{ ...good(), active: [0, 70000] }] }), PreparedError);
  assert.throws(() => adaptChannels({ ...base, cloth: [{ ...good(), active: [] }] }), PreparedError);
});

await nodeTest('validation enforces morph, eye and material refs', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  const badMorph = JSON.parse(JSON.stringify(manifest));
  badMorph.persons[0].meshes[0].morphs[0].relative = false;
  assert.throws(() => validatePrepared(badMorph, buffers), PreparedError);
  const noMat = JSON.parse(JSON.stringify(manifest));
  noMat.persons[0].meshes[0].material.shader.glslSha256 = 'short';
  assert.throws(() => validatePrepared(noMat, buffers), PreparedError);
  const badEye = JSON.parse(JSON.stringify(manifest));
  badEye.persons[0].channels.eyes.headJoint = 'tail';
  assert.throws(() => validatePrepared(badEye, buffers), PreparedError);
  const missing = { ...buffers };
  delete missing[manifest.persons[0].channels.eyes.globes[0].center.key];
  assert.throws(() => validatePrepared(manifest, missing), PreparedError);
});

await nodeTest('cloth parts must bind to an exported mesh', () => {
  const p = personInput();
  p.channels.cloth[0].part = 'ghost-garment';
  assert.throws(() => exportPrepared({ persons: [p], identity: identity() }), PreparedError);
});

function fakeLive() {
  const attr = (array, itemSize, count) => ({ array, itemSize, count });
  const bodyGeo = {
    attributes: {
      position: attr(new Float32Array(12), 3, 4),
      normal: attr(new Float32Array(12), 3, 4),
      uv: attr(new Float32Array(8), 2, 4),
      skinIndex: attr(new Uint16Array(16), 4, 4),
      skinWeight: attr(new Float32Array(16), 4, 4),
      aHero: attr(new Float32Array(16), 4, 4),
      aLikeA: attr(new Float32Array(16), 4, 4),
      aLikeB: attr(new Float32Array(16), 4, 4),
      aLikeC: attr(new Float32Array(16), 4, 4),
      aRest: attr(new Float32Array(12), 3, 4),
    },
    index: { array: new Uint32Array([0, 1, 2, 0, 2, 3]) },
  };
  const shirtGeo = {
    attributes: {
      position: attr(new Float32Array(9), 3, 3),
      normal: attr(new Float32Array(9), 3, 3),
      uv: attr(new Float32Array(6), 2, 3),
      aHero: attr(new Float32Array(12), 4, 3),
    },
    index: { array: new Uint32Array([0, 1, 2]) },
  };
  const I16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const body = { isMesh: true, name: 'body', userData: {}, geometry: bodyGeo, visible: true, parent: null,
    matrix: { elements: I16 }, bindMatrix: { elements: I16 }, bindMatrixInverse: { elements: I16 } };
  const shirt = { isMesh: true, name: '', userData: { k3: { name: 'shirt', group: 'garment' } }, geometry: shirtGeo, visible: true, parent: null,
    matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.3, 0.5, 0, 1] } };
  const mid = { isMesh: false, name: 'mid', userData: {}, visible: true, parent: null,
    matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1] } };
  const hidden = { isMesh: true, name: 'debug', userData: {}, geometry: shirtGeo, visible: false, parent: null };
  const P = {
    info: { name: 'fake' },
    parts: [shirt],
    h: {
      names: ['root', 'head'], rig: { parent: [-1, 0] },
      head0: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1.6, z: 0 }],
      bindPos: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0.6, z: 0 }],
      scale: 1.0,
      group: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 }, traverse: fn => [body, hidden].forEach(fn) },
      eyeL: { y: 1.62 }, eyeR: { y: 1.62 }, mouth: { y: 1.5 },
      skeleton: { boneInverses: [[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], { elements: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }] },
      aHero: new Float32Array(16),
      body,
    },
  };
  body.parent = P.h.group;
  shirt.parent = P.h.group;
  P.mid = mid;
  return P;
}

await nodeTest('live capture reads THREE-shaped objects without three.js', () => {
  const P = fakeLive();
  assert.throws(() => captureAttribute({ array: new DataView(new ArrayBuffer(4)) }, 'x'), PreparedError);
  assert.throws(() => captureGeometry({ attributes: {} }, 'x'), PreparedError);
  assert.throws(() => captureGeometry({ attributes: { position: { array: new Float32Array(3), itemSize: 3, count: 1 } }, index: { array: new Float32Array([0]) } }, 'x'), PreparedError);
  assert.throws(() => captureJoints({}), PreparedError);
  assert.throws(() => captureJoints({ names: ['a', 'b'], rig: { parent: [1, 0] }, bindHeads: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], skeleton: { boneInverses: [new Float32Array(16), new Float32Array(16)] } }), PreparedError);
  const fullList = [
    { key: 'body', kind: 'body', geo: P.h.body.geometry, mesh: P.h.body, material: personInput().meshes[0].material },
    { key: 'shirt', kind: 'garment', geo: P.parts[0].geometry, mesh: P.parts[0], material: personInput().meshes[1].material },
  ];
  const out = capturePerson(P, { meshList: fullList, channels: { cloth: [], hair: [], face: ['smile'] } });
  assert.equal(out.meshes[0].indexWidth, 32);
  assert.ok(out.meshes[0].attributes.aHero);
  assert.ok(Math.abs(out.joints.bindLocal[4] - 0.6) < 1e-6);
  assert.equal(out.joints.bindLocalSource, 'bindPos');
  assert.equal(out.joints.groupScale, 1.0);
  assert.deepEqual(out.placement, { position: [0, 0, 0], rotationY: 0 });
  assert.deepEqual(out.landmarks, { eyeLY: 1.62, eyeRY: 1.62, jawY: 1.5 });
  assert.throws(() => capturePerson({}, {}), PreparedError);
  assert.throws(() => capturePerson(P, { channels: { cloth: [], hair: [], face: ['x'] } }), PreparedError);
  assert.throws(() => capturePerson(P, { meshList: [{ key: 'body', kind: 'body', geo: P.h.body.geometry, material: personInput().meshes[0].material }] }), PreparedError);
  assert.throws(() => capturePerson(P, { meshList: [{ key: 'body', kind: 'body', geo: P.h.body.geometry, mesh: P.h.body, material: personInput().meshes[0].material }], channels: { cloth: [], hair: [], face: ['smile'] } }), PreparedError);
  assert.throws(() => capturePerson(P, { meshList: [{ key: 'ghost', kind: 'other' }], channels: { cloth: [], hair: [], face: ['x'] } }), PreparedError);
  assert.throws(() => adaptHairSim({ strands: [] }), PreparedError);
  assert.throws(() => adaptHairSim(undefined), PreparedError);
});

await nodeTest('nested parent transforms bake group-relative; outsiders rejected', () => {
  const P = fakeLive();
  const group = P.h.group;
  const mid = P.mid;
  mid.parent = group;
  const nested = { isMesh: true, name: '', userData: { k3: { name: 'skirt', group: 'garment' } }, geometry: P.parts[0].geometry, visible: true, parent: mid,
    matrix: { elements: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0.3, 0.5, 0, 1] } };
  const baked = groupRelativeMatrix(nested, group, 'nested');
  const hit = applyMatrix4(baked, 1, 0, 0);
  assert.ok(Math.abs(hit[0] - 0.3) < 1e-6 && hit[1] === 1.5 && hit[2] === -1);
  const broken = { isMesh: true, name: 'broken', userData: {}, parent: { name: 'nolink', parent: null } };
  assert.throws(() => groupRelativeMatrix(broken, group, 'broken'), PreparedError);
  const outside = { isMesh: true, name: 'outside', userData: {}, parent: null, matrix: { elements: [...IDENT] } };
  assert.throws(() => groupRelativeMatrix(outside, group, 'outside'), PreparedError);
  const nomat = { isMesh: true, name: 'nomat', userData: {}, parent: group };
  assert.throws(() => groupRelativeMatrix(nomat, group, 'nomat'), PreparedError);
});

await nodeTest('chain products stay f64 with one final cast; cycles rejected', () => {
  const T = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const R = t => { const c = Math.cos(t), s = Math.sin(t); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; };
  // Precision: the product container must be f64 (an f32 pass is untestable
  // after the fact, so its absence is asserted structurally), and one
  // element is checked against hand-expanded f64 arithmetic at 1e-9 — an
  // f32-rounded factor would err ~1e-6 at these magnitudes.
  const C = multiplyMatrices(R(0.37), T(123.456, -78.9, 0.135));
  assert.ok(Array.isArray(C) && !(C instanceof Float32Array));
  const c = Math.cos(0.37), s = Math.sin(0.37);
  assert.ok(Math.abs(C[12] - (c * 123.456 + s * 0.135)) < 1e-9);
  assert.ok(Math.abs(C[14] - (-s * 123.456 + c * 0.135)) < 1e-9);
  // Composition across 3+ ancestors: baked single matrix matches sequential
  // application within the one designed final-cast rounding (~1e-4 at these
  // magnitudes); wrong order would miss by O(100).
  const group = { name: 'g' };
  const a3 = { name: 'a3', parent: group, matrix: { elements: T(123.456, -78.9, 0.135) } };
  const a2 = { name: 'a2', parent: a3, matrix: { elements: R(0.37) } };
  const a1 = { name: 'a1', parent: a2, matrix: { elements: T(-45.25, 900.125, 3.75) } };
  const leaf = { name: 'leaf', parent: a1, matrix: { elements: R(-1.13) } };
  const baked = groupRelativeMatrix(leaf, group, 'leaf');
  assert.ok(baked instanceof Float32Array);
  const [px, py, pz] = [7.25, -3.5, 11.75];
  const single = applyMatrix4([...baked], px, py, pz);
  let v = [px, py, pz];
  for (const m of [R(-1.13), T(-45.25, 900.125, 3.75), R(0.37), T(123.456, -78.9, 0.135)]) v = applyMatrix4(m, ...v);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(single[i] - v[i]) < 1e-4, `component ${i}: ${single[i]} vs ${v[i]}`);
  const ca = { name: 'ca', parent: null };
  const cb = { name: 'cb', parent: ca };
  ca.parent = cb;
  assert.throws(() => groupRelativeMatrix({ name: 'c', parent: ca }, group, 'cyc'), PreparedError);
});

await nodeTest('invisible meshes are excluded explicitly, never silently', () => {
  const P = fakeLive();
  const fullList = [
    { key: 'body', kind: 'body', geo: P.h.body.geometry, mesh: P.h.body, material: personInput().meshes[0].material },
    { key: 'shirt', kind: 'garment', geo: P.parts[0].geometry, mesh: P.parts[0], material: personInput().meshes[1].material },
  ];
  const got = capturePerson(P, { meshList: fullList, channels: { cloth: [], hair: [], face: ['smile'] } });
  assert.deepEqual(got.excluded, [{ key: 'debug', kind: 'other' }]);
  assert.throws(() => capturePerson(P, { meshList: fullList, channels: { cloth: [], hair: [], face: ['smile'] }, requireAllVisible: true }), PreparedError);
  const { manifest, buffers } = exportPrepared({ persons: [{ ...personInput(), excluded: got.excluded }], identity: identity() });
  assert.deepEqual(manifest.persons[0].excluded, [{ key: 'debug', kind: 'other' }]);
  validatePrepared(manifest, buffers);
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.persons[0].excluded = [{ key: 'body', kind: 'body' }];
  assert.throws(() => validatePrepared(bad, buffers), PreparedError);
});

await nodeTest('inventory enumerates source-owned meshes; capture proves coverage', () => {
  const P = fakeLive();
  const inv = inventoryPerson(P);
  assert.deepEqual(inv.map(e => e.key).sort(), ['body', 'debug', 'shirt']);
  assert.equal(inv.find(e => e.key === 'shirt').kind, 'garment');
  assert.equal(inv.find(e => e.key === 'debug').visible, false);
  assert.throws(() => inventoryPerson({}), PreparedError);
  assert.throws(() => inventoryPerson({ h: {} }), PreparedError);
  const cycA = { isMesh: true, name: 'cycA', userData: {}, geometry: P.h.body.geometry, visible: true, parent: null };
  const cycB = { isMesh: true, name: 'cycB', userData: {}, geometry: P.h.body.geometry, visible: true, parent: cycA };
  cycA.parent = cycB;
  const Pcyc = { h: { ...P.h, group: { traverse: fn => fn(cycA) } } };
  assert.throws(() => inventoryPerson(Pcyc), PreparedError);
});

await nodeTest('duplicate excluded keys rejected at export and import', () => {
  const p = { ...personInput(), excluded: [{ key: 'debug', kind: 'other' }, { key: 'debug', kind: 'other' }] };
  assert.throws(() => exportPrepared({ persons: [p], identity: identity() }), PreparedError);
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], identity: identity() });
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.persons[0].excluded = [{ key: 'x', kind: 'other' }, { key: 'x', kind: 'garment' }];
  assert.throws(() => validatePrepared(bad, buffers), PreparedError);
});

await nodeTest('extractPerson derives the full inventory with no caller mesh list', () => {
  const P = fakeLive();
  const byKey = { body: personInput().meshes[0].material, shirt: personInput().meshes[1].material };
  const got = extractPerson(P, {
    materialFor: e => byKey[e.key] ?? null,
    channels: { cloth: [], hair: [], eyes: null, face: ['smile'] },
  });
  assert.deepEqual(got.meshes.map(m => m.name).sort(), ['body', 'shirt']);
  assert.equal(got.joints.bindLocalSource, 'bindPos');
  const { manifest, buffers } = exportPrepared({ persons: [got], identity: identity() });
  validatePrepared(manifest, buffers);
  assert.throws(() => extractPerson(P, { channels: { cloth: [], hair: [], eyes: null, face: ['s'] } }), PreparedError);
  assert.throws(() => extractPerson(P, {
    materialFor: e => byKey[e.key] ?? null,
    channels: { cloth: [], hair: [], eyes: null, face: ['smile'] },
    requireAllVisible: true,
  }), PreparedError);
  assert.throws(() => extractPerson(P, {
    materialFor: e => (e.key === 'shirt' ? null : byKey[e.key]),
    channels: { cloth: [], hair: [], eyes: null, face: ['s'] },
  }), PreparedError);
});

await nodeTest('shared geometry needs per-mesh entries; transforms captured, instancing rejected', () => {
  const P = fakeLive();
  const twin = { isMesh: true, name: 'twin', userData: {}, geometry: P.h.body.geometry, visible: true, parent: P.h.group,
    matrix: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] }, bindMatrix: { elements: IDENT }, bindMatrixInverse: { elements: IDENT } };
  const origTraverse = P.h.group.traverse;
  P.h.group.traverse = fn => { origTraverse(fn); fn(twin); };
  const mat = personInput().meshes[0].material;
  const oneEntry = [{ key: 'body', kind: 'body', geo: P.h.body.geometry, mesh: P.h.body, material: mat }];
  assert.throws(() => capturePerson(P, { meshList: oneEntry, channels: { cloth: [], hair: [], face: ['s'] } }), PreparedError);
  const both = [...oneEntry, { key: 'twin', kind: 'other', geo: twin.geometry, mesh: twin, material: mat }];
  const ch = { cloth: [], hair: [], face: ['smile'], eyes: null };
  const got = capturePerson(P, { meshList: [...both, { key: 'shirt', kind: 'garment', geo: P.parts[0].geometry, mesh: P.parts[0], material: personInput().meshes[1].material }], channels: ch });
  assert.deepEqual([...got.meshes.find(m => m.name === 'twin').matrix.slice(12, 15)], [2, 0, 0]);
  const inst = { isMesh: true, isInstancedMesh: true, name: 'inst', userData: {}, geometry: P.h.body.geometry, visible: true, parent: P.h.group, matrix: { elements: [...IDENT] } };
  P.h.group.traverse = fn => { origTraverse(fn); fn(inst); };
  assert.throws(() => capturePerson(P, { meshList: both, channels: ch }), PreparedError);
  assert.throws(() => captureGeometry({ attributes: { position: { array: new Float32Array(12), itemSize: 3, count: 4 } }, index: { array: new Uint16Array([0, 1, 2, 0, 2, 3]) }, drawRange: { start: 0, count: 3 } }, 'd'), PreparedError);
  assert.throws(() => captureGeometry({ attributes: { position: { array: new Float32Array(12), itemSize: 3, count: 4 } }, index: { array: new Uint16Array([0, 1, 2, 0, 2, 3]) }, groups: [{ start: 0, count: 3, materialIndex: 0 }] }, 'g'), PreparedError);
  const noBind = { key: 'nude', kind: 'body', geo: P.h.body.geometry, mesh: { ...P.h.body, bindMatrix: undefined, bindMatrixInverse: undefined }, material: mat };
  assert.throws(() => capturePerson(P, { meshList: [noBind], channels: ch }), PreparedError);
});

await nodeTest('live capture rejects unrepresentable bind, scale and rotation', () => {
  const P = fakeLive();
  const hNoBind = { ...P.h };
  delete hNoBind.bindPos;
  assert.throws(() => captureJoints(hNoBind), PreparedError);
  const proven = captureJoints({ ...hNoBind, skeleton: { ...hNoBind.skeleton, bones: [{ position: { x: 0, y: 1, z: 0 } }, { position: { x: 0, y: 0.6, z: 0 } }] } }, { proveLiveBind: true });
  assert.equal(proven.bindLocalSource, 'liveBones');
  assert.throws(() => captureJoints({ ...P.h, scale: 2, group: { ...P.h.group, scale: { x: 1, y: 1, z: 1 } } }), PreparedError);
  assert.throws(() => captureJoints({ ...P.h, group: { ...P.h.group, scale: { x: 1, y: 2, z: 1 } } }), PreparedError);
  assert.throws(() => capturePerson(P, { meshList: [{ key: 'body', kind: 'body', geo: P.h.body.geometry, mesh: P.h.body, material: personInput().meshes[0].material }], channels: { cloth: [], hair: [], face: ['x'] }, placement: { position: [0, 0, 0], rotation: { x: 0.5, y: 0, z: 0 } } }), PreparedError);
  assert.throws(() => captureGeometry({ attributes: { position: { array: new Float32Array(12), itemSize: 3, count: 4 } }, index: { array: new Uint16Array([0, 1, 2, 0, 2, 3]) }, morphAttributes: { normal: [{ array: new Float32Array(12) }] } }, 'm'), PreparedError);
  assert.throws(() => adaptChannels({ hair: [], eyes: null, face: ['x'] }), PreparedError);
  assert.throws(() => adaptChannels({ cloth: [], hair: [], face: ['x'] }), PreparedError);
  assert.throws(() => adaptChannels({ cloth: [], hair: [], eyes: {}, face: [] }), PreparedError);
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  assert.equal(manifest.persons[0].joints.bindLocalSource, 'bindPos');
  const stripped = JSON.parse(JSON.stringify(manifest));
  delete stripped.persons[0].joints.bindLocalSource;
  assert.throws(() => validatePrepared(stripped, buffers), PreparedError);
});

await nodeTest('joints require bindLocal and groupScale; hair requires landmarks', () => {
  const badJoints = personInput();
  delete badJoints.joints.bindLocal;
  assert.throws(() => exportPrepared({ persons: [badJoints], identity: identity() }), PreparedError);
  const noLm = personInput();
  delete noLm.landmarks;
  assert.throws(() => exportPrepared({ persons: [noLm], identity: identity() }), PreparedError);
  const badExpr = personInput();
  badExpr.exprIndex = { grin: 0 };
  assert.throws(() => exportPrepared({ persons: [badExpr], identity: identity() }), PreparedError);
  const badActive = personInput();
  badActive.channels.cloth[0].active = [0, 99];
  assert.throws(() => exportPrepared({ persons: [badActive], identity: identity() }), PreparedError);
  const badK3 = personInput();
  badK3.channels.cloth[0].k3 = { name: 'shirt' };
  assert.throws(() => exportPrepared({ persons: [badK3], identity: identity() }), PreparedError);
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  assert.equal(manifest.persons[0].joints.groupScale, 1.0);
  assert.deepEqual(manifest.persons[0].landmarks, { jawY: 1.5, eyeLY: 1.62, eyeRY: 1.62 });
  assert.deepEqual(manifest.persons[0].exprIndex, { smile: 0 });
  assert.deepEqual(manifest.persons[0].channels.cloth[0].k3, { name: 'shirt', group: 'garment' });
  validatePrepared(manifest, buffers);
});

await nodeTest('capture preserves morphs, normalized flags and hold6', () => {
  const geo = {
    attributes: { position: { array: new Float32Array(12), itemSize: 3, count: 4, normalized: false } },
    index: { array: new Uint16Array([0, 1, 2, 0, 2, 3]) },
    morphAttributes: { position: [{ array: new Float32Array(12) }] },
    morphTargetsRelative: true,
    userData: { morphNames: ['smile'], hold6: new Uint8Array([0, 1, 0, 0]) },
  };
  const cap = captureGeometry(geo, 'hairy');
  assert.equal(cap.morphs[0].name, 'smile');
  assert.equal(cap.attributes.hold6.typed[1], 1);
  const noNames = { ...geo, userData: {} };
  assert.throws(() => captureGeometry(noNames, 'hairy'), PreparedError);
  const absolute = { ...geo, morphTargetsRelative: false, userData: { morphNames: ['smile'] } };
  assert.throws(() => captureGeometry(absolute, 'hairy'), PreparedError);
  const badHold = { ...geo, userData: { morphNames: ['smile'], hold6: new Uint8Array([1]) } };
  assert.throws(() => captureGeometry(badHold, 'hairy'), PreparedError);
});

await nodeTest('NaN/Infinity inside float buffers fails closed', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  const nan = { ...buffers, 'p0.m0.position': new Float32Array(buffers['p0.m0.position']) };
  nan['p0.m0.position'][0] = NaN;
  assert.throws(() => validatePrepared(manifest, nan), PreparedError);
  const inf = { ...buffers, 'p0.bindHeads': new Float32Array(buffers['p0.bindHeads']) };
  inf['p0.bindHeads'][1] = Infinity;
  assert.throws(() => validatePrepared(manifest, inf), PreparedError);
  const base = personInput().meshes[0];
  const bad = { ...base.attributes.position, typed: new Float32Array(base.attributes.position.typed) };
  bad.typed[2] = NaN;
  assert.throws(() => adaptMesh({ ...base, attributes: { ...base.attributes, position: bad } }), PreparedError);
});

await nodeTest('runtimeSha256 is explicit preparer hash, never computed here', () => {
  const withHash = { ...identity(), runtimeSha256: 'c'.repeat(64) };
  assert.equal(adaptIdentity(withHash).runtimeSha256, 'c'.repeat(64));
  assert.throws(() => adaptIdentity({ ...identity(), runtimeSha256: 'short' }), PreparedError);
  assert.throws(() => adaptIdentity({ ...identity(), runtimeSha256: 42 }), PreparedError);
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: withHash });
  assert.equal(manifest.identity.runtimeSha256, 'c'.repeat(64));
  validatePrepared(manifest, buffers);
  const noHash = exportPrepared({ persons: [personInput()], identity: identity() });
  assert.equal(noHash.manifest.identity.runtimeSha256, undefined);
});

await nodeTest('preparationKey is exact: order-insensitive effects, sensitive to every field', () => {
  const base = () => ({ sourceCommit: COMMIT, inputsSha256: H64, closureSha256: 'b'.repeat(64) });
  const k1 = preparationKey(base());
  assert.match(k1, /^[a-f0-9]{64}$/);
  assert.equal(preparationKey({ ...base(), seed: undefined, effects: undefined }), k1);
  assert.equal(preparationKey({ ...base(), seed: null, effects: [] }), k1);
  assert.equal(preparationKey({ ...base(), effects: ['b', 'a'] }), preparationKey({ ...base(), effects: ['a', 'b'] }));
  for (const alt of [
    { ...base(), sourceCommit: 'e'.repeat(40) },
    { ...base(), inputsSha256: 'c'.repeat(64) },
    { ...base(), closureSha256: 'c'.repeat(64) },
    { ...base(), runtimeSha256: 'c'.repeat(64) },
    { ...base(), seed: 2015 },
    { ...base(), effects: ['a'] },
  ]) assert.notEqual(preparationKey(alt), k1, JSON.stringify(alt));
  assert.throws(() => preparationKey({ ...base(), contract: 'acp.prepared/v2' }), PreparedError);
  assert.throws(() => preparationKey({ ...base(), seed: NaN }), PreparedError);
  assert.throws(() => preparationKey({ ...base(), effects: [''] }), PreparedError);
  assert.throws(() => preparationKey({ ...base(), contract: 'acp.other/v1' }), PreparedError);
  assert.throws(() => adaptIdentity({ ...identity(), seed: NaN }), PreparedError);
  assert.throws(() => adaptIdentity({ ...identity(), effects: 'nope' }), PreparedError);
  assert.equal(adaptIdentity({ ...identity(), seed: 2015, effects: ['b', 'a'] }).seed, 2015);
});

await nodeTest('duplicate face-channel names rejected at export and import', () => {
  const dup = personInput();
  dup.channels.face = ['smile', 'smile'];
  assert.throws(() => exportPrepared({ persons: [dup], identity: identity() }), PreparedError);
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], identity: identity() });
  const bad = JSON.parse(JSON.stringify(manifest));
  bad.persons[0].channels.face = ['blink', 'blink'];
  assert.throws(() => validatePrepared(bad, buffers), PreparedError);
});

await nodeTest('exact 26-name CH7 bake census accepted (schema stays count-agnostic)', () => {
  // Ground truth: bake7.js CH7 = 14 fixed + HAIR_CHANS (HAIR_GROUPS L/R/C x
  // x,y,z, cloth_motion.js) + FACE7 (brow/squint/platysma, act7.js) = 26.
  // The schema pins uniqueness only; this test proves the real bake case is
  // an accepted case. Order matches simulation's handshake list.
  const CH7 = ['eyeYaw', 'eyePitch', 'smile', 'blink', 'breath', 'weight',
    'boxX', 'boxY', 'boxZ', 'boxYaw', 's3x', 's3z', 's2x', 's2z',
    'hairLx', 'hairLy', 'hairLz', 'hairRx', 'hairRy', 'hairRz',
    'hairCx', 'hairCy', 'hairCz', 'brow', 'squint', 'platysma'];
  assert.equal(CH7.length, 26);
  const input = personInput();
  input.channels.face = CH7;
  const { manifest, buffers } = exportPrepared({ persons: [input], identity: identity() });
  assert.deepEqual(manifest.persons[0].channels.face, CH7);
  validatePrepared(manifest, buffers);
});

await nodeTest('packed bytes survive nonzero view offsets with byte identity', () => {
  const { manifest, buffers } = exportPrepared({ persons: [personInput()], scene: sceneInput(), identity: identity() });
  const shifted = {};
  for (const [key, arr] of Object.entries(buffers)) {
    const off = arr.BYTES_PER_ELEMENT === 4 ? 12 : arr.BYTES_PER_ELEMENT === 2 ? 6 : 7;
    const backing = new Uint8Array(arr.byteLength + off + 8);
    backing.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), off);
    shifted[key] = new arr.constructor(backing.buffer, off, arr.length);
    assert.ok(shifted[key].byteOffset !== 0);
  }
  const packed = packPrepared(manifest, shifted);
  const back = {};
  for (const [key, f] of Object.entries(packed.files)) {
    const Ctor = { Float32Array, Uint16Array, Uint32Array, Int8Array, Uint8Array }[f.type];
    back[key] = new Ctor(packed.bin.buffer, packed.bin.byteOffset + f.offset, f.count);
  }
  for (const [key, arr] of Object.entries(buffers)) assert.deepEqual(back[key], arr, `buffer ${key} identical`);
  const bytesOf = a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  for (const [key, arr] of Object.entries(buffers)) assert.deepEqual(bytesOf(back[key]), bytesOf(arr), `bytes ${key} identical`);
});
