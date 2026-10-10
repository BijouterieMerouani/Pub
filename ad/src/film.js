import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  clamp, lerp, range, smooth, pulse, rng, spline, noise3,
  easeInOutCubic, easeOutCubic, easeInCubic, easeInOutSine, easeOutExpo, easeOutBack,
} from './util.js';
import { noiseNormalMap, lidTextures, starBumpMap, leafAlphaMap } from './textures.js';
import { drawTitle } from './title.js';

export const DURATION = 10;
const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// Each scene lives in its own region of world space and only one is visible at a time.
const OA = V(0, 0, 0); // the box (shots 1, 2, 5)
const OB = V(100, 0, 0); // macro hero bonbon (shot 3)
const OC = V(200, 0, 0); // Algerian signature (shot 4)

let fontsReady = null;
export function loadFonts(base = '') {
  if (!fontsReady) {
    const faces = [
      new FontFace('Cinzel', `url(${base}fonts/Cinzel.ttf)`, { weight: '400 900' }),
      new FontFace('Cormorant Garamond', `url(${base}fonts/CormorantGaramond-Italic.ttf)`, { style: 'italic', weight: '300 700' }),
    ];
    fontsReady = Promise.all(faces.map((f) => f.load().then((ff) => document.fonts.add(ff))));
  }
  return fontsReady;
}

// ---------------------------------------------------------------------------
// Environment: a dark studio with warm softboxes, prefiltered for reflections.
function buildEnvironment(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: 0x030201, side: THREE.BackSide })));
  const panel = (w, h, hex, k, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(22, 7, 0xffd8a0, 2.6, [0, 20, 5]);
  panel(4, 26, 0xffb35c, 2.4, [-17, 4, 6]);
  panel(3, 26, 0xffc98a, 1.6, [16, 3, -5]);
  panel(40, 2, 0xff9a3c, 0.7, [0, -1, -20]);
  panel(8, 3, 0xfff0d8, 3.5, [6, 12, 14]);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.015).texture;
  pm.dispose();
  return tex;
}

// ---------------------------------------------------------------------------
// Materials.
function buildMaterials() {
  const micro = noiseNormalMap(256, 6, 4, 2.0, 5);
  const powder = noiseNormalMap(256, 16, 5, 9.0, 9);
  const grain = noiseNormalMap(256, 24, 3, 3.0, 13);
  const leafAlpha = leafAlphaMap();
  const m = {};
  m.choc = new THREE.MeshPhysicalMaterial({
    color: 0x220f07, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.11, envMapIntensity: 1.0,
  });
  m.chocMilk = m.choc.clone();
  m.chocMilk.color.set(0x3d1d0e);
  m.chocInner = new THREE.MeshPhysicalMaterial({
    color: 0x3a1a0c, roughness: 0.62, normalMap: powder, normalScale: new THREE.Vector2(0.25, 0.25), side: THREE.DoubleSide,
  });
  m.shard = new THREE.MeshPhysicalMaterial({ color: 0x2e140a, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.1, flatShading: true });
  m.truffle = new THREE.MeshStandardMaterial({ color: 0x3b2215, roughness: 1, normalMap: powder, normalScale: new THREE.Vector2(1.4, 1.4) });
  m.caramel = new THREE.MeshPhysicalMaterial({
    color: 0x5e260a, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.05, emissive: 0x2a0e02, emissiveIntensity: 0.7,
    side: THREE.DoubleSide, sheen: 0.4, sheenColor: new THREE.Color(0xffb060),
  });
  m.liquid = new THREE.MeshPhysicalMaterial({ color: 0x2f150a, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 });
  m.gold = new THREE.MeshStandardMaterial({ color: 0xe0ac52, metalness: 1, roughness: 0.24 });
  m.goldLeaf = new THREE.MeshStandardMaterial({ color: 0xf0c060, metalness: 1, roughness: 0.32, alphaMap: leafAlpha, alphaTest: 0.5, side: THREE.DoubleSide });
  m.foil = new THREE.MeshStandardMaterial({ color: 0x8a6226, metalness: 1, roughness: 0.34, flatShading: true });
  m.lining = new THREE.MeshPhysicalMaterial({ color: 0x24120a, metalness: 0.3, roughness: 0.5, sheen: 0.8, sheenColor: new THREE.Color(0x8a5a2a) });
  m.boxSide = new THREE.MeshPhysicalMaterial({
    color: 0x1a0c07, roughness: 0.48, sheen: 0.6, sheenColor: new THREE.Color(0x5a3018), sheenRoughness: 0.5,
    clearcoat: 0.25, clearcoatRoughness: 0.4, normalMap: grain, normalScale: new THREE.Vector2(0.18, 0.18),
  });
  const lid = lidTextures();
  m.lidTop = new THREE.MeshPhysicalMaterial({
    map: lid.color, metalness: 1, metalnessMap: lid.metal, roughness: 1, roughnessMap: lid.rough,
    clearcoat: 0.2, clearcoatRoughness: 0.5,
  });
  m.floor = new THREE.MeshPhysicalMaterial({ color: 0x050302, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3 });
  m.sand = new THREE.MeshStandardMaterial({ color: 0xc08448, roughness: 0.92, normalMap: grain, normalScale: new THREE.Vector2(0.3, 0.3) });
  m.starDecal = m.choc.clone();
  m.starDecal.bumpMap = starBumpMap();
  m.starDecal.bumpScale = 2.0;
  m.starDecal.normalMap = null;
  m.starDecal.polygonOffset = true;
  m.starDecal.polygonOffsetFactor = -2;
  for (const t of [micro, powder, grain]) t.repeat.set(3, 3);
  return m;
}

// ---------------------------------------------------------------------------
// Chocolate pieces (unit size, scaled by the caller).
function sphereGeo(seg = 72) {
  return new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75));
}

function flattenBottom(geo, y0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < y0) p.setY(i, y0 + (p.getY(i) - y0) * 0.05);
  geo.computeVertexNormals();
  return geo;
}

function goldLeaf(mat, size, curve = 1.2, seed = 1) {
  const g = new THREE.PlaneGeometry(1, 1, 14, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, -curve * (x * x + y * y) * 0.5 + (noise3(x * 5 + seed, y * 5, seed) - 0.5) * 0.07);
  }
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, mat);
  mesh.scale.setScalar(size);
  return mesh;
}

function bonbonDome(m) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(flattenBottom(sphereGeo(), -0.5), m.choc);
  body.position.y = 0.5;
  body.castShadow = true;
  const leaf = goldLeaf(m.goldLeaf, 0.6, 1.6, 2);
  leaf.rotation.x = -Math.PI / 2;
  leaf.rotation.z = 0.6;
  leaf.position.y = 1.505;
  g.add(body, leaf);
  return g; // ~2 units wide, 1.5 high
}

function truffle(m, seed) {
  const geo = sphereGeo(64);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = V(p.getX(i), p.getY(i), p.getZ(i));
    const d = 1 + (noise3(v.x * 2.3 + seed, v.y * 2.3, v.z * 2.3) - 0.5) * 0.22;
    v.multiplyScalar(d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  flattenBottom(geo, -0.55);
  const mesh = new THREE.Mesh(geo, m.truffle);
  mesh.position.y = 0.55;
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  return g;
}

function squarePraline(m, mat = m.chocMilk) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.8, 1.0, 1.8, 5, 0.2), mat);
  body.position.y = 0.5;
  body.castShadow = true;
  const stripe = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.05, 0.22, 2, 0.02), m.gold);
  stripe.rotation.y = Math.PI / 4;
  stripe.position.y = 1.0;
  stripe.scale.x = 0.95;
  g.add(body, stripe);
  return g;
}

function foilCup(m) {
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push(new THREE.Vector2(0.78 + u * 0.32, u * 0.42));
  }
  pts.unshift(new THREE.Vector2(0, 0));
  const g = new THREE.LatheGeometry(pts, 36);
  // Fluted foil: push alternate columns in and out.
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    if (r < 0.01) continue;
    const k = 1 + 0.035 * Math.cos(a * 18);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  fixPoleNormals(g);
  return new THREE.Mesh(g, m.foil);
}

// ---------------------------------------------------------------------------
// The box (prototype packaging — no real EBCORE photography was available).
const BW = 3.0, BH = 0.75, WT = 0.07, LID_H = 0.32, LID_W = BW + 0.07, TRAY_Y = 0.14;

function buildBox(m) {
  const box = new THREE.Group();
  const add = (geo, mat, x, y, z, parent = box) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  add(new RoundedBoxGeometry(BW, 0.08, BW, 3, 0.03), m.boxSide, 0, 0.04, 0);
  add(new RoundedBoxGeometry(BW, BH, WT, 3, 0.025), m.boxSide, 0, BH / 2, BW / 2 - WT / 2);
  add(new RoundedBoxGeometry(BW, BH, WT, 3, 0.025), m.boxSide, 0, BH / 2, -BW / 2 + WT / 2);
  add(new RoundedBoxGeometry(WT, BH, BW - 2 * WT, 3, 0.025), m.boxSide, BW / 2 - WT / 2, BH / 2, 0);
  add(new RoundedBoxGeometry(WT, BH, BW - 2 * WT, 3, 0.025), m.boxSide, -BW / 2 + WT / 2, BH / 2, 0);
  // Gold-satin interior.
  const inner = BW - 2 * WT - 0.004;
  add(new THREE.BoxGeometry(inner, TRAY_Y, inner), m.lining, 0, TRAY_Y / 2 + 0.05, 0);
  for (const [w, d, x, z] of [[inner, 0.004, 0, inner / 2], [inner, 0.004, 0, -inner / 2], [0.004, inner, inner / 2, 0], [0.004, inner, -inner / 2, 0]]) {
    add(new THREE.BoxGeometry(w, BH - TRAY_Y - 0.06, d), m.lining, x, (BH + TRAY_Y) / 2, z);
  }
  // Gold rim on the base edge.
  for (const [w, d, x, z] of [[BW + 0.012, 0.012, 0, BW / 2], [BW + 0.012, 0.012, 0, -BW / 2], [0.012, BW + 0.012, BW / 2, 0], [0.012, BW + 0.012, -BW / 2, 0]]) {
    add(new THREE.BoxGeometry(w, 0.022, d), m.gold, x, BH - LID_H + 0.035, z);
  }

  // Nine chocolates in fluted gold cups.
  const pieces = [];
  const sc = 0.27;
  const layout = [
    ['sq', 'dome', 'sq'],
    ['truffle', 'hero', 'truffle'],
    ['sq', 'dome', 'sq'],
  ];
  layout.forEach((row, r) => row.forEach((kind, c) => {
    const x = (c - 1) * 0.92, z = (r - 1) * 0.92;
    const cup = foilCup(m);
    cup.scale.setScalar(0.38);
    cup.position.set(x, TRAY_Y + 0.05, z);
    box.add(cup);
    let piece;
    if (kind === 'sq') piece = squarePraline(m, (r + c) % 4 === 0 ? m.chocMilk : m.choc);
    else if (kind === 'dome') piece = bonbonDome(m);
    else if (kind === 'truffle') piece = truffle(m, r * 3 + c);
    else {
      piece = new THREE.Group();
      const s = new THREE.Mesh(sphereGeo(), m.choc);
      s.position.y = 1;
      s.castShadow = true;
      piece.add(s);
    }
    piece.scale.setScalar(sc);
    piece.position.set(x, TRAY_Y + 0.06, z);
    if (kind === 'sq') piece.rotation.y = 0.15 * (c - 1) + 0.05 * r;
    box.add(piece);
    pieces.push(piece);
  }));

  // Hinged lid.
  const hinge = new THREE.Group();
  hinge.position.set(0, BH - LID_H + 0.05, -LID_W / 2);
  box.add(hinge);
  const lid = new THREE.Group();
  lid.position.set(0, 0, LID_W / 2);
  hinge.add(lid);
  add(new RoundedBoxGeometry(LID_W, LID_H, LID_W, 4, 0.035), m.boxSide, 0, LID_H / 2, 0, lid);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(LID_W - 0.1, LID_W - 0.1), m.lidTop);
  top.rotation.x = -Math.PI / 2;
  top.position.y = LID_H + 0.0015;
  top.receiveShadow = true;
  lid.add(top);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(LID_W - 0.16, LID_W - 0.16), m.lining);
  under.rotation.x = Math.PI / 2;
  under.position.y = -0.002;
  lid.add(under);
  for (const [w, d, x, z] of [[LID_W + 0.01, 0.01, 0, LID_W / 2], [LID_W + 0.01, 0.01, 0, -LID_W / 2], [0.01, LID_W + 0.01, LID_W / 2, 0], [0.01, LID_W + 0.01, -LID_W / 2, 0]]) {
    add(new THREE.BoxGeometry(w, 0.018, d), m.gold, x, 0.03, z, lid);
  }
  return { box, hinge, pieces };
}

// ---------------------------------------------------------------------------
// Hero bonbon that cracks along a jagged seam.
const R = 1, SHELL = 0.88;
// Seam offset along X as a function of the angle around the X axis.
const tri = (x) => Math.abs(x - Math.floor(x) - 0.5) * 2 - 0.5;
const seam = (phi) => 0.05 * Math.sin(2 * phi + 0.3) + 0.045 * tri((phi * 5) / (2 * Math.PI) + 0.2) + 0.022 * tri((phi * 17) / (2 * Math.PI) + 0.6);

function applySeam(geo, side, weightFn) {
  // Half A has local +Y -> world +X (worldY = -x, worldZ = z); half B the mirror.
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const wy = side > 0 ? -x : x;
    const phi = Math.atan2(z, wy);
    p.setY(i, y + side * seam(phi) * weightFn(x, y, z));
  }
  geo.computeVertexNormals();
  smoothNormals(geo);
  fixPoleNormals(geo);
}

// Lathe geometry duplicates vertices along its seam and at the pole; average the
// normals of coincident vertices so shading has no radial streaks.
function smoothNormals(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    const g = groups.get(k);
    g ? g.push(i) : groups.set(k, [i]);
  }
  const v = new THREE.Vector3(), sum = new THREE.Vector3();
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    sum.set(0, 0, 0);
    for (const i of idx) sum.add(v.fromBufferAttribute(n, i));
    if (sum.lengthSq() < 1e-8) continue;
    sum.normalize();
    for (const i of idx) n.setXYZ(i, sum.x, sum.y, sum.z);
  }
  n.needsUpdate = true;
}

// Degenerate triangles at a lathe pole leave zero normals, which turn into NaN
// in the shader (and bloom smears NaN into black blocks). Point them radially.
function fixPoleNormals(geo, axis = null) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < n.count; i++) {
    v.fromBufferAttribute(n, i);
    if (v.lengthSq() > 0.25) continue;
    if (axis) v.copy(axis);
    else v.fromBufferAttribute(p, i).normalize();
    if (v.lengthSq() < 0.25) v.set(0, 1, 0);
    n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}

function buildHalf(m, side) {
  const nOuter = 64;
  const outerPts = [];
  for (let i = nOuter; i >= 0; i--) {
    const th = (i / nOuter) * (Math.PI / 2);
    outerPts.push(new THREE.Vector2(R * Math.sin(th), R * Math.cos(th)));
  }
  const innerPts = [new THREE.Vector2(R, 0)];
  for (let i = nOuter; i >= 0; i--) {
    const th = (i / nOuter) * (Math.PI / 2);
    innerPts.push(new THREE.Vector2(SHELL * Math.sin(th), SHELL * Math.cos(th)));
  }
  const w = (x, y) => Math.pow(1 - clamp(y / R), 8);
  const outer = new THREE.LatheGeometry(outerPts, 160);
  const inner = new THREE.LatheGeometry(innerPts, 160);
  applySeam(outer, side, w);
  applySeam(inner, side, w);
  // Caramel face: a slightly domed, rippled disc across the opening.
  const capPts = [];
  for (let i = 0; i <= 40; i++) {
    const r = (i / 40) * (SHELL - 0.004);
    const rr = r / SHELL;
    capPts.push(new THREE.Vector2(Math.max(r, 1e-4), -0.07 * (1 - rr * rr)));
  }
  const cap = new THREE.LatheGeometry(capPts, 160);
  {
    const p = cap.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      p.setY(i, p.getY(i) - (noise3(x * 2.5, z * 2.5, side * 3) - 0.5) * 0.035);
    }
  }
  applySeam(cap, side, (x, y, z) => Math.pow(Math.hypot(x, z) / SHELL, 14));
  const orient = new THREE.Group();
  orient.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  const mo = new THREE.Mesh(outer, m.choc);
  const mi = new THREE.Mesh(inner, m.chocInner);
  const mc = new THREE.Mesh(cap, m.caramel);
  orient.add(mo, mi, mc);
  const half = new THREE.Group();
  half.add(orient);
  half.userData.capCenter = (target) => mc.localToWorld(target.set(0, -0.07, 0));
  return half;
}

// Pose of the bonbon halves over time (shared by geometry and the pour target).
function heroPose(t) {
  const sep = 0.004 * smooth(4.55, 4.6, t) + 0.07 * easeOutExpo(range(t, 4.75, 4.95)) + 0.95 * easeInOutSine(range(t, 4.85, 6.5));
  const yaw = 0.5 * easeInOutSine(range(t, 4.9, 6.5));
  const tilt = 0.12 * easeInOutSine(range(t, 4.9, 6.5));
  return { sep, yaw, tilt };
}

function makeShardGeo(r, seed) {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  const rr = rng(seed);
  const jit = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!jit.has(key)) jit.set(key, [0.6 + rr() * 0.7, 0.6 + rr() * 0.7, 0.6 + rr() * 0.7]);
    const j = jit.get(key);
    p.setXYZ(i, p.getX(i) * j[0], p.getY(i) * j[1] * 0.45, p.getZ(i) * j[2]);
  }
  g.scale(r, r, r);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Shaders.
const particleVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime, uSize, uFocus, uBlur, uProj, uGold, uSwirl, uAmbient, uBeamAmt, uBeamRadius;
uniform vec3 uCenter, uExtent, uWind, uBeamPos, uBeamDir;
varying float vAlpha; varying vec3 vColor; varying float vCoc;
void main(){
  vec3 p = aSeed.xyz + uWind * uTime * (0.4 + aSeed.w);
  p += 0.025 * vec3(sin(uTime*0.7 + aSeed.w*40.0), sin(uTime*0.5 + aSeed.x*30.0), cos(uTime*0.6 + aSeed.y*20.0));
  p = fract(p) - 0.5;
  float a = uSwirl * uTime * (0.4 + aSeed.w);
  p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
  vec3 world = uCenter + p * uExtent;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  float depth = max(-mv.z, 0.05);
  float coc = abs(depth - uFocus) * uBlur;
  bool gold = aSeed.w > 1.0 - uGold;
  float s = uSize * (gold ? 0.55 : 1.0) * (0.35 + aSeed.w * 0.9);
  gl_PointSize = clamp(s * uProj / depth * (1.0 + coc * 3.0), 1.0, 160.0);
  vec3 d = world - uBeamPos; float along = dot(d, uBeamDir);
  float dist = length(d - along * uBeamDir);
  float beam = (1.0 - smoothstep(0.0, uBeamRadius * (1.0 + along * 0.18), dist)) * step(0.0, along);
  float lit = uAmbient + beam * uBeamAmt;
  float tw = gold ? 0.55 + 0.45 * sin(uTime * (6.0 + aSeed.x * 9.0) + aSeed.y * 50.0) : 1.0;
  vAlpha = lit * tw / (1.0 + coc * coc * 6.0);
  vColor = gold ? vec3(1.0, 0.72, 0.32) * 2.2 : vec3(0.62, 0.34, 0.16);
  vCoc = clamp(coc, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const particleFS = /* glsl */ `
varying float vAlpha; varying vec3 vColor; varying float vCoc;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float soft = 1.0 - smoothstep(0.0, 1.0, d);
  float disc = (1.0 - smoothstep(0.82, 1.0, d)) * (0.55 + 0.45 * smoothstep(0.4, 0.95, d));
  float a = mix(soft * soft, disc * 0.5, vCoc);
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}`;

function makeParticles(count, seed) {
  const r = rng(seed);
  const g = new THREE.BufferGeometry();
  const seeds = new Float32Array(count * 4).map(() => r());
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: particleVS, fragmentShader: particleFS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uSize: { value: 0.02 }, uFocus: { value: 5 }, uBlur: { value: 0.3 }, uProj: { value: 1000 },
      uGold: { value: 0.2 }, uSwirl: { value: 0 }, uAmbient: { value: 0.2 }, uBeamAmt: { value: 0 }, uBeamRadius: { value: 1 },
      uCenter: { value: V(0, 0, 0) }, uExtent: { value: V(8, 5, 8) }, uWind: { value: V(0.01, 0.02, 0) },
      uBeamPos: { value: V(0, 8, 0) }, uBeamDir: { value: V(0, -1, 0) },
    },
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return pts;
}

const burstVS = /* glsl */ `
attribute vec4 aSeed;
uniform float uTau, uProj, uSize;
uniform vec3 uOrigin;
varying float vAlpha; varying vec3 vColor;
float seamX(float phi){
  float t1 = abs(fract(phi*5.0/6.2831853 + 0.2) - 0.5)*2.0 - 0.5;
  float t2 = abs(fract(phi*17.0/6.2831853 + 0.6) - 0.5)*2.0 - 0.5;
  return 0.05*sin(2.0*phi + 0.3) + 0.045*t1 + 0.022*t2;
}
void main(){
  float phi = aSeed.x * 6.2831853;
  vec3 radial = vec3(0.0, cos(phi), sin(phi));
  vec3 p0 = uOrigin + vec3(seamX(phi), 0.0, 0.0) + radial * 1.0;
  vec3 v = radial * (0.4 + aSeed.y * 1.4) + vec3((aSeed.z - 0.5) * 0.9, 0.15, 0.35 * aSeed.w);
  float tau = uTau * (0.6 + aSeed.w * 0.8);
  vec3 world = p0 + v * (0.45 * (1.0 - exp(-4.0 * tau)) + 0.1 * tau) + vec3(0.0, -0.03, 0.0) * tau * tau;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  float depth = max(-mv.z, 0.05);
  gl_PointSize = clamp(uSize * (0.4 + aSeed.z) * uProj / depth, 1.0, 64.0);
  bool gold = aSeed.y > 0.82;
  vAlpha = step(0.0001, uTau) * exp(-tau * 0.9) * (gold ? 1.0 : 0.55);
  vColor = gold ? vec3(1.0, 0.7, 0.3) * 2.4 : vec3(0.75, 0.42, 0.2);
  gl_Position = projectionMatrix * mv;
}`;

function glowMaterial(hex) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hex) }, uAmt: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uAmt; varying vec2 vUv;
      void main(){ vec2 c = (vUv - 0.5) * vec2(1.0, 1.6); float d = length(c) * 2.0;
      gl_FragColor = vec4(uColor * uAmt * pow(max(1.0 - d, 0.0), 2.2), 1.0); }`,
    depthWrite: false,
  });
}

function beamMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uAmt: { value: 0 }, uTime: { value: 0 }, uH: { value: 7 } },
    vertexShader: `uniform float uH; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vY = position.y / uH + 0.5; vec4 mv = modelViewMatrix * vec4(position,1.0);
      vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uAmt, uTime; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
      float shafts = 0.75 + 0.25 * sin(vY * 9.0 - uTime * 0.8 + f * 6.0);
      float a = pow(f, 2.5) * smoothstep(0.0, 0.3, vY) * (1.0 - vY * 0.55) * shafts * uAmt;
      gl_FragColor = vec4(vec3(1.0, 0.74, 0.38) * a, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// Sky for the Algerian shot: dusk gradient with a khatam lattice in fine gold.
function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uHorizon: { value: new THREE.Color(0x7a3e12) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uTime, uReveal; uniform vec3 uHorizon; varying vec2 vUv;
      float sdBox(vec2 p, float s){ vec2 d = abs(p) - vec2(s); return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
      vec2 rot(vec2 p, float a){ return mat2(cos(a), -sin(a), sin(a), cos(a)) * p; }
      float khatam(vec2 uv, float aa){
        vec2 g = fract(uv) - 0.5;
        float d1 = sdBox(g, 0.25), d2 = sdBox(rot(g, 0.785398), 0.25);
        float star = min(d1, d2), oct = max(d1, d2);
        float l = min(abs(star), abs(oct + 0.07));
        vec2 h = abs(g); float link = min(abs(h.x - h.y) + max(0.0, 0.33 - max(h.x, h.y)) * 10.0, 1.0);
        l = min(l, link);
        return 1.0 - smoothstep(0.0, aa, l - 0.006);
      }
      void main(){
        float y = vUv.y;
        vec3 col = mix(uHorizon * 1.15, vec3(0.03, 0.017, 0.01), smoothstep(0.30, 0.78, y));
        float sun = exp(-pow(length((vUv - vec2(0.36, 0.30)) * vec2(1.7, 3.2)), 2.0) * 3.0);
        col += vec3(1.0, 0.55, 0.2) * sun * 0.9;
        vec2 p = (vUv - vec2(0.5, 0.3)) * vec2(46.0, 18.7);
        float k = khatam(p, 0.05);
        float mask = smoothstep(0.36, 0.62, y) * (1.0 - smoothstep(0.85, 1.0, y));
        float reveal = 1.0 - smoothstep(uReveal * 30.0 - 3.0, uReveal * 30.0, length(p - vec2(0.0, 7.5)));
        float sweep = 0.6 + 0.8 * exp(-pow((p.x + p.y * 0.4) - (uTime * 9.0 - 18.0), 2.0) * 0.03);
        col += vec3(0.95, 0.68, 0.32) * k * mask * reveal * 0.2 * sweep;
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: false,
  });
}

const clampShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 40.0), 1.0); }`,
};

const gradeShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uFade: { value: 1 }, uFlash: { value: 0 },
    uVignette: { value: 0.55 }, uGrain: { value: 0.035 }, uAberr: { value: 0.006 }, uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uFade, uFlash, uVignette, uGrain, uAberr; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * uAberr * r2 * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col = pow(col, vec3(0.98, 1.0, 1.07));
      col *= 1.0 - uVignette * smoothstep(0.12, 0.62, length(c * vec2(1.0, 0.9)));
      col += uFlash * vec3(1.0, 0.76, 0.42) * (1.1 - r2 * 2.0);
      col *= uFade;
      float g = hash(floor(vUv * uRes) + fract(uTime * 7.13) * 97.0) - 0.5;
      col += g * uGrain * (0.35 + 0.65 * (1.0 - dot(col, vec3(0.333))));
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// ---------------------------------------------------------------------------
export async function createFilm({ width, height, pixelRatio = 1, fontBase = '' }) {
  await loadFonts(fontBase);
  const glCanvas = document.createElement('canvas');
  const out = document.createElement('canvas');
  const ctx2d = out.getContext('2d');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x5a2e10, 0);
  scene.environment = buildEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.02, 400);
  const m = buildMaterials();

  // ---- Set A: the box on a dark glossy floor.
  const setA = new THREE.Group();
  scene.add(setA);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), m.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  setA.add(floor);
  const backA = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), glowMaterial(0x6a3410));
  backA.position.set(0, 3, -9);
  setA.add(backA);
  const { box, hinge } = buildBox(m);
  setA.add(box);
  const beamA = new THREE.Mesh(new THREE.ConeGeometry(1.25, 7, 48, 1, true), beamMaterial());
  beamA.position.set(0.15, 0.6 + 3.5, 0.1);
  beamA.rotation.z = -0.03;
  setA.add(beamA);
  // Pieces scattered around the box for the packshot.
  const extras = new THREE.Group();
  setA.add(extras);
  {
    const put = (obj, x, z, s, ry) => { obj.position.set(x, 0, z); obj.scale.setScalar(s); obj.rotation.y = ry; extras.add(obj); };
    put(bonbonDome(m), -2.15, 1.2, 0.3, 0.4);
    put(squarePraline(m), 2.05, 1.05, 0.3, 0.5);
    put(truffle(m, 7), -1.35, 2.15, 0.27, 0);
    put(bonbonDome(m), 2.55, -0.4, 0.27, 1.2);
    const r = rng(21);
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Mesh(makeShardGeo(1, 40 + i), m.shard);
      const a = r() * Math.PI * 2;
      s.position.set(Math.cos(a) * (2.0 + r() * 0.9), 0.025, 1.0 + r() * 1.4);
      s.rotation.set(r() * 0.3, r() * 6, r() * 0.3);
      s.scale.setScalar(0.06 + r() * 0.07);
      s.castShadow = true;
      extras.add(s);
    }
  }

  const keyA = new THREE.SpotLight(0xffc27a, 0, 0, 0.46, 0.75, 2);
  keyA.position.set(-3.6, 6.5, 4.6);
  keyA.target.position.set(0, 0.4, 0);
  keyA.castShadow = true;
  keyA.shadow.mapSize.set(2048, 2048);
  keyA.shadow.bias = -0.0004;
  keyA.shadow.normalBias = 0.02;
  const rimA = new THREE.SpotLight(0xff9a40, 0, 0, 0.5, 0.6, 2);
  rimA.position.set(3.2, 4.6, -5.2);
  rimA.target.position.set(0, 0.6, 0);
  const rimA2 = new THREE.SpotLight(0xffb060, 0, 0, 0.5, 0.6, 2);
  rimA2.position.set(-3.6, 4.0, -4.6);
  rimA2.target.position.set(0, 0.5, 0);
  const topA = new THREE.SpotLight(0xffe2b0, 0, 0, 0.26, 0.55, 2);
  topA.position.set(0.3, 8, 0.4);
  topA.target.position.set(0, 0.3, 0);
  const innerA = new THREE.PointLight(0xffa850, 0, 3.0, 2);
  innerA.position.set(0, 1.7, 0.7);
  setA.add(keyA, keyA.target, rimA, rimA.target, rimA2, rimA2.target, topA, topA.target, innerA);

  // ---- Set B: macro hero bonbon.
  const setB = new THREE.Group();
  setB.position.copy(OB);
  scene.add(setB);
  const backB = new THREE.Mesh(new THREE.PlaneGeometry(30, 20), glowMaterial(0x5a2a0c));
  backB.position.set(0, 0, -8);
  setB.add(backB);
  const hero = new THREE.Group();
  setB.add(hero);
  const halfA = buildHalf(m, 1), halfB = buildHalf(m, -1);
  hero.add(halfA, halfB);
  // Caramel strand stretched between the halves.
  const strandGeo = new THREE.CylinderGeometry(1, 1, 1, 28, 48, true);
  strandGeo.rotateZ(-Math.PI / 2); // axis along X, x in [-0.5, 0.5]
  const strandBase = strandGeo.attributes.position.array.slice();
  const strand = new THREE.Mesh(strandGeo, m.caramel);
  strand.frustumCulled = false;
  setB.add(strand);
  // Shards.
  const shardRand = rng(77);
  const shards = [];
  for (let i = 0; i < 22; i++) {
    const big = i < 9;
    const mesh = new THREE.Mesh(makeShardGeo(big ? 0.11 + shardRand() * 0.08 : 0.035 + shardRand() * 0.035, 100 + i), m.shard);
    // Angle around the seam, biased toward the camera side (+Z).
    const ph = -0.3 + shardRand() * (Math.PI + 0.6);
    const radial = V(0, Math.cos(ph), Math.sin(ph));
    mesh.userData = {
      p0: V(seam(ph), radial.y, radial.z),
      v: radial.clone().multiplyScalar(0.5 + shardRand() * 1.1).add(V((shardRand() - 0.5) * 1.2, 0.2, 0.3 + shardRand() * 0.5)),
      w: V(shardRand() - 0.5, shardRand() - 0.5, shardRand() - 0.5).multiplyScalar(5),
      r0: V(shardRand() * 6, shardRand() * 6, shardRand() * 6),
    };
    hero.add(mesh);
    shards.push(mesh);
  }
  const burst = new THREE.Points(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
    vertexShader: burstVS, fragmentShader: particleFS.replace('varying float vCoc;', '').replace('vCoc', '0.0'),
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTau: { value: 0 }, uProj: { value: 1000 }, uSize: { value: 0.012 }, uOrigin: { value: V(0, 0, 0) } },
  }));
  {
    const r = rng(5);
    const n = 700;
    burst.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    burst.geometry.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(n * 4).map(() => r()), 4));
    burst.frustumCulled = false;
  }
  setB.add(burst);
  // Pour: a thin glossy stream landing on the left half.
  const pourLand = (() => {
    const { sep, yaw } = heroPose(6.6);
    const n = V(-0.42, 0.88, 0.22).normalize().multiplyScalar(1.004);
    n.applyAxisAngle(V(0, 1, 0), -yaw);
    return n.add(V(-sep, 0, 0));
  })();
  const pourCurve = new THREE.CatmullRomCurve3([
    pourLand.clone().add(V(0.32, 4.2, 0.4)),
    pourLand.clone().add(V(0.22, 2.6, 0.26)),
    pourLand.clone().add(V(0.1, 1.3, 0.12)),
    pourLand.clone().add(V(0.02, 0.45, 0.03)),
    pourLand.clone(),
  ]);
  const POUR_SEG = 160, POUR_RAD = 14;
  const pourGeo = new THREE.TubeGeometry(pourCurve, POUR_SEG, 0.05, POUR_RAD, false);
  {
    const uv = pourGeo.attributes.uv;
    const a = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) a[i] = uv.getX(i);
    pourGeo.setAttribute('aU', new THREE.BufferAttribute(a, 1));
  }
  const liquidUniforms = { uTime: { value: 0 } };
  m.liquid.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = liquidUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aU; uniform float uTime;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normal * (0.010 * sin(aU * 70.0 - uTime * 16.0) + 0.006 * sin(aU * 23.0 - uTime * 7.0)) * (1.0 - aU * 0.6);');
  };
  const pour = new THREE.Mesh(pourGeo, m.liquid);
  pour.frustumCulled = false;
  setB.add(pour);
  const pourHead = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 16), m.liquid);
  setB.add(pourHead);
  const pool = new THREE.Mesh(flattenBottom(new THREE.SphereGeometry(1, 40, 24), 0), m.liquid);
  setB.add(pool);

  const keyB = new THREE.SpotLight(0xffc88a, 0, 0, 0.5, 0.8, 2);
  const rimB = new THREE.SpotLight(0xff9a40, 0, 0, 0.55, 0.6, 2);
  rimB.position.set(3.2, 2.2, -4);
  const rimB2 = new THREE.SpotLight(0xffb870, 0, 0, 0.55, 0.6, 2);
  rimB2.position.set(-3.5, 1.4, -3.4);
  const topB = new THREE.SpotLight(0xffe0b8, 0, 0, 0.45, 0.7, 2);
  topB.position.set(0.5, 6, 1.2);
  const glowB = new THREE.PointLight(0xff9a3a, 0, 2.5, 2);
  for (const l of [keyB, rimB, rimB2, topB]) { l.target.position.set(0, 0, 0); setB.add(l, l.target); }
  glowB.position.set(0, 0.5, 1.8);
  setB.add(glowB);

  // ---- Set C: the Algerian signature.
  const setC = new THREE.Group();
  setC.position.copy(OC);
  scene.add(setC);
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(320, 130), skyMaterial());
  sky.position.set(0, 30, -95);
  setC.add(sky);
  const dunes = (() => {
    const g = new THREE.PlaneGeometry(220, 140, 320, 220);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const big = 2.4 * Math.sin(x * 0.045 + Math.sin(z * 0.03) * 1.6) * Math.cos(z * 0.035);
      const u = x * 0.16 + 0.7 * Math.sin(z * 0.09) + 0.35 * Math.sin(z * 0.21 + x * 0.04);
      const s = Math.sin(u);
      const crest = Math.pow(1 - Math.abs(s), 2.2) * (s > 0 ? 1.0 : 0.75);
      const ridge = crest * (1.4 + 0.6 * Math.sin(z * 0.05 + 1.0));
      const far = smooth(-12, -70, z - 62);
      p.setY(i, (big + ridge * 1.6) * (0.4 + far * 1.6) - 4.2);
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m.sand);
    mesh.position.set(0, 0, -62);
    return mesh;
  })();
  setC.add(dunes);
  const praline = new THREE.Group();
  {
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.72, 1.4, 6, 0.16), m.choc);
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 1.06), m.starDecal);
    decal.rotation.x = -Math.PI / 2;
    decal.position.y = 0.3605;
    const leaf = goldLeaf(m.goldLeaf, 0.34, 0.2, 5);
    leaf.rotation.set(-Math.PI / 2 + 0.05, 0, 0.8);
    leaf.position.set(0.42, 0.366, -0.42);
    praline.add(body, decal, leaf);
  }
  setC.add(praline);
  const sunC = new THREE.DirectionalLight(0xffa24a, 0);
  sunC.position.set(-70, 9, -30);
  const keyC = new THREE.SpotLight(0xffd29a, 0, 0, 0.4, 0.8, 2);
  keyC.position.set(3.5, 6.5, 6);
  const rimC = new THREE.SpotLight(0xff9a40, 0, 0, 0.4, 0.6, 2);
  rimC.position.set(-2.5, 4.5, -4.5);
  const rimC2 = new THREE.SpotLight(0xffb060, 0, 0, 0.4, 0.6, 2);
  rimC2.position.set(3, 1.5, -4);
  for (const l of [keyC, rimC, rimC2]) { l.target.position.set(0, 2.6, 0); setC.add(l, l.target); }
  setC.add(sunC, sunC.target);
  const hemi = new THREE.HemisphereLight(0xffb070, 0x1a0c05, 0);
  scene.add(hemi);

  // ---- Atmosphere.
  const dust = makeParticles(1600, 3);
  scene.add(dust);

  // ---- Post.
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // Tiny-roughness highlights can overflow the half-float buffer (Inf), which the
  // bloom blur would smear into black NaN blocks. Clamp before bloom.
  composer.addPass(new ShaderPass(clampShader));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.55, 0.82);
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
  }
  resize(width, height);

  // Camera: baseFov applies to the narrow side so framing holds in 9:16 and 16:9.
  function setCam(p, target, baseFov, roll = 0) {
    camera.position.set(...p);
    const fwd = V(...target).sub(camera.position).normalize();
    const right = V().crossVectors(fwd, V(0, 1, 0)).normalize();
    const up = V().crossVectors(right, fwd).normalize();
    camera.up.copy(up.applyAxisAngle(fwd, roll));
    camera.lookAt(...target);
    const aspect = W / H;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? (2 * Math.atan(Math.tan((baseFov * DEG) / 2) / aspect)) / DEG : baseFov;
    camera.updateProjectionMatrix();
  }
  const add3 = (o, a) => [o.x + a[0], o.y + a[1], o.z + a[2]];
  const lights = [keyA, rimA, rimA2, topA, innerA, keyB, rimB, rimB2, topB, glowB, sunC, keyC, rimC, rimC2, hemi];

  function dustSet(o) {
    const u = dust.material.uniforms;
    u.uCenter.value.set(...o.center);
    u.uExtent.value.set(...o.extent);
    u.uWind.value.set(...(o.wind || [0.006, 0.012, 0.002]));
    u.uSize.value = o.size ?? 0.02;
    u.uGold.value = o.gold ?? 0.2;
    u.uSwirl.value = o.swirl ?? 0;
    u.uAmbient.value = o.ambient ?? 0.2;
    u.uBeamAmt.value = o.beam ?? 0;
    u.uBlur.value = o.blur ?? 0.3;
    u.uFocus.value = o.focus ?? camera.position.distanceTo(V(...o.center));
  }

  // -------------------------------------------------------------------------
  function update(t) {
    setA.visible = setB.visible = setC.visible = false;
    extras.visible = false;
    for (const l of lights) l.intensity = 0;
    scene.fog.density = 0;
    renderer.toneMappingExposure = 1;
    bloom.strength = 0.55;
    beamA.material.uniforms.uAmt.value = 0;
    dust.material.uniforms.uTime.value = t;
    grade.uniforms.uTime.value = t;
    grade.uniforms.uFade.value = 1;
    grade.uniforms.uVignette.value = 0.55;
    grade.uniforms.uFlash.value = 0.22 * pulse(t, 4.0, 0.08, 0.2) + 0.85 * pulse(t, 7.0, 0.12, 0.3) + 0.6 * pulse(t, 9.0, 0.03, 0.4);

    if (t < 4.0) shotBox(t);
    else if (t < 7.0) shotMacro(t);
    else if (t < 9.0) shotAlgeria(t);
    else shotFinal(t);

    const proj = H / (2 * Math.tan((camera.fov * DEG) / 2));
    dust.material.uniforms.uProj.value = proj;
    burst.material.uniforms.uProj.value = proj;
  }

  // Shots 1 + 2 (0-4s): the mystery, then the reveal. One continuous camera move.
  function shotBox(t) {
    setA.visible = true;
    grade.uniforms.uFade.value = smooth(0.0, 0.7, t);
    const rim = smooth(0.15, 1.4, t), key = smooth(0.7, 2.0, t);
    keyA.intensity = 230 * key * (1 - 0.35 * smooth(2.2, 3.2, t));
    rimA.intensity = 170 * rim;
    rimA2.intensity = 100 * rim;
    hemi.intensity = 0.02;
    backA.material.uniforms.uAmt.value = 0.35 * smooth(0.2, 2.0, t) + 0.25 * smooth(2.0, 3.0, t);
    const open = easeOutBack(easeInOutCubic(range(t, 2.0, 2.95)), 0.6);
    hinge.rotation.x = -open * 106 * DEG;
    const light = smooth(2.08, 2.7, t);
    topA.intensity = 420 * light;
    innerA.intensity = 1.5 * light;
    beamA.material.uniforms.uAmt.value = 0.3 * light;
    beamA.material.uniforms.uTime.value = t;
    beamA.position.x = 0.15 + 0.25 * Math.sin(t * 0.9);
    topA.position.x = 0.3 + 0.25 * Math.sin(t * 0.9);
    bloom.strength = 0.5 + 0.2 * light;

    const p = spline([
      [0.0, 1.3, 1.2, 13.5],
      [2.0, 0.4, 1.4, 8.4],
      [2.95, 0.05, 3.2, 4.9],
      [3.5, 0.0, 2.3, 1.9],
      [4.0, 0.0, 1.02, 0.36],
    ], t);
    const tg = spline([
      [0.0, 0.0, 0.48, 0.0],
      [2.0, 0.0, 0.46, 0.0],
      [2.95, 0.0, 0.42, 0.0],
      [3.5, 0.0, 0.5, 0.0],
      [4.0, 0.0, 0.5, 0.0],
    ], t);
    setCam(p, tg, lerp(28, 34, range(t, 2, 4)), -0.08 * easeInCubic(range(t, 3.2, 4.0)));
    dustSet({
      center: [0, 2.0, 1.5], extent: [7, 4.5, 9], size: 0.018, gold: 0.18, ambient: 0.12 + 0.2 * key,
      beam: 2.5 * light, focus: camera.position.distanceTo(V(0, 0.5, 0)), blur: 0.35,
    });
    const u = dust.material.uniforms;
    u.uBeamPos.value.set(beamA.position.x, 7.6, 0.1);
    u.uBeamRadius.value = 0.25;
  }

  // Shot 3 (4-7s): crack, slow-motion shards, caramel and the pour.
  function shotMacro(t) {
    setB.visible = true;
    hemi.intensity = 0.02;
    backB.material.uniforms.uAmt.value = 0.4;
    // Squeeze, then crack.
    const press = smooth(4.35, 4.72, t) * (1 - smooth(4.75, 4.85, t));
    hero.scale.set(1 + 0.012 * press, 1 - 0.03 * press, 1 + 0.012 * press);
    const { sep, yaw, tilt } = heroPose(t);
    halfA.position.set(sep, 0, 0);
    halfB.position.set(-sep, 0, 0);
    halfA.rotation.set(0, yaw, -tilt);
    halfB.rotation.set(0, -yaw, tilt);
    glowB.intensity = 2 * smooth(4.75, 5.4, t);
    // Shards drift in slow motion.
    const tau = Math.max(0, t - 4.75);
    for (const s of shards) {
      const d = s.userData;
      s.visible = tau > 0;
      const k = 0.4 * (1 - Math.exp(-4 * tau)) + 0.11 * tau;
      s.position.copy(d.p0).addScaledVector(d.v, k).add(V(0, -0.02 * tau * tau, 0));
      s.rotation.set(d.r0.x + d.w.x * k, d.r0.y + d.w.y * k, d.r0.z + d.w.z * k);
    }
    burst.material.uniforms.uTau.value = tau;
    liquidUniforms.uTime.value = t;

    // Light sweep across the gloss before the crack.
    const sweep = range(t, 4.0, 4.9);
    keyB.position.set(lerp(-4.5, 3.0, easeInOutSine(sweep)), 4.2, 3.6);
    keyB.intensity = 140;
    rimB.intensity = 190;
    rimB2.intensity = 130;
    topB.intensity = 90;

    let p, tg, fov, roll = 0;
    if (t < 5.2) {
      p = spline([[4.0, 0, 1.92, 1.2], [4.6, 0.75, 1.15, 2.45], [5.2, 1.2, 0.5, 3.15]], t);
      tg = [0, 0, 0];
      fov = lerp(34, 30, range(t, 4, 5.2));
      roll = -0.08 * (1 - easeOutCubic(range(t, 4.0, 4.6)));
    } else if (t < 6.1) {
      p = spline([[5.2, 0.95, -0.18, 2.35], [6.1, 0.15, 0.12, 2.05]], t);
      tg = spline([[5.2, 0.1, -0.02, 0], [6.1, -0.05, 0.02, 0]], t);
      fov = 27;
      roll = 0.05;
    } else {
      p = spline([[6.1, -0.35, 1.25, 3.0], [7.0, -0.8, 0.95, 2.45]], t);
      tg = spline([[6.1, -1.05, 0.55, 0], [7.0, -1.15, 0.5, 0]], t);
      fov = 30;
    }
    setCam(add3(OB, p), add3(OB, tg), fov, roll);
    scene.updateMatrixWorld();

    // Strand between the two caramel faces.
    const a = halfA.userData.capCenter(V()), b = halfB.userData.capCenter(V());
    setB.worldToLocal(a);
    setB.worldToLocal(b);
    // Root the strand slightly inside each caramel face so its flare never shows an edge.
    const axis = V().subVectors(a, b).normalize();
    a.addScaledVector(axis, 0.06);
    b.addScaledVector(axis, -0.06);
    const L = a.distanceTo(b);
    strand.visible = t > 4.8 && t < 7.0;
    if (strand.visible) {
      const pos = strand.geometry.attributes.position;
      const neck = Math.max(0.016, 0.2 * Math.exp(-L * 2.4));
      const endR = 0.26;
      const sag = 0.09 * smooth(0.2, 1.4, L);
      for (let i = 0; i < pos.count; i++) {
        const bx = strandBase[i * 3], by = strandBase[i * 3 + 1], bz = strandBase[i * 3 + 2];
        const u = bx + 0.5;
        const e = Math.pow(Math.abs(2 * u - 1), 7.0);
        const r = lerp(neck, endR, e);
        const c = V().lerpVectors(b, a, u);
        c.y -= sag * Math.sin(Math.PI * u);
        pos.setXYZ(i, c.x, c.y + by * r, c.z + bz * r);
      }
      pos.needsUpdate = true;
      strand.geometry.computeVertexNormals();
    }

    // Pour.
    const fall = easeInCubic(range(t, 6.15, 6.6));
    pour.visible = pourHead.visible = t > 6.15;
    const startSeg = Math.floor(fall * POUR_SEG);
    pour.geometry.setDrawRange(0, startSeg * POUR_RAD * 6);
    pourHead.position.copy(pourCurve.getPointAt(Math.min(fall, 0.999)));
    pourHead.scale.setScalar(1 - 0.5 * smooth(0.9, 1.0, fall));
    const grow = easeOutCubic(range(t, 6.58, 7.0));
    pool.visible = grow > 0;
    pool.position.copy(pourLand);
    pool.quaternion.setFromUnitVectors(V(0, 1, 0), pourLand.clone().add(V(sep, 0, 0)).normalize());
    pool.scale.set(0.05 + 0.2 * grow, 0.012 + 0.03 * grow, 0.05 + 0.24 * grow);

    dustSet({ center: [OB.x, 0.3, 0.6], extent: [5, 4, 5], size: 0.012, gold: 0.35, ambient: 0.32, blur: 1.1 });
  }

  // Shot 4 (7-9s): rotation over the dunes, khatam lattice in the sky.
  function shotAlgeria(t) {
    setC.visible = true;
    scene.fog.density = 0.012;
    scene.fog.color.set(0x6a3510);
    const l = t - 7;
    praline.position.set(0, 2.6 + 0.05 * Math.sin(l * 2), 0);
    praline.rotation.set(0.42 + 0.06 * Math.sin(l * 1.3), 0.4 + l * 0.85, 0.12);
    sky.material.uniforms.uTime.value = l;
    sky.material.uniforms.uReveal.value = easeOutCubic(range(t, 7.0, 8.2));
    sunC.intensity = 3.2;
    keyC.intensity = 150;
    rimC.intensity = 320;
    rimC2.intensity = 140;
    hemi.intensity = 0.25;
    const p = spline([[7.0, 2.3, 3.15, 3.4], [8.0, 0.6, 3.0, 3.6], [9.0, -1.0, 2.85, 2.9]], t);
    setCam(add3(OC, p), add3(OC, [0, 2.45, 0]), lerp(33, 29, range(t, 7, 9)), 0.02);
    dustSet({ center: [OC.x, 2.6, 0], extent: [3.6, 2.8, 3.6], size: 0.011, gold: 0.75, ambient: 0.55, swirl: 0.25, wind: [0, 0.03, 0], blur: 0.8 });
  }

  // Shot 5 (9-10s): packshot.
  function shotFinal(t) {
    setA.visible = true;
    extras.visible = true;
    hinge.rotation.x = 0;
    keyA.intensity = 260;
    rimA.intensity = 150;
    rimA2.intensity = 90;
    topA.intensity = 180;
    topA.position.x = 0.3;
    hemi.intensity = 0.05;
    backA.material.uniforms.uAmt.value = 0.5;
    const s = easeOutCubic(range(t, 9.0, 9.75));
    const p = [0, lerp(2.95, 2.75, s), lerp(6.9, 6.25, s)];
    setCam(p, [0, -0.2, 0], 40);
    dustSet({ center: [0, 1.6, 2], extent: [9, 4, 6], size: 0.014, gold: 0.4, ambient: 0.25, blur: 0.4 });
  }

  function renderAt(t) {
    update(clamp(t, 0, DURATION - 1e-4));
    composer.render();
    ctx2d.drawImage(glCanvas, 0, 0);
    drawTitle(ctx2d, W, H, t - 9.0);
    return out;
  }

  return { canvas: out, renderAt, resize, scene, get size() { return [W, H]; } };
}
