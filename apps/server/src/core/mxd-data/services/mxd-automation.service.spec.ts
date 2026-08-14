import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MxdAutomationService } from './mxd-automation.service';
import { MxdContext, MxdRecordChangedEvent } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1', user: { id: 'u1' } as any };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name' },
  { id: 'f_status', type: 'text', name: 'Status' },
];

function make(over: any = {}) {
  const tableRepo = {
    findById: jest.fn().mockResolvedValue({ id: 't1', pageId: 'p1', spaceId: 's1' }),
  };
  const fieldRepo = { listByTable: jest.fn().mockResolvedValue(fields) };
  const ruleRepo = {
    insert: jest.fn().mockImplementation(async (v: any) => ({ id: 'a1', ...v })),
    findById: jest.fn().mockResolvedValue(over.rule ?? { id: 'a1' }),
    listByTable: jest.fn().mockResolvedValue([]),
    listEnabledForTable: jest.fn().mockResolvedValue(over.enabledRules ?? []),
    update: jest.fn().mockImplementation(async (_w, _t, id, p) => ({ id, ...p })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const runRepo = { insert: jest.fn().mockResolvedValue(undefined) };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
  };
  const actionRunner = { run: jest.fn().mockResolvedValue({ directives: [] }) };
  const service = new MxdAutomationService(
    tableRepo as any,
    fieldRepo as any,
    ruleRepo as any,
    runRepo as any,
    access as any,
    actionRunner as any,
  );
  return { service, tableRepo, fieldRepo, ruleRepo, runRepo, access, actionRunner };
}

describe('MxdAutomationService — CRUD', () => {
  it('creates a rule after authorizing write and validating trigger + actions', async () => {
    const { service, access, ruleRepo } = make();
    const rule = await service.createRule(ctx, 't1', {
      name: 'Set status',
      trigger: { type: 'record_created' },
      actions: [{ type: 'setField', fieldId: 'f_status', value: 'new' } as any],
    });
    expect(access.authorizeWrite).toHaveBeenCalled();
    expect(ruleRepo.insert).toHaveBeenCalled();
    expect(rule.enabled).toBe(true); // defaults enabled
  });

  it('rejects an unknown trigger type', async () => {
    const { service } = make();
    await expect(
      service.createRule(ctx, 't1', {
        trigger: { type: 'on_full_moon' } as any,
        actions: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a field_changed trigger with an unknown fieldId', async () => {
    const { service } = make();
    await expect(
      service.createRule(ctx, 't1', {
        trigger: { type: 'field_changed', fieldId: 'ghost' },
        actions: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an action referencing an unsettable/unknown field', async () => {
    const { service } = make();
    await expect(
      service.createRule(ctx, 't1', {
        trigger: { type: 'record_created' },
        actions: [{ type: 'setField', fieldId: 'ghost', value: 1 } as any],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s updating a missing rule', async () => {
    const { service, ruleRepo } = make();
    ruleRepo.update.mockResolvedValueOnce(undefined);
    await expect(
      service.updateRule(ctx, 't1', 'nope', { enabled: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MxdAutomationService — executor', () => {
  const rule = (over: any = {}) => ({
    id: 'a1',
    enabled: true,
    trigger: { type: 'record_created' },
    actions: [{ type: 'setField', fieldId: 'f_status', value: 'new' }],
    ...over,
  });

  const event = (over: Partial<MxdRecordChangedEvent> = {}): MxdRecordChangedEvent => ({
    ctx,
    tableId: 't1',
    recordId: 'r1',
    triggerType: 'record_created',
    changedFieldIds: [],
    ...over,
  });

  it('runs a matching enabled rule and logs a success run', async () => {
    const { service, actionRunner, runRepo } = make({ enabledRules: [rule()] });
    await service.onRecordChanged(event());
    expect(actionRunner.run).toHaveBeenCalledTimes(1);
    // executor forbids openUrl
    expect(actionRunner.run.mock.calls[0][4]).toEqual({ allowOpenUrl: false });
    expect(runRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', ruleId: 'a1' }),
    );
  });

  it('increments automation depth for the actions it triggers', async () => {
    const { service, actionRunner } = make({ enabledRules: [rule()] });
    await service.onRecordChanged(event());
    const childCtx = actionRunner.run.mock.calls[0][0];
    expect(childCtx.automationDepth).toBe(1);
  });

  it('stops once the depth cap is reached (loop guard)', async () => {
    const { service, actionRunner } = make({ enabledRules: [rule()] });
    await service.onRecordChanged(event({ ctx: { ...ctx, automationDepth: 5 } }));
    expect(actionRunner.run).not.toHaveBeenCalled();
  });

  it('does not run a rule whose trigger does not match the event', async () => {
    const { service, actionRunner } = make({
      enabledRules: [rule({ trigger: { type: 'record_updated' } })],
    });
    await service.onRecordChanged(event({ triggerType: 'record_created' }));
    expect(actionRunner.run).not.toHaveBeenCalled();
  });

  it('field_changed matches only when its field is among the changed ids', async () => {
    const { service, actionRunner } = make({
      enabledRules: [rule({ trigger: { type: 'field_changed', fieldId: 'f_status' } })],
    });
    await service.onRecordChanged(
      event({ triggerType: 'record_updated', changedFieldIds: ['f_name'] }),
    );
    expect(actionRunner.run).not.toHaveBeenCalled();
    await service.onRecordChanged(
      event({ triggerType: 'record_updated', changedFieldIds: ['f_status'] }),
    );
    expect(actionRunner.run).toHaveBeenCalledTimes(1);
  });

  it('isolates a failing rule — logs an error run and never rethrows', async () => {
    const { service, actionRunner, runRepo } = make({ enabledRules: [rule()] });
    actionRunner.run.mockRejectedValueOnce(new Error('boom'));
    await expect(service.onRecordChanged(event())).resolves.toBeUndefined();
    expect(runRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', error: 'boom' }),
    );
  });

  // P1 regression: the executor must never reject back through emitAsync into
  // the committed write, even for errors OUTSIDE the per-rule try/catch.
  it('swallows a listEnabledForTable failure (never rethrows to the write)', async () => {
    const { service, ruleRepo } = make();
    ruleRepo.listEnabledForTable.mockRejectedValueOnce(new Error('db blip'));
    await expect(service.onRecordChanged(event())).resolves.toBeUndefined();
  });

  it('swallows a run-log insert failure (never rethrows to the write)', async () => {
    const { service, runRepo } = make({ enabledRules: [rule()] });
    runRepo.insert.mockRejectedValueOnce(new Error('run-log down'));
    await expect(service.onRecordChanged(event())).resolves.toBeUndefined();
  });

  // P0 regression: with a shared budget already exhausted, the executor does no
  // work in this branch of the cascade — total fan-out stays bounded.
  it('stops when the shared fan-out budget is exhausted', async () => {
    const { service, actionRunner } = make({ enabledRules: [rule()] });
    await service.onRecordChanged(
      event({ ctx: { ...ctx, automationBudget: { remaining: 0 } } }),
    );
    expect(actionRunner.run).not.toHaveBeenCalled();
  });
});
