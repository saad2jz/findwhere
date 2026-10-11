import { setTimeout as pause } from 'node:timers/promises';

export class GeocoderBusy extends Error {}

export function createGeocoder({ fetcher = fetch, now = Date.now, url: endpoint, userAgent }) {
  let lastStart = -Infinity;
  const cache = new Map();
  const pending = new Map();
  async function search(query, { waitForSlot = false } = {}) {
    const key = query.trim().toLocaleLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.time < 24 * 60 * 60 * 1000) return cached.results;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      const deadline = Date.now() + 5000;
      while (now() - lastStart < 1100) {
        const delay = 1100 - (now() - lastStart);
        if (!waitForSlot || Date.now() + delay > deadline) throw new GeocoderBusy('Geocoder busy');
        await pause(delay);
      }
      lastStart = now();
      const url = new URL(endpoint);
      url.search = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        addressdetails: '1',
        limit: '5',
      }).toString();
      const response = await fetcher(url, {
        headers: { 'User-Agent': userAgent, Accept: 'application/json', 'Accept-Language': 'en' },
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Geocoder unavailable');
      const raw = await response.json();
      if (!Array.isArray(raw)) throw new Error('Invalid geocoder response');
      const results = raw
        .slice(0, 5)
        .map((item) => ({
          name: String(item.display_name || '').slice(0, 300),
          country: String(item.address?.country || '').slice(0, 100),
          category: String(item.class || item.category || '').slice(0, 80),
          lat: Number(item.lat),
          lng: Number(item.lon),
        }))
        .filter(
          (item) =>
            item.name &&
            Number.isFinite(item.lat) &&
            Number.isFinite(item.lng) &&
            Math.abs(item.lat) <= 90 &&
            Math.abs(item.lng) <= 180,
        );
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, { time: now(), results });
      return results;
    })();
    pending.set(key, task);
    try {
      return await task;
    } finally {
      pending.delete(key);
    }
  }
  return { search };
}
