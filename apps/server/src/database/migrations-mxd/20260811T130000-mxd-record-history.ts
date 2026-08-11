import { Kysely, sql } from 'kysely';

// MXD data platform — record history / audit trail. Fork-owned, additive-only,
// runs via the mxd_migration ledger. Append-only: one immutable row per record
// mutation (create / update / delete), capturing who, when, the data snapshot,
// and which fields changed. record_id is a plain uuid (no FK) so history
// survives a hard-deleted record.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mxd_record_history')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('mxd_tables.id').onDelete('cascade'),
    )
    .addColumn('record_id', 'uuid', (col) => col.notNull())
    // 'create' | 'update' | 'delete'
    .addColumn('action', 'varchar', (col) => col.notNull())
    // The actor: a user id, or a guest name for an anonymous (public-share) actor.
    .addColumn('actor_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('actor_guest_name', 'varchar')
    // Snapshot: the record's data AFTER a create/update, or BEFORE a delete.
    .addColumn('data', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // The field ids whose values changed in this mutation.
    .addColumn('changed_field_ids', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_mxd_record_history_record')
    .on('mxd_record_history')
    .columns(['workspace_id', 'record_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('idx_mxd_record_history_table')
    .on('mxd_record_history')
    .columns(['workspace_id', 'table_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mxd_record_history').ifExists().execute();
}
