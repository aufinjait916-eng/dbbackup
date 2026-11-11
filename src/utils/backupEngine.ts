import JSZip from 'jszip';
import { DatabaseItem } from '../types';

export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function parseDatabasesJson(jsonString: string): { databases: string[]; error?: string } {
  try {
    const trimmed = jsonString.trim();
    if (!trimmed) {
      return { databases: [], error: 'JSON content is empty' };
    }

    const parsed = JSON.parse(trimmed);

    // Format 1: Simple array of strings ["db1", "db2"]
    if (Array.isArray(parsed)) {
      const names: string[] = [];
      for (const item of parsed) {
        if (typeof item === 'string') {
          names.push(item.trim());
        } else if (item && typeof item === 'object') {
          const name = item.name || item.database || item.db || item.dbname;
          if (typeof name === 'string') {
            names.push(name.trim());
          }
        }
      }
      const unique = Array.from(new Set(names.filter(Boolean)));
      if (unique.length === 0) {
        return { databases: [], error: 'Array does not contain any valid database names' };
      }
      return { databases: unique };
    }

    // Format 2: Object with databases property {"databases": [...]} or {"dbs": [...]}
    if (parsed && typeof parsed === 'object') {
      const candidateList =
        parsed.databases ||
        parsed.dbs ||
        parsed.databaseList ||
        parsed.targets ||
        parsed.items;

      if (Array.isArray(candidateList)) {
        const names: string[] = [];
        for (const item of candidateList) {
          if (typeof item === 'string') {
            names.push(item.trim());
          } else if (item && typeof item === 'object') {
            const name = item.name || item.database || item.db || item.dbname;
            if (typeof name === 'string') {
              names.push(name.trim());
            }
          }
        }
        const unique = Array.from(new Set(names.filter(Boolean)));
        if (unique.length === 0) {
          return { databases: [], error: 'List inside object does not contain valid database names' };
        }
        return { databases: unique };
      }

      // Format 3: Object where keys might be database names: {"db1": {}, "db2": {}}
      const keys = Object.keys(parsed).filter(
        (k) => !['server', 'options', 'version', '$schema', 'title', 'description'].includes(k)
      );
      if (keys.length > 0) {
        return { databases: keys };
      }
    }

    return { databases: [], error: 'Unsupported JSON schema structure' };
  } catch (err) {
    return {
      databases: [],
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  // Cleanup after browser acknowledges
  setTimeout(() => {
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  }, 1000);
}

export async function createZipBundle(databases: DatabaseItem[]): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder(`truenas_postgres_backups_${new Date().toISOString().slice(0, 10)}`);

  const manifest = {
    exportedAt: new Date().toISOString(),
    totalDatabases: databases.length,
    databases: databases.map((db) => ({
      name: db.name,
      status: db.status,
      size: db.sizeBytes || 0,
      timestamp: db.lastBackupAt,
    })),
  };

  folder?.file('manifest.json', JSON.stringify(manifest, null, 2));

  for (const db of databases) {
    if (db.sqlContent) {
      folder?.file(`${db.name}_backup.sql`, db.sqlContent);
    }
  }

  return await zip.generateAsync({ type: 'blob' });
}

export function generateClientSampleSql(dbname: string): string {
  const ts = new Date().toISOString();
  return `-- =====================================================================
-- TrueNAS PostgreSQL Automated Backup
-- Database: ${dbname}
-- Generated at: ${ts}
-- Engine: TrueNAS PostgreSQL Backup Engine v1.0
-- =====================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

BEGIN;

CREATE SCHEMA IF NOT EXISTS "public";

-- Table: "public"."app_settings"
DROP TABLE IF EXISTS "public"."app_settings" CASCADE;
CREATE TABLE "public"."app_settings" (
  "id" serial PRIMARY KEY,
  "service_key" varchar(128) NOT NULL,
  "config_payload" jsonb,
  "is_active" boolean DEFAULT true,
  "updated_at" timestamp with time zone DEFAULT now()
);

INSERT INTO "public"."app_settings" ("service_key", "config_payload", "is_active") VALUES
  ('${dbname}.storage', '{"pool": "tank", "dataset": "app_data", "mount": "/mnt/tank"}'::jsonb, true),
  ('${dbname}.network', '{"port": 5432, "truenas_host": "192.168.1.100", "ssl": false}'::jsonb, true);

-- Table: "public"."service_records"
DROP TABLE IF EXISTS "public"."service_records" CASCADE;
CREATE TABLE "public"."service_records" (
  "record_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "record_type" varchar(64) NOT NULL,
  "payload_bytes" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);

INSERT INTO "public"."service_records" ("record_type", "payload_bytes") VALUES
  ('SNAPSHOT_REF', 1048576),
  ('STATE_SYNC', 524288),
  ('AUDIT_LOG', 131072);

CREATE INDEX IF NOT EXISTS "idx_${dbname}_records_created" ON "public"."service_records" ("created_at");

COMMIT;

-- Backup completed successfully for ${dbname}
`;
}
