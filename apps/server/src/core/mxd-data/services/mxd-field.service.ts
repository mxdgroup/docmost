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
import { MxdAccessService } from '../mxd-access.service';
import { FieldConfig, FieldValidationError } from '../field-types/field-type';
import {
  getFieldType,
  isKnownFieldType,
} from '../field-types/field-types.registry';
import { compileFormula } from '../formula/formula-engine';

@Injectable()
export class MxdFieldService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly access: MxdAccessService,
  ) {}

  // Load the table scoped to the workspace, then authorize against its
  // page/space. Field mutations are schema changes → require edit (write).
  private async requireTable(ctx: MxdContext, tableId: string, write: boolean) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    if (write) await this.access.authorizeWrite(ctx, table);
    else await this.access.authorizeRead(ctx, table);
    return table;
  }

  private async requireField(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    write: boolean,
  ) {
    await this.requireTable(ctx, tableId, write);
    const field = await this.fieldRepo.findById(
      ctx.workspaceId,
      tableId,
      fieldId,
    );
    if (!field) throw new NotFoundException('Field not found');
    return field;
  }

  // Per-type config validation. For a relation field the related table must be a
  // real table in the caller's workspace (never a client-asserted foreign id).
  private async validateTypeConfig(
    ctx: MxdContext,
    type: string,
    config: FieldConfig | undefined,
  ): Promise<void> {
    if (type === 'relation') {
      const relatedTableId = (config ?? {}).relatedTableId;
      if (!relatedTableId || typeof relatedTableId !== 'string') {
        throw new BadRequestException(
          'A relation field requires a relatedTableId',
        );
      }
      const related = await this.tableRepo.findById(
        ctx.workspaceId,
        relatedTableId,
      );
      if (!related) {
        throw new BadRequestException('Related table not found in workspace');
      }
    }
    if (type === 'formula') {
      const expr = (config ?? {}).expression;
      if (!expr || typeof expr !== 'string') {
        throw new BadRequestException('A formula field requires an expression');
      }
      try {
        compileFormula(expr);
      } catch (e: any) {
        throw new BadRequestException(`Invalid formula: ${e?.message ?? 'parse error'}`);
      }
    }
  }

  async listFields(ctx: MxdContext, tableId: string): Promise<MxdField[]> {
    await this.requireTable(ctx, tableId, false);
    return this.fieldRepo.listByTable(ctx.workspaceId, tableId);
  }

  async addField(
    ctx: MxdContext,
    tableId: string,
    input: { name: string; type: string; config?: FieldConfig },
  ): Promise<MxdField> {
    await this.requireTable(ctx, tableId, true);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('Field name is required');
    if (!isKnownFieldType(input.type)) {
      throw new BadRequestException(`Unknown field type: ${input.type}`);
    }
    const existing = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    if (existing.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      throw new BadRequestException(`A field named "${name}" already exists`);
    }
    await this.validateTypeConfig(ctx, input.type, input.config);
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
    await this.requireTable(ctx, tableId, true);
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
    await this.requireField(ctx, tableId, fieldId, true);
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
    const field = await this.requireField(ctx, tableId, fieldId, true);
    // Re-validate per-type config on UPDATE, not just at creation — otherwise a
    // relation field's relatedTableId could be silently repointed to any table
    // (incl. one the owner can't read), and a formula could be set to garbage.
    await this.validateTypeConfig(ctx, field.type, config);
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
    const field = await this.requireField(ctx, tableId, fieldId, true);
    if (!isKnownFieldType(newType)) {
      throw new BadRequestException(`Unknown field type: ${newType}`);
    }
    const target = getFieldType(newType);
    const config = (opts.config ?? field.config ?? {}) as FieldConfig;
    // Validate the target type's config (relation relatedTableId, formula expr).
    await this.validateTypeConfig(ctx, newType, config);

    // Read AND write in ONE transaction with the rows locked (FOR UPDATE), so a
    // concurrent updateRecord can't interleave a change that a later replaceData
    // would silently clobber (§P1 lost-update).
    return this.db.transaction().execute(async (trx) => {
      const records = await this.recordRepo.allForTable(
        ctx.workspaceId,
        tableId,
        trx,
        true,
      );
      const byId = new Map(records.map((r) => [r.id, r]));

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
      }

      // Scalar target: re-normalize each cell; collect incompatibles.
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

      for (const c of converted) {
        const rec = byId.get(c.id)!;
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
          const rec = byId.get(id)!;
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
    const table = await this.requireTable(ctx, tableId, true);
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
