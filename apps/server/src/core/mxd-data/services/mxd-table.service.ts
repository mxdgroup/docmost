import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdViewRepo } from '@docmost/db/repos/mxd-data/mxd-view.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { MxdTable } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';

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
    private readonly pageRepo: PageRepo,
    private readonly access: MxdAccessService,
  ) {}

  // A table is homed on a page. The space is derived from that page; the page is
  // validated to belong to the caller's workspace AND the caller must be able to
  // EDIT that page — a table can't be created against another tenant's page or a
  // page the caller can only read (authz, roadmap §3/§17).
  async createTable(
    ctx: MxdContext,
    input: { pageId: string; title?: string },
  ): Promise<MxdTable> {
    const page = await this.pageRepo.findById(input.pageId);
    if (!page || page.workspaceId !== ctx.workspaceId) {
      throw new ForbiddenException('Page not found in this workspace');
    }
    await this.access.authorizePageWrite(ctx, page as any);
    return this.db.transaction().execute(async (trx) => {
      const table = await this.tableRepo.insert(
        {
          workspaceId: ctx.workspaceId,
          spaceId: page.spaceId,
          pageId: page.id,
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
    await this.access.authorizeRead(ctx, table);
    return table;
  }

  // Only return the tables in the space the caller may actually read — a
  // restricted page's table is filtered out rather than leaked (roadmap §5).
  async listTables(ctx: MxdContext, spaceId: string): Promise<MxdTable[]> {
    const tables = await this.tableRepo.listBySpace(ctx.workspaceId, spaceId);
    const visible: MxdTable[] = [];
    for (const table of tables) {
      if (await this.access.canRead(ctx, table)) visible.push(table);
    }
    return visible;
  }

  async renameTable(
    ctx: MxdContext,
    tableId: string,
    title: string,
  ): Promise<MxdTable> {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.access.authorizeWrite(ctx, table);
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
    await this.access.authorizeWrite(ctx, table);
    await this.tableRepo.softDelete(ctx.workspaceId, tableId);
  }
}
