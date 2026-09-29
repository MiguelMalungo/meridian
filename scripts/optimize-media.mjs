// Shrink rendered stills in docs/media to web-sized JPEGs before committing.
// Converts every PNG/WebP still to a 1280px-wide JPEG, points the private
// render log (data/renders.json) and the public list (docs/media/index.json)
// at it, and deletes the original. Uses macOS `sips` (no dependencies).
// Safe to run while renders are in progress: conversion happens first, then
// the render log is re-read and updated in one quick step.
//   node scripts/optimize-media.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'docs', 'media');
const LOG = path.join(ROOT, 'data', 'renders.json');
const PUBLIC = path.join(MEDIA, 'index.json');
const WIDTH = '1280';
const QUALITY = '76';

const readLog = async () => JSON.parse(await fs.readFile(LOG, 'utf8'));
const writeJson = async (file, value) => {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
};

// 1. Convert, without touching the render log.
const converted = new Map(); // old relative path → new relative path
let before = 0;
let after = 0;
for (const [code, entry] of Object.entries((await readLog()).recon || {})) {
  const still = entry.image;
  if (!still || /\.jpe?g$/i.test(still.file)) continue;
  const src = path.join(MEDIA, path.basename(still.file));
  const dest = src.replace(/\.[a-z0-9]+$/i, '.jpg');
  try {
    before += (await fs.stat(src)).size;
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', QUALITY, '-Z', WIDTH, src, '--out', dest], { stdio: 'ignore' });
    after += (await fs.stat(dest)).size;
    converted.set(still.file, `media/${path.basename(dest)}`);
  } catch (err) {
    console.error(`${code}: ${err.message}`);
  }
}

// 2. Re-read, repoint, and regenerate the public list in one quick step.
const log = await readLog();
const recon = {};
for (const [code, entry] of Object.entries(log.recon || {})) {
  if (entry.image && converted.has(entry.image.file)) entry.image.file = converted.get(entry.image.file);
  for (const kind of ['image', 'video']) {
    if (entry[kind]?.file) (recon[code] ??= {})[kind] = { file: entry[kind].file };
  }
}
await writeJson(LOG, log);
await writeJson(PUBLIC, { recon });

// 3. Remove the originals.
for (const old of converted.keys()) await fs.unlink(path.join(MEDIA, path.basename(old))).catch(() => {});

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`Converted ${converted.size} stills: ${mb(before)} MB → ${mb(after)} MB`);
