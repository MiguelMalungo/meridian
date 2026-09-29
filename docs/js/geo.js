// Spherical math + formatting shared by the globe and the HUD.

export const EARTH_KM = 6371;
const RAD = Math.PI / 180;

// Globe convention: lon 0 faces +Z, north is +Y.
export function latLonToXYZ(lat, lon, r = 1) {
  const phi = lat * RAD;
  const lam = lon * RAD;
  return [r * Math.cos(phi) * Math.sin(lam), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lam)];
}

export function distanceKm(a, b) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Initial great-circle bearing from a to b, degrees clockwise from north.
export function bearingDeg(a, b) {
  const p1 = a.lat * RAD;
  const p2 = b.lat * RAD;
  const dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// Block time: cruise ~840 km/h plus ~40 min taxi/climb/descent.
export function flightHours(km) {
  return km / 840 + 0.67;
}

export const CO2_KG_PER_KM = 0.15; // economy long-haul, incl. non-CO2 effects (approx.)

// ------------------------------------------------------------ formatting
export const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

export function fmtCoord(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`;
}

export function fmtHours(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}H ${String(mm).padStart(2, '0')}M`;
}

export function fmtOffset(mins) {
  const sign = mins >= 0 ? '+' : '−';
  const a = Math.abs(mins);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}H`;
}

export function timeIn(tz, date = new Date(), seconds = false) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: 'h23',
    }).format(date);
  } catch {
    return '--:--';
  }
}

// ------------------------------------------------------------ dates
export const DAY_MS = 86400000;

export function parseDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / DAY_MS);
}

export function fmtDay(iso) {
  return parseDay(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
}

// Trip phase derived from dates; stored status only distinguishes confirmed/planned.
export function tripPhase(trip, today = todayISO()) {
  if (trip.ret < today) return 'completed';
  if (trip.depart <= today) return 'active';
  return trip.status;
}
