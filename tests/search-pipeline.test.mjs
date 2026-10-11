import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runSearchPipeline,
  selectSupportedProposals,
  resolveSearchPlace,
  rankSearchChecks,
} from '../server/search-pipeline.mjs';
import { createDocumentSearch, downloadReference } from '../server/search-retrieval.mjs';
import { analyzeGemini } from '../server/gemini.mjs';
import { createDailyQuota } from '../server/security.mjs';
import { createApp } from '../server/app.mjs';
import { readPipelineResponse } from '../src/lib/search-pipeline.mjs';
import { createCase, exportReport } from '../src/lib/domain.mjs';
import { mergeAnalysis } from '../src/lib/investigation.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';

// Synthetic fixtures verify orchestration and safeguards, not real recognition accuracy.
const image = 'data:image/jpeg;base64,aGVsbG8=';
const input = { image, context: '' };
const scene = {
  summary: 'Location undetermined.',
  clues: [
    { category: 'Sign', text: 'Harbor Museum sign' },
    { category: 'Building', text: 'An octagonal tower beside a stone arch' },
  ],
  candidates: [],
  leads: [],
  uncertainties: ['The place is not recognized.'],
  nextSteps: ['Compare tower geometry.'],
  searchPlan: {
    queries: ['Harbor Museum tower'],
    placeQueries: ['Harbor Museum, Seaton, United Kingdom'],
  },
};
const record = {
  name: 'Harbor Museum, Quay Road, Seaton, United Kingdom',
  country: 'United Kingdom',
  category: 'tourism',
  lat: 50.1,
  lng: -3.2,
  city: 'Seaton',
  street: 'Quay Road',
  osmUrl: 'https://www.openstreetmap.org/way/123456',
};
const doc = {
  kind: 'article',
  title: 'Harbor Museum',
  url: 'https://en.wikipedia.org/wiki/Harbor_Museum',
  text: 'Harbor Museum in Seaton, United Kingdom.',
};
const photo = {
  title: 'Harbor Museum tower.jpg',
  thumbnail: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Harbor_Museum.jpg',
  source: 'https://commons.wikimedia.org/wiki/File:Harbor_Museum.jpg',
  attribution: 'Example author · CC BY-SA 4.0',
  date: '2020',
};
const candidate = {
  name: 'Harbor Museum',
  country: 'United Kingdom',
  city: 'Seaton',
  street: 'Quay Road',
  query: scene.searchPlan.placeQueries[0],
  reason: 'Compare the sign and tower arrangement.',
  uncertainty: 'The reference label and viewpoint remain uncertain.',
  sourceIds: ['source-1'],
  supportingClueIndexes: [0, 1],
  referenceIds: ['source-3'],
};
const comparison = {
  verdict: 'supports',
  summary: 'The tower and arch arrangement show visual support.',
  findings: [
    {
      feature: 'Tower geometry',
      sourceObservation: 'Octagonal tower.',
      referenceObservation: 'Octagonal tower.',
      assessment: 'match',
    },
    {
      feature: 'Arch alignment',
      sourceObservation: 'Arch right of tower.',
      referenceObservation: 'Arch right of tower.',
      assessment: 'match',
    },
  ],
  limitations: ['Reference identity is unverified.'],
};
const imageResponse = () =>
  new Response(new Uint8Array([255, 216, 255, 0, 1, 2]), {
    headers: { 'content-type': 'image/jpeg' },
  });
const options = (overrides = {}) => ({
  input,
  reserve: async () => true,
  callAI: async (request) =>
    request.mode === 'pipeline'
      ? scene
      : request.mode === 'selection'
        ? { candidates: [candidate] }
        : comparison,
  searchPlaces: async () => [record],
  searchDocuments: async () => [doc],
  searchReferences: async () => [photo],
  fetcher: async () => imageResponse(),
  ...overrides,
});

test('pipeline retrieves evidence, uses map-record coordinates and compares two unlabeled images before ranking', async () => {
  const stages = [],
    calls = [],
    queries = [];
  const quota = createDailyQuota({ limit: 10 });
  const result = await runSearchPipeline(
    options({
      reserve: () => quota.reserve(),
      onProgress: (event) => stages.push(event.stage),
      searchPlaces: async (query) => {
        queries.push(query);
        return [record];
      },
      callAI: async (request) => {
        calls.push(request);
        if (request.mode === 'pipeline')
          return {
            ...scene,
            candidates: [
              {
                name: 'Wrong remembered place',
                country: 'Somewhere',
                lat: 1,
                lng: 2,
                confidence: 'low',
                reason: 'Weak resemblance',
                supportingClueIndexes: [0, 1],
                distinctiveMatch: '',
                contradictions: [],
              },
            ],
          };
        return request.mode === 'selection' ? { candidates: [candidate] } : comparison;
      },
    }),
  );
  assert.deepEqual([...new Set(stages)], ['scene', 'retrieve', 'locate', 'compare', 'rank']);
  assert.equal(result.candidates[0].lat, record.lat);
  assert.equal(result.candidates[0].lng, record.lng);
  assert.equal(result.candidates[0].modelPoint, undefined);
  assert.equal(result.candidates[0].mapReference.url, record.osmUrl);
  assert.equal(result.candidates[0].confidence, 'medium');
  assert.equal(result.pipeline.requestsUsed, 3);
  assert.equal((await quota.status()).dailyUsed, 3);
  assert.equal(queries.length, 1, 'same place query reuses retrieved records');
  assert.deepEqual(
    calls.map((request) => request.mode),
    ['pipeline', 'selection', 'comparison'],
  );
  assert.doesNotMatch(JSON.stringify(calls), /34\.0062964|-6\.8567864|GeoSeeer|Avenue Hassan II/);
  assert.doesNotMatch(calls[2].context, /Harbor Museum|Seaton|United Kingdom/);
  assert.equal(result.pipeline.checks[0].comparison.verdict, 'supports');
  assert.equal(result.pipeline.contextUsed, false);
  assert.equal(result.pipeline.correctionUsed, false);
});

test('source IDs, multiple observations and a retrieved name are required; rejected places cannot return', () => {
  const sources = [{ ...doc, id: 'source-1' }];
  for (const changed of [
    { sourceIds: ['invented-source'] },
    { supportingClueIndexes: [0, 0] },
    { supportingClueIndexes: [0, 11] },
    { name: 'Unretrieved Landmark' },
  ])
    assert.deepEqual(
      selectSupportedProposals(
        { candidates: [{ ...candidate, ...changed }] },
        sources,
        scene.clues,
      ),
      [],
    );
  assert.deepEqual(
    selectSupportedProposals({ candidates: [candidate] }, sources, scene.clues, {
      knownPlace: '',
      rejectedNames: ['Harbor Museum'],
    }),
    [],
  );
  assert.deepEqual(
    selectSupportedProposals(
      { candidates: [{ ...candidate, referenceIds: ['invented-image'] }] },
      sources,
      scene.clues,
    )[0].referenceIds,
    [],
  );
});

test('map resolution rejects branch ambiguity, wrong country, wrong street and administrative centroids', () => {
  assert.equal(resolveSearchPlace(candidate, [record]).lat, record.lat);
  for (const records of [
    [{ ...record, category: 'boundary' }],
    [{ ...record, country: 'France' }],
    [{ ...record, street: 'Different Road' }],
    [{ ...record, city: 'Different City' }],
    [record, { ...record, lat: 51 }],
  ])
    assert.equal(resolveSearchPlace(candidate, records), null);
  assert.equal(resolveSearchPlace({ ...candidate, country: '' }, [record]), null);
});

test('a reference contradiction stays visible and prevents map promotion even with an inconclusive verdict', async () => {
  const result = await runSearchPipeline(
    options({
      callAI: async (request) =>
        request.mode === 'pipeline'
          ? scene
          : request.mode === 'selection'
            ? { candidates: [candidate] }
            : {
                ...comparison,
                findings: [
                  { ...comparison.findings[0], assessment: 'contradiction' },
                  comparison.findings[1],
                ],
              },
    }),
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.pipeline.checks[0].status, 'contradicted');
  assert.equal(result.pipeline.checks[0].comparison.verdict, 'inconclusive');
});

test('missing reference images retain low-confidence sourced hypotheses without claiming a visual match', async () => {
  const result = await runSearchPipeline(options({ searchReferences: async () => [] }));
  assert.equal(result.candidates[0].confidence, 'low');
  assert.match(result.candidates[0].reason, /No reference photo was visually compared/);
  assert.equal(result.pipeline.requestsUsed, 2);
  assert.equal(result.pipeline.checks[0].referenceStatus, 'unavailable');
  assert.match(result.pipeline.warnings[0], /Broad web search is not configured/);
});

test('quota exhaustion and failed provider attempts preserve available evidence without retries', async () => {
  for (const limit of [1, 2]) {
    const quota = createDailyQuota({ limit });
    const result = await runSearchPipeline(options({ reserve: () => quota.reserve() }));
    assert.equal(result.pipeline.requestsUsed, limit);
    assert.equal((await quota.status()).dailyUsed, limit);
    assert.ok(result.pipeline.sources.length);
    assert.ok(result.pipeline.warnings.some((warning) => /allowance/.test(warning)));
    if (limit === 2) {
      assert.equal(result.candidates[0].confidence, 'low');
      assert.equal(result.pipeline.checks[0].comparison, undefined);
    }
  }
  let calls = 0;
  const failed = await runSearchPipeline(
    options({
      callAI: async (request) => {
        calls++;
        if (request.mode === 'selection')
          throw new Error('secret provider response must not be shown');
        return scene;
      },
    }),
  );
  assert.equal(calls, 2);
  assert.equal(failed.pipeline.requestsUsed, 2);
  assert.doesNotMatch(JSON.stringify(failed), /secret provider response/);
});

test('unavailable retrieval keeps clues, reports failed searches and never invents candidates', async () => {
  const result = await runSearchPipeline(
    options({
      searchPlaces: async () => {
        throw new Error('secret');
      },
      searchDocuments: async () => [],
      searchReferences: async () => [],
    }),
  );
  assert.deepEqual(result.candidates, []);
  assert.equal(result.pipeline.requestsUsed, 1);
  assert.equal(result.clues.length, 2);
  assert.ok(result.pipeline.queries.length >= 3);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
});

test('ranking promotes paired support before untested map records, retaining unresolved and contradicted checks', () => {
  const checks = [
    { id: 'contradicted', status: 'contradicted' },
    { id: 'unresolved', status: 'unresolved' },
    { id: 'untested', status: 'mapped' },
    { id: 'support', status: 'mapped', comparison },
  ];
  assert.deepEqual(
    rankSearchChecks(checks).map((check) => check.id),
    ['support', 'untested', 'unresolved', 'contradicted'],
  );
  assert.equal(checks[0].id, 'contradicted', 'ranking does not mutate saved input');
});

test('document retrieval uses fixed authenticated destinations, encodes query data and filters unsafe citations', async () => {
  for (const braveKey of ['', 'test-brave-secret']) {
    const search = createDocumentSearch({
      braveKey,
      fetcher: async (url, request) => {
        assert.equal(url.hostname, braveKey ? 'api.search.brave.com' : 'en.wikipedia.org');
        assert.equal(url.searchParams.get(braveKey ? 'q' : 'srsearch'), 'Museum & q=override');
        assert.doesNotMatch(url.href, /test-brave-secret/);
        assert.equal(request.redirect, 'error');
        assert.equal(request.headers['X-Subscription-Token'], braveKey || undefined);
        return Response.json(
          braveKey
            ? {
                web: {
                  results: [
                    { title: '<b>Museum</b>', url: doc.url, description: '<b>Public</b> museum' },
                    { title: 'Unsafe', url: 'javascript:alert(1)' },
                    { title: 'Credentials', url: 'https://user:pass@example.com' },
                  ],
                },
              }
            : {
                query: {
                  search: [{ title: 'Harbor Museum', snippet: '<span>Public</span> museum' }],
                },
              },
        );
      },
    });
    const result = await search('Museum & q=override');
    assert.equal(result.length, 1);
    assert.doesNotMatch(result[0].text, /<span|<b>/);
  }
});

test('reference downloads reject arbitrary hosts, redirects, oversized streams and MIME spoofing', async () => {
  for (const url of [
    'http://127.0.0.1/secret',
    'https://evil.example/a.jpg',
    photo.thumbnail.replace('org/', 'org:444/'),
    photo.thumbnail.replace('upload.', 'upload.wikimedia.org@evil.'),
  ])
    await assert.rejects(
      downloadReference(url, {
        fetcher: () => {
          throw new Error('must not fetch');
        },
      }),
      /Invalid reference destination/,
    );
  const fetcher = async (url, request) => {
    assert.equal(request.redirect, 'error');
    assert.equal(url, photo.thumbnail);
    return imageResponse();
  };
  assert.match(await downloadReference(photo.thumbnail, { fetcher }), /^data:image\/jpeg;base64,/);
  for (const response of [
    new Response('<html>unsafe</html>', { headers: { 'content-type': 'image/jpeg' } }),
    new Response(new Uint8Array(1_000_001), { headers: { 'content-type': 'image/png' } }),
    new Response('too large', {
      headers: { 'content-type': 'image/jpeg', 'content-length': '1000001' },
    }),
    new Response(null, { status: 302, headers: { location: 'http://localhost/secret' } }),
  ])
    await assert.rejects(downloadReference(photo.thumbnail, { fetcher: async () => response }));
});

test('pipeline schema and selection schema do not let the model invent selection coordinates or source URLs', async () => {
  for (const mode of ['pipeline', 'selection'])
    await analyzeGemini({
      apiKey: 'test-key',
      model: 'gemini-3.5-flash-lite',
      input: { ...input, mode },
      fetcher: async (url, request) => {
        const schema = JSON.parse(request.body).generationConfig.responseJsonSchema;
        if (mode === 'pipeline') assert.ok(schema.properties.searchPlan);
        else {
          const fields = schema.properties.candidates.items.properties;
          assert.equal(fields.lat, undefined);
          assert.equal(fields.lng, undefined);
          assert.equal(fields.url, undefined);
          assert.ok(fields.sourceIds);
        }
        return Response.json({
          candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }],
        });
      },
    });
});

test('search evidence survives merge, backups and reports, preserving reviewed manual candidates', async () => {
  const result = await runSearchPipeline(options());
  const previous = createCase('Synthetic pipeline test');
  previous.candidates.push({
    id: 'manual',
    name: 'Investigator marker',
    country: '',
    lat: 1,
    lng: 2,
    source: 'manual',
    status: 'supported',
    confidence: 'low',
    reason: 'User supplied.',
  });
  const merged = mergeAnalysis(previous, result);
  assert.equal(merged.candidates[0].id, 'manual');
  assert.equal(merged.candidates[1].status, 'hypothesis');
  const backup = exportBackup([merged]);
  const restored = importBackup(backup)[0];
  assert.deepEqual(restored.analysisReview.pipeline, merged.analysisReview.pipeline);
  assert.equal(restored.candidates[1].searchCheckId, merged.candidates[1].searchCheckId);
  const report = exportReport(merged);
  assert.match(report, /Findwhere search evidence trail/);
  assert.match(report, /Tower geometry/);
  assert.match(report, /Example author/);
  assert.match(report, /openstreetmap.org\/way\/123456/);
});

test('NDJSON progress handles split multibyte events, rejects interruptions and surfaces server errors', async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(
    JSON.stringify({ type: 'progress', stage: 'retrieve', detail: 'Château search' }) +
      '\n' +
      JSON.stringify({ type: 'result', result: { candidates: [] } }) +
      '\n',
  );
  const body = new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
  const progress = [];
  const response = new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
  assert.deepEqual(await readPipelineResponse(response, (event) => progress.push(event)), {
    candidates: [],
  });
  assert.equal(progress[0].detail, 'Château search');
  await assert.rejects(
    readPipelineResponse(
      new Response('{"type":"progress","stage":"scene"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    ),
    /disconnected/,
  );
  await assert.rejects(
    readPipelineResponse(
      new Response('{"type":"error","error":"Controlled failure"}\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      }),
    ),
    /Controlled failure/,
  );
});

test('a cancelled pipeline makes no additional provider reservations or source requests', async () => {
  const controller = new AbortController();
  let reservations = 0;
  let lookups = 0;
  await assert.rejects(
    runSearchPipeline(
      options({
        signal: controller.signal,
        reserve: async () => {
          reservations++;
          return true;
        },
        callAI: async () => {
          controller.abort();
          return scene;
        },
        searchPlaces: async () => {
          lookups++;
          return [record];
        },
      }),
    ),
    { name: 'AbortError' },
  );
  assert.equal(reservations, 1);
  assert.equal(lookups, 0);
});

test('a run compares at most two of three candidates and spends at most four shared AI requests', async () => {
  const names = ['Harbor Museum', 'Harbor Gallery', 'Harbor Theatre'];
  const sources = names.map((name, index) => ({
    ...doc,
    title: name,
    text: `${name}, Seaton, United Kingdom.`,
    url: `https://en.wikipedia.org/wiki/Test_${index}`,
  }));
  const results = await runSearchPipeline(
    options({
      searchDocuments: async () => sources,
      searchReferences: async (query) => {
        const name = names.find((name) => query.includes(name));
        return name
          ? [
              {
                ...photo,
                title: `${name} Seaton.jpg`,
                source: `https://commons.wikimedia.org/wiki/File:${name.replaceAll(' ', '_')}.jpg`,
              },
            ]
          : [];
      },
      searchPlaces: async (query) => [
        {
          ...record,
          name: `${names.find((name) => query.includes(name)) || names[0]}, Quay Road, Seaton, United Kingdom`,
        },
      ],
      callAI: async (request) =>
        request.mode === 'pipeline'
          ? scene
          : request.mode === 'comparison'
            ? comparison
            : {
                candidates: names.map((name, index) => ({
                  ...candidate,
                  name,
                  query: `${name}, Seaton, United Kingdom`,
                  sourceIds: [`source-${index + 2}`],
                  referenceIds: [],
                })),
              },
    }),
  );
  assert.equal(results.pipeline.requestsUsed, 4);
  assert.equal(
    results.pipeline.checks.filter((check) => check.referenceStatus === 'compared').length,
    2,
  );
  assert.equal(
    results.pipeline.checks.filter((check) => check.referenceStatus === 'skipped').length,
    1,
  );
});

test('pipeline endpoint shares auth and charges each provider attempt; unsupported provider is rejected before billing', async () => {
  for (const provider of ['gemini', 'openai']) {
    const server = createApp({
      provider,
      apiKey: '',
      geminiKey: '',
      production: false,
      accessPassword: 'pipeline-test-password',
      appOrigin: '',
      dailyLimit: 2,
      usageFile: '',
      analyze: async (request) =>
        request.mode === 'pipeline'
          ? { ...scene, searchPlan: { queries: ['Harbor Museum'], placeQueries: [] } }
          : { candidates: [] },
      fetcher: async (url) =>
        Response.json(
          url.hostname === 'commons.wikimedia.org'
            ? { query: { pages: [] } }
            : { query: { search: [{ title: 'Harbor Museum', snippet: 'Museum in Seaton' }] } },
        ),
    }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (path, body, headers = {}) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    try {
      assert.equal((await post('/api/analyze', { ...input, mode: 'pipeline' })).status, 401);
      const logged = await post('/api/auth/login', { password: 'pipeline-test-password' });
      const Cookie = logged.headers.get('set-cookie').split(';')[0];
      const response = await post(
        '/api/analyze',
        { ...input, mode: 'pipeline', stream: true },
        { Cookie },
      );
      if (provider === 'openai') {
        assert.equal(response.status, 400);
        assert.equal(
          (await (await fetch(base + '/api/health', { headers: { Cookie } })).json()).dailyUsed,
          0,
        );
      } else {
        const progress = [];
        const result = await readPipelineResponse(response, (event) => progress.push(event));
        assert.equal(result.verified, false);
        assert.equal(result.pipeline.requestsUsed, 2);
        assert.equal(progress[0].stage, 'scene');
        assert.equal(progress.at(-1).stage, 'rank');
        assert.equal(
          (await (await fetch(base + '/api/health', { headers: { Cookie } })).json()).dailyUsed,
          2,
        );
        assert.equal(
          (await post('/api/analyze', { ...input, mode: 'pipeline' }, { Cookie })).status,
          429,
        );
      }
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
