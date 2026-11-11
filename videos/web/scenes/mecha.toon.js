// MECHA PROLETARIAT: the cel pass. The scene renders (linear, half float) at a reduced size with its depth; this
// full-frame pass puts EVERYTHING through one medium: a three-step toon ramp on luminance (people.js included), ink
// edge lines from depth (silhouettes thick, creases thin, both from log depth), 45-degree screentone dots in the
// shadow band, depth haze, a grade, and the 2-frame anime impact frame (armor red on cream).
import * as THREE from 'three';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const FS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor, tDepth;
uniform vec2 uRes, uSrc;           // output px, source px
uniform float uNear, uFar, uInk, uInkW, uTone, uToneScale, uPoster, uExpo, uImpact, uInvert, uFogD, uSat, uCrush, uTime, uGrain, uBlack;
uniform vec3 uFog, uInkCol, uLift, uGain, uImpA, uImpB;
float ld(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
float LD(vec2 uv){ return log(ld(texture2D(tDepth, uv).r)); }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 px = vUv * uRes;
  vec3 c = texture2D(tColor, vUv).rgb * uExpo;
  float d0 = texture2D(tDepth, vUv).r;
  float z = ld(d0);
  // ---- ink: log-depth first and second differences at a ~1.5 source-px offset
  vec2 o = uInkW / uSrc;
  float lc = log(z);
  float lx1 = LD(vUv + vec2(o.x, 0.)), lx0 = LD(vUv - vec2(o.x, 0.)), ly1 = LD(vUv + vec2(0., o.y)), ly0 = LD(vUv - vec2(0., o.y));
  float sil = max(max(abs(lx1 - lc), abs(lx0 - lc)), max(abs(ly1 - lc), abs(ly0 - lc)));
  float crease = max(abs(lx1 + lx0 - 2.0 * lc), abs(ly1 + ly0 - 2.0 * lc));
  float near = clamp(1.4 - lc * 0.12, 0.35, 1.0);
  float ink = smoothstep(0.035, 0.07, sil) + 0.8 * smoothstep(0.006 * (1.0 + z * 0.004), 0.016 * (1.0 + z * 0.004), crease);
  ink = clamp(ink, 0.0, 1.0) * uInk * (d0 < 0.99999 ? 1.0 : smoothstep(0.035, 0.07, sil));
  // ---- the toon ramp on luminance (hue kept); emissive highlights above 1 are left alone
  float L = luma(c);
  float t1 = 0.085, t2 = 0.34, w = 0.012;
  float q = mix(0.045, 0.2, smoothstep(t1 - w, t1 + w, L));
  q = mix(q, 0.52, smoothstep(t2 - w * 2.0, t2 + w * 2.0, L));
  q = mix(q, L, smoothstep(0.75, 1.3, L));
  vec3 ct = c * min(q / max(L, 1e-4), 1.0);
  c = mix(c, ct, uPoster);
  // ---- screentone: 45-degree dots in the shadow band
  float Lq = luma(c);
  vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * px / uToneScale;
  vec2 f = fract(r) - 0.5;
  float cover = smoothstep(0.16, 0.02, Lq);                 // darker -> bigger dots
  float dotR = sqrt(cover) * 0.55;
  float dotm = smoothstep(dotR + 0.08, dotR - 0.08, length(f));
  c = mix(c, c * 0.35 + uInkCol * 0.1, dotm * uTone * step(0.002, cover));
  // ---- haze by depth (in-world: hangar air, morning mist)
  float fog = 1.0 - exp(-uFogD * z);
  c = mix(c, uFog, clamp(fog, 0.0, 0.92) * (d0 < 0.99999 ? 1.0 : 0.0));
  // ---- ink on top
  c = mix(c, uInkCol, ink * 0.95);
  // ---- grade: lift/gain, saturation, crush, a soft shoulder, then sRGB
  c = c * uGain + uLift;
  float l2 = luma(c); c = mix(vec3(l2), c, uSat);
  c = max(c - uCrush, 0.0) / (1.0 - uCrush);
  { float m = max(c.r, max(c.g, c.b)); if (m > 0.8) c *= (0.8 + (m - 0.8) / (1.0 + (m - 0.8) * 1.4)) / m; }
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
  c += (h12(px + fract(uTime * 7.13) * 91.0) - 0.5) * uGrain;
  // ---- the impact frame: two inks, armor red on cream, cut on luminance (and ink)
  float li = luma(c);
  vec3 imp = mix(uImpB, uImpA, step(li, 0.42) + ink);
  imp = uInvert > 0.5 ? mix(uImpA, uImpB, step(li, 0.42) + ink) : imp;
  c = mix(c, clamp(imp, 0.0, 1.0), uImpact);
  c = mix(c, vec3(0.0), uBlack);
  gl_FragColor = vec4(c, 1.0);
}`;

export class Toon {
  constructor(renderer, srcW, srcH, outW, outH) {
    this.r = renderer;
    this.rt = new THREE.WebGLRenderTarget(srcW, srcH, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(srcW, srcH, THREE.UnsignedIntType), samples: 0 });
    this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    this.rt.depthTexture.minFilter = this.rt.depthTexture.magFilter = THREE.NearestFilter;
    this.u = {
      tColor: { value: this.rt.texture }, tDepth: { value: this.rt.depthTexture }, uRes: { value: new THREE.Vector2(outW, outH) }, uSrc: { value: new THREE.Vector2(srcW, srcH) },
      uNear: { value: 0.1 }, uFar: { value: 5000 }, uInk: { value: 1 }, uInkW: { value: 1.2 }, uTone: { value: 0.8 }, uToneScale: { value: 7.0 }, uPoster: { value: 0.8 },
      uExpo: { value: 1 }, uImpact: { value: 0 }, uInvert: { value: 0 }, uFogD: { value: 0 }, uSat: { value: 1.05 }, uCrush: { value: 0.02 }, uTime: { value: 0 }, uGrain: { value: 0.03 },
      uBlack: { value: 0 }, uFog: { value: new THREE.Color('#0F2A2C') }, uInkCol: { value: new THREE.Color('#120a0a') }, uLift: { value: new THREE.Color(0, 0, 0) },
      uGain: { value: new THREE.Color(1, 1, 1) }, uImpA: { value: new THREE.Color('#C91F37') }, uImpB: { value: new THREE.Color('#F4E6D0') },
    };
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.u, depthTest: false, depthWrite: false });
    this.scene = new THREE.Scene(); this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.u.uImpA.value.setHex(0xC91F37, THREE.LinearSRGBColorSpace); this.u.uImpB.value.setHex(0xF4E6D0, THREE.LinearSRGBColorSpace);
  }
  render(scene, camera, o = {}) {
    const u = this.u;
    u.uNear.value = camera.near; u.uFar.value = camera.far;
    for (const k in o) {
      const U = u['u' + k[0].toUpperCase() + k.slice(1)];
      if (!U) continue;
      if (U.value && U.value.isColor) { if (k === 'impA' || k === 'impB') U.value.setStyle(o[k], THREE.LinearSRGBColorSpace); else U.value.set(o[k]); } else U.value = o[k];
    }
    this.r.setRenderTarget(this.rt); this.r.clear(); this.r.render(scene, camera);
    this.r.setRenderTarget(null); this.r.render(this.scene, this.cam);
  }
}
