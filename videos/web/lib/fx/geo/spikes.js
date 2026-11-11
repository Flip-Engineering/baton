// geo/spikes: three.js population skyline, one instanced prism per town, height = sqrt(population).
//
//   const spikes = new SpikeMap(geo, THREE, { lod: 'lo' });        // 540x960 target, towns >= 20k (default)
//   spikes.sky(ctx, { horizon });                                    // readable dusk sky behind the transparent render
//   spikes.composite(ctx, spikes.render({ t, ripple, cam: { target, orbit, dist, height, fov } }), { dof: 1 });
//   spikes.screen([lon, lat], spikes.heightOf(pop)) -> screen px for callouts
//
// LOD: 'lo' = towns >= 20k (2,511 prisms) at 540x960, no MSAA; 'hi' = towns >= 5k (7,172) at 720x1280.
// hero: { ll:[lon,lat], pop, color } marks one spike (or a cluster by radius) as the hero: brighter, cream cap,
// a light shaft to the sky. Fog is exponential toward the sky's horizon colour, so the far country dissolves into
// the sky instead of ending in a clipped edge; composite({ dof }) adds a cheap near/far blur band (tilt-shift DOF).
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { clamp, lerp } from '../../kit.js';
import { hash, TAU, hex01, FLAGS } from './data.js';

export const SKY = { dusk: ['#0a0103', '#2b060b', '#8a1a1c', '#e8794a', '#f4d3a8'], ember: ['#070102', '#1a0306', '#4a0a10', '#a01c22', '#e4623a'], night: ['#020204', '#05060c', '#0f1020', '#2a1420', '#6a2a24'] };

export class SpikeMap {
  constructor(G, THREE, { lod = 'lo', width = null, height = null, minPop = null, hScale = 0.13, hMax = 260, fog = '#8a1a1c', hero = null } = {}) {
    const LOD = { lo: { w: 540, h: 960, minPop: 20000 }, hi: { w: 720, h: 1280, minPop: 5000 } }[lod] || { w: 540, h: 960, minPop: 20000 };
    width = width || LOD.w; height = height || LOD.h; minPop = minPop ?? LOD.minPop;
    this.heightOf = pop => Math.min(hMax, Math.sqrt(pop) * hScale);
    this.THREE = THREE; this.w = width; this.h = height; this.flag = FLAGS.towns;
    const R = new THREE.WebGLRenderer({ antialias: lod === 'hi', preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false });
    R.setPixelRatio(1); R.setSize(width, height, false); R.setClearColor('#000000', 0);
    this.renderer = R; this.canvas = R.domElement;
    const scene = new THREE.Scene(); this.scene = scene;
    this.cam = new THREE.PerspectiveCamera(34, width / height, 1, 8000);
    const proj = geoAlbersUsa().fitExtent([[0, 0], [1400, 880]], G.us.nation); this.proj = proj;
    // ground: a baked county map so the spikes stand on real geography
    const tc = document.createElement('canvas'); tc.width = 2048; tc.height = 1288;
    const g = tc.getContext('2d'); g.fillStyle = '#0a0203'; g.fillRect(0, 0, 2048, 1288);
    g.scale(2048 / 1400, 1288 / 880);
    const p2 = geoPath(proj, g), maxW = Math.max(...Object.values(G.us.weight));
    for (const f of G.us.counties) {
      const w = G.us.weight[f.id] || 0, wn = w > 0 ? Math.log10(w) / Math.log10(maxW) : 0;
      g.fillStyle = `rgb(${Math.round(30 + 120 * wn * wn * wn)},${Math.round(5 + 14 * wn * wn * wn)},${Math.round(7 + 12 * wn * wn)})`; g.beginPath(); p2(f); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.4; g.beginPath(); p2(G.us.countyMesh); g.stroke();
    g.globalCompositeOperation = 'lighter';
    for (const c of G.us.cities) { const p = proj([c[0], c[1]]); if (!p) continue; const r = 1 + Math.sqrt(c[2]) * 0.012;
      g.fillStyle = 'rgba(201,31,55,0.12)'; g.beginPath(); g.arc(p[0], p[1], r * 1.8, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,200,160,0.5)'; g.beginPath(); g.arc(p[0], p[1], r * 0.5, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    g.strokeStyle = 'rgba(244,230,208,0.55)'; g.lineWidth = 1; g.beginPath(); p2(G.us.stateMesh); g.stroke();
    g.strokeStyle = 'rgba(244,230,208,0.95)'; g.lineWidth = 1.8; g.beginPath(); p2(G.us.nation); g.stroke();
    const tex = new THREE.CanvasTexture(tc); tex.anisotropy = 8;                  // no colour-space decode: display-referred, like the prisms
    this.fogC = new THREE.Color().setRGB(...hex01(fog));            // raw display values (no sRGB->linear)
    const groundMat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex }, uFogC: { value: this.fogC }, uFogD: { value: 1 / 1400 } },
      vertexShader: `varying vec2 vUv; varying float vD; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 uFogC; uniform float uFogD; varying vec2 vUv; varying float vD;
        void main(){ vec3 c = texture2D(map, vUv).rgb; float f = 1. - exp(-pow(vD * uFogD, 1.6)); gl_FragColor = vec4(mix(c, uFogC, f), 1.); }` });
    this.groundMat = groundMat;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1400, 880), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(700, 0, 440); scene.add(ground);
    // sea: a huge plane under the map so a low camera never sees the edge of the world; fogged like the ground
    // the sea carries the sun: a rippled reflection streak toward the camera (so the foreground water reads, not murk)
    this.sun = new THREE.Vector3(0, 0.05, -1);
    const seaMat = new THREE.ShaderMaterial({ uniforms: { uFogC: { value: this.fogC }, uFogD: groundMat.uniforms.uFogD, uSun: { value: this.sun }, uT: { value: 0 } },
      vertexShader: `varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vec4 mv = viewMatrix * w; vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uFogC, uSun; uniform float uFogD, uT; varying vec3 vW; varying float vD;
        void main(){ vec3 V = normalize(vW - cameraPosition);
          vec2 q = vW.xz; float w1 = sin(dot(q, vec2(.043, .131)) + uT * 1.1), w2 = sin(dot(q, vec2(-.097, .071)) - uT * .7), w3 = sin(dot(q, vec2(.21, .37)) + uT * 2.3);
          vec3 N = normalize(vec3((w1 * .6 + w3 * .4) * .018, 1., (w2 * .6 + w3 * .4) * .03)); vec3 R = reflect(V, N); float k = max(dot(R, normalize(uSun)), 0.);
          float f = 1. - exp(-pow(vD * uFogD, 1.6));
          vec3 c = mix(vec3(.05, .01, .015), uFogC * .8, f);
          c += vec3(1., .78, .55) * (pow(k, 1400.) * 2.5 + pow(k, 160.) * .3) * (1. - f * .4);
          gl_FragColor = vec4(c, 1.); }` });
    this.seaMat = seaMat;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), seaMat); sea.rotation.x = -Math.PI / 2; sea.position.set(700, -0.6, 440); scene.add(sea);
    // spikes (instanced prisms)
    const towns = G.us.cities.filter(c => c[2] >= minPop).map(c => ({ p: proj([c[0], c[1]]), pop: c[2], ll: [c[0], c[1]] })).filter(c => c.p);
    const n = towns.length; this.n = n; this.towns = towns;
    const geo = new THREE.CylinderGeometry(0.62, 1, 1, 4, 1, false); geo.translate(0, 0.5, 0);
    const ig = new THREE.InstancedBufferGeometry(); ig.index = geo.index; ig.attributes.position = geo.attributes.position; ig.attributes.normal = geo.attributes.normal;
    const off = new Float32Array(n * 4);
    towns.forEach((t, i) => { off[i * 4] = t.p[0]; off[i * 4 + 1] = t.p[1]; off[i * 4 + 2] = this.heightOf(t.pop); off[i * 4 + 3] = hash(i, 3); });
    ig.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4)); ig.instanceCount = n;
    this.uni = { uGrow: { value: 1 }, uOrigin: { value: new THREE.Vector2(700, 440) }, uR: { value: 3000 }, uW: { value: minPop >= 20000 ? 3.2 : 2.3 }, uT: { value: 0 },
      uFogC: this.groundMat.uniforms.uFogC, uFogD: this.groundMat.uniforms.uFogD, uHero: { value: new THREE.Vector3(0, 0, -1) } };
    const mat = new THREE.ShaderMaterial({ uniforms: this.uni,
      vertexShader: `attribute vec4 aOff; uniform float uGrow, uR, uW, uT; uniform vec2 uOrigin; uniform vec3 uHero; varying float vH, vY, vSide, vF, vD, vHero;
        void main(){ float d = distance(aOff.xy, uOrigin); float k = clamp((uR - d) / 180., 0., 1.); k = 1. - pow(1. - k, 3.);
          float h = aOff.z * uGrow * k; float w = uW * (0.8 + 0.5 * clamp(aOff.z / 60., 0., 2.));
          vHero = uHero.z > 0. ? 1. - smoothstep(uHero.z * .6, uHero.z, distance(aOff.xy, uHero.xy)) : 0.;
          w *= 1. + vHero * .6;
          vec3 p = vec3(aOff.x + position.x * w, position.y * max(h, .01), aOff.y + position.z * w);
          vH = aOff.z; vY = position.y; vSide = abs(normal.x) > .5 ? 1. : 0.; vF = exp(-pow((uR - d) / 120. - .5, 2.) * 2.) * step(0., uR - d);
          vec4 mv = modelViewMatrix * vec4(p, 1.); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uFogC; uniform float uFogD; varying float vH, vY, vSide, vF, vD, vHero;
        void main(){ vec3 red = vec3(.79,.12,.2), cream = vec3(.96,.9,.82), deep = vec3(.25,.02,.04);
          float hk = clamp(vH / 60., 0., 1.);
          vec3 c = mix(deep, red, smoothstep(0., .6, vY)); c = mix(c, cream, smoothstep(.55, 1., vY) * (.35 + .65 * hk));
          c *= mix(1., .62, vSide); c += vec3(1., .8, .6) * vF * .9;
          c = mix(c, mix(red * 1.2, vec3(1., .96, .9), smoothstep(.2, 1., vY)) * mix(1., .75, vSide), vHero);
          float f = 1. - exp(-pow(vD * uFogD * (1. - vHero * .5), 1.6)); gl_FragColor = vec4(mix(c, uFogC, f), 1.); }` });
    this.mesh = new THREE.Mesh(ig, mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.hero = hero;
  }
  // cam: { target:[x,y,z] map units (x east, z south), orbit (rad; 0 = from the south, +pi/2 = from the east), dist, height, fov }
  render({ t = 0, grow = 1, ripple = null, orbit = 0, dist = 1500, height = 900, target = [700, 0, 470], fov = 34, fogColor = null, fogDist = 1400, hero = this.hero, beam = 1, sunScreen = [0.3, 0.36] } = {}) {
    const THREE = this.THREE, u = this.uni;
    u.uGrow.value = grow; u.uT.value = t;
    if (ripple) { const o = this.proj(ripple.origin) || [700, 440]; u.uOrigin.value.set(o[0], o[1]); u.uR.value = ripple.r; } else u.uR.value = 1e5;
    if (fogColor) this.fogC.setRGB(...hex01(fogColor));
    u.uFogD.value = 1 / fogDist;
    if (hero) {
      const p = this.proj(hero.ll); u.uHero.value.set(p[0], p[1], hero.radius || 8);
      this._heroTop = [hero.ll, this.heightOf(hero.pop || 8e6) * grow * (u.uR.value >= 1e5 ? 1 : 1)]; this._beam = beam;
    } else { u.uHero.value.set(0, 0, -1); this._heroTop = null; }
    const c = this.cam; c.fov = fov; c.updateProjectionMatrix();
    c.position.set(target[0] + Math.sin(orbit) * dist, height, target[2] + Math.cos(orbit) * dist);
    c.lookAt(target[0], target[1], target[2]);
    if (sunScreen) {                                               // world direction of the painted sun disc (sky())
      const p = new THREE.Vector3(sunScreen[0] * 2 - 1, 1 - sunScreen[1] * 2, 0.5).unproject(c); this.sun.copy(p.sub(c.position).normalize());
    }
    this.seaMat.uniforms.uT.value = t;
    this.renderer.render(this.scene, c);
    return this.canvas;
  }
  // screen px of a lon/lat (+ height) in an output canvas of size [w, h]
  screen(lonlat, h = 0, w = 1080, hh = 1920) {
    const p = this.proj(lonlat); if (!p) return null;
    const v = new this.THREE.Vector3(p[0], h, p[1]).project(this.cam);
    return [(v.x * 0.5 + 0.5) * w, (-v.y * 0.5 + 0.5) * hh, v.z < 1];
  }
  // readable sky: a graded dusk with the horizon band at `horizon` (0..1 of the height), a sun disc and haze
  sky(ctx, { horizon = 0.42, palette = 'dusk', sun = [0.3, 0.36], sunR = 90, t = 0 } = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height, P = SKY[palette] || palette, hy = H * horizon;
    const g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, P[0]); g.addColorStop(0.45, P[1]); g.addColorStop(0.8, P[2]); g.addColorStop(1, P[3]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, hy + 1);
    const g2 = ctx.createLinearGradient(0, hy, 0, H); g2.addColorStop(0, P[3]); g2.addColorStop(0.08, P[2]); g2.addColorStop(0.4, P[1]); g2.addColorStop(1, P[0]);
    ctx.fillStyle = g2; ctx.fillRect(0, hy, W, H - hy);
    if (sun) {
      const sx = W * sun[0], sy = H * sun[1];
      const gl = ctx.createRadialGradient(sx, sy, 0, sx, sy, sunR * 6); gl.addColorStop(0, 'rgba(255,220,180,0.55)'); gl.addColorStop(0.2, 'rgba(240,120,70,0.25)'); gl.addColorStop(1, 'rgba(200,40,40,0)');
      ctx.fillStyle = gl; ctx.fillRect(sx - sunR * 6, sy - sunR * 6, sunR * 12, sunR * 12);
      ctx.fillStyle = P[4]; ctx.beginPath(); ctx.arc(sx, sy, sunR, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(40,4,8,0.55)';                         // haze strata across the disc
      for (let i = 0; i < 3; i++) { const y = sy + sunR * 0.15 + i * sunR * 0.28; ctx.fillRect(sx - sunR * 1.3, y, sunR * 2.6, 2 + i * 2); }
    }
  }
  // draw the transparent render over the sky. dof: blur amount for the far band (around the horizon) and the near
  // ground (bottom), keeping `focus` (0..1 of the height) sharp: a cheap tilt-shift depth of field.
  composite(ctx, src, { dof = 1, focus = 0.62, band = 0.16, horizon = 0.42 } = {}) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    ctx.drawImage(src, 0, 0, W, H);
    if (this._heroTop && this._beam) {                            // hero light shaft: additive column from the spike tip up
      const p = this.screen(this._heroTop[0], this._heroTop[1], W, H);
      if (p && p[2]) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const bw = 46 * this._beam;
        ctx.translate(p[0], p[1]); ctx.scale(1, p[1] / bw);           // a soft vertical ellipse: tip -> top of frame
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, bw); g.addColorStop(0, `rgba(255,210,170,${0.45 * this._beam})`); g.addColorStop(1, 'rgba(255,120,80,0)');
        ctx.fillStyle = g; ctx.fillRect(-bw, -bw, 2 * bw, bw);
        ctx.globalCompositeOperation = 'source-over'; ctx.restore();
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; const rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], 120);
        rg.addColorStop(0, `rgba(255,230,200,${0.7 * this._beam})`); rg.addColorStop(1, 'rgba(255,120,80,0)'); ctx.fillStyle = rg; ctx.fillRect(p[0] - 120, p[1] - 120, 240, 240); ctx.restore(); }
    }
    if (!dof) return;
    const bw = Math.round(src.width / 5), bh = Math.round(src.height / 5);
    const b = this._blur || (this._blur = document.createElement('canvas')); b.width = bw; b.height = bh;
    const bg = b.getContext('2d'); bg.clearRect(0, 0, bw, bh); bg.drawImage(src, 0, 0, bw, bh);
    const mw = src.width, mh = src.height;                       // mask at the render's size, upscaled once
    const m = this._mask || (this._mask = document.createElement('canvas')); if (m.width !== mw) { m.width = mw; m.height = mh; }
    const mg = m.getContext('2d'); mg.globalCompositeOperation = 'source-over'; mg.clearRect(0, 0, mw, mh);
    mg.imageSmoothingQuality = 'high'; mg.drawImage(b, 0, 0, mw, mh);
    const gr = mg.createLinearGradient(0, 0, 0, mh), f = focus;
    gr.addColorStop(0, `rgba(0,0,0,${dof})`); gr.addColorStop(clamp(horizon + 0.02), `rgba(0,0,0,${dof * 0.9})`);
    gr.addColorStop(clamp(f - band), 'rgba(0,0,0,0)'); gr.addColorStop(clamp(f + band), 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${dof * 0.8})`);
    mg.globalCompositeOperation = 'destination-in'; mg.fillStyle = gr; mg.fillRect(0, 0, mw, mh);
    ctx.drawImage(m, 0, 0, W, H);
  }
}
