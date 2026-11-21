"""Bande-son ESAA : la musique choisie, allongée à 30 s sur sa propre grille rythmique.

La musique (extrait TikTok) dure 24 s :
    0 – 4,09 s   intro (effets + roulement)
    4,09 – 22,4  groove à 94,9 BPM, motif 3+3+2 (accents sur les croches 0, 3 et 6
                 de chaque mesure de 2,53 s)
    22,47        fin du son de la vidéo ; à 22,54 démarre le jingle du logo TikTok,
                 qu'on n'utilise pas : on le remplace par notre propre BOUM (synth_boom).
Pour tenir 30 s, on rejoue deux mesures (raccord mesure 4 -> mesure 2, même accord)
et on prolonge le BOUM par une réverbération. La grille reste continue : toutes
les coupes du film tombent sur les accents de la musique.

`python3 esaa/tools/music.py --analyse` recalcule la grille (nécessite librosa).
"""
import json, os, subprocess, sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
META = os.path.join(ROOT, "music.json")
SR = 48000
LENGTH = 30.0


def default_source():
    from clips import UPLOADS
    import glob
    hits = glob.glob(os.path.join(UPLOADS, "*-v14044g50000d6ark17og65qqefk6pvg.mp4"))
    return hits[0] if hits else None


def decode(path, sr=SR):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "2",
                                   "-ar", str(sr), "-f", "f32le", "-"])
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


# --- Analyse (une fois) ------------------------------------------------------------------
def analyse(path):
    import librosa
    sr = 44100
    y = decode(path, sr).mean(1).astype(np.float32)
    hop = 128
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    ft = librosa.frames_to_time(np.arange(S.shape[1]), sr=sr, hop_length=hop)
    env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S), sr=sr, hop_length=hop)

    def val(t):
        i = np.searchsorted(ft, t)
        return env[max(0, i - 2):i + 3].max()

    best = None
    for E in np.arange(0.3120, 0.3205, 0.0002):          # croche
        B = 8 * E
        for ph in np.arange(0, B, 0.005):
            acc, t = [], 4.0 + ph
            while t < 22.2:
                acc += [val(t + k * E) for k in (0, 3, 6) if t + k * E < 22.2]
                t += B
            s = float(np.mean(acc))
            if best is None or s > best[0]:
                best = (s, float(E), float(4.0 + ph))
    _, E, bar0 = best
    boom = float(np.argmax(np.abs(y[int(22.3 * sr):int(22.9 * sr)]) > 0.3) / sr + 22.3)
    meta = {"eighth": round(E, 5), "bar0": round(bar0, 4), "boom": round(boom, 4),
            "loop_from_bar": 4, "loop_to_bar": 2,
            "end": 22.47,          # avant le jingle TikTok (logo de fin de la vidéo téléchargée)
            "boom_gain": 0.62}
    with open(META, "w") as f:
        json.dump(meta, f, indent=2)
    return meta


def load_meta():
    with open(META) as f:
        return json.load(f)


# --- Grille dans le temps du film ------------------------------------------------------------
class Grid:
    def __init__(self, meta):
        self.E = meta["eighth"]
        self.bar = 8 * self.E
        self.bar0 = meta["bar0"]
        loop = (meta["loop_from_bar"] - meta["loop_to_bar"]) * self.bar
        self.loop = loop
        self.boom = meta["boom"] + loop          # temps du film

    def accent(self, a):
        """Temps (film) du a-ième accent ; a=0 est le premier temps du groove (4,09 s)."""
        k, r = divmod(a, 3)
        return self.bar0 + k * self.bar + (0, 3, 6)[r] * self.E


# --- Montage audio ---------------------------------------------------------------------------
def _reverb_ir(seconds=2.8, sr=SR, seed=7):
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    decay = np.exp(-6.9 * t / seconds)                 # -60 dB à `seconds`
    ir = rng.standard_normal((n, 2)) * decay[:, None]
    # adoucir les aigus (filtre passe-bas simple, appliqué plus fort au fil du temps)
    k = 18
    kern = np.ones(k) / k
    for c in range(2):
        ir[:, c] = np.convolve(ir[:, c], kern, mode="same")
    pre = int(0.018 * sr)
    ir = np.vstack([np.zeros((pre, 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(0, keepdims=True))


def synth_boom(seconds=2.2, sr=SR, seed=11):
    """Notre propre impact (remplace le son du logo TikTok) : sub qui plonge de 120 à 38 Hz,
    coup sourd à 95 Hz, attaque de bruit très courte et un souffle grave. Stéréo."""
    rng = np.random.default_rng(seed)
    n = int(seconds * sr)
    t = np.arange(n) / sr
    f = 38 + 82 * np.exp(-t / 0.06)
    sub = np.sin(2 * np.pi * np.cumsum(f) / sr) * (1 - np.exp(-t / 0.002)) * np.exp(-t / 0.42)
    thump = np.sin(2 * np.pi * 95 * t) * np.exp(-t / 0.09)
    out = np.zeros((n, 2))
    for c in range(2):
        noise = rng.standard_normal(n)
        click = np.diff(noise, prepend=0) * np.exp(-t / 0.010) * 0.35
        air = np.convolve(noise, np.ones(48) / 48, mode="same") * np.exp(-t / 0.35) * 1.4
        out[:, c] = sub + 0.55 * thump + click + air
    out = np.tanh(1.8 * out) / np.tanh(1.8)
    return out / np.abs(out).max()


def _highpass(x, fc, sr=SR):
    X = np.fft.rfft(x, axis=0)
    f = np.fft.rfftfreq(len(x), 1 / sr)[:, None]
    X *= 1 - np.exp(-(f / fc) ** 4)
    return np.fft.irfft(X, len(x), axis=0)


def _fftconv(x, h):
    n = len(x) + len(h) - 1
    N = 1 << (n - 1).bit_length()
    out = np.fft.irfft(np.fft.rfft(x, N, axis=0) * np.fft.rfft(h, N, axis=0), N, axis=0)
    return out[:n]


def build(path, out_wav, meta=None):
    meta = meta or load_meta()
    g = Grid(meta)
    x = decode(path)
    sr = SR
    i_bar = g.bar0 + meta["loop_to_bar"] * g.bar
    j_bar = g.bar0 + meta["loop_from_bar"] * g.bar
    # alignement fin du raccord par corrélation (± 12 ms)
    mono = x.mean(1)
    w = int(0.30 * sr)
    a = mono[int(j_bar * sr):int(j_bar * sr) + w]
    best, lag_best = -1e9, 0
    for lag in range(-int(0.012 * sr), int(0.012 * sr) + 1, 8):
        s = int(i_bar * sr) + lag
        b = mono[s:s + w]
        c = float(np.dot(a, b))
        if c > best:
            best, lag_best = c, lag
    j = int(j_bar * sr)
    i = int(i_bar * sr) + lag_best
    xf = int(0.045 * sr)                                   # fondu à puissance constante
    t = np.linspace(0, np.pi / 2, xf)[:, None]
    head = x[:j - xf // 2]
    cross = x[j - xf // 2:j - xf // 2 + xf] * np.cos(t) + x[i - xf // 2:i - xf // 2 + xf] * np.sin(t)
    tail = x[i - xf // 2 + xf:int(meta["end"] * sr)].copy()
    fo = int(0.06 * sr)                    # la musique s'arrête juste avant le son TikTok
    tail[-fo:] *= np.linspace(1, 0, fo)[:, None]
    y = np.vstack([head, cross, tail]).astype(np.float64)

    n = int(LENGTH * sr)
    y = np.vstack([y, np.zeros((max(0, n - len(y)), 2))])[:n]
    # notre BOUM, au même instant que celui de la vidéo d'origine (le slogan est calé dessus)
    b = int(g.boom * sr)
    boom = synth_boom()[:n - b]
    y[b:b + len(boom)] += meta.get("boom_gain", 0.62) * boom
    # réverbération sur le BOUM (et seulement lui)
    b = int((g.boom - 0.01) * sr)
    hit = _highpass(y[b:].copy(), 180.0)   # pas de réverbération sur le sub : la fin reste nette
    wet = _fftconv(hit, _reverb_ir())[:len(hit)]
    y[b:] += 0.42 * wet
    # fin : fondu sur les 0,9 dernières secondes
    f = int(0.9 * sr)
    y[-f:] *= np.linspace(1, 0, f)[:, None] ** 1.5
    y[:int(0.01 * sr)] *= np.linspace(0, 1, int(0.01 * sr))[:, None]
    peak = np.abs(y).max()
    if peak > 0.99:
        y *= 0.99 / peak
    raw = out_wav + ".raw.wav"
    _write_wav(raw, y.astype(np.float32), sr)
    _loudnorm(raw, out_wav)
    os.remove(raw)
    return g, lag_best / sr


def _write_wav(path, y, sr):
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "2",
                          "-i", "-", "-c:a", "pcm_f32le", path], stdin=subprocess.PIPE)
    p.stdin.write(y.tobytes())
    p.stdin.close()
    p.wait()


def _loudnorm(src, dst, I=-14.0, TP=-1.5, LRA=11):
    """Normalisation EBU R128 en deux passes (linéaire : ne change pas la dynamique)."""
    out = subprocess.run(["ffmpeg", "-hide_banner", "-i", src, "-af",
                          f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    js = json.loads(out[out.rindex("{"):out.rindex("}") + 1])
    af = (f"loudnorm=I={I}:TP={TP}:LRA={LRA}:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
          f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:"
          f"offset={js['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", af, "-ar", str(SR),
                    "-c:a", "pcm_s16le", dst], check=True)


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    src = default_source()
    if "--analyse" in sys.argv:
        print(analyse(src))
    out = os.path.join(ROOT, "export", "esaa-musique-30s.wav")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    g, lag = build(src, out)
    print(f"OK {out}  BOUM à {g.boom:.3f} s (film), raccord ajusté de {lag * 1000:+.1f} ms")
