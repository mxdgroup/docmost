import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdFormRepo } from '@docmost/db/repos/mxd-data/mxd-form.repo';
import { MxdField, MxdForm, MxdTable } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { MxdRecordService } from './mxd-record.service';
import { getFieldType } from '../field-types/field-types.registry';
import { FieldConfig } from '../field-types/field-type';

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
// anonymous by design: an enabled form (plus the workspace/space public-sharing
// kill switch — same gate as mxd-public-data.service.ts) is itself the
// authorization to create ONE record using ONLY its whitelisted, settable
// fields. The write itself goes through MxdRecordService#createFromTrustedSource
// — the SAME validation + insert + history + record_created automation dispatch
// as every other create — so a form submission has intentional parity with a
// normal write. Only the table's page/space authorizeWrite check is skipped
// (the form + its sharing gate is the authorization instead).
@Injectable()
export class MxdFormService {
  constructor(
    private readonly formRepo: MxdFormRepo,
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly access: MxdAccessService,
    private readonly recordService: MxdRecordService,
    private readonly shareRepo: ShareRepo,
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

  private async loadEnabledForm(
    key: string,
  ): Promise<{ form: MxdForm; fields: MxdField[]; table: MxdTable }> {
    const form = await this.formRepo.findByKey(key);
    // A disabled or missing form is indistinguishable to the public (404).
    if (!form || !form.enabled) throw new NotFoundException('Form not found');
    const table = await this.tableRepo.findById(form.workspaceId, form.tableId);
    if (!table) throw new NotFoundException('Form not found');
    // Respect the workspace/space public-sharing kill switch — the same gate
    // the public-data path enforces (mxd-public-data.service.ts). A form is a
    // public-facing surface too: disabling public sharing must disable it.
    const allowed = await this.shareRepo.isSharingAllowed(
      table.workspaceId,
      table.spaceId,
    );
    if (!allowed) throw new NotFoundException('Form not found');
    const fields = await this.fieldRepo.listByTable(form.workspaceId, form.tableId);
    return { form, fields, table };
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

    // Whitelist enforcement stays form-specific: only values for fields the
    // form actually collects are allowed through, whether or not the field
    // still exists (a deleted field silently drops). Per-value validation
    // (unknown-for-table, computed/relation/button rejection, type
    // normalization) is NOT duplicated here — createFromTrustedSource runs the
    // exact same validateCells the authenticated write path uses.
    const cells: Record<string, unknown> = {};
    for (const [fieldId, raw] of Object.entries(values ?? {})) {
      if (!allowed.has(fieldId)) {
        throw new BadRequestException(`Field not on this form: ${fieldId}`);
      }
      if (!byId.has(fieldId)) continue;
      cells[fieldId] = raw;
    }

    // Anonymous trusted-source context: the enabled form + the sharing kill
    // switch (checked in loadEnabledForm) is the authorization. Routing
    // through MxdRecordService gives the submission the same history row and
    // record_created automation dispatch as every other create.
    const anonCtx: MxdContext = {
      workspaceId: form.workspaceId,
      userId: null,
      guestName: 'Form',
    };
    await this.recordService.createFromTrustedSource(
      anonCtx,
      form.tableId,
      cells,
    );
    return { success: true };
  }
}
