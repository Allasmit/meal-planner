import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, libsqlClient } from '../db/client';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

/** Writes a consistent copy of the live database (safe while the app is running) and returns its path. */
export async function backupDatabase(prefix: string): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `${prefix}-${stamp}.db`);
  await libsqlClient.execute(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

/** Keeps the newest `keep` backups with this prefix and deletes older ones. Returns how many were removed. */
export function pruneBackups(prefix: string, keep: number): number {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.db'))
    .sort(); // ISO timestamps sort chronologically
  const stale = files.slice(0, Math.max(0, files.length - keep));
  for (const file of stale) fs.unlinkSync(path.join(BACKUP_DIR, file));
  return stale.length;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Takes a backup now and then once a day, keeping the last BACKUP_KEEP (default 14).
 * Set BACKUP_ENABLED=false to turn it off. Returns a function that stops the schedule.
 */
export function startScheduledBackups(): () => void {
  if ((process.env.BACKUP_ENABLED ?? 'true').toLowerCase() === 'false') return () => {};
  const keep = Math.max(1, parseInt(process.env.BACKUP_KEEP ?? '14', 10) || 14);

  const run = async () => {
    try {
      const file = await backupDatabase('mealplan-daily');
      const removed = pruneBackups('mealplan-daily', keep);
      console.log(`Daily backup written: ${file}${removed ? ` (removed ${removed} old)` : ''}`);
    } catch (err) {
      console.error('Scheduled backup failed:', err);
    }
  };

  // Skip the startup backup if a recent one already exists, so frequent restarts don't churn the folder.
  const recent = fs.existsSync(BACKUP_DIR)
    ? fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('mealplan-daily-')).sort().pop()
    : undefined;
  const recentAge = recent ? Date.now() - fs.statSync(path.join(BACKUP_DIR, recent)).mtimeMs : Infinity;
  let timer: NodeJS.Timeout | undefined;
  const first = setTimeout(async () => {
    await run();
    timer = setInterval(run, DAY_MS);
    timer.unref();
  }, recentAge < DAY_MS ? DAY_MS - recentAge : 5_000);
  first.unref();

  return () => {
    clearTimeout(first);
    if (timer) clearInterval(timer);
  };
}
