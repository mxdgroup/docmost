import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdField,
  MxdField,
  UpdatableMxdField,
} from '@docmost/db/types/entity.types';

// MXD data platform — field repository. Scoped by (workspaceId, tableId): a
// field is only ever addressed within its table, so a valid field UUID with the
// wrong parent table resolves to undefined (roadmap §5 IDOR).
@Injectable()
export class MxdFieldRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdField,
    trx?: KyselyTransaction,
  ): Promise<MxdField> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdFields')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    workspaceId: string,
    tableId: string,
    fieldId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdField | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdFields')
      .selectAll()
      .where('id', '=', fieldId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async listByTable(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdField[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdFields')
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
    fieldId: string,
    data: UpdatableMxdField,
    trx?: KyselyTransaction,
  ): Promise<MxdField | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdFields')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', fieldId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  // Hard delete — the caller (field service) is responsible for the policy on
  // orphaned jsonb cell values keyed by this field's uuid (roadmap §12). The FK
  // cascade removes relation edges for a relation field.
  async delete(
    workspaceId: string,
    tableId: string,
    fieldId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('mxdFields')
      .where('id', '=', fieldId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async maxPosition(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const row = await dbOrTx(this.db, trx)
      .selectFrom('mxdFields')
      .select((eb) => eb.fn.max('position').as('max'))
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .executeTakeFirst();
    return Number(row?.max ?? 0);
  }
}
