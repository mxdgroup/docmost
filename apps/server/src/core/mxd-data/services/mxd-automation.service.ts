import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MxdTableRepo } from '@docmost/db/repos/mxd-data/mxd-table.repo';
import { MxdFieldRepo } from '@docmost/db/repos/mxd-data/mxd-field.repo';
import {
  MxdAutomationRuleRepo,
  MxdAutomationRunRepo,
} from '@docmost/db/repos/mxd-data/mxd-automation.repo';
import { MxdAutomationRule } from '@docmost/db/types/entity.types';
import {
  MxdContext,
  MXD_RECORD_CHANGED,
  MxdRecordChangedEvent,
} from '../mxd-context';
import { MxdAccessService } from '../mxd-access.service';
import { MxdActionRunner } from './mxd-action-runner.service';
import { validateButtonConfig, ButtonAction } from '../buttons/button-config';

const TRIGGER_TYPES = ['record_created', 'record_updated', 'field_changed'];
// Loop guard (roadmap §40): an automation-triggered write increments the chain
// depth; once it reaches the cap the executor stops, so A→B→A can't run forever.
const MAX_AUTOMATION_DEPTH = 5;

interface AutomationTrigger {
  type: string;
  fieldId?: string;
}

// MXD data platform — automations (roadmap §39-40). Rules (trigger → actions) are
// managed via CRUD; the executor is a DECOUPLED @OnEvent listener on the record
// service's change event, so there's no circular dependency and each rule's
// failure is isolated + logged (never fails the user's write).
@Injectable()
export class MxdAutomationService {
  private readonly logger = new Logger(MxdAutomationService.name);

  constructor(
    private readonly tableRepo: MxdTableRepo,
    private readonly fieldRepo: MxdFieldRepo,
    private readonly ruleRepo: MxdAutomationRuleRepo,
    private readonly runRepo: MxdAutomationRunRepo,
    private readonly access: MxdAccessService,
    private readonly actionRunner: MxdActionRunner,
  ) {}

  private async requireTable(ctx: MxdContext, tableId: string, write: boolean) {
    const table = await this.tableRepo.findById(ctx.workspaceId, tableId);
    if (!table) throw new NotFoundException('Table not found');
    if (write) await this.access.authorizeWrite(ctx, table);
    else await this.access.authorizeRead(ctx, table);
    return table;
  }

  private validateTrigger(
    fields: { id: string }[],
    trigger: AutomationTrigger | undefined,
  ): void {
    if (!trigger || !TRIGGER_TYPES.includes(trigger.type)) {
      throw new BadRequestException(
        `Trigger type must be one of: ${TRIGGER_TYPES.join(', ')}`,
      );
    }
    if (trigger.type === 'field_changed') {
      if (!trigger.fieldId || !fields.some((f) => f.id === trigger.fieldId)) {
        throw new BadRequestException(
          'field_changed trigger requires a valid fieldId',
        );
      }
    }
  }

  async createRule(
    ctx: MxdContext,
    tableId: string,
    input: {
      name?: string;
      trigger: AutomationTrigger;
      actions: ButtonAction[];
      enabled?: boolean;
    },
  ): Promise<MxdAutomationRule> {
    await this.requireTable(ctx, tableId, true);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    this.validateTrigger(fields, input.trigger);
    validateButtonConfig(fields, { actions: input.actions });
    return this.ruleRepo.insert({
      workspaceId: ctx.workspaceId,
      tableId,
      name: input.name?.trim() || 'Automation',
      enabled: input.enabled ?? true,
      trigger: input.trigger as any,
      actions: input.actions as any,
      creatorId: ctx.userId,
    });
  }

  async listRules(ctx: MxdContext, tableId: string): Promise<MxdAutomationRule[]> {
    await this.requireTable(ctx, tableId, false);
    return this.ruleRepo.listByTable(ctx.workspaceId, tableId);
  }

  async updateRule(
    ctx: MxdContext,
    tableId: string,
    ruleId: string,
    input: {
      name?: string;
      trigger?: AutomationTrigger;
      actions?: ButtonAction[];
      enabled?: boolean;
    },
  ): Promise<MxdAutomationRule> {
    await this.requireTable(ctx, tableId, true);
    const fields = await this.fieldRepo.listByTable(ctx.workspaceId, tableId);
    const patch: any = {};
    if (input.name !== undefined) patch.name = input.name.trim() || 'Automation';
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    if (input.trigger !== undefined) {
      this.validateTrigger(fields, input.trigger);
      patch.trigger = input.trigger;
    }
    if (input.actions !== undefined) {
      validateButtonConfig(fields, { actions: input.actions });
      patch.actions = input.actions;
    }
    const updated = await this.ruleRepo.update(
      ctx.workspaceId,
      tableId,
      ruleId,
      patch,
    );
    if (!updated) throw new NotFoundException('Automation not found');
    return updated;
  }

  async deleteRule(
    ctx: MxdContext,
    tableId: string,
    ruleId: string,
  ): Promise<void> {
    await this.requireTable(ctx, tableId, true);
    const rule = await this.ruleRepo.findById(ctx.workspaceId, tableId, ruleId);
    if (!rule) throw new NotFoundException('Automation not found');
    await this.ruleRepo.delete(ctx.workspaceId, tableId, ruleId);
  }

  private matches(
    trigger: AutomationTrigger,
    triggerType: string,
    changedFieldIds: string[],
  ): boolean {
    if (trigger.type === 'record_created') return triggerType === 'record_created';
    if (trigger.type === 'record_updated') return triggerType === 'record_updated';
    if (trigger.type === 'field_changed') {
      return (
        triggerType === 'record_updated' &&
        !!trigger.fieldId &&
        changedFieldIds.includes(trigger.fieldId)
      );
    }
    return false;
  }

  // The executor. Runs synchronously within the emitting write (emitAsync) so a
  // records/get right after reflects the automation's effect. Bounded by BOTH
  // the chain-depth guard and the shared per-root-event write budget (breadth).
  //
  // The ENTIRE body is wrapped so nothing here can ever reject back through
  // emitAsync into the user's already-committed write (the record service also
  // swallows dispatch failures — this is the inner half of that guarantee).
  // Each rule is additionally isolated so one failing rule doesn't stop others.
  @OnEvent(MXD_RECORD_CHANGED)
  async onRecordChanged(event: MxdRecordChangedEvent): Promise<void> {
    try {
      await this.runRules(event);
    } catch (e: any) {
      // Last-resort guard: listEnabledForTable / unexpected errors must never
      // propagate out of the listener and fail the committed write.
      this.logger.error(
        `mxd automation executor failed for ${event.triggerType} ${event.tableId}/${event.recordId}: ${
          e?.message ?? e
        }`,
      );
    }
  }

  private async runRules(event: MxdRecordChangedEvent): Promise<void> {
    const { ctx, tableId, recordId, triggerType, changedFieldIds } = event;
    const depth = ctx.automationDepth ?? 0;
    if (depth >= MAX_AUTOMATION_DEPTH) return; // loop guard (chain length)
    // Breadth guard: if the shared root-event budget is already exhausted, stop
    // before doing any more work in this branch of the cascade.
    if (ctx.automationBudget && ctx.automationBudget.remaining <= 0) return;

    const rules = await this.ruleRepo.listEnabledForTable(
      ctx.workspaceId,
      tableId,
    );
    // childCtx carries the SAME budget object (spread copies the reference), so
    // every descendant write across the whole cascade draws down one budget.
    const childCtx: MxdContext = { ...ctx, automationDepth: depth + 1 };

    for (const rule of rules) {
      if (ctx.automationBudget && ctx.automationBudget.remaining <= 0) break;
      if (!this.matches(rule.trigger as any, triggerType, changedFieldIds)) {
        continue;
      }
      let status: 'success' | 'error' = 'success';
      let error: string | undefined;
      try {
        await this.actionRunner.run(
          childCtx,
          tableId,
          recordId,
          rule.actions as unknown as ButtonAction[],
          { allowOpenUrl: false },
        );
      } catch (e: any) {
        status = 'error';
        error = String(e?.message ?? e).slice(0, 500);
      }
      // Recording the run is itself isolated — a failure to write the audit row
      // must not abort the remaining rules or bubble out of the listener.
      try {
        await this.runRepo.insert({
          workspaceId: ctx.workspaceId,
          ruleId: rule.id,
          recordId,
          triggerType,
          status,
          ...(error ? { error } : {}),
        });
      } catch (e: any) {
        this.logger.error(
          `mxd automation run-log insert failed for rule ${rule.id}: ${
            e?.message ?? e
          }`,
        );
      }
    }
  }
}
