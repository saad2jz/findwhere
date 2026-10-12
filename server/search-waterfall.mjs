import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createDocumentSearch,
  isRelevantSearchRecord,
  plainText,
  safeSourceUrl,
} from './search-retrieval.mjs';

export const defaultSearchLimits = { tavily: 900, exa: 300, serpapi: 200, brave: 0 };
export const searchLabels = {
  wikipedia: 'Wikipedia',
  tavily: 'Tavily',
  exa: 'Exa',
  serpapi: 'SerpApi',
  brave: 'Brave Search',
};

// Separate from the AI allowance. Count attempts before sending, including failed uploads.
// A single serialized ledger prevents concurrent jobs from spending the same last request.
export function createSearchBudget({
  limits = defaultSearchLimits,
  file = '',
  now = Date.now,
} = {}) {
  for (const value of Object.values(limits))
    if (!Number.isInteger(value) || value < 0 || value > 10000)
      throw new Error('Search monthly limits must be integers from 0 to 10000.');
  let state;
  let queue = Promise.resolve();
  return (provider) => {
    const task = queue.then(async () => {
      if (!state) {
        try {
          state = file ? JSON.parse(await readFile(file, 'utf8')) : { month: '', counts: {} };
          if (
            !/^$|^\d{4}-\d{2}$/.test(state.month) ||
            !state.counts ||
            typeof state.counts !== 'object' ||
            Array.isArray(state.counts) ||
            Object.values(state.counts).some((v) => !Number.isInteger(v) || v < 0)
          )
            throw new Error();
        } catch (error) {
          if (error.code !== 'ENOENT') {
            state = undefined;
            throw new Error('Search usage storage unavailable');
          }
          state = { month: '', counts: {} };
        }
      }
      const month = new Date(now()).toISOString().slice(0, 7);
      const current = state.month === month ? state.counts : {};
      if ((current[provider] || 0) >= (limits[provider] || 0)) return false;
      const next = { month, counts: { ...current, [provider]: (current[provider] || 0) + 1 } };
      if (file) {
        await mkdir(path.dirname(file), { recursive: true });
        const temporary = `${file}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await rename(temporary, file);
      }
      state = next;
      return true;
    });
    queue = task.catch(() => {});
    return task;
  };
}

function records(items, provider) {
  return (Array.isArray(items) ? items : []).slice(0, 5).flatMap((item) => {
    const title = plainText(item.title, 300);
    const url = safeSourceUrl(item.url || item.link);
    if (!title || !url || url.length > 2000) return [];
    return [
      {
        kind: 'web',
        title,
        url,
        text: plainText(
          provider === 'exa'
            ? (item.highlights || []).join(' ') || item.text
            : item.content || item.snippet || item.source,
        ),
      },
    ];
  });
}

export function createSearchWaterfall({
  fetcher = fetch,
  keys = {},
  limits = defaultSearchLimits,
  usageFile = '',
  now = Date.now,
  reserve = createSearchBudget({ limits, file: usageFile, now }),
} = {}) {
  const wiki = createDocumentSearch({ fetcher });
  const brave = createDocumentSearch({ fetcher, braveKey: keys.brave });
  const cache = new Map();
  const cooldowns = new Map();
  const order = ['wikipedia', 'tavily', 'exa', 'serpapi', 'brave'];
  const configured = order.filter(
    (name) => name === 'wikipedia' || (keys[name] && limits[name] > 0),
  );
  const request = async (url, options, signal) => {
    const response = await fetcher(url, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(12000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) {
      const error = new Error('Search unavailable');
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    if (data.error) throw new Error('Search unavailable');
    return data;
  };
  const textSearch = async (provider, query, signal) => {
    if (provider === 'wikipedia') return wiki(query, signal);
    if (provider === 'brave') return brave(query, signal);
    if (provider === 'tavily') {
      const data = await request(
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${keys.tavily}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            search_depth: 'basic',
            max_results: 5,
            auto_parameters: false,
            include_answer: false,
            include_raw_content: false,
            include_images: false,
          }),
        },
        signal,
      );
      return records(data.results, provider);
    }
    if (provider === 'exa') {
      const data = await request(
        'https://api.exa.ai/search',
        {
          method: 'POST',
          headers: { 'x-api-key': keys.exa, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            type: 'fast',
            numResults: 5,
            contents: { highlights: true },
          }),
        },
        signal,
      );
      return records(data.results, provider);
    }
    // SerpApi documents api_key as a query parameter. Never expose request URLs or provider errors.
    const url = new URL('https://serpapi.com/search.json');
    url.search = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: keys.serpapi,
      num: '5',
      safe: 'active',
    });
    return records((await request(url, {}, signal)).organic_results, provider);
  };
  return {
    providers: configured.map((name) => searchLabels[name]),
    reverseImageEnabled: Boolean(keys.serpapi && limits.serpapi > 0),
    createRun({ signal, onAttempt = () => {}, onProgress = () => {} } = {}) {
      let used = 0;
      const failed = new Set();
      const nextProvider = new Map();
      const emit = (provider, query, status, count = 0, discarded = 0) =>
        onAttempt({
          service: provider === 'lens' ? 'Google Lens via SerpApi' : searchLabels[provider],
          query,
          status,
          count,
          discarded,
        });
      const spend = async (provider) => {
        signal?.throwIfAborted();
        if (used >= 8) return 'run_limit';
        if (!(await reserve(provider))) return 'quota_limit';
        signal?.throwIfAborted();
        used++;
        return null;
      };
      return {
        hasMore(query) {
          return (
            used < 8 &&
            order
              .slice(nextProvider.get(query) ?? order.length)
              .some(
                (provider) =>
                  provider !== 'wikipedia' &&
                  keys[provider] &&
                  limits[provider] > 0 &&
                  !failed.has(provider) &&
                  (cooldowns.get(provider) || 0) <= now(),
              )
          );
        },
        async search(query, { continueSearch = false } = {}) {
          const found = new Map();
          const start = continueSearch ? (nextProvider.get(query) ?? order.length) : 0;
          for (let index = start; index < order.length; index++) {
            const provider = order[index];
            nextProvider.set(query, index + 1);
            signal?.throwIfAborted();
            if (provider !== 'wikipedia' && !keys[provider]) {
              emit(provider, query, 'missing_key');
              continue;
            }
            if (failed.has(provider) || (cooldowns.get(provider) || 0) > now()) {
              emit(provider, query, 'cooldown');
              continue;
            }
            const key = `${provider}:${query}`;
            const cached = cache.get(key);
            let hits,
              fromCache = false;
            if (cached && cached.expires > now()) {
              hits = cached.hits;
              fromCache = true;
            } else {
              if (provider !== 'wikipedia') {
                let reason;
                try {
                  reason = await spend(provider);
                } catch {
                  signal?.throwIfAborted();
                  reason = 'quota_limit';
                }
                if (reason) {
                  emit(provider, query, reason);
                  continue;
                }
              }
              onProgress(`Trying ${searchLabels[provider]}: ${query}`);
              try {
                hits = await textSearch(provider, query, signal);
                if (cache.size >= 100) cache.delete(cache.keys().next().value);
                cache.set(key, { hits, expires: now() + 60 * 60_000 });
              } catch (error) {
                signal?.throwIfAborted();
                failed.add(provider);
                cooldowns.set(
                  provider,
                  now() +
                    ([401, 402, 403, 429, 432, 433].includes(error.status) ? 15 * 60_000 : 60_000),
                );
                emit(provider, query, 'error');
                continue;
              }
            }
            const relevant = hits.filter((hit) => isRelevantSearchRecord(hit, query));
            for (const hit of relevant) found.set(hit.url, hit);
            emit(
              provider,
              query,
              fromCache
                ? 'cached'
                : relevant.length
                  ? 'success'
                  : hits.length
                    ? 'irrelevant'
                    : 'empty',
              relevant.length,
              hits.length - relevant.length,
            );
            // Two relevant distinct URLs are a retrieval threshold, not independent confirmation.
            if (!continueSearch && found.size >= 2) break;
          }
          return [...found.values()].slice(0, 10);
        },
        async reverseImage(image) {
          signal?.throwIfAborted();
          const query = 'Uploaded photo';
          if (!keys.serpapi) {
            emit('lens', query, 'missing_key');
            return [];
          }
          if ((cooldowns.get('serpapi') || 0) > now()) {
            emit('lens', query, 'cooldown');
            return [];
          }
          const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(image);
          const bytes = match && Buffer.from(match[2], 'base64');
          if (!bytes || bytes.length > 500_000) {
            emit('lens', query, 'image_too_large');
            return [];
          }
          try {
            let reason = await spend('serpapi');
            if (reason) {
              emit('lens', query, reason);
              return [];
            }
            onProgress('Uploading the consented photo to Google Lens via SerpApi.');
            const form = new FormData();
            form.set(
              'image',
              new Blob([bytes], { type: match[1] }),
              `photo.${match[1].split('/')[1]}`,
            );
            form.set('api_key', keys.serpapi);
            const upload = await request(
              'https://serpapi.com/image',
              { method: 'POST', body: form },
              signal,
            );
            if (typeof upload.image_id !== 'string' || upload.image_id.length > 500)
              throw new Error('Upload unavailable');
            signal?.throwIfAborted();
            reason = await spend('serpapi');
            if (reason) {
              emit('lens', query, reason);
              return [];
            }
            const url = new URL('https://serpapi.com/search.json');
            url.search = new URLSearchParams({
              engine: 'google_lens',
              image_id: upload.image_id,
              type: 'visual_matches',
              api_key: keys.serpapi,
              safe: 'active',
            });
            const data = await request(url, {}, signal);
            const hits = records(data.visual_matches, 'serpapi');
            // These are visual-search leads. External thumbnails are not fetched or treated as verified references.
            emit('lens', query, hits.length ? 'success' : 'empty', hits.length);
            return hits;
          } catch (error) {
            signal?.throwIfAborted();
            failed.add('serpapi');
            cooldowns.set('serpapi', now() + 15 * 60_000);
            emit('lens', query, 'error');
            return [];
          }
        },
      };
    },
  };
}
