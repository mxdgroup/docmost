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
// Hard cap on outgoing edges per (relation field, source record). Bounds the
// fan-out that lookup/rollup compute must materialize on every read (§P0).
const MAX_RELATION_EDGES = 10_000;

@Injectable()
export class MxdRelationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
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

    // Serialize concurrent links for this (field, fromRecord) with a
    // transaction-scoped advisory lock, so the single-relation replace and the
    // fan-out cap are race-free (two concurrent links can't both see 0 edges
    // and both insert).
    return this.db.transaction().execute(async (trx) => {
      await this.linkRepo.lockRelation(input.fieldId, input.fromRecordId, trx);

      const existing = await this.linkRepo.listFrom(
        ctx.workspaceId,
        input.fieldId,
        input.fromRecordId,
        trx,
      );
      if (config.single) {
        // one-to-* : replace any existing outgoing edge for this field.
        for (const e of existing) {
          await this.linkRepo.deleteEdge(
            ctx.workspaceId,
            input.fieldId,
            e.fromRecordId,
            e.toRecordId,
            trx,
          );
        }
      } else if (
        existing.length >= MAX_RELATION_EDGES &&
        !existing.some((e) => e.toRecordId === input.toRecordId)
      ) {
        throw new BadRequestException(
          `A record can have at most ${MAX_RELATION_EDGES} links on one relation`,
        );
      }

      await this.linkRepo.insert(
        {
          workspaceId: ctx.workspaceId,
          fieldId: input.fieldId,
          fromRecordId: input.fromRecordId,
          toRecordId: input.toRecordId,
        },
        trx,
      );
      return { success: true };
    });
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
    // Batch-fetch targets (one query) instead of N+1 findById per edge, and
    // preserve edge order.
    const toIds = edges.map((e) => e.toRecordId);
    const targets = await this.recordRepo.findByIds(
      ctx.workspaceId,
      relatedTable.id,
      toIds,
    );
    const byId = new Map(targets.map((t) => [t.id, t]));
    const out: MxdRecord[] = [];
    for (const id of toIds) {
      const rec = byId.get(id);
      if (rec) out.push(rec);
    }
    return out;
  }
}
