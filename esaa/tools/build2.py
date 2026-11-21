"""ESAA — film 2, façon « aftermovie » (modèle : la vidéo CAREER EXPO envoyée).

Même musique que le modèle (coupée avant le jingle TikTok), même construction :
intro avec titre jaune animé (la police change sur les coups de l'intro, puis se fixe),
groove à 93,2 BPM découpé en phrases de 4 mesures, coupes sur les temps, look ciné
(contraste, ombres bleu-vert, peaux chaudes), grain et vignettage, fin au noir.

    python3 esaa/tools/build2.py                  # les deux formats
    python3 esaa/tools/build2.py --format 16x9    # un seul
    python3 esaa/tools/build2.py --preview        # planche des cadrages, sans rendu
"""
import argparse, hashlib, json, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from clips import UPLOADS, index, photo  # noqa: E402
import look  # noqa: E402
import music  # noqa: E402

FPS = 30
CACHE = os.path.join(ROOT, ".cache")
EXPORT = os.path.join(ROOT, "export")
FORMATS = {"9x16": (1080, 1920), "16x9": (1920, 1080)}
MODEL = os.path.join(UPLOADS, "c195f95e-v14044g50000d158v37og65sq0av1fa0.mp4")

# --- Musique du modèle (analyse : voir LISEZMOI) -----------------------------------------
Q = 0.64408                 # un temps (93,16 BPM)
B0 = 6.925                  # temps 0 = 1er temps de la 1re phrase du groove
DROP = 5.567                # entrée du groove (coup juste avant le temps -2)
HITS = [0.353, 1.035, 1.406, 1.778, 1.990, 2.557, 2.788, 2.939]   # coups de l'intro
SETTLE = 2.939              # la police du titre se fixe
END_BEAT = 76               # coupe au noir (55,88 s), comme le modèle
LENGTH = 57.2               # le jingle TikTok démarre à 57,28 s : on s'arrête avant


def beat(k):
    return B0 + k * Q


# --- Montage ------------------------------------------------------------------------------
# Chaque plan : source, point d'entrée (s), durée en temps (ou fin absolue pour l'intro),
# cadrage 16:9 `cy` (centre vertical de la bande gardée, 0 = haut, 1 = bas) ;
# `speed` < 1 = ralenti (les vidéos 4K à 60 i/s) ; `alt16` = autre plan pour le 16:9.
def S(src, t_in, beats=None, cy=0.45, speed=1.0, until=None, alt16=None, cx=0.5, pan=None, dark=False,
      box9=None, box16=None, focus=None):
    return dict(src=src, t_in=t_in, beats=beats, cy=cy, speed=speed, until=until, alt16=alt16,
                cx=cx, pan=pan, dark=dark, box9=box9, box16=box16, focus=focus)


# Règle de montage : chaque plan montre quelqu'un qui fait coucou ou une vraie action
# (pas de préparation de salle, pas de décor vide, pas de gens qui attendent).
INTRO = [  # titre par-dessus, image assombrie (le jaune ressort), le groove « ouvre » l'image
    S("6899", 0.30, until=HITS[1], cy=0.40, speed=0.5, dark=True),   # trio qui salue
    S("6914", 0.10, until=3.595, cy=0.45, dark=True),                # l'équipe du stand salue
    S("6916", 4.00, until=4.776, cy=0.40, dark=True),                # coucou sous BIENVENUE
    S("6897", 3.40, until=DROP, cy=0.38, speed=0.5, dark=True),      # coucou à deux mains
]
ACTS = [
    # 1. Les coucous (du DROP au temps 16) : ralentis 50 % sur les vidéos 4K à 60 i/s
    [S("6888", 0.00, 2, cy=0.47, speed=0.5), S("6890", 0.00, 2, cy=0.34, speed=0.5),
     S("6903", 1.10, 1, cy=0.36), S("6893", 0.20, 2, cy=0.40, speed=0.5),
     S("6902", 1.40, 1, cy=0.50), S("6896", 0.30, 2, cy=0.42, speed=0.5),
     S("6904", 4.30, 1, cy=0.40), S("6891", 0.00, 1, cy=0.40, speed=0.5),
     S("6897", 0.30, 2, cy=0.38, speed=0.5), S("6895", 0.10, 1, cy=0.40, speed=0.5),
     S("6906", 1.40, 1, cy=0.46), S("6899", 1.60, 1, cy=0.36, speed=0.5),
     S("6889", 0.00, 1, cy=0.47, speed=0.5)],
    # 2. Les stands et l'économie : billets, stand « 2 pour 1 jeton », fous rires
    [S("6915", 0.20, 2, cy=0.55), S("6901", 0.00, 2, cy=0.58), S("6904", 0.10, 1, cy=0.50),
     S("6919", 0.20, 1, cy=0.45), S("6906", 2.60, 1, cy=0.42), S("6914", 7.30, 2, cy=0.50),
     S("6904", 1.70, 1, cy=0.45), S("6918", 0.20, 1, cy=0.45), S("6906", 8.00, 1, cy=0.42),
     S("6898", 0.20, 1, cy=0.38, speed=0.5), S("7557711C", 4.60, 2, cy=0.42),
     S("6934", 1.20, 1, cy=0.50)],
    # 3. Ateliers
    [S("6931", 0.20, 2, cy=0.55), S("6933", 0.20, 1, cy=0.50), S("6932", 2.20, 1, cy=0.45),
     S("6933", 6.60, 2, cy=0.45), S("6931", 1.50, 1, cy=0.52),
     S("still:lego", 0, 1, alt16=S("6906", 4.40, 1, cy=0.45)), S("6933", 12.00, 1, cy=0.55),
     S("6934", 9.20, 1, cy=0.55), S("6935", 3.40, 2, cy=0.55), S("6931", 12.30, 1, cy=0.55),
     S("6945", 0.20, 1, cy=0.50), S("6934", 11.80, 2, cy=0.52)],
    # 4. Remise des diplômes : les moments où ça bouge (on vient le chercher, on le reçoit, on saute)
    [S("6942", 1.20, 2, cy=0.38), S("6945", 2.60, 1, cy=0.45), S("6947", 0.20, 2, cy=0.42),
     S("6953", 0.05, 1, cy=0.42), S("6949", 1.80, 2, cy=0.50), S("6945", 7.20, 1, cy=0.45),
     S("6950", 2.80, 1, cy=0.42), S("6952", 0.40, 1, cy=0.50), S("6943", 5.80, 1, cy=0.42),
     S("6949", 0.15, 1, cy=0.45), S("6942", 18.60, 2, cy=0.55), S("6950", 3.45, 1, cy=0.42)],
    # 5. Photos de groupe en rafale, puis zooms sur trois parties de la photo 6921 (la plus
    #    nette), et pour finir la photo entière qui se dévoile, jusqu'au noir
    [S("photo:6925", 0, 2, cy=0.55, cx=0.30), S("photo:6922", 0, 1, cy=0.55, cx=0.70),
     S("photo:6923", 0, 1, cy=0.55, cx=0.45), S("photo:6926", 0, 1, cy=0.55, cx=0.75),
     S("part:6921", 0, 1, box9=(520, 1180, 880), box16=(560, 880, 1000)),
     S("part:6921", 0, 1, box9=(1300, 1180, 880), box16=(1300, 920, 1000)),
     S("part:6921", 0, 1, box9=(2140, 1180, 820), box16=(2060, 870, 1000)),
     S("final:6921", 0, 4, cy=0.452, focus=1300)],
]
ACT_BEATS = [18, 16, 16, 16, 12]     # 1re phrase : 2 temps d'avance (le DROP)


def timeline():
    """Liste (plan, début s, fin s), plus contrôle des comptes de temps."""
    out = []
    t0 = 0.0
    for sh in INTRO:
        out.append((sh, t0, sh["until"]))
        t0 = sh["until"]
    k = -2
    for act, n in zip(ACTS, ACT_BEATS):
        assert sum(s["beats"] for s in act) == n, (n, sum(s["beats"] for s in act))
        for sh in act:
            start = t0 if k == -2 else beat(k)
            k += sh["beats"]
            out.append((sh, start, beat(k)))
    assert k == END_BEAT
    return out


# --- Extraction des plans (HDR -> SDR, cadrage, ralenti, étalonnage) ----------------------
HLG = ("zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:rin=tv:t=linear:npl=203,"
       "format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,"
       "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


def probe(path):
    j = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=width,height,color_transfer:stream_side_data=rotation:format=duration",
        "-of", "json", path]))
    st = j["streams"][0]
    w, h = st["width"], st["height"]
    for sd in st.get("side_data_list", []):
        if abs(sd.get("rotation", 0)) == 90:
            w, h = h, w
    return w, h, st.get("color_transfer", ""), float(j["format"]["duration"])


def luts():
    normal = os.path.join(CACHE, "aftermovie.cube")
    dark = os.path.join(CACHE, "aftermovie-dark.cube")
    look.write_cube(normal)
    look.write_cube(dark, exposure=0.70)
    return normal, dark


def extract(path, sh, n, fmt, lut):
    W, H = FORMATS[fmt]
    w, h, transfer, dur = probe(path)
    need = n / FPS * sh["speed"]
    t_in = max(0.0, min(sh["t_in"], dur - need - 0.02))
    with open(lut, "rb") as fh:
        lut_id = hashlib.sha1(fh.read()).hexdigest()[:10]
    key = hashlib.sha1(f"{path}|{t_in:.3f}|{n}|{fmt}|{sh['cy']}|{sh['speed']}|{lut_id}|v2"
                       .encode()).hexdigest()[:14]
    out = os.path.join(CACHE, f"am_{key}.mp4")
    if os.path.exists(out):
        return out
    vf = []
    if fmt == "16x9":
        band = int(w * 9 / 16) // 2 * 2
        y0 = int(min(max(sh["cy"] * h - band / 2, 0), h - band)) // 2 * 2
        vf.append(f"crop={w}:{band}:0:{y0}")
        if transfer == "arib-std-b67":
            vf.append(HLG)
        vf.append(f"scale={W}:{H}:flags=lanczos")
        if w < W:
            vf.append("unsharp=5:5:0.55:5:5:0")
    else:
        vf.append(f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos,crop={W}:{H}")
        if transfer == "arib-std-b67":
            vf.append(HLG)
    if sh["speed"] != 1.0:
        vf.append(f"setpts=(PTS-STARTPTS)/{sh['speed']}")
    vf += [f"fps={FPS}", "format=rgb24", f"lut3d=file={lut}:interp=tetrahedral", "format=yuv420p"]
    tmp = out + ".part.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t_in:.3f}", "-i", path,
                    "-vf", ",".join(vf), "-frames:v", str(n), "-an",
                    "-c:v", "libx264", "-preset", "fast", "-crf", "11", tmp], check=True)
    os.replace(tmp, out)
    return out


def read_frames(path, n, W, H):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         stdout=subprocess.PIPE)
    size = W * H * 3
    last = None
    for _ in range(n):
        buf = p.stdout.read(size)
        if len(buf) == size:
            last = Image.frombuffer("RGB", (W, H), buf, "raw", "RGB", 0, 1).copy()
        yield last
    p.stdout.close()
    p.wait()


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def push(frame, i, n, amount):
    s = 1.0 + amount * i / max(n - 1, 1)
    W, H = frame.size
    bw, bh = W / s, H / s
    return frame.resize((W, H), Image.BICUBIC, box=((W - bw) / 2, (H - bh) / 2, (W + bw) / 2, (H + bh) / 2))


# --- Photos ---------------------------------------------------------------------------------
_graded = {}


def graded_photo(key):
    if key not in _graded:
        im = ImageOps.exif_transpose(Image.open(photo(key))).convert("RGB")
        _graded[key] = look.grade_image(im)
    return _graded[key]


def part_frames(sh, n, fmt):
    """Zoom sur une partie de la photo : boîte (centre x, centre y, largeur) en pixels."""
    W, H = FORMATS[fmt]
    im = graded_photo(sh["src"].split(":")[1])
    iw, ih = im.size
    cx, cy, cw = sh["box16"] if fmt == "16x9" else sh["box9"]
    ch = cw * H / W
    if ch > ih:
        ch, cw = ih, ih * W / H
    for i in range(n):
        s = 1.0 + 0.06 * ease(i / max(n - 1, 1))
        bw, bh = cw / s, ch / s
        x0 = min(max(cx - bw / 2, 0), iw - bw)
        y0 = min(max(cy - bh / 2, 0), ih - bh)
        yield im.resize((W, H), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))


def final_frames(sh, n, fmt):
    """Dernier plan : la photo entière. 16:9 : on dézoome (1,15 -> 1) sur la bande cy.
    9:16 : on part d'un plan serré (focus) et la photo rétrécit jusqu'à tenir en largeur,
    sur un fond flou de la même photo."""
    from PIL import ImageEnhance
    W, H = FORMATS[fmt]
    im = graded_photo(sh["src"].split(":")[1])
    iw, ih = im.size
    if fmt == "16x9":
        cw, ch = iw, iw * H / W
        yc = min(max(sh["cy"] * ih, ch / 2), ih - ch / 2)
        for i in range(n):
            s = max(1.0, 1.15 - 0.15 * ease(min(1.0, i / (0.85 * n))))
            bw, bh = min(iw, cw / s), min(ih, ch / s)
            x0 = max(0.0, (iw - bw) / 2)
            y0 = min(max(yc - bh / 2, 0), ih - bh)
            yield im.resize((W, H), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))
        return
    bw = ih * W / H
    bg = im.resize((W // 6, H // 6), Image.BICUBIC, box=((iw - bw) / 2, 0, (iw + bw) / 2, ih))
    bg = bg.filter(ImageFilter.GaussianBlur(5)).resize((W, H), Image.BICUBIC)
    bg = ImageEnhance.Brightness(bg).enhance(0.5)
    s0, s1 = H / ih, W / iw * 0.94
    f0, f1 = np.array([sh["focus"], ih / 2]), np.array([iw / 2, ih / 2])
    for i in range(n):
        u = ease(min(1.0, i / (0.62 * n)))
        s = float(np.exp(np.log(s0) + (np.log(s1) - np.log(s0)) * u)) * (1 + 0.02 * i / n)
        f = f0 + (f1 - f0) * u
        fw, fh = iw * s, ih * s
        x, y = W / 2 - f[0] * s, H / 2 - f[1] * s
        # on ne redimensionne que la partie visible de la photo
        vx0, vy0 = max(0.0, -x / s), max(0.0, -y / s)
        vx1, vy1 = min(iw, (W - x) / s), min(ih, (H - y) / s)
        px, py = max(0, round(x)), max(0, round(y))
        tw, th = round((vx1 - vx0) * s), round((vy1 - vy0) * s)
        frame = bg.copy()
        frame.paste(im.resize((tw, th), Image.LANCZOS, box=(vx0, vy0, vx1, vy1)), (px, py))
        yield frame


def photo_frames(sh, n, fmt):
    """16:9 : bande horizontale (cy) avec léger zoom ; 9:16 : fenêtre verticale à cx
    (ou panoramique `pan`) avec léger zoom. Photo verticale (`still:`) : plein cadre."""
    W, H = FORMATS[fmt]
    if sh["src"].startswith("part:"):
        yield from part_frames(sh, n, fmt)
        return
    if sh["src"].startswith("final:"):
        yield from final_frames(sh, n, fmt)
        return
    key = sh["src"].split(":")[1]
    im = graded_photo(key)
    iw, ih = im.size
    if iw / ih > W / H:          # photo plus large que le cadre
        ch, cw = ih, ih * W / H
    else:
        cw, ch = iw, iw * H / W
    amount = 0.08 if sh["beats"] >= 4 else 0.045
    for i in range(n):
        t = i / max(n - 1, 1)
        s = 1.0 + amount * ease(t)
        bw, bh = cw / s, ch / s
        if sh["pan"] and fmt == "9x16":
            fx = sh["pan"][0] + (sh["pan"][1] - sh["pan"][0]) * ease(t)
        else:
            fx = sh["cx"] if fmt == "9x16" else 0.5
        fy = sh["cy"] if fmt == "16x9" else 0.5
        x0 = min(max(fx * iw - bw / 2, 0), iw - bw)
        y0 = min(max(fy * ih - bh / 2, 0), ih - bh)
        yield im.resize((W, H), Image.LANCZOS, box=(x0, y0, x0 + bw, y0 + bh))


# --- Titre --------------------------------------------------------------------------------
YELLOW = (246, 197, 30, 255)
F_FINAL = "/usr/share/fonts/opentype/inter/InterDisplay-Black.otf"
F_CYCLE = [
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/opentype/inter/InterDisplay-Thin.otf",
    os.path.join(os.path.dirname(ROOT), "ad", "fonts", "CormorantGaramond-Italic.ttf"),
    "/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-ExtraBold.ttf",
    os.path.join(os.path.dirname(ROOT), "ad", "fonts", "Cinzel.ttf"),
    "/usr/share/fonts/truetype/freefont/FreeSerifBoldItalic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/crosextra/Caladea-BoldItalic.ttf",
    "/usr/share/fonts/opentype/inter/Inter-ExtraLight.otf",
    "/usr/share/fonts/truetype/freefont/FreeMonoBold.ttf",
]
F_SUB = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"
F_SUB_B = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"


def _cap_font(path, cap):
    """Police dont la hauteur de capitale vaut `cap` pixels."""
    f = ImageFont.truetype(path, 200)
    b = f.getbbox("E")
    return ImageFont.truetype(path, max(8, round(200 * cap / (b[3] - b[1]))))


def _word(fonts, cap, word="ESAA", tracking=0.06):
    """Rend un mot lettre par lettre (une police par lettre), alignées sur la ligne de base."""
    glyphs = []
    for ch, fp in zip(word, fonts):
        f = _cap_font(fp, cap)
        b = f.getbbox(ch)
        glyphs.append((ch, f, b))
    pad = int(cap * 0.6)
    widths = [g[2][2] - g[2][0] for g in glyphs]
    gap = cap * tracking
    total = int(sum(widths) + gap * (len(word) - 1)) + 2 * pad
    img = Image.new("RGBA", (total, int(cap * 2.2)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    x = pad
    base = int(cap * 1.6)
    for (ch, f, b), w in zip(glyphs, widths):
        d.text((x - b[0], base), ch, font=f, fill=YELLOW, anchor="ls")
        x += w + gap
    return img, base


def _shadow(img, radius, alpha):
    a = img.split()[3].point(lambda v: int(v * alpha))
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.putalpha(a)
    sh = sh.filter(ImageFilter.GaussianBlur(radius))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(sh, (0, int(radius * 0.25)))
    out.alpha_composite(img)
    return out


class Title:
    def __init__(self, fmt):
        self.fmt = fmt
        W, H = FORMATS[fmt]
        self.W, self.H = W, H
        if fmt == "16x9":
            self.cap, self.cy = 200, 470
            self.sub = [("Projet associatif · L’économie et la finance expliquées aux enfants", F_SUB, 34)]
            self.sub_y = [620]
            self.tag_cap, self.tag_y, self.tag_sub_y = 120, 500, 600
        else:
            self.cap, self.cy = 172, 770
            self.sub = [("Projet associatif", F_SUB_B, 40),
                        ("L’économie et la finance expliquées aux enfants", F_SUB, 33)]
            self.sub_y = [905, 955]
            self.tag_cap, self.tag_y, self.tag_sub_y = 135, 880, 990
        self.rng = np.random.default_rng(5)
        self.cache = {}
        self.sub_layer = self._sub_layer()
        self.tag = self._tag()

    def _place(self, img, base, cy, cap):
        lay = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        x = (self.W - img.width) // 2
        y = int(cy + cap / 2 - base)            # centre de la capitale sur cy
        lay.alpha_composite(img, (x, y))
        return lay

    def word_layer(self, fonts):
        k = tuple(fonts)
        if k not in self.cache:
            img, base = _word(fonts, self.cap)
            self.cache[k] = _shadow(self._place(img, base, self.cy, self.cap), 18, 0.5)
        return self.cache[k]

    def _sub_layer(self):
        lay = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 0))
        d = ImageDraw.Draw(lay)
        for (txt, fp, size), y in zip(self.sub, self.sub_y):
            d.text((self.W / 2, y), txt, font=ImageFont.truetype(fp, size), fill=YELLOW, anchor="mm")
        return _shadow(lay, 10, 0.55)

    def _tag(self):
        img, base = _word([F_FINAL] * 4, self.tag_cap)
        lay = self._place(img, base, self.tag_y, self.tag_cap)
        d = ImageDraw.Draw(lay)
        d.text((self.W / 2, self.tag_sub_y), "Projet associatif", font=ImageFont.truetype(F_SUB, 34 if self.fmt == "16x9" else 38),
               fill=YELLOW, anchor="mm")
        return lay

    def fonts_at(self, t):
        if t < HITS[1] or t >= SETTLE:
            return [F_FINAL] * 4
        # entre deux coups : nouvelle police toutes les 4 images, et à chaque coup
        last_hit = max(h for h in HITS if h <= t)
        step = int((t - last_hit) * FPS // 4)
        seed = int(last_hit * 1000) * 31 + step
        r = np.random.default_rng(seed)
        return [F_CYCLE[i] for i in r.integers(0, len(F_CYCLE), 4)]

    def overlay(self, frame, t):
        if t < HITS[0] or t >= DROP:
            return frame
        out = frame.convert("RGBA")
        out.alpha_composite(self.word_layer(self.fonts_at(t)))
        if t >= HITS[1]:
            out.alpha_composite(self.sub_layer)
        return out.convert("RGB")

    def end_frame(self, t, t_end):
        img = Image.new("RGBA", (self.W, self.H), (0, 0, 0, 255))
        a = min(1.0, (t - beat(END_BEAT)) / 0.25) * min(1.0, max(0.0, (t_end - t) / 0.45))
        if a > 0:
            r, g, b, al = self.tag.split()
            img.alpha_composite(Image.merge("RGBA", (r, g, b, al.point(lambda v: int(v * a)))))
        return img.convert("RGB")


# --- Son --------------------------------------------------------------------------------------
def soundtrack(out_wav):
    x = music.decode(MODEL)
    sr = music.SR
    n = int(LENGTH * sr)
    y = x[:n].astype(np.float64)
    f0, f1 = int(56.0 * sr), n
    y[f0:f1] *= np.cos(np.linspace(0, np.pi / 2, f1 - f0))[:, None] ** 1.2
    raw = out_wav + ".raw.wav"
    music._write_wav(raw, y.astype(np.float32), sr)
    music._loudnorm(raw, out_wav)
    os.remove(raw)


# --- Rendu ------------------------------------------------------------------------------------
def render(fmt, preview=False):
    W, H = FORMATS[fmt]
    tl = timeline()
    total = round(LENGTH * FPS)
    lut, lut_dark = luts()
    idx = index()
    shots = []
    for sh, a, b in tl:
        if fmt == "16x9" and sh["alt16"]:
            sh = sh["alt16"]
        fa, fb = round(a * FPS), round(b * FPS)
        shots.append((sh, fa, fb - fa))
    if preview:
        return preview_sheet(fmt, shots, idx, lut, lut_dark)
    with ThreadPoolExecutor(4) as ex:
        futs = {i: ex.submit(extract, idx[sh["src"]], sh, n, fmt, lut_dark if sh["dark"] else lut)
                for i, (sh, fa, n) in enumerate(shots) if ":" not in sh["src"]}
        clips = {i: f.result() for i, f in futs.items()}
    print(f"[{fmt}] {len(clips)} plans prêts", flush=True)

    title = Title(fmt)
    out = os.path.join(EXPORT, f"esaa-aftermovie-{fmt}.mp4")
    silent = os.path.join(CACHE, f"aftermovie-{fmt}-video.mp4")
    vf = "vignette=angle=0.62:mode=forward,noise=c0s=7:c0f=t+u"
    enc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-vf", vf, "-c:v", "libx264", "-preset", "slow", "-crf", "20",
        "-maxrate", "10M", "-bufsize", "20M", "-pix_fmt", "yuv420p",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-movflags", "+faststart", silent], stdin=subprocess.PIPE)
    f = 0
    for i, (sh, fa, n) in enumerate(shots):
        if ":" in sh["src"]:
            gen = photo_frames(sh, n, fmt)
        else:
            amount = 0.03 if sh["speed"] == 1.0 else 0.02
            gen = (push(im, j, n, amount) for j, im in enumerate(read_frames(clips[i], n, W, H)))
        for im in gen:
            im = title.overlay(im, f / FPS)
            enc.stdin.write(im.tobytes())
            f += 1
    while f < total:                                           # noir + ESAA
        enc.stdin.write(title.end_frame(f / FPS, LENGTH).tobytes())
        f += 1
    enc.stdin.close()
    enc.wait()
    wav = os.path.join(CACHE, "aftermovie-music.wav")
    if not os.path.exists(wav):
        soundtrack(wav)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", silent, "-i", wav, "-map", "0:v", "-map", "1:a",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-t", f"{LENGTH}",
                    "-movflags", "+faststart", out], check=True)
    print(f"OK {out}  ({f} images)", flush=True)
    return out


def preview_sheet(fmt, shots, idx, lut, lut_dark):
    """Une image au milieu de chaque plan, au cadrage final (sans titre ni grain)."""
    W, H = FORMATS[fmt]
    tw = 320 if fmt == "16x9" else 180
    th = round(tw * H / W)
    with ThreadPoolExecutor(4) as ex:
        futs = {i: ex.submit(extract, idx[sh["src"]], sh, n, fmt, lut_dark if sh["dark"] else lut)
                for i, (sh, fa, n) in enumerate(shots) if ":" not in sh["src"]}
        clips = {i: f.result() for i, f in futs.items()}
    tiles = []
    for i, (sh, fa, n) in enumerate(shots):
        if i in clips:
            raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", clips[i], "-vf",
                                           f"select=eq(n\\,{n // 2})", "-frames:v", "1",
                                           "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])
            fr = Image.frombuffer("RGB", (W, H), raw, "raw", "RGB", 0, 1)
        else:
            for j, fr in enumerate(photo_frames(sh, n, fmt)):
                if j == n // 2:
                    break
        t = fr.resize((tw, th), Image.BICUBIC)
        ImageDraw.Draw(t).text((4, 4), f"{i} {sh['src']} {fa / FPS:.1f}s", fill=(255, 255, 0))
        tiles.append(t)
    cols = 8 if fmt == "16x9" else 12
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, rows * th))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * tw, (i // cols) * th))
    out = os.path.join(CACHE, f"preview-{fmt}.jpg")
    sheet.save(out, quality=88)
    print(out)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--format", choices=list(FORMATS), action="append")
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(EXPORT, exist_ok=True)
    for fmt in args.format or ["16x9", "9x16"]:
        render(fmt, args.preview)


if __name__ == "__main__":
    main()
