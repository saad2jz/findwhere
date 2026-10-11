import { z } from 'zod';

const leadFields = {
  name: z.string().trim().min(1).max(300),
  kind: z.enum(['place', 'region', 'feature']),
  query: z.string().trim().min(3).max(200),
  reason: z.string().trim().min(1).max(2000),
  uncertainty: z.string().trim().min(1).max(1000),
};
export const researchLeadSchema = z.object({
  ...leadFields,
  features: z.array(z.string().min(1).max(2000)).min(1).max(12),
});
export const modelLeadSchema = z.object({
  ...leadFields,
  supportingClueIndexes: z.array(z.number().int().min(0).max(11)).min(1).max(12),
});
export const modelLeadsJsonSchema = {
  type: 'array',
  maxItems: 3,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'kind', 'query', 'reason', 'uncertainty', 'supportingClueIndexes'],
    properties: {
      name: { type: 'string' },
      kind: { type: 'string', enum: ['place', 'region', 'feature'] },
      query: { type: 'string' },
      reason: { type: 'string' },
      uncertainty: { type: 'string' },
      supportingClueIndexes: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        items: { type: 'integer', minimum: 0, maximum: 11 },
      },
    },
  },
};

// Search queries derived from observations, not invented geographic identifications.
export function featureSearchLeads(clues) {
  const seen = new Set();
  return clues
    .flatMap((clue) => {
      const text = clue.text.trim();
      const key = text.toLocaleLowerCase();
      if (text.length < 3 || seen.has(key)) return [];
      seen.add(key);
      return [
        {
          name: `${clue.category || 'Visible feature'} search`.slice(0, 300),
          kind: 'feature',
          query: text.slice(0, 200),
          reason: 'Search for reference photos containing this observed feature.',
          uncertainty:
            'This is a search direction, not a suggested location. The observation may be mistaken.',
          features: [text],
        },
      ];
    })
    .slice(0, 3);
}
