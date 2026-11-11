import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Helper to resolve TrueNAS environment variables
function getEffectivePostgresConfig(overrides?: {
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | string;
}) {
  const host =
    overrides?.host ||
    process.env.TRUENAS_POSTGRES_HOST ||
    process.env.POSTGRES_HOST ||
    process.env.PGHOST ||
    process.env.DB_HOST ||
    'localhost';

  const port = parseInt(
    String(
      overrides?.port ||
        process.env.TRUENAS_POSTGRES_PORT ||
        process.env.POSTGRES_PORT ||
        process.env.PGPORT ||
        process.env.DB_PORT ||
        '5432'
    ),
    10
  );

  const user =
    overrides?.user ||
    process.env.TRUENAS_POSTGRES_USER ||
    process.env.POSTGRES_USER ||
    process.env.PGUSER ||
    process.env.DB_USER ||
    'postgres';

  const password =
    overrides?.password !== undefined
      ? overrides.password
      : process.env.TRUENAS_POSTGRES_PASSWORD ||
        process.env.POSTGRES_PASSWORD ||
        process.env.PGPASSWORD ||
        process.env.DB_PASSWORD ||
        '';

  const defaultDb =
    overrides?.database ||
    process.env.TRUENAS_POSTGRES_DB ||
    process.env.POSTGRES_DATABASE ||
    process.env.PGDATABASE ||
    process.env.DB_NAME ||
    'postgres';

  const rawSsl =
    overrides?.ssl !== undefined
      ? overrides.ssl
      : process.env.TRUENAS_POSTGRES_SSL ||
        process.env.POSTGRES_SSL ||
        process.env.PGSSLMODE ||
        'false';

  const ssl =
    rawSsl === true ||
    rawSsl === 'true' ||
    rawSsl === 'require' ||
    rawSsl === 'prefer'
      ? { rejectUnauthorized: false }
      : false;

  return { host, port, user, password, defaultDb, ssl };
}

// 1. Get current server configuration status
app.get('/api/config', (_req: Request, res: Response) => {
  const config = getEffectivePostgresConfig();
  const envKeysFound: string[] = [];

  [
    'TRUENAS_POSTGRES_HOST',
    'POSTGRES_HOST',
    'PGHOST',
    'TRUENAS_POSTGRES_USER',
    'POSTGRES_USER',
    'PGUSER',
    'TRUENAS_POSTGRES_PASSWORD',
    'POSTGRES_PASSWORD',
    'PGPASSWORD',
    'TRUENAS_POSTGRES_PORT',
    'POSTGRES_PORT',
    'PGPORT',
    'TRUENAS_POSTGRES_DB',
    'POSTGRES_DATABASE',
  ].forEach((key) => {
    if (process.env[key]) {
      envKeysFound.push(key);
    }
  });

  res.json({
    configured: envKeysFound.length > 0 || !!process.env.POSTGRES_HOST,
    host: config.host,
    port: config.port,
    user: config.user,
    defaultDb: config.defaultDb,
    sslEnabled: !!config.ssl,
    hasPassword: Boolean(config.password && config.password.length > 0),
    detectedEnvKeys: envKeysFound,
    truenasPlatform:
      process.env.TRUENAS_SCALE === 'true' ||
      !!process.env.TRUENAS_POSTGRES_HOST ||
      process.env.CONTAINER_NAME?.includes('truenas') ||
      false,
    nodeVersion: process.version,
    serverTime: new Date().toISOString(),
  });
});

// 2. Test PostgreSQL Connection
app.post('/api/test-connection', async (req: Request, res: Response) => {
  const overrides = req.body || {};
  const config = getEffectivePostgresConfig(overrides);
  const startTime = Date.now();

  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: overrides.database || config.defaultDb,
    ssl: config.ssl,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const result = await client.query(
      'SELECT version() as version, current_database() as current_db, current_user as current_user;'
    );
    await client.end();

    const latency = Date.now() - startTime;
    return res.json({
      success: true,
      message: `Successfully connected to PostgreSQL at ${config.host}:${config.port}`,
      version: result.rows[0]?.version || 'PostgreSQL (unknown version)',
      currentDatabase: result.rows[0]?.current_db || config.defaultDb,
      currentUser: result.rows[0]?.current_user || config.user,
      latencyMs: latency,
    });
  } catch (err: unknown) {
    try {
      await client.end();
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code;

    let hint = 'Check that your PostgreSQL server is running and accessible.';
    if (code === 'ECONNREFUSED') {
      hint = `Connection refused at ${config.host}:${config.port}. Verify host name, port, and firewall rules in TrueNAS.`;
    } else if (code === '28P01') {
      hint = 'Password authentication failed for user. Check POSTGRES_PASSWORD.';
    } else if (code === '28000') {
      hint = 'Authentication failed. Check your pg_hba.conf configuration.';
    } else if (code === 'ENOTFOUND') {
      hint = `DNS resolution failed for hostname '${config.host}'. Ensure the TrueNAS container or host has network access.`;
    }

    return res.status(500).json({
      success: false,
      message,
      code,
      hint,
      host: config.host,
      port: config.port,
      user: config.user,
    });
  }
});

// 3. Auto-discover databases on PostgreSQL server
app.get('/api/databases', async (req: Request, res: Response) => {
  const config = getEffectivePostgresConfig();

  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.defaultDb,
    ssl: config.ssl,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    const query = `
      SELECT 
        d.datname AS name,
        pg_size_pretty(pg_database_size(d.datname)) AS size_pretty,
        pg_database_size(d.datname) AS size_bytes,
        pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
        d.datcollate AS collation
      FROM pg_database d
      WHERE d.datistemplate = false
      ORDER BY d.datname ASC;
    `;
    const result = await client.query(query);
    await client.end();

    return res.json({
      success: true,
      databases: result.rows,
      server: `${config.host}:${config.port}`,
    });
  } catch (err: unknown) {
    try {
      await client.end();
    } catch {
      // ignore
    }
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      success: false,
      message,
      hint: 'Unable to query pg_database. Verify permissions and TrueNAS environment variables.',
    });
  }
});

// Pure TypeScript fallback dumper when pg_dump binary is absent or unreachable
async function generatePureSqlDump(config: ReturnType<typeof getEffectivePostgresConfig>, targetDb: string): Promise<string> {
  const client = new Client({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: targetDb,
    ssl: config.ssl,
    connectionTimeoutMillis: 10000,
  });

  await client.connect();

  const timestamp = new Date().toISOString();
  let sql = `-- =====================================================================\n`;
  sql += `-- TrueNAS PostgreSQL Automated Backup\n`;
  sql += `-- Database: ${targetDb}\n`;
  sql += `-- Host: ${config.host}:${config.port}\n`;
  sql += `-- Timestamp: ${timestamp}\n`;
  sql += `-- Generated by: TrueNAS PostgreSQL Backup Manager\n`;
  sql += `-- =====================================================================\n\n`;

  sql += `SET statement_timeout = 0;\n`;
  sql += `SET lock_timeout = 0;\n`;
  sql += `SET client_encoding = 'UTF8';\n`;
  sql += `SET standard_conforming_strings = on;\n`;
  sql += `SET check_function_bodies = false;\n`;
  sql += `SET client_min_messages = warning;\n`;
  sql += `SET row_security = off;\n\n`;

  sql += `BEGIN;\n\n`;

  try {
    // 1. Fetch schemas
    const schemasRes = await client.query(`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY schema_name;
    `);

    for (const row of schemasRes.rows) {
      if (row.schema_name !== 'public') {
        sql += `CREATE SCHEMA IF NOT EXISTS "${row.schema_name}";\n`;
      }
    }
    sql += `\n`;

    // 2. Fetch tables
    const tablesRes = await client.query(`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables 
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name;
    `);

    for (const table of tablesRes.rows) {
      const s = table.table_schema;
      const t = table.table_name;
      const fullTableName = `"${s}"."${t}"`;

      if (table.table_type === 'BASE TABLE') {
        sql += `-- Table: ${fullTableName}\n`;
        sql += `DROP TABLE IF EXISTS ${fullTableName} CASCADE;\n`;

        // Columns definition
        const colsRes = await client.query(`
          SELECT 
            column_name, 
            data_type, 
            character_maximum_length, 
            is_nullable, 
            column_default
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          ORDER BY ordinal_position;
        `, [s, t]);

        const colDefs = colsRes.rows.map((c) => {
          let typeStr = c.data_type;
          if (c.character_maximum_length) {
            typeStr += `(${c.character_maximum_length})`;
          }
          let def = `  "${c.column_name}" ${typeStr}`;
          if (c.column_default) {
            def += ` DEFAULT ${c.column_default}`;
          }
          if (c.is_nullable === 'NO') {
            def += ` NOT NULL`;
          }
          return def;
        });

        // Primary key constraint
        const pkRes = await client.query(`
          SELECT c.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage c ON c.constraint_name = tc.constraint_name
          WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2;
        `, [s, t]);

        if (pkRes.rows.length > 0) {
          const pkCols = pkRes.rows.map((r) => `"${r.column_name}"`).join(', ');
          colDefs.push(`  PRIMARY KEY (${pkCols})`);
        }

        sql += `CREATE TABLE ${fullTableName} (\n${colDefs.join(',\n')}\n);\n\n`;

        // Table Data Dump
        const dataRes = await client.query(`SELECT * FROM ${fullTableName};`);
        if (dataRes.rows.length > 0) {
          sql += `-- Data for ${fullTableName} (${dataRes.rows.length} rows)\n`;
          for (const row of dataRes.rows) {
            const cols = Object.keys(row).map((k) => `"${k}"`).join(', ');
            const vals = Object.values(row).map((val) => {
              if (val === null || val === undefined) return 'NULL';
              if (typeof val === 'number' || typeof val === 'boolean') return String(val);
              if (val instanceof Date) return `'${val.toISOString()}'`;
              if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
              return `'${String(val).replace(/'/g, "''")}'`;
            }).join(', ');
            sql += `INSERT INTO ${fullTableName} (${cols}) VALUES (${vals});\n`;
          }
          sql += `\n`;
        }
      }
    }

    sql += `COMMIT;\n`;
    sql += `-- End of backup for database: ${targetDb}\n`;
  } finally {
    await client.end();
  }

  return sql;
}

// 4. Backup Endpoint: Takes backup of a database and returns the SQL file
app.post('/api/backup/:database', async (req: Request, res: Response) => {
  const targetDb = req.params.database;
  const overrides = req.body?.overrides || {};
  const isSimulation = req.body?.simulation === true;
  const config = getEffectivePostgresConfig(overrides);

  if (!targetDb || !/^[a-zA-Z0-9_\-]+$/.test(targetDb)) {
    return res.status(400).json({ error: 'Invalid database name' });
  }

  // Simulation mode support for instant previews / sandboxes
  if (isSimulation) {
    const timestamp = new Date().toISOString();
    const simulatedSql = `-- =====================================================================
-- TrueNAS PostgreSQL Simulated / Demo Backup
-- Database: ${targetDb}
-- Host: ${config.host}:${config.port}
-- Timestamp: ${timestamp}
-- Note: This is an automated sample backup generated for preview/verification.
-- =====================================================================

SET statement_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."backup_metadata" (
  "id" serial PRIMARY KEY,
  "database_name" varchar(128) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "status" varchar(32) DEFAULT 'VERIFIED',
  "exported_by" varchar(64) DEFAULT 'truenas_admin'
);

INSERT INTO "public"."backup_metadata" ("database_name", "status") 
VALUES ('${targetDb}', 'SUCCESS');

CREATE TABLE IF NOT EXISTS "public"."sample_records" (
  "uuid" varchar(64) PRIMARY KEY,
  "service" varchar(64) NOT NULL,
  "data_payload" jsonb,
  "updated_at" timestamp with time zone DEFAULT now()
);

INSERT INTO "public"."sample_records" ("uuid", "service", "data_payload") 
VALUES 
  ('rec_${Date.now()}_01', '${targetDb}_core', '{"metric": "sync", "status": 200, "truenas_pool": "tank"}'::jsonb),
  ('rec_${Date.now()}_02', '${targetDb}_auth', '{"tokens_valid": true, "session_store": "pg"}'::jsonb);

COMMIT;
-- Completed backup for database: ${targetDb}
`;
    const filename = `${targetDb}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Size', Buffer.byteLength(simulatedSql));
    return res.send(simulatedSql);
  }

  // Attempt pg_dump first if available on host/container
  const pgDumpCommand = `PGPASSWORD="${config.password}" pg_dump -h "${config.host}" -p ${config.port} -U "${config.user}" -d "${targetDb}" --clean --if-exists`;

  try {
    const { stdout } = await execAsync(pgDumpCommand, { timeout: 60000, maxBuffer: 50 * 1024 * 1024 });
    const filename = `${targetDb}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Backup-Method', 'pg_dump');
    return res.send(stdout);
  } catch (pgDumpError) {
    // If pg_dump CLI is not installed or failed, fall back to pure TypeScript query-based dumper
    try {
      const sql = await generatePureSqlDump(config, targetDb);
      const filename = `${targetDb}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}.sql`;
      res.setHeader('Content-Type', 'application/sql');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Backup-Method', 'native-postgres-client');
      return res.send(sql);
    } catch (fallbackError: unknown) {
      const errMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      return res.status(500).json({
        error: `Failed to backup database '${targetDb}': ${errMsg}`,
        pgDumpDetail: pgDumpError instanceof Error ? pgDumpError.message : undefined,
        hint: 'Check TrueNAS environment variables (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD) and ensure the PostgreSQL service is reachable.',
      });
    }
  }
});

// Vite middleware in dev or static serve in prod
async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`TrueNAS PostgreSQL Backup Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
