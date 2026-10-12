import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSearchBudget, createSearchWaterfall } from '../server/search-waterfall.mjs';
import { runSearchPipeline } from '../server/search-pipeline.mjs';
import { pipelineSchema } from '../src/lib/search-pipeline.mjs';
import { createCase, exportReport } from '../src/lib/domain.mjs';
import { mergeAnalysis } from '../src/lib/investigation.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';

const keys = {
  tavily: 'tavily-secret',
  exa: 'exa-secret',
  serpapi: 'serp-secret',
  brave: 'brave-secret',
};
const limits = { tavily: 20, exa: 20, serpapi: 20, brave: 20 };
const hit = (suffix) => ({
  title: 'Harbor Museum',
  url: `https://example.com/${suffix}`,
  content: 'Harbor Museum tower',
  highlights: ['Harbor Museum tower'],
  snippet: 'Harbor Museum tower',
});
const wiki = (items = []) => Response.json({ query: { search: items } });

test('waterfall retains relevant partial evidence, excludes irrelevant hits and stops before unnecessary providers', async () => {
  const hosts = [],
    attempts = [],
    spent = [];
  const service = createSearchWaterfall({
    keys,
    limits,
    reserve: async (name) => {
      spent.push(name);
      return true;
    },
    fetcher: async (value, options) => {
      const url = new URL(value);
      hosts.push(url.hostname);
      assert.equal(options.redirect, 'error');
      if (url.hostname === 'en.wikipedia.org')
        return wiki([{ title: 'Other park', snippet: 'Unrelated building.' }]);
      const body = JSON.parse(options.body);
      assert.equal(body.query, 'Harbor Museum tower');
      if (url.hostname === 'api.tavily.com') {
        assert.equal(options.headers.Authorization, 'Bearer tavily-secret');
        assert.equal(body.search_depth, 'basic');
        assert.equal(body.auto_parameters, false);
        return Response.json({
          results: [
            hit('one'),
            { title: 'Unsafe', url: 'javascript:alert(1)', content: 'Harbor Museum' },
          ],
        });
      }
      assert.equal(options.headers['x-api-key'], 'exa-secret');
      assert.equal(body.type, 'fast');
      return Response.json({ results: [hit('one'), hit('two')] });
    },
  });
  const result = await service
    .createRun({ onAttempt: (a) => attempts.push(a) })
    .search('Harbor Museum tower');
  assert.deepEqual(hosts, ['en.wikipedia.org', 'api.tavily.com', 'api.exa.ai']);
  assert.equal(result.length, 2);
  assert.deepEqual(spent, ['tavily', 'exa']);
  assert.equal(attempts[0].status, 'irrelevant');
  assert.equal(attempts[0].discarded, 1);
  assert.doesNotMatch(JSON.stringify({ result, attempts }), /secret/);
});

test('rate limits fall through and open a cooldown instead of retrying the failed provider', async () => {
  let tavilyCalls = 0;
  const attempts = [];
  const service = createSearchWaterfall({
    keys: { tavily: keys.tavily, exa: keys.exa },
    limits,
    reserve: async () => true,
    fetcher: async (url) => {
      const host = new URL(url).hostname;
      if (host === 'en.wikipedia.org') return wiki();
      if (host === 'api.tavily.com') {
        tavilyCalls++;
        return new Response('secret provider error', { status: 429 });
      }
      return Response.json({ results: [hit('one'), hit('two')] });
    },
  });
  const run = service.createRun({ onAttempt: (a) => attempts.push(a) });
  await run.search('Harbor Museum');
  await run.search('Harbor Museum tower');
  assert.equal(tavilyCalls, 1);
  assert.ok(attempts.some((a) => a.service === 'Tavily' && a.status === 'cooldown'));
  assert.doesNotMatch(JSON.stringify(attempts), /secret provider/);
});

test('missing keys and exhausted local limits skip providers without sending requests', async () => {
  const attempts = [],
    hosts = [];
  const run = createSearchWaterfall({
    keys: { tavily: keys.tavily },
    limits,
    reserve: async () => false,
    fetcher: async (url) => {
      hosts.push(new URL(url).hostname);
      return wiki();
    },
  }).createRun({ onAttempt: (a) => attempts.push(a) });
  assert.deepEqual(await run.search('Harbor Museum'), []);
  assert.deepEqual(hosts, ['en.wikipedia.org']);
  assert.equal(attempts.find((a) => a.service === 'Tavily').status, 'quota_limit');
  assert.equal(attempts.find((a) => a.service === 'Exa').status, 'missing_key');
});

test('cached text searches consume no extra provider allowance', async () => {
  let calls = 0,
    spent = 0;
  const attempts = [];
  const service = createSearchWaterfall({
    keys,
    limits,
    reserve: async () => {
      spent++;
      return true;
    },
    fetcher: async (url) => {
      calls++;
      return new URL(url).hostname === 'en.wikipedia.org'
        ? wiki()
        : Response.json({ results: [hit('one'), hit('two')] });
    },
  });
  await service.createRun().search('Harbor Museum');
  await service.createRun({ onAttempt: (a) => attempts.push(a) }).search('Harbor Museum');
  assert.equal(calls, 2);
  assert.equal(spent, 1);
  assert.ok(attempts.every((a) => a.status === 'cached'));
});

test('SerpApi and Brave use fixed endpoints, safely encode queries and do not expose request secrets in evidence', async () => {
  const attempts = [],
    hosts = [];
  const service = createSearchWaterfall({
    keys,
    limits,
    reserve: async () => true,
    fetcher: async (value, options) => {
      const url = new URL(value);
      hosts.push(url.hostname);
      if (url.hostname === 'en.wikipedia.org') return wiki();
      if (url.hostname === 'serpapi.com') {
        assert.equal(url.pathname, '/search.json');
        assert.equal(url.searchParams.get('engine'), 'google');
        assert.equal(url.searchParams.get('q'), 'Harbor Museum & api_key=override');
        assert.equal(url.searchParams.get('api_key'), keys.serpapi);
        return Response.json({ organic_results: [] });
      }
      if (url.hostname === 'api.search.brave.com') {
        assert.equal(options.headers['X-Subscription-Token'], keys.brave);
        return Response.json({
          web: { results: [{ ...hit('one'), description: 'Harbor Museum' }] },
        });
      }
      return Response.json({ results: [] });
    },
  });
  const result = await service
    .createRun({ onAttempt: (a) => attempts.push(a) })
    .search('Harbor Museum & api_key=override');
  assert.deepEqual(hosts, [
    'en.wikipedia.org',
    'api.tavily.com',
    'api.exa.ai',
    'serpapi.com',
    'api.search.brave.com',
  ]);
  assert.equal(result.length, 1);
  assert.doesNotMatch(JSON.stringify(attempts), /serp-secret|brave-secret/);
});

test('Lens directly uploads bounded bytes, uses the returned image ID and never crawls result images', async () => {
  const calls = [],
    attempts = [];
  let spent = 0;
  const run = createSearchWaterfall({
    keys,
    limits,
    reserve: async () => {
      spent++;
      return true;
    },
    fetcher: async (value, options) => {
      const url = new URL(value);
      calls.push(url.pathname);
      assert.equal(url.hostname, 'serpapi.com');
      assert.equal(options.redirect, 'error');
      if (url.pathname === '/image') {
        assert.equal(options.method, 'POST');
        assert.equal(options.body.get('api_key'), keys.serpapi);
        assert.equal(options.body.get('image').type, 'image/jpeg');
        return Response.json({ image_id: 'synthetic-image-id' });
      }
      assert.equal(url.searchParams.get('image_id'), 'synthetic-image-id');
      assert.equal(url.searchParams.get('engine'), 'google_lens');
      assert.equal(url.searchParams.has('url'), false);
      assert.equal(url.searchParams.has('q'), false);
      return Response.json({
        visual_matches: [
          {
            title: 'Harbor Museum',
            link: 'https://example.com/reference',
            image: 'http://127.0.0.1/private',
            thumbnail: 'http://localhost/private',
          },
        ],
      });
    },
  }).createRun({ onAttempt: (a) => attempts.push(a) });
  const result = await run.reverseImage('data:image/jpeg;base64,/9j/AA==');
  assert.equal(result.length, 1);
  assert.equal(result[0].thumbnail, undefined);
  assert.deepEqual(calls, ['/image', '/search.json']);
  assert.equal(spent, 2);
  assert.doesNotMatch(JSON.stringify({ result, attempts }), /secret|synthetic-image-id/);
});

test('oversized uploads and mid-upload cancellation stop before further network spending', async () => {
  let calls = 0;
  const attempts = [];
  const controller = new AbortController();
  const run = createSearchWaterfall({
    keys,
    limits,
    reserve: async () => true,
    fetcher: async () => {
      calls++;
      controller.abort();
      return Response.json({ image_id: 'synthetic' });
    },
  }).createRun({ signal: controller.signal, onAttempt: (a) => attempts.push(a) });
  await run.reverseImage('data:image/jpeg;base64,' + Buffer.alloc(500001).toString('base64'));
  assert.equal(calls, 0);
  assert.equal(attempts[0].status, 'image_too_large');
  await assert.rejects(run.reverseImage('data:image/jpeg;base64,/9j/AA=='));
  assert.equal(calls, 1);
});

test('run budget bounds all keyed requests across image and text searches', async () => {
  let spent = 0;
  const attempts = [];
  const run = createSearchWaterfall({
    keys,
    limits,
    reserve: async () => {
      spent++;
      return true;
    },
    fetcher: async (value) => {
      const url = new URL(value);
      if (url.pathname === '/image') return Response.json({ image_id: 'synthetic' });
      if (url.hostname === 'en.wikipedia.org') return wiki();
      return Response.json({
        results: [],
        organic_results: [],
        visual_matches: [],
        web: { results: [] },
      });
    },
  }).createRun({ onAttempt: (a) => attempts.push(a) });
  await run.reverseImage('data:image/jpeg;base64,/9j/AA==');
  for (const query of ['Harbor Museum', 'Harbor Museum tower', 'Harbor Museum arch'])
    await run.search(query);
  assert.equal(spent, 8);
  assert.ok(attempts.some((a) => a.status === 'run_limit'));
});

test('monthly ledger persists, serializes concurrent reservations, resets in UTC and fails closed on corruption', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'findwhere-waterfall-'));
  const file = path.join(folder, 'usage.json');
  let clock = Date.UTC(2026, 9, 31, 23, 59);
  try {
    const config = { file, now: () => clock, limits: { tavily: 2 } };
    const reserve = createSearchBudget(config);
    assert.deepEqual(await Promise.all([reserve('tavily'), reserve('tavily'), reserve('tavily')]), [
      true,
      true,
      false,
    ]);
    assert.equal(await createSearchBudget(config)('tavily'), false);
    assert.equal(JSON.parse(await readFile(file)).counts.tavily, 2);
    clock += 120_000;
    assert.equal(await reserve('tavily'), true);
    assert.equal(JSON.parse(await readFile(file)).month, '2026-11');
    await writeFile(file, 'invalid');
    await assert.rejects(createSearchBudget(config)('tavily'));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('cancelling during budget reservation never sends a keyed provider request', async () => {
  const controller = new AbortController();
  let external = 0;
  const run = createSearchWaterfall({
    keys,
    limits,
    reserve: async () => {
      controller.abort();
      return true;
    },
    fetcher: async (url) => {
      if (new URL(url).hostname === 'en.wikipedia.org') return wiki();
      external++;
      return Response.json({ results: [] });
    },
  }).createRun({ signal: controller.signal });
  await assert.rejects(run.search('Harbor Museum'));
  assert.equal(external, 0);
});

test('pipeline records actual waterfall provenance and never uploads without consent', async () => {
  let uploads = 0;
  const waterfall = createSearchWaterfall({
    keys: { serpapi: keys.serpapi },
    limits,
    fetcher: async (value) => {
      const url = new URL(value);
      if (url.pathname === '/image') uploads++;
      return url.hostname === 'en.wikipedia.org' ? wiki() : Response.json({ organic_results: [] });
    },
  });
  const result = await runSearchPipeline({
    input: { image: 'data:image/jpeg;base64,/9j/AA==', context: '' },
    waterfall,
    reserve: async () => true,
    callAI: async (request) => {
      assert.equal(request.mode, 'pipeline');
      return {
        summary: 'Synthetic fixture; undetermined.',
        clues: [{ category: 'Sign', text: 'Harbor Museum sign.' }],
        candidates: [],
        nextSteps: [],
        searchPlan: { queries: ['Harbor Museum'], placeQueries: [] },
      };
    },
    searchPlaces: async () => [],
    searchReferences: async () => [],
  });
  assert.equal(uploads, 0);
  assert.equal(result.pipeline.requestsUsed, 1);
  assert.equal(result.pipeline.reverseImageUsed, false);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.pipeline.attempts.some((a) => a.service === 'SerpApi' && a.status === 'empty'));
  assert.ok(result.pipeline.engines.includes('SerpApi'));
  assert.equal(pipelineSchema.parse(result.pipeline).attempts.length, 5);
  const saved = mergeAnalysis(createCase('Waterfall test'), result);
  assert.match(exportReport(saved), /Waterfall SerpApi: empty/);
  const restored = importBackup(exportBackup([saved]));
  assert.deepEqual(restored[0].analysisReview.pipeline.attempts, result.pipeline.attempts);
});
