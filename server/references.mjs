import { commonsImageUrl } from '../src/lib/image-research.mjs';
import { setTimeout as pause } from 'node:timers/promises';

const plain = (value) =>
  String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

export function normalizeReferences(raw) {
  return (raw.query?.pages || [])
    .slice()
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
        },
      ];
    })
    .slice(0, 6);
}

export function createReferenceSearch({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  let lastStart = -Infinity;
  return async (query, { waitForSlot = false, signal } = {}) => {
    const key = query.toLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.time < 600_000) return cached.results;
    const deadline = Date.now() + 5000;
    while (now() - lastStart < 1100) {
      const delay = 1100 - (now() - lastStart);
      if (!waitForSlot || Date.now() + delay > deadline) return null;
      await pause(delay, undefined, { signal });
    }
    lastStart = now();
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '6',
      prop: 'imageinfo',
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
    const raw = await response.json();
    if (raw.error) throw new Error('Reference search unavailable');
    const results = normalizeReferences(raw);
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(key, { time: now(), results });
    return results;
  };
}
