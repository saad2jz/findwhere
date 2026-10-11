import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.mjs';

async function withServer(options, run) {
  const server = createApp({
    apiKey: '',
    production: false,
    accessPassword: '',
    appOrigin: '',
    dailyLimit: 10,
    usageFile: '',
    ...options,
  }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const input = { image: 'data:image/jpeg;base64,aGVsbG8=', context: '' };
const output = {
  summary: 'A generic landscape',
  clues: [{ category: 'Terrain', text: 'A low hill' }],
  candidates: [],
  nextSteps: ['Inspect road signs'],
};
const post = (base, body, headers = {}) =>
  fetch(base + '/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const password = 'test-password-for-ai-only';
const origin = 'https://findwhere.example';
const login = (base, value = password, headers = { Origin: origin }) =>
  fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ password: value }),
  });
const productionOptions = {
  production: true,
  accessPassword: password,
  appOrigin: origin,
  analyze: async () => output,
};

test('production fails closed without a strong password or HTTPS origin', async () => {
  for (const options of [
    { accessPassword: '' },
    { accessPassword: 'short' },
    { appOrigin: '' },
    { appOrigin: 'http://unsafe.example' },
  ]) {
    await withServer({ ...productionOptions, ...options }, async (base) => {
      const health = await (await fetch(base + '/api/health')).json();
      assert.equal(health.aiEnabled, false);
      assert.equal(health.authenticated, false);
      assert.equal(
        (await post(base, input, { Origin: origin })).status,
        options.appOrigin !== undefined ? 403 : 503,
      );
    });
  }
});
test('production requires same-origin authenticated sessions and revokes logout', async () =>
  withServer(productionOptions, async (base) => {
    assert.equal((await post(base, input, { Origin: origin })).status, 401);
    for (const headers of [
      {},
      { Origin: 'https://attacker.example' },
      { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
    ]) {
      assert.equal((await login(base, password, headers)).status, 403);
    }
    assert.equal((await login(base, 'wrong')).status, 401);
    const response = await login(base);
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie');
    assert.match(setCookie, /^__Host-findwhere_session=/);
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200'])
      assert.ok(setCookie.includes(flag));
    assert.doesNotMatch(setCookie, new RegExp(password));
    const Cookie = setCookie.split(';')[0];
    const health = await (await fetch(base + '/api/health', { headers: { Cookie } })).json();
    assert.equal(health.authenticated, true);
    assert.equal(health.dailyRemaining, 10);
    assert.equal(
      (await post(base, input, { Origin: origin, Cookie: Cookie + 'tampered' })).status,
      401,
    );
    assert.equal((await post(base, input, { Origin: origin, Cookie })).status, 200);
    assert.equal((await post(base, input, { Cookie })).status, 403);
    await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Origin: origin, Cookie } });
    assert.equal((await post(base, input, { Origin: origin, Cookie })).status, 401);
  }));
test('expired sessions and repeated wrong passwords cannot access AI', async () => {
  let time = Date.parse('2026-10-11T12:00:00Z');
  await withServer({ ...productionOptions, now: () => time }, async (base) => {
    const response = await login(base);
    const Cookie = response.headers.get('set-cookie').split(';')[0];
    time += 12 * 3600000;
    assert.equal((await post(base, input, { Origin: origin, Cookie })).status, 401);
    for (let i = 0; i < 5; i++) assert.equal((await login(base, 'wrong')).status, 401);
    assert.equal((await login(base)).status, 429);
    time += 15 * 60000;
    assert.equal((await login(base)).status, 200);
  });
});
test('daily allowance is shared across sessions and charges failed provider attempts', async () => {
  let calls = 0;
  await withServer(
    {
      ...productionOptions,
      dailyLimit: 1,
      analyze: async () => {
        calls++;
        throw new Error('provider-secret');
      },
    },
    async (base) => {
      const first = (await login(base)).headers.get('set-cookie').split(';')[0];
      const second = (await login(base)).headers.get('set-cookie').split(';')[0];
      assert.equal((await post(base, {}, { Origin: origin, Cookie: first })).status, 400);
      assert.equal((await post(base, input, { Origin: origin, Cookie: first })).status, 502);
      assert.equal((await post(base, input, { Origin: origin, Cookie: second })).status, 429);
      assert.equal(calls, 1);
      const health = await (
        await fetch(base + '/api/health', { headers: { Cookie: second } })
      ).json();
      assert.equal(health.dailyRemaining, 0);
    },
  );
});
test('concurrent requests never exceed the daily allowance', async () => {
  let calls = 0;
  await withServer(
    {
      dailyLimit: 1,
      analyze: async () => {
        calls++;
        return output;
      },
    },
    async (base) => {
      const responses = await Promise.all([
        post(base, input),
        post(base, input),
        post(base, input),
      ]);
      assert.equal(responses.filter((response) => response.status === 200).length, 1);
      assert.equal(calls, 1);
    },
  );
});

test('health exposes configuration status without secrets', async () =>
  withServer({ apiKey: 'test-secret' }, async (base) => {
    const response = await fetch(base + '/api/health');
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /"aiEnabled":true/);
    assert.doesNotMatch(body, /test-secret/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }));
test('AI without a key reports setup required, not fabricated results', async () =>
  withServer({}, async (base) => {
    const response = await post(base, input);
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /OPENAI_API_KEY/);
  }));
test('AI accepts validated results, clearly marked unverified', async () =>
  withServer({ analyze: async () => output }, async (base) => {
    const response = await post(base, input);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.verified, false);
    assert.equal(body.source, 'ai');
    assert.deepEqual(body.candidates, []);
    assert.equal(body.clues[0].text, 'A low hill');
  }));
test('invalid image requests never reach the analyzer', async () => {
  let calls = 0;
  await withServer(
    {
      analyze: async () => {
        calls++;
        return output;
      },
    },
    async (base) => {
      for (const body of [
        { image: 'https://remote.example/photo.jpg' },
        { image: 'data:image/svg+xml;base64,AAAA' },
        { ...input, context: 'x'.repeat(2001) },
        {},
      ])
        assert.equal((await post(base, body)).status, 400);
      assert.equal(calls, 0);
    },
  );
});
test('invalid and failed model output produce recoverable errors', async () => {
  await withServer({ analyze: async () => ({ summary: 'invalid' }) }, async (base) =>
    assert.equal((await post(base, input)).status, 502),
  );
  await withServer(
    {
      analyze: async () => {
        throw new Error('secret-token');
      },
    },
    async (base) => {
      const response = await post(base, input);
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /secret-token/);
    },
  );
});
test('analysis rate limit bounds requests', async () =>
  withServer({ analyze: async () => output }, async (base) => {
    for (let i = 0; i < 5; i++) assert.equal((await post(base, input)).status, 200);
    assert.equal((await post(base, input)).status, 429);
  }));
test('cross-origin browser requests cannot use the AI endpoint', async () =>
  withServer({ analyze: async () => output }, async (base) => {
    assert.equal((await post(base, input, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await post(base, input, { Origin: base })).status, 200);
  }));
test('geocoding validates input, throttles requests, and caches results', async () => {
  let calls = 0;
  let clock = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url.searchParams.get('q'), 'Lisbon');
    assert.match(options.headers['User-Agent'], /Findwhere/);
    return {
      ok: true,
      json: async () => [
        {
          display_name: 'Lisbon, Portugal',
          lat: '38.72',
          lon: '-9.14',
          address: { country: 'Portugal' },
        },
        { display_name: 'Bad', lat: 'NaN', lon: '0' },
      ],
    };
  };
  await withServer({ fetcher, now: () => clock }, async (base) => {
    assert.equal((await fetch(base + '/api/geocode?q=a')).status, 400);
    let response = await fetch(base + '/api/geocode?q=Lisbon');
    let data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].lng, -9.14);
    assert.equal((await fetch(base + '/api/geocode?q=Lisbon')).status, 200);
    assert.equal(calls, 1);
    assert.equal((await fetch(base + '/api/geocode?q=Porto')).status, 429);
    clock = 1200;
    assert.equal((await fetch(base + '/api/geocode?q=Lisbon')).status, 200);
    assert.equal(calls, 1);
  });
});
test('geocoder failures allow manual investigation to continue', async () =>
  withServer(
    {
      fetcher: async () => {
        throw new Error('network');
      },
    },
    async (base) => {
      const response = await fetch(base + '/api/geocode?q=Lisbon');
      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /coordinates/);
    },
  ));
test('invalid JSON and unknown endpoints return JSON errors', async () =>
  withServer({}, async (base) => {
    const response = await fetch(base + '/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /JSON/);
    assert.equal((await fetch(base + '/api/unknown')).status, 404);
  }));
