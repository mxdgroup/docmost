import { Kysely, sql } from 'kysely';

// Commenter accounts for public share links (2026-09-15).
//
// A commenter is NOT a Docmost user: no `users` row, no workspace membership,
// no space access. It is only a verified identity (email + display name) that
// lets someone comment on commentable share links under their own name
// instead of as an anonymous guest. Sign-in is a single-use emailed link.
//
// Additive-only; runs via the mxd_migration ledger (see MXD-FORK.md).
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('mxd_share_commenters')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    // stored lowercased + trimmed; unique per workspace
    .addColumn('email', 'varchar', (col) => col.notNull())
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('last_sign_in_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('mxd_share_commenters_workspace_email_unique', [
      'workspace_id',
      'email',
    ])
    .execute();

  // Single-use sign-in links. Only a sha256 of the token is stored.
  await db.schema
    .createTable('mxd_commenter_sign_in_tokens')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('email', 'varchar', (col) => col.notNull())
    // display name offered at request time; used only if the account is new
    .addColumn('name', 'varchar')
    .addColumn('token_hash', 'varchar', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('mxd_commenter_sign_in_tokens_email_created_idx')
    .on('mxd_commenter_sign_in_tokens')
    .columns(['workspace_id', 'email', 'created_at'])
    .execute();

  // Attribution on comments: author and resolver may be a commenter account.
  await db.schema
    .alterTable('comments')
    .addColumn('commenter_id', 'uuid', (col) =>
      col.references('mxd_share_commenters.id').onDelete('set null'),
    )
    .execute();
  await db.schema
    .alterTable('comments')
    .addColumn('resolved_by_commenter_id', 'uuid', (col) =>
      col.references('mxd_share_commenters.id').onDelete('set null'),
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('comments')
    .dropColumn('resolved_by_commenter_id')
    .execute();
  await db.schema.alterTable('comments').dropColumn('commenter_id').execute();
  await db.schema.dropTable('mxd_commenter_sign_in_tokens').execute();
  await db.schema.dropTable('mxd_share_commenters').execute();
}
