import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp, lerp, range, smooth, pulse, spline, easeInOutCubic, easeOutCubic, easeInOutSine, easeOutBack } from './util.js';
import { loadFonts, clampShader, gradeShader } from './film.js';
import { drawTitle, drawCaption } from './title.js';

// ASSEL — 20 s. Built from the client's box photograph and one photograph per
// flavour theme (ad/themes/themes.json). Everything is 2.5D compositing of those
// photos: the lid is re-projected with a homography, each chocolate is a cut-out
// lifted out of a slot rebuilt underneath it, and each theme photo appears behind
// its chocolate. Every animation is a pure function of time.

export const DURATION = 20;
const SEG0 = 6, SEG = 3; // four chocolate segments: 6-9, 9-12, 12-15, 15-18
const TRAY = [0.52, 0.6, 0.64]; // camera framing over the open tray (cx, cy, vis)

const quadVS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';

// Plate (mode 0) and lid (mode 1) share one shader so lighting matches exactly.
const boxFS = /* glsl */ `
uniform sampler2D tMap, tDepth, tGold, tLidMask;
uniform float uFeather, uMode, uOpacity, uExposure, uAmbient, uLightAmt, uGlow, uDofBias, uFocusR, uSweep, uSweepAmt, uGlint, uTime, uLidShade;
uniform vec2 uPar, uFocus; uniform vec3 uLight; uniform mat3 uH;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);
  vec2 q; float a = 1.0;
  if (uMode < 0.5) {
    float d = texture2D(tDepth, p).r;
    q = p - uPar * (d - 0.4);
    q = p - uPar * (texture2D(tDepth, q).r - 0.4);
  } else {
    vec2 pp = p - uPar * (0.28 - 0.4);
    vec3 h = uH * vec3(pp, 1.0);
    q = h.xy / h.z;
    a = texture2D(tLidMask, q).r;
    if (a < 0.002) discard;
  }
  float f = smoothstep(uFocusR, uFocusR * 2.6, length(q - uFocus));
  vec3 col = texture2D(tMap, q, f * uDofBias).rgb;
  vec2 ql = q - uLight.xy;
  float light = uAmbient + uLightAmt * exp(-dot(ql, ql) / (uLight.z * uLight.z));
  col *= light * uExposure * (uMode > 0.5 ? uLidShade : 1.0);
  // Warm light escaping from inside the box while it is ajar.
  vec2 qg = (q - vec2(0.56, 0.62)) * vec2(1.0, 1.6);
  col *= 1.0 + vec3(1.0, 0.62, 0.25) * 2.5 * uGlow * exp(-dot(qg, qg) * 14.0) * (uMode > 0.5 ? 0.3 : 1.0);
  float g = texture2D(tGold, q).r * (1.0 - f);
  if (uMode < 0.5) g *= 1.0 - texture2D(tLidMask, q).r;
  float sweep = exp(-pow((q.x * 0.8 + q.y * 0.6 - uSweep) * 9.0, 2.0));
  float tw = pow(hash(floor(q * 900.0) + floor(uTime * 12.0)), 24.0);
  col += g * (sweep * uSweepAmt * 2.4 + tw * uGlint * 5.0 + 0.1 * uGlint) * vec3(1.0, 0.74, 0.38) * light;
  float e = uFeather;
  if (e > 0.0) a *= smoothstep(0.0, e, p.x) * smoothstep(0.0, e, 1.0 - p.x) * smoothstep(0.0, e, p.y) * smoothstep(0.0, e, 1.0 - p.y);
  gl_FragColor = vec4(col, a * uOpacity);
}`;

// Chocolate cut-out: depth-of-field (mip bias), theme light and a glaze sweep.
const chocFS = /* glsl */ `
uniform sampler2D tMap; uniform float uOpacity, uBlur, uExposure, uSweep, uRim, uAmbient;
uniform vec3 uTint, uRimColor;
varying vec2 vUv;
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 c = texture2D(tMap, uv, uBlur);
  vec3 col = c.rgb * uExposure * uAmbient * uTint;
  float top = smoothstep(0.55, 0.0, uv.y);
  col += uRimColor * top * uRim * 0.45 * smoothstep(0.05, 0.25, dot(c.rgb, vec3(0.33)));
  float sw = exp(-pow((uv.x + uv.y * 0.5) - uSweep, 2.0) * 50.0);
  col += vec3(1.0, 0.86, 0.66) * sw * 0.45 * smoothstep(0.06, 0.3, dot(c.rgb, vec3(0.33)));
  gl_FragColor = vec4(col, c.a * uOpacity);
}`;

// Theme photograph, uniformly scaled (never distorted), with volumetric rays.
const themeFS = /* glsl */ `
uniform sampler2D tMap; uniform float uOpacity, uExposure, uRayAmt, uTime, uAspect;
uniform vec2 uRay; uniform vec3 uLightColor;
varying vec2 vUv;
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 col = texture2D(tMap, uv).rgb * uExposure;
  vec2 d = (uv - uRay) * vec2(uAspect, 1.0);
  float r = length(d), ang = atan(d.y, d.x);
  float n = 0.5 + 0.5 * sin(ang * 23.0 + uTime * 0.35) * sin(ang * 37.0 - uTime * 0.25 + 1.3);
  float rays = pow(n, 3.0) * exp(-r * 2.0) + 0.6 * exp(-r * r * 30.0);
  float lum = dot(col, vec3(0.3, 0.55, 0.15));
  col += uLightColor * rays * uRayAmt * (0.35 + lum);
  gl_FragColor = vec4(col, uOpacity);
}`;

const shadowFS = 'uniform float uAmt; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, uAmt * (1.0 - smoothstep(0.25, 1.0, d))); }';

// Theme particles: spray, pollen, snow, sand (and gold dust on the box).
const partVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSize, uProj, uTwinkle, uSpread;
uniform vec3 uWind, uExtent;
varying float vA; varying float vS;
void main(){
  vec3 p = aSeed.xyz + uWind * uTime * (0.5 + aSeed.w);
  p += uSpread * vec3(sin(uTime * 0.9 + aSeed.w * 40.0), sin(uTime * 0.6 + aSeed.x * 30.0), cos(uTime * 0.7 + aSeed.y * 20.0));
  p = fract(p) - 0.5;
  vec4 mv = viewMatrix * vec4(p * uExtent, 1.0);
  float depth = max(-mv.z, 0.1);
  float coc = abs(depth - 6.0) * 0.35;
  gl_PointSize = clamp(uSize * (0.35 + aSeed.w) * uProj / depth * (1.0 + coc * 2.0), 1.0, 120.0);
  vA = (1.0 - uTwinkle + uTwinkle * (0.5 + 0.5 * sin(uTime * (5.0 + aSeed.x * 8.0) + aSeed.y * 60.0))) / (1.0 + coc * coc * 5.0);
  vS = step(0.8, aSeed.w);
  gl_Position = projectionMatrix * mv;
}`;
const partFS = /* glsl */ `
uniform vec3 uColorA, uColorB; uniform float uAmt;
varying float vA; varying float vS;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.6) * vA * uAmt;
  gl_FragColor = vec4(mix(uColorA, uColorB, vS) * a, 1.0);
}`;
const PARTICLES = {
  gold: { a: [0.62, 0.34, 0.16], b: [2.2, 1.6, 0.7], wind: [0.006, 0.012, 0.002], size: 0.018, tw: 0.5, spread: 0.025, amt: 0.25 },
  spray: { a: [0.7, 0.9, 1.1], b: [1.8, 2.0, 2.2], wind: [0.035, 0.012, 0.0], size: 0.014, tw: 0.8, spread: 0.03, amt: 0.45 },
  pollen: { a: [1.1, 0.95, 0.4], b: [2.2, 1.9, 0.8], wind: [0.008, 0.01, 0.0], size: 0.016, tw: 0.4, spread: 0.04, amt: 0.5 },
  snow: { a: [1.1, 1.15, 1.25], b: [1.6, 1.7, 1.9], wind: [0.01, -0.07, 0.0], size: 0.03, tw: 0.0, spread: 0.02, amt: 0.6 },
  sand: { a: [1.2, 0.65, 0.3], b: [2.4, 1.5, 0.7], wind: [0.09, 0.006, 0.0], size: 0.013, tw: 0.3, spread: 0.015, amt: 0.55 },
};

// 4-point homography (src quad -> dst quad), row-major 3x3.
function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const k = A[r][c] / A[c][c];
      for (let j = c; j < 8; j++) A[r][j] -= k * A[c][j];
      b[r] -= k * b[c];
    }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function loadTexture(loader, url, srgb = true) {
  return new Promise((res, rej) => loader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false;
    t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    res(t);
  }, undefined, rej));
}

const hexColor = (h) => new THREE.Color(h);

export async function createFilm({ width, height, pixelRatio = 1, fontBase = '', assetBase = 'assets/', themeBase = 'themes/' }) {
  await loadFonts(fontBase);
  const loader = new THREE.TextureLoader();
  const T = (url, srgb) => loadTexture(loader, url, srgb);
  const [cfg, chocMeta] = await Promise.all([
    fetch(`${themeBase}themes.json`).then((r) => r.json()),
    fetch(`${assetBase}assel/chocolates.json`).then((r) => r.json()),
  ]);
  const themes = cfg.themes;
  const [plate, box, lidMask, depth, gold] = await Promise.all([
    T(`${assetBase}assel/plate.jpg`), T(`${assetBase}box.jpg`), T(`${assetBase}assel/lid-mask.png`, false),
    T(`${assetBase}box-depth.png`, false), T(`${assetBase}box-gold.png`, false),
  ]);
  const chocIds = Object.keys(chocMeta).filter((k) => k !== 'lid');
  const chocTex = Object.fromEntries(await Promise.all(chocIds.map(async (id) => [id, await T(`${assetBase}assel/choc-${id}.png`)])));
  const themeTex = await Promise.all(themes.map((th) => T(themeBase + th.image)));

  const glCanvas = document.createElement('canvas');
  const out = document.createElement('canvas');
  const ctx2d = out.getContext('2d');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const ASP = box.image.width / box.image.height;
  const uvToWorld = (u, v) => [(u - 0.5) * ASP, 0.5 - v];

  const boxUniforms = (map, mode) => ({
    tMap: { value: map }, tDepth: { value: depth }, tGold: { value: gold }, tLidMask: { value: lidMask },
    uMode: { value: mode }, uFeather: { value: 0 }, uOpacity: { value: 1 }, uExposure: { value: 1 }, uAmbient: { value: 1 }, uLightAmt: { value: 0 },
    uGlow: { value: 0 }, uDofBias: { value: 0 }, uFocusR: { value: 0.2 }, uSweep: { value: -1 }, uSweepAmt: { value: 0 },
    uGlint: { value: 0 }, uTime: { value: 0 }, uLidShade: { value: 1 }, uPar: { value: new THREE.Vector2() },
    uFocus: { value: new THREE.Vector2(0.5, 0.5) }, uLight: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uH: { value: new THREE.Matrix3() },
  });
  const mk = (geo, fs, uniforms, order) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: quadVS, fragmentShader: fs, uniforms, transparent: true, depthTest: false, depthWrite: false }));
    m.renderOrder = order;
    return m;
  };
  const plateL = mk(new THREE.PlaneGeometry(ASP, 1), boxFS, boxUniforms(plate, 0), 1);
  const lidL = mk(new THREE.PlaneGeometry(ASP, 1), boxFS, boxUniforms(box, 1), 2);
  scene.add(plateL, lidL);
  // Blurred, very dark copy of the photo filling the frame around the box.
  const fillL = mk(new THREE.PlaneGeometry(ASP, 1), boxFS, boxUniforms(plate, 0), 0);
  plateL.material.uniforms.uFeather.value = 0.05;
  scene.add(fillL);

  const chocs = {};
  for (const id of chocIds) {
    const r = chocMeta[id];
    const w = (r.x1 - r.x0) * ASP, h = r.y1 - r.y0;
    const mesh = mk(new THREE.PlaneGeometry(1, 1), chocFS, {
      tMap: { value: chocTex[id] }, uOpacity: { value: 1 }, uBlur: { value: 0 }, uExposure: { value: 1 }, uSweep: { value: -2 },
      uRim: { value: 0 }, uAmbient: { value: 1 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uRimColor: { value: new THREE.Color(1, 0.8, 0.5) },
    }, 4);
    const sh = mk(new THREE.CircleGeometry(0.5, 40), shadowFS, { uAmt: { value: 0 } }, 3);
    const [x, y] = uvToWorld((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    chocs[id] = { mesh, sh, w, h, home: new THREE.Vector2(x, y) };
    scene.add(mesh, sh);
  }

  const themeL = themes.map((th, i) => {
    const img = themeTex[i].image;
    const m = mk(new THREE.PlaneGeometry(1, 1), themeFS, {
      tMap: { value: themeTex[i] }, uOpacity: { value: 0 }, uExposure: { value: 1 }, uRayAmt: { value: 0 }, uTime: { value: 0 },
      uAspect: { value: img.width / img.height }, uRay: { value: new THREE.Vector2(...(th.rays || [0.5, 0.2])) },
      uLightColor: { value: hexColor(th.light || '#ffd9a0') },
    }, 5);
    m.userData.aspect = img.width / img.height;
    scene.add(m);
    return m;
  });

  // Particles.
  const pScene = new THREE.Scene();
  const pCam = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  pCam.position.set(0, 0, 6);
  const pGeo = new THREE.BufferGeometry();
  {
    let seed = 11;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = 1500;
    pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    pGeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n * 4).map(() => r()), 4));
  }
  const pMat = new THREE.ShaderMaterial({
    vertexShader: partVS, fragmentShader: partFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uSize: { value: 0.02 }, uProj: { value: 1000 }, uTwinkle: { value: 0.5 }, uSpread: { value: 0.02 },
      uWind: { value: new THREE.Vector3() }, uExtent: { value: new THREE.Vector3(7, 10, 6) },
      uColorA: { value: new THREE.Color() }, uColorB: { value: new THREE.Color() }, uAmt: { value: 0.3 },
    },
  });
  const points = new THREE.Points(pGeo, pMat);
  points.frustumCulled = false;
  pScene.add(points);

  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, cam));
  const pPass = new RenderPass(pScene, pCam);
  pPass.clear = false;
  composer.addPass(pPass);
  composer.addPass(new ShaderPass(clampShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.5, 0.86);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(gradeShader);
  composer.addPass(grade);

  let W = 0, H = 0;
  function resize(w, h, pr = pixelRatio) {
    W = Math.round(w * pr);
    H = Math.round(h * pr);
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(1);
    composer.setSize(W, H);
    out.width = W;
    out.height = H;
    grade.uniforms.uRes.value.set(W, H);
    pCam.aspect = W / H;
    pCam.updateProjectionMatrix();
  }
  resize(width, height);

  // Camera over the box photo: image point (cx, cy) centred, `vis` = visible
  // fraction of the image along the frame's narrow side.
  let FH = 1;
  function frame(cx, cy, vis) {
    const A = W / H;
    FH = A < 1 ? (vis * ASP) / A : vis;
    cam.left = (-A * FH) / 2;
    cam.right = (A * FH) / 2;
    cam.top = FH / 2;
    cam.bottom = -FH / 2;
    const [x, y] = uvToWorld(cx, cy);
    cam.position.set(x, y, 5);
    cam.updateProjectionMatrix();
  }
  // Frame-relative coordinates (frame heights from centre) <-> world.
  const toWorld = (sx, sy) => new THREE.Vector2(cam.position.x + sx * FH, cam.position.y + sy * FH);

  function particles(kind, amtScale = 1) {
    const p = PARTICLES[kind] || PARTICLES.gold;
    const u = pMat.uniforms;
    u.uColorA.value.setRGB(...p.a);
    u.uColorB.value.setRGB(...p.b);
    u.uWind.value.set(...p.wind);
    u.uSize.value = p.size;
    u.uTwinkle.value = p.tw;
    u.uSpread.value = p.spread;
    u.uAmt.value = p.amt * amtScale;
    u.uProj.value = H / (2 * Math.tan((pCam.fov * Math.PI) / 360));
  }

  // Lid inner panel as it swings open: alpha = 0 fully open, >0 tilted forward.
  const LID0 = chocMeta.lid; // TL, TR, hinge-R, hinge-L (uv)
  function lidQuad(alpha) {
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const hinge = { 0: LID0[3], 1: LID0[2] };
    const tops = [0, 1].map((i) => {
      const [hx, hy] = hinge[i];
      const vx = LID0[i][0] - hx, vy = LID0[i][1] - hy;
      const len = Math.hypot(vx, vy);
      return [hx + vx * ca, hy + vy * ca + 0.85 * len * sa];
    });
    const cx = (tops[0][0] + tops[1][0]) / 2, cy = (tops[0][1] + tops[1][1]) / 2;
    const k = 1 + 0.1 * sa;
    const wide = tops.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
    return [wide[0], wide[1], LID0[2], LID0[3]];
  }

  let caption = null, titleT = -1;

  function setBox(o) {
    for (const L of [plateL, lidL]) {
      const u = L.material.uniforms;
      u.uTime.value = o.t;
      u.uExposure.value = o.exposure ?? 1;
      u.uAmbient.value = o.ambient ?? 1;
      u.uLightAmt.value = o.lightAmt ?? 0;
      u.uLight.value.set(...(o.light || [0.5, 0.5, 0.5]));
      u.uGlow.value = o.glow ?? 0;
      u.uDofBias.value = o.dof ?? 0;
      u.uFocus.value.set(...(o.focus || [0.5, 0.5]));
      u.uFocusR.value = o.focusR ?? 0.2;
      u.uSweep.value = o.sweep ?? -1;
      u.uSweepAmt.value = o.sweepAmt ?? 0;
      u.uGlint.value = o.glint ?? 0.3;
      u.uPar.value.set(...(o.par || [0, 0]));
      u.uOpacity.value = 1;
    }
    const f = fillL.material.uniforms;
    f.uExposure.value = 0.12 * (o.ambient ?? 1);
    f.uDofBias.value = 6;
    f.uFocusR.value = 0.0001;
    fillL.scale.setScalar(FH * 2.2);
    fillL.position.set(cam.position.x, cam.position.y, 0);
  }

  // Chocolate state: lift in [0,1] (in the slot -> floating), float pose in frame space.
  function setChoc(id, o) {
    const c = chocs[id];
    const u = c.mesh.material.uniforms;
    const par = o.par || [0, 0];
    // Same parallax as the photo underneath (chocolates sit at depth ~0.85).
    const home = new THREE.Vector2(c.home.x + par[0] * 0.45 * ASP, c.home.y - par[1] * 0.45);
    const lift = o.lift ?? 0;
    const up = easeInOutSine(clamp(lift / 0.35)) * 0.11; // vertical rise out of the slot
    let pos = new THREE.Vector2(home.x, home.y + up);
    let w = c.w * (1 + 0.25 * clamp(lift / 0.35));
    let rot = 0;
    if (o.float > 0) {
      const target = toWorld(o.floatAt[0], o.floatAt[1]);
      const tw = o.floatW * FH;
      const e = easeInOutCubic(o.float);
      pos = pos.lerp(target, e);
      w = Math.exp(lerp(Math.log(w), Math.log(tw), e));
      rot = o.rot * e;
    }
    c.mesh.scale.set(w, (w * c.h) / c.w, 1);
    c.mesh.position.set(pos.x, pos.y, 0);
    c.mesh.rotation.z = rot;
    c.mesh.renderOrder = o.hero ? 7 : 4;
    u.uBlur.value = o.blur ?? 0;
    u.uExposure.value = o.exposure ?? 1;
    u.uAmbient.value = o.ambient ?? 1;
    u.uTint.value.set(...(o.tint || [1, 1, 1]));
    u.uRim.value = o.rim ?? 0;
    if (o.rimColor) u.uRimColor.value.copy(o.rimColor);
    u.uSweep.value = o.sweep ?? -2;
    u.uOpacity.value = o.opacity ?? 1;
    // Contact shadow in the slot fades as the chocolate leaves it.
    c.sh.position.set(home.x, home.y - c.h * 0.08, 0);
    c.sh.scale.set(c.w * 0.95, c.h * 0.8, 1);
    c.sh.material.uniforms.uAmt.value = 0.5 * clamp(lift / 0.2) * (1 - clamp((lift - 0.15) / 0.3)) * (o.opacity ?? 1);
  }

  function update(t) {
    caption = null;
    titleT = -1;
    for (const m of themeL) { m.visible = false; m.material.uniforms.uOpacity.value = 0; }
    pMat.uniforms.uTime.value = t;
    grade.uniforms.uTime.value = t;
    grade.uniforms.uFade.value = 1;
    grade.uniforms.uVignette.value = 0.5;
    grade.uniforms.uAberr.value = 0.004;
    let flash = 0.55 * pulse(t, 18.0, 0.04, 0.45) + 0.18 * pulse(t, 4.9, 0.05, 0.3);
    bloom.strength = 0.45;
    lidL.material.uniforms.uLidShade.value = 1;
    const portrait = W < H;

    // Lid: ajar until 4.0, swings open 4.0-5.3 with a soft settle.
    const ALPHA0 = 0.5;
    const open = t < 4.0 ? 0 : easeOutBack(easeInOutCubic(range(t, 4.0, 5.3)), 0.5);
    const alpha = ALPHA0 * (1 - open);
    const Hm = homography(lidQuad(alpha), LID0);
    lidL.material.uniforms.uH.value.set(...Hm);
    lidL.material.uniforms.uLidShade.value = 1 - 0.35 * Math.sin(alpha);
    lidL.visible = true;

    // Default: every chocolate at home.
    const chocState = Object.fromEntries(chocIds.map((id) => [id, { lift: 0 }]));

    if (t < 6.0) {
      // 0-4 reveal, 4-6 opening and the camera passing over the tray.
      grade.uniforms.uFade.value = smooth(0.0, 0.7, t);
      const v = spline([[0, 0.5, 0.46, 1.16], [4.0, 0.5, 0.47, 0.96], [5.0, 0.51, 0.52, 0.82], [6.0, ...TRAY]], t);
      frame(v[0], v[1], v[2]);
      const orbit = 0.032 * Math.sin(lerp(-1.2, 1.2, range(t, 0, 5)));
      const over = easeInOutCubic(range(t, 4.3, 6.0));
      const par = [orbit, -0.012 + 0.03 * over];
      const lp = spline([[0, 0.3, 0.38], [2.0, 0.45, 0.5], [4.0, 0.52, 0.55], [6, 0.52, 0.6]], t);
      const light = smooth(0.1, 1.6, t);
      const boxState = {
        t, par, light: [lp[0], lp[1], lerp(0.18, 0.6, smooth(0.3, 4.2, t))], lightAmt: 1.3 * light * (1 - 0.85 * smooth(3.6, 4.6, t)),
        ambient: 0.03 + 0.97 * smooth(3.2, 4.6, t), glow: 0.5 * smooth(0.4, 2.2, t) * (1 - smooth(4.2, 5.2, t)),
        sweep: lerp(-0.2, 1.7, range(t, 4.5, 5.6)), sweepAmt: smooth(4.4, 4.6, t) * (1 - smooth(5.5, 5.8, t)) + 0.4 * smooth(1.0, 2.0, t) * (1 - smooth(2.6, 3.2, t)),
        glint: 0.25 + 0.4 * smooth(4.5, 5.2, t), dof: 2.5 * smooth(5.2, 6.0, t), focus: [TRAY[0], TRAY[1]], focusR: 0.32,
      };
      setBox(boxState);
      // Chocolates receive the same light as the photo under them.
      const b = boxState;
      for (const id of chocIds) {
        const r = chocMeta[id];
        const cu = (r.x0 + r.x1) / 2, cv = (r.y0 + r.y1) / 2;
        const dl = ((cu - b.light[0]) ** 2 + (cv - b.light[1]) ** 2) / (b.light[2] ** 2);
        const dg = (cu - 0.56) ** 2 + ((cv - 0.62) * 1.6) ** 2;
        const lit = (b.ambient + b.lightAmt * Math.exp(-dl)) * (1 + 1.1 * b.glow * Math.exp(-dg * 14));
        chocState[id] = { lift: 0, par, ambient: lit };
      }
      particles('gold', 0.6 + 0.6 * smooth(2, 5, t));
      bloom.strength = 0.4 + 0.2 * smooth(4.5, 5.2, t);
    } else if (t < SEG0 + SEG * themes.length) {
      // One segment per chocolate: lift, reveal its world, float, return.
      const i = Math.floor((t - SEG0) / SEG);
      const k = (t - SEG0 - i * SEG) / SEG;
      const th = themes[i];
      const id = th.chocolate;
      const r = chocMeta[id];
      const slot = [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2];
      const last = i === themes.length - 1;
      // Camera: over the tray -> push onto the slot (following the rise) -> back.
      const v = spline([[0, ...TRAY], [0.32, slot[0], slot[1] - 0.06, 0.42], [0.86, slot[0], slot[1] - 0.06, 0.4], [1, ...TRAY]], k);
      frame(v[0], v[1], v[2]);
      const par = [0.02 * Math.sin(k * 3 + i), 0.018];
      setBox({
        t, par, ambient: 1, glint: 0.4, dof: 2.8 * smooth(0.05, 0.3, k) * (1 - smooth(0.88, 1, k)) + 1.2, focus: slot, focusR: 0.07,
        sweep: lerp(-0.2, 1.6, range(k, 0.0, 0.35)), sweepAmt: 0.5,
      });
      // Lift (0-0.35), theme fades in (0.22-0.45), float (0.35-0.86), return (0.86-1).
      const lift = clamp(k / 0.35) * (k < 0.86 ? 1 : 1 - easeInOutCubic(range(k, 0.86, 1.0)));
      const fl = smooth(0.24, 0.5, k) * (1 - easeInOutCubic(range(k, 0.84, 0.98)));
      const themeA = smooth(0.22, 0.42, k) * (1 - smooth(0.84, 0.97, k));
      const light = hexColor(th.light || '#ffd9a0');
      const L = themeL[i];
      L.visible = themeA > 0;
      const tu = L.material.uniforms;
      tu.uOpacity.value = themeA;
      tu.uTime.value = t;
      tu.uExposure.value = 1.0;
      tu.uRayAmt.value = (last ? 1.0 : 0.7) * smooth(0.3, 0.6, k);
      // Cover the frame with the theme photo, slow push toward its focus point.
      {
        const A = W / H, fa = L.userData.aspect;
        const push = lerp(1.0, last ? 1.12 : 1.07, easeInOutSine(range(k, 0.22, 0.97)));
        const hgt = Math.max(FH, (A * FH) / fa) * push;
        L.scale.set(hgt * fa, hgt, 1);
        const fx = (th.focus || [0.5, 0.5])[0], fy = (th.focus || [0.5, 0.5])[1];
        // Keep the focus point as close to centre as the cover crop allows.
        const maxX = (hgt * fa - A * FH) / 2, maxY = (hgt - FH) / 2;
        const ox = clamp((0.5 - fx) * hgt * fa, -maxX, maxX), oy = clamp((fy - 0.5) * hgt, -maxY, maxY);
        L.position.set(cam.position.x + ox, cam.position.y + oy, 0);
      }
      const tint = [lerp(1, light.r * 0.5 + 0.5, fl), lerp(1, light.g * 0.5 + 0.5, fl), lerp(1, light.b * 0.5 + 0.5, fl)];
      const bob = 0.012 * Math.sin(t * 2.1);
      for (const cid of chocIds) {
        if (cid === id) continue;
        chocState[cid] = { lift: 0, par, blur: 2.6 * smooth(0.05, 0.3, k) * (1 - smooth(0.88, 1, k)) + 0.8 };
      }
      chocState[id] = {
        hero: true, lift, par, float: fl, floatAt: [0, (portrait ? 0.03 : 0.0) + bob], floatW: portrait ? (last ? 0.62 : 0.56) * (W / H) : (last ? 0.44 : 0.4),
        rot: 0.06 * Math.sin(t * 0.9 + i), tint, rim: fl * (last ? 1.4 : 1.0), rimColor: light, exposure: 1.0 + 0.04 * fl,
        sweep: lerp(-0.5, 1.6, range(k, 0.42, 0.8)),
      };
      caption = { alpha: smooth(0.45, 0.58, k) * (1 - smooth(0.78, 0.86, k)), title: th.title, sub: th.subtitle };
      flash += (last ? 0.45 : 0.28) * pulse(k, 0.3, 0.04, 0.12) * 1;
      particles(k > 0.25 && k < 0.92 ? th.particles : 'gold', (last ? 1.3 : 1) * (0.5 + 0.5 * fl));
      bloom.strength = 0.45 + 0.15 * fl + (last ? 0.1 : 0);
      grade.uniforms.uVignette.value = 0.5 + 0.1 * fl;
    } else {
      // 18-20: pull back to the whole open box; logo.
      const s = easeOutCubic(range(t, 18.0, 19.4));
      if (portrait) frame(lerp(TRAY[0], 0.5, s), lerp(TRAY[1], 0.25, s), lerp(TRAY[2], 1.08, s));
      else frame(lerp(TRAY[0], 0.5, s), lerp(TRAY[1], 0.64, s), lerp(TRAY[2], 1.5, s));
      setBox({ t, par: [0, 0.018 * (1 - s)], ambient: 1, light: [0.5, 0.45, 0.6], lightAmt: 0.2, glint: 0.6, sweep: lerp(-0.2, 1.7, range(t, 18.2, 19.4)), sweepAmt: 0.9 });
      for (const id of chocIds) chocState[id] = { lift: 0, par: [0, 0.018 * (1 - s)] };
      particles('gold', 0.9);
      titleT = t - 18.0;
      bloom.strength = 0.5;
    }
    grade.uniforms.uFlash.value = flash;
    for (const id of chocIds) setChoc(id, chocState[id]);
  }

  function renderAt(t) {
    t = clamp(t, 0, DURATION - 1e-4);
    update(t);
    composer.render();
    ctx2d.drawImage(glCanvas, 0, 0);
    if (caption) drawCaption(ctx2d, W, H, caption.alpha, caption.title, caption.sub);
    if (titleT > 0) drawTitle(ctx2d, W, H, titleT, { portrait: 0.25, landscape: 0.86, brand: cfg.brand, tagline: cfg.slogan });
    return out;
  }

  return { canvas: out, renderAt, resize, scene, brand: cfg.brand, get size() { return [W, H]; } };
}
