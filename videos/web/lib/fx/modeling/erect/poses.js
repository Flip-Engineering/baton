// ERECT poses (MODELING c4): key poses for the ERECTOR giant, in its base frame (metres, degrees). Feet are placed, legs solved.
// foot: { p: [x, z] toe-pad on the ground, phi: heel lift (deg), lift: m off the ground, yaw }
// The toe pad sits ~4.6 m ahead of the ankle pin; with the foot flat the ankle pin is 4 m up.
export const POSES = {
  // standing at work, not on parade: weight more on the left, right foot a little out and turned, arms away from the body
  stand: { root: { p: [1.0, 29.8, -.6], r: [2, -3, 1.5] }, waist: [0, 4, 0], chest: [2, 0, -1],
    legs: { L: { p: [6.6, 3.6], yaw: -4 }, R: { p: [-7.6, 6.2], yaw: 10 } },
    arms: { L: { fk: { sh: [-6, 0, 9], el: [-16, 0, 0] } }, R: { fk: { sh: [4, 0, -11], el: [-12, 0, 0] } } }, curl: { L: .45, R: .3 } },
  square: { root: { p: [0, 30.2, 0], r: [0, 0, 0] }, legs: { L: { p: [5.6, 4.6] }, R: { p: [-5.6, 4.6] } }, arms: { L: { fk: { sh: [0, 0, 3] } }, R: { fk: { sh: [0, 0, -3] } } }, curl: { L: .3, R: .3 } },
};
