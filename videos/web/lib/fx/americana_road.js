// AMERICANA / ROAD (WORLDS studio c1): the interstate at MUTCD scale, at night, in rain.
//   Highway    lanes 3.66 m, shoulders 3.0 / 1.2 m, dashed lines 3.05 m on 9.15 m off (10 ft / 30 ft), 0.15 m edge lines,
//              yellow left edge, raised retroreflective markers every 24.4 m, a jersey barrier, a W-beam guardrail,
//              LED cobra-head lamps on the median every 70 m (12 m). Wet asphalt: puddles, planar reflections smeared into
//              vertical streaks (Mead), lamp pools from the LightField.
//   Gantry     a box-truss sign bridge (default span 30 m, 5.3 m clearance) with guide panels 4.3 m tall and 0.46 m legend
//              caps in Overpass (a Highway Gothic descendant). The legend is retroreflective: luminance = headlight
//              illuminance at the panel (low-beam pattern: little light above the horizon) x R_A(observation angle), so it
//              lights as the car approaches and goes flat far away; the green field reflects about 1/8 of the white.
//   Headlights two low-beam spots that ride the camera (cab height), and the uniforms the sign and markers read.
//   Rain       streaks around the camera, lit by the headlight cone and the lamp pools, occluded by the scene depth.
//   Truck      a 53 ft trailer + tractor with tail/marker lights and a lit spray plume.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ATMOS_GLSL, LF_GLSL } from './atmos3d.js';

export const MUTCD = { lane: 3.66, shoulderR: 3.0, shoulderL: 1.2, clearance: 5.3, panelH: 4.3, cap: 0.46, span: 30, dash: 3.05, gap: 9.15 };
const TAU = Math.PI * 2;

// ------------------------------------------------------------------ headlights (ride the camera)
export class Headlights {
  constructor(world, { spread = 0.78, drop = 1.25, fwd = 1.0, intensity = 2200, angle = 0.5, penumbra = 0.55, aim = 40, spots = false } = {}) {
    this.U = { uHL0: { value: new THREE.Vector3() }, uHL1: { value: new THREE.Vector3() }, uHLF: { value: new THREE.Vector3(0, 0, -1) }, uHLI: { value: intensity } };
    this.camU = { value: new THREE.Vector3() };
    this.spots = spots ? [-1, 1].map(() => { const s = new THREE.SpotLight(0xfff1e0, intensity, 260, angle, penumbra, 2); s.castShadow = false; world.scene.add(s, s.target); return s; }) : [];
    Object.assign(this, { spread, drop, fwd, aim, world });
    world.onBefore.push(cam => this.follow(cam));
  }
  follow(cam) {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); f.y = 0; f.normalize();
    const rt = new THREE.Vector3(-f.z, 0, f.x);
    [-1, 1].forEach((sd, i) => { const p = cam.position.clone().addScaledVector(rt, sd * this.spread).addScaledVector(f, this.fwd); p.y -= this.drop;
      if (this.spots[i]) { this.spots[i].position.copy(p); this.spots[i].target.position.copy(p).addScaledVector(f, this.aim).setY(0); this.spots[i].target.updateMatrixWorld(); }
      this.U[i ? 'uHL1' : 'uHL0'].value.copy(p); });
    this.U.uHLF.value.copy(f); this.camU.value.copy(cam.position);
  }
}
// GLSL: headlight illuminance at p (low beam: cut-off 0.5 deg above horizontal, ~20 deg half spread) and retro gain
const HL_GLSL = /* glsl */`
uniform vec3 uHL0, uHL1, uHLF; uniform float uHLI;
float hlE(vec3 p, vec3 h, vec3 n){ vec3 d = p - h; float r = length(d); vec3 u = d / r;
  float up = degrees(asin(clamp(u.y, -1., 1.)));                                   // + above the lamp axis
  float side = degrees(acos(clamp(dot(normalize(u.xz), normalize(uHLF.xz)), -1., 1.)));
  float vert = up < -.5 ? mix(1., .12, smoothstep(-2.5, -9., up)) : max(exp(-pow((up + .5) / 1.2, 2.)), .05 * exp(-max(up - 4., 0.) / 4.));
  float beam = vert * exp(-pow(side / 20., 2.)) * step(0., dot(u.xz, uHLF.xz));
  return uHLI * beam * max(dot(n, -u), 0.) / (r*r); }
// retroreflection: R_A falls with the observation angle (source -> surface -> eye), sheeting ~0.2-1 deg
float retro(vec3 p, vec3 h){ vec3 a = normalize(h - p), b = normalize(uCamPos - p); float ang = acos(clamp(dot(a, b), -1., 1.)); return exp(-pow(ang / .012, 2.)) + .08*exp(-ang / .05); }
`;

// ------------------------------------------------------------------ wet standard material (+ markings + lightmap + reflection streaks)
export function wetMaterial(atmos, lf, hl, { color = '#2a2826', rough = 0.55, wet = 0.85, markings = null, streak = 1, puddles = 0.5, worldTex = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
  const R = atmos.reflU;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, atmos.U, lf.U, hl ? hl.U : {}, R || {}, { uWet: { value: wet }, uStreak: { value: streak }, uPud: { value: puddles } });
    if (markings) Object.assign(sh.uniforms, markings.U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 lp = vec4(transformed, 1.);
          #ifdef USE_INSTANCING
          lp = instanceMatrix * lp;
          #endif
          vWP = (modelMatrix * lp).xyz; }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform float uWet, uStreak, uPud;\n' + ATMOS_GLSL + LF_GLSL
        + (hl ? HL_GLSL : '') + (R ? 'uniform sampler2D tRefl; uniform mat4 uReflMat;\n' : '') + (markings ? markings.GLSL : 'vec4 marks(vec3 p){ return vec4(0.); }\n'))
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pud = smoothstep(.55, .75, a_fbm(vWP.xz*.18) + .15*a_n2(vWP.xz*2.1)) * uPud;
        vec4 mk = marks(vWP); diffuseColor.rgb = mix(diffuseColor.rgb, mk.rgb, mk.a);
        diffuseColor.rgb *= mix(1., .55, uWet * (1. - mk.a*.5)) * (.9 + .2*a_n2(vWP.xz*1.7));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .12, uWet*.5); roughnessFactor = mix(roughnessFactor, .03, pud*uWet);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * lightAt(vWP) / 3.14159;
        ${hl ? '{ vec3 nW = normalize((vec4(normal, 0.) * viewMatrix).xyz); reflectedLight.indirectDiffuse += diffuseColor.rgb * (hlE(vWP, uHL0, nW) + hlE(vWP, uHL1, nW)) / 3.14159; }' : ''}`)
      .replace('#include <opaque_fragment>', `
        ${R ? `{ vec4 rc = uReflMat * vec4(vWP, 1.); vec2 ru = rc.xy / rc.w; vec3 V = normalize(uCamPos - vWP);
          float fr = .04 + .96*pow(1. - max(V.y, 0.), 5.);
          float wob = (a_n2(vWP.xz*3.) - .5) * .004 * (1. - pud);
          vec3 acc = vec3(0.); float ws = 0.;
          for (int i = 0; i < 10; i++) { float k = float(i) / 9.; float w = exp(-k*2.5);
            vec2 o = vec2(wob, (k - .15) * .06 * uStreak * (1. - pud*.8));
            acc += texture2D(tRefl, ru + o).rgb * w; ws += w; }
          outgoingLight += acc / ws * fr * uWet * mix(.55, 1., pud); }` : ''}
        ${markings ? 'outgoingLight += markGlow(vWP);' : ''}
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'wet' + (markings ? markings.key : '') + (R ? 'R' : '') + (hl ? 'H' : '');
  return mat;
}

// markings for a carriageway whose lanes run along -z from x = xL (left edge) with n lanes
export function laneMarkings({ xL = 0, n = 4, lane = MUTCD.lane, dash = MUTCD.dash, gap = MUTCD.gap, rpm = 24.4, hl = true } = {}) {
  const U = { uXL: { value: xL }, uNL: { value: n }, uLW: { value: lane } };
  const GLSL = /* glsl */`
    uniform float uXL, uNL, uLW;
    vec4 marks(vec3 p){
      float x = p.x - uXL, W = uNL*uLW, fw = fwidth(x) + 1e-4;
      float a = 0.; vec3 c = vec3(.75);
      float yl = smoothstep(.1 + fw, .1 - fw, abs(x - .1)); if (yl > 0.) { c = vec3(.75, .55, .08); a = yl; }      // yellow left edge
      float er = smoothstep(.1 + fw, .1 - fw, abs(x - W + .1)); a = max(a, er);                                  // white right edge
      float k = floor(x / uLW + .5); float lx = abs(x - k*uLW);
      if (k > .5 && k < uNL - .5) { float on = step(mod(-p.z, ${(dash + gap).toFixed(2)}), ${dash.toFixed(2)}); a = max(a, smoothstep(.06 + fw, .06 - fw, lx) * on); }
      return vec4(c * (.85 + .15*a_n2(p.xz*9.)), a * .9);
    }
    vec3 markGlow(vec3 p){                                                   // raised pavement markers between dashes
      float x = p.x - uXL; float k = floor(x / uLW + .5); if (k < .5 || k > uNL - .5) return vec3(0.);
      vec2 q = vec2(x - k*uLW, mod(-p.z + 6., ${rpm.toFixed(1)}) - 6.);
      float m = smoothstep(.08, .05, max(abs(q.x), abs(q.y)*.9));
      if (m <= 0.) return vec3(0.);
      ${hl ? 'float e = hlE(p + vec3(0., .02, 0.), uHL0, normalize(uCamPos - p)) + hlE(p + vec3(0., .02, 0.), uHL1, normalize(uCamPos - p)); return vec3(1., .95, .85) * m * e * (retro(p, uHL0) + retro(p, uHL1)) * 18.;' : 'return vec3(0.);'}
    }`;
  return { U, GLSL, key: 'lm' + n };
}

export function patchLit(hl) {
  return (mat, lf, { wallFall = 14 } = {}) => {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, lf.U, hl.U, { uCamPos: { value: new THREE.Vector3() }, uWallFall: { value: wallFall } });
      sh.uniforms.uCamPos = hl.camU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLFp;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          { vec4 lp = vec4(transformed, 1.);
            #ifdef USE_INSTANCING
            lp = instanceMatrix * lp;
            #endif
            vLFp = (modelMatrix * lp).xyz; }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLFp; uniform float uWallFall; uniform vec3 uCamPos;\n' + LF_GLSL + HL_GLSL)
        .replace('#include <aomap_fragment>', `#include <aomap_fragment>
          { vec3 nW = normalize((vec4(normal, 0.) * viewMatrix).xyz); float up = clamp(nW.y, 0., 1.), hf = exp(-max(vLFp.y, 0.) / uWallFall);
            reflectedLight.indirectDiffuse += diffuseColor.rgb * (lightAt(vLFp) * mix(.45 * hf, 1., up) + hlE(vLFp, uHL0, nW) + hlE(vLFp, uHL1, nW)) / 3.14159; }`);
    };
    mat.customProgramCacheKey = () => 'lit' + wallFall;
    return mat;
  };
}

// ------------------------------------------------------------------ geometry helpers
function boxAt(sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) { const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g.toNonIndexed(); }
function beam(a, b, t) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B); const g = new THREE.BoxGeometry(t, t, L);
  const m = new THREE.Matrix4().lookAt(A, B, new THREE.Vector3(0, 1, 0)); g.applyMatrix4(m); g.translate(...A.clone().add(B).multiplyScalar(0.5).toArray()); return g.toNonIndexed(); }
function strip(g) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; }
export function steel(lf, patch, color = '#8a9096', rough = 0.45, metal = 0.6) { const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); if (patch) patch(m, lf); return m; }

// ------------------------------------------------------------------ Highway
export class Highway {
  // our carriageway: n lanes from x = 0 (left edge) to n*3.66; median barrier at x = -shoulderL - 0.3; opposite carriageway mirrored
  constructor(world, atmos, lf, hl, { n = 4, z0 = 150, z1 = -2500, lampEvery = 70, lampH = 12, lampI = 5, wet = 0.85, patch = null, seed = 3 } = {}) {
    const W = n * MUTCD.lane, xm = -MUTCD.shoulderL - 0.45, len = z0 - z1;
    this.n = n; this.W = W; this.xm = xm;
    // road slab: opposite carriageway + median + ours + shoulder + verge
    const xa = xm - 0.45 - MUTCD.shoulderL - W - MUTCD.shoulderR - 6, xb = W + MUTCD.shoulderR + 14;
    const rg = new THREE.PlaneGeometry(xb - xa, len, 64, 256); rg.rotateX(-Math.PI / 2); rg.translate((xa + xb) / 2, 0, (z0 + z1) / 2);
    this.marks = laneMarkings({ xL: 0, n, hl: !!hl });
    const road = new THREE.Mesh(rg, wetMaterial(atmos, lf, hl, { wet, markings: this.marks }));
    road.userData.noReflect = true; world.scene.add(road); this.road = road;
    const marks2 = laneMarkings({ xL: xm - 0.45 - MUTCD.shoulderL - W, n, hl: false });
    // verge (grass beyond the shoulder, wet but rough)
    // jersey barrier (F-shape, 0.81 m) along the median
    const prof = new THREE.Shape(); prof.moveTo(-0.3, 0); prof.lineTo(-0.2, 0.08); prof.lineTo(-0.12, 0.33); prof.lineTo(-0.08, 0.81); prof.lineTo(0.08, 0.81); prof.lineTo(0.12, 0.33); prof.lineTo(0.2, 0.08); prof.lineTo(0.3, 0);
    const jb = new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false, steps: 1 }); jb.translate(0, 0, -len / 2); jb.translate(xm, 0, (z0 + z1) / 2);
    const conc = new THREE.MeshStandardMaterial({ color: '#8c8a84', roughness: 0.8 }); if (patch) patch(conc, lf);
    world.scene.add(new THREE.Mesh(jb, conc));
    // W-beam guardrail on the right, 0.7 m, posts every 1.9 m
    const gx = W + MUTCD.shoulderR + 0.6, gl = [];
    gl.push(boxAt(0.06, 0.32, len, gx, 0.62, (z0 + z1) / 2));
    const posts = []; for (let z = z0; z > z1; z -= 1.905) posts.push(boxAt(0.15, 0.7, 0.15, gx + 0.18, 0.35, z));
    const gm = steel(lf, patch, '#9aa0a4', 0.35, 0.8);
    world.scene.add(new THREE.Mesh(mergeGeometries([...gl, ...posts].map(strip)), gm));
    // median lamps: 12 m poles, twin davit arms, LED 4000 K heads; pools on both carriageways
    const poles = [];
    for (let z = z0 - 20; z > z1; z -= lampEvery) {
      poles.push(boxAt(0.22, lampH, 0.22, xm, lampH / 2 + 0.8, z));
      for (const sd of [-1, 1]) { poles.push(beam([xm, lampH + 0.8, z], [xm + sd * 2.6, lampH + 1.1, z], 0.1)); poles.push(boxAt(0.7, 0.18, 0.35, xm + sd * 2.9, lampH + 1.0, z));
        lf.add({ pos: [xm + sd * 3.0, lampH + 0.85, z], color: '#fff0dc', i: lampI, core: 0.25, halo: 0.8, minPx: 1.6, pool: { r: lampH * 0.6, i: lampI * 0.35 } }); }
    }
    world.scene.add(new THREE.Mesh(mergeGeometries(poles.map(strip)), steel(lf, patch, '#6a6e72', 0.5, 0.5)));
  }
}

// ------------------------------------------------------------------ guide sign legends (canvas, 200 px per metre)
const PXM = 200;
export async function loadHighwayFont(url = '../assets/fonts/overpass-latin-700-normal.woff2') {
  const f = new FontFace('HwyGothic', `url(${url})`); document.fonts.add(await f.load()); return 'HwyGothic';
}
function shield(g, cx, cy, h, num) {                                        // Interstate shield (M1-1), h metres
  const s = h * PXM, w = s * 0.92;
  const path = () => { g.beginPath(); g.moveTo(cx - w / 2, cy - s * 0.42); g.quadraticCurveTo(cx - w * 0.25, cy - s * 0.52, cx, cy - s * 0.4); g.quadraticCurveTo(cx + w * 0.25, cy - s * 0.52, cx + w / 2, cy - s * 0.42);
    g.bezierCurveTo(cx + w * 0.56, cy + s * 0.05, cx + w * 0.35, cy + s * 0.35, cx, cy + s * 0.5); g.bezierCurveTo(cx - w * 0.35, cy + s * 0.35, cx - w * 0.56, cy + s * 0.05, cx - w / 2, cy - s * 0.42); g.closePath(); };
  g.fillStyle = '#f4f4f0'; path(); g.fill();
  g.save(); g.scale(0.9, 0.9); g.translate(cx / 0.9 - cx, cy / 0.9 - cy + s * 0.01); g.fillStyle = '#1f3c88'; path(); g.fill(); g.restore();
  g.save(); path(); g.clip(); g.fillStyle = '#b8202a'; g.fillRect(cx - w, cy - s * 0.6, w * 2, s * 0.25); g.restore();
  g.fillStyle = '#f4f4f0'; g.font = `700 ${s * 0.13}px HwyGothic`; g.textAlign = 'center'; g.fillText('INTERSTATE', cx, cy - s * 0.24);
  g.font = `700 ${s * 0.5}px HwyGothic`; g.fillText(num, cx, cy + s * 0.24);
}
// panel: { w, h, lines: [{ text, cap (m), y (m from top), x (m from left) | align }], shield: { num, h, x, y }, tab: { text, w } , arrow }
export function drawPanel(P) {
  const c = document.createElement('canvas'); c.width = Math.round(P.w * PXM); c.height = Math.round(P.h * PXM); const g = c.getContext('2d');
  const r = 0.15 * PXM; g.fillStyle = '#006a3e'; g.beginPath(); g.roundRect(0, 0, c.width, c.height, r); g.fill();
  g.strokeStyle = '#f4f4f0'; g.lineWidth = 0.05 * PXM; g.beginPath(); g.roundRect(0.08 * PXM, 0.08 * PXM, c.width - 0.16 * PXM, c.height - 0.16 * PXM, r * 0.7); g.stroke();
  g.fillStyle = '#f4f4f0'; g.textBaseline = 'alphabetic';
  for (const L of P.lines || []) { const capPx = L.cap * PXM; g.font = `700 ${capPx / 0.7}px HwyGothic`;       // Overpass cap height ~ 0.7 em
    g.textAlign = L.align || 'center'; const x = L.x != null ? L.x * PXM : c.width / 2; g.fillText(L.text, x, (L.y + L.cap) * PXM); }
  if (P.shield) shield(g, P.shield.x * PXM, P.shield.y * PXM, P.shield.h, P.shield.num);
  if (P.arrow) { const ax = P.arrow.x * PXM, ay = P.arrow.y * PXM, s = P.arrow.h * PXM; g.beginPath(); g.moveTo(ax - s * 0.09, ay - s / 2); g.lineTo(ax + s * 0.09, ay - s / 2); g.lineTo(ax + s * 0.09, ay + s * 0.1);
    g.lineTo(ax + s * 0.3, ay + s * 0.1); g.lineTo(ax, ay + s / 2); g.lineTo(ax - s * 0.3, ay + s * 0.1); g.lineTo(ax - s * 0.09, ay + s * 0.1); g.closePath(); g.fill(); }
  // grime: road film at the bottom, rain runs
  const gr = g.createLinearGradient(0, c.height * 0.6, 0, c.height); gr.addColorStop(0, 'rgba(30,30,20,0)'); gr.addColorStop(1, 'rgba(30,30,20,0.25)'); g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height);
  return c;
}

const SIGN_GLSL_V = `varying vec2 vUv; varying vec3 vWP; varying vec3 vN; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
export function signMaterial(atmos, lf, hl, canvas, { ambient = 0.02 } = {}) {
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return new THREE.ShaderMaterial({ uniforms: { ...atmos.U, ...lf.U, ...hl.U, tLegend: { value: tex }, uAmb: { value: ambient }, uRetro: { value: 1 }, uSheet: { value: 0 } },
    vertexShader: SIGN_GLSL_V,
    fragmentShader: ATMOS_GLSL + LF_GLSL + HL_GLSL + /* glsl */`
      uniform sampler2D tLegend; uniform float uAmb, uRetro, uSheet; varying vec2 vUv; varying vec3 vWP; varying vec3 vN;
      void main(){
        vec3 alb = texture2D(tLegend, vUv).rgb;                     // linear albedo of the sheeting
        // pass 2 (uSheet): aged sheeting: panel seams, road film rising from the bottom, rain runs, patchy retro loss
        float sheet = 1.;
        if (uSheet > 0.) { sheet = .82 + .3*a_fbm(vUv * vec2(9., 4.)) ; sheet *= 1. - .25*smoothstep(.35, 0., vUv.y) * a_n2(vUv*vec2(60., 3.));
          sheet *= 1. - .2*smoothstep(.02, .0, abs(fract(vUv.x * 4.) - .5) - .49); alb *= mix(1., sheet, uSheet); }
        float white = smoothstep(.35, .8, dot(alb, vec3(.33)));
        vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        vec3 c = alb * (uAmb + lightAt(vWP) * .25 / 3.14159);
        float e0 = hlE(vWP, uHL0, n), e1 = hlE(vWP, uHL1, n);
        float ra = mix(.12, 1., white);                               // green sheeting returns ~1/8 of the white
        c += alb * (e0*retro(vWP, uHL0) + e1*retro(vWP, uHL1)) * ra * uRetro * 90. * mix(1., sheet, uSheet);
        gl_FragColor = vec4(c, 1.);
      }` });
}

// ------------------------------------------------------------------ Gantry: box-truss sign bridge
export class Gantry {
  // mass (pass 2, opt-in): a sign bridge with weight: 0.24 m chords, a 1.5 m box, twin 0.55 m pipe posts per end on concrete
  // footings, a maintenance catwalk with handrail under the panels, and the old sign-light brackets
  constructor(world, atmos, lf, hl, { z = -120, x0 = -6, x1 = 24, clearance = MUTCD.clearance, depth = 1.5, panels = [], patch = null, mass = false } = {}) {
    if (mass) depth = Math.max(depth, 1.6);
    const span = x1 - x0, H = mass ? 1.5 : 1.2, y0 = clearance + 4.6, ch = [];                // truss 1.2 m deep over the panels' top
    const tC = mass ? 0.24 : 0.14, tV = mass ? 0.12 : 0.07, tD = mass ? 0.1 : 0.06;
    this.span = span; this.z = z; this.clearance = clearance;
    const yT = y0 + H, zF = z + depth / 2, zB = z - depth / 2;
    for (const [yy, zz] of [[y0, zF], [y0, zB], [yT, zF], [yT, zB]]) ch.push(beam([x0, yy, zz], [x1, yy, zz], tC));
    for (let x = x0, k = 0; x <= x1 + 1e-3; x += 1.5, k++) {
      for (const zz of [zF, zB]) { ch.push(beam([x, y0, zz], [x, yT, zz], tV)); if (x + 1.5 <= x1 + 1e-3) ch.push(beam([x, k % 2 ? y0 : yT, zz], [x + 1.5, k % 2 ? yT : y0, zz], tD)); }
      ch.push(beam([x, y0, zF], [x, y0, zB], tD)); ch.push(beam([x, yT, zF], [x, yT, zB], tD));
      if (mass && x + 1.5 <= x1 + 1e-3) ch.push(beam([x, yT, zF], [x + 1.5, yT, zB], tD * 0.8));                 // top plane bracing
    }
    const conc = [];
    if (!mass) {
    // end frames: 4-leg towers to the footings
    for (const xx of [x0, x1]) { for (const dx of [-0.5, 0.5]) for (const zz of [zF, zB]) ch.push(beam([xx + dx, 0, zz], [xx + dx, yT, zz], 0.18));
      for (let y = 0.8; y < yT; y += 1.3) { ch.push(beam([xx - 0.5, y, zF], [xx + 0.5, y + 1.3, zF], 0.06)); ch.push(beam([xx - 0.5, y, zB], [xx + 0.5, y + 1.3, zB], 0.06)); } }
    } else {
      for (const xx of [x0, x1]) { for (const zz of [zF - 0.2, zB + 0.2]) { const g = new THREE.CylinderGeometry(0.28, 0.3, yT + 0.4, 16); g.translate(xx, 1.0 + (yT - 0.6) / 2, zz); ch.push(g.toNonIndexed());
          const bp = new THREE.BoxGeometry(0.9, 0.06, 0.9); bp.translate(xx, 1.03, zz); ch.push(bp.toNonIndexed()); }
        for (let y = 1.6; y < yT - 0.5; y += 1.4) { ch.push(beam([xx, y, zF - 0.2], [xx, y + 1.2, zB + 0.2], 0.12)); ch.push(beam([xx, y, zF - 0.2], [xx, y, zB + 0.2], 0.1)); }
        conc.push(boxAt(1.5, 1.05, depth + 1.1, xx, 0.52, z)); }
      // catwalk: grating 0.9 m in front of the panels, handrail at 1.07 m, brackets back to the bottom chord
      const cy = clearance - 0.12, cz = zF + 0.95, cw0 = Math.min(...panels.map(P => P.x - P.w / 2)) - 0.6, cw1 = Math.max(...panels.map(P => P.x + P.w / 2)) + 0.6;
      ch.push(boxAt(cw1 - cw0, 0.06, 0.9, (cw0 + cw1) / 2, cy, cz), beam([cw0, cy + 1.07, cz + 0.42], [cw1, cy + 1.07, cz + 0.42], 0.05), beam([cw0, cy + 0.55, cz + 0.42], [cw1, cy + 0.55, cz + 0.42], 0.035));
      for (let x = cw0; x <= cw1; x += 1.8) { ch.push(beam([x, cy, cz + 0.42], [x, cy + 1.07, cz + 0.42], 0.045)); ch.push(beam([x, cy - 0.05, cz - 0.45], [x, y0, zF], 0.06));
        ch.push(boxAt(0.35, 0.18, 0.25, x + 0.9, cy - 0.2, cz + 0.2)); }                                   // the old sign-light housings
    }
    // panel support posts (vertical Z-bars behind the panels)
    for (const P of panels) for (let k = 0; k < Math.max(2, Math.round(P.w / 2.5)); k++) ch.push(boxAt(0.1, P.h + 0.4, 0.1, P.x - P.w / 2 + 0.4 + k * (P.w - 0.8) / Math.max(1, Math.round(P.w / 2.5) - 1), clearance + P.h / 2, zF + 0.1));
    const tm = steel(lf, patch, mass ? '#8e9498' : '#a4aaae', mass ? 0.55 : 0.4, 0.75);
    this.truss = new THREE.Mesh(mergeGeometries(ch.map(strip)), tm); world.scene.add(this.truss);
    if (conc.length) world.scene.add(new THREE.Mesh(mergeGeometries(conc.map(strip)), steel(lf, patch, '#8c8a84', 0.85, 0)));
    this.panels = [];
    for (const P of panels) {
      const cv = drawPanel(P), m = new THREE.Mesh(new THREE.PlaneGeometry(P.w, P.h), signMaterial(atmos, lf, hl, cv));
      m.position.set(P.x, clearance + P.h / 2, zF + 0.28); world.scene.add(m);
      const back = new THREE.Mesh(new THREE.BoxGeometry(P.w, P.h, 0.08), steel(lf, patch, '#7c8286', 0.6, 0.6)); back.position.set(P.x, clearance + P.h / 2, zF + 0.2); world.scene.add(back);
      m.userData.panel = P; this.panels.push(m);
    }
  }
}

// ------------------------------------------------------------------ Rain: streaks around the camera
export class Rain {
  constructor(atmos, lf, hl, { count = 22000, box = [36, 16, 70], fall = 9, len = 0.45, wind = [0.9, 0, 0.3], gain = 1 } = {}) {
    const n = count, P = new Float32Array(n * 2 * 3), S = new Float32Array(n * 2 * 2);
    let q = 12345; const rnd = () => (q = (q * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) { const a = [rnd(), rnd(), rnd()], sd = rnd();
      for (let e = 0; e < 2; e++) { P.set(a, (i * 2 + e) * 3); S.set([e, sd], (i * 2 + e) * 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('se', new THREE.BufferAttribute(S, 2));
    const F = atmos.frameU;
    this.U = { ...atmos.U, ...lf.U, ...hl.U, tDepth: F.tDepth, uRes: F.uRes, uOcc: F.uOcc, uBox: { value: new THREE.Vector3(...box) }, uFall: { value: fall }, uLen: { value: len },
      uWind: { value: new THREE.Vector3(...wind) }, uGain: { value: gain } };
    this.mesh = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.U, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: ATMOS_GLSL + LF_GLSL + HL_GLSL + /* glsl */`
        attribute vec2 se; uniform vec3 uBox, uWind; uniform float uFall, uLen; varying float vB; varying vec4 vCP;
        void main(){
          vec3 fwd = normalize(vec3(uHLF.x, 0., uHLF.z));
          vec3 c = uCamPos + fwd * uBox.z * .45;
          vec3 v = vec3(uWind.x, -uFall, uWind.z);
          vec3 p = position * uBox + v * uTime;
          p = mod(p - (c - uBox*.5), uBox) + (c - uBox*.5);
          p.y = mod(p.y, uBox.y);
          p += normalize(v) * uLen * se.x * (.6 + .8*se.y);
          vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; vCP = gl_Position;
          vec3 n = -normalize(p - uHL0);
          float e = min(hlE(p, uHL0, n) + hlE(p, uHL1, n), .25);
          vec3 L = lightAt(p) * exp(-max(p.y - 0., 0.) / 30.);
          float d = -mv.z;
          vB = (e * .6 + dot(L, vec3(.33)) * .05 + .002) * smoothstep(3., 9., d) * exp(-d / 40.);
        }`,
      fragmentShader: `uniform sampler2D tDepth; uniform float uOcc, uGain; varying float vB; varying vec4 vCP;
        void main(){ vec3 ndc = vCP.xyz / vCP.w; if (uOcc > .5 && texture2D(tDepth, ndc.xy*.5+.5).r < ndc.z*.5+.5) discard;
          gl_FragColor = vec4(vec3(.8, .85, .9) * vB * uGain * .12, 1.); }` }));
    this.mesh.frustumCulled = false; this.mesh.userData.noReflect = true;
    atmos.overlay.add(this.mesh);
  }
}

// ------------------------------------------------------------------ Truck: 53 ft trailer, tractor, lights and spray
export class Truck {
  constructor(world, atmos, lf, hl, { x = 5.5, z = -60, patch = null } = {}) {
    const dark = [boxAt(2.3, 0.12, 0.12, 0, 0.55, 8.2), boxAt(0.1, 0.5, 0.1, -1.0, 0.8, 8.15), boxAt(0.1, 0.5, 0.1, 1.0, 0.8, 8.15),
      boxAt(0.03, 2.8, 0.02, 0, 2.65, 8.06), ...[-1.2, -0.05, 0.05, 1.2].flatMap(xx => [0.8, 1.7, 2.6, 3.5].map(yy => boxAt(0.06, 0.08, 0.04, xx, 1.25 + yy * 0.8, 8.07))),
      boxAt(0.5, 0.6, 0.03, -0.9, 0.55, 7.0), boxAt(0.5, 0.6, 0.03, 0.9, 0.55, 7.0)];
    const ribs = []; for (let zz = -7.9; zz <= 7.9; zz += 0.61) for (const sd of [-1, 1]) ribs.push(boxAt(0.035, 2.8, 0.07, sd * 1.315, 2.65, zz));   // logistic posts
    for (const yy of [1.3, 4.05]) for (const sd of [-1, 1]) ribs.push(boxAt(0.06, 0.12, 16.1, sd * 1.32, yy, 0));
    const parts = [...ribs, boxAt(2.6, 2.9, 16.1, 0, 1.2 + 1.45, 0), boxAt(2.5, 0.25, 16, 0, 1.12, 0),
      boxAt(2.5, 2.4, 3.2, 0, 1.0 + 1.2, -9.8), boxAt(2.4, 1.3, 2.2, 0, 3.8, -9.4), boxAt(2.5, 1.0, 1.2, 0, 1.0, 7.5)];
    const wheels = []; for (const zz of [5.2, 6.4, -6.8, -8.0, -11.0]) for (const sd of [-1, 1]) { const w = new THREE.CylinderGeometry(0.52, 0.52, 0.55, 16); w.rotateZ(Math.PI / 2); w.translate(sd * 1.0, 0.52, zz); wheels.push(w.toNonIndexed()); }
    const body = new THREE.MeshStandardMaterial({ color: '#7e7e7a', roughness: 0.55, metalness: 0.3 }); if (patch) patch(body, lf);
    const blk = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.7, metalness: 0.3 }); if (patch) patch(blk, lf);
    const tire = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
    this.group = new THREE.Group(); this.group.add(new THREE.Mesh(mergeGeometries(parts.map(strip)), body), new THREE.Mesh(mergeGeometries(wheels.map(strip)), tire), new THREE.Mesh(mergeGeometries(dark.map(strip)), blk));
    // rear doors: retroreflective conspicuity tape (red/white) across the bottom and up the corners
    const tape = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.06), new THREE.ShaderMaterial({ uniforms: { ...atmos.U, ...hl.U },
      vertexShader: SIGN_GLSL_V, fragmentShader: ATMOS_GLSL + HL_GLSL + `varying vec2 vUv; varying vec3 vWP; varying vec3 vN; void main(){ float k = step(.5, fract(vUv.x * 8.));
        vec3 c = mix(vec3(.9,.05,.03), vec3(.95), k); float e = hlE(vWP, uHL0, vec3(0,0,1)) + hlE(vWP, uHL1, vec3(0,0,1)); gl_FragColor = vec4(c * (e * (retro(vWP, uHL0) + retro(vWP, uHL1)) * 40. + .01), 1.); }` }));
    tape.position.set(0, 1.25, 8.06); this.group.add(tape);
    this.group.position.set(x, 0, z); world.scene.add(this.group);
    for (const sd of [-1, 1]) { lf.add({ pos: [x + sd * 1.05, 1.3, z + 8.1], color: '#ff1406', i: 3, core: 0.09, halo: 0.6, minPx: 1.5 });
      lf.add({ pos: [x + sd * 1.25, 4.0, z + 8.05], color: '#ff2a0a', i: 1.4, core: 0.05, halo: 0.3, minPx: 1.1 });
      lf.add({ pos: [x + sd * 1.3, 2.2, z - 11.2], color: '#ffae40', i: 1.2, core: 0.05, halo: 0.3, minPx: 1.0 }); }
    // spray: soft lit mist behind the tandems (overlay points, lit by our low beams)
    const n = 900, P = new Float32Array(n * 3), R = new Float32Array(n);
    let q = 777; const rnd = () => (q = (q * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) { const t = rnd(); P.set([x + (rnd() - 0.5) * (2.6 + t * 2.5), 0.3 + rnd() * (0.5 + t * 3.2), z + 8 + t * 22], i * 3); R[i] = 0.5 + t * 1.6; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('rad', new THREE.BufferAttribute(R, 1));
    const F = atmos.frameU;
    const sp = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: { ...atmos.U, ...lf.U, ...hl.U, tDepth: F.tDepth, uOcc: F.uOcc, uRes: F.uRes, uFovY: { value: 0.8 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: ATMOS_GLSL + LF_GLSL + HL_GLSL + `attribute float rad; uniform vec2 uRes; varying float vB; varying vec4 vCP;
        void main(){ vec4 mv = viewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vCP = gl_Position; float d = -mv.z;
          vec3 n = -normalize(position - uHL0); float e = hlE(position, uHL0, n) + hlE(position, uHL1, n);
          vB = min(e, .2) * .25 + dot(lightAt(position), vec3(.33)) * .02 + .001; gl_PointSize = min(rad * uRes.y / (1.3 * d), 240.); }`,
      fragmentShader: `uniform sampler2D tDepth; uniform float uOcc; varying float vB; varying vec4 vCP;
        void main(){ vec3 ndc = vCP.xyz / vCP.w; if (uOcc > .5 && texture2D(tDepth, ndc.xy*.5+.5).r < ndc.z*.5+.5) discard;
          float r = length(gl_PointCoord - .5); float a = exp(-r*r*14.) * (1. - smoothstep(.4, .5, r)); gl_FragColor = vec4(vec3(.8,.82,.85) * vB * a * .015, 1.); }` }));
    sp.frustumCulled = false; sp.userData.noReflect = true; atmos.overlay.add(sp); this.spray = sp;
  }
}

// ------------------------------------------------------------------ pass 2: the road does not end in a void
// Roadside: earth berms (the road on its fill), an overpass with lamps, tree lines and fields to the horizon (Hades cards),
// a far lit town with its water tower and a radio mast, so the vanishing point has a place in it.
export class Roadside {
  constructor(world, atmos, lf, { hw, over = -780, fieldsTo = -16000, town = { x: 380, z: -5200, n: 260 }, patch = null, trees = true, CD = null, seed = 7 } = {}) {
    let q = seed * 7919; const rnd = () => (q = (q * 1664525 + 1013904223) >>> 0) / 4294967296;
    const W = hw ? hw.W : 14.6, xm = hw ? hw.xm : -1.65, xL = xm - 0.45 - MUTCD.shoulderL - W - MUTCD.shoulderR - 6, xR = W + MUTCD.shoulderR + 14;
    const mat = (c, r = 0.95) => { const m = new THREE.MeshStandardMaterial({ color: c, roughness: r }); if (patch) patch(m, lf); return m; };
    // fields to the horizon on both sides (the verge falls off the fill: the road sits 2 m up)
    const fg = new THREE.PlaneGeometry(40000, Math.abs(fieldsTo) + 400, 8, 8); fg.rotateX(-Math.PI / 2); fg.translate(0, -2.2, (fieldsTo + 400) / 2);
    const fields = new THREE.Mesh(fg, mat('#1c1a14')); fields.userData.noReflect = true; world.scene.add(fields);
    const berm = [];
    for (const [a, b] of [[xL, xL - 16], [xR, xR + 16]]) { const g = new THREE.BufferGeometry(), z0 = 250, z1 = fieldsTo * 0.2;
      const P = [a, 0.02, z0, b, -2.2, z0, b, -2.2, z1, a, 0.02, z0, b, -2.2, z1, a, 0.02, z1]; g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); berm.push(g); }
    const bm = new THREE.Mesh(mergeGeometries(berm), mat('#24221a')); bm.material.side = THREE.DoubleSide; bm.userData.noReflect = true; world.scene.add(bm);
    // the overpass: a county road over the interstate, 2 m deep girders, parapets, piers in the median and beyond the shoulders, lamps
    if (over) { const y = MUTCD.clearance + 0.6, parts = [boxAt(xR - xL + 40, 1.9, 11, (xL + xR) / 2, y + 0.95, over), boxAt(xR - xL + 40, 1.0, 0.35, (xL + xR) / 2, y + 2.4, over + 5.4), boxAt(xR - xL + 40, 1.0, 0.35, (xL + xR) / 2, y + 2.4, over - 5.4)];
      for (const px of [xm, xL + 3, xR - 3]) for (const pz of [-3.5, 3.5]) parts.push(boxAt(1.1, y, 1.1, px, y / 2, over + pz));
      for (const px of [xm, xL + 3, xR - 3]) parts.push(boxAt(1.4, 1.2, 9.5, px, y - 0.6, over));
      world.scene.add(new THREE.Mesh(mergeGeometries(parts.map(strip)), mat('#6e6a64', 0.85)));
      for (let x = xL - 10; x < xR + 20; x += 32) lf.add({ pos: [x, y + 10, over + 4.8], color: '#ffae5a', i: 3, core: 0.3, halo: 0.6, minPx: 1.3, pool: { r: 8, i: 10 } });
      for (let k = 0; k < 3; k++) lf.add({ pos: [xL - 120 - k * 90 + rnd() * 20, 1.4, over + (rnd() - 0.5) * 6], color: '#fff4e6', i: 2, core: 0.12, halo: 0.5, minPx: 1.1 }); }   // cars on the county road
    // tree lines and far rows (Hades cards): shelterbelts, a farmstead's windbreak, the far edge of the county
    if (trees && CD) new CD.SilhouetteRows(world, atmos, lf, [
      { z: -1500, x0: -900, x1: -80, hMax: 16, y: -2.2, seed: 21 }, { z: -1900, x0: 60, x1: 1100, hMax: 18, y: -2.2, seed: 22 },
      { z: -3200, x0: -1800, x1: 1600, hMax: 17, y: -2.2, seed: 23, ppm: 1.5 }, { z: -6500, x0: -4000, x1: 4200, hMax: 20, y: -2.2, seed: 24, ppm: 0.8 } ],
      { kind: 'trees', body: '#0c0d0c', edge: '#000000', edgeGain: 0 });
    // the far town: sodium grid, a lit water tower, a radio mast with its red lights, a grain elevator floodlit
    if (town) { const { x, z, n } = town;
      for (let i = 0; i < n; i++) { const a = rnd() * 6.283, d = Math.sqrt(rnd()) * 900; if (rnd() < 0.35) continue;
        lf.add({ pos: [x + Math.round(Math.cos(a) * d / 90) * 90, 7, z + Math.round(Math.sin(a) * d * 0.5 / 90) * 90], color: rnd() < 0.75 ? '#ffae5a' : '#fff0dc', i: 2.2, core: 0.4, halo: 0.6, minPx: 1.2, pool: { r: 10, i: 12 } }); }
      lf.add({ pos: [x - 200, 46, z + 100], color: '#ff1a0a', i: 5, core: 0.4, halo: 0.6, minPx: 1.6 });
      lf.add({ pos: [x + 350, 40, z - 60], color: '#fff4e0', i: 9, core: 1.2, halo: 0.9, pool: { r: 30, i: 30 } });
      for (const h of [60, 120, 180]) lf.add({ pos: [x - 1400, h, z - 800], color: '#ff1a0a', i: 5, core: 0.4, halo: 0.5, minPx: 1.4, blink: h === 180 ? { period: 1.5, duty: 0.35, phase: 0 } : null }); }
  }
}
