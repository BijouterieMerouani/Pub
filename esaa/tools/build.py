"""ESAA — film de 30 s, vertical 1080x1920, 30 i/s.

Usage :
    python3 esaa/tools/build.py                 # brouillon sans musique
    python3 esaa/tools/build.py --music fichier  # version finale (musique + coupes sur le tempo)
    python3 esaa/tools/build.py --music f --bpm 124 --offset 0.12 --music-start 31.5

Étapes :
1. chaque plan est extrait de la vidéo source, converti HDR (HLG) -> SDR Rec.709, mis au
   format 1080x1920 30 i/s et mis en cache dans esaa/.cache/ ;
2. un compositeur Python lit les plans dans l'ordre, ajoute un léger zoom, les photos
   (panoramique, carte de fin) et les titres animés, puis encode en H.264 ;
3. si une musique est donnée, elle est coupée à 30 s (fondu de fin) et ajoutée en AAC.
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
# (source, point d'entrée en s, durée en temps musicaux). 60 temps = 30 s à 120 BPM.
# Avec --bpm, la durée d'un temps change et les plans restent calés sur les temps.
TIMELINE = [
    # Préparation + titre
    ("6876", 0.10, 3),   # on accroche les lettres BIENVENUE
    ("6877", 0.30, 3),   # la salle se prépare
    # Accueil
    ("6879", 0.20, 3),   # le buffet
    ("6886", 2.40, 3),   # buffet, ballons verts, rideau doré
    ("6881", 0.30, 2),   # un stand
    # L'économie en jeu : billets et jetons
    ("6901", 0.00, 3),   # billets sur la table
    ("6904", 0.00, 2),   # cœur avec les billets
    ("6914", 1.20, 3),   # stand « 2 pour 1 jeton »
    ("6897", 0.30, 2),   # bonjour !
    ("6916", 4.00, 2),   # l'équipe salue
    # Ateliers
    ("6931", 0.80, 3),
    ("6932", 0.00, 2),
    ("6933", 7.80, 3),
    ("7557711C", 2.80, 2),
    # Remise des diplômes
    ("6947", 1.60, 3),
    ("6949", 2.30, 2),
    ("6950", 1.20, 2),
    ("6953", 1.20, 2),
    ("6954", 1.30, 2),
    ("6952", 0.60, 2),
    # Photos de groupe
    ("photo:6920", 0, 3),   # panoramique sur le groupe
    ("photo:6929", 0, None),  # carte de fin : prend le reste jusqu'à 30 s
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


def title_overlay(frame, f, end, layers):
    """Titre visible de f=6 jusqu'à `end` (fin du 2e plan)."""
    sc, big, pill = layers
    if f > end:
        return frame
    a_out = 1 - ease_in_out((f - (end - 10)) / 10)
    out = frame.convert("RGBA")
    out.alpha_composite(faded(sc, min(ease_out((f - 0) / 10), a_out)))
    for lay, start, dy in ((big, 6, 60), (pill, 13, 40)):
        t = ease_out((f - start) / 14)
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


def end_card(key, n):
    bg, holder, top, l1, l2 = build_end_assets(key)
    for i in range(n):
        # fond : léger zoom lent
        s = 1.0 + 0.04 * i / n
        bw, bh = W / s, H / s
        frame = bg.resize((W, H), Image.BICUBIC,
                          box=((W - bw) / 2, (H - bh) / 2, (W + bw) / 2, (H + bh) / 2)).convert("RGBA")
        # photo : arrive en se posant (échelle 1.12 -> 1.0), puis respire doucement
        t = ease_out(i / 12)
        sc = (1.12 - 0.12 * t) * (1.0 + 0.025 * i / n)
        hw, hh = holder.size
        hp = holder.resize((round(hw * sc), round(hh * sc)), Image.BICUBIC)
        hp = faded(hp, t)
        cx, cy = W / 2, 880
        frame.alpha_composite(hp, (round(cx - hp.width / 2), round(cy - hp.height / 2)))
        for lay, start, dy in ((top, 4, 30), (l1, 12, 36), (l2, 18, 36)):
            tt = ease_out((i - start) / 14)
            if tt > 0:
                frame.alpha_composite(faded(lay, tt), (0, round(dy * (1 - tt))))
        yield frame.convert("RGB")


# --- Zoom léger sur les plans vidéo -----------------------------------------------------
def push_in(frame, i, n, amount=0.035):
    s = 1.0 + amount * (i / max(n - 1, 1))
    if s <= 1.0005:
        return frame
    bw, bh = W / s, H / s
    return frame.resize((W, H), Image.BICUBIC,
                        box=((W - bw) / 2, (H - bh) / 2, (W + bw) / 2, (H + bh) / 2))


# --- Bande-son -------------------------------------------------------------------------
def prepare_music(path, start, out_wav):
    subprocess.run([
        "ffmpeg", "-v", "error", "-y", "-ss", f"{start:.3f}", "-i", path, "-t", "30",
        "-vn", "-ac", "2", "-ar", "48000",
        "-af", "afade=t=in:st=0:d=0.05,afade=t=out:st=28.3:d=1.7,loudnorm=I=-14:TP=-1.5:LRA=11",
        out_wav], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--music")
    ap.add_argument("--music-start", type=float, default=0.0, help="début du passage utilisé (s)")
    ap.add_argument("--bpm", type=float, default=120.0)
    ap.add_argument("--offset", type=float, default=0.0,
                    help="décalage du premier temps fort par rapport au début du passage (s)")
    ap.add_argument("--out", default=os.path.join(EXPORT, "esaa-30s-9x16.mp4"))
    args = ap.parse_args()
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(EXPORT, exist_ok=True)

    beat = 60.0 / args.bpm
    # bornes des plans sur la grille des temps : le 1er plan absorbe le décalage
    bounds = [0]
    acc = args.offset
    for src, t_in, beats in TIMELINE:
        if beats is None:
            bounds.append(TOTAL)
            break
        acc += beats * beat
        bounds.append(min(TOTAL, round(acc * FPS)))
    shots = []
    for (src, t_in, _), a, b in zip(TIMELINE, bounds, bounds[1:]):
        if b > a:
            shots.append((src, t_in, a, b - a))
    assert shots[-1][2] + shots[-1][3] == TOTAL, shots[-1]

    idx = index()
    jobs = {}
    with ThreadPoolExecutor(4) as ex:
        for src, t_in, a, n in shots:
            if not src.startswith("photo:"):
                jobs[(src, a)] = ex.submit(extract, idx[src], t_in, n)
        jobs = {k: fut.result() for k, fut in jobs.items()}
    print(f"{len(jobs)} plans prêts", flush=True)

    title_layers = build_title_layers()
    title_end = shots[1][2] + shots[1][3] - 1

    silent = args.out if not args.music else os.path.join(CACHE, "video_only.mp4")
    enc = subprocess.Popen([
        "ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
        "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17",
        "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "bt709", "-movflags", "+faststart", silent], stdin=subprocess.PIPE)

    f = 0
    for src, t_in, a, n in shots:
        if src == "photo:6929" or (src.startswith("photo:") and (a + n) == TOTAL):
            gen = end_card(src.split(":")[1], n)
        elif src.startswith("photo:"):
            gen = photo_pan(src.split(":")[1], n)
        else:
            gen = (push_in(fr, i, n) for i, fr in enumerate(read_frames(jobs[(src, a)], n)))
        for fr in gen:
            if f <= title_end:
                fr = title_overlay(fr, f, title_end, title_layers)
            enc.stdin.write(fr.tobytes())
            f += 1
        print(f"  {src:<12} {a / FPS:5.2f}s -> {(a + n) / FPS:5.2f}s", flush=True)
    enc.stdin.close()
    enc.wait()
    assert f == TOTAL, f

    if args.music:
        wav = os.path.join(EXPORT, "esaa-musique-30s.wav")
        prepare_music(args.music, args.music_start, wav)
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-i", silent, "-i", wav, "-map", "0:v", "-map", "1:a",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-shortest",
            "-movflags", "+faststart", args.out], check=True)
    print("OK", args.out)


if __name__ == "__main__":
    main()
