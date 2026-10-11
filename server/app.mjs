import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { analysisSchema, analysisJsonSchema, analysisFeedbackSchema } from '../src/lib/domain.mjs';
import { assessAnalysis, sceneContext, resolveAnalysisPoints } from './analysis-quality.mjs';
import { createGeocoder, GeocoderBusy } from './geocoder.mjs';
import { createAccess, createDailyQuota } from './security.mjs';
import { analyzeGemini, sceneInstructions, comparisonInstructions } from './gemini.mjs';
import {
  comparisonSchema,
  comparisonJsonSchema,
  assessComparison,
} from '../src/lib/image-research.mjs';
import { createReferenceSearch } from './references.mjs';
import { createDocumentSearch } from './search-retrieval.mjs';
import { runSearchPipeline } from './search-pipeline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imageInput = z
  .string()
  .max(5_000_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/);
const requestSchema = z
  .object({
    image: imageInput,
    mode: z.enum(['scene', 'comparison', 'pipeline']).default('scene'),
    stream: z.boolean().default(false),
    referenceImage: imageInput.optional(),
    context: z.string().max(2000).default(''),
    feedback: analysisFeedbackSchema.optional(),
  })
  .superRefine((input, ctx) => {
    if (
      input.mode === 'comparison' &&
      (!input.referenceImage ||
        input.referenceImage === input.image ||
        input.referenceImage.length + input.image.length > 5_000_000)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Provide two different images under 3.5 MB combined.',
      });
  });

export function createApp({
  apiKey = process.env.OPENAI_API_KEY,
  geminiKey = process.env.GEMINI_API_KEY || '',
  provider = process.env.AI_PROVIDER || (geminiKey ? 'gemini' : apiKey ? 'openai' : 'gemini'),
  model = provider === 'gemini'
    ? process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'
    : process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  aiFetcher = fetch,
  fetcher = fetch,
  analyze,
  now = Date.now,
  geocoderUrl = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search',
  production = process.env.NODE_ENV === 'production',
  accessPassword = process.env.AI_ACCESS_PASSWORD || '',
  appOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || '',
  dailyLimit = Number(process.env.AI_DAILY_LIMIT ?? 10),
  usageFile = process.env.AI_USAGE_FILE || '',
  braveKey = process.env.BRAVE_SEARCH_API_KEY || '',
} = {}) {
  const app = express();
  const access = createAccess({
    password: accessPassword,
    required: production || Boolean(accessPassword),
    secure: production,
    now,
  });
  const quota = createDailyQuota({ limit: dailyLimit, file: usageFile, now });
  let originConfigured = !production;
  try {
    const url = new URL(appOrigin);
    originConfigured = !production || (url.protocol === 'https:' && url.origin === appOrigin);
  } catch {
    /* Production AI stays disabled without a valid HTTPS origin. */
  }
  const providerConfigured = ['gemini', 'openai'].includes(provider);
  const selectedKey = provider === 'gemini' ? geminiKey : apiKey;
  const aiConfigured =
    providerConfigured &&
    Boolean(selectedKey || analyze) &&
    access.configured &&
    originConfigured &&
    dailyLimit > 0;
  const geocoder = createGeocoder({
    fetcher,
    now,
    url: geocoderUrl,
    userAgent:
      process.env.GEOCODER_USER_AGENT || 'Findwhere/1.0 (https://github.com/saad2jz/findwhere)',
  });
  const searchReferences = createReferenceSearch({ fetcher, now });
  const searchDocuments = createDocumentSearch({ fetcher, braveKey });
  const attempts = new Map();
  let runningAnalysis = 0;
  let globalAttempts = { start: now(), count: 0 };
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'DENY');
    if (production) {
      res.set('Strict-Transport-Security', 'max-age=31536000');
      res.set(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com https://upload.wikimedia.org https://thumb.wikimedia.org; font-src 'self'; connect-src 'self' https://upload.wikimedia.org https://thumb.wikimedia.org; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
      );
    }
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    // Production uses one configured HTTPS origin; CLI clients must send it too.
    const origin = req.get('origin');
    if (
      req.method === 'POST' &&
      (production
        ? !originConfigured || origin !== appOrigin || req.get('sec-fetch-site') === 'cross-site'
        : origin &&
          ![
            `${req.protocol}://${req.get('host')}`,
            'http://127.0.0.1:5173',
            'http://localhost:5173',
          ].includes(origin))
    ) {
      return res.status(403).json({ error: 'This request must come from the Findwhere app.' });
    }
    next();
  });
  app.post('/api/auth/login', express.json({ limit: '2kb' }), access.login);
  app.post('/api/auth/logout', access.logout);
  app.use('/api/analyze', (req, res, next) => {
    if (!access.configured || !originConfigured)
      return res.status(503).json({
        error:
          'AI access is not configured securely. The operator must set AI_ACCESS_PASSWORD and an HTTPS APP_ORIGIN.',
      });
    if (!access.authorized(req))
      return res.status(401).json({ error: 'Sign in to AI access before sending an image.' });
    next();
  });
  app.use(express.json({ limit: '6mb' }));
  app.get('/api/health', async (req, res) => {
    const authenticated = access.authorized(req);
    let usage = {};
    if (authenticated) {
      try {
        usage = await quota.status();
      } catch {
        usage = { usageUnavailable: true };
      }
    }
    res.json({
      ok: true,
      aiEnabled: aiConfigured && !usage.usageUnavailable,
      model: aiConfigured ? model : null,
      provider: providerConfigured ? provider : null,
      authRequired: access.required,
      authConfigured: access.configured,
      authenticated,
      searchPipelineEnabled: aiConfigured && provider === 'gemini',
      broadSearchEnabled: Boolean(braveKey),
      ...usage,
    });
  });

  app.get('/api/geocode', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 3 || query.length > 200)
      return res.status(400).json({ error: 'Enter a place name between 3 and 200 characters.' });
    try {
      const results = await geocoder.search(query);
      return res.json({ results, attribution: '© OpenStreetMap contributors' });
    } catch (error) {
      if (error instanceof GeocoderBusy)
        return res.status(429).json({ error: 'Please wait a moment before searching again.' });
      return res.status(502).json({
        error: 'Place search is unavailable. You can still add a candidate by coordinates.',
      });
    }
  });

  app.get('/api/references', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 3 || query.length > 200)
      return res
        .status(400)
        .json({ error: 'Enter a place or feature between 3 and 200 characters.' });
    try {
      const results = await searchReferences(query);
      if (!results)
        return res.status(429).json({ error: 'Please wait a moment before searching again.' });
      res.json({ results });
    } catch {
      res.status(502).json({
        error:
          'Wikimedia reference search is unavailable. You can still import a reference photo or screenshot.',
      });
    }
  });

  app.post('/api/analyze', async (req, res) => {
    if (!providerConfigured || (!selectedKey && !analyze))
      return res.status(503).json({
        error: `AI analysis is not configured. Add ${provider === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY'} to the server environment and restart. GPS extraction and manual investigation already work.`,
      });
    if (!dailyLimit)
      return res.status(429).json({ error: 'AI analysis is paused by the operator.' });
    const input = requestSchema.safeParse(req.body);
    if (!input.success)
      return res.status(400).json({
        error:
          'Provide JPEG, PNG, or WebP images under 3.5 MB combined and no more than 2,000 characters of context. Comparison requires two different photos.',
      });
    const comparing = input.data.mode === 'comparison';
    const searching = input.data.mode === 'pipeline';
    if (searching && provider !== 'gemini')
      return res
        .status(400)
        .json({ error: 'Findwhere search currently requires the Gemini provider.' });
    const clientKey = req.ip || 'local';
    const bucket = attempts.get(clientKey);
    if (now() - globalAttempts.start >= 60_000) globalAttempts = { start: now(), count: 0 };
    if (globalAttempts.count >= 5)
      return res.status(429).json({
        error: 'Five analyses per minute are allowed on this server. Please try again shortly.',
      });
    if (bucket && now() - bucket.start < 60_000 && bucket.count >= 5)
      return res
        .status(429)
        .json({ error: 'Five analyses per minute are allowed. Please try again shortly.' });
    if (runningAnalysis >= 2)
      return res
        .status(429)
        .json({ error: 'Two analyses are already running. Please try again shortly.' });
    for (const [key, value] of attempts) if (now() - value.start >= 60_000) attempts.delete(key);
    if (!bucket && attempts.size >= 1000)
      return res.status(429).json({ error: 'Server busy. Please try again shortly.' });
    attempts.set(
      clientKey,
      bucket && now() - bucket.start < 60_000
        ? { ...bucket, count: bucket.count + 1 }
        : { start: now(), count: 1 },
    );
    runningAnalysis++;
    globalAttempts.count++;
    try {
      if (searching) {
        // The same auth, origin, concurrency and daily allowance protect every pipeline stage.
        if (!(await quota.status()).dailyRemaining)
          return res
            .status(429)
            .json({
              error:
                'The server’s daily analysis limit has been reached. Try again after 00:00 UTC.',
            });
        const disconnect = new AbortController();
        const signal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(240000)]);
        res.on('close', () => {
          if (!res.writableEnded) disconnect.abort();
        });
        const send = (event) => {
          if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
        };
        if (input.data.stream) {
          res
            .status(200)
            .set({
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'X-Accel-Buffering': 'no',
            });
          res.flushHeaders();
        }
        const boundedAI = (url, options) =>
          aiFetcher(url, { ...options, signal: AbortSignal.any([signal, options.signal]) });
        const result = await runSearchPipeline({
          input: input.data,
          reserve: () => quota.reserve(),
          callAI:
            analyze ||
            ((request) =>
              analyzeGemini({ apiKey: geminiKey, model, input: request, fetcher: boundedAI })),
          searchPlaces: geocoder.search,
          searchDocuments,
          searchReferences,
          fetcher,
          broadSearch: Boolean(braveKey),
          signal,
          onProgress: input.data.stream
            ? (progress) => send({ type: 'progress', ...progress })
            : undefined,
        });
        const response = { ...result, source: 'ai', verified: false };
        if (input.data.stream) {
          send({ type: 'result', result: response });
          return res.end();
        }
        return res.json(response);
      }
      if (!(await quota.reserve()))
        return res.status(429).json({
          error: 'The server’s daily analysis limit has been reached. Try again after 00:00 UTC.',
        });
      let result;
      if (analyze) result = await analyze(input.data);
      else if (provider === 'gemini')
        result = await analyzeGemini({
          apiKey: geminiKey,
          model,
          input: input.data,
          fetcher: aiFetcher,
        });
      else {
        const client = new OpenAI({ apiKey, timeout: 60000, maxRetries: 0 });
        const response = await client.responses.create({
          model,
          store: false,
          instructions: comparing ? comparisonInstructions : sceneInstructions,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: comparing
                    ? 'Image A is the investigation photo. Image B is the reference; its identity is unverified. Compare visible permanent features only.'
                    : sceneContext(input.data),
                },
                { type: 'input_image', image_url: input.data.image, detail: 'high' },
                ...(comparing
                  ? [{ type: 'input_image', image_url: input.data.referenceImage, detail: 'high' }]
                  : []),
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: comparing ? 'image_comparison' : 'location_hypotheses',
              strict: true,
              schema: comparing ? comparisonJsonSchema : analysisJsonSchema,
            },
          },
          max_output_tokens: 6000,
        });
        if (!response.output_text)
          return res.status(422).json({
            error: 'The model could not analyze this image. Try a landscape or a wider view.',
          });
        result = JSON.parse(response.output_text);
      }
      const validated = (comparing ? comparisonSchema : analysisSchema).safeParse(result);
      if (!validated.success)
        return res.status(502).json({
          error: comparing
            ? 'The model returned an invalid comparison. No comparison was saved; please try again.'
            : 'The model returned an invalid result. No candidates were saved; please try again.',
        });
      if (comparing)
        return res.json({ ...assessComparison(validated.data), source: 'ai', verified: false });
      return res.json({
        ...(await resolveAnalysisPoints(
          assessAnalysis(validated.data, input.data.feedback),
          geocoder.search,
        )),
        source: 'ai',
        verified: false,
      });
    } catch {
      if (res.headersSent) {
        if (!res.destroyed && !res.writableEnded)
          res.end(
            JSON.stringify({
              type: 'error',
              error:
                'Search could not finish. It may have timed out, reached the daily allowance or lost provider access. No result was saved.',
            }) + '\n',
          );
        return;
      }
      return res.status(502).json({
        error:
          'AI analysis failed. Check the server API key, model access, and connection, then try again.',
      });
    } finally {
      runningAnalysis--;
    }
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown endpoint.' }));
  app.use(express.static(path.join(root, 'dist')));
  app.get('/', (req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: 'The image is too large. Choose a smaller image.' });
    if (err instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON request.' });
    return res.status(500).json({ error: 'An unexpected server error occurred.' });
  });
  return app;
}
