import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableMxdAutomationRule,
  InsertableMxdAutomationRun,
  MxdAutomationRule,
  UpdatableMxdAutomationRule,
} from '@docmost/db/types/entity.types';

// MXD data platform — automation rule repository. Workspace + table scoped by
// construction (roadmap §5), like the other mxd repos.
@Injectable()
export class MxdAutomationRuleRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdAutomationRule,
    trx?: KyselyTransaction,
  ): Promise<MxdAutomationRule> {
    return dbOrTx(this.db, trx)
      .insertInto('mxdAutomationRules')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(
    workspaceId: string,
    tableId: string,
    ruleId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdAutomationRule | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdAutomationRules')
      .selectAll()
      .where('id', '=', ruleId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async listByTable(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdAutomationRule[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdAutomationRules')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  // Enabled rules for a table — the set the executor considers on a trigger.
  async listEnabledForTable(
    workspaceId: string,
    tableId: string,
    trx?: KyselyTransaction,
  ): Promise<MxdAutomationRule[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('mxdAutomationRules')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('tableId', '=', tableId)
      .where('enabled', '=', true)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async update(
    workspaceId: string,
    tableId: string,
    ruleId: string,
    data: UpdatableMxdAutomationRule,
    trx?: KyselyTransaction,
  ): Promise<MxdAutomationRule | undefined> {
    return dbOrTx(this.db, trx)
      .updateTable('mxdAutomationRules')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', ruleId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async delete(
    workspaceId: string,
    tableId: string,
    ruleId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('mxdAutomationRules')
      .where('id', '=', ruleId)
      .where('tableId', '=', tableId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}

// Append-only execution audit log.
@Injectable()
export class MxdAutomationRunRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    data: InsertableMxdAutomationRun,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .insertInto('mxdAutomationRuns')
      .values(data)
      .execute();
  }
}
