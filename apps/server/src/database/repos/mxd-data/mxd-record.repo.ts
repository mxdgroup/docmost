import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdRecord,
  MxdRecord,
} from '@docmost/db/types/entity.types';

export interface MxdRecordPage {
  items: MxdRecord[];
  total: number;
  limit: number;
  offset: number;
}

// MXD data platform — record repository. Scoped by (workspaceId, tableId).
// Mutations carry optimistic-concurrency teeth: a versioned write only lands if
// the caller's expected version still matches, so a stale client can never
// silently clobber a newer write (roadmap §10/§18).
@Injectable()
export class MxdRecordRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdRecord,
    trx?: KyselyTransaction,
  ): Promise<MxdRecord> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdRecords')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    workspaceId: string,
    tableId: string,
    recordId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdRecord | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecords')
      .selectAll()
      .where('id', '=', recordId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  // Deterministic ordering (position, then id) so pagination is stable
  // (roadmap §13). Offset/limit with a hard cap enforced by the caller — never
  // return a whole table to render a page (§23).
  async list(
    workspaceId: string,
    tableId: string,
    limit: number,
    offset: number,
    trx?: KyselyTransaction,
  ): Promise<MxdRecordPage> {
    const db = dbOrTx(this.db, trx);
    const items = await db
      .selectFrom('mxdRecords')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('deletedAt', 'is', null)
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
      .limit(limit)
      .offset(offset)
      .execute();
    const countRow = await db
      .selectFrom('mxdRecords')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return {
      items,
      total: Number(countRow?.count ?? 0),
      limit,
      offset,
    };
  }

  // Optimistic-concurrency update. Writes the validated full cell bag and bumps
  // version, but ONLY if the row is still at expectedVersion. Returns undefined
  // when the version no longer matches (stale) — the service maps that to a 409
  // conflict, never a silent overwrite.
  async updateWithVersion(
    workspaceId: string,
    tableId: string,
    recordId: string,
    expectedVersion: number,
    data: Record<string, unknown>,
    updatedById: string | null,
    trx?: KyselyTransaction,
  ): Promise<MxdRecord | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdRecords')
      .set({
        data: JSON.stringify(data) as unknown as any,
        version: expectedVersion + 1,
        updatedById,
        updatedAt: new Date(),
      })
      .where('id', '=', recordId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .where('version', '=', expectedVersion)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  // Version-checked soft delete: a delete racing an edit is a conflict, not a
  // silent win (roadmap §10 delete-vs-edit).
  async softDeleteWithVersion(
    workspaceId: string,
    tableId: string,
    recordId: string,
    expectedVersion: number,
    trx?: KyselyTransaction,
  ): Promise<MxdRecord | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdRecords')
      .set({ deletedAt: new Date(), version: expectedVersion + 1 })
      .where('id', '=', recordId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .where('version', '=', expectedVersion)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirst();
  }

  // All live records' id + data for a table — used by field type-conversion,
  // which must re-normalize every existing cell. Bounded by table size; callers
  // treat conversion as an admin op (roadmap §7).
  async allForTable(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<Pick<MxdRecord, 'id' | 'data' | 'version'>[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecords')
      .select(['id', 'data', 'version'])
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  // Remove a field's key from every record's jsonb (field delete policy §12:
  // values are REMOVED, so deleted-field data can never leak via API/export).
  async stripField(
    workspaceId: string,
    tableId: string,
    fieldId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('mxdRecords')
      .set((eb) => ({ data: sql`${eb.ref('data')} - ${fieldId}` }))
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .execute();
  }

  // Direct data replace (no version bump) for schema-level operations like type
  // conversion, where the whole column is being rewritten under an editor's
  // control rather than a concurrent record edit.
  async replaceData(
    workspaceId: string,
    tableId: string,
    recordId: string,
    data: Record<string, unknown>,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('mxdRecords')
      .set({ data: JSON.stringify(data) as unknown as any, updatedAt: new Date() })
      .where('id', '=', recordId)
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
      .selectFrom('mxdRecords')
      .select((eb) => eb.fn.max('position').as('max'))
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    return Number(row?.max ?? 0);
  }
}
