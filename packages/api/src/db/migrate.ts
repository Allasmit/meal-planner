import { libsqlClient } from './client';
import path from 'path';
import fs from 'fs';

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

async function applyMigrations() {
  // Create migrations tracking table if it doesn't exist
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

  for (const file of files) {
    if (appliedMigrations.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Strip single-line comments, then split by semicolon
    const stripped = sql.replace(/--[^\n]*/g, '');
    const statements = stripped
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await libsqlClient.execute(stmt);
    }
    await libsqlClient.execute({ sql: 'INSERT INTO __migrations (name) VALUES (?)', args: [file] });
    console.log(`Applied migration: ${file}`);
  }

  console.log('Migrations complete.');
}

applyMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
