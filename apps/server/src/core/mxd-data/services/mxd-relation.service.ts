import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdRecordLinkRepo } from '@docmost/db/repos/mxd-data/mxd-record-link.repo';
import { MxdRecord } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { FieldConfig } from '../field-types/field-type';
import { getFieldType } from '../field-types/field-types.registry';

// MXD data platform — relations (roadmap §7/§30-32). Edges are true rows in
// mxd_record_links, never text labels. Security invariants:
//   - the source table requires WRITE authz; the TARGET table requires READ
//     authz (you can only link to records you may see) — so a relation can't be
//     used to reach records in a table the caller can't read;
//   - both endpoints are resolved from the DB within the caller's workspace, so
//     an edge can never span tenants or point at a non-existent/foreign record
//     (a client-supplied record id is never trusted on its own).
@Injectable()
export class MxdRelationService {
  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly linkRepo: MxdRecordLinkRepo,
    private readonly access: MxdAccessService,
  ) {}

  // Resolve the relation field + its target table, enforcing authz:
  // WRITE on the source table (for a mutating op) or READ (for a read op), and
  // READ on the target table either way.
  private async resolveRelation(
    ctx: MxdContext,
    tableId: string,
    fieldId: string,
    write: boolean,
  ) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    if (write) await this.access.authorizeWrite(ctx, table);
    else await this.access.authorizeRead(ctx, table);

    const field = await this.fieldRepo.findById(
      ctx.workspaceId,
      tableId,
      fieldId,
    );
    if (!field) throw new NotFoundException('Field not found');
    if (!getFieldType(field.type).isRelation) {
      throw new BadRequestException('Field is not a relation');
    }
    const config = (field.config ?? {}) as FieldConfig;
    if (!config.relatedTableId) {
      throw new BadRequestException('Relation field has no related table');
    }
    const relatedTable = await this.tableRepo.findById(
      ctx.workspaceId,
      config.relatedTableId,
    );
    if (!relatedTable) {
      throw new BadRequestException('Related table not found');
    }
    // You may only traverse into a target table you can READ (§31/§32).
    await this.access.authorizeRead(ctx, relatedTable);
    return { table, field, config, relatedTable };
  }

  async link(
    ctx: MxdContext,
    input: {
      tableId: string;
      fieldId: string;
      fromRecordId: string;
      toRecordId: string;
    },
  ): Promise<{ success: true }> {
    const { config, relatedTable } = await this.resolveRelation(
      ctx,
      input.tableId,
      input.fieldId,
      true,
    );
    const from = await this.recordRepo.findById(
      ctx.workspaceId,
      input.tableId,
      input.fromRecordId,
    );
    if (!from) throw new NotFoundException('Source record not found');
    // Target must exist IN the related table (not just any workspace record) —
    // this is the IDOR gate: a foreign/hidden record id resolves to undefined.
    const to = await this.recordRepo.findById(
      ctx.workspaceId,
      relatedTable.id,
      input.toRecordId,
    );
    if (!to) throw new BadRequestException('Target record not found');

    // one-to-* (single): replace any existing outgoing edge for this field.
    if (config.single) {
      const existing = await this.linkRepo.listFrom(
        ctx.workspaceId,
        input.fieldId,
        input.fromRecordId,
      );
      for (const e of existing) {
        await this.linkRepo.deleteEdge(
          ctx.workspaceId,
          input.fieldId,
          e.fromRecordId,
          e.toRecordId,
        );
      }
    }

    await this.linkRepo.insert({
      workspaceId: ctx.workspaceId,
      fieldId: input.fieldId,
      fromRecordId: input.fromRecordId,
      toRecordId: input.toRecordId,
    });
    return { success: true };
  }

  async unlink(
    ctx: MxdContext,
    input: {
      tableId: string;
      fieldId: string;
      fromRecordId: string;
      toRecordId: string;
    },
  ): Promise<{ success: true }> {
    await this.resolveRelation(ctx, input.tableId, input.fieldId, true);
    await this.linkRepo.deleteEdge(
      ctx.workspaceId,
      input.fieldId,
      input.fromRecordId,
      input.toRecordId,
    );
    return { success: true };
  }

  // List the records related to a source record through a relation field. Only
  // returns targets that still resolve in the (readable) related table.
  async listRelated(
    ctx: MxdContext,
    input: { tableId: string; fieldId: string; recordId: string },
  ): Promise<MxdRecord[]> {
    const { relatedTable } = await this.resolveRelation(
      ctx,
      input.tableId,
      input.fieldId,
      false,
    );
    const edges = await this.linkRepo.listFrom(
      ctx.workspaceId,
      input.fieldId,
      input.recordId,
    );
    const out: MxdRecord[] = [];
    for (const e of edges) {
      const rec = await this.recordRepo.findById(
        ctx.workspaceId,
        relatedTable.id,
        e.toRecordId,
      );
      if (rec) out.push(rec);
    }
    return out;
  }
}
