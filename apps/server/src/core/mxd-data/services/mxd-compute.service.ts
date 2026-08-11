import { Injectable } from '@nestjs/common';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdRecordLinkRepo } from '@docmost/db/repos/mxd-data/mxd-record-link.repo';
import { MxdField, MxdRecord } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { FieldConfig } from '../field-types/field-type';
import { getFieldType } from '../field-types/field-types.registry';

// MXD data platform — computed cells: lookups + rollups (roadmap §8/§33).
// Derived on READ and merged transiently into record.data (never persisted), so
// values are always fresh — no stale cached rollups. Batched across the record
// set (one edge query + one target-fetch per computed field) to avoid N+1.
//
// A lookup field pulls a target field's value(s) across a relation; a rollup
// aggregates them (count/sum/avg/min/max/concat). Config:
//   { viaFieldId: <relation field on this table>, targetFieldId: <field on the
//     related table>, rollup?: 'count'|'sum'|'avg'|'min'|'max'|'concat' }
@Injectable()
export class MxdComputeService {
  constructor(
    private readonly recordRepo: MxdRecordRepo,
    private readonly linkRepo: MxdRecordLinkRepo,
  ) {}

  async enrich(
    ctx: MxdContext,
    fields: MxdField[],
    records: MxdRecord[],
  ): Promise<MxdRecord[]> {
    const computed = fields.filter(
      (f) => f.type === 'lookup' || f.type === 'rollup',
    );
    if (computed.length === 0 || records.length === 0) return records;

    const fieldsById = new Map(fields.map((f) => [f.id, f]));
    const recordIds = records.map((r) => r.id);

    for (const cf of computed) {
      const cfg = (cf.config ?? {}) as FieldConfig;
      const via = cfg.viaFieldId ? fieldsById.get(cfg.viaFieldId) : undefined;
      const emptyVal = cf.type === 'rollup' ? null : [];

      if (
        !via ||
        !getFieldType(via.type).isRelation ||
        !cfg.targetFieldId ||
        !(via.config as FieldConfig)?.relatedTableId
      ) {
        for (const r of records) (r.data as any)[cf.id] = emptyVal;
        continue;
      }

      const relatedTableId = (via.config as FieldConfig).relatedTableId!;
      const edges = await this.linkRepo.listFromMany(
        ctx.workspaceId,
        via.id,
        recordIds,
      );
      const targetIds = [...new Set(edges.map((e) => e.toRecordId))];
      const targets = await this.recordRepo.findByIds(
        ctx.workspaceId,
        relatedTableId,
        targetIds,
      );
      const targetById = new Map(targets.map((t) => [t.id, t]));

      const byFrom = new Map<string, string[]>();
      for (const e of edges) {
        const arr = byFrom.get(e.fromRecordId) ?? [];
        arr.push(e.toRecordId);
        byFrom.set(e.fromRecordId, arr);
      }

      for (const r of records) {
        const tids = byFrom.get(r.id) ?? [];
        const values = tids
          .map((id) => (targetById.get(id)?.data as any)?.[cfg.targetFieldId!])
          .filter((v) => v != null);
        (r.data as any)[cf.id] =
          cf.type === 'lookup'
            ? values
            : this.aggregate(cfg.rollup, tids.length, values);
      }
    }
    return records;
  }

  private aggregate(
    op: FieldConfig['rollup'] | undefined,
    relatedCount: number,
    values: unknown[],
  ): unknown {
    const nums = values
      .map((v) => (typeof v === 'number' ? v : Number(v)))
      .filter((n) => Number.isFinite(n)) as number[];
    switch (op) {
      case 'count':
        return relatedCount;
      case 'sum':
        return nums.reduce((a, b) => a + b, 0);
      case 'avg':
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      case 'min':
        return nums.length ? Math.min(...nums) : null;
      case 'max':
        return nums.length ? Math.max(...nums) : null;
      case 'concat':
        return values.map((v) => String(v)).join(', ');
      default:
        // no aggregate specified → default to count of related records
        return relatedCount;
    }
  }
}
