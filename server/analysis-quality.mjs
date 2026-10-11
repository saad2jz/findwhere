import { analysisSchema } from '../src/lib/domain.mjs';
import { resolvePlaceReference } from '../src/lib/place-match.mjs';
import { featureSearchLeads } from '../src/lib/research-leads.mjs';

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

const candidateLead = (candidate, features, uncertainty) => ({
  name: candidate.name,
  kind: 'place',
  query: `${candidate.name}, ${candidate.country}`.slice(0, 200),
  reason: candidate.reason.trim() || 'Compare this possible place with the visible features.',
  uncertainty,
  features,
});

function clueFeatures(indexes, clues) {
  const distinct = [...new Set(indexes)];
  const features = distinct.map((index) => clues[index]?.text.trim()).filter(Boolean);
  return features.length === distinct.length &&
    new Set(features.map(normalize)).size === features.length
    ? features
    : [];
}

// This is a conservative structural check, not independent visual verification.
export function assessAnalysis(raw, feedback) {
  const result = analysisSchema.parse(raw);
  const rejected = new Set(
    [
      ...(feedback?.rejectedNames || []),
      ...result.candidates
        .filter((candidate) => candidate.contradictions.some((item) => item.trim()))
        .map((candidate) => candidate.name),
    ]
      .map(normalizeName)
      .filter(Boolean),
  );
  const isRejected = (value) => [...rejected].some((name) => normalizeName(value).includes(name));
  const researchLeads = result.leads.flatMap((lead) => {
    const features = clueFeatures(lead.supportingClueIndexes, result.clues);
    if (
      isRejected(lead.name) ||
      isRejected(lead.query) ||
      features.length < (lead.kind === 'feature' ? 1 : 2)
    )
      return [];
    const { supportingClueIndexes, ...details } = lead;
    return [{ ...details, features }];
  });
  const candidates = result.candidates.flatMap((candidate) => {
    const features = clueFeatures(candidate.supportingClueIndexes, result.clues);
    if (candidate.contradictions.some((item) => item.trim()) || isRejected(candidate.name))
      return [];
    if (
      candidate.confidence === 'low' ||
      !candidate.distinctiveMatch.trim() ||
      features.length < 2
    ) {
      if (features.length >= 2)
        researchLeads.push(
          candidateLead(
            candidate,
            features,
            'Insufficient distinctive evidence for a map candidate. This possible place needs an independent reference comparison.',
          ),
        );
      return [];
    }
    return [
      {
        ...candidate,
        visualEvidence: { features, distinctiveMatch: candidate.distinctiveMatch.trim() },
      },
    ];
  });
  const withheldCandidates = result.candidates.length - candidates.length;
  const mappedNames = new Set(candidates.map((candidate) => normalizeName(candidate.name)));
  const seen = new Set(mappedNames);
  const distinctLeads = researchLeads
    .filter((lead) => {
      const key = normalizeName(lead.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  return {
    ...result,
    leads: [],
    candidates,
    withheldCandidates,
    researchLeads:
      distinctLeads.length || candidates.length
        ? distinctLeads
        : featureSearchLeads(result.clues).filter((lead) => !isRejected(lead.query)),
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

export async function resolveAnalysisPoints(assessment, lookup) {
  const candidates = [];
  const researchLeads = [...assessment.researchLeads];
  const uncertainties = [...assessment.uncertainties];
  for (const candidate of assessment.candidates.slice(0, 3)) {
    try {
      const results = await lookup(`${candidate.name}, ${candidate.country}`.slice(0, 200), {
        waitForSlot: true,
      });
      const resolved = resolvePlaceReference(candidate, results);
      if (resolved) {
        candidates.push(resolved);
        continue;
      }
    } catch {
      /* Keep clues and explain the missing map reference without inventing a point. */
    }
    uncertainties.unshift(
      `${candidate.name}: no unambiguous landmark reference was found in the geocoder; the AI coordinate guess was not placed on the map.`,
    );
    researchLeads.unshift(
      candidateLead(
        candidate,
        candidate.visualEvidence.features,
        'No unambiguous landmark map reference was found. Search for reference photos before placing this lead on the map.',
      ),
    );
  }
  return {
    ...assessment,
    candidates,
    summary: candidates.length
      ? assessment.summary
      : 'Location undetermined from the available visual evidence.' +
        (researchLeads.length ? ' Explore the research leads below.' : ''),
    researchLeads: researchLeads.slice(0, 3),
    uncertainties: uncertainties.slice(0, 8),
    withheldCandidates:
      assessment.withheldCandidates + assessment.candidates.length - candidates.length,
  };
}
