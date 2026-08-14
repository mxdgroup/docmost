import { Kysely, sql } from 'kysely';

// MXD data platform — automations (roadmap §39-40). Fork-owned, additive-only,
// runs via the mxd_migration ledger. mxd_automation_rules holds trigger→action
// rules per table; mxd_automation_runs is the append-only execution audit log
// (execution id, status, error) that also underpins idempotency + observability.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mxd_automation_rules')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('mxd_tables.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar', (col) => col.notNull().defaultTo('Automation'))
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    // { type: 'record_created' | 'record_updated' | 'field_changed', fieldId? }
    .addColumn('trigger', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // [ ButtonAction-shaped actions ] (no openUrl — automations run server-side)
    .addColumn('actions', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`),
    )
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
    .createTable('mxd_automation_runs')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('rule_id', 'uuid', (col) =>
      col.notNull().references('mxd_automation_rules.id').onDelete('cascade'),
    )
    .addColumn('record_id', 'uuid', (col) => col.notNull())
    .addColumn('trigger_type', 'varchar', (col) => col.notNull())
    // 'success' | 'error'
    .addColumn('status', 'varchar', (col) => col.notNull())
    .addColumn('error', 'varchar')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_mxd_automation_rules_table')
    .on('mxd_automation_rules')
    .column('table_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_automation_rules_workspace')
    .on('mxd_automation_rules')
    .column('workspace_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_automation_runs_rule')
    .on('mxd_automation_runs')
    .column('rule_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_automation_runs_workspace')
    .on('mxd_automation_runs')
    .column('workspace_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mxd_automation_runs').ifExists().execute();
  await db.schema.dropTable('mxd_automation_rules').ifExists().execute();
}
