/** Current time in SQLite's own `datetime('now')` format (UTC, "YYYY-MM-DD HH:MM:SS"), matching the column defaults. */
export function sqliteNow(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** Escapes LIKE wildcards so user input is matched literally. Use with `ESCAPE '\\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
