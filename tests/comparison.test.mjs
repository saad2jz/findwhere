import test from 'node:test';
import assert from 'node:assert/strict';
import {
  caseSchema,
  copyCase,
  createCase,
  exportReport,
  referenceDetailsSchema,
} from '../src/lib/domain.mjs';
import { exportBackup, importBackup } from '../src/lib/backup.mjs';
import { mergeAnalysis } from '../src/lib/investigation.mjs';

function withReference() {
  return {
    ...createCase('Comparison test'),
    reference: {
      photo: 'data:image/jpeg;base64,/9j/AAAA',
      fileName: '参考-image.jpg',
      sourceUrl: 'https://example.com/reference?date=2025',
      notes: 'Tower matches; the bridge angle contradicts the candidate.',
    },
  };
}
test('reference images and provenance survive backups and independent copies', () => {
  const original = withReference();
  const restored = importBackup(exportBackup([original]))[0];
  assert.deepEqual(restored.reference, original.reference);
  assert.notEqual(restored.id, original.id);
  const copy = copyCase(original);
  copy.reference.notes = 'Different observation';
  assert.notEqual(copy.reference.notes, original.reference.notes);
  const legacy = createCase();
  delete legacy.reference;
  assert.equal(caseSchema.parse(legacy).reference, null);
});
test('reference backups reject remote images, active image types, unsafe URLs and oversized content', () => {
  const original = withReference();
  for (const change of [
    { photo: 'https://example.com/tracker.jpg' },
    { photo: 'data:image/svg+xml;base64,AAAA' },
    { photo: 'data:image/jpeg;base64,' + 'A'.repeat(6_000_000) },
    { sourceUrl: 'javascript:alert(1)' },
    { sourceUrl: 'https://user:secret@example.com/' },
    { notes: 'x'.repeat(2001) },
  ]) {
    const text = JSON.stringify({
      format: 'findwhere-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      cases: [{ ...original, reference: { ...original.reference, ...change } }],
    });
    assert.throws(() => importBackup(text), /supported Findwhere backup/);
  }
  assert.equal(referenceDetailsSchema.safeParse({ sourceUrl: '', notes: '' }).success, true);
});
test('reports include reference source and observations without embedding a large image or claiming verification', () => {
  const original = withReference();
  const report = exportReport(original);
  assert.match(report, /Reference image comparison/);
  assert.match(report, /参考-image.jpg/);
  assert.match(report, /https:\/\/example.com\/reference\?date=2025/);
  assert.match(report, /bridge angle contradicts/);
  assert.match(report, /does not verify a location/);
  assert.doesNotMatch(report, /data:image/);
});
test('scene reanalysis retains the independently supplied reference image and notes', () => {
  const original = withReference();
  const result = mergeAnalysis(original, {
    summary: 'Unverified',
    clues: [],
    candidates: [],
    nextSteps: [],
  });
  assert.deepEqual(result.reference, original.reference);
  assert.equal(result.candidates.length, 0);
});
