import * as THREE from 'three';
import { makeNoise2D, rng } from './util.js';

const GOLD = '#d6a54e';
const GOLD_HI = '#f3d692';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Tileable normal map baked from fbm value noise.
export function noiseNormalMap(size, scale, octaves, strength, seed) {
  const n = makeNoise2D(scale * 8, seed);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 0.5, f = scale / size;
      for (let o = 0; o < octaves; o++) {
        v += amp * n(x * f * (1 << o), y * f * (1 << o));
        amp *= 0.5;
      }
      hgt[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const H = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      data[i + 1] = ((-dy / l) * 0.5 + 0.5) * 255;
      data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Eight-pointed star (khatam) outline: two interlaced squares + inner octagon.
export function star8(ctx, cx, cy, r, inner = true) {
  ctx.beginPath();
  for (const rot of [0, Math.PI / 4]) {
    for (let i = 0; i < 4; i++) {
      const a = rot + Math.PI / 4 + (i * Math.PI) / 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }
  ctx.stroke();
  if (inner) {
    ctx.beginPath();
    const ri = r * 0.54;
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      const x = cx + Math.cos(a) * ri, y = cy + Math.sin(a) * ri;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

// Lid artwork. Drawn twice: once in colour, once as a white-on-black mask
// that drives metalness/roughness so only the gold foil is metallic.
function drawLid(ctx, S, mode) {
  const bg = mode === 'color' ? '#170b07' : mode === 'metal' ? '#000' : '#9e9e9e';
  const fg = mode === 'color' ? GOLD : mode === 'metal' ? '#fff' : '#404040';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  if (mode === 'color') {
    // Faint leather grain.
    const r = rng(3);
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? '60,30,18' : '0,0,0'},${0.05 + r() * 0.08})`;
      ctx.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
  }
  ctx.strokeStyle = fg;
  ctx.fillStyle = fg;
  ctx.lineJoin = 'miter';
  const k = S / 1024;
  // Double frame.
  ctx.lineWidth = 3 * k;
  ctx.strokeRect(40 * k, 40 * k, S - 80 * k, S - 80 * k);
  ctx.lineWidth = 1.5 * k;
  ctx.strokeRect(58 * k, 58 * k, S - 116 * k, S - 116 * k);
  // Star band along the frame.
  ctx.lineWidth = 1.6 * k;
  const step = 64 * k;
  for (let p = 49 * k + step; p < S - 49 * k - step / 2; p += step) {
    star8(ctx, p, 49 * k, 7 * k, false);
    star8(ctx, p, S - 49 * k, 7 * k, false);
    star8(ctx, 49 * k, p, 7 * k, false);
    star8(ctx, S - 49 * k, p, 7 * k, false);
  }
  for (const [x, y] of [[49, 49], [975, 49], [49, 975], [975, 975]]) {
    ctx.lineWidth = 2.5 * k;
    star8(ctx, x * k, y * k, 20 * k);
  }
  // Central medallion.
  const cy = 400 * k;
  ctx.lineWidth = 3 * k;
  star8(ctx, S / 2, cy, 150 * k);
  ctx.lineWidth = 1.5 * k;
  star8(ctx, S / 2, cy, 118 * k, false);
  ctx.beginPath();
  ctx.arc(S / 2, cy, 172 * k, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(S / 2, cy, 26 * k, 0, Math.PI * 2);
  ctx.fill();
  // Wordmark.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${118 * k}px Cinzel`;
  ctx.letterSpacing = `${22 * k}px`;
  ctx.fillText('EBCORE', S / 2 + 11 * k, 680 * k);
  ctx.lineWidth = 2 * k;
  ctx.beginPath();
  ctx.moveTo(330 * k, 765 * k);
  ctx.lineTo(694 * k, 765 * k);
  ctx.stroke();
  ctx.font = `500 ${30 * k}px Cinzel`;
  ctx.letterSpacing = `${16 * k}px`;
  ctx.fillText('CHOCOLAT', S / 2 + 8 * k, 815 * k);
}

export function lidTextures(S = 1024) {
  const out = {};
  for (const mode of ['color', 'metal', 'rough']) {
    const c = canvas(S);
    drawLid(c.getContext('2d'), S, mode);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    if (mode === 'color') t.colorSpace = THREE.SRGBColorSpace;
    out[mode] = t;
  }
  return out;
}

// Height map of an embossed khatam star for the hero praline's top face.
export function starBumpMap(S = 512) {
  const c = canvas(S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#fff';
  ctx.filter = `blur(${S * 0.004}px)`;
  ctx.lineWidth = S * 0.022;
  star8(ctx, S / 2, S / 2, S * 0.34);
  ctx.lineWidth = S * 0.01;
  star8(ctx, S / 2, S / 2, S * 0.24, false);
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.045, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return t;
}

// Irregular torn silhouette for gold-leaf flakes.
export function leafAlphaMap(S = 256) {
  const c = canvas(S);
  const ctx = c.getContext('2d');
  const r = rng(11);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rad = S * (0.28 + r() * 0.17);
    const x = S / 2 + Math.cos(a) * rad, y = S / 2 + Math.sin(a) * rad;
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  return t;
}

export { GOLD, GOLD_HI };
