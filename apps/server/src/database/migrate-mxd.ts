// MXD fork-migration CLI — mirrors migrate.ts but drives the fork's separate
// migrator (folder migrations-mxd/, ledger table mxd_migration) so fork
// migrations never enter upstream's kysely_migration ledger. See MXD-FORK.md.
import * as path from 'path';
import { promises as fs } from 'fs';
import { Kysely, Migrator, FileMigrationProvider } from 'kysely';
import { run } from 'kysely-migration-cli';
import * as dotenv from 'dotenv';
import { envPath, normalizePostgresUrl } from '../common/helpers';
import { PostgresJSDialect } from 'kysely-postgres-js';
import postgres from 'postgres';

dotenv.config({ path: envPath });

const migrationFolder = path.join(__dirname, './migrations-mxd');

const db = new Kysely<any>({
  dialect: new PostgresJSDialect({
    postgres: postgres(normalizePostgresUrl(process.env.DATABASE_URL)),
  }),
});

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder,
  }),
  migrationTableName: 'mxd_migration',
  migrationLockTableName: 'mxd_migration_lock',
});

run(db, migrator, migrationFolder);
