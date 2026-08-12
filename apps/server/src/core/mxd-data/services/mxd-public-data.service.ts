import { Injectable, NotFoundException } from '@nestjs/common';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdViewRepo } from '@docmost/db/repos/mxd-data/mxd-view.repo';
import {
  MxdRecordPage,
  MxdRecordRepo,
} from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdTable } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdComputeService } from './mxd-compute.service';
import { ViewConfig, sanitizeViewConfig } from '../views/view-config';
import { compileFilter, orderBySpecs } from '../views/filter-compiler';

const RECORD_LIST_MAX = 200;
const RECORD_LIST_DEFAULT = 50;

// MXD data platform — PUBLIC (anonymous) read access to an embedded table on a
// public share. Authorization is the SHARE itself: a table is readable only if
// its home page is within the share's scope (the shared page, or a descendant if
// includeSubPages). This is READ-ONLY — no writes on the anonymous path. Computed
// lookups/rollups that cross a relation resolve to empty here (the anonymous
// reader can't be authorized on the related table), so no cross-table leak.
@Injectable()
export class MxdPublicDataService {
  constructor(
    private readonly shareRepo: ShareRepo,
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly viewRepo: MxdViewRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly compute: MxdComputeService,
  ) {}

  // Resolve a (shareKey, tableId) to a table the share grants read to, or 404.
  private async resolve(shareKey: string, tableId: string): Promise<MxdTable> {
    const share = await this.shareRepo.findById(shareKey);
    if (!share || share.deletedAt || !share.pageId) {
      throw new NotFoundException('Not found');
    }
    // Respect the workspace/space public-sharing kill switch.
    const allowed = await this.shareRepo.isSharingAllowed(
      share.workspaceId,
      share.spaceId,
    );
    if (!allowed) throw new NotFoundException('Not found');

    const table = await this.tableRepo.findById(share.workspaceId, tableId);
    if (!table || !table.pageId) throw new NotFoundException('Not found');

    const withinScope = await this.shareRepo.isPageWithinShareScope(
      { pageId: share.pageId, includeSubPages: share.includeSubPages },
      table.pageId,
    );
    if (!withinScope) throw new NotFoundException('Not found');
    return table;
  }

  // An anonymous read context scoped to the share's workspace. userId is null, so
  // any cross-table authorization (in compute) fails closed → no leak.
  private anonCtx(table: MxdTable): MxdContext {
    return { workspaceId: table.workspaceId, userId: null };
  }

  async getTable(shareKey: string, tableId: string): Promise<MxdTable> {
    return this.resolve(shareKey, tableId);
  }

  async listFields(shareKey: string, tableId: string) {
    const table = await this.resolve(shareKey, tableId);
    return this.fieldRepo.listByTable(table.workspaceId, tableId);
  }

  async listViews(shareKey: string, tableId: string) {
    const table = await this.resolve(shareKey, tableId);
    return this.viewRepo.listByTable(table.workspaceId, tableId);
  }

  async queryRecords(
    shareKey: string,
    tableId: string,
    opts: { viewId?: string; limit?: number; offset?: number },
  ): Promise<MxdRecordPage> {
    const table = await this.resolve(shareKey, tableId);
    const ctx = this.anonCtx(table);
    const fields = await this.fieldRepo.listByTable(table.workspaceId, tableId);
    const fieldsById = new Map(fields.map((f) => [f.id, f]));

    // Only a STORED view's (sanitized) config is honored publicly — no arbitrary
    // inline filter/sort from an anonymous caller.
    let config: ViewConfig = {};
    if (opts.viewId) {
      const view = await this.viewRepo.findById(
        table.workspaceId,
        tableId,
        opts.viewId,
      );
      if (view) config = sanitizeViewConfig(fields, (view.config ?? {}) as ViewConfig);
    }

    const where = config.filter ? compileFilter(fieldsById, config.filter) : null;
    const order = orderBySpecs(fieldsById, config.sorts ?? []);
    const limit = Math.min(
      Math.max(1, opts.limit ?? RECORD_LIST_DEFAULT),
      RECORD_LIST_MAX,
    );
    const offset = Math.max(0, opts.offset ?? 0);
    const page = await this.recordRepo.queryView(
      table.workspaceId,
      tableId,
      where,
      order,
      limit,
      offset,
    );
    page.items = await this.compute.enrich(ctx, fields, page.items);
    return page;
  }
}
