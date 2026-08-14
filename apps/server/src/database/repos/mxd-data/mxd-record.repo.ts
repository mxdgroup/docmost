import { Injectable } from '@nestjs/common';
import { RawBuilder, SqlBool, sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdRecord,
  MxdRecord,
} from '@docmost/db/types/entity.types';

// A pre-compiled ORDER BY term (the core view layer builds these from a
// validated config via the filter-compiler; the repo just applies them).
export interface MxdOrderTerm {
  expr: RawBuilder<unknown>;
  direction: 'asc' | 'desc';
}

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

  // Apply a validated, pre-compiled filter (where) + ordering over the
  // workspace/table-scoped record set. `where` and `order` are built by the
  // core view layer from a validated config — the repo never sees raw client
  // strings. A stable secondary sort by id keeps pagination deterministic.
  async queryView(
    workspaceId: string,
    tableId: string,
    where: RawBuilder<SqlBool> | null,
    order: MxdOrderTerm[],
    limit: number,
    offset: number,
    trx?: KyselyTransaction,
  ): Promise<MxdRecordPage> {
    const db = dbOrTx(this.db, trx);
    let base = db
      .selectFrom('mxdRecords')
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('deletedAt', 'is', null);
    if (where) base = base.where(where);

    let q = base.selectAll();
    for (const term of order) q = q.orderBy(term.expr as any, term.direction);
    q = q.orderBy('id', 'asc');

    const items = await q.limit(limit).offset(offset).execute();
    const countRow = await base
      .select((eb) => eb.fn.countAll<string>().as('count'))
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
        // Pass the object (like insert) so pg serializes it to a jsonb OBJECT;
        // JSON.stringify here double-encodes it into a jsonb STRING and breaks
        // every subsequent cell read.
        data: data as any,
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
    forUpdate = false,
  ): Promise<Pick<MxdRecord, 'id' | 'data' | 'version'>[]> {
    let q = dbOrTx(this.db, trx)
      .selectFrom('mxdRecords')
      .select(['id', 'data', 'version'])
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('deletedAt', 'is', null);
    // Lock the rows for the transaction so a concurrent updateWithVersion can't
    // interleave a change that a later replaceData would silently clobber.
    if (forUpdate) q = q.forUpdate();
    return q.execute();
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

  // Direct data replace for schema-level operations like type conversion, where
  // the whole column is rewritten under an editor's control. It BUMPS version:
  // although the rows are locked FOR UPDATE during the conversion transaction, a
  // concurrent updateRecord reads its `current` snapshot under READ COMMITTED
  // BEFORE the lock and then writes WHERE version = expected. Without the bump
  // that stale write's version still matches and it silently restores the
  // pre-conversion values for every field it didn't touch. Bumping version
  // forces that racing write into the 409-conflict path instead (review P1).
  async replaceData(
    workspaceId: string,
    tableId: string,
    recordId: string,
    data: Record<string, unknown>,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('mxdRecords')
      .set((eb) => ({
        data: data as any,
        version: sql`${eb.ref('version')} + 1`,
        updatedAt: new Date(),
      }))
      .where('id', '=', recordId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  // Batch-fetch live records by id within a table (used by lookup/rollup compute
  // to resolve relation targets without an N+1 per record).
  async findByIds(
    workspaceId: string,
    tableId: string,
    ids: string[],
    trx?: KyselyTransaction,
  ): Promise<MxdRecord[]> {
    if (ids.length === 0) return [];
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecords')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('id', 'in', ids)
      .where('deletedAt', 'is', null)
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
