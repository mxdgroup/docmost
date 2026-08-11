import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import {
  MxdRecordPage,
  MxdRecordRepo,
} from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdViewRepo } from '@docmost/db/repos/mxd-data/mxd-view.repo';
import { MxdField, MxdRecord } from '@docmost/db/types/entity.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  MxdContext,
  MXD_RECORD_CHANGED,
  MxdRecordChangedEvent,
} from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { MxdComputeService } from './mxd-compute.service';
import {
  FieldConfig,
  FieldValidationError,
} from '../field-types/field-type';
import { getFieldType } from '../field-types/field-types.registry';
import {
  FilterGroup,
  ViewConfig,
  sanitizeViewConfig,
  validateViewConfig,
} from '../views/view-config';
import {
  compileFilter,
  orderBySpecs,
} from '../views/filter-compiler';

const RECORD_LIST_MAX = 200;
const RECORD_LIST_DEFAULT = 50;

@Injectable()
export class MxdRecordService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly viewRepo: MxdViewRepo,
    private readonly access: MxdAccessService,
    private readonly compute: MxdComputeService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // Emit a change event (awaited) so automations run synchronously within the
  // write. emitAsync resolves immediately when there are no listeners.
  private async emitChanged(
    ctx: MxdContext,
    tableId: string,
    recordId: string,
    triggerType: 'record_created' | 'record_updated',
    changedFieldIds: string[],
  ): Promise<void> {
    await this.eventEmitter.emitAsync(MXD_RECORD_CHANGED, {
      ctx,
      tableId,
      recordId,
      triggerType,
      changedFieldIds,
    } as MxdRecordChangedEvent);
  }

  // Load the table scoped to the workspace, then authorize against the table's
  // page/space — a valid table id is never sufficient on its own (§3/§5).
  private async requireTableRead(ctx: MxdContext, tableId: string) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.access.authorizeRead(ctx, table);
    return table;
  }

  private async requireTableWrite(ctx: MxdContext, tableId: string) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    await this.access.authorizeWrite(ctx, table);
    return table;
  }

  // Validate a set of client-supplied cells against the table's fields. Only
  // fields that belong to THIS table are accepted (a field id from another
  // table is rejected, not silently ignored — IDOR + integrity, roadmap §9).
  // relation/computed fields cannot be written as cells. Returns the normalized
  // { fieldId: value } map.
  private validateCells(
    fields: MxdField[],
    cells: Record<string, unknown>,
  ): Record<string, unknown> {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: Record<string, unknown> = {};
    for (const [fieldId, raw] of Object.entries(cells ?? {})) {
      const field = byId.get(fieldId);
      if (!field) {
        throw new BadRequestException(
          `Unknown field for this table: ${fieldId}`,
        );
      }
      const type = getFieldType(field.type);
      if (type.isRelation) {
        throw new BadRequestException(
          `Field ${field.name} is a relation — use the relation endpoints`,
        );
      }
      if (type.isComputed) {
        throw new BadRequestException(
          `Field ${field.name} is computed and cannot be set`,
        );
      }
      try {
        out[fieldId] = type.normalize(raw, (field.config ?? {}) as FieldConfig);
      } catch (err) {
        if (err instanceof FieldValidationError) {
          throw new BadRequestException(`${field.name}: ${err.message}`);
        }
        throw err;
      }
    }
    return out;
  }

  async createRecord(
    ctx: MxdContext,
    tableId: string,
    cells: Record<string, unknown>,
  ): Promise<MxdRecord> {
    await this.requireTableWrite(ctx, tableId);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const data = this.validateCells(fields, cells);
    const position = (await this.recordRepo.maxPosition(
      ctx.workspaceId,
      tableId,
    )) + 1;
    const record = await this.recordRepo.insert({
      tableId,
      workspaceId: ctx.workspaceId,
      data: data as any,
      position,
      version: 1,
      creatorId: ctx.userId,
      creatorGuestName: ctx.userId ? null : ctx.guestName ?? null,
      updatedById: ctx.userId,
    });
    await this.emitChanged(
      ctx,
      tableId,
      record.id,
      'record_created',
      Object.keys(data),
    );
    return record;
  }

  async getRecord(
    ctx: MxdContext,
    tableId: string,
    recordId: string,
  ): Promise<MxdRecord> {
    await this.requireTableRead(ctx, tableId);
    const record = await this.recordRepo.findById(
      ctx.workspaceId,
      tableId,
      recordId,
    );
    if (!record) throw new NotFoundException('Record not found');
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const [enriched] = await this.compute.enrich(ctx, fields, [record]);
    return enriched;
  }

  async listRecords(
    ctx: MxdContext,
    tableId: string,
    opts: { limit?: number; offset?: number },
  ): Promise<MxdRecordPage> {
    await this.requireTableRead(ctx, tableId);
    const limit = Math.min(
      Math.max(1, opts.limit ?? RECORD_LIST_DEFAULT),
      RECORD_LIST_MAX,
    );
    const offset = Math.max(0, opts.offset ?? 0);
    const page = await this.recordRepo.list(
      ctx.workspaceId,
      tableId,
      limit,
      offset,
    );
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    page.items = await this.compute.enrich(ctx, fields, page.items);
    return page;
  }

  // Query records through a view: apply the view's (or an inline) filter + sort,
  // compiled to safe parameterized SQL. A stored view's config is sanitized
  // against the current fields (a deleted field silently drops from the config)
  // so the view never breaks; an inline config is validated strictly by the
  // caller/DTO layer. Filtering/sorting is display refinement over records the
  // caller can already read — read authz is still enforced here.
  async queryRecords(
    ctx: MxdContext,
    tableId: string,
    opts: {
      viewId?: string;
      config?: ViewConfig;
      limit?: number;
      offset?: number;
    },
  ): Promise<MxdRecordPage> {
    await this.requireTableRead(ctx, tableId);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const fieldsById = new Map(fields.map((f) => [f.id, f]));

    let config: ViewConfig;
    if (opts.viewId) {
      // Stored view: sanitize against current fields so a later field deletion
      // doesn't break it (resilient, §19/§33).
      const view = await this.viewRepo.findById(
        ctx.workspaceId,
        tableId,
        opts.viewId,
      );
      if (!view) throw new NotFoundException('View not found');
      config = sanitizeViewConfig(fields, (view.config ?? {}) as ViewConfig);
    } else {
      // Inline ad-hoc config provided this request: validate strictly so a bad
      // operator/field is a clear 400, not a silently-ignored filter.
      config = validateViewConfig(fields, opts.config ?? {});
    }

    const where = config.filter
      ? compileFilter(fieldsById, config.filter)
      : null;
    const order = orderBySpecs(fieldsById, config.sorts ?? []);
    const limit = Math.min(
      Math.max(1, opts.limit ?? RECORD_LIST_DEFAULT),
      RECORD_LIST_MAX,
    );
    const offset = Math.max(0, opts.offset ?? 0);
    const page = await this.recordRepo.queryView(
      ctx.workspaceId,
      tableId,
      where,
      order,
      limit,
      offset,
    );
    page.items = await this.compute.enrich(ctx, fields, page.items);
    return page;
  }

  // Full-text-ish search over a table's records: case-insensitive substring
  // match across every text-like field (roadmap: search). Implemented by
  // constructing a validated OR-of-`contains` filter and running it through the
  // exact same injection-safe compile+query path as views — no new SQL surface.
  // Read authz is enforced; the term and field ids flow through the parameterized
  // compiler, never string-concatenated.
  async searchRecords(
    ctx: MxdContext,
    tableId: string,
    term: string,
    opts: { limit?: number; offset?: number },
  ): Promise<MxdRecordPage> {
    await this.requireTableRead(ctx, tableId);
    const limit = Math.min(
      Math.max(1, opts.limit ?? RECORD_LIST_DEFAULT),
      RECORD_LIST_MAX,
    );
    const offset = Math.max(0, opts.offset ?? 0);

    const q = (term ?? '').trim().slice(0, 500);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    // Only fields whose type supports substring matching participate; cap the
    // condition count so a very wide table can't exceed the filter bound.
    const searchable = fields
      .filter((f) => getFieldType(f.type).filterOperators.includes('contains'))
      .slice(0, 40);

    if (q === '' || searchable.length === 0) {
      return { items: [], total: 0, limit, offset };
    }

    const filter: FilterGroup = {
      combinator: 'or',
      conditions: searchable.map((f) => ({
        fieldId: f.id,
        op: 'contains',
        value: q,
      })),
    };
    const config = validateViewConfig(fields, { filter });
    const fieldsById = new Map(fields.map((f) => [f.id, f]));
    const where = compileFilter(fieldsById, config.filter!);
    const page = await this.recordRepo.queryView(
      ctx.workspaceId,
      tableId,
      where,
      [],
      limit,
      offset,
    );
    page.items = await this.compute.enrich(ctx, fields, page.items);
    return page;
  }

  // Optimistic-concurrency update. The caller passes the version it read; a
  // stale version yields a 409 rather than clobbering a newer write (§10/§18).
  async updateRecord(
    ctx: MxdContext,
    tableId: string,
    recordId: string,
    expectedVersion: number,
    cellPatch: Record<string, unknown>,
  ): Promise<MxdRecord> {
    await this.requireTableWrite(ctx, tableId);
    const current = await this.recordRepo.findById(
      ctx.workspaceId,
      tableId,
      recordId,
    );
    if (!current) throw new NotFoundException('Record not found');

    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const patch = this.validateCells(fields, cellPatch);
    const merged = { ...((current.data as object) ?? {}), ...patch };

    const updated = await this.recordRepo.updateWithVersion(
      ctx.workspaceId,
      tableId,
      recordId,
      expectedVersion,
      merged,
      ctx.userId,
    );
    if (!updated) {
      throw new ConflictException(
        'Record was modified by someone else — reload and retry',
      );
    }
    await this.emitChanged(
      ctx,
      tableId,
      recordId,
      'record_updated',
      Object.keys(patch),
    );
    return updated;
  }

  async deleteRecord(
    ctx: MxdContext,
    tableId: string,
    recordId: string,
    expectedVersion: number,
  ): Promise<void> {
    await this.requireTableWrite(ctx, tableId);
    const deleted = await this.recordRepo.softDeleteWithVersion(
      ctx.workspaceId,
      tableId,
      recordId,
      expectedVersion,
    );
    if (!deleted) {
      // Either gone already or a version race — surface a conflict so the
      // client reloads rather than assuming success.
      const exists = await this.recordRepo.findById(
        ctx.workspaceId,
        tableId,
        recordId,
      );
      if (!exists) throw new NotFoundException('Record not found');
      throw new ConflictException(
        'Record was modified by someone else — reload and retry',
      );
    }
  }

  async duplicateRecord(
    ctx: MxdContext,
    tableId: string,
    recordId: string,
  ): Promise<MxdRecord> {
    await this.requireTableWrite(ctx, tableId);
    const source = await this.recordRepo.findById(
      ctx.workspaceId,
      tableId,
      recordId,
    );
    if (!source) throw new NotFoundException('Record not found');
    const position =
      (await this.recordRepo.maxPosition(ctx.workspaceId, tableId)) + 1;
    const record = await this.recordRepo.insert({
      tableId,
      workspaceId: ctx.workspaceId,
      data: (source.data as any) ?? {},
      position,
      version: 1,
      creatorId: ctx.userId,
      creatorGuestName: ctx.userId ? null : ctx.guestName ?? null,
      updatedById: ctx.userId,
    });
    await this.emitChanged(
      ctx,
      tableId,
      record.id,
      'record_created',
      Object.keys((record.data as object) ?? {}),
    );
    return record;
  }
}
