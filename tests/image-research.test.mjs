import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonSchema, assessComparison, commonsImageUrl } from '../src/lib/image-research.mjs';
import { createReferenceSearch, normalizeReferences } from '../server/references.mjs';
import { analyzeGemini } from '../server/gemini.mjs';
import { createApp } from '../server/app.mjs';
import { createCase, exportReport } from '../src/lib/domain.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';

const image = 'data:image/jpeg;base64,aGVsbG8=';
const referenceImage = 'data:image/png;base64,d29ybGQ=';
const finding = {
  feature: 'Window layout',
  sourceObservation: 'Five window bays.',
  referenceObservation: 'Five window bays.',
  assessment: 'match',
};
const comparison = {
  verdict: 'supports',
  summary: 'Two permanent features appear compatible.',
  findings: [finding, { ...finding, feature: 'Roofline' }],
  limitations: ['Viewpoint differs. Reference identity remains unverified.'],
};
const rawReferences = {
  query: {
    pages: [
      {
        title: 'File:Sceaux.jpg',
        imageinfo: [
          {
            mime: 'image/jpeg',
            thumburl:
              'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Sceaux.jpg/1280px-Sceaux.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sceaux.jpg',
            extmetadata: {
              Artist: { value: '<a href="https://example.com">Test author</a>' },
              LicenseShortName: { value: 'CC BY-SA 4.0' },
              DateTimeOriginal: { value: '2023-06-04' },
            },
          },
        ],
      },
    ],
  },
};

test('comparison verdicts require distinct paired findings and retain uncertainty or contradictions', () => {
  assert.equal(assessComparison(comparison).verdict, 'supports');
  for (const change of [
    { findings: [finding] },
    { findings: [finding, finding] },
    { findings: [finding, { ...finding, feature: 'Roofline', assessment: 'contradiction' }] },
    { verdict: 'different' },
  ]) {
    const result = assessComparison({ ...comparison, ...change });
    assert.equal(result.verdict, 'inconclusive');
    assert.match(result.summary, /do not establish/);
  }
  assert.equal(
    assessComparison({
      ...comparison,
      verdict: 'different',
      findings: [{ ...finding, assessment: 'contradiction' }],
    }).verdict,
    'different',
  );
  assert.equal(
    comparisonSchema.safeParse({ ...comparison, findings: Array(9).fill(finding) }).success,
    false,
  );
});

test('Gemini comparison sends two labeled images and a separate bounded schema, without source labels', async () => {
  const result = await analyzeGemini({
    apiKey: 'test-only',
    model: 'gemini-3.5-flash-lite',
    input: { mode: 'comparison', image, referenceImage, context: '' },
    fetcher: async (url, request) => {
      const body = JSON.parse(request.body);
      assert.match(body.systemInstruction.parts[0].text, /Do not guess a location/);
      const parts = body.contents[0].parts;
      assert.match(parts[0].text, /Image A/);
      assert.equal(parts[1].inlineData.data, 'aGVsbG8=');
      assert.match(parts[2].text, /Image B/);
      assert.equal(parts[3].inlineData.data, 'd29ybGQ=');
      assert.deepEqual(body.generationConfig.responseJsonSchema.required, [
        'verdict',
        'summary',
        'findings',
        'limitations',
      ]);
      assert.equal(body.generationConfig.maxOutputTokens, 6000);
      return {
        ok: true,
        json: async () => ({
          candidates: [
            { finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(comparison) }] } },
          ],
        }),
      };
    },
  });
  assert.deepEqual(result, comparison);
  await assert.rejects(
    analyzeGemini({
      apiKey: 'test',
      model: 'gemini-3.5-flash-lite',
      input: { mode: 'comparison', image },
      fetcher: () => {
        throw new Error('Must not call provider');
      },
    }),
    /Invalid reference/,
  );
});

test('reference search returns attributed raster previews only from fixed Wikimedia hosts', () => {
  const [result] = normalizeReferences(rawReferences);
  assert.equal(result.attribution, 'Test author · CC BY-SA 4.0');
  assert.equal(result.date, '2023-06-04');
  assert.equal(result.title, 'Sceaux.jpg');
  for (const url of [
    'http://thumb.wikimedia.org/wikipedia/commons/a.jpg',
    'https://thumb.wikimedia.org.evil.example/wikipedia/commons/a.jpg',
    'https://user:secret@upload.wikimedia.org/wikipedia/commons/a.jpg',
    'https://127.0.0.1/a.jpg',
    'data:image/jpeg;base64,AA',
  ])
    assert.equal(commonsImageUrl(url), null);
  for (const change of [
    { mime: 'image/svg+xml' },
    { thumburl: 'https://evil.example/a.jpg' },
    { descriptionurl: 'javascript:alert(1)' },
  ]) {
    const raw = structuredClone(rawReferences);
    Object.assign(raw.query.pages[0].imageinfo[0], change);
    assert.deepEqual(normalizeReferences(raw), []);
  }
});

test('reference queries are encoded as data, cached, throttled, and never choose the destination', async () => {
  let calls = 0,
    time = 0;
  const search = createReferenceSearch({
    now: () => time,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url.origin + url.pathname, 'https://commons.wikimedia.org/w/api.php');
      assert.equal(url.searchParams.get('gsrsearch'), 'Sceaux & origin=evil');
      assert.equal(url.searchParams.get('gsrnamespace'), '6');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      return { ok: true, json: async () => rawReferences };
    },
  });
  assert.equal((await search('Sceaux & origin=evil')).length, 1);
  assert.equal((await search('Sceaux & origin=evil')).length, 1);
  assert.equal(calls, 1);
  assert.equal(await search('Other place'), null);
  time = 1101;
  assert.equal((await search('Sceaux & origin=evil')).length, 1);
});

test('comparison source, attribution and findings survive backups and reports without verifying a candidate', () => {
  const investigation = createCase('Comparison fixture');
  investigation.photo = image;
  investigation.reference = {
    photo: referenceImage,
    fileName: 'independent.jpg',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Sceaux.jpg',
    notes: 'Reference label needs checking.',
    attribution: 'Test author · CC BY-SA 4.0',
    comparison: { ...comparison, comparedAt: '2026-10-11T18:00:00Z', provider: 'Gemini (Google)' },
  };
  const restored = importBackup(exportBackup([investigation]))[0];
  assert.deepEqual(restored.reference, investigation.reference);
  assert.deepEqual(restored.candidates, []);
  const report = exportReport(restored);
  assert.match(report, /Window layout/);
  assert.match(report, /CC BY-SA/);
  assert.match(report, /does not verify the reference label/);
  assert.doesNotMatch(report, /data:image/);
});

test('comparison shares authenticated scene quota, rejects malformed pairs before billing and never geocodes', async () => {
  let calls = 0;
  const app = createApp({
    production: true,
    accessPassword: 'test-password-for-comparison',
    appOrigin: 'https://findwhere.example',
    provider: 'gemini',
    geminiKey: '',
    apiKey: '',
    usageFile: '',
    dailyLimit: 2,
    analyze: async (input) => {
      calls++;
      return input.mode === 'comparison'
        ? comparison
        : { summary: 'Undetermined', clues: [], candidates: [], nextSteps: [] };
    },
    fetcher: async () => {
      throw new Error('No geocoder in comparison');
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'Content-Type': 'application/json', Origin: 'https://findwhere.example' };
  const post = (body) =>
    fetch(base + '/api/analyze', { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    const pair = { mode: 'comparison', image, referenceImage };
    assert.equal((await post(pair)).status, 401);
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'test-password-for-comparison' }),
    });
    headers.Cookie = login.headers.get('set-cookie').split(';')[0];
    for (const body of [
      { ...pair, referenceImage: undefined },
      { ...pair, referenceImage: image },
      { ...pair, referenceImage: 'https://evil.example/image.jpg' },
    ])
      assert.equal((await post(body)).status, 400);
    assert.equal(calls, 0);
    const result = await (await post(pair)).json();
    assert.equal(result.verdict, 'supports');
    assert.equal(result.verified, false);
    assert.equal(result.candidates, undefined);
    assert.equal((await post({ image })).status, 200);
    assert.equal((await post(pair)).status, 429);
    assert.equal(calls, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('public reference endpoint validates inputs, caches results and handles upstream failure', async () => {
  let calls = 0;
  let time = 0;
  let failing = false;
  const server = createApp({
    production: false,
    accessPassword: '',
    usageFile: '',
    dailyLimit: 10,
    now: () => time,
    fetcher: async () => {
      calls++;
      if (failing) throw new Error('Upstream unavailable');
      return { ok: true, json: async () => rawReferences };
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/references?q=ab')).status, 400);
    assert.equal((await fetch(base + '/api/references?q=Sceaux')).status, 200);
    assert.equal((await fetch(base + '/api/references?q=Sceaux')).status, 200);
    assert.equal(calls, 1);
    assert.equal((await fetch(base + '/api/references?q=Other')).status, 429);
    time = 1101;
    failing = true;
    const failure = await fetch(base + '/api/references?q=Other');
    assert.equal(failure.status, 502);
    assert.match((await failure.json()).error, /import a reference photo/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
