# python scripts/bake-finger.py <folder with the pictures made by Sol> : makes public/mp-ipad/finger-*.jpg (wrapped around the finger) and tex/*.jpg (tileable)
# finger-*.jpg: across = angle around the finger (0 = right, 0.25 = palm, 0.75 = back), down = s from -20 to 97 mm (PIP 42, DIP 67, end 97)
import sys, os, numpy as np
from PIL import Image
def gaussian_filter(a, sigma, mode='nearest'):
    sg = sigma if isinstance(sigma, tuple) else (sigma,) * a.ndim; md = mode if isinstance(mode, tuple) else (mode,) * a.ndim
    for ax, (v, m) in enumerate(zip(sg, md)):
        r = max(1, int(3 * v)); k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * v * v)); k /= k.sum(); n = a.shape[ax]; pad = [(0, 0)] * a.ndim; pad[ax] = (r, r)
        if m == 'wrap' and r > n: m = 'edge'
        b = np.moveaxis(np.pad(a, pad, 'wrap' if m == 'wrap' else 'edge'), ax, -1); L = b.shape[-1]; f = np.fft.rfft(k, L + len(k)); c = np.fft.irfft(np.fft.rfft(b, L + len(k), axis=-1) * f, L + len(k), axis=-1)[..., 2 * r:2 * r + n]; a = np.moveaxis(c, -1, ax)
    return a
def map_coordinates(im, YX, order=1, mode='nearest'):
    Y, X = YX; h, w = im.shape; Y = np.clip(Y, 0, h - 1.001); X = np.clip(X, 0, w - 1.001); y, x = Y.astype(int), X.astype(int); a, b = Y - y, X - x
    return (im[y, x] * (1 - b) + im[y, x + 1] * b) * (1 - a) + (im[y + 1, x] * (1 - b) + im[y + 1, x + 1] * b) * a
SRC, OUT = sys.argv[1], os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'mp-ipad')
W, H, S0, S1 = 1024, 1536, -20.0, 97.0
def load(f): return np.asarray(Image.open(os.path.join(SRC, f)).convert('RGB')).astype(np.float64) / 255
def lin(a): return np.where(a <= .04045, a / 12.92, ((a + .055) / 1.055) ** 2.4)
def srgb(a): a = np.clip(a, 0, 1); return np.where(a <= .0031308, a * 12.92, 1.055 * a ** (1 / 2.4) - .055)
def save(a, f, q=90): Image.fromarray((np.clip(a, 0, 1) * 255 + .5).astype(np.uint8)).save(os.path.join(OUT, f), quality=q)
def smooth(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def strip(f, marks):  # marks: (y at 1000 px height, s)
    im = load(f); h, w = im.shape[:2]; green = (im[..., 1] > im[..., 0] + .12) & (im[..., 1] > im[..., 2] + .12); L, R = np.zeros(h), np.zeros(h); ok = np.zeros(h, bool)
    for y in range(h):
        x = np.where(~green[y])[0]
        if len(x) > 20: L[y], R[y], ok[y] = x[0], x[-1], True
    yy = np.arange(h); L, R = np.interp(yy, yy[ok], L[ok]), np.interp(yy, yy[ok], R[ok]); L, R = gaussian_filter(L, 6), gaussian_filter(R, 6)
    ms = sorted((s, y / 1000 * h) for y, s in marks); s = S0 + (np.arange(H) + .5) / H * (S1 - S0); ys = np.interp(s, [m[0] for m in ms], [m[1] for m in ms]); lo = ms[0]; k = (ms[1][1] - ms[0][1]) / (ms[1][0] - ms[0][0]); ys = np.where(s < lo[0], lo[1] + (s - lo[0]) * k, ys)
    # below the picture: mirrored
    over = ys > h * .985; ys = np.where(over, 2 * h * .985 - ys, ys); ys = np.clip(ys, h * .62, h * .985) * over + ys * ~over; ys = np.clip(ys, 0, h - 1)
    return lin(im), ys, (np.interp(ys, yy, L) + np.interp(ys, yy, R)) / 2, (np.interp(ys, yy, R) - np.interp(ys, yy, L)) / 2, s
def wrap(f, marks, flip):
    im, ys, c, hw, s = strip(f, marks); a = (np.arange(W) + .5) / W * 2 * np.pi; x = np.cos(a) * (-1 if flip else 1) * .90
    X = c[:, None] + hw[:, None] * x[None, :]; Y = np.repeat(ys[:, None], W, 1)
    global XMM; XMM = (X - c[:, None]) / (108 / 1000 * im.shape[0]) * 7.8 if not flip else XMM
    return np.stack([map_coordinates(im[..., k], [Y, X], order=1, mode='nearest') for k in range(3)], -1), a, s
back, a, s = wrap('finger_back.png', [(57, 97), (365, 67), (760, 42), (985, 27.5)], False)
palm, _, _ = wrap('finger_palm-v2.png', [(50, 97), (345, 67), (650, 42), (985, 15)], True)
Q = np.sin(a)[None, :]; wp = smooth(-.35, .35, Q)[..., None]
# nail: a rounded plate in (s, mm across); the same numbers as in skin.js
xm = XMM; sm = s[:, None]
def nail(xm, sm):
    cx, cs, rx, rs, r = 0, 88.2, 5.15, 8.3, 3.6; dx, ds = np.abs(xm) - (rx - r), np.abs(sm - cs) - (rs - r); return np.hypot(np.maximum(dx, 0), np.maximum(ds, 0)) + np.minimum(np.maximum(dx, ds), 0) - r
d = np.where(Q < 0, nail(xm, sm), 9.0); N = smooth(.25, -.25, d)
# even out the light: the two sides get the same mean, slow changes are reduced
def mean(x, w): return (x * w[..., None]).sum((0, 1)) / w.sum()
sk = (s > 30)[:, None] & (s < 92)[:, None]; mb = mean(back, (sk & (Q < -.2) & (N < .05)).astype(float)); mp = mean(palm, (sk & (Q > .2)).astype(float)); tgt = mb * .6 + mp * .4
back = back / mb * tgt; palm = palm / mp * tgt * np.array([1.03, .99, .985])
col = back * (1 - wp) + palm * wp
low = np.stack([gaussian_filter(col[..., k], (90, 60), mode=('nearest', 'wrap')) for k in range(3)], -1); lum = low.mean(-1, keepdims=True); base = tgt.mean()
col = col * (1 - .55 * (1 - N[..., None])) + col * (base / lum) * (.55 * (1 - N[..., None]))
col = col / tgt # 1 = the asked skin colour
print('mean', col[(s > 30)].mean((0, 1)), 'nail', mean(col, N))
save(srgb(col * .72), 'finger-color.jpg') # 0.72 in linear = the skin colour (room for lighter places)
L = col.mean(-1); hi = L - np.stack([gaussian_filter(L, 9, mode=('nearest', 'wrap'))])[0]; hi = gaussian_filter(hi, .8, mode=('nearest', 'wrap')) * (1 - .85 * N)
gx = (np.roll(hi, -1, 1) - np.roll(hi, 1, 1)) * 9; gy = np.gradient(hi, axis=0) * 18; n = np.stack([-gx, -gy, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True); save(n * .5 + .5, 'finger-normal.jpg', 88)
rough = .56 - .34 * N + np.clip(-hi * 1.2, 0, .15); g = np.stack([np.ones_like(rough), rough, np.zeros_like(rough)], -1); save(g, 'finger-rough.jpg', 85)
# ---------- tileable surfaces ----------
os.makedirs(os.path.join(OUT, 'tex'), exist_ok=True)
def tile(im):  # the seams are covered with the picture shifted by half; the low frequencies are made even
    n = im.shape[0]; low = np.stack([gaussian_filter(im[..., k], n / 6, mode='wrap') for k in range(3)], -1); im = im / low * low.mean((0, 1)); r = np.roll(im, (n // 2, n // 2), (0, 1)); t = np.abs(np.linspace(-1, 1, n)); e = smooth(.72, .98, np.maximum.outer(t, t))[..., None]; return im * (1 - e) + r * e
for f in ['sand', 'stone', 'knit', 'tape', 'honey', 'fur', 'brick', 'wood', 'leather', 'plaster', 'smooth', 'rubber', 'slime', 'block', 'iron', 'soil']:
    src = {'plaster': 'wool_felt'}.get(f, f) + '.png'
    if not os.path.exists(os.path.join(SRC, src)): print('no', src); continue
    im = np.asarray(Image.open(os.path.join(SRC, src)).convert('RGB').resize((512, 512), Image.LANCZOS)).astype(np.float64) / 255; im = im if f in ('knit', 'brick', 'wood', 'rubber') else tile(im)
    save(im, f'tex/{f}.jpg', 86); L = im.mean(-1); hi = L - gaussian_filter(L, 24, mode='wrap'); hi = gaussian_filter(hi, 1.0, mode='wrap'); k = {'stone': 26, 'sand': 20, 'knit': 22, 'brick': 20, 'tape': 8, 'honey': 6, 'fur': 14, 'wood': 12, 'leather': 18, 'plaster': 16, 'smooth': 3, 'rubber': 14, 'slime': 5, 'block': 8, 'iron': 10, 'soil': 22}[f]
    gx = (np.roll(hi, -1, 1) - np.roll(hi, 1, 1)) * k; gy = (np.roll(hi, -1, 0) - np.roll(hi, 1, 0)) * k; n = np.stack([-gx, -gy, np.ones_like(gx)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True); save(n * .5 + .5, f'tex/{f}-n.jpg', 84)
