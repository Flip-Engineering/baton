export const meta = {
  name: 'round3-heads',
  description: 'Round 3 from JUDGE c8 (steps 3, 4): HAIR3 (women\'s styles that read from the front; blondes not helmets; card hair density) and FACE3 (women\'s dimorphism within range, seams at face/neck/hairline, wet deep eyes, seeded expressions, optional light make-up)',
  phases: [ { title: 'Build', detail: 'HAIR3 and FACE3 in parallel' } ],
}
const H = args.house
const J = `READ FIRST: the independent judge's verdict, review/studio_human_c8/judge_c8/NOTES.md (scores and ranked list), and integration v2's notes, review/studio_human_c8/after/integration2/NOTES.md (makePerson v2 in lib/fx/person/v2.js; lab_person who=v2:faces|women|men|row). The judge: women score below men everywhere mainly because of their HEADS: 'L08, L20 and L12 look like adolescent boys from the front'; women's hair 2/10 ('styles hug the skull and the buns vanish from the front; blondes look like helmets'); faces 3/10 for women ('same slack open mouth and flat eyes on everyone; visible seams on the cheek and neck'). The client (3 Oct): lineups must look 'just realistic', common to attractive, never ugly; women carried as fully as men. SCAN c1 (real scanned heads, review/studio_human_c8/after/scan/NOTES.md) runs beside you: read it; it is the long-term face base.`
const HAIR3 = `${H}

${J}

You are HAIR3 (lane D is done: lib/fx/hair/ and assets/hair/styles/ are yours now; notes review/studio_human_c8/after/hair/NOTES.md; keep its tests and its opt-in rule). Build women's styles that read from the FRONT and at 270 px: shoulder-length loose (straight, wavy), a ponytail and a bun with face-framing pieces and visible volume, curly and coily volume (not frizz), a bob, a pixie that reads feminine, braids/locs with volume, each by group-appropriate texture; men's styles keep working. Fix blondes reading as helmets (density, strand-level variation, root shadow, light transmission) and the card look at 1:1 (thinner, more, varied cards; clumping; flyaways; hairline density ramps). Assign styles in v2 (V2_PLAN in lib/fx/person/v2.js: coordinate through notes with the integrator's file; you may edit the style assignment table). Deliver: the 12 v2 people head-on and three-quarter at 270 and 1:1, before (v2) | after; a style sheet for women and men. NOTES.md in review/studio_human_c8/after/hair3/. Final message under 400 words.`
const FACE3 = `${H}

${J}

You are FACE3 (FACE c2 is done: lib/fx/face/ is yours; lane B's lib/fx/likeness/ is done and yours to extend for the items below, opt-in, keeping its tests). Build: (1) DIMORPHISM WITHIN RANGE for women: brow height and arch, softer jaw and chin, lip fullness, lash density, cheek fullness, by each person's own range and group; check every woman head-on at 270 px and 1:1 reads as a woman (never caricature, never one ideal). (2) SEAMS: close the decal seams at the face/neck boundary and the hairline (blend albedo and normal across the boundary, or carry one body-wide map). (3) EYES: a tear-line meniscus, caruncle, lid ambient occlusion, wet specular, depth (lane B's eyes.js). (4) EXPRESSION: a closed-mouth neutral and a slight-smile look, seeded per person (no more cloned slack open mouths). (5) An OPTIONAL light make-up layer for women (lane B: brow fill, a little lip colour, lash darkening; off by default; on in casting presets where appropriate). Deliver: the 6 v2 faces at 1:1 and the 12 head-on at 270, before (v2) | after; NOTES.md in review/studio_human_c8/after/face3/. Final message under 400 words.`
const GP = { agentType: 'general-purpose' }
const [hr, fc] = await parallel([
  () => agent(HAIR3, { ...GP, label: 'HAIR3: women\'s hair, card realism', phase: 'Build' }),
  () => agent(FACE3, { ...GP, label: 'FACE3: dimorphism, seams, eyes, expression', phase: 'Build' }),
])
return { HAIR3: hr, FACE3: fc }
