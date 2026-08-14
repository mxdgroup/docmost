import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdTable,
  MxdTable,
  UpdatableMxdTable,
} from '@docmost/db/types/entity.types';

// MXD data platform — table repository. Every method is workspace-scoped by
// construction (roadmap §5): an opaque table UUID is never trusted alone. A
// caller that only has (workspaceId, tableId) cannot reach another tenant's
// table because the workspace predicate is part of the query, not a separate
// check someone must remember to add.
@Injectable()
export class MxdTableRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdTable,
    trx?: KyselyTransaction,
  ): Promise<MxdTable> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdTables')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Scoped lookup: workspace + id, non-deleted. Returns undefined when the id
  // belongs to another workspace or is soft-deleted (indistinguishable to the
  // caller — no oracle for cross-tenant existence).
  async findById(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdTable | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdTables')
      .selectAll()
      .where('id', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async listBySpace(
    workspaceId: string,
    spaceId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdTable[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdTables')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async listByPage(
    workspaceId: string,
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdTable[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdTables')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async update(
    workspaceId: string,
    tableId: string,
    data: UpdatableMxdTable,
    trx?: KyselyTransaction,
  ): Promise<MxdTable | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdTables')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  // Soft delete (archive) — keeps records/fields for recovery; cascades happen
  // only on a hard delete, which is a deliberate separate operation.
  async softDelete(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('mxdTables')
      .set({ deletedAt: new Date() })
      .where('id', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
