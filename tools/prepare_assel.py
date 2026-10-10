#!/usr/bin/env python3
"""Builds the ASSEL film assets in ad/assets/assel/ from the box photograph.

    python3 tools/prepare_assel.py BOX_IMAGE

Outputs:
  tray-empty.jpg      the box with all four slots emptied (chocolates removed and
                      the slot floor reconstructed), used under lifting chocolates
  plate.jpg           the same with the lid removed too (dark backdrop rebuilt),
                      so the lid can be animated opening over it
  lid-mask.png        soft mask of the lid's inner panel
  choc-<id>.png       each chocolate cut out with alpha, plus its crop box in
  chocolates.json     image uv so the film can put it back exactly in its slot

Coordinates are in the original 623x624 photo and scale to any resolution.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'ad' / 'assets' / 'assel'
REF_W, REF_H = 623, 624
# Lid inner panel corners: top-left, top-right, hinge-right, hinge-left.
LID = [(32, 34), (546, 2), (570, 239), (74, 299)]
# id: centre x, centre y, radius x, radius y, rotation (deg) of the cut ellipse
CHOCS = {
    'date': (235, 355, 64, 47, -25),
    'white': (419, 340, 49, 43, 0),
    'star': (262, 471, 63, 59, 0),
    'round': (435, 452, 49, 48, 0),
}


def ellipse_field(w, h, cx, cy, rx, ry, rot):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    a = np.radians(rot)
    u = ((xx - cx) * np.cos(a) + (yy - cy) * np.sin(a)) / rx
    v = (-(xx - cx) * np.sin(a) + (yy - cy) * np.cos(a)) / ry
    return np.sqrt(u * u + v * v)


def chocolate_alpha(c, r, kind):
    """Foreground mask of a chocolate against the dark slot."""
    lum = c @ np.array([0.3, 0.55, 0.15], np.float32)
    warm = c[..., 0] - c[..., 2]
    if kind == 'date':
        # Dark chocolate on a dark slot: rely on the fitted ellipse, trimmed where the slot shows.
        fg = np.clip((1.0 - r) / 0.06, 0, 1)
        slot = (c.max(-1) < 0.13) & (warm < 0.04)
        return fg * (1 - slot * np.clip((r - 0.8) / 0.2, 0, 1))
    fg = np.clip((lum - 0.16) * 8, 0, 1) if kind != 'white' else np.clip((lum - 0.3) * 6, 0, 1)
    fg = np.maximum(fg, np.clip((warm - 0.08) * 8, 0, 1))
    return fg * np.clip((1.12 - r) / 0.08, 0, 1)


def clean(a, k):
    A = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    A = A.filter(ImageFilter.MaxFilter(k | 1)).filter(ImageFilter.MinFilter((k * 2) | 1)).filter(ImageFilter.MaxFilter(k | 1))
    return A.filter(ImageFilter.GaussianBlur(k * 0.4))


def inpaint(img, mask):
    """Push-pull (multi-scale) fill: good for the dark, nearly uniform slot floor."""
    known = (mask < 0.5).astype(np.float32)
    if min(img.shape[:2]) <= 4:
        w = known.sum()
        mean = (img * known[..., None]).sum((0, 1)) / max(w, 1)
        return np.where(known[..., None] > 0, img, mean)
    h, w = img.shape[:2]
    h2, w2 = (h + 1) // 2, (w + 1) // 2
    pi = np.zeros((h2 * 2, w2 * 2, 3), np.float32)
    pk = np.zeros((h2 * 2, w2 * 2), np.float32)
    pi[:h, :w] = img * known[..., None]
    pk[:h, :w] = known
    si = pi.reshape(h2, 2, w2, 2, 3).sum((1, 3))
    sk = pk.reshape(h2, 2, w2, 2).sum((1, 3))
    down = si / np.maximum(sk, 1e-6)[..., None]
    coarse = inpaint(down, (sk < 1e-6).astype(np.float32))
    up = np.repeat(np.repeat(coarse, 2, 0), 2, 1)[:h, :w]
    up = np.asarray(Image.fromarray((np.clip(up, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    return np.where(known[..., None] > 0, img, up)


def main(src):
    OUT.mkdir(parents=True, exist_ok=True)
    img = Image.open(src).convert('RGB')
    W, H = img.size
    s = W / REF_W
    arr = np.asarray(img).astype(np.float32) / 255
    meta = {}
    hole = np.zeros((H, W), np.float32)
    for cid, (cx, cy, rx, ry, rot) in CHOCS.items():
        pad = 1.3
        x0, y0 = int((cx - rx * pad) * s), int((cy - ry * pad) * s)
        x1, y1 = int((cx + rx * pad) * s), int((cy + ry * pad) * s)
        c = arr[y0:y1, x0:x1]
        r = ellipse_field(x1 - x0, y1 - y0, (cx * s - x0), (cy * s - y0), rx * s, ry * s, rot)
        A = clean(chocolate_alpha(c, r, cid), max(3, int(2 * s)))
        crop = img.crop((x0, y0, x1, y1)).convert('RGBA')
        crop.putalpha(A)
        crop.save(OUT / f'choc-{cid}.png', optimize=True)
        meta[cid] = {'x0': x0 / W, 'y0': y0 / H, 'x1': x1 / W, 'y1': y1 / H}
        # Area to reconstruct: the chocolate plus a margin for its contact shadow.
        hole[y0:y1, x0:x1] = np.maximum(hole[y0:y1, x0:x1], (r < 1.14).astype(np.float32))
        print('wrote', OUT / f'choc-{cid}.png', crop.size)

    # Reconstruct the empty slots at reduced size (they are dark and soft), then
    # composite back at full resolution so the rest of the photo stays untouched.
    f = 4
    small = np.asarray(img.resize((W // f, H // f), Image.LANCZOS)).astype(np.float32) / 255
    hs = np.asarray(Image.fromarray((hole * 255).astype(np.uint8)).resize((W // f, H // f))).astype(np.float32) / 255
    filled = inpaint(small, (hs > 0.05).astype(np.float32))
    # A slot is a recess: deepen it slightly toward its centre.
    filled *= 1 - 0.35 * np.clip(hs, 0, 1)[..., None]
    big = Image.fromarray((np.clip(filled, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)
    big = big.filter(ImageFilter.GaussianBlur(2 * s))
    m = Image.fromarray((hole * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(int(3 * s) | 1)).filter(ImageFilter.GaussianBlur(3 * s))
    empty = Image.composite(big, img, m)
    empty.save(OUT / 'tray-empty.jpg', quality=92, optimize=True, progressive=True)
    print('wrote', OUT / 'tray-empty.jpg')

    # Lid removed: rebuild what is behind it (a dark backdrop) and darken it.
    lm = Image.new('L', (REF_W, REF_H), 0)
    ImageDraw.Draw(lm).polygon(LID, fill=255)
    lm.filter(ImageFilter.GaussianBlur(1.0)).resize((1024, 1024), Image.BICUBIC).save(OUT / 'lid-mask.png')
    hole_lid = np.asarray(lm.filter(ImageFilter.MaxFilter(9)).resize((W // f, H // f))).astype(np.float32) / 255
    small_e = np.asarray(empty.resize((W // f, H // f), Image.LANCZOS)).astype(np.float32) / 255
    back = inpaint(small_e, (hole_lid > 0.05).astype(np.float32))
    yy = np.linspace(0, 1, H // f)[:, None, None]
    back = back * (0.22 + 0.5 * yy) * 0.7
    back = Image.fromarray((np.clip(back, 0, 1) * 255).astype(np.uint8)).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(6 * s))
    m2 = lm.filter(ImageFilter.MaxFilter(9)).resize((W, H), Image.BICUBIC).filter(ImageFilter.GaussianBlur(2 * s))
    Image.composite(back, empty, m2).save(OUT / 'plate.jpg', quality=92, optimize=True, progressive=True)
    print('wrote', OUT / 'plate.jpg')
    meta['lid'] = [[x / REF_W, y / REF_H] for x, y in LID]
    (OUT / 'chocolates.json').write_text(json.dumps(meta, indent=2))
    print('wrote', OUT / 'chocolates.json')


if __name__ == '__main__':
    main(sys.argv[1])
