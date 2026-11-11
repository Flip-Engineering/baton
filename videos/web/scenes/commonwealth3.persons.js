// COMMON WEALTH v15: Dot, Marcus and Ray as real people, from the client's person pipeline (lib/fx/person: makePerson, the
// studio's one current person; research/capabilities/human.md). They replace the cutout heroes (lib/fx/people.js under the
// scene's silhouette pass) in the shots where a face or a hand is the point: SMALL FARMERS. (Dot), RAIL STRIKERS. (Marcus,
// lantern up), STEELWORKERS. (Ray at the pour), WE ALL UNITE. (Dot and Marcus clasp) and SAME HANDS. (the match cut).
//
// Each person is built once at load (the page reads the anatomy layers' keyed bakes; it solves nothing), added hidden, and
// posed per frame by the scene with the person's own poser (two-bone IK on the person's kinematics, the hand's grip solver).
// A person that fails to build is left out and logged, and the scene falls back to its old figure for that role, so a
// pipeline change on main can never stop the render.
import * as THREE from 'three';

export async function castPeople(scene, roles) {
  const out = {};
  let PI;
  try { PI = await import('../lib/fx/person/index.js'); }
  catch (e) { console.log('[cw15] person pipeline did not load:', String(e && e.message || e)); return out; }
  let st;
  try { st = await PI.loadPersonStudio(); }
  catch (e) { console.log('[cw15] person studio did not load:', String(e && e.message || e)); return out; }
  for (const [role, name] of Object.entries(roles)) {
    const t0 = performance.now();
    try {
      const P = await PI.makePerson(name, { studio: st, stage: 'yard@5' });
      const g = P.h.group;
      g.visible = false;
      g.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      scene.add(g);
      const hp = await PI.poserOf(P);
      const after = () => { try { (PI.afterPose7 || PI.afterPose)(P); } catch (e) { P.h.update(); } };
      out[role] = { name, P, h: P.h, hp, after };
      console.log(`[cw15] ${role} = ${name} built in ${Math.round(performance.now() - t0)} ms` + (P.report?.seams?.length ? ` (seams: ${P.report.seams.length})` : ''));
    } catch (e) {
      console.log(`[cw15] ${role} = ${name} failed to build:`, String(e && e.stack || e).slice(0, 400));
    }
  }
  return out;
}

// heading (rotation.y) that turns a figure's +z toward the point (x, z)
export const headingTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

// shortest-path blend of two headings
export function lerpHeading(a, b, k) {
  let d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * k;
}

// a storm lantern (kerosene, wire guard, glass globe, bail) for Marcus's raised hand; the flame is emissive and the scene
// puts a light at it
export function makeLantern() {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.55, metalness: 0.6 });
  const tin = new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 0.4, metalness: 0.75 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffd8a0, emissive: new THREE.Color(1.0, 0.62, 0.28), emissiveIntensity: 2.2, roughness: 0.15, transparent: true, opacity: 0.9 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.07, 18), tin); base.position.y = -0.28; g.add(base);
  const glob = new THREE.Mesh(new THREE.SphereGeometry(0.068, 18, 14), glass); glob.scale.set(1, 1.35, 1); glob.position.y = -0.17; g.add(glob);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 0.06, 18), tin); cap.position.y = -0.06; g.add(cap);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4, w = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.2, 5), iron); w.position.set(Math.cos(a) * 0.078, -0.17, Math.sin(a) * 0.078); g.add(w); }
  const bail = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.005, 6, 20, Math.PI), iron); bail.position.y = -0.04; g.add(bail);
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  const flame = new THREE.Vector3(0, -0.17, 0);
  return { root: g, flame, glass };
}
