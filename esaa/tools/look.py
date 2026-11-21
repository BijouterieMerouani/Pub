"""Look « aftermovie » du film 2 (modèle : CAREER EXPO) : contraste en S, ombres
bleu-vert, hautes lumières chaudes, couleurs plus denses, verts/bleus tirés vers le
bleu canard, peaux protégées. Même fonction pour la LUT des vidéos (ffmpeg lut3d) et
pour les photos (appliquée directement en numpy).
"""
import os

import numpy as np


def _hsv(rgb):
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn + 1e-9
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    s = np.where(mx > 1e-6, (mx - mn) / (mx + 1e-9), 0)
    return h, s, mx


def _rgb(h, s, v):
    c = v * s
    hp = (h % 360) / 60
    x = c * (1 - np.abs(hp % 2 - 1))
    z = np.zeros_like(h)
    conds = [(hp < 1), (hp < 2), (hp < 3), (hp < 4), (hp < 5), (hp <= 6)]
    vals = [(c, x, z), (x, c, z), (z, c, x), (z, x, c), (x, z, c), (c, z, x)]
    r = np.select(conds, [v_[0] for v_ in vals])
    g = np.select(conds, [v_[1] for v_ in vals])
    b = np.select(conds, [v_[2] for v_ in vals])
    m = v - c
    return np.stack([r + m, g + m, b + m], -1)


def _hue_pull(h, centre, width, target, amount):
    """Rapproche les teintes proches de `centre` (± width) de `target`."""
    dist = ((h - centre + 180) % 360) - 180
    w = np.clip(1 - np.abs(dist) / width, 0, 1) ** 1.5
    delta = ((target - h + 180) % 360) - 180
    return h + delta * w * amount


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


PARAMS = dict(exposure=0.92, contrast=0.65, shoulder=0.80, sat=1.42,
              shadow=(-0.085, 0.022, 0.080), warm=(0.050, 0.015, -0.040), white=(0.018, 0.006, -0.028))


def grade(rgb, exposure=None, **kw):
    """rgb : tableau float [0,1] (…, 3), Rec.709 gamma. Renvoie le même format."""
    p = dict(PARAMS, **kw)
    if exposure is not None:
        p["exposure"] = exposure
    x = np.clip(rgb * p["exposure"], 0, 1)
    L = 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
    # contraste en S sur la luminance (teinte conservée) + épaule douce dans les blancs
    c, sh0 = p["contrast"], p["shoulder"]
    Ls = L - c * np.sin(2 * np.pi * L) / (2 * np.pi)
    span = 0.97 - sh0
    Ls = np.where(Ls < sh0, Ls, sh0 + span * (1 - np.exp(-(Ls - sh0) / span)))
    Ls = np.clip(Ls, 0, 1)
    ratio = np.where(L > 1e-4, Ls / np.maximum(L, 1e-4), 1)[..., None]
    x = np.clip(x * ratio, 0, 1.2)
    # teintes : verts/cyans -> bleu canard, bleus -> bleu profond, oranges/peaux stables
    h, s, v = _hsv(np.clip(x, 0, 1))
    h = _hue_pull(h, 120, 60, 172, 0.55)
    h = _hue_pull(h, 220, 35, 205, 0.4)
    h = _hue_pull(h, 30, 25, 26, 0.3)
    skin = np.clip(1 - np.abs(((h - 25 + 180) % 360) - 180) / 30, 0, 1)
    s = np.clip(s * (p["sat"] - 0.14 * skin), 0, 1)
    x = _rgb(h, s, np.clip(v, 0, 1))
    # virage : ombres bleu-vert, tons moyens/clairs chauds (peaux, bois), blancs propres
    L2 = (0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2])[..., None]
    shw = (1 - L2) ** 2.5
    mid = L2 ** 1.5 * (1 - _smooth(0.70, 0.95, L2))
    wht = _smooth(0.80, 1.0, L2)
    x = x + shw * np.array(p["shadow"]) + mid * np.array(p["warm"]) + wht * np.array(p["white"])
    return np.clip(x, 0, 1)


def write_cube(path, size=33, exposure=None, **kw):
    g = np.linspace(0, 1, size)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")      # rouge varie le plus vite
    rgb = np.stack([r, gg, b], -1).reshape(-1, 3)
    out = grade(rgb, exposure, **kw)
    with open(path, "w") as f:
        f.write(f"TITLE \"ESAA aftermovie\"\nLUT_3D_SIZE {size}\n")
        for p in out:
            f.write(f"{p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
    return path


def grade_image(im, exposure=None, **kw):
    """PIL RGB -> PIL RGB étalonnée (photos)."""
    from PIL import Image
    a = np.asarray(im, dtype=np.float32) / 255.0
    out = grade(a, exposure, **kw)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGB")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    print(write_cube(os.path.join(os.path.dirname(here), ".cache", "aftermovie.cube")))
