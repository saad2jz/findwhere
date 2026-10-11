import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDailyQuota } from '../server/security.mjs';

test('quota persists reservations across restarts and rolls over at UTC midnight', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'findwhere-quota-'));
  const file = path.join(dir, 'usage.json');
  let time = Date.parse('2026-10-11T23:59:00Z');
  const options = { limit: 2, file, now: () => time };
  try {
    const quota = createDailyQuota(options);
    assert.deepEqual(await Promise.all([quota.reserve(), quota.reserve(), quota.reserve()]), [
      true,
      true,
      false,
    ]);
    const restarted = createDailyQuota(options);
    assert.equal((await restarted.status()).dailyRemaining, 0);
    assert.equal(await restarted.reserve(), false);
    assert.equal((await restarted.status()).resetsAt, '2026-10-12T00:00:00.000Z');
    time += 60000;
    assert.equal(await restarted.reserve(), true);
    assert.equal((await createDailyQuota(options).status()).dailyUsed, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('invalid storage fails closed rather than allowing paid requests', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'findwhere-quota-'));
  const file = path.join(dir, 'usage.json');
  try {
    await writeFile(file, 'broken');
    const quota = createDailyQuota({ file });
    await assert.rejects(quota.status(), /storage is unavailable/);
    await assert.rejects(quota.reserve(), /storage is unavailable/);
    const unwritable = createDailyQuota({ file: path.join(file, 'child.json') });
    await assert.rejects(unwritable.reserve(), /storage is unavailable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('zero disables analysis and invalid quota configuration is rejected', async () => {
  assert.equal(await createDailyQuota({ limit: 0 }).reserve(), false);
  for (const limit of [-1, 0.5, NaN, 1001])
    assert.throws(() => createDailyQuota({ limit }), /AI_DAILY_LIMIT/);
});
