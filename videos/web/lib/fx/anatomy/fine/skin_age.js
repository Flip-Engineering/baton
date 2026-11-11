// ANATOMY / FINE / SKIN AGE (DETAIL7, iteration 6, 8 Oct 2026): how deep a STATIC line is, from the SKIN, for every static line the tier
// draws (forehead, glabellar, procerus, crow's feet, the lid-cheek junction, the nasolabial, marionette, labiomental and commissure creases).
// The client's principle (8 Oct): the lines from the anatomy (dynamic lines perpendicular to each mimetic muscle's fibres, static depth by age
// from the skin's elasticity), not painted patterns; measurements gate, they never construct. Until iteration 5 each family had its own
// [young, old] depth ramp, a sex multiplier (women's glabella x 0.65, men's lines x 1.15) and a 'young' cut: per-feature amplitudes. Here they
// are ONE model of the skin, and the families differ only by their muscle and their skin. Ours, CC0.
//
// A static line is a fold the skin no longer unfolds. An expression folds the skin across the line (the muscle shortens along its fibres and
// the skin over it buckles perpendicular to them: the frontalis' vertical fibres -> horizontal forehead lines, the orbicularis oculi's
// concentric fibres -> radial crow's feet, the corrugators' oblique pull -> near-vertical glabellar lines, the procerus' vertical fibres ->
// a transverse line at the nasal root). A young dermis recovers the fold completely; as its collagen and elastic network degrades part of
// every fold stays SET. So, per line:
//   D_static = A_dyn x set
//   A_dyn = (lambda / pi) sqrt(eps): the fold's amplitude while the muscle contracts. A stiff sheet on a soft base buckles at its own
//           wavelength lambda (the spacing its lines show) and, under a compressive strain eps across the line, takes the amplitude that
//           keeps its length (Cerda and Mahadevan 2003, Phys Rev Lett 90, 074302: A ~ (lambda / pi) sqrt(Delta / L)). lambda scales with
//           the skin's thickness: men's dermis is ~15 % thicker (Shuster, Black and McVitie 1975, as recalled), so men's folds are
//           deeper and wider for the same expression (Luebberding, Krueger and Kerscher 2014: men's forehead, glabellar and crow's feet
//           lines more severe at most ages, as recalled). eps per site: the habitual expression's strain across the line (OURS, from
//           the muscles' excursions: brow raise ~10-12 mm over a ~60 mm frontalis, the brows' heads ~4 mm medially over ~20 mm, the
//           lateral canthal skin compressed ~25 % in a smile; provisional, gated).
//   set   = the share of the fold the skin keeps: the loss of its elastic recovery since its young plateau. The cutometer's recovery
//           ratios (R2, R7) fall roughly linearly with age from the mid-20s; fair facial skin has lost ~35-40 % of its young value by 60
//           (Ryu et al. 2008; Krueger et al. 2011; Luebberding et al. 2013-2014; as recalled), about half intrinsic and half photo-ageing.
//           The photo half scales with the UV the epidermis lets through: a black epidermis transmits about a third of what a white one
//           does (Kaidbey et al. 1979, as recalled); East Asian skin wrinkles about ten years later than European (Nouveau-Richard et al.
//           2005; Tsukahara et al. 2004; as recalled). Women lose dermal collagen faster for ~15 years after the menopause (~2 % a year:
//           Brincat et al. 1987, as recalled).
// The fold's CROSS-SECTION (bake.js 'crease'): a set fold is a CREASE, the sheet hinged at its floor (creases in soft solids are cusps,
// sharpest at the floor: Hong, Zhao and Suo 2009, Appl Phys Lett 95), its walls ~a third of the skin's thickness wide (w = 0.35 t: OURS,
// gated). Iteration 5's lines were Gaussian valleys 0.9-1.2 mm wide with a 12 % core: at the same depth they read in neither renderer
// (the measurer: L05 Cycles E 0.136 = its off twin).
// Every number here is a named constant; the photographs (tools/lines7.py: E, Lmax_frac, cv_med, cohL by age band) GATE the result.
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

export const SKIN_AGE_VERSION = 1;
export const SKIN_AGE = {
  onset: 25,                     // the dermis' young plateau ends (collagen content peaks in the mid-20s; as recalled)
  kIntr: 0.005, kPhoto: 0.005,   // set per year past the onset, intrinsic and photo (fair skin: 0.35 at 60, half each)
  uv: { white: 1, mena: 0.75, hispanic: 0.7, southasian: 0.6, indigenous: 0.6, asian: 0.5, black: 0.33 },   // the photo half's share by the epidermis' UV screen
  meno: { from: 49, to: 64, k: 0.008 },   // women: the post-menopausal collagen loss
  sexT: { m: 1.15, f: 1 },       // the skin's thickness (and so lambda and the hinge's width) by sex
  thin: 0.05,                    // the skin thins ~5 % a decade from 40 (face_tissue.js skinAt)
  hinge: 0.35,                   // a crease's wall width per mm of skin thickness (OURS)
  maxSet: 0.7,
  // the sites: lambda (mm, the spacing the skin's lines show there), eps (the habitual expression's compressive strain across the line), t (mm,
  // the skin's thickness there: Ha et al. 2005, Chopra et al. 2015, as recalled in face_tissue.js), the muscle and its fibres
  sites: {
    forehead:    { lambda: 8.5, eps: 0.15, t: 1.9, muscle: 'frontalis: vertical fibres, horizontal lines' },
    glabella:    { lambda: 9.6, eps: 0.18, t: 1.9, muscle: 'corrugator supercilii: oblique fibres, near-vertical lines' },
    procerus:    { lambda: 6.0, eps: 0.12, t: 1.8, muscle: 'procerus: vertical fibres, a transverse line over the nasal root' },
    crow:        { lambda: 4.5, eps: 0.25, t: 1.1, muscle: 'orbicularis oculi (lateral, orbital part): concentric fibres, radial lines' },
    lidCheek:    { lambda: 5.0, eps: 0.20, t: 1.0, muscle: 'orbicularis oculi (palpebral over orbital part): the lid-cheek junction' },
    nasolabial:  { lambda: 8.0, eps: 0.30, t: 1.6, muscle: 'zygomaticus major and levator labii: the cheek folds over the tethered line' },
    marionette:  { lambda: 6.0, eps: 0.15, t: 1.7, muscle: 'depressor anguli oris over the mandibular ligament' },
    labiomental: { lambda: 7.0, eps: 0.20, t: 2.0, muscle: 'mentalis and orbicularis oris: the lower lip everted' },
    commissure:  { lambda: 4.0, eps: 0.30, t: 1.4, muscle: 'the modiolus' },
  },
};

// the person's skin: the share of a fold it keeps (st: features.js tissueState)
export function skinSet(st) {
  const S = SKIN_AGE, age = st.age ?? 35, y = Math.max(0, age - S.onset), uv = S.uv[st.group] ?? 0.8;
  const intr = S.kIntr * y, photo = S.kPhoto * uv * y, meno = st.sex === 'f' ? S.meno.k * clamp(age - S.meno.from, 0, S.meno.to - S.meno.from) : 0;
  const set = Math.min(S.maxSet, intr + photo + meno);
  return { set, intr: +intr.toFixed(4), photo: +photo.toFixed(4), meno: +meno.toFixed(4), uv, setN: clamp(set / 0.35) };
}

// one site's static fold: D (mm, the depth the skin keeps), w (mm, the crease's wall), Adyn (the fold in the expression), t, lambda
export function staticFold(st, site, o = {}) {
  const S = SKIN_AGE, q = S.sites[site]; if (!q) throw new Error('skin_age: unknown site ' + site);
  const sk = st.skin || skinSet(st), tK = (S.sexT[st.sex] ?? 1) * (1 - S.thin * Math.max(0, (st.age ?? 35) - 40) / 10);
  const t = (o.t ?? q.t) * tK, lambda = (o.lambda ?? q.lambda) * tK, Adyn = lambda / Math.PI * Math.sqrt(o.eps ?? q.eps);
  return { D: Adyn * sk.set, w: S.hinge * t, Adyn, t, lambda, set: sk.set };
}

// the report: every site's fold for this person (numbers only)
export function skinReport(st) {
  const sk = st.skin || skinSet(st), out = { ...sk, set: +sk.set.toFixed(4), setN: +sk.setN.toFixed(3), sites: {} };
  for (const k of Object.keys(SKIN_AGE.sites)) { const f = staticFold(st, k); out.sites[k] = { D: +f.D.toFixed(3), w: +f.w.toFixed(3), Adyn: +f.Adyn.toFixed(3) }; }
  return out;
}
