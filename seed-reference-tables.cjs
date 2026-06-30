// Idempotent reference-table seeder for the QE database.
//
// Copies rows from a SOURCE QE database into a TARGET QE database, restricted
// to a small hardcoded whitelist of reference / template tables. No
// transactional / ADO / Jira / integration data is touched.
//
// Env vars required:
//   QE_SOURCE_DATABASE_URL              full mysql:// URL for the SOURCE  (e.g. Azure nat2o)
//   QE_DATABASE_URL  OR  NAT_MYSQL_*    TARGET resolution (same as sync-schema.cjs / server/qe/db.ts)
//
// Optional:
//   MYSQL_SSL_REJECT_UNAUTHORIZED=false   skip CA verification (dev only)
//   SEED_DRY_RUN=true                     count rows but don't write to target
//
// Usage:  node seed-reference-tables.cjs

require('dotenv').config();
const mysql = require('mysql2/promise');

// HARDCODED whitelist — do not extend without reviewing intent. Anything
// outside this list is left untouched on both source and target.
const SEED_TABLES = [
  'framework_configs',
  'framework_functions',
  'framework_files',
  'bdd_step_definitions',
];

// Defensive deny-list: even if someone mistakenly adds these to SEED_TABLES,
// the script will refuse to copy them.
const FORBIDDEN_TABLES = new Set([
  'ado_configurations',
  'integration_configs',
  'jira_test_cases',
]);

function buildSslConfig(host) {
  if (process.env.MYSQL_DISABLE_SSL === 'true' || process.env.MYSQL_DISABLE_SSL === '1') {
    return false;
  }
  if (!host || /^(localhost|127\.|::1)/.test(host)) {
    return false;
  }
  return { rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false' };
}

function resolveTargetConfig() {
  if (process.env.QE_DATABASE_URL) {
    return { uri: process.env.QE_DATABASE_URL, _label: 'QE_DATABASE_URL' };
  }
  for (const { prefix, label } of [
    { prefix: 'NAT_MYSQL', label: 'NAT_MYSQL_*' },
    { prefix: 'MYSQL', label: 'MYSQL_*' },
  ]) {
    const host = process.env[`${prefix}_HOST`];
    const user = process.env[`${prefix}_USER`];
    const password = process.env[`${prefix}_PASSWORD`];
    const database = process.env[`${prefix}_DATABASE`];
    if (host && user && password && database) {
      return {
        host,
        port: parseInt(process.env[`${prefix}_PORT`] || '3306', 10),
        user,
        password,
        database,
        ssl: buildSslConfig(host),
        _label: label,
      };
    }
  }
  return null;
}

function resolveSourceConfig() {
  if (!process.env.QE_SOURCE_DATABASE_URL) return null;
  return { uri: process.env.QE_SOURCE_DATABASE_URL, _label: 'QE_SOURCE_DATABASE_URL' };
}

function describe(cfg) {
  if (cfg.uri) {
    try {
      const u = new URL(cfg.uri);
      return `${u.hostname}:${u.port || 3306}/${u.pathname.replace(/^\//, '')}`;
    } catch {
      return '[unparseable URL]';
    }
  }
  return `${cfg.host}:${cfg.port || 3306}/${cfg.database}`;
}

function hostOf(cfg) {
  if (cfg.uri) {
    try { return new URL(cfg.uri).hostname; } catch { return null; }
  }
  return cfg.host;
}

(async () => {
  const sourceCfg = resolveSourceConfig();
  const targetCfg = resolveTargetConfig();

  if (!sourceCfg) {
    console.error('ERROR: QE_SOURCE_DATABASE_URL is not set.');
    console.error('       Set it to the Azure source URL, e.g. (one line):');
    console.error('       QE_SOURCE_DATABASE_URL=mysql://USER:PASS@qadevxmysqlserver.mysql.database.azure.com:3306/nat2o?ssl={"rejectUnauthorized":true}');
    process.exit(1);
  }
  if (!targetCfg) {
    console.error('ERROR: No QE TARGET database connection configured.');
    console.error('       Set QE_DATABASE_URL or NAT_MYSQL_* (same vars sync-schema.cjs uses).');
    process.exit(1);
  }

  const sourceHost = hostOf(sourceCfg);
  const targetHost = hostOf(targetCfg);
  if (sourceHost && targetHost && sourceHost === targetHost) {
    console.error(`ERROR: source and target hosts are identical (${sourceHost}). Aborting to prevent accidental self-seed.`);
    process.exit(1);
  }

  const dryRun = process.env.SEED_DRY_RUN === 'true' || process.env.SEED_DRY_RUN === '1';

  console.log(`Source:  ${describe(sourceCfg)}   (from ${sourceCfg._label})`);
  console.log(`Target:  ${describe(targetCfg)}   (from ${targetCfg._label})`);
  console.log(`Mode:    ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Tables:  ${SEED_TABLES.join(', ')}`);
  console.log('');

  const { _label: _sl, ...srcConn } = sourceCfg;
  const { _label: _tl, ...tgtConn } = targetCfg;
  const src = await mysql.createConnection({ ...srcConn, connectTimeout: 30000 });
  const tgt = await mysql.createConnection({ ...tgtConn, connectTimeout: 30000 });

  let totalCopied = 0;
  const summary = [];

  try {
    for (const table of SEED_TABLES) {
      if (FORBIDDEN_TABLES.has(table)) {
        console.log(`SKIP ${table}: explicitly forbidden by deny-list`);
        summary.push({ table, status: 'SKIP-forbidden', rows: 0 });
        continue;
      }

      const [srcExists] = await src.query('SHOW TABLES LIKE ?', [table]);
      if (srcExists.length === 0) {
        console.log(`SKIP ${table}: not present in source DB`);
        summary.push({ table, status: 'SKIP-no-source', rows: 0 });
        continue;
      }
      const [tgtExists] = await tgt.query('SHOW TABLES LIKE ?', [table]);
      if (tgtExists.length === 0) {
        console.log(`SKIP ${table}: not present in target DB (run sync-schema.cjs first?)`);
        summary.push({ table, status: 'SKIP-no-target', rows: 0 });
        continue;
      }

      const [rows] = await src.query(`SELECT * FROM \`${table}\``);
      if (rows.length === 0) {
        console.log(`SKIP ${table}: source has 0 rows`);
        summary.push({ table, status: 'SKIP-empty', rows: 0 });
        continue;
      }

      if (dryRun) {
        console.log(`DRY  ${table}: would seed ${rows.length} row(s)`);
        summary.push({ table, status: 'DRY', rows: rows.length });
        continue;
      }

      // Build column list from union of keys across rows (defensive in case
      // some rows have NULLs serialised differently).
      const colSet = new Set();
      for (const row of rows) {
        for (const k of Object.keys(row)) colSet.add(k);
      }
      const cols = Array.from(colSet);
      const colList = cols.map((c) => `\`${c}\``).join(', ');
      const placeholders = cols.map(() => '?').join(', ');
      const updateList = cols.filter((c) => c !== 'id')
        .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
        .join(', ');
      const insertSql = `INSERT INTO \`${table}\` (${colList}) VALUES (${placeholders})
                         ${updateList ? `ON DUPLICATE KEY UPDATE ${updateList}` : ''}`;

      let copied = 0;
      for (const row of rows) {
        const values = cols.map((c) => (row[c] === undefined ? null : row[c]));
        await tgt.query(insertSql, values);
        copied++;
      }
      console.log(`OK   ${table}: seeded ${copied} row(s)`);
      summary.push({ table, status: 'OK', rows: copied });
      totalCopied += copied;
    }
  } finally {
    await src.end();
    await tgt.end();
  }

  console.log('');
  console.log('Summary:');
  console.table(summary);
  console.log(`Total rows ${dryRun ? 'inspected' : 'seeded'}: ${totalCopied}`);
})().catch((err) => {
  console.error('\nSeed FAILED.');
  console.error(`  code:    ${err.code || '(none)'}`);
  console.error(`  errno:   ${err.errno || '(none)'}`);
  console.error(`  message: ${err.message}`);
  process.exit(1);
});
