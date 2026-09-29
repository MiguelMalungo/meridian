// Network layer: local server (state + render proxy) and public data feeds.

async function json(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ------------------------------------------------------------ trip state
export const loadState = () => json('/api/state');
export const saveState = (state) => json('/api/state', { method: 'PUT', body: JSON.stringify(state) });

// ------------------------------------------------------------ renders (via local proxy)
export const renderStatus = () => json('/api/render/status');
export const loadRenders = () => json('/api/renders');
export const renderEstimate = (kind, input) =>
  json('/api/render/estimate', { method: 'POST', body: JSON.stringify({ kind, input }) });
export const renderGenerate = (kind, cityId, input) =>
  json('/api/render/generate', { method: 'POST', body: JSON.stringify({ kind, cityId, input }) });
export const renderRequest = (id) => json(`/api/render/requests/${id}`);
export const renderCancel = (id) => json(`/api/render/requests/${id}/cancel`, { method: 'POST' });

// Poll with backoff (2s → 10s, jittered) until a terminal status.
export async function pollRequest(id, onTick, { signal } = {}) {
  let delay = 2000;
  const started = Date.now();
  for (;;) {
    if (signal?.aborted) throw new Error('aborted');
    let res;
    try {
      res = await renderRequest(id);
    } catch (err) {
      if (err.status === 401 || err.status === 404) throw err;
      res = { status: 'retrying' };
    }
    onTick?.(res, Date.now() - started);
    if (['completed', 'failed', 'nsfw', 'canceled'].includes(res.status)) return res;
    if (Date.now() - started > 15 * 60 * 1000) throw new Error('Timed out waiting for the render');
    await new Promise((r) => setTimeout(r, delay + Math.random() * 500));
    delay = Math.min(delay * 1.5, 10000);
  }
}

// ------------------------------------------------------------ weather (Open-Meteo, no key)
const wxCache = new Map();
export async function weather(city) {
  const hit = wxCache.get(city.code);
  if (hit && Date.now() - hit.at < 15 * 60 * 1000) return hit.data;
  const q = new URLSearchParams({
    latitude: city.lat,
    longitude: city.lon,
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,relative_humidity_2m,is_day',
    daily: 'temperature_2m_max,temperature_2m_min,sunrise,sunset,weather_code',
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error('Weather feed unavailable');
  const data = await res.json();
  wxCache.set(city.code, { at: Date.now(), data });
  return data;
}

// Current temperature + 7-day highs/lows for every destination in one request.
export async function weatherAll(cities) {
  const key = 'meridian.wx.v1';
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.at < 30 * 60 * 1000 && cached.n === cities.length) return cached.data;
  } catch { /* storage unavailable */ }
  const q = new URLSearchParams({
    latitude: cities.map((c) => c.lat).join(','),
    longitude: cities.map((c) => c.lon).join(','),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) throw new Error('Weather feed unavailable');
  const body = await res.json();
  const list = Array.isArray(body) ? body : [body];
  const data = {};
  list.forEach((d, i) => {
    if (!cities[i]) return;
    data[cities[i].code] = {
      t: d.current?.temperature_2m,
      w: d.current?.weather_code,
      hi: d.daily?.temperature_2m_max || [],
      lo: d.daily?.temperature_2m_min || [],
    };
  });
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), n: cities.length, data }));
  } catch { /* ignore */ }
  return data;
}

// Wikipedia summary: a short extract, a description and the lead photo (free, no key).
const wikiCache = new Map();
export function wiki(city) {
  if (wikiCache.has(city.code)) return wikiCache.get(city.code);
  const title = encodeURIComponent((city.wiki || city.name).replace(/ /g, '_'));
  const p = fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Wikipedia ${r.status}`))))
    .then((d) => {
      let image = null;
      const orig = d.originalimage;
      if (d.thumbnail?.source) {
        image = orig && orig.width >= 960 ? d.thumbnail.source.replace(/\/\d+px-/, '/960px-') : orig?.source || d.thumbnail.source;
      }
      const sentences = (d.extract || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [];
      let extract = '';
      for (const s of sentences) {
        if (extract && (extract + s).length > 260) break;
        extract += s;
      }
      return { extract: extract.trim(), description: d.description || '', url: d.content_urls?.desktop?.page || '', image };
    });
  wikiCache.set(city.code, p);
  p.catch(() => wikiCache.delete(city.code));
  return p;
}

export function describeWeather(code) {
  if (code === 0) return 'CLEAR';
  if (code <= 2) return 'PARTLY CLOUDY';
  if (code === 3) return 'OVERCAST';
  if (code <= 48) return 'FOG';
  if (code <= 57) return 'DRIZZLE';
  if (code <= 67) return 'RAIN';
  if (code <= 77) return 'SNOW';
  if (code <= 82) return 'SHOWERS';
  if (code <= 86) return 'SNOW SHOWERS';
  return 'THUNDERSTORM';
}

// ------------------------------------------------------------ FX (Frankfurter / ECB, no key)
let fxCache = null;
export async function fxRate(from, to) {
  if (from === to) return 1;
  if (!fxCache || Date.now() - fxCache.at > 6 * 3600 * 1000) {
    const res = await fetch('https://api.frankfurter.dev/v1/latest?base=EUR');
    if (!res.ok) throw new Error('FX feed unavailable');
    const data = await res.json();
    fxCache = { at: Date.now(), rates: { ...data.rates, EUR: 1 } };
  }
  const r = fxCache.rates;
  if (!r[from] || !r[to]) return null;
  return r[to] / r[from];
}
