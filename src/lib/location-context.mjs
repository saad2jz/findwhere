import { z } from 'zod';

const point = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
const sourceUrl = z
  .string()
  .max(2000)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password;
    } catch {
      return false;
    }
  });
export const contextRequestSchema = point
  .extend({
    radius: z.union([z.literal(500), z.literal(1000), z.literal(2000)]).default(1000),
    category: z.enum(['all', 'fuel', 'landmarks']).default('all'),
    date: z.iso.date().optional(),
  })
  .strict();
const status = z.enum(['available', 'unavailable']);
const measurement = z.number().finite().min(-15000).max(15000).nullable();
export const locationContextSchema = point.extend({
  radius: z.number().int().min(500).max(2000),
  category: z.enum(['all', 'fuel', 'landmarks']),
  date: z.iso.date().optional(),
  fetchedAt: z.iso.datetime(),
  nearby: z.object({
    status,
    source: sourceUrl,
    attribution: z.string().max(200),
    items: z
      .array(
        point.extend({
          id: z.string().max(100),
          name: z.string().min(1).max(300),
          type: z.string().max(80),
          url: sourceUrl,
          distanceMetres: z.number().finite().min(0).max(5000),
          bearing: z.number().finite().min(0).max(360).nullable(),
        }),
      )
      .max(20),
  }),
  terrain: z.object({
    status,
    source: sourceUrl,
    attribution: z.string().max(200),
    samples: z
      .array(
        point.extend({
          direction: z.enum(['Center', 'N', 'E', 'S', 'W']),
          elevation: measurement,
          dataset: z.enum(['srtm90m', 'aster30m']),
        }),
      )
      .max(5),
  }),
  weather: z.object({
    status: z.enum(['available', 'unavailable', 'not-requested']),
    source: sourceUrl,
    attribution: z.string().max(200),
    grid: point.optional(),
    timezone: z.string().max(100).optional(),
    minimum: z.number().finite().min(-100).max(70).nullable().optional(),
    maximum: z.number().finite().min(-100).max(70).nullable().optional(),
    precipitation: z.number().finite().min(0).max(10000).nullable().optional(),
    cloudCover: z.number().finite().min(0).max(100).nullable().optional(),
    sunrise: z.string().max(30).nullable().optional(),
    sunset: z.string().max(30).nullable().optional(),
  }),
});

export function contextMatchesCandidate(context, candidate) {
  return Boolean(
    context && candidate && context.lat === candidate.lat && context.lng === candidate.lng,
  );
}
