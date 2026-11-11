"""(Since 8 Oct the measures it yields no longer judge the people: the landmarks serve the side-by-side boards. Our renders are judged by looking at them beside the references at the same crop and size (refmeasure.py board / localboard, hair_sheets.py), not by where a number falls in the photographs' spread.)
REFMEASURE face pass: ONE MediaPipe Face Landmarker detection per image, and from it the face proportions (measure 1), the skin colour and
fine-detail energy (measure 2) and the hair beside the face (measure 5), the same code on a photograph and on one of our renders.

Frame: origin at the midpoint of the pupils (iris centres), x along the pupil line, y down the face, unit = the interpupillary distance (IPD).
So y of any landmark is its distance below the pupil line in IPD units and the geometry is scale-free and tilt-free; yaw biases widths, so only
near-frontal faces are kept (|yaw index| < 0.2, as FACE2's ref_measure.py).

Index set and the keys that FACE2's ref_measure.py also has (face_w, lower_verm, upper_verm, mouth_open, smile) are the same definitions.
Run under the MediaPipe venv (rm_common.FIGVENV_PY): numpy, cv2, PIL, mediapipe.

8 Oct revision (CHECK.md; NOTES.md 'INSTRUMENTS REVISED'):
  * SKIN patches are JUDGED before they count (judge_patch): within-patch L* p90 - p10 above SPREAD_MAX, hair pixels (MediaPipe's hair segmenter,
    ~/.cache/acp_human/models/hair_segmenter.tflite; else a dark-pixel rule) above HAIR_FRAC_MAX, or a cheek whose L* sits more than |CMF_MIN| below the
    forehead's, is REJECTED with its reason; each cheek is measured on its own and only the clean one(s) are kept; flush_a = cheek a* - forehead a*.
  * cheek_hf (the pore-scale floor) is measured per clean cheek, on faces with IPD >= HF_MIN_IPD_FACTOR x HF_IPD only (so the INTER_AREA reduction is >= 2 and
    averages JPEG blocking away); the caller refuses JPEG plates (refmeasure.our_face_plates).
  * analyse_mirror(): every plate is averaged with its mirror (landmark noise: CHECK.md M4).
  * persp_xy(): the geometry ratios can be re-projected to a longer lens from MediaPipe's z (CHECK.md M1): see PERSPECTIVE below.
"""
import math, os, sys
import numpy as np
import cv2
from PIL import Image, ImageOps
import rm_common as C
from measure6 import lab_of

IRIS_R, IRIS_L = 468, 473
ZY_R, ZY_L = 234, 454
N_, SN, PRN, ME = 168, 2, 1, 152
STO_U, STO_L, LS, LI = 13, 14, 0, 17
CH_R, CH_L = 61, 291
BROW_UP_R, BROW_LO_R = [70, 63, 105, 66, 107], [46, 53, 52, 65, 55]
BROW_UP_L, BROW_LO_L = [336, 296, 334, 293, 300], [276, 283, 282, 295, 285]
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132,
        93, 234, 127, 162, 21, 54, 103, 67, 109]
CHEEK_R, CHEEK_L = 50, 280
TEMPLE_R, TEMPLE_L = 21, 251
YAW_MAX = 0.2
HF_IPD = 100.0          # the common scale of the fine-detail measure: every face resampled to this many pixels between the pupils
HF_MIN_IPD_FACTOR = 2.0 # a face must have at least this many times HF_IPD between the pupils: the reduction to HF_IPD then averages >= 2 x 2 px (JPEG blocking, sensor noise)
# SKIN patch judgement (CHECK.md H3 / H4). Frozen thresholds: SPREAD_MAX and CMF_MIN are the checker's (the photos' cheek-minus-forehead L* p10 was -14);
# HAIR_FRAC_MAX is ours (a hair strand across a cheek is pore-scale detail to the high-pass; 5 % of the patch is enough to read as texture).
SPREAD_MAX = 20.0       # within-patch L* p90 - p10 (raw pixels, before the skin mask): above this the patch holds an edge (hair, shadow, glasses, lips)
CMF_MIN = -14.0         # cheek L* minus forehead L* (skin-masked medians): below this the cheek is in shadow (the photos' p10)
HAIR_FRAC_MAX = 0.05    # share of the patch that is hair
DARK_DROP = 25.0        # colour fallback when the hair segmenter is missing: pixels this many L* below the patch median count as hair / deep shadow
HAIR_MODEL = os.path.expanduser('~/.cache/acp_human/models/hair_segmenter.tflite')
IPD_MM = 63.0           # adult mean interpupillary distance, to turn MediaPipe's z (pixels) into millimetres for the perspective re-projection
PERSP_REF_M = 2.0       # default reference distance: ours are re-projected to a camera this far from the iris plane (only when ours was nearer)
PLATE_CAM_M = {'front': 0.96, 'face': 0.96, 'tele': 2.47}   # camera to iris-plane distance of each plate kind, metres (lab_front: 0.99 m from the head joint,
                                                            # the eyes are 3 cm forward of it; lab_front tele=1: 2.5 m from the head joint)
_DET = None
_SEG = None


def detector():
    global _DET
    if _DET is None:
        import mediapipe as mp
        from mediapipe.tasks import python as mpt
        from mediapipe.tasks.python import vision
        opts = vision.FaceLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=C.FACE_MODEL), num_faces=1, output_face_blendshapes=True,
                                            min_face_detection_confidence=0.4, min_face_presence_confidence=0.4)
        _DET = vision.FaceLandmarker.create_from_options(opts)
    return _DET


def load_rgb(path, max_side=1600):
    im = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    if max(im.size) > max_side:
        s = max_side / max(im.size); im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    return np.asarray(im)


def detect(rgb):
    import mediapipe as mp
    r = detector().detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    if not r.face_landmarks: return None
    h, w = rgb.shape[:2]
    L = np.array([[p.x * w, p.y * h, p.z * w] for p in r.face_landmarks[0]])
    bs = {c.category_name: c.score for c in r.face_blendshapes[0]} if r.face_blendshapes else {}
    return dict(L=L, bs=bs)


class Frame:
    """the face frame: P(x, y) -> pixel, F(pixel) -> (x, y), both in IPD units from the pupil midpoint"""
    def __init__(self, L2):
        self.L = L2; self.ipd = float(np.linalg.norm(L2[IRIS_L] - L2[IRIS_R]))
        self.o = (L2[IRIS_R] + L2[IRIS_L]) / 2
        self.ex = (L2[IRIS_L] - L2[IRIS_R]) / self.ipd; ey = np.array([-self.ex[1], self.ex[0]])
        if np.dot(L2[ME] - self.o, ey) < 0: ey = -ey
        self.ey = ey
    def F(self, p): d = np.asarray(p, float) - self.o; return np.array([np.dot(d, self.ex), np.dot(d, self.ey)]) / self.ipd
    def P(self, x, y): return self.o + (x * self.ex + y * self.ey) * self.ipd
    def fx(self, i): return self.F(self.L[i])[0]
    def fy(self, i): return self.F(self.L[i])[1]


def oval_width_at(fr, y):
    """width (IPD units) of the face oval's polyline in the face frame at height y (None when it does not span y)"""
    pts = np.array([fr.F(fr.L[i]) for i in OVAL]); xs = []
    for a, b in zip(pts, np.roll(pts, -1, 0)):
        if (a[1] - y) * (b[1] - y) < 0: xs.append(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]))
    return (max(xs) - min(xs)) if len(xs) >= 2 else None



# ---------------------------------------------------------------- hair mask and the judgement of a skin patch
def hair_seg():
    """MediaPipe's hair segmenter (a 780 kB tflite in ~/.cache/acp_human/models), or None when the file is missing (then judge_patch uses the dark-pixel rule)"""
    global _SEG
    if _SEG is None:
        if not os.path.exists(HAIR_MODEL): _SEG = False
        else:
            import mediapipe as mp
            from mediapipe.tasks import python as mpt
            from mediapipe.tasks.python import vision
            _SEG = vision.ImageSegmenter.create_from_options(vision.ImageSegmenterOptions(base_options=mpt.BaseOptions(model_asset_path=HAIR_MODEL),
                                                                                         output_category_mask=False, output_confidence_masks=True))
    return _SEG or None


def hair_mask(rgb):
    """-> bool array (H, W) of hair pixels (hair-class confidence > 0.5), or None without the segmenter"""
    s = hair_seg()
    if s is None: return None
    import mediapipe as mp
    r = s.segment(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    return r.confidence_masks[1].numpy_view() > 0.5


def judge_patch(patch, hair_patch=None):
    """-> dict(spread, hair_frac, reasons): the raw L* spread (p90 - p10), the share of hair pixels (segmenter mask, else pixels DARK_DROP below the patch median),
    and the reasons this patch is not skin (empty list = clean). The skin-like fraction is judged by skin_lab()."""
    L = lab_of(patch.reshape(-1, 3).astype(float))[:, 0]
    p10, p50, p90 = np.percentile(L, [10, 50, 90]); spread = float(p90 - p10)
    hf = float(hair_patch.mean()) if hair_patch is not None else float(np.mean(L < p50 - DARK_DROP))
    reasons = []
    if spread > SPREAD_MAX: reasons.append(f'L* spread {spread:.0f} > {SPREAD_MAX:.0f}')
    if hf > HAIR_FRAC_MAX: reasons.append(f'hair {100 * hf:.0f}% > {100 * HAIR_FRAC_MAX:.0f}%')
    return dict(spread=round(spread, 1), hair_frac=round(hf, 3), L50_raw=round(float(p50), 1), reasons=reasons)

# ---------------------------------------------------------------- pixel helpers
def lum_Lstar(rgb):
    return lab_of(rgb.reshape(-1, 3).astype(float))[:, 0].reshape(rgb.shape[:2])


def sample_line(Lc, p0, d, ts):
    """bilinear samples of a 2-D array along p0 + t d"""
    xs = p0[0] + ts * d[0]; ys = p0[1] + ts * d[1]
    return cv2.remap(Lc.astype(np.float32), xs.reshape(1, -1).astype(np.float32), ys.reshape(1, -1).astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)[0]


def patch_pixels(rgb, fr, cx, cy, hx, hy):
    """the pixels of an axis-aligned box around the frame point (cx, cy), half sizes hx, hy in IPD units (None when it leaves the image)"""
    c = fr.P(cx, cy); hxp = hx * fr.ipd; hyp = hy * fr.ipd
    x0, x1, y0, y1 = int(round(c[0] - hxp)), int(round(c[0] + hxp)), int(round(c[1] - hyp)), int(round(c[1] + hyp))
    h, w = rgb.shape[:2]
    if x0 < 0 or y0 < 0 or x1 > w or y1 > h or x1 - x0 < 4 or y1 - y0 < 4: return None, (x0, y0, x1, y1)
    return rgb[y0:y1, x0:x1], (x0, y0, x1, y1)


def skin_mask(Lab):
    hue = np.degrees(np.arctan2(Lab[:, 2], Lab[:, 1])); Cc = np.hypot(Lab[:, 1], Lab[:, 2])
    return (hue > 15) & (hue < 80) & (Cc > 4)


def skin_lab(patches, min_frac=0.6):
    """median CIELAB of the skin-like pixels (hue 15-80 deg, chroma > 4, the darkest and brightest 10 % dropped: SKIN6's measure6) over a list of
    patches; None when fewer than min_frac of the pixels are skin-like"""
    px = [p.reshape(-1, 3).astype(float) for p in patches if p is not None]
    if not px: return None
    a = np.concatenate(px); Lab = lab_of(a); m = skin_mask(Lab)
    if m.mean() < min_frac or m.sum() < 40: return None
    lo, hi = np.percentile(Lab[m, 0], [10, 90]); m &= (Lab[:, 0] >= lo) & (Lab[:, 0] <= hi)
    if m.sum() < 30: return None
    med = np.median(Lab[m], 0)
    return dict(L=float(med[0]), a=float(med[1]), b=float(med[2]), C=float(np.hypot(med[1], med[2])), h=float(np.degrees(np.arctan2(med[2], med[1]))))


def hf_prepare(rgb, fr, hm=None):
    """the common-scale picture of the fine-detail measure: the face resampled so the pupils are HF_IPD px apart (INTER_AREA down). None when the face has fewer
    than HF_MIN_IPD_FACTOR x HF_IPD pixels between the pupils: a reduction under 2 does not average JPEG blocking or sensor noise away (CHECK.md H4)."""
    if fr.ipd < HF_MIN_IPD_FACTOR * HF_IPD: return None
    s = HF_IPD / fr.ipd
    small = cv2.resize(rgb, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    Ls = lum_Lstar(small); H = Ls - cv2.GaussianBlur(Ls, (0, 0), 1.5)
    hs = None if hm is None else cv2.resize(hm.astype(np.float32), (small.shape[1], small.shape[0]), interpolation=cv2.INTER_AREA) > 0.5
    return dict(small=small, H=H, hair=hs, fr2=Frame(fr.L[:, :2] * s), s=s)


def hf_patch(prep, cx, cy, hx=0.15, hy=0.15):
    """-> (std of the high-passed L* over the skin-like pixels of one patch, None) or (None, reason). The same rejection as the colour patches, at this scale."""
    if prep is None: return None, 'IPD < %d px (cheek_hf needs a reduction of >= 2)' % int(HF_MIN_IPD_FACTOR * HF_IPD)
    small, H, fr2, hs = prep['small'], prep['H'], prep['fr2'], prep['hair']
    c = fr2.P(cx, cy); hxp, hyp = hx * HF_IPD, hy * HF_IPD
    x0, x1, y0, y1 = int(round(c[0] - hxp)), int(round(c[0] + hxp)), int(round(c[1] - hyp)), int(round(c[1] + hyp))
    if x0 < 3 or y0 < 3 or x1 > small.shape[1] - 3 or y1 > small.shape[0] - 3: return None, 'patch outside the image'
    pt = small[y0:y1, x0:x1]; j = judge_patch(pt, None if hs is None else hs[y0:y1, x0:x1])
    if j['reasons']: return None, '; '.join(j['reasons']) + ' (at the common scale)'
    m = skin_mask(lab_of(pt.reshape(-1, 3).astype(float)))
    if m.mean() < 0.7: return None, 'skin-like fraction %.0f%% < 70%%' % (100 * m.mean())
    return float(np.std(H[y0:y1, x0:x1].reshape(-1)[m])), None


# ---------------------------------------------------------------- the brow
def brow_img(Ls, fr):
    """brow thickness from the picture, IPD units: across each brow's middle three landmark pairs, the L* profile along the face's y axis in a
    window of +-0.5 IPD about the pair's mid-height; the width (FWHM) of the dark run that holds the profile's minimum (searched within +-0.3
    IPD). The landmarks only say where the brow is (the mesh model draws an average brow, so landmark thickness barely varies);
    the profile says how much of that place is hair. None when the brow is lighter than 8 L* below its skin (blonde, grey, plucked)."""
    ws = []
    for up, lo in ((BROW_UP_R, BROW_LO_R), (BROW_UP_L, BROW_LO_L)):
        for k in (1, 2, 3):
            pu, pl = fr.L[up[k], :2], fr.L[lo[k], :2]; c = (pu + pl) / 2
            n = int(round(1.0 * fr.ipd))
            if n < 20: return None
            ts = np.linspace(-0.5, 0.5, n) * fr.ipd
            prof = sample_line(Ls, c, fr.ey, ts); prof = cv2.GaussianBlur(prof.reshape(1, -1), (0, 0), max(1.0, 0.012 * fr.ipd)).ravel()
            core = np.abs(ts / fr.ipd) <= 0.3
            if not core.any(): continue
            i0 = int(np.where(core)[0][np.argmin(prof[core])]); mn = prof[i0]
            e = max(3, n // 5); ref = max(np.median(prof[:e]), np.median(prof[-e:]))
            if ref - mn < 8: continue
            thr = ref - 0.5 * (ref - mn); a = i0; b = i0
            while a > 0 and prof[a - 1] < thr: a -= 1
            while b < n - 1 and prof[b + 1] < thr: b += 1
            ws.append((b - a + 1) / n)
    return float(np.median(ws)) if len(ws) >= 3 else None


def brow_lm(fr):
    """the landmark mesh's own brow thickness (upper minus lower contour, IPD units; for comparison only)"""
    d = [abs(fr.fy(u) - fr.fy(l)) for U, Lw in ((BROW_UP_R, BROW_LO_R), (BROW_UP_L, BROW_LO_L)) for u, l in zip(U[1:4], Lw[1:4])]
    return float(np.mean(d))


# ---------------------------------------------------------------- the hair
def hairline(rgb, fr, ref_lab, Lab_img=None):
    """hairline height, IPD units above the brow's upper contour, at x = +-0.3 IPD (off the centre so a middle parting's skin stripe does not
    count): from just above the brow upward in steps of 0.02 IPD, the first height at which the pixels' CIELAB distance (dE76) from the
    forehead skin stays above 14 for three steps. Returns (height or None, note) and the colour of the hair found just above it."""
    h, w = rgb.shape[:2]
    if Lab_img is None: Lab_img = lab_of(rgb.reshape(-1, 3).astype(float)).reshape(h, w, 3)
    hs, hair_cols = [], []
    for sgn in (-1, 1):
        x = sgn * 0.3; yb = fr.fy(105 if sgn < 0 else 334)           # the brow's upper contour above the arch
        run = 0; found = None
        for k in range(1, 70):
            y = yb - 0.06 - 0.02 * k; c = fr.P(x, y); xi, yi = int(round(c[0])), int(round(c[1])); r = max(2, int(0.025 * fr.ipd))
            if xi - r < 0 or yi - r < 0 or xi + r >= w or yi + r >= h: found = 'edge'; break
            med = np.median(Lab_img[yi - r:yi + r + 1, xi - r:xi + r + 1].reshape(-1, 3), 0)
            dE = float(np.linalg.norm(med - ref_lab))
            run = run + 1 if dE > 14 else 0
            if run == 3: found = (yb - (y + 0.04)) ; break
        if isinstance(found, float):
            hs.append(found)
            y = yb - found - 0.12; c = fr.P(x, y); xi, yi = int(round(c[0])), int(round(c[1])); r = max(3, int(0.05 * fr.ipd))
            if r < xi < w - r and r < yi < h - r: hair_cols.append(np.median(Lab_img[yi - r:yi + r + 1, xi - r:xi + r + 1].reshape(-1, 3), 0))
        elif found == 'edge': hs.append(None)
    hs = [x for x in hs if x is not None]
    hc = np.median(np.array(hair_cols), 0) if hair_cols else None
    return (float(np.mean(hs)) if hs else None), (None if hc is None else dict(L=float(hc[0]), a=float(hc[1]), b=float(hc[2])))


def temple_hair(rgb, fr):
    """the median linear luminance Y of the patch just outside the face oval at the temple, above the ear (both sides pooled): the 'beside the face' hair"""
    ps = []
    for tid, sgn in ((TEMPLE_R, -1), (TEMPLE_L, 1)):
        t = fr.F(fr.L[tid]); p, _ = patch_pixels(rgb, fr, t[0] + sgn * 0.20, t[1] - 0.04, 0.07, 0.10)
        if p is not None: ps.append(p.reshape(-1, 3))
    if not ps: return None, None
    a = np.concatenate(ps).astype(float) / 255.0; lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722]); lab = np.median(lab_of(a * 255.0), 0)
    return float(np.median(Y)), dict(L=float(lab[0]), a=float(lab[1]), b=float(lab[2]))


def lin_Y(lab_L):
    f = (lab_L + 16) / 116.0
    return f ** 3 if f > 6 / 29 else 3 * (6 / 29) ** 2 * (f - 4 / 29)


# ---------------------------------------------------------------- PERSPECTIVE (CHECK.md M1)
def persp_xy(L, shape, cam_m, ref_m):
    """The landmark pixel positions (N, 2) as a camera ref_m from the iris plane would have drawn them (same scale at the iris plane), from the camera distance cam_m
    and MediaPipe's own z. A point z behind the iris plane is drawn at D / (D + z) of its iris-plane scale; moving the camera from D = cam_m to R = ref_m scales
    it by (D + z) / D x R / (R + z). z is MediaPipe's face-mesh depth (pixels, the same scale as x; 63 mm IPD turns it to millimetres): a trained prior of the
    face's depth structure, NOT measured depth, so it is good to about +-10 mm of z = +-1 % of a width, and it can only be applied where the camera distance is KNOWN:
    to our plates (PLATE_CAM_M), never to a photograph. Only when ref_m > cam_m (a long lens is not re-projected to a shorter one)."""
    if not cam_m or not ref_m or ref_m <= cam_m: return L[:, :2]
    h, w = shape[:2]
    ipd = float(np.linalg.norm(L[IRIS_L, :2] - L[IRIS_R, :2])); zi = (L[IRIS_R, 2] + L[IRIS_L, 2]) / 2
    zmm = (L[:, 2] - zi) * (IPD_MM / ipd)
    D, R = cam_m * 1000.0, ref_m * 1000.0
    k = ((D + zmm) / D) * (R / (R + zmm))
    c = np.array([w / 2.0, h / 2.0])
    return c + (L[:, :2] - c) * k[:, None]


# ---------------------------------------------------------------- one image
GEO_KEYS = ('face_w', 'midface_h_w', 'midface_ns_w', 'len_w', 'lower_verm', 'upper_verm', 'mouth_w', 'cheek_full', 'brow_lm')


def geometry(fg):
    """the landmark proportions of a face frame (IPD units); fg = the frame to read them from (the image's own, or its perspective re-projection)"""
    sto = fg.fy(STO_U); fw = abs(fg.fx(ZY_L) - fg.fx(ZY_R))
    g = dict(face_w=fw,                                                 # bizygomatic width / IPD (FACE2: face_w)
             midface_h_w=sto / fw,                                      # pupil line to the stomion over the width
             midface_ns_w=fg.fy(SN) / fw,                               # pupil line to the subnasale over the width (the nose part of it)
             len_w=(fg.fy(ME) - fg.fy(N_)) / fw,                        # nasion to menton over the width (FACE2: len_w)
             lower_verm=fg.fy(LI) - fg.fy(STO_L),                       # lower vermilion height / IPD (FACE2: lower_verm)
             upper_verm=fg.fy(STO_U) - fg.fy(LS),
             mouth_w=abs(fg.fx(CH_L) - fg.fx(CH_R)))
    ow = oval_width_at(fg, sto); g['cheek_full'] = (ow / fw) if ow else None   # face-oval width at the mouth over the bizygomatic width
    g['brow_lm'] = brow_lm(fg)
    return g


def analyse(rgb, want=('geo', 'skin', 'hair'), cam_m=None, ref_m=None, hm=None):
    """-> (dict of measures (floats / None) or {'error': ...}, the face frame).
    cam_m / ref_m: our plate's camera distance and the reference distance for the PERSPECTIVE re-projection of the landmark proportions (see persp_xy); both None for a
    photograph. hm: a precomputed hair mask (bool H x W) or None (computed here)."""
    d = detect(rgb)
    if d is None: return {'error': 'no face'}, None
    fr = Frame(d['L'][:, :2])
    if fr.ipd < 25: return {'error': 'face too small', 'ipd_px': round(fr.ipd, 1)}, None
    m = {'ipd_px': round(fr.ipd, 1), 'img_w': rgb.shape[1], 'img_h': rgb.shape[0]}
    sat = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[..., 1].astype(float) / 255.0
    m['sat95'] = float(np.percentile(sat, 95)); m['grey_image'] = bool(m['sat95'] < 0.08)     # a black-and-white (or desaturated) photograph: no skin colour to measure
    fw = abs(fr.fx(ZY_L) - fr.fx(ZY_R))
    yaw = (abs(fr.fx(ZY_L) - fr.fx(PRN)) - abs(fr.fx(ZY_R) - fr.fx(PRN))) / max(1e-6, fw)
    m['yaw'] = round(float(yaw), 3)
    m['mouth_open'] = round(fr.fy(STO_L) - fr.fy(STO_U), 4)
    bs = d['bs']
    m['smile'] = round(0.5 * (bs.get('mouthSmileLeft', 0) + bs.get('mouthSmileRight', 0)), 3)
    m['squint'] = round(0.5 * (bs.get('eyeSquintLeft', 0) + bs.get('eyeSquintRight', 0)), 3)
    m['blink'] = round(0.5 * (bs.get('eyeBlinkLeft', 0) + bs.get('eyeBlinkRight', 0)), 3)
    if 'geo' in want:
        corrected = bool(cam_m and ref_m and ref_m > cam_m)
        fg = Frame(persp_xy(d['L'], rgb.shape, cam_m, ref_m)) if corrected else fr
        m.update(geometry(fg))
        if corrected:
            m['persp'] = dict(cam_m=cam_m, ref_m=ref_m, z_zyg_ipd=round(float(((d['L'][ZY_R, 2] + d['L'][ZY_L, 2]) / 2 - (d['L'][IRIS_R, 2] + d['L'][IRIS_L, 2]) / 2) / fr.ipd), 3))
            for k, v in geometry(fr).items(): m[k + '_raw'] = v
        Ls = lum_Lstar(rgb); m['brow_img'] = brow_img(Ls, fr)       # read from the picture along the image's own face frame
    if 'skin' in want or 'hair' in want:
        if hm is None: hm = hair_mask(rgb)
        m['hair_mask'] = 'segmenter' if hm is not None else 'colour (dark-pixel rule: the segmenter model is missing)'
        sub = lambda box: None if hm is None else hm[box[1]:box[3], box[0]:box[2]]
        yb = np.mean([fr.fy(105), fr.fy(334)]); y10 = fr.fy(10)
        fy_ = yb + 0.45 * (y10 - yb)                                        # the forehead patch: 45 % of the way from the brow to the oval's top
        fp, fbox = patch_pixels(rgb, fr, 0.0, fy_, 0.25, 0.09)
        fh, m['forehead_reject'] = None, []
        if fp is None: m['forehead_reject'] = ['patch outside the image']
        else:
            fj = judge_patch(fp, sub(fbox)); m['forehead_judge'] = {k: fj[k] for k in ('spread', 'hair_frac')}
            fh = None if fj['reasons'] else skin_lab([fp])
            m['forehead_reject'] = fj['reasons'] or ([] if fh else ['skin-like fraction < 60%'])
        sides, clean = {}, []
        for nm, cid in (('R', CHEEK_R), ('L', CHEEK_L)):
            c = fr.F(fr.L[cid]); p, box = patch_pixels(rgb, fr, c[0], c[1], 0.14, 0.14); s = dict(centre=[round(float(c[0]), 3), round(float(c[1]), 3)])
            if p is None: s.update(ok=False, reasons=['patch outside the image'])
            else:
                j = judge_patch(p, sub(box)); col = skin_lab([p]); rs = list(j['reasons'])
                if col is None and not rs: rs.append('skin-like fraction < 60%')
                s.update(spread=j['spread'], hair_frac=j['hair_frac'], **(col or {}))
                if col and fh:
                    cmf = col['L'] - fh['L']; s['cmf'] = round(float(cmf), 1)
                    if cmf < CMF_MIN: rs.append(f'cheek - forehead L* {cmf:.0f} < {CMF_MIN:.0f} (shadow)')
                elif col: s['cmf'] = None                                   # no clean forehead to compare with: this rule cannot be applied
                s.update(ok=not rs, reasons=rs)
                if not rs: clean.append((nm, p, c))
            sides[nm] = s
        m['cheek_R'], m['cheek_L'] = sides['R'], sides['L']
        ch = skin_lab([p for _, p, _ in clean]) if clean else None
        if ch: ch['sides'] = ''.join(n for n, _, _ in clean)
        m['forehead'] = fh; m['cheek'] = ch
        m['cheek_reject'] = [f'{n}: ' + '; '.join(s['reasons']) for n, s in sides.items() if not s['ok']]
        m['flush_a'] = (ch['a'] - fh['a']) if (ch and fh) else None             # the cheek's regional flush: cheek a* minus forehead a*
        m['flush_L'] = (ch['L'] - fh['L']) if (ch and fh) else None
        if 'skin' in want:
            prep = hf_prepare(rgb, fr, hm); hfs, why = {}, {}
            for nm, p, c in clean:
                hfs[nm], why[nm] = hf_patch(prep, c[0], c[1])
            for nm in 'RL':
                m[f'cheek_hf_{nm}'] = hfs.get(nm)
            vals = [v for v in hfs.values() if v is not None]
            m['cheek_hf'] = float(np.mean(vals)) if vals else None
            m['cheek_hf_why'] = (None if vals else ('no clean cheek' if not clean else '; '.join(f'{n}: {w}' for n, w in why.items() if w)))
            m['forehead_hf'] = hf_patch(prep, 0.0, fy_, 0.25, 0.09)[0] if (prep and fh) else None
    if 'hair' in want:
        ref = None
        if fh: ref = np.array([fh['L'], fh['a'], fh['b']])
        elif m.get('cheek'): ref = np.array([m['cheek']['L'], m['cheek']['a'], m['cheek']['b']])
        Yt, labt = temple_hair(rgb, fr)
        skinY = None
        if fh or m.get('cheek'):
            Ls_ = [x['L'] for x in (fh, m.get('cheek')) if x]; skinY = lin_Y(float(np.mean(Ls_)))
        m['temple_Y'] = Yt; m['temple_lab'] = labt; m['skin_Y'] = skinY
        m['hair_face_Y'] = (Yt / skinY) if (Yt is not None and skinY) else None
        if ref is not None:
            hl, hc = hairline(rgb, fr, ref)
            m['hairline'] = hl; m['hair_lab'] = hc
        else: m['hairline'] = None; m['hair_lab'] = None
    return rnd(m), fr


MIRROR_AVG = GEO_KEYS + tuple(k + '_raw' for k in GEO_KEYS) + ('brow_img', 'hairline', 'hair_face_Y', 'mouth_open', 'smile', 'squint', 'blink')


def analyse_mirror(rgb, want=('geo', 'skin', 'hair'), cam_m=None, ref_m=None):
    """analyse() on the plate AND on its mirror image, the landmark-based keys averaged (CHECK.md M4: the landmarks move up to 0.06 IPD of face width between a
    plate and its mirror). Colour patches, their rejection and cheek_hf are read once, from the plate itself. The yaw index is (plate - mirror) / 2. m['mirror'] lists
    the largest plate-vs-mirror differences, the evidence of the landmark noise. Returns (m, frame of the plate)."""
    m1, fr1 = analyse(rgb, want, cam_m, ref_m)
    if 'error' in m1: return m1, fr1
    w2 = tuple(x for x in want if x != 'skin') or ('geo',)
    m2, _ = analyse(np.ascontiguousarray(rgb[:, ::-1]), w2, cam_m, ref_m)
    if 'error' in m2:
        m1['mirror'] = dict(used=False, why='no face on the mirror image'); return m1, fr1
    m = dict(m1); diff = {}
    for k in MIRROR_AVG:
        a, b = m1.get(k), m2.get(k)
        if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
            m[k] = round((a + b) / 2, 4); diff[k] = round(abs(a - b), 4)
    m['single'] = {k: m1.get(k) for k in GEO_KEYS + ('brow_img', 'mouth_open')}            # the plate alone (selftest: FACE2's ref_measure.py is a single pass)
    m['yaw_single'] = m1['yaw']; m['yaw'] = round((m1['yaw'] - m2['yaw']) / 2, 3)
    m['mirror'] = dict(used=True, max_diff=dict(sorted(diff.items(), key=lambda kv: -kv[1])[:4]), diff=diff)
    return m, fr1


def rnd(o, nd=4):
    if isinstance(o, float): return round(o, nd)
    if isinstance(o, dict): return {k: rnd(v, nd) for k, v in o.items()}
    return o
