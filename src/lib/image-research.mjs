import { z } from 'zod';

export const comparisonSchema = z.object({
  verdict: z.enum(['supports', 'different', 'inconclusive']),
  summary: z.string().min(1).max(1200),
  findings: z
    .array(
      z.object({
        feature: z.string().min(1).max(150),
        sourceObservation: z.string().min(1).max(600),
        referenceObservation: z.string().min(1).max(600),
        assessment: z.enum(['match', 'contradiction', 'unclear']),
      }),
    )
    .max(8),
  limitations: z.array(z.string().max(600)).max(6),
});

export const comparisonJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'findings', 'limitations'],
  properties: {
    verdict: { type: 'string', enum: ['supports', 'different', 'inconclusive'] },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['feature', 'sourceObservation', 'referenceObservation', 'assessment'],
        properties: {
          feature: { type: 'string' },
          sourceObservation: { type: 'string' },
          referenceObservation: { type: 'string' },
          assessment: { type: 'string', enum: ['match', 'contradiction', 'unclear'] },
        },
      },
    },
    limitations: { type: 'array', maxItems: 6, items: { type: 'string' } },
  },
};

export function assessComparison(raw) {
  const result = comparisonSchema.parse(raw);
  const matches = new Set(
    result.findings
      .filter((f) => f.assessment === 'match')
      .map((f) => f.feature.trim().toLowerCase()),
  );
  const contradictions = result.findings.some((f) => f.assessment === 'contradiction');
  if (
    (result.verdict === 'supports' && (matches.size < 2 || contradictions)) ||
    (result.verdict === 'different' && !contradictions)
  ) {
    result.verdict = 'inconclusive';
    result.summary =
      'The available paired observations do not establish a reliable visual match. Review both images independently.';
    result.limitations = [
      'The reported findings do not support a clear verdict. Review both images independently.',
      ...result.limitations,
    ].slice(0, 6);
  }
  return result;
}

export const comparisonVerdicts = {
  supports: 'Visual support · unverified',
  different: 'Visible contradictions',
  inconclusive: 'Inconclusive comparison',
};

export function commonsImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) &&
      url.pathname.startsWith('/wikipedia/commons/') &&
      value.length <= 2000
      ? url.href
      : null;
  } catch {
    return null;
  }
}
