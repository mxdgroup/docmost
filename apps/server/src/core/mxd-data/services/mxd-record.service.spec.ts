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
    ...overrides,
  };
  const service = new MxdRecordService(
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
  );
  return { service, tableRepo, fieldRepo, recordRepo };
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

  it('caps the list limit at 200', async () => {
    const { service, recordRepo } = make({
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    });
    await service.listRecords(ctx, 't1', { limit: 100000 });
    expect(recordRepo.list.mock.calls[0][2]).toBe(200);
  });
});
