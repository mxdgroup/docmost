import { Kysely, sql } from 'kysely';

// Adds shares.mode: 'view' | 'comment' | 'edit'.
// Additive-only (fork rule, MXD-FORK.md): nullable column with a SQL-level
// DEFAULT so existing rows read 'view' and upstream code inserting shares
// without the column keeps working. App code still treats NULL as 'view'
// defensively. Runs via the mxd_migration ledger, never upstream's.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('shares')
    .addColumn('mode', 'varchar', (col) => col.defaultTo('view'))
    .execute();
  await sql`UPDATE shares SET mode = 'view' WHERE mode IS NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('shares').dropColumn('mode').execute();
}
