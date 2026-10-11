import { analysisSchema } from '../src/lib/domain.mjs';

const normalize = (value) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

const normalizeName = (value) =>
  normalize(
    value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLocaleLowerCase()
      .replace(/\b(chateau|castle|palace|parc|park|domaine|de|du|des|le|la|les|the|of)\b/g, ''),
  );

// This is a conservative structural check, not independent visual verification.
export function assessAnalysis(raw, feedback) {
  const result = analysisSchema.parse(raw);
  const rejected = new Set((feedback?.rejectedNames || []).map(normalizeName).filter(Boolean));
  const candidates = result.candidates.flatMap((candidate) => {
    const indexes = [...new Set(candidate.supportingClueIndexes)];
    const features = indexes.map((index) => result.clues[index]?.text.trim()).filter(Boolean);
    if (
      candidate.confidence === 'low' ||
      !candidate.distinctiveMatch.trim() ||
      candidate.contradictions.some((item) => item.trim()) ||
      rejected.has(normalizeName(candidate.name)) ||
      indexes.length < 2 ||
      features.length !== indexes.length ||
      new Set(features.map(normalize)).size < 2
    )
      return [];
    return [
      {
        ...candidate,
        visualEvidence: { features, distinctiveMatch: candidate.distinctiveMatch.trim() },
      },
    ];
  });
  const withheldCandidates = result.candidates.length - candidates.length;
  return {
    ...result,
    candidates,
    withheldCandidates,
    summary: !candidates.length
      ? 'Location undetermined from the available visual evidence.'
      : result.summary,
  };
}

export function sceneContext(input) {
  if (!input.feedback)
    return (
      input.context ||
      'Read the scene. Return no location when distinctive evidence is insufficient.'
    );
  return JSON.stringify({
    userContext: input.context,
    investigatorCorrection: input.feedback,
    note: 'The reported place is supplied by the investigator, not independently verified. Check it against visible features; do not treat it as proof. Do not repeat rejected names.',
  });
}
