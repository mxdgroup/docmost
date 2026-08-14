import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MxdRecordService } from './mxd-record.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1' };

const fields = [
  { id: 'f_name', type: 'text', name: 'Name', config: {} },
  { id: 'f_age', type: 'number', name: 'Age', config: {} },
  { id: 'f_calc', type: 'formula', name: 'Calc', config: {} },
];

function make(overrides: any = {}) {
  const tableRepo = {
    findById: jest.fn().mockResolvedValue({ id: 't1', workspaceId: 'ws1' }),
  };
  const fieldRepo = {
    listByTable: jest.fn().mockResolvedValue(fields),
  };
  const recordRepo = {
    maxPosition: jest.fn().mockResolvedValue(0),
    insert: jest.fn().mockImplementation(async (v: any) => ({
      id: 'r1',
      version: 1,
      ...v,
    })),
    findById: jest
      .fn()
      .mockResolvedValue({ id: 'r1', version: 3, data: { f_name: 'old' } }),
    updateWithVersion: jest.fn(),
    softDeleteWithVersion: jest.fn(),
    queryView: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    ...overrides,
  };
  const viewRepo = { findById: jest.fn() };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
    canRead: jest.fn().mockResolvedValue(true),
  };
  const compute = {
    enrich: jest.fn().mockImplementation(async (_c, _f, records) => records),
  };
  const eventEmitter = { emitAsync: jest.fn().mockResolvedValue([]) };
  const historyRepo = {
    insert: jest.fn().mockResolvedValue(undefined),
    listByRecord: jest.fn().mockResolvedValue([]),
  };
  const service = new MxdRecordService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    viewRepo as any,
    access as any,
    compute as any,
    eventEmitter as any,
    historyRepo as any,
  );
  return {
    service,
    tableRepo,
    fieldRepo,
    recordRepo,
    viewRepo,
    access,
    compute,
    eventEmitter,
    historyRepo,
  };
}

describe('MxdRecordService', () => {
  it('creates a record with normalized cell values', async () => {
    const { service, recordRepo } = make();
    await service.createRecord(ctx, 't1', { f_name: 42, f_age: '7' });
    const inserted = recordRepo.insert.mock.calls[0][0];
    expect(inserted.data).toEqual({ f_name: '42', f_age: 7 }); // coerced/parsed
    expect(inserted.workspaceId).toBe('ws1');
    expect(inserted.tableId).toBe('t1');
  });

  it('rejects a field id that is not on this table (IDOR/integrity)', async () => {
    const { service } = make();
    await expect(
      service.createRecord(ctx, 't1', { f_other: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects writing a computed field directly', async () => {
    const { service } = make();
    await expect(
      service.createRecord(ctx, 't1', { f_calc: '5' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an invalid value for the field type', async () => {
    const { service } = make();
    await expect(
      service.createRecord(ctx, 't1', { f_age: 'not-a-number' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s when the table is not in the workspace', async () => {
    const { service, tableRepo } = make();
    tableRepo.findById.mockResolvedValue(undefined);
    await expect(service.getRecord(ctx, 't1', 'r1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates when the version matches, merging the patch', async () => {
    const { service, recordRepo } = make({
      updateWithVersion: jest
        .fn()
        .mockResolvedValue({ id: 'r1', version: 4, data: {} }),
    });
    await service.updateRecord(ctx, 't1', 'r1', 3, { f_age: 9 });
    const args = recordRepo.updateWithVersion.mock.calls[0];
    expect(args[3]).toBe(3); // expectedVersion
    expect(args[4]).toEqual({ f_name: 'old', f_age: 9 }); // merged
  });

  it('409s on a stale update instead of clobbering', async () => {
    const { service } = make({
      updateWithVersion: jest.fn().mockResolvedValue(undefined),
    });
    await expect(
      service.updateRecord(ctx, 't1', 'r1', 1, { f_age: 9 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409s on a stale delete when the record still exists', async () => {
    const { service } = make({
      softDeleteWithVersion: jest.fn().mockResolvedValue(undefined),
    });
    await expect(
      service.deleteRecord(ctx, 't1', 'r1', 1),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('query: inline config with an illegal operator is rejected (400)', async () => {
    const { service } = make();
    await expect(
      service.queryRecords(ctx, 't1', {
        config: {
          filter: {
            combinator: 'and',
            conditions: [{ fieldId: 'f_age', op: 'contains' as any, value: 'x' }],
          },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('query: valid inline filter reaches queryView', async () => {
    const { service, recordRepo } = make();
    await service.queryRecords(ctx, 't1', {
      config: {
        filter: {
          combinator: 'and',
          conditions: [{ fieldId: 'f_age', op: 'gt', value: 5 }],
        },
      },
    });
    expect(recordRepo.queryView).toHaveBeenCalled();
  });

  it('query: a stored view with a now-illegal condition is sanitized, not rejected', async () => {
    const { service, recordRepo, viewRepo } = make();
    viewRepo.findById.mockResolvedValue({
      id: 'v1',
      config: {
        filter: {
          combinator: 'and',
          conditions: [{ fieldId: 'f_age', op: 'contains', value: 'x' }],
        },
      },
    });
    await expect(
      service.queryRecords(ctx, 't1', { viewId: 'v1' }),
    ).resolves.toBeTruthy();
    expect(recordRepo.queryView).toHaveBeenCalled();
  });

  it('caps the list limit at 200', async () => {
    const { service, recordRepo } = make({
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    });
    await service.listRecords(ctx, 't1', { limit: 100000 });
    expect(recordRepo.list.mock.calls[0][2]).toBe(200);
  });

  describe('searchRecords', () => {
    it('queries an OR-of-contains over text fields and enriches results', async () => {
      const { service, recordRepo, access, compute } = make({
        queryView: jest
          .fn()
          .mockResolvedValue({ items: [{ id: 'r1', data: {} }], total: 1 }),
      });
      const res = await service.searchRecords(ctx, 't1', 'ali', {});
      expect(access.authorizeRead).toHaveBeenCalled();
      // built a compiled WHERE and ran it through the view query path
      expect(recordRepo.queryView).toHaveBeenCalled();
      const where = recordRepo.queryView.mock.calls[0][2];
      expect(where).not.toBeNull();
      expect(compute.enrich).toHaveBeenCalled();
      expect(res.total).toBe(1);
    });

    it('short-circuits to empty for a blank term (no query issued)', async () => {
      const { service, recordRepo } = make();
      const res = await service.searchRecords(ctx, 't1', '   ', {});
      expect(res.items).toEqual([]);
      expect(recordRepo.queryView).not.toHaveBeenCalled();
    });

    it('returns empty when the table has no text-like fields', async () => {
      const { service, recordRepo, fieldRepo } = make();
      fieldRepo.listByTable.mockResolvedValueOnce([
        { id: 'f_age', type: 'number', name: 'Age', config: {} },
      ]);
      const res = await service.searchRecords(ctx, 't1', 'ali', {});
      expect(res.items).toEqual([]);
      expect(recordRepo.queryView).not.toHaveBeenCalled();
    });
  });

  describe('history/audit', () => {
    it('appends a create history entry with the actor and changed fields', async () => {
      const { service, historyRepo } = make();
      await service.createRecord(ctx, 't1', { f_name: 'Ada' });
      const entry = historyRepo.insert.mock.calls[0][0];
      expect(entry.action).toBe('create');
      expect(entry.actorId).toBe('u1');
      expect(entry.changedFieldIds).toEqual(['f_name']);
    });

    it('appends an update history entry with the after-snapshot', async () => {
      const { service, recordRepo, historyRepo } = make({
        updateWithVersion: jest
          .fn()
          .mockResolvedValue({ id: 'r1', version: 4, data: { f_name: 'new' } }),
      });
      await service.updateRecord(ctx, 't1', 'r1', 3, { f_name: 'new' });
      const entry = historyRepo.insert.mock.calls[0][0];
      expect(entry.action).toBe('update');
      expect(entry.data).toEqual({ f_name: 'new' });
      expect(entry.changedFieldIds).toEqual(['f_name']);
    });

    it('appends a delete history entry with the before-snapshot', async () => {
      const { service, historyRepo } = make({
        softDeleteWithVersion: jest
          .fn()
          .mockResolvedValue({ id: 'r1', version: 4, data: { f_name: 'gone' } }),
      });
      await service.deleteRecord(ctx, 't1', 'r1', 3);
      const entry = historyRepo.insert.mock.calls[0][0];
      expect(entry.action).toBe('delete');
      expect(entry.data).toEqual({ f_name: 'gone' });
    });

    it('never fails the mutation if the audit insert throws', async () => {
      const { service, historyRepo } = make();
      historyRepo.insert.mockRejectedValueOnce(new Error('audit down'));
      await expect(
        service.createRecord(ctx, 't1', { f_name: 'Ada' }),
      ).resolves.toBeTruthy();
    });

    it('lists history most-recent-first, capped at 200', async () => {
      const { service, historyRepo } = make();
      await service.listHistory(ctx, 't1', 'r1', 100000);
      expect(historyRepo.listByRecord).toHaveBeenCalledWith('ws1', 't1', 'r1', 200);
    });
  });

  describe('automation dispatch isolation (P1 regression)', () => {
    // A committed write must never be turned into a failure by a downstream
    // automation-listener error — otherwise the client retries and duplicates.
    it('still resolves createRecord when the change listener rejects', async () => {
      const { service, eventEmitter, recordRepo } = make();
      eventEmitter.emitAsync.mockRejectedValueOnce(new Error('automation blew up'));
      await expect(
        service.createRecord(ctx, 't1', { f_name: 'Ada' }),
      ).resolves.toBeTruthy();
      // the row was inserted before the (failed) dispatch
      expect(recordRepo.insert).toHaveBeenCalledTimes(1);
    });

    it('still resolves updateRecord when the change listener rejects', async () => {
      const { service, eventEmitter } = make({
        updateWithVersion: jest
          .fn()
          .mockResolvedValue({ id: 'r1', version: 4, data: { f_name: 'new' } }),
      });
      eventEmitter.emitAsync.mockRejectedValueOnce(new Error('automation blew up'));
      await expect(
        service.updateRecord(ctx, 't1', 'r1', 3, { f_name: 'new' }),
      ).resolves.toBeTruthy();
    });

    // A root user write seeds a shared fan-out budget onto the emitted event's
    // ctx, so the whole cascade draws down a single MAX_AUTOMATION_WRITES pool.
    it('seeds a shared automation budget on the emitted event for a root write', async () => {
      const { service, eventEmitter } = make();
      await service.createRecord(ctx, 't1', { f_name: 'Ada' });
      const event = eventEmitter.emitAsync.mock.calls[0][1];
      expect(event.ctx.automationBudget).toBeDefined();
      expect(event.ctx.automationBudget.remaining).toBeGreaterThan(0);
    });

    it('does not reset an existing budget on a nested write', async () => {
      const { service, eventEmitter } = make();
      const budget = { remaining: 7 };
      await service.createRecord(
        { ...ctx, automationBudget: budget } as MxdContext,
        't1',
        { f_name: 'Ada' },
      );
      const event = eventEmitter.emitAsync.mock.calls[0][1];
      expect(event.ctx.automationBudget).toBe(budget); // same object, not reseeded
      expect(event.ctx.automationBudget.remaining).toBe(7);
    });
  });
});
