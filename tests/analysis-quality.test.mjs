import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAnalysis, sceneContext } from '../server/analysis-quality.mjs';
import { createCase, exportReport } from '../src/lib/domain.mjs';
import { mergeAnalysis, recordAnalysisFeedback } from '../src/lib/investigation.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';

// Synthetic contract fixtures. These tests do not evaluate recognition accuracy.
const candidate = {
  name: 'Public landmark',
  country: 'France',
  lat: 48,
  lng: 2,
  confidence: 'medium',
  reason: 'A proposed visual match, requiring verification.',
  supportingClueIndexes: [0, 1],
  distinctiveMatch: 'A particular facade and garden alignment.',
  contradictions: [],
};
const output = {
  summary: 'A possible public landmark.',
  clues: [
    { category: 'Facade', text: 'Alternating brick panels and stone window surrounds.' },
    { category: 'Layout', text: 'A central pavilion aligned with a patterned garden and pool.' },
  ],
  candidates: [candidate],
  uncertainties: ['No independent reference image was compared.'],
  nextSteps: ['Compare the facade and garden with an official photograph.'],
};

test('generic low-confidence chateau guesses are withheld without discarding observations', () => {
  const result = assessAnalysis({
    ...output,
    candidates: ['Chateau de Fontainebleau', 'Chateau de Vaux-le-Vicomte'].map((name) => ({
      ...candidate,
      name,
      confidence: 'low',
    })),
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.withheldCandidates, 2);
  assert.match(result.summary, /undetermined/);
  assert.deepEqual(result.clues, output.clues);
});

test('candidates require distinct valid observations, a distinctive match and no contradictions', () => {
  for (const change of [
    { supportingClueIndexes: [] },
    { supportingClueIndexes: [0, 0] },
    { supportingClueIndexes: [0, 11] },
    { distinctiveMatch: '  ' },
    { contradictions: ['The facade material does not match.'] },
  ])
    assert.equal(
      assessAnalysis({ ...output, candidates: [{ ...candidate, ...change }] }).candidates.length,
      0,
    );
  assert.equal(
    assessAnalysis({ ...output, clues: [output.clues[0], output.clues[0]] }).candidates.length,
    0,
  );
  const { supportingClueIndexes, distinctiveMatch, contradictions, ...legacy } = candidate;
  assert.equal(assessAnalysis({ ...output, candidates: [legacy] }).candidates.length, 0);
});

test('retained hypotheses expose the exact model-reported visual support', () => {
  const result = assessAnalysis(output);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(
    result.candidates[0].visualEvidence.features,
    output.clues.map((item) => item.text),
  );
  assert.equal(result.withheldCandidates, 0);
  const investigation = mergeAnalysis(createCase('Synthetic test'), result);
  assert.equal(investigation.candidates[0].status, 'hypothesis');
  assert.equal(investigation.candidates[0].source, 'ai');
  assert.deepEqual(investigation.analysisReview.uncertainties, output.uncertainties);
});

test('rejected names cannot return as new hypotheses with accent or punctuation changes', () => {
  const result = assessAnalysis(
    { ...output, candidates: [{ ...candidate, name: 'Château de Fontainebleau' }] },
    {
      knownPlace: 'Parc de Sceaux',
      rejectedNames: ['Chateau de Fontainebleau'],
    },
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.withheldCandidates, 1);
});

test('corrections preserve existing work and round-trip through backup and reports', () => {
  const original = mergeAnalysis(createCase('Synthetic test'), assessAnalysis(output));
  original.candidates.push(
    { ...original.candidates[0], id: 'manual', source: 'manual' },
    { ...original.candidates[0], id: 'reviewed-ai', status: 'supported' },
  );
  const corrected = recordAnalysisFeedback(original, {
    knownPlace: ' Parc de Sceaux ',
    rejectAI: true,
  });
  assert.equal(corrected.candidates[0].status, 'ruled-out');
  assert.equal(corrected.candidates[1].source, 'manual');
  assert.equal(corrected.candidates[1].status, 'hypothesis');
  assert.equal(corrected.candidates[2].status, 'supported');
  assert.equal(original.candidates[0].status, 'hypothesis');
  assert.equal(corrected.analysisFeedback.knownPlace, 'Parc de Sceaux');
  const restored = importBackup(exportBackup([corrected]))[0];
  assert.deepEqual(restored.analysisFeedback, corrected.analysisFeedback);
  assert.deepEqual(restored.analysisReview, corrected.analysisReview);
  assert.deepEqual(restored.candidates[0].visualEvidence, corrected.candidates[0].visualEvidence);
  const report = exportReport(restored);
  assert.match(report, /user supplied, not an AI identification/);
  assert.match(report, /camera position and coordinate accuracy are unknown/i);
  assert.match(report, /No independent reference image/);
  const again = mergeAnalysis(corrected, assessAnalysis({ ...output, candidates: [] }));
  assert.equal(again.candidates[0].status, 'ruled-out');
  assert.deepEqual(again.analysisFeedback, corrected.analysisFeedback);
});

test('common landmark prefixes do not bypass a rejection, and empty results never claim a place', () => {
  for (const name of ['Fontainebleau', 'Castle of Fontainebleau', 'Château de Fontainebleau']) {
    const result = assessAnalysis(
      { ...output, candidates: [{ ...candidate, name }] },
      { knownPlace: '', rejectedNames: ['Chateau de Fontainebleau'] },
    );
    assert.deepEqual(result.candidates, []);
  }
  assert.match(assessAnalysis({ ...output, candidates: [] }).summary, /undetermined/);
});

test('correction transmission is explicit data and does not claim independent verification', () => {
  assert.equal(sceneContext({ context: 'User context' }), 'User context');
  const feedback = { knownPlace: 'Parc de Sceaux', rejectedNames: ['Fontainebleau'] };
  const context = JSON.parse(sceneContext({ context: 'Additional clues', feedback }));
  assert.deepEqual(context.investigatorCorrection, feedback);
  assert.match(context.note, /not independently verified/);
});

test('low-confidence proposals become actionable leads without leaking guessed map coordinates', () => {
  const result = assessAnalysis({ ...output, candidates: [{ ...candidate, confidence: 'low' }] });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.researchLeads[0].name, candidate.name);
  assert.equal(result.researchLeads[0].kind, 'place');
  assert.match(result.researchLeads[0].query, /Public landmark, France/);
  assert.match(result.researchLeads[0].uncertainty, /Insufficient/);
  assert.equal(result.researchLeads[0].lat, undefined);
  assert.equal(result.researchLeads[0].lng, undefined);
});

const lead = {
  name: 'A possible region',
  kind: 'region',
  query: 'region facade garden reference',
  reason: 'Investigate the combination of facade materials and garden layout.',
  uncertainty: 'These features occur in multiple regions.',
  supportingClueIndexes: [0, 1],
};

test('a model can return useful research leads with no mapped candidates', () => {
  const result = assessAnalysis({ ...output, candidates: [], leads: [lead] });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.researchLeads[0].kind, 'region');
  assert.equal(result.researchLeads[0].query, lead.query);
  assert.deepEqual(
    result.researchLeads[0].features,
    output.clues.map((c) => c.text),
  );
  assert.match(result.summary, /undetermined/);
});

test('rejected names, duplicate or invalid observations cannot return as geographic leads', () => {
  for (const change of [
    { name: 'Château de Fontainebleau' },
    { query: 'Castle of Fontainebleau facade photos' },
    { supportingClueIndexes: [0, 0] },
    { supportingClueIndexes: [0, 11] },
  ]) {
    const result = assessAnalysis(
      { ...output, candidates: [], leads: [{ ...lead, ...change }] },
      { knownPlace: '', rejectedNames: ['Fontainebleau'] },
    );
    assert.ok(result.researchLeads.every((item) => item.kind === 'feature'));
  }
  const duplicate = assessAnalysis({ ...output, candidates: [], leads: [lead, lead] });
  assert.equal(duplicate.researchLeads.length, 1);
});

test('empty recognition offers observed-feature queries, while an image without clues gets no invented place', () => {
  const result = assessAnalysis({ ...output, candidates: [] });
  assert.equal(result.researchLeads.length, 2);
  assert.ok(result.researchLeads.every((item) => item.kind === 'feature'));
  assert.equal(result.researchLeads[0].query, output.clues[0].text);
  assert.deepEqual(assessAnalysis({ ...output, candidates: [], clues: [] }).researchLeads, []);
});

test('research leads persist in backups and reports without becoming map candidates', () => {
  const result = assessAnalysis({ ...output, candidates: [], leads: [lead] });
  const investigation = mergeAnalysis(createCase('Research regression fixture'), result);
  const restored = importBackup(exportBackup([investigation]))[0];
  assert.deepEqual(restored.analysisReview.researchLeads, result.researchLeads);
  assert.deepEqual(restored.candidates, []);
  assert.match(exportReport(restored), /Research lead \(region, unverified\)/);
  assert.match(exportReport(restored), /These features occur in multiple regions/);
});
