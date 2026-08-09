import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdView,
  MxdView,
  UpdatableMxdView,
} from '@docmost/db/types/entity.types';

// MXD data platform — view repository. A view is configuration over one table's
// records, never a copy (roadmap §9). Scoped by (workspaceId, tableId).
@Injectable()
export class MxdViewRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdView,
    trx?: KyselyTransaction,
  ): Promise<MxdView> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdViews')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    workspaceId: string,
    tableId: string,
    viewId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdView | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdViews')
      .selectAll()
      .where('id', '=', viewId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async listByTable(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdView[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdViews')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .orderBy('position', 'asc')
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async update(
    workspaceId: string,
    tableId: string,
    viewId: string,
    data: UpdatableMxdView,
    trx?: KyselyTransaction,
  ): Promise<MxdView | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdViews')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', viewId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(
    workspaceId: string,
    tableId: string,
    viewId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('mxdViews')
      .where('id', '=', viewId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
