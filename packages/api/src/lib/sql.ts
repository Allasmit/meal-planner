/** Splits a SQL script into statements, ignoring `;` and `--` inside quoted strings. */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let quote: string | null = null;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];

    if (quote) {
      current += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          current += sql[++i]; // escaped quote ('' or "")
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      current += '\n';
    } else if (ch === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
