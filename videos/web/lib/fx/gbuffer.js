// GBUFFER: the aux input for print.js presses, from any three.js scene. One extra geometry pass (MRT, float,
// no shadows, no lighting) at the source resolution, read back once per frame:
//   nd  = view-space normal xyz + linear view depth (0 where there is no geometry: sky / background)
//   uvm = object uv * userData.uvScale (+ uvOffset), subject weight (userData.subject, 0..1), coverage 1
// Isolines of u are what an engraver's burin follows (rings round a limb or a drum); give each mesh metric UVs
// (world units) or set userData.uvScale so its u/v run ~1 unit per metre. userData.gbuffer = false hides a mesh
// (sky domes, glows); userData.uvSwap = true swaps u and v for that mesh.
//
//   const gb = new GBuffer(renderer, 540, 960);
//   const aux = gb.read(scene, camera);                          // { nd, uvm, width, height, range }
//   pr.render(ctx, renderer.domElement, [['engrave', { pitch: 8 }]], { t, aux, prep: { subject: 'aux' } });
import * as THREE from 'three';

const VS = `
#include <common>
#include <skinning_pars_vertex>
out vec3 vN; out vec2 vUv; out float vZ;
uniform vec4 UVS; uniform float SWAP;
void main(){
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
  vN = transformedNormal; vec2 u = SWAP > .5 ? uv.yx : uv; vUv = u*UVS.xy + UVS.zw; vZ = -mvPosition.z;
}`;
const FS = `
precision highp float;
in vec3 vN; in vec2 vUv; in float vZ;
uniform float SUBJ;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
void main(){ vec3 n = normalize(vN); if(!gl_FrontFacing) n = -n; o0 = vec4(n, vZ); o1 = vec4(vUv, SUBJ, 1.); }`;

export class GBuffer {
  constructor(renderer, width, height) {
    this.r = renderer; this.w = width; this.h = height;
    this.rt = new THREE.WebGLRenderTarget(width, height, { count: 2, type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
    this.mat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
      uniforms: { UVS: { value: new THREE.Vector4(1, 1, 0, 0) }, SWAP: { value: 0 }, SUBJ: { value: 0 } } });
    this.nd = new Float32Array(width * height * 4); this.uvm = new Float32Array(width * height * 4);
    const U = this.mat.uniforms, mat = this.mat;
    this._before = function () {    // per-object uniforms (called with this = the mesh)
      const d = this.userData, s = d.uvScale || [1, 1], of = d.uvOffset || [0, 0];
      U.UVS.value.set(s[0], s[1], of[0], of[1]); U.SWAP.value = d.uvSwap ? 1 : 0; U.SUBJ.value = d.subject || 0; mat.uniformsNeedUpdate = true;
    };
    this.ms = 0;
  }
  // render the G-buffer of scene/camera and read it back; returns the aux object print.js takes
  read(scene, camera, { rangePct = [0.02, 0.98] } = {}) {
    const t0 = performance.now(), r = this.r, gl = r.getContext();
    const hidden = [], hooks = [];
    scene.traverse(o => {
      if (o.userData.gbuffer === false && o.visible) { o.visible = false; hidden.push(o); }
      if (o.isMesh) { hooks.push([o, o.onBeforeRender]); o.onBeforeRender = this._before; }
    });
    const bg = scene.background, fog = scene.overrideMaterial, sm = r.shadowMap.autoUpdate, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    scene.background = null; scene.overrideMaterial = this.mat; r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.rt); r.setClearColor(0x000000, 0); r.clear(); r.render(scene, camera);
    // read both attachments (three's readRenderTargetPixels only reads attachment 0)
    const fb = r.properties.get(this.rt).__webglFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, this.nd);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.FLOAT, this.uvm);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    r.setRenderTarget(null); r.resetState();
    r.setClearColor(cc, ca); scene.background = bg; scene.overrideMaterial = fog; r.shadowMap.autoUpdate = sm;
    for (const o of hidden) o.visible = true;
    for (const [o, f] of hooks) o.onBeforeRender = f;
    // depth range for pitch-by-depth: percentiles of the covered pixels (strided sample)
    const zs = []; for (let i = 3; i < this.nd.length; i += 4 * 37) if (this.nd[i] > 0) zs.push(this.nd[i]);
    zs.sort((a, b) => a - b);
    const range = zs.length ? [zs[Math.floor(zs.length * rangePct[0])], zs[Math.min(zs.length - 1, Math.floor(zs.length * rangePct[1]))]] : [1, 100];
    this.ms = performance.now() - t0;
    return { nd: this.nd, uvm: this.uvm, width: this.w, height: this.h, range };
  }
}
