import { renderSoundtrack, renderAsselSoundtrack, encodeWav } from './audio.js';

const params = new URLSearchParams(location.search);
// Films in this project. ?film=assel (default) | ebcore | 3d
const FILMS = {
  assel: { module: './film-assel.js', name: 'assel', brand: 'ASSEL', score: async () => renderAsselSoundtrack(undefined, (await (await fetch('themes/themes.json')).json()).themes.map((t) => t.id)) },
  ebcore: { module: './film-photo.js', name: 'ebcore', brand: 'EBCORE', score: () => renderSoundtrack(undefined, { variant: 'tour' }) },
  '3d': { module: './film.js', name: 'ebcore-3d', brand: 'EBCORE', score: () => renderSoundtrack(undefined, { variant: 'crack' }) },
};
const FILM = FILMS[params.get('film')] || FILMS.assel;
const { createFilm, DURATION } = await import(FILM.module);
const FORMATS = { '9x16': [1080, 1920], '16x9': [1920, 1080] };

// --- Capture mode: driven frame by frame by tools/render.mjs.
if (params.has('capture')) {
  const [w, h] = FORMATS[params.get('format')] || FORMATS['9x16'];
  const film = await createFilm({ width: w, height: h });
  document.body.appendChild(film.canvas);
  window.EB = {
    size: film.size,
    scene: film.scene,
    duration: DURATION,
    name: FILM.name,
    frame(t, type = 'image/png') {
      return film.renderAt(t).toDataURL(type);
    },
    async soundtrackWav() {
      const wav = new Uint8Array(encodeWav(await FILM.score()));
      let s = '';
      for (let i = 0; i < wav.length; i += 0x8000) s += String.fromCharCode(...wav.subarray(i, i + 0x8000));
      return btoa(s);
    },
  };
  window.EB_READY = true;
} else {
  player();
}

async function player() {
  const stage = document.getElementById('stage');
  const startBtn = document.getElementById('start');
  const replayBtn = document.getElementById('replay');
  const fmtBtns = [...document.querySelectorAll('[data-format]')];
  const timeBar = document.getElementById('progress');
  const status = document.getElementById('status');

  let format = params.get('format') === '16x9' ? '16x9' : '9x16';
  const still = params.has('t') ? parseFloat(params.get('t')) : null;

  document.getElementById('brand').textContent = FILM.brand;
  document.title = `${FILM.brand} — Publicité ${DURATION} s`;
  status.textContent = 'Préparation de la scène…';
  const film = await createFilm({ width: 2, height: 2 });
  stage.appendChild(film.canvas);

  function layout() {
    const [fw, fh] = FORMATS[format];
    const vw = innerWidth - 32, vh = innerHeight - 140;
    const s = Math.min(vw / fw, vh / fh);
    const cw = Math.max(1, Math.floor(fw * s)), ch = Math.max(1, Math.floor(fh * s));
    stage.style.width = `${cw}px`;
    stage.style.height = `${ch}px`;
    film.canvas.style.width = '100%';
    film.canvas.style.height = '100%';
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // Render at least at the canvas's on-screen size, capped at the export size.
    const k = Math.min(1, (cw * dpr) / fw);
    film.resize(Math.round(fw * k), Math.round(fh * k), 1);
    fmtBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.format === format)));
  }

  let audioCtx = null, buffer = null, source = null, t0 = 0, playing = false, last = 0;

  function frame() {
    if (!playing) return;
    const t = audioCtx.currentTime - t0;
    last = Math.min(t, DURATION);
    film.renderAt(last);
    timeBar.style.transform = `scaleX(${last / DURATION})`;
    if (t >= DURATION) {
      playing = false;
      document.body.classList.add('ended');
      return;
    }
    requestAnimationFrame(frame);
  }

  async function play() {
    if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 48000 });
    await audioCtx.resume();
    if (source) source.stop();
    source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    // Audio clock is the master clock: picture follows the soundtrack exactly.
    t0 = audioCtx.currentTime + 0.05;
    source.start(t0);
    playing = true;
    document.body.classList.remove('ended');
    document.body.classList.add('playing');
    requestAnimationFrame(frame);
  }

  layout();
  addEventListener('resize', () => { layout(); if (!playing) film.renderAt(still ?? last); });
  fmtBtns.forEach((b) => b.addEventListener('click', () => {
    format = b.dataset.format;
    layout();
    if (!playing) film.renderAt(still ?? last);
  }));

  if (still !== null) {
    film.renderAt(still);
    status.textContent = `Image fixe à ${still.toFixed(2)} s`;
    document.body.classList.add('still');
    return;
  }

  film.renderAt(0);
  status.textContent = 'Composition de la bande-son…';
  buffer = await FILM.score();
  status.textContent = '';
  startBtn.disabled = false;
  startBtn.addEventListener('click', play);
  replayBtn.addEventListener('click', play);

  // Offer the rendered MP4s only if they have been exported.
  for (const a of document.querySelectorAll('[data-mp4]')) {
    a.href = `export/${FILM.name}-${a.dataset.mp4}.mp4`;
    fetch(a.getAttribute('href'), { method: 'HEAD' }).then((r) => { if (r.ok) a.hidden = false; }).catch(() => {});
  }
}
