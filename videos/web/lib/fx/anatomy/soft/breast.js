// ANATOMY / SOFT / BREAST: the breast as soft tissue SOLVED under gravity (ANAT8-BODY, 8 Oct 2026, lane iteration 8 = c3 iteration 1; NOTES.md iteration
// 8, S6). The client (8 Oct): 'this sounds like hardcoding rather than improving the bodies systems'. So nothing here draws the standing form: the
// ANATOMY builds the UNLOADED reference (the gravity-free gland-and-fat mound on the pectoral fascia, inside the chest's ordinary subcutaneous layer),
// the person's record gives TISSUE PROPERTIES, and soft/index.js solves the standing form. The literature's numbers (Regnault, Mallucci, ANSUR II,
// nipple-to-fold) are CHECKS in breastReport; when one fails, the tissue model changes, never the form.
//   import { breastRegion, solveBreast } from '.../lib/fx/anatomy/soft/breast.js';
//   const R = breastRegion(B, K, M, { rec, side: 'L' | 'R', h })    // the region (soft/index.js API)
//   const Z = solveBreast(B, K, M, { rec, side, h, solve: {...} })  // -> { R, S, L, report }
// THE REFERENCE (unloaded; each choice with its reason):
//   the FRAME: the breast's base plane, its axis D = the deep fascia's mean normal over the footprint (a plane fitted to the fascia there: the cage's own
//     curvature and slope decide where the breast points; no yaw or pitch is set), E1 lateral, E2 up, the origin the fascia under the nipple;
//   the DEEP FASCIA: the bone + muscle union of the trunk (ribs, sternum, clavicle, intercostals, serratus, pectoralis, the abdominal wall, latissimus) as a
//     height field along D, smoothed 1 cm (v3's: the fascia bridges the muscles' small steps); it is the kinematic deep boundary (solids);
//   the CHEST'S ORDINARY SUBCUTANEOUS LAYER tSC (FATREF.chest x the person's body fat, + 1.5 mm of skin; v11: the person's own where the region hands back) over the whole region: the mound is continuous with
//     it, so the breast has NO rim to clip (the sawtooth's cause in v2 / v3: a field clipped by the wall at a grazing angle);
//   the MOUND over the anatomical FOOTPRINT (v2's base: the 2nd rib to the inframammary fold on the midclavicular line, the fold at the imaging level of
//     chestLevels (Wang 2023, Oh 2020); the parasternal line (1.8 cm) to the midaxillary line (ribs 4-6 + 1.5 cm)), its VOLUME the record's
//     (targets.breast.volumeMl: Coltman 2017's scan volumes, the mound over the chest's surface; 380 mL without a record), its SUMMIT (the nipple, the
//     ducts' convergence) over the MCL at the 4th intercostal space (the textbook and supine-imaging level: supine loads the breast front-to-back, so its
//     height is the nearest to unloaded), its profile a smooth dome over the footprint ((1 - rho^2)^0.75 from the summit to the footprint's edge, blurred
//     1.2 cm: the premammary fat rounds the gland's edge);
//   the GLAND a lens in the middle of the mound (from 12 % to 80 % of the mound's thickness above the fascia, inside rho < rg), rg set so the gland is the
//     person's glandular share of the volume (by age and BMI: the MRI trend as recalled, to source: 0.38 at 22 / 25 y, -0.012 a BMI unit, -0.006 a year).
// THE TISSUE PROPERTIES (inputs; TISSUE below, each with its source; the model as of version 3, see VERSION 2 and 3 below): the breast's in vivo shear with
//   the ex vivo bulk (Mazier 2024; Samani 2007), the skin a J-curve membrane with the in vivo toe, its laxity from the record's (sampler.js t.laxity: age past
//   35 and parity), the retromammary sliding layer inside the anchoring ring, the ring a dense connective tissue bonded to the fascia, the chest's ordinary
//   subcutis outside it; no Cooper's tether to the chest wall and no inframammary ligament (Duraes 2026; Nava 1998).
import { buildSoft, solveSoft, sectionX, setGrowth, tissueCreep, skinGrowth } from './index.js';
import { layerOf, nrm, clamp, sub, crs } from '../muscle/core.js';
import { midline } from '../skeleton/body.js';
import { chestLevels } from '../skeleton/chest.js';
import { FATREF } from '../muscle/index.js';
import { ribAt, blur2 } from '../fat/breast.js';

// VERSION 2 (lane iteration 9 = c3 iteration 2): THE SUPPORTS WHERE THE ANATOMY HAS THEM, AND THE TISSUE'S IN VIVO MODULUS (two tissue-model changes,
//   each from a source; no shape is set): (1) no Cooper's ligament runs from the pectoral fascia to the skin (Duraes et al. 2026: MRI in three postures
//   and surgery: the retinacula cutis cross the superficial and the deep fat separately, none runs from the pectoralis to the skin; the breast is a pocket
//   of the superficial fascia ANCHORED AT ITS PERIPHERY, an 'anchoring ring' where the superficial and the deep fascia meet): the base is bonded in the
//   ring (label 'ring'), slides inside it on the retromammary layer (label 'retro') and outside it as the chest's ordinary layer ('base'); the
//   inframammary line tether is an OPTION (opts.imf 'ligament', Muntan 2000) and OFF by default ('sfs': Nava et al. 1998 found no ligament but a fine
//   superficial fascial system suspension; v2 models NONE, so its fold's skin slid 1.5-1.7 cm standing (the c3 it2 measurer); v3 models it as the ring's
//   tissue) [comment corrected in lane iteration 10: it said 'the tether stays', which the default contradicted]; (2) the tissue's modulus is
//   the in vivo one identified under gravity loading (Mazier and Bordas 2024: 0.32 kPa), not the ex vivo small-strain indentation (Samani 2007: 3.25
//   kPa; kept as `moduli: 'samani'`). A second posture (`posture: 'supine'`, gravity to the
//   back) is a CHECK (the textbook nipple at ICS4 is supine anatomy), never a construction.
// VERSION 3 (lane iteration 10 = c3 iteration 3): THE TISSUE COMPARTMENTS AROUND THE BREAST (one tissue-model change; no shape is set): v2 gave the WHOLE
//   region the breast's in vivo softness (0.32 kPa), so the chest's ordinary subcutis under the fold and the anchoring ring were as soft as the breast:
//   the fold's skin slid 1.5-1.7 cm down the chest with the breast and the lower pole's skin piled into a cusp at the crease (compressed 7-14 %), a flat
//   shelf in front of it (the c3 it2 measurer's issues 1-2). Now (1) THE ANCHORING RING (Duraes 2026: 'a dense zone of connective tissue around the
//   periphery of the breast, where the superficial fascia and the deep fascia meet') is a compartment of dense connective tissue through the FULL
//   thickness of the band (rho 0.95-1.15), deep fascia to dermis, not only a bonded base; its modulus the in vivo modulus of the dense irregular
//   connective tissue the same calibration identified (the dermis: Mazier and Bordas 2024, 22.7 kPa); the fold is part of it (Nava 1998: the fold's
//   'fine superficial fascial system suspension'); (2) THE CHEST'S ORDINARY SUBCUTIS outside the ring is the body's superficial subcutaneous fat with its
//   retinacula, not breast tissue: ANAT8-PELVIS's fatSuperficial (2.5 kPa: Samani 2007 / Comley and Fleck 2010), the bulk as before. Inside the ring the
//   breast keeps v2's tissue. (Lane iteration 10 deleted v1, v2 and every switch back to them: one current version; git history keeps them.)
// VERSION 4 (lane iteration 11 = c4 iteration 2): THE STANDING LOAD PATH THROUGH THE POCKET'S ENVELOPE (one tissue-model change, two parts that act only together;
//   no shape is set). The diagnosis (node, measures/it11_ablation.md): in v3 the lower-pole skin was NOT locked (its sagittal strain 1.6 % mean, 12 of 2316 edges past
//   the J-curve's lock): the parenchyma (0.32 kPa) held its own form as an elastic solid hung from its base and the ring, the skin a passive film (1-5 % strain,
//   ~1-2 N/m of a ~30 N/m load), so gravity SHEARED the reference's lens: its front turned vertical and its sloping underside turned into a floor (the box). A real
//   breast is a POCKET of the superficial fascia (Duraes 2026) whose contents, fat lobules and gland, are a fluid-filled foam: under a load sustained for hours their
//   shear relaxes to a small equilibrium fraction (adipose tissue is strongly time-dependent in shear: Geerligs et al. 2008, Biorheology 45:677; Sommer et al. 2013,
//   Acta Biomater 9:9036; the fraction RECALLED, to source), the bulk stays (lipid and water), so the load goes into the envelope; and the envelope's skin
//   stiffens SMOOTHLY (collagen recruits fibre by fibre: a Fung-type exponential), not at a corner. So (1) the parenchyma's shear x TISSUE.relaxed.g (its
//   long-term fraction of the in vivo modulus); (2) the skin's tension f = (k L / beta) expm1(beta e) (soft/index.js Mb.beta) with the same small-strain modulus
//   (the in vivo 22.7 kPa) and beta from the in vivo stretch of breast skin under gravity (TISSUE.skinFung). Ablations (L08, left): (2) alone changes nothing
//   (the skin carries no load to stiffen); (1) alone sags the sack lower with the wall kept (the lock); (1) + (2) turns the lower pole into one convex arc.
//   (lane iteration 12 removed v4's A/B switch back to v3, `opts.loadPath: 'v3'`: one A/B switch at a time, now v5's.)
// VERSION 5 (lane iteration 12 = c4 iteration 3): THE GLAND AND ITS NIPPLE (one change to the UNLOADED reference's anatomy; the tissue model and the loading are v4's;
//   no loaded shape is set). The diagnosis (measures/it11_ablation.md section 3; the c4 it1 critic): the reference put its crown (most forward point) 2.0-3.2 cm MEDIAL of
//   its nipple, on a flat-topped lens with walls, and the nipple 2.7 cm lateral of the midclavicular line pointing 24-25 deg out, BEFORE any load. Two causes, both in
//   how the anatomy was applied: (1) the textbook places the NIPPLE at the 4th intercostal space on the midclavicular line (Gray's; Moore): the MCL is a SURFACE line
//   (drawn on the skin from the clavicle's midpoint, seen from the front) and the statement is about the nipple, a skin point, in the unloaded (supine-like) body; v4
//   put the gland's FOOT on the fascia there and then carried the nipple out along the fascia's mean normal D by the mound's whole height (6-7 cm x sin 24 deg = 2.7 cm
//   lateral, 0.8 cm up); v5 puts the NIPPLE (the ducts' convergence, the gland's apex) on the MCL at the 4th space and finds its foot on the fascia back along D, so the
//   footprint stays the anatomy's (parasternal to midaxillary) and the nipple lies over its medial part: the lateral breast, the longer meridians, runs out to the axilla
//   (the axillary tail's side), as in the anatomy; (2) the GLAND is the 15-20 lobes radiating from the nipple, their ducts converging on it (Cooper 1840; Ramsay et al.
//   2005, J Anat 206:525: ultrasound of lactating breasts, the ducts converge on the nipple, the gland thickest under it): its thickness falls along each meridian from
//   the nipple to the footprint's edge (a CONE of lobes, profile 1 - rho), not a lens ((1 - rho^2)^0.75, flat over its middle), and the premammary fat rounds it (the
//   v4 blur, 1.2 cm, and the chest's subcutis over it, kept). A cone's apex is its most forward point in every direction inside its opening, so the crown and the nipple
//   coincide by the anatomy, not by a placement. (v5's A/B switch back to v4's reference, `opts.reference: 'v4'`, deleted in lane iteration 13: the c4 it3 critic held
//   v5's nipple-at-the-crown claims over v4's plateau in the sections; it also named v5's paraboloid a CONSTRUCTION: see VERSION 6 and NOTES NEXT.)
// VERSION 6 (lane iteration 13 = c4 iteration 4): THE SKIN'S REST STATE FROM ITS LOAD HISTORY (one change to the tissue model's supports; the reference and the loading are
//   v5's; no shape is set). The diagnosis (node, L08 left, measures/it13_supports.md): the standing breast's weight goes 13 % into the retromammary layer, 27 % into the
//   bonded anchoring ring and ~50 % through the skin and the tissue into the region's boundary: the upper pole's SKIN holds the nipple (its ~14 % stretch over ~12 cm
//   IS the 1.7 cm drop); freeing the retromammary layer x 0.1 / x 0.02 changes nothing (the drop stays 1.7 cm). So the age has to act where the load goes. v5 let
//   age reach the skin as a UNIFORM rest-length excess (0.10 x the record's laxity: 4.4 % for L06), which leaves the skin slack where nothing loads it (a 15 %
//   uniform excess compressed the chest's skin by 12 % at the median and did not converge) and is too little where the breast hangs from it. Skin under a load
//   sustained for years creeps, and with age (elastin lost, the recoil gone) and with pregnancies it does not recover what it crept: so the skin's rest length is
//   its unloaded length plus the RETAINED fraction of the strain it carries standing. v6: solve standing (pass 1, as v5 but with no uniform excess); each skin
//   edge's rest length grows by c x its pass-1 tensile strain, c = the record's laxity (sampler.js: (age - 35) / 55 x 0.8 + 0.06 x parity: 0 for L08 at 24
//   nulliparous, 0.44 for L06 at 53 with three children) read as that retained fraction (OUR mapping: Agache 1980 and Escoffier et al. 1989 (J Invest Dermatol
//   93:353) report the skin's elastic recovery falling with age; the fraction itself is recalled, to source); solve again (pass 2) from the loaded state. Where the
//   skin carried nothing it keeps its rest length. A young nulliparous woman (c = 0) solves exactly as v5's loading. `opts.supports: 'v5'` = v5's uniform excess
//   (the A/B; delete when the critic rules). [Lane iteration 14 deleted that switch: v7 replaces it with its own.]
// VERSION 7 (lane iteration 14 = c5 iteration 1): THE LOAD HISTORY'S LARGEST LOAD (one change to the tissue model's load history; the reference, the tissue and the
//   supports are v6's; no shape is set). v6 let the skin keep part of the strain of TODAY's standing load, and L06 (53, three children) still solved like a smaller L08
//   (grade 0 against her record's 2, the nipple pointing up; measures/it13_supports.md section 4): today's standing load is not the largest load her skin has carried.
//   In each pregnancy and lactation the breast grows by the gland's proliferation and the milk it holds: Cox, Kent, Casey, Owens and Hartmann 1999 (Exp Physiol
//   84:421, PMID 10226182; 8 women, 13 breasts, volumes measured before conception, through pregnancy and in lactation): +145 +- 19 mL a breast by term (range
//   12-227), +211 +- 16 mL at one month of lactation (129-320), held for the months of lactation; after weaning the gland involutes and the volume returns, but
//   the skin that carried the enlarged breast for months has grown and crept (skin under a sustained stretch grows: the tissue-expansion literature, Buganza
//   Tepole et al. 2011, J Mech Phys Solids 59:2177, recalled, to source) and with age does not recover it: the envelope is now larger than its contents
//   ('deflation', the mechanism of the parous breast's lower pole and of the nipple turning down). So, for a parous woman (the record's parity >= 1): pass 1 is
//   the LACTATING breast standing: the parenchyma (the breast's fat and gland inside the anchoring ring) GROWN in place by Cox's +211 mL (soft/index.js setGrowth:
//   an isotropic growth of the rest state, its mass with it; ramped in four stages, the growth being slow), solved to equilibrium; the skin keeps c x the
//   tensile strain it carried there (v6's creep rule, c the record's laxity) and EVERY other support keeps the same fraction of its deformation (soft/index.js
//   tissueCreep: the anchoring ring's tissue, the chest's subcutis, the parenchyma, the sliding layers' rest points); pass 2 the gland INVOLUTED back to today's volume (the growth ramped out), standing,
//   solved again. A nulliparous woman's pass 1 is today's standing load (v6 exactly), and with c = 0 (L08) no second pass runs: she solves exactly as before.
//   The growth is uniform over the parenchyma (the lactating gland's ducts and lobules run through the whole breast; at the solver's 5 mm cells we do not
//   resolve the lobes: ours, stated). `opts.history: 'standing'` = v6 (pass 1 today's standing load: the one A/B switch; delete when the critic rules).
//   Node (lane iteration 14, measures/soft_load_i14.log): L06's nipple 1.9 cm down (v6 1.5), still grade 0: the fold's ledge (the ring's block) holds the lower
//   pole; v7's slack goes into the front. NOTES NEXT 1. (v7's A/B switch back to v6, `opts.history: 'standing'`, deleted in lane iteration 15: the c5 it1 critic
//   kept v7 as sound machinery, inert on the picture.)
// VERSION 8 (lane iteration 15 = c5 iteration 2): THE ANCHORING RING AS AN ADHERENCE, NOT A BLOCK; THE FOLD AS A LINE OF SKIN BOUND TO THE DEEP FASCIA (one change
//   to the tissue model's supports at the breast's periphery; the reference, the tissue inside the ring and the load history are v7's; no shape is set). The
//   diagnosis (lane iteration 14, the c5 it1 critic): every solve, young or old, ends its lower pole on a FLAT FLOOR 3-5 cm long from the fold to the front and
//   nothing of the breast passes below the fold: v3-v7 made the anchoring ring a FULL-THICKNESS BLOCK of dense tissue (22.7 kPa, ~70x the parenchyma's relaxed
//   shear) 1.5 cm wide all round the footprint, deep fascia to dermis; at the fold it is a cantilever the lower pole's skin is slung from, so the content cannot
//   roll over the line, and at the upper border it is a rim. What the anatomy describes is a LINE and a SURFACE, not a block: (1) the anchoring ring is where
//   the superficial fascia (a thin membrane, the pocket's wall) meets the deep fascia (Duraes et al. 2026, PubMed 41549904; Rehnke et al. 2018, Plast Reconstr
//   Surg 142:1135, 12 cadavers: 'a three-dimensional zone of adherence at the breast's periphery', the circummammary ligament): an adhesion on the DEEP side
//   (kept: the band's deep interface bonded, as v3-v7), with the ordinary superficial fat and its retinacula over it (the band's tissue is now the chest's
//   subcutis, TISSUE.subcutis, as outside the ring); (2) at the INFERIOR border only, the adherence reaches the DERMIS: 'the inframammary fold is an intrinsic
//   dermal structure ... held in place by a zone of adherence that is a specialized area of the superficial fascial system ... between the skin and the
//   underlying pectoralis fascia' (Boutros et al. 1998, Plast Reconstr Surg 102:1030, PMID 9734420, 10 cadavers; Nava 1998's SFS suspension; Muntan 2000's
//   ligament): the fold's skin is BOUND to the deep fascia along the footprint's lower arc (soft/index.js tethers kind 'bound': the skin point held within a
//   give of its rest position, against sliding as against lifting; the septa's stiffness from the same dense connective tissue, TISSUE.imfLine). The upper,
//   medial and lateral borders' skin is free over the subcutis. The fold's POSITION stays the anatomy's (the imaging fold, chestLevels: an input, as the 2nd
//   rib and the MCL are); its FORM (a crease, a lower pole resting on the chest's skin below it, an overhang with age) is now free to come out of the solve:
//   the lower pole rotates over a line instead of standing on a block, and its skin lands on the chest's skin below the fold (the collider 'chest skin').
//   The load history (v7) acts on the line too: tissueCreep moves each bound point's anchor by c of its slide. (`opts.anchor: 'block'` was v8's A/B to v7.)
//   Node (lane iteration 15, NOTES iteration 15; measures/soft_load_i15.log): the fold now HOLDS where the anatomy puts it (L08 0.3 cm, L06 0.4, L14 0.2; v7's block
//   let it slide 0.9-1.3 cm with the breast) and L06's nipple turns 4 deg down (16 -> 12 up), but the FLOOR stays, ~1 cm higher with the fold (the c5 it1 critic's
//   prediction): the lower pole is a HAMMOCK slung side to side (its skin 10.9 % medial-lateral against 2.7 % front-back, L08); five ablations of the solver
//   (the skin's compression, the subcutis's stiffness, convergence, the grid, a per-cell pressure) leave it unchanged. A probe (scratch) of the skin's rest state
//   grown under its standing load lets the lower pole round below the bound fold into a crease: NOTES NEXT 1. (v8's A/B switch back to v7, `opts.anchor:
//   'block'`, deleted in lane iteration 16 with v7's block: v8's line and adhesion are the supports v9 grows its skin on.)
// VERSION 9 (lane iteration 16 = c5 iteration 3): THE SKIN'S REST STATE FROM ITS GROWTH (one change to the skin's rest state; the reference, the tissue, the supports
//   and the load history's loads are v8's; no shape is set). The diagnosis (lane iteration 15): the lower pole is a HAMMOCK slung side to side (its skin 10.9 %
//   medial-lateral, 2.7 % front-back), its skin's rest state the gravity-free reference's surface. But skin is not a fixed sheet: held stretched past its
//   physiological limit it GROWS new area until its elastic stretch is back at that limit, and it never gives the area back (Zoellner, Buganza Tepole and Kuhl
//   2012, J Theor Biol 297:166, PMC3278515: the area growth driven by <theta_e - theta_crit>, theta_crit = 1.21 = a uniaxial 10 %, 'the physiological threshold
//   value, to which the elastic area stretch tends to return during adaptive skin growth'; upon the expander's removal the elastic stretch retracts and the grown
//   area stays; the model of Buganza Tepole et al. 2011, J Mech Phys Solids 59:2177; soft/index.js skinGrowth 'grow', at the growth's equilibrium: a load held
//   for months or years). Two sustained loads of a woman's life reach it: (1) her STANDING breast, every day since its development: where today's standing load
//   stretches the skin past the limit (the upper pole, the hoop under the nipple) it has grown to the limit (TISSUE.skinGrowth.devRounds rounds of grow and the
//   standing solve again: the skin's rest and the form it carries are one fixed point); (2) LACTATION (a parous woman, every age: v7 gated it on c > 0, so L20, 29,
//   one child, had none): the breast grows by Cox's +211 mL for months, the over-stretched skin grows (lactRounds rounds under the lactating load), and after
//   weaning the content involutes while the grown skin STAYS: an envelope larger than its contents, the parous breast's ptosis by its mechanism. v7's creep of
//   every support by c (the record's laxity: the elastic recovery lost with age) stays on top. Nothing is fitted: lamCrit is the source's.
//   (Tried and NOT kept, lane iteration 16: skinGrowth 'expanded' for (1): the developed breast's skin at the limit over its whole footprint both ways, Zoellner's
//   'chronic restoration theta_e -> theta_crit' read for the gland as the expander: three rounds on L08 tightened the slack lower pole and lifted the nipple, pitch
//   1.5 -> 8.8 deg up, projection 8.9 -> 8.3 cm, the floor unchanged (3.5 cm): the homeostatic TENSION along the meridian does not round the floor; AREA does.)
//   (15 Oct, the review gate abolished: v8's `opts.skin: 'rest'` A/B switch deleted; git history keeps it.)
// VERSION 10 (lane iteration 17 = c5 run iteration 1, 15 Oct): DEVELOPMENT AS A SIMULATION (one change to the load history: its first and longest chapter; the
//   tissue, the supports, the skin's growth law and the later loads are v9's; no shape is set). v9 grew the skin from the gravity-free reference's surface,
//   so the developed breast's skin was the reference's (a constructed paraboloid's) plus what today's load stretched past the limit: the lower pole kept the
//   reference's arc, slung side to side (the hammock, 10.9 % medial-lateral against 2.7 % front-back) and stood on a flat floor at the fold. But the adult
//   breast's skin was never that surface: the breast DEVELOPS, over the 3-5 years from thelarche (Tanner B2) to B5, under the skin of a flat chest, standing,
//   and the skin it ends with is the skin that growth under gravity made. So: the parenchyma (the breast's fat and gland inside the ring) is shrunk IN PLACE
//   to the bud (soft/index.js setGrowth, TISSUE.development.v0 of today's volume) and solved standing; the bud's skin is set at its HOMEOSTATIC STRETCH over
//   it (skin in vivo is never at rest: it retracts when cut; Zoellner 2012's theta_crit = 1.21, lambda 1.10, is 'the physiological threshold value, to which
//   the elastic area stretch tends to return': every skin edge's rest = its length there / 1.10, in every direction, over the footprint, fading out by
//   rho 1.3; skinGrowth 'expanded' at lamCrit); then the
//   parenchyma GROWS back to today's volume in TISSUE.development.stages stages, standing, the skin growing past Zoellner's limit after each (v9's law,
//   soft/index.js skinGrowth 'grow'): the skin the adult breast ends with, and where it has its area, come out of the history, the reference's form is
//   only the material layout. Then v9's chain unchanged (the standing growth rounds, lactation for a parous woman with its growth, creep, involution).
//   The bud's size is ours (stated: 1/4 of today's volume, a breast at ~B3; the skin's final state is set by the growth from there, so the start matters little
//   once the skin has doubled its area); the stages are the solver's (growth is slow: ramped, not stepped).
//   Node (lane iteration 17, L08 left, h 7.5 mm; measures/soft_c5i1_L08_*; boards/soft_c5i1_L08_v9_v10_v10b.jpg): the bud's skin AT REST (lambda 1) moved the
//   form by millimetres and kept v9's dead-straight floor (the lower pole carried no front-back tension: growth only lengthens what is stretched); at its
//   homeostatic stretch the lower pole carries tension both ways: the floor 3.5 -> 2.5 cm and no longer flat (the walk from the fold 86 -> 53 deg, one arc),
//   the lower pole's convexity 30.7 -> 23.1 mm, projection 8.8 -> 8.0 cm, pitch +2.9 -> +0.4 deg; the nipple 4 mm HIGHER (3.6 cm over ANSUR's bust point:
//   the taut skin holds it), the median skin stretch 5.4 % (v9 0.5 %: skin in vivo is tensioned).
// VERSION 11 (lane iteration 19 = c5 run iteration 3, 16 Oct): THE CHEST'S SUBCUTIS WHERE THE REGION HANDS BACK IS THE PERSON'S (one change to the region's
//   reference, at its edges; the mound, its tissue, supports, load history and growth are v10's; no shape is set). The diagnosis (node, the v10 bakes against
//   the prior body they were solved on; the critic's rank 1, 'blotchy lumps across clavicles, upper pectorals and sternum'): outside the mound the region's
//   reference skin was OUR deep fascia (the bone and muscle union, smoothed 1 cm) + the TABLE's subcutis (FATREF.chest x the person's fat), which is not
//   the person's skin: where the solve hands the skin back to the body (the blend band) it sat 5.6 / 7.9 mm (L08 / L22, median; to 20 mm) BEHIND the person's
//   skin over the upper chest, 1-8 mm medially, and the membrane fit (BODY7's, screened Laplacian) spread that as a 4-6 mm groove round the breast and
//   across the upper chest, beyond the band itself. Now the chest's ordinary subcutis is a FIELD: its thickness (normal to the fascia) MEASURED on the
//   person's own skin outside the anchoring ring above the footprint's middle (lower down the person's own breast, which this solve replaces, spreads past
//   our footprint and would be read as subcutis), the table's thickness under the breast (inside the footprint, as v10), harmonic between, smoothed 1 cm
//   (subcutisField below). The person's fat where the solve meets the body is then the person's (a PARAMETER read off the person, as the record's volume
//   is), and the region's reference skin is continuous with the body it hands back to. Not reached by this: the lateral flank, where the person's skin lies
//   INSIDE our muscle layer (the thickness clamps at skin + 1 mm: a skeleton / muscle width question), and the chest under the fold.
// VERSION 12 (lane iteration 20 = c6 run iteration 1, 16 Oct): THE PERSON'S OLD BREAST TAKEN OUT; THE CHEST'S SUBCUTIS ONE LAYER UNDER THE WHOLE CHEST (one
//   change: what the region reads off the person and what it replaces; the mound, its tissue, supports, load history and growth are v10's, the subcutis model
//   v11's; no shape is set). The diagnosis (the c5 run's critic and checker, measured on v11's bakes): under the fold the fitted skin lay 2 cm INSIDE the
//   person's (the hand-back 'bottom' -20.8 / -23.8 mm, L08 / L22): the trench and crescent under every breast. Its cause, measured this iteration (scratch
//   col20.mjs, the person's skin minus our fascia down the MCL): the person's OWN breast (the SOMA prior's learned breast, which our solve replaces; no
//   rebuild removes it: the cup and mound parameters are not what made it) is centred 2-5 cm LOWER than ours (its thickest 52-59 mm at b -2..-5 cm, our fold
//   at b -4.5) and runs to ~9 cm under our fold; v11 read the subcutis only above the footprint's middle and handed back (the blend weight 0 by rho 1.6) ON
//   that old lower pole, so the fit kept the old breast's lower half under ours. Now (1) the old breast is located on the person's skin by hm08's own
//   'breastFoot' field (BODY7's footprint of the as-built breast, f > 0.08: measure.js's 'inside the footprint'; a property of the mesh the person is
//   built on, like v3's as-built NAC: what is being replaced, not a target); (2) the region reaches 2.5 cm past it on every side but the midline (below the
//   fold that is the costal margin and the epigastrium); (3) the chest's subcutis is MEASURED on the person's skin at every height outside the ring and
//   outside the old breast, harmonic across the old breast, the table under ours (the one layer under the whole chest); (4) the fit's blend weight
//   (soft/envelope.js) is 1 over the old breast too, falling to 0 by 2 cm outside it, so the old breast is replaced whole and the hand-back lies where the
//   person's skin is the chest wall and ours is read from it.
export const SOFT_BREAST_VERSION = 12;   // the one current version
const CM = 0.01;
export const TISSUE = {
  fat: { E: 3250, nu: 0.49, rho: 920, src: 'Samani, Zubovits and Plewes 2007, Phys Med Biol 52:1565 (169 ex vivo samples, small strain: fat 3.25 kPa); rho recalled' },
  gland: { E: 3240, nu: 0.49, rho: 1040, src: 'Samani 2007 (fibroglandular 3.24 kPa: "similar" to fat at small strain); rho recalled' },
  skin: { E0: 0.42e6, E1: 0.85e6, a0: 30, a1: 60, t: 0.0018, compress: 10, src: 'Agache et al. 1980, Arch Dermatol Res 269:221 (138 people in vivo: E doubles with age, ~0.42 MPa young, ~0.85 MPa older: values recalled); breast skin ~1.8 mm (recalled)' },
  // (the bilinear J-curve skin, skinJ, v2-v3: deleted in lane iteration 12 with v4's switch back to v3; soft/index.js keeps the J-curve law for other regions)
  laxity: { creep: 1.0, src: 'the record\'s laxity (sampler.js: (age - 35) / 55 x 0.8 + 0.06 x parity) -> v6: the RETAINED fraction of the skin\'s sustained strain (creep x 1.0 x laxity; the elastic recovery lost with age and parity: Agache 1980, Escoffier 1989; the mapping ours); v7: of the LARGEST sustained load (lactation for a parous woman)' },
  // v7: the lactating breast (the load history's largest sustained load for a parous woman)
  lactation: { dV: 211e-6, stages: 4, stageTime: 0.4, src: 'Cox, Kent, Casey, Owens and Hartmann 1999, Exp Physiol 84:421 (PMID 10226182): breast volume +145 +- 19 mL by term (range 12-227), +211 +- 16 mL at one month of lactation (range 129-320), over the volume before conception; the stages and their time are the solver\'s (growth is slow: ramped, not stepped)' },
  retro: { G: 300, t: 0.003, kn: 1e6, src: 'the retromammary (loose areolar) layer: an estimate, to source' },
  imf: { spacing: 0.01, src: 'the inframammary line, TRACKED every ~1 cm along the footprint\'s lower arc; v8: BOUND there (imfLine)' },
  // v8: the fold's zone of adherence (Boutros 1998: a condensation of the superficial fascial system binding the fold's dermis to the pectoral fascia): each ~1 cm of
  // the line a septum of the dense connective tissue of v3's ring (E 22.7 kPa), across the ring's band width (w), through the subcutis's thickness at the fold (L):
  // k = E w s / L; the give the zone's (ANAT8-PELVIS's young value, 1 mm); age acts through the load history's creep (c of the slide), not a second dial
  imfLine: { E: 22.7e3, w: 0.015, give: 0.001, src: 'Boutros, Kattash, Wienfeld, Yuksel, Baer and Shenaq 1998, Plast Reconstr Surg 102:1030 (PMID 9734420): the IMF an intrinsic dermal structure held by a zone of adherence between the skin and the pectoralis fascia; Rehnke 2018 (PRS 142:1135) and Duraes 2026: the adherence at the periphery; the modulus = v3\'s ring tissue (Mazier 2024\'s 22.7 kPa, our analogue), the width the ring\'s band (~1.5 cm, ours), the give 1 mm (ANAT8-PELVIS tethers.js, an assumption)' },
  // v9: the skin's growth past its physiological limit (under the standing load; a parous woman's under the lactating load: grown, kept)
  skinGrowth: { lamCrit: 1.10, devRounds: 2, lactRounds: 1, src: 'Zoellner, Buganza Tepole and Kuhl 2012, J Theor Biol 297:166 (PMC3278515): growth while the elastic area stretch exceeds theta_crit = 1.21 (a uniaxial 10 %), the physiological threshold to which the elastic stretch returns during growth; chronic elastic stretch of expanded skin 10 % (model) vs 10 % (measured); irreversible (the grown area stays when the expander is removed); Buganza Tepole et al. 2011, J Mech Phys Solids 59:2177 (the model). The rounds (the fixed point\'s iterations) are ours' },
  // v10: development (the load history's first chapter): the bud's share of today's parenchyma, the stages of its growth (each a standing solve of stageTime
  // simulated seconds, then the skin's growth past the limit), and the band over which the bud's skin is set at rest (rho: 1 inside the footprint, 0 by rho1)
  development: { v0: 0.25, stages: 8, stageTime: 0.4, rho0: 1.0, rho1: 1.3, src: 'ours: the breast develops from the bud (thelarche, Tanner B2) to the adult breast over 3-5 years, standing; the bud\'s share (a ~B3 breast), the stages and the band are ours; the growth law Zoellner 2012 (skinGrowth)' },
  gland0: { at: 0.38, bmi: -0.012, age: -0.006, min: 0.08, max: 0.5, src: 'glandular share by volume falls with BMI and age (MRI studies, recalled; to source)' },
  // v4: the skin's tension as a SMOOTH exponential (soft/index.js Mb.beta): the small-strain modulus the in vivo toe (Mazier 2024, 22.7 kPa), the tangent
  // reaching the ex vivo linear region (20 MPa, recalled) at the in vivo upper bound of the breast skin's gravity stretch
  skinFung: { beta: Math.log(20e6 / 22.7e3) / 0.60, src: 'beta = ln(E_lin / E_toe) / 0.60: the tangent reaches the linear region at stretch 1.60, the upper bound of the in vivo breast skin stretch supine to upright (Khatam et al. 2015, Med Eng Phys: max principal stretch 1.25-1.60); gravity-loaded vs gravity-free peaks 14-75 % (Sanchez et al. 2017, Clin Biomech 50:47, doi 10.1016/j.clinbiomech.2017.10.005)' },
  // v4: the parenchyma's shear under a load sustained for hours: the equilibrium fraction of its in vivo (minutes-scale, imaging) modulus; the bulk kept
  relaxed: { g: 0.1, src: 'the long-term (equilibrium) shear fraction of adipose tissue: strongly time-dependent in shear and relaxation (Geerligs et al. 2008, Biorheology 45:677, doi 10.3233/BIR-2008-0517; Sommer et al. 2013, Acta Biomater 9:9036, doi 10.1016/j.actbio.2013.06.011); 0.1 RECALLED from their relaxation curves, to source; applied to the breast\'s fat and gland only (the ring is collagen; the chest subcutis keeps its retinacula: NEXT)' },
  // v2: the in vivo modulus under gravity loading (fat and gland together: the calibrations treat the breast as one homogeneous solid)
  vivo: { E: 320, Eskin: 22.7e3, src: 'Mazier and Bordas 2024, Clin Biomech 111:106153 (PubMed 38061204): patient-specific prone-to-supine calibration, E_breast 0.32 kPa, E_skin 22.7 kPa (corotational); the method: Rajagopal et al. 2008, Acad Radiol 15:1425 (PubMed 18995193: in vivo properties from neutral-buoyancy (unloaded) to prone MRI, skin surface RMS 3.6-4.2 mm). Samani 2007 (3.25 kPa) is ex vivo, small strain, indentation' },
  // v2: the anchoring ring (rho = the footprint's normalised radius: 1 on the footprint's edge)
  // v3: the ring's TISSUE (dense connective tissue, deep fascia to dermis) and the chest's ordinary subcutis outside it
  subcutis: { E: 2.5e3, nu: 0.49, rho: 920, src: 'the chest\'s ordinary subcutaneous fat outside the breast (the superficial fat with its retinacula cutis): as ANAT8-PELVIS fatSuperficial (pelvis/index.js: Samani 2007 3.25 +- 0.91 kPa; Comley and Fleck 2010 ~1 kPa slow loading)' },
  ring: { in: 0.95, out: 1.15, src: 'Duraes et al. 2026, Clin Anat, doi 10.1002/ca.70071 (PubMed 41549904): 196 patients, 10 with MRI supine / prone / lateral, and surgery: no retinacula from the pectoralis major to the skin; a dense anchoring ring at the periphery where the superficial and the deep fascia meet is the main adhesion; the band width (0.95-1.15 of the footprint radius, ~1.5 cm) is ours' },
};

export function breastRegion(B, K, M, opts = {}) {
  const side = opts.side || 'L', s = side === 'L' ? 1 : -1, H = B.stature, sT = H / 1.625, rec = opts.rec || {}, tg = rec.targets || rec.prior?.targets || {}, tb = tg.breast || null;
  const h = opts.h ?? 0.005, da = 0.004, age = B.age ?? 35, bmi = B.bmi ?? 23, RG = TISSUE.ring;
  const trunk = K.parts.filter(q => /^(rib|sternum|clavicle|vert|scapula)/.test(q.name)).concat(M.parts.filter(q => /^(intercostal|serratus|pectoralis|externalOblique|rectusAbdominis|abdominalWall|latissimus)/.test(q.name)));
  const U = layerOf(trunk, 0.12), sup = B.lm.suprasternale || K.pts.jugular, CL = chestLevels(K, side), xm = CL.xm;
  const pf = B.pf ?? 0.28, fk = Math.pow(pf / 0.28, 1.2), tSCref = (FATREF.chest.f * fk + 1.5) / 1000;   // v11: the table's thickness, now only described (meta.tSCref)
  const onFascia = (x, y) => { let z = (midline(B, y).front || 0.15) + 0.03; for (let i = 0; i < 200 && U.d(x, y, z) > 0.0008; i++) z -= Math.max(0.0005, 0.7 * (U.d(x, y, z) - 0.0008)); return [x, y, z]; };
  // the footprint's anchors (world)
  const r2 = ribAt(K, 2, side, xm), fold = CL.fold, i4 = CL.ics(4), yN = i4 === i4 ? i4 : (r2[1] + fold) / 2, yC = (r2[1] + fold) / 2;
  const latR = [4, 5, 6].map(k => K.geo.ribs['rib' + k + side].lat), xLat = Math.max(...latR.map(q => Math.abs(q[0]))) + 1.5 * CM * sT, xMed = 1.8 * CM * sT;
  // the frame: D = the fascia's mean normal over the footprint (a least-squares plane z = a x + b y + c through 5 x 5 fascia points)
  let Sxx = 0, Sxy = 0, Sx = 0, Syy = 0, Sy = 0, Sn = 0, Sxz = 0, Syz = 0, Sz = 0;
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) { const x = s * (xMed + (xLat - xMed) * i / 4), y = fold + (r2[1] - fold) * j / 4, z = onFascia(x, y)[2];
    Sxx += x * x; Sxy += x * y; Sx += x; Syy += y * y; Sy += y; Sn++; Sxz += x * z; Syz += y * z; Sz += z; }
  const [pa, pb] = solve3([[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, Sn]], [Sxz, Syz, Sz]), D = nrm([-pa, -pb, 1]);
  let E1 = nrm(crs([0, 1, 0], D)); if (E1[0] * s < 0) E1 = E1.map(c => -c); let E2 = nrm(crs(D, E1)); if (E2[1] < 0) E2 = E2.map(c => -c);
  const O = onFascia(s * xm, yN), dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const toW = (a, b, w) => [O[0] + E1[0] * a + E2[0] * b + D[0] * w, O[1] + E1[1] * a + E2[1] * b + D[1] * w, O[2] + E1[2] * a + E2[2] * b + D[2] * w];
  const ab = p => { const d = sub(p, O); return [dot3(d, E1), dot3(d, E2), dot3(d, D)]; };
  const pTop = ab(onFascia(s * xm, r2[1])), pFold = ab(onFascia(s * xm, fold)), pMed = ab(onFascia(s * xMed, yC)), pLat = ab([s * xLat, yC, latR.reduce((a, q) => a + q[2], 0) / 3]), pMid = ab(onFascia(s * 0.002, yC));
  const aMed = pMed[0], aLat = pLat[0], bTop = pTop[1], bF = pFold[1], aC = (aMed + aLat) / 2, ha = (aLat - aMed) / 2, bC = (bTop + bF) / 2, hb = (bTop - bF) / 2;
  // v12: THE PERSON'S OLD BREAST (the as-built one this solve replaces): hm08's 'breastFoot' field on the person's own skin (BODY7's footprint of the
  // as-built breast; f > 0.08 is 'inside the footprint' as BODY7's measure.js reads it), this side; its extent in the frame
  const OB = oldBreast(B, ab, s);
  // the region's box (in the frame): the midline to 3 cm past the midaxillary line; 6 cm under the fold to 2.5 cm over the 2nd rib; v12: and 2.5 cm past
  // the old breast on every side but the midline (below the fold that reaches the costal margin and the epigastrium: the whole chest under the old breast)
  const mgO = 0.025 * sT, a0 = pMid[0], a1 = Math.max(aLat + 0.03 * sT, OB ? OB.a1 + mgO : -Infinity), b0 = Math.min(bF - 0.06 * sT, OB ? OB.b0 - mgO : Infinity), b1 = Math.max(bTop + 0.025 * sT, OB ? OB.b1 + mgO : -Infinity);
  // the fascia's height field along D (5 mm grid... da), smoothed 1 cm
  const ga0 = a0 - 0.02, gb0 = b0 - 0.02, na = Math.ceil((a1 + 0.02 - ga0) / da) + 1, nb = Math.ceil((b1 + 0.02 - gb0) / da) + 1, HF = new Float32Array(na * nb).fill(NaN);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const a = ga0 + i * da, b = gb0 + j * da; let t = 0.16, hit = NaN;
    for (let k = 0; k < 300 && t > -0.2; k++) { const p = toW(a, b, t), d = U.d(p[0], p[1], p[2]); if (d <= 0.0008) { hit = t; break; } t -= Math.max(0.0005, 0.75 * (d - 0.0008)); }
    HF[i + na * j] = hit; }
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) if (!(HF[i + na * j] === HF[i + na * j])) { let v = NaN; for (let q = 1; q < na && v !== v; q++) { const l = HF[Math.max(0, i - q) + na * j], r = HF[Math.min(na - 1, i + q) + na * j]; v = l === l ? l : r; } HF[i + na * j] = v === v ? v : 0; }
  const HFs = blur2(HF, na, nb, 0.01 / da);
  const bil = (G, a, b) => { const fi = clamp((a - ga0) / da, 0, na - 1.001), fj = clamp((b - gb0) / da, 0, nb - 1.001), i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    return (G[i + na * j] * (1 - u) + G[i + 1 + na * j] * u) * (1 - v) + (G[i + na * (j + 1)] * (1 - u) + G[i + 1 + na * (j + 1)] * u) * v; };
  // v11: the chest's ordinary subcutis where the region hands back = the PERSON's: its thickness measured on the person's own skin outside the anchoring ring
  // above the footprint's middle (the upper chest, the sternum's upper part, the axillary side: lower down, the person's own breast, which the solve replaces,
  // spreads past our footprint and would be read as subcutis); under the breast (inside the footprint) the chest's ordinary subcutis of the table (FATREF x
  // the person's fat, as v10); between them and below (the ring's band, the lower flanks, under the fold) harmonic;
  // smoothed 1 cm. The region's reference skin is then the person's skin where it hands back, and the step between the two lives inside the solve
  // v12: ONE LAYER UNDER THE WHOLE CHEST: measured at EVERY height outside the anchoring ring and outside the person's OLD breast (v11's 'above the
  // footprint's middle' was a stand-in for the old breast: below the fold it read the old lower pole as 3-4 cm of subcutis, so v11 could not measure there and
  // handed back 2 cm in front of its own chest: the trench under the fold); across the old breast (outside our footprint) harmonic from all round it
  const TS = subcutisField(B, ab, { ga0, gb0, na, nb, da, HF: HFs, D, old: OB, known: (a, b) => Math.hypot((a - aC) / ha, (b - bC) / hb) >= RG.out && (OB ? true : b >= bC), inner: (a, b) => Math.hypot((a - aC) / ha, (b - bC) / hb) < 1, dump: opts.dumpTS }, tSCref);
  const tS = (a, b) => bil(TS.F, a, b), tSC = TS.med;   // tSC: the field's median over the measured cells (the report's thresholds and the record)
  const oldW = TS.WO ? (a, b) => bil(TS.WO, a, b) : null;   // v12: 1 over the old breast, 0 by 2 cm outside it (soft/envelope.js: the fit replaces the old breast whole)
  // the mound: rho from the summit (af, bf) (the nipple's foot) to the footprint ellipse along each meridian; the gland's profile along it (v5: the cone of lobes
  // 1 - rho; v4: the lens (1 - rho^2)^0.75), blurred 1.2 cm (the premammary fat rounding the gland), scaled to the record's volume
  // v5's GLAND PROFILE along each meridian from the nipple's foot (d its distance, L the meridian's length to the footprint's edge): 1 - (d / L)^2, a paraboloid,
  // the small-deflection form of a tensioned envelope over incompressible contents (w = p (R^2 - r^2) / 4T) with its apex where the ducts converge; measured in
  // real distance per meridian, so the apex stays ON the foot whatever the meridians' lengths. (Tried first, lane iteration 12: the CONE 1 - rho of the lobes
  // radiating, with the 1.2 cm blur over the whole field: the blur moved the peak 1 cm toward the longer lateral and upper meridians, the nipple on the peak's
  // medial-lower flank (L08 loaded: pointing 13 deg in, 15 deg down); with a hyperbolic tip at the areola's radius the apex held, but a cone puts the volume
  // high: L08's 470 mL projected 10.7 cm off the fascia unloaded (v4 8.4). The paraboloid: 1.5x the cone's volume per unit height.) The 1.2 cm blur (the
  // premammary fat rounding the gland's EDGE) acts toward the edge only (rho 0.35-0.75), so it cannot move the apex.
  const prof = (r, d, Lm) => 1 - (d / Lm) * (d / Lm);   // (v4's lens reference deleted in lane iteration 13)
  let af = 0, bf = 0;
  let gL = 0;   // the last geo call's meridian length (metres), for v5's profile
  const geo = (a, b) => { const u0 = (af - aC) / ha, v0 = (bf - bC) / hb, u = (a - af) / ha, v = (b - bf) / hb, l = Math.hypot(u, v); if (l < 1e-9) { gL = 1; return 0; }
    const du = u / l, dv = v / l, bq = u0 * du + v0 * dv, cq = u0 * u0 + v0 * v0 - 1, tE = -bq + Math.sqrt(Math.max(0, bq * bq - cq)); gL = tE * Math.hypot(du * ha, dv * hb); return l / tE; };
  const Vrec = tb?.volumeMl ? tb.volumeMl * 1e-6 : null, V = clamp(Vrec ?? 380e-6, 100e-6, 1400e-6), Hs = (a, b) => bil(HFs, a, b);
  let T0, RHO, Tb;
  const mound = () => { T0 = new Float32Array(na * nb); RHO = new Float32Array(na * nb);
    for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const a = ga0 + i * da, b = gb0 + j * da, r = geo(a, b); RHO[i + na * j] = r; T0[i + na * j] = r < 1 ? prof(r, Math.hypot(a - af, b - bf), gL) : 0; }
    Tb = blur2(T0, na, nb, 0.012 / da); for (let q = 0; q < Tb.length; q++) { const r = RHO[q], wB = r <= 0.35 ? 0 : r >= 0.75 ? 1 : (x => x * x * (3 - 2 * x))((r - 0.35) / 0.4); Tb[q] = T0[q] + wB * (Tb[q] - T0[q]); }
    let vol = 0; for (let q = 0; q < Tb.length; q++) vol += Tb[q] * da * da; const sc = V / vol; for (let q = 0; q < Tb.length; q++) Tb[q] *= sc; };
  mound();
  const Tm = (a, b) => bil(Tb, a, b), rhoAt = (a, b) => bil(RHO, a, b);
  // v5: the NIPPLE (the apex: the ducts' convergence) on the midclavicular line at the 4th intercostal space, seen from the front; its foot on the fascia back along
  // D (the apex's height depends on the mound's volume over the footprint, so a few fixed-point steps: |step| < 0.1 mm by the 4th)
  const apexShift = []; { const det = E1[0] * E2[1] - E2[0] * E1[1];
    for (let it = 0; it < 6; it++) { const w = Hs(af, bf) + tS(af, bf) + Tm(af, bf), rx = s * xm - O[0] - D[0] * w, ry = yN - O[1] - D[1] * w;
      const na_ = (rx * E2[1] - E2[0] * ry) / det, nb_ = (E1[0] * ry - rx * E1[1]) / det, st = Math.hypot(na_ - af, nb_ - bf); af = na_; bf = nb_; mound(); apexShift.push(+(st * 1000).toFixed(2)); if (st < 1e-4) break; } }
  // the gland: a lens 12-80 % of the mound's thickness, rho < rg; rg for the person's glandular share
  const G0 = TISSUE.gland0, share = clamp(G0.at + G0.bmi * (bmi - 22) + G0.age * (age - 25), G0.min, G0.max);
  let rg = 1; { let lo = 0.05, hi = 1; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; let vg = 0; for (let q = 0; q < Tb.length; q++) if (RHO[q] < m) vg += 0.68 * Tb[q] * da * da; if (vg < share * V) lo = m; else hi = m; } rg = (lo + hi) / 2; }
  const e = 0.002;
  const fieldF = (a, b, w) => {
    const hs = Hs(a, b), t = Tm(a, b), top = hs + tS(a, b) + t;
    const hsa = (Hs(a + e, b) - Hs(a - e, b)) / (2 * e), hsb = (Hs(a, b + e) - Hs(a, b - e)) / (2 * e), ta = (Tm(a + e, b) - Tm(a - e, b)) / (2 * e) + (tS(a + e, b) - tS(a - e, b)) / (2 * e), tbb = (Tm(a, b + e) - Tm(a, b - e)) / (2 * e) + (tS(a, b + e) - tS(a, b - e)) / (2 * e);
    const fB = (hs - w) / Math.sqrt(1 + hsa * hsa + hsb * hsb), fS = (w - top) / Math.sqrt(1 + (hsa + ta) ** 2 + (hsb + tbb) ** 2), fC = Math.max(a0 - a, a - a1, b0 - b, b - b1);
    let d = fB, label = 'base'; if (fS > d) { d = fS; label = 'skin'; } if (fC > d) { d = fC; label = 'cut'; }
    if (label === 'base') { const r = rhoAt(a, b); label = r < RG.in ? 'retro' : r <= RG.out ? 'ring' : 'base'; }   // the deep side by the anchoring ring
    const u = w - hs, rr = rhoAt(a, b); let comp = t > 0.003 && rr < rg && u > 0.12 * t && u < 0.8 * t ? 1 : 0;
    if (rr >= RG.in) comp = 2;   // the ring's band (v8: the ordinary subcutis over the deep adhesion) and the chest's ordinary subcutis outside it
    return { d, comp, label };
  };
  // the deep fascia (solids) and the chest's own skin below the fold (the collider the lower pole lands on), world -> d and the unit gradient
  const fasciaDG = (off) => (x, y, z, g) => { const [a, b, w] = ab([x, y, z]), hs = Hs(a, b) + off(a, b), hsa = (Hs(a + e, b) + off(a + e, b) - Hs(a - e, b) - off(a - e, b)) / (2 * e), hsb = (Hs(a, b + e) + off(a, b + e) - Hs(a, b - e) - off(a, b - e)) / (2 * e), l = Math.sqrt(1 + hsa * hsa + hsb * hsb);
    g[0] = (-hsa * E1[0] - hsb * E2[0] + D[0]) / l; g[1] = (-hsa * E1[1] - hsb * E2[1] + D[1]) / l; g[2] = (-hsa * E1[2] - hsb * E2[2] + D[2]) / l; return (w - hs) / l; };
  // tissue properties by the person
  const Esc = opts.Escale ?? 1, Rsc = opts.retroScale ?? 1, Msc = opts.muScale ?? 1;   // sensitivity knobs (the node sweep of lane iteration 8): the tissue moduli and the retromammary layer's shear stiffness, x
  const SK = TISSUE.skin, Eskin = SK.E0 + (SK.E1 - SK.E0) * clamp((age - SK.a0) / (SK.a1 - SK.a0), 0, 1), lax = tg.laxity ?? 0, LX = TISSUE.laxity;
  const skinLax = 0, creep = LX.creep * lax;   // v6: the retained fraction of the sustained strain (solveBreast's pass 2)
  const parity = tg.parity ?? 0, lactDV = parity >= 1 ? TISSUE.lactation.dV : 0;   // v7: the lactating breast (a parous woman; v9: every parous woman, whatever c)
  // the inframammary line: the footprint ellipse's lower arc (200-340 deg), every ~1 cm: TRACKED (the fold), not tethered (Nava 1998: no ligament)
  const IM = TISSUE.imf, fs = [], fa = [], fl = []; { let prev = null; for (let th = 200; th <= 340; th += 0.5) { const r = th * Math.PI / 180, a = aC + ha * Math.cos(r), b = bC + hb * Math.sin(r);
    if (prev && Math.hypot(a - prev[0], b - prev[1]) < IM.spacing) continue; prev = [a, b]; const hs = Hs(a, b); fs.push(toW(a, b, hs + tS(a, b) + Tm(a, b))); fa.push(toW(a, b, hs)); fl.push([a, b]); } }
  // v8: the fold's zone of adherence: one bound septum a point of the line, k = E w s / L (s the point's share of the line, L the subcutis's thickness there)
  const IL = TISSUE.imfLine, imfK = fs.map((p, i) => { const sh = 0.5 * ((i > 0 ? Math.hypot(...sub(fs[i], fs[i - 1])) : 0) + (i < fs.length - 1 ? Math.hypot(...sub(fs[i + 1], fs[i])) : 0)) || IM.spacing;
    return IL.E * IL.w * sh / Math.max(0.003, Math.hypot(...sub(p, fa[i]))); });
  const tops = []; for (const k of [0]) tops.push(toW(af, bTop, Hs(af, bTop) + tS(af, bTop) + Tm(af, bTop)));
  // THE MODULI (Mazier and Bordas 2024): the tissue's SHEAR from the in vivo calibration under gravity, the BULK kept from the ex vivo moduli (tissue is ~water:
  // nearly incompressible however soft its shear; with E 0.32 kPa and nu 0.49 the bulk would be 5 kPa and the gland lost 3 % of its volume): mu = vivo.E /
  // (2 (1 + nu)) through muScale. THE SKIN's toe: the skin modulus identified TOGETHER with the breast's in the same calibration (E_skin 22.7 kPa with E_breast
  // 0.32 kPa: the two belong together); its smooth stiffening to the linear region (TISSUE.skinFung, v4). The AGE enters only through the record's laxity (the
  // skin's rest excess), not through Agache's factor: Agache's x2 is a small-strain torsion modulus, and the calibration's patients were of an age we do not
  // know, so scaling it again would count age twice and make the older skin hold the breast UP.
  const toe = TISSUE.vivo.Eskin;
  const gR = TISSUE.relaxed.g;   // v4's load path through the pocket's envelope (the relaxed parenchyma, the Fung skin): the current tissue model
  const Efat = TISSUE.fat.E, Egl = TISSUE.gland.E, mFat = TISSUE.vivo.E / TISSUE.fat.E, mGl = TISSUE.vivo.E / TISSUE.gland.E, retroI = { kind: 'sliding', G: TISSUE.retro.G * Rsc, t: TISSUE.retro.t, kn: TISSUE.retro.kn };
  const R = {
    name: 'breast.' + side, h, frame: { O, ax: [E1, E2, D] }, box: null, fieldF,
    compartments: [{ name: 'fat', kind: 'fat', mat: { ...TISSUE.fat, E: Efat * Esc, muScale: Msc * mFat * gR } }, { name: 'gland', kind: 'gland', mat: { ...TISSUE.gland, E: Egl * Esc, muScale: Msc * mGl * gR } }, { name: 'subcutis', kind: 'fat', mat: { ...TISSUE.subcutis, muScale: 1 } }],
    solids: { dg: fasciaDG(() => 0) },
    // inside the ring the retromammary layer slides; the ring is bonded (the main adhesion); outside it the chest's ordinary layer slides
    interfaces: [{ label: 'retro', ...retroI }, { label: 'ring', kind: 'bonded', kn: TISSUE.retro.kn }, { label: 'base', ...retroI }],
    membranes: [{ name: 'skin', label: 'skin', E: toe, beta: TISSUE.skinFung.beta, t: SK.t, laxity: skinLax, compress: SK.compress }],
    // no Cooper's ligament to the chest wall (Duraes 2026); v8: the fold's dermis bound to the deep fascia (Boutros 1998), one septum a point of the line
    tethers: [{ name: 'imf', kind: 'bound', skin: fs, anchor: fa, k: imfK, give: IL.give }],
    colliders: [{ name: 'chest skin', dg: fasciaDG(tS), margin: 0, applies: (p0, lab) => { if (lab !== 'skin') return false; const [a, b] = ab(p0); return Tm(a, b) > 0.002; } }],
    cuts: [[-1, 0, a0], [1, 0, a1], [0, -1, b0], [0, 1, b1]].map(([sa, sb, v]) => ({ p: sa ? toW(v, 0, 0) : toW(0, v, 0), n: sa ? E1.map(c => c * sa) : E2.map(c => c * sb), kind: 'held' })),
    gravity: (opts.posture ?? 'standing') === 'supine' ? [0, 0, -9.81] : [0, -9.81, 0], pose: 'bind', posture: opts.posture ?? 'standing',   // supine: a CHECK posture (lying on the back: gravity to -z)
    track: [{ name: 'nipple', p: toW(af, bf, Hs(af, bf) + tS(af, bf) + Tm(af, bf)) },{ name: 'top', p: tops[0] }, ...fs.map((p, i) => ({ name: 'fold' + i, p }))],
    surfH: opts.surfH ?? 0.0025, massFloor: opts.massFloor ?? 1,
  };
  // the grid frame is (E1, E2, D), so fieldF(u, v, w) is fieldF(a, b, w)
  let wMin = Infinity, wMax = -Infinity; for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const a = ga0 + i * da, b = gb0 + j * da; if (a < a0 || a > a1 || b < b0 || b > b1) continue; const hs = HFs[i + na * j]; wMin = Math.min(wMin, hs); wMax = Math.max(wMax, hs + TS.F[i + na * j] + Tb[i + na * j]); }
  R.box = [a0 - h, b0 - h, wMin - 2 * h, a1 + h, b1 + h, wMax + 2 * h];
  R.meta = { side, s, sT, H, tSC, tS, tSCref, tSfield: TS.stats, oldW, oldBreast: OB ? { verts: OB.n, thr: OB.thr, abCm: [OB.a0, OB.a1, OB.b0, OB.b1].map(v => +(v * 100).toFixed(1)) } : null, D, E1, E2, O, ab, toW, Hs, Tm, rhoAt, sup, CL, fold, yN, r2, xm, xMed, xLat, aMed, aLat, bTop, bF, a0, a1, b0, b1, Vcm3: +(V * 1e6).toFixed(0), Vsrc: Vrec != null ? 'record' : 'default 380',
    share: +share.toFixed(3), rg: +rg.toFixed(3), Tmax: Tm(af, bf), af, bf, reference: 'gland', apexShiftMm: apexShift, Eskin, skinModel: 'fung', skinBeta: +TISSUE.skinFung.beta.toFixed(2), relaxG: gR, skinToe: toe, skinToeSrc: 'vivo (Mazier 2024)', skinLax, laxity: lax, parity: tg.parity ?? null, nImf: fs.length, foldAB: fl,
    ptosisRec: tb?.ptosis ?? null, gradeRec: tb?.grade ?? null, age, bmi, Escale: Esc, retroScale: Rsc, muScale: Msc, version: SOFT_BREAST_VERSION, creep, lactDV, historyAB: 'development (v10) + largest load (v7)', moduli: 'vivo', supports: 'deep adhesion + bound fold line (v8)', imf: 'bound', imfK: +(imfK.reduce((a, b) => a + b, 0) / Math.max(1, imfK.length)).toFixed(0), Etissue: Efat * Esc * Msc * mFat * gR, posture: R.posture, subcutis: TISSUE.subcutis.E,
    skinGrowth: 'v9: grown past theta_crit under the standing load (' + TISSUE.skinGrowth.devRounds + ' rounds) and, parous, the lactating load (' + TISSUE.skinGrowth.lactRounds + ')' };
  return R;
}
// v11: the chest's ordinary subcutaneous thickness from the person's own skin (B: bodyOf's prior body, hm08's torso triangles, region 2), normal to the deep
// fascia, on the region's grid: measured where known(a, b), clamped to [skin + 1 mm, 5 cm]; the table's (tRef) where inner(a, b); filled harmonically between
// (Gauss-Seidel on the grid, the grid's edges free); smoothed 1 cm; returned along the region's axis D. Without the body's regions, tRef everywhere.
function subcutisField(B, ab, G, tRef) {
  const { ga0, gb0, na, nb, da, HF, known, inner = () => false } = G, N = na * nb, P = B?.pos, T = B?.tri, nV = B?.nb, RG8 = B?.region, tMin = 0.0025, tMax = 0.05;
  const flat = why => ({ F: new Float32Array(N).fill(tRef), med: tRef, stats: { src: why, measured: 0 } });
  if (!P || !T || !nV || !RG8) return flat('FATREF (no body regions)');
  const Q = new Float64Array(nV * 3); for (let v = 0; v < nV; v++) { const q = ab([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); Q[v * 3] = q[0]; Q[v * 3 + 1] = q[1]; Q[v * 3 + 2] = q[2]; }
  const HB = new Float32Array(N).fill(NaN);
  // v12: the skin read is the person's OUTER skin facing out along D: torso and upper-arm triangles (hm08's hero labels put part of the lateral chest wall
  // in 'upper arm': v11 read torso only, so on the lateral chest it found the posterior axilla's skin 6 cm behind our fascia and clamped to the floor), each
  // kept only where its outward normal (oriented away from the trunk's axis at its height) faces along D
  const zMid = new Map(), axisZ = y => { const k = Math.round(y * 100); if (!zMid.has(k)) { const m = midline(B, y); zMid.set(k, m && m.front === m.front && m.back === m.back ? (m.front + m.back) / 2 : 0); } return zMid.get(k); };
  const Dw = G.D, outward = (A, Bv, C) => { const ax = P[A * 3], ay = P[A * 3 + 1], az = P[A * 3 + 2], ux = P[Bv * 3] - ax, uy = P[Bv * 3 + 1] - ay, uz = P[Bv * 3 + 2] - az, vx = P[C * 3] - ax, vy = P[C * 3 + 1] - ay, vz = P[C * 3 + 2] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1, cx = (ax + P[Bv * 3] + P[C * 3]) / 3, cy = (ay + P[Bv * 3 + 1] + P[C * 3 + 1]) / 3, cz = (az + P[Bv * 3 + 2] + P[C * 3 + 2]) / 3;
    const sg = nx * cx + nz * (cz - axisZ(cy)) >= 0 ? 1 : -1; return !Dw || sg * (nx * Dw[0] + ny * Dw[1] + nz * Dw[2]) / l > 0.1; };
  for (let t = 0; t < T.length; t += 3) { const A = T[t], Bv = T[t + 1], C = T[t + 2]; if (A >= nV || Bv >= nV || C >= nV) continue;
    const rA = RG8[A], rB = RG8[Bv], rC = RG8[C]; if (!((rA === 2 || rA === 3) && (rB === 2 || rB === 3) && (rC === 2 || rC === 3)) || !outward(A, Bv, C)) continue;
    const xa = Q[A * 3], ya = Q[A * 3 + 1], xb = Q[Bv * 3], yb = Q[Bv * 3 + 1], xc = Q[C * 3], yc = Q[C * 3 + 1], den = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc); if (Math.abs(den) < 1e-14) continue;
    const i0 = Math.max(0, Math.floor((Math.min(xa, xb, xc) - ga0) / da)), i1 = Math.min(na - 1, Math.ceil((Math.max(xa, xb, xc) - ga0) / da)), j0 = Math.max(0, Math.floor((Math.min(ya, yb, yc) - gb0) / da)), j1 = Math.min(nb - 1, Math.ceil((Math.max(ya, yb, yc) - gb0) / da));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = ga0 + i * da, y = gb0 + j * da, l1 = ((yb - yc) * (x - xc) + (xc - xb) * (y - yc)) / den, l2 = ((yc - ya) * (x - xc) + (xa - xc) * (y - yc)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; const h = l1 * Q[A * 3 + 2] + l2 * Q[Bv * 3 + 2] + l3 * Q[C * 3 + 2], k = i + na * j; if (!(HB[k] >= h)) HB[k] = h; } }
  // the thickness NORMAL to the fascia (the subcutis's own thickness: along D it is 1 / cos of the fascia's slope larger on the chest's flanks), filled, then back along D
  const sl = new Float32Array(N); for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const gx = (HF[Math.min(na - 1, i + 1) + na * j] - HF[Math.max(0, i - 1) + na * j]) / ((Math.min(na - 1, i + 1) - Math.max(0, i - 1)) * da),
    gy = (HF[i + na * Math.min(nb - 1, j + 1)] - HF[i + na * Math.max(0, j - 1)]) / ((Math.min(nb - 1, j + 1) - Math.max(0, j - 1)) * da); sl[i + na * j] = Math.sqrt(1 + gx * gx + gy * gy); }
  // v12: the person's OLD breast on the grid: the breastFoot field at the frontmost skin (every body triangle: the as-built nipple's own triangles are not
  // labelled torso) above the threshold; never measured as subcutis; WO its weight for the fit (1 on it, 0 by 2 cm outside it: a 2-pass chamfer distance)
  const OB = G.old, OLD = new Uint8Array(N); let nOld = 0, WO = null;
  if (OB) { const FB = new Float32Array(N).fill(NaN), HT = new Float32Array(N).fill(NaN);
    for (let t = 0; t < T.length; t += 3) { const A = T[t], Bv = T[t + 1], C = T[t + 2]; if (A >= nV || Bv >= nV || C >= nV) continue;
      const xa = Q[A * 3], ya = Q[A * 3 + 1], xb = Q[Bv * 3], yb = Q[Bv * 3 + 1], xc = Q[C * 3], yc = Q[C * 3 + 1], den = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc); if (Math.abs(den) < 1e-14) continue;
      const i0 = Math.max(0, Math.floor((Math.min(xa, xb, xc) - ga0) / da)), i1 = Math.min(na - 1, Math.ceil((Math.max(xa, xb, xc) - ga0) / da)), j0 = Math.max(0, Math.floor((Math.min(ya, yb, yc) - gb0) / da)), j1 = Math.min(nb - 1, Math.ceil((Math.max(ya, yb, yc) - gb0) / da));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = ga0 + i * da, y = gb0 + j * da, l1 = ((yb - yc) * (x - xc) + (xc - xb) * (y - yc)) / den, l2 = ((yc - ya) * (x - xc) + (xa - xc) * (y - yc)) / den, l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue; const h = l1 * Q[A * 3 + 2] + l2 * Q[Bv * 3 + 2] + l3 * Q[C * 3 + 2], k = i + na * j; if (!(HT[k] >= h)) { HT[k] = h; FB[k] = l1 * OB.f[A] + l2 * OB.f[Bv] + l3 * OB.f[C]; } } }
    const dist = new Float32Array(N).fill(1e9), d1 = da, d2 = da * Math.SQRT2;
    for (let k = 0; k < N; k++) if (FB[k] > OB.thr) { OLD[k] = 1; dist[k] = 0; nOld++; }
    for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const k = i + na * j; let d = dist[k]; if (i > 0) d = Math.min(d, dist[k - 1] + d1); if (j > 0) { d = Math.min(d, dist[k - na] + d1); if (i > 0) d = Math.min(d, dist[k - na - 1] + d2); if (i < na - 1) d = Math.min(d, dist[k - na + 1] + d2); } dist[k] = d; }
    for (let j = nb - 1; j >= 0; j--) for (let i = na - 1; i >= 0; i--) { const k = i + na * j; let d = dist[k]; if (i < na - 1) d = Math.min(d, dist[k + 1] + d1); if (j < nb - 1) { d = Math.min(d, dist[k + na] + d1); if (i < na - 1) d = Math.min(d, dist[k + na + 1] + d2); if (i > 0) d = Math.min(d, dist[k + na - 1] + d2); } dist[k] = d; }
    WO = new Float32Array(N); for (let k = 0; k < N; k++) { const t = Math.min(1, dist[k] / 0.02); WO[k] = 1 - t * t * (3 - 2 * t); } }
  const F = new Float32Array(N), K = new Uint8Array(N), acc = [];
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const k = i + na * j; if (HB[k] === HB[k] && !OLD[k] && known(ga0 + i * da, gb0 + j * da)) { F[k] = clamp((HB[k] - HF[k]) / sl[k], tMin, tMax); K[k] = 1; acc.push(F[k]); } }
  if (acc.length < 20) return flat('FATREF (the person\'s skin not found around the breast)');
  acc.sort((p, q) => p - q); const med = acc[acc.length >> 1]; let nIn = 0;
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const k = i + na * j; if (K[k]) continue; if (inner(ga0 + i * da, gb0 + j * da)) { F[k] = tRef; K[k] = 2; nIn++; } else F[k] = med; }
  for (let it = 0; it < 1500; it++) for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) { const k = i + na * j; if (K[k]) continue;
    F[k] = (F[Math.max(0, i - 1) + na * j] + F[Math.min(na - 1, i + 1) + na * j] + F[i + na * Math.max(0, j - 1)] + F[i + na * Math.min(nb - 1, j + 1)]) / 4; }
  const Fs = blur2(F, na, nb, 0.01 / da), mm = v => +(v * 1000).toFixed(1); for (let k = 0; k < N; k++) Fs[k] *= sl[k];   // back along D
  if (G.dump) G.dump({ HB, F, K, sl, na, nb, OLD, WO });
  const nFloor = acc.filter(v => v <= tMin + 1e-6).length;
  return { F: Fs, med, WO, stats: { src: OB ? 'v12: the person\'s skin (prior body, torso) minus the deep fascia, normal to the fascia, at every height outside the ring and outside the person\'s old breast (hm08 breastFoot > ' + OB.thr + '); the table under our breast; harmonic between' : 'the person\'s skin (prior body, torso) minus the deep fascia, normal to the fascia, outside the ring above the footprint\'s middle (no breastFoot field); the table under the breast; harmonic between',
    measured: acc.length, inner: nIn, oldCells: nOld, onFloor: nFloor, mm: { p5: mm(acc[Math.floor(0.05 * acc.length)]), p50: mm(med), p95: mm(acc[Math.floor(0.95 * acc.length)]) }, tRefMm: mm(tRef) } };
}
// v12: the person's OLD (as-built) breast: hm08's 'breastFoot' vertex field (BODY7's footprint of the as-built breast; f > thr = inside it, measure.js's
// reading) on this side of the prior body, and its extent in the region's frame. null without the field (the region then keeps v11's upper-chest reading).
function oldBreast(B, ab, s, thr = 0.08) {
  const FF = B?.field?.('breastFoot'); if (!FF?.ix || !B.pos) return null;
  const nV = B.nb, f = new Float32Array(nV); for (let i = 0; i < FF.ix.length; i++) if (FF.ix[i] < nV) f[FF.ix[i]] = FF.f[i];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity, n = 0;
  for (let v = 0; v < nV; v++) { if (f[v] <= thr || B.pos[v * 3] * s < 0.005) continue; const q = ab([B.pos[v * 3], B.pos[v * 3 + 1], B.pos[v * 3 + 2]]);
    a0 = Math.min(a0, q[0]); a1 = Math.max(a1, q[0]); b0 = Math.min(b0, q[1]); b1 = Math.max(b1, q[1]); n++; }
  return n ? { f, thr, a0, a1, b0, b1, n } : null;
}
function solve3(A, b) {   // Cramer
  const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A); return [0, 1, 2].map(c => det(A.map((r, i) => r.map((v, j) => j === c ? b[i] : v))) / d);
}

export function solveBreast(B, K, M, opts = {}) {
  // v4's relaxed parenchyma settles more slowly (its shear x 0.1): ~6 s simulated to static equilibrium (v3: ~1.8 s), so its default horizon is 8 s (the solve stops when converged)
  const R = breastRegion(B, K, M, opts), S = buildSoft(R), so = { maxTime: R.meta.relaxG < 1 ? 8 : 3, ...(opts.solve || {}) }, SG = TISSUE.skinGrowth, grows = true;
  const LA = TISSUE.lactation, par = new Set(['fat', 'gland']), hist = {};
  // v10: DEVELOPMENT: the bud standing, its skin at rest over the footprint, the parenchyma grown back to today's volume in stages with the skin's growth
  const DV = TISSUE.development, dev = { v0: DV.v0, stages: [] }; {
    const g0 = Math.cbrt(DV.v0), m = R.meta, sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const where = q => { const [a, b] = m.ab(q); return 1 - sst(DV.rho0, DV.rho1, m.rhoAt(a, b)); }, stage = { ...so, maxTime: DV.stageTime, minTime: DV.stageTime, log: null };
    setGrowth(S, (nm) => par.has(nm) ? g0 : 1); const Lb = solveSoft(S, so);
    dev.bud = { g0: +g0.toFixed(4), converged: Lb.stats.converged, inverted: Lb.stats.inverted, nippleCm: Lb.track.nipple.map(v => +(v * 100).toFixed(2)), rest: skinGrowth(S, Lb.surface.pos, { lamCrit: SG.lamCrit, mode: 'expanded', where }).restChangePct };
    for (let k = 1; k <= DV.stages; k++) { const gk = Math.pow(g0, 1 - k / DV.stages); setGrowth(S, (nm) => par.has(nm) ? gk : 1); const Ls = solveSoft(S, stage), gs = skinGrowth(S, Ls.surface.pos, { lamCrit: SG.lamCrit, mode: 'grow' });
      dev.stages.push({ g: +gk.toFixed(4), vmaxMmS: Ls.stats.residualMmS, inverted: Ls.stats.inverted, grown: gs.edges, restP95: gs.restChangePct.p95 }); } }
  // today's standing load (the developed breast's)
  let L = solveSoft(S, so);
  // v9 (1): the skin past its physiological limit under the standing load grows to the limit (a fixed point: grow, solve again)
  if (grows) { hist.standing = [];
    for (let k = 0; k < SG.devRounds; k++) { const g = skinGrowth(S, L.surface.pos, { lamCrit: SG.lamCrit, mode: 'grow' }); L = solveSoft(S, so);
      hist.standing.push({ ...g, converged: L.stats.converged, time: L.stats.time, nippleCm: L.track.nipple.map(v => +(v * 100).toFixed(2)) }); } }
  // v7: a parous woman's LACTATING breast: the parenchyma (fat, gland inside the ring) grown in place by the lactating volume, ramped in stages, solved standing
  let grow = null;
  if (R.meta.lactDV > 0) { let Vp = 0; for (let t = 0; t < S.TF.length; t++) if (par.has(R.compartments[S.TC[t]].name)) Vp += S.Vol[t] * (S.TF[t] > 0.05 ? S.TF[t] : 0);
    const g = Math.cbrt(1 + R.meta.lactDV / Vp), stage = { ...so, maxTime: LA.stageTime, minTime: LA.stageTime, log: null }, ramp = [];
    for (let k = 1; k <= LA.stages; k++) { const gk = Math.pow(g, k / LA.stages), r = setGrowth(S, (nm) => par.has(nm) ? gk : 1), Ls = solveSoft(S, stage); ramp.push({ g: +gk.toFixed(4), dVcm3: r.dVcm3, vmaxMmS: Ls.stats.residualMmS }); }
    grow = { g: +g.toFixed(4), parenchymaCm3: +(Vp * 1e6).toFixed(1), dVml: +(R.meta.lactDV * 1e6).toFixed(0), ramp }; L = solveSoft(S, so);
    grow.lactating = { nippleCm: L.track.nipple.map(v => +(v * 100).toFixed(2)), skinStrainPct: L.stats.skinStrainPct, converged: L.stats.converged };
    // v9 (2): the skin over-stretched by the lactating breast GROWS (irreversible), held for months: the growth's equilibrium under the lactating load
    if (grows) { grow.skin = []; for (let k = 0; k < SG.lactRounds; k++) { const gs = skinGrowth(S, L.surface.pos, { lamCrit: SG.lamCrit, mode: 'grow' }); L = solveSoft(S, so); grow.skin.push({ ...gs, converged: L.stats.converged }); } } }
  // v6 / v7: every support keeps c (the record's laxity: the elastic recovery lost with age and parity) of the deformation it carried under the largest sustained load
  // (the lactating breast for a parous woman, else today's), the skin (skinCreep) and the tissue, the sliding layers and the bound line (tissueCreep)
  let cr = null; const L1 = L;
  if (R.meta.creep > 0) { cr = skinCreep(S, L1.surface.pos, R.meta.creep); cr.tissue = tissueCreep(S, R.meta.creep, grow ? (nm) => par.has(nm) ? grow.g : 1 : 1, L1.surface.pos); }
  // the gland involutes after weaning (the growth ramped out); the grown skin and the crept supports stay
  if (grow) { const stage = { ...so, maxTime: LA.stageTime, minTime: LA.stageTime, log: null }; grow.unramp = [];
    for (let k = LA.stages - 1; k >= 0; k--) { const gk = Math.pow(grow.g, k / LA.stages), Ls = (setGrowth(S, (nm) => par.has(nm) ? gk : 1), solveSoft(S, stage)); grow.unramp.push({ g: +gk.toFixed(4), vmaxMmS: Ls.stats.residualMmS }); } }
  if (cr || grow) L = solveSoft(S, so);
  L.stats.creep = { ...(cr || { frac: 0 }), development: dev, ...(grow ? { lactation: grow } : {}), ...(hist.standing ? { standingGrowth: hist.standing } : {}),
    pass1: { time: L1.stats.time, converged: L1.stats.converged, nippleCm: L1.track.nipple.map(v => +(v * 100).toFixed(2)), skinStrainPct: L1.stats.skinStrainPct, surfVolCm3: L1.stats.surfVolCm3 } };
  return { R, S, L, report: breastReport(B, R, S, L) };
}
// the creep (v6): rest length x (1 + c max(0, e)) on every membrane edge of the skin, e its strain at the loaded positions P (surface vertices); S's constraints edited in place
export function skinCreep(S, P, c) {
  const iSkin = S.surf.labels.indexOf('skin'), lab = S.surf.label, sets = []; let n = 0;
  for (const m of S.cons.memb) { if (lab[m.a] !== iSkin || lab[m.b] !== iSkin) continue; const l = Math.hypot(P[m.a * 3] - P[m.b * 3], P[m.a * 3 + 1] - P[m.b * 3 + 1], P[m.a * 3 + 2] - P[m.b * 3 + 2]), e = l / m.L - 1;
    if (e <= 0) continue; const f = 1 + c * e; m.L *= f; if (Number.isFinite(m.Llock)) { m.Llock *= f; m.Leff *= f; } sets.push(c * e); n++; }
  sets.sort((a, b) => a - b); const pc = q => sets.length ? +(sets[Math.min(sets.length - 1, Math.floor(q * sets.length))] * 100).toFixed(1) : 0;
  return { frac: c, edges: n, setPct: { p50: pc(0.5), p95: pc(0.95), max: pc(1) } };
}

// THE CHECKS (never construction): the sagittal section through the loaded nipple (world x = const), unloaded vs loaded, and the literature's numbers
// (lane iteration 23, a CHECK only: the solve and the bake key are unchanged) the published STANDING anthropometry the report prints BESIDE ours (described,
// never a target, never a threshold): the upper : lower pole height about the nipple's level (Mallucci and Branford 2012, J Plast Reconstr Aesthet Surg 65:8,
// PMID 21868295: 100 natural breasts of topless models chosen for their attractiveness, three-quarter profile: 45 : 55 in every one, the nipple angled up
// 20 deg from its meridian, the upper pole linear or slightly concave, the lower pole convex); the nipple's distance from the sternal notch and from the fold
// along the skin, standing, nulliparous women 18-32 (J West Afr Coll Surg 2021, PMC9516749, 370 Nigerian students, tape: SN-N 22.1 +- 3.5 cm, N-IMF
// 9.9 +- 2.5 cm, projection 6.5 +- 1.3 cm, volume 417 +- 155 mL); ANSUR II's bust point (dyAnsurCm). SUPINE, for the unloaded reference's nipple (the
// lane's NOTES iteration 23): the inter-nipple line 5.6 +- 1.9 cm above the xiphoid in women, 6.2 +- 1.8 in men (Shin, Rhee and Kim 2007, Resuscitation
// 75:305, PMID 17590258, 189 adults, CT); at the sternal border in the 4th / 5th / 6th / 7th / 8th intercostal space in 12 / 30 / 33 / 22 / 3 % (Cureus 2021,
// PMC7925053, 64 adults over 40, 37 women, ultrasound)
export const LIT = { upperShareMallucci: 0.45, nipplePitchMallucciDeg: 20, snNcm: [22.1, 3.5], nImfCm: [9.9, 2.5], projectionCm: [6.5, 1.3], supineINLaboveXiphoidCm: { f: [5.6, 1.9], m: [6.2, 1.8] }, src: 'Mallucci and Branford 2012 (PMID 21868295); J West Afr Coll Surg 2021 (PMC9516749); Shin 2007 (PMID 17590258); ANSUR II' };
export function breastReport(B, R, S, L) {
  const m = R.meta, H = m.H, sup = m.sup, s = m.s, cm = v => +(v * 100).toFixed(1), Nl = L.track.nipple, N0 = S.trk[0].p0, labs = L.surface.labels, iSkin = labs.indexOf('skin'), iBase = labs.indexOf('base');
  const x = Nl[0], secL = sectionX(L.surface.pos, L.surface.tri, L.surface.label, [iSkin], x), sec0 = sectionX(L.surface.pos0, L.surface.tri, L.surface.label, [iSkin], x);
  const iB = [iBase, labs.indexOf('retro'), labs.indexOf('ring')].filter(i => i >= 0);   // v2: the deep side carries three labels
  const secB = sectionX(L.surface.pos, L.surface.tri, L.surface.label, iB, x), sec0B = sectionX(L.surface.pos0, L.surface.tri, L.surface.label, iB, x);
  // the fascia in the plane: for each y, z where the solids' d = 0 (bisection along z)
  const G = [0, 0, 0], fasc = []; for (let y = sup[1] + 0.01; y > m.fold - 0.09; y -= 0.0025) { let zf = N0[2] + 0.1, zb = N0[2] - 0.15; if (R.solids.dg(x, y, zf, G) < 0 || R.solids.dg(x, y, zb, G) > 0) continue;
    for (let k = 0; k < 30; k++) { const zm = (zf + zb) / 2; if (R.solids.dg(x, y, zm, G) > 0) zf = zm; else zb = zm; } fasc.push([y, (zf + zb) / 2]); }
  const zFas = y => { let best = null; for (const p of fasc) if (!best || Math.abs(p[0] - y) < Math.abs(best[0] - y)) best = p; return best ? best[1] : NaN; };
  // the loaded skin section as an ordered polyline (top to bottom)
  const poly = chain(secL), poly0 = chain(sec0);
  const tsAt = p => m.tS ? m.tS(...m.ab([x, p[0], p[1]]).slice(0, 2)) - m.tSC : 0;   // v11: the subcutis is a field: the thresholds below are tSC + margin, taken locally
  const proud = (p, lim) => R.solids.dg(x, p[0], p[1], G) > lim + tsAt(p);   // the skin more than lim off the fascia (along its normal)
  const thr = m.tSC + 0.003;
  const iN = nearestIdx(poly, [Nl[1], Nl[2]]), upper = poly.filter(p => p[0] > Nl[1] && proud(p, thr)), lower = poly.filter(p => p[0] < Nl[1] && proud(p, thr));
  const yTop = upper.length ? Math.max(...upper.map(p => p[0])) : Nl[1], yLow = lower.length ? Math.min(...lower.map(p => p[0])) : Nl[1];
  // the loaded fold: the tracked inframammary line's skin point nearest the nipple's x (and the line's lowest point within 2 cm of it)
  const folds = Object.entries(L.track).filter(([k]) => k.startsWith('fold')).map(([, p]) => p), folds0 = S.trk.filter(t => t.name.startsWith('fold')).map(t => t.p0);
  const near = (P, xx) => P.reduce((b, p) => Math.abs(p[0] - xx) < Math.abs(b[0] - xx) ? p : b, P[0]);
  const fL = near(folds, x), f0 = near(folds0, N0[0]), yFold = fL[1];
  // nipple to the fold along the loaded skin section
  const iF = nearestIdx(poly, [fL[1], fL[2]]); let arc = 0; for (let i = Math.min(iN, iF); i < Math.max(iN, iF); i++) arc += Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][1] - poly[i][1]);
  // the lower pole: the chord from the nipple to the crease (the fold's skin point or the lowest proud point, the lower), its slope from the vertical, convexity
  const cr = yLow < yFold ? lower.reduce((b, p) => p[0] < b[0] ? p : b, lower[0]) : [fL[1], fL[2]], slope = Math.atan2(Nl[2] - cr[1], Nl[1] - cr[0]) * 180 / Math.PI;
  let convex = -Infinity; for (const p of lower) { if (p[0] < cr[0]) continue; const t = (Nl[1] - p[0]) / Math.max(1e-6, Nl[1] - cr[0]), zc = Nl[2] + t * (cr[1] - Nl[2]); convex = Math.max(convex, p[1] - zc); }
  // the nipple's direction at the areola's scale: a plane through the loaded skin vertices within 1.5 cm
  const P = L.surface.pos, lab = L.surface.label, pts = []; for (let v = 0; v < lab.length; v++) if (lab[v] === iSkin && Math.hypot(P[v * 3] - Nl[0], P[v * 3 + 1] - Nl[1], P[v * 3 + 2] - Nl[2]) < 0.015) pts.push([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
  const nN = planeNormal(pts, m.D), pitch = Math.asin(clamp(nN[1], -1, 1)) * 180 / Math.PI, yaw = Math.atan2(s * nN[0], nN[2]) * 180 / Math.PI;
  const pts0 = []; const P0 = L.surface.pos0; for (let v = 0; v < lab.length; v++) if (lab[v] === iSkin && Math.hypot(P0[v * 3] - N0[0], P0[v * 3 + 1] - N0[1], P0[v * 3 + 2] - N0[2]) < 0.015) pts0.push([P0[v * 3], P0[v * 3 + 1], P0[v * 3 + 2]]);
  const nN0 = planeNormal(pts0, m.D), pitch0 = Math.asin(clamp(nN0[1], -1, 1)) * 180 / Math.PI;
  const projL = Math.max(...poly.map(p => p[1] - zFas(p[0])).filter(Number.isFinite)), proj0 = Math.max(...poly0.map(p => p[1] - zFas(p[0])).filter(Number.isFinite));
  // the rear: the base points' lift off the fascia (a pocket) and their slide
  let lift = 0, slide = 0; { const B0 = S.surf.pos0; for (const c of S.cons.base) { const v = c.v, q = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]; lift = Math.max(lift, R.solids.dg(q[0], q[1], q[2], G)); slide = Math.max(slide, Math.hypot(q[0] - B0[v * 3], q[1] - B0[v * 3 + 1], q[2] - B0[v * 3 + 2])); } }
  const dyF = Nl[1] - yFold, grade = dyF > 0.01 ? 0 : dyF > -0.01 ? 1 : dyF > -0.03 ? 2 : 3;
  // v6's skin in the same plane (the body mesh, for the chart and the comparison at the nipple's height)
  const bt = []; for (let i = 0; i < B.tri.length; i += 3) if (B.tri[i] < B.nb && B.tri[i + 1] < B.nb && B.tri[i + 2] < B.nb) bt.push(B.tri[i], B.tri[i + 1], B.tri[i + 2]);
  const v6 = sectionX(B.pos, bt, new Int16Array(B.pos.length / 3), null, x).filter(sg => sg[0] < sup[1] + 0.02 && sg[0] > m.fold - 0.1 && Math.max(sg[1], sg[3]) > N0[2] - 0.12);
  let zv6 = -Infinity; for (const sg of v6) for (const [yy, zz] of [[sg[0], sg[1]], [sg[2], sg[3]]]) if (Math.abs(yy - Nl[1]) < 0.004) zv6 = Math.max(zv6, zz);
  const ansurY = sup[1] - 0.0971 * H;
  // SHAPE (lane iteration 10; the c3 it2 measurer's proposed gates, measures/it2_c3.md issues 1, 2, 5, 6, 7; checks only): the lower pole walked down
  // from the nipple every 5 mm of arc to the crease (the loaded fold's section point): the local angle from the vertical (0 a vertical wall, 90 a
  // horizontal shelf); the shelf = the arc at >= 75 deg; a step more than 10 deg below the one above it breaks the monotone (convex) turn into the crease
  const walk = []; { let acc = 0, mark = 0.005, prev = poly[iN]; const iEnd = iF > iN ? iF : Math.min(poly.length - 1, iN + 400);
    for (let i = iN + 1; i <= iEnd; i++) { acc += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]); if (acc < mark) continue;
      const q = poly[i]; walk.push(+(Math.atan2(Math.abs(q[1] - prev[1]), Math.max(1e-9, Math.abs(q[0] - prev[0]))) * 180 / Math.PI).toFixed(0)); prev = q; mark += 0.005; } }
  let breaks = 0; for (let i = 1; i < walk.length; i++) if (walk[i] < walk[i - 1] - 10) breaks++;
  const up10 = poly.filter(p => p[0] > Nl[1] && proud(p, m.tSC + 0.010)), yTop10 = up10.length ? Math.max(...up10.map(p => p[0])) : Nl[1];
  const dyF0 = Nl[1] - f0[1], grade0 = dyF0 > 0.01 ? 0 : dyF0 > -0.01 ? 1 : dyF0 > -0.03 ? 2 : 3;
  const shape = { lowerWalkDeg: walk, shelfArcCm: +(0.5 * walk.filter(a => a >= 75).length).toFixed(1), wallArcCm: +(0.5 * walk.filter(a => a <= 15).length).toFixed(1), monotoneBreaks: breaks,
    foldDropCm: cm(fL[1] - f0[1]), nAboveFold0Cm: cm(dyF0), gradeVsImagingFold: grade0, lowestBelowFold0Cm: cm(f0[1] - yLow),
    upperShare10: +((yTop10 - Nl[1]) / Math.max(1e-6, yTop10 - Math.min(yLow, yFold))).toFixed(2), nipplePitchDeg: +pitch.toFixed(1), nippleYawOutDeg: +yaw.toFixed(1) };
  return {
    shape, literature: LIT,
    side: m.side, x: cm(x), checks: {
      nippleDropCm: cm(Nl[1] - N0[1]), nippleForwardCm: cm(Nl[2] - N0[2]), nippleOutCm: cm(s * (Nl[0] - N0[0])),
      foldDropCm: cm(fL[1] - f0[1]), nAboveFoldCm: cm(dyF), gradeSolved: grade, gradeRecord: m.gradeRec, ptosisRecord: m.ptosisRec != null ? +m.ptosisRec.toFixed(2) : null,
      nToFoldArcCm: cm(arc), lowestBelowFoldCm: cm(yFold - yLow), upperPoleCm: cm(yTop - Nl[1]), lowerPoleCm: cm(Nl[1] - Math.min(yLow, yFold)), upperShare: +((yTop - Nl[1]) / Math.max(1e-6, yTop - Math.min(yLow, yFold))).toFixed(2),
      lowerSlopeDeg: +slope.toFixed(1), lowerConvexMm: Number.isFinite(convex) ? +(convex * 1000).toFixed(1) : null, nipplePitchDeg: +pitch.toFixed(1), nippleYawOutDeg: +yaw.toFixed(1), nipplePitch0Deg: +pitch0.toFixed(1),
      projectionCm: { ref: cm(proj0), loaded: cm(projL) }, snNcm: cm(Math.hypot(Nl[0] - sup[0], Nl[1] - sup[1], Nl[2] - sup[2])), nUnderNotchCm: cm(sup[1] - Nl[1]), dyAnsurCm: cm(Nl[1] - ansurY),
      halfCm: cm(Math.abs(Nl[0])), rearLiftMm: +(lift * 1000).toFixed(1), rearSlideMaxMm: +(slide * 1000).toFixed(1), v6MinusOursAtNippleMm: Number.isFinite(zv6) ? +((zv6 - Nl[2]) * 1000).toFixed(1) : null,
      ...(m.version >= 2 ? { posture: m.posture, dyIcs4Cm: cm(Nl[1] - m.yN), nUnderNotch0Cm: cm(sup[1] - N0[1]), dyAnsur0Cm: cm(N0[1] - ansurY) } : {}) },
    tissue: { Vcm3: m.Vcm3, Vsrc: m.Vsrc, glandShare: m.share, rg: m.rg, tSCmm: +(m.tSC * 1000).toFixed(1), tSCrefMm: m.tSCref != null ? +(m.tSCref * 1000).toFixed(1) : null, tSfield: m.tSfield || null, TmaxCm: cm(m.Tmax), EskinMPa: +(m.Eskin / 1e6).toFixed(2), skinModel: m.skinModel, skinToeKPa: m.skinToe ? +(m.skinToe / 1000).toFixed(0) : null, skinBeta: m.skinBeta, relaxG: m.relaxG, skinLaxPct: +(m.skinLax * 100).toFixed(1), creepFrac: m.creep != null ? +m.creep.toFixed(2) : null, historyAB: m.historyAB, lactDVml: +(m.lactDV * 1e6).toFixed(0), cooperSlackPct: +(m.cooperSlack * 100).toFixed(1), imfSlackPct: +(m.imfSlack * 100).toFixed(1), laxity: +m.laxity.toFixed(2), parity: m.parity, Escale: m.Escale, retroScale: m.retroScale, muScale: m.muScale, nCooper: m.nCooper, nImf: m.nImf, axisD: m.D.map(v => +v.toFixed(3)), ...(m.version >= 2 ? { version: m.version, moduli: m.moduli, EtissuePa: m.Etissue, supports: m.supports, imf: m.imf, skinToeSrc: m.skinToeSrc, ring: [TISSUE.ring.in, TISSUE.ring.out] } : {}), ...(m.version >= 3 ? { subcutisPa: m.subcutis } : {}), skinGrowth: m.skinGrowth },
    section: { x: cm(x), notchY: cm(sup[1]), ansurY: cm(ansurY), fold0: [cm(f0[1]), cm(f0[2])], foldL: [cm(fL[1]), cm(fL[2])], N0: [cm(N0[1]), cm(N0[2])], NL: [cm(Nl[1]), cm(Nl[2])],
      skin0: poly0.map(p => [cm(p[0]), cm(p[1])]), skinL: poly.map(p => [cm(p[0]), cm(p[1])]), base0: chain(sec0B).map(p => [cm(p[0]), cm(p[1])]), baseL: chain(secB).map(p => [cm(p[0]), cm(p[1])]),
      fascia: fasc.map(p => [cm(p[0]), cm(p[1])]), v6: v6.map(sg => sg.map(cm)) } };
}
function nearestIdx(P, q) { let b = 0, bd = Infinity; P.forEach((p, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; b = i; } }); return b; }
// segments [y0, z0, y1, z1] -> the longest chain, ordered from its highest end down
function chain(segs) {
  if (!segs.length) return []; const key = (y, z) => Math.round(y * 1e6) + ',' + Math.round(z * 1e6), adj = new Map(), pt = new Map();
  segs.forEach(([y0, z0, y1, z1], i) => { for (const [y, z] of [[y0, z0], [y1, z1]]) { const k = key(y, z); pt.set(k, [y, z]); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(i); } });
  const used = new Uint8Array(segs.length); let best = [];
  for (let s0 = 0; s0 < segs.length; s0++) { if (used[s0]) continue; const comp = new Set([s0]), st = [s0]; while (st.length) { const i = st.pop(); used[i] = 1; for (const [y, z] of [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]]) for (const j of adj.get(key(y, z))) if (!comp.has(j)) { comp.add(j); st.push(j); } }
    if (comp.size > best.length) best = [...comp]; }
  // walk from an end (a point with one segment in the component), else from the highest point
  const inC = new Set(best), deg = k => adj.get(k).filter(i => inC.has(i)).length; let start = null;
  for (const i of best) for (const [y, z] of [[segs[i][0], segs[i][1]], [segs[i][2], segs[i][3]]]) { const k = key(y, z); if (deg(k) === 1 && (!start || y > pt.get(start)[0])) start = k; }
  if (!start) { for (const i of best) { const k = key(segs[i][0], segs[i][1]); if (!start || segs[i][0] > pt.get(start)[0]) start = k; } }
  const out = [pt.get(start)], seen = new Set(); let cur = start;
  for (;;) { const nx = adj.get(cur).find(i => inC.has(i) && !seen.has(i)); if (nx == null) break; seen.add(nx); const a = key(segs[nx][0], segs[nx][1]), b = key(segs[nx][2], segs[nx][3]); cur = a === cur ? b : a; out.push(pt.get(cur)); }
  return out;
}
function planeNormal(pts, D) {
  if (pts.length < 3) return D.slice(); const c = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length), C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - c[i]) * (p[j] - c[j]);
  // the smallest eigenvector by inverse iteration on C + eps I
  let v = D.slice(); const A = C.map((r, i) => r.map((x, j) => x + (i === j ? 1e-12 : 0)));
  for (let it = 0; it < 40; it++) { const w = solve3(A, v), l = Math.hypot(...w) || 1; v = w.map(x => x / l); }
  if (v[0] * D[0] + v[1] * D[1] + v[2] * D[2] < 0) v = v.map(x => -x); return v;
}
