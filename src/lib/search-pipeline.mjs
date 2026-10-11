import { z } from 'zod';
import { comparisonSchema } from './image-research.mjs';

const url = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  });
export const searchSourceSchema = z.object({
  id: z.string().max(80),
  kind: z.enum(['web', 'article', 'place', 'image']),
  title: z.string().max(300),
  url,
  text: z.string().max(2400),
  thumbnail: url.optional(),
  attribution: z.string().max(1200).optional(),
  date: z.string().max(500).optional(),
});
export const searchCheckSchema = z.object({
  id: z.string().max(80),
  name: z.string().min(1).max(300),
  country: z.string().max(100),
  reason: z.string().max(1200),
  uncertainty: z.string().max(600),
  sourceIds: z.array(z.string().max(80)).max(8),
  features: z.array(z.string().max(2000)).max(12),
  status: z.enum(['mapped', 'unresolved', 'contradicted']),
  referenceStatus: z.enum(['compared', 'unavailable', 'skipped']),
  referenceId: z.string().max(80).optional(),
  comparison: comparisonSchema.optional(),
});
export const pipelineSchema = z.object({
  version: z.literal(1),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  engines: z.array(z.string().max(80)).max(4),
  requestsUsed: z.number().int().min(0).max(4),
  contextUsed: z.boolean(),
  correctionUsed: z.boolean(),
  queries: z.array(z.object({ service: z.string().max(80), query: z.string().max(200) })).max(20),
  sources: z.array(searchSourceSchema).max(40),
  checks: z.array(searchCheckSchema).max(3),
  warnings: z.array(z.string().max(500)).max(12),
});

export const pipelineStages = [
  ['scene', 'Read visible clues'],
  ['retrieve', 'Search places and references'],
  ['locate', 'Resolve named places'],
  ['compare', 'Compare reference photos'],
  ['rank', 'Rank the evidence'],
];

// Each line is a complete server event. A disconnected stream cannot masquerade as a result.
export async function readPipelineResponse(response, onProgress = () => {}) {
  if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Search failed. Please try again.');
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === 'progress' && pipelineStages.some(([id]) => id === event.stage))
      onProgress({ stage: event.stage, detail: String(event.detail || '').slice(0, 300) });
    if (event.type === 'error') throw new Error(event.error || 'Search failed. Please try again.');
    if (event.type === 'result') result = event.result;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      if (buffer.length > 1_000_000) throw new Error('Search response was too large.');
      let boundary;
      while ((boundary = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!result) throw new Error('Search disconnected before completing. Please try again.');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
  }
}
