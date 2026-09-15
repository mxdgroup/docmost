import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '../../types/kysely.types';
import { dbOrTx } from '../../utils';
import {
  Comment,
  InsertableComment,
  UpdatableComment,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

@Injectable()
export class CommentRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  // todo, add workspaceId
  async findById(
    commentId: string,
    opts?: {
      includeCreator: boolean;
      includeResolvedBy: boolean;
      // MXD: commenter-account author/resolver ({ id, name }; + email for members)
      includeCommenter?: boolean;
      includeCommenterEmail?: boolean;
    },
  ): Promise<Comment> {
    return await this.db
      .selectFrom('comments')
      .selectAll('comments')
      .$if(opts?.includeCreator, (qb) => qb.select(this.withCreator))
      .$if(opts?.includeResolvedBy, (qb) => qb.select(this.withResolvedBy))
      .$if(!!opts?.includeCommenter, (qb) =>
        qb.select((eb) => [
          this.withCommenter(eb, !!opts?.includeCommenterEmail),
          this.withResolvedByCommenter(eb),
        ]),
      )
      .where('id', '=', commentId)
      .executeTakeFirst();
  }

  async findPageComments(
    pageId: string,
    pagination: PaginationOptions,
    opts?: { includeCommenterEmail?: boolean },
  ) {
    const query = this.db
      .selectFrom('comments')
      .selectAll('comments')
      .select((eb) => this.withCreator(eb))
      .select((eb) => this.withResolvedBy(eb))
      .select((eb) => this.withCommenter(eb, !!opts?.includeCommenterEmail))
      .select((eb) => this.withResolvedByCommenter(eb))
      .where('pageId', '=', pageId);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
  }

  async updateComment(
    updatableComment: UpdatableComment,
    commentId: string,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('comments')
      .set(updatableComment)
      .where('id', '=', commentId)
      .execute();
  }

  async insertComment(
    insertableComment: InsertableComment,
    trx?: KyselyTransaction,
  ): Promise<Comment> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('comments')
      .values(insertableComment)
      .returningAll()
      .executeTakeFirst();
  }

  withCreator(eb: ExpressionBuilder<DB, 'comments'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'comments.creatorId'),
    ).as('creator');
  }

  // MXD: a commenter's email is PII — only member-facing reads include it,
  // never the public share listing.
  withCommenter(eb: ExpressionBuilder<DB, 'comments'>, includeEmail: boolean) {
    return jsonObjectFrom(
      eb
        .selectFrom('mxdShareCommenters')
        .select(
          includeEmail
            ? ['mxdShareCommenters.id', 'mxdShareCommenters.name', 'mxdShareCommenters.email']
            : ['mxdShareCommenters.id', 'mxdShareCommenters.name'],
        )
        .whereRef('mxdShareCommenters.id', '=', 'comments.commenterId'),
    ).as('commenter');
  }

  withResolvedByCommenter(eb: ExpressionBuilder<DB, 'comments'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('mxdShareCommenters')
        .select(['mxdShareCommenters.id', 'mxdShareCommenters.name'])
        .whereRef('mxdShareCommenters.id', '=', 'comments.resolvedByCommenterId'),
    ).as('resolvedByCommenter');
  }

  // MXD: move a guest comment onto a commenter account (ownership already
  // proven by the caller). Only anonymous, unclaimed rows can move.
  async claimGuestComment(
    commentId: string,
    commenterId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const result = await this.db
      .updateTable('comments')
      .set({ commenterId })
      .where('id', '=', commentId)
      .where('workspaceId', '=', workspaceId)
      .where('creatorId', 'is', null)
      .where('commenterId', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0) > 0;
  }

  withResolvedBy(eb: ExpressionBuilder<DB, 'comments'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'comments.resolvedById'),
    ).as('resolvedBy');
  }

  // MXD: guest ownership secret (hash only) for edit/delete of a guest comment.
  // Kept out of `comments` so selectAll-based responses never carry it.
  async insertGuestCommentToken(
    commentId: string,
    tokenHash: string,
  ): Promise<void> {
    await this.db
      .insertInto('mxdGuestCommentTokens')
      .values({ commentId, tokenHash })
      .execute();
  }

  async findGuestCommentTokenHash(commentId: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('mxdGuestCommentTokens')
      .select('tokenHash')
      .where('commentId', '=', commentId)
      .executeTakeFirst();
    return row?.tokenHash ?? null;
  }

  async deleteComment(commentId: string): Promise<void> {
    await this.db.deleteFrom('comments').where('id', '=', commentId).execute();
  }

  async hasChildren(commentId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('comments')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('parentCommentId', '=', commentId)
      .executeTakeFirst();

    return Number(result?.count) > 0;
  }

  async hasChildrenFromOtherUsers(commentId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .selectFrom('comments')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('parentCommentId', '=', commentId)
      .where('creatorId', '!=', userId)
      .executeTakeFirst();

    return Number(result?.count) > 0;
  }
}
