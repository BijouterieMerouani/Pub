#!/usr/bin/env node
// Renders the EBCORE film frame by frame in headless Chromium and encodes it
// with ffmpeg, muxing the synthesized soundtrack.
//
//   node tools/render.mjs                      # both formats -> ad/export/*.mp4
//   node tools/render.mjs --format 9x16 --fps 30
//   node tools/render.mjs --film 3d               # procedural 3D cut -> ad/export/ebcore-3d-*.mp4
//   node tools/render.mjs --stills 0.5,2.4,5.6 --format 16x9 --out /tmp/stills
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'ad');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
);
const FPS = Number(args.fps || 30);
const DURATION = 10;
const formats = args.format && args.format !== true ? [args.format] : ['9x16', '16x9'];
const outDir = path.resolve(args.out && args.out !== true ? args.out : path.join(ROOT, 'export'));
const FILM = args.film === '3d' ? '3d' : 'photo';
const SUFFIX = FILM === '3d' ? '-3d' : '';
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const MIME = { '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.png': 'image/png' };
function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

async function openFilm(browser, port, format) {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/index.html?capture=1&format=${format}&film=${FILM}`);
  await page.waitForFunction(() => window.EB_READY === true, null, { timeout: 120000 });
  return page;
}

const dataUrlToBuffer = (s) => Buffer.from(s.slice(s.indexOf(',') + 1), 'base64');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    if (args.stills) {
      const times = String(args.stills).split(',').map(Number);
      for (const format of formats) {
        const page = await openFilm(browser, port, format);
        for (const t of times) {
          const file = path.join(outDir, `still${SUFFIX}-${format}-${t.toFixed(2)}.png`);
          fs.writeFileSync(file, dataUrlToBuffer(await page.evaluate((tt) => window.EB.frame(tt), t)));
          console.log('wrote', file);
        }
        await page.close();
      }
      return;
    }

    let wavPath = null;
    for (const format of formats) {
      const page = await openFilm(browser, port, format);
      if (!wavPath) {
        wavPath = path.join(outDir, `ebcore${SUFFIX}-soundtrack.wav`);
        fs.writeFileSync(wavPath, Buffer.from(await page.evaluate(() => window.EB.soundtrackWav()), 'base64'));
        console.log('wrote', wavPath);
      }
      const mp4 = path.join(outDir, `ebcore${SUFFIX}-${format}.mp4`);
      const ff = spawn('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
        '-i', wavPath,
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
        '-r', String(FPS), '-c:a', 'aac', '-b:a', '256k', '-t', String(DURATION), '-movflags', '+faststart', mp4,
      ], { stdio: ['pipe', 'inherit', 'inherit'] });
      const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
      const frames = Math.round(DURATION * FPS);
      const started = Date.now();
      for (let i = 0; i < frames; i++) {
        const buf = dataUrlToBuffer(await page.evaluate((t) => window.EB.frame(t), i / FPS));
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        if (i % 15 === 0 || i === frames - 1) {
          const el = (Date.now() - started) / 1000;
          process.stdout.write(`\r${format}: frame ${i + 1}/${frames}  ${(el / (i + 1)).toFixed(2)} s/frame  `);
        }
      }
      ff.stdin.end();
      await done;
      console.log(`\nwrote ${mp4}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
