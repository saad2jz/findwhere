import {
  analysisSchema,
  candidateSchema,
  caseSchema,
  clueSchema,
  parseCoordinates,
  safeUrl,
} from './domain.mjs';

function errorsFrom(result) {
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path[0] || 'form', issue.message]),
  );
}

export function validateEvidence(draft, existing = null) {
  const url = draft.url?.trim() || undefined;
  const urlError =
    url && !safeUrl(url)
      ? 'Use a complete http:// or https:// source link without embedded credentials.'
      : null;
  const fields = {
    text: draft.text.trim(),
    category: draft.category.trim() || 'Observation',
    source: draft.source.trim() || 'Investigator',
    url: url ? safeUrl(url) : undefined,
    observedOn: draft.observedOn || undefined,
  };
  const changed = existing && Object.keys(fields).some((key) => fields[key] !== existing[key]);
  const result = clueSchema.safeParse({
    ...existing,
    ...fields,
    id: existing?.id || crypto.randomUUID(),
    checked: changed ? false : existing?.checked || false,
    ...(changed ? { editedAt: new Date().toISOString() } : {}),
  });
  const errors = result.success ? {} : errorsFrom(result);
  if (urlError) errors.url = urlError;
  if (!fields.text) errors.text = 'Write an observation before saving.';
  return Object.keys(errors).length ? { errors } : { value: result.data, errors: {} };
}

export function validateCandidateEdit(existing, draft) {
  let point;
  let coordinateError;
  try {
    point = parseCoordinates(draft.coordinates);
  } catch (error) {
    coordinateError = error.message;
    point = { lat: existing.lat, lng: existing.lng };
  }
  const changedPoint = point.lat !== existing.lat || point.lng !== existing.lng;
  const fields = {
    ...point,
    name: draft.name.trim(),
    country: draft.country.trim(),
    reason: draft.reason.trim(),
    confidence: changedPoint ? 'low' : draft.confidence,
    status: changedPoint ? 'hypothesis' : draft.status,
  };
  const changed = Object.keys(fields).some((key) => fields[key] !== existing[key]);
  const { id, original, editedAt, ...originalDetails } = existing;
  const result = candidateSchema.safeParse({
    ...existing,
    ...fields,
    ...(changed
      ? {
          source: 'manual',
          original: original || originalDetails,
          editedAt: new Date().toISOString(),
        }
      : {}),
  });
  const errors = result.success ? {} : errorsFrom(result);
  if (coordinateError) errors.coordinates = coordinateError;
  if (!fields.name) errors.name = 'Name this location candidate.';
  return Object.keys(errors).length ? { errors } : { value: result.data, errors: {}, changedPoint };
}

export function mergeAnalysis(previous, response, incomingCandidates) {
  const result = analysisSchema.parse(response);
  const candidates =
    incomingCandidates ||
    result.candidates.map((candidate) => ({
      ...candidate,
      id: crypto.randomUUID(),
      source: 'ai',
      status: 'hypothesis',
    }));
  return caseSchema.parse({
    ...previous,
    updatedAt: new Date().toISOString(),
    candidates: [
      ...previous.candidates.filter(
        (candidate) => candidate.source !== 'ai' || candidate.status !== 'hypothesis',
      ),
      ...candidates,
    ].slice(0, 50),
    clues: [
      ...previous.clues.filter(
        (clue) => clue.source !== 'AI scene analysis' || clue.editedAt || clue.checked,
      ),
      ...result.clues
        .filter((clue) => clue.text.trim())
        .map((clue) => ({
          ...clue,
          category: clue.category || 'Observation',
          id: crypto.randomUUID(),
          checked: false,
          source: 'AI scene analysis',
        })),
    ].slice(0, 100),
    notes: [
      previous.notes,
      `AI scene read (unverified): ${result.summary}`,
      'Next checks:\n' + result.nextSteps.map((step) => '• ' + step).join('\n'),
    ]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 20000),
  });
}
