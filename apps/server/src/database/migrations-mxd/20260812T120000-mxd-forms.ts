import { Kysely, sql } from 'kysely';

// MXD data platform — public forms (roadmap: forms). A form is a public,
// anonymous-submittable front door that creates ONE record in a table using only
// a whitelisted set of that table's fields. Fork-owned, additive-only, runs via
// the mxd_migration ledger.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mxd_forms')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('mxd_tables.id').onDelete('cascade'),
    )
    // Public slug used in the form URL (/forms/:key). Unique + indexed.
    .addColumn('key', 'varchar', (col) => col.notNull().unique())
    .addColumn('title', 'varchar', (col) => col.notNull().defaultTo('Form'))
    .addColumn('description', 'text')
    // The whitelisted field ids the form collects (order = display order). A
    // submit may only set these fields; anything else is rejected.
    .addColumn('field_ids', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
    // A disabled form returns 404 to the public and accepts no submissions.
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('submit_message', 'varchar')
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_mxd_forms_table')
    .on('mxd_forms')
    .columns(['workspace_id', 'table_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mxd_forms').ifExists().execute();
}
