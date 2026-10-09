// tsc only emits .ts files; the SQL migrations must sit next to the compiled migrate.js to be found at runtime.
const fs = require('node:fs');
const path = require('node:path');

const from = path.resolve(__dirname, '..', 'src', 'db', 'migrations');
const to = path.resolve(__dirname, '..', 'dist', 'db', 'migrations');

fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`Copied migrations to ${path.relative(process.cwd(), to)}`);
