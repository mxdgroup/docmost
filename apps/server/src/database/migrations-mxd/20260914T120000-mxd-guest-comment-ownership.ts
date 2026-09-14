import { Kysely, sql } from 'kysely';

// Guest comment ownership + guest resolution attribution.
//
// A guest has no account, so "edit/delete your own comment" is proven with a
// per-comment secret handed to the posting browser once at create time. Only a
// sha256 hash is stored, and it lives in its OWN table rather than on
// `comments`: upstream's comment queries `selectAll('comments')` into public
// responses, so a column there would leak the hash to every share visitor.
//
// `resolved_by_guest_name` records who resolved a thread when a guest did it
// (resolved_by_id stays null). Additive-only; runs via the mxd_migration ledger.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mxd_guest_comment_tokens')
    .addColumn('comment_id', 'uuid', (col) =>
      col.primaryKey().references('comments.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'varchar', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .alterTable('comments')
    .addColumn('resolved_by_guest_name', 'varchar', (col) => col)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('comments')
    .dropColumn('resolved_by_guest_name')
    .execute();
  await db.schema.dropTable('mxd_guest_comment_tokens').execute();
}
