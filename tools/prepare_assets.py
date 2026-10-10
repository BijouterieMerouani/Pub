#!/usr/bin/env python3
"""Builds the photo-film assets in ad/assets/ from the two source photos.

    python3 tools/prepare_assets.py BOX_IMAGE SAHARA_IMAGE

The sources used for the committed assets were the client photos upscaled x4
with OpenCV's EDSR super-resolution model (cv2.dnn_superres, EDSR_x4.pb).
Any image of the same framing works; coordinates below are expressed in the
original 623x624 box photo and scale automatically.

Outputs:
  box.jpg / box-blur.jpg     photo + heavily blurred copy (depth of field, fill)
  box-depth.png              hand-built depth map for 2.5D parallax
  box-gold.png               mask of gold foil / gold leaf for glints
  date.png                   date-shaped chocolate cut out with alpha
  sahara.jpg / sahara-blur.jpg / sahara-depth.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'ad' / 'assets'
REF_W, REF_H = 623, 624  # original box photo size; all coordinates below use it

# Chocolates (centre x, centre y, radius x, radius y) in reference pixels.
CHOCS = {
    'date': (235, 355, 64, 47),
    'white': (419, 339, 47, 41),
    'star': (262, 470, 60, 56),
    'round': (435, 452, 47, 46),
}
LID = [(32, 35), (548, 2), (570, 240), (75, 300)]
TRAY = [(75, 300), (570, 240), (623, 470), (623, 525), (117, 600)]
FRONT = [(100, 540), (623, 455), (623, 525), (117, 600)]


def save_jpg(img, name, q=90):
    img.save(OUT / name, quality=q, optimize=True, progressive=True)
    print('wrote', OUT / name, img.size)


def box_assets(src):
    img = Image.open(src).convert('RGB')
    W, H = img.size
    sx, sy = W / REF_W, H / REF_H
    S = lambda pts: [(x * sx, y * sy) for x, y in pts]
    save_jpg(img, 'box.jpg', 92)
    save_jpg(img.resize((W // 3, H // 3), Image.LANCZOS).filter(ImageFilter.GaussianBlur(10)), 'box-blur.jpg', 88)

    # Depth: 0 = far, 1 = near. Built at reference scale then upsampled.
    D = Image.new('F', (REF_W, REF_H), 0.12)
    d = ImageDraw.Draw(D)
    d.polygon(LID, fill=0.28)
    d.polygon(TRAY, fill=0.5)
    d.polygon(FRONT, fill=0.72)
    arr = np.array(D)
    yy, xx = np.mgrid[0:REF_H, 0:REF_W]
    for cx, cy, rx, ry in CHOCS.values():
        r = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2)
        dome = np.clip(1 - r, 0, 1) ** 0.6
        arr = np.maximum(arr, np.where(r < 1, 0.66 + 0.24 * dome, 0))
    D = Image.fromarray((arr * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
    D.resize((1024, 1024), Image.BICUBIC).save(OUT / 'box-depth.png')
    print('wrote box-depth.png')

    # Gold mask: warm, saturated, bright pixels (foil lettering, trims, gold leaf).
    small = np.asarray(img.resize((1024, 1024), Image.LANCZOS)).astype(np.float32) / 255
    r, g, b = small[..., 0], small[..., 1], small[..., 2]
    mx, mn = small.max(-1), small.min(-1)
    sat = (mx - mn) / (mx + 1e-4)
    hue_ok = (r > g) & (g > b) & ((r - g) < 0.35 * r + 0.05)
    gold = np.clip((sat - 0.35) * 3, 0, 1) * np.clip((mx - 0.42) * 4, 0, 1) * hue_ok
    # Keep the photo's surroundings (dates, hazelnuts, lantern) out of the glints.
    keep = Image.new('L', (REF_W, REF_H), 0)
    ImageDraw.Draw(keep).polygon(LID + TRAY[1:], fill=255)
    keep = np.asarray(keep.resize((1024, 1024))).astype(np.float32) / 255
    # The map artwork is colourful but not foil.
    mapmask = Image.new('L', (REF_W, REF_H), 255)
    ImageDraw.Draw(mapmask).ellipse((205, 45, 412, 250), fill=0)
    keep *= np.asarray(mapmask.resize((1024, 1024))).astype(np.float32) / 255
    # On the chocolates only the date's real gold leaf (very saturated and bright) may glint.
    yy, xx = np.mgrid[0:1024, 0:1024] * (REF_W / 1024)
    strict = (sat > 0.55) & (mx > 0.62)
    for name, (cx, cy, rx, ry) in CHOCS.items():
        inside = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1.2
        gold = np.where(inside, gold * strict if name == 'date' else 0, gold)
    Image.fromarray((np.clip(gold * keep, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)).save(OUT / 'box-gold.png')
    print('wrote box-gold.png')

    # Date chocolate cut-out: separate the reddish-brown chocolate from the dark tray.
    cx, cy, rx, ry = CHOCS['date']
    pad = 1.35
    box = (int((cx - rx * pad) * sx), int((cy - ry * pad) * sy), int((cx + rx * pad) * sx), int((cy + ry * pad) * sy))
    crop = img.crop(box)
    c = np.asarray(crop).astype(np.float32) / 255
    h, w = c.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    # The date lies tilted ~25 degrees; fit a rotated ellipse and feather it.
    ang = np.radians(-25)
    u = ((xx - w / 2) * np.cos(ang) + (yy - h / 2) * np.sin(ang)) / (63 * sx)
    v = (-(xx - w / 2) * np.sin(ang) + (yy - h / 2) * np.cos(ang)) / (37 * sy)
    r = np.sqrt(u * u + v * v)
    ell = np.clip((1.0 - r) / 0.06, 0, 1)
    dark_tray = (c.max(-1) < 0.13) & ((c[..., 0] - c[..., 2]) < 0.04)
    a = ell * (1 - dark_tray * np.clip((r - 0.8) / 0.2, 0, 1))
    A = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))
    crop = crop.convert('RGBA')
    crop.putalpha(A)
    crop.save(OUT / 'date.png', optimize=True)
    print('wrote date.png', crop.size)


def sahara_assets(src):
    img = Image.open(src).convert('RGB')
    if img.width > 1440:
        img = img.resize((1440, round(img.height * 1440 / img.width)), Image.LANCZOS)
    save_jpg(img, 'sahara.jpg', 90)
    save_jpg(img.resize((img.width // 3, img.height // 3), Image.LANCZOS).filter(ImageFilter.GaussianBlur(8)), 'sahara-blur.jpg', 88)
    # Depth by height: sky far, horizon with the caravan mid, sand near.
    h = 512
    y = np.linspace(0, 1, h)[:, None]
    horizon = 0.59
    depth = np.where(y < horizon, 0.1 + 0.15 * (y / horizon), 0.35 + 0.65 * np.clip((y - horizon) / (1 - horizon), 0, 1) ** 0.8)
    Image.fromarray((np.repeat(depth, 288, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6)).save(OUT / 'sahara-depth.png')
    print('wrote sahara-depth.png')


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    box_assets(sys.argv[1])
    sahara_assets(sys.argv[2])
