import fs from 'fs/promises';
import path from 'path';

export interface ApiSnapshotPayload {
  targetDate: string;
  categories: unknown;
  catalog: unknown;
  menus: unknown;
  menuDetail: unknown;
}

function formatDay(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatHourMinute(date: Date): string {
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${hours}-${minutes}`;
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

function isSnapshotDayFolder(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

export async function purgeOldSnapshotDays(rootDir: string, now: Date, retentionDays: number): Promise<void> {
  await fs.mkdir(rootDir, { recursive: true });
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSnapshotDayFolder(entry.name)) {
      continue;
    }

    const dayDate = new Date(`${entry.name}T00:00:00`);
    if (Number.isNaN(dayDate.getTime())) {
      continue;
    }

    const ageInMs = today.getTime() - dayDate.getTime();
    const ageInDays = Math.floor(ageInMs / (24 * 60 * 60 * 1000));

    if (ageInDays >= retentionDays) {
      await fs.rm(path.join(rootDir, entry.name), { recursive: true, force: true });
    }
  }
}

async function writeSnapshotFiles(directory: string, now: Date, payload: ApiSnapshotPayload): Promise<void> {
  await fs.mkdir(directory, { recursive: true });

  await writeJson(path.join(directory, 'categories.json'), payload.categories);
  await writeJson(path.join(directory, 'catalog.json'), payload.catalog);
  await writeJson(path.join(directory, 'menus.json'), payload.menus);
  await writeJson(path.join(directory, 'menu-plat-du-jour.json'), payload.menuDetail);

  await writeJson(path.join(directory, 'meta.json'), {
    capturedAt: now.toISOString(),
    targetDate: payload.targetDate
  });
}

export async function saveApiSnapshot(
  payload: ApiSnapshotPayload,
  now: Date = new Date(),
  rootDir: string = path.join(process.cwd(), 'snapshots', 'gootu-api')
): Promise<string> {
  const day = formatDay(now);
  const time = formatHourMinute(now);

  const currentDir = path.join(rootDir, day, time);
  await writeSnapshotFiles(currentDir, now, payload);

  const latestDir = path.join(rootDir, 'latest');
  await fs.rm(latestDir, { recursive: true, force: true });
  await writeSnapshotFiles(latestDir, now, payload);

  await purgeOldSnapshotDays(rootDir, now, 30);
  return currentDir;
}
