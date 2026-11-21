"""ESAA — film de 30 s, vertical 1080x1920, 30 i/s.

Usage :
    python3 esaa/tools/build.py            # film final avec la musique envoyée
    python3 esaa/tools/build.py --music f  # autre fichier (même grille : voir music.json)

Étapes :
1. chaque plan est extrait de la vidéo source, converti HDR (HLG) -> SDR Rec.709, mis au
   format 1080x1920 30 i/s et mis en cache dans esaa/.cache/ ;
2. un compositeur Python lit les plans dans l'ordre, ajoute un léger zoom, les photos
   (panoramique, carte de fin) et les titres animés, puis encode en H.264 ;
3. la musique est allongée à 30 s sur sa propre grille (music.py) et ajoutée en AAC ;
   toutes les coupes tombent sur ses accents, le BOUM final fait entrer le slogan.
"""
import argparse, hashlib, json, math, os, subprocess, sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from clips import index, photo  # noqa: E402

W, H, FPS = 1080, 1920, 30
TOTAL = 30 * FPS
CACHE = os.path.join(ROOT, ".cache")
EXPORT = os.path.join(ROOT, "export")
FONTS = "/usr/share/fonts/opentype/inter"

GREEN = (31, 143, 90)
GOLD = (242, 193, 78)
INK = (8, 32, 22)

# --- Montage --------------------------------------------------------------------------
# Coupes calées sur la musique (voir music.py) : 94,9 BPM, motif 3+3+2, soit 3 accents
# par mesure de 2,53 s (intervalles 0,95 / 0,95 / 0,63 s). Chaque plan dure un nombre
# d'accents ; l'accent 0 est l'arrivée du groove (4,09 s).
FIRST_CUT = -3          # 1re coupe : accent -3 = début de la mesure d'intro (1,56 s)
TIMELINE = [
    # Intro (effets + roulement) : préparation + titre
    ("6876", 0.10, None),  # on accroche les lettres BIENVENUE      0 -> 1,56
    ("6877", 0.30, 3),     # la salle se prépare                 1,56 -> 4,09
    # Mesure 0 : accueil
    ("6879", 0.20, 1),     # le buffet
    ("6886", 2.40, 1),     # ballons verts, rideau doré
    ("6881", 0.30, 1),     # un stand
    # Mesure 1 : l'économie en jeu
    ("6901", 0.00, 1),     # billets sur la table
    ("6904", 0.00, 1),     # cœur avec les billets
    ("6899", 0.50, 1),     # bonjour !
    # Mesure 2 : stand des jetons
    ("6914", 1.20, 2),     # « 2 pour 1 jeton »
    ("6897", 0.30, 1),
    # Mesures 3-4 : ateliers
    ("6916", 4.00, 1),
    ("6931", 0.80, 2),
    ("6932", 0.00, 1),
    ("6933", 7.80, 2),
    # Mesure 5 : fous rires, puis les diplômes
    ("7557711C", 2.80, 1),
    ("6947", 1.60, 2),
    # Mesures 6-7 : remise des diplômes
    ("6949", 2.30, 1),
    ("6950", 1.20, 1),
    ("6953", 1.20, 1),
    ("6954", 1.30, 1),
    ("6952", 0.60, 1),
    ("6948", 0.20, 1),
    # Mesure 8 : photo de groupe (panoramique) pendant que la musique retombe
    ("photo:6920", 0, 3),
    # Carte de fin : la photo se pose, puis le BOUM fait entrer le slogan
    ("photo:6929", 0, None),
]

HLG = ("zscale=tin=arib-std-b67:min=bt2020nc:pin=bt2020:rin=tv:t=linear:npl=203,"
       "format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:desat=0,"
       "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
GRADE = "eq=saturation=1.12:contrast=1.04"


def probe(path):
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
        "stream=color_transfer:format=duration", "-of", "json", path]).decode()
    j = json.loads(out)
    return j["streams"][0].get("color_transfer", ""), float(j["format"]["duration"])


def extract(src_path, t_in, frames):
    """Plan -> mp4 1080x1920 30 i/s SDR, mis en cache."""
    key = hashlib.sha1(f"{src_path}|{t_in:.3f}|{frames}|v3".encode()).hexdigest()[:12]
    out = os.path.join(CACHE, f"shot_{key}.mp4")
    if os.path.exists(out):
        return out
    transfer, dur = probe(src_path)
    need = frames / FPS
    t_in = max(0.0, min(t_in, dur - need - 0.05))
    vf = []
    if transfer == "arib-std-b67":
        vf.append(HLG)
    vf += [f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos",
           f"crop={W}:{H}", f"fps={FPS}", GRADE, "format=yuv420p"]
    tmp = out + ".part.mp4"
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-ss", f"{t_in:.3f}", "-i", src_path,
        "-vf", ",".join(vf), "-frames:v", str(frames), "-an",
        "-c:v", "libx264", "-preset", "fast", "-crf", "10", tmp], check=True)
    os.replace(tmp, out)
    return out


def read_frames(path, frames):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    size = W * H * 3
    last = None
    for _ in range(frames):
        buf = p.stdout.read(size)
        if len(buf) == size:
            last = Image.frombuffer("RGB", (W, H), buf, "raw", "RGB", 0, 1).copy()
        yield last           # si le plan est un peu court, on tient la dernière image
    p.stdout.close()
    p.wait()


# --- Typographie ----------------------------------------------------------------------
def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


def text_size(fnt, txt, tracking=0):
    w = sum(fnt.getlength(c) for c in txt) + tracking * (len(txt) - 1)
    asc, desc = fnt.getmetrics()
    return w, asc + desc


def draw_text(draw, xy, txt, fnt, fill, tracking=0, anchor="mm"):
    """Texte avec interlettrage, centré sur xy."""
    w, h = text_size(fnt, txt, tracking)
    x, y = xy
    x -= w / 2
    for c in txt:
        draw.text((x, y), c, font=fnt, fill=fill, anchor="lm")
        x += fnt.getlength(c) + tracking
    return w


def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))


def ease_out(t):
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def faded(img, a):
    if a >= 0.999:
        return img
    r, g, b, al = img.split()
    al = al.point(lambda v: int(v * a))
    return Image.merge("RGBA", (r, g, b, al))


def shadowed(img, radius=18, alpha=0.55, offset=(0, 6)):
    """Ajoute une ombre douce sous un calque transparent (lisibilité sur murs blancs)."""
    a = img.split()[3]
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: int(v * alpha)))
    sh = sh.filter(ImageFilter.GaussianBlur(radius))
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(sh, offset)
    out.alpha_composite(img)
    return out


def scrim(y0, y1, peak=0.62):
    """Dégradé sombre vertical (vert très foncé) derrière les titres."""
    arr = np.zeros((H, W, 4), np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = INK
    ys = np.arange(H, dtype=np.float32)
    mid = (y0 + y1) / 2
    half = (y1 - y0) / 2
    a = np.clip(1 - np.abs(ys - mid) / half, 0, 1)
    a = (a ** 0.8) * peak * 255
    arr[..., 3] = a[:, None].astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


# Titre d'ouverture -----------------------------------------------------------------
def build_title_layers():
    big = layer()
    d = ImageDraw.Draw(big)
    f = font("InterDisplay-Black.otf", 270)
    draw_text(d, (W / 2, 1110), "ESAA", f, (255, 255, 255), tracking=8)
    d.rounded_rectangle((W / 2 - 90, 1262, W / 2 + 90, 1274), 6, fill=GOLD)
    big = shadowed(big)

    pill = layer()
    d = ImageDraw.Draw(pill)
    f2 = font("Inter-Bold.otf", 44)
    tw, _ = text_size(f2, "PROJET ASSOCIATIF", 9)
    d.rounded_rectangle((W / 2 - tw / 2 - 40, 1318, W / 2 + tw / 2 + 40, 1398), 40, fill=GREEN)
    draw_text(d, (W / 2, 1358), "PROJET ASSOCIATIF", f2, (255, 255, 255), tracking=9)
    pill = shadowed(pill, radius=14, alpha=0.4)
    return scrim(860, 1640, 0.6), big, pill


def title_overlay(frame, f, cue, layers):
    """Titre d'ouverture. cue = (apparition ESAA, apparition bandeau, fin) en images."""
    sc, big, pill = layers
    t_big, t_pill, end = cue
    if f > end:
        return frame
    a_out = 1 - ease_in_out((f - (end - 8)) / 8)
    out = frame.convert("RGBA")
    out.alpha_composite(faded(sc, min(ease_out((f - t_big + 4) / 10), a_out)))
    for lay, start, dy in ((big, t_big, 70), (pill, t_pill, 40)):
        t = ease_out((f - start) / 12)
        a = min(t, a_out)
        if a <= 0:
            continue
        out.alpha_composite(faded(lay, a), (0, int(round(dy * (1 - t)))))
    return out.convert("RGB")


# Photos ---------------------------------------------------------------------------
def load_photo(key):
    im = Image.open(photo(key))
    from PIL import ImageOps
    return ImageOps.exif_transpose(im).convert("RGB")


def photo_pan(key, n):
    """Panoramique gauche -> droite sur une photo paysage, plein cadre 9:16."""
    im = load_photo(key)
    iw, ih = im.size
    ch = ih * 0.96
    cw = ch * W / H
    for i in range(n):
        t = ease_in_out(i / max(n - 1, 1))
        x0 = (iw - cw) * (0.08 + 0.84 * t)
        y0 = (ih - ch) * 0.35
        yield im.resize((W, H), Image.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))


def build_end_assets(key):
    im = load_photo(key)
    # fond : photo plein cadre, floutée, assombrie, teintée vert
    iw, ih = im.size
    cw = ih * W / H
    bg = im.resize((W // 4, H // 4), Image.BICUBIC, box=((iw - cw) / 2, 0, (iw + cw) / 2, ih))
    bg = bg.filter(ImageFilter.GaussianBlur(10)).resize((W, H), Image.BICUBIC)
    tint = Image.new("RGB", (W, H), INK)
    bg = Image.blend(bg, tint, 0.62)
    # photo encadrée façon tirage
    pw = 960
    ph = round(pw * ih / iw)
    pic = im.resize((pw, ph), Image.LANCZOS)
    border = 16
    card = Image.new("RGBA", (pw + 2 * border, ph + 2 * border), (255, 255, 255, 255))
    card.paste(pic, (border, border))
    pad = 60
    holder = Image.new("RGBA", (card.width + 2 * pad, card.height + 2 * pad), (0, 0, 0, 0))
    holder.alpha_composite(card, (pad, pad))
    holder = shadowed(holder, radius=26, alpha=0.6, offset=(0, 14))
    holder = holder.rotate(-2.2, resample=Image.BICUBIC, expand=True)

    top = layer()
    d = ImageDraw.Draw(top)
    draw_text(d, (W / 2, 300), "ESAA", font("InterDisplay-Black.otf", 150), (255, 255, 255), 6)
    d.rounded_rectangle((W / 2 - 60, 392, W / 2 + 60, 400), 4, fill=GOLD)
    draw_text(d, (W / 2, 448), "PROJET ASSOCIATIF", font("Inter-Bold.otf", 34), (255, 255, 255, 230), 8)

    l1 = layer()
    d = ImageDraw.Draw(l1)
    draw_text(d, (W / 2, 1370), "L’économie et la finance", font("InterDisplay-ExtraBold.otf", 70), (255, 255, 255))
    l2 = layer()
    d = ImageDraw.Draw(l2)
    draw_text(d, (W / 2, 1460), "expliquées aux enfants", font("InterDisplay-ExtraBold.otf", 70), GOLD)
    return bg, holder, top, shadowed(l1, 12, 0.5), shadowed(l2, 12, 0.5)


def end_card(key, n, boom):
    """Carte de fin : la photo se pose, ESAA apparaît ; au BOUM (image `boom`), le
    slogan claque (zoom 1.25 -> 1), petit flash blanc et secousse qui s'amortit."""
    bg, holder, top, l1, l2 = build_end_assets(key)
    flash = Image.new("RGBA", (W, H), (255, 255, 255, 255))
    rng = np.random.default_rng(3)
    shake = rng.uniform(-1, 1, (n, 2))
    for i in range(n):
        s = 1.0 + 0.04 * i / n
        bw, bh = W / s, H / s
        frame = bg.resize((W, H), Image.BICUBIC,
                          box=((W - bw) / 2, (H - bh) / 2, (W + bw) / 2, (H + bh) / 2)).convert("RGBA")
        t = ease_out(i / 12)
        sc = (1.12 - 0.12 * t) * (1.0 + 0.025 * i / n)
        hw, hh = holder.size
        hp = holder.resize((round(hw * sc), round(hh * sc)), Image.BICUBIC)
        hp = faded(hp, t)
        frame.alpha_composite(hp, (round(W / 2 - hp.width / 2), round(880 - hp.height / 2)))
        tt = ease_out((i - 3) / 12)
        if tt > 0:
            frame.alpha_composite(faded(top, tt), (0, round(30 * (1 - tt))))
        k = i - boom
        if k >= 0:
            for lay, delay in ((l1, 0), (l2, 2)):
                u = ease_out((k - delay) / 7)
                if u <= 0:
                    continue
                z = 1.25 - 0.25 * u
                cy = 1415
                lz = lay.resize((round(W * z), round(H * z)), Image.BICUBIC)
                frame.alpha_composite(faded(lz, min(1, (k - delay + 1) / 3)),
                                      (round(W / 2 - W * z / 2), round(cy - cy * z)))
            if k < 7:
                frame.alpha_composite(faded(flash, 0.32 * (1 - k / 7)))
        img = frame.convert("RGB")
        if 0 <= k < 10:                       # secousse amortie
            amp = 14 * (1 - k / 10) ** 2
            dx, dy = (shake[i] * amp).round().astype(int)
            img = img.transform((W, H), Image.AFFINE, (1, 0, -dx, 0, 1, -dy), Image.BICUBIC,
                                fillcolor=INK)
        yield img


# --- Zoom léger sur les plans vidéo -----------------------------------------------------
def push_in(frame, i, n, amount=0.035):
    s = 1.0 + amount * (i / max(n - 1, 1))
    if s <= 1.0005:
        return frame
    bw, bh = W / s, H / s
    return frame.resize((W, H), Image.BICUBIC,
                        box=((W - bw) / 2, (H - bh) / 2, (W + bw) / 2, (H + bh) / 2))


# --- Assemblage -------------------------------------------------------------------------
def main():
    import music
    ap = argparse.ArgumentParser()
    ap.add_argument("--music", default=None, help="fichier de la musique (par défaut : celui envoyé)")
    ap.add_argument("--out", default=os.path.join(EXPORT, "esaa-30s-9x16.mp4"))
    args = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(EXPORT, exist_ok=True)

    src_music = args.music or music.default_source()
    wav = os.path.join(EXPORT, "esaa-musique-30s.wav")
    grid, _ = music.build(src_music, wav)

    def fr(t):
        return int(round(t * FPS))

    # bornes des plans : 0, puis les accents, l'avant-dernier plan finit à la mesure 9,
    # la carte de fin court jusqu'à 30 s
    bounds = [0]
    a = FIRST_CUT
    for src, t_in, n_acc in TIMELINE[1:-1]:
        bounds.append(fr(grid.accent(a)))
        a += n_acc
    bounds.append(fr(grid.accent(a)))
    bounds.append(TOTAL)
    shots = [(src, t_in, b0, b1 - b0) for (src, t_in, _), b0, b1 in zip(TIMELINE, bounds, bounds[1:])]
    assert all(n > 0 for *_, n in shots) and bounds[-1] == TOTAL

    idx = index()
    with ThreadPoolExecutor(4) as ex:
        futs = {(src, b0): ex.submit(extract, idx[src], t_in, n)
                for src, t_in, b0, n in shots if not src.startswith("photo:")}
        jobs = {k: f.result() for k, f in futs.items()}
    print(f"{len(jobs)} plans prêts", flush=True)

    title_layers = build_title_layers()
    # ESAA sur le 1er effet de l'intro, bandeau sur la mesure d'intro, sortie à l'arrivée du groove
    title_cue = (fr(0.30), fr(grid.accent(FIRST_CUT)), fr(grid.accent(0)) - 1)

    silent = os.path.join(CACHE, "video_only.mp4")
    enc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
        "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-movflags", "+faststart", silent], stdin=subprocess.PIPE)

    f = 0
    for k, (src, t_in, b0, n) in enumerate(shots):
        if k == len(shots) - 1:
            gen = end_card(src.split(":")[1], n, fr(grid.boom) - b0)
        elif src.startswith("photo:"):
            gen = photo_pan(src.split(":")[1], n)
        else:
            gen = (push_in(im, i, n) for i, im in enumerate(read_frames(jobs[(src, b0)], n)))
        for im in gen:
            if f <= title_cue[2]:
                im = title_overlay(im, f, title_cue, title_layers)
            enc.stdin.write(im.tobytes())
            f += 1
        print(f"  {src:<12} {b0 / FPS:6.2f}s -> {(b0 + n) / FPS:6.2f}s  ({n / FPS:.2f}s)", flush=True)
    enc.stdin.close()
    enc.wait()
    assert f == TOTAL, f

    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-i", silent, "-i", wav, "-map", "0:v", "-map", "1:a",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-t", "30",
        "-movflags", "+faststart", args.out], check=True)
    print("OK", args.out, f"(BOUM à {grid.boom:.2f} s)")


if __name__ == "__main__":
    main()
