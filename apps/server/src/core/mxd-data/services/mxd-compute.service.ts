import { Injectable } from '@nestjs/common';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdRecordLinkRepo } from '@docmost/db/repos/mxd-data/mxd-record-link.repo';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdField, MxdRecord } from '@docmost/db/types/entity.types';
import { MxdContext } from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { FieldConfig } from '../field-types/field-type';
import { getFieldType } from '../field-types/field-types.registry';
import {
  CompiledFormula,
  compileFormula,
} from '../formula/formula-engine';

// Cap the number of relation targets materialized per computed field, and the
// size of a concat rollup, so an unbounded relation fan-out can't turn a read
// into a memory bomb (§P0).
const MAX_COMPUTE_TARGETS = 1_000;
const MAX_CONCAT_LEN = 50_000;

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
    private readonly tableRepo: MxdTableRepo,
    private readonly access: MxdAccessService,
  ) {}

  async enrich(
    ctx: MxdContext,
    fields: MxdField[],
    records: MxdRecord[],
  ): Promise<MxdRecord[]> {
    const computed = fields.filter(
      (f) => f.type === 'lookup' || f.type === 'rollup',
    );
    const hasFormula = fields.some((f) => f.type === 'formula');
    if ((computed.length === 0 && !hasFormula) || records.length === 0) {
      return records;
    }

    const fieldsById = new Map(fields.map((f) => [f.id, f]));
    const recordIds = records.map((r) => r.id);
    // Cache the reader's access to each related table within this call — many
    // computed fields may share a target table.
    const readable = new Map<string, boolean>();

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

      // AUTHORIZE the related table for the CURRENT reader — a lookup/rollup
      // must not surface data from a table the reader can't access (confused
      // deputy / cross-space leak). If unreadable, yield empty (as if no links).
      if (!readable.has(relatedTableId)) {
        const relatedTable = await this.tableRepo.findById(
          ctx.workspaceId,
          relatedTableId,
        );
        readable.set(
          relatedTableId,
          relatedTable
            ? await this.access.canRead(ctx, relatedTable)
            : false,
        );
      }
      if (!readable.get(relatedTableId)) {
        for (const r of records) (r.data as any)[cf.id] = emptyVal;
        continue;
      }

      const edges = await this.linkRepo.listFromMany(
        ctx.workspaceId,
        via.id,
        recordIds,
      );
      // Cap the distinct targets we materialize (fan-out bomb guard, §P0).
      const targetIds = [...new Set(edges.map((e) => e.toRecordId))].slice(
        0,
        MAX_COMPUTE_TARGETS,
      );
      const targetSet = new Set(targetIds);
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
        const tids = (byFrom.get(r.id) ?? [])
          .filter((id) => targetSet.has(id))
          .slice(0, MAX_COMPUTE_TARGETS);
        const values = tids
          .map((id) => (targetById.get(id)?.data as any)?.[cfg.targetFieldId!])
          .filter((v) => v != null);
        (r.data as any)[cf.id] =
          cf.type === 'lookup'
            ? values
            : this.aggregate(cfg.rollup, tids.length, values);
      }
    }

    // Formulas last — they may reference cells, lookups, rollups, and each other.
    this.computeFormulas(fields, records);
    return records;
  }

  // Evaluate formula fields in dependency order with cycle detection. A cyclic
  // or broken formula yields a contained { error } value — it never throws out
  // of enrich or corrupts the table (roadmap §35).
  private computeFormulas(fields: MxdField[], records: MxdRecord[]): void {
    const formulaFields = fields.filter((f) => f.type === 'formula');
    if (formulaFields.length === 0) return;

    const compiled = new Map<string, CompiledFormula | null>();
    for (const ff of formulaFields) {
      try {
        compiled.set(
          ff.id,
          compileFormula(String((ff.config as FieldConfig)?.expression ?? '')),
        );
      } catch {
        compiled.set(ff.id, null); // invalid formula -> error state below
      }
    }

    // dependency graph among formula fields only
    const formulaIds = new Set(formulaFields.map((f) => f.id));
    const graph = new Map<string, string[]>();
    for (const ff of formulaFields) {
      const c = compiled.get(ff.id);
      graph.set(
        ff.id,
        c ? c.dependencies.filter((d) => formulaIds.has(d)) : [],
      );
    }

    // DFS topological order + cycle members (via the recursion stack)
    const color = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const cyclic = new Set<string>();
    const order: string[] = [];
    const dfs = (id: string) => {
      color.set(id, 1);
      stack.push(id);
      for (const d of graph.get(id) ?? []) {
        const c = color.get(d) ?? 0;
        if (c === 1) {
          const idx = stack.indexOf(d);
          for (let k = idx; k < stack.length; k++) cyclic.add(stack[k]);
        } else if (c === 0) {
          dfs(d);
        }
      }
      stack.pop();
      color.set(id, 2);
      order.push(id);
    };
    for (const ff of formulaFields) {
      if ((color.get(ff.id) ?? 0) === 0) dfs(ff.id);
    }

    for (const id of order) {
      const c = compiled.get(id);
      for (const r of records) {
        if (cyclic.has(id)) {
          (r.data as any)[id] = { error: 'circular reference' };
        } else if (!c) {
          (r.data as any)[id] = { error: 'invalid formula' };
        } else {
          try {
            (r.data as any)[id] = c.evaluate((r.data as any) ?? {});
          } catch (e: any) {
            (r.data as any)[id] = { error: e?.message ?? 'formula error' };
          }
        }
      }
    }
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
      case 'concat': {
        const joined = values.map((v) => String(v)).join(', ');
        return joined.length > MAX_CONCAT_LEN
          ? joined.slice(0, MAX_CONCAT_LEN)
          : joined;
      }
      default:
        // no aggregate specified → default to count of related records
        return relatedCount;
    }
  }
}
