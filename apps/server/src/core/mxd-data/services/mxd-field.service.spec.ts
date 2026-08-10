import { BadRequestException } from '@nestjs/common';
import { MxdFieldService } from './mxd-field.service';
import { MxdContext } from '../mxd-context';

const ctx: MxdContext = { workspaceId: 'ws1', userId: 'u1' };

// A db whose transaction just runs the callback with a dummy trx.
const fakeDb = {
  transaction: () => ({ execute: (cb: any) => cb({}) }),
} as any;

function make(opts: {
  fields?: any[];
  records?: any[];
  table?: any;
} = {}) {
  const table = opts.table ?? {
    id: 't1',
    workspaceId: 'ws1',
    primaryFieldId: 'f_name',
  };
  const fields = opts.fields ?? [
    { id: 'f_name', name: 'Name', type: 'text', config: {} },
    { id: 'f_age', name: 'Age', type: 'text', config: {} },
  ];
  const tableRepo = {
    findById: jest.fn().mockResolvedValue(table),
    update: jest.fn().mockResolvedValue(table),
  };
  const fieldRepo = {
    findById: jest
      .fn()
      .mockImplementation(async (_w, _t, id) => fields.find((f) => f.id === id)),
    listByTable: jest.fn().mockResolvedValue(fields),
    maxPosition: jest.fn().mockResolvedValue(1),
    insert: jest.fn().mockImplementation(async (v) => ({ id: 'new', ...v })),
    update: jest
      .fn()
      .mockImplementation(async (_w, _t, id, patch) => ({ id, ...patch })),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const recordRepo = {
    allForTable: jest.fn().mockResolvedValue(opts.records ?? []),
    stripField: jest.fn().mockResolvedValue(undefined),
    replaceData: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    authorizeRead: jest.fn().mockResolvedValue(undefined),
    authorizeWrite: jest.fn().mockResolvedValue(undefined),
    canRead: jest.fn().mockResolvedValue(true),
  };
  const service = new MxdFieldService(
    fakeDb,
    tableRepo as any,
    fieldRepo as any,
    recordRepo as any,
    access as any,
  );
  return { service, tableRepo, fieldRepo, recordRepo, access };
}

describe('MxdFieldService', () => {
  it('rejects an unknown field type on add', async () => {
    const { service } = make();
    await expect(
      service.addField(ctx, 't1', { name: 'X', type: 'bogus' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a duplicate field name (case-insensitive)', async () => {
    const { service } = make();
    await expect(
      service.addField(ctx, 't1', { name: 'name', type: 'text' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames without touching records (stable id)', async () => {
    const { service, recordRepo, fieldRepo } = make();
    await service.renameField(ctx, 't1', 'f_age', 'Years');
    expect(recordRepo.replaceData).not.toHaveBeenCalled();
    expect(fieldRepo.update).toHaveBeenCalledWith('ws1', 't1', 'f_age', {
      name: 'Years',
    });
  });

  describe('changeType (conversion policy)', () => {
    const records = [
      { id: 'r1', data: { f_age: '42' }, version: 1 },
      { id: 'r2', data: { f_age: 'oops' }, version: 1 },
    ];

    it('refuses when some values are incompatible', async () => {
      const { service } = make({ records });
      await expect(
        service.changeType(ctx, 't1', 'f_age', 'number'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('converts compatible values and clears incompatible when asked', async () => {
      const { service, recordRepo, fieldRepo } = make({ records });
      await service.changeType(ctx, 't1', 'f_age', 'number', {
        clearIncompatible: true,
      });
      // r1 converted to number 42
      expect(recordRepo.replaceData).toHaveBeenCalledWith(
        'ws1',
        't1',
        'r1',
        { f_age: 42 },
        expect.anything(),
      );
      // r2 cleared (key removed)
      expect(recordRepo.replaceData).toHaveBeenCalledWith(
        'ws1',
        't1',
        'r2',
        {},
        expect.anything(),
      );
      expect(fieldRepo.update).toHaveBeenCalledWith(
        'ws1',
        't1',
        'f_age',
        expect.objectContaining({ type: 'number' }),
        expect.anything(),
      );
    });

    it('refuses converting to a relation when values exist (would discard)', async () => {
      const { service } = make({
        records: [{ id: 'r1', data: { f_age: '42' }, version: 1 }],
      });
      await expect(
        service.changeType(ctx, 't1', 'f_age', 'relation'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('deleteField strips cells, deletes, and promotes the primary', async () => {
    const { service, recordRepo, fieldRepo, tableRepo } = make();
    await service.deleteField(ctx, 't1', 'f_name'); // f_name is primary
    expect(recordRepo.stripField).toHaveBeenCalledWith(
      'ws1',
      't1',
      'f_name',
      expect.anything(),
    );
    expect(fieldRepo.delete).toHaveBeenCalled();
    // primary promoted to the next field (f_age)
    expect(tableRepo.update).toHaveBeenCalledWith(
      'ws1',
      't1',
      { primaryFieldId: 'f_age' },
      expect.anything(),
    );
  });
});
