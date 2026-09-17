import { Kysely, sql } from 'kysely';

// Anonymous uploads have no users FK. This only loosens a constraint; existing
// rows and the FK remain intact, and older code can still create member uploads.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('attachments')
    .alterColumn('creator_id', (column) => column.dropNotNull())
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Never delete uploads or falsely attribute them in order to roll back.
  const guests =
    await sql`SELECT 1 FROM attachments WHERE creator_id IS NULL LIMIT 1`.execute(
      db,
    );
  if (guests.rows.length)
    throw new Error(
      'Guest uploads exist; keep the nullable creator_id constraint when rolling back the app',
    );
  await db.schema
    .alterTable('attachments')
    .alterColumn('creator_id', (column) => column.setNotNull())
    .execute();
}
