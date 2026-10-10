// Shared math helpers. Every animation in the film is a pure function of time,
// so the same frame is produced in the live player and in the MP4 export.

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const range = (t, a, b) => clamp((t - a) / (b - a));
export const smooth = (a, b, x) => {
  const t = range(x, a, b);
  return t * t * (3 - 2 * t);
};
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const easeOutBack = (t, s = 1.0) => {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

// Attack/release pulse centred on c.
export const pulse = (t, c, rise, fall) => (t < c ? smooth(c - rise, c, t) : 1 - smooth(c, c + fall, t));

// Deterministic PRNG (mulberry32).
export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// C1-continuous keyframe spline over time. keys: [[time, x, y, z], ...]
export function spline(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0].slice(1);
  if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const dt = k1[0] - k0[0];
  const u = (t - k0[0]) / dt;
  const tangent = (j) => {
    // Ends ease in/out (zero velocity); interior uses non-uniform Catmull-Rom.
    if (j === 0 || j === n - 1) return k0.slice(1).map(() => 0);
    const a = keys[j - 1], b = keys[j + 1];
    return a.slice(1).map((v, c) => (b[c + 1] - v) / (b[0] - a[0]));
  };
  const m0 = tangent(i), m1 = tangent(i + 1);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  return k0.slice(1).map((p0, c) => h00 * p0 + h10 * dt * m0[c] + h01 * k1[c + 1] + h11 * dt * m1[c]);
}

// Periodic 2D value noise + fbm, used to bake normal maps.
export function makeNoise2D(period, seed) {
  const r = rng(seed);
  const grid = new Float32Array(period * period).map(() => r());
  const at = (x, y) => grid[((y % period + period) % period) * period + ((x % period + period) % period)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const a = lerp(at(xi, yi), at(xi + 1, yi), sx);
    const b = lerp(at(xi, yi + 1), at(xi + 1, yi + 1), sx);
    return lerp(a, b, sy);
  };
}

// Smooth 3D value noise for procedural geometry displacement.
export function noise3(x, y, z) {
  const h = (i, j, k) => {
    const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (v) => v * v * (3 - 2 * v);
  const u = f(x - xi), v = f(y - yi), w = f(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
