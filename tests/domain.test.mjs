import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createCase,
  parseCoordinates,
  mapLinks,
  safeUrl,
  exportReport,
  analysisSchema,
  caseSchema,
  resourceLink,
} from '../src/lib/domain.mjs';
import { demoCase } from '../src/data/demo.mjs';

test('coordinates preserve negative values, zero, and precision', () => {
  assert.deepEqual(parseCoordinates(' -33.8583701, 151.2944812 '), {
    lat: -33.8583701,
    lng: 151.2944812,
  });
  assert.deepEqual(parseCoordinates('0,0'), { lat: 0, lng: 0 });
  assert.deepEqual(parseCoordinates('-90,180'), { lat: -90, lng: 180 });
  for (const input of [
    '',
    ',',
    ',0',
    '0,',
    '91,0',
    '0,-181',
    'NaN,0',
    'Infinity,1',
    '1,2,3',
    'Paris',
  ])
    assert.throws(() => parseCoordinates(input));
});
test('map links encode values with correct provider coordinate order', () => {
  const links = mapLinks({ lat: 48.8583701, lng: 2.2944812 }, '東京 & api=2');
  assert.deepEqual(Object.fromEntries(new URL(links.google).searchParams), {
    api: '1',
    query: '48.8583701,2.2944812',
  });
  assert.equal(new URL(links.bing).searchParams.get('cp'), '48.8583701~2.2944812');
  assert.equal(new URL(links.osm).searchParams.get('mlat'), '48.8583701');
  assert.equal(new URL(links.osm).searchParams.get('mlon'), '2.2944812');
  assert.equal(new URL(links.search).searchParams.get('q'), '東京 & api=2');
  assert.throws(() => mapLinks({ lat: 100, lng: 0 }));
});
test('external links reject executable URLs and credentials', () => {
  assert.equal(safeUrl('https://example.com/path'), 'https://example.com/path');
  for (const value of [
    'javascript:alert(1)',
    'file:///secret',
    'data:text/html,hi',
    'https://user:secret@example.com',
    '/relative',
  ])
    assert.equal(safeUrl(value), null);
});
test('new cases have unique ids and independently mutable data', () => {
  const a = createCase();
  const b = createCase();
  assert.notEqual(a.id, b.id);
  a.clues.push('test');
  assert.equal(b.clues.length, 0);
  assert.equal(caseSchema.safeParse(b).success, true);
});
test('sample data is valid and explicitly identifies reference sources', () => {
  const demo = demoCase();
  assert.equal(caseSchema.safeParse(demo).success, true);
  assert.equal(demo.demo, true);
  assert.equal(demo.candidates[0].source, 'demo');
  assert.ok(demo.clues.some((c) => c.url?.includes('commons.wikimedia.org')));
  const report = exportReport(demo);
  assert.match(report, /sample investigation/);
  assert.match(report, /not a live analysis/);
  assert.match(report, /WGS84/);
  assert.match(report, /two independent constraints/);
});
test('report preserves evidence and Unicode while escaping titles', () => {
  const data = createCase('[東京]<script>');
  data.notes = 'Check the temple against historical imagery.';
  data.clues.push({
    id: '1',
    category: 'Language',
    text: '東京駅',
    source: 'Investigator',
    checked: true,
    url: 'javascript:alert(1)',
  });
  const report = exportReport(data);
  assert.match(report, /\\\[東京\\\]&lt;script&gt;/);
  assert.match(report, /\[x\] Language: 東京駅/);
  assert.doesNotMatch(report, /javascript:/);
  assert.match(report, /historical imagery/);
});
test('AI results reject out of range points and excessive candidates', () => {
  const result = {
    summary: 'Unknown',
    clues: [],
    candidates: [],
    nextSteps: ['Inspect landmarks'],
  };
  assert.equal(analysisSchema.safeParse(result).success, true);
  const candidate = {
    lat: 91,
    lng: 0,
    name: 'Invalid',
    country: '',
    confidence: 'high',
    reason: '',
  };
  assert.equal(analysisSchema.safeParse({ ...result, candidates: [candidate] }).success, false);
  assert.equal(
    analysisSchema.safeParse({ ...result, candidates: Array(6).fill({ ...candidate, lat: 0 }) })
      .success,
    false,
  );
});
test('curated resource catalog has 24 uniquely attributed valid resources', async () => {
  const catalog = JSON.parse(
    await readFile(new URL('../src/data/resources.json', import.meta.url)),
  );
  assert.equal(catalog.resources.length, 24);
  assert.equal(new Set(catalog.resources.map((r) => r.id)).size, 24);
  for (const resource of catalog.resources) {
    assert.ok(safeUrl(resource.url));
    assert.ok(safeUrl(resource.source));
    assert.ok(resource.description);
    assert.ok(resource.action);
    assert.equal(resourceLink(resource, null), resource.url);
  }
  const google = catalog.resources.find((r) => r.id === 'google-maps');
  assert.match(resourceLink(google, demoCase().candidates[0]), /query=38/);
});
