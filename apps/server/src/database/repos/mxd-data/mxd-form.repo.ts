import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdForm,
  MxdForm,
  UpdatableMxdForm,
} from '@docmost/db/types/entity.types';

// MXD data platform — public form repository. Authenticated reads are workspace +
// table scoped; the public path resolves a form by its global unique key.
@Injectable()
export class MxdFormRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdForm,
    trx?: KyselyTransaction,
  ): Promise<MxdForm> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdForms')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    workspaceId: string,
    tableId: string,
    formId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdForm | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdForms')
      .selectAll()
      .where('id', '=', formId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async listByTable(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdForm[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdForms')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  // Public lookup by key — the only path a form's key is trusted from the URL.
  async findByKey(key: string, trx?: KyselyTransaction): Promise<MxdForm | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdForms')
      .selectAll()
      .where('key', '=', key)
      .executeTakeFirst();
  }

  async update(
    workspaceId: string,
    tableId: string,
    formId: string,
    data: UpdatableMxdForm,
    trx?: KyselyTransaction,
  ): Promise<MxdForm | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdForms')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', formId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(
    workspaceId: string,
    tableId: string,
    formId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('mxdForms')
      .where('id', '=', formId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
