import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGemini } from '../server/gemini.mjs';

const input = { image: 'data:image/png;base64,aGVsbG8=', context: 'Public test scene' };
const output = { summary: 'Hillside architecture', clues: [], candidates: [], nextSteps: [] };
const options = { apiKey: 'test-gemini-secret', model: 'gemini-3.5-flash-lite', input };

test('Gemini sends inline images and requests bounded structured output without a key in the URL', async () => {
  let calls = 0;
  const result = await analyzeGemini({
    ...options,
    fetcher: async (url, request) => {
      calls++;
      assert.equal(
        url,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      );
      assert.doesNotMatch(url, /test-gemini-secret/);
      assert.equal(request.headers['x-goog-api-key'], options.apiKey);
      assert.equal(request.redirect, 'error');
      assert.ok(request.signal instanceof AbortSignal);
      const body = JSON.parse(request.body);
      assert.deepEqual(body.contents[0].parts[0].inlineData, {
        mimeType: 'image/png',
        data: 'aGVsbG8=',
      });
      assert.equal(body.contents[0].parts[1].text, input.context);
      assert.equal(body.generationConfig.maxOutputTokens, 6000);
      assert.equal(body.generationConfig.mediaResolution, 'MEDIA_RESOLUTION_HIGH');
      assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.deepEqual(body.generationConfig.responseJsonSchema.required, [
        'summary',
        'clues',
        'candidates',
        'nextSteps',
        'uncertainties',
      ]);
      return {
        ok: true,
        json: async () => ({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { thought: true, text: 'Do not expose reasoning' },
                  { text: JSON.stringify(output).slice(0, 20) },
                  { text: JSON.stringify(output).slice(20) },
                ],
              },
            },
          ],
        }),
      };
    },
  });
  assert.deepEqual(result, output);
  assert.equal(calls, 1);
});
test('Gemini refuses blocked, truncated, empty and malformed output', async () => {
  for (const data of [
    { promptFeedback: { blockReason: 'SAFETY' } },
    {
      candidates: [
        { finishReason: 'MAX_TOKENS', content: { parts: [{ text: JSON.stringify(output) }] } },
      ],
    },
    { candidates: [{ finishReason: 'SAFETY' }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{invalid' }] } }] },
  ])
    await assert.rejects(
      analyzeGemini({ ...options, fetcher: async () => ({ ok: true, json: async () => data }) }),
    );
});
test('provider errors are never retried or exposed, and invalid destinations are rejected', async () => {
  let calls = 0;
  await assert.rejects(
    analyzeGemini({
      ...options,
      fetcher: async () => {
        calls++;
        return {
          ok: false,
          json: async () => {
            throw new Error('Secret response must not be read');
          },
        };
      },
    }),
    { message: 'Gemini request failed' },
  );
  assert.equal(calls, 1);
  await assert.rejects(analyzeGemini({ ...options, model: '../../evil' }), /Invalid Gemini model/);
});
