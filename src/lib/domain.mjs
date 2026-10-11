import { z } from 'zod';

export const pointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});
const candidateDetailsSchema = pointSchema.extend({
  name: z.string().min(1).max(300),
  country: z.string().max(100),
  confidence: z.enum(['low', 'medium', 'high']),
  status: z.enum(['hypothesis', 'supported', 'ruled-out']),
  source: z.enum(['manual', 'gps', 'ai', 'demo']),
  reason: z.string().max(2000),
});
export const candidateSchema = candidateDetailsSchema.extend({
  id: z.string().min(1).max(100),
  original: candidateDetailsSchema.optional(),
  editedAt: z.iso.datetime().optional(),
});
export const clueSchema = z.object({
  id: z.string().min(1).max(100),
  category: z.string().max(80),
  text: z.string().min(1).max(2000),
  source: z.string().max(200),
  checked: z.boolean(),
  url: z.string().max(2000).optional(),
  observedOn: z.iso.date().optional(),
  editedAt: z.iso.datetime().optional(),
});
export const caseSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  demo: z.boolean(),
  photo: z
    .string()
    .max(6_000_000)
    .refine(
      (value) =>
        value === '/lisbon.jpg' ||
        /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value),
      'Photos must be embedded JPEG, PNG or WebP images.',
    )
    .nullable(),
  fileName: z.string().max(300),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  candidates: z
    .array(candidateSchema)
    .max(50)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Candidate identities must be unique.',
    ),
  clues: z
    .array(clueSchema)
    .max(100)
    .refine(
      (items) => new Set(items.map((item) => item.id)).size === items.length,
      'Evidence identities must be unique.',
    ),
  notes: z.string().max(20000),
  archivedAt: z.iso.datetime().nullable().default(null),
});

export function createCase(title = 'Untitled investigation') {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    demo: false,
    photo: null,
    fileName: '',
    metadata: {},
    candidates: [],
    clues: [],
    notes: '',
    archivedAt: null,
  };
}

export function copyCase(investigation) {
  const value = caseSchema.parse(investigation);
  const now = new Date().toISOString();
  return {
    ...structuredClone(value),
    id: crypto.randomUUID(),
    title: `${value.title.slice(0, 193)} — copy`,
    createdAt: now,
    updatedAt: now,
    demo: false,
    archivedAt: null,
  };
}

export function parseCoordinates(input) {
  const parts = input.trim().split(',');
  if (parts.length !== 2 || parts.some((p) => !p.trim()))
    throw new Error('Use latitude, longitude — for example 38.71217, -9.13380.');
  const point = pointSchema.safeParse({ lat: Number(parts[0]), lng: Number(parts[1]) });
  if (!point.success) throw new Error('Latitude must be −90 to 90 and longitude −180 to 180.');
  return point.data;
}

export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function mapLinks(point, name = '') {
  const { lat, lng } = pointSchema.parse(point);
  const pair = `${lat},${lng}`;
  return {
    google: `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: pair })}`,
    streetview: `https://www.google.com/maps/@?${new URLSearchParams({ api: '1', map_action: 'pano', viewpoint: pair })}`,
    osm: `https://www.openstreetmap.org/?${new URLSearchParams({ mlat: lat, mlon: lng })}#map=17/${lat}/${lng}`,
    bing: `https://www.bing.com/maps?${new URLSearchParams({ cp: `${lat}~${lng}`, lvl: '17' })}`,
    search: `https://www.google.com/search?${new URLSearchParams({ q: name || pair })}`,
  };
}

export function resourceLink(resource, candidate) {
  if (!candidate) return resource.url;
  const links = mapLinks(candidate, `${candidate.name} ${candidate.country}`);
  return links[resource.builder] || resource.url;
}

function md(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '')
    .replaceAll('\n', ' ');
}
export function exportReport(investigation) {
  const data = caseSchema.parse(investigation);
  const lines = [
    `# ${md(data.title)}`,
    '',
    `Created: ${data.createdAt}`,
    `Updated: ${data.updatedAt}`,
    `Image: ${md(data.fileName || 'No image')}`,
    data.demo
      ? 'Type: sample investigation — reference data, not a live analysis.'
      : 'Type: user investigation.',
    '',
    'Location candidates are hypotheses unless independently verified. GPS metadata can be edited; AI confidence is not a calibrated probability.',
    '',
    '## Metadata',
    '',
  ];
  for (const [key, value] of Object.entries(data.metadata))
    lines.push(`- ${md(key)}: ${md(value ?? 'Not available')}`);
  lines.push('', '## Location candidates', '');
  for (const candidate of data.candidates) {
    lines.push(
      `### ${md(candidate.name)}`,
      '',
      `Country: ${md(candidate.country)}`,
      `Coordinates (WGS84): ${candidate.lat}, ${candidate.lng}`,
      `Status: ${candidate.status}; confidence: ${candidate.confidence}; source: ${candidate.source}`,
      '',
      md(candidate.reason),
      '',
      `[OpenStreetMap](<${mapLinks(candidate).osm}>)`,
      '',
    );
    if (candidate.original) {
      const original = candidate.original;
      lines.push(
        `Original lead: ${md(original.name)} (${md(original.country)}); source: ${original.source}; coordinates: ${original.lat}, ${original.lng}`,
        `Original status: ${original.status}; confidence: ${original.confidence}`,
        '',
        `Original reasoning: ${md(original.reason)}`,
        '',
      );
    }
  }
  lines.push('## Evidence ledger', '');
  for (const clue of data.clues) {
    lines.push(
      `- [${clue.checked ? 'x' : ' '}] ${md(clue.category)}: ${md(clue.text)} (source: ${md(clue.source)})`,
    );
    if (clue.observedOn) lines.push(`  Reference date: ${clue.observedOn}`);
    if (clue.url && safeUrl(clue.url))
      lines.push(`  Source: <${safeUrl(clue.url).replaceAll('<', '%3C').replaceAll('>', '%3E')}>`);
  }
  lines.push(
    '',
    '## Investigator notes',
    '',
    data.notes || 'No notes recorded.',
    '',
    '## Verification',
    '',
    '- Compare three permanent scene features with independent reference imagery.',
    '- Check image dates and contradictions before supporting a candidate.',
    '- Require two independent constraints before claiming precision within 100 metres.',
    '',
  );
  return lines.join('\n');
}

export const analysisSchema = z.object({
  summary: z.string().max(2000),
  clues: z.array(z.object({ category: z.string().max(80), text: z.string().max(2000) })).max(12),
  candidates: z
    .array(
      pointSchema.extend({
        name: z.string().min(1).max(300),
        country: z.string().max(100),
        confidence: z.enum(['low', 'medium', 'high']),
        reason: z.string().max(2000),
      }),
    )
    .max(5),
  nextSteps: z.array(z.string().max(500)).max(8),
});

export const analysisJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'clues', 'candidates', 'nextSteps'],
  properties: {
    summary: { type: 'string' },
    clues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'text'],
        properties: { category: { type: 'string' }, text: { type: 'string' } },
      },
    },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'country', 'lat', 'lng', 'confidence', 'reason'],
        properties: {
          name: { type: 'string' },
          country: { type: 'string' },
          lat: { type: 'number' },
          lng: { type: 'number' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          reason: { type: 'string' },
        },
      },
    },
    nextSteps: { type: 'array', items: { type: 'string' } },
  },
};
