// Throwaway DB integration harness for the F2 query engine (not committed to
// prod paths' jest run). Proves the compiled filter/sort SQL is correct AND safe
// against real Postgres jsonb: parameterized values, injection attempts inert,
// cross-workspace isolation on the query path. Run from apps/server:
//   npx tsx test/mxd-data/mxd-data-query-db-check.ts
import { Kysely, PostgresDialect, CamelCasePlugin, sql } from 'kysely';
import * as pg from 'pg';
import { up } from '../../src/database/migrations-mxd/20260809T120000-mxd-data-platform-core';
import {
  compileFilter,
  orderBySpecs,
} from '../../src/core/mxd-data/views/filter-compiler';

const CONN = process.env.MXD_TEST_DB_URL || 'postgresql://t:t@localhost:5433/t';
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

const F_TEXT = { id: 'ftext', type: 'text', name: 'Text' } as any;
const F_NUM = { id: 'fnum', type: 'number', name: 'Num' } as any;
const fieldsById = new Map<string, any>([
  [F_TEXT.id, F_TEXT],
  [F_NUM.id, F_NUM],
]);

async function query(workspaceId: string, tableId: string, filter: any, sorts: any[] = []) {
  let q = db
    .selectFrom('mxdRecords')
    .selectAll()
    .where('workspaceId', '=', workspaceId)
    .where('tableId', '=', tableId)
    .where('deletedAt', 'is', null);
  if (filter) q = q.where(compileFilter(fieldsById, filter));
  for (const t of orderBySpecs(fieldsById, sorts)) q = q.orderBy(t.expr as any, t.direction);
  q = q.orderBy('id', 'asc');
  return q.execute();
}
const names = (rows: any[]) => rows.map((r) => r.data.ftext);

async function main() {
  // Idempotent: drop any leftovers so this can run after the other harness
  // against the same DB (CI runs both) and on reruns.
  await sql`DROP TABLE IF EXISTS mxd_record_links, mxd_records, mxd_views, mxd_fields, mxd_tables, workspaces, spaces, pages, users CASCADE`.execute(db);
  await sql`CREATE OR REPLACE FUNCTION gen_uuid_v7() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$`.execute(db);
  for (const t of ['workspaces', 'spaces', 'pages', 'users']) {
    await sql`CREATE TABLE ${sql.raw(t)} (id uuid primary key default gen_uuid_v7())`.execute(db);
  }
  await up(db);

  const w1 = await newId('workspaces');
  const w2 = await newId('workspaces');
  const space = await newId('spaces');
  const t1: any = await db.insertInto('mxdTables').values({ workspaceId: w1, spaceId: space, title: 'T1' }).returningAll().executeTakeFirstOrThrow();
  const t2: any = await db.insertInto('mxdTables').values({ workspaceId: w2, spaceId: space, title: 'T2' }).returningAll().executeTakeFirstOrThrow();

  const insert = (workspaceId: string, tableId: string, data: any, pos: number) =>
    db.insertInto('mxdRecords').values({ workspaceId, tableId, data: JSON.stringify(data) as any, position: pos, version: 1 }).execute();

  await insert(w1, t1.id, { ftext: 'apple', fnum: 10 }, 1);
  await insert(w1, t1.id, { ftext: 'banana', fnum: 5 }, 2);
  await insert(w1, t1.id, { ftext: 'cherry', fnum: 20 }, 3);
  await insert(w1, t1.id, {}, 4); // empty row (nulls)
  await insert(w2, t2.id, { ftext: "apple", fnum: 999 }, 1); // other workspace

  // number gt
  check(
    (await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'fnum', op: 'gt', value: 8 }] })).length === 2,
    'number gt 8 → 2 rows',
  );
  // text contains
  const containsRows = await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'ftext', op: 'contains', value: 'an' }] });
  check(
    names(containsRows).join() === 'banana',
    'text contains "an" → banana',
  );
  // and group
  check(
    (await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'fnum', op: 'gte', value: 5 }, { fieldId: 'ftext', op: 'isNotEmpty' }] })).length === 3,
    'and[num>=5, text notEmpty] → 3 rows',
  );
  // or group
  check(
    (await query(w1, t1.id, { combinator: 'or', conditions: [{ fieldId: 'fnum', op: 'lt', value: 6 }, { fieldId: 'ftext', op: 'equals', value: 'cherry' }] })).length === 2,
    'or[num<6, text=cherry] → 2 rows',
  );
  // between
  check(
    (await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'fnum', op: 'between', value: [6, 15] }] })).length === 1,
    'num between 6..15 → 1 row (apple)',
  );
  // isEmpty
  check(
    (await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'ftext', op: 'isEmpty' }] })).length === 1,
    'text isEmpty → 1 row (the empty record)',
  );
  // sort asc by number → 5,10,20, null last
  const asc = await query(w1, t1.id, null, [{ fieldId: 'fnum', direction: 'asc' }]);
  check(names(asc).slice(0, 3).join() === 'banana,apple,cherry', 'sort num asc orders 5,10,20');

  // cross-workspace isolation: w1 query never returns w2's row (even matching)
  check(
    (await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'fnum', op: 'gt', value: 100 }] })).length === 0,
    'cross-workspace row (num=999 in w2) not visible from w1 query',
  );

  // INJECTION: a value crafted to break out must be treated as a literal
  const inj = await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'ftext', op: 'equals', value: "apple' OR '1'='1" }] });
  check(inj.length === 0, 'SQL-injection value is parameterized (0 rows, not all)');
  const injLike = await query(w1, t1.id, { combinator: 'and', conditions: [{ fieldId: 'ftext', op: 'contains', value: '%' }] });
  check(injLike.length === 0, 'LIKE wildcard in value is escaped (literal %, 0 rows)');

  await db.destroy();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
