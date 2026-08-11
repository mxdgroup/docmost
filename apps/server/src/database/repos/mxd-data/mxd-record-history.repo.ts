import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdRecordHistory,
  MxdRecordHistoryEntry,
} from '@docmost/db/types/entity.types';

// MXD data platform — append-only record history / audit trail. Workspace +
// record scoped by construction (roadmap §5). Never updated or deleted from the
// application (immutable audit); rows are removed only by the FK cascade when a
// workspace or table is dropped.
@Injectable()
export class MxdRecordHistoryRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdRecordHistory,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .insertInto('mxdRecordHistory')
      .values(data)
      .execute();
  }

  // Most-recent-first history for one record, capped by the caller.
  async listByRecord(
    workspaceId: string,
    tableId: string,
    recordId: string,
    limit: number,
    trx?: KyselyTransaction,
  ): Promise<MxdRecordHistoryEntry[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdRecordHistory')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('recordId', '=', recordId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
  }
}
