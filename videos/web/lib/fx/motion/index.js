// MOTION (MOTION studio, cycle 1): natural poses and animation for people.js figures. See research/capabilities/motion.md.
export { Poser, Spring, Spring3, Pendulum, FOOT, BONES, hash, noise1, fbm } from './poser.js';
export { Walker, gaitFor, WALK_RATIO } from './steps.js';
export { Idle, POSTURES } from './idle.js';
export { Crowd } from './crowd.js';
export { Cast } from './cast.js';
export { Haul, Lift, Hammer, Climb, Lever, Stoop, Dig, SHOVELS, lob, Act, withCart, withBox, callTimes, ropeTravel, ropeTension } from './labour.js';
export { encodeMotion, parseMotion, loadMotion, MotionClip } from './clipfmt.js';
export { loadLibrary, castTakes } from './library.js';
