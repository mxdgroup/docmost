// Throwaway DB integration harness (not committed): proves the E1 migration
// applies against a real Postgres and that the repos' workspace-scoping +
// optimistic-concurrency WHERE clauses isolate tenants. Inline kysely queries
// mirror the repo predicates. Run from apps/server: npx tsx mxd-harness.ts
import { Kysely, PostgresDialect, CamelCasePlugin, sql } from 'kysely';
import * as pg from 'pg';
import { up, down } from '../../src/database/migrations-mxd/20260809T120000-mxd-data-platform-core';

const CONN =
  process.env.MXD_TEST_DB_URL || 'postgresql://t:t@localhost:5433/t';
const db = new Kysely<any>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: CONN }) }),
  plugins: [new CamelCasePlugin()],
});

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log('  PASS ', msg);
  else {
    console.error('  FAIL ', msg);
    failures++;
  }
}
async function newId(table: string): Promise<string> {
  const row: any = await db.insertInto(table).defaultValues().returning('id').executeTakeFirstOrThrow();
  return row.id;
}
const findRecord = (w: string, t: string, id: string) =>
  db.selectFrom('mxdRecords').selectAll()
    .where('id', '=', id).where('tableId', '=', t)
    .where('workspaceId', '=', w).where('deletedAt', 'is', null)
    .executeTakeFirst();
const updateWithVersion = (w: string, t: string, id: string, ver: number, data: any) =>
  db.updateTable('mxdRecords')
    .set({ data: data as any, version: ver + 1 }) /* object, not JSON.stringify: matches the real repo; stringify double-encodes jsonb in the app (bug ffcc6d49) */
    .where('id', '=', id).where('tableId', '=', t).where('workspaceId', '=', w)
    .where('version', '=', ver).where('deletedAt', 'is', null)
    .returningAll().executeTakeFirst();

async function main() {
  await sql`DROP TABLE IF EXISTS mxd_record_links, mxd_records, mxd_views, mxd_fields, mxd_tables, workspaces, spaces, pages, users CASCADE`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$`.execute(db);
  for (const t of ['workspaces', 'spaces', 'pages', 'users']) {
    await sql`CREATE TABLE ${sql.raw(t)} (id uuid primary key default gen_uuid_v7())`.execute(db);
  }

  await up(db);
  console.log('migration up() applied cleanly');

  const w1 = await newId('workspaces');
  const w2 = await newId('workspaces');
  const space = await newId('spaces');

  const table: any = await db.insertInto('mxdTables')
    .values({ workspaceId: w1, spaceId: space, title: 'T' })
    .returningAll().executeTakeFirstOrThrow();

  check(!!(await db.selectFrom('mxdTables').selectAll().where('id', '=', table.id).where('workspaceId', '=', w1).executeTakeFirst()),
    'table visible to owning workspace');
  check(!(await db.selectFrom('mxdTables').selectAll().where('id', '=', table.id).where('workspaceId', '=', w2).executeTakeFirst()),
    'table NOT visible to another workspace (IDOR)');

  const field: any = await db.insertInto('mxdFields')
    .values({ tableId: table.id, workspaceId: w1, name: 'Name', type: 'text', position: 0 })
    .returningAll().executeTakeFirstOrThrow();

  let dup = false;
  try {
    await db.insertInto('mxdFields').values({ tableId: table.id, workspaceId: w1, name: 'Name', type: 'text', position: 1 }).execute();
  } catch { dup = true; }
  check(dup, 'duplicate field name rejected by unique (table_id,name)');

  const rec: any = await db.insertInto('mxdRecords')
    .values({ tableId: table.id, workspaceId: w1, data: { [field.id]: 'hi' } as any, position: 1, version: 1 })
    .returningAll().executeTakeFirstOrThrow();
  check(rec.version === 1, 'record inserted at version 1');

  check(!!(await findRecord(w1, table.id, rec.id)), 'record visible to owning workspace');
  check(!(await findRecord(w2, table.id, rec.id)), 'record NOT visible to another workspace (IDOR)');

  check((await updateWithVersion(w1, table.id, rec.id, 1, { [field.id]: 'v2' }))?.version === 2, 'version-matched update bumps to 2');
  check((await updateWithVersion(w1, table.id, rec.id, 1, { [field.id]: 'v3' })) === undefined, 'stale-version update refused (409 path)');
  check((await updateWithVersion(w2, table.id, rec.id, 2, { [field.id]: 'x' })) === undefined, 'cross-workspace update refused');

  const reread: any = await findRecord(w1, table.id, rec.id);
  check(reread != null && reread.data[field.id] === 'v2', 'jsonb cell round-trips as an object');

  // Concurrency regression (review P1): a field-type conversion rewrites a
  // record's data via replaceData, which MUST bump version — otherwise a stale
  // updateRecord that read version=2 before the conversion would still match
  // WHERE version=2 and silently restore pre-conversion values. Mirror the real
  // replaceData (data rewrite + `version + 1`) and prove the stale write 409s.
  const replaceData = (w: string, t: string, id: string, data: any) =>
    db.updateTable('mxdRecords')
      .set({ data: data as any, version: sql`version + 1` })
      .where('id', '=', id).where('tableId', '=', t).where('workspaceId', '=', w)
      .where('deletedAt', 'is', null)
      .returningAll().executeTakeFirst();
  // record is at version 2. A concurrent reader captured version 2, then a type
  // conversion runs:
  const converted: any = await replaceData(w1, table.id, rec.id, { [field.id]: 'converted' });
  check(converted?.version === 3, 'replaceData (type conversion) bumps version 2 -> 3');
  // the reader's stale write (still thinks it's version 2) must now be refused:
  check(
    (await updateWithVersion(w1, table.id, rec.id, 2, { [field.id]: 'stale' })) === undefined,
    'update racing a type conversion is refused (409) — no silent revert',
  );
  const afterRace: any = await findRecord(w1, table.id, rec.id);
  check(
    afterRace?.data[field.id] === 'converted',
    'converted value survives the racing stale update',
  );

  const idx: any = await db.selectFrom('pg_indexes' as any).select('indexname' as any)
    .where('indexname' as any, '=', 'idx_mxd_records_data_gin').executeTakeFirst();
  check(!!idx, 'GIN index on records.data created');

  await down(db);
  let dropped = false;
  try { await db.selectFrom('mxdTables').selectAll().execute(); } catch { dropped = true; }
  check(dropped, 'migration down() drops mxd_tables cleanly');

  await db.destroy();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
