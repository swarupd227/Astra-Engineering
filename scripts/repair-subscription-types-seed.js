#!/usr/bin/env node
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: process.env.MYSQL_SSL === 'false' ? undefined : { rejectUnauthorized: false },
  multipleStatements: true,
});

await conn.query('DELETE FROM subscription_types');
await conn.query("DELETE FROM schema_migrations WHERE migration_name = 'manual/02_seed'");

const seed = readFileSync(join(__dirname, '..', 'migrations/manual/02_seed.sql'), 'utf-8');
const part = seed.split('-- =============================================================================\n-- 2. ROLES')[0];
await conn.query(part);

const [rows] = await conn.query('SELECT id, code, name FROM subscription_types ORDER BY code');
console.log('subscription_types after repair:');
console.table(rows);
await conn.end();
