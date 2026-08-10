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
import { MxdField, MxdRecord } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import {
  FieldConfig,
  FieldValidationError,
} from '../field-types/field-type';
import { getFieldType } from '../field-types/field-types.registry';

const RECORD_LIST_MAX = 200;
const RECORD_LIST_DEFAULT = 50;

@Injectable()
export class MxdRecordService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly access: MxdAccessService,
  ) {}

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
    return this.recordRepo.insert({
      tableId,
      workspaceId: ctx.workspaceId,
      data: data as any,
      position,
      version: 1,
      creatorId: ctx.userId,
      creatorGuestName: ctx.userId ? null : ctx.guestName ?? null,
      updatedById: ctx.userId,
    });
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
    return record;
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
    return this.recordRepo.list(ctx.workspaceId, tableId, limit, offset);
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
    return this.recordRepo.insert({
      tableId,
      workspaceId: ctx.workspaceId,
      data: (source.data as any) ?? {},
      position,
      version: 1,
      creatorId: ctx.userId,
      creatorGuestName: ctx.userId ? null : ctx.guestName ?? null,
      updatedById: ctx.userId,
    });
  }
}
