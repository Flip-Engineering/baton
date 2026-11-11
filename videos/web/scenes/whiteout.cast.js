// WHITEOUT (WINTER SHIFT ep.1): the people, from the client's person pipeline (research/series/snowbelt/ep1_brief.md "People"). Every figure
// is a v7 person (lib/fx/person: makePerson('v7:<name>')) playing MOTION's rev 7d acts (row7, lift7, walk7), seen at a distance through
// glass or falling snow: no face is over about 60 px. People are built LAZILY, the first time a shot needs them, so a farm segment builds
// only the people its own shots show (a v7 build is 27-73 s; the page is ready long before). One build per person and clip.
//   L22_f27_black   the ER: at the counter (row7), lifting a supply box and carrying it across the station (lift7); the new hospital (row7)
//   L06_f53_white   the ER and the new hospital (row7)          scrubs: a stand-in (her baked retail outfit recoloured ceil blue, top
//                                                              and trousers) until CLOTHING bakes scrubTop / scrubPants on her (the brief's request)
//   L03_m38_asian   the new hospital (row7, his gesture arm L)  scrubs: the same stand-in in charcoal
//   L12_f39_white   the site: guides the load (row7's gesture arm R); construction canvas jacket; a hard hat (below)
//   L23_m45_white   the site (row7); trades canvas jacket; a hard hat
//   L21_m32_black   the site; walks out of the heat (walk7)      the canvas jacket over his fleece is not baked: his fleece stands in; a hard hat
//   L17_m28_hispanic inside the heat: carries (lift7); tee and work trousers (it is warm in there)
// Hard hats: v7 has no headwear layer yet (person/v2.js builds every person hat: 'none'). Until HUMAN lands one, the builders wear a
// scene-local white hard hat with a knit liner, attached to the head bone (it rides every clip), sized from the person's own head top.
import * as THREE from 'three';
import { loadPersonStudio, makePerson } from '../lib/fx/person/index.js';
import { afterPose7, ensureSkinSSS } from '../lib/fx/person/v7.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SCRUBS = { L06_f53_white: 0xa3c4dc, L03_m38_asian: 0x3a3d44 };
const HATS = new Set(['L12_f39_white', 'L23_m45_white', 'L21_m32_black']);
const CLIP_DUR = { row7: 6.0, walk7: 7.0, lift7: 7.0 };

// a garment recoloured: the fabric shader's dye uniforms and the material colour (the weave and its light are kept)
function recolour(P, hex) {
  const c = new THREE.Color(hex); let n = 0;
  P.h.group.traverse(o => { if (!o.isMesh || !o.userData?.k3) return; const g = o.userData.k3.group; if (g !== 'garment' && g !== 'construction' && !/top|bottom|shirt|tee|trouser|pant|chino/i.test(o.userData.k3.name || '')) return;
    if (/shoe|sneaker|boot|sole|lace/i.test(o.userData.k3.name || '')) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) { if (!m) continue; if (m.color) m.color.copy(c); const U = m.uniforms_c6; if (U?.cA) U.cA.value.copy(c); if (U?.cB) U.cB.value.copy(c); if (U?.fWeft) U.fWeft.value.copy(c).multiplyScalar(0.92); n++; } });
  return n;
}
// the hard hat: a shell (a lathe dome), a short front brim, a ridge, and the knit liner's band below; attached to the head bone
function hardHat(P) {
  const h = P.h; h.update?.(); const head = h.bone ? h.bone('head') : null; if (!head) return null;
  // the head's top from the body's own vertices (bind = the stance the person was built in)
  const g = h.body?.geometry; if (!g) return null; g.computeBoundingBox(); const top = g.boundingBox.max.y;
  const hp = head.getWorldPosition(V()), grp = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.LatheGeometry([[0.0, 0.118], [0.05, 0.116], [0.085, 0.104], [0.108, 0.082], [0.12, 0.05], [0.123, 0.012], [0.125, 0.0]].map(([x, y]) => new THREE.Vector2(x, y)), 24).scale(1.0, 1.0, 1.18),
    new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.42, metalness: 0 }));
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.135, 0.012, 24, 1, false, -0.9, 1.8).scale(1, 1, 1.45).translate(0, 0.004, 0.02), shell.material);
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.24).translate(0, 0.118, 0), shell.material);
  const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.112, 0.114, 0.04, 20, 1, true).scale(1, 1, 1.15).translate(0, -0.012, 0), new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.95, side: THREE.DoubleSide }));
  grp.add(shell, brim, ridge, liner);
  grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // seated so the shell's crown clears the head's top by 2 cm, centred over the head joint, a little back
  grp.position.set(hp.x, top - 0.118 + 0.02, hp.z - 0.012); P.h.group.updateMatrixWorld(true);
  head.attach(grp);
  return grp;
}

export class Cast {
  constructor(scene, { log = console.log, dry = false } = {}) { this.scene = scene; this.log = log; this.dry = dry; this.people = new Map(); this.pending = new Map(); this.st = null; this.boxes = new Map(); }
  key(name, clip) { return name + ':' + clip; }
  // build (once) and return { P, M, holder, box } or null; never throws (a person that fails is left out of the shot, said in the log)
  async get(name, clip) {
    const k = this.key(name, clip);
    if (this.people.has(k)) return this.people.get(k);
    if (this.dry) { this.people.set(k, null); return null; }
    if (!this.pending.has(k)) this.pending.set(k, (async () => {
      const t0 = performance.now();
      try {
        this.st = this.st || await loadPersonStudio();
        const P = await makePerson('v7:' + name, { studio: this.st, motion: { clip }, fine7: false });
        const holder = new THREE.Group(); holder.name = 'cast:' + k; holder.add(P.h.group); this.scene.add(holder); holder.visible = false;
        P.h.group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        let recol = 0; if (SCRUBS[name]) recol = recolour(P, SCRUBS[name]);
        let hat = null; if (HATS.has(name)) { try { hat = hardHat(P); } catch (e) { this.log('whiteout: hat ' + name + ' ' + e.message); } }
        let box = null; if (clip === 'lift7') { const b = P.motion?.T?.H?.act?.box || { w: 0.4, h: 0.28, d: 0.3 };
          box = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshStandardMaterial({ color: 0xbfae92, roughness: 0.82 })); box.castShadow = true; box.receiveShadow = true;
          const tape = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, b.d + 0.002), new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.5 })); tape.position.y = b.h / 2 + 0.001; box.add(tape); holder.add(box); }
        const rec = { P, M: P.motion, holder, box, hat, name, clip, dur: CLIP_DUR[clip] || 6 };
        this.log(`whiteout: person ${k} ${Math.round(performance.now() - t0)} ms, motion ${P.report?.v7?.lanes?.motion?.path || '-'}, seams ${P.report?.seams?.length || 0}${recol ? ', scrubs stand-in ' + recol + ' parts' : ''}${hat ? ', hat' : ''}`);
        return rec;
      } catch (e) { this.log('whiteout: person ' + k + ' FAILED ' + String(e?.stack || e).slice(0, 400)); return null; }
    })().then(r => { this.people.set(k, r); return r; }));
    return this.pending.get(k);
  }
  hideAll() { for (const r of this.people.values()) if (r) r.holder.visible = false; }
  // place a built person: the clip at time tc (seconds into it; row7 plays back and forth so an idle never jumps), the holder at
  // pos/yaw (the track moves the person inside the holder from the clip's own origin)
  pose(r, { tc, pos, yaw = 0, pingpong = false }) {
    if (!r) return; r.holder.visible = true; r.holder.position.copy(pos); r.holder.rotation.set(0, yaw, 0);
    let t = Math.max(0, tc);
    if (pingpong) { const d = r.dur, m = t % (2 * d); t = m <= d ? m : 2 * d - m; } else t = Math.min(t, r.dur - 1e-3);
    try { const fr = r.M?.apply?.(t); afterPose7(r.P);
      if (r.box && r.M?.tp) { const tp = r.M.tp, f = tp.frameOf(t); r.box.position.set(tp.chan('boxX', f), tp.chan('boxY', f), tp.chan('boxZ', f)); r.box.rotation.y = tp.chan('boxYaw', f); }
      void fr; } catch (e) { this.log('whiteout: pose ' + r.name + ' ' + e.message); }
    r.holder.updateMatrixWorld(true);
  }
  async sss(lr) { try { await ensureSkinSSS(lr, this.scene); } catch (e) { this.log('whiteout: skin pass ' + e.message); } }
}
