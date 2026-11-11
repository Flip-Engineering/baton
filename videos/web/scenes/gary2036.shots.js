// GARY 2036 c2 / the shots: the timeline in seconds, each shot's light, state and camera. A shot's setup(SC, T, S) sets what is shown
// (SC.ST), the camera, and returns the light rig. T is the shot's quantised render time (the 3D holds between its frames).
// the calendar: old Gary counts from 1906 (hold at 1906, 1908, 1930), the new city from 2027 (one year every 1.6 s)
export const yOldAt = T => T < 1.0 ? 0 : T < 3.2 ? mixf(0, 2.7, smf(1.0, 3.2, T)) : T < 4.6 ? 2.7 : T < 7.2 ? mixf(2.7, 24, smf(4.6, 7.2, T)) : 24;
export const yNewAt = T => 10 * Math.max(0, Math.min(1, T / 16.8));
function smf(a, b, x) { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); }
function mixf(a, b, t) { return a + (b - a) * t; }
// v4 (3 Oct, after the client's 'cumbersome ... doesnt adequately work the concepts together'): the precedent now has its
// cost (decline: built for one company, the company's jobs left, so did the people), the Program answers it, and the 2027
// stake is the 1906 shot again, framed the same, at the new site. review/GARY_2036_c20/CRITIQUE.md.
export const END_T = { stake: 6.0, gary: 14.4, decline: 21.6, plan: 27.6, stake2: 31.2, build: 48.0, city: 52.8, station: 58.8, next: 61.8, plaza: 67.2 };
// the decline: the town holds full to 1960, then empties back toward its 1915 size by 2020 (the mill stays)
export const yDeclineAt = T => T < 3.6 ? 24 : mixf(24, 9, smf(3.6, 6.0, T));
export const yearDeclineAt = T => T < 1.0 ? 1930 + 30 * smf(0, 1.0, T) : T < 3.6 ? 1960 : 1960 + 60 * smf(3.6, 6.0, T);
const sm = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mix = (a, b, t) => a + (b - a) * t;

export const SHOTS = [
  { id: 'stake', t0: 0, t1: END_T.stake, fps: 30, lens: { focal: 28, fstop: 5.6, focus: 9 },
    setup({ ST, camera, V3, useRig }, T) {
      Object.assign(ST, { yOld: 0, yNew: 0, wet: 0, night: 0 }); Object.assign(ST.show, { stake: true, scrub: true });
      const u = cl(T / 6.0); camera.fov = 38;
      camera.position.set(-4.6 + 1.2 * u, 1.05 + 0.5 * u, 8.8 - 1.0 * u); camera.lookAt(0.25, 1.0 + 0.1 * u, -3.0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('dawn');
    } },
  { id: 'gary', t0: END_T.stake, t1: END_T.gary, fps: 30, lens: { focal: 24, fstop: 8, focus: 200 },
    setup({ ST, camera, V3, useRig }, T) {
      // 1906 empty; 1908 first iron; then the town fills to 1930
      const y = yOldAt(T);
      Object.assign(ST, { yOld: y, yNew: 0, wet: 0, night: 0 }); Object.assign(ST.show, { gary: true, scrub: y < 3.2, stakeOnly: y < 3.2 });
      const s = cl(T / 8.4), e = s * s * (3 - 2 * s);
      camera.fov = mix(40, 52, e); camera.position.set(-3 + 4 * e, 1.5 + 70 * Math.pow(e, 1.4), 9 + 60 * e * e); camera.lookAt(0, 6 + 14 * e, -420 * (0.25 + 0.75 * e)); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('smoke');
    } },
  { id: 'decline', t0: END_T.gary, t1: END_T.decline, fps: 30, lens: { focal: 24, fstop: 8, focus: 200 },
    setup({ ST, camera, V3, useRig }, T) {
      // the same camera the town ended on, drifting back and up as the town thins
      const y = yDeclineAt(T), d = smf(0, 7.2, T);
      Object.assign(ST, { yOld: y, yNew: 0, wet: 0, night: 0 }); Object.assign(ST.show, { gary: true });
      camera.fov = 52 + 3 * d; camera.position.set(1 + 5 * d, 71.5 + 14 * d, 69 + 16 * d); camera.lookAt(0, 20 - 4 * d, -420); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('smoke');
    } },
  { id: 'plan', t0: END_T.decline, t1: END_T.plan, fps: 30, lens: { focal: 24, fstop: 11, focus: 1500 },
    setup({ ST, camera, V3, useRig, beacons, lineGlow, streak, CX, CZ }, T) {
      T = T * 1.6;                                                  // v4: the same move in 6 s instead of 9.6
      Object.assign(ST, { yOld: 0, yNew: 0, wet: 0, night: 0 }); Object.assign(ST.show, { plan: true });
      const tb = [0.2, 2.0, 3.8, 4.2, 4.6, 5.0];
      beacons.forEach((b, k) => { const p = sm(tb[k], tb[k] + 0.9, T), u = b.userData; b.visible = p > 0.001; u.beam.scale.set(1, Math.max(0.001, p), 1); u.ring.scale.setScalar(Math.max(0.001, p)); u.ring2.scale.setScalar(Math.max(0.001, p)); });
      const reach = sm(5.4, 7.0, T) * 16000; lineGlow.scale.x = Math.max(0.01, reach);
      const sx = sm(7.2, 9.4, T); streak.visible = T > 7.2 && T < 9.5; streak.position.x = CX + sx * 14000 - 200;
      camera.fov = 52; camera.position.set(CX - 1150 + T * 80, 330 + T * 12, CZ + 100 + 300 - T * 6); camera.lookAt(CX + 3800, 40, CZ + 100); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('gold');
    } },
  { id: 'stake2', t0: END_T.plan, t1: END_T.stake2, fps: 30, lens: { focal: 28, fstop: 5.6, focus: 9 },
    setup({ ST, camera, V3, useRig, line, CX, CZ }, T) {
      // 2027: the 1906 shot again, the same framing on the new stake (driver2 stands where driver1 stood, offset to the site)
      Object.assign(ST, { yOld: 0, yNew: 0, wet: 0, night: 0, lit: 0.3 }); Object.assign(ST.show, { city: true, site: true, survey: true }); ST.crewClear = true;   // nobody between the camera and the stake
      line.setReach(0);
      const u = cl(T / 6.0); camera.fov = 38;
      camera.position.set(CX - 4.6 + 1.2 * u, 1.05 + 0.5 * u, CZ + 8.8 - 1.0 * u); camera.lookAt(CX + 0.25, 1.0 + 0.1 * u, CZ - 3.0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('dawn2');
    } },
  { id: 'build', t0: END_T.stake2, t1: END_T.build, fps: 30, lens: { focal: 24, fstop: 11, focus: 300 },
    setup({ ST, camera, V3, useRig, line, CX, CZ }, T) {
      const yr = yNewAt(T), s = cl((T - 1.8) / 15.0), e = s * s * (3 - 2 * s), h = 1.7 + 300 * Math.pow(e, 1.35);   // v5: ends lower and oblique: a skyline, not a map
      Object.assign(ST, { yOld: 0, yNew: yr, wet: 0, night: 0, lit: 0.3 }); Object.assign(ST.show, { city: true, line: true, cranes: true, site: T < 9, survey: T < 9 });
      line.setReach(6800 * sm(5.0, 9.0, yr));
      camera.fov = mix(46, 62, Math.min(1, e * 2.2)); camera.position.set(CX + 5 - 12 * e, h, CZ + 9 + 1.15 * h); camera.lookAt(CX + 30 * e, 1 + 0.16 * h + 48 * sm(1.8, 6, T) + 0.12 * h * sm(6, 12, T), CZ - mix(0.55, 3.2, Math.min(1, e * 1.6)) * h - 170 * sm(1.8, 6, T));   // v7: aimed past the plaza (an empty disc) onto the blocks that rise first camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig(T < 9.5 ? 'day' : 'gold');
    } },
  { id: 'city', t0: END_T.build, t1: END_T.city, fps: 30, lens: { focal: 24, fstop: 8, focus: 120 },
    setup({ ST, camera, V3, useRig, line, mirrorOn, CX, CZ, ease }, T) {
      Object.assign(ST, { yOld: 0, yNew: 10, wet: 1, night: 1, lit: 0.22 + 0.2 * cl(T / 4.8), glow: 3.0 }); Object.assign(ST.show, { city: true, line: true, lamps: true, next: true });
      line.setReach(6800); mirrorOn.v = true;
      const u = cl(T / 4.8), e = u * u * (3 - 2 * u);
      camera.fov = 58; camera.position.set(CX + 14 - 10 * e, mix(95, 20, e), CZ + mix(620, 190, e)); camera.lookAt(CX, mix(30, 24, e), CZ - 220); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('blue');
    } },
  { id: 'station', t0: END_T.city, t1: END_T.station, fps: 30, lens: { focal: 24, fstop: 8, focus: 40 },
    setup({ ST, camera, V3, useRig, line, mirrorOn, train, train2, platformUpdate, CX, CZ }, T) {
      Object.assign(ST, { yOld: 0, yNew: 10, wet: 1, night: 1, lit: 0.4, glow: 3.0 }); Object.assign(ST.show, { city: true, line: true, lamps: true, station: true, train: true, next: true });
      line.setReach(6800); mirrorOn.v = true;
      const u = cl((T - 0.3) / 4.5), xTip = -110 + 1115 * Math.pow(1 - u, 1.6);     // v4: 6 s; the train comes all the way in
      train2(xTip); train.visible = true; train.userData.winM.emissiveIntensity = 4; platformUpdate(T, true);
      camera.fov = 58; camera.position.set(CX - 128, 10.75, CZ + 100 + 5.0); camera.lookAt(CX + 300, 11.9 - 0.4 * cl((T - 4.8) / 1.2), CZ + 100 + 1.6); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('blue');
    } },
  { id: 'next', t0: END_T.station, t1: END_T.next, fps: 30, lens: { focal: 24, fstop: 11, focus: 800 },
    setup({ ST, camera, V3, useRig, line, mirrorOn, train, train2, CX, CZ, ease }, T) {
      Object.assign(ST, { yOld: 0, yNew: 10, wet: 1, night: 1, lit: 0.45, glow: 3.0 }); Object.assign(ST.show, { city: true, line: true, lamps: true, station: true, train: true, next: true });
      line.setReach(6800); mirrorOn.v = true; train2(-110); train.visible = true; train.userData.winM.emissiveIntensity = 4;
      const u = cl(T / 3.0), e = u * u * (3 - 2 * u);
      camera.fov = 60; camera.position.set(CX - 140 - 40 * e, mix(14, 150, e), CZ + 100 + mix(7, 60, e)); camera.lookAt(CX + 5400, mix(12, 60, e), CZ + 100); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return useRig('blue');
    } },
  { id: 'plaza', t0: END_T.next, t1: END_T.plaza, fps: 30, lens: { focal: 24, fstop: 5.6, focus: 12 },
    setup({ ST, camera, V3, useRig, line, mirrorOn, markMesh, pillarM, markM, citizensUpdate, CX, CZ }, T) {
      Object.assign(ST, { yOld: 0, yNew: 10, wet: 1, night: 1, lit: 0.5, glow: 3.0 }); Object.assign(ST.show, { city: true, line: true, lamps: true, plaza: true });
      line.setReach(6800); mirrorOn.v = true; citizensUpdate(T, true);
      const u = cl(T / 5.4), e = u * u * (3 - 2 * u), r = sm(2.0, 3.8, T);
      markMesh.visible = false;   // v4: the closer carries the mark (it floated beside the benchmark like a stray logo)
      void r; markMesh.scale.set(2 * (0.02 + 1.1 * r), 0.01 + 1.1 * r, 1); markMesh.position.y = 0.06 + 0.35 * r; markMesh.rotation.y = 0;
      pillarM.opacity = 0;
      camera.fov = 50; camera.position.set(CX - 1.3 + 1.6 * e, mix(1.05, 2.4, e), CZ + mix(4.6, 9.2, e)); camera.lookAt(CX, mix(0.55, 2.6, e), CZ - 1.5); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      markMesh.lookAt(camera.position.x, markMesh.position.y, camera.position.z); markMesh.rotation.x = 0; markMesh.rotation.z = 0;
      return useRig('plaza');
    } },
];
const CY = m => m.getWorldPosition ? 0 : 0;
export function shotAt(t) { for (const s of SHOTS) if (t < s.t1) return s; return SHOTS[SHOTS.length - 1]; }
