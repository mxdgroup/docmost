import { Kysely, sql } from 'kysely';

// MXD data platform — performance indexes for the record hot paths. Fork-owned,
// additive-only (CREATE INDEX only — no table/column change), runs via the
// mxd_migration ledger, and leaves the pure-upstream-boot invariant intact.
//
// Measured with EXPLAIN ANALYZE on a 20k-row table (review P1): without these
// the list-by-position query does a Seq Scan + top-N sort, and MAX(position)
// (the CSV-import hot path) does a Seq Scan over the whole table. The composite
// (table_id, position) turns both into index scans (reads 50 / 1 rows).
//
// The remaining filtered/sorted-view cost is a dynamic jsonb predicate
// (data ->> '<fieldId>'), which no btree can serve for an arbitrary field — that
// stays an in-table scan and is the documented v1 bound (see MXD-FORK.md).
export async function up(db: Kysely<any>): Promise<void> {
  // Serves list() (WHERE table_id ORDER BY position LIMIT) and maxPosition()
  // (MAX(position) WHERE table_id). Partial on the live rows the queries filter.
  await db.schema
    .createIndex('idx_mxd_records_table_position')
    .on('mxd_records')
    .columns(['table_id', 'position'])
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('idx_mxd_records_table_position').execute();
}
