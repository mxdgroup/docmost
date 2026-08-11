import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdViewRepo } from '@docmost/db/repos/mxd-data/mxd-view.repo';
import { MxdView } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import {
  ViewConfig,
  ViewType,
  VIEW_TYPES,
  validateViewConfigForType,
} from '../views/view-config';

@Injectable()
export class MxdViewService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly viewRepo: MxdViewRepo,
    private readonly access: MxdAccessService,
  ) {}

  private async requireTable(ctx: MxdContext, tableId: string, write: boolean) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    if (write) await this.access.authorizeWrite(ctx, table);
    else await this.access.authorizeRead(ctx, table);
    return table;
  }

  private assertType(type: string): ViewType {
    if (!(VIEW_TYPES as readonly string[]).includes(type)) {
      throw new BadRequestException(`Unknown view type: ${type}`);
    }
    return type as ViewType;
  }

  private async validateConfig(
    ctx: MxdContext,
    tableId: string,
    type: ViewType,
    config: ViewConfig | undefined,
  ): Promise<ViewConfig> {
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    return validateViewConfigForType(fields, type, config);
  }

  async createView(
    ctx: MxdContext,
    tableId: string,
    input: { name?: string; type?: string; config?: ViewConfig },
  ): Promise<MxdView> {
    await this.requireTable(ctx, tableId, true);
    const type = this.assertType(input.type ?? 'grid');
    const config = await this.validateConfig(ctx, tableId, type, input.config);
    const position =
      (await this.maxPosition(ctx.workspaceId, tableId)) + 1;
    return this.viewRepo.insert({
      tableId,
      workspaceId: ctx.workspaceId,
      name: input.name?.trim() || 'View',
      type,
      config: config as any,
      position,
      creatorId: ctx.userId,
    });
  }

  async listViews(ctx: MxdContext, tableId: string): Promise<MxdView[]> {
    await this.requireTable(ctx, tableId, false);
    return this.viewRepo.listByTable(ctx.workspaceId, tableId);
  }

  async getView(
    ctx: MxdContext,
    tableId: string,
    viewId: string,
  ): Promise<MxdView> {
    await this.requireTable(ctx, tableId, false);
    const view = await this.viewRepo.findById(ctx.workspaceId, tableId, viewId);
    if (!view) throw new NotFoundException('View not found');
    return view;
  }

  async renameView(
    ctx: MxdContext,
    tableId: string,
    viewId: string,
    name: string,
  ): Promise<MxdView> {
    await this.requireTable(ctx, tableId, true);
    const updated = await this.viewRepo.update(ctx.workspaceId, tableId, viewId, {
      name: name?.trim() || 'View',
    });
    if (!updated) throw new NotFoundException('View not found');
    return updated;
  }

  async updateConfig(
    ctx: MxdContext,
    tableId: string,
    viewId: string,
    input: { type?: string; config?: ViewConfig },
  ): Promise<MxdView> {
    await this.requireTable(ctx, tableId, true);
    const existing = await this.viewRepo.findById(
      ctx.workspaceId,
      tableId,
      viewId,
    );
    if (!existing) throw new NotFoundException('View not found');

    const patch: any = {};
    // Validate the EFFECTIVE (type, config) pair: a type change must be checked
    // against the existing config (e.g. switching to calendar needs a date
    // field), and a config change against the effective type.
    const effectiveType =
      input.type !== undefined
        ? this.assertType(input.type)
        : (existing.type as ViewType);
    if (input.type !== undefined) patch.type = effectiveType;
    if (input.type !== undefined || input.config !== undefined) {
      const effectiveConfig =
        input.config !== undefined
          ? input.config
          : ((existing.config ?? {}) as ViewConfig);
      patch.config = (await this.validateConfig(
        ctx,
        tableId,
        effectiveType,
        effectiveConfig,
      )) as any;
    }
    const updated = await this.viewRepo.update(
      ctx.workspaceId,
      tableId,
      viewId,
      patch,
    );
    if (!updated) throw new NotFoundException('View not found');
    return updated;
  }

  async reorderView(
    ctx: MxdContext,
    tableId: string,
    viewId: string,
    position: number,
  ): Promise<MxdView> {
    await this.requireTable(ctx, tableId, true);
    const updated = await this.viewRepo.update(ctx.workspaceId, tableId, viewId, {
      position,
    });
    if (!updated) throw new NotFoundException('View not found');
    return updated;
  }

  async deleteView(
    ctx: MxdContext,
    tableId: string,
    viewId: string,
  ): Promise<void> {
    await this.requireTable(ctx, tableId, true);
    const view = await this.viewRepo.findById(ctx.workspaceId, tableId, viewId);
    if (!view) throw new NotFoundException('View not found');
    await this.viewRepo.delete(ctx.workspaceId, tableId, viewId);
  }

  private async maxPosition(
    workspaceId: string,
    tableId: string,
  ): Promise<number> {
    const views = await this.viewRepo.listByTable(workspaceId, tableId);
    return views.reduce((m, v) => Math.max(m, Number(v.position ?? 0)), 0);
  }
}
