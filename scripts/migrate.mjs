// Creates the tables if they are missing. Safe to run again.
// Usage: DATABASE_URL=... node scripts/migrate.mjs   (no DATABASE_URL = local test database)
import { readFile } from 'node:fs/promises';
import { exec } from '../lib/db.js';

const schema = await readFile(new URL('../lib/schema.sql', import.meta.url), 'utf8');
await exec(schema);
console.log('Database is ready.');
process.exit(0);
