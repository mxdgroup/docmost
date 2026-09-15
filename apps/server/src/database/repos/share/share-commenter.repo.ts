import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '../../types/kysely.types';
import { executeTx } from '../../utils';

export type ShareCommenter = {
  id: string;
  workspaceId: string;
  email: string;
  name: string;
};

// MXD: commenter accounts for public share links (NOT Docmost users) and their
// single-use emailed sign-in tokens. See migration 20260915T120000.
@Injectable()
export class ShareCommenterRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<ShareCommenter | undefined> {
    return this.db
      .selectFrom('mxdShareCommenters')
      .select(['id', 'workspaceId', 'email', 'name'])
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async countRecentSignInTokens(
    workspaceId: string,
    email: string,
    since: Date,
  ): Promise<number> {
    const row = await this.db
      .selectFrom('mxdCommenterSignInTokens')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('email', '=', email)
      .where('createdAt', '>', since)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async insertSignInToken(opts: {
    workspaceId: string;
    email: string;
    name: string | null;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insertInto('mxdCommenterSignInTokens').values(opts).execute();
  }

  // Atomically consumes a valid (unused, unexpired) token and upserts the
  // commenter it belongs to. Returns null when the token can't be used — a
  // second use of the same link always fails.
  async consumeSignInToken(
    tokenHash: string,
    workspaceId: string,
  ): Promise<ShareCommenter | null> {
    return executeTx(this.db, async (trx) => {
      const token = await trx
        .updateTable('mxdCommenterSignInTokens')
        .set({ usedAt: new Date() })
        .where('tokenHash', '=', tokenHash)
        .where('workspaceId', '=', workspaceId)
        .where('usedAt', 'is', null)
        .where('expiresAt', '>', new Date())
        .returning(['email', 'name'])
        .executeTakeFirst();
      if (!token) return null;

      const fallbackName = token.email.split('@')[0].slice(0, 50) || 'Commenter';
      const commenter = await trx
        .insertInto('mxdShareCommenters')
        .values({
          workspaceId,
          email: token.email,
          name: token.name?.trim() || fallbackName,
          lastSignInAt: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['workspaceId', 'email']).doUpdateSet({
            lastSignInAt: sql`now()`,
            updatedAt: sql`now()`,
          }),
        )
        .returning(['id', 'workspaceId', 'email', 'name'])
        .executeTakeFirst();
      return commenter ?? null;
    });
  }
}
