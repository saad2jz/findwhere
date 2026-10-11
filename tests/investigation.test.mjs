import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeAnalysis,
  validateCandidateEdit,
  validateEvidence,
} from '../src/lib/investigation.mjs';
import { copyCase, exportReport } from '../src/lib/domain.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';
import { demoCase } from '../src/data/demo.mjs';

const evidenceDraft = () => ({
  text: '  The skyline has two towers.  ',
  category: ' Landmark ',
  source: ' Field notes ',
  url: ' https://example.com/imagery?q=Lisbon ',
  observedOn: '2009-06-07',
});
const candidateDraft = (candidate) => ({
  ...candidate,
  coordinates: `${candidate.lat}, ${candidate.lng}`,
});

test('sourced evidence records a date and normalized source without claiming verification', () => {
  const { value, errors } = validateEvidence(evidenceDraft());
  assert.deepEqual(errors, {});
  assert.equal(value.text, 'The skyline has two towers.');
  assert.equal(value.category, 'Landmark');
  assert.equal(value.source, 'Field notes');
  assert.equal(value.url, 'https://example.com/imagery?q=Lisbon');
  assert.equal(value.observedOn, '2009-06-07');
  assert.equal(value.checked, false);
  assert.notEqual(value.id, validateEvidence(evidenceDraft()).value.id);
});

test('evidence edits preserve identity and clear stale checked status only when content changes', () => {
  const original = { ...validateEvidence(evidenceDraft()).value, checked: true };
  assert.deepEqual(validateEvidence(evidenceDraft(), original).value, original);
  for (const change of [
    { text: 'Different tower arrangement' },
    { url: '' },
    { observedOn: '2010-06-07' },
    { source: 'Another source' },
  ]) {
    const updated = validateEvidence({ ...evidenceDraft(), ...change }, original).value;
    assert.equal(updated.id, original.id);
    assert.equal(updated.checked, false);
    assert.ok(updated.editedAt);
  }
  assert.equal(original.checked, true);
});

test('source validation rejects unsafe links, impossible dates and empty observations with field errors', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hello',
    'file:///secret',
    '/relative',
    'https://user:secret@example.com',
  ]) {
    const result = validateEvidence({ ...evidenceDraft(), url });
    assert.ok(result.errors.url);
    assert.equal(result.value, undefined);
  }
  const result = validateEvidence({ ...evidenceDraft(), text: ' ', observedOn: '2025-02-30' });
  assert.ok(result.errors.text);
  assert.ok(result.errors.observedOn);
  assert.equal(result.value, undefined);
  const minimal = validateEvidence({
    text: 'Observation',
    category: '',
    source: '',
    url: '',
    observedOn: '',
  }).value;
  assert.equal(minimal.source, 'Investigator');
  assert.equal(minimal.category, 'Observation');
  assert.equal(minimal.url, undefined);
});

test('moving a supported candidate resets confidence and status while preserving its original source', () => {
  const original = demoCase().candidates[0];
  const result = validateCandidateEdit(original, {
    ...candidateDraft(original),
    name: 'Refined viewpoint',
    coordinates: '38.7121901, -9.1338212',
  });
  assert.deepEqual(result.errors, {});
  assert.equal(result.changedPoint, true);
  assert.equal(result.value.id, original.id);
  assert.equal(result.value.source, 'manual');
  assert.equal(result.value.status, 'hypothesis');
  assert.equal(result.value.confidence, 'low');
  assert.equal(result.value.lat, 38.7121901);
  const { id, ...details } = original;
  assert.deepEqual(result.value.original, details);
  assert.equal(original.status, 'supported');
});

test('candidate refinements keep the first original lead across repeated edits and no-op saves', () => {
  const original = { ...demoCase().candidates[0], source: 'ai' };
  assert.deepEqual(validateCandidateEdit(original, candidateDraft(original)).value, original);
  const first = validateCandidateEdit(original, {
    ...candidateDraft(original),
    reason: 'Compare the tower against another image.',
  }).value;
  const second = validateCandidateEdit(first, {
    ...candidateDraft(first),
    name: 'Updated name',
    confidence: 'medium',
  }).value;
  assert.deepEqual(second.original, first.original);
  assert.equal(second.original.source, 'ai');
  assert.equal(second.confidence, 'medium');
  assert.equal(second.status, 'supported');
});

test('invalid candidate coordinates never replace a lead and expose all relevant field errors', () => {
  const original = demoCase().candidates[0];
  for (const coordinates of ['91,0', '0,-181', 'NaN,2', ',0', 'Paris']) {
    const result = validateCandidateEdit(original, {
      ...candidateDraft(original),
      name: '',
      coordinates,
    });
    assert.ok(result.errors.coordinates);
    assert.ok(result.errors.name);
    assert.equal(result.value, undefined);
  }
});

test('reports and backups retain evidence dates and the provenance of refined candidates', () => {
  const investigation = copyCase(demoCase());
  const original = investigation.candidates[0];
  investigation.candidates[0] = validateCandidateEdit(original, {
    ...candidateDraft(original),
    name: 'Investigator viewpoint',
  }).value;
  investigation.clues.push(validateEvidence(evidenceDraft()).value);
  const report = exportReport(investigation);
  assert.match(report, /Reference date: 2009-06-07/);
  assert.match(report, /Original lead: Castelo de São Jorge/);
  assert.match(report, /Original reasoning:/);
  assert.match(report, /source: demo/);
  const restored = importBackup(exportBackup([investigation]))[0];
  assert.deepEqual(restored.candidates, investigation.candidates);
  assert.deepEqual(restored.clues, investigation.clues);
});

test('reanalysis preserves reviewed and edited work while replacing untouched AI hypotheses', () => {
  const item = copyCase(demoCase());
  const response = {
    summary: 'A hillside scene.',
    candidates: [
      {
        name: 'AI viewpoint',
        country: 'Portugal',
        lat: 38.7,
        lng: -9.1,
        confidence: 'low',
        reason: 'Compare the skyline.',
      },
    ],
    clues: [
      { category: 'Architecture', text: 'Stone buildings.' },
      { category: 'Landscape', text: 'A hillside.' },
    ],
    nextSteps: ['Compare dated imagery.'],
  };
  const first = mergeAnalysis(item, response);
  const originalAI = first.candidates.find((candidate) => candidate.source === 'ai');
  const refinedAI = validateCandidateEdit(originalAI, {
    ...candidateDraft(originalAI),
    reason: 'Investigator compared the permanent tower.',
  }).value;
  first.candidates = first.candidates.map((candidate) =>
    candidate.id === originalAI.id ? refinedAI : candidate,
  );
  const reviewed = first.clues.find((clue) => clue.source === 'AI scene analysis');
  reviewed.checked = true;
  const edited = first.clues.filter((clue) => clue.source === 'AI scene analysis')[1];
  const updatedEvidence = validateEvidence(
    { ...edited, text: 'An investigator annotation.', url: '', observedOn: '' },
    edited,
  ).value;
  first.clues = first.clues.map((clue) => (clue.id === edited.id ? updatedEvidence : clue));
  first.clues.push({ ...edited, id: 'untouched-ai-clue', text: 'Old unreviewed clue.' });
  first.candidates.push({ ...originalAI, id: 'untouched-ai-point' });
  const second = mergeAnalysis(first, {
    ...response,
    clues: [...response.clues, { category: '', text: '   ' }],
  });
  assert.deepEqual(
    second.candidates.find((candidate) => candidate.id === refinedAI.id),
    refinedAI,
  );
  assert.ok(second.clues.some((clue) => clue.id === reviewed.id && clue.checked));
  assert.ok(
    second.clues.some(
      (clue) => clue.id === edited.id && clue.text === 'An investigator annotation.',
    ),
  );
  assert.ok(!second.candidates.some((candidate) => candidate.id === 'untouched-ai-point'));
  assert.ok(!second.clues.some((clue) => clue.id === 'untouched-ai-clue'));
  assert.ok(second.clues.every((clue) => clue.text.trim()));
  assert.equal(second.photo, item.photo);
  assert.ok(second.notes.startsWith(item.notes));
  assert.equal(second.candidates.filter((candidate) => candidate.source === 'ai').length, 1);
});
