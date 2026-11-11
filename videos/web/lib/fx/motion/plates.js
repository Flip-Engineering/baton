// MOTION / PLATES (HUMAN c7): key poses MEASURED from Muybridge's plates, not set by eye.
// Animal Locomotion (1887) photographs one act at the same instants from two or three cameras against a ruled background. This
// module holds 2D joint marks read off a plate and fits them to 3D intents for the motion layer:
//   - scale from the subject's stature on the plate (head top to the floor line) against an assumed stature (Muybridge's men were
//     about 1.70-1.75 m; the background ruling agrees to a few per cent);
//   - depth by Taylor's method ("Reconstruction of articulated objects from point correspondences in a single uncalibrated
//     image", CVIU 2000): with a known segment length l and the scaled image length d of that segment, the relative depth of its
//     two ends is +-sqrt(l^2 - d^2). The sign (in front of / behind) is read from the plate's OTHER view (for 376 the rear-oblique
//     row), which is exactly what the simultaneous cameras are for;
//   - trunk pitch from the trunk's foreshortening in the frontal view (cos pitch = apparent / true shoulder-to-hip height), lateral
//     lean from the shoulder centre's offset over the hips.
// The marks are hand-placed on 3x enlargements of the Wellcome scan with a 10 px grid (HUMAN c7 builder, 2 Oct 2026); they carry a
// read error of about 2-3 px (2-3 cm on the subject). Store more plates the same way: { id, view, statureM, px: { floor, top },
// frames: [{ marks }] , signs }.
import * as THREE from 'three';
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Plate 376, "Striking a blow with a sledge", one man, 12 phases. FRONTAL view (top row): the man faces the camera, so image x
// increasing is HIS LEFT. Pixel units of the Wellcome scan (2400 px wide), relative to each frame's crop (x0 = 360 + 142 k, y0 = 588).
// Marks: hd (centre of the skull), sh (mid shoulders), hp (mid hips), hn (mid of the two hands on the handle), hh (centre of the
// sledge head), aR / aL (ankles). The striking cycle on this plate: 6 is the blow (head on the anvil, out of the frontal frame's
// view below the hands), 7-12 the head swings low past the right thigh and back, 1-3 up over the right shoulder, 4-5 the downswing.
export const PLATE_376 = {
  id: 376, title: 'Striking a blow with a sledge (Muybridge, Animal Locomotion, 1887, plate 376; Wellcome Collection, Public Domain Mark)',
  statureM: 1.72, px: { floor: 236, top: 40 },
  frames: [
    { hd: [70, 52], sh: [73, 72], hp: [75, 132], hn: [20, 58], hh: [2, 48], aR: [42, 228], aL: [112, 228] },
    { hd: [75, 50], sh: [73, 76], hp: [77, 136], hn: [42, 30], hh: [22, 5], aR: [35, 230], aL: [118, 230] },
    { hd: [80, 55], sh: [78, 75], hp: [78, 138], hn: [70, 18], hh: [42, 2], aR: [32, 232], aL: [118, 232] },
    { hd: [88, 58], sh: [80, 80], hp: [65, 140], hn: [100, 32], hh: [68, 3], aR: [22, 232], aL: [108, 232] },
    { hd: [85, 72], sh: [72, 95], hp: [55, 135], hn: [115, 105], hh: [118, 43], aR: [15, 230], aL: [100, 230] },
    { hd: [95, 80], sh: [80, 100], hp: [55, 140], hn: [108, 145], hh: [100, 158], aR: [18, 232], aL: [100, 232] },
    { hd: [95, 72], sh: [80, 100], hp: [52, 138], hn: [105, 135], hh: [140, 95], aR: [20, 235], aL: [100, 235] },
    { hd: [85, 65], sh: [80, 95], hp: [45, 135], hn: [118, 140], hh: [138, 95], aR: [25, 235], aL: [110, 235] },
    { hd: [60, 62], sh: [55, 95], hp: [45, 135], hn: [75, 140], hh: [127, 122], aR: [20, 235], aL: [98, 235] },
    { hd: [60, 68], sh: [55, 95], hp: [50, 138], hn: [65, 150], hh: [113, 168], aR: [18, 232], aL: [100, 232] },
    { hd: [48, 72], sh: [48, 95], hp: [45, 140], hn: [45, 150], hh: [53, 203], aR: [20, 232], aL: [98, 232] },
    { hd: [52, 68], sh: [55, 92], hp: [55, 140], hn: [20, 148], hh: [-5, 180], aR: [20, 232], aL: [102, 232] },
  ],
  // depth signs read from the rear-oblique row (376b): hands in front of the shoulders (+1), level (0); sledge head in front of (+1) or
  // behind (-1) the hands. 1-4: the head is up and back over the right shoulder; 5-10 in front; 11 straight down; 12 behind, low right.
  handSign: [1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1], headSign: [-1, -1, -1, -1, 1, 1, 1, 1, 1, 1, 0.3, -1],
  reach: [0.5, 0.42, 0.42, 0.5, 0.58, 0.6, 0.58, 0.58, 0.56, 0.56, 0.52, 0.5],     // shoulder-centre to the hands' centre (m): straight arms below the shoulders, bent overhead
  trunkM: 0.5,                                                                      // shoulder-centre to hip-centre (m) for this subject, from the upright phases
  handleM: 0.74,                                                                    // hands' centre to the head's centre (m): a 36-inch sledge held 12 cm from the end
};

// fit -> per phase { pelvis: Vector3 (hips' centre, local m), pitch, lean, hands: Vector3, head: Vector3, shoulder: Vector3, gaze: Vector3, stance: [xR, xL] }
// local frame: origin between the ankles on the floor, x = his left, y up, z forward (toward the anvil)
export function fitPlate(P = PLATE_376) {
  const s = P.statureM / (P.px.floor - P.px.top), out = [];
  for (let i = 0; i < P.frames.length; i++) {
    const f = P.frames[i], cx = (f.aR[0] + f.aL[0]) / 2, X = p => (p[0] - cx) * s, Y = p => (P.px.floor - p[1]) * s;
    const app = Y(f.sh) - Y(f.hp), pitch = Math.acos(Math.max(-1, Math.min(1, app / P.trunkM))), lean = Math.atan2(X(f.sh) - X(f.hp), Math.max(0.05, app));
    // the pelvis sits back as the trunk pitches forward: the centre of mass (trunk and head about 60 % of the body) stays over the feet
    const zHip = -0.62 * P.trunkM * 0.5 * Math.sin(pitch);
    const hip = V3(X(f.hp), Y(f.hp), zHip), sh = V3(X(f.sh), Y(f.sh), zHip + P.trunkM * Math.sin(pitch));
    // Taylor: the hands' depth from the shoulder centre, the sledge head's depth from the hands
    const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const hn2 = V3(X(f.hn), Y(f.hn), 0), dz = P.handSign[i] * Math.sqrt(Math.max(0, P.reach[i] ** 2 - d2(hn2, sh) ** 2)), hands = hn2.setZ(sh.z + dz);
    const hh2 = V3(X(f.hh), Y(f.hh), 0), hz = P.headSign[i] * Math.sqrt(Math.max(0, P.handleM ** 2 - d2(hh2, hands) ** 2)), head = hh2.setZ(hands.z + hz);
    out.push({ i, pitch, lean, pelvis: hip, shoulder: sh, hands, head, gaze: V3(X(f.hd), Y(f.hd), sh.z + 0.12), stance: [X(f.aR), X(f.aL)], app });
  }
  return out;
}
