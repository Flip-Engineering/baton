# CAMERA7 (round 7): the PHOTOGRAPHIC display transform, numpy twin of web/lib/fx/light/camera7.js display7() (keep the two in step; the node test
# camera7_test.mjs writes a table of values both read). Opt-in: render_person.py --camera7 <json|preset>; without it acp_display.py's chain is untouched.
#
# Why a second display: acp_display.py / display.js are the studio's ONE display for lamps and furnaces: a hue-preserving curve on the max-RGB norm
# whose white sits +6.5 stops over mid grey (so a lamp core keeps gradation) and whose Oklab path-to-white starts at +2.5 stops. A photograph of a
# person is not that: a camera's tone curve acts on each channel (that is what saturates the mid tones and sends bright colours to white) and clips
# near +3.5 stops over the 18 % card. display7 is that chain, in the same linear Rec.709 working space:
#   1. exposure compensation (stops; the photographer's metering rule, camera7.skinBias) and white balance (the stage's grey card, as before)
#   2. the filmic curve f (Lottes's family, display.js lottesParams: contrast a, shoulder d, mid 0.18 -> midOut, white at +whiteStops) applied
#      twice: on the max-RGB norm (hue kept, display.js's way) and on each channel (a camera's way), mixed by `perChannel`
#   3. colour rendering in Oklab: ONE global chroma gain `sat`, no hue band (c3 iteration 1: the earlier skin vibrance and chroma ceiling were weighted by the
#      Oklab hue and turned a scarlet banner into brick; the colour of a skin is the albedo's and the light's, the camera never sees "skin")
#   4. the path to white above `pathStart` (as display.js, later; every hue alike), a hue-preserving gamut clip, the sRGB OETF
import numpy as np
from acp_display import lin2oklab, oklab2lin, srgb_oetf, _sstep

CAMERA7_DEFAULTS = dict(
    contrast=1.32, shoulder=0.96, mid=0.18, midOut=0.18, whiteStops=3.6,
    perChannel=0.6,
    sat=1.04,
    pathStart=3.0, pathRange=2.0,
    expo=0.0,
    black=0.014,    # a soft toe (scene units after exposure, on the luminance): the black point of a real camera's curve
    ped=0.0022,     # a pedestal, the black level of a camera's JPEG (a photograph's darkest pixels are L* 1.4-4.8, never 0): y' = ped + (1 - ped) y on the display-linear value, after the curve
)
CAMERA7_SKIN = dict(a=-0.22, b=-0.5, lo=0.0, hi=2.2)
CAMERA7_SHARPEN = dict(sigma_per_ipd=0.0086, amount=1.1, thr=0.04, luma=True)   # output sharpening: sigma follows the head's size (px between the pupils); a THRESHOLD mask (strong edges are not boosted) on the LUMINANCE only (a camera sharpens luma: the render's colour speckle is not amplified)
CAMERA7_BG = dict(track=1.385, offset=0.578)   # the engine's studio seamless: stops = -(track * bias + offset) on its tint (the paper tracks the skin compensation)
# Cycles: the backdrop as the CAMERA sees it, apart from the bounce it gives the subject (camera7_stage.tint_sweep, Light Path rays):
#   stops = -(meter + bias) + c   the tint x 2^stops for camera and glossy rays: the exposure the backdrop is seen at is meter (the metered gain, stops) + bias (the skin compensation), so its
#                                 display lightness is independent of both; c is the backdrop's own level (the stage record may carry its own c)
#   bounce                        stops of the record's tint that DIFFUSE rays see: the floor's bounce into the shadow side of the face keeps (nearly) its real albedo
CAMERA7_BG3 = dict(c=1.15, bounce=-0.9)
CAMERA7_LENS = dict(portrait=dict(focal=85, fstop=2.8), portrait4=dict(focal=85, fstop=4), portrait56=dict(focal=85, fstop=5.6), environmental=dict(focal=35, fstop=5.6))


def skin_bias(skin_y, S=None):
    S = S or CAMERA7_SKIN
    return float(min(S['hi'], max(S['lo'], S['a'] + S['b'] * np.log2(max(skin_y, 1e-3)))))


def bg_stops(bias, B=None):
    """stops on the seamless's tint so the paper tracks the skin compensation (twin of camera7.js bgStops)"""
    B = B or CAMERA7_BG
    return -(B['track'] * max(0.0, bias) + B['offset'])


def bg_stops3(bias, meter_stops, B=None):
    """Cycles: the backdrop's tint stops for camera rays so its display lightness does not depend on the person's exposure (see CAMERA7_BG3)"""
    B = B or CAMERA7_BG3
    return -(float(meter_stops) + max(0.0, float(bias))) + B['c']


def sharpen(img, sigma=1.5, amount=1.2, thr=None, luma=False):
    """unsharp mask on a display-referred (h, w, 3) float image: out = img + amount * w * (img - gaussian(img, sigma)) (separable, reflect borders).
    thr (display units, e.g. 0.04): a threshold mask w = 1 - smoothstep(thr / 2, thr, max_c |img - blur|): the fine variations (pores, fine hair, lashes) are
    boosted and strong edges are left alone (so the edges do not get crisper than they are); thr None = the classic mask, w = 1.
    luma: only the LUMINANCE of the high-pass is added back (every channel gets the same delta): the colour speckle of Cycles' render noise is not amplified
    (a camera sharpens luma, not chroma); the mask still reads the channels' maximum"""
    r = int(np.ceil(3 * sigma)); x = np.arange(-r, r + 1); k = np.exp(-0.5 * (x / sigma) ** 2); k /= k.sum()
    def blur(a, axis):
        p = np.pad(a, [(r, r) if i == axis else (0, 0) for i in range(a.ndim)], mode='reflect'); o = np.zeros_like(a)
        for i, w in enumerate(k):
            sl = [slice(None)] * a.ndim; sl[axis] = slice(i, i + a.shape[axis]); o += w * p[tuple(sl)]
        return o
    img = np.asarray(img, np.float64); b = blur(blur(img, 0), 1); d = img - b
    w = 1.0 if thr is None else 1.0 - _sstep(0.5 * thr, thr, np.abs(d).max(-1, keepdims=True))
    if luma:
        d = (d @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    return np.clip(img + amount * w * d, 0.0, 1.0)


def params7(**o):
    p = dict(CAMERA7_DEFAULTS, **o)
    a, d, mi, mo = p['contrast'], p['shoulder'], p['mid'], p['midOut']
    hm = mi * 2 ** p['whiteStops']
    b = (-(mi ** a) + (hm ** a) * mo) / (((hm ** (a * d)) - (mi ** (a * d))) * mo)
    c = ((hm ** (a * d)) * (mi ** a) - (hm ** a) * (mi ** (a * d)) * mo) / (((hm ** (a * d)) - (mi ** (a * d))) * mo)
    p.update(a=a, d=d, b=b, c=c)
    p['toeG'] = mi / (mi - p['black'] * (1 - np.exp(-mi / p['black']))) if p['black'] > 0 else 1.0   # the toe keeps 18 % grey where it was
    return p


def curve(x, P):
    xa = np.power(np.maximum(x, 0.0), P['a'])
    return xa / (np.power(xa, P['d']) * P['b'] + P['c'])


def _toe(c, b, g=1.0):
    """soft black point on the luminance (hue kept): Y' = g (Y - b (1 - exp(-Y / b))); b = 0 is off; g keeps 18 % grey where it was"""
    if b <= 0:
        return c
    Y = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    Yn = (Y - b * (1.0 - np.exp(-np.maximum(Y, 0) / b))) * g
    return c * (np.where(Y > 1e-9, Yn / np.maximum(Y, 1e-9), 0.0))[..., None]


def _tone(c, P):
    n = np.maximum(c.max(-1), 1e-7)
    A = c * (curve(n, P) / n)[..., None]
    B = curve(c, P)
    return A + (B - A) * P['perChannel'], n


def display7(c, P=None, wb=None):
    """scene-linear Rec.709 (..., 3), already exposed -> display sRGB 0..1 (float64). P = params7(...)"""
    P = P or params7()
    c = np.asarray(c, dtype=np.float64)
    if wb is not None:
        c = c @ np.asarray(wb, dtype=np.float64).reshape(3, 3).T
    c = c * 2.0 ** P['expo']
    Y = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    mn = c.min(-1); Y0 = np.maximum(Y, 0)
    t = np.where(mn < 0, Y0 / np.maximum(Y - mn, 1e-6), 1.0)
    c = Y0[..., None] + (c - Y0[..., None]) * t[..., None]
    c = _toe(c, P['black'], P['toeG'])
    rgb, n = _tone(c, P)
    lab = lin2oklab(rgb)
    C = np.hypot(lab[..., 1], lab[..., 2]); h = np.arctan2(lab[..., 2], lab[..., 1])
    k = _sstep(0, 1, (np.log2(n / P['mid']) - P['pathStart']) / P['pathRange'])
    C = C * P['sat'] * (1 - k * k)
    L = lab[..., 0] + (1 - lab[..., 0]) * k
    out = oklab2lin(L, C * np.cos(h), C * np.sin(h))
    g = oklab2lin(L, np.zeros_like(L), np.zeros_like(L))
    s = np.ones_like(L)
    for i in range(3):
        v, gv = out[..., i], g[..., i]
        s = np.where(v > 1, np.minimum(s, (1 - gv) / np.maximum(v - gv, 1e-6)), s)
        s = np.where(v < 0, np.minimum(s, gv / np.maximum(gv - v, 1e-6)), s)
    s = np.clip(s, 0, 1)
    lin = np.clip(g + (out - g) * s[..., None], 0, 1)
    return srgb_oetf(lin * (1.0 - P['ped']) + P['ped'])


def vignette(img, fov_y_deg, crop=None):
    """THE LENS' NATURAL FALL-OFF, one formula with the engine's final pass (pipeline.js): cos^4 of the field angle, tan(theta) = |ndc| tan(fov/2) per axis,
    strength 1, applied to scene-linear light before the curve. img (h, w, 3) is the rendered region; crop = (x0, y0, x1, y1) fractions of the full frame when
    a border was rendered (so the falloff is the full frame's)."""
    h, w = img.shape[:2]
    if crop is None:
        crop = (0.0, 0.0, 1.0, 1.0)
    x0, y0, x1, y1 = crop
    W, H = w / (x1 - x0), h / (y1 - y0)                       # the full frame's size in px
    ty = np.tan(np.radians(fov_y_deg) / 2.0); tx = ty * W / H  # square pixels
    u = (x0 + (np.arange(w) + 0.5) / W) * 2.0 - 1.0
    v = (y0 + (np.arange(h) + 0.5) / H) * 2.0 - 1.0
    q2 = (u[None, :] * tx) ** 2 + (v[:, None] * ty) ** 2
    return img * ((1.0 / (1.0 + q2)) ** 2)[..., None]
