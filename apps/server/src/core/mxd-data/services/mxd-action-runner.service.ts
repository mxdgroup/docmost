import { Injectable } from '@nestjs/common';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import { MxdRecordRepo } from '@docmost/db/repos/mxd-data/mxd-record.repo';
import { MxdContext } from '../mxd-context';
import { MxdRecordService } from './mxd-record.service';
import { ButtonAction } from '../buttons/button-config';

export interface ActionRunResult {
  directives: { type: string; [k: string]: unknown }[];
}

// MXD data platform — shared executor for declarative actions (buttons §37 and
// automations §39). Applies cell mutations in one optimistic-concurrency-checked
// update and runs createRecord through the record service (so its validation +
// authz + change events apply). NO arbitrary code — only the fixed action shapes.
//
// no-op cells are skipped: a setField that would write the value already present
// produces no write and therefore no change event — which prevents an automation
// whose action sets the same field it triggers on from looping.
@Injectable()
export class MxdActionRunner {
  constructor(
    private readonly fieldRepo: MxdFieldRepo,
    private readonly recordRepo: MxdRecordRepo,
    private readonly recordService: MxdRecordService,
  ) {}

  async run(
    ctx: MxdContext,
    tableId: string,
    recordId: string,
    actions: ButtonAction[],
    opts: { allowOpenUrl?: boolean } = {},
  ): Promise<ActionRunResult> {
    const record = await this.recordRepo.findById(
      ctx.workspaceId,
      tableId,
      recordId,
    );
    if (!record) return { directives: [] };
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const fieldsById = new Map(fields.map((f) => [f.id, f]));
    const current = (record.data as any) ?? {};

    const directives: ActionRunResult['directives'] = [];
    const patch: Record<string, unknown> = {};

    // DEFINED MULTI-ACTION SEMANTICS: cell mutations (setField/clearField/
    // setNow) accumulate into ONE patch applied after the loop, so they commit
    // together. createRecord actions apply in order and each commits as its own
    // atomic row write; if a later action throws, earlier spawned rows remain
    // and the caller records the rule as an error. This is the v1 contract —
    // cell writes atomic, cross-record spawns best-effort in-order. (A full
    // multi-record transaction is deferred; noted in MXD-FORK.md.)
    const budget = ctx.automationBudget;

    for (const action of actions) {
      switch (action.type) {
        case 'setField':
          if (current[action.fieldId] !== action.value) {
            patch[action.fieldId] = action.value;
          }
          break;
        case 'clearField':
          if (current[action.fieldId] != null) patch[action.fieldId] = null;
          break;
        case 'setNow': {
          const f = fieldsById.get(action.fieldId);
          const iso = new Date().toISOString();
          patch[action.fieldId] = f?.type === 'date' ? iso.slice(0, 10) : iso;
          break;
        }
        case 'createRecord':
          // Fan-out breadth guard: each spawned record spends one unit of the
          // shared root-event budget. When it's exhausted the cascade stops
          // spawning — this is what bounds N^depth amplification.
          if (budget) {
            if (budget.remaining <= 0) break;
            budget.remaining -= 1;
          }
          await this.recordService.createRecord(ctx, tableId, action.cells);
          break;
        case 'openUrl':
          if (opts.allowOpenUrl) {
            directives.push({ type: 'openUrl', url: action.url });
          }
          break;
      }
    }

    if (Object.keys(patch).length > 0) {
      // A cell-patch update re-emits a change event and can re-trigger rules,
      // so it also spends one budget unit — keeping total writes bounded.
      if (budget) {
        if (budget.remaining <= 0) return { directives };
        budget.remaining -= 1;
      }
      await this.recordService.updateRecord(
        ctx,
        tableId,
        recordId,
        record.version,
        patch,
      );
    }
    return { directives };
  }
}
