import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdRecordLink,
  MxdRecordLink,
} from '@docmost/db/types/entity.types';

// MXD data platform — relation edge repository. Edges are true rows with FK
// integrity (roadmap §7/§24), never text labels. Scoped by workspaceId; the
// service asserts both endpoints resolve within the workspace before linking,
// so an edge can never span tenants.
@Injectable()
export class MxdRecordLinkRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  // Transaction-scoped advisory lock keyed by (field, fromRecord) — serializes
  // concurrent link() calls for the same source so the single-relation replace
  // and the fan-out cap are race-free.
  async lockRelation(
    fieldId: string,
    fromRecordId: string,
    trx: KyselyTransaction,
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${
      fieldId + ':' + fromRecordId
    }, 0))`.execute(trx);
  }

  // Idempotent: the unique (field_id, from, to) constraint means a duplicate
  // link is a no-op rather than an error.
  async insert(
    data: InsertableMxdRecordLink,
    trx?: KyselyTransaction,
  ): Promise<MxdRecordLink | undefined> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdRecordLinks')
      .values(data)
      .onConflict((oc) =>
        oc.columns(['fieldId', 'fromRecordId', 'toRecordId']).doNothing(),
      )
      .returningAll()
      .executeTakeFirst();
  }

  // Outgoing edges for a record on a given relation field.
  async listFrom(
    workspaceId: string,
    fieldId: string,
    fromRecordId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdRecordLink[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecordLinks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('fieldId', '=', fieldId)
      .where('fromRecordId', '=', fromRecordId)
      .execute();
  }

  // Batch: all outgoing edges for a set of source records on one field (used by
  // lookup/rollup compute to avoid an N+1 per record).
  async listFromMany(
    workspaceId: string,
    fieldId: string,
    fromRecordIds: string[],
    trx?: KyselyTransaction,
  ): Promise<MxdRecordLink[]> {
    if (fromRecordIds.length === 0) return [];
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecordLinks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('fieldId', '=', fieldId)
      .where('fromRecordId', 'in', fromRecordIds)
      .execute();
  }

  // Incoming edges (reciprocal display, roadmap §7).
  async listTo(
    workspaceId: string,
    fieldId: string,
    toRecordId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdRecordLink[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecordLinks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('fieldId', '=', fieldId)
      .where('toRecordId', '=', toRecordId)
      .execute();
  }

  async deleteEdge(
    workspaceId: string,
    fieldId: string,
    fromRecordId: string,
    toRecordId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('mxdRecordLinks')
      .where('workspaceId', '=', workspaceId)
      .where('fieldId', '=', fieldId)
      .where('fromRecordId', '=', fromRecordId)
      .where('toRecordId', '=', toRecordId)
      .execute();
  }

  // Remove every edge touching a record (either endpoint) — used when a record
  // is hard-deleted. Soft delete leaves edges intact for recovery.
  async deleteForRecord(
    workspaceId: string,
    recordId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('mxdRecordLinks')
      .where('workspaceId', '=', workspaceId)
      .where((eb) =>
        eb.or([
          eb('fromRecordId', '=', recordId),
          eb('toRecordId', '=', recordId),
        ]),
      )
      .execute();
  }
}
