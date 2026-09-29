// MERIDIAN — local server
// Serves the atlas, stores trip state, and proxies the image-render API so the
// key never reaches the browser. Zero dependencies: `node server.mjs`.
// Render provider details live only in .env (see .env.example).

import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'docs');
const DATA_DIR = path.join(ROOT, 'data');
const MEDIA_DIR = path.join(PUBLIC_DIR, 'media');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
// Full render records (prompts, request ids, provider URLs) stay private...
const RECON_FILE = path.join(DATA_DIR, 'renders.json');
// ...the published site only gets a list of image files.
const PUBLIC_MANIFEST = path.join(MEDIA_DIR, 'index.json');

// ---------------------------------------------------------------- env
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 4317;
const HOST = process.env.HOST || '127.0.0.1';
const RENDER_BASE = (process.env.RENDER_API_BASE || '').trim().replace(/\/+$/, '');

// Endpoints the atlas may call, configured in .env.
const RENDER_MODELS = Object.fromEntries(
  [['image', process.env.RENDER_IMAGE_MODEL], ['video', process.env.RENDER_VIDEO_MODEL]]
    .filter(([, v]) => v && v.trim())
    .map(([k, v]) => [k, v.trim()]),
);

// RENDER_API_KEY is "KEY_ID:KEY_SECRET".
function renderKey() {
  const key = (process.env.RENDER_API_KEY || '').trim();
  return /^[^:\s]+:[^:\s]+$/.test(key) ? key : null;
}
const renderReady = () => Boolean(renderKey() && RENDER_BASE && RENDER_MODELS.image);

const ASPECTS = new Set(['16:9', '9:16', '4:3', '3:4', '1:1', '2:3', '3:2']);
const RESOLUTIONS = new Set(['720p', '1080p']);

function sanitizeInput(kind, input = {}) {
  const prompt = String(input.prompt || '').slice(0, 2400).trim();
  if (!prompt) throw httpError(400, 'Prompt is required');
  if (kind === 'image') {
    return {
      prompt,
      aspect_ratio: ASPECTS.has(input.aspect_ratio) ? input.aspect_ratio : '16:9',
      resolution: RESOLUTIONS.has(input.resolution) ? input.resolution : '1080p',
      enhance_prompt: Boolean(input.enhance_prompt),
      batch_size: 1,
    };
  }
  if (kind === 'video') {
    const url = String(input.image_url || '');
    if (!/^https:\/\//.test(url)) throw httpError(400, 'A public https image_url is required for video');
    const duration = Math.min(15, Math.max(3, Math.round(Number(input.duration) || 5)));
    return {
      prompt,
      image_url: url,
      duration,
      resolution: RESOLUTIONS.has(input.resolution) ? input.resolution : '720p',
    };
  }
  throw httpError(400, 'Unknown generation kind');
}

// ---------------------------------------------------------------- helpers
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Invalid JSON body');
  }
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

// ---------------------------------------------------------------- trip state
function isoDay(offsetDays) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function seedState() {
  const trip = (id, city, start, days, status, note) => ({
    id, city, depart: isoDay(start), ret: isoDay(start + days), status, note,
  });
  return {
    home: null,
    trips: [
      trip('t1', 'REK', -128, 6, 'confirmed', 'Aurora hunt, Golden Circle'),
      trip('t2', 'RAK', -41, 5, 'confirmed', 'Medina + Atlas day trip'),
      trip('t3', 'TYO', 17, 11, 'confirmed', 'Tokyo → Kyoto rail leg'),
      trip('t4', 'ZQN', 63, 9, 'planned', 'Milford Sound flyover'),
      trip('t5', 'CUZ', 118, 8, 'planned', 'Inca Trail permit pending'),
      trip('t6', 'CPT', 171, 7, 'planned', 'Cape Peninsula drive'),
      trip('t7', 'TOS', 45, 5, 'planned', 'Polar night, northern lights'),
    ],
  };
}

function validateState(body) {
  const home = typeof body.home === 'string' && /^[A-Z]{3}$/.test(body.home) ? body.home : null;
  if (!Array.isArray(body.trips)) throw httpError(400, 'trips must be an array');
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const trips = body.trips.slice(0, 200).map((t) => {
    if (!/^[A-Z]{3}$/.test(t.city) || !day.test(t.depart) || !day.test(t.ret)) {
      throw httpError(400, 'Invalid trip entry');
    }
    return {
      id: String(t.id || '').slice(0, 40) || `t${Date.now().toString(36)}`,
      city: t.city,
      depart: t.depart,
      ret: t.ret < t.depart ? t.depart : t.ret,
      status: t.status === 'planned' ? 'planned' : 'confirmed',
      note: String(t.note || '').slice(0, 140),
    };
  });
  return { home, trips };
}

// ---------------------------------------------------------------- render API
async function renderApi(method, pathname, body) {
  const creds = renderKey();
  if (!creds || !RENDER_BASE) throw httpError(503, 'Rendering is not configured on the server');
  const res = await fetch(`${RENDER_BASE}/${pathname}`, {
    method,
    headers: {
      Authorization: `Key ${creds}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: text.slice(0, 400) };
  }
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? data);
    throw httpError(res.status, `Render API ${res.status}: ${detail}`);
  }
  return data;
}

const emptyRecon = () => ({ recon: {}, jobs: {} });
let reconLock = Promise.resolve();
// Serialise read-modify-write of the media index.
function withRecon(fn) {
  const run = reconLock.then(async () => {
    const idx = await readJson(RECON_FILE, emptyRecon());
    idx.recon ??= {};
    idx.jobs ??= {};
    const out = await fn(idx);
    await writeJson(RECON_FILE, idx);
    await writeJson(PUBLIC_MANIFEST, publicManifest(idx));
    return out;
  });
  reconLock = run.catch(() => {});
  return run;
}

// What the static site needs: just the file for each still / flyover.
function publicManifest(idx) {
  const recon = {};
  for (const [code, entry] of Object.entries(idx.recon || {})) {
    for (const kind of ['image', 'video']) {
      if (entry[kind]?.file) (recon[code] ??= {})[kind] = { file: entry[kind].file };
    }
  }
  return { recon };
}

// One-time move of full records out of the published folder.
async function migrateRenderIndex() {
  if (existsSync(RECON_FILE)) return;
  const legacy = await readJson(PUBLIC_MANIFEST, null);
  const hasPrivate = legacy && (legacy.jobs || Object.values(legacy.recon || {}).some((e) => e.image?.prompt || e.video?.prompt));
  if (!hasPrivate) return;
  await writeJson(RECON_FILE, { recon: legacy.recon || {}, jobs: legacy.jobs || {} });
  await writeJson(PUBLIC_MANIFEST, publicManifest(legacy));
}

function outputUrl(result) {
  return result?.video?.url || result?.images?.[0]?.url || null;
}

function extensionFor(url, contentType = '') {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('mp4')) return 'mp4';
  if (contentType.includes('webm')) return 'webm';
  const m = new URL(url).pathname.match(/\.(png|jpe?g|webp|mp4|webm|mov)$/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'bin';
}

const downloading = new Map();
async function archiveOutput(requestId, job, remoteUrl) {
  if (downloading.has(requestId)) return downloading.get(requestId);
  const task = (async () => {
    const res = await fetch(remoteUrl);
    if (!res.ok) throw httpError(502, `Could not download output (${res.status})`);
    const ext = extensionFor(remoteUrl, res.headers.get('content-type') || '');
    const name = `${job.cityId}-${job.kind}-${requestId.slice(0, 8)}.${ext}`;
    await fs.writeFile(path.join(MEDIA_DIR, name), Buffer.from(await res.arrayBuffer()));
    return withRecon((idx) => {
      const entry = {
        file: `media/${name}`,
        remoteUrl,
        requestId,
        prompt: job.prompt,
        createdAt: new Date().toISOString(),
      };
      idx.recon[job.cityId] ??= {};
      idx.recon[job.cityId][job.kind] = entry;
      delete idx.jobs[requestId];
      return entry;
    });
  })();
  downloading.set(requestId, task);
  try {
    return await task;
  } finally {
    downloading.delete(requestId);
  }
}

// ---------------------------------------------------------------- routes
async function handleApi(req, res, url) {
  const { pathname } = url;

  if (pathname === '/api/state' && req.method === 'GET') {
    let state = await readJson(STATE_FILE, null);
    if (!state) {
      state = seedState();
      await writeJson(STATE_FILE, state);
    }
    return send(res, 200, state);
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    const state = validateState(await readBody(req));
    await writeJson(STATE_FILE, state);
    return send(res, 200, state);
  }

  if (pathname === '/api/render/status' && req.method === 'GET') {
    return send(res, 200, { configured: renderReady(), video: Boolean(RENDER_MODELS.video) });
  }

  if (pathname === '/api/renders' && req.method === 'GET') {
    return send(res, 200, await readJson(RECON_FILE, emptyRecon()));
  }

  if (pathname === '/api/render/estimate' && req.method === 'POST') {
    const { kind, input } = await readBody(req);
    if (!RENDER_MODELS[kind]) throw httpError(400, 'Unknown generation kind');
    const data = await renderApi('POST', `estimate/${RENDER_MODELS[kind]}`, sanitizeInput(kind, input));
    return send(res, 200, data);
  }

  if (pathname === '/api/render/generate' && req.method === 'POST') {
    const { kind, cityId, input } = await readBody(req);
    if (!RENDER_MODELS[kind]) throw httpError(400, 'Unknown generation kind');
    if (!/^[A-Z]{3}$/.test(cityId || '')) throw httpError(400, 'Invalid cityId');
    const clean = sanitizeInput(kind, input);
    const data = await renderApi('POST', RENDER_MODELS[kind], clean);
    if (!data.request_id) throw httpError(502, 'Render API did not return a request id');
    await withRecon((idx) => {
      idx.jobs[data.request_id] = { cityId, kind, prompt: clean.prompt, createdAt: new Date().toISOString() };
    });
    return send(res, 202, { request_id: data.request_id, status: data.status || 'queued' });
  }

  const statusMatch = pathname.match(/^\/api\/render\/requests\/([0-9a-f-]{36})$/i);
  if (statusMatch && req.method === 'GET') {
    const id = statusMatch[1];
    const result = await renderApi('GET', `requests/${id}/status`);
    const idx = await readJson(RECON_FILE, emptyRecon());
    const job = idx.jobs?.[id];
    if (result.status === 'completed') {
      const remote = outputUrl(result);
      if (job && remote) {
        const entry = await archiveOutput(id, job, remote);
        return send(res, 200, { status: 'completed', cityId: job.cityId, kind: job.kind, entry });
      }
      return send(res, 200, { status: 'completed', remoteUrl: remote });
    }
    if (['failed', 'nsfw', 'canceled'].includes(result.status)) {
      await withRecon((i) => { delete i.jobs[id]; });
      return send(res, 200, { status: result.status, error: result.error || null });
    }
    return send(res, 200, { status: result.status });
  }

  const cancelMatch = pathname.match(/^\/api\/render\/requests\/([0-9a-f-]{36})\/cancel$/i);
  if (cancelMatch && req.method === 'POST') {
    await renderApi('POST', `requests/${cancelMatch[1]}/cancel`);
    await withRecon((i) => { delete i.jobs[cancelMatch[1]]; });
    return send(res, 200, { status: 'canceled' });
  }

  throw httpError(404, 'Not found');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, url) {
  const inMedia = url.pathname.startsWith('/media/');
  const base = inMedia ? MEDIA_DIR : PUBLIC_DIR;
  const rel = decodeURIComponent(inMedia ? url.pathname.slice('/media/'.length) : url.pathname);
  let file = path.resolve(base, `.${path.sep}${rel}`);
  if (!file.startsWith(base)) return send(res, 403, 'Forbidden');
  if (!inMedia && (rel === '/' || rel === '')) file = path.join(PUBLIC_DIR, 'index.html');
  try {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) file = path.join(file, 'index.html');
    const data = await fs.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': inMedia ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    send(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return await serveStatic(req, res, url);
  } catch (err) {
    const status = err.status && err.status >= 400 ? err.status : 500;
    if (status >= 500) console.error('[meridian]', err);
    send(res, status, { error: err.message || 'Server error' });
  }
});

await fs.mkdir(DATA_DIR, { recursive: true });
await fs.mkdir(MEDIA_DIR, { recursive: true });
await migrateRenderIndex();

server.listen(PORT, HOST, () => {
  const link = renderReady() ? 'ONLINE' : 'OFF (configure RENDER_* in .env)';
  console.log(`\n  MERIDIAN flight atlas  →  http://localhost:${PORT}`);
  console.log(`  Renders                →  ${link}\n`);
});
