import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdField } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { FieldConfig, FieldValidationError } from '../field-types/field-type';
import {
  getFieldType,
  isKnownFieldType,
} from '../field-types/field-types.registry';

@Injectable()
export class MxdFieldService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
  ) {}

  private async requireTable(ctx: MxdContext, tableId: string) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  private async requireField(ctx: MxdContext, tableId: string, fieldId: string) {
    const field = await this.fieldRepo.findById(
      ctx.workspaceId,
      tableId,
      fieldId,
    );
    if (!field) throw new NotFoundException('Field not found');
    return field;
  }

  async listFields(ctx: MxdContext, tableId: string): Promise<MxdField[]> {
    await this.requireTable(ctx, tableId);
    return this.fieldRepo.listByTable(ctx.workspaceId, tableId);
  }

  async addField(
    ctx: MxdContext,
    tableId: string,
    input: { name: string; type: string; config?: FieldConfig },
  ): Promise<MxdField> {
    await this.requireTable(ctx, tableId);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Field name is required');
    if (!isKnownFieldType(input.type)) {
      throw new BadRequestException(`Unknown field type: ${input.type}`);
    }
    const existing = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException(`A field named "${name}" already exists`);
    }
    const position =
      (await this.fieldRepo.maxPosition(ctx.workspaceId, tableId)) + 1;
    return this.fieldRepo.insert({
      tableId,
      workspaceId: ctx.workspaceId,
      name,
      type: input.type,
      config: (input.config ?? {}) as any,
      position,
    });
  }

  async renameField(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    name: string,
  ): Promise<MxdField> {
    await this.requireTable(ctx, tableId);
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('Field name is required');
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    if (!fields.some((f) => f.id === fieldId)) {
      throw new NotFoundException('Field not found');
    }
    if (
      fields.some(
        (f) => f.id !== fieldId && f.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      throw new BadRequestException(`A field named "${trimmed}" already exists`);
    }
    // Only the display name changes — the field id (cell key) is stable, so no
    // record is rewritten and formulas/filters/views keep working (roadmap §8).
    const updated = await this.fieldRepo.update(ctx.workspaceId, tableId, fieldId, {
      name: trimmed,
    });
    if (!updated) throw new NotFoundException('Field not found');
    return updated;
  }

  async reorderField(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    position: number,
  ): Promise<MxdField> {
    await this.requireField(ctx, tableId, fieldId);
    const updated = await this.fieldRepo.update(ctx.workspaceId, tableId, fieldId, {
      position,
    });
    if (!updated) throw new NotFoundException('Field not found');
    return updated;
  }

  async updateConfig(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    config: FieldConfig,
  ): Promise<MxdField> {
    await this.requireField(ctx, tableId, fieldId);
    const updated = await this.fieldRepo.update(ctx.workspaceId, tableId, fieldId, {
      config: (config ?? {}) as any,
    });
    if (!updated) throw new NotFoundException('Field not found');
    return updated;
  }

  // Type conversion (roadmap §7). Re-normalize every existing cell under the new
  // type. Safe values convert; incompatible ones are REFUSED unless the caller
  // explicitly opts to clear them — never silently discarded. Converting to a
  // relation/computed type drops the stored cell values by definition, so it
  // also requires the explicit clear flag.
  async changeType(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    newType: string,
    opts: { clearIncompatible?: boolean; config?: FieldConfig } = {},
  ): Promise<MxdField> {
    await this.requireTable(ctx, tableId);
    const field = await this.requireField(ctx, tableId, fieldId);
    if (!isKnownFieldType(newType)) {
      throw new BadRequestException(`Unknown field type: ${newType}`);
    }
    const target = getFieldType(newType);
    const config = (opts.config ?? field.config ?? {}) as FieldConfig;
    const records = await this.recordRepo.allForTable(ctx.workspaceId, tableId);

    // Cell-less target (relation/computed): values are dropped by definition.
    if (target.isRelation || target.isComputed) {
      const hasValues = records.some(
        (r) => (r.data as any)?.[fieldId] != null,
      );
      if (hasValues && !opts.clearIncompatible) {
        throw new BadRequestException(
          `Converting to ${newType} discards all existing values in this field — retry with clearIncompatible to confirm`,
        );
      }
      return this.db.transaction().execute(async (trx) => {
        await this.recordRepo.stripField(ctx.workspaceId, tableId, fieldId, trx);
        const updated = await this.fieldRepo.update(
          ctx.workspaceId,
          tableId,
          fieldId,
          { type: newType, config: config as any },
          trx,
        );
        if (!updated) throw new NotFoundException('Field not found');
        return updated;
      });
    }

    // Scalar target: attempt to re-normalize each cell; collect incompatibles.
    const converted: { id: string; value: unknown }[] = [];
    const incompatible: string[] = [];
    for (const r of records) {
      const raw = (r.data as any)?.[fieldId];
      if (raw == null) continue;
      try {
        converted.push({ id: r.id, value: target.normalize(raw, config) });
      } catch (err) {
        if (err instanceof FieldValidationError) incompatible.push(r.id);
        else throw err;
      }
    }
    if (incompatible.length > 0 && !opts.clearIncompatible) {
      throw new BadRequestException(
        `${incompatible.length} value(s) cannot convert to ${newType} — retry with clearIncompatible to clear them, or fix the values first`,
      );
    }

    return this.db.transaction().execute(async (trx) => {
      for (const c of converted) {
        const rec = records.find((r) => r.id === c.id)!;
        await this.recordRepo.replaceData(
          ctx.workspaceId,
          tableId,
          c.id,
          { ...((rec.data as object) ?? {}), [fieldId]: c.value },
          trx,
        );
      }
      if (opts.clearIncompatible) {
        for (const id of incompatible) {
          const rec = records.find((r) => r.id === id)!;
          const next = { ...((rec.data as object) ?? {}) };
          delete (next as any)[fieldId];
          await this.recordRepo.replaceData(
            ctx.workspaceId,
            tableId,
            id,
            next,
            trx,
          );
        }
      }
      const updated = await this.fieldRepo.update(
        ctx.workspaceId,
        tableId,
        fieldId,
        { type: newType, config: config as any },
        trx,
      );
      if (!updated) throw new NotFoundException('Field not found');
      return updated;
    });
  }

  // Delete policy (roadmap §12): values are REMOVED from every record's jsonb so
  // deleted-field data can never resurface via API/export/formula. Relation
  // edges cascade via the FK. If the primary field is deleted, promote the next
  // field (or null).
  async deleteField(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
  ): Promise<void> {
    const table = await this.requireTable(ctx, tableId);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    if (!fields.some((f) => f.id === fieldId)) {
      throw new NotFoundException('Field not found');
    }
    await this.db.transaction().execute(async (trx) => {
      await this.recordRepo.stripField(ctx.workspaceId, tableId, fieldId, trx);
      await this.fieldRepo.delete(ctx.workspaceId, tableId, fieldId, trx);
      if (table.primaryFieldId === fieldId) {
        const next = fields.find((f) => f.id !== fieldId);
        await this.tableRepo.update(
          ctx.workspaceId,
          tableId,
          { primaryFieldId: next?.id ?? null },
          trx,
        );
      }
    });
  }
}
