import { Kysely, sql } from 'kysely';

// MXD data platform — core relational schema (roadmap Phase 4, item E + view/relation
// foundation for F/G). Fork-owned, additive-only, runs via the mxd_migration ledger.
//
// Design decisions (see docs/plans data-platform ledger):
//  - Everything is namespaced `mxd_*` so it can NEVER collide with upstream's
//    EE "Bases" (`base*`) tables and a pure upstream image still boots by simply
//    ignoring these tables. This is the structural clean-room boundary.
//  - Schema is genuinely relational: tables and fields are first-class rows with
//    types and integrity, NOT an arbitrary JSON blob. Per-record CELL values are a
//    jsonb bag keyed by the field's stable uuid (never its name) — the Airtable/
//    Baserow-lite model — so renaming a field never rewrites records and there is
//    no EAV row explosion.
//  - Relations are true edges in `mxd_record_links` (FK + cascade), never text
//    labels. Lookups/rollups (item H) read through these edges.
export async function up(db: Kysely<any>): Promise<void> {
  // ---- mxd_tables: a structured table ("database"), optionally homed on a page.
  await db.schema
    .createTable('mxd_tables')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.notNull().references('spaces.id').onDelete('cascade'),
    )
    // Home page is optional: a table can outlive the page that embeds it.
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('set null'),
    )
    .addColumn('title', 'varchar', (col) => col.notNull().defaultTo('Untitled'))
    // The field shown as each record's label (the "primary" column). FK added
    // after mxd_fields exists (circular ref, nullable).
    .addColumn('primary_field_id', 'uuid')
    .addColumn('deleted_at', 'timestamptz')
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

  // ---- mxd_fields: a column. `type` is a string enum (text/number/select/…);
  // `config` holds per-type options (select choices, number precision, relation
  // target table id + reciprocal field, formula expression, etc.).
  await db.schema
    .createTable('mxd_fields')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('mxd_tables.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('config', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // fractional position for cheap reordering without rewriting siblings
    .addColumn('position', 'double precision', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    // field names unique within a table (collision guard, roadmap §6)
    .addUniqueConstraint('mxd_fields_table_name_unique', ['table_id', 'name'])
    .execute();

  // primary_field_id → mxd_fields.id (set null if the primary field is deleted;
  // the service picks a new primary).
  await db.schema
    .alterTable('mxd_tables')
    .addForeignKeyConstraint(
      'mxd_tables_primary_field_fk',
      ['primary_field_id'],
      'mxd_fields',
      ['id'],
    )
    .onDelete('set null')
    .execute();

  // ---- mxd_records: a row. Cell values live in `data` jsonb keyed by field uuid.
  // `version` powers optimistic concurrency (roadmap §18 — no silent last-write-loss).
  await db.schema
    .createTable('mxd_records')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('mxd_tables.id').onDelete('cascade'),
    )
    .addColumn('data', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('position', 'double precision', (col) => col.notNull().defaultTo(0))
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('deleted_at', 'timestamptz')
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    // guest attribution without a users row (roadmap §19); mutually exclusive
    // with creator_id at the app layer.
    .addColumn('creator_guest_name', 'varchar')
    .addColumn('updated_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // ---- mxd_views: a saved view over one table. Configuration only — never a
  // copy of the records (roadmap §9).
  await db.schema
    .createTable('mxd_views')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('table_id', 'uuid', (col) =>
      col.notNull().references('mxd_tables.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar', (col) => col.notNull().defaultTo('Grid'))
    // 'grid' | 'board' | 'list' | 'calendar' | 'gallery'
    .addColumn('type', 'varchar', (col) => col.notNull().defaultTo('grid'))
    // filters / sorts / groupBy / visibleFields / fieldOrder / displayFieldId …
    .addColumn('config', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('position', 'double precision', (col) => col.notNull().defaultTo(0))
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

  // ---- mxd_record_links: a directed relation edge from one record (via a
  // relation field) to another record. True relational integrity; many-to-many
  // by default, one-to-* enforced at the service layer via field config.
  await db.schema
    .createTable('mxd_record_links')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('field_id', 'uuid', (col) =>
      col.notNull().references('mxd_fields.id').onDelete('cascade'),
    )
    .addColumn('from_record_id', 'uuid', (col) =>
      col.notNull().references('mxd_records.id').onDelete('cascade'),
    )
    .addColumn('to_record_id', 'uuid', (col) =>
      col.notNull().references('mxd_records.id').onDelete('cascade'),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    // one edge per (field, from, to): no duplicate links
    .addUniqueConstraint('mxd_record_links_unique', [
      'field_id',
      'from_record_id',
      'to_record_id',
    ])
    .execute();

  // ---- indexes (roadmap §23: avoid N+1 / full scans)
  await db.schema
    .createIndex('idx_mxd_tables_space')
    .on('mxd_tables')
    .column('space_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_tables_page')
    .on('mxd_tables')
    .column('page_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_fields_table')
    .on('mxd_fields')
    .column('table_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_records_table')
    .on('mxd_records')
    .column('table_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_views_table')
    .on('mxd_views')
    .column('table_id')
    .execute();
  await db.schema
    .createIndex('idx_mxd_record_links_from')
    .on('mxd_record_links')
    .columns(['field_id', 'from_record_id'])
    .execute();
  await db.schema
    .createIndex('idx_mxd_record_links_to')
    .on('mxd_record_links')
    .columns(['field_id', 'to_record_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('mxd_record_links').ifExists().execute();
  await db.schema.dropTable('mxd_views').ifExists().execute();
  await db.schema.dropTable('mxd_records').ifExists().execute();
  // drop the circular FK before the tables it ties together
  await db.schema
    .alterTable('mxd_tables')
    .dropConstraint('mxd_tables_primary_field_fk')
    .ifExists()
    .execute();
  await db.schema.dropTable('mxd_fields').ifExists().execute();
  await db.schema.dropTable('mxd_tables').ifExists().execute();
}
