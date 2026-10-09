import { libsqlClient } from './client';
import path from 'path';
import fs from 'fs';
import { splitSqlStatements } from '../lib/sql';
import { backupDatabase, pruneBackups } from '../lib/backup';

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

// Migrations that rebuild a table other tables reference must run with foreign
// keys off, otherwise DROP TABLE cascades into the child rows. Opt in with this
// marker on the first line of the migration file.
const FK_OFF_MARKER = '-- migrate:fk-off';

async function backupBeforeMigrating(pendingCount: number, hasHistory: boolean): Promise<void> {
  if (!hasHistory || pendingCount === 0) return;
  console.log(`Database backed up to ${await backupDatabase('mealplan-pre-migration')}`);
  pruneBackups('mealplan-pre-migration', 10);
}

export async function runMigrations(): Promise<void> {
  await libsqlClient.execute(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const result = await libsqlClient.execute('SELECT name FROM __migrations ORDER BY id');
  const appliedMigrations = new Set(result.rows.map((r: any) => r.name as string));

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('No migrations directory found — skipping.');
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pending = files.filter((f) => !appliedMigrations.has(f));

  await backupBeforeMigrating(pending.length, appliedMigrations.size > 0);

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/^\uFEFF/, '');
    const fkOff = sql.trimStart().startsWith(FK_OFF_MARKER);
    const statements = splitSqlStatements(sql);

    if (fkOff) await libsqlClient.execute('PRAGMA foreign_keys = OFF');
    try {
      // batch() runs all statements in one transaction, so a failing migration leaves no partial changes.
      await libsqlClient.batch(
        [...statements, { sql: 'INSERT INTO __migrations (name) VALUES (?)', args: [file] }],
        'write',
      );
    } finally {
      if (fkOff) await libsqlClient.execute('PRAGMA foreign_keys = ON');
    }

    if (fkOff) {
      const violations = await libsqlClient.execute('PRAGMA foreign_key_check');
      if (violations.rows.length > 0) {
        console.warn(`Warning: ${violations.rows.length} foreign key violation(s) after ${file}`);
      }
    }
    console.log(`Applied migration: ${file}`);
  }

  console.log('Migrations complete.');
}

// Allow `tsx src/db/migrate.ts` (and the db:migrate script) to still run standalone.
if (require.main === module) {
  runMigrations().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
