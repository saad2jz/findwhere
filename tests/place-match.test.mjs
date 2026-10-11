import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlaceReference } from '../src/lib/place-match.mjs';
import { resolveAnalysisPoints, assessAnalysis } from '../server/analysis-quality.mjs';
import { createGeocoder, GeocoderBusy } from '../server/geocoder.mjs';
import { createCase, exportReport } from '../src/lib/domain.mjs';
import { mergeAnalysis, validateCandidateEdit } from '../src/lib/investigation.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';

const candidate = {
  name: 'Château de Sceaux',
  country: 'France',
  lat: 48.7719,
  lng: 2.2908,
  confidence: 'high',
  reason: 'Visual hypothesis.',
  supportingClueIndexes: [0, 1],
  distinctiveMatch: 'Specific facade and garden layout.',
  contradictions: [],
};
const reference = {
  name: 'Château de Sceaux, Sceaux, France',
  country: 'France',
  category: 'historic',
  lat: 48.7743732,
  lng: 2.3000678,
};
const raw = {
  summary: 'A public chateau and garden.',
  clues: [
    { category: 'Facade', text: 'Brick and stone facade.' },
    { category: 'Garden', text: 'A patterned parterre aligned with the building.' },
  ],
  candidates: [candidate],
  nextSteps: ['Compare independent imagery.'],
};

test('Sceaux map reference replaces the model coordinate guess and retains its provenance', () => {
  const resolved = resolvePlaceReference(candidate, [reference, { ...reference, lng: 2.30017 }]);
  assert.equal(resolved.lat, reference.lat);
  assert.equal(resolved.lng, reference.lng);
  assert.deepEqual(resolved.modelPoint, { lat: candidate.lat, lng: candidate.lng });
  assert.match(resolved.mapReference.url, /openstreetmap.org/);
  assert.equal(candidate.lng, 2.2908);
});

test('ambiguous, unrelated, administrative, invalid and wrong-country results never replace points', () => {
  for (const results of [
    [],
    [{ ...reference, name: 'Château de Fontainebleau, France' }],
    [{ ...reference, category: 'boundary' }],
    [{ ...reference, lat: 95 }],
    [{ ...reference, country: 'Canada' }],
    [reference, { ...reference, lat: 49 }],
  ])
    assert.equal(resolvePlaceReference(candidate, results), null);
  assert.equal(
    resolvePlaceReference(candidate, [{ ...reference, name: 'Sceaux, France', category: 'place' }]),
    null,
  );
});

test('geocoder failures keep clues and withhold the AI point rather than using a fallback guess', async () => {
  const assessment = assessAnalysis(raw);
  const result = await resolveAnalysisPoints(assessment, async () => {
    throw new Error('unavailable');
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.withheldCandidates, 1);
  assert.deepEqual(result.clues, assessment.clues);
  assert.match(result.uncertainties[0], /Château de Sceaux.*not placed on the map/);
  assert.equal(result.researchLeads[0].name, candidate.name);
  assert.equal(result.researchLeads[0].lat, undefined);
  assert.equal(result.researchLeads[0].lng, undefined);
  assert.match(result.summary, /undetermined/);
});

test('resolved map provenance survives merging, backup, export and manual coordinate changes', async () => {
  const result = await resolveAnalysisPoints(assessAnalysis(raw), async () => [reference]);
  const investigation = mergeAnalysis(createCase('Sceaux regression fixture'), result);
  const restored = importBackup(exportBackup([investigation]))[0];
  assert.deepEqual(restored.candidates[0].mapReference, investigation.candidates[0].mapReference);
  assert.deepEqual(restored.candidates[0].modelPoint, { lat: candidate.lat, lng: candidate.lng });
  assert.match(exportReport(restored), /Original AI coordinate guess \(not used on map\)/);
  const point = restored.candidates[0];
  const edited = validateCandidateEdit(point, { ...point, coordinates: '48.775, 2.30' }).value;
  assert.equal(edited.mapReference, undefined);
  assert.ok(edited.original.mapReference);
});

test('geocoder deduplicates simultaneous searches, caches results and shares the request interval', async () => {
  let calls = 0,
    time = 0,
    release;
  const geocoder = createGeocoder({
    now: () => time,
    url: 'https://nominatim.example/search',
    userAgent: 'Findwhere test',
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url.searchParams.get('q'), 'Château de Sceaux, France');
      assert.equal(options.headers['User-Agent'], 'Findwhere test');
      assert.equal(options.redirect, 'error');
      await new Promise((resolve) => {
        release = resolve;
      });
      return {
        ok: true,
        json: async () => [
          {
            display_name: reference.name,
            address: { country: 'France' },
            class: 'historic',
            lat: reference.lat,
            lon: reference.lng,
          },
        ],
      };
    },
  });
  const first = geocoder.search('Château de Sceaux, France');
  const second = geocoder.search('Château de Sceaux, France');
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
  assert.deepEqual(await geocoder.search('Château de Sceaux, France'), [reference]);
  assert.equal(calls, 1);
  await assert.rejects(geocoder.search('Another place'), GeocoderBusy);
});
