// RIG (HUMAN studio, cycle 5): kinematics for people. See research/capabilities/human.md, cycle 5.
export { twoBone, fabrik, softReach } from './ik.js';
export { LIMITS, clampLocal, measureLocal, slerpPose, limitsFor } from './limits.js';
export { FootPlant, phaseFromDistance } from './ground.js';
export { com, supportPolygon, insideDist, centroid, leanAngle, SEGMENTS, DELEVA, DELEVA_RG, segmentsOf, inertia } from './balance.js';
export { LookCascade } from './look.js';
export { Keyed, follow } from './timing.js';
export { PeopleRig } from './people_rig.js';
export { cleanTrack, jointsAt, OneEuro, MP } from './retarget.js';
export { drawDiag } from './diag.js';
// RIG c1 (cycle 1 of the RIG studio): hands that hold things, bodies as data, beyond people. See research/capabilities/rig.md.
export { cylinder, torus, sphere, box, union, inflate, moved } from './sdf.js';
export { HandRig, GRIPS, FINGERS } from './hand.js';
export { loadAnsur, parseAnsur, sampleBody, heroOptions, applyBody, applyPosture, setTorsoLean, walkStyle, mulberry32, kinBody, KIN_REF } from './body.js';
export { SerialArm, DH } from './serial.js';
export { Horse, GAITS, FEET } from './horse.js';
export { Rider } from './rider.js';
// HUMAN c8 lane F: each person's kinematic model (lane A's p.kin) handed to the rig: see person_kin.js and review/studio_human_c8/after/kin/NOTES.md
export { kinOf, kinSegments, rgOf, heroPoints, heroCom, heroSupport, twoBoneKin, hingeOf, armFrame, valgusDeg, carrying, harringtonHJC, scaleKin, STANCE_H, STANCE_BAND } from './person_kin.js';
