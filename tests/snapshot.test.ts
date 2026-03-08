import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { purgeOldSnapshotDays } from '../snapshots.ts';

test('purgeOldSnapshotDays removes only day folders older than retention', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gootu-snapshots-'));
  const oldDay = path.join(root, '2025-01-01');
  const boundaryDay = path.join(root, '2026-02-08');
  const almostBoundaryDay = path.join(root, '2026-02-09');
  const freshDay = path.join(root, '2026-03-01');
  const notADay = path.join(root, 'latest');

  await fs.mkdir(oldDay, { recursive: true });
  await fs.mkdir(boundaryDay, { recursive: true });
  await fs.mkdir(almostBoundaryDay, { recursive: true });
  await fs.mkdir(freshDay, { recursive: true });
  await fs.mkdir(notADay, { recursive: true });

  await purgeOldSnapshotDays(root, new Date('2026-03-10T10:00:00Z'), 30);

  await assert.rejects(() => fs.access(oldDay));
  await assert.rejects(() => fs.access(boundaryDay));
  await fs.access(almostBoundaryDay);
  await fs.access(freshDay);
  await fs.access(notADay);

  await fs.rm(root, { recursive: true, force: true });
});
