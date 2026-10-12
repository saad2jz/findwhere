import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocationContext, terrainPoints, ContextBusy } from '../server/location-context.mjs';
import { locationContextSchema, contextMatchesCandidate } from '../src/lib/location-context.mjs';
import { createApp } from '../server/app.mjs';
import { createCase, exportReport, caseSchema } from '../src/lib/domain.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';
import { distanceAndBearing } from '../src/lib/geo.mjs';

const input = { lat: 38.71217, lng: -9.133801, radius: 1000, category: 'all', date: '2020-06-01' };
const clock = Date.UTC(2026, 9, 12);
function fixture(value, options) {
  const url = new URL(value);
  assert.equal(options.redirect, 'error');
  if (['overpass-api.de', 'overpass.private.coffee'].includes(url.hostname)) {
    assert.equal(url.pathname, '/api/interpreter');
    const query = url.searchParams.get('data');
    assert.match(query, /\[timeout:10\]/);
    assert.match(query, /out center 100/);
    return Response.json({
      elements: [
        {
          type: 'node',
          id: 1,
          lat: input.lat + 0.001,
          lon: input.lng,
          tags: { name: '<b>Public Museum</b>', tourism: 'museum' },
        },
        {
          type: 'way',
          id: 2,
          center: { lat: input.lat + 0.002, lon: input.lng },
          tags: { name: 'Public Road', highway: 'secondary' },
        },
        {
          type: 'node',
          id: 3,
          lat: input.lat,
          lon: input.lng,
          tags: { name: 'Private House', building: 'residential' },
        },
        {
          type: 'node',
          id: 4,
          lat: input.lat,
          lon: input.lng,
          tags: { name: 'Private Place', access: 'private' },
        },
        { type: 'node', id: 5, lat: 0, lon: 0, tags: { name: 'Too Far' } },
        { type: 'node', id: 6, lat: NaN, lon: input.lng, tags: { name: 'Invalid' } },
        {
          type: 'script',
          id: 7,
          lat: input.lat,
          lon: input.lng,
          tags: { name: 'Unsafe identity' },
        },
      ],
    });
  }
  if (url.hostname === 'api.opentopodata.org') {
    assert.equal(url.pathname, '/v1/srtm90m,aster30m');
    const points = url.searchParams
      .get('locations')
      .split('|')
      .map((point) => point.split(',').map(Number));
    assert.equal(points.length, 5);
    return Response.json({
      status: 'OK',
      results: points.map(([lat, lng], i) => ({
        location: { lat, lng },
        elevation: i === 2 ? null : [0, 40, 0, 60, 80][i],
        dataset: 'srtm90m',
      })),
    });
  }
  assert.equal(url.hostname, 'archive-api.open-meteo.com');
  assert.equal(url.searchParams.get('models'), 'era5');
  assert.equal(url.searchParams.get('timezone'), 'auto');
  assert.equal(url.searchParams.get('start_date'), input.date);
  assert.equal(url.searchParams.get('end_date'), input.date);
  return Response.json({
    latitude: 38.75,
    longitude: -9.25,
    timezone: 'Europe/Lisbon',
    daily_units: { temperature_2m_min: '°C', precipitation_sum: 'mm', cloud_cover_mean: '%' },
    daily: {
      time: [input.date],
      temperature_2m_min: [14],
      temperature_2m_max: [24],
      precipitation_sum: [0],
      cloud_cover_mean: [30],
      sunrise: ['2020-06-01T06:13'],
      sunset: ['2020-06-01T20:55'],
    },
  });
}

test('location context uses bounded fixed providers, filters private/invalid places and preserves missing/zero data', async () => {
  const calls = [];
  const result = await createLocationContext({
    now: () => clock,
    fetcher: async (url, options) => {
      calls.push(String(url));
      return fixture(url, options);
    },
  })(input);
  assert.equal(calls.length, 3);
  assert.equal(result.nearby.items.length, 2);
  assert.equal(result.nearby.items[0].name, 'Public Museum');
  assert.equal(result.nearby.items[0].url, 'https://www.openstreetmap.org/node/1');
  assert.ok(result.nearby.items[0].distanceMetres < result.nearby.items[1].distanceMetres);
  assert.equal(result.terrain.samples[0].elevation, 0);
  assert.equal(result.terrain.samples[2].elevation, null);
  assert.equal(result.weather.precipitation, 0);
  assert.deepEqual(result.weather.grid, { lat: 38.75, lng: -9.25 });
  assert.equal(locationContextSchema.safeParse(result).success, true);
});

test('one unavailable provider retains other results, and no date sends no weather request', async () => {
  for (const broken of ['overpass-api.de', 'api.opentopodata.org', 'archive-api.open-meteo.com']) {
    const result = await createLocationContext({
      now: () => clock,
      fetcher: async (url, options) =>
        (
          broken === 'overpass-api.de'
            ? new URL(url).hostname.startsWith('overpass')
            : new URL(url).hostname === broken
        )
          ? new Response('private upstream error', { status: 429 })
          : fixture(url, options),
    })(input);
    assert.equal(
      result[
        broken.startsWith('overpass')
          ? 'nearby'
          : broken.includes('opentopo')
            ? 'terrain'
            : 'weather'
      ].status,
      'unavailable',
    );
    assert.equal(
      Object.values({
        nearby: result.nearby,
        terrain: result.terrain,
        weather: result.weather,
      }).filter((part) => part.status === 'available').length,
      2,
    );
    assert.doesNotMatch(JSON.stringify(result), /private upstream/);
  }
  const calls = [];
  const result = await createLocationContext({
    now: () => clock,
    fetcher: async (url, options) => {
      calls.push(String(url));
      return fixture(url, options);
    },
  })({ lat: input.lat, lng: input.lng, radius: 500, category: 'fuel' });
  assert.equal(result.weather.status, 'not-requested');
  assert.equal(calls.length, 2);
});

test('Overpass falls through once on failure, skips a cooling server and accepts an empty successful result', async () => {
  const calls = [];
  let time = clock;
  const load = createLocationContext({
    now: () => time,
    fetcher: async (url, options) => {
      const host = new URL(url).hostname;
      calls.push(host);
      if (host === 'overpass-api.de') return new Response('', { status: 429 });
      return fixture(url, options);
    },
  });
  const result = await load(input);
  assert.equal(result.nearby.status, 'available');
  assert.match(result.nearby.attribution, /overpass.private.coffee/);
  assert.equal(calls.filter((host) => host.startsWith('overpass')).length, 2);
  time += 2000;
  await load({ ...input, category: 'fuel' });
  assert.equal(calls.filter((host) => host === 'overpass-api.de').length, 1);
  time += 5 * 60000;
  await load({ ...input, category: 'landmarks' });
  assert.equal(calls.filter((host) => host === 'overpass-api.de').length, 2);
  const emptyCalls = [];
  const empty = await createLocationContext({
    now: () => clock,
    fetcher: async (url, options) => {
      emptyCalls.push(new URL(url).hostname);
      return new URL(url).hostname === 'overpass-api.de'
        ? Response.json({ elements: [] })
        : fixture(url, options);
    },
  })(input);
  assert.equal(empty.nearby.status, 'available');
  assert.equal(empty.nearby.items.length, 0);
  assert.ok(!emptyCalls.includes('overpass.private.coffee'));
});

test('provider diagnostics classify failures without exposing coordinates, queries or upstream text', async () => {
  for (const [failure, reason] of [
    [() => new Response('secret response body', { status: 429 }), 'HTTP_429'],
    [
      () => {
        throw Object.assign(new Error('secret query'), { name: 'TimeoutError' });
      },
      'TIMEOUT',
    ],
    [
      () => {
        throw new TypeError('secret URL', { cause: { code: 'EAI_AGAIN' } });
      },
      'EAI_AGAIN',
    ],
    [() => Response.json({ elements: [], remark: 'secret query' }), 'QUERY_INCOMPLETE'],
  ]) {
    const events = [];
    const result = await createLocationContext({
      now: () => clock,
      onUnavailable: (event) => events.push(event),
      fetcher: async (url, options) =>
        new URL(url).hostname.startsWith('overpass') ? failure() : fixture(url, options),
    })(input);
    assert.equal(result.nearby.status, 'unavailable');
    assert.deepEqual(
      events,
      ['overpass-api.de', 'overpass.private.coffee'].map((host) => ({
        provider: 'overpass',
        host,
        reason,
      })),
    );
    assert.doesNotMatch(JSON.stringify(events), /secret|38\.71217|-9\.133801|timeout:10/);
  }
});

test('invalid requests and future/recent dates never contact upstream providers; cache and request gate bound usage', async () => {
  let now = clock,
    calls = 0;
  const load = createLocationContext({
    now: () => now,
    fetcher: async (url, options) => {
      calls++;
      return fixture(url, options);
    },
  });
  for (const value of [
    { ...input, lat: 91 },
    { ...input, radius: 50000 },
    { ...input, category: 'x];out;' },
    { ...input, photo: 'private photo' },
    { ...input, date: '2026-10-11' },
    { ...input, date: '1939-12-31' },
    { ...input, date: '2020-02-30' },
  ])
    await assert.rejects(load(value));
  assert.equal(calls, 0);
  const first = await load(input);
  assert.deepEqual(await load(input), first);
  assert.equal(calls, 3);
  await assert.rejects(load({ ...input, category: 'fuel' }), ContextBusy);
  now += 1500;
  await load({ ...input, category: 'fuel' });
  assert.equal(calls, 6);
});

test('terrain sample offsets retain distance and valid coordinates at poles and across the antimeridian', () => {
  for (const point of [
    { lat: 90, lng: 180 },
    { lat: -89.9999, lng: -179.9999 },
    { lat: 0, lng: 179.9999 },
  ]) {
    const points = terrainPoints(point, 2000);
    assert.equal(points.length, 5);
    for (const sample of points.slice(1)) {
      assert.ok(Math.abs(sample.lat) <= 90 && Math.abs(sample.lng) <= 180);
      assert.ok(Math.abs(distanceAndBearing(point, sample).distanceMetres - 2000) < 0.2);
    }
  }
});

test('oversized or semantically invalid upstream data is unavailable without discarding other providers', async () => {
  for (const invalid of [
    new Response('x'.repeat(1000001)),
    Response.json({
      status: 'OK',
      results: Array(5).fill({ elevation: 5, dataset: 'srtm90m', location: {} }),
    }),
  ]) {
    const result = await createLocationContext({
      now: () => clock,
      fetcher: async (url, options) =>
        new URL(url).hostname === 'api.opentopodata.org' ? invalid : fixture(url, options),
    })(input);
    assert.equal(result.terrain.status, 'unavailable');
    assert.equal(result.nearby.status, 'available');
    assert.equal(result.weather.status, 'available');
  }
});

test('saved context survives backups/reports; moved points are stale and old cases remain compatible', async () => {
  const context = await createLocationContext({ now: () => clock, fetcher: fixture })(input);
  const saved = createCase('Context test');
  saved.candidates.push({
    id: 'test',
    name: 'Test public place',
    country: 'Portugal',
    lat: input.lat,
    lng: input.lng,
    source: 'manual',
    confidence: 'low',
    status: 'hypothesis',
    reason: 'Unverified lead.',
    mapReference: {
      method: 'nearby',
      label: 'Test public place',
      url: 'https://www.openstreetmap.org/node/123',
      attribution: '© OpenStreetMap contributors',
    },
    locationContext: context,
  });
  assert.equal(contextMatchesCandidate(context, saved.candidates[0]), true);
  const restored = importBackup(exportBackup([saved]))[0];
  assert.deepEqual(restored.candidates[0].locationContext, context);
  assert.equal(restored.candidates[0].mapReference.method, 'nearby');
  assert.match(exportReport(saved), /Nearby public map record \(not camera position\)/);
  assert.match(exportReport(saved), /Public Museum/);
  assert.match(exportReport(saved), /ERA5 reanalysis/);
  saved.candidates[0].lat += 1;
  assert.equal(contextMatchesCandidate(context, saved.candidates[0]), false);
  assert.match(exportReport(saved), /Stale: candidate coordinates changed/);
  delete saved.candidates[0].locationContext;
  assert.equal(caseSchema.safeParse(saved).success, true);
});

test('context imports reject malformed or unsafe source links and impossible weather values', async () => {
  const context = await createLocationContext({ now: () => clock, fetcher: fixture })(input);
  for (const source of ['not a URL', 'javascript:alert(1)', 'https://user:secret@example.com/']) {
    const value = structuredClone(context);
    value.nearby.source = source;
    assert.equal(locationContextSchema.safeParse(value).success, false);
  }
  const value = structuredClone(context);
  value.weather.maximum = 1000;
  assert.equal(locationContextSchema.safeParse(value).success, false);
});

test('public context endpoint requires app origin in production and validates before sending; AI login is unnecessary', async () => {
  let calls = 0;
  const server = createApp({
    production: true,
    appOrigin: 'https://findwhere.example',
    accessPassword: '',
    now: () => clock,
    fetcher: async (url, options) => {
      calls++;
      return fixture(url, options);
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/location-context`;
    const post = (body, origin) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      });
    assert.equal((await post(input)).status, 403);
    assert.equal((await post({ ...input, lat: 95 }, 'https://findwhere.example')).status, 400);
    assert.equal(calls, 0);
    const response = await post(input, 'https://findwhere.example');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).nearby.items.length, 2);
    assert.equal(calls, 3);
    assert.equal(
      (await post({ ...input, category: 'fuel' }, 'https://findwhere.example')).status,
      429,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
