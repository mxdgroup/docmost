import { Kysely, sql } from 'kysely';

// Public links are commentable by default (product decision 2026-09-14: a link
// shared with a client must let them comment without the sharer finding a
// separate setting). New shares get `comment` in ShareService.createShare; this
// one-off backfill lifts every existing view-only share to `comment` too.
//
// Safe with the flags off: comment capability is still gated server-side by
// SHARE_GUEST_COMMENTS_ENABLED, so a `comment` share behaves as `view` until
// the flag is on. `edit` shares are untouched. The column DEFAULT stays 'view'
// so upstream code inserting shares without a mode keeps its old behavior.
export async function up(db: Kysely<any>): Promise<void> {
  await sql`UPDATE shares SET mode = 'comment' WHERE mode IS NULL OR mode = 'view'`.execute(
    db,
  );
}

// Irreversible by design: after up() we can't tell backfilled rows from shares
// someone deliberately set to `comment`. Lower individual links in the UI.
export async function down(): Promise<void> {}
