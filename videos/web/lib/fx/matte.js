// MATTE (WORLDS studio c1): matte-painting layers by 2.5D projection (Craig Barron's Great Expectations practice).
//   bakeLayer(atmos, objects, cam, { depth, res, keep })  renders only `objects` from the shot camera, once, into a
//        high-resolution HDR plate with alpha, and replaces them with a card at `depth` along the view axis, sized to the
//        frustum there. The card writes depth, so the post pass fogs it at its true distance; a short camera move then
//        gets correct parallax for that plane while the per-frame cost is one textured quad.
//   Card helpers: a plate is linear HDR (not tonemapped), so emissive windows stay emissive after the bake.
// Budget (brief): a bake may take up to 5 minutes once per shot; the live layer stays under 3 s per frame.
import * as THREE from 'three';

export function bakeLayer(atmos, objects, cam, { depth = 3000, res = 2, keep = false, pad = 1.08, name = 'plate' } = {}) {
  const W = atmos.world, r = atmos.renderer, sc = atmos.scene, camera = atmos.camera;
  if (cam) { camera.position.set(...cam.pos); camera.up.set(0, 1, 0); camera.lookAt(...cam.target); camera.fov = cam.fov || camera.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); }
  const t0 = performance.now();
  const w = Math.round(atmos.w * res), h = Math.round(atmos.h * res);
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 0 });
  rt.texture.generateMipmaps = false;
  const set = new Set(objects), hidden = [];
  sc.traverse(o => { if ((o.isMesh || o.isPoints || o.isLine) && !set.has(o) && o.visible) { o.visible = false; hidden.push(o); } });
  // widen the bake frustum a little so the card covers small moves
  const fov0 = camera.fov; camera.fov = 2 * Math.atan(Math.tan(fov0 * Math.PI / 360) * pad) * 180 / Math.PI; camera.updateProjectionMatrix();
  const tm = r.toneMapping; r.toneMapping = THREE.NoToneMapping; r.setClearColor(0x000000, 0);
  r.setRenderTarget(rt); r.clear(); r.render(sc, camera); r.setRenderTarget(null); r.toneMapping = tm; r.setClearColor(0x000000, 1);
  const fovB = camera.fov; camera.fov = fov0; camera.updateProjectionMatrix();
  for (const o of hidden) o.visible = true;
  if (!keep) for (const o of objects) o.visible = false;
  // the card: a plane at `depth` along the view axis covering the (padded) frustum
  const hh = 2 * depth * Math.tan(fovB * Math.PI / 360), ww = hh * camera.aspect;
  const card = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), new THREE.ShaderMaterial({ transparent: false, uniforms: { tPlate: { value: rt.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform sampler2D tPlate; varying vec2 vUv; void main(){ vec4 c = texture2D(tPlate, vUv); if (c.a < .5) discard; gl_FragColor = vec4(c.rgb / max(c.a, 1e-3), 1.); }' }));
  card.position.copy(camera.position).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), depth);
  card.quaternion.copy(camera.quaternion); card.name = name; card.userData.plate = { w, h, depth, ms: Math.round(performance.now() - t0) };
  sc.add(card);
  return card;
}
