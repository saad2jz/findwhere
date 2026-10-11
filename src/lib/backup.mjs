import { z } from 'zod';
import { caseSchema } from './domain.mjs';

export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const backupSchema = z.object({
  format: z.literal('findwhere-backup'),
  version: z.literal(1),
  exportedAt: z.iso.datetime(),
  cases: z.array(caseSchema).min(1).max(100),
});

export function exportBackup(cases) {
  if (!cases.length) throw new Error('There are no saved investigations to back up yet.');
  if (cases.length > 100) throw new Error('Back up up to 100 investigations at a time.');
  const value = backupSchema.parse({
    format: 'findwhere-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    cases,
  });
  const text = JSON.stringify(value, null, 2);
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error('This backup is larger than 50 MB. Export investigations separately.');
  return text;
}

export function importBackup(text) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error('Choose a Findwhere backup smaller than 50 MB.');
  let result;
  try {
    result = backupSchema.safeParse(JSON.parse(text));
  } catch {
    throw new Error('This file is not valid JSON. Choose a Findwhere backup.');
  }
  if (!result.success)
    throw new Error('This is not a supported Findwhere backup. No investigations were imported.');
  // Fresh identities preserve existing work, even when a backup is imported twice.
  return result.data.cases.map((item) => ({
    ...item,
    id: crypto.randomUUID(),
    demo: false,
  }));
}
