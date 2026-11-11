// ART kit / BANNER: the carried ACP banner as cloth, not a flat red plane. Built on sim2/flag.js (baked cloth,
// bunting shader with transmission), plus the house print, a carrier from hero.js, red dust lit by the low sun.
//
//   import { bannerShot, bannerArt } from '../lib/fx/art/banner.js';
//   const shot = await bannerShot(st, { cam: 'low', t0: 0, t1: 8 });  shot.frame(t) -> canvas
//   bannerArt({ w, h })  -> the print: press-red bunting, the ACP emblem (gear, hammer and sickle, FOUR stripes) in stock,
//                           a hemmed sleeve, weave; no gradient, no glow
// Dialect: POSTER / NEWSREEL red world. No sun disc in frame (THE GIANT owns the disc): the sun is behind and above, and
// shows as light THROUGH the cloth (the emblem reads dark against it, as on a real banner against the sky).
import * as THREE from 'three';
import { Flag, printCanvas } from '../sim2/flag.js';
import { acpEmblem } from '../../kit.js';
import { Fume } from './molten.js';
import { INK } from './tokens.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export function bannerArt({ w = 1800, h = 1200, ground = INK.red, ink = INK.stock } = {}) {
  return printCanvas({ w, h, ground, draw: (x, W, H) => {
    acpEmblem(x, W * 0.42, H * 0.5, H * 0.64, { color: ink });
    x.fillStyle = 'rgba(0,0,0,0.18)'; x.fillRect(0, 0, W * 0.035, H);          // the pole sleeve, doubled cloth
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, H - 14, W, 14); x.fillRect(0, 0, W, 14);   // hems
  } });
}

function skyDome(scene, { top = '#2a0806', hor = '#b8401c', low = '#3a0c06', sun = V3(0.2, 0.35, -1), glow = '#ff9a50' } = {}) {
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: new THREE.Color(top) }, uHor: { value: new THREE.Color(hor) }, uLow: { value: new THREE.Color(low) }, uSun: { value: sun.clone().normalize() }, uGlow: { value: new THREE.Color(glow) } },
    vertexShader: 'varying vec3 vp; void main(){ vp = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 uTop, uHor, uLow, uSun, uGlow; varying vec3 vp;
      void main(){ vec3 d = normalize(vp); float h = d.y; vec3 c = mix(uHor, uTop, smoothstep(0.0, 0.6, h)); c = mix(uLow, c, smoothstep(-0.2, 0.0, h));
        float s = max(dot(d, uSun), 0.0); c += uGlow * pow(s, 3.0) * 0.35;
        // stepped in HORIZONTAL bands like a screened sky (the poster rule): step the height, not the colour
        float hb = floor(h * 14.0) / 14.0; vec3 cb = mix(uHor, uTop, smoothstep(0.0, 0.6, hb)); cb = mix(uLow, cb, smoothstep(-0.2, 0.0, hb));
        c = mix(c, cb + uGlow * pow(s, 3.0) * 0.35, 0.7); gl_FragColor = vec4(c, 1.0); }` });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), m); mesh.userData.gbuffer = false; scene.add(mesh); return mesh;
}

export async function bannerShot(st, o = {}) {
  const { t0 = 0, t1 = 8, cam = 'low', carrier = true, seed = 3 } = o;
  const S = st.scene, R = st.r;
  const sunDir = V3(0.25, 0.3, -1).normalize();
  skyDome(S, { sun: sunDir });
  S.fog = new THREE.FogExp2('#8a2a14', 0.018);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#5a1c10', roughness: 1 })); ground.receiveShadow = true; S.add(ground);
  const sun = new THREE.DirectionalLight('#ffc890', 2.2); sun.position.copy(sunDir).multiplyScalar(60); S.add(sun);
  const rim = new THREE.DirectionalLight('#ff7040', 1.2); rim.position.set(-8, 6, -20); S.add(rim);
  S.add(new THREE.HemisphereLight('#6a2418', '#1a0604', 0.45));
  // the carrier plants the pole: hands on it at chest and hip, the pole leaning into the wind
  let hero = null, poleBase = V3(0.1, 0, 0.2), poleTop = V3(0.45, 6.2, 0);
  if (carrier) {
    hero = st.hero({ variant: 'plains', height: 1.84, kind: 'coat', shirt: '#2a1a14', trousers: '#1e1512', hat: 'cap', hatColor: '#1a1210', beard: 0.4, stubble: 0.8, skin: '#8a5a40', seed: 29, dirt: 0.5, gloves: 'work', gloveColor: '#2a1c14' });
    st.stand(hero, { x: 0, y: 0, z: 0, turn: 0.55, t: 'bind', nod: -0.12, chest: -0.05 });
    hero.gesture('R', 'LINE_LO', { fist: false }); hero.gesture('L', 'RAIL', { fist: false }); hero.update();
    const gR = st.gripAt(hero, 'R', V3(0.05, 1, -0.07), 0.028); const d = V3(0.06, 1, -0.07).normalize();
    poleBase = gR.p.clone().addScaledVector(d, -1.3); poleTop = gR.p.clone().addScaledVector(d, 5.0);
    st.gripAt(hero, 'L', d, 0.028);
  }
  const art = bannerArt({});
  const flag = new Flag(S, { w: 3.3, h: 2.2, nx: 48, ny: 32, t0, t1, art, color: INK.red, wind: { dir: [1, 0.05, 0.35], speed: 11, gust: 0.5, turb: 0.55 },
    pole: () => ({ base: poleBase.toArray(), top: poleTop.toArray() }), poleR: 0.03, seed, bend: 0.08, poleColor: '#2a221e' });
  flag.setLight({ sun: sunDir, sunColor: new THREE.Color('#ffb070').multiplyScalar(1.8), sky: new THREE.Color('#5a2018').multiplyScalar(0.5), ground: new THREE.Color('#3a0c06').multiplyScalar(0.3), trans: 0.55, fog: new THREE.Color('#8a2a14'), fogDensity: 0.018 });
  // blowing dust: sideways cards, lit by the sun from behind
  const dust = new Fume(S, { base: [-6, 0, -6], height: 8, width: 18, n: 6, seed: 7, color: '#6a2414', rise: 0.15, alpha: 0.35 });
  const dust2 = new Fume(S, { base: [2, 0, 3], height: 4, width: 10, n: 3, seed: 11, color: '#7a2a16', rise: 0.2, alpha: 0.2 });
  const CAMS = { low: { pos: [-1.3, 0.7, 3.4], look: [0.8, 3.2, 0], fov: 52 }, wide: { pos: [-3, 1.4, 9], look: [0.8, 3.0, 0], fov: 46 } };
  const C = CAMS[cam] || CAMS.low; st.lookAt(V3(...C.pos), V3(...C.look), C.fov);
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.0;
  const out = document.createElement('canvas'); out.width = st.W; out.height = st.H; const g = out.getContext('2d');
  return { st, flag, hero, frame(t) { flag.update(t); dust.update(t, st.camera, { color: new THREE.Color('#ffa060'), power: 0.5 }); dust2.update(t, st.camera, { color: new THREE.Color('#ffa060'), power: 0.4 });
    g.drawImage(st.renderLit(), 0, 0); return out; } };
}
