import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdFormRepo } from '@docmost/db/repos/mxd-data/mxd-form.repo';
import { MxdField, MxdForm } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { getFieldType } from '../field-types/field-types.registry';
import { FieldConfig, FieldValidationError } from '../field-types/field-type';

const MAX_FORM_FIELDS = 50;

export interface PublicFormField {
  id: string;
  name: string;
  type: string;
  // Only the choices are exposed (for select rendering) — never other config.
  choices?: { id: string; label: string; color?: string }[];
}
export interface PublicForm {
  key: string;
  title: string;
  description: string | null;
  submitMessage: string | null;
  fields: PublicFormField[];
}

// MXD data platform — public forms. Authenticated CRUD is authorized against the
// table like the rest of the platform. The PUBLIC path (get + submit) is
// anonymous by design: an enabled form is itself the authorization to create ONE
// record using ONLY its whitelisted, settable fields — every value is validated
// by the field-type registry, unknown/computed/relation fields are rejected, and
// the record is inserted directly (never through the authenticated write path).
@Injectable()
export class MxdFormService {
  constructor(
    private readonly formRepo: MxdFormRepo,
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly access: MxdAccessService,
  ) {}

  private async requireTable(ctx: MxdContext, tableId: string, write: boolean) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    if (write) await this.access.authorizeWrite(ctx, table);
    else await this.access.authorizeRead(ctx, table);
    return table;
  }

  // fieldIds must reference settable (non-computed/relation/button) fields on the
  // table. Returns the cleaned, de-duplicated list in the caller's order.
  private validateFieldIds(fields: MxdField[], fieldIds: string[]): string[] {
    if (!Array.isArray(fieldIds) || fieldIds.length === 0) {
      throw new BadRequestException('A form needs at least one field');
    }
    if (fieldIds.length > MAX_FORM_FIELDS) {
      throw new BadRequestException(`Too many fields (max ${MAX_FORM_FIELDS})`);
    }
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: string[] = [];
    for (const id of fieldIds) {
      const f = byId.get(id);
      if (!f) throw new BadRequestException(`Unknown field: ${id}`);
      const t = getFieldType(f.type);
      if (t.isComputed || t.isRelation || f.type === 'button') {
        throw new BadRequestException(
          `Field "${f.name}" can't be collected by a form`,
        );
      }
      if (!out.includes(id)) out.push(id);
    }
    return out;
  }

  async createForm(
    ctx: MxdContext,
    tableId: string,
    input: {
      title?: string;
      description?: string;
      fieldIds: string[];
      submitMessage?: string;
      enabled?: boolean;
    },
  ): Promise<MxdForm> {
    await this.requireTable(ctx, tableId, true);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const fieldIds = this.validateFieldIds(fields, input.fieldIds);
    return this.formRepo.insert({
      workspaceId: ctx.workspaceId,
      tableId,
      key: randomBytes(9).toString('base64url'),
      title: input.title?.trim() || 'Form',
      description: input.description ?? null,
      fieldIds: fieldIds as any,
      enabled: input.enabled ?? true,
      submitMessage: input.submitMessage ?? null,
      creatorId: ctx.userId,
    });
  }

  async listForms(ctx: MxdContext, tableId: string): Promise<MxdForm[]> {
    await this.requireTable(ctx, tableId, false);
    return this.formRepo.listByTable(ctx.workspaceId, tableId);
  }

  async updateForm(
    ctx: MxdContext,
    tableId: string,
    formId: string,
    input: {
      title?: string;
      description?: string;
      fieldIds?: string[];
      submitMessage?: string;
      enabled?: boolean;
    },
  ): Promise<MxdForm> {
    await this.requireTable(ctx, tableId, true);
    const patch: any = {};
    if (input.title !== undefined) patch.title = input.title.trim() || 'Form';
    if (input.description !== undefined) patch.description = input.description;
    if (input.submitMessage !== undefined) patch.submitMessage = input.submitMessage;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.fieldIds !== undefined) {
      const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
      patch.fieldIds = this.validateFieldIds(fields, input.fieldIds);
    }
    const updated = await this.formRepo.update(
      ctx.workspaceId,
      tableId,
      formId,
      patch,
    );
    if (!updated) throw new NotFoundException('Form not found');
    return updated;
  }

  async deleteForm(ctx: MxdContext, tableId: string, formId: string): Promise<void> {
    await this.requireTable(ctx, tableId, true);
    const form = await this.formRepo.findById(ctx.workspaceId, tableId, formId);
    if (!form) throw new NotFoundException('Form not found');
    await this.formRepo.delete(ctx.workspaceId, tableId, formId);
  }

  // ---- public (anonymous)

  private async loadEnabledForm(key: string): Promise<{ form: MxdForm; fields: MxdField[] }> {
    const form = await this.formRepo.findByKey(key);
    // A disabled or missing form is indistinguishable to the public (404).
    if (!form || !form.enabled) throw new NotFoundException('Form not found');
    const fields = await this.fieldRepo.listByTable(form.workspaceId, form.tableId);
    return { form, fields };
  }

  async getPublicForm(key: string): Promise<PublicForm> {
    const { form, fields } = await this.loadEnabledForm(key);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const formFields: PublicFormField[] = [];
    for (const id of (form.fieldIds as string[]) ?? []) {
      const f = byId.get(id);
      if (!f) continue; // a deleted field silently drops from the form
      const cfg = (f.config ?? {}) as FieldConfig & { choices?: any };
      formFields.push({
        id: f.id,
        name: f.name,
        type: f.type,
        choices: cfg.choices,
      });
    }
    return {
      key: form.key,
      title: form.title,
      description: form.description,
      submitMessage: form.submitMessage,
      fields: formFields,
    };
  }

  async submitForm(
    key: string,
    values: Record<string, unknown>,
  ): Promise<{ success: true }> {
    const { form, fields } = await this.loadEnabledForm(key);
    const allowed = new Set((form.fieldIds as string[]) ?? []);
    const byId = new Map(fields.map((f) => [f.id, f]));

    const data: Record<string, unknown> = {};
    for (const [fieldId, raw] of Object.entries(values ?? {})) {
      if (!allowed.has(fieldId)) {
        throw new BadRequestException(`Field not on this form: ${fieldId}`);
      }
      const field = byId.get(fieldId);
      if (!field) continue;
      const type = getFieldType(field.type);
      if (type.isComputed || type.isRelation || field.type === 'button') {
        throw new BadRequestException(`Field ${field.name} can't be set`);
      }
      try {
        data[fieldId] = type.normalize(raw, (field.config ?? {}) as FieldConfig);
      } catch (err) {
        if (err instanceof FieldValidationError) {
          throw new BadRequestException(`${field.name}: ${err.message}`);
        }
        throw err;
      }
    }

    const position =
      (await this.recordRepo.maxPosition(form.workspaceId, form.tableId)) + 1;
    // Inserted directly (not through the authenticated write path): the enabled
    // form is the authorization, and only its validated fields are written.
    await this.recordRepo.insert({
      tableId: form.tableId,
      workspaceId: form.workspaceId,
      data: data as any,
      position,
      version: 1,
      creatorId: null,
      creatorGuestName: 'Form',
      updatedById: null,
    });
    return { success: true };
  }
}
