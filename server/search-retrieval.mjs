import { setTimeout as pause } from 'node:timers/promises';
import { commonsImageUrl } from '../src/lib/image-research.mjs';

export const plainText = (value, max = 2400) =>
  String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const userAgent = 'Findwhere/1.0 (https://github.com/saad2jz/findwhere)';
export function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

// Destinations are fixed. Retrieved URLs are citations, never crawl targets.
export function createDocumentSearch({ fetcher = fetch, braveKey = '' } = {}) {
  let lastStart = -Infinity;
  return async (query, signal) => {
    const deadline = Date.now() + 5000;
    while (Date.now() - lastStart < 1100) {
      const delay = 1100 - (Date.now() - lastStart);
      if (Date.now() + delay > deadline) throw new Error('Document search busy');
      await pause(delay, undefined, { signal });
    }
    lastStart = Date.now();
    const url = new URL(
      braveKey
        ? 'https://api.search.brave.com/res/v1/web/search'
        : 'https://en.wikipedia.org/w/api.php',
    );
    url.search = new URLSearchParams(
      braveKey
        ? { q: query, count: '5', extra_snippets: 'true', safesearch: 'moderate' }
        : {
            action: 'query',
            format: 'json',
            list: 'search',
            srsearch: query,
            srlimit: '3',
            utf8: '1',
          },
    ).toString();
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
        ...(braveKey ? { 'X-Subscription-Token': braveKey } : {}),
      },
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) throw new Error('Document search unavailable');
    const data = await response.json();
    if (data.error) throw new Error('Document search unavailable');
    return (braveKey ? data.web?.results || [] : data.query?.search || [])
      .slice(0, 5)
      .flatMap((item) => {
        const link = safeSourceUrl(
          braveKey
            ? item.url
            : `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title || '').replaceAll(' ', '_'))}`,
        );
        const title = plainText(item.title, 300);
        if (!link || !title) return [];
        return [
          {
            kind: braveKey ? 'web' : 'article',
            title,
            url: link,
            text: plainText(
              braveKey
                ? [item.description, ...(item.extra_snippets || []).slice(0, 2)]
                    .filter(Boolean)
                    .join(' ')
                : item.snippet,
            ),
          },
        ];
      });
  };
}

export async function downloadReference(value, { fetcher = fetch, signal } = {}) {
  const url = commonsImageUrl(value);
  if (!url || new URL(url).port) throw new Error('Invalid reference destination');
  const response = await fetcher(url, {
    headers: { 'User-Agent': userAgent, Accept: 'image/jpeg,image/png,image/webp' },
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  });
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(mime))
    throw new Error('Reference image unavailable');
  const max = 1_000_000;
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel();
    throw new Error('Reference image too large');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      length += chunk.length;
      if (length > max) throw new Error('Reference image too large');
      chunks.push(chunk);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = Buffer.concat(chunks);
  const valid =
    mime === 'image/jpeg'
      ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : mime === 'image/png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error('Invalid reference image');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
