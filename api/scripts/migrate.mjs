// Brings the Turso database up to date: Better Auth's tables (derived from the auth config), then the
// arcade tables in migrations/. Safe to run repeatedly. Reads the same .dev.vars as `wrangler dev`.
//   npm run migrate

import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '../src/auth.js';

const env = Object.fromEntries(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  .split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const client = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });

const auth = createAuth(env, client);
const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
console.log('auth tables to create:', toBeCreated.map(t => t.table).join(', ') || 'none');
console.log('auth columns to add:', toBeAdded.map(t => t.table).join(', ') || 'none');
await runMigrations();

const dir = new URL('../migrations/', import.meta.url);
for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort())
{
  await client.executeMultiple(readFileSync(new URL(file, dir), 'utf8'));
  console.log('applied', file);
}
const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
console.log('tables:', tables.rows.map(r => r.name).join(', '));
