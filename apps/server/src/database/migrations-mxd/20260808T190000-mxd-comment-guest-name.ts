import { Kysely } from 'kysely';

// Guest display name for anonymous comments on shared pages. creator_id is
// already nullable upstream; a guest comment is creator_id NULL + guest_name
// set. Additive-only; runs via the mxd_migration ledger (see MXD-FORK.md) —
// all fork migrations live in migrations-mxd/, never migrations/.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('comments')
    .addColumn('guest_name', 'varchar', (col) => col)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('comments').dropColumn('guest_name').execute();
}
