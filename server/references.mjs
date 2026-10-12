import { commonsImageUrl, nearbyReferenceRequestSchema } from '../src/lib/image-research.mjs';
import { distanceAndBearing } from '../src/lib/geo.mjs';
import { setTimeout as pause } from 'node:timers/promises';

const plain = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

export function normalizeReferences(raw, nearby) {
  const seen = new Set();
  return (Array.isArray(raw.query?.pages) ? raw.query.pages : [])
    .slice(0, nearby ? 12 : 6)
    .sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity))
    .flatMap((page) => {
      const image = page.imageinfo?.[0];
      if (!image || !['image/jpeg', 'image/png', 'image/webp'].includes(image.mime)) return [];
      const thumbnail = commonsImageUrl(image.thumburl || image.url);
      let source;
      try {
        const url = new URL(image.descriptionurl);
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'commons.wikimedia.org' ||
          !url.pathname.startsWith('/wiki/File:') ||
          url.username ||
          url.password
        )
          return [];
        source = url.href;
      } catch {
        return [];
      }
      if (!thumbnail) return [];
      if (seen.has(source)) return [];
      let discovery;
      if (nearby) {
        const coordinate = (Array.isArray(page.coordinates) ? page.coordinates : []).find(
          (point) =>
            point.globe === 'earth' &&
            Number.isFinite(point.lat) &&
            Number.isFinite(point.lon) &&
            Math.abs(point.lat) <= 90 &&
            Math.abs(point.lon) <= 180,
        );
        if (!coordinate) return [];
        const geotag = { lat: coordinate.lat, lng: coordinate.lon };
        const { distanceMetres } = distanceAndBearing(nearby, geotag);
        if (distanceMetres > nearby.radius) return [];
        discovery = { ...nearby, method: 'nearby', geotag, distanceMetres };
      }
      seen.add(source);
      const meta = image.extmetadata || {};
      return [
        {
          title: plain(page.title)
            .replace(/^File:/, '')
            .slice(0, 300),
          thumbnail,
          source,
          attribution:
            [plain(meta.Artist?.value), plain(meta.LicenseShortName?.value)]
              .filter(Boolean)
              .join(' · ') || 'Check author and license on the source page',
          date: plain(meta.DateTimeOriginal?.value),
          ...(discovery ? { discovery } : {}),
        },
      ];
    })
    .sort((a, b) => (nearby ? a.discovery.distanceMetres - b.discovery.distanceMetres : 0))
    .slice(0, 6);
}

async function boundedJson(response) {
  if (Number(response.headers.get('content-length')) > 2_000_000)
    throw new Error('Reference search unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) throw new Error('Reference search unavailable');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createReferenceSearch({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  let lastStart = -Infinity;
  let day = '',
    nearbyCount = 0;
  return async (query, { waitForSlot = false, signal } = {}) => {
    const nearby = typeof query === 'object' ? nearbyReferenceRequestSchema.parse(query) : null;
    const key = nearby ? `nearby:${JSON.stringify(nearby)}` : `text:${query.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached && now() - cached.time < 600_000) return cached.results;
    if (nearby) {
      const today = new Date(now()).toISOString().slice(0, 10);
      if (day !== today) {
        day = today;
        nearbyCount = 0;
      }
      if (nearbyCount >= 90) return null;
    }
    const deadline = Date.now() + 5000;
    while (now() - lastStart < 1100) {
      const delay = 1100 - (now() - lastStart);
      if (!waitForSlot || Date.now() + delay > deadline) return null;
      await pause(delay, undefined, { signal });
    }
    lastStart = now();
    if (nearby) nearbyCount++;
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      ...(nearby
        ? {
            generator: 'geosearch',
            ggscoord: `${nearby.lat}|${nearby.lng}`,
            ggsradius: String(nearby.radius),
            ggsnamespace: '6',
            ggslimit: '12',
            coprimary: 'primary',
            colimit: 'max',
          }
        : {
            generator: 'search',
            gsrsearch: query,
            gsrnamespace: '6',
            gsrlimit: '6',
          }),
      prop: nearby ? 'imageinfo|coordinates' : 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      iiurlwidth: '1280',
      iiextmetadatafilter: 'Artist|LicenseShortName|DateTimeOriginal',
    }).toString();
    const response = await fetcher(url, {
      headers: {
        'User-Agent': 'Findwhere/1.0 (https://github.com/saad2jz/findwhere)',
        Accept: 'application/json',
      },
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Reference search unavailable');
    const raw = nearby ? await boundedJson(response) : await response.json();
    if (raw.error || (nearby && raw.warnings)) throw new Error('Reference search unavailable');
    if (
      nearby &&
      !Array.isArray(raw.query?.pages) &&
      (raw.query || !Object.hasOwn(raw, 'batchcomplete'))
    )
      throw new Error('Reference search unavailable');
    const results = normalizeReferences(raw, nearby);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { time: now(), results });
    return results;
  };
}
