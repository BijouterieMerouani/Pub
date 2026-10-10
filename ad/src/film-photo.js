import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { clamp, lerp, range, smooth, pulse, spline, easeInOutCubic, easeOutCubic, easeInOutSine } from './util.js';
import { DURATION, loadFonts, makeParticles, clampShader, gradeShader } from './film.js';
import { drawTitle, drawCaption } from './title.js';

// Photo-based version of the film: the client's own box photograph and Sahara
// photograph, animated in 2.5D (depth-map parallax, depth of field, light and
// gold glints), with the same particles, grade and soundtrack as the 3D cut.

// Points of interest in the box photo, in uv (0..1, origin top-left).
const P = {
  lid: [0.47, 0.25],
  box: [0.52, 0.47],
  date: [0.377, 0.569],
  star: [0.421, 0.753],
  white: [0.673, 0.543],
  round: [0.698, 0.724],
};
// Macro tour (4.0-7.0s). Captions follow the box's own "4 régions · 4 saveurs".
const TOUR = [
  { at: P.date, title: 'DÉSERT', sub: 'Dattes de Biskra', drift: [0.02, -0.006] },
  { at: P.star, title: 'MER', sub: 'Fleur de sel de la Méditerranée', drift: [-0.018, 0.004] },
  { at: P.white, title: 'FORÊT', sub: 'Miel de chêne de Kabylie', drift: [0.016, 0.008], exposure: 0.8 },
  { at: P.round, title: 'MONTAGNE', sub: 'Amandes des Aurès', drift: [-0.014, -0.008] },
];

const layerVS = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// One shader for every photo layer.
const layerFS = /* glsl */ `
uniform sampler2D tMap, tBlur, tDepth, tGold;
uniform float uHasDepth, uHasGold, uImgAspect;
uniform vec2 uPar;
uniform vec2 uFocus; uniform float uFocusR, uDof;
uniform vec3 uLight; uniform float uLightAmt, uAmbient, uExposure;
uniform float uSweep, uSweepAmt, uGlint, uTime, uFeather, uOpacity, uHaze, uHorizon;
uniform vec3 uTint;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // image space, origin top-left
  if (uHasDepth > 0.5) {
    float d = texture2D(tDepth, uv).r;
    uv -= uPar * (d - 0.4);
    d = texture2D(tDepth, uv).r;
    uv = vec2(vUv.x, 1.0 - vUv.y) - uPar * (d - 0.4);
  }
  if (uHaze > 0.0) {
    float band = exp(-pow((uv.y - uHorizon) * 9.0, 2.0));
    uv.x += sin(uv.y * 340.0 + uTime * 9.0) * 0.0014 * uHaze * band;
    uv.y += sin(uv.x * 210.0 - uTime * 6.0) * 0.0008 * uHaze * band;
  }
  vec3 sharp = texture2D(tMap, uv).rgb;
  vec3 soft = texture2D(tBlur, uv).rgb;
  vec2 q = (uv - uFocus) * vec2(uImgAspect, 1.0);
  float f = smoothstep(uFocusR, uFocusR * 2.6, length(q)) * uDof;
  vec3 col = mix(sharp, soft, f);
  vec2 ql = (uv - uLight.xy) * vec2(uImgAspect, 1.0);
  float light = uAmbient + uLightAmt * exp(-dot(ql, ql) / (uLight.z * uLight.z));
  col *= light * uExposure * uTint;
  if (uHasGold > 0.5) {
    float g = texture2D(tGold, uv).r * (1.0 - f * 0.8);
    float sweep = exp(-pow((uv.x * 0.8 + uv.y * 0.6 - uSweep) * 9.0, 2.0));
    float tw = pow(hash(floor(uv * 900.0) + floor(uTime * 12.0)), 24.0);
    col += g * (sweep * uSweepAmt * 2.4 + tw * uGlint * 6.0 + 0.1 * uGlint) * vec3(1.0, 0.74, 0.38) * light;
  }
  float e = uFeather;
  float edge = smoothstep(0.0, e, vUv.x) * smoothstep(0.0, e, 1.0 - vUv.x) * smoothstep(0.0, e, vUv.y) * smoothstep(0.0, e, 1.0 - vUv.y);
  gl_FragColor = vec4(col, uOpacity * (e > 0.0 ? edge : 1.0));
}`;

// Cut-out layer (the date chocolate floating over the desert).
const cutoutFS = /* glsl */ `
uniform sampler2D tMap; uniform float uOpacity, uSweep, uRim, uExposure;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(tMap, vec2(vUv.x, 1.0 - vUv.y));
  vec3 col = c.rgb * uExposure;
  // Warm sunset rim from above and a slow specular sweep across the glaze.
  float up = smoothstep(0.35, 1.0, vUv.y);
  col += vec3(1.0, 0.45, 0.12) * up * uRim * c.a * 0.35;
  float sweep = exp(-pow((vUv.x + (1.0 - vUv.y) * 0.5) - uSweep, 2.0) * 60.0);
  col += vec3(1.0, 0.8, 0.55) * sweep * 0.5 * smoothstep(0.08, 0.3, dot(c.rgb, vec3(0.33)));
  gl_FragColor = vec4(col, c.a * uOpacity);
}`;

function loadTexture(loader, url, srgb = true) {
  return new Promise((res, rej) => loader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.flipY = false; // shaders work in image space (origin top-left)
    t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    res(t);
  }, undefined, rej));
}

function layer(tex, opts = {}) {
  const img = tex.map.image;
  const aspect = img.width / img.height;
  const mat = new THREE.ShaderMaterial({
    vertexShader: layerVS, fragmentShader: layerFS, transparent: true, depthWrite: false, depthTest: false,
    uniforms: {
      tMap: { value: tex.map }, tBlur: { value: tex.blur || tex.map }, tDepth: { value: tex.depth || tex.map }, tGold: { value: tex.gold || tex.map },
      uHasDepth: { value: tex.depth ? 1 : 0 }, uHasGold: { value: tex.gold ? 1 : 0 }, uImgAspect: { value: aspect },
      uPar: { value: new THREE.Vector2() }, uFocus: { value: new THREE.Vector2(0.5, 0.5) }, uFocusR: { value: 0.2 }, uDof: { value: 0 },
      uLight: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uLightAmt: { value: 0 }, uAmbient: { value: 1 }, uExposure: { value: 1 },
      uSweep: { value: -1 }, uSweepAmt: { value: 0 }, uGlint: { value: 0 }, uTime: { value: 0 }, uFeather: { value: opts.feather ?? 0 },
      uOpacity: { value: 1 }, uHaze: { value: 0 }, uHorizon: { value: 0.59 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(aspect, 1), mat);
  mesh.userData.aspect = aspect;
  mesh.renderOrder = opts.order ?? 0;
  return mesh;
}

export async function createFilm({ width, height, pixelRatio = 1, fontBase = '', assetBase = 'assets/' }) {
  await loadFonts(fontBase);
  const loader = new THREE.TextureLoader();
  const T = (name, srgb) => loadTexture(loader, assetBase + name, srgb);
  const [box, boxBlur, boxDepth, boxGold, sahara, saharaBlur, saharaDepth, date] = await Promise.all([
    T('box.jpg'), T('box-blur.jpg'), T('box-depth.png', false), T('box-gold.png', false),
    T('sahara.jpg'), T('sahara-blur.jpg'), T('sahara-depth.png', false), T('date.png'),
  ]);

  const glCanvas = document.createElement('canvas');
  const out = document.createElement('canvas');
  const ctx2d = out.getContext('2d');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: false, preserveDrawingBuffer: true });
  renderer.toneMapping = THREE.NoToneMapping;

  // Photo scene (orthographic, units = image heights).
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const fillBox = layer({ map: boxBlur }, { order: 0 });
  const boxL = layer({ map: box, blur: boxBlur, depth: boxDepth, gold: boxGold }, { order: 1, feather: 0.06 });
  const fillSahara = layer({ map: saharaBlur }, { order: 0 });
  const saharaL = layer({ map: sahara, blur: saharaBlur, depth: saharaDepth }, { order: 1, feather: 0.05 });
  const dateMat = new THREE.ShaderMaterial({
    vertexShader: layerVS, fragmentShader: cutoutFS, transparent: true, depthWrite: false, depthTest: false,
    uniforms: { tMap: { value: date }, uOpacity: { value: 1 }, uSweep: { value: -1 }, uRim: { value: 1 }, uExposure: { value: 1 } },
  });
  const dateAspect = date.image.width / date.image.height;
  const dateL = new THREE.Mesh(new THREE.PlaneGeometry(dateAspect, 1), dateMat);
  dateL.renderOrder = 3;
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.ShaderMaterial({
    vertexShader: layerVS,
    fragmentShader: 'uniform float uAmt; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(0.0, 0.0, 0.0, uAmt * (1.0 - smoothstep(0.2, 1.0, d))); }',
    uniforms: { uAmt: { value: 0.5 } }, transparent: true, depthWrite: false, depthTest: false,
  }));
  shadow.renderOrder = 2;
  scene.add(fillBox, boxL, fillSahara, saharaL, shadow, dateL);

  // Particles in their own perspective scene, layered on top.
  const pScene = new THREE.Scene();
  const pCam = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
  pCam.position.set(0, 0, 6);
  pCam.lookAt(0, 0, 0);
  const dust = makeParticles(1400, 3);
  pScene.add(dust);

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

  // Frame a layer: image point (cx, cy) at screen offset (ox, oy) in frame-height units;
  // `vis` is the visible fraction of the image along the frame's narrow side.
  function frame(l, cx, cy, vis, ox = 0, oy = 0) {
    const A = W / H;
    const asp = l.userData.aspect;
    const frameH = A < 1 ? (vis * asp) / A : vis;
    cam.left = (-A * frameH) / 2;
    cam.right = (A * frameH) / 2;
    cam.top = frameH / 2;
    cam.bottom = -frameH / 2;
    cam.position.set((cx - 0.5) * asp - ox * frameH, (0.5 - cy) + oy * frameH, 5);
    cam.updateProjectionMatrix();
    return frameH;
  }
  // Blurred fill behind a layer, covering the whole frame.
  function fill(f, l, frameH, amt) {
    f.visible = true;
    const A = W / H;
    const s = Math.max((A * frameH) / f.userData.aspect, frameH) * 1.25;
    f.scale.setScalar(s);
    f.position.set(cam.position.x, cam.position.y, 0);
    f.material.uniforms.uExposure.value = amt;
    l.visible = true;
  }

  function dustSet(o) {
    const u = dust.material.uniforms;
    u.uCenter.value.set(0, 0, 0);
    u.uExtent.value.set(o.ex ?? 7, 9, 6);
    u.uWind.value.set(...(o.wind || [0.006, 0.012, 0.002]));
    u.uSize.value = o.size ?? 0.018;
    u.uGold.value = o.gold ?? 0.25;
    u.uSwirl.value = 0;
    u.uAmbient.value = o.ambient ?? 0.2;
    u.uBeamAmt.value = o.beam ?? 0;
    u.uBeamPos.value.set(...(o.beamPos || [0, 6, 0]));
    u.uBeamDir.value.set(0, -1, 0);
    u.uBeamRadius.value = o.beamR ?? 1.0;
    u.uBlur.value = o.blur ?? 0.5;
    u.uFocus.value = 6;
    u.uProj.value = H / (2 * Math.tan((pCam.fov * Math.PI) / 360));
  }

  let caption = null;

  function update(t) {
    for (const o of [fillBox, boxL, fillSahara, saharaL, shadow, dateL]) o.visible = false;
    caption = null;
    dust.material.uniforms.uTime.value = t;
    grade.uniforms.uTime.value = t;
    grade.uniforms.uFade.value = 1;
    grade.uniforms.uVignette.value = 0.5;
    grade.uniforms.uAberr.value = 0.004;
    grade.uniforms.uFlash.value = 0.12 * pulse(t, 4.0, 0.06, 0.18) + 0.08 * (pulse(t, 4.75, 0.05, 0.15) + pulse(t, 5.5, 0.05, 0.15) + pulse(t, 6.25, 0.05, 0.15))
      + 0.75 * pulse(t, 7.0, 0.12, 0.3) + 0.55 * pulse(t, 9.0, 0.03, 0.4);
    bloom.strength = 0.45;
    const u = boxL.material.uniforms;
    u.uTime.value = t;
    u.uTint.value.set(1, 1, 1);

    if (t < 4.0) {
      // 1 + 2: mystery, then the reveal and the dive toward the date.
      grade.uniforms.uFade.value = smooth(0.0, 0.6, t);
      const v = spline([[0, 0.5, 0.44, 1.08], [2.0, 0.49, 0.42, 0.92], [2.6, 0.5, 0.47, 0.94], [4.0, P.date[0], P.date[1], 0.36]], t);
      const fh = frame(boxL, v[0], v[1], v[2]);
      fill(fillBox, boxL, fh, 0.1 * smooth(0.2, 2.6, t));
      // A pool of warm light drifts over the lid before the box is fully lit.
      const lp = spline([[0, 0.22, 0.12], [1.2, 0.36, 0.2], [2.0, 0.5, 0.42], [4, 0.45, 0.55]], t);
      u.uLight.value.set(lp[0], lp[1], lerp(0.16, 0.55, smooth(0.0, 2.3, t)));
      u.uLightAmt.value = 1.25 * smooth(0.05, 1.0, t) * (1 - 0.85 * smooth(2.0, 2.7, t));
      u.uAmbient.value = 0.04 + 0.96 * smooth(2.0, 2.7, t);
      u.uExposure.value = 1.0;
      u.uSweep.value = lerp(-0.2, 1.6, range(t, 1.85, 2.9));
      u.uSweepAmt.value = smooth(1.8, 2.0, t) * (1 - smooth(2.8, 3.0, t)) + 0.5 * smooth(0.2, 1.2, t) * (1 - smooth(1.6, 1.9, t));
      u.uGlint.value = 0.25 + 0.5 * smooth(2.0, 2.6, t);
      const push = range(t, 2.6, 4.0);
      u.uPar.value.set(0.012 * Math.sin(t * 0.7) + 0.02 * easeInOutCubic(push), -0.008 + 0.014 * easeInOutCubic(push));
      u.uFocus.value.set(...P.date);
      u.uFocusR.value = lerp(0.3, 0.09, easeInOutCubic(push));
      u.uDof.value = smooth(2.8, 3.8, t);
      bloom.strength = 0.4 + 0.25 * smooth(2.0, 2.6, t);
      dustSet({ ambient: 0.1 + 0.25 * smooth(1.5, 3, t), beam: 2.4 * smooth(1.9, 2.6, t), beamPos: [0.4, 6, 0], beamR: 0.9, gold: 0.18 });
    } else if (t < 7.0) {
      // 3: macro tour of the four chocolates, one per beat.
      const i = Math.min(3, Math.floor((t - 4.0) / 0.75));
      const k = (t - 4.0 - i * 0.75) / 0.75;
      const s = TOUR[i];
      const fh = frame(boxL, s.at[0] + s.drift[0] * (k - 0.5), s.at[1] + s.drift[1] * (k - 0.5), lerp(0.33, 0.27, easeOutCubic(k)));
      fill(fillBox, boxL, fh, 0.08);
      u.uLight.value.set(s.at[0] - 0.05, s.at[1] - 0.06, 0.2);
      u.uLightAmt.value = 0.3;
      u.uAmbient.value = 0.95;
      u.uExposure.value = s.exposure ?? 1.02;
      u.uFocus.value.set(...s.at);
      u.uFocusR.value = 0.075;
      u.uDof.value = 1;
      u.uPar.value.set(0.03 * (k - 0.5) * (i % 2 ? -1 : 1), 0.012 * (k - 0.5));
      u.uSweep.value = lerp(s.at[0] * 0.8 + s.at[1] * 0.6 - 0.15, s.at[0] * 0.8 + s.at[1] * 0.6 + 0.15, k);
      u.uSweepAmt.value = 0.7;
      u.uGlint.value = 0.35;
      bloom.strength = 0.55;
      caption = { alpha: smooth(0.05, 0.3, k) * (1 - smooth(0.8, 1.0, k)), ...s };
      dustSet({ ambient: 0.3, size: 0.012, gold: 0.4, blur: 1.2 });
    } else if (t < 9.0) {
      // 4: the client's Sahara photograph behind the date chocolate.
      const l = t - 7.0;
      const portrait = W < H;
      const su = saharaL.material.uniforms;
      const v = portrait
        ? [0.5, lerp(0.5, 0.48, l / 2), lerp(1.04, 0.94, easeInOutSine(l / 2))]
        : [0.5, 0.47, lerp(0.34, 0.31, easeInOutSine(l / 2))];
      const fh = frame(saharaL, v[0], v[1], v[2]);
      fill(fillSahara, saharaL, fh, 0.6);
      su.uTime.value = t;
      su.uPar.value.set(0.012 * (l - 1), 0.004 * (l - 1));
      su.uHaze.value = 1;
      su.uExposure.value = 1.0 + 0.08 * Math.sin(l * 2.2);
      su.uAmbient.value = 1;
      grade.uniforms.uVignette.value = 0.6;
      // The date floats in the dark sand below the caravan.
      dateL.visible = shadow.visible = true;
      const A = W / H;
      const dw = portrait ? 0.62 * A : 0.36;
      const pos = portrait ? [0, -0.28] : [0.48, -0.2];
      const bob = 0.012 * Math.sin(l * 2.4);
      const sc = (dw / dateAspect) * fh * lerp(0.96, 1.04, easeInOutSine(l / 2));
      dateL.scale.setScalar(sc);
      dateL.rotation.z = 0.09 * Math.sin(l * 1.1) - 0.04;
      dateL.position.set(cam.position.x + pos[0] * fh, cam.position.y + (pos[1] + bob) * fh, 0);
      dateMat.uniforms.uSweep.value = lerp(-0.6, 1.2, range(l, 0.3, 1.8));
      dateMat.uniforms.uRim.value = 1;
      dateMat.uniforms.uExposure.value = 1.15;
      shadow.scale.set(sc * dateAspect * 0.9, sc * 0.22, 1);
      shadow.position.set(dateL.position.x, dateL.position.y - sc * 0.62 - bob * fh * 0.5, 0);
      shadow.material.uniforms.uAmt.value = 0.55 - bob * 8;
      dustSet({ ambient: 0.45, size: 0.013, gold: 0.5, wind: [0.02, 0.004, 0], blur: 0.8 });
    } else {
      // 5: packshot.
      const portrait = W < H;
      const s = easeOutCubic(range(t, 9.0, 9.7));
      const fh = portrait ? frame(boxL, 0.5, 0.71, lerp(1.06, 1.0, s)) : frame(boxL, 0.5, 0.68, lerp(1.58, 1.5, s));
      fill(fillBox, boxL, fh, 0.12);
      u.uLight.value.set(0.5, 0.42, 0.6);
      u.uLightAmt.value = 0.25;
      u.uAmbient.value = 1.0;
      u.uExposure.value = 1.05;
      u.uDof.value = 0;
      u.uPar.value.set(0, 0);
      u.uSweep.value = lerp(-0.2, 1.6, range(t, 9.05, 9.8));
      u.uSweepAmt.value = 1.0;
      u.uGlint.value = 0.7;
      bloom.strength = 0.5;
      dustSet({ ambient: 0.22, gold: 0.4 });
    }
  }

  function renderAt(t) {
    t = clamp(t, 0, DURATION - 1e-4);
    update(t);
    composer.render();
    ctx2d.drawImage(glCanvas, 0, 0);
    if (caption) drawCaption(ctx2d, W, H, caption.alpha, caption.title, caption.sub);
    drawTitle(ctx2d, W, H, t - 9.0, { portrait: 0.765, landscape: 0.84 });
    return out;
  }

  return { canvas: out, renderAt, resize, scene, get size() { return [W, H]; } };
}
