// Batch-render Higgsfield stills through the local Meridian server
// (start it first with `node server.mjs`; the API key never leaves it).
// Usage: [CONCURRENCY=3] node scripts/render-stills.mjs [CODE,CODE,...]
//        no args = every destination that doesn't have a still yet
import { CITIES } from '../docs/js/cities.js';

const BASE = 'http://localhost:4317';
const MAX_USD_PER_STILL = 0.01;
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prompt = (c) => `Cinematic aerial establishing shot of ${c.name}, ${c.country}${c.hint ? `: ${c.hint}` : ''}. Blue-hour light with warm city lights, volumetric atmosphere, crisp detail, sweeping wide-angle composition, travel documentary photography, subtle 35mm film grain, no text.`;
const input = (c) => ({ prompt: prompt(c), aspect_ratio: '16:9', resolution: '1080p' });

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

const only = process.argv[2]?.split(',').map((s) => s.trim().toUpperCase());
const index = await call('GET', '/api/recon');
const todo = CITIES.filter((c) => (!only || only.includes(c.code)) && !index.recon?.[c.code]?.image);

if (!todo.length) console.log('Every destination already has a still.');
const est = await call('POST', '/api/hf/estimate', { kind: 'image', input: input(todo[0] || CITIES[0]) });
const unit = Number(est.usd);
if (!Number.isFinite(unit) || unit > MAX_USD_PER_STILL) {
  console.error(`Aborting: estimate $${est.usd} per still exceeds the $${MAX_USD_PER_STILL} guard`);
  process.exit(1);
}
console.log(`${todo.length} stills to render at $${unit} each ≈ $${(unit * todo.length).toFixed(3)}`);

if (!todo.length) process.exit(0);

const results = [];
let halt = null;
async function renderOne(c) {
  let job;
  for (let attempt = 0; ; attempt++) {
    try {
      job = await call('POST', '/api/hf/generate', { kind: 'image', cityId: c.code, input: input(c) });
      break;
    } catch (err) {
      if (/concurrent/i.test(err.message) && attempt < 240) { await sleep(5000); continue; }
      if (/not_enough_credits|insufficient|balance/i.test(err.message)) halt = 'Higgsfield API balance is empty. Top up at console.higgsfield.ai.';
      return { code: c.code, status: 'error', error: err.message };
    }
  }
  let delay = 3000;
  const started = Date.now();
  for (;;) {
    await sleep(delay);
    let r;
    try {
      r = await call('GET', `/api/hf/requests/${job.request_id}`);
    } catch (err) {
      if (Date.now() - started > 10 * 60 * 1000) return { code: c.code, status: 'timeout', error: err.message };
      continue;
    }
    if (['completed', 'failed', 'nsfw', 'canceled'].includes(r.status)) {
      return { code: c.code, status: r.status, file: r.entry?.file, secs: Math.round((Date.now() - started) / 1000) };
    }
    delay = Math.min(delay * 1.4, 8000);
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length && !halt) {
    const c = queue.shift();
    const r = await renderOne(c);
    results.push(r);
    console.log(`[${results.length}/${todo.length}] ${r.code} ${r.status}${r.file ? ` → ${r.file}` : ''}${r.secs ? ` (${r.secs}s)` : ''}${r.error ? ` ${r.error}` : ''}`);
  }
}));

if (halt) console.error(`Stopped: ${halt}`);
const ok = results.filter((r) => r.status === 'completed').length;
console.log(`Done: ${ok} completed, ${results.length - ok} not completed (not charged).`);
