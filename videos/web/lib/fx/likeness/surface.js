// SKIN OPTICS iteration 11 (16 Oct): THE SKIN'S SURFACE STATE FROM ITS OWN TISSUE (skin rev 7, `skin: { surface }`, ON; `surface: false` the one A/B arm).
// Iteration 12 (16 Oct): the film levels the plateau (3b) and the lobes are drawn at the surface's own alpha and Fresnel (6): version 2.
// What a skin's surface reflects is set by what lies on it and what it is made of, site by site, for any person. The lobes of skin.js (the engine)
// and of blender/person_scene.py skin_material (Cycles) read it; this file is the model, its sources and the renderer conversion.
//
// (1) THE SEBUM FILM. The casual level the glands keep on the surface (ug/cm^2) = the site's gland output (the zones' sebum map, vLikeB.z: the
//     T-zone, chin, upper lip and nasolabial high, the cheeks low, the chest and upper back moderate, the limbs a trace; zones4.js / skin.js, after
//     Pierard-Franchimont's maps; Youn et al. 2005, Skin Res Technol 11:189: forehead, nose and chin above both cheeks) x the person's gland activity
//     by age and sex (skin.js sebumActivity: Pochi, Strauss and Downing 1979). Sebumeter cohorts put the adult forehead's casual level at ~60-130
//     ug/cm^2 (Youn 2005 ~67; other cohorts 110-127): SEBUM.ref, at the zones' forehead density SEBUM.refDensity. None on the palms and soles (no
//     sebaceous glands) and none on the vermilion (glabrous). Thickness h = level / density (sebum ~0.91 g/cm^3: 1 ug/cm^2 ~ 0.011 um).
// (2) ITS COVERAGE. A film of mean thickness h on a plateau whose asperities (the corneocytes' shingled edges, ~0.3-0.5 um cells, lifted further
//     where dry) stand ~h_c covers a share f = 1 - exp(-h / h_c) of it; h_c grows with the site's dryness (lifted scales).
// (3) THE TWO SURFACES. Under the film the corneum / sebum interface reflects almost nothing (eta ~1.50 against 1.47): the base lobe there is the
//     film's. The bare corneum: keratin eta 1.55 (Anderson and Parrish 1981, J Invest Dermatol 77:13: 4-7 % regular reflectance at the air / stratum
//     corneum step), lowered by the surface layers' water (~15-25 % at the surface, Caspers et al. 2001, J Invest Dermatol 116:434: eta ~1.50), rough
//     at the cell scale (PLATEAU.m), rougher where dry (xerosis: the limbs and the shins far drier than the face by corneometry; senile xerosis after ~60).
// (3b) THE FILM LEVELS THE PLATEAU (iteration 12; was one constant FILM.m 0.12 for every thickness). A liquid film's free surface flattens under its
//     surface tension: an undulation of wavelength L in a film of thickness h decays with the time constant tau = 3 eta L^4 / (16 pi^4 sigma h^3)
//     (Orchard 1962, Appl Sci Res A11:451, the levelling of paint films). For sebum (viscosity ~0.05-0.1 Pa s, surface tension ~0.03 N/m) over the
//     corneocytes (L ~30-40 um) tau is ~10 ms at h 1 um and ~1 s at 0.2 um: wherever the film is continuous its surface is flat at the cell scale.
//     What keeps slope is where the plateau still stands through it: the corneocytes' lifted edges and the menisci the film draws round them (sebum
//     wets keratin). So the film's top keeps the plateau's slopes damped by the same exp(-h / h_c) that sets its coverage: m_film = m_plateau x (1 - f)
//     (a thin trace in the furrows: menisci, as rough as the plateau; a thick T-zone film: glassy). The relief under it (pores, furrows, lines: far
//     longer than the film is thick) the film follows: LEAN adds it to this lobe as before. No new number: h_c is the coverage's.
// (4) THE RELIEF (pores, furrows, lines: DETAIL7's fine tier on the face, the engine's meso and furrows on the body) is NOT here: LEAN / Toksvig add
//     its slopes to both lobes, as before (skin.js FRAG4 'var', person_scene.py fine7 'varo'); the pits' hidden share (DETAIL7 i10) takes weight out.
// (5) THE VERMILION: no glands, a thin hydrated corneum (tissue.js VERMILION), its film saliva (eta 1.333) at the wet band toward the contact line.
// (6) DRAWN AS GGX AT THE SURFACE'S OWN ALPHA AND FRESNEL (iteration 12). Skin's slopes are Gaussian: Beckmann, the distribution Weyrich et al. 2006
//     fitted to 149 faces (their Eq. 12). The engine and Cycles draw GGX: at alpha = m the GGX lobe has the Beckmann lobe's peak (D(0) = 1 / (pi m^2)
//     for both) and its energy (both normalised, the same Fresnel); its shoulder is narrower and its tail heavier. Iteration 11 drew alpha x ~1.05
//     with the Fresnel x ~1.6, the GGX that Weyrich's dome FIT cannot tell from the Beckmann lobe: that put 1.6x the energy into the surface that
//     keratin and sebum reflect, and the peak at ~1.46x the Beckmann one (the c5 it2 critic's arithmetic: the predicted lacquer). An instrument's
//     reading is not a reason to make light: the BECK2GGX table and its gain are deleted; each lobe is drawn at its own m and its material's Fresnel.
// CHECKED, not constructed: the model's Beckmann lobes by region fitted with Weyrich's Eq. 12 against their Fig. 15 (skin7/tools/weyrich_fit2.py);
// the drawn GGX lobes the same way (weyrich_fit.py: they read lower, the GGX tail the Beckmann fit cannot take; described in NOTES, not corrected).

export const SURFACE_VERSION = 2;
export const ETA = { keratin: 1.55, water: 1.333, sebum: 1.47 };
export const WATER = 0.2;                                     // the surface layers' water volume fraction (Caspers et al. 2001: ~15-25 %)
export const SEBUM = { ref: 90, refDensity: 0.8, density: 0.91 };   // ug/cm^2 at the zones' forehead density; g/cm^3
export const HC = 1.5;                                        // um: the plateau's asperity height a film must fill (hydrated; corneocytes 0.3-0.5 um, shingled, edges lifted ~1-2 um); x (1 + dryness). Bracketed by the check (1.0-2.0 all within Weyrich's spread); 1.5 sits nearest by region
export const PLATEAU = { m: 0.25, mDry: 0.40 };               // Beckmann m of the bare corneum's plateau, hydrated / xerotic (cell scale; the relief adds by LEAN)
export const DRY = { limb: 0.5, age: [55, 80, 0.4] };   // dryness 0..1: the limbs' against the face (corneometry: the face the most hydrated, the limbs and shins the least; a site between by its corneum: trunk ~0.36, neck ~0.1), the palms' horn 1, + age (senile xerosis)
const f0 = eta => ((eta - 1) / (eta + 1)) ** 2;
const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const etaCorneum = (water = WATER) => ETA.keratin - (ETA.keratin - ETA.water) * water;
// the eta whose normal-incidence Fresnel is f (Cycles' Coat IOR: its only handle on the coat's reflectance)
export const etaOfF0 = f => (1 + Math.sqrt(f)) / (1 - Math.sqrt(f));

// the person's surface: what the shader's uniforms and Cycles' material take. activity: skin.js sebumActivity(years, sex)
export function personSurface({ years = 35, activity = 1 } = {}) {
  const etaC = etaCorneum(), umPerDensity = SEBUM.ref / SEBUM.refDensity / SEBUM.density / 100 * activity;   // um of film per unit of the zones' map (ug/cm^2 / (g/cm^3) = 0.01 um)
  const ageDry = DRY.age[2] * sst(DRY.age[0], DRY.age[1], years);
  // the drawn lobes: GGX at the microsurface's own m (alpha = m) and the material's own Fresnel; the film's alpha is per fragment: (1 - f) x the bare plateau's (3b)
  const aC = PLATEAU.m, aD = PLATEAU.mDry;
  return {
    version: SURFACE_VERSION, etaC: +etaC.toFixed(4), etaFilm: ETA.sebum, f0C: +f0(etaC).toFixed(4), f0Film: +f0(ETA.sebum).toFixed(4),
    umPerDensity: +umPerDensity.toFixed(4), hc: HC, ageDry: +ageDry.toFixed(3), dry: DRY,
    // GGX alpha of the bare plateau hydrated / dry and its perceptual roughness (r = sqrt(alpha): three's and Blender's); film: 'levels' = alpha_film = (1 - f) x alpha_bare
    alphaC: aC, alphaDry: aD, rC: +Math.sqrt(aC).toFixed(4), rDry: +Math.sqrt(aD).toFixed(4), film: 'levels',
    // Cycles: the base's Specular IOR Level 0.5 (the IOR's own Fresnel) x (1 - film); the coat's IOR the film's own
    cycLevelC: 0.5, cycCoatIor: ETA.sebum,
    // the vermilion's own film (saliva) as a share of the coat: water's Fresnel over the coat's
    wetK: +(f0(ETA.water) / f0(ETA.sebum)).toFixed(3),
    source: 'surface.js: sebum film by site x activity (Youn 2005; Pochi 1979), coverage over the corneocytes, keratin + water (Anderson and Parrish 1981; Caspers 2001), the film levelling the plateau (Orchard 1962), GGX at the surface\'s own alpha and Fresnel (Weyrich 2006 Eq. 12 the check)',
  };
}
// the shader's per-fragment model in JS (for node checks; the GLSL in skin.js FRAG7 is the same arithmetic)
export function surfaceAt(S, { density = 0.5, dryness = 0, lip = 0, wet = 0, volar = 0 } = {}) {
  const dry = Math.min(1, Math.max(0, dryness + S.ageDry + volar)) * (1 - lip);
  const h = S.umPerDensity * density * (1 - volar) * (1 - lip), f = 1 - Math.exp(-h / (S.hc * (1 + dry)));
  const fl = Math.min(1, f + lip * wet * S.wetK);
  const alpha = S.alphaC + (S.alphaDry - S.alphaC) * dry;
  const alphaFilm = (1 - fl) * alpha;   // the film levels the plateau (3b); the relief adds by LEAN after
  return { film_um: h, f: fl, alphaBare: alpha, rBare: Math.sqrt(alpha), alphaFilm, rFilm: Math.sqrt(alphaFilm) };
}
