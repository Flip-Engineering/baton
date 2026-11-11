# The studio's ONE display transform (web/lib/fx/light/display.js acpDisplay: white balance, Lottes's filmic curve on the max-RGB norm,
# the Oklab path to white, the hue-preserving gamut clip, the sRGB OETF), ported to numpy so a Cycles render goes through exactly the
# curve our engine's frames do. Keep in step with display.js (DISPLAY_DEFAULTS, lottesParams, acpDisplay).
# Also a dependency-free PNG writer (Blender's Python has numpy but not PIL) and an EXR reader through bpy.
import zlib, struct
import numpy as np

DISPLAY_DEFAULTS = dict(contrast=1.32, shoulder=0.972, mid=0.18, midOut=0.18, whiteStops=6.5, pathStart=2.5, pathRange=5.5, warmDrift=1.0, sat=1.0)


def lottes_params(**o):
    p = dict(DISPLAY_DEFAULTS, **o)
    a, d, mi, mo = p['contrast'], p['shoulder'], p['mid'], p['midOut']
    hm = mi * 2 ** p['whiteStops']
    b = (-(mi ** a) + (hm ** a) * mo) / (((hm ** (a * d)) - (mi ** (a * d))) * mo)
    c = ((hm ** (a * d)) * (mi ** a) - (hm ** a) * (mi ** (a * d)) * mo) / (((hm ** (a * d)) - (mi ** (a * d))) * mo)
    return dict(a=a, d=d, b=b, c=c, mid=mi, ps=p['pathStart'], pr=p['pathRange'], wd=p['warmDrift'], sat=p['sat'])


def _sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lin2oklab(c):
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return np.stack([0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
                     0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s], -1)


def oklab2lin(L, a, b):
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return np.stack([4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                     -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s], -1)


def srgb_oetf(v):
    return np.where(v <= 0.0031308, 12.92 * v, 1.055 * np.power(np.maximum(v, 0), 1 / 2.4) - 0.055)


def acp_display(c, P=None, wb=None):
    """scene-linear Rec.709 (..., 3) -> display sRGB 0..1"""
    P = P or lottes_params()
    c = np.asarray(c, dtype=np.float64)
    if wb is not None:
        c = c @ np.asarray(wb, dtype=np.float64).reshape(3, 3).T
    Y = 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]
    mn = c.min(-1)
    Y0 = np.maximum(Y, 0)
    t = np.where(mn < 0, Y0 / np.maximum(Y - mn, 1e-6), 1.0)
    c = Y0[..., None] + (c - Y0[..., None]) * t[..., None]
    n = c.max(-1)
    zero = n <= 1e-7
    n = np.maximum(n, 1e-7)
    xa = n ** P['a']
    y = xa / ((xa ** P['d']) * P['b'] + P['c'])
    rgb = c * (y / n)[..., None]
    k = _sstep(0, 1, (np.log2(n / P['mid']) - P['ps']) / P['pr'])
    lab = lin2oklab(rgb)
    C = np.hypot(lab[..., 1], lab[..., 2]); h = np.arctan2(lab[..., 2], lab[..., 1])
    warm = _sstep(-0.9, -0.2, h) * (1 - _sstep(1.3, 1.9, h))
    h = h + (1.7 - h) * warm * P['wd'] * np.sqrt(k)
    C = C * (1 - k * k) * P['sat']
    L = lab[..., 0] + (1 - lab[..., 0]) * k
    rgb = oklab2lin(L, C * np.cos(h), C * np.sin(h))
    g = oklab2lin(L, np.zeros_like(L), np.zeros_like(L))
    s = np.ones_like(L)
    for i in range(3):
        v, gv = rgb[..., i], g[..., i]
        s = np.where(v > 1, np.minimum(s, (1 - gv) / np.maximum(v - gv, 1e-6)), s)
        s = np.where(v < 0, np.minimum(s, gv / np.maximum(gv - v, 1e-6)), s)
    s = np.clip(s, 0, 1)
    out = srgb_oetf(np.clip(g + (rgb - g) * s[..., None], 0, 1))
    out[zero] = 0
    return out


def write_png(path, rgb01, flip=False):
    """8-bit RGB PNG from (h, w, 3) floats 0..1 (row 0 = top unless flip)"""
    a = np.clip(np.rint(np.asarray(rgb01) * 255), 0, 255).astype(np.uint8)
    if flip:
        a = a[::-1]
    h, w, _ = a.shape
    raw = b''.join(b'\x00' + a[y].tobytes() for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def read_exr_bpy(path):
    """(h, w, 4) float32, row 0 = TOP, through Blender's image loader"""
    import bpy
    im = bpy.data.images.load(path, check_existing=False)
    im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    px = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(px)
    bpy.data.images.remove(im)
    return px.reshape(h, w, 4)[::-1]
