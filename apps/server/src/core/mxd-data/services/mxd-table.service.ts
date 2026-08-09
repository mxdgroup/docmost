import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdViewRepo } from '@docmost/db/repos/mxd-data/mxd-view.repo';
import { MxdTable } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';

// MXD data platform — table lifecycle (roadmap §11). A new table is created with
// a primary text field and a default grid view in one transaction, so a table is
// never in a half-built state (no primary, no view).
@Injectable()
export class MxdTableService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly viewRepo: MxdViewRepo,
  ) {}

  async createTable(
    ctx: MxdContext,
    input: { spaceId: string; pageId?: string | null; title?: string },
  ): Promise<MxdTable> {
    return this.db.transaction().execute(async (trx) => {
      const table = await this.tableRepo.insert(
        {
          workspaceId: ctx.workspaceId,
          spaceId: input.spaceId,
          pageId: input.pageId ?? null,
          title: input.title?.trim() || 'Untitled',
          creatorId: ctx.userId,
        },
        trx,
      );

      const primary = await this.fieldRepo.insert(
        {
          tableId: table.id,
          workspaceId: ctx.workspaceId,
          name: 'Name',
          type: 'text',
          position: 0,
        },
        trx,
      );

      await this.tableRepo.update(
        ctx.workspaceId,
        table.id,
        { primaryFieldId: primary.id },
        trx,
      );

      await this.viewRepo.insert(
        {
          tableId: table.id,
          workspaceId: ctx.workspaceId,
          name: 'Grid',
          type: 'grid',
          position: 0,
          creatorId: ctx.userId,
        },
        trx,
      );

      return { ...table, primaryFieldId: primary.id };
    });
  }

  async getTable(ctx: MxdContext, tableId: string): Promise<MxdTable> {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  async listTables(ctx: MxdContext, spaceId: string): Promise<MxdTable[]> {
    return this.tableRepo.listBySpace(ctx.workspaceId, spaceId);
  }

  async renameTable(
    ctx: MxdContext,
    tableId: string,
    title: string,
  ): Promise<MxdTable> {
    const updated = await this.tableRepo.update(ctx.workspaceId, tableId, {
      title: title.trim() || 'Untitled',
    });
    if (!updated) throw new NotFoundException('Table not found');
    return updated;
  }

  // Archive (soft delete). Records/fields are retained under the archived table
  // for recovery; a hard delete is a separate, deliberate operation.
  async archiveTable(ctx: MxdContext, tableId: string): Promise<void> {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.tableRepo.softDelete(ctx.workspaceId, tableId);
  }
}
