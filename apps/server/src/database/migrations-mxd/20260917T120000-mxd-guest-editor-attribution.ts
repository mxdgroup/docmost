import { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .addColumn('last_updated_by_guest', 'varchar(100)')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('pages')
    .dropColumn('last_updated_by_guest')
    .execute();
}
