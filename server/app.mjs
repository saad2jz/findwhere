import express from 'express';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { analysisSchema, analysisJsonSchema, analysisFeedbackSchema } from '../src/lib/domain.mjs';
import { assessAnalysis, sceneContext } from './analysis-quality.mjs';
import { createAccess, createDailyQuota } from './security.mjs';
import { analyzeGemini, sceneInstructions } from './gemini.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestSchema = z.object({
  image: z
    .string()
    .max(5_000_000)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
  context: z.string().max(2000).default(''),
  feedback: analysisFeedbackSchema.optional(),
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
  let lastGeocode = -Infinity;
  const cache = new Map();
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://server.arcgisonline.com; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
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
      ...usage,
    });
  });

  app.get('/api/geocode', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 3 || query.length > 200)
      return res.status(400).json({ error: 'Enter a place name between 3 and 200 characters.' });
    const key = query.toLocaleLowerCase();
    const cached = cache.get(key);
    if (cached && now() - cached.time < 24 * 60 * 60 * 1000)
      return res.json({ results: cached.results, attribution: '© OpenStreetMap contributors' });
    if (now() - lastGeocode < 1100)
      return res.status(429).json({ error: 'Please wait a moment before searching again.' });
    lastGeocode = now();
    const url = new URL(geocoderUrl);
    url.search = new URLSearchParams({
      q: query,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '5',
    }).toString();
    try {
      const response = await fetcher(url, {
        headers: {
          'User-Agent':
            process.env.GEOCODER_USER_AGENT ||
            'Findwhere/1.0 (https://github.com/saad2jz/findwhere)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('Geocoder unavailable');
      const raw = await response.json();
      if (!Array.isArray(raw)) throw new Error('Invalid geocoder response');
      const results = raw
        .slice(0, 5)
        .map((item) => ({
          name: String(item.display_name || '').slice(0, 300),
          country: String(item.address?.country || '').slice(0, 100),
          lat: Number(item.lat),
          lng: Number(item.lon),
        }))
        .filter(
          (item) =>
            item.name &&
            Number.isFinite(item.lat) &&
            Number.isFinite(item.lng) &&
            Math.abs(item.lat) <= 90 &&
            Math.abs(item.lng) <= 180,
        );
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, { time: now(), results });
      return res.json({ results, attribution: '© OpenStreetMap contributors' });
    } catch {
      return res.status(502).json({
        error: 'Place search is unavailable. You can still add a candidate by coordinates.',
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
          'Provide a JPEG, PNG, or WebP image under 3.5 MB and no more than 2,000 characters of context.',
      });
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
          instructions: sceneInstructions,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: sceneContext(input.data),
                },
                { type: 'input_image', image_url: input.data.image, detail: 'high' },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'location_hypotheses',
              strict: true,
              schema: analysisJsonSchema,
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
      const validated = analysisSchema.safeParse(result);
      if (!validated.success)
        return res.status(502).json({
          error:
            'The model returned an invalid result. No candidates were saved; please try again.',
        });
      return res.json({
        ...assessAnalysis(validated.data, input.data.feedback),
        source: 'ai',
        verified: false,
      });
    } catch {
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
