import { lerp, range, smooth, easeOutCubic } from './util.js';

// End card typography, drawn over the final rendered frame.
// t is seconds since the packshot cut (9.0s); the card is legible by ~0.6s.
let off = null;

export function drawTitle(ctx, W, H, t) {
  if (t <= 0) return;
  const portrait = H > W;
  const base = Math.min(W, H);
  const cx = W / 2;
  const y1 = portrait ? H * 0.745 : H * 0.79;
  const size1 = base * (portrait ? 0.115 : 0.095);
  const size2 = base * (portrait ? 0.052 : 0.042);
  const y2 = y1 + size1 * 0.95;

  const a1 = smooth(0.08, 0.5, t);
  const track = lerp(0.62, 0.3, easeOutCubic(range(t, 0.05, 0.8)));

  if (!off || off.width !== W || off.height !== H) {
    off = document.createElement('canvas');
    off.width = W;
    off.height = H;
  }
  const o = off.getContext('2d');
  o.clearRect(0, 0, W, H);
  o.globalCompositeOperation = 'source-over';
  o.font = `600 ${size1}px Cinzel`;
  o.letterSpacing = `${track * size1}px`;
  o.textAlign = 'center';
  o.textBaseline = 'alphabetic';
  const g = o.createLinearGradient(0, y1 - size1 * 0.8, 0, y1 + size1 * 0.1);
  g.addColorStop(0, '#fbe6ae');
  g.addColorStop(0.45, '#e2b25c');
  g.addColorStop(0.55, '#b8812f');
  g.addColorStop(1, '#f0cf86');
  o.fillStyle = g;
  // letterSpacing also pads after the last glyph; re-centre.
  o.fillText('EBCORE', cx + (track * size1) / 2, y1);
  // Specular sweep across the letters.
  const sx = lerp(-0.3, 1.3, easeOutCubic(range(t, 0.35, 0.98))) * W;
  const band = o.createLinearGradient(sx - size1 * 1.4, 0, sx + size1 * 1.4, size1 * 0.6);
  band.addColorStop(0, 'rgba(255,240,205,0)');
  band.addColorStop(0.5, 'rgba(255,246,222,0.95)');
  band.addColorStop(1, 'rgba(255,240,205,0)');
  o.globalCompositeOperation = 'source-atop';
  o.fillStyle = band;
  o.fillRect(0, y1 - size1, W, size1 * 1.3);

  ctx.save();
  // Soft golden glow, then the crisp wordmark.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.45 * a1;
  ctx.filter = `blur(${size1 * 0.22}px)`;
  ctx.drawImage(off, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a1;
  ctx.filter = a1 < 1 ? `blur(${(1 - a1) * size1 * 0.09}px)` : 'none';
  ctx.drawImage(off, 0, 0);
  ctx.filter = 'none';

  // Hairline rules.
  const rw = smooth(0.3, 0.85, t) * size1 * 1.6;
  ctx.globalAlpha = 0.85 * smooth(0.3, 0.6, t);
  ctx.strokeStyle = '#d9a952';
  ctx.lineWidth = Math.max(1, base * 0.0016);
  const ry = y1 + size1 * 0.3;
  ctx.beginPath();
  ctx.moveTo(cx - size1 * 0.22 - rw, ry);
  ctx.lineTo(cx - size1 * 0.22, ry);
  ctx.moveTo(cx + size1 * 0.22, ry);
  ctx.lineTo(cx + size1 * 0.22 + rw, ry);
  ctx.stroke();
  // Small diamond between the rules.
  const d = size1 * 0.06;
  ctx.fillStyle = '#e8bf6a';
  ctx.beginPath();
  ctx.moveTo(cx, ry - d);
  ctx.lineTo(cx + d, ry);
  ctx.lineTo(cx, ry + d);
  ctx.lineTo(cx - d, ry);
  ctx.closePath();
  ctx.fill();

  // Tagline.
  const a2 = smooth(0.32, 0.72, t);
  ctx.globalAlpha = a2;
  ctx.font = `italic 500 ${size2}px "Cormorant Garamond"`;
  ctx.letterSpacing = `${size2 * 0.04}px`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#efd7a4';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = size2 * 0.4;
  ctx.fillText('L’Algérie, dans chaque bouchée.', cx, y2 + (1 - a2) * size2 * 0.35);
  ctx.restore();
}
