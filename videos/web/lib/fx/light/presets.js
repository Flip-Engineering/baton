// LIGHT / presets: times and places, not looks (LIGHTING c1). Each sets sun and sky, exposure, white balance, the air and
// the lens; a scene adds its own practicals (where the lamps ARE is the scene's business) and may override anything.
// A look from looks.js or printlab is applied after the display transform, unchanged.
//   const rec = PRESETS.sodiumNight({ practicals: [...], atmosphere: { density: 0.03 } });
const merge = (a, b) => { const o = { ...a }; for (const k in b || {}) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? { ...a[k], ...b[k] } : b[k]; return o; };
const P = base => (o = {}) => merge(base, o);

export const PRESETS = {
  // a fixed neutral bay for look development: clear mid-morning sun, standard daylight exposure (sunny 16 minus a third)
  lookdev: P({ camera: { ev100: 14.3, wb: 5600 }, sky: { kind: 'clear', elevation: 38, azimuth: 120, turbidity: 2.2 }, sun: { extent: 12, softness: 1 },
    atmosphere: { density: 0.0004, height: 200 }, lens: { bloom: 0.03, halation: 0.15, vignette: 0.2, grain: 0.015 } }),
  // low sun just up through ground haze: warm light on the faces that see the east, a bright hazy sky, long blue shadows
  dawnHaze: P({ camera: { ev100: 12.4, wb: 5200 }, sky: { kind: 'clear', elevation: 3.2, azimuth: 92, turbidity: 6, hazeH: 450, groundAlbedo: 0.15 },
    sun: { softness: 4, extent: 45 }, atmosphere: { density: 0.0024, height: 18, albedo: 0.92, g: 0.72, ambient: 1, maxDist: 450 }, look: { contrast: 1.45 },
    lens: { bloom: 0.045, halation: 0.3, vignette: 0.3, grain: 0.025 } }),
  // (c2) dawn AGAINST the light with a true black: the same sky and sun, but clear near air (visibility ~8 km instead of
  // ~1.5 km: haze between the lens and a silhouette 25 m off, lit from behind by a 4-degree sun, is what lifted c1's
  // shadow side to ~67/255), a narrower bloom, the haze kept for the distance by the sky model and a far ground bank
  dawnContre: P({ camera: { ev100: 12.6, wb: 5200 }, sky: { kind: 'clear', elevation: 3.2, azimuth: 92, turbidity: 6, hazeH: 450, groundAlbedo: 0.12 },
    sun: { softness: 4, extent: 45 }, atmosphere: { density: 0.00045, height: 30, albedo: 0.92, g: 0.76, ambient: 0.6, maxDist: 600 }, look: { contrast: 1.5 },
    lens: { bloom: 0.025, bloomFalloff: 0.42, halation: 0.35, vignette: 0.3, grain: 0.02 } }),
  // golden hour against the light
  goldenHour: P({ camera: { ev100: 12.8, wb: 5600 }, sky: { kind: 'clear', elevation: 9, azimuth: 250, turbidity: 3.5 }, sun: { extent: 45 },
    atmosphere: { density: 0.002, height: 40, g: 0.7 }, lens: { bloom: 0.04, halation: 0.3, vignette: 0.3, grain: 0.02 } }),
  // Becher light: a high overcast, soft, shadowless except where things meet (that is where AO and contact shadows earn it)
  overcastNoon: P({ camera: { ev100: 12.9, wb: 6500 }, sky: { kind: 'overcast', illuminance: 17000, kelvin: 6800, elevation: 50, azimuth: 160, groundAlbedo: 0.16 },
    atmosphere: { density: 0.0009, height: 60, albedo: 0.95, g: 0.3, maxDist: 600 }, lens: { bloom: 0.02, halation: 0.1, vignette: 0.25, grain: 0.02 } }),
  // a clear high sun (for completeness: hard, top-down)
  noonClear: P({ camera: { ev100: 14.8, wb: 5600 }, sky: { kind: 'clear', elevation: 62, azimuth: 170, turbidity: 2.5 }, sun: { extent: 45 },
    atmosphere: { density: 0.0006, height: 300 }, lens: { bloom: 0.025, halation: 0.12, vignette: 0.25, grain: 0.015 } }),
  // pre-dawn blue hour: the sun 4 degrees under, the sky the only source, lamps still on
  blueHour: P({ camera: { ev100: 6.2, wb: 4600 }, sky: { kind: 'clear', elevation: -4, azimuth: 92, turbidity: 3 }, atmosphere: { density: 0.004, height: 30 },
    lens: { bloom: 0.05, halation: 0.35, vignette: 0.35, grain: 0.03 } }),
  // the yard at night under high-pressure sodium in humid air: few strong sources, a dark ambient, halos and cones in the haze.
  // White balance at 4100 K keeps sodium orange and lets mercury go blue-green, as film under mixed light does.
  sodiumNight: P({ camera: { ev100: 4.6, wb: 4100 }, sky: { kind: 'night', skyglow: 0.18, zenith: 0.003, glowAz: 200, groundAlbedo: 0.12 },
    atmosphere: { density: 0.0028, height: 14, albedo: 0.95, g: 0.76, ambient: 1, maxDist: 220 }, lens: { bloom: 0.035, halation: 0.45, vignette: 0.4, grain: 0.035 } }),
  // a mercury-lit yard (the 1950s-80s gantry light: blue-green, no red)
  mercuryYard: P({ camera: { ev100: 4.8, wb: 4000 }, sky: { kind: 'night', skyglow: 0.06, zenith: 0.002 }, atmosphere: { density: 0.01, height: 16, g: 0.6, maxDist: 220 },
    lens: { bloom: 0.05, halation: 0.35, vignette: 0.4, grain: 0.035 } }),
  // a furnace tapped at night: the metal is the key, everything falls off from it (Wright of Derby, Menzel); smoke lit from within
  furnaceNight: P({ camera: { ev100: 5.8, wb: 3600 }, sky: { kind: 'night', skyglow: 0.12, zenith: 0.002, glowAz: 200 },
    atmosphere: { density: 0.0012, height: 16, albedo: 0.9, g: 0.74, maxDist: 200 }, lens: { bloom: 0.04, halation: 0.5, vignette: 0.42, grain: 0.035 } }),
  // a storm: overcast at a quarter of the light, with a flash practical the scene fires
  stormDusk: P({ camera: { ev100: 9.5, wb: 6200 }, sky: { kind: 'overcast', illuminance: 2500, kelvin: 7500, elevation: 10, azimuth: 250 },
    atmosphere: { density: 0.004, height: 60, g: 0.4 }, lens: { bloom: 0.035, halation: 0.2, vignette: 0.35, grain: 0.03 } }),
};
export const PRESET_NOTES = {
  lookdev: 'neutral clear mid-morning, EV100 14.3', dawnHaze: 'sun 4 deg up through ground haze, EV100 12.4',
  goldenHour: 'sun 9 deg, against the light', overcastNoon: 'CIE overcast 17 klx, EV100 12.9', noonClear: 'sun 62 deg',
  blueHour: 'sun 4 deg under, EV100 6.2', sodiumNight: 'HPS night in humid air, EV100 4.6, WB 4100 K', mercuryYard: 'clear-mercury night',
  furnaceNight: 'a tap at night, EV100 6.4, WB 3600 K', stormDusk: 'overcast 2.5 klx, for a flash',
};
