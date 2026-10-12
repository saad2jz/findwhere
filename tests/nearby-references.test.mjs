import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceSearch, normalizeReferences } from '../server/references.mjs';
import { nearbyReferenceRequestSchema } from '../src/lib/image-research.mjs';
import { createApp } from '../server/app.mjs';
import { createCase, exportReport, referenceSchema } from '../src/lib/domain.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';

const point = { lat: 38.71217, lng: -9.133801, radius: 1000 };
const epoch = Date.UTC(2026, 9, 12);
function page(name = 'Independent view', lat = point.lat + 0.001) {
  return {
    title: `File:${name}.jpg`,
    coordinates: [{ lat, lon: point.lng, globe: 'earth', primary: true }],
    imageinfo: [
      {
        mime: 'image/jpeg',
        thumburl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${encodeURIComponent(name)}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}.jpg`,
        extmetadata: { Artist: { value: 'Test author' }, LicenseShortName: { value: 'CC BY 4.0' } },
      },
    ],
  };
}
const data = () => ({ query: { pages: [page()] } });

test('nearby photos require valid Earth geotags inside the requested radius and are deduplicated and sorted', () => {
  const far = page('Far away', 0);
  const bad = page('Invalid', NaN);
  const moon = page('Moon');
  moon.coordinates[0].globe = 'moon';
  const missing = page('Missing');
  delete missing.coordinates;
  const active = page('Active');
  active.imageinfo[0].mime = 'image/svg+xml';
  const unsafe = page('Unsafe');
  unsafe.imageinfo[0].thumburl = 'https://evil.example/tracker.jpg';
  const raw = {
    query: {
      pages: [
        page('Farther', point.lat + 0.002),
        far,
        bad,
        moon,
        missing,
        active,
        unsafe,
        page('Closer'),
        page('Closer'),
      ],
    },
  };
  const result = normalizeReferences(raw, point);
  assert.deepEqual(
    result.map((item) => item.title),
    ['Closer.jpg', 'Farther.jpg'],
  );
  assert.ok(result[0].discovery.distanceMetres > 100 && result[0].discovery.distanceMetres < 120);
  assert.deepEqual(result[0].discovery.geotag, { lat: point.lat + 0.001, lng: point.lng });
  assert.equal(result[0].discovery.method, 'nearby');
  assert.equal(result[0].attribution, 'Test author · CC BY 4.0');
  assert.equal(normalizeReferences(data())[0].discovery, undefined);
});

test('nearby reference requests use a fixed keyless Commons endpoint, bounded generator and shared cache/throttle', async () => {
  const calls = [];
  let time = epoch;
  const search = createReferenceSearch({
    now: () => time,
    fetcher: async (url, options) => {
      calls.push(new URL(url));
      assert.equal(url.origin + url.pathname, 'https://commons.wikimedia.org/w/api.php');
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal);
      return Response.json(data());
    },
  });
  assert.equal((await search(point)).length, 1);
  const params = calls[0].searchParams;
  assert.equal(params.get('generator'), 'geosearch');
  assert.equal(params.get('ggscoord'), `${point.lat}|${point.lng}`);
  assert.equal(params.get('ggsradius'), '1000');
  assert.equal(params.get('ggsnamespace'), '6');
  assert.equal(params.get('ggslimit'), '12');
  assert.equal(params.get('prop'), 'imageinfo|coordinates');
  assert.equal(params.get('coprimary'), 'primary');
  assert.equal(params.get('gsrsearch'), null);
  assert.equal((await search(point)).length, 1);
  assert.equal(calls.length, 1);
  assert.equal(await search({ ...point, radius: 500 }), null);
  assert.equal(await search('Independent view'), null);
  time += 1100;
  await search('Independent view');
  assert.equal(calls[1].searchParams.get('generator'), 'search');
  assert.equal(calls[1].searchParams.get('ggscoord'), null);
});

test('invalid inputs contact no provider and nearby uncached searches have a daily cap including failures', async () => {
  let time = epoch,
    calls = 0;
  const search = createReferenceSearch({
    now: () => time,
    fetcher: async () => {
      calls++;
      return new Response('private error', { status: 503 });
    },
  });
  for (const value of [
    { ...point, lat: 91 },
    { ...point, lng: Infinity },
    { ...point, radius: 10000 },
    { ...point, radius: '1000' },
    { ...point, photo: 'private photo' },
    { ...point, url: 'https://evil.example/' },
  ]) {
    assert.equal(nearbyReferenceRequestSchema.safeParse(value).success, false);
    await assert.rejects(search(value));
  }
  assert.equal(calls, 0);
  for (let i = 0; i < 90; i++) {
    await assert.rejects(search(point));
    time += 1100;
  }
  assert.equal(await search(point), null);
  assert.equal(calls, 90);
  time += 86400000;
  await assert.rejects(search(point));
  assert.equal(calls, 91);
});

test('oversized, incomplete or invalid nearby responses are rejected and never cached as empty matches', async () => {
  for (const response of [
    () => new Response('x'.repeat(2_000_001)),
    () => Response.json({ warnings: { coordinates: 'unsupported' }, ...data() }),
    () => Response.json({ error: { info: 'secret upstream detail' } }),
    () => new Response('not json'),
    () => Response.json({ query: { pages: {} } }),
    () => Response.json({ unexpected: 'provider payload changed' }),
  ]) {
    let time = epoch,
      calls = 0;
    const search = createReferenceSearch({
      now: () => time,
      fetcher: async () => {
        calls++;
        return calls === 1 ? response() : Response.json({ batchcomplete: true });
      },
    });
    await assert.rejects(search(point));
    time += 1100;
    assert.deepEqual(await search(point), []);
    assert.deepEqual(await search(point), []);
    assert.equal(calls, 2);
  }
});

test('nearby reference provenance survives backups and reports without changing candidate status', () => {
  const investigation = createCase('Nearby photo test');
  const result = normalizeReferences(data(), point)[0];
  investigation.reference = referenceSchema.parse({
    photo: 'data:image/jpeg;base64,aGVsbG8=',
    fileName: result.title,
    sourceUrl: result.source,
    attribution: result.attribution,
    notes: '',
    discovery: result.discovery,
  });
  const restored = importBackup(exportBackup([investigation]))[0];
  assert.deepEqual(restored.reference.discovery, result.discovery);
  assert.deepEqual(restored.candidates, []);
  const report = exportReport(restored);
  assert.match(report, /Found by nearby photo search: 38.71217, -9.133801; radius 1000 m/);
  assert.match(report, /proximity does not establish a visual match/);
  assert.match(report, /CC BY 4.0/);
  assert.doesNotMatch(report, /data:image/);
  assert.equal(
    referenceSchema.safeParse({
      ...investigation.reference,
      discovery: { ...result.discovery, geotag: { lat: 99, lng: 0 } },
    }).success,
    false,
  );
  delete investigation.reference.discovery;
  assert.equal(referenceSchema.safeParse(investigation.reference).success, true);
});

test('nearby endpoint requires production origin, validates before retrieval and works without AI login', async () => {
  let calls = 0,
    time = epoch;
  const server = createApp({
    production: true,
    appOrigin: 'https://findwhere.example',
    accessPassword: '',
    now: () => time,
    fetcher: async () => {
      calls++;
      return Response.json(data());
    },
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/references/nearby`;
  const post = (body, origin) =>
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post(point)).status, 403);
    assert.equal(
      (await post({ ...point, radius: 10000 }, 'https://findwhere.example')).status,
      400,
    );
    assert.equal(calls, 0);
    const result = await post(point, 'https://findwhere.example');
    assert.equal(result.status, 200);
    assert.equal((await result.json()).results[0].discovery.method, 'nearby');
    assert.equal(calls, 1);
    assert.equal((await post({ ...point, radius: 500 }, 'https://findwhere.example')).status, 429);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
