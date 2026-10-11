import test from 'node:test';
import assert from 'node:assert/strict';
import { createCase, copyCase, caseSchema } from '../src/lib/domain.mjs';
import { demoCase } from '../src/data/demo.mjs';
import { exportBackup, importBackup, MAX_BACKUP_BYTES } from '../src/lib/backup.mjs';

test('backup round trip preserves photos, notes, evidence and archive status', () => {
  const item = copyCase(demoCase());
  item.photo = 'data:image/jpeg;base64,/9j/AAAA';
  item.title = '東京 — field notes';
  item.notes = 'Compare the bridge\nwith dated imagery.';
  item.archivedAt = new Date().toISOString();
  const restored = importBackup(exportBackup([item]));
  assert.equal(restored.length, 1);
  assert.notEqual(restored[0].id, item.id);
  assert.deepEqual({ ...restored[0], id: item.id }, item);
});

test('repeated imports and duplicate backup ids never overwrite existing identities', () => {
  const item = createCase();
  const text = exportBackup([item, item]);
  const restored = [...importBackup(text), ...importBackup(text)];
  assert.equal(new Set(restored.map((c) => c.id)).size, 4);
  assert.ok(restored.every((c) => c.id !== item.id));
});

test('unsupported versions and malformed or partially invalid backups are rejected as a whole', () => {
  const valid = JSON.parse(exportBackup([createCase()]));
  for (const value of [
    {},
    { ...valid, version: 2 },
    { ...valid, format: 'other-app' },
    { ...valid, cases: [] },
    { ...valid, cases: Array(101).fill(valid.cases[0]) },
    { ...valid, cases: [valid.cases[0], { ...valid.cases[0], candidates: [{ lat: 91 }] }] },
  ])
    assert.throws(() => importBackup(JSON.stringify(value)), /supported Findwhere backup/);
  assert.throws(() => importBackup('{broken'), /not valid JSON/);
  assert.throws(() => exportBackup([]), /no saved investigations/);
});

test('imports reject remote photos, active content and credentials in image URLs', () => {
  const valid = JSON.parse(exportBackup([createCase()]));
  for (const photo of [
    'https://example.com/tracker.jpg',
    '//example.com/image',
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,AAAA',
    'https://user:secret@example.com/photo.jpg',
  ])
    assert.throws(() =>
      importBackup(JSON.stringify({ ...valid, cases: [{ ...valid.cases[0], photo }] })),
    );
});

test('sample copies preserve provenance but have independent editable state', () => {
  const original = demoCase();
  const copy = copyCase(original);
  assert.equal(copy.demo, false);
  assert.notEqual(copy.id, original.id);
  assert.equal(copy.candidates[0].source, 'demo');
  assert.equal(copy.photo, '/lisbon.jpg');
  copy.clues[0].checked = !original.clues[0].checked;
  assert.notEqual(copy.clues[0].checked, original.clues[0].checked);
  assert.equal(copy.archivedAt, null);
  assert.equal(caseSchema.safeParse(copy).success, true);
});

test('legacy cases default to active and oversized imports fail before parsing', () => {
  const legacy = createCase();
  delete legacy.archivedAt;
  assert.equal(caseSchema.parse(legacy).archivedAt, null);
  assert.throws(() => importBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /smaller than 50 MB/);
});

test('imports reject invalid timestamps and ambiguous evidence or candidate identities', () => {
  const item = copyCase(demoCase());
  const data = JSON.parse(exportBackup([item]));
  for (const invalid of [
    { ...item, createdAt: 'yesterday' },
    { ...item, updatedAt: '' },
    { ...item, candidates: [item.candidates[0], item.candidates[0]] },
    { ...item, clues: [item.clues[0], item.clues[0]] },
  ])
    assert.throws(() => importBackup(JSON.stringify({ ...data, cases: [invalid] })));
});
